use super::*;

pub(super) fn build_single_account_investment_return_payload(
    conn: &Connection,
    account_id: &str,
    preset: &str,
    from_raw: &str,
    to_raw: &str,
) -> Result<Value, String> {
    let bounds = load_investment_account_bounds(conn, account_id)?;
    let window = resolve_window(preset, from_raw, to_raw, bounds.earliest, bounds.latest)?;

    let begin_row =
        select_begin_snapshot(conn, account_id, window.effective_from, window.effective_to)?
            .ok_or_else(|| "区间内没有可用的期初资产记录".to_string())?;
    let begin_date = begin_row.snapshot_date;
    let begin_assets = begin_row.total_assets_cents;

    let end_row = select_end_snapshot(conn, account_id, begin_date, window.effective_to)?
        .ok_or_else(|| "区间内没有可用的期末资产记录".to_string())?;
    let end_date = end_row.snapshot_date;
    if begin_date >= end_date {
        return Err("区间内有效快照不足，无法计算收益率".to_string());
    }
    let end_assets = end_row.total_assets_cents;

    let flow_rows = load_transfer_rows(conn, account_id, begin_date, end_date)?;
    let calc = calculate_modified_dietz(
        begin_date,
        end_date,
        begin_assets,
        end_assets,
        &flow_rows,
        false,
    )?;

    let requested_to = if to_raw.trim().is_empty() {
        window.latest.format("%Y-%m-%d").to_string()
    } else {
        parse_iso_date(to_raw, "to")?.format("%Y-%m-%d").to_string()
    };
    let return_rate = calc.return_rate.map(|v| round_to(v, 8));
    let annualized_rate = calc.annualized_rate.map(|v| round_to(v, 8));

    Ok(json!({
        "account_id": account_id,
        "account_name": bounds.account_name,
        "range": {
            "preset": preset,
            "requested_from": window.requested_from.format("%Y-%m-%d").to_string(),
            "requested_to": requested_to,
            "effective_from": begin_date.format("%Y-%m-%d").to_string(),
            "effective_to": end_date.format("%Y-%m-%d").to_string(),
            "interval_days": calc.interval_days,
        },
        "metrics": {
            "begin_assets_cents": begin_assets,
            "begin_assets_yuan": cents_to_yuan_text(begin_assets),
            "end_assets_cents": end_assets,
            "end_assets_yuan": cents_to_yuan_text(end_assets),
            "net_flow_cents": calc.net_flow_cents,
            "net_flow_yuan": cents_to_yuan_text(calc.net_flow_cents),
            "profit_cents": calc.profit_cents,
            "profit_yuan": cents_to_yuan_text(calc.profit_cents),
            "net_growth_cents": calc.profit_cents,
            "net_growth_yuan": cents_to_yuan_text(calc.profit_cents),
            "weighted_capital_cents": calc.weighted_capital_cents,
            "weighted_capital_yuan": cents_to_yuan_text(calc.weighted_capital_cents),
            "return_rate": return_rate,
            "return_rate_pct": return_rate.map(|v| format!("{:.2}%", v * 100.0)),
            "annualized_rate": annualized_rate,
            "annualized_rate_pct": annualized_rate.map(|v| format!("{:.2}%", v * 100.0)),
            "note": calc.note,
        },
        "cash_flows": calc.cash_flows,
    }))
}

pub(super) fn build_portfolio_investment_return_payload(
    conn: &Connection,
    preset: &str,
    from_raw: &str,
    to_raw: &str,
) -> Result<Value, String> {
    let bounds = load_portfolio_bounds(conn)?;
    let window = resolve_window(preset, from_raw, to_raw, bounds.earliest, bounds.latest)?;
    if window.effective_from >= window.effective_to {
        return Err("区间内有效快照不足，无法计算收益率".to_string());
    }

    let mut dates = Vec::<NaiveDate>::new();
    let mut stmt = conn
        .prepare(
            r#"
            SELECT DISTINCT snapshot_date
            FROM investment_records
            WHERE snapshot_date >= ?1 AND snapshot_date <= ?2
            ORDER BY snapshot_date ASC
            "#,
        )
        .map_err(|e| format!("查询组合日期点失败: {e}"))?;
    let rows = stmt
        .query_map(
            params![
                window.effective_from.format("%Y-%m-%d").to_string(),
                window.effective_to.format("%Y-%m-%d").to_string()
            ],
            |row| row.get::<_, String>(0),
        )
        .map_err(|e| format!("查询组合日期点失败: {e}"))?;
    for row in rows {
        let d = parse_db_date(
            row.map_err(|e| format!("读取组合日期点失败: {e}"))?,
            "snapshot_date",
        )?;
        dates.push(d);
    }
    if !dates.contains(&window.effective_from) {
        dates.push(window.effective_from);
    }
    if !dates.contains(&window.effective_to) {
        dates.push(window.effective_to);
    }
    dates.sort_unstable();
    dates.dedup();

    let mut history_stmt = conn
        .prepare(
            r#"
            SELECT account_id, snapshot_date, total_assets_cents AS value_cents, transfer_amount_cents AS flow_cents
            FROM investment_records
            WHERE snapshot_date <= ?1
            ORDER BY account_id, snapshot_date
            "#,
        )
        .map_err(|e| format!("查询组合历史失败: {e}"))?;
    let history_iter = history_stmt
        .query_map(
            params![window.effective_to.format("%Y-%m-%d").to_string()],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            },
        )
        .map_err(|e| format!("查询组合历史失败: {e}"))?;

    let mut history_rows = Vec::new();
    for row in history_iter {
        let (account_id, snapshot_date_raw, value_cents, flow_cents) =
            row.map_err(|e| format!("读取组合历史失败: {e}"))?;
        history_rows.push(PortfolioHistoryRow {
            account_id,
            snapshot_date: parse_db_date(snapshot_date_raw, "snapshot_date")?,
            value_cents,
            flow_cents,
        });
    }
    if history_rows.is_empty() {
        return Err("区间内没有可用的投资记录".to_string());
    }

    let totals = build_portfolio_asof_totals(&dates, &history_rows);
    let begin_assets = *totals
        .get(&window.effective_from.format("%Y-%m-%d").to_string())
        .unwrap_or(&0);
    let end_assets = *totals
        .get(&window.effective_to.format("%Y-%m-%d").to_string())
        .unwrap_or(&0);

    let mut flow_stmt = conn
        .prepare(
            r#"
            SELECT snapshot_date, COALESCE(SUM(transfer_amount_cents), 0) AS transfer_amount_cents
            FROM investment_records
            WHERE snapshot_date > ?1 AND snapshot_date <= ?2 AND transfer_amount_cents != 0
            GROUP BY snapshot_date
            HAVING COALESCE(SUM(transfer_amount_cents), 0) != 0
            ORDER BY snapshot_date ASC
            "#,
        )
        .map_err(|e| format!("查询组合资金流失败: {e}"))?;
    let flow_iter = flow_stmt
        .query_map(
            params![
                window.effective_from.format("%Y-%m-%d").to_string(),
                window.effective_to.format("%Y-%m-%d").to_string()
            ],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
        )
        .map_err(|e| format!("查询组合资金流失败: {e}"))?;
    let mut flow_rows = Vec::new();
    for row in flow_iter {
        let (d_raw, amount) = row.map_err(|e| format!("读取组合资金流失败: {e}"))?;
        flow_rows.push(TransferRow {
            snapshot_date: parse_db_date(d_raw, "snapshot_date")?,
            transfer_amount_cents: amount,
        });
    }
    let calc = calculate_modified_dietz(
        window.effective_from,
        window.effective_to,
        begin_assets,
        end_assets,
        &flow_rows,
        false,
    )?;

    let requested_to = if to_raw.trim().is_empty() {
        window.latest.format("%Y-%m-%d").to_string()
    } else {
        parse_iso_date(to_raw, "to")?.format("%Y-%m-%d").to_string()
    };
    let return_rate = calc.return_rate.map(|v| round_to(v, 8));
    let annualized_rate = calc.annualized_rate.map(|v| round_to(v, 8));

    Ok(json!({
        "account_id": PORTFOLIO_ACCOUNT_ID,
        "account_name": PORTFOLIO_ACCOUNT_NAME,
        "account_count": bounds.account_count,
        "range": {
            "preset": preset,
            "requested_from": window.requested_from.format("%Y-%m-%d").to_string(),
            "requested_to": requested_to,
            "effective_from": window.effective_from.format("%Y-%m-%d").to_string(),
            "effective_to": window.effective_to.format("%Y-%m-%d").to_string(),
            "interval_days": calc.interval_days,
        },
        "metrics": {
            "begin_assets_cents": begin_assets,
            "begin_assets_yuan": cents_to_yuan_text(begin_assets),
            "end_assets_cents": end_assets,
            "end_assets_yuan": cents_to_yuan_text(end_assets),
            "net_flow_cents": calc.net_flow_cents,
            "net_flow_yuan": cents_to_yuan_text(calc.net_flow_cents),
            "profit_cents": calc.profit_cents,
            "profit_yuan": cents_to_yuan_text(calc.profit_cents),
            "net_growth_cents": calc.profit_cents,
            "net_growth_yuan": cents_to_yuan_text(calc.profit_cents),
            "weighted_capital_cents": calc.weighted_capital_cents,
            "weighted_capital_yuan": cents_to_yuan_text(calc.weighted_capital_cents),
            "return_rate": return_rate,
            "return_rate_pct": return_rate.map(|v| format!("{:.2}%", v * 100.0)),
            "annualized_rate": annualized_rate,
            "annualized_rate_pct": annualized_rate.map(|v| format!("{:.2}%", v * 100.0)),
            "note": calc.note,
        },
        "cash_flows": calc.cash_flows,
    }))
}
