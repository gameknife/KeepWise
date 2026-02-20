#!/usr/bin/env python3
"""Minimal M0 web app: interactive imports, manual investment entry, and basic queries."""

from __future__ import annotations

import argparse
import base64
import json
import secrets
import sqlite3
import sys
import traceback
from dataclasses import dataclass
from datetime import datetime, timezone
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
