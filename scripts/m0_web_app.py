#!/usr/bin/env python3
"""Local web app for imports, investment analytics, wealth overview, and basic queries."""

from __future__ import annotations

import argparse
import base64
import json
import secrets
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


def ensure_db(config: AppConfig) -> None:
    migrate_mod.apply_migrations(config.db_path, config.migrations_dir)


SUPPORTED_PRESETS = {"ytd", "1y", "3y", "since_inception", "custom"}
SUPPORTED_ASSET_CLASSES = {"cash", "real_estate"}


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
    return f"acct_re_{suffix}"


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
    account_name = str(payload.get("account_name", "")).strip() or "手工投资账户"
    account_id = yzxy_import_mod.account_id_from_name(account_name)

    row = yzxy_import_mod.ParsedInvestmentRow(
        snapshot_date=snapshot_date,
        account_name=account_name,
        total_assets_cents=yzxy_import_mod.parse_amount_to_cents(str(payload.get("total_assets", "0"))),
        transfer_amount_cents=yzxy_import_mod.parse_amount_to_cents(str(payload.get("transfer_amount", "0"))),
    )
    if row.total_assets_cents <= 0:
        raise ValueError("总资产必须大于 0")

    conn = sqlite3.connect(config.db_path)
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yzxy_import_mod.ensure_schema_ready(conn)
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


def upsert_manual_asset_valuation(config: AppConfig, payload: dict[str, Any]) -> dict[str, Any]:
    ensure_db(config)
    asset_class = str(payload.get("asset_class", "")).strip().lower()
    if asset_class not in SUPPORTED_ASSET_CLASSES:
        raise ValueError("asset_class 必须是 cash 或 real_estate")

    snapshot_date = yzxy_import_mod.normalize_date(str(payload.get("snapshot_date", "")))
    default_name = "现金账户" if asset_class == "cash" else "不动产账户"
    account_name = str(payload.get("account_name", "")).strip() or default_name
    value_cents = yzxy_import_mod.parse_amount_to_cents(str(payload.get("value", "0")))
    if value_cents <= 0:
        raise ValueError("资产金额必须大于 0")

    account_id = account_id_from_asset_name(asset_class, account_name)
    account_type = "cash" if asset_class == "cash" else "other"
    record_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"{account_id}:{asset_class}:{snapshot_date}"))

    conn = sqlite3.connect(config.db_path)
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        ensure_asset_schema_ready(conn)
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


def query_accounts(config: AppConfig, qs: dict[str, list[str]]) -> dict[str, Any]:
    kind = (qs.get("kind") or ["all"])[0].strip().lower() or "all"
    if kind not in {"all", "investment", "cash", "real_estate"}:
        raise ValueError("kind 仅支持 all/investment/cash/real_estate")

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

    if kind == "investment":
        selected = investment_items
    elif kind == "cash":
        selected = cash_items
    elif kind == "real_estate":
        selected = real_estate_items
    else:
        selected = investment_items + cash_items + real_estate_items

    return {
        "kind": kind,
        "accounts": selected,
        "investment_accounts": investment_items,
        "cash_accounts": cash_items,
        "real_estate_accounts": real_estate_items,
    }


def query_asset_valuations(config: AppConfig, qs: dict[str, list[str]]) -> dict[str, Any]:
    limit = min(max(int((qs.get("limit") or ["100"])[0] or "100"), 1), 500)
    date_from = (qs.get("from") or [""])[0].strip()
    date_to = (qs.get("to") or [""])[0].strip()
    asset_class = (qs.get("asset_class") or [""])[0].strip().lower()
    account_id = (qs.get("account_id") or [""])[0].strip()

    if asset_class and asset_class not in SUPPORTED_ASSET_CLASSES:
        raise ValueError("asset_class 仅支持 cash/real_estate")

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
            SELECT account_id, account_name, asset_class, snapshot_date, value_cents, source_type
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
    finally:
        conn.close()

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
            WHERE account_id = ? AND snapshot_date >= ? AND snapshot_date <= ?
            GROUP BY snapshot_date
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
            rows.append(
                {
                    "snapshot_date": date_text,
                    "effective_snapshot_date": point_end_date.isoformat(),
                    "total_assets_cents": point_end_assets,
                    "total_assets_yuan": cents_to_yuan_text(point_end_assets),
                    "transfer_amount_cents": transfer_by_date.get(date_text, 0),
                    "transfer_amount_yuan": cents_to_yuan_text(transfer_by_date.get(date_text, 0)),
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
                "end_cumulative_return_rate": None,
                "end_cumulative_return_pct_text": None,
            },
            "rows": [],
        }

    first_value = int(rows[0]["total_assets_cents"])
    last_value = int(rows[-1]["total_assets_cents"])
    change_cents = last_value - first_value
    change_pct = (change_cents / first_value) if first_value > 0 else None
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
    cash_total = sum(int(row["value_cents"]) for row in cash_rows)
    real_estate_total = sum(int(row["value_cents"]) for row in real_estate_rows)
    wealth_total = investment_total + cash_total + real_estate_total

    def fmt_rows(rows: list[sqlite3.Row], cls: str) -> list[dict[str, Any]]:
        result = []
        for row in rows:
            value_cents = int(row["value_cents"])
            result.append(
                {
                    "asset_class": cls,
                    "account_id": row["account_id"],
                    "account_name": row["account_name"],
                    "snapshot_date": row["snapshot_date"],
                    "value_cents": value_cents,
                    "value_yuan": cents_to_yuan_text(value_cents),
                }
            )
        return result

    return {
        "as_of": as_of,
        "requested_as_of": requested_as_of.isoformat(),
        "summary": {
            "investment_total_cents": investment_total,
            "investment_total_yuan": cents_to_yuan_text(investment_total),
            "cash_total_cents": cash_total,
            "cash_total_yuan": cents_to_yuan_text(cash_total),
            "real_estate_total_cents": real_estate_total,
            "real_estate_total_yuan": cents_to_yuan_text(real_estate_total),
            "wealth_total_cents": wealth_total,
            "wealth_total_yuan": cents_to_yuan_text(wealth_total),
        },
        "rows": fmt_rows(investment_rows, "investment") + fmt_rows(cash_rows, "cash") + fmt_rows(real_estate_rows, "real_estate"),
    }


def query_wealth_curve(config: AppConfig, qs: dict[str, list[str]]) -> dict[str, Any]:
    preset = parse_preset((qs.get("preset") or ["1y"])[0])
    from_raw = (qs.get("from") or [""])[0].strip()
    to_raw = (qs.get("to") or [""])[0].strip()

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
                SELECT snapshot_date FROM account_valuations WHERE snapshot_date >= ? AND snapshot_date <= ?
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
    finally:
        conn.close()

    investment_totals = build_asof_totals(dates=dates, history_rows=investment_history)
    cash_totals = build_asof_totals(dates=dates, history_rows=cash_history)
    real_estate_totals = build_asof_totals(dates=dates, history_rows=real_estate_history)

    rows: list[dict[str, Any]] = []
    for d in dates:
        inv = investment_totals[d]
        cash = cash_totals[d]
        re = real_estate_totals[d]
        wealth = inv + cash + re
        rows.append(
            {
                "snapshot_date": d,
                "investment_total_cents": inv,
                "cash_total_cents": cash,
                "real_estate_total_cents": re,
                "wealth_total_cents": wealth,
                "wealth_total_yuan": cents_to_yuan_text(wealth),
            }
        )

    first_total = rows[0]["wealth_total_cents"] if rows else 0
    last_total = rows[-1]["wealth_total_cents"] if rows else 0
    change_cents = last_total - first_total
    change_pct = (change_cents / first_total) if first_total > 0 else None

    return {
        "range": {
            "preset": preset,
            "requested_from": requested_from.isoformat(),
            "requested_to": parse_iso_date(to_raw, "to").isoformat() if to_raw else latest.isoformat(),
            "effective_from": rows[0]["snapshot_date"] if rows else effective_from.isoformat(),
            "effective_to": rows[-1]["snapshot_date"] if rows else effective_to.isoformat(),
            "points": len(rows),
        },
        "summary": {
            "start_wealth_cents": first_total,
            "start_wealth_yuan": cents_to_yuan_text(first_total),
            "end_wealth_cents": last_total,
            "end_wealth_yuan": cents_to_yuan_text(last_total),
            "change_cents": change_cents,
            "change_yuan": cents_to_yuan_text(change_cents),
            "change_pct": round(change_pct, 8) if change_pct is not None else None,
            "change_pct_text": f"{change_pct * 100:.2f}%" if change_pct is not None else None,
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
        conditions.append("month_key = ?")
        params.append(month_key)
    if source_type:
        conditions.append("source_type = ?")
        params.append(source_type)
    if account_id:
        conditions.append("account_id = ?")
        params.append(account_id)
    if keyword:
        conditions.append("(description LIKE ? OR merchant_normalized LIKE ?)")
        params.extend([f"%{keyword}%", f"%{keyword}%"])

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    conn = sqlite3.connect(config.db_path)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            f"""
            SELECT posted_at, occurred_at, merchant_normalized, description, amount_cents, statement_category, source_type
            FROM transactions
            {where}
            ORDER BY COALESCE(posted_at, occurred_at) DESC, id DESC
            LIMIT ?
            """,
            [*params, limit],
        ).fetchall()

        summary_row = conn.execute(
            f"SELECT COUNT(*) AS count, COALESCE(SUM(amount_cents), 0) AS total_cents FROM transactions {where}",
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
            SELECT r.snapshot_date, r.account_id, a.name AS account_name, r.total_assets_cents,
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
            if parsed.path == "/assets/m0_app.css":
                css = (self.config.assets_dir / "m0_app.css").read_text(encoding="utf-8")
                self._text(HTTPStatus.OK, "text/css", css)
                return
            if parsed.path == "/api/health":
                self._json(HTTPStatus.OK, {"ok": True, "time": datetime.now().isoformat(timespec="seconds")})
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
            if parsed.path == "/api/analytics/investment-return":
                payload = query_investment_return(self.config, parse_qs(parsed.query))
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

            if self.path == "/api/assets/manual":
                body = self._read_json()
                payload = upsert_manual_asset_valuation(self.config, body)
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
