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
import json
import math
import sqlite3
import tempfile
import uuid
from pathlib import Path
from typing import Any

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


def run_regression(root: Path) -> dict[str, Any]:
    with tempfile.TemporaryDirectory(prefix="keepwise-m1-regression-") as tmp_dir:
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

        curve_end = curve["summary"]["end_cumulative_return_rate"]
        if not approx_equal(got_return, curve_end, tol=1e-8):
            raise AssertionError(
                f"Curve end return mismatch: return={got_return}, curve_end={curve_end}"
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

        curve_start = curve["range"]["effective_from"]
        per_point_checked = 0
        for row in curve["rows"]:
            point_date = str(row["snapshot_date"])
            if point_date <= curve_start:
                continue
            point_ret = app_mod.query_investment_return(
                cfg,
                {
                    "account_id": [account_id],
                    "preset": ["custom"],
                    "from": [curve_start],
                    "to": [point_date],
                },
            )["metrics"]["return_rate"]
            point_curve = row["cumulative_return_rate"]
            if not approx_equal(point_ret, point_curve, tol=1e-8):
                raise AssertionError(
                    f"Per-point mismatch at {point_date}: return={point_ret}, curve={point_curve}"
                )
            per_point_checked += 1

        overview = app_mod.query_wealth_overview(cfg, {"as_of": [range_to]})
        expected_wealth_cents = 14_000_000 + 5_500_000 + 80_000_000
        if int(overview["summary"]["wealth_total_cents"]) != expected_wealth_cents:
            raise AssertionError(
                f"Wealth overview mismatch: expected={expected_wealth_cents}, "
                f"got={overview['summary']['wealth_total_cents']}"
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

        # All filters disabled should fail fast.
        for query_func, payload in (
            (
                app_mod.query_wealth_overview,
                {
                    "as_of": [range_to],
                    "include_investment": ["false"],
                    "include_cash": ["false"],
                    "include_real_estate": ["false"],
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
            "curve_end_return_rate": curve_end,
            "per_point_checked": per_point_checked,
            "wealth_total_cents": expected_wealth_cents,
            "wealth_total_without_investment_cents": expected_wealth_without_investment,
            "wealth_curve_points": wealth_curve["range"]["points"],
            "admin_reset_deleted_rows": reset_result["summary"]["deleted_rows"],
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
    print(f"  curve_end_return_rate: {result['curve_end_return_rate']}")
    print(f"  per_point_checked: {result['per_point_checked']}")
    print(f"  wealth_total_cents: {result['wealth_total_cents']}")
    print(f"  wealth_curve_points: {result['wealth_curve_points']}")
    print(f"  admin_reset_deleted_rows: {result['admin_reset_deleted_rows']}")


if __name__ == "__main__":
    main()
