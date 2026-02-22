#!/usr/bin/env python3
"""Local web app for imports, investment analytics, wealth overview, and basic queries."""

from __future__ import annotations

import argparse
import base64
import csv
import json
import secrets
import shutil
import sqlite3
import sys
import traceback
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import import_classified_to_ledger as ledger_import_mod
import import_youzhiyouxing_investments as yzxy_import_mod
import migrate_ledger_db as migrate_mod
import parse_cmb_statements as parser_mod


@dataclass
class AppConfig:
    root_dir: Path
    work_dir: Path
    rules_dir: Path
    db_path: Path
    migrations_dir: Path
    assets_dir: Path
    session_dir: Path


@dataclass
class UploadSession:
    token: str
    kind: str
    created_at: str
    root_path: Path
    input_dir: Path | None = None
    file_path: Path | None = None


class SessionStore:
    def __init__(self, root_dir: Path) -> None:
        self.root_dir = root_dir
        self.root_dir.mkdir(parents=True, exist_ok=True)
        self._sessions: dict[str, UploadSession] = {}

    def create_eml_session(self, files: list[dict[str, str]]) -> UploadSession:
        token = secrets.token_urlsafe(12)
        root = self.root_dir / token
        input_dir = root / "eml_input"
        input_dir.mkdir(parents=True, exist_ok=True)
        for idx, item in enumerate(files):
            filename = Path(item.get("name", f"upload_{idx}.eml")).name
            if not filename.lower().endswith(".eml"):
                filename = f"{filename}.eml"
            payload = base64.b64decode(item.get("content_base64", ""), validate=False)
            (input_dir / filename).write_bytes(payload)

        session = UploadSession(
            token=token,
            kind="eml",
            created_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
            root_path=root,
            input_dir=input_dir,
        )
        self._sessions[token] = session
        return session

    def create_single_file_session(
        self,
        kind: str,
        item: dict[str, str],
        allowed_suffixes: tuple[str, ...],
    ) -> UploadSession:
        token = secrets.token_urlsafe(12)
        root = self.root_dir / token
        root.mkdir(parents=True, exist_ok=True)

        filename = Path(item.get("name", "upload.csv")).name
        lowered = filename.lower()
        if not any(lowered.endswith(sfx.lower()) for sfx in allowed_suffixes):
            raise ValueError(f"文件后缀必须为: {', '.join(allowed_suffixes)}")
        payload = base64.b64decode(item.get("content_base64", ""), validate=False)
        file_path = root / filename
        file_path.write_bytes(payload)

        session = UploadSession(
            token=token,
            kind=kind,
            created_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
            root_path=root,
            file_path=file_path,
        )
        self._sessions[token] = session
        return session

    def get(self, token: str, kind: str) -> UploadSession:
        session = self._sessions.get(token)
        if not session:
            raise KeyError("预览会话不存在，请先重新预览。")
        if session.kind != kind:
            raise KeyError("预览会话类型不匹配。")
        return session

    def clear_all(self) -> int:
        cleared = 0
        for child in self.root_dir.glob("*"):
            if child.is_dir():
                shutil.rmtree(child, ignore_errors=True)
                cleared += 1
            elif child.exists():
                child.unlink(missing_ok=True)
                cleared += 1
        self._sessions.clear()
        self.root_dir.mkdir(parents=True, exist_ok=True)
        return cleared


def ensure_db(config: AppConfig) -> None:
    migrate_mod.apply_migrations(config.db_path, config.migrations_dir)


SUPPORTED_PRESETS = {"ytd", "1y", "3y", "since_inception", "custom"}
SUPPORTED_ASSET_CLASSES = {"cash", "real_estate", "liability"}
ACCOUNT_KIND_CHOICES = {
    "investment",
    "cash",
    "real_estate",
    "bank",
    "credit_card",
    "wallet",
    "liability",
    "other",
}
PORTFOLIO_ACCOUNT_ID = "__portfolio__"
PORTFOLIO_ACCOUNT_NAME = "全部投资账户（组合）"
ADMIN_RESET_CONFIRM_PHRASE = "RESET KEEPWISE"
ADMIN_DATA_TABLES = [
    "transactions",
    "reconciliations",
    "investment_records",
    "account_valuations",
    "assets",
    "budgets",
    "ai_suggestions",
    "import_jobs",
    "categories",
    "accounts",
]
MERCHANT_MAP_HEADERS = ["merchant_normalized", "expense_category", "confidence", "note"]
CATEGORY_RULE_HEADERS = ["priority", "match_type", "pattern", "expense_category", "confidence", "note"]


def parse_iso_date(raw: str, field_name: str) -> date:
    text = (raw or "").strip()
    if not text:
        raise ValueError(f"缺少字段: {field_name}")
    try:
        return datetime.strptime(text, "%Y-%m-%d").date()
    except ValueError as exc:
        raise ValueError(f"{field_name} 日期格式必须为 YYYY-MM-DD") from exc


def cents_to_yuan_text(cents: int) -> str:
    return f"{cents / 100:.2f}"


def parse_preset(raw: str) -> str:
    preset = (raw or "ytd").strip().lower() or "ytd"
    if preset not in SUPPORTED_PRESETS:
        raise ValueError(f"preset 不支持: {preset}，可选 {', '.join(sorted(SUPPORTED_PRESETS))}")
    return preset


def parse_bool_param(raw: str, *, default: bool) -> bool:
    text = (raw or "").strip().lower()
    if not text:
        return default
    if text in {"1", "true", "yes", "y", "on"}:
        return True
    if text in {"0", "false", "no", "n", "off"}:
        return False
    raise ValueError(f"布尔参数不合法: {raw}")


def list_admin_data_tables(conn: sqlite3.Connection) -> list[str]:
    table_rows = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    ).fetchall()
    existing = {str(row[0]) for row in table_rows}
    return [name for name in ADMIN_DATA_TABLES if name in existing]


def build_admin_table_counts(conn: sqlite3.Connection, tables: list[str]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for table in tables:
        count = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        rows.append(
            {
                "table": table,
                "row_count": int(count),
            }
        )
    return rows


def query_admin_db_stats(config: AppConfig) -> dict[str, Any]:
    ensure_db(config)
    conn = sqlite3.connect(config.db_path)
    try:
        tables = list_admin_data_tables(conn)
        rows = build_admin_table_counts(conn, tables)
    finally:
        conn.close()

    total_rows = sum(int(item["row_count"]) for item in rows)
    return {
        "db_path": str(config.db_path),
        "confirm_phrase": ADMIN_RESET_CONFIRM_PHRASE,
        "summary": {
            "table_count": len(rows),
            "total_rows": total_rows,
        },
        "rows": rows,
    }


def reset_admin_db_data(config: AppConfig, *, confirm_text: str) -> dict[str, Any]:
    ensure_db(config)
    if (confirm_text or "").strip() != ADMIN_RESET_CONFIRM_PHRASE:
        raise ValueError(f"confirm_text 不正确，请输入: {ADMIN_RESET_CONFIRM_PHRASE}")

    conn = sqlite3.connect(config.db_path)
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        tables = list_admin_data_tables(conn)
        before_rows = build_admin_table_counts(conn, tables)
        with conn:
            for table in tables:
                conn.execute(f"DELETE FROM {table}")
        after_rows = build_admin_table_counts(conn, tables)
    finally:
        conn.close()

    before_map = {row["table"]: int(row["row_count"]) for row in before_rows}
    after_map = {row["table"]: int(row["row_count"]) for row in after_rows}
    deleted_rows = sum(before_map.get(table, 0) - after_map.get(table, 0) for table in before_map)
    total_before = sum(before_map.values())
    total_after = sum(after_map.values())

    return {
        "db_path": str(config.db_path),
        "confirm_phrase": ADMIN_RESET_CONFIRM_PHRASE,
        "summary": {
            "table_count": len(tables),
            "total_rows_before": total_before,
            "total_rows_after": total_after,
            "deleted_rows": deleted_rows,
        },
        "before_rows": before_rows,
        "after_rows": after_rows,
    }


def ensure_rules_files(config: AppConfig) -> tuple[Path, Path, Path]:
    merchant_map_path = config.rules_dir / "merchant_map.csv"
    category_rules_path = config.rules_dir / "category_rules.csv"
    exclusions_path = config.rules_dir / "analysis_exclusions.csv"
    parser_mod.ensure_reference_files(
        merchant_map_path=merchant_map_path,
        category_rules_path=category_rules_path,
        analysis_exclusions_path=exclusions_path,
    )
    return merchant_map_path, category_rules_path, exclusions_path


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


def query_merchant_map_rules(config: AppConfig, qs: dict[str, list[str]]) -> dict[str, Any]:
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


def upsert_merchant_map_rule(config: AppConfig, payload: dict[str, Any]) -> dict[str, Any]:
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


def delete_merchant_map_rule(config: AppConfig, payload: dict[str, Any]) -> dict[str, Any]:
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


def query_category_rules(config: AppConfig, qs: dict[str, list[str]]) -> dict[str, Any]:
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


def upsert_category_rule(config: AppConfig, payload: dict[str, Any]) -> dict[str, Any]:
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


def delete_category_rule(config: AppConfig, payload: dict[str, Any]) -> dict[str, Any]:
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


def query_merchant_rule_suggestions(config: AppConfig, qs: dict[str, list[str]]) -> dict[str, Any]:
    limit = min(max(int((qs.get("limit") or ["200"])[0] or "200"), 1), 500)
    only_unmapped = parse_bool_param((qs.get("only_unmapped") or ["true"])[0], default=True)
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
                "total_amount_yuan": cents_to_yuan_text(int(row["total_amount_cents"])),
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


def resolve_window(
    *,
    preset: str,
    from_raw: str,
    to_raw: str,
    earliest: date,
    latest: date,
) -> tuple[date, date, date]:
    if latest < earliest:
        raise ValueError("无可用时间范围")

    requested_to = parse_iso_date(to_raw, "to") if to_raw else latest
    effective_to = min(requested_to, latest)
    if effective_to < earliest:
        raise ValueError("结束日期早于最早可用记录")

    if preset == "custom":
        requested_from = parse_iso_date(from_raw, "from")
    elif preset == "ytd":
        requested_from = date(effective_to.year, 1, 1)
    elif preset == "1y":
        requested_from = effective_to - timedelta(days=365)
    elif preset == "3y":
        requested_from = effective_to - timedelta(days=365 * 3)
    elif preset == "since_inception":
        requested_from = earliest
    else:
        raise ValueError(f"preset 不支持: {preset}")

    effective_from = max(requested_from, earliest)
    if effective_from > effective_to:
        raise ValueError("起始日期晚于结束日期")
    return requested_from, effective_from, effective_to


def account_id_from_asset_name(asset_class: str, account_name: str) -> str:
    digest = uuid.uuid5(uuid.NAMESPACE_URL, f"keepwise:{asset_class}:{account_name}")
    suffix = str(digest).replace("-", "")[:12]
    if asset_class == "cash":
        return f"acct_cash_{suffix}"
    if asset_class == "liability":
        return f"acct_liab_{suffix}"
    return f"acct_re_{suffix}"


def account_id_from_manual_account(kind: str, account_name: str) -> str:
    if kind == "investment":
        return yzxy_import_mod.account_id_from_name(account_name)
    if kind in {"cash", "real_estate"}:
        return account_id_from_asset_name(kind, account_name)

    digest = uuid.uuid5(uuid.NAMESPACE_URL, f"keepwise:{kind}:{account_name}")
    suffix = str(digest).replace("-", "")[:12]
    prefix_map = {
        "bank": "acct_bank",
        "credit_card": "acct_cc",
        "wallet": "acct_wallet",
        "liability": "acct_liab",
        "other": "acct_other",
    }
    prefix = prefix_map.get(kind, "acct_other")
    return f"{prefix}_{suffix}"


def normalize_account_kind(raw: str) -> str:
    kind = (raw or "").strip().lower()
    if kind not in ACCOUNT_KIND_CHOICES:
        raise ValueError(f"account_kind 不支持: {kind}")
    return kind


def account_kind_to_db_type(kind: str) -> str:
    if kind == "real_estate":
        return "other"
    return kind


def infer_account_kind(
    *,
    account_id: str,
    account_type: str,
    asset_cash_count: int,
    asset_real_estate_count: int,
) -> str:
    if account_type == "liability" or account_id.startswith("acct_liab_"):
        return "liability"
    if asset_real_estate_count > 0 or account_id.startswith("acct_re_"):
        return "real_estate"
    if asset_cash_count > 0 or account_id.startswith("acct_cash_"):
        return "cash"
    return account_type


def load_account_row_by_id(conn: sqlite3.Connection, account_id: str) -> sqlite3.Row:
    row = conn.execute(
        """
        SELECT id, name, account_type
        FROM accounts
        WHERE id = ?
        """,
        (account_id,),
    ).fetchone()
    if not row:
        raise ValueError("未找到对应账户")
    return row


def ensure_asset_schema_ready(conn: sqlite3.Connection) -> None:
    table_exists = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='account_valuations' LIMIT 1"
    ).fetchone()
    if not table_exists:
        raise RuntimeError("数据库缺少 account_valuations 表，请先执行最新迁移。")

    columns = {row[1] for row in conn.execute("PRAGMA table_info(account_valuations)")}
    required_columns = {
        "account_id",
        "account_name",
        "asset_class",
        "snapshot_date",
        "value_cents",
        "source_type",
    }
    missing = required_columns - columns
    if missing:
        raise RuntimeError(f"account_valuations 缺少字段: {', '.join(sorted(missing))}")


def upsert_account(
    conn: sqlite3.Connection,
    *,
    account_id: str,
    account_name: str,
    account_type: str,
) -> None:
    conn.execute(
        """
        INSERT INTO accounts(id, name, account_type, currency, initial_balance_cents)
        VALUES (?, ?, ?, 'CNY', 0)
        ON CONFLICT(id) DO UPDATE SET
            name=excluded.name,
            account_type=excluded.account_type,
            updated_at=datetime('now')
        """,
        (account_id, account_name, account_type),
    )


def preview_eml(config: AppConfig, input_dir: Path, review_threshold: float) -> dict[str, Any]:
    eml_files = parser_mod.read_eml_files(input_dir, "*.eml", True)
    if not eml_files:
        raise FileNotFoundError("没有可解析的 .eml 文件")

    merchant_map_path = config.rules_dir / "merchant_map.csv"
    category_rules_path = config.rules_dir / "category_rules.csv"
    exclusions_path = config.rules_dir / "analysis_exclusions.csv"
    parser_mod.ensure_reference_files(merchant_map_path, category_rules_path, exclusions_path)
    merchant_map = parser_mod.load_merchant_map(merchant_map_path)
    category_rules = parser_mod.load_category_rules(category_rules_path)
    exclusion_rules = parser_mod.load_analysis_exclusion_rules(exclusions_path)

    records: list[parser_mod.Transaction] = []
    errors: list[tuple[Path, Exception]] = []
    for eml_file in eml_files:
        try:
            records.extend(parser_mod.parse_eml(eml_file, input_dir))
        except Exception as exc:
            errors.append((eml_file, exc))

    if not records:
        details = "; ".join(f"{p.name}: {e}" for p, e in errors) or "无可解析交易记录"
        raise RuntimeError(f"未产出任何交易记录。{details}")

    classified = parser_mod.classify_transactions(records, merchant_map, category_rules, review_threshold)
    classified = parser_mod.apply_analysis_exclusions(classified, exclusion_rules)

    consume_rows = [r for r in classified if r.txn.statement_category == "消费" and r.excluded_in_analysis == 0]
    review_count = sum(1 for r in consume_rows if r.needs_review == 1)
    excluded_count = sum(1 for r in classified if r.txn.statement_category == "消费" and r.excluded_in_analysis == 1)

    failed_files = [{"file": p.name, "error": str(e)} for p, e in errors[:20]]
    return {
        "input_files_count": len(eml_files),
        "records_count": len(records),
        "consume_count": len(consume_rows),
        "needs_review_count": review_count,
        "excluded_count": excluded_count,
        "failed_files_count": len(errors),
        "failed_files": failed_files,
    }


def run_eml_import(config: AppConfig, input_dir: Path, review_threshold: float) -> dict[str, Any]:
    ensure_db(config)
    parse_result = parser_mod.run(
        input_path=input_dir,
        pattern="*.eml",
        recursive=True,
        out_root=config.work_dir,
        merchant_map_path=config.rules_dir / "merchant_map.csv",
        category_rules_path=config.rules_dir / "category_rules.csv",
        analysis_exclusions_path=config.rules_dir / "analysis_exclusions.csv",
        review_threshold=review_threshold,
    )
    imported_count, import_error_count, import_job_id = ledger_import_mod.import_csv(
        config.db_path,
        Path(parse_result["classified_transactions_csv"]),
        source_type="cmb_eml",
    )

    return {
        "parse_result": parse_result,
        "imported_count": imported_count,
        "import_error_count": import_error_count,
        "import_job_id": import_job_id,
        "db_path": str(config.db_path),
    }


def upsert_manual_investment(config: AppConfig, payload: dict[str, Any]) -> dict[str, Any]:
    ensure_db(config)
    snapshot_date = yzxy_import_mod.normalize_date(str(payload.get("snapshot_date", "")))
    account_id_input = str(payload.get("account_id", "")).strip()
    account_name_input = str(payload.get("account_name", "")).strip()

    row = yzxy_import_mod.ParsedInvestmentRow(
        snapshot_date=snapshot_date,
        account_name=account_name_input or "手工投资账户",
        total_assets_cents=yzxy_import_mod.parse_amount_to_cents(str(payload.get("total_assets", "0"))),
        transfer_amount_cents=yzxy_import_mod.parse_amount_to_cents(str(payload.get("transfer_amount", "0"))),
    )
    if row.total_assets_cents <= 0:
        raise ValueError("总资产必须大于 0")

    conn = sqlite3.connect(config.db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yzxy_import_mod.ensure_schema_ready(conn)
        if account_id_input:
            account_row = load_account_row_by_id(conn, account_id_input)
            if str(account_row["account_type"]) != "investment":
                raise ValueError("所选账户不是投资账户")
            account_id = str(account_row["id"])
            account_name = str(account_row["name"])
        else:
            account_name = account_name_input or "手工投资账户"
            account_id = yzxy_import_mod.account_id_from_name(account_name)
        with conn:
            yzxy_import_mod.ensure_account(conn, account_id, account_name)
            yzxy_import_mod.upsert_investment_record(
                conn,
                account_id=account_id,
                row=row,
                source_type="manual",
                source_file=None,
                import_job_id=None,
            )
    finally:
        conn.close()

    return {
        "account_id": account_id,
        "account_name": account_name,
        "snapshot_date": snapshot_date,
    }


def update_investment_record(config: AppConfig, payload: dict[str, Any]) -> dict[str, Any]:
    ensure_db(config)
    record_id = str(payload.get("id", "")).strip()
    if not record_id:
        raise ValueError("id 必填")

    snapshot_date = yzxy_import_mod.normalize_date(str(payload.get("snapshot_date", "")))
    account_id_input = str(payload.get("account_id", "")).strip()
    account_name_input = str(payload.get("account_name", "")).strip()
    total_assets_cents = yzxy_import_mod.parse_amount_to_cents(str(payload.get("total_assets", "0")))
    transfer_amount_cents = yzxy_import_mod.parse_amount_to_cents(str(payload.get("transfer_amount", "0")))
    if total_assets_cents <= 0:
        raise ValueError("总资产必须大于 0")

    conn = sqlite3.connect(config.db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yzxy_import_mod.ensure_schema_ready(conn)
        existing = conn.execute(
            """
            SELECT id, source_type, source_file, import_job_id
            FROM investment_records
            WHERE id = ?
            """,
            (record_id,),
        ).fetchone()
        if not existing:
            raise ValueError("未找到要修改的投资记录")
        if account_id_input:
            account_row = load_account_row_by_id(conn, account_id_input)
            if str(account_row["account_type"]) != "investment":
                raise ValueError("所选账户不是投资账户")
            account_id = str(account_row["id"])
            account_name = str(account_row["name"])
        else:
            account_name = account_name_input or "手工投资账户"
            account_id = yzxy_import_mod.account_id_from_name(account_name)
        with conn:
            yzxy_import_mod.ensure_account(conn, account_id, account_name)
            conn.execute(
                """
                UPDATE investment_records
                SET account_id = ?,
                    snapshot_date = ?,
                    total_assets_cents = ?,
                    transfer_amount_cents = ?,
                    updated_at = datetime('now')
                WHERE id = ?
                """,
                (
                    account_id,
                    snapshot_date,
                    total_assets_cents,
                    transfer_amount_cents,
                    record_id,
                ),
            )
    except sqlite3.IntegrityError as exc:
        raise ValueError(f"修改失败（可能与现有记录冲突）: {exc}") from exc
    finally:
        conn.close()

    return {
        "id": record_id,
        "account_id": account_id,
        "account_name": account_name,
        "snapshot_date": snapshot_date,
        "total_assets_cents": total_assets_cents,
        "transfer_amount_cents": transfer_amount_cents,
    }


def delete_investment_record(config: AppConfig, payload: dict[str, Any]) -> dict[str, Any]:
    ensure_db(config)
    record_id = str(payload.get("id", "")).strip()
    if not record_id:
        raise ValueError("id 必填")

    conn = sqlite3.connect(config.db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        row = conn.execute(
            """
            SELECT r.id, r.account_id, COALESCE(a.name, r.account_id) AS account_name, r.snapshot_date
            FROM investment_records r
            LEFT JOIN accounts a ON a.id = r.account_id
            WHERE r.id = ?
            """,
            (record_id,),
        ).fetchone()
        if not row:
            raise ValueError("未找到要删除的投资记录")
        with conn:
            conn.execute("DELETE FROM investment_records WHERE id = ?", (record_id,))
    finally:
        conn.close()

    return {
        "id": str(row["id"]),
        "account_id": str(row["account_id"]),
        "account_name": str(row["account_name"]),
        "snapshot_date": str(row["snapshot_date"]),
        "deleted": True,
    }


def upsert_manual_asset_valuation(config: AppConfig, payload: dict[str, Any]) -> dict[str, Any]:
    ensure_db(config)
    asset_class = str(payload.get("asset_class", "")).strip().lower()
    if asset_class not in SUPPORTED_ASSET_CLASSES:
        raise ValueError("asset_class 必须是 cash、real_estate 或 liability")

    snapshot_date = yzxy_import_mod.normalize_date(str(payload.get("snapshot_date", "")))
    default_name_map = {
        "cash": "现金账户",
        "real_estate": "不动产账户",
        "liability": "负债账户",
    }
    default_name = default_name_map.get(asset_class, "资产账户")
    account_id_input = str(payload.get("account_id", "")).strip()
    account_name_input = str(payload.get("account_name", "")).strip()
    account_name = account_name_input or default_name
    value_cents = yzxy_import_mod.parse_amount_to_cents(str(payload.get("value", "0")))
    if value_cents <= 0:
        raise ValueError("资产金额必须大于 0")

    conn = sqlite3.connect(config.db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        ensure_asset_schema_ready(conn)
        if account_id_input:
            account_row = load_account_row_by_id(conn, account_id_input)
            account_id = str(account_row["id"])
            account_name = str(account_row["name"])
            account_type = str(account_row["account_type"])
            if asset_class == "cash" and account_type != "cash":
                raise ValueError("所选账户不是现金账户")
            if asset_class == "real_estate" and account_type not in {"other"} and not account_id.startswith("acct_re_"):
                raise ValueError("所选账户不是不动产账户")
            if asset_class == "liability" and account_type != "liability":
                raise ValueError("所选账户不是负债账户")
        else:
            account_id = account_id_from_asset_name(asset_class, account_name)
            account_type = "cash" if asset_class == "cash" else ("liability" if asset_class == "liability" else "other")
        record_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"{account_id}:{asset_class}:{snapshot_date}"))
        with conn:
            upsert_account(
                conn,
                account_id=account_id,
                account_name=account_name,
                account_type=account_type,
            )
            conn.execute(
                """
                INSERT INTO account_valuations(
                    id, account_id, account_name, asset_class, snapshot_date, value_cents, source_type
                )
                VALUES (?, ?, ?, ?, ?, ?, 'manual')
                ON CONFLICT(account_id, asset_class, snapshot_date) DO UPDATE SET
                    account_name=excluded.account_name,
                    value_cents=excluded.value_cents,
                    source_type='manual',
                    updated_at=datetime('now')
                """,
                (
                    record_id,
                    account_id,
                    account_name,
                    asset_class,
                    snapshot_date,
                    value_cents,
                ),
            )
    finally:
        conn.close()

    return {
        "account_id": account_id,
        "account_name": account_name,
        "asset_class": asset_class,
        "snapshot_date": snapshot_date,
        "value_cents": value_cents,
        "value_yuan": cents_to_yuan_text(value_cents),
    }


def update_asset_valuation(config: AppConfig, payload: dict[str, Any]) -> dict[str, Any]:
    ensure_db(config)
    record_id = str(payload.get("id", "")).strip()
    if not record_id:
        raise ValueError("id 必填")

    asset_class = str(payload.get("asset_class", "")).strip().lower()
    if asset_class not in SUPPORTED_ASSET_CLASSES:
        raise ValueError("asset_class 必须是 cash、real_estate 或 liability")
    snapshot_date = yzxy_import_mod.normalize_date(str(payload.get("snapshot_date", "")))
    default_name_map = {
        "cash": "现金账户",
        "real_estate": "不动产账户",
        "liability": "负债账户",
    }
    default_name = default_name_map.get(asset_class, "资产账户")
    account_id_input = str(payload.get("account_id", "")).strip()
    account_name_input = str(payload.get("account_name", "")).strip()
    account_name = account_name_input or default_name
    value_cents = yzxy_import_mod.parse_amount_to_cents(str(payload.get("value", "0")))
    if value_cents <= 0:
        raise ValueError("资产金额必须大于 0")

    conn = sqlite3.connect(config.db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        ensure_asset_schema_ready(conn)
        existing = conn.execute(
            """
            SELECT id
            FROM account_valuations
            WHERE id = ?
            """,
            (record_id,),
        ).fetchone()
        if not existing:
            raise ValueError("未找到要修改的资产记录")
        if account_id_input:
            account_row = load_account_row_by_id(conn, account_id_input)
            account_id = str(account_row["id"])
            account_name = str(account_row["name"])
            account_type = str(account_row["account_type"])
            if asset_class == "cash" and account_type != "cash":
                raise ValueError("所选账户不是现金账户")
            if asset_class == "real_estate" and account_type not in {"other"} and not account_id.startswith("acct_re_"):
                raise ValueError("所选账户不是不动产账户")
            if asset_class == "liability" and account_type != "liability":
                raise ValueError("所选账户不是负债账户")
        else:
            account_id = account_id_from_asset_name(asset_class, account_name)
            account_type = "cash" if asset_class == "cash" else ("liability" if asset_class == "liability" else "other")
        with conn:
            upsert_account(
                conn,
                account_id=account_id,
                account_name=account_name,
                account_type=account_type,
            )
            conn.execute(
                """
                UPDATE account_valuations
                SET account_id = ?,
                    account_name = ?,
                    asset_class = ?,
                    snapshot_date = ?,
                    value_cents = ?,
                    updated_at = datetime('now')
                WHERE id = ?
                """,
                (
                    account_id,
                    account_name,
                    asset_class,
                    snapshot_date,
                    value_cents,
                    record_id,
                ),
            )
    except sqlite3.IntegrityError as exc:
        raise ValueError(f"修改失败（可能与现有记录冲突）: {exc}") from exc
    finally:
        conn.close()

    return {
        "id": record_id,
        "account_id": account_id,
        "account_name": account_name,
        "asset_class": asset_class,
        "snapshot_date": snapshot_date,
        "value_cents": value_cents,
        "value_yuan": cents_to_yuan_text(value_cents),
    }


def delete_asset_valuation(config: AppConfig, payload: dict[str, Any]) -> dict[str, Any]:
    ensure_db(config)
    record_id = str(payload.get("id", "")).strip()
    if not record_id:
        raise ValueError("id 必填")

    conn = sqlite3.connect(config.db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        row = conn.execute(
            """
            SELECT id, account_id, account_name, asset_class, snapshot_date
            FROM account_valuations
            WHERE id = ?
            """,
            (record_id,),
        ).fetchone()
        if not row:
            raise ValueError("未找到要删除的资产记录")
        with conn:
            conn.execute("DELETE FROM account_valuations WHERE id = ?", (record_id,))
    finally:
        conn.close()

    return {
        "id": str(row["id"]),
        "account_id": str(row["account_id"]),
        "account_name": str(row["account_name"]),
        "asset_class": str(row["asset_class"]),
        "snapshot_date": str(row["snapshot_date"]),
        "deleted": True,
    }


def query_accounts(config: AppConfig, qs: dict[str, list[str]]) -> dict[str, Any]:
    kind = (qs.get("kind") or ["all"])[0].strip().lower() or "all"
    if kind not in {"all", "investment", "cash", "real_estate", "liability"}:
        raise ValueError("kind 仅支持 all/investment/cash/real_estate/liability")

    conn = sqlite3.connect(config.db_path)
    conn.row_factory = sqlite3.Row
    try:
        investment_rows = conn.execute(
            """
            SELECT
                r.account_id,
                COALESCE(a.name, r.account_id) AS account_name,
                COUNT(*) AS record_count,
                MIN(r.snapshot_date) AS first_snapshot_date,
                MAX(r.snapshot_date) AS latest_snapshot_date
            FROM investment_records r
            LEFT JOIN accounts a ON a.id = r.account_id
            GROUP BY r.account_id
            ORDER BY latest_snapshot_date DESC, account_name
            """
        ).fetchall()

        asset_rows = conn.execute(
            """
            SELECT
                v.account_id,
                v.account_name,
                v.asset_class,
                COUNT(*) AS record_count,
                MIN(v.snapshot_date) AS first_snapshot_date,
                MAX(v.snapshot_date) AS latest_snapshot_date
            FROM account_valuations v
            GROUP BY v.account_id, v.asset_class
            ORDER BY latest_snapshot_date DESC, v.account_name
            """
        ).fetchall()
    finally:
        conn.close()

    investment_items = [dict(row) for row in investment_rows]
    cash_items = [dict(row) for row in asset_rows if row["asset_class"] == "cash"]
    real_estate_items = [dict(row) for row in asset_rows if row["asset_class"] == "real_estate"]
    liability_items = [dict(row) for row in asset_rows if row["asset_class"] == "liability"]

    if kind == "investment":
        selected = investment_items
    elif kind == "cash":
        selected = cash_items
    elif kind == "real_estate":
        selected = real_estate_items
    elif kind == "liability":
        selected = liability_items
    else:
        selected = investment_items + cash_items + real_estate_items + liability_items

    return {
        "kind": kind,
        "accounts": selected,
        "investment_accounts": investment_items,
        "cash_accounts": cash_items,
        "real_estate_accounts": real_estate_items,
        "liability_accounts": liability_items,
    }


def query_account_catalog(config: AppConfig, qs: dict[str, list[str]]) -> dict[str, Any]:
    ensure_db(config)
    kind_filter = (qs.get("kind") or ["all"])[0].strip().lower() or "all"
    keyword = (qs.get("keyword") or [""])[0].strip().lower()
    limit = min(max(int((qs.get("limit") or ["500"])[0] or "500"), 1), 1000)

    valid_kind_filters = {"all", *ACCOUNT_KIND_CHOICES}
    if kind_filter not in valid_kind_filters:
        raise ValueError(f"kind 仅支持: {', '.join(sorted(valid_kind_filters))}")

    conn = sqlite3.connect(config.db_path)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            """
            SELECT
                a.id,
                a.name,
                a.account_type,
                a.currency,
                a.initial_balance_cents,
                a.created_at,
                a.updated_at,
                COALESCE(t.tx_count, 0) AS transaction_count,
                COALESCE(inv.inv_count, 0) AS investment_record_count,
                COALESCE(av.asset_val_count, 0) AS asset_valuation_count,
                COALESCE(av.cash_count, 0) AS cash_valuation_count,
                COALESCE(av.real_estate_count, 0) AS real_estate_valuation_count
            FROM accounts a
            LEFT JOIN (
                SELECT account_id, COUNT(*) AS tx_count
                FROM transactions
                GROUP BY account_id
            ) t ON t.account_id = a.id
            LEFT JOIN (
                SELECT account_id, COUNT(*) AS inv_count
                FROM investment_records
                GROUP BY account_id
            ) inv ON inv.account_id = a.id
            LEFT JOIN (
                SELECT
                    account_id,
                    COUNT(*) AS asset_val_count,
                    SUM(CASE WHEN asset_class = 'cash' THEN 1 ELSE 0 END) AS cash_count,
                    SUM(CASE WHEN asset_class = 'real_estate' THEN 1 ELSE 0 END) AS real_estate_count
                FROM account_valuations
                GROUP BY account_id
            ) av ON av.account_id = a.id
            ORDER BY a.updated_at DESC, a.name ASC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    finally:
        conn.close()

    items: list[dict[str, Any]] = []
    for row in rows:
        account_id = str(row["id"])
        account_type = str(row["account_type"])
        inferred_kind = infer_account_kind(
            account_id=account_id,
            account_type=account_type,
            asset_cash_count=int(row["cash_valuation_count"] or 0),
            asset_real_estate_count=int(row["real_estate_valuation_count"] or 0),
        )
        item = {
            "account_id": account_id,
            "account_name": str(row["name"]),
            "account_type": account_type,
            "account_kind": inferred_kind,
            "currency": str(row["currency"]),
            "initial_balance_cents": int(row["initial_balance_cents"] or 0),
            "initial_balance_yuan": cents_to_yuan_text(int(row["initial_balance_cents"] or 0)),
            "transaction_count": int(row["transaction_count"] or 0),
            "investment_record_count": int(row["investment_record_count"] or 0),
            "asset_valuation_count": int(row["asset_valuation_count"] or 0),
            "cash_valuation_count": int(row["cash_valuation_count"] or 0),
            "real_estate_valuation_count": int(row["real_estate_valuation_count"] or 0),
            "created_at": str(row["created_at"]),
            "updated_at": str(row["updated_at"]),
        }
        if kind_filter != "all" and inferred_kind != kind_filter:
            continue
        if keyword:
            hay = " ".join(
                [
                    item["account_id"],
                    item["account_name"],
                    item["account_kind"],
                    item["account_type"],
                ]
            ).lower()
            if keyword not in hay:
                continue
        items.append(item)

    kind_groups: dict[str, list[dict[str, Any]]] = {k: [] for k in ACCOUNT_KIND_CHOICES}
    for item in items:
        kind_groups.setdefault(item["account_kind"], []).append(item)

    return {
        "summary": {
            "count": len(items),
            "kind": kind_filter,
            "keyword": keyword,
            "limit": limit,
        },
        "rows": items,
        "groups": kind_groups,
    }


def upsert_account_catalog_entry(config: AppConfig, payload: dict[str, Any]) -> dict[str, Any]:
    ensure_db(config)
    account_name = str(payload.get("account_name", "")).strip()
    if not account_name:
        raise ValueError("account_name 必填")
    account_kind = normalize_account_kind(str(payload.get("account_kind", "")).strip())
    account_id_raw = str(payload.get("account_id", "")).strip()
    account_id = account_id_raw or account_id_from_manual_account(account_kind, account_name)
    account_type = account_kind_to_db_type(account_kind)

    conn = sqlite3.connect(config.db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        with conn:
            upsert_account(
                conn,
                account_id=account_id,
                account_name=account_name,
                account_type=account_type,
            )
            # Keep denormalized account_name in asset valuations in sync for edited account names.
            conn.execute(
                """
                UPDATE account_valuations
                SET account_name = ?, updated_at = datetime('now')
                WHERE account_id = ?
                """,
                (account_name, account_id),
            )

        refreshed = query_account_catalog(
            AppConfig(
                root_dir=config.root_dir,
                work_dir=config.work_dir,
                rules_dir=config.rules_dir,
                db_path=config.db_path,
                migrations_dir=config.migrations_dir,
                assets_dir=config.assets_dir,
                session_dir=config.session_dir,
            ),
            {"keyword": [account_id], "limit": ["5"]},
        )
    finally:
        conn.close()

    row = next((item for item in refreshed["rows"] if item["account_id"] == account_id), None)
    return {
        "created": not bool(account_id_raw),
        "updated": bool(account_id_raw),
        "row": row
        or {
            "account_id": account_id,
            "account_name": account_name,
            "account_kind": account_kind,
            "account_type": account_type,
        },
    }


def delete_account_catalog_entry(config: AppConfig, payload: dict[str, Any]) -> dict[str, Any]:
    ensure_db(config)
    account_id = str(payload.get("account_id", "")).strip()
    if not account_id:
        raise ValueError("account_id 必填")

    conn = sqlite3.connect(config.db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        row = load_account_row_by_id(conn, account_id)
        tx_count = int(
            conn.execute("SELECT COUNT(*) FROM transactions WHERE account_id = ?", (account_id,)).fetchone()[0]
        )
        inv_count = int(
            conn.execute("SELECT COUNT(*) FROM investment_records WHERE account_id = ?", (account_id,)).fetchone()[0]
        )
        asset_count = int(
            conn.execute("SELECT COUNT(*) FROM account_valuations WHERE account_id = ?", (account_id,)).fetchone()[0]
        )
        if tx_count > 0 or inv_count > 0 or asset_count > 0:
            raise ValueError(
                f"账户仍被引用，不能删除（transactions={tx_count}, investments={inv_count}, assets={asset_count}）"
            )
        with conn:
            conn.execute("DELETE FROM accounts WHERE id = ?", (account_id,))
    finally:
        conn.close()

    return {
        "deleted": True,
        "account_id": account_id,
        "account_name": str(row["name"]),
    }


def query_asset_valuations(config: AppConfig, qs: dict[str, list[str]]) -> dict[str, Any]:
    limit = min(max(int((qs.get("limit") or ["100"])[0] or "100"), 1), 500)
    date_from = (qs.get("from") or [""])[0].strip()
    date_to = (qs.get("to") or [""])[0].strip()
    asset_class = (qs.get("asset_class") or [""])[0].strip().lower()
    account_id = (qs.get("account_id") or [""])[0].strip()

    if asset_class and asset_class not in SUPPORTED_ASSET_CLASSES:
        raise ValueError("asset_class 仅支持 cash/real_estate/liability")

    conditions: list[str] = []
    params: list[Any] = []
    if date_from:
        conditions.append("snapshot_date >= ?")
        params.append(date_from)
    if date_to:
        conditions.append("snapshot_date <= ?")
        params.append(date_to)
    if asset_class:
        conditions.append("asset_class = ?")
        params.append(asset_class)
    if account_id:
        conditions.append("account_id = ?")
        params.append(account_id)

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    conn = sqlite3.connect(config.db_path)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            f"""
            SELECT id, account_id, account_name, asset_class, snapshot_date, value_cents, source_type
            FROM account_valuations
            {where}
            ORDER BY snapshot_date DESC, updated_at DESC
            LIMIT ?
            """,
            [*params, limit],
        ).fetchall()

        summary_row = conn.execute(
            f"""
            SELECT
                COUNT(*) AS count,
                COALESCE(SUM(value_cents), 0) AS total_cents
            FROM account_valuations
            {where}
            """,
            params,
        ).fetchone()
    finally:
        conn.close()

    total_cents = int(summary_row["total_cents"]) if summary_row else 0
    return {
        "summary": {
            "count": int(summary_row["count"]) if summary_row else 0,
            "sum_value_cents": total_cents,
            "sum_value_yuan": cents_to_yuan_text(total_cents),
            "asset_class": asset_class,
        },
        "rows": [dict(row) for row in rows],
    }


def load_investment_account_bounds(
    conn: sqlite3.Connection,
    account_id: str,
) -> tuple[str, date, date]:
    row = conn.execute(
        """
        SELECT
            r.account_id,
            COALESCE(a.name, r.account_id) AS account_name,
            MIN(r.snapshot_date) AS earliest_date,
            MAX(r.snapshot_date) AS latest_date
        FROM investment_records r
        LEFT JOIN accounts a ON a.id = r.account_id
        WHERE r.account_id = ?
        GROUP BY r.account_id
        """,
        (account_id,),
    ).fetchone()
    if not row:
        raise ValueError("未找到该投资账户的记录")
    account_name = str(row["account_name"])
    earliest = parse_iso_date(str(row["earliest_date"]), "earliest_date")
    latest = parse_iso_date(str(row["latest_date"]), "latest_date")
    return account_name, earliest, latest


def load_investment_portfolio_bounds(conn: sqlite3.Connection) -> tuple[date, date, int]:
    row = conn.execute(
        """
        SELECT
            MIN(snapshot_date) AS earliest_date,
            MAX(snapshot_date) AS latest_date,
            COUNT(DISTINCT account_id) AS account_count
        FROM investment_records
        """
    ).fetchone()
    if not row or not row["latest_date"]:
        raise ValueError("未找到可用的投资记录")
    earliest = parse_iso_date(str(row["earliest_date"]), "earliest_date")
    latest = parse_iso_date(str(row["latest_date"]), "latest_date")
    account_count = int(row["account_count"] or 0)
    if account_count <= 0:
        raise ValueError("未找到可用的投资账户")
    return earliest, latest, account_count


def select_begin_snapshot(
    conn: sqlite3.Connection,
    account_id: str,
    *,
    window_from: date,
    window_to: date,
) -> sqlite3.Row | None:
    begin_row = conn.execute(
        """
        SELECT snapshot_date, total_assets_cents
        FROM investment_records
        WHERE account_id = ? AND snapshot_date <= ? AND total_assets_cents > 0
        ORDER BY snapshot_date DESC
        LIMIT 1
        """,
        (account_id, window_from.isoformat()),
    ).fetchone()
    if begin_row:
        return begin_row

    begin_row = conn.execute(
        """
        SELECT snapshot_date, total_assets_cents
        FROM investment_records
        WHERE account_id = ? AND snapshot_date >= ? AND snapshot_date <= ? AND total_assets_cents > 0
        ORDER BY snapshot_date ASC
        LIMIT 1
        """,
        (account_id, window_from.isoformat(), window_to.isoformat()),
    ).fetchone()
    if begin_row:
        return begin_row

    return conn.execute(
        """
        SELECT snapshot_date, total_assets_cents
        FROM investment_records
        WHERE account_id = ? AND snapshot_date <= ?
        ORDER BY snapshot_date DESC
        LIMIT 1
        """,
        (account_id, window_from.isoformat()),
    ).fetchone()


def select_end_snapshot(
    conn: sqlite3.Connection,
    account_id: str,
    *,
    begin_date: date,
    window_to: date,
) -> sqlite3.Row | None:
    end_row = conn.execute(
        """
        SELECT snapshot_date, total_assets_cents
        FROM investment_records
        WHERE account_id = ? AND snapshot_date >= ? AND snapshot_date <= ? AND total_assets_cents > 0
        ORDER BY snapshot_date DESC
        LIMIT 1
        """,
        (account_id, begin_date.isoformat(), window_to.isoformat()),
    ).fetchone()
    if end_row:
        return end_row

    return conn.execute(
        """
        SELECT snapshot_date, total_assets_cents
        FROM investment_records
        WHERE account_id = ? AND snapshot_date >= ? AND snapshot_date <= ?
        ORDER BY snapshot_date DESC
        LIMIT 1
        """,
        (account_id, begin_date.isoformat(), window_to.isoformat()),
    ).fetchone()


def load_transfer_rows(
    conn: sqlite3.Connection,
    account_id: str,
    *,
    begin_date: date,
    end_date: date,
) -> list[sqlite3.Row]:
    return conn.execute(
        """
        SELECT snapshot_date, transfer_amount_cents
        FROM investment_records
        WHERE account_id = ?
          AND snapshot_date > ?
          AND snapshot_date <= ?
          AND transfer_amount_cents != 0
        ORDER BY snapshot_date ASC
        """,
        (account_id, begin_date.isoformat(), end_date.isoformat()),
    ).fetchall()


def calculate_modified_dietz(
    *,
    begin_date: date,
    end_date: date,
    begin_assets_cents: int,
    end_assets_cents: int,
    flow_rows: list[sqlite3.Row],
    allow_zero_interval: bool,
) -> dict[str, Any]:
    interval_days = (end_date - begin_date).days
    if interval_days < 0:
        raise ValueError("结束日期不能早于开始日期")
    if interval_days == 0 and not allow_zero_interval:
        raise ValueError("区间内有效快照不足，无法计算收益率")

    net_flow = sum(int(r["transfer_amount_cents"]) for r in flow_rows)
    profit_cents = end_assets_cents - begin_assets_cents - net_flow

    weighted_flow = 0.0
    cash_flows: list[dict[str, Any]] = []
    for row in flow_rows:
        flow_date = parse_iso_date(str(row["snapshot_date"]), "flow_date")
        flow_cents = int(row["transfer_amount_cents"])
        if flow_cents == 0:
            continue
        if interval_days > 0:
            weight = (end_date - flow_date).days / interval_days
        else:
            weight = 0.0
        weighted_flow += flow_cents * weight
        cash_flows.append(
            {
                "snapshot_date": row["snapshot_date"],
                "transfer_amount_cents": flow_cents,
                "transfer_amount_yuan": cents_to_yuan_text(flow_cents),
                "weight": round(weight, 6),
            }
        )

    denominator = begin_assets_cents + weighted_flow
    return_rate: float | None
    annualized_rate: float | None
    note = ""
    if interval_days == 0:
        if denominator <= 0:
            return_rate = None
            annualized_rate = None
            note = "加权本金小于等于 0，无法计算现金加权收益率。"
        else:
            return_rate = 0.0
            annualized_rate = None
    elif denominator <= 0:
        return_rate = None
        annualized_rate = None
        note = "加权本金小于等于 0，无法计算现金加权收益率。"
    else:
        return_rate = profit_cents / denominator
        if (1 + return_rate) > 0:
            annualized_rate = (1 + return_rate) ** (365 / interval_days) - 1
        else:
            annualized_rate = None

    return {
        "interval_days": interval_days,
        "net_flow_cents": net_flow,
        "profit_cents": profit_cents,
        "weighted_capital_cents": int(round(denominator)),
        "return_rate": return_rate,
        "annualized_rate": annualized_rate,
        "note": note,
        "cash_flows": cash_flows,
    }


def build_investment_portfolio_return_payload(
    conn: sqlite3.Connection,
    *,
    preset: str,
    from_raw: str,
    to_raw: str,
) -> dict[str, Any]:
    earliest, latest, account_count = load_investment_portfolio_bounds(conn)
    requested_from, effective_from, effective_to = resolve_window(
        preset=preset,
        from_raw=from_raw,
        to_raw=to_raw,
        earliest=earliest,
        latest=latest,
    )
    if effective_from >= effective_to:
        raise ValueError("区间内有效快照不足，无法计算收益率")

    date_rows = conn.execute(
        """
        SELECT DISTINCT snapshot_date
        FROM investment_records
        WHERE snapshot_date >= ? AND snapshot_date <= ?
        ORDER BY snapshot_date ASC
        """,
        (effective_from.isoformat(), effective_to.isoformat()),
    ).fetchall()
    candidate_dates = {str(row["snapshot_date"]) for row in date_rows}
    candidate_dates.add(effective_from.isoformat())
    candidate_dates.add(effective_to.isoformat())
    ordered_dates = sorted(candidate_dates)

    history_rows = conn.execute(
        """
        SELECT
            account_id,
            snapshot_date,
            total_assets_cents AS value_cents,
            transfer_amount_cents AS flow_cents
        FROM investment_records
        WHERE snapshot_date <= ?
        ORDER BY account_id, snapshot_date
        """,
        (effective_to.isoformat(),),
    ).fetchall()
    if not history_rows:
        raise ValueError("区间内没有可用的投资记录")
    totals = build_asof_totals(dates=ordered_dates, history_rows=history_rows)
    begin_assets = int(totals[effective_from.isoformat()])
    end_assets = int(totals[effective_to.isoformat()])

    flow_rows = conn.execute(
        """
        SELECT snapshot_date, COALESCE(SUM(transfer_amount_cents), 0) AS transfer_amount_cents
        FROM investment_records
        WHERE snapshot_date > ? AND snapshot_date <= ? AND transfer_amount_cents != 0
        GROUP BY snapshot_date
        HAVING COALESCE(SUM(transfer_amount_cents), 0) != 0
        ORDER BY snapshot_date ASC
        """,
        (effective_from.isoformat(), effective_to.isoformat()),
    ).fetchall()
    calc = calculate_modified_dietz(
        begin_date=effective_from,
        end_date=effective_to,
        begin_assets_cents=begin_assets,
        end_assets_cents=end_assets,
        flow_rows=flow_rows,
        allow_zero_interval=False,
    )

    requested_to_text = parse_iso_date(to_raw, "to").isoformat() if to_raw else latest.isoformat()
    return_rate = calc["return_rate"]
    annualized_rate = calc["annualized_rate"]

    return {
        "account_id": PORTFOLIO_ACCOUNT_ID,
        "account_name": PORTFOLIO_ACCOUNT_NAME,
        "account_count": account_count,
        "range": {
            "preset": preset,
            "requested_from": requested_from.isoformat(),
            "requested_to": requested_to_text,
            "effective_from": effective_from.isoformat(),
            "effective_to": effective_to.isoformat(),
            "interval_days": calc["interval_days"],
        },
        "metrics": {
            "begin_assets_cents": begin_assets,
            "begin_assets_yuan": cents_to_yuan_text(begin_assets),
            "end_assets_cents": end_assets,
            "end_assets_yuan": cents_to_yuan_text(end_assets),
            "net_flow_cents": calc["net_flow_cents"],
            "net_flow_yuan": cents_to_yuan_text(calc["net_flow_cents"]),
            "profit_cents": calc["profit_cents"],
            "profit_yuan": cents_to_yuan_text(calc["profit_cents"]),
            "net_growth_cents": calc["profit_cents"],
            "net_growth_yuan": cents_to_yuan_text(calc["profit_cents"]),
            "weighted_capital_cents": calc["weighted_capital_cents"],
            "weighted_capital_yuan": cents_to_yuan_text(calc["weighted_capital_cents"]),
            "return_rate": round(return_rate, 8) if return_rate is not None else None,
            "return_rate_pct": f"{return_rate * 100:.2f}%" if return_rate is not None else None,
            "annualized_rate": round(annualized_rate, 8) if annualized_rate is not None else None,
            "annualized_rate_pct": f"{annualized_rate * 100:.2f}%" if annualized_rate is not None else None,
            "note": calc["note"],
        },
        "cash_flows": calc["cash_flows"],
    }


def build_investment_portfolio_curve_payload(
    conn: sqlite3.Connection,
    *,
    preset: str,
    from_raw: str,
    to_raw: str,
) -> dict[str, Any]:
    earliest, latest, account_count = load_investment_portfolio_bounds(conn)
    requested_from, effective_from, effective_to = resolve_window(
        preset=preset,
        from_raw=from_raw,
        to_raw=to_raw,
        earliest=earliest,
        latest=latest,
    )
    if effective_from > effective_to:
        raise ValueError("区间内有效快照不足，无法生成曲线")

    date_rows = conn.execute(
        """
        SELECT DISTINCT snapshot_date
        FROM investment_records
        WHERE snapshot_date >= ? AND snapshot_date <= ?
        ORDER BY snapshot_date ASC
        """,
        (effective_from.isoformat(), effective_to.isoformat()),
    ).fetchall()
    candidate_dates = {str(row["snapshot_date"]) for row in date_rows}
    candidate_dates.add(effective_from.isoformat())
    candidate_dates.add(effective_to.isoformat())
    ordered_dates = sorted(candidate_dates)

    history_rows = conn.execute(
        """
        SELECT
            account_id,
            snapshot_date,
            total_assets_cents AS value_cents,
            transfer_amount_cents AS flow_cents
        FROM investment_records
        WHERE snapshot_date <= ?
        ORDER BY account_id, snapshot_date
        """,
        (effective_to.isoformat(),),
    ).fetchall()
    if not history_rows:
        raise ValueError("区间内没有可用的投资记录")
    totals = build_asof_totals(dates=ordered_dates, history_rows=history_rows)
    begin_assets = int(totals[effective_from.isoformat()])

    flow_rows = conn.execute(
        """
        SELECT snapshot_date, COALESCE(SUM(transfer_amount_cents), 0) AS transfer_amount_cents
        FROM investment_records
        WHERE snapshot_date > ? AND snapshot_date <= ? AND transfer_amount_cents != 0
        GROUP BY snapshot_date
        HAVING COALESCE(SUM(transfer_amount_cents), 0) != 0
        ORDER BY snapshot_date ASC
        """,
        (effective_from.isoformat(), effective_to.isoformat()),
    ).fetchall()
    flow_points = [(str(row["snapshot_date"]), int(row["transfer_amount_cents"])) for row in flow_rows]
    transfer_by_date = {flow_date: flow_amount for flow_date, flow_amount in flow_points}

    rows: list[dict[str, Any]] = []
    for point_date_text in ordered_dates:
        if point_date_text < effective_from.isoformat():
            continue
        point_date = parse_iso_date(point_date_text, "point_date")
        point_assets = int(totals[point_date_text])

        point_flows: list[dict[str, Any]] = []
        for flow_date, flow_amount in flow_points:
            if flow_date > point_date_text:
                break
            point_flows.append(
                {
                    "snapshot_date": flow_date,
                    "transfer_amount_cents": flow_amount,
                }
            )

        point_calc = calculate_modified_dietz(
            begin_date=effective_from,
            end_date=point_date,
            begin_assets_cents=begin_assets,
            end_assets_cents=point_assets,
            flow_rows=point_flows,
            allow_zero_interval=True,
        )
        cumulative_return = point_calc["return_rate"]
        cumulative_net_growth_cents = int(point_calc["profit_cents"])
        rows.append(
            {
                "snapshot_date": point_date_text,
                "effective_snapshot_date": point_date_text,
                "total_assets_cents": point_assets,
                "total_assets_yuan": cents_to_yuan_text(point_assets),
                "transfer_amount_cents": transfer_by_date.get(point_date_text, 0),
                "transfer_amount_yuan": cents_to_yuan_text(transfer_by_date.get(point_date_text, 0)),
                "cumulative_net_growth_cents": cumulative_net_growth_cents,
                "cumulative_net_growth_yuan": cents_to_yuan_text(cumulative_net_growth_cents),
                "cumulative_return_rate": round(cumulative_return, 8) if cumulative_return is not None else None,
                "cumulative_return_pct": round(cumulative_return * 100, 4) if cumulative_return is not None else None,
                "cumulative_return_pct_text": (
                    f"{cumulative_return * 100:.2f}%" if cumulative_return is not None else None
                ),
            }
        )

    if not rows:
        return {
            "account_id": PORTFOLIO_ACCOUNT_ID,
            "account_name": PORTFOLIO_ACCOUNT_NAME,
            "account_count": account_count,
            "range": {
                "preset": preset,
                "requested_from": requested_from.isoformat(),
                "requested_to": parse_iso_date(to_raw, "to").isoformat() if to_raw else latest.isoformat(),
                "effective_from": effective_from.isoformat(),
                "effective_to": effective_to.isoformat(),
            },
            "summary": {
                "count": 0,
                "change_cents": 0,
                "change_pct": None,
                "end_net_growth_cents": 0,
                "end_net_growth_yuan": cents_to_yuan_text(0),
                "end_cumulative_return_rate": None,
                "end_cumulative_return_pct_text": None,
            },
            "rows": [],
        }

    first_value = int(rows[0]["total_assets_cents"])
    last_value = int(rows[-1]["total_assets_cents"])
    change_cents = last_value - first_value
    change_pct = (change_cents / first_value) if first_value > 0 else None
    end_net_growth_cents = int(rows[-1]["cumulative_net_growth_cents"])
    end_cumulative_return_rate = rows[-1]["cumulative_return_rate"]

    return {
        "account_id": PORTFOLIO_ACCOUNT_ID,
        "account_name": PORTFOLIO_ACCOUNT_NAME,
        "account_count": account_count,
        "range": {
            "preset": preset,
            "requested_from": requested_from.isoformat(),
            "requested_to": parse_iso_date(to_raw, "to").isoformat() if to_raw else latest.isoformat(),
            "effective_from": effective_from.isoformat(),
            "effective_to": rows[-1]["effective_snapshot_date"],
        },
        "summary": {
            "count": len(rows),
            "start_assets_cents": first_value,
            "start_assets_yuan": cents_to_yuan_text(first_value),
            "end_assets_cents": last_value,
            "end_assets_yuan": cents_to_yuan_text(last_value),
            "change_cents": change_cents,
            "change_yuan": cents_to_yuan_text(change_cents),
            "change_pct": round(change_pct, 8) if change_pct is not None else None,
            "change_pct_text": f"{change_pct * 100:.2f}%" if change_pct is not None else None,
            "end_net_growth_cents": end_net_growth_cents,
            "end_net_growth_yuan": cents_to_yuan_text(end_net_growth_cents),
            "end_cumulative_return_rate": end_cumulative_return_rate,
            "end_cumulative_return_pct_text": (
                f"{end_cumulative_return_rate * 100:.2f}%"
                if end_cumulative_return_rate is not None
                else None
            ),
        },
        "rows": rows,
    }


def build_investment_return_payload(
    conn: sqlite3.Connection,
    *,
    account_id: str,
    preset: str,
    from_raw: str,
    to_raw: str,
) -> dict[str, Any]:
    account_name, earliest, latest = load_investment_account_bounds(conn, account_id)
    requested_from, effective_from, effective_to = resolve_window(
        preset=preset,
        from_raw=from_raw,
        to_raw=to_raw,
        earliest=earliest,
        latest=latest,
    )

    begin_row = select_begin_snapshot(
        conn,
        account_id,
        window_from=effective_from,
        window_to=effective_to,
    )
    if not begin_row:
        raise ValueError("区间内没有可用的期初资产记录")

    begin_date = parse_iso_date(str(begin_row["snapshot_date"]), "begin_date")
    begin_assets = int(begin_row["total_assets_cents"])

    end_row = select_end_snapshot(
        conn,
        account_id,
        begin_date=begin_date,
        window_to=effective_to,
    )
    if not end_row:
        raise ValueError("区间内没有可用的期末资产记录")

    end_date = parse_iso_date(str(end_row["snapshot_date"]), "end_date")
    if begin_date >= end_date:
        raise ValueError("区间内有效快照不足，无法计算收益率")
    end_assets = int(end_row["total_assets_cents"])

    flow_rows = load_transfer_rows(
        conn,
        account_id,
        begin_date=begin_date,
        end_date=end_date,
    )
    calc = calculate_modified_dietz(
        begin_date=begin_date,
        end_date=end_date,
        begin_assets_cents=begin_assets,
        end_assets_cents=end_assets,
        flow_rows=flow_rows,
        allow_zero_interval=False,
    )

    requested_to_text = parse_iso_date(to_raw, "to").isoformat() if to_raw else latest.isoformat()
    return_rate = calc["return_rate"]
    annualized_rate = calc["annualized_rate"]

    return {
        "account_id": account_id,
        "account_name": account_name,
        "range": {
            "preset": preset,
            "requested_from": requested_from.isoformat(),
            "requested_to": requested_to_text,
            "effective_from": begin_date.isoformat(),
            "effective_to": end_date.isoformat(),
            "interval_days": calc["interval_days"],
        },
        "metrics": {
            "begin_assets_cents": begin_assets,
            "begin_assets_yuan": cents_to_yuan_text(begin_assets),
            "end_assets_cents": end_assets,
            "end_assets_yuan": cents_to_yuan_text(end_assets),
            "net_flow_cents": calc["net_flow_cents"],
            "net_flow_yuan": cents_to_yuan_text(calc["net_flow_cents"]),
            "profit_cents": calc["profit_cents"],
            "profit_yuan": cents_to_yuan_text(calc["profit_cents"]),
            "net_growth_cents": calc["profit_cents"],
            "net_growth_yuan": cents_to_yuan_text(calc["profit_cents"]),
            "weighted_capital_cents": calc["weighted_capital_cents"],
            "weighted_capital_yuan": cents_to_yuan_text(calc["weighted_capital_cents"]),
            "return_rate": round(return_rate, 8) if return_rate is not None else None,
            "return_rate_pct": f"{return_rate * 100:.2f}%" if return_rate is not None else None,
            "annualized_rate": round(annualized_rate, 8) if annualized_rate is not None else None,
            "annualized_rate_pct": f"{annualized_rate * 100:.2f}%" if annualized_rate is not None else None,
            "note": calc["note"],
        },
        "cash_flows": calc["cash_flows"],
    }


def query_investment_return(config: AppConfig, qs: dict[str, list[str]]) -> dict[str, Any]:
    account_id = (qs.get("account_id") or [""])[0].strip()
    if not account_id:
        raise ValueError("account_id 必填")

    preset = parse_preset((qs.get("preset") or ["ytd"])[0])
    from_raw = (qs.get("from") or [""])[0].strip()
    to_raw = (qs.get("to") or [""])[0].strip()

    conn = sqlite3.connect(config.db_path)
    conn.row_factory = sqlite3.Row
    try:
        if account_id == PORTFOLIO_ACCOUNT_ID:
            return build_investment_portfolio_return_payload(
                conn,
                preset=preset,
                from_raw=from_raw,
                to_raw=to_raw,
            )
        return build_investment_return_payload(
            conn,
            account_id=account_id,
            preset=preset,
            from_raw=from_raw,
            to_raw=to_raw,
        )
    finally:
        conn.close()


def query_investment_returns(config: AppConfig, qs: dict[str, list[str]]) -> dict[str, Any]:
    preset = parse_preset((qs.get("preset") or ["ytd"])[0])
    from_raw = (qs.get("from") or [""])[0].strip()
    to_raw = (qs.get("to") or [""])[0].strip()
    keyword = (qs.get("keyword") or [""])[0].strip().lower()
    limit = min(max(int((qs.get("limit") or ["200"])[0] or "200"), 1), 500)

    if preset == "custom":
        parse_iso_date(from_raw, "from")
    requested_to_text = parse_iso_date(to_raw, "to").isoformat() if to_raw else ""

    conn = sqlite3.connect(config.db_path)
    conn.row_factory = sqlite3.Row
    try:
        account_rows = conn.execute(
            """
            SELECT
                r.account_id,
                COALESCE(a.name, r.account_id) AS account_name,
                COUNT(*) AS record_count,
                MIN(r.snapshot_date) AS first_snapshot_date,
                MAX(r.snapshot_date) AS latest_snapshot_date
            FROM investment_records r
            LEFT JOIN accounts a ON a.id = r.account_id
            GROUP BY r.account_id
            ORDER BY latest_snapshot_date DESC, account_name
            """
        ).fetchall()

        if keyword:
            account_rows = [
                row
                for row in account_rows
                if keyword in str(row["account_id"]).lower() or keyword in str(row["account_name"]).lower()
            ]
        account_rows = account_rows[:limit]

        rows: list[dict[str, Any]] = []
        errors: list[dict[str, str]] = []
        for row in account_rows:
            account_id = str(row["account_id"])
            account_name = str(row["account_name"])
            try:
                payload = build_investment_return_payload(
                    conn,
                    account_id=account_id,
                    preset=preset,
                    from_raw=from_raw,
                    to_raw=to_raw,
                )
            except ValueError as exc:
                errors.append(
                    {
                        "account_id": account_id,
                        "account_name": account_name,
                        "error": str(exc),
                    }
                )
                continue

            metrics = payload["metrics"]
            rng = payload["range"]
            rows.append(
                {
                    "account_id": account_id,
                    "account_name": account_name,
                    "record_count": int(row["record_count"]),
                    "first_snapshot_date": str(row["first_snapshot_date"]),
                    "latest_snapshot_date": str(row["latest_snapshot_date"]),
                    "effective_from": rng["effective_from"],
                    "effective_to": rng["effective_to"],
                    "interval_days": int(rng["interval_days"]),
                    "begin_assets_cents": int(metrics["begin_assets_cents"]),
                    "begin_assets_yuan": metrics["begin_assets_yuan"],
                    "end_assets_cents": int(metrics["end_assets_cents"]),
                    "end_assets_yuan": metrics["end_assets_yuan"],
                    "net_flow_cents": int(metrics["net_flow_cents"]),
                    "net_flow_yuan": metrics["net_flow_yuan"],
                    "profit_cents": int(metrics["profit_cents"]),
                    "profit_yuan": metrics["profit_yuan"],
                    "net_growth_cents": int(metrics["net_growth_cents"]),
                    "net_growth_yuan": metrics["net_growth_yuan"],
                    "return_rate": metrics["return_rate"],
                    "return_rate_pct": metrics["return_rate_pct"],
                    "annualized_rate": metrics["annualized_rate"],
                    "annualized_rate_pct": metrics["annualized_rate_pct"],
                    "note": metrics["note"] or "",
                }
            )
    finally:
        conn.close()

    rows.sort(
        key=lambda item: (
            item["return_rate"] is None,
            -(item["return_rate"] if item["return_rate"] is not None else 0.0),
            item["account_name"],
        )
    )
    valid_rates = [float(row["return_rate"]) for row in rows if row["return_rate"] is not None]
    avg_rate = sum(valid_rates) / len(valid_rates) if valid_rates else None

    return {
        "range": {
            "preset": preset,
            "requested_from": from_raw if from_raw else "",
            "requested_to": requested_to_text,
            "input_limit": limit,
            "keyword": keyword,
        },
        "summary": {
            "account_count": len(account_rows),
            "computed_count": len(rows),
            "error_count": len(errors),
            "avg_return_rate": round(avg_rate, 8) if avg_rate is not None else None,
            "avg_return_pct": f"{avg_rate * 100:.2f}%" if avg_rate is not None else None,
        },
        "rows": rows,
        "errors": errors,
    }


def query_investment_curve(config: AppConfig, qs: dict[str, list[str]]) -> dict[str, Any]:
    account_id = (qs.get("account_id") or [""])[0].strip()
    if not account_id:
        raise ValueError("account_id 必填")

    preset = parse_preset((qs.get("preset") or ["1y"])[0])
    from_raw = (qs.get("from") or [""])[0].strip()
    to_raw = (qs.get("to") or [""])[0].strip()

    conn = sqlite3.connect(config.db_path)
    conn.row_factory = sqlite3.Row
    try:
        if account_id == PORTFOLIO_ACCOUNT_ID:
            return build_investment_portfolio_curve_payload(
                conn,
                preset=preset,
                from_raw=from_raw,
                to_raw=to_raw,
            )
        account_name, earliest, latest = load_investment_account_bounds(conn, account_id)
        requested_from, effective_from, effective_to = resolve_window(
            preset=preset,
            from_raw=from_raw,
            to_raw=to_raw,
            earliest=earliest,
            latest=latest,
        )

        begin_row = select_begin_snapshot(
            conn,
            account_id,
            window_from=effective_from,
            window_to=effective_to,
        )
        if not begin_row:
            raise ValueError("区间内没有可用的期初资产记录")
        begin_date = parse_iso_date(str(begin_row["snapshot_date"]), "begin_date")
        begin_assets = int(begin_row["total_assets_cents"])

        final_end_row = select_end_snapshot(
            conn,
            account_id,
            begin_date=begin_date,
            window_to=effective_to,
        )
        if not final_end_row:
            raise ValueError("区间内没有可用的期末资产记录")
        final_end_date = parse_iso_date(str(final_end_row["snapshot_date"]), "final_end_date")
        if final_end_date < begin_date:
            raise ValueError("区间内有效快照不足，无法生成曲线")

        date_rows = conn.execute(
            """
            SELECT DISTINCT snapshot_date
            FROM investment_records
            WHERE account_id = ? AND snapshot_date >= ? AND snapshot_date <= ?
            ORDER BY snapshot_date ASC
            """,
            (account_id, begin_date.isoformat(), final_end_date.isoformat()),
        ).fetchall()
        candidate_dates = {str(row["snapshot_date"]) for row in date_rows}
        candidate_dates.add(begin_date.isoformat())
        candidate_dates.add(final_end_date.isoformat())
        ordered_dates = sorted(candidate_dates)

        transfer_rows = conn.execute(
            """
            SELECT snapshot_date, COALESCE(SUM(transfer_amount_cents), 0) AS transfer_amount_cents
            FROM investment_records
            WHERE account_id = ? AND snapshot_date >= ? AND snapshot_date <= ? AND transfer_amount_cents != 0
            GROUP BY snapshot_date
            HAVING COALESCE(SUM(transfer_amount_cents), 0) != 0
            """,
            (account_id, begin_date.isoformat(), final_end_date.isoformat()),
        ).fetchall()
        transfer_by_date = {str(row["snapshot_date"]): int(row["transfer_amount_cents"]) for row in transfer_rows}

        rows: list[dict[str, Any]] = []
        for date_text in ordered_dates:
            point_date = parse_iso_date(date_text, "point_date")
            point_end_row = select_end_snapshot(
                conn,
                account_id,
                begin_date=begin_date,
                window_to=point_date,
            )
            if not point_end_row:
                continue

            point_end_date = parse_iso_date(str(point_end_row["snapshot_date"]), "point_end_date")
            point_end_assets = int(point_end_row["total_assets_cents"])
            point_flows = load_transfer_rows(
                conn,
                account_id,
                begin_date=begin_date,
                end_date=point_end_date,
            )
            point_calc = calculate_modified_dietz(
                begin_date=begin_date,
                end_date=point_end_date,
                begin_assets_cents=begin_assets,
                end_assets_cents=point_end_assets,
                flow_rows=point_flows,
                allow_zero_interval=True,
            )
            cumulative_return = point_calc["return_rate"]
            cumulative_net_growth_cents = int(point_calc["profit_cents"])
            rows.append(
                {
                    "snapshot_date": date_text,
                    "effective_snapshot_date": point_end_date.isoformat(),
                    "total_assets_cents": point_end_assets,
                    "total_assets_yuan": cents_to_yuan_text(point_end_assets),
                    "transfer_amount_cents": transfer_by_date.get(date_text, 0),
                    "transfer_amount_yuan": cents_to_yuan_text(transfer_by_date.get(date_text, 0)),
                    "cumulative_net_growth_cents": cumulative_net_growth_cents,
                    "cumulative_net_growth_yuan": cents_to_yuan_text(cumulative_net_growth_cents),
                    "cumulative_return_rate": round(cumulative_return, 8) if cumulative_return is not None else None,
                    "cumulative_return_pct": round(cumulative_return * 100, 4) if cumulative_return is not None else None,
                    "cumulative_return_pct_text": (
                        f"{cumulative_return * 100:.2f}%" if cumulative_return is not None else None
                    ),
                }
            )
    finally:
        conn.close()

    if not rows:
        return {
            "account_id": account_id,
            "account_name": account_name,
            "range": {
                "preset": preset,
                "requested_from": requested_from.isoformat(),
                "requested_to": parse_iso_date(to_raw, "to").isoformat() if to_raw else latest.isoformat(),
                "effective_from": begin_date.isoformat(),
                "effective_to": final_end_date.isoformat(),
            },
            "summary": {
                "count": 0,
                "change_cents": 0,
                "change_pct": None,
                "end_net_growth_cents": 0,
                "end_net_growth_yuan": cents_to_yuan_text(0),
                "end_cumulative_return_rate": None,
                "end_cumulative_return_pct_text": None,
            },
            "rows": [],
        }

    first_value = int(rows[0]["total_assets_cents"])
    last_value = int(rows[-1]["total_assets_cents"])
    change_cents = last_value - first_value
    change_pct = (change_cents / first_value) if first_value > 0 else None
    end_net_growth_cents = int(rows[-1]["cumulative_net_growth_cents"])
    end_cumulative_return_rate = rows[-1]["cumulative_return_rate"]

    return {
        "account_id": account_id,
        "account_name": account_name,
        "range": {
            "preset": preset,
            "requested_from": requested_from.isoformat(),
            "requested_to": parse_iso_date(to_raw, "to").isoformat() if to_raw else latest.isoformat(),
            "effective_from": begin_date.isoformat(),
            "effective_to": rows[-1]["effective_snapshot_date"],
        },
        "summary": {
            "count": len(rows),
            "start_assets_cents": first_value,
            "start_assets_yuan": cents_to_yuan_text(first_value),
            "end_assets_cents": last_value,
            "end_assets_yuan": cents_to_yuan_text(last_value),
            "change_cents": change_cents,
            "change_yuan": cents_to_yuan_text(change_cents),
            "change_pct": round(change_pct, 8) if change_pct is not None else None,
            "change_pct_text": f"{change_pct * 100:.2f}%" if change_pct is not None else None,
            "end_net_growth_cents": end_net_growth_cents,
            "end_net_growth_yuan": cents_to_yuan_text(end_net_growth_cents),
            "end_cumulative_return_rate": end_cumulative_return_rate,
            "end_cumulative_return_pct_text": (
                f"{end_cumulative_return_rate * 100:.2f}%"
                if end_cumulative_return_rate is not None
                else None
            ),
        },
        "rows": rows,
    }


def build_asof_totals(
    *,
    dates: list[str],
    history_rows: list[sqlite3.Row],
) -> dict[str, int]:
    totals = {d: 0 for d in dates}
    by_account: dict[str, list[tuple[str, int, int]]] = {}
    for row in history_rows:
        account_id = str(row["account_id"])
        flow_cents = int(row["flow_cents"]) if "flow_cents" in row.keys() else 0
        by_account.setdefault(account_id, []).append(
            (
                str(row["snapshot_date"]),
                int(row["value_cents"]),
                flow_cents,
            )
        )

    for series in by_account.values():
        series.sort(key=lambda x: x[0])
        idx = 0
        current = 0
        for d in dates:
            while idx < len(series) and series[idx][0] <= d:
                raw_value = series[idx][1]
                flow_cents = series[idx][2]
                if raw_value == 0 and flow_cents != 0 and current > 0:
                    # 兼容旧导入数据：资金流日期无总资产快照时，延续上一资产值。
                    pass
                else:
                    current = raw_value
                idx += 1
            totals[d] += current
    return totals


def query_wealth_overview(config: AppConfig, qs: dict[str, list[str]]) -> dict[str, Any]:
    as_of_raw = (qs.get("as_of") or [""])[0].strip()
    include_investment = parse_bool_param((qs.get("include_investment") or [""])[0], default=True)
    include_cash = parse_bool_param((qs.get("include_cash") or [""])[0], default=True)
    include_real_estate = parse_bool_param((qs.get("include_real_estate") or [""])[0], default=True)
    include_liability = parse_bool_param((qs.get("include_liability") or [""])[0], default=True)
    if not (include_investment or include_cash or include_real_estate or include_liability):
        raise ValueError("至少需要选择一个资产类型")

    conn = sqlite3.connect(config.db_path)
    conn.row_factory = sqlite3.Row
    try:
        max_date_row = conn.execute(
            """
            SELECT MAX(snapshot_date) AS max_date
            FROM (
                SELECT snapshot_date FROM investment_records
                UNION ALL
                SELECT snapshot_date FROM account_valuations
            )
            """
        ).fetchone()
        if not max_date_row or not max_date_row["max_date"]:
            raise ValueError("当前没有可用于财富总览的数据")

        latest_available = parse_iso_date(max_date_row["max_date"], "max_date")
        requested_as_of = parse_iso_date(as_of_raw, "as_of") if as_of_raw else latest_available
        effective_as_of = min(requested_as_of, latest_available)
        as_of = effective_as_of.isoformat()

        investment_rows = conn.execute(
            """
            SELECT
                r.account_id,
                COALESCE(a.name, r.account_id) AS account_name,
                r.snapshot_date,
                r.total_assets_cents AS value_cents
            FROM investment_records r
            JOIN (
                SELECT account_id, MAX(snapshot_date) AS snapshot_date
                FROM investment_records
                WHERE snapshot_date <= ? AND total_assets_cents > 0
                GROUP BY account_id
            ) latest
              ON latest.account_id = r.account_id
             AND latest.snapshot_date = r.snapshot_date
            LEFT JOIN accounts a ON a.id = r.account_id
            ORDER BY value_cents DESC, account_name
            """,
            (as_of,),
        ).fetchall()

        asset_rows = conn.execute(
            """
            SELECT
                v.account_id,
                v.account_name,
                v.asset_class,
                v.snapshot_date,
                v.value_cents
            FROM account_valuations v
            JOIN (
                SELECT account_id, asset_class, MAX(snapshot_date) AS snapshot_date
                FROM account_valuations
                WHERE snapshot_date <= ?
                GROUP BY account_id, asset_class
            ) latest
              ON latest.account_id = v.account_id
             AND latest.asset_class = v.asset_class
             AND latest.snapshot_date = v.snapshot_date
            ORDER BY v.asset_class, v.value_cents DESC, v.account_name
            """,
            (as_of,),
        ).fetchall()
    finally:
        conn.close()

    investment_total = sum(int(row["value_cents"]) for row in investment_rows)
    cash_rows = [row for row in asset_rows if row["asset_class"] == "cash"]
    real_estate_rows = [row for row in asset_rows if row["asset_class"] == "real_estate"]
    liability_rows = [row for row in asset_rows if row["asset_class"] == "liability"]
    cash_total = sum(int(row["value_cents"]) for row in cash_rows)
    real_estate_total = sum(int(row["value_cents"]) for row in real_estate_rows)
    liability_total = sum(int(row["value_cents"]) for row in liability_rows)
    gross_assets_total = (
        (investment_total if include_investment else 0)
        + (cash_total if include_cash else 0)
        + (real_estate_total if include_real_estate else 0)
    )
    selected_liability_total = liability_total if include_liability else 0
    net_asset_total = gross_assets_total - selected_liability_total

    def fmt_rows(rows: list[sqlite3.Row], cls: str) -> list[dict[str, Any]]:
        result = []
        for row in rows:
            value_cents = int(row["value_cents"])
            snapshot_date = str(row["snapshot_date"])
            stale_days = (effective_as_of - parse_iso_date(snapshot_date, "snapshot_date")).days
            result.append(
                {
                    "asset_class": cls,
                    "account_id": row["account_id"],
                    "account_name": row["account_name"],
                    "snapshot_date": snapshot_date,
                    "value_cents": value_cents,
                    "value_yuan": cents_to_yuan_text(value_cents),
                    "stale_days": stale_days,
                }
            )
        return result

    investment_items = fmt_rows(investment_rows, "investment")
    cash_items = fmt_rows(cash_rows, "cash")
    real_estate_items = fmt_rows(real_estate_rows, "real_estate")
    liability_items = fmt_rows(liability_rows, "liability")
    selected_rows = (
        (investment_items if include_investment else [])
        + (cash_items if include_cash else [])
        + (real_estate_items if include_real_estate else [])
        + (liability_items if include_liability else [])
    )
    selected_rows_assets_total_cents = sum(
        int(row["value_cents"]) for row in selected_rows if str(row["asset_class"]) != "liability"
    )
    selected_rows_liability_total_cents = sum(
        int(row["value_cents"]) for row in selected_rows if str(row["asset_class"]) == "liability"
    )
    selected_rows_total_cents = selected_rows_assets_total_cents - selected_rows_liability_total_cents
    reconciliation_delta_cents = selected_rows_total_cents - net_asset_total
    stale_account_count = sum(1 for row in selected_rows if int(row.get("stale_days") or 0) > 0)

    return {
        "as_of": as_of,
        "requested_as_of": requested_as_of.isoformat(),
        "filters": {
            "include_investment": include_investment,
            "include_cash": include_cash,
            "include_real_estate": include_real_estate,
            "include_liability": include_liability,
        },
        "summary": {
            "investment_total_cents": investment_total,
            "investment_total_yuan": cents_to_yuan_text(investment_total),
            "cash_total_cents": cash_total,
            "cash_total_yuan": cents_to_yuan_text(cash_total),
            "real_estate_total_cents": real_estate_total,
            "real_estate_total_yuan": cents_to_yuan_text(real_estate_total),
            "liability_total_cents": liability_total,
            "liability_total_yuan": cents_to_yuan_text(liability_total),
            "wealth_total_cents": gross_assets_total,
            "wealth_total_yuan": cents_to_yuan_text(gross_assets_total),
            "gross_assets_total_cents": gross_assets_total,
            "gross_assets_total_yuan": cents_to_yuan_text(gross_assets_total),
            "net_asset_total_cents": net_asset_total,
            "net_asset_total_yuan": cents_to_yuan_text(net_asset_total),
            "selected_rows_total_cents": selected_rows_total_cents,
            "selected_rows_total_yuan": cents_to_yuan_text(selected_rows_total_cents),
            "selected_rows_assets_total_cents": selected_rows_assets_total_cents,
            "selected_rows_assets_total_yuan": cents_to_yuan_text(selected_rows_assets_total_cents),
            "selected_rows_liability_total_cents": selected_rows_liability_total_cents,
            "selected_rows_liability_total_yuan": cents_to_yuan_text(selected_rows_liability_total_cents),
            "reconciliation_delta_cents": reconciliation_delta_cents,
            "reconciliation_delta_yuan": cents_to_yuan_text(reconciliation_delta_cents),
            "reconciliation_ok": reconciliation_delta_cents == 0,
            "stale_account_count": stale_account_count,
        },
        "rows": selected_rows,
    }


def query_wealth_curve(config: AppConfig, qs: dict[str, list[str]]) -> dict[str, Any]:
    preset = parse_preset((qs.get("preset") or ["1y"])[0])
    from_raw = (qs.get("from") or [""])[0].strip()
    to_raw = (qs.get("to") or [""])[0].strip()
    include_investment = parse_bool_param((qs.get("include_investment") or [""])[0], default=True)
    include_cash = parse_bool_param((qs.get("include_cash") or [""])[0], default=True)
    include_real_estate = parse_bool_param((qs.get("include_real_estate") or [""])[0], default=True)
    include_liability = parse_bool_param((qs.get("include_liability") or [""])[0], default=True)
    if not (include_investment or include_cash or include_real_estate or include_liability):
        raise ValueError("至少需要选择一个资产类型")

    conn = sqlite3.connect(config.db_path)
    conn.row_factory = sqlite3.Row
    try:
        bounds_row = conn.execute(
            """
            SELECT
                MIN(snapshot_date) AS min_date,
                MAX(snapshot_date) AS max_date
            FROM (
                SELECT snapshot_date FROM investment_records
                UNION ALL
                SELECT snapshot_date FROM account_valuations
            )
            """
        ).fetchone()
        if not bounds_row or not bounds_row["max_date"]:
            raise ValueError("当前没有可用于曲线展示的数据")

        earliest = parse_iso_date(bounds_row["min_date"], "min_date")
        latest = parse_iso_date(bounds_row["max_date"], "max_date")
        requested_from, effective_from, effective_to = resolve_window(
            preset=preset,
            from_raw=from_raw,
            to_raw=to_raw,
            earliest=earliest,
            latest=latest,
        )

        date_rows = conn.execute(
            """
            SELECT snapshot_date
            FROM (
                SELECT snapshot_date FROM investment_records WHERE snapshot_date >= ? AND snapshot_date <= ?
                UNION
                SELECT snapshot_date
                FROM account_valuations
                WHERE snapshot_date >= ? AND snapshot_date <= ?
            )
            ORDER BY snapshot_date ASC
            """,
            (
                effective_from.isoformat(),
                effective_to.isoformat(),
                effective_from.isoformat(),
                effective_to.isoformat(),
            ),
        ).fetchall()

        date_set = {row["snapshot_date"] for row in date_rows}
        date_set.add(effective_from.isoformat())
        date_set.add(effective_to.isoformat())
        dates = sorted(date_set)

        investment_history = conn.execute(
            """
            SELECT
                account_id,
                snapshot_date,
                total_assets_cents AS value_cents,
                transfer_amount_cents AS flow_cents
            FROM investment_records
            WHERE snapshot_date <= ?
            ORDER BY account_id, snapshot_date
            """,
            (effective_to.isoformat(),),
        ).fetchall()

        cash_history = conn.execute(
            """
            SELECT account_id, snapshot_date, value_cents
            FROM account_valuations
            WHERE asset_class = 'cash' AND snapshot_date <= ?
            ORDER BY account_id, snapshot_date
            """,
            (effective_to.isoformat(),),
        ).fetchall()

        real_estate_history = conn.execute(
            """
            SELECT account_id, snapshot_date, value_cents
            FROM account_valuations
            WHERE asset_class = 'real_estate' AND snapshot_date <= ?
            ORDER BY account_id, snapshot_date
            """,
            (effective_to.isoformat(),),
        ).fetchall()
        liability_history = conn.execute(
            """
            SELECT account_id, snapshot_date, value_cents
            FROM account_valuations
            WHERE asset_class = 'liability' AND snapshot_date <= ?
            ORDER BY account_id, snapshot_date
            """,
            (effective_to.isoformat(),),
        ).fetchall()
    finally:
        conn.close()

    investment_totals = build_asof_totals(dates=dates, history_rows=investment_history)
    cash_totals = build_asof_totals(dates=dates, history_rows=cash_history)
    real_estate_totals = build_asof_totals(dates=dates, history_rows=real_estate_history)
    liability_totals = build_asof_totals(dates=dates, history_rows=liability_history)

    rows: list[dict[str, Any]] = []
    first_investment_total = 0
    first_cash_total = 0
    first_real_estate_total = 0
    first_liability_total = 0
    first_wealth_total = 0
    first_net_asset_total = 0
    for d in dates:
        inv = investment_totals[d]
        cash = cash_totals[d]
        re = real_estate_totals[d]
        liability = liability_totals[d]
        wealth = (
            (inv if include_investment else 0)
            + (cash if include_cash else 0)
            + (re if include_real_estate else 0)
        )
        selected_liability = liability if include_liability else 0
        net_asset = wealth - selected_liability
        if not rows:
            first_investment_total = inv
            first_cash_total = cash
            first_real_estate_total = re
            first_liability_total = liability
            first_wealth_total = wealth
            first_net_asset_total = net_asset
        wealth_net_growth_cents = wealth - first_wealth_total
        liability_net_growth_cents = liability - first_liability_total
        net_asset_net_growth_cents = net_asset - first_net_asset_total
        investment_net_growth_cents = inv - first_investment_total
        cash_net_growth_cents = cash - first_cash_total
        real_estate_net_growth_cents = re - first_real_estate_total
        rows.append(
            {
                "snapshot_date": d,
                "investment_total_cents": inv,
                "cash_total_cents": cash,
                "real_estate_total_cents": re,
                "liability_total_cents": liability,
                "wealth_total_cents": wealth,
                "wealth_total_yuan": cents_to_yuan_text(wealth),
                "net_asset_total_cents": net_asset,
                "net_asset_total_yuan": cents_to_yuan_text(net_asset),
                "wealth_net_growth_cents": wealth_net_growth_cents,
                "wealth_net_growth_yuan": cents_to_yuan_text(wealth_net_growth_cents),
                "liability_net_growth_cents": liability_net_growth_cents,
                "net_asset_net_growth_cents": net_asset_net_growth_cents,
                "investment_net_growth_cents": investment_net_growth_cents,
                "cash_net_growth_cents": cash_net_growth_cents,
                "real_estate_net_growth_cents": real_estate_net_growth_cents,
            }
        )

    first_total = rows[0]["wealth_total_cents"] if rows else 0
    last_total = rows[-1]["wealth_total_cents"] if rows else 0
    change_cents = last_total - first_total
    change_pct = (change_cents / first_total) if first_total > 0 else None
    start_liability_cents = rows[0]["liability_total_cents"] if rows else 0
    end_liability_cents = rows[-1]["liability_total_cents"] if rows else 0
    liability_total_change_cents = end_liability_cents - start_liability_cents
    liability_change_pct = (
        liability_total_change_cents / start_liability_cents if start_liability_cents > 0 else None
    )
    start_net_asset_cents = rows[0]["net_asset_total_cents"] if rows else 0
    end_net_asset_cents = rows[-1]["net_asset_total_cents"] if rows else 0
    net_asset_change_cents = end_net_asset_cents - start_net_asset_cents
    net_asset_change_pct = net_asset_change_cents / start_net_asset_cents if start_net_asset_cents > 0 else None
    start_investment_cents = rows[0]["investment_total_cents"] if rows else 0
    end_investment_cents = rows[-1]["investment_total_cents"] if rows else 0
    investment_net_growth_cents = end_investment_cents - start_investment_cents
    investment_change_pct = (
        investment_net_growth_cents / start_investment_cents if start_investment_cents > 0 else None
    )
    start_cash_cents = rows[0]["cash_total_cents"] if rows else 0
    end_cash_cents = rows[-1]["cash_total_cents"] if rows else 0
    cash_net_growth_cents = end_cash_cents - start_cash_cents
    cash_change_pct = cash_net_growth_cents / start_cash_cents if start_cash_cents > 0 else None
    start_real_estate_cents = rows[0]["real_estate_total_cents"] if rows else 0
    end_real_estate_cents = rows[-1]["real_estate_total_cents"] if rows else 0
    real_estate_net_growth_cents = end_real_estate_cents - start_real_estate_cents
    real_estate_change_pct = (
        real_estate_net_growth_cents / start_real_estate_cents if start_real_estate_cents > 0 else None
    )

    return {
        "range": {
            "preset": preset,
            "requested_from": requested_from.isoformat(),
            "requested_to": parse_iso_date(to_raw, "to").isoformat() if to_raw else latest.isoformat(),
            "effective_from": rows[0]["snapshot_date"] if rows else effective_from.isoformat(),
            "effective_to": rows[-1]["snapshot_date"] if rows else effective_to.isoformat(),
            "points": len(rows),
        },
        "filters": {
            "include_investment": include_investment,
            "include_cash": include_cash,
            "include_real_estate": include_real_estate,
            "include_liability": include_liability,
        },
        "summary": {
            "start_wealth_cents": first_total,
            "start_wealth_yuan": cents_to_yuan_text(first_total),
            "end_wealth_cents": last_total,
            "end_wealth_yuan": cents_to_yuan_text(last_total),
            "change_cents": change_cents,
            "change_yuan": cents_to_yuan_text(change_cents),
            "net_growth_cents": change_cents,
            "net_growth_yuan": cents_to_yuan_text(change_cents),
            "change_pct": round(change_pct, 8) if change_pct is not None else None,
            "change_pct_text": f"{change_pct * 100:.2f}%" if change_pct is not None else None,
            "start_liability_cents": start_liability_cents,
            "start_liability_yuan": cents_to_yuan_text(start_liability_cents),
            "end_liability_cents": end_liability_cents,
            "end_liability_yuan": cents_to_yuan_text(end_liability_cents),
            "liability_net_growth_cents": liability_total_change_cents,
            "liability_net_growth_yuan": cents_to_yuan_text(liability_total_change_cents),
            "liability_change_pct": round(liability_change_pct, 8) if liability_change_pct is not None else None,
            "liability_change_pct_text": (
                f"{liability_change_pct * 100:.2f}%" if liability_change_pct is not None else None
            ),
            "start_net_asset_cents": start_net_asset_cents,
            "start_net_asset_yuan": cents_to_yuan_text(start_net_asset_cents),
            "end_net_asset_cents": end_net_asset_cents,
            "end_net_asset_yuan": cents_to_yuan_text(end_net_asset_cents),
            "net_asset_change_cents": net_asset_change_cents,
            "net_asset_change_yuan": cents_to_yuan_text(net_asset_change_cents),
            "net_asset_net_growth_cents": net_asset_change_cents,
            "net_asset_net_growth_yuan": cents_to_yuan_text(net_asset_change_cents),
            "net_asset_change_pct": round(net_asset_change_pct, 8) if net_asset_change_pct is not None else None,
            "net_asset_change_pct_text": (
                f"{net_asset_change_pct * 100:.2f}%" if net_asset_change_pct is not None else None
            ),
            "start_investment_cents": start_investment_cents,
            "start_investment_yuan": cents_to_yuan_text(start_investment_cents),
            "end_investment_cents": end_investment_cents,
            "end_investment_yuan": cents_to_yuan_text(end_investment_cents),
            "investment_net_growth_cents": investment_net_growth_cents,
            "investment_net_growth_yuan": cents_to_yuan_text(investment_net_growth_cents),
            "investment_change_pct": round(investment_change_pct, 8) if investment_change_pct is not None else None,
            "investment_change_pct_text": (
                f"{investment_change_pct * 100:.2f}%" if investment_change_pct is not None else None
            ),
            "start_cash_cents": start_cash_cents,
            "start_cash_yuan": cents_to_yuan_text(start_cash_cents),
            "end_cash_cents": end_cash_cents,
            "end_cash_yuan": cents_to_yuan_text(end_cash_cents),
            "cash_net_growth_cents": cash_net_growth_cents,
            "cash_net_growth_yuan": cents_to_yuan_text(cash_net_growth_cents),
            "cash_change_pct": round(cash_change_pct, 8) if cash_change_pct is not None else None,
            "cash_change_pct_text": f"{cash_change_pct * 100:.2f}%" if cash_change_pct is not None else None,
            "start_real_estate_cents": start_real_estate_cents,
            "start_real_estate_yuan": cents_to_yuan_text(start_real_estate_cents),
            "end_real_estate_cents": end_real_estate_cents,
            "end_real_estate_yuan": cents_to_yuan_text(end_real_estate_cents),
            "real_estate_net_growth_cents": real_estate_net_growth_cents,
            "real_estate_net_growth_yuan": cents_to_yuan_text(real_estate_net_growth_cents),
            "real_estate_change_pct": round(real_estate_change_pct, 8) if real_estate_change_pct is not None else None,
            "real_estate_change_pct_text": (
                f"{real_estate_change_pct * 100:.2f}%" if real_estate_change_pct is not None else None
            ),
        },
        "rows": rows,
    }


def query_transactions(config: AppConfig, qs: dict[str, list[str]]) -> dict[str, Any]:
    limit = min(max(int((qs.get("limit") or ["100"])[0] or "100"), 1), 500)
    month_key = (qs.get("month_key") or [""])[0].strip()
    source_type = (qs.get("source_type") or [""])[0].strip()
    account_id = (qs.get("account_id") or [""])[0].strip()
    keyword = (qs.get("keyword") or [""])[0].strip()

    conditions: list[str] = []
    params: list[Any] = []
    if month_key:
        conditions.append("t.month_key = ?")
        params.append(month_key)
    if source_type:
        conditions.append("t.source_type = ?")
        params.append(source_type)
    if account_id:
        conditions.append("t.account_id = ?")
        params.append(account_id)
    if keyword:
        conditions.append("(description LIKE ? OR merchant_normalized LIKE ? OR COALESCE(c.name, '') LIKE ?)")
        params.extend([f"%{keyword}%", f"%{keyword}%", f"%{keyword}%"])

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    conn = sqlite3.connect(config.db_path)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            f"""
            SELECT
                t.posted_at,
                t.occurred_at,
                t.merchant_normalized,
                t.description,
                t.amount_cents,
                t.statement_category,
                t.source_type,
                t.category_id,
                COALESCE(c.name, '待分类') AS expense_category
            FROM transactions t
            LEFT JOIN categories c ON c.id = t.category_id
            {where}
            ORDER BY COALESCE(t.posted_at, t.occurred_at) DESC, t.id DESC
            LIMIT ?
            """,
            [*params, limit],
        ).fetchall()

        summary_row = conn.execute(
            f"""
            SELECT COUNT(*) AS count, COALESCE(SUM(t.amount_cents), 0) AS total_cents
            FROM transactions t
            LEFT JOIN categories c ON c.id = t.category_id
            {where}
            """,
            params,
        ).fetchone()
    finally:
        conn.close()

    return {
        "summary": {
            "count": int(summary_row["count"]),
            "total_amount_cents": int(summary_row["total_cents"]),
            "total_amount_yuan": f"{int(summary_row['total_cents']) / 100:.2f}",
            "source_type": source_type,
        },
        "rows": [dict(r) for r in rows],
    }


def query_investments(config: AppConfig, qs: dict[str, list[str]]) -> dict[str, Any]:
    limit = min(max(int((qs.get("limit") or ["100"])[0] or "100"), 1), 500)
    date_from = (qs.get("from") or [""])[0].strip()
    date_to = (qs.get("to") or [""])[0].strip()
    source_type = (qs.get("source_type") or [""])[0].strip()
    account_id = (qs.get("account_id") or [""])[0].strip()

    conditions: list[str] = []
    params: list[Any] = []
    if date_from:
        conditions.append("r.snapshot_date >= ?")
        params.append(date_from)
    if date_to:
        conditions.append("r.snapshot_date <= ?")
        params.append(date_to)
    if source_type:
        conditions.append("r.source_type = ?")
        params.append(source_type)
    if account_id:
        conditions.append("r.account_id = ?")
        params.append(account_id)

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    conn = sqlite3.connect(config.db_path)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            f"""
            SELECT r.id, r.snapshot_date, r.account_id, a.name AS account_name, r.total_assets_cents,
                   r.transfer_amount_cents, r.source_type
            FROM investment_records r
            LEFT JOIN accounts a ON a.id = r.account_id
            {where}
            ORDER BY r.snapshot_date DESC, r.updated_at DESC
            LIMIT ?
            """,
            [*params, limit],
        ).fetchall()

        summary_row = conn.execute(
            f"""
            SELECT COUNT(*) AS count,
                   COALESCE(SUM(r.transfer_amount_cents), 0) AS net_flow_cents
            FROM investment_records r
            {where}
            """,
            params,
        ).fetchone()

        latest_row = conn.execute(
            f"""
            SELECT COALESCE(r.total_assets_cents, 0) AS total_assets_cents
            FROM investment_records r
            {where}
            ORDER BY r.snapshot_date DESC, r.updated_at DESC
            LIMIT 1
            """,
            params,
        ).fetchone()
    finally:
        conn.close()

    latest_assets = int(latest_row["total_assets_cents"]) if latest_row else 0
    net_flow = int(summary_row["net_flow_cents"])
    return {
        "summary": {
            "count": int(summary_row["count"]),
            "latest_total_assets_cents": latest_assets,
            "latest_total_assets_yuan": f"{latest_assets / 100:.2f}",
            "net_transfer_amount_cents": net_flow,
            "net_transfer_amount_yuan": f"{net_flow / 100:.2f}",
            "source_type": source_type,
        },
        "rows": [dict(r) for r in rows],
    }


class M0Handler(BaseHTTPRequestHandler):
    config: AppConfig
    session_store: SessionStore

    def log_message(self, fmt: str, *args: Any) -> None:
        return

    def _json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _text(self, status: int, content_type: str, content: str) -> None:
        body = content.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", f"{content_type}; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length > 0 else b"{}"
        return json.loads(raw.decode("utf-8"))

    def do_GET(self) -> None:  # noqa: N802
        try:
            parsed = urlparse(self.path)
            if parsed.path == "/":
                html = (self.config.assets_dir / "m0_app.html").read_text(encoding="utf-8")
                self._text(HTTPStatus.OK, "text/html", html)
                return
            if parsed.path in {"/rules", "/rules/"}:
                html = (self.config.assets_dir / "rules_admin.html").read_text(encoding="utf-8")
                self._text(HTTPStatus.OK, "text/html", html)
                return
            if parsed.path == "/assets/m0_app.css":
                css = (self.config.assets_dir / "m0_app.css").read_text(encoding="utf-8")
                self._text(HTTPStatus.OK, "text/css", css)
                return
            if parsed.path == "/assets/rules_admin.css":
                css = (self.config.assets_dir / "rules_admin.css").read_text(encoding="utf-8")
                self._text(HTTPStatus.OK, "text/css", css)
                return
            if parsed.path == "/api/health":
                self._json(HTTPStatus.OK, {"ok": True, "time": datetime.now().isoformat(timespec="seconds")})
                return
            if parsed.path == "/api/admin/db-stats":
                payload = query_admin_db_stats(self.config)
                self._json(HTTPStatus.OK, payload)
                return
            if parsed.path == "/api/rules/merchant-map":
                payload = query_merchant_map_rules(self.config, parse_qs(parsed.query))
                self._json(HTTPStatus.OK, payload)
                return
            if parsed.path == "/api/rules/category-rules":
                payload = query_category_rules(self.config, parse_qs(parsed.query))
                self._json(HTTPStatus.OK, payload)
                return
            if parsed.path == "/api/rules/merchant-suggestions":
                payload = query_merchant_rule_suggestions(self.config, parse_qs(parsed.query))
                self._json(HTTPStatus.OK, payload)
                return
            if parsed.path == "/api/query/transactions":
                payload = query_transactions(self.config, parse_qs(parsed.query))
                self._json(HTTPStatus.OK, payload)
                return
            if parsed.path == "/api/query/investments":
                payload = query_investments(self.config, parse_qs(parsed.query))
                self._json(HTTPStatus.OK, payload)
                return
            if parsed.path == "/api/query/assets":
                payload = query_asset_valuations(self.config, parse_qs(parsed.query))
                self._json(HTTPStatus.OK, payload)
                return
            if parsed.path == "/api/meta/accounts":
                payload = query_accounts(self.config, parse_qs(parsed.query))
                self._json(HTTPStatus.OK, payload)
                return
            if parsed.path == "/api/accounts/catalog":
                payload = query_account_catalog(self.config, parse_qs(parsed.query))
                self._json(HTTPStatus.OK, payload)
                return
            if parsed.path == "/api/analytics/investment-return":
                payload = query_investment_return(self.config, parse_qs(parsed.query))
                self._json(HTTPStatus.OK, payload)
                return
            if parsed.path == "/api/analytics/investment-returns":
                payload = query_investment_returns(self.config, parse_qs(parsed.query))
                self._json(HTTPStatus.OK, payload)
                return
            if parsed.path == "/api/analytics/investment-curve":
                payload = query_investment_curve(self.config, parse_qs(parsed.query))
                self._json(HTTPStatus.OK, payload)
                return
            if parsed.path == "/api/analytics/wealth-overview":
                payload = query_wealth_overview(self.config, parse_qs(parsed.query))
                self._json(HTTPStatus.OK, payload)
                return
            if parsed.path == "/api/analytics/wealth-curve":
                payload = query_wealth_curve(self.config, parse_qs(parsed.query))
                self._json(HTTPStatus.OK, payload)
                return
            self._json(HTTPStatus.NOT_FOUND, {"error": f"未找到路径: {parsed.path}"})
        except Exception as exc:
            self._json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(exc)})

    def do_POST(self) -> None:  # noqa: N802
        try:
            if self.path == "/api/eml/preview":
                body = self._read_json()
                files = body.get("files") or []
                if not isinstance(files, list) or not files:
                    raise ValueError("请上传至少一个 EML 文件")
                review_threshold = float(body.get("review_threshold", 0.70))
                session = self.session_store.create_eml_session(files)
                summary = preview_eml(self.config, session.input_dir or Path("."), review_threshold)
                self._json(HTTPStatus.OK, {"preview_token": session.token, "summary": summary})
                return

            if self.path == "/api/eml/import":
                body = self._read_json()
                token = str(body.get("preview_token", "")).strip()
                review_threshold = float(body.get("review_threshold", 0.70))
                session = self.session_store.get(token, kind="eml")
                result = run_eml_import(self.config, session.input_dir or Path("."), review_threshold)
                self._json(HTTPStatus.OK, result)
                return

            if self.path == "/api/yzxy/preview":
                body = self._read_json()
                item = body.get("file")
                if not isinstance(item, dict):
                    raise ValueError("请上传有知有行导出文件")
                session = self.session_store.create_single_file_session(
                    "yzxy",
                    item,
                    (".csv", ".xlsx"),
                )
                preview = yzxy_import_mod.preview_file(session.file_path or Path("."))
                self._json(HTTPStatus.OK, {"preview_token": session.token, "preview": preview})
                return

            if self.path == "/api/yzxy/import":
                body = self._read_json()
                token = str(body.get("preview_token", "")).strip()
                session = self.session_store.get(token, kind="yzxy")
                ensure_db(self.config)
                imported_count, error_count, import_job_id = yzxy_import_mod.import_file(
                    self.config.db_path,
                    session.file_path or Path("."),
                )
                self._json(
                    HTTPStatus.OK,
                    {
                        "imported_count": imported_count,
                        "error_count": error_count,
                        "import_job_id": import_job_id,
                        "db_path": str(self.config.db_path),
                    },
                )
                return

            if self.path == "/api/investments/manual":
                body = self._read_json()
                payload = upsert_manual_investment(self.config, body)
                self._json(HTTPStatus.OK, payload)
                return

            if self.path == "/api/investments/update":
                body = self._read_json()
                payload = update_investment_record(self.config, body)
                self._json(HTTPStatus.OK, payload)
                return

            if self.path == "/api/investments/delete":
                body = self._read_json()
                payload = delete_investment_record(self.config, body)
                self._json(HTTPStatus.OK, payload)
                return

            if self.path == "/api/assets/manual":
                body = self._read_json()
                payload = upsert_manual_asset_valuation(self.config, body)
                self._json(HTTPStatus.OK, payload)
                return

            if self.path == "/api/assets/update":
                body = self._read_json()
                payload = update_asset_valuation(self.config, body)
                self._json(HTTPStatus.OK, payload)
                return

            if self.path == "/api/assets/delete":
                body = self._read_json()
                payload = delete_asset_valuation(self.config, body)
                self._json(HTTPStatus.OK, payload)
                return

            if self.path == "/api/accounts/upsert":
                body = self._read_json()
                payload = upsert_account_catalog_entry(self.config, body)
                self._json(HTTPStatus.OK, payload)
                return

            if self.path == "/api/accounts/delete":
                body = self._read_json()
                payload = delete_account_catalog_entry(self.config, body)
                self._json(HTTPStatus.OK, payload)
                return

            if self.path == "/api/admin/reset-db":
                body = self._read_json()
                confirm_text = str(body.get("confirm_text", "")).strip()
                clear_sessions = parse_bool_param(str(body.get("clear_import_sessions", "true")), default=True)
                payload = reset_admin_db_data(self.config, confirm_text=confirm_text)
                if clear_sessions:
                    payload["cleared_preview_sessions"] = self.session_store.clear_all()
                else:
                    payload["cleared_preview_sessions"] = 0
                payload["clear_import_sessions"] = clear_sessions
                self._json(HTTPStatus.OK, payload)
                return

            if self.path == "/api/rules/merchant-map/upsert":
                body = self._read_json()
                payload = upsert_merchant_map_rule(self.config, body)
                self._json(HTTPStatus.OK, payload)
                return

            if self.path == "/api/rules/merchant-map/delete":
                body = self._read_json()
                payload = delete_merchant_map_rule(self.config, body)
                self._json(HTTPStatus.OK, payload)
                return

            if self.path == "/api/rules/category-rules/upsert":
                body = self._read_json()
                payload = upsert_category_rule(self.config, body)
                self._json(HTTPStatus.OK, payload)
                return

            if self.path == "/api/rules/category-rules/delete":
                body = self._read_json()
                payload = delete_category_rule(self.config, body)
                self._json(HTTPStatus.OK, payload)
                return

            self._json(HTTPStatus.NOT_FOUND, {"error": f"未找到路径: {self.path}"})
        except KeyError as exc:
            self._json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
        except ValueError as exc:
            self._json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
        except Exception as exc:
            trace = traceback.format_exc(limit=4)
            self._json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(exc), "trace": trace})


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run KeepWise M0 local web app")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=8081, type=int)
    parser.add_argument("--root", default=Path("."), type=Path)
    return parser.parse_args()


def build_config(root: Path) -> AppConfig:
    root_dir = root.resolve()
    work_dir = root_dir / "data" / "work" / "processed"
    return AppConfig(
        root_dir=root_dir,
        work_dir=work_dir,
        rules_dir=root_dir / "data" / "rules",
        db_path=work_dir / "ledger" / "keepwise.db",
        migrations_dir=root_dir / "db" / "migrations",
        assets_dir=root_dir / "scripts" / "assets",
        session_dir=work_dir / "import_sessions",
    )


def main() -> None:
    args = parse_args()
    config = build_config(args.root)
    ensure_db(config)
    session_store = SessionStore(config.session_dir)

    class BoundHandler(M0Handler):
        pass

    BoundHandler.config = config
    BoundHandler.session_store = session_store

    server = ThreadingHTTPServer((args.host, args.port), BoundHandler)
    print(f"M0 app running: http://{args.host}:{args.port}")
    print(f"Database: {config.db_path}")
    server.serve_forever()


if __name__ == "__main__":
    main()
