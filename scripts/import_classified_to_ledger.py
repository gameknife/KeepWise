#!/usr/bin/env python3
"""Import classified CSV output into the local ledger SQLite database."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import sqlite3
import uuid
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path


def parse_amount_to_cents(raw: str) -> int:
    text = (raw or "").strip().replace(",", "")
    if not text:
        return 0
    value = Decimal(text).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return int(value * 100)


def boolish_to_int(raw: str) -> int:
    text = (raw or "").strip().lower()
    return 1 if text in {"1", "true", "yes", "y", "on"} else 0


def safe_confidence(raw: str) -> float:
    try:
        value = float((raw or "").strip() or "0")
    except ValueError:
        return 0.0
    if value < 0:
        return 0.0
    if value > 1:
        return 1.0
    return value


def resolve_month_key(row: dict[str, str]) -> str:
    post_date = (row.get("post_date") or "").strip()
    trans_date = (row.get("trans_date") or "").strip()
    if len(post_date) >= 7:
        return post_date[:7]
    if len(trans_date) >= 7:
        return trans_date[:7]

    year = (row.get("statement_year") or "").strip()
    month = (row.get("statement_month") or "").strip()
    if year.isdigit() and month.isdigit():
        return f"{int(year):04d}-{int(month):02d}"
    return "1970-01"


def account_id_from_last4(last4: str) -> str:
    clean = (last4 or "").strip()
    return f"acct_cmb_credit_{clean if clean else 'unknown'}"


def account_name_from_last4(last4: str) -> str:
    clean = (last4 or "").strip()
    return f"招行信用卡尾号{clean}" if clean else "招行信用卡"


def category_id_from_name(name: str) -> str:
    normalized = (name or "").strip() or "待分类"
    digest = hashlib.sha1(normalized.encode("utf-8")).hexdigest()[:12]
    return f"cat_{digest}"


def transaction_identity_base(row: dict[str, str]) -> str:
    return "|".join(
        [
            (row.get("source_file") or "").strip(),
            (row.get("source_path") or "").strip(),
            (row.get("statement_year") or "").strip(),
            (row.get("statement_month") or "").strip(),
            (row.get("statement_category") or "").strip(),
            (row.get("post_date") or "").strip(),
            (row.get("trans_date") or "").strip(),
            (row.get("description") or "").strip(),
            (row.get("amount_rmb") or "").strip(),
            (row.get("card_last4") or "").strip(),
            (row.get("original_amount") or "").strip(),
            (row.get("country_area") or "").strip(),
        ]
    )


def transaction_id(row: dict[str, str], *, source_type: str, occurrence_index: int) -> str:
    # Use a source-row fingerprint + occurrence rank instead of CSV global row number.
    # This keeps IDs stable when users import overlapping EML batches in different combinations.
    source = "|".join([source_type, transaction_identity_base(row), str(occurrence_index)])
    return hashlib.sha1(source.encode("utf-8")).hexdigest()


def direction_from_statement_category(statement_category: str) -> str:
    cat = (statement_category or "").strip()
    if cat == "消费":
        return "expense"
    if cat == "还款":
        return "transfer"
    return "other"


def ensure_schema_ready(conn: sqlite3.Connection) -> None:
    tables = {
        row[0]
        for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('accounts', 'categories', 'transactions', 'import_jobs')"
        )
    }
    required = {"accounts", "categories", "transactions", "import_jobs"}
    missing = required - tables
    if missing:
        raise RuntimeError(f"数据库缺少必要表: {', '.join(sorted(missing))}。请先运行 migrate_ledger_db.py")


def upsert_account(conn: sqlite3.Connection, account_id: str, account_name: str) -> None:
    conn.execute(
        """
        INSERT INTO accounts(id, name, account_type, currency, initial_balance_cents)
        VALUES (?, ?, 'credit_card', 'CNY', 0)
        ON CONFLICT(id) DO UPDATE SET
            name=excluded.name,
            updated_at=datetime('now')
        """,
        (account_id, account_name),
    )


def upsert_category(conn: sqlite3.Connection, category_id: str, category_name: str) -> None:
    conn.execute(
        """
        INSERT INTO categories(id, name, level, budget_enabled, is_active)
        VALUES (?, ?, 1, 1, 1)
        ON CONFLICT(id) DO UPDATE SET
            name=excluded.name,
            is_active=1,
            updated_at=datetime('now')
        """,
        (category_id, category_name),
    )


def upsert_transaction(
    conn: sqlite3.Connection,
    row: dict[str, str],
    *,
    tx_id: str,
    category_id: str,
    account_id: str,
    source_type: str,
    import_job_id: str,
) -> None:
    amount_cents = parse_amount_to_cents(row.get("amount_rmb") or "")
    description = (row.get("description") or "").strip()
    merchant_normalized = (row.get("merchant_normalized") or "").strip()
    statement_category = (row.get("statement_category") or "").strip()

    conn.execute(
        """
        INSERT INTO transactions(
            id, external_ref, occurred_at, posted_at, month_key, amount_cents, currency, direction,
            description, merchant, merchant_normalized, statement_category, category_id, account_id,
            source_type, source_file, import_job_id, confidence, needs_review, excluded_in_analysis, exclude_reason
        )
        VALUES (?, ?, ?, ?, ?, ?, 'CNY', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            external_ref=excluded.external_ref,
            occurred_at=excluded.occurred_at,
            posted_at=excluded.posted_at,
            month_key=excluded.month_key,
            amount_cents=excluded.amount_cents,
            direction=excluded.direction,
            description=excluded.description,
            merchant=excluded.merchant,
            merchant_normalized=excluded.merchant_normalized,
            statement_category=excluded.statement_category,
            category_id=excluded.category_id,
            account_id=excluded.account_id,
            source_type=excluded.source_type,
            source_file=excluded.source_file,
            import_job_id=excluded.import_job_id,
            confidence=excluded.confidence,
            needs_review=excluded.needs_review,
            excluded_in_analysis=excluded.excluded_in_analysis,
            exclude_reason=excluded.exclude_reason,
            updated_at=datetime('now')
        """,
        (
            tx_id,
            f"{source_type}:{tx_id}",
            (row.get("trans_date") or "").strip() or None,
            (row.get("post_date") or "").strip() or None,
            resolve_month_key(row),
            amount_cents,
            direction_from_statement_category(statement_category),
            description,
            description,
            merchant_normalized,
            statement_category,
            category_id,
            account_id,
            source_type,
            (row.get("source_file") or "").strip(),
            import_job_id,
            safe_confidence(row.get("confidence") or ""),
            boolish_to_int(row.get("needs_review") or ""),
            boolish_to_int(row.get("excluded_in_analysis") or ""),
            (row.get("exclude_reason") or "").strip(),
        ),
    )


def import_csv(
    db_path: Path,
    classified_csv: Path,
    *,
    source_type: str,
    replace_existing_source_transactions: bool = True,
) -> tuple[int, int, str]:
    if not classified_csv.exists():
        raise FileNotFoundError(f"未找到分类结果 CSV: {classified_csv}")

    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys = ON")
    ensure_schema_ready(conn)

    job_id = str(uuid.uuid4())
    started_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    metadata_json = json.dumps(
        {
            "classified_csv": str(classified_csv),
            "source_type": source_type,
            "replace_existing_source_transactions": replace_existing_source_transactions,
        },
        ensure_ascii=False,
    )

    with conn:
        conn.execute(
            """
            INSERT INTO import_jobs(id, source_type, source_file, status, started_at, total_count, imported_count, error_count, metadata_json)
            VALUES (?, ?, ?, 'running', ?, 0, 0, 0, ?)
            """,
            (job_id, source_type, str(classified_csv), started_at, metadata_json),
        )
        if replace_existing_source_transactions:
            # CLI/report pipeline keeps full-snapshot semantics by default.
            conn.execute("DELETE FROM transactions WHERE source_type = ?", (source_type,))

    total_count = 0
    imported_count = 0
    error_count = 0
    occurrence_counters: dict[str, int] = {}

    try:
        with classified_csv.open("r", newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                total_count += 1
                try:
                    category_name = (row.get("expense_category") or "").strip() or "待分类"
                    category_id = category_id_from_name(category_name)
                    card_last4 = (row.get("card_last4") or "").strip()
                    account_id = account_id_from_last4(card_last4)
                    account_name = account_name_from_last4(card_last4)
                    identity_base = transaction_identity_base(row)
                    occurrence_index = occurrence_counters.get(identity_base, 0) + 1
                    occurrence_counters[identity_base] = occurrence_index

                    with conn:
                        upsert_account(conn, account_id, account_name)
                        upsert_category(conn, category_id, category_name)
                        tx_id = transaction_id(
                            row,
                            source_type=source_type,
                            occurrence_index=occurrence_index,
                        )
                        upsert_transaction(
                            conn,
                            row,
                            tx_id=tx_id,
                            category_id=category_id,
                            account_id=account_id,
                            source_type=source_type,
                            import_job_id=job_id,
                        )
                    imported_count += 1
                except (ValueError, InvalidOperation, sqlite3.DatabaseError):
                    error_count += 1

        finished_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
        with conn:
            conn.execute(
                """
                UPDATE import_jobs
                SET status='success',
                    finished_at=?,
                    total_count=?,
                    imported_count=?,
                    error_count=?
                WHERE id=?
                """,
                (finished_at, total_count, imported_count, error_count, job_id),
            )
        return imported_count, error_count, job_id
    except Exception as exc:
        finished_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
        with conn:
            conn.execute(
                """
                UPDATE import_jobs
                SET status='failed',
                    finished_at=?,
                    total_count=?,
                    imported_count=?,
                    error_count=?,
                    error_message=?
                WHERE id=?
                """,
                (finished_at, total_count, imported_count, error_count, str(exc), job_id),
            )
        raise
    finally:
        conn.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="导入 classified_transactions.csv 到本地账本数据库")
    parser.add_argument(
        "--db",
        type=Path,
        default=Path("data/work/processed/ledger/keepwise.db"),
        help="SQLite 数据库文件路径（默认: data/work/processed/ledger/keepwise.db）",
    )
    parser.add_argument(
        "--classified-csv",
        type=Path,
        default=Path("data/work/processed/category/classified_transactions.csv"),
        help="分类交易 CSV 路径（默认: data/work/processed/category/classified_transactions.csv）",
    )
    parser.add_argument(
        "--source-type",
        default="cmb_eml",
        help="导入来源标识（默认: cmb_eml）",
    )
    args = parser.parse_args()

    imported_count, error_count, job_id = import_csv(
        args.db,
        args.classified_csv,
        source_type=args.source_type,
    )
    print("导入完成。")
    print(f"数据库路径: {args.db}")
    print(f"导入任务ID: {job_id}")
    print(f"成功导入: {imported_count}")
    print(f"失败条数: {error_count}")


if __name__ == "__main__":
    main()
