#!/usr/bin/env python3
"""Build a sanitized interactive demo from local report output."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from pathlib import Path


def stable_int(text: str) -> int:
    return int(hashlib.sha1(text.encode("utf-8")).hexdigest()[:12], 16)


def perturb_amount(amount: float, seed: str, merchant_key: str, date_key: str) -> float:
    base_raw = stable_int(f"{seed}|merchant|{merchant_key}") % 2200
    base_factor = 0.62 + base_raw / 10000.0  # 0.62 ~ 0.8399
    jitter_raw = stable_int(f"{seed}|jitter|{date_key}|{merchant_key}") % 61
    jitter = (jitter_raw - 30) / 100.0  # -0.30 ~ +0.30
    value = max(1.0, amount * base_factor + jitter)
    return round(value, 2)


def shift_date(date_str: str, seed: str) -> str:
    try:
        dt = datetime.strptime(date_str, "%Y-%m-%d")
    except ValueError:
        return date_str
    offset = (stable_int(f"{seed}|date|{date_str}") % 19) - 9
    return (dt + timedelta(days=offset)).strftime("%Y-%m-%d")


def alloc_sample_per_month(month_counts: dict[str, int], sample_size: int) -> dict[str, int]:
    total = sum(month_counts.values())
    if sample_size <= 0 or sample_size >= total:
        return {m: c for m, c in month_counts.items()}
    base = {}
    fractions: list[tuple[float, str]] = []
    used = 0
    for month, count in month_counts.items():
        raw = sample_size * count / total
        take = int(raw)
        if count > 0 and take == 0:
            take = 1
        take = min(take, count)
        base[month] = take
        used += take
        fractions.append((raw - int(raw), month))
    if used > sample_size:
        # trim smallest fractional parts first
        for _, month in sorted(fractions):
            if used <= sample_size:
                break
            if base[month] > 1:
                base[month] -= 1
                used -= 1
    if used < sample_size:
        for _, month in sorted(fractions, reverse=True):
            if used >= sample_size:
                break
            if base[month] < month_counts[month]:
                base[month] += 1
                used += 1
    return base


def aggregate(payload: dict) -> dict:
    txns = payload["transactions"]
    categories: dict[str, dict] = defaultdict(lambda: {"amount": 0.0, "count": 0, "review_count": 0})
    months: dict[str, dict] = defaultdict(lambda: {"amount": 0.0, "count": 0, "review_count": 0})
    merchants: dict[str, dict] = defaultdict(lambda: {"amount": 0.0, "count": 0, "review_count": 0, "cats": Counter()})

    for row in txns:
        amount = float(row["amount"])
        cat = row["category"]
        month = row["month"]
        merchant = row["merchant"]
        review = int(row.get("needs_review", 0))

        categories[cat]["amount"] += amount
        categories[cat]["count"] += 1
        categories[cat]["review_count"] += review

        months[month]["amount"] += amount
        months[month]["count"] += 1
        months[month]["review_count"] += review

        merchants[merchant]["amount"] += amount
        merchants[merchant]["count"] += 1
        merchants[merchant]["review_count"] += review
        merchants[merchant]["cats"][cat] += 1

    month_list = [
        {
            "month": month,
            "amount": round(v["amount"], 2),
            "count": v["count"],
            "review_count": v["review_count"],
        }
        for month, v in sorted(months.items())
    ]
    category_list = [
        {
            "category": cat,
            "amount": round(v["amount"], 2),
            "count": v["count"],
            "review_count": v["review_count"],
        }
        for cat, v in categories.items()
    ]
    category_list.sort(key=lambda x: x["amount"], reverse=True)

    merchant_list = []
    for merchant, v in merchants.items():
        main_cat = v["cats"].most_common(1)[0][0] if v["cats"] else "待分类"
        merchant_list.append(
            {
                "merchant": merchant,
                "amount": round(v["amount"], 2),
                "count": v["count"],
                "category": main_cat,
            }
        )
    merchant_list.sort(key=lambda x: x["amount"], reverse=True)

    total = round(sum(float(x["amount"]) for x in txns), 2)
    review_count = sum(int(x.get("needs_review", 0)) for x in txns)
    consume_count = len(txns)
    excluded_count = int(payload.get("excluded_consumption_count", 0))
    excluded_total = float(payload.get("excluded_consumption_total_value", 0.0))
    raw_count = consume_count + excluded_count
    raw_total = round(total + excluded_total, 2)

    top_expense_categories = [
        {"expense_category": x["category"], "amount": f"{x['amount']:.2f}"}
        for x in category_list[:10]
    ]

    payload["transactions"] = txns
    payload["months"] = month_list
    payload["categories"] = category_list
    payload["merchants"] = merchant_list
    payload["top_expense_categories"] = top_expense_categories
    payload["consumption_count"] = consume_count
    payload["consumption_total_value"] = total
    payload["consumption_total"] = f"{total:.2f}"
    payload["needs_review_count"] = review_count
    payload["needs_review_ratio"] = (review_count / consume_count) if consume_count else 0.0
    payload["raw_consumption_count"] = raw_count
    payload["raw_consumption_total_value"] = raw_total
    payload["raw_consumption_total"] = f"{raw_total:.2f}"
    return payload


def sanitize_payload(data: dict, seed: str, sample_size: int) -> dict:
    txns = list(data.get("transactions", []))
    if not txns:
        raise ValueError("源数据 transactions 为空")

    # deterministic sample
    month_groups: dict[str, list[dict]] = defaultdict(list)
    for row in txns:
        month_groups[str(row.get("month", "未知"))].append(row)
    alloc = alloc_sample_per_month({m: len(v) for m, v in month_groups.items()}, sample_size)
    sampled: list[dict] = []
    for month, rows in month_groups.items():
        rows_sorted = sorted(
            rows,
            key=lambda r: stable_int(f"{seed}|pick|{r.get('date','')}|{r.get('merchant','')}|{r.get('description','')}"),
        )
        sampled.extend(rows_sorted[: alloc[month]])

    merchants_sorted = sorted({str(x.get("merchant", "")) for x in sampled if x.get("merchant")})
    merchant_map = {m: f"商户{idx+1:03d}" for idx, m in enumerate(merchants_sorted)}

    sanitized = []
    for idx, row in enumerate(sampled, start=1):
        new_row = dict(row)
        old_merchant = str(row.get("merchant", "未知商户"))
        old_date = str(row.get("date", ""))
        new_date = shift_date(old_date, seed)
        new_amount = perturb_amount(float(row.get("amount", 0.0)), seed, old_merchant, old_date)
        category = str(row.get("category", "待分类"))

        new_row["merchant"] = merchant_map.get(old_merchant, "商户000")
        new_row["description"] = f"{category}交易-{idx:04d}"
        new_row["date"] = new_date
        new_row["month"] = new_date[:7] if len(new_date) >= 7 else str(row.get("month", "未知"))
        new_row["amount"] = new_amount
        new_row["source_path"] = f"statements/{new_row['month']}.eml"
        sanitized.append(new_row)

    demo = dict(data)
    demo["transactions"] = sanitized
    demo["generated_at"] = f"DEMO {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"
    demo["input_files_count"] = min(12, int(data.get("input_files_count", 12)))
    demo["failed_files_count"] = 0

    # Obfuscate excluded total as well
    old_excluded = float(data.get("excluded_consumption_total_value", 0.0))
    ex_factor = 0.55 + (stable_int(f"{seed}|excluded") % 2100) / 10000.0
    new_excluded = round(old_excluded * ex_factor, 2)
    demo["excluded_consumption_total_value"] = new_excluded
    demo["excluded_consumption_total"] = f"{new_excluded:.2f}"
    demo["excluded_consumption_count"] = int(data.get("excluded_consumption_count", 0))

    return aggregate(demo)


def replace_report_data(html_text: str, payload: dict) -> str:
    marker = "const REPORT_DATA = "
    tail = ";\n    const COLORS ="
    start = html_text.find(marker)
    if start < 0:
        raise ValueError("HTML 中未找到 REPORT_DATA 标记")
    json_start = start + len(marker)
    end = html_text.find(tail, json_start)
    if end < 0:
        raise ValueError("HTML 中未找到 REPORT_DATA 结束标记")
    data_json = json.dumps(payload, ensure_ascii=False).replace("</", "<\\/")
    out = html_text[:json_start] + data_json + html_text[end:]
    return out.replace("消费分析引擎 · 本地生成", "消费分析引擎 · 脱敏示例")


def write_category_exports(base_dir: Path, payload: dict) -> None:
    cat_dir = base_dir / "category"
    cat_dir.mkdir(parents=True, exist_ok=True)

    with (cat_dir / "summary_by_expense_category.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["expense_category", "consume_count", "consume_total", "review_count"])
        for item in payload["categories"]:
            w.writerow(
                [
                    item["category"],
                    item["count"],
                    f"{float(item['amount']):.2f}",
                    item["review_count"],
                ]
            )

    with (cat_dir / "summary_by_merchant.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["merchant_normalized", "expense_category", "consume_count", "consume_total", "review_count"])
        merchant_reviews = defaultdict(int)
        for row in payload["transactions"]:
            merchant_reviews[row["merchant"]] += int(row.get("needs_review", 0))
        for item in payload["merchants"]:
            w.writerow(
                [
                    item["merchant"],
                    item["category"],
                    item["count"],
                    f"{float(item['amount']):.2f}",
                    merchant_reviews[item["merchant"]],
                ]
            )

    with (cat_dir / "needs_review.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(
            [
                "source_path",
                "post_date",
                "description",
                "merchant_normalized",
                "amount_rmb",
                "expense_category",
                "classify_source",
                "confidence",
            ]
        )
        for row in payload["transactions"]:
            if int(row.get("needs_review", 0)) != 1:
                continue
            w.writerow(
                [
                    row.get("source_path", ""),
                    row.get("date", ""),
                    row.get("description", ""),
                    row.get("merchant", ""),
                    f"{float(row.get('amount', 0.0)):.2f}",
                    row.get("category", "待分类"),
                    "demo",
                    f"{float(row.get('confidence', 0.0)):.2f}",
                ]
            )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate sanitized interactive demo files.")
    parser.add_argument(
        "--analysis-json",
        type=Path,
        default=Path("data/output/reports/consumption_analysis.json"),
        help="Source analysis JSON.",
    )
    parser.add_argument(
        "--report-html",
        type=Path,
        default=Path("data/output/reports/consumption_report.html"),
        help="Source report HTML.",
    )
    parser.add_argument(
        "--report-css",
        type=Path,
        default=Path("data/output/reports/consumption_report.css"),
        help="Source report CSS.",
    )
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=Path("examples"),
        help="Output base directory (will write demo/ and category/).",
    )
    parser.add_argument(
        "--seed",
        default="keepwise-demo-v1",
        help="Deterministic seed for masking.",
    )
    parser.add_argument(
        "--sample-size",
        type=int,
        default=420,
        help="How many transactions to keep in demo. <=0 keeps all.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if not args.analysis_json.exists():
        raise FileNotFoundError(f"未找到源分析 JSON: {args.analysis_json}")
    if not args.report_html.exists():
        raise FileNotFoundError(f"未找到源报告 HTML: {args.report_html}")
    if not args.report_css.exists():
        raise FileNotFoundError(f"未找到源报告 CSS: {args.report_css}")

    src = json.loads(args.analysis_json.read_text(encoding="utf-8"))
    demo_payload = sanitize_payload(src, args.seed, args.sample_size)

    out_demo = args.out_dir / "demo"
    out_demo.mkdir(parents=True, exist_ok=True)
    write_category_exports(args.out_dir, demo_payload)

    demo_json_path = out_demo / "consumption_analysis.json"
    demo_html_path = out_demo / "consumption_report.html"
    demo_index_path = out_demo / "index.html"
    demo_css_path = out_demo / "consumption_report.css"

    demo_json_path.write_text(json.dumps(demo_payload, ensure_ascii=False, indent=2), encoding="utf-8")
    demo_css_path.write_text(args.report_css.read_text(encoding="utf-8"), encoding="utf-8")
    html_source = args.report_html.read_text(encoding="utf-8")
    demo_html = replace_report_data(html_source, demo_payload)
    demo_html_path.write_text(demo_html, encoding="utf-8")
    demo_index_path.write_text(demo_html, encoding="utf-8")

    readme = args.out_dir / "demo" / "README.md"
    readme.write_text(
        "\n".join(
            [
                "# KeepWise Demo",
                "",
                "这是一份脱敏示例数据生成的交互式报告。",
                "",
                "- 打开 `consumption_report.html` 可直接查看交互。",
                "- 若用于 GitHub Pages，可直接访问 `index.html`。",
                "- `consumption_analysis.json` 是同一份 demo 数据。",
                "- `../category/*.csv` 为报告顶部链接对应的示例 CSV。",
                "",
                "注意：该示例数据已做商户/摘要/来源脱敏，并对金额做混淆处理，仅用于演示交互。",
            ]
        ),
        encoding="utf-8",
    )

    print("Demo files generated:")
    print(f"- {demo_html_path}")
    print(f"- {demo_index_path}")
    print(f"- {demo_css_path}")
    print(f"- {demo_json_path}")
    print(f"- {args.out_dir / 'category' / 'summary_by_expense_category.csv'}")
    print(f"- {args.out_dir / 'category' / 'summary_by_merchant.csv'}")
    print(f"- {args.out_dir / 'category' / 'needs_review.csv'}")


if __name__ == "__main__":
    main()
