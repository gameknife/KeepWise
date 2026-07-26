use super::*;

fn build_single_account_investment_curve_payload(
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

    let final_end_row = select_end_snapshot(conn, account_id, begin_date, window.effective_to)?
        .ok_or_else(|| "区间内没有可用的期末资产记录".to_string())?;
    let final_end_date = final_end_row.snapshot_date;
    if final_end_date < begin_date {
        return Err("区间内有效快照不足，无法生成曲线".to_string());
    }

    let mut date_stmt = conn
        .prepare(
            r#"
            SELECT DISTINCT snapshot_date
            FROM investment_records
            WHERE account_id = ?1 AND snapshot_date >= ?2 AND snapshot_date <= ?3
            ORDER BY snapshot_date ASC
            "#,
        )
        .map_err(|e| format!("查询投资曲线日期点失败: {e}"))?;
    let date_iter = date_stmt
        .query_map(
            params![
                account_id,
                begin_date.format("%Y-%m-%d").to_string(),
                final_end_date.format("%Y-%m-%d").to_string()
            ],
            |row| row.get::<_, String>(0),
        )
        .map_err(|e| format!("查询投资曲线日期点失败: {e}"))?;
    let mut candidate_dates = Vec::<NaiveDate>::new();
    for row in date_iter {
        candidate_dates.push(parse_db_date(
            row.map_err(|e| format!("读取投资曲线日期点失败: {e}"))?,
            "snapshot_date",
        )?);
    }
    candidate_dates.push(begin_date);
    candidate_dates.push(final_end_date);
    candidate_dates.sort_unstable();
    candidate_dates.dedup();

    let mut transfer_stmt = conn
        .prepare(
            r#"
            SELECT snapshot_date, COALESCE(SUM(transfer_amount_cents), 0) AS transfer_amount_cents
            FROM investment_records
            WHERE account_id = ?1
              AND snapshot_date >= ?2
              AND snapshot_date <= ?3
              AND transfer_amount_cents != 0
            GROUP BY snapshot_date
            HAVING COALESCE(SUM(transfer_amount_cents), 0) != 0
            "#,
        )
        .map_err(|e| format!("查询投资曲线资金流失败: {e}"))?;
    let transfer_iter = transfer_stmt
        .query_map(
            params![
                account_id,
                begin_date.format("%Y-%m-%d").to_string(),
                final_end_date.format("%Y-%m-%d").to_string()
            ],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
        )
        .map_err(|e| format!("查询投资曲线资金流失败: {e}"))?;
    let mut transfer_by_date = HashMap::<String, i64>::new();
    for row in transfer_iter {
        let (d, cents) = row.map_err(|e| format!("读取投资曲线资金流失败: {e}"))?;
        transfer_by_date.insert(d, cents);
    }

    let mut anchors = Vec::<CurveAnchorRow>::new();
    for point_date in &candidate_dates {
        let point_date_text = point_date.format("%Y-%m-%d").to_string();
        let point_end_row = select_end_snapshot(conn, account_id, begin_date, *point_date)?;
        let Some(point_end_row) = point_end_row else {
            continue;
        };

        let point_end_date = point_end_row.snapshot_date;
        let point_end_assets = point_end_row.total_assets_cents;
        let point_flows = load_transfer_rows(conn, account_id, begin_date, point_end_date)?;
        let point_calc = calculate_modified_dietz(
            begin_date,
            point_end_date,
            begin_assets,
            point_end_assets,
            &point_flows,
            true,
        )?;
        let cumulative_return = point_calc.return_rate.map(|v| round_to(v, 8));
        let cumulative_net_growth_cents = point_calc.profit_cents;
        let transfer_amount_cents = *transfer_by_date.get(&point_date_text).unwrap_or(&0);

        anchors.push(CurveAnchorRow {
            snapshot_date: *point_date,
            effective_snapshot_date: point_end_date,
            total_assets_cents: point_end_assets,
            transfer_amount_cents,
            transfer_details: if transfer_amount_cents == 0 {
                Vec::new()
            } else {
                vec![TransferDetail {
                    account_id: account_id.to_string(),
                    account_name: bounds.account_name.clone(),
                    transfer_amount_cents,
                }]
            },
            cumulative_net_growth_cents,
            cumulative_return_rate: cumulative_return,
            is_observed: true,
        });
    }
    let rows = interpolate_curve_rows_daily(&anchors);

    let requested_to = if to_raw.trim().is_empty() {
        bounds.latest.format("%Y-%m-%d").to_string()
    } else {
        parse_iso_date(to_raw, "to")?.format("%Y-%m-%d").to_string()
    };

    if rows.is_empty() {
        return Ok(json!({
            "account_id": account_id,
            "account_name": bounds.account_name,
            "range": {
                "preset": preset,
                "requested_from": window.requested_from.format("%Y-%m-%d").to_string(),
                "requested_to": requested_to,
                "effective_from": begin_date.format("%Y-%m-%d").to_string(),
                "effective_to": final_end_date.format("%Y-%m-%d").to_string(),
            },
            "summary": {
                "count": 0,
                "change_cents": 0,
                "change_pct": Value::Null,
                "end_net_growth_cents": 0,
                "end_net_growth_yuan": cents_to_yuan_text(0),
                "end_cumulative_return_rate": Value::Null,
                "end_cumulative_return_pct_text": Value::Null,
            },
            "rows": rows,
        }));
    }

    let first_row = rows
        .first()
        .and_then(Value::as_object)
        .ok_or("曲线结果格式错误")?;
    let last_row = rows
        .last()
        .and_then(Value::as_object)
        .ok_or("曲线结果格式错误")?;
    let first_value = first_row
        .get("total_assets_cents")
        .and_then(Value::as_i64)
        .ok_or("曲线结果格式错误")?;
    let last_value = last_row
        .get("total_assets_cents")
        .and_then(Value::as_i64)
        .ok_or("曲线结果格式错误")?;
    let change_cents = last_value - first_value;
    let change_pct = if first_value > 0 {
        Some(change_cents as f64 / first_value as f64)
    } else {
        None
    };
    let end_net_growth_cents = last_row
        .get("cumulative_net_growth_cents")
        .and_then(Value::as_i64)
        .ok_or("曲线结果格式错误")?;
    let end_cumulative_return_rate = last_row
        .get("cumulative_return_rate")
        .and_then(Value::as_f64)
        .map(|v| round_to(v, 8));
    let effective_to = last_row
        .get("effective_snapshot_date")
        .and_then(Value::as_str)
        .ok_or("曲线结果格式错误")?;

    Ok(json!({
        "account_id": account_id,
        "account_name": bounds.account_name,
        "range": {
            "preset": preset,
            "requested_from": window.requested_from.format("%Y-%m-%d").to_string(),
            "requested_to": requested_to,
            "effective_from": begin_date.format("%Y-%m-%d").to_string(),
            "effective_to": effective_to,
        },
        "summary": {
            "count": rows.len(),
            "start_assets_cents": first_value,
            "start_assets_yuan": cents_to_yuan_text(first_value),
            "end_assets_cents": last_value,
            "end_assets_yuan": cents_to_yuan_text(last_value),
            "change_cents": change_cents,
            "change_yuan": cents_to_yuan_text(change_cents),
            "change_pct": change_pct.map(|v| round_to(v, 8)),
            "change_pct_text": change_pct.map(|v| format!("{:.2}%", v * 100.0)),
            "end_net_growth_cents": end_net_growth_cents,
            "end_net_growth_yuan": cents_to_yuan_text(end_net_growth_cents),
            "end_cumulative_return_rate": end_cumulative_return_rate,
            "end_cumulative_return_pct_text": end_cumulative_return_rate.map(|v| format!("{:.2}%", v * 100.0)),
        },
        "rows": rows,
    }))
}

fn build_portfolio_investment_curve_payload(
    conn: &Connection,
    preset: &str,
    from_raw: &str,
    to_raw: &str,
) -> Result<Value, String> {
    let bounds = load_portfolio_bounds(conn)?;
    let window = resolve_window(preset, from_raw, to_raw, bounds.earliest, bounds.latest)?;
    if window.effective_from > window.effective_to {
        return Err("区间内有效快照不足，无法生成曲线".to_string());
    }

    let mut date_stmt = conn
        .prepare(
            r#"
            SELECT DISTINCT snapshot_date
            FROM investment_records
            WHERE snapshot_date >= ?1 AND snapshot_date <= ?2
            ORDER BY snapshot_date ASC
            "#,
        )
        .map_err(|e| format!("查询组合曲线日期点失败: {e}"))?;
    let date_iter = date_stmt
        .query_map(
            params![
                window.effective_from.format("%Y-%m-%d").to_string(),
                window.effective_to.format("%Y-%m-%d").to_string()
            ],
            |row| row.get::<_, String>(0),
        )
        .map_err(|e| format!("查询组合曲线日期点失败: {e}"))?;
    let mut dates = Vec::<NaiveDate>::new();
    let mut observed_dates = HashMap::<String, bool>::new();
    for row in date_iter {
        let point_date = parse_db_date(
            row.map_err(|e| format!("读取组合曲线日期点失败: {e}"))?,
            "snapshot_date",
        )?;
        observed_dates.insert(point_date.format("%Y-%m-%d").to_string(), true);
        dates.push(point_date);
    }
    dates.push(window.effective_from);
    dates.push(window.effective_to);
    dates.sort_unstable();
    dates.dedup();

    let mut history_stmt = conn
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
        .map_err(|e| format!("查询组合曲线历史失败: {e}"))?;
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
        .map_err(|e| format!("查询组合曲线历史失败: {e}"))?;
    let mut history_rows = Vec::new();
    for row in history_iter {
        let (account_id, snapshot_date_raw, value_cents, flow_cents) =
            row.map_err(|e| format!("读取组合曲线历史失败: {e}"))?;
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
    let effective_from_text = window.effective_from.format("%Y-%m-%d").to_string();

    let mut transfer_detail_stmt = conn
        .prepare(
            r#"
            SELECT
                r.snapshot_date,
                r.account_id,
                COALESCE(a.name, r.account_id) AS account_name,
                COALESCE(SUM(r.transfer_amount_cents), 0) AS transfer_amount_cents
            FROM investment_records r
            LEFT JOIN accounts a ON a.id = r.account_id
            WHERE r.snapshot_date >= ?1
              AND r.snapshot_date <= ?2
              AND r.transfer_amount_cents != 0
            GROUP BY r.snapshot_date, r.account_id, account_name
            HAVING COALESCE(SUM(r.transfer_amount_cents), 0) != 0
            ORDER BY r.snapshot_date ASC, account_name ASC
            "#,
        )
        .map_err(|e| format!("查询组合曲线资金流明细失败: {e}"))?;
    let transfer_detail_iter = transfer_detail_stmt
        .query_map(
            params![
                window.effective_from.format("%Y-%m-%d").to_string(),
                window.effective_to.format("%Y-%m-%d").to_string()
            ],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            },
        )
        .map_err(|e| format!("查询组合曲线资金流明细失败: {e}"))?;
    let mut transfer_by_date = BTreeMap::<String, i64>::new();
    let mut transfer_details_by_date = HashMap::<String, Vec<TransferDetail>>::new();
    for row in transfer_detail_iter {
        let (snapshot_date, account_id, account_name, amount) =
            row.map_err(|e| format!("读取组合曲线资金流明细失败: {e}"))?;
        *transfer_by_date.entry(snapshot_date.clone()).or_insert(0) += amount;
        transfer_details_by_date
            .entry(snapshot_date)
            .or_default()
            .push(TransferDetail {
                account_id,
                account_name,
                transfer_amount_cents: amount,
            });
    }
    for details in transfer_details_by_date.values_mut() {
        details.sort_by(|left, right| {
            right
                .transfer_amount_cents
                .abs()
                .cmp(&left.transfer_amount_cents.abs())
                .then_with(|| left.account_name.cmp(&right.account_name))
        });
    }

    let mut anchors = Vec::<CurveAnchorRow>::new();
    for point_date in &dates {
        let point_date_text = point_date.format("%Y-%m-%d").to_string();
        if point_date_text < window.effective_from.format("%Y-%m-%d").to_string() {
            continue;
        }
        let point_assets = *totals.get(&point_date_text).unwrap_or(&0);

        let mut point_flows = Vec::<TransferRow>::new();
        for (flow_date, flow_amount) in &transfer_by_date {
            if flow_date <= &effective_from_text {
                continue;
            }
            if flow_date > &point_date_text {
                break;
            }
            point_flows.push(TransferRow {
                snapshot_date: parse_db_date(flow_date.clone(), "snapshot_date")?,
                transfer_amount_cents: *flow_amount,
            });
        }

        let point_calc = calculate_modified_dietz(
            window.effective_from,
            *point_date,
            begin_assets,
            point_assets,
            &point_flows,
            true,
        )?;
        let cumulative_return = point_calc.return_rate.map(|v| round_to(v, 8));
        let cumulative_net_growth_cents = point_calc.profit_cents;
        let transfer_amount_cents = *transfer_by_date.get(&point_date_text).unwrap_or(&0);

        anchors.push(CurveAnchorRow {
            snapshot_date: *point_date,
            effective_snapshot_date: *point_date,
            total_assets_cents: point_assets,
            transfer_amount_cents,
            transfer_details: transfer_details_by_date
                .get(&point_date_text)
                .cloned()
                .unwrap_or_default(),
            cumulative_net_growth_cents,
            cumulative_return_rate: cumulative_return,
            is_observed: observed_dates.contains_key(&point_date_text),
        });
    }
    let rows = interpolate_curve_rows_daily(&anchors);

    let requested_to = if to_raw.trim().is_empty() {
        bounds.latest.format("%Y-%m-%d").to_string()
    } else {
        parse_iso_date(to_raw, "to")?.format("%Y-%m-%d").to_string()
    };

    if rows.is_empty() {
        return Ok(json!({
            "account_id": PORTFOLIO_ACCOUNT_ID,
            "account_name": PORTFOLIO_ACCOUNT_NAME,
            "account_count": bounds.account_count,
            "range": {
                "preset": preset,
                "requested_from": window.requested_from.format("%Y-%m-%d").to_string(),
                "requested_to": requested_to,
                "effective_from": window.effective_from.format("%Y-%m-%d").to_string(),
                "effective_to": window.effective_to.format("%Y-%m-%d").to_string(),
            },
            "summary": {
                "count": 0,
                "change_cents": 0,
                "change_pct": Value::Null,
                "end_net_growth_cents": 0,
                "end_net_growth_yuan": cents_to_yuan_text(0),
                "end_cumulative_return_rate": Value::Null,
                "end_cumulative_return_pct_text": Value::Null,
            },
            "rows": rows,
        }));
    }

    let first_row = rows
        .first()
        .and_then(Value::as_object)
        .ok_or("曲线结果格式错误")?;
    let last_row = rows
        .last()
        .and_then(Value::as_object)
        .ok_or("曲线结果格式错误")?;
    let first_value = first_row
        .get("total_assets_cents")
        .and_then(Value::as_i64)
        .ok_or("曲线结果格式错误")?;
    let last_value = last_row
        .get("total_assets_cents")
        .and_then(Value::as_i64)
        .ok_or("曲线结果格式错误")?;
    let change_cents = last_value - first_value;
    let change_pct = if first_value > 0 {
        Some(change_cents as f64 / first_value as f64)
    } else {
        None
    };
    let end_net_growth_cents = last_row
        .get("cumulative_net_growth_cents")
        .and_then(Value::as_i64)
        .ok_or("曲线结果格式错误")?;
    let end_cumulative_return_rate = last_row
        .get("cumulative_return_rate")
        .and_then(Value::as_f64)
        .map(|v| round_to(v, 8));
    let effective_to = last_row
        .get("effective_snapshot_date")
        .and_then(Value::as_str)
        .ok_or("曲线结果格式错误")?;

    Ok(json!({
        "account_id": PORTFOLIO_ACCOUNT_ID,
        "account_name": PORTFOLIO_ACCOUNT_NAME,
        "account_count": bounds.account_count,
        "range": {
            "preset": preset,
            "requested_from": window.requested_from.format("%Y-%m-%d").to_string(),
            "requested_to": requested_to,
            "effective_from": window.effective_from.format("%Y-%m-%d").to_string(),
            "effective_to": effective_to,
        },
        "summary": {
            "count": rows.len(),
            "start_assets_cents": first_value,
            "start_assets_yuan": cents_to_yuan_text(first_value),
            "end_assets_cents": last_value,
            "end_assets_yuan": cents_to_yuan_text(last_value),
            "change_cents": change_cents,
            "change_yuan": cents_to_yuan_text(change_cents),
            "change_pct": change_pct.map(|v| round_to(v, 8)),
            "change_pct_text": change_pct.map(|v| format!("{:.2}%", v * 100.0)),
            "end_net_growth_cents": end_net_growth_cents,
            "end_net_growth_yuan": cents_to_yuan_text(end_net_growth_cents),
            "end_cumulative_return_rate": end_cumulative_return_rate,
            "end_cumulative_return_pct_text": end_cumulative_return_rate.map(|v| format!("{:.2}%", v * 100.0)),
        },
        "rows": rows,
    }))
}

pub fn investment_curve_query_at_db_path(
    db_path: &Path,
    req: InvestmentCurveQueryRequest,
) -> Result<Value, String> {
    let account_id = req.account_id.trim().to_string();
    if account_id.is_empty() {
        return Err("account_id 必填".to_string());
    }
    let preset = parse_preset_with_default(req.preset.as_deref(), "1y")?;
    let from_raw = req.from_date.unwrap_or_default();
    let to_raw = req.to_date.unwrap_or_default();

    let conn = Connection::open(db_path).map_err(|e| format!("打开数据库失败: {e}"))?;
    if account_id == PORTFOLIO_ACCOUNT_ID {
        build_portfolio_investment_curve_payload(&conn, &preset, &from_raw, &to_raw)
    } else {
        build_single_account_investment_curve_payload(
            &conn,
            &account_id,
            &preset,
            &from_raw,
            &to_raw,
        )
    }
}

pub fn investment_curve_benchmarks_query_at_db_path(
    db_path: &Path,
    req: InvestmentCurveQueryRequest,
) -> Result<Value, String> {
    let preferred_source = parse_benchmark_market_data_source(req.benchmark_source.as_deref())?;
    let curve_payload = investment_curve_query_at_db_path(db_path, req)?;
    build_benchmark_payload_from_curve_payload(&curve_payload, preferred_source)
}
