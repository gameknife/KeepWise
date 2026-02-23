#!/usr/bin/env python3
"""Rule file management and rule-admin query services for KeepWise web app."""

from __future__ import annotations

import csv
import sqlite3
from pathlib import Path
from typing import Any, Protocol

import parse_cmb_statements as parser_mod


MERCHANT_MAP_HEADERS = ["merchant_normalized", "expense_category", "confidence", "note"]
CATEGORY_RULE_HEADERS = ["priority", "match_type", "pattern", "expense_category", "confidence", "note"]
BANK_TRANSFER_WHITELIST_HEADERS = ["name", "is_active", "note"]
DEFAULT_BANK_TRANSFER_WHITELIST_ROWS = [
    {"name": "徐凯", "is_active": "1", "note": "银行卡个人转账消费白名单（默认）"},
]


class RulesConfigLike(Protocol):
    rules_dir: Path
    db_path: Path


def _cents_to_yuan_text(cents: int) -> str:
    return f"{cents / 100:.2f}"


def _parse_bool_param(raw: str, *, default: bool) -> bool:
    text = (raw or "").strip().lower()
    if not text:
        return default
    if text in {"1", "true", "yes", "y", "on"}:
        return True
    if text in {"0", "false", "no", "n", "off"}:
        return False
    raise ValueError(f"布尔参数不合法: {raw}")


def read_csv_rows(path: Path, headers: list[str]) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    with path.open("r", newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            normalized = {h: (row.get(h) or "").strip() for h in headers}
            if not any(normalized.values()):
                continue
            rows.append(normalized)
    return rows


def write_csv_rows(path: Path, headers: list[str], rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=headers)
        writer.writeheader()
        for row in rows:
            writer.writerow({h: (row.get(h) or "").strip() for h in headers})


def parse_confidence(value: str, *, default: float) -> str:
    text = (value or "").strip()
    if not text:
        return f"{default:.2f}"
    try:
        conf = float(text)
    except ValueError as exc:
        raise ValueError("confidence 必须是 0~1 之间的小数") from exc
    if conf < 0 or conf > 1:
        raise ValueError("confidence 必须是 0~1 之间的小数")
    return f"{conf:.2f}"


def safe_int(value: str, *, default: int) -> int:
    try:
        return int((value or "").strip() or str(default))
    except ValueError:
        return default


def ensure_rules_files(config: RulesConfigLike) -> tuple[Path, Path, Path]:
    merchant_map_path = config.rules_dir / "merchant_map.csv"
    category_rules_path = config.rules_dir / "category_rules.csv"
    exclusions_path = config.rules_dir / "analysis_exclusions.csv"
    parser_mod.ensure_reference_files(
        merchant_map_path=merchant_map_path,
        category_rules_path=category_rules_path,
        analysis_exclusions_path=exclusions_path,
    )
    return merchant_map_path, category_rules_path, exclusions_path


def ensure_bank_transfer_whitelist_file(config: RulesConfigLike) -> Path:
    path = config.rules_dir / "bank_transfer_whitelist.csv"
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        write_csv_rows(path, BANK_TRANSFER_WHITELIST_HEADERS, DEFAULT_BANK_TRANSFER_WHITELIST_ROWS)
        return path
    rows = read_csv_rows(path, BANK_TRANSFER_WHITELIST_HEADERS)
    existing_names = {str(row.get("name") or "").strip() for row in rows}
    missing = [row for row in DEFAULT_BANK_TRANSFER_WHITELIST_ROWS if row["name"] not in existing_names]
    if missing:
        rows.extend(missing)
        rows.sort(
            key=lambda item: (
                -(
                    1
                    if str(item.get("is_active", "1")).strip().lower() in {"1", "true", "yes", "on"}
                    else 0
                ),
                str(item.get("name") or ""),
            )
        )
        write_csv_rows(path, BANK_TRANSFER_WHITELIST_HEADERS, rows)
    return path


def load_bank_transfer_whitelist_names(config: RulesConfigLike) -> set[str]:
    path = ensure_bank_transfer_whitelist_file(config)
    rows = read_csv_rows(path, BANK_TRANSFER_WHITELIST_HEADERS)
    names: set[str] = set()
    for row in rows:
        name = str(row.get("name") or "").strip()
        if not name:
            continue
        active = str(row.get("is_active") or "1").strip().lower() in {"1", "true", "yes", "y", "on"}
        if active:
            names.add(name)
    return names


def query_merchant_map_rules(config: RulesConfigLike, qs: dict[str, list[str]]) -> dict[str, Any]:
    keyword = (qs.get("keyword") or [""])[0].strip().lower()
    limit = min(max(int((qs.get("limit") or ["200"])[0] or "200"), 1), 500)
    merchant_map_path, _, _ = ensure_rules_files(config)
    rows = read_csv_rows(merchant_map_path, MERCHANT_MAP_HEADERS)
    if keyword:
        rows = [
            row
            for row in rows
            if keyword in row["merchant_normalized"].lower()
            or keyword in row["expense_category"].lower()
            or keyword in row["note"].lower()
        ]
    rows.sort(key=lambda item: (item["merchant_normalized"], item["expense_category"]))
    rows = rows[:limit]
    return {
        "summary": {
            "count": len(rows),
            "keyword": keyword,
            "limit": limit,
            "file_path": str(merchant_map_path),
        },
        "rows": rows,
    }


def upsert_merchant_map_rule(config: RulesConfigLike, payload: dict[str, Any]) -> dict[str, Any]:
    merchant = str(payload.get("merchant_normalized", "")).strip()
    category = str(payload.get("expense_category", "")).strip()
    note = str(payload.get("note", "")).strip()
    confidence = parse_confidence(str(payload.get("confidence", "")), default=0.95)
    if not merchant:
        raise ValueError("merchant_normalized 必填")
    if not category:
        raise ValueError("expense_category 必填")

    merchant_map_path, _, _ = ensure_rules_files(config)
    rows = read_csv_rows(merchant_map_path, MERCHANT_MAP_HEADERS)
    updated = False
    for row in rows:
        if row["merchant_normalized"] == merchant:
            row["expense_category"] = category
            row["confidence"] = confidence
            row["note"] = note
            updated = True
            break
    if not updated:
        rows.append(
            {
                "merchant_normalized": merchant,
                "expense_category": category,
                "confidence": confidence,
                "note": note,
            }
        )
    rows.sort(key=lambda item: (item["merchant_normalized"], item["expense_category"]))
    write_csv_rows(merchant_map_path, MERCHANT_MAP_HEADERS, rows)
    return {
        "updated": updated,
        "file_path": str(merchant_map_path),
        "row": {
            "merchant_normalized": merchant,
            "expense_category": category,
            "confidence": confidence,
            "note": note,
        },
    }


def delete_merchant_map_rule(config: RulesConfigLike, payload: dict[str, Any]) -> dict[str, Any]:
    merchant = str(payload.get("merchant_normalized", "")).strip()
    if not merchant:
        raise ValueError("merchant_normalized 必填")
    merchant_map_path, _, _ = ensure_rules_files(config)
    rows = read_csv_rows(merchant_map_path, MERCHANT_MAP_HEADERS)
    before_count = len(rows)
    rows = [row for row in rows if row["merchant_normalized"] != merchant]
    deleted = before_count - len(rows)
    write_csv_rows(merchant_map_path, MERCHANT_MAP_HEADERS, rows)
    return {
        "deleted": deleted > 0,
        "deleted_count": deleted,
        "file_path": str(merchant_map_path),
        "merchant_normalized": merchant,
    }


def query_category_rules(config: RulesConfigLike, qs: dict[str, list[str]]) -> dict[str, Any]:
    keyword = (qs.get("keyword") or [""])[0].strip().lower()
    limit = min(max(int((qs.get("limit") or ["200"])[0] or "200"), 1), 500)
    _, category_rules_path, _ = ensure_rules_files(config)
    rows = read_csv_rows(category_rules_path, CATEGORY_RULE_HEADERS)
    if keyword:
        rows = [
            row
            for row in rows
            if keyword in row["pattern"].lower()
            or keyword in row["expense_category"].lower()
            or keyword in row["note"].lower()
            or keyword in row["match_type"].lower()
        ]
    rows.sort(key=lambda item: (safe_int(item.get("priority", ""), default=999), item["match_type"], item["pattern"]))
    rows = rows[:limit]
    return {
        "summary": {
            "count": len(rows),
            "keyword": keyword,
            "limit": limit,
            "file_path": str(category_rules_path),
        },
        "rows": rows,
    }


def upsert_category_rule(config: RulesConfigLike, payload: dict[str, Any]) -> dict[str, Any]:
    match_type = str(payload.get("match_type", "contains")).strip().lower() or "contains"
    pattern = str(payload.get("pattern", "")).strip()
    category = str(payload.get("expense_category", "")).strip()
    note = str(payload.get("note", "")).strip()
    confidence = parse_confidence(str(payload.get("confidence", "")), default=0.70)
    priority_raw = str(payload.get("priority", "500")).strip() or "500"
    try:
        priority = int(priority_raw)
    except ValueError as exc:
        raise ValueError("priority 必须是整数") from exc
    if match_type not in {"exact", "contains", "prefix", "regex"}:
        raise ValueError("match_type 仅支持 exact/contains/prefix/regex")
    if not pattern:
        raise ValueError("pattern 必填")
    if not category:
        raise ValueError("expense_category 必填")

    _, category_rules_path, _ = ensure_rules_files(config)
    rows = read_csv_rows(category_rules_path, CATEGORY_RULE_HEADERS)
    updated = False
    for row in rows:
        if row["match_type"] == match_type and row["pattern"] == pattern:
            row["priority"] = str(priority)
            row["expense_category"] = category
            row["confidence"] = confidence
            row["note"] = note
            updated = True
            break
    if not updated:
        rows.append(
            {
                "priority": str(priority),
                "match_type": match_type,
                "pattern": pattern,
                "expense_category": category,
                "confidence": confidence,
                "note": note,
            }
        )
    rows.sort(key=lambda item: (safe_int(item.get("priority", ""), default=999), item["match_type"], item["pattern"]))
    write_csv_rows(category_rules_path, CATEGORY_RULE_HEADERS, rows)
    return {
        "updated": updated,
        "file_path": str(category_rules_path),
        "row": {
            "priority": str(priority),
            "match_type": match_type,
            "pattern": pattern,
            "expense_category": category,
            "confidence": confidence,
            "note": note,
        },
    }


def delete_category_rule(config: RulesConfigLike, payload: dict[str, Any]) -> dict[str, Any]:
    match_type = str(payload.get("match_type", "")).strip().lower()
    pattern = str(payload.get("pattern", "")).strip()
    if match_type not in {"exact", "contains", "prefix", "regex"}:
        raise ValueError("match_type 仅支持 exact/contains/prefix/regex")
    if not pattern:
        raise ValueError("pattern 必填")

    _, category_rules_path, _ = ensure_rules_files(config)
    rows = read_csv_rows(category_rules_path, CATEGORY_RULE_HEADERS)
    before_count = len(rows)
    rows = [
        row
        for row in rows
        if not (row["match_type"] == match_type and row["pattern"] == pattern)
    ]
    deleted = before_count - len(rows)
    write_csv_rows(category_rules_path, CATEGORY_RULE_HEADERS, rows)
    return {
        "deleted": deleted > 0,
        "deleted_count": deleted,
        "file_path": str(category_rules_path),
        "match_type": match_type,
        "pattern": pattern,
    }


def query_bank_transfer_whitelist_rules(config: RulesConfigLike, qs: dict[str, list[str]]) -> dict[str, Any]:
    keyword = (qs.get("keyword") or [""])[0].strip().lower()
    limit = min(max(int((qs.get("limit") or ["200"])[0] or "200"), 1), 500)
    active_only = _parse_bool_param((qs.get("active_only") or ["false"])[0], default=False)
    path = ensure_bank_transfer_whitelist_file(config)
    rows = read_csv_rows(path, BANK_TRANSFER_WHITELIST_HEADERS)

    normalized_rows: list[dict[str, Any]] = []
    for row in rows:
        name = str(row.get("name") or "").strip()
        if not name:
            continue
        is_active = str(row.get("is_active") or "1").strip().lower() in {"1", "true", "yes", "y", "on"}
        note = str(row.get("note") or "").strip()
        if active_only and not is_active:
            continue
        if keyword and keyword not in f"{name} {note}".lower():
            continue
        normalized_rows.append({"name": name, "is_active": 1 if is_active else 0, "note": note})

    normalized_rows.sort(key=lambda item: (-int(item["is_active"]), str(item["name"])))
    normalized_rows = normalized_rows[:limit]
    active_count = sum(1 for row in normalized_rows if int(row["is_active"]) == 1)
    return {
        "summary": {
            "count": len(normalized_rows),
            "active_count": active_count,
            "inactive_count": len(normalized_rows) - active_count,
            "keyword": keyword,
            "limit": limit,
            "active_only": active_only,
            "file_path": str(path),
        },
        "rows": normalized_rows,
    }


def upsert_bank_transfer_whitelist_rule(config: RulesConfigLike, payload: dict[str, Any]) -> dict[str, Any]:
    name = str(payload.get("name", "")).strip()
    note = str(payload.get("note", "")).strip()
    raw_active = payload.get("is_active", True)
    if isinstance(raw_active, bool):
        is_active = raw_active
    elif raw_active is None:
        is_active = True
    else:
        is_active = _parse_bool_param(str(raw_active), default=True)
    if not name:
        raise ValueError("name 必填")

    path = ensure_bank_transfer_whitelist_file(config)
    rows = read_csv_rows(path, BANK_TRANSFER_WHITELIST_HEADERS)
    updated = False
    for row in rows:
        if str(row.get("name") or "").strip() == name:
            row["is_active"] = "1" if is_active else "0"
            row["note"] = note
            updated = True
            break
    if not updated:
        rows.append({"name": name, "is_active": "1" if is_active else "0", "note": note})
    rows.sort(
        key=lambda item: (
            -(
                1
                if str(item.get("is_active") or "1").strip().lower() in {"1", "true", "yes", "y", "on"}
                else 0
            ),
            str(item.get("name") or ""),
        )
    )
    write_csv_rows(path, BANK_TRANSFER_WHITELIST_HEADERS, rows)
    return {
        "updated": updated,
        "file_path": str(path),
        "row": {"name": name, "is_active": 1 if is_active else 0, "note": note},
    }


def delete_bank_transfer_whitelist_rule(config: RulesConfigLike, payload: dict[str, Any]) -> dict[str, Any]:
    name = str(payload.get("name", "")).strip()
    if not name:
        raise ValueError("name 必填")
    path = ensure_bank_transfer_whitelist_file(config)
    rows = read_csv_rows(path, BANK_TRANSFER_WHITELIST_HEADERS)
    before_count = len(rows)
    rows = [row for row in rows if str(row.get("name") or "").strip() != name]
    deleted = before_count - len(rows)
    write_csv_rows(path, BANK_TRANSFER_WHITELIST_HEADERS, rows)
    return {
        "deleted": deleted > 0,
        "deleted_count": deleted,
        "file_path": str(path),
        "name": name,
    }


def query_merchant_rule_suggestions(config: RulesConfigLike, qs: dict[str, list[str]]) -> dict[str, Any]:
    limit = min(max(int((qs.get("limit") or ["200"])[0] or "200"), 1), 500)
    only_unmapped = _parse_bool_param((qs.get("only_unmapped") or ["true"])[0], default=True)
    keyword = (qs.get("keyword") or [""])[0].strip().lower()
    merchant_map_path, _, _ = ensure_rules_files(config)
    merchant_map = parser_mod.load_merchant_map(merchant_map_path)

    conn = sqlite3.connect(config.db_path)
    conn.row_factory = sqlite3.Row
    try:
        keyword_params: list[Any] = []
        keyword_clause = ""
        if keyword:
            keyword_clause = "AND t.merchant_normalized LIKE ?"
            keyword_params.append(f"%{keyword}%")
        grouped = conn.execute(
            f"""
            SELECT
                t.merchant_normalized,
                COUNT(*) AS txn_count,
                COALESCE(SUM(t.amount_cents), 0) AS total_amount_cents,
                SUM(CASE WHEN t.needs_review = 1 THEN 1 ELSE 0 END) AS review_count,
                (
                    SELECT c2.name
                    FROM transactions t2
                    LEFT JOIN categories c2 ON c2.id = t2.category_id
                    WHERE t2.statement_category = '消费'
                      AND t2.merchant_normalized = t.merchant_normalized
                      AND COALESCE(c2.name, '') != ''
                    GROUP BY c2.name
                    ORDER BY COUNT(*) DESC, c2.name
                    LIMIT 1
                ) AS suggested_expense_category
            FROM transactions t
            WHERE t.statement_category = '消费'
              AND COALESCE(t.merchant_normalized, '') != ''
              {keyword_clause}
            GROUP BY t.merchant_normalized
            ORDER BY review_count DESC, txn_count DESC, total_amount_cents DESC
            LIMIT ?
            """,
            [*keyword_params, limit],
        ).fetchall()
    finally:
        conn.close()

    rows: list[dict[str, Any]] = []
    for row in grouped:
        merchant = str(row["merchant_normalized"])
        mapped = merchant_map.get(merchant)
        if only_unmapped and mapped:
            continue
        mapped_category, mapped_confidence, mapped_note = mapped if mapped else ("", None, "")
        rows.append(
            {
                "merchant_normalized": merchant,
                "txn_count": int(row["txn_count"]),
                "total_amount_cents": int(row["total_amount_cents"]),
                "total_amount_yuan": _cents_to_yuan_text(int(row["total_amount_cents"])),
                "review_count": int(row["review_count"]),
                "suggested_expense_category": str(row["suggested_expense_category"] or "").strip(),
                "mapped_expense_category": mapped_category,
                "mapped_confidence": round(mapped_confidence, 2) if mapped_confidence is not None else None,
                "mapped_note": mapped_note,
            }
        )
    return {
        "summary": {
            "count": len(rows),
            "limit": limit,
            "only_unmapped": only_unmapped,
            "keyword": keyword,
            "file_path": str(merchant_map_path),
        },
        "rows": rows,
    }
