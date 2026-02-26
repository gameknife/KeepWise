#!/usr/bin/env python3
"""Local web app for imports, investment analytics, wealth overview, and basic queries."""

from __future__ import annotations

import argparse
import base64
import json
import math
import secrets
import shutil
import sqlite3
import sys
import traceback
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import import_classified_to_ledger as ledger_import_mod
import import_cmb_bank_pdf_transactions as cmb_bank_pdf_import_mod
import import_youzhiyouxing_investments as yzxy_import_mod
import migrate_ledger_db as migrate_mod
import http_route_tables as http_routes
import investment_analytics_service as investment_service
import budget_fire_analytics_service as budget_fire_service
import rules_service as rules_service
import wealth_analytics_service as wealth_service
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
SUPPORTED_PRESETS = investment_service.SUPPORTED_PRESETS
PORTFOLIO_ACCOUNT_ID = investment_service.PORTFOLIO_ACCOUNT_ID
PORTFOLIO_ACCOUNT_NAME = investment_service.PORTFOLIO_ACCOUNT_NAME
ADMIN_RESET_CONFIRM_PHRASE = "RESET KEEPWISE"
ADMIN_DATA_TABLES = [
    "transactions",
    "reconciliations",
    "investment_records",
    "account_valuations",
    "monthly_budget_items",
    "assets",
    "budgets",
    "ai_suggestions",
    "import_jobs",
    "categories",
    "accounts",
]
TRANSACTION_IMPORT_SOURCE_TYPES = ("cmb_eml", "cmb_bank_pdf")
MANUAL_TX_EXCLUDE_REASON_PREFIX = ledger_import_mod.MANUAL_TX_EXCLUDE_REASON_PREFIX
ADMIN_TRANSACTION_RESET_SCOPES = (
    "transactions",
    "reconciliations",
    "import_jobs:transaction_sources",
)


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


def cents_to_yuan_value(cents: int) -> float:
    return round(cents / 100.0, 2)


def parse_bool_param(raw: str, *, default: bool) -> bool:
    text = (raw or "").strip().lower()
    if not text:
        return default
    if text in {"1", "true", "yes", "y", "on"}:
        return True
    if text in {"0", "false", "no", "n", "off"}:
        return False
    raise ValueError(f"布尔参数不合法: {raw}")


def parse_year_param(raw: str | None, *, default_year: int) -> int:
    text = (raw or "").strip()
    if not text:
        return int(default_year)
    try:
        value = int(text)
    except ValueError as exc:
        raise ValueError("year 必须是整数年份") from exc
    if value < 2000 or value > 2100:
        raise ValueError("year 超出支持范围（2000-2100）")
    return value


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


def build_admin_transaction_scope_counts(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    tx_count = int(conn.execute("SELECT COUNT(*) FROM transactions").fetchone()[0])
    rows.append({"table": "transactions", "row_count": tx_count})

    reconciliations_exists = bool(
        conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='reconciliations' LIMIT 1"
        ).fetchone()
    )
    if reconciliations_exists:
        rec_count = int(conn.execute("SELECT COUNT(*) FROM reconciliations").fetchone()[0])
        rows.append({"table": "reconciliations", "row_count": rec_count})

    import_jobs_exists = bool(
        conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='import_jobs' LIMIT 1"
        ).fetchone()
    )
    if import_jobs_exists:
        cmb_jobs_count = int(
            conn.execute(
                "SELECT COUNT(*) FROM import_jobs WHERE source_type IN (?, ?)",
                TRANSACTION_IMPORT_SOURCE_TYPES,
            ).fetchone()[0]
        )
        rows.append({"table": "import_jobs(transaction_sources)", "row_count": cmb_jobs_count})
    return rows


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


def reset_admin_transaction_data(config: AppConfig, *, confirm_text: str) -> dict[str, Any]:
    ensure_db(config)
    if (confirm_text or "").strip() != ADMIN_RESET_CONFIRM_PHRASE:
        raise ValueError(f"confirm_text 不正确，请输入: {ADMIN_RESET_CONFIRM_PHRASE}")

    conn = sqlite3.connect(config.db_path)
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        before_rows = build_admin_transaction_scope_counts(conn)
        with conn:
            conn.execute("DELETE FROM transactions")
            # Reconciliations may already be deleted via FK cascade from transactions, but execute
            # explicitly for schema compatibility if cascade behavior changes.
            if conn.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='reconciliations' LIMIT 1"
            ).fetchone():
                conn.execute("DELETE FROM reconciliations")
            if conn.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='import_jobs' LIMIT 1"
            ).fetchone():
                conn.execute(
                    "DELETE FROM import_jobs WHERE source_type IN (?, ?)",
                    TRANSACTION_IMPORT_SOURCE_TYPES,
                )
        after_rows = build_admin_transaction_scope_counts(conn)
    finally:
        conn.close()

    before_map = {row["table"]: int(row["row_count"]) for row in before_rows}
    after_map = {row["table"]: int(row["row_count"]) for row in after_rows}
    deleted_rows = sum(before_map.get(name, 0) - after_map.get(name, 0) for name in before_map)

    return {
        "db_path": str(config.db_path),
        "confirm_phrase": ADMIN_RESET_CONFIRM_PHRASE,
        "scopes": list(ADMIN_TRANSACTION_RESET_SCOPES),
        "summary": {
            "scope_count": len(before_rows),
            "total_rows_before": sum(before_map.values()),
            "total_rows_after": sum(after_map.values()),
            "deleted_rows": deleted_rows,
        },
        "before_rows": before_rows,
        "after_rows": after_rows,
    }


ensure_rules_files = rules_service.ensure_rules_files
load_bank_transfer_whitelist_names = rules_service.load_bank_transfer_whitelist_names
query_merchant_map_rules = rules_service.query_merchant_map_rules
upsert_merchant_map_rule = rules_service.upsert_merchant_map_rule
delete_merchant_map_rule = rules_service.delete_merchant_map_rule
query_category_rules = rules_service.query_category_rules
upsert_category_rule = rules_service.upsert_category_rule
delete_category_rule = rules_service.delete_category_rule
query_bank_transfer_whitelist_rules = rules_service.query_bank_transfer_whitelist_rules
upsert_bank_transfer_whitelist_rule = rules_service.upsert_bank_transfer_whitelist_rule
delete_bank_transfer_whitelist_rule = rules_service.delete_bank_transfer_whitelist_rule
query_merchant_rule_suggestions = rules_service.query_merchant_rule_suggestions


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
        replace_existing_source_transactions=False,
    )

    return {
        "parse_result": parse_result,
        "imported_count": imported_count,
        "import_error_count": import_error_count,
        "import_job_id": import_job_id,
        "db_path": str(config.db_path),
    }


def preview_cmb_bank_pdf(config: AppConfig, pdf_path: Path) -> dict[str, Any]:
    merchant_map_path, category_rules_path, _ = ensure_rules_files(config)
    merchant_map = parser_mod.load_merchant_map(merchant_map_path)
    category_rules = parser_mod.load_category_rules(category_rules_path)
    transfer_whitelist = load_bank_transfer_whitelist_names(config)
    preview = cmb_bank_pdf_import_mod.preview_file(
        pdf_path,
        transfer_whitelist=transfer_whitelist,
        merchant_map=merchant_map,
        category_rules=category_rules,
        review_threshold=0.70,
    )
    return preview


def run_cmb_bank_pdf_import(config: AppConfig, pdf_path: Path) -> dict[str, Any]:
    ensure_db(config)
    merchant_map_path, category_rules_path, _ = ensure_rules_files(config)
    merchant_map = parser_mod.load_merchant_map(merchant_map_path)
    category_rules = parser_mod.load_category_rules(category_rules_path)
    transfer_whitelist = load_bank_transfer_whitelist_names(config)
    imported_count, import_error_count, import_job_id, preview = cmb_bank_pdf_import_mod.import_file(
        config.db_path,
        pdf_path,
        source_type="cmb_bank_pdf",
        transfer_whitelist=transfer_whitelist,
        merchant_map=merchant_map,
        category_rules=category_rules,
        review_threshold=0.70,
    )
    return {
        "preview": preview,
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


def query_investment_return(config: AppConfig, qs: dict[str, list[str]]) -> dict[str, Any]:
    ensure_db(config)
    return investment_service.query_investment_return(config, qs)


def query_investment_returns(config: AppConfig, qs: dict[str, list[str]]) -> dict[str, Any]:
    ensure_db(config)
    return investment_service.query_investment_returns(config, qs)


def query_investment_curve(config: AppConfig, qs: dict[str, list[str]]) -> dict[str, Any]:
    ensure_db(config)
    return investment_service.query_investment_curve(config, qs)


def query_monthly_budget_items(config: AppConfig, qs: dict[str, list[str]]) -> dict[str, Any]:
    ensure_db(config)
    return budget_fire_service.query_monthly_budget_items(config, qs)


def upsert_monthly_budget_item(config: AppConfig, payload: dict[str, Any]) -> dict[str, Any]:
    ensure_db(config)
    return budget_fire_service.upsert_monthly_budget_item(config, payload)


def delete_monthly_budget_item(config: AppConfig, payload: dict[str, Any]) -> dict[str, Any]:
    ensure_db(config)
    return budget_fire_service.delete_monthly_budget_item(config, payload)


def query_budget_overview(config: AppConfig, qs: dict[str, list[str]]) -> dict[str, Any]:
    ensure_db(config)
    return budget_fire_service.query_budget_overview(config, qs)


def query_budget_monthly_review(config: AppConfig, qs: dict[str, list[str]]) -> dict[str, Any]:
    ensure_db(config)
    return budget_fire_service.query_budget_monthly_review(config, qs)


def query_consumption_report(config: AppConfig, qs: dict[str, list[str]]) -> dict[str, Any]:
    ensure_db(config)
    return budget_fire_service.query_consumption_report(config, qs)


def query_salary_income_overview(config: AppConfig, qs: dict[str, list[str]]) -> dict[str, Any]:
    ensure_db(config)
    return budget_fire_service.query_salary_income_overview(config, qs)


def query_fire_progress(config: AppConfig, qs: dict[str, list[str]]) -> dict[str, Any]:
    ensure_db(config)
    return budget_fire_service.query_fire_progress(config, qs, wealth_overview_query=query_wealth_overview)


def query_wealth_overview(config: AppConfig, qs: dict[str, list[str]]) -> dict[str, Any]:
    ensure_db(config)
    return wealth_service.query_wealth_overview(config, qs)


def query_wealth_curve(config: AppConfig, qs: dict[str, list[str]]) -> dict[str, Any]:
    ensure_db(config)
    return wealth_service.query_wealth_curve(config, qs)


def query_transactions(config: AppConfig, qs: dict[str, list[str]]) -> dict[str, Any]:
    limit = min(max(int((qs.get("limit") or ["100"])[0] or "100"), 1), 500)
    month_key = (qs.get("month_key") or [""])[0].strip()
    source_type = (qs.get("source_type") or [""])[0].strip()
    account_id = (qs.get("account_id") or [""])[0].strip()
    keyword = (qs.get("keyword") or [""])[0].strip()
    sort_key = (qs.get("sort") or ["date_desc"])[0].strip() or "date_desc"
    sort_sql_map = {
        "date_desc": "COALESCE(t.posted_at, t.occurred_at) DESC, t.id DESC",
        "date_asc": "COALESCE(t.posted_at, t.occurred_at) ASC, t.id ASC",
        "amount_desc": "ABS(t.amount_cents) DESC, COALESCE(t.posted_at, t.occurred_at) DESC, t.id DESC",
        "amount_asc": "ABS(t.amount_cents) ASC, COALESCE(t.posted_at, t.occurred_at) DESC, t.id DESC",
    }
    if sort_key not in sort_sql_map:
        raise ValueError(f"sort 不支持: {sort_key}")

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
                t.id,
                t.posted_at,
                t.occurred_at,
                t.direction,
                t.merchant,
                t.merchant_normalized,
                t.description,
                t.amount_cents,
                t.statement_category,
                t.source_type,
                t.category_id,
                t.excluded_in_analysis,
                t.exclude_reason,
                COALESCE(c.name, '待分类') AS expense_category
            FROM transactions t
            LEFT JOIN categories c ON c.id = t.category_id
            {where}
            ORDER BY {sort_sql_map[sort_key]}
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

    result_rows: list[dict[str, Any]] = []
    excluded_count = 0
    excluded_total_cents = 0
    for row in rows:
        item = dict(row)
        excluded = bool(int(item.get("excluded_in_analysis") or 0))
        reason = str(item.get("exclude_reason") or "")
        manual_excluded = excluded and reason.startswith(MANUAL_TX_EXCLUDE_REASON_PREFIX)
        item["excluded_in_analysis"] = 1 if excluded else 0
        item["manual_excluded"] = manual_excluded
        if manual_excluded:
            item["manual_exclude_reason"] = reason[len(MANUAL_TX_EXCLUDE_REASON_PREFIX) :].lstrip(" :")
        else:
            item["manual_exclude_reason"] = ""
        result_rows.append(item)
        if excluded:
            excluded_count += 1
            excluded_total_cents += abs(int(item.get("amount_cents") or 0))

    return {
        "summary": {
            "count": int(summary_row["count"]),
            "total_amount_cents": int(summary_row["total_cents"]),
            "total_amount_yuan": f"{int(summary_row['total_cents']) / 100:.2f}",
            "source_type": source_type,
            "excluded_count_in_rows": excluded_count,
            "excluded_total_abs_cents_in_rows": excluded_total_cents,
            "excluded_total_abs_yuan_in_rows": f"{excluded_total_cents / 100:.2f}",
            "sort": sort_key,
        },
        "rows": result_rows,
    }


def update_transaction_analysis_exclusion(config: AppConfig, payload: dict[str, Any]) -> dict[str, Any]:
    ensure_db(config)
    tx_id = str(payload.get("id", "")).strip()
    if not tx_id:
        raise ValueError("id 必填")
    action = str(payload.get("action", "")).strip() or ("exclude" if bool(payload.get("excluded_in_analysis")) else "restore")
    if action not in {"exclude", "restore"}:
        raise ValueError("action 必须是 exclude 或 restore")
    user_reason = str(payload.get("reason", "")).strip()

    conn = sqlite3.connect(config.db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        row = conn.execute(
            """
            SELECT id, amount_cents, description, merchant_normalized, excluded_in_analysis, exclude_reason
            FROM transactions
            WHERE id = ?
            """,
            (tx_id,),
        ).fetchone()
        if not row:
            raise ValueError("未找到交易记录")

        current_excluded = bool(int(row["excluded_in_analysis"] or 0))
        current_reason = str(row["exclude_reason"] or "")
        current_manual = current_excluded and current_reason.startswith(MANUAL_TX_EXCLUDE_REASON_PREFIX)

        if action == "exclude":
            suffix = user_reason or "手动剔除（查询页）"
            new_reason = f"{MANUAL_TX_EXCLUDE_REASON_PREFIX} {suffix}"
            with conn:
                conn.execute(
                    """
                    UPDATE transactions
                    SET excluded_in_analysis = 1,
                        exclude_reason = ?,
                        updated_at = datetime('now')
                    WHERE id = ?
                    """,
                    (new_reason, tx_id),
                )
            excluded = True
            manual_excluded = True
            reason = new_reason
        else:
            if not current_manual:
                raise ValueError("该交易不是“手动剔除”状态，无法在此处恢复")
            with conn:
                conn.execute(
                    """
                    UPDATE transactions
                    SET excluded_in_analysis = 0,
                        exclude_reason = '',
                        updated_at = datetime('now')
                    WHERE id = ?
                    """,
                    (tx_id,),
                )
            excluded = False
            manual_excluded = False
            reason = ""
    finally:
        conn.close()

    return {
        "id": tx_id,
        "excluded_in_analysis": 1 if excluded else 0,
        "manual_excluded": manual_excluded,
        "exclude_reason": reason,
        "manual_exclude_reason": (
            reason[len(MANUAL_TX_EXCLUDE_REASON_PREFIX) :].lstrip(" :")
            if manual_excluded and reason.startswith(MANUAL_TX_EXCLUDE_REASON_PREFIX)
            else ""
        ),
        "action": action,
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


GET_PAGE_FILE_ROUTES = http_routes.build_get_page_file_routes()
GET_TEXT_ASSET_ROUTES = http_routes.build_get_text_asset_routes()
GET_API_ROUTES = http_routes.build_get_api_routes(
    query_admin_db_stats=query_admin_db_stats,
    query_merchant_map_rules=query_merchant_map_rules,
    query_category_rules=query_category_rules,
    query_bank_transfer_whitelist_rules=query_bank_transfer_whitelist_rules,
    query_merchant_rule_suggestions=query_merchant_rule_suggestions,
    query_transactions=query_transactions,
    query_investments=query_investments,
    query_asset_valuations=query_asset_valuations,
    query_accounts=query_accounts,
    query_account_catalog=query_account_catalog,
    query_monthly_budget_items=query_monthly_budget_items,
    query_investment_return=query_investment_return,
    query_investment_returns=query_investment_returns,
    query_investment_curve=query_investment_curve,
    query_wealth_overview=query_wealth_overview,
    query_wealth_curve=query_wealth_curve,
    query_budget_overview=query_budget_overview,
    query_budget_monthly_review=query_budget_monthly_review,
    query_consumption_report=query_consumption_report,
    query_salary_income_overview=query_salary_income_overview,
    query_fire_progress=query_fire_progress,
)
POST_API_ROUTES = http_routes.build_post_api_routes(
    preview_eml=preview_eml,
    run_eml_import=run_eml_import,
    yzxy_preview_file=yzxy_import_mod.preview_file,
    yzxy_import_file=yzxy_import_mod.import_file,
    preview_cmb_bank_pdf=preview_cmb_bank_pdf,
    run_cmb_bank_pdf_import=run_cmb_bank_pdf_import,
    ensure_db=ensure_db,
    parse_bool_param=parse_bool_param,
    upsert_manual_investment=upsert_manual_investment,
    update_investment_record=update_investment_record,
    delete_investment_record=delete_investment_record,
    upsert_manual_asset_valuation=upsert_manual_asset_valuation,
    update_asset_valuation=update_asset_valuation,
    delete_asset_valuation=delete_asset_valuation,
    update_transaction_analysis_exclusion=update_transaction_analysis_exclusion,
    upsert_monthly_budget_item=upsert_monthly_budget_item,
    delete_monthly_budget_item=delete_monthly_budget_item,
    upsert_account_catalog_entry=upsert_account_catalog_entry,
    delete_account_catalog_entry=delete_account_catalog_entry,
    reset_admin_db_data=reset_admin_db_data,
    reset_admin_transaction_data=reset_admin_transaction_data,
    upsert_merchant_map_rule=upsert_merchant_map_rule,
    delete_merchant_map_rule=delete_merchant_map_rule,
    upsert_category_rule=upsert_category_rule,
    delete_category_rule=delete_category_rule,
    upsert_bank_transfer_whitelist_rule=upsert_bank_transfer_whitelist_rule,
    delete_bank_transfer_whitelist_rule=delete_bank_transfer_whitelist_rule,
)


class KeepWiseHandler(BaseHTTPRequestHandler):
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
            page_route = GET_PAGE_FILE_ROUTES.get(parsed.path)
            if page_route:
                html = (self.config.assets_dir / page_route).read_text(encoding="utf-8")
                self._text(HTTPStatus.OK, "text/html", html)
                return

            asset_route = GET_TEXT_ASSET_ROUTES.get(parsed.path)
            if asset_route:
                filename, content_type = asset_route
                content = (self.config.assets_dir / filename).read_text(encoding="utf-8")
                self._text(HTTPStatus.OK, content_type, content)
                return

            api_route = GET_API_ROUTES.get(parsed.path)
            if api_route is not None:
                payload = api_route(self, parsed)
                self._json(HTTPStatus.OK, payload)
                return

            self._json(HTTPStatus.NOT_FOUND, {"error": f"未找到路径: {parsed.path}"})
        except Exception as exc:
            self._json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(exc)})

    def do_POST(self) -> None:  # noqa: N802
        try:
            route = POST_API_ROUTES.get(self.path)
            if route is not None:
                payload = route(self)
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
    parser = argparse.ArgumentParser(description="Run KeepWise local web app")
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
        assets_dir=root_dir / "apps" / "keepwise-legacy" / "scripts" / "assets",
        session_dir=work_dir / "import_sessions",
    )


def main() -> None:
    args = parse_args()
    config = build_config(args.root)
    ensure_db(config)
    session_store = SessionStore(config.session_dir)

    class BoundHandler(KeepWiseHandler):
        pass

    BoundHandler.config = config
    BoundHandler.session_store = session_store

    server = ThreadingHTTPServer((args.host, args.port), BoundHandler)
    print(f"KeepWise app running: http://{args.host}:{args.port}")
    print(f"Database: {config.db_path}")
    server.serve_forever()


if __name__ == "__main__":
    main()
