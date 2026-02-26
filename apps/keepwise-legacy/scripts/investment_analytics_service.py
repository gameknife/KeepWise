#!/usr/bin/env python3
"""Investment analytics helper functions extracted from keepwise_web_app."""

from __future__ import annotations

import sqlite3
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Protocol

SUPPORTED_PRESETS = {"ytd", "1y", "3y", "since_inception", "custom"}
PORTFOLIO_ACCOUNT_ID = "__portfolio__"
PORTFOLIO_ACCOUNT_NAME = "全部投资账户（组合）"


class InvestmentConfigLike(Protocol):
    db_path: Path


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


def query_investment_return(config: InvestmentConfigLike, qs: dict[str, list[str]]) -> dict[str, Any]:
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


def query_investment_returns(config: InvestmentConfigLike, qs: dict[str, list[str]]) -> dict[str, Any]:
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


def query_investment_curve(config: InvestmentConfigLike, qs: dict[str, list[str]]) -> dict[str, Any]:
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
