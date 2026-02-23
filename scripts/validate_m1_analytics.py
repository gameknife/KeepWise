#!/usr/bin/env python3
"""Regression checks for M1 analytics consistency.

Checks:
1) Modified Dietz return result is numerically stable on a fixed sample.
2) Investment curve endpoint equals interval return for the same range.
3) Each curve point equals return(from=range_start, to=point_date).
4) Wealth overview and wealth curve aggregation stay consistent.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import sqlite3
import tempfile
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

import import_classified_to_ledger as ledger_import_mod
import import_youzhiyouxing_investments as yzxy_mod
import m0_web_app as app_mod
import migrate_ledger_db as migrate_mod


def approx_equal(a: float | None, b: float | None, tol: float = 1e-8) -> bool:
    if a is None or b is None:
        return a is None and b is None
    return math.isclose(a, b, rel_tol=0.0, abs_tol=tol)


def make_id(seed: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, seed))


def insert_account(conn: sqlite3.Connection, account_id: str, name: str, account_type: str) -> None:
    conn.execute(
        """
        INSERT INTO accounts(id, name, account_type, currency, initial_balance_cents)
        VALUES (?, ?, ?, 'CNY', 0)
        ON CONFLICT(id) DO UPDATE SET
            name=excluded.name,
            account_type=excluded.account_type,
            updated_at=datetime('now')
        """,
        (account_id, name, account_type),
    )


def insert_investment(
    conn: sqlite3.Connection,
    *,
    account_id: str,
    snapshot_date: str,
    total_assets_cents: int,
    transfer_amount_cents: int,
) -> None:
    row_id = make_id(f"regression:inv:{account_id}:{snapshot_date}")
    conn.execute(
        """
        INSERT INTO investment_records(
            id, account_id, snapshot_date, total_assets_cents, transfer_amount_cents, source_type
        )
        VALUES (?, ?, ?, ?, ?, 'manual')
        ON CONFLICT(account_id, snapshot_date) DO UPDATE SET
            total_assets_cents=excluded.total_assets_cents,
            transfer_amount_cents=excluded.transfer_amount_cents,
            source_type='manual',
            updated_at=datetime('now')
        """,
        (row_id, account_id, snapshot_date, total_assets_cents, transfer_amount_cents),
    )


def insert_asset_valuation(
    conn: sqlite3.Connection,
    *,
    account_id: str,
    account_name: str,
    asset_class: str,
    snapshot_date: str,
    value_cents: int,
) -> None:
    row_id = make_id(f"regression:asset:{account_id}:{asset_class}:{snapshot_date}")
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
        (row_id, account_id, account_name, asset_class, snapshot_date, value_cents),
    )


def build_sample_dataset(conn: sqlite3.Connection) -> dict[str, str]:
    inv_account_id = "acct_inv_regression"
    cash_account_id = "acct_cash_regression"
    re_account_id = "acct_re_regression"
    tx_account_id = "acct_tx_regression"

    insert_account(conn, inv_account_id, "回归测试投资账户", "investment")
    insert_account(conn, cash_account_id, "回归测试现金账户", "cash")
    insert_account(conn, re_account_id, "回归测试不动产账户", "other")
    insert_account(conn, tx_account_id, "回归测试信用卡", "credit_card")

    # Fixed sample for Modified Dietz checks.
    insert_investment(
        conn,
        account_id=inv_account_id,
        snapshot_date="2025-01-15",
        total_assets_cents=9_200_000,
        transfer_amount_cents=0,
    )
    insert_investment(
        conn,
        account_id=inv_account_id,
        snapshot_date="2026-01-01",
        total_assets_cents=10_000_000,
        transfer_amount_cents=0,
    )
    insert_investment(
        conn,
        account_id=inv_account_id,
        snapshot_date="2026-01-10",
        total_assets_cents=13_000_000,
        transfer_amount_cents=2_000_000,
    )
    insert_investment(
        conn,
        account_id=inv_account_id,
        snapshot_date="2026-01-20",
        total_assets_cents=12_500_000,
        transfer_amount_cents=-1_000_000,
    )
    insert_investment(
        conn,
        account_id=inv_account_id,
        snapshot_date="2026-01-31",
        total_assets_cents=14_000_000,
        transfer_amount_cents=0,
    )

    # Wealth overview sample.
    insert_asset_valuation(
        conn,
        account_id=cash_account_id,
        account_name="回归测试现金账户",
        asset_class="cash",
        snapshot_date="2026-01-15",
        value_cents=5_000_000,
    )
    insert_asset_valuation(
        conn,
        account_id=cash_account_id,
        account_name="回归测试现金账户",
        asset_class="cash",
        snapshot_date="2026-01-31",
        value_cents=5_500_000,
    )
    insert_asset_valuation(
        conn,
        account_id=re_account_id,
        account_name="回归测试不动产账户",
        asset_class="real_estate",
        snapshot_date="2026-01-05",
        value_cents=80_000_000,
    )

    conn.execute(
        """
        INSERT INTO categories(id, name, level, budget_enabled, is_active)
        VALUES ('cat_reg_food', '餐饮', 1, 1, 1)
        ON CONFLICT(id) DO UPDATE SET
            name=excluded.name,
            updated_at=datetime('now')
        """
    )
    conn.execute(
        """
        INSERT INTO transactions(
            id, external_ref, occurred_at, posted_at, month_key, amount_cents, currency, direction,
            description, merchant, merchant_normalized, statement_category, category_id, account_id,
            source_type, source_file, import_job_id, confidence, needs_review, excluded_in_analysis, exclude_reason
        )
        VALUES (
            'tx_reg_1', 'cmb:tx_reg_1', '2026-01-10', '2026-01-10', '2026-01', 12345, 'CNY', 'expense',
            '回归测试餐饮消费', '测试商户', '测试商户', '消费', 'cat_reg_food', ?, 'cmb_eml', 'sample.eml', NULL,
            0.95, 0, 0, ''
        )
        ON CONFLICT(id) DO UPDATE SET
            category_id=excluded.category_id,
            updated_at=datetime('now')
        """,
        (tx_account_id,),
    )

    return {
        "investment_account_id": inv_account_id,
        "range_from": "2026-01-01",
        "range_to": "2026-01-31",
    }


def build_config(root: Path, db_path: Path) -> app_mod.AppConfig:
    work_dir = root / "data" / "work" / "processed"
    return app_mod.AppConfig(
        root_dir=root,
        work_dir=work_dir,
        rules_dir=root / "data" / "rules",
        db_path=db_path,
        migrations_dir=root / "db" / "migrations",
        assets_dir=root / "scripts" / "assets",
        session_dir=work_dir / "import_sessions",
    )


def write_classified_csv(path: Path, rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = [
        "source_file",
        "source_path",
        "statement_year",
        "statement_month",
        "statement_category",
        "trans_date",
        "post_date",
        "description",
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
    ]
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def assert_incremental_eml_import_dedupe(root: Path, tmp_dir: Path) -> None:
    db_path = tmp_dir / "import_dedupe.db"
    migrate_mod.apply_migrations(db_path, root / "db" / "migrations")

    row_a = {
        "source_file": "2026-01.eml",
        "source_path": "cmb/2026-01.eml",
        "statement_year": "2026",
        "statement_month": "1",
        "statement_category": "消费",
        "trans_date": "2026-01-10",
        "post_date": "2026-01-10",
        "description": "测试交易A",
        "merchant_normalized": "测试商户A",
        "amount_rmb": "12.34",
        "card_last4": "1234",
        "original_amount": "",
        "country_area": "",
        "expense_category": "餐饮",
        "classify_source": "manual_rule",
        "confidence": "0.95",
        "needs_review": "0",
        "excluded_in_analysis": "0",
        "exclude_reason": "",
    }
    row_b = {
        "source_file": "2026-01.eml",
        "source_path": "cmb/2026-01.eml",
        "statement_year": "2026",
        "statement_month": "1",
        "statement_category": "消费",
        "trans_date": "2026-01-09",
        "post_date": "2026-01-09",
        "description": "测试交易B",
        "merchant_normalized": "测试商户B",
        "amount_rmb": "56.78",
        "card_last4": "1234",
        "original_amount": "",
        "country_area": "",
        "expense_category": "购物",
        "classify_source": "manual_rule",
        "confidence": "0.95",
        "needs_review": "0",
        "excluded_in_analysis": "0",
        "exclude_reason": "",
    }

    csv_one = tmp_dir / "classified_one.csv"
    csv_two = tmp_dir / "classified_two.csv"
    write_classified_csv(csv_one, [row_a])
    write_classified_csv(csv_two, [row_b, row_a])  # row_a line number changes in this batch

    ledger_import_mod.import_csv(
        db_path,
        csv_one,
        source_type="cmb_eml",
        replace_existing_source_transactions=False,
    )
    ledger_import_mod.import_csv(
        db_path,
        csv_two,
        source_type="cmb_eml",
        replace_existing_source_transactions=False,
    )

    conn = sqlite3.connect(db_path)
    try:
        total = int(conn.execute("SELECT COUNT(*) FROM transactions WHERE source_type='cmb_eml'").fetchone()[0])
        if total != 2:
            raise AssertionError(f"Incremental EML import dedupe failed: expected 2 tx, got {total}")
        dup_count = int(
            conn.execute(
                """
                SELECT COUNT(*)
                FROM (
                    SELECT source_file, posted_at, occurred_at, amount_cents, description, account_id, COUNT(*) AS c
                    FROM transactions
                    WHERE source_type='cmb_eml'
                    GROUP BY source_file, posted_at, occurred_at, amount_cents, description, account_id
                    HAVING c > 1
                )
                """
            ).fetchone()[0]
        )
        if dup_count != 0:
            raise AssertionError(f"Incremental EML import dedupe failed: duplicate groups={dup_count}")
    finally:
        conn.close()


def run_regression(root: Path) -> dict[str, Any]:
    manual_rows, manual_errors, _ = yzxy_mod.parse_manual_rows(
        [
            ["记录类型", "记账时间", "转入转出金额", "总资产金额", "账户名称"],
            ["资产快照", "2026-01-01", "", "100.00", "回归投资账户"],
            ["资金转入", "2026-01-02", "10.00", "", "回归投资账户"],
            ["资金转出", "2026-01-03", "-30.00", "", "回归投资账户"],
        ],
        "回归投资账户",
    )
    if manual_errors:
        raise AssertionError(f"Manual parser errors unexpected: {manual_errors}")
    if [int(row.total_assets_cents) for row in manual_rows] != [10_000, 11_000, 8_000]:
        raise AssertionError(
            "Manual parser inferred assets mismatch: "
            f"got={[int(row.total_assets_cents) for row in manual_rows]}"
        )

    summary_rows, summary_errors, _ = yzxy_mod.parse_summary_rows(
        [
            ["日期", "账户名称", "总资产金额", "转入转出金额"],
            ["2026-01-01", "回归投资账户", "100.00", "0.00"],
            ["2026-01-02", "回归投资账户", "", "10.00"],
            ["2026-01-03", "回归投资账户", "", "-30.00"],
        ],
        "回归投资账户",
    )
    if summary_errors:
        raise AssertionError(f"Summary parser errors unexpected: {summary_errors}")
    if [int(row.total_assets_cents) for row in summary_rows] != [10_000, 11_000, 8_000]:
        raise AssertionError(
            "Summary parser inferred assets mismatch: "
            f"got={[int(row.total_assets_cents) for row in summary_rows]}"
        )

    with tempfile.TemporaryDirectory(prefix="keepwise-m1-regression-") as tmp_dir:
        tmp_path = Path(tmp_dir)
        assert_incremental_eml_import_dedupe(root, tmp_path)

        db_path = Path(tmp_dir) / "ledger_regression.db"
        migrate_mod.apply_migrations(db_path, root / "db" / "migrations")

        conn = sqlite3.connect(db_path)
        conn.execute("PRAGMA foreign_keys = ON")
        with conn:
            info = build_sample_dataset(conn)
        conn.close()

        cfg = build_config(root, db_path)
        account_id = info["investment_account_id"]
        range_from = info["range_from"]
        range_to = info["range_to"]

        ret = app_mod.query_investment_return(
            cfg,
            {
                "account_id": [account_id],
                "preset": ["custom"],
                "from": [range_from],
                "to": [range_to],
            },
        )
        curve = app_mod.query_investment_curve(
            cfg,
            {
                "account_id": [account_id],
                "preset": ["custom"],
                "from": [range_from],
                "to": [range_to],
            },
        )

        # Expected Modified Dietz on fixed sample:
        # R = (14000000 - 10000000 - 1000000) / (10000000 + 2000000*(21/30) - 1000000*(11/30))
        expected_return = 3_000_000 / (10_000_000 + 2_000_000 * (21 / 30) - 1_000_000 * (11 / 30))
        got_return = ret["metrics"]["return_rate"]
        if not approx_equal(got_return, expected_return, tol=1e-8):
            raise AssertionError(
                f"Modified Dietz mismatch: expected={expected_return:.10f}, got={got_return}"
            )
        if int(ret["metrics"]["net_growth_cents"]) != int(ret["metrics"]["profit_cents"]):
            raise AssertionError(
                "Investment return net growth mismatch: "
                f"net_growth={ret['metrics']['net_growth_cents']}, profit={ret['metrics']['profit_cents']}"
            )

        curve_end = curve["summary"]["end_cumulative_return_rate"]
        if not approx_equal(got_return, curve_end, tol=1e-8):
            raise AssertionError(
                f"Curve end return mismatch: return={got_return}, curve_end={curve_end}"
            )
        if int(curve["summary"]["end_net_growth_cents"]) != int(ret["metrics"]["net_growth_cents"]):
            raise AssertionError(
                "Curve end net growth mismatch: "
                f"curve={curve['summary']['end_net_growth_cents']}, "
                f"return={ret['metrics']['net_growth_cents']}"
            )
        if int(curve["rows"][-1]["cumulative_net_growth_cents"]) != int(curve["summary"]["end_net_growth_cents"]):
            raise AssertionError(
                "Curve end net growth row mismatch: "
                f"row={curve['rows'][-1]['cumulative_net_growth_cents']}, "
                f"summary={curve['summary']['end_net_growth_cents']}"
            )
        if int(curve["summary"]["start_assets_cents"]) != int(curve["rows"][0]["total_assets_cents"]):
            raise AssertionError(
                "Curve start assets mismatch: "
                f"summary={curve['summary']['start_assets_cents']}, "
                f"row={curve['rows'][0]['total_assets_cents']}"
            )
        if int(curve["summary"]["end_assets_cents"]) != int(curve["rows"][-1]["total_assets_cents"]):
            raise AssertionError(
                "Curve end assets mismatch: "
                f"summary={curve['summary']['end_assets_cents']}, "
                f"row={curve['rows'][-1]['total_assets_cents']}"
            )
        if int(curve["summary"]["change_cents"]) != (
            int(curve["summary"]["end_assets_cents"]) - int(curve["summary"]["start_assets_cents"])
        ):
            raise AssertionError(
                "Curve asset change mismatch: "
                f"change={curve['summary']['change_cents']}, "
                f"start={curve['summary']['start_assets_cents']}, "
                f"end={curve['summary']['end_assets_cents']}"
            )

        returns_batch = app_mod.query_investment_returns(
            cfg,
            {
                "preset": ["custom"],
                "from": [range_from],
                "to": [range_to],
            },
        )
        if int(returns_batch["summary"]["computed_count"]) != 1:
            raise AssertionError(
                f"Investment returns batch computed_count mismatch: got={returns_batch['summary']['computed_count']}"
            )
        batch_row = returns_batch["rows"][0]
        if str(batch_row["account_id"]) != account_id:
            raise AssertionError(
                f"Investment returns batch account mismatch: expected={account_id}, got={batch_row['account_id']}"
            )
        if not approx_equal(batch_row["return_rate"], got_return, tol=1e-8):
            raise AssertionError(
                f"Investment returns batch return mismatch: expected={got_return}, got={batch_row['return_rate']}"
            )

        portfolio_ret = app_mod.query_investment_return(
            cfg,
            {
                "account_id": [app_mod.PORTFOLIO_ACCOUNT_ID],
                "preset": ["custom"],
                "from": [range_from],
                "to": [range_to],
            },
        )
        portfolio_curve = app_mod.query_investment_curve(
            cfg,
            {
                "account_id": [app_mod.PORTFOLIO_ACCOUNT_ID],
                "preset": ["custom"],
                "from": [range_from],
                "to": [range_to],
            },
        )
        portfolio_rate = portfolio_ret["metrics"]["return_rate"]
        portfolio_curve_end = portfolio_curve["summary"]["end_cumulative_return_rate"]
        if int(portfolio_ret.get("account_count") or 0) != 1:
            raise AssertionError(
                f"Portfolio account_count mismatch: expected=1, got={portfolio_ret.get('account_count')}"
            )
        if any(int(flow["transfer_amount_cents"]) == 0 for flow in portfolio_ret.get("cash_flows", [])):
            raise AssertionError("Portfolio cash flows should exclude zero-value entries")
        if not approx_equal(portfolio_rate, got_return, tol=1e-8):
            raise AssertionError(
                f"Portfolio return mismatch: expected={got_return}, got={portfolio_rate}"
            )
        if not approx_equal(portfolio_curve_end, got_return, tol=1e-8):
            raise AssertionError(
                f"Portfolio curve end mismatch: expected={got_return}, got={portfolio_curve_end}"
            )
        if int(portfolio_ret["metrics"]["net_growth_cents"]) != int(portfolio_ret["metrics"]["profit_cents"]):
            raise AssertionError(
                "Portfolio return net growth mismatch: "
                f"net_growth={portfolio_ret['metrics']['net_growth_cents']}, "
                f"profit={portfolio_ret['metrics']['profit_cents']}"
            )
        if int(portfolio_curve["summary"]["end_net_growth_cents"]) != int(portfolio_ret["metrics"]["net_growth_cents"]):
            raise AssertionError(
                "Portfolio curve end net growth mismatch: "
                f"curve={portfolio_curve['summary']['end_net_growth_cents']}, "
                f"return={portfolio_ret['metrics']['net_growth_cents']}"
            )
        if int(portfolio_curve["summary"]["start_assets_cents"]) != int(portfolio_curve["rows"][0]["total_assets_cents"]):
            raise AssertionError(
                "Portfolio curve start assets mismatch: "
                f"summary={portfolio_curve['summary']['start_assets_cents']}, "
                f"row={portfolio_curve['rows'][0]['total_assets_cents']}"
            )
        if int(portfolio_curve["summary"]["change_cents"]) != (
            int(portfolio_curve["summary"]["end_assets_cents"]) - int(portfolio_curve["summary"]["start_assets_cents"])
        ):
            raise AssertionError(
                "Portfolio curve asset change mismatch: "
                f"change={portfolio_curve['summary']['change_cents']}, "
                f"start={portfolio_curve['summary']['start_assets_cents']}, "
                f"end={portfolio_curve['summary']['end_assets_cents']}"
            )

        curve_start = curve["range"]["effective_from"]
        per_point_checked = 0
        for row in curve["rows"]:
            point_date = str(row["snapshot_date"])
            if point_date <= curve_start:
                continue
            point_ret_payload = app_mod.query_investment_return(
                cfg,
                {
                    "account_id": [account_id],
                    "preset": ["custom"],
                    "from": [curve_start],
                    "to": [point_date],
                },
            )
            point_ret = point_ret_payload["metrics"]["return_rate"]
            point_curve = row["cumulative_return_rate"]
            if not approx_equal(point_ret, point_curve, tol=1e-8):
                raise AssertionError(
                    f"Per-point mismatch at {point_date}: return={point_ret}, curve={point_curve}"
                )
            if int(point_ret_payload["metrics"]["net_growth_cents"]) != int(row["cumulative_net_growth_cents"]):
                raise AssertionError(
                    f"Per-point net growth mismatch at {point_date}: "
                    f"return={point_ret_payload['metrics']['net_growth_cents']}, "
                    f"curve={row['cumulative_net_growth_cents']}"
                )
            per_point_checked += 1

        overview = app_mod.query_wealth_overview(cfg, {"as_of": [range_to]})
        expected_wealth_cents = 14_000_000 + 5_500_000 + 80_000_000
        if int(overview["summary"]["wealth_total_cents"]) != expected_wealth_cents:
            raise AssertionError(
                f"Wealth overview mismatch: expected={expected_wealth_cents}, "
                f"got={overview['summary']['wealth_total_cents']}"
            )
        if int(overview["summary"]["net_asset_total_cents"]) != expected_wealth_cents:
            raise AssertionError(
                "Wealth overview net asset mismatch (no liabilities expected): "
                f"got={overview['summary']['net_asset_total_cents']}"
            )
        if not bool(overview["summary"]["reconciliation_ok"]):
            raise AssertionError("Wealth overview reconciliation should be true")
        if int(overview["summary"]["selected_rows_total_cents"]) != int(overview["summary"]["wealth_total_cents"]):
            raise AssertionError(
                "Wealth overview selected rows total mismatch: "
                f"selected={overview['summary']['selected_rows_total_cents']}, "
                f"wealth={overview['summary']['wealth_total_cents']}"
            )
        if int(overview["summary"]["stale_account_count"]) != 1:
            raise AssertionError(
                f"Wealth overview stale_account_count mismatch: expected=1, got={overview['summary']['stale_account_count']}"
            )
        stale_rows = [row for row in overview["rows"] if int(row.get("stale_days") or 0) > 0]
        if len(stale_rows) != int(overview["summary"]["stale_account_count"]):
            raise AssertionError(
                "Wealth overview stale rows mismatch: "
                f"rows={len(stale_rows)}, summary={overview['summary']['stale_account_count']}"
            )

        wealth_curve = app_mod.query_wealth_curve(
            cfg,
            {"preset": ["custom"], "from": [range_from], "to": [range_to]},
        )
        if int(wealth_curve["summary"]["end_wealth_cents"]) != expected_wealth_cents:
            raise AssertionError(
                f"Wealth curve end mismatch: expected={expected_wealth_cents}, "
                f"got={wealth_curve['summary']['end_wealth_cents']}"
            )
        if int(wealth_curve["summary"]["end_net_asset_cents"]) != expected_wealth_cents:
            raise AssertionError(
                "Wealth curve end net asset mismatch (no liabilities expected): "
                f"got={wealth_curve['summary']['end_net_asset_cents']}"
            )
        if int(wealth_curve["summary"]["start_wealth_cents"]) != int(wealth_curve["rows"][0]["wealth_total_cents"]):
            raise AssertionError(
                "Wealth curve start mismatch: "
                f"summary={wealth_curve['summary']['start_wealth_cents']}, "
                f"row={wealth_curve['rows'][0]['wealth_total_cents']}"
            )
        if int(wealth_curve["summary"]["net_growth_cents"]) != int(wealth_curve["summary"]["change_cents"]):
            raise AssertionError(
                "Wealth curve net growth mismatch: "
                f"net_growth={wealth_curve['summary']['net_growth_cents']}, "
                f"change={wealth_curve['summary']['change_cents']}"
            )
        if int(wealth_curve["rows"][-1]["wealth_net_growth_cents"]) != int(wealth_curve["summary"]["net_growth_cents"]):
            raise AssertionError(
                "Wealth curve end row net growth mismatch: "
                f"row={wealth_curve['rows'][-1]['wealth_net_growth_cents']}, "
                f"summary={wealth_curve['summary']['net_growth_cents']}"
            )
        if int(wealth_curve["summary"]["start_investment_cents"]) != int(wealth_curve["rows"][0]["investment_total_cents"]):
            raise AssertionError(
                "Wealth curve start investment mismatch: "
                f"summary={wealth_curve['summary']['start_investment_cents']}, "
                f"row={wealth_curve['rows'][0]['investment_total_cents']}"
            )
        if int(wealth_curve["summary"]["end_investment_cents"]) != int(wealth_curve["rows"][-1]["investment_total_cents"]):
            raise AssertionError(
                "Wealth curve end investment mismatch: "
                f"summary={wealth_curve['summary']['end_investment_cents']}, "
                f"row={wealth_curve['rows'][-1]['investment_total_cents']}"
            )
        if int(wealth_curve["summary"]["investment_net_growth_cents"]) != (
            int(wealth_curve["summary"]["end_investment_cents"]) - int(wealth_curve["summary"]["start_investment_cents"])
        ):
            raise AssertionError(
                "Wealth curve investment net growth mismatch: "
                f"summary={wealth_curve['summary']['investment_net_growth_cents']}, "
                f"start={wealth_curve['summary']['start_investment_cents']}, "
                f"end={wealth_curve['summary']['end_investment_cents']}"
            )
        if int(wealth_curve["summary"]["start_cash_cents"]) != int(wealth_curve["rows"][0]["cash_total_cents"]):
            raise AssertionError(
                "Wealth curve start cash mismatch: "
                f"summary={wealth_curve['summary']['start_cash_cents']}, "
                f"row={wealth_curve['rows'][0]['cash_total_cents']}"
            )
        if int(wealth_curve["summary"]["end_cash_cents"]) != int(wealth_curve["rows"][-1]["cash_total_cents"]):
            raise AssertionError(
                "Wealth curve end cash mismatch: "
                f"summary={wealth_curve['summary']['end_cash_cents']}, "
                f"row={wealth_curve['rows'][-1]['cash_total_cents']}"
            )
        if int(wealth_curve["summary"]["cash_net_growth_cents"]) != (
            int(wealth_curve["summary"]["end_cash_cents"]) - int(wealth_curve["summary"]["start_cash_cents"])
        ):
            raise AssertionError(
                "Wealth curve cash net growth mismatch: "
                f"summary={wealth_curve['summary']['cash_net_growth_cents']}, "
                f"start={wealth_curve['summary']['start_cash_cents']}, "
                f"end={wealth_curve['summary']['end_cash_cents']}"
            )
        if int(wealth_curve["summary"]["start_real_estate_cents"]) != int(
            wealth_curve["rows"][0]["real_estate_total_cents"]
        ):
            raise AssertionError(
                "Wealth curve start real estate mismatch: "
                f"summary={wealth_curve['summary']['start_real_estate_cents']}, "
                f"row={wealth_curve['rows'][0]['real_estate_total_cents']}"
            )
        if int(wealth_curve["summary"]["end_real_estate_cents"]) != int(
            wealth_curve["rows"][-1]["real_estate_total_cents"]
        ):
            raise AssertionError(
                "Wealth curve end real estate mismatch: "
                f"summary={wealth_curve['summary']['end_real_estate_cents']}, "
                f"row={wealth_curve['rows'][-1]['real_estate_total_cents']}"
            )
        if int(wealth_curve["summary"]["real_estate_net_growth_cents"]) != (
            int(wealth_curve["summary"]["end_real_estate_cents"])
            - int(wealth_curve["summary"]["start_real_estate_cents"])
        ):
            raise AssertionError(
                "Wealth curve real estate net growth mismatch: "
                f"summary={wealth_curve['summary']['real_estate_net_growth_cents']}, "
                f"start={wealth_curve['summary']['start_real_estate_cents']}, "
                f"end={wealth_curve['summary']['end_real_estate_cents']}"
            )

        # M3 preset switching regression: wealth curve presets should be stable and end at latest snapshot.
        wealth_curve_since_inception = app_mod.query_wealth_curve(
            cfg,
            {"preset": ["since_inception"]},
        )
        wealth_curve_1y = app_mod.query_wealth_curve(
            cfg,
            {"preset": ["1y"]},
        )
        wealth_curve_ytd = app_mod.query_wealth_curve(
            cfg,
            {"preset": ["ytd"]},
        )
        preset_curves = {
            "since_inception": wealth_curve_since_inception,
            "1y": wealth_curve_1y,
            "ytd": wealth_curve_ytd,
        }
        for preset_name, preset_curve in preset_curves.items():
            if preset_curve["range"]["preset"] != preset_name:
                raise AssertionError(
                    f"Wealth curve preset echo mismatch for {preset_name}: "
                    f"got={preset_curve['range']['preset']}"
                )
            if not preset_curve["rows"] or int(preset_curve["range"]["points"]) <= 0:
                raise AssertionError(f"Wealth curve preset {preset_name} should return non-empty rows")
            if str(preset_curve["range"]["effective_to"]) != range_to:
                raise AssertionError(
                    f"Wealth curve preset {preset_name} effective_to mismatch: "
                    f"expected={range_to}, got={preset_curve['range']['effective_to']}"
                )
            if str(preset_curve["rows"][-1]["snapshot_date"]) != str(preset_curve["range"]["effective_to"]):
                raise AssertionError(
                    f"Wealth curve preset {preset_name} end row date mismatch: "
                    f"row={preset_curve['rows'][-1]['snapshot_date']}, "
                    f"range={preset_curve['range']['effective_to']}"
                )
            if int(preset_curve["summary"]["end_wealth_cents"]) != expected_wealth_cents:
                raise AssertionError(
                    f"Wealth curve preset {preset_name} end wealth mismatch: "
                    f"expected={expected_wealth_cents}, got={preset_curve['summary']['end_wealth_cents']}"
                )

        if str(wealth_curve_since_inception["range"]["effective_from"]) != "2025-01-15":
            raise AssertionError(
                "Wealth curve since_inception start mismatch: "
                f"got={wealth_curve_since_inception['range']['effective_from']}"
            )
        if str(wealth_curve_ytd["range"]["effective_from"]) != range_from:
            raise AssertionError(
                "Wealth curve ytd start mismatch: "
                f"expected={range_from}, got={wealth_curve_ytd['range']['effective_from']}"
            )
        if not (
            str(wealth_curve_since_inception["range"]["effective_from"])
            < str(wealth_curve_1y["range"]["effective_from"])
            < str(wealth_curve_ytd["range"]["effective_from"])
        ):
            raise AssertionError(
                "Wealth curve preset start ordering mismatch: "
                f"since_inception={wealth_curve_since_inception['range']['effective_from']}, "
                f"1y={wealth_curve_1y['range']['effective_from']}, "
                f"ytd={wealth_curve_ytd['range']['effective_from']}"
            )

        # Wealth include filters should affect only wealth total and rows selection.
        expected_wealth_without_investment = 5_500_000 + 80_000_000
        overview_without_investment = app_mod.query_wealth_overview(
            cfg,
            {
                "as_of": [range_to],
                "include_investment": ["false"],
                "include_cash": ["true"],
                "include_real_estate": ["true"],
            },
        )
        if int(overview_without_investment["summary"]["wealth_total_cents"]) != expected_wealth_without_investment:
            raise AssertionError(
                "Wealth overview filter mismatch: "
                f"expected={expected_wealth_without_investment}, "
                f"got={overview_without_investment['summary']['wealth_total_cents']}"
            )
        if int(overview_without_investment["summary"]["selected_rows_total_cents"]) != int(
            overview_without_investment["summary"]["wealth_total_cents"]
        ):
            raise AssertionError(
                "Wealth overview filter selected rows total mismatch: "
                f"selected={overview_without_investment['summary']['selected_rows_total_cents']}, "
                f"wealth={overview_without_investment['summary']['wealth_total_cents']}"
            )
        if not bool(overview_without_investment["summary"]["reconciliation_ok"]):
            raise AssertionError("Wealth overview filter reconciliation should be true")

        wealth_curve_without_investment = app_mod.query_wealth_curve(
            cfg,
            {
                "preset": ["custom"],
                "from": [range_from],
                "to": [range_to],
                "include_investment": ["false"],
                "include_cash": ["true"],
                "include_real_estate": ["true"],
            },
        )
        if int(wealth_curve_without_investment["summary"]["end_wealth_cents"]) != expected_wealth_without_investment:
            raise AssertionError(
                "Wealth curve filter mismatch: "
                f"expected={expected_wealth_without_investment}, "
                f"got={wealth_curve_without_investment['summary']['end_wealth_cents']}"
            )
        if int(wealth_curve_without_investment["summary"]["net_growth_cents"]) != int(
            wealth_curve_without_investment["rows"][-1]["wealth_net_growth_cents"]
        ):
            raise AssertionError(
                "Wealth curve filtered net growth mismatch: "
                f"summary={wealth_curve_without_investment['summary']['net_growth_cents']}, "
                f"row={wealth_curve_without_investment['rows'][-1]['wealth_net_growth_cents']}"
            )
        if int(wealth_curve_without_investment["summary"]["start_cash_cents"]) != int(
            wealth_curve_without_investment["rows"][0]["cash_total_cents"]
        ):
            raise AssertionError(
                "Wealth curve filtered start cash mismatch: "
                f"summary={wealth_curve_without_investment['summary']['start_cash_cents']}, "
                f"row={wealth_curve_without_investment['rows'][0]['cash_total_cents']}"
            )

        # All filters disabled should fail fast.
        for query_func, payload in (
            (
                app_mod.query_wealth_overview,
                {
                    "as_of": [range_to],
                    "include_investment": ["false"],
                    "include_cash": ["false"],
                    "include_real_estate": ["false"],
                    "include_liability": ["false"],
                },
            ),
            (
                app_mod.query_wealth_curve,
                {
                    "preset": ["custom"],
                    "from": [range_from],
                    "to": [range_to],
                    "include_investment": ["false"],
                    "include_cash": ["false"],
                    "include_real_estate": ["false"],
                    "include_liability": ["false"],
                },
            ),
        ):
            try:
                query_func(cfg, payload)
            except ValueError:
                pass
            else:
                raise AssertionError("All wealth filters disabled should raise ValueError")

        tx_result = app_mod.query_transactions(
            cfg,
            {"source_type": ["cmb_eml"], "limit": ["10"]},
        )
        if int(tx_result["summary"]["count"]) != 1:
            raise AssertionError(f"Transactions regression count mismatch: got={tx_result['summary']['count']}")
        tx_row = tx_result["rows"][0]
        if tx_row.get("expense_category") != "餐饮":
            raise AssertionError(
                "Transactions expense category mismatch: "
                f"expected=餐饮, got={tx_row.get('expense_category')}"
            )

        # Manual CRUD regression for investment records (M2+ ergonomics).
        inv_create = app_mod.upsert_manual_investment(
            cfg,
            {
                "account_name": "回归CRUD投资账户",
                "snapshot_date": "2026-02-10",
                "total_assets": "200.00",
                "transfer_amount": "10.00",
            },
        )
        inv_rows_created = app_mod.query_investments(
            cfg,
            {
                "account_id": [inv_create["account_id"]],
                "from": ["2026-02-01"],
                "to": ["2026-02-28"],
                "limit": ["10"],
            },
        )["rows"]
        if len(inv_rows_created) != 1 or not inv_rows_created[0].get("id"):
            raise AssertionError("Investment query should return record id for CRUD operations")
        inv_row_id = str(inv_rows_created[0]["id"])
        app_mod.update_investment_record(
            cfg,
            {
                "id": inv_row_id,
                "account_name": "回归CRUD投资账户",
                "snapshot_date": "2026-02-11",
                "total_assets": "230.00",
                "transfer_amount": "20.00",
            },
        )
        inv_rows_updated = app_mod.query_investments(
            cfg,
            {
                "account_id": [inv_create["account_id"]],
                "from": ["2026-02-01"],
                "to": ["2026-02-28"],
                "limit": ["10"],
            },
        )["rows"]
        if len(inv_rows_updated) != 1:
            raise AssertionError("Investment update should keep exactly one CRUD test row")
        inv_updated = inv_rows_updated[0]
        if str(inv_updated["snapshot_date"]) != "2026-02-11":
            raise AssertionError(
                f"Investment update snapshot_date mismatch: got={inv_updated['snapshot_date']}"
            )
        if int(inv_updated["total_assets_cents"]) != 23_000:
            raise AssertionError(
                f"Investment update total_assets mismatch: got={inv_updated['total_assets_cents']}"
            )
        if int(inv_updated["transfer_amount_cents"]) != 2_000:
            raise AssertionError(
                f"Investment update transfer_amount mismatch: got={inv_updated['transfer_amount_cents']}"
            )
        app_mod.delete_investment_record(cfg, {"id": inv_row_id})
        inv_rows_deleted = app_mod.query_investments(
            cfg,
            {
                "account_id": [inv_create["account_id"]],
                "from": ["2026-02-01"],
                "to": ["2026-02-28"],
                "limit": ["10"],
            },
        )["rows"]
        if inv_rows_deleted:
            raise AssertionError("Investment delete should remove CRUD test row")

        # Manual CRUD regression for asset valuations.
        asset_create = app_mod.upsert_manual_asset_valuation(
            cfg,
            {
                "asset_class": "cash",
                "account_name": "回归CRUD现金账户",
                "snapshot_date": "2026-02-10",
                "value": "88.00",
            },
        )
        asset_rows_created = app_mod.query_asset_valuations(
            cfg,
            {
                "account_id": [asset_create["account_id"]],
                "asset_class": ["cash"],
                "from": ["2026-02-01"],
                "to": ["2026-02-28"],
                "limit": ["10"],
            },
        )["rows"]
        if len(asset_rows_created) != 1 or not asset_rows_created[0].get("id"):
            raise AssertionError("Asset query should return record id for CRUD operations")
        asset_row_id = str(asset_rows_created[0]["id"])
        app_mod.update_asset_valuation(
            cfg,
            {
                "id": asset_row_id,
                "asset_class": "cash",
                "account_name": "回归CRUD现金账户",
                "snapshot_date": "2026-02-11",
                "value": "99.00",
            },
        )
        asset_rows_updated = app_mod.query_asset_valuations(
            cfg,
            {
                "account_id": [asset_create["account_id"]],
                "asset_class": ["cash"],
                "from": ["2026-02-01"],
                "to": ["2026-02-28"],
                "limit": ["10"],
            },
        )["rows"]
        if len(asset_rows_updated) != 1:
            raise AssertionError("Asset update should keep exactly one CRUD test row")
        asset_updated = asset_rows_updated[0]
        if str(asset_updated["snapshot_date"]) != "2026-02-11":
            raise AssertionError(f"Asset update snapshot_date mismatch: got={asset_updated['snapshot_date']}")
        if int(asset_updated["value_cents"]) != 9_900:
            raise AssertionError(f"Asset update value mismatch: got={asset_updated['value_cents']}")
        app_mod.delete_asset_valuation(cfg, {"id": asset_row_id})
        asset_rows_deleted = app_mod.query_asset_valuations(
            cfg,
            {
                "account_id": [asset_create["account_id"]],
                "asset_class": ["cash"],
                "from": ["2026-02-01"],
                "to": ["2026-02-28"],
                "limit": ["10"],
            },
        )["rows"]
        if asset_rows_deleted:
            raise AssertionError("Asset delete should remove CRUD test row")

        # Manual CRUD regression for liability valuations.
        liability_create = app_mod.upsert_manual_asset_valuation(
            cfg,
            {
                "asset_class": "liability",
                "account_name": "回归CRUD负债账户",
                "snapshot_date": "2026-02-10",
                "value": "120.00",
            },
        )
        liability_rows_created = app_mod.query_asset_valuations(
            cfg,
            {
                "account_id": [liability_create["account_id"]],
                "asset_class": ["liability"],
                "from": ["2026-02-01"],
                "to": ["2026-02-28"],
                "limit": ["10"],
            },
        )["rows"]
        if len(liability_rows_created) != 1 or not liability_rows_created[0].get("id"):
            raise AssertionError("Liability query should return record id for CRUD operations")
        liability_row_id = str(liability_rows_created[0]["id"])
        app_mod.update_asset_valuation(
            cfg,
            {
                "id": liability_row_id,
                "asset_class": "liability",
                "account_name": "回归CRUD负债账户",
                "snapshot_date": "2026-02-11",
                "value": "135.00",
            },
        )
        liability_rows_updated = app_mod.query_asset_valuations(
            cfg,
            {
                "account_id": [liability_create["account_id"]],
                "asset_class": ["liability"],
                "from": ["2026-02-01"],
                "to": ["2026-02-28"],
                "limit": ["10"],
            },
        )["rows"]
        if len(liability_rows_updated) != 1:
            raise AssertionError("Liability update should keep exactly one CRUD test row")
        liability_updated = liability_rows_updated[0]
        if str(liability_updated["snapshot_date"]) != "2026-02-11":
            raise AssertionError(
                f"Liability update snapshot_date mismatch: got={liability_updated['snapshot_date']}"
            )
        if int(liability_updated["value_cents"]) != 13_500:
            raise AssertionError(f"Liability update value mismatch: got={liability_updated['value_cents']}")
        liability_overview = app_mod.query_wealth_overview(
            cfg,
            {
                "as_of": ["2026-02-11"],
                "include_investment": ["false"],
                "include_cash": ["false"],
                "include_real_estate": ["false"],
                "include_liability": ["true"],
            },
        )
        if int(liability_overview["summary"]["liability_total_cents"]) != 13_500:
            raise AssertionError(
                "Liability overview total mismatch: "
                f"got={liability_overview['summary']['liability_total_cents']}"
            )
        if int(liability_overview["summary"]["net_asset_total_cents"]) != -13_500:
            raise AssertionError(
                "Liability overview net asset mismatch: "
                f"got={liability_overview['summary']['net_asset_total_cents']}"
            )
        if not bool(liability_overview["summary"]["reconciliation_ok"]):
            raise AssertionError("Liability overview reconciliation should be true")
        liability_curve = app_mod.query_wealth_curve(
            cfg,
            {
                "preset": ["custom"],
                "from": ["2026-02-10"],
                "to": ["2026-02-11"],
                "include_investment": ["false"],
                "include_cash": ["false"],
                "include_real_estate": ["false"],
                "include_liability": ["true"],
            },
        )
        if int(liability_curve["summary"]["end_liability_cents"]) != 13_500:
            raise AssertionError(
                "Liability curve end liability mismatch: "
                f"got={liability_curve['summary']['end_liability_cents']}"
            )
        if int(liability_curve["summary"]["end_net_asset_cents"]) != -13_500:
            raise AssertionError(
                "Liability curve end net asset mismatch: "
                f"got={liability_curve['summary']['end_net_asset_cents']}"
            )
        if int(liability_curve["rows"][-1]["net_asset_total_cents"]) != -13_500:
            raise AssertionError(
                "Liability curve end row net asset mismatch: "
                f"got={liability_curve['rows'][-1]['net_asset_total_cents']}"
            )
        app_mod.delete_asset_valuation(cfg, {"id": liability_row_id})
        liability_rows_deleted = app_mod.query_asset_valuations(
            cfg,
            {
                "account_id": [liability_create["account_id"]],
                "asset_class": ["liability"],
                "from": ["2026-02-01"],
                "to": ["2026-02-28"],
                "limit": ["10"],
            },
        )["rows"]
        if liability_rows_deleted:
            raise AssertionError("Liability delete should remove CRUD test row")

        # M4 baseline regression: monthly budget items + budget overview + FIRE progress.
        budget_items_before = app_mod.query_monthly_budget_items(cfg, {})
        if int(budget_items_before["summary"]["total_count"]) < 3:
            raise AssertionError("Budget item templates should be seeded by migration")
        budget_rows_by_name = {str(row["name"]): row for row in budget_items_before["rows"]}
        for required_name in ("房贷", "日常开销", "缴费"):
            if required_name not in budget_rows_by_name:
                raise AssertionError(f"Missing default budget template: {required_name}")

        app_mod.upsert_monthly_budget_item(
            cfg,
            {
                "id": budget_rows_by_name["房贷"]["id"],
                "name": "房贷",
                "monthly_amount": "6000.00",
                "sort_order": budget_rows_by_name["房贷"]["sort_order"],
                "is_active": True,
            },
        )
        app_mod.upsert_monthly_budget_item(
            cfg,
            {
                "id": budget_rows_by_name["日常开销"]["id"],
                "name": "日常开销",
                "monthly_amount": "3000.00",
                "sort_order": budget_rows_by_name["日常开销"]["sort_order"],
                "is_active": True,
            },
        )
        app_mod.upsert_monthly_budget_item(
            cfg,
            {
                "id": budget_rows_by_name["缴费"]["id"],
                "name": "缴费",
                "monthly_amount": "1000.00",
                "sort_order": budget_rows_by_name["缴费"]["sort_order"],
                "is_active": True,
            },
        )
        custom_budget_item = app_mod.upsert_monthly_budget_item(
            cfg,
            {
                "name": "娱乐",
                "monthly_amount": "500.00",
                "sort_order": 40,
                "is_active": False,
            },
        )
        budget_items_after = app_mod.query_monthly_budget_items(cfg, {})
        expected_monthly_budget_cents = 1_000_000  # 6000 + 3000 + 1000 元，未计入停用项“娱乐”
        expected_annual_budget_cents = expected_monthly_budget_cents * 12
        if int(budget_items_after["summary"]["monthly_budget_total_cents"]) != expected_monthly_budget_cents:
            raise AssertionError(
                "Budget monthly total mismatch: "
                f"expected={expected_monthly_budget_cents}, "
                f"got={budget_items_after['summary']['monthly_budget_total_cents']}"
            )
        if int(budget_items_after["summary"]["annual_budget_cents"]) != expected_annual_budget_cents:
            raise AssertionError(
                "Budget annual total mismatch: "
                f"expected={expected_annual_budget_cents}, "
                f"got={budget_items_after['summary']['annual_budget_cents']}"
            )

        budget_overview = app_mod.query_budget_overview(cfg, {"year": ["2026"]})
        if int(budget_overview["budget"]["monthly_total_cents"]) != expected_monthly_budget_cents:
            raise AssertionError("Budget overview monthly total mismatch")
        if int(budget_overview["budget"]["annual_total_cents"]) != expected_annual_budget_cents:
            raise AssertionError("Budget overview annual total mismatch")
        if int(budget_overview["actual"]["spent_total_cents"]) != 12_345:
            raise AssertionError(
                f"Budget overview actual spent mismatch: got={budget_overview['actual']['spent_total_cents']}"
            )
        test_today = datetime.now().date()
        if test_today.year < 2026:
            expected_elapsed_months = 0
        elif test_today.year > 2026:
            expected_elapsed_months = 12
        else:
            expected_elapsed_months = test_today.month
        if int(budget_overview["analysis_scope"]["elapsed_months"]) != expected_elapsed_months:
            raise AssertionError(
                "Budget overview elapsed months mismatch: "
                f"expected={expected_elapsed_months}, got={budget_overview['analysis_scope']['elapsed_months']}"
            )
        if int(budget_overview["budget"]["ytd_budget_cents"]) != expected_monthly_budget_cents * expected_elapsed_months:
            raise AssertionError("Budget overview YTD budget mismatch")
        if int(budget_overview["metrics"]["annual_remaining_cents"]) != (expected_annual_budget_cents - 12_345):
            raise AssertionError("Budget overview remaining budget mismatch")
        budget_monthly_review = app_mod.query_budget_monthly_review(cfg, {"year": ["2026"]})
        if len(budget_monthly_review["rows"]) != 12:
            raise AssertionError(
                f"Budget monthly review row count mismatch: got={len(budget_monthly_review['rows'])}"
            )
        jan_row = next((row for row in budget_monthly_review["rows"] if str(row["month_key"]) == "2026-01"), None)
        if not jan_row:
            raise AssertionError("Budget monthly review missing 2026-01 row")
        if int(jan_row["spent_cents"]) != 12_345:
            raise AssertionError(
                "Budget monthly review January spent mismatch: "
                f"got={jan_row['spent_cents']}"
            )
        if int(budget_monthly_review["summary"]["annual_spent_cents"]) != 12_345:
            raise AssertionError(
                "Budget monthly review annual spent mismatch: "
                f"got={budget_monthly_review['summary']['annual_spent_cents']}"
            )

        fire_progress = app_mod.query_fire_progress(cfg, {"year": ["2026"]})
        expected_investable_cents = 14_000_000 + 5_500_000
        if int(fire_progress["investable_assets"]["total_cents"]) != expected_investable_cents:
            raise AssertionError(
                "FIRE progress investable assets mismatch: "
                f"expected={expected_investable_cents}, got={fire_progress['investable_assets']['total_cents']}"
            )
        if not approx_equal(float(fire_progress["withdrawal_rate"]), 0.04, tol=1e-12):
            raise AssertionError(f"FIRE withdrawal rate mismatch: got={fire_progress['withdrawal_rate']}")
        expected_required_assets_cents = int(math.ceil(expected_annual_budget_cents / 0.04))
        if int(fire_progress["metrics"]["required_assets_cents"]) != expected_required_assets_cents:
            raise AssertionError(
                "FIRE required assets mismatch: "
                f"expected={expected_required_assets_cents}, got={fire_progress['metrics']['required_assets_cents']}"
            )
        expected_coverage_years = expected_investable_cents / expected_annual_budget_cents
        if not approx_equal(float(fire_progress["metrics"]["coverage_years"]), expected_coverage_years, tol=1e-8):
            raise AssertionError(
                "FIRE coverage years mismatch: "
                f"expected={expected_coverage_years}, got={fire_progress['metrics']['coverage_years']}"
            )
        expected_freedom_ratio = (expected_investable_cents * 0.04) / expected_annual_budget_cents
        if not approx_equal(float(fire_progress["metrics"]["freedom_ratio"]), expected_freedom_ratio, tol=1e-8):
            raise AssertionError(
                "FIRE freedom ratio mismatch: "
                f"expected={expected_freedom_ratio}, got={fire_progress['metrics']['freedom_ratio']}"
            )
        fire_progress_custom_rate = app_mod.query_fire_progress(
            cfg,
            {"year": ["2026"], "withdrawal_rate": ["0.035"]},
        )
        if not approx_equal(float(fire_progress_custom_rate["withdrawal_rate"]), 0.035, tol=1e-12):
            raise AssertionError(
                "FIRE custom withdrawal rate echo mismatch: "
                f"got={fire_progress_custom_rate['withdrawal_rate']}"
            )
        expected_custom_required_assets_cents = int(math.ceil(expected_annual_budget_cents / 0.035))
        if int(fire_progress_custom_rate["metrics"]["required_assets_cents"]) != expected_custom_required_assets_cents:
            raise AssertionError(
                "FIRE custom required assets mismatch: "
                f"expected={expected_custom_required_assets_cents}, "
                f"got={fire_progress_custom_rate['metrics']['required_assets_cents']}"
            )
        app_mod.delete_monthly_budget_item(cfg, {"id": custom_budget_item["id"]})

        conn = sqlite3.connect(db_path)
        try:
            with conn:
                conn.execute(
                    """
                    INSERT INTO import_jobs(id, source_type, source_file, status, started_at, total_count, imported_count, error_count)
                    VALUES (?, 'cmb_eml', 'regression.eml', 'success', datetime('now'), 1, 1, 0)
                    """,
                    (make_id("regression:import_job:cmb_eml"),),
                )
                conn.execute(
                    """
                    INSERT INTO import_jobs(id, source_type, source_file, status, started_at, total_count, imported_count, error_count)
                    VALUES (?, 'manual', 'manual', 'success', datetime('now'), 1, 1, 0)
                    """,
                    (make_id("regression:import_job:manual"),),
                )
                conn.execute(
                    """
                    INSERT INTO reconciliations(id, transaction_id, status)
                    VALUES (?, 'tx_reg_1', 'pending')
                    ON CONFLICT(transaction_id) DO UPDATE SET
                        status=excluded.status,
                        updated_at=datetime('now')
                    """,
                    (make_id("regression:recon:tx_reg_1"),),
                )
            inv_count_before_tx_reset = int(conn.execute("SELECT COUNT(*) FROM investment_records").fetchone()[0])
            asset_count_before_tx_reset = int(conn.execute("SELECT COUNT(*) FROM account_valuations").fetchone()[0])
            manual_jobs_before_tx_reset = int(
                conn.execute("SELECT COUNT(*) FROM import_jobs WHERE source_type='manual'").fetchone()[0]
            )
            tx_count_before_tx_reset = int(conn.execute("SELECT COUNT(*) FROM transactions").fetchone()[0])
            if tx_count_before_tx_reset <= 0:
                raise AssertionError("Regression setup failed: expected transactions before transaction reset")
        finally:
            conn.close()

        try:
            app_mod.reset_admin_transaction_data(cfg, confirm_text="WRONG")
        except ValueError:
            pass
        else:
            raise AssertionError("Admin transaction reset should reject wrong confirm text")

        tx_reset_result = app_mod.reset_admin_transaction_data(
            cfg,
            confirm_text=app_mod.ADMIN_RESET_CONFIRM_PHRASE,
        )
        if int(tx_reset_result["summary"]["total_rows_after"]) != 0:
            raise AssertionError(
                "Admin transaction reset failed: expected total_rows_after=0 for transaction scopes, "
                f"got={tx_reset_result['summary']['total_rows_after']}"
            )

        conn = sqlite3.connect(db_path)
        try:
            tx_count_after_tx_reset = int(conn.execute("SELECT COUNT(*) FROM transactions").fetchone()[0])
            recon_count_after_tx_reset = int(conn.execute("SELECT COUNT(*) FROM reconciliations").fetchone()[0])
            cmb_jobs_after_tx_reset = int(
                conn.execute("SELECT COUNT(*) FROM import_jobs WHERE source_type='cmb_eml'").fetchone()[0]
            )
            manual_jobs_after_tx_reset = int(
                conn.execute("SELECT COUNT(*) FROM import_jobs WHERE source_type='manual'").fetchone()[0]
            )
            inv_count_after_tx_reset = int(conn.execute("SELECT COUNT(*) FROM investment_records").fetchone()[0])
            asset_count_after_tx_reset = int(conn.execute("SELECT COUNT(*) FROM account_valuations").fetchone()[0])
        finally:
            conn.close()
        if tx_count_after_tx_reset != 0 or recon_count_after_tx_reset != 0 or cmb_jobs_after_tx_reset != 0:
            raise AssertionError(
                "Admin transaction reset should clear transactions/reconciliations/cmb_eml jobs: "
                f"tx={tx_count_after_tx_reset}, recon={recon_count_after_tx_reset}, cmb_jobs={cmb_jobs_after_tx_reset}"
            )
        if manual_jobs_after_tx_reset != manual_jobs_before_tx_reset:
            raise AssertionError(
                "Admin transaction reset should keep non-cmb import jobs: "
                f"before={manual_jobs_before_tx_reset}, after={manual_jobs_after_tx_reset}"
            )
        if inv_count_after_tx_reset != inv_count_before_tx_reset or asset_count_after_tx_reset != asset_count_before_tx_reset:
            raise AssertionError(
                "Admin transaction reset should not affect investment/asset records: "
                f"inv_before={inv_count_before_tx_reset}, inv_after={inv_count_after_tx_reset}, "
                f"asset_before={asset_count_before_tx_reset}, asset_after={asset_count_after_tx_reset}"
            )

        stats_before_reset = app_mod.query_admin_db_stats(cfg)
        if int(stats_before_reset["summary"]["total_rows"]) <= 0:
            raise AssertionError("Admin stats should report rows before reset")

        try:
            app_mod.reset_admin_db_data(cfg, confirm_text="WRONG")
        except ValueError:
            pass
        else:
            raise AssertionError("Admin reset should reject wrong confirm text")

        reset_result = app_mod.reset_admin_db_data(
            cfg,
            confirm_text=app_mod.ADMIN_RESET_CONFIRM_PHRASE,
        )
        if int(reset_result["summary"]["total_rows_after"]) != 0:
            raise AssertionError(
                "Admin reset failed: expected total_rows_after=0, "
                f"got={reset_result['summary']['total_rows_after']}"
            )

        return {
            "db_path": str(db_path),
            "expected_return_rate": round(expected_return, 10),
            "api_return_rate": got_return,
            "batch_return_rate": batch_row["return_rate"],
            "portfolio_return_rate": portfolio_rate,
            "curve_end_return_rate": curve_end,
            "curve_end_net_growth_cents": curve["summary"]["end_net_growth_cents"],
            "per_point_checked": per_point_checked,
            "import_inferred_assets_ok": True,
            "record_crud_ok": True,
            "wealth_total_cents": expected_wealth_cents,
            "wealth_overview_stale_account_count": overview["summary"]["stale_account_count"],
            "wealth_curve_net_growth_cents": wealth_curve["summary"]["net_growth_cents"],
            "wealth_total_without_investment_cents": expected_wealth_without_investment,
            "wealth_curve_points": wealth_curve["range"]["points"],
            "wealth_curve_presets_ok": True,
            "wealth_curve_preset_starts": {
                "since_inception": wealth_curve_since_inception["range"]["effective_from"],
                "1y": wealth_curve_1y["range"]["effective_from"],
                "ytd": wealth_curve_ytd["range"]["effective_from"],
            },
            "budget_monthly_total_cents": expected_monthly_budget_cents,
            "fire_investable_assets_cents": expected_investable_cents,
            "admin_reset_deleted_rows": reset_result["summary"]["deleted_rows"],
            "admin_transaction_reset_ok": True,
            "eml_incremental_dedupe_ok": True,
        }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run M1 analytics regression checks")
    parser.add_argument(
        "--root",
        type=Path,
        default=Path(__file__).resolve().parents[1],
        help="Project root (default: repo root)",
    )
    parser.add_argument("--json", action="store_true", help="Output JSON only")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    result = run_regression(args.root.resolve())
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return

    print("M1 回归校验通过。")
    print(f"  expected_return_rate: {result['expected_return_rate']}")
    print(f"  api_return_rate: {result['api_return_rate']}")
    print(f"  batch_return_rate: {result['batch_return_rate']}")
    print(f"  portfolio_return_rate: {result['portfolio_return_rate']}")
    print(f"  curve_end_return_rate: {result['curve_end_return_rate']}")
    print(f"  curve_end_net_growth_cents: {result['curve_end_net_growth_cents']}")
    print(f"  per_point_checked: {result['per_point_checked']}")
    print(f"  import_inferred_assets_ok: {result['import_inferred_assets_ok']}")
    print(f"  record_crud_ok: {result['record_crud_ok']}")
    print(f"  wealth_total_cents: {result['wealth_total_cents']}")
    print(f"  wealth_overview_stale_account_count: {result['wealth_overview_stale_account_count']}")
    print(f"  wealth_curve_net_growth_cents: {result['wealth_curve_net_growth_cents']}")
    print(f"  wealth_curve_points: {result['wealth_curve_points']}")
    print(f"  wealth_curve_presets_ok: {result['wealth_curve_presets_ok']}")
    print(f"  wealth_curve_preset_starts: {result['wealth_curve_preset_starts']}")
    print(f"  budget_monthly_total_cents: {result['budget_monthly_total_cents']}")
    print(f"  fire_investable_assets_cents: {result['fire_investable_assets_cents']}")
    print(f"  admin_reset_deleted_rows: {result['admin_reset_deleted_rows']}")
    print(f"  admin_transaction_reset_ok: {result['admin_transaction_reset_ok']}")
    print(f"  eml_incremental_dedupe_ok: {result['eml_incremental_dedupe_ok']}")


if __name__ == "__main__":
    main()
