#!/usr/bin/env python3
"""M4 analytics and budget service functions for KeepWise web app."""

from __future__ import annotations

import sqlite3
import uuid
import math
from datetime import date, datetime
from pathlib import Path
from typing import Any, Callable, Protocol

import import_youzhiyouxing_investments as yzxy_import_mod

TRANSACTION_IMPORT_SOURCE_TYPES = ("cmb_eml", "cmb_bank_pdf")
DEFAULT_FIRE_WITHDRAWAL_RATE = 0.04


class M4ConfigLike(Protocol):
    db_path: Path


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


def parse_withdrawal_rate_param(raw: str | None, *, default_rate: float) -> float:
    text = (raw or "").strip()
    if not text:
        return float(default_rate)
    try:
        value = float(text)
    except ValueError as exc:
        raise ValueError("withdrawal_rate 必须是数字（例如 0.04）") from exc
    if value <= 0 or value >= 1:
        raise ValueError("withdrawal_rate 必须在 0 和 1 之间（例如 0.04 表示 4%）")
    return value


def _load_monthly_budget_items(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    return conn.execute(
        """
        SELECT id, name, monthly_amount_cents, sort_order, is_active, is_builtin, created_at, updated_at
        FROM monthly_budget_items
        ORDER BY sort_order ASC, is_builtin DESC, created_at ASC, id ASC
        """
    ).fetchall()


def _summarize_monthly_budget_items(rows: list[sqlite3.Row]) -> dict[str, int]:
    total_count = len(rows)
    active_rows = [row for row in rows if int(row["is_active"] or 0) == 1]
    active_count = len(active_rows)
    monthly_total_cents = sum(int(row["monthly_amount_cents"] or 0) for row in active_rows)
    annual_total_cents = monthly_total_cents * 12
    return {
        "total_count": total_count,
        "active_count": active_count,
        "monthly_total_cents": monthly_total_cents,
        "annual_total_cents": annual_total_cents,
    }


def _format_monthly_budget_item_row(row: sqlite3.Row) -> dict[str, Any]:
    monthly_amount_cents = int(row["monthly_amount_cents"] or 0)
    annual_amount_cents = monthly_amount_cents * 12
    return {
        "id": str(row["id"]),
        "name": str(row["name"]),
        "monthly_amount_cents": monthly_amount_cents,
        "monthly_amount_yuan": cents_to_yuan_text(monthly_amount_cents),
        "annual_amount_cents": annual_amount_cents,
        "annual_amount_yuan": cents_to_yuan_text(annual_amount_cents),
        "sort_order": int(row["sort_order"] or 0),
        "is_active": bool(int(row["is_active"] or 0)),
        "is_builtin": bool(int(row["is_builtin"] or 0)),
        "created_at": str(row["created_at"]),
        "updated_at": str(row["updated_at"]),
    }


def query_monthly_budget_items(config: M4ConfigLike, qs: dict[str, list[str]]) -> dict[str, Any]:
    conn = sqlite3.connect(config.db_path)
    conn.row_factory = sqlite3.Row
    try:
        rows = _load_monthly_budget_items(conn)
    finally:
        conn.close()

    summary = _summarize_monthly_budget_items(rows)
    return {
        "summary": {
            "total_count": summary["total_count"],
            "active_count": summary["active_count"],
            "monthly_budget_total_cents": summary["monthly_total_cents"],
            "monthly_budget_total_yuan": cents_to_yuan_text(summary["monthly_total_cents"]),
            "annual_budget_cents": summary["annual_total_cents"],
            "annual_budget_yuan": cents_to_yuan_text(summary["annual_total_cents"]),
        },
        "rows": [_format_monthly_budget_item_row(row) for row in rows],
    }


def upsert_monthly_budget_item(config: M4ConfigLike, payload: dict[str, Any]) -> dict[str, Any]:
    item_id = str(payload.get("id", "")).strip()
    name = str(payload.get("name", "")).strip()
    if not name:
        raise ValueError("name 必填")
    monthly_amount_cents = yzxy_import_mod.parse_amount_to_cents(str(payload.get("monthly_amount", "0")))
    if monthly_amount_cents < 0:
        raise ValueError("monthly_amount 不能为负数")
    is_active = parse_bool_param(str(payload.get("is_active", "true")), default=True)
    sort_order_raw = str(payload.get("sort_order", "")).strip()
    sort_order = int(sort_order_raw) if sort_order_raw else 1000

    conn = sqlite3.connect(config.db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        with conn:
            if item_id:
                existing = conn.execute(
                    "SELECT id, is_builtin FROM monthly_budget_items WHERE id = ?",
                    (item_id,),
                ).fetchone()
                if not existing:
                    raise ValueError("未找到要修改的预算项")
                conn.execute(
                    """
                    UPDATE monthly_budget_items
                    SET name = ?,
                        monthly_amount_cents = ?,
                        sort_order = ?,
                        is_active = ?,
                        updated_at = datetime('now')
                    WHERE id = ?
                    """,
                    (name, monthly_amount_cents, sort_order, 1 if is_active else 0, item_id),
                )
            else:
                item_id = str(uuid.uuid4())
                conn.execute(
                    """
                    INSERT INTO monthly_budget_items(
                        id, name, monthly_amount_cents, sort_order, is_active, is_builtin
                    )
                    VALUES (?, ?, ?, ?, ?, 0)
                    """,
                    (item_id, name, monthly_amount_cents, sort_order, 1 if is_active else 0),
                )

            saved = conn.execute(
                """
                SELECT id, name, monthly_amount_cents, sort_order, is_active, is_builtin, created_at, updated_at
                FROM monthly_budget_items
                WHERE id = ?
                """,
                (item_id,),
            ).fetchone()
    except sqlite3.IntegrityError as exc:
        raise ValueError(f"预算项保存失败（名称可能重复）: {exc}") from exc
    finally:
        conn.close()

    if not saved:
        raise ValueError("预算项保存后读取失败")
    return _format_monthly_budget_item_row(saved)


def delete_monthly_budget_item(config: M4ConfigLike, payload: dict[str, Any]) -> dict[str, Any]:
    item_id = str(payload.get("id", "")).strip()
    if not item_id:
        raise ValueError("id 必填")

    conn = sqlite3.connect(config.db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        row = conn.execute(
            """
            SELECT id, name, monthly_amount_cents, is_builtin
            FROM monthly_budget_items
            WHERE id = ?
            """,
            (item_id,),
        ).fetchone()
        if not row:
            raise ValueError("未找到要删除的预算项")
        with conn:
            conn.execute("DELETE FROM monthly_budget_items WHERE id = ?", (item_id,))
    finally:
        conn.close()

    return {
        "id": str(row["id"]),
        "name": str(row["name"]),
        "monthly_amount_cents": int(row["monthly_amount_cents"] or 0),
        "is_builtin": bool(int(row["is_builtin"] or 0)),
        "deleted": True,
    }


def _budget_year_months_elapsed(selected_year: int, today: date) -> int:
    if selected_year < today.year:
        return 12
    if selected_year > today.year:
        return 0
    return today.month


def query_budget_overview(config: M4ConfigLike, qs: dict[str, list[str]]) -> dict[str, Any]:
    today = datetime.now().date()
    year = parse_year_param((qs.get("year") or [""])[0], default_year=today.year)
    month_start = f"{year:04d}-01"
    month_end = f"{year:04d}-12"
    elapsed_months = _budget_year_months_elapsed(year, today)

    conn = sqlite3.connect(config.db_path)
    conn.row_factory = sqlite3.Row
    try:
        budget_rows = _load_monthly_budget_items(conn)
        budget_summary = _summarize_monthly_budget_items(budget_rows)
        spent_row = conn.execute(
            """
            SELECT COALESCE(SUM(ABS(amount_cents)), 0) AS spent_cents
            FROM transactions
            WHERE direction = 'expense'
              AND month_key >= ?
              AND month_key <= ?
              AND needs_review = 0
              AND excluded_in_analysis = 0
            """,
            (month_start, month_end),
        ).fetchone()
    finally:
        conn.close()

    monthly_budget_total_cents = budget_summary["monthly_total_cents"]
    annual_budget_cents = budget_summary["annual_total_cents"]
    ytd_budget_cents = monthly_budget_total_cents * elapsed_months
    actual_spent_cents = int(spent_row["spent_cents"] or 0) if spent_row else 0
    ytd_actual_cents = actual_spent_cents
    annual_remaining_cents = annual_budget_cents - actual_spent_cents
    ytd_variance_cents = ytd_budget_cents - ytd_actual_cents
    usage_rate = (actual_spent_cents / annual_budget_cents) if annual_budget_cents > 0 else None
    ytd_usage_rate = (ytd_actual_cents / ytd_budget_cents) if ytd_budget_cents > 0 else None

    return {
        "year": year,
        "as_of_date": today.isoformat(),
        "analysis_scope": {
            "exclude_needs_review": True,
            "exclude_excluded_in_analysis": True,
            "ytd_budget_mode": "elapsed_months_integer",
            "elapsed_months": elapsed_months,
        },
        "budget": {
            "monthly_total_cents": monthly_budget_total_cents,
            "monthly_total_yuan": cents_to_yuan_text(monthly_budget_total_cents),
            "annual_total_cents": annual_budget_cents,
            "annual_total_yuan": cents_to_yuan_text(annual_budget_cents),
            "ytd_budget_cents": ytd_budget_cents,
            "ytd_budget_yuan": cents_to_yuan_text(ytd_budget_cents),
            "active_item_count": budget_summary["active_count"],
            "total_item_count": budget_summary["total_count"],
        },
        "actual": {
            "spent_total_cents": actual_spent_cents,
            "spent_total_yuan": cents_to_yuan_text(actual_spent_cents),
            "ytd_spent_cents": ytd_actual_cents,
            "ytd_spent_yuan": cents_to_yuan_text(ytd_actual_cents),
        },
        "metrics": {
            "annual_remaining_cents": annual_remaining_cents,
            "annual_remaining_yuan": cents_to_yuan_text(annual_remaining_cents),
            "usage_rate": round(usage_rate, 8) if usage_rate is not None else None,
            "usage_rate_pct_text": f"{usage_rate * 100:.2f}%" if usage_rate is not None else "-",
            "ytd_variance_cents": ytd_variance_cents,
            "ytd_variance_yuan": cents_to_yuan_text(ytd_variance_cents),
            "ytd_usage_rate": round(ytd_usage_rate, 8) if ytd_usage_rate is not None else None,
            "ytd_usage_rate_pct_text": f"{ytd_usage_rate * 100:.2f}%" if ytd_usage_rate is not None else "-",
        },
    }


def query_budget_monthly_review(config: M4ConfigLike, qs: dict[str, list[str]]) -> dict[str, Any]:
    today = datetime.now().date()
    year = parse_year_param((qs.get("year") or [""])[0], default_year=today.year)
    month_start = f"{year:04d}-01"
    month_end = f"{year:04d}-12"

    conn = sqlite3.connect(config.db_path)
    conn.row_factory = sqlite3.Row
    try:
        budget_rows = _load_monthly_budget_items(conn)
        budget_summary = _summarize_monthly_budget_items(budget_rows)
        tx_rows = conn.execute(
            """
            SELECT
                month_key,
                COUNT(*) AS tx_count,
                COALESCE(SUM(ABS(amount_cents)), 0) AS spent_cents
            FROM transactions
            WHERE direction = 'expense'
              AND month_key >= ?
              AND month_key <= ?
              AND needs_review = 0
              AND excluded_in_analysis = 0
            GROUP BY month_key
            ORDER BY month_key ASC
            """,
            (month_start, month_end),
        ).fetchall()
    finally:
        conn.close()

    monthly_budget_cents = budget_summary["monthly_total_cents"]
    tx_map = {str(row["month_key"]): row for row in tx_rows}
    rows: list[dict[str, Any]] = []
    over_budget_months = 0
    under_budget_months = 0
    equal_months = 0
    annual_spent_cents = 0
    annual_budget_cents = monthly_budget_cents * 12

    for month in range(1, 13):
        month_key = f"{year:04d}-{month:02d}"
        tx_row = tx_map.get(month_key)
        spent_cents = int(tx_row["spent_cents"] or 0) if tx_row else 0
        tx_count = int(tx_row["tx_count"] or 0) if tx_row else 0
        variance_cents = monthly_budget_cents - spent_cents
        usage_rate = (spent_cents / monthly_budget_cents) if monthly_budget_cents > 0 else None
        if spent_cents > monthly_budget_cents:
            status = "超预算"
            over_budget_months += 1
        elif spent_cents < monthly_budget_cents:
            status = "低于预算"
            under_budget_months += 1
        else:
            status = "持平"
            equal_months += 1
        annual_spent_cents += spent_cents
        rows.append(
            {
                "month_key": month_key,
                "month_index": month,
                "tx_count": tx_count,
                "budget_cents": monthly_budget_cents,
                "budget_yuan": cents_to_yuan_text(monthly_budget_cents),
                "spent_cents": spent_cents,
                "spent_yuan": cents_to_yuan_text(spent_cents),
                "variance_cents": variance_cents,
                "variance_yuan": cents_to_yuan_text(variance_cents),
                "usage_rate": round(usage_rate, 8) if usage_rate is not None else None,
                "usage_rate_pct_text": (f"{usage_rate * 100:.2f}%" if usage_rate is not None else "-"),
                "status": status,
            }
        )

    annual_variance_cents = annual_budget_cents - annual_spent_cents
    annual_usage_rate = (annual_spent_cents / annual_budget_cents) if annual_budget_cents > 0 else None

    return {
        "year": year,
        "analysis_scope": {
            "exclude_needs_review": True,
            "exclude_excluded_in_analysis": True,
        },
        "summary": {
            "monthly_budget_cents": monthly_budget_cents,
            "monthly_budget_yuan": cents_to_yuan_text(monthly_budget_cents),
            "annual_budget_cents": annual_budget_cents,
            "annual_budget_yuan": cents_to_yuan_text(annual_budget_cents),
            "annual_spent_cents": annual_spent_cents,
            "annual_spent_yuan": cents_to_yuan_text(annual_spent_cents),
            "annual_variance_cents": annual_variance_cents,
            "annual_variance_yuan": cents_to_yuan_text(annual_variance_cents),
            "annual_usage_rate": round(annual_usage_rate, 8) if annual_usage_rate is not None else None,
            "annual_usage_rate_pct_text": (f"{annual_usage_rate * 100:.2f}%" if annual_usage_rate is not None else "-"),
            "over_budget_months": over_budget_months,
            "under_budget_months": under_budget_months,
            "equal_months": equal_months,
        },
        "rows": rows,
    }


def query_consumption_report(config: M4ConfigLike, _qs: dict[str, list[str]]) -> dict[str, Any]:
    conn = sqlite3.connect(config.db_path)
    conn.row_factory = sqlite3.Row
    try:
        tx_rows = conn.execute(
            """
            SELECT
                t.id,
                t.month_key,
                t.posted_at,
                t.occurred_at,
                t.amount_cents,
                t.description,
                t.merchant_normalized,
                t.source_file,
                t.source_type,
                t.confidence,
                t.needs_review,
                t.excluded_in_analysis,
                COALESCE(c.name, '待分类') AS expense_category
            FROM transactions t
            LEFT JOIN categories c ON c.id = t.category_id
            WHERE t.direction = 'expense'
              AND t.currency = 'CNY'
            ORDER BY COALESCE(t.posted_at, t.occurred_at) DESC, t.id DESC
            """
        ).fetchall()
        failed_jobs_count = 0
        if conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='import_jobs' LIMIT 1"
        ).fetchone():
            failed_jobs_count = int(
                conn.execute(
                    """
                    SELECT COUNT(*)
                    FROM import_jobs
                    WHERE source_type IN (?, ?)
                      AND status = 'failed'
                    """,
                    TRANSACTION_IMPORT_SOURCE_TYPES,
                ).fetchone()[0]
            )
    finally:
        conn.close()

    all_consume_rows: list[dict[str, Any]] = []
    for row in tx_rows:
        amount_cents_abs = abs(int(row["amount_cents"] or 0))
        tx_date = str(row["posted_at"] or row["occurred_at"] or "")
        month_key = str(row["month_key"] or "") or (tx_date[:7] if len(tx_date) >= 7 else "")
        source_file = str(row["source_file"] or "")
        source_type = str(row["source_type"] or "")
        all_consume_rows.append(
            {
                "id": str(row["id"]),
                "month": month_key,
                "date": tx_date or (f"{month_key}-01" if len(month_key) == 7 else ""),
                "merchant": str(row["merchant_normalized"] or "").strip() or str(row["description"] or "").strip(),
                "description": str(row["description"] or ""),
                "category": str(row["expense_category"] or "待分类"),
                "amount_cents_abs": amount_cents_abs,
                "amount": cents_to_yuan_value(amount_cents_abs),
                "needs_review": bool(int(row["needs_review"] or 0)),
                "confidence": round(float(row["confidence"] or 0.0), 2),
                "source_path": source_file or f"{source_type}:{row['id']}",
                "excluded_in_analysis": bool(int(row["excluded_in_analysis"] or 0)),
            }
        )

    excluded_rows = [r for r in all_consume_rows if r["excluded_in_analysis"]]
    consume_rows = [r for r in all_consume_rows if not r["excluded_in_analysis"]]
    consumption_total_cents = sum(int(r["amount_cents_abs"]) for r in consume_rows)
    excluded_total_cents = sum(int(r["amount_cents_abs"]) for r in excluded_rows)
    review_count = sum(1 for r in consume_rows if r["needs_review"])

    by_expense: dict[str, dict[str, int]] = {}
    by_month: dict[str, dict[str, int]] = {}
    by_merchant: dict[str, dict[str, Any]] = {}
    transactions: list[dict[str, Any]] = []

    for rec in consume_rows:
        category = str(rec["category"])
        month = str(rec["month"])
        merchant = str(rec["merchant"])

        exp_bucket = by_expense.setdefault(category, {"amount_cents": 0, "count": 0, "review_count": 0})
        exp_bucket["amount_cents"] += int(rec["amount_cents_abs"])
        exp_bucket["count"] += 1
        exp_bucket["review_count"] += 1 if rec["needs_review"] else 0

        month_bucket = by_month.setdefault(month, {"amount_cents": 0, "count": 0, "review_count": 0})
        month_bucket["amount_cents"] += int(rec["amount_cents_abs"])
        month_bucket["count"] += 1
        month_bucket["review_count"] += 1 if rec["needs_review"] else 0

        merchant_bucket = by_merchant.setdefault(
            merchant,
            {"amount_cents": 0, "count": 0, "category": category},
        )
        merchant_bucket["amount_cents"] += int(rec["amount_cents_abs"])
        merchant_bucket["count"] += 1

        transactions.append(
            {
                "month": month,
                "date": str(rec["date"]),
                "merchant": merchant,
                "description": str(rec["description"]),
                "category": category,
                "amount": float(rec["amount"]),
                "needs_review": bool(rec["needs_review"]),
                "confidence": float(rec["confidence"]),
                "source_path": str(rec["source_path"]),
            }
        )

    categories = [
        {
            "category": cat,
            "amount": cents_to_yuan_value(int(stat["amount_cents"])),
            "count": int(stat["count"]),
            "review_count": int(stat["review_count"]),
        }
        for cat, stat in sorted(by_expense.items(), key=lambda x: x[1]["amount_cents"], reverse=True)
    ]
    months = [
        {
            "month": month,
            "amount": cents_to_yuan_value(int(stat["amount_cents"])),
            "count": int(stat["count"]),
            "review_count": int(stat["review_count"]),
        }
        for month, stat in sorted(by_month.items(), key=lambda x: x[0])
        if month
    ]
    merchants = [
        {
            "merchant": merchant,
            "amount": cents_to_yuan_value(int(stat["amount_cents"])),
            "count": int(stat["count"]),
            "category": str(stat["category"]),
        }
        for merchant, stat in sorted(by_merchant.items(), key=lambda x: x[1]["amount_cents"], reverse=True)[:80]
    ]

    transactions.sort(key=lambda x: (str(x["date"]), float(x["amount"])), reverse=True)
    top_expense_categories = [
        {"expense_category": item["category"], "amount": f"{float(item['amount']):.2f}"}
        for item in categories[:10]
    ]
    source_files = {str(r["source_path"]) for r in all_consume_rows if str(r["source_path"]).strip()}

    return {
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "input_files_count": len(source_files),
        "failed_files_count": failed_jobs_count,
        "consumption_count": len(consume_rows),
        "consumption_total": cents_to_yuan_text(consumption_total_cents),
        "consumption_total_value": cents_to_yuan_value(consumption_total_cents),
        "needs_review_count": int(review_count),
        "needs_review_ratio": round(review_count / len(consume_rows), 4) if consume_rows else 0,
        "excluded_consumption_count": len(excluded_rows),
        "excluded_consumption_total": cents_to_yuan_text(excluded_total_cents),
        "excluded_consumption_total_value": cents_to_yuan_value(excluded_total_cents),
        "raw_consumption_count": len(all_consume_rows),
        "raw_consumption_total": cents_to_yuan_text(consumption_total_cents + excluded_total_cents),
        "raw_consumption_total_value": cents_to_yuan_value(consumption_total_cents + excluded_total_cents),
        "top_expense_categories": top_expense_categories,
        "categories": categories,
        "months": months,
        "merchants": merchants,
        "transactions": transactions,
    }


def query_salary_income_overview(config: M4ConfigLike, qs: dict[str, list[str]]) -> dict[str, Any]:
    today = datetime.now().date()
    year = parse_year_param((qs.get("year") or [""])[0], default_year=today.year)
    month_start = f"{year:04d}-01"
    month_end = f"{year:04d}-12"

    conn = sqlite3.connect(config.db_path)
    conn.row_factory = sqlite3.Row
    try:
        monthly_rows = conn.execute(
            """
            SELECT
                month_key,
                statement_category,
                COUNT(*) AS tx_count,
                COALESCE(SUM(amount_cents), 0) AS amount_cents
            FROM transactions
            WHERE source_type = 'cmb_bank_pdf'
              AND direction = 'income'
              AND month_key >= ?
              AND month_key <= ?
              AND statement_category IN ('代发工资', '代发住房公积金')
            GROUP BY month_key, statement_category
            ORDER BY month_key ASC, statement_category ASC
            """,
            (month_start, month_end),
        ).fetchall()
        employer_rows = conn.execute(
            """
            SELECT
                COALESCE(NULLIF(TRIM(merchant_normalized), ''), NULLIF(TRIM(merchant), ''), '未知来源') AS employer,
                COUNT(*) AS tx_count,
                COALESCE(SUM(amount_cents), 0) AS amount_cents
            FROM transactions
            WHERE source_type = 'cmb_bank_pdf'
              AND direction = 'income'
              AND month_key >= ?
              AND month_key <= ?
              AND statement_category = '代发工资'
            GROUP BY employer
            ORDER BY amount_cents DESC, employer ASC
            """,
            (month_start, month_end),
        ).fetchall()
        totals_row = conn.execute(
            """
            SELECT
                COALESCE(SUM(CASE WHEN statement_category = '代发工资' THEN amount_cents ELSE 0 END), 0) AS salary_cents,
                COALESCE(SUM(CASE WHEN statement_category = '代发住房公积金' THEN amount_cents ELSE 0 END), 0) AS housing_fund_cents,
                COALESCE(SUM(CASE WHEN statement_category = '代发工资' THEN 1 ELSE 0 END), 0) AS salary_count,
                COALESCE(SUM(CASE WHEN statement_category = '代发住房公积金' THEN 1 ELSE 0 END), 0) AS housing_fund_count
            FROM transactions
            WHERE source_type = 'cmb_bank_pdf'
              AND direction = 'income'
              AND month_key >= ?
              AND month_key <= ?
              AND statement_category IN ('代发工资', '代发住房公积金')
            """,
            (month_start, month_end),
        ).fetchone()
    finally:
        conn.close()

    month_map: dict[str, dict[str, Any]] = {}
    for row in monthly_rows:
        month_key = str(row["month_key"])
        bucket = month_map.setdefault(
            month_key,
            {
                "salary_cents": 0,
                "salary_tx_count": 0,
                "housing_fund_cents": 0,
                "housing_fund_tx_count": 0,
            },
        )
        stmt = str(row["statement_category"] or "")
        amount_cents = int(row["amount_cents"] or 0)
        tx_count = int(row["tx_count"] or 0)
        if stmt == "代发工资":
            bucket["salary_cents"] += amount_cents
            bucket["salary_tx_count"] += tx_count
        elif stmt == "代发住房公积金":
            bucket["housing_fund_cents"] += amount_cents
            bucket["housing_fund_tx_count"] += tx_count

    rows: list[dict[str, Any]] = []
    months_with_salary = 0
    months_with_housing_fund = 0
    for month in range(1, 13):
        month_key = f"{year:04d}-{month:02d}"
        item = month_map.get(
            month_key,
            {
                "salary_cents": 0,
                "salary_tx_count": 0,
                "housing_fund_cents": 0,
                "housing_fund_tx_count": 0,
            },
        )
        salary_cents = int(item["salary_cents"])
        housing_fund_cents = int(item["housing_fund_cents"])
        if salary_cents > 0:
            months_with_salary += 1
        if housing_fund_cents > 0:
            months_with_housing_fund += 1
        total_cents = salary_cents + housing_fund_cents
        rows.append(
            {
                "month_key": month_key,
                "salary_cents": salary_cents,
                "salary_yuan": cents_to_yuan_text(salary_cents),
                "salary_tx_count": int(item["salary_tx_count"]),
                "housing_fund_cents": housing_fund_cents,
                "housing_fund_yuan": cents_to_yuan_text(housing_fund_cents),
                "housing_fund_tx_count": int(item["housing_fund_tx_count"]),
                "total_income_cents": total_cents,
                "total_income_yuan": cents_to_yuan_text(total_cents),
            }
        )

    salary_total_cents = int(totals_row["salary_cents"] or 0) if totals_row else 0
    housing_fund_total_cents = int(totals_row["housing_fund_cents"] or 0) if totals_row else 0
    salary_tx_count = int(totals_row["salary_count"] or 0) if totals_row else 0
    housing_fund_tx_count = int(totals_row["housing_fund_count"] or 0) if totals_row else 0

    return {
        "year": year,
        "as_of_date": today.isoformat(),
        "source_type": "cmb_bank_pdf",
        "summary": {
            "salary_total_cents": salary_total_cents,
            "salary_total_yuan": cents_to_yuan_text(salary_total_cents),
            "salary_tx_count": salary_tx_count,
            "housing_fund_total_cents": housing_fund_total_cents,
            "housing_fund_total_yuan": cents_to_yuan_text(housing_fund_total_cents),
            "housing_fund_tx_count": housing_fund_tx_count,
            "total_income_cents": salary_total_cents + housing_fund_total_cents,
            "total_income_yuan": cents_to_yuan_text(salary_total_cents + housing_fund_total_cents),
            "months_with_salary": months_with_salary,
            "months_with_housing_fund": months_with_housing_fund,
            "employer_count": len(employer_rows),
        },
        "employers": [
            {
                "employer": str(row["employer"]),
                "tx_count": int(row["tx_count"] or 0),
                "amount_cents": int(row["amount_cents"] or 0),
                "amount_yuan": cents_to_yuan_text(int(row["amount_cents"] or 0)),
            }
            for row in employer_rows
        ],
        "rows": rows,
    }


def query_fire_progress(
    config: M4ConfigLike,
    qs: dict[str, list[str]],
    *,
    wealth_overview_query: Callable[[M4ConfigLike, dict[str, list[str]]], dict[str, Any]],
) -> dict[str, Any]:
    today = datetime.now().date()
    year = parse_year_param((qs.get("year") or [""])[0], default_year=today.year)
    withdrawal_rate = parse_withdrawal_rate_param(
        (qs.get("withdrawal_rate") or [""])[0],
        default_rate=DEFAULT_FIRE_WITHDRAWAL_RATE,
    )

    budget_overview = query_budget_overview(config, {"year": [str(year)]})
    wealth_overview = wealth_overview_query(
        config,
        {
            "include_investment": ["true"],
            "include_cash": ["true"],
            "include_real_estate": ["false"],
            "include_liability": ["false"],
        },
    )
    annual_budget_cents = int(budget_overview["budget"]["annual_total_cents"])
    investment_cents = int(wealth_overview["summary"]["investment_total_cents"])
    cash_cents = int(wealth_overview["summary"]["cash_total_cents"])
    investable_assets_cents = investment_cents + cash_cents

    if annual_budget_cents > 0:
        coverage_years = investable_assets_cents / annual_budget_cents
        freedom_ratio = (investable_assets_cents * withdrawal_rate) / annual_budget_cents
        required_assets_cents = int(math.ceil(annual_budget_cents / withdrawal_rate))
        goal_gap_cents = investable_assets_cents - required_assets_cents
        remaining_to_goal_cents = max(required_assets_cents - investable_assets_cents, 0)
    else:
        coverage_years = None
        freedom_ratio = None
        required_assets_cents = 0
        goal_gap_cents = 0
        remaining_to_goal_cents = 0

    return {
        "year": year,
        "withdrawal_rate": withdrawal_rate,
        "withdrawal_rate_pct_text": f"{withdrawal_rate * 100:.2f}%",
        "budget": budget_overview["budget"],
        "investable_assets": {
            "as_of": str(wealth_overview["as_of"]),
            "investment_cents": investment_cents,
            "investment_yuan": cents_to_yuan_text(investment_cents),
            "cash_cents": cash_cents,
            "cash_yuan": cents_to_yuan_text(cash_cents),
            "total_cents": investable_assets_cents,
            "total_yuan": cents_to_yuan_text(investable_assets_cents),
        },
        "metrics": {
            "coverage_years": round(coverage_years, 8) if coverage_years is not None else None,
            "coverage_years_text": (f"{coverage_years:.2f} 年" if coverage_years is not None else "-"),
            "freedom_ratio": round(freedom_ratio, 8) if freedom_ratio is not None else None,
            "freedom_ratio_pct_text": (f"{freedom_ratio * 100:.2f}%" if freedom_ratio is not None else "-"),
            "required_assets_cents": required_assets_cents,
            "required_assets_yuan": cents_to_yuan_text(required_assets_cents),
            "goal_gap_cents": goal_gap_cents,
            "goal_gap_yuan": cents_to_yuan_text(goal_gap_cents),
            "remaining_to_goal_cents": remaining_to_goal_cents,
            "remaining_to_goal_yuan": cents_to_yuan_text(remaining_to_goal_cents),
        },
    }

