#!/usr/bin/env python3
"""Parse and import CMB bank transaction statement PDF into ledger transactions."""

from __future__ import annotations

import csv
import re
from dataclasses import dataclass
from pathlib import Path
from statistics import median
from typing import Any

import import_classified_to_ledger as ledger_import_mod
import parse_cmb_statements as parser_mod

SUMMARY_PREFIXES = sorted(
    [
        "代发住房公积金",
        "信用卡自动还款",
        "本行ATM无卡取款",
        "一网通支付鼓励金",
        "结售汇即时售汇",
        "结售汇即时结汇",
        "基金快速赎回",
        "基金申购",
        "基金赎回",
        "基金认购",
        "行内转账转入",
        "行内转账转出",
        "朝朝宝转入",
        "朝朝宝转出",
        "国际结算解付款项",
        "银联无卡自助消费",
        "银联快捷支付",
        "信用卡还款",
        "转账汇款",
        "个贷交易",
        "个贷放款",
        "账户结息",
        "快捷退款",
        "快捷支付",
        "银联消费",
        "银联代付",
        "汇入汇款",
        "代发工资",
        "转出到分仓",
        "转入到分仓",
        "从分仓转入",
        "基金退款",
        "即时委托",
        "分红",
        "强赎",
        "还本",
        "申购",
        "赎回",
    ],
    key=len,
    reverse=True,
)

INVESTMENT_OR_FX_SUMMARIES = {
    "基金申购",
    "基金赎回",
    "基金快速赎回",
    "基金认购",
    "基金退款",
    "申购",
    "赎回",
    "朝朝宝转入",
    "朝朝宝转出",
    "转出到分仓",
    "转入到分仓",
    "从分仓转入",
    "分红",
    "强赎",
    "还本",
    "即时委托",
    "国际结算解付款项",
    "结售汇即时售汇",
    "结售汇即时结汇",
}
SKIP_SUMMARIES = INVESTMENT_OR_FX_SUMMARIES | {
    "信用卡自动还款",
    "信用卡还款",
    "个贷放款",
    "汇入汇款",
    "行内转账转入",
    "账户结息",
    "一网通支付鼓励金",
    "快捷退款",
    "银联代付",
}
DEBIT_PAYMENT_SUMMARIES = {"快捷支付", "银联快捷支付", "银联消费", "银联无卡自助消费"}
BANK_TRANSFER_OUT_SUMMARIES = {"转账汇款", "行内转账转出"}
WECHAT_TRANSFER_PREFIXES = ("微信转账", "微信红包")
PERSONAL_TRANSFER_WHITELIST = {"徐凯"}
PERSON_NAME_RE = re.compile(r"^([\u4e00-\u9fa5]{2,4})(?:\s+\d{6,}|\b)")
LOAN_ID_RE = re.compile(r"(\d{16,})$")
ACCOUNT_NO_RE = re.compile(r"账号[:：]\s*([0-9]{8,})")
DATE_RANGE_RE = re.compile(r"(\d{4}-\d{2}-\d{2})\s*--\s*(\d{4}-\d{2}-\d{2})")
ROW_START_RE = re.compile(
    r"^(\d{4}-\d{2}-\d{2})\s+([A-Z]{3})\s+([+-]?\d[\d,]*\.\d{2})\s+(\d[\d,]*\.\d{2})\s+(.*)$"
)


@dataclass
class PdfHeader:
    account_no: str
    account_last4: str
    range_start: str
    range_end: str
    holder_name: str | None = None


@dataclass
class BankPdfTransaction:
    page: int
    date: str
    currency: str
    amount_text: str
    balance_text: str
    raw_detail: str
    summary: str
    counterparty: str

    @property
    def amount(self) -> float:
        return float(self.amount_text.replace(",", ""))

    @property
    def month(self) -> str:
        return self.date[:7]


@dataclass
class ClassifiedPdfRow:
    tx: BankPdfTransaction
    include_in_import: bool
    include_in_expense_analysis: bool
    rule_tag: str
    expense_category: str
    direction: str
    confidence: float
    needs_review: int
    excluded_in_analysis: int
    exclude_reason: str


def _require_pdf_reader():
    try:
        from pypdf import PdfReader  # type: ignore
    except Exception as exc:  # pragma: no cover - runtime dependency branch
        raise RuntimeError("缺少 PDF 解析依赖 pypdf，请先执行: python3 -m pip install pypdf") from exc
    return PdfReader


def _normalize_line(raw: str) -> str:
    return " ".join((raw or "").strip().split())


def _extract_header(first_page_text: str) -> PdfHeader:
    account_no_match = ACCOUNT_NO_RE.search(first_page_text)
    date_range_match = DATE_RANGE_RE.search(first_page_text)
    if not account_no_match or not date_range_match:
        raise ValueError("无法识别招商银行流水 PDF 头部信息（账号/日期范围）")
    account_no = account_no_match.group(1)
    return PdfHeader(
        account_no=account_no,
        account_last4=account_no[-4:],
        range_start=date_range_match.group(1),
        range_end=date_range_match.group(2),
        holder_name=None,
    )


def _parse_summary_and_counterparty(raw_detail: str) -> tuple[str, str]:
    text = (raw_detail or "").strip()
    if not text:
        return "", ""
    for prefix in SUMMARY_PREFIXES:
        if text.startswith(prefix):
            return prefix, text[len(prefix) :].strip()
    token = text.split(" ", 1)[0]
    remainder = text[len(token) :].strip()
    return token, remainder


def parse_pdf(pdf_path: Path) -> tuple[PdfHeader, list[BankPdfTransaction]]:
    PdfReader = _require_pdf_reader()
    reader = PdfReader(str(pdf_path))
    if not reader.pages:
        raise ValueError("PDF 无页面内容")

    first_page_text = reader.pages[0].extract_text() or ""
    header = _extract_header(first_page_text)

    records: list[BankPdfTransaction] = []
    current: dict[str, Any] | None = None
    skip_prefixes = (
        "记账日期 货币 交易金额 联机余额 交易摘要 对手信息",
        "Date Currency Transaction",
        "Amount Balance Transaction Type Counter Party",
    )
    meta_prefixes = ("户 名：", "户\xa0\xa0名：", "账户类型：", "申请时间：", "账号：", "开 户 行：", "验 证 码：")
    meta_exact = {
        "招商银行交易流水",
        "Transaction Statement of China Merchants Bank",
        "Name",
        "Account Type",
        "Date",
        "Account No",
        "Sub Branch",
        "Verification Code",
    }

    def flush_current() -> None:
        nonlocal current
        if not current:
            return
        summary, counterparty = _parse_summary_and_counterparty(str(current["raw_detail"]))
        records.append(
            BankPdfTransaction(
                page=int(current["page"]),
                date=str(current["date"]),
                currency=str(current["currency"]),
                amount_text=str(current["amount_text"]),
                balance_text=str(current["balance_text"]),
                raw_detail=str(current["raw_detail"]).strip(),
                summary=summary,
                counterparty=counterparty,
            )
        )
        current = None

    for page_no, page in enumerate(reader.pages, start=1):
        page_text = page.extract_text() or ""
        for raw_line in page_text.splitlines():
            line = _normalize_line(raw_line)
            if not line:
                continue
            if re.fullmatch(r"\d+/\d+", line):
                continue
            if line in meta_exact:
                continue
            if any(line.startswith(p) for p in skip_prefixes):
                continue
            if any(line.startswith(p) for p in meta_prefixes):
                continue
            if DATE_RANGE_RE.fullmatch(line):
                continue

            m = ROW_START_RE.match(line)
            if m:
                flush_current()
                current = {
                    "page": page_no,
                    "date": m.group(1),
                    "currency": m.group(2),
                    "amount_text": m.group(3),
                    "balance_text": m.group(4),
                    "raw_detail": m.group(5),
                }
                continue

            if current is not None:
                current["raw_detail"] = f"{current['raw_detail']} {line}"

    flush_current()
    return header, records


def _normalize_counterparty(text: str) -> str:
    return " ".join((text or "").strip().split())


def _looks_like_person_counterparty(counterparty: str) -> str | None:
    text = _normalize_counterparty(counterparty)
    if not text:
        return None
    if text.startswith(WECHAT_TRANSFER_PREFIXES):
        return None
    merchant_markers = (
        "公司",
        "银行",
        "基金",
        "理财",
        "中心",
        "管理",
        "有限",
        "科技",
        "股份",
        "平台",
        "商户",
        "机场",
        "高速",
        "停车",
        "美团",
        "肯德基",
        "面馆",
        "智泊",
        "机场",
    )
    if any(marker in text for marker in merchant_markers):
        return None
    m = PERSON_NAME_RE.match(text)
    if not m:
        return None
    return m.group(1)


def _loan_key(counterparty: str) -> str:
    m = LOAN_ID_RE.search(counterparty or "")
    return m.group(1) if m else "unknown"


def _classify_debit_merchant_spend(
    counterparty: str,
    *,
    merchant_map: dict[str, tuple[str, float, str]] | None,
    category_rules: list[parser_mod.ClassificationRule] | None,
    review_threshold: float,
    fallback_category: str,
) -> tuple[str, float, int, str]:
    merchant_map = merchant_map or {}
    category_rules = category_rules or []
    merchant = parser_mod.normalize_merchant(_normalize_counterparty(counterparty))
    if not merchant_map and not category_rules:
        return fallback_category, 0.92, 0, "fallback"
    if merchant in merchant_map:
        category, confidence, _ = merchant_map[merchant]
        conf = float(confidence)
        return category, conf, 1 if conf < review_threshold else 0, "merchant_map"
    for rule in category_rules:
        if parser_mod.match_rule(rule, merchant):
            conf = float(rule.confidence)
            return rule.expense_category, conf, 1 if conf < review_threshold else 0, "keyword_rule"
    return "待分类", 0.0, 1, "unmatched"


def _mortgage_fixed_profiles(records: list[BankPdfTransaction]) -> dict[str, dict[str, float | int]]:
    grouped: dict[str, list[float]] = {}
    for rec in records:
        if rec.currency != "CNY" or rec.summary != "个贷交易" or rec.amount >= 0:
            continue
        grouped.setdefault(_loan_key(rec.counterparty), []).append(abs(rec.amount))
    profiles: dict[str, dict[str, float | int]] = {}
    for key, amounts in grouped.items():
        if not amounts:
            continue
        med = float(median(amounts))
        threshold = max(med * 1.8, med + 3000.0)
        profiles[key] = {
            "count": len(amounts),
            "median_abs_amount": med,
            "fixed_threshold": threshold,
        }
    return profiles


def classify_transactions(
    header: PdfHeader,
    records: list[BankPdfTransaction],
    *,
    transfer_whitelist: set[str] | None = None,
    merchant_map: dict[str, tuple[str, float, str]] | None = None,
    category_rules: list[parser_mod.ClassificationRule] | None = None,
    review_threshold: float = 0.70,
) -> tuple[list[ClassifiedPdfRow], dict[str, Any]]:
    whitelist = set(transfer_whitelist or PERSONAL_TRANSFER_WHITELIST)
    mortgage_profiles = _mortgage_fixed_profiles(records)
    rows: list[ClassifiedPdfRow] = []

    counters: dict[str, int] = {}
    amount_cents_by_tag: dict[str, int] = {}

    def bump(tag: str, amount_text: str | None = None) -> None:
        counters[tag] = counters.get(tag, 0) + 1
        if amount_text is not None:
            amount_cents_by_tag[tag] = amount_cents_by_tag.get(tag, 0) + ledger_import_mod.parse_amount_to_cents(amount_text)

    for tx in records:
        if tx.currency != "CNY":
            row = ClassifiedPdfRow(
                tx=tx,
                include_in_import=False,
                include_in_expense_analysis=False,
                rule_tag="skip_non_cny",
                expense_category="非人民币交易",
                direction="other",
                confidence=1.0,
                needs_review=0,
                excluded_in_analysis=1,
                exclude_reason="非人民币交易，当前版本暂不导入",
            )
            rows.append(row)
            bump("skip_non_cny")
            continue

        if tx.summary == "代发工资" and tx.amount > 0:
            row = ClassifiedPdfRow(
                tx=tx,
                include_in_import=True,
                include_in_expense_analysis=False,
                rule_tag="salary",
                expense_category="工资收入",
                direction="income",
                confidence=0.99,
                needs_review=0,
                excluded_in_analysis=0,
                exclude_reason="",
            )
            rows.append(row)
            bump("salary", tx.amount_text)
            continue

        if tx.summary == "代发住房公积金" and tx.amount > 0:
            row = ClassifiedPdfRow(
                tx=tx,
                include_in_import=True,
                include_in_expense_analysis=False,
                rule_tag="housing_fund_income",
                expense_category="公积金收入",
                direction="income",
                confidence=0.99,
                needs_review=0,
                excluded_in_analysis=0,
                exclude_reason="",
            )
            rows.append(row)
            bump("housing_fund_income", tx.amount_text)
            continue

        if tx.summary == "个贷交易" and tx.amount < 0:
            loan_key = _loan_key(tx.counterparty)
            profile = mortgage_profiles.get(loan_key) or {}
            profile_count = int(profile.get("count", 0))
            threshold = float(profile.get("fixed_threshold", 0.0))
            abs_amount = abs(tx.amount)
            is_fixed = profile_count >= 3 and abs_amount <= threshold
            if is_fixed:
                row = ClassifiedPdfRow(
                    tx=tx,
                    include_in_import=True,
                    include_in_expense_analysis=True,
                    rule_tag="mortgage_fixed",
                    expense_category="房贷固定还款",
                    direction="expense",
                    confidence=0.95,
                    needs_review=0,
                    excluded_in_analysis=0,
                    exclude_reason="",
                )
                bump("mortgage_fixed", tx.amount_text)
            else:
                row = ClassifiedPdfRow(
                    tx=tx,
                    include_in_import=False,
                    include_in_expense_analysis=False,
                    rule_tag="skip_mortgage_early_or_unknown",
                    expense_category="房贷提前还款/异常",
                    direction="expense",
                    confidence=0.9,
                    needs_review=0,
                    excluded_in_analysis=1,
                    exclude_reason="仅统计固定月供；提前还贷/异常金额已忽略",
                )
                bump("skip_mortgage_early_or_unknown", tx.amount_text)
            rows.append(row)
            continue

        if tx.summary == "本行ATM无卡取款" and tx.amount < 0:
            row = ClassifiedPdfRow(
                tx=tx,
                include_in_import=True,
                include_in_expense_analysis=True,
                rule_tag="atm_cash",
                expense_category="ATM取现",
                direction="expense",
                confidence=0.99,
                needs_review=0,
                excluded_in_analysis=0,
                exclude_reason="",
            )
            rows.append(row)
            bump("atm_cash", tx.amount_text)
            continue

        if tx.summary in BANK_TRANSFER_OUT_SUMMARIES and tx.amount < 0:
            person_name = _looks_like_person_counterparty(tx.counterparty)
            if person_name and person_name in whitelist:
                row = ClassifiedPdfRow(
                    tx=tx,
                    include_in_import=True,
                    include_in_expense_analysis=True,
                    rule_tag="bank_transfer_whitelist",
                    expense_category=f"个人转账(白名单:{person_name})",
                    direction="expense",
                    confidence=0.95,
                    needs_review=0,
                    excluded_in_analysis=0,
                    exclude_reason="",
                )
                bump("bank_transfer_whitelist", tx.amount_text)
            else:
                row = ClassifiedPdfRow(
                    tx=tx,
                    include_in_import=False,
                    include_in_expense_analysis=False,
                    rule_tag="skip_bank_transfer_non_whitelist",
                    expense_category="银行卡个人转账(非白名单)",
                    direction="transfer",
                    confidence=0.9,
                    needs_review=0,
                    excluded_in_analysis=1,
                    exclude_reason="银行卡个人转账仅统计白名单对象",
                )
                bump("skip_bank_transfer_non_whitelist", tx.amount_text)
            rows.append(row)
            continue

        if tx.summary in DEBIT_PAYMENT_SUMMARIES and tx.amount < 0:
            counterparty = _normalize_counterparty(tx.counterparty)
            is_wechat_p2p = tx.summary in {"快捷支付", "银联快捷支付"} and counterparty.startswith(WECHAT_TRANSFER_PREFIXES)
            if is_wechat_p2p:
                row = ClassifiedPdfRow(
                    tx=tx,
                    include_in_import=True,
                    include_in_expense_analysis=True,
                    rule_tag="wechat_transfer_redpacket",
                    expense_category="微信转账/红包",
                    direction="expense",
                    confidence=0.95,
                    needs_review=0,
                    excluded_in_analysis=0,
                    exclude_reason="",
                )
                rows.append(row)
                bump("wechat_transfer_redpacket", tx.amount_text)
                continue

            person_name = _looks_like_person_counterparty(counterparty)
            if person_name:
                row = ClassifiedPdfRow(
                    tx=tx,
                    include_in_import=False,
                    include_in_expense_analysis=False,
                    rule_tag="skip_quickpay_person_non_whitelist",
                    expense_category=f"个人转账(非白名单:{person_name})",
                    direction="transfer",
                    confidence=0.85,
                    needs_review=0,
                    excluded_in_analysis=1,
                    exclude_reason="个人转账仅统计微信转账/红包；快捷支付实名个人默认忽略",
                )
                rows.append(row)
                bump("skip_quickpay_person_non_whitelist", tx.amount_text)
                continue

            category, conf, needs_review, match_source = _classify_debit_merchant_spend(
                counterparty,
                merchant_map=merchant_map,
                category_rules=category_rules,
                review_threshold=review_threshold,
                fallback_category=(
                    "借记卡商户消费" if tx.summary in {"快捷支付", "银联快捷支付"} else "借记卡直接商户消费"
                ),
            )
            row = ClassifiedPdfRow(
                tx=tx,
                include_in_import=True,
                include_in_expense_analysis=True,
                rule_tag=(
                    "debit_merchant_spend"
                    if match_source == "fallback"
                    else f"debit_merchant_spend_{match_source}"
                ),
                expense_category=category,
                direction="expense",
                confidence=conf,
                needs_review=needs_review,
                excluded_in_analysis=0,
                exclude_reason="",
            )
            rows.append(row)
            bump("debit_merchant_spend", tx.amount_text)
            continue

        if tx.summary in SKIP_SUMMARIES:
            row = ClassifiedPdfRow(
                tx=tx,
                include_in_import=False,
                include_in_expense_analysis=False,
                rule_tag="skip_irrelevant_summary",
                expense_category="忽略项",
                direction="other",
                confidence=0.99,
                needs_review=0,
                excluded_in_analysis=1,
                exclude_reason="按规则忽略（投资/还款/转入等）",
            )
            rows.append(row)
            bump("skip_irrelevant_summary", tx.amount_text)
            continue

        row = ClassifiedPdfRow(
            tx=tx,
            include_in_import=False,
            include_in_expense_analysis=False,
            rule_tag="skip_unclassified",
            expense_category="未纳入口径",
            direction="other",
            confidence=0.5,
            needs_review=1,
            excluded_in_analysis=1,
            exclude_reason="当前规则未纳入该类型",
        )
        rows.append(row)
        bump("skip_unclassified", tx.amount_text)

    preview = {
        "header": {
            "account_last4": header.account_last4,
            "range_start": header.range_start,
            "range_end": header.range_end,
        },
        "summary": {
            "total_records": len(records),
            "cny_records": sum(1 for tx in records if tx.currency == "CNY"),
            "non_cny_records": sum(1 for tx in records if tx.currency != "CNY"),
            "import_rows_count": sum(1 for row in rows if row.include_in_import),
            "expense_rows_count": sum(1 for row in rows if row.include_in_import and row.direction == "expense"),
            "income_rows_count": sum(1 for row in rows if row.include_in_import and row.direction == "income"),
            "expense_total_cents": sum(
                ledger_import_mod.parse_amount_to_cents(row.tx.amount_text)
                for row in rows
                if row.include_in_import and row.direction == "expense"
            ),
            "income_total_cents": sum(
                ledger_import_mod.parse_amount_to_cents(row.tx.amount_text)
                for row in rows
                if row.include_in_import and row.direction == "income"
            ),
        },
        "rule_counts": counters,
        "rule_amount_cents": amount_cents_by_tag,
        "mortgage_profiles": {
            key: {
                "count": int(profile["count"]),
                "median_abs_amount_cents": int(round(float(profile["median_abs_amount"]) * 100)),
                "fixed_threshold_cents": int(round(float(profile["fixed_threshold"]) * 100)),
            }
            for key, profile in mortgage_profiles.items()
        },
        "samples": {
            "salary": [
                {
                    "date": row.tx.date,
                    "amount": row.tx.amount_text,
                    "counterparty": row.tx.counterparty,
                }
                for row in rows
                if row.rule_tag == "salary"
            ][:8],
            "mortgage_skipped": [
                {
                    "date": row.tx.date,
                    "amount": row.tx.amount_text,
                    "counterparty": row.tx.counterparty,
                }
                for row in rows
                if row.rule_tag == "skip_mortgage_early_or_unknown"
            ][:8],
            "bank_transfer_whitelist": [
                {
                    "date": row.tx.date,
                    "amount": row.tx.amount_text,
                    "counterparty": row.tx.counterparty,
                }
                for row in rows
                if row.rule_tag == "bank_transfer_whitelist"
            ][:8],
        },
    }
    return rows, preview


def _stable_source_name(header: PdfHeader) -> str:
    return f"cmb_bank_statement_{header.account_last4}_{header.range_start}_{header.range_end}.pdf"


def _build_import_rows(header: PdfHeader, classified_rows: list[ClassifiedPdfRow]) -> list[dict[str, str]]:
    source_name = _stable_source_name(header)
    account_id = f"acct_cmb_debit_{header.account_last4}"
    account_name = f"招行借记卡尾号{header.account_last4}"
    rows: list[dict[str, str]] = []
    for item in classified_rows:
        if not item.include_in_import:
            continue
        tx = item.tx
        rows.append(
            {
                "source_file": source_name,
                "source_path": source_name,
                "statement_year": tx.date[:4],
                "statement_month": str(int(tx.date[5:7])),
                "statement_category": tx.summary,
                "trans_date": tx.date,
                "post_date": tx.date,
                "description": tx.raw_detail,
                "merchant": _normalize_counterparty(tx.counterparty),
                "merchant_normalized": parser_mod.normalize_merchant(_normalize_counterparty(tx.counterparty)),
                "amount_rmb": tx.amount_text,
                "card_last4": header.account_last4,
                "original_amount": "",
                "country_area": "",
                "expense_category": item.expense_category,
                "classify_source": "cmb_bank_pdf_rules",
                "confidence": f"{item.confidence:.2f}",
                "needs_review": str(int(item.needs_review)),
                "excluded_in_analysis": str(int(item.excluded_in_analysis)),
                "exclude_reason": item.exclude_reason,
                "direction": item.direction,
                "currency": tx.currency,
                "account_id": account_id,
                "account_name": account_name,
                "account_type": "bank",
            }
        )
    return rows


def _write_import_csv(path: Path, rows: list[dict[str, str]]) -> None:
    headers = [
        "source_file",
        "source_path",
        "statement_year",
        "statement_month",
        "statement_category",
        "trans_date",
        "post_date",
        "description",
        "merchant",
        "merchant_normalized",
        "amount_rmb",
        "card_last4",
        "original_amount",
        "country_area",
        "expense_category",
        "classify_source",
        "confidence",
        "needs_review",
        "excluded_in_analysis",
        "exclude_reason",
        "direction",
        "currency",
        "account_id",
        "account_name",
        "account_type",
    ]
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=headers)
        writer.writeheader()
        for row in rows:
            writer.writerow({h: str(row.get(h, "")) for h in headers})


def preview_file(
    pdf_path: Path,
    *,
    transfer_whitelist: set[str] | None = None,
    merchant_map: dict[str, tuple[str, float, str]] | None = None,
    category_rules: list[parser_mod.ClassificationRule] | None = None,
    review_threshold: float = 0.70,
) -> dict[str, Any]:
    header, records = parse_pdf(pdf_path)
    classified_rows, preview = classify_transactions(
        header,
        records,
        transfer_whitelist=transfer_whitelist,
        merchant_map=merchant_map,
        category_rules=category_rules,
        review_threshold=review_threshold,
    )
    preview["file"] = {
        "path": str(pdf_path),
        "name": pdf_path.name,
        "stable_source_name": _stable_source_name(header),
    }
    preview["summary"]["skipped_rows_count"] = len(records) - int(preview["summary"]["import_rows_count"])
    preview["summary"]["date_start"] = records[0].date if records else None
    preview["summary"]["date_end"] = records[-1].date if records else None
    return preview


def import_file(
    db_path: Path,
    pdf_path: Path,
    *,
    source_type: str = "cmb_bank_pdf",
    transfer_whitelist: set[str] | None = None,
    merchant_map: dict[str, tuple[str, float, str]] | None = None,
    category_rules: list[parser_mod.ClassificationRule] | None = None,
    review_threshold: float = 0.70,
) -> tuple[int, int, str, dict[str, Any]]:
    header, records = parse_pdf(pdf_path)
    classified_rows, preview = classify_transactions(
        header,
        records,
        transfer_whitelist=transfer_whitelist,
        merchant_map=merchant_map,
        category_rules=category_rules,
        review_threshold=review_threshold,
    )
    import_rows = _build_import_rows(header, classified_rows)
    import_csv_path = pdf_path.parent / f"{pdf_path.stem}.classified_import.csv"
    _write_import_csv(import_csv_path, import_rows)
    imported_count, error_count, job_id = ledger_import_mod.import_csv(
        db_path,
        import_csv_path,
        source_type=source_type,
        replace_existing_source_transactions=False,
    )
    preview["file"] = {
        "path": str(pdf_path),
        "name": pdf_path.name,
        "stable_source_name": _stable_source_name(header),
        "import_csv_path": str(import_csv_path),
    }
    return imported_count, error_count, job_id, preview
