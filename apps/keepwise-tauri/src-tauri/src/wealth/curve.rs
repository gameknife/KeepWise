use super::*;

fn load_investment_history_for_curve(
    conn: &Connection,
    effective_to: NaiveDate,
) -> Result<Vec<AsOfHistoryRow>, String> {
    let mut stmt = conn
        .prepare(
            r#"
            SELECT
                account_id,
                snapshot_date,
                total_assets_cents AS value_cents,
                transfer_amount_cents AS flow_cents
            FROM investment_records
            WHERE snapshot_date <= ?1
            ORDER BY account_id, snapshot_date
            "#,
        )
        .map_err(|e| format!("查询投资历史失败: {e}"))?;
    let iter = stmt
        .query_map(
            params![effective_to.format("%Y-%m-%d").to_string()],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            },
        )
        .map_err(|e| format!("查询投资历史失败: {e}"))?;
    let mut out = Vec::new();
    for row in iter {
        let (account_id, date_raw, value_cents, flow_cents) =
            row.map_err(|e| format!("读取投资历史失败: {e}"))?;
        out.push(AsOfHistoryRow {
            account_id,
            snapshot_date: parse_iso_date(&date_raw, "snapshot_date")?,
            value_cents,
            flow_cents,
        });
    }
    Ok(out)
}

fn load_asset_history_for_curve(
    conn: &Connection,
    asset_class: &str,
    effective_to: NaiveDate,
) -> Result<Vec<AsOfHistoryRow>, String> {
    let mut stmt = conn
        .prepare(
            r#"
            SELECT account_id, snapshot_date, value_cents
            FROM account_valuations
            WHERE asset_class = ?1 AND snapshot_date <= ?2
            ORDER BY account_id, snapshot_date
            "#,
        )
        .map_err(|e| format!("查询资产历史失败 ({asset_class}): {e}"))?;
    let iter = stmt
        .query_map(
            params![asset_class, effective_to.format("%Y-%m-%d").to_string()],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            },
        )
        .map_err(|e| format!("查询资产历史失败 ({asset_class}): {e}"))?;
    let mut out = Vec::new();
    for row in iter {
        let (account_id, date_raw, value_cents) =
            row.map_err(|e| format!("读取资产历史失败 ({asset_class}): {e}"))?;
        out.push(AsOfHistoryRow {
            account_id,
            snapshot_date: parse_iso_date(&date_raw, "snapshot_date")?,
            value_cents,
            flow_cents: 0,
        });
    }
    Ok(out)
}

pub fn wealth_curve_query_at_db_path(
    db_path: &Path,
    req: WealthCurveQueryRequest,
) -> Result<Value, String> {
    let preset = parse_preset_with_default(req.preset.as_deref(), "1y")?;
    let from_raw = req.from_date.unwrap_or_default();
    let to_raw = req.to_date.unwrap_or_default();
    let filters = parse_wealth_filters(
        req.include_investment.as_deref(),
        req.include_cash.as_deref(),
        req.include_real_estate.as_deref(),
        req.include_liability.as_deref(),
    )?;

    let conn = Connection::open(db_path).map_err(|e| format!("打开数据库失败: {e}"))?;
    let (earliest, latest) =
        query_union_bounds(&conn)?.ok_or_else(|| "当前没有可用于曲线展示的数据".to_string())?;
    let window = resolve_window(&preset, &from_raw, &to_raw, earliest, latest)?;

    let mut date_stmt = conn
        .prepare(
            r#"
            SELECT snapshot_date
            FROM (
                SELECT snapshot_date FROM investment_records WHERE snapshot_date >= ?1 AND snapshot_date <= ?2
                UNION
                SELECT snapshot_date FROM account_valuations WHERE snapshot_date >= ?3 AND snapshot_date <= ?4
            )
            ORDER BY snapshot_date ASC
            "#,
        )
        .map_err(|e| format!("查询财富曲线日期点失败: {e}"))?;
    let date_iter = date_stmt
        .query_map(
            params![
                window.effective_from.format("%Y-%m-%d").to_string(),
                window.effective_to.format("%Y-%m-%d").to_string(),
                window.effective_from.format("%Y-%m-%d").to_string(),
                window.effective_to.format("%Y-%m-%d").to_string()
            ],
            |row| row.get::<_, String>(0),
        )
        .map_err(|e| format!("查询财富曲线日期点失败: {e}"))?;

    let mut date_set = Vec::<NaiveDate>::new();
    for row in date_iter {
        let d_raw = row.map_err(|e| format!("读取财富曲线日期点失败: {e}"))?;
        date_set.push(parse_iso_date(&d_raw, "snapshot_date")?);
    }
    date_set.push(window.effective_from);
    date_set.push(window.effective_to);
    date_set.sort_unstable();
    date_set.dedup();
    let dates = date_set;

    let investment_history = load_investment_history_for_curve(&conn, window.effective_to)?;
    let cash_history = load_asset_history_for_curve(&conn, "cash", window.effective_to)?;
    let real_estate_history =
        load_asset_history_for_curve(&conn, "real_estate", window.effective_to)?;
    let liability_history = load_asset_history_for_curve(&conn, "liability", window.effective_to)?;

    let investment_totals = build_asof_totals(&dates, &investment_history);
    let cash_totals = build_asof_totals(&dates, &cash_history);
    let real_estate_totals = build_asof_totals(&dates, &real_estate_history);
    let liability_totals = build_asof_totals(&dates, &liability_history);

    let mut rows = Vec::<Value>::new();
    let mut first_investment_total = 0_i64;
    let mut first_cash_total = 0_i64;
    let mut first_real_estate_total = 0_i64;
    let mut first_liability_total = 0_i64;
    let mut first_wealth_total = 0_i64;
    let mut first_net_asset_total = 0_i64;

    for d in &dates {
        let key = d.format("%Y-%m-%d").to_string();
        let inv = *investment_totals.get(&key).unwrap_or(&0);
        let cash = *cash_totals.get(&key).unwrap_or(&0);
        let re = *real_estate_totals.get(&key).unwrap_or(&0);
        let liability = *liability_totals.get(&key).unwrap_or(&0);

        let wealth = (if filters.include_investment { inv } else { 0 })
            + (if filters.include_cash { cash } else { 0 })
            + (if filters.include_real_estate { re } else { 0 });
        let selected_liability = if filters.include_liability {
            liability
        } else {
            0
        };
        let net_asset = wealth - selected_liability;

        if rows.is_empty() {
            first_investment_total = inv;
            first_cash_total = cash;
            first_real_estate_total = re;
            first_liability_total = liability;
            first_wealth_total = wealth;
            first_net_asset_total = net_asset;
        }

        let wealth_net_growth_cents = wealth - first_wealth_total;
        let liability_net_growth_cents = liability - first_liability_total;
        let net_asset_net_growth_cents = net_asset - first_net_asset_total;
        let investment_net_growth_cents = inv - first_investment_total;
        let cash_net_growth_cents = cash - first_cash_total;
        let real_estate_net_growth_cents = re - first_real_estate_total;

        rows.push(json!({
            "snapshot_date": key,
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
        }));
    }

    let first_total = rows
        .first()
        .and_then(Value::as_object)
        .and_then(|o| o.get("wealth_total_cents"))
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let last_total = rows
        .last()
        .and_then(Value::as_object)
        .and_then(|o| o.get("wealth_total_cents"))
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let change_cents = last_total - first_total;
    let change_pct = if first_total > 0 {
        Some(change_cents as f64 / first_total as f64)
    } else {
        None
    };

    let start_liability_cents = rows
        .first()
        .and_then(Value::as_object)
        .and_then(|o| o.get("liability_total_cents"))
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let end_liability_cents = rows
        .last()
        .and_then(Value::as_object)
        .and_then(|o| o.get("liability_total_cents"))
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let liability_total_change_cents = end_liability_cents - start_liability_cents;
    let liability_change_pct = if start_liability_cents > 0 {
        Some(liability_total_change_cents as f64 / start_liability_cents as f64)
    } else {
        None
    };

    let start_net_asset_cents = rows
        .first()
        .and_then(Value::as_object)
        .and_then(|o| o.get("net_asset_total_cents"))
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let end_net_asset_cents = rows
        .last()
        .and_then(Value::as_object)
        .and_then(|o| o.get("net_asset_total_cents"))
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let net_asset_change_cents = end_net_asset_cents - start_net_asset_cents;
    let net_asset_change_pct = if start_net_asset_cents > 0 {
        Some(net_asset_change_cents as f64 / start_net_asset_cents as f64)
    } else {
        None
    };

    let start_investment_cents = rows
        .first()
        .and_then(Value::as_object)
        .and_then(|o| o.get("investment_total_cents"))
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let end_investment_cents = rows
        .last()
        .and_then(Value::as_object)
        .and_then(|o| o.get("investment_total_cents"))
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let investment_net_growth_cents = end_investment_cents - start_investment_cents;
    let investment_change_pct = if start_investment_cents > 0 {
        Some(investment_net_growth_cents as f64 / start_investment_cents as f64)
    } else {
        None
    };

    let start_cash_cents = rows
        .first()
        .and_then(Value::as_object)
        .and_then(|o| o.get("cash_total_cents"))
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let end_cash_cents = rows
        .last()
        .and_then(Value::as_object)
        .and_then(|o| o.get("cash_total_cents"))
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let cash_net_growth_cents = end_cash_cents - start_cash_cents;
    let cash_change_pct = if start_cash_cents > 0 {
        Some(cash_net_growth_cents as f64 / start_cash_cents as f64)
    } else {
        None
    };

    let start_real_estate_cents = rows
        .first()
        .and_then(Value::as_object)
        .and_then(|o| o.get("real_estate_total_cents"))
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let end_real_estate_cents = rows
        .last()
        .and_then(Value::as_object)
        .and_then(|o| o.get("real_estate_total_cents"))
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let real_estate_net_growth_cents = end_real_estate_cents - start_real_estate_cents;
    let real_estate_change_pct = if start_real_estate_cents > 0 {
        Some(real_estate_net_growth_cents as f64 / start_real_estate_cents as f64)
    } else {
        None
    };

    let requested_to = if to_raw.trim().is_empty() {
        window.latest.format("%Y-%m-%d").to_string()
    } else {
        parse_iso_date(&to_raw, "to")?
            .format("%Y-%m-%d")
            .to_string()
    };
    let effective_from_out = rows
        .first()
        .and_then(Value::as_object)
        .and_then(|o| o.get("snapshot_date"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| window.effective_from.format("%Y-%m-%d").to_string());
    let effective_to_out = rows
        .last()
        .and_then(Value::as_object)
        .and_then(|o| o.get("snapshot_date"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| window.effective_to.format("%Y-%m-%d").to_string());

    let range = json!({
        "preset": preset,
        "requested_from": window.requested_from.format("%Y-%m-%d").to_string(),
        "requested_to": requested_to,
        "effective_from": effective_from_out,
        "effective_to": effective_to_out,
        "points": rows.len(),
    });
    let filters_json = json!({
        "include_investment": filters.include_investment,
        "include_cash": filters.include_cash,
        "include_real_estate": filters.include_real_estate,
        "include_liability": filters.include_liability,
    });
    let summary = json!({
            "start_wealth_cents": first_total,
            "start_wealth_yuan": cents_to_yuan_text(first_total),
            "end_wealth_cents": last_total,
            "end_wealth_yuan": cents_to_yuan_text(last_total),
            "change_cents": change_cents,
            "change_yuan": cents_to_yuan_text(change_cents),
            "net_growth_cents": change_cents,
            "net_growth_yuan": cents_to_yuan_text(change_cents),
            "change_pct": change_pct.map(|v| round_to(v, 8)),
            "change_pct_text": change_pct.map(|v| format!("{:.2}%", v * 100.0)),
            "start_liability_cents": start_liability_cents,
            "start_liability_yuan": cents_to_yuan_text(start_liability_cents),
            "end_liability_cents": end_liability_cents,
            "end_liability_yuan": cents_to_yuan_text(end_liability_cents),
            "liability_net_growth_cents": liability_total_change_cents,
            "liability_net_growth_yuan": cents_to_yuan_text(liability_total_change_cents),
            "liability_change_pct": liability_change_pct.map(|v| round_to(v, 8)),
            "liability_change_pct_text": liability_change_pct.map(|v| format!("{:.2}%", v * 100.0)),
            "start_net_asset_cents": start_net_asset_cents,
            "start_net_asset_yuan": cents_to_yuan_text(start_net_asset_cents),
            "end_net_asset_cents": end_net_asset_cents,
            "end_net_asset_yuan": cents_to_yuan_text(end_net_asset_cents),
            "net_asset_change_cents": net_asset_change_cents,
            "net_asset_change_yuan": cents_to_yuan_text(net_asset_change_cents),
            "net_asset_net_growth_cents": net_asset_change_cents,
            "net_asset_net_growth_yuan": cents_to_yuan_text(net_asset_change_cents),
            "net_asset_change_pct": net_asset_change_pct.map(|v| round_to(v, 8)),
            "net_asset_change_pct_text": net_asset_change_pct.map(|v| format!("{:.2}%", v * 100.0)),
            "start_investment_cents": start_investment_cents,
            "start_investment_yuan": cents_to_yuan_text(start_investment_cents),
            "end_investment_cents": end_investment_cents,
            "end_investment_yuan": cents_to_yuan_text(end_investment_cents),
            "investment_net_growth_cents": investment_net_growth_cents,
            "investment_net_growth_yuan": cents_to_yuan_text(investment_net_growth_cents),
            "investment_change_pct": investment_change_pct.map(|v| round_to(v, 8)),
            "investment_change_pct_text": investment_change_pct.map(|v| format!("{:.2}%", v * 100.0)),
            "start_cash_cents": start_cash_cents,
            "start_cash_yuan": cents_to_yuan_text(start_cash_cents),
            "end_cash_cents": end_cash_cents,
            "end_cash_yuan": cents_to_yuan_text(end_cash_cents),
            "cash_net_growth_cents": cash_net_growth_cents,
            "cash_net_growth_yuan": cents_to_yuan_text(cash_net_growth_cents),
            "cash_change_pct": cash_change_pct.map(|v| round_to(v, 8)),
            "cash_change_pct_text": cash_change_pct.map(|v| format!("{:.2}%", v * 100.0)),
            "start_real_estate_cents": start_real_estate_cents,
            "start_real_estate_yuan": cents_to_yuan_text(start_real_estate_cents),
            "end_real_estate_cents": end_real_estate_cents,
            "end_real_estate_yuan": cents_to_yuan_text(end_real_estate_cents),
            "real_estate_net_growth_cents": real_estate_net_growth_cents,
            "real_estate_net_growth_yuan": cents_to_yuan_text(real_estate_net_growth_cents),
            "real_estate_change_pct": real_estate_change_pct.map(|v| round_to(v, 8)),
            "real_estate_change_pct_text": real_estate_change_pct.map(|v| format!("{:.2}%", v * 100.0)),
    });

    Ok(json!({
        "range": range,
        "filters": filters_json,
        "summary": summary,
        "rows": rows,
    }))
}
