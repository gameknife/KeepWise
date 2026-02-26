#!/usr/bin/env python3
"""Wealth overview and wealth curve analytics service for KeepWise web app."""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any, Protocol

import investment_analytics_service as investment_service


class WealthConfigLike(Protocol):
    db_path: Path


def parse_bool_param(raw: str, *, default: bool) -> bool:
    text = (raw or "").strip().lower()
    if not text:
        return default
    if text in {"1", "true", "yes", "y", "on"}:
        return True
    if text in {"0", "false", "no", "n", "off"}:
        return False
    raise ValueError(f"布尔参数不合法: {raw}")


def query_wealth_overview(config: WealthConfigLike, qs: dict[str, list[str]]) -> dict[str, Any]:
    parse_iso_date = investment_service.parse_iso_date
    cents_to_yuan_text = investment_service.cents_to_yuan_text

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


def query_wealth_curve(config: WealthConfigLike, qs: dict[str, list[str]]) -> dict[str, Any]:
    parse_preset = investment_service.parse_preset
    parse_iso_date = investment_service.parse_iso_date
    resolve_window = investment_service.resolve_window
    build_asof_totals = investment_service.build_asof_totals
    cents_to_yuan_text = investment_service.cents_to_yuan_text

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
