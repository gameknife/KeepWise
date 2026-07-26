use super::*;

pub(super) fn parse_preset(raw: Option<&str>) -> Result<String, String> {
    parse_preset_with_default(raw, "ytd")
}

pub(super) fn parse_preset_with_default(
    raw: Option<&str>,
    default_preset: &str,
) -> Result<String, String> {
    let preset = raw.unwrap_or(default_preset).trim().to_lowercase();
    let preset = if preset.is_empty() {
        default_preset.to_string()
    } else {
        preset
    };
    if SUPPORTED_PRESETS.iter().any(|x| *x == preset) {
        Ok(preset)
    } else {
        Err(format!(
            "preset 不支持: {preset}，可选 {}",
            SUPPORTED_PRESETS.join(", ")
        ))
    }
}

pub(super) fn resolve_window(
    preset: &str,
    from_raw: &str,
    to_raw: &str,
    earliest: NaiveDate,
    latest: NaiveDate,
) -> Result<Window, String> {
    if latest < earliest {
        return Err("无可用时间范围".to_string());
    }

    let requested_to = if to_raw.trim().is_empty() {
        latest
    } else {
        parse_iso_date(to_raw, "to")?
    };
    let effective_to = if requested_to < latest {
        requested_to
    } else {
        latest
    };
    if effective_to < earliest {
        return Err("结束日期早于最早可用记录".to_string());
    }

    let requested_from = match preset {
        "custom" => parse_iso_date(from_raw, "from")?,
        "ytd" => NaiveDate::from_ymd_opt(effective_to.year(), 1, 1).ok_or("无效 ytd 日期范围")?,
        "3m" => effective_to - Duration::days(90),
        "6m" => effective_to - Duration::days(180),
        "1y" => effective_to - Duration::days(365),
        "3y" => effective_to - Duration::days(365 * 3),
        "since_inception" => earliest,
        _ => return Err(format!("preset 不支持: {preset}")),
    };

    let effective_from = if requested_from > earliest {
        requested_from
    } else {
        earliest
    };
    if effective_from > effective_to {
        return Err("起始日期晚于结束日期".to_string());
    }

    Ok(Window {
        requested_from,
        effective_from,
        effective_to,
        latest,
    })
}

pub(super) fn parse_db_date(s: String, field: &str) -> Result<NaiveDate, String> {
    parse_iso_date(&s, field)
}

pub(super) fn load_investment_account_bounds(
    conn: &Connection,
    account_id: &str,
) -> Result<AccountBounds, String> {
    let row = conn
        .query_row(
            r#"
            SELECT
              COALESCE(a.name, r.account_id) AS account_name,
              MIN(r.snapshot_date) AS earliest_date,
              MAX(r.snapshot_date) AS latest_date
            FROM investment_records r
            LEFT JOIN accounts a ON a.id = r.account_id
            WHERE r.account_id = ?1
            GROUP BY r.account_id
            "#,
            params![account_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()
        .map_err(|e| format!("查询投资账户边界失败: {e}"))?;

    let Some((account_name, earliest_raw, latest_raw)) = row else {
        return Err("未找到该投资账户的记录".to_string());
    };

    Ok(AccountBounds {
        account_name,
        earliest: parse_db_date(earliest_raw, "earliest_date")?,
        latest: parse_db_date(latest_raw, "latest_date")?,
    })
}

pub(super) fn load_portfolio_bounds(conn: &Connection) -> Result<PortfolioBounds, String> {
    let row = conn
        .query_row(
            r#"
            SELECT
              MIN(snapshot_date) AS earliest_date,
              MAX(snapshot_date) AS latest_date,
              COUNT(DISTINCT account_id) AS account_count
            FROM investment_records
            "#,
            [],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            },
        )
        .map_err(|e| format!("查询组合边界失败: {e}"))?;

    let (earliest_raw, latest_raw, account_count) = row;
    let Some(earliest_raw) = earliest_raw else {
        return Err("未找到可用的投资记录".to_string());
    };
    let Some(latest_raw) = latest_raw else {
        return Err("未找到可用的投资记录".to_string());
    };
    if account_count <= 0 {
        return Err("未找到可用的投资账户".to_string());
    }

    Ok(PortfolioBounds {
        earliest: parse_db_date(earliest_raw, "earliest_date")?,
        latest: parse_db_date(latest_raw, "latest_date")?,
        account_count,
    })
}

pub(super) fn select_begin_snapshot(
    conn: &Connection,
    account_id: &str,
    window_from: NaiveDate,
    window_to: NaiveDate,
) -> Result<Option<SnapshotRow>, String> {
    let fetch =
        |sql: &str, params_any: &[&dyn rusqlite::ToSql]| -> Result<Option<SnapshotRow>, String> {
            conn.query_row(sql, params_any, |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })
            .optional()
            .map_err(|e| format!("查询期初快照失败: {e}"))?
            .map(|(date_raw, total_assets_cents)| {
                Ok(SnapshotRow {
                    snapshot_date: parse_db_date(date_raw, "snapshot_date")?,
                    total_assets_cents,
                })
            })
            .transpose()
        };

    let wf = window_from.format("%Y-%m-%d").to_string();
    let wt = window_to.format("%Y-%m-%d").to_string();

    if let Some(row) = fetch(
        r#"
        SELECT snapshot_date, total_assets_cents
        FROM investment_records
        WHERE account_id = ?1 AND snapshot_date <= ?2 AND total_assets_cents > 0
        ORDER BY snapshot_date DESC
        LIMIT 1
        "#,
        &[&account_id, &wf],
    )? {
        return Ok(Some(row));
    }

    if let Some(row) = fetch(
        r#"
        SELECT snapshot_date, total_assets_cents
        FROM investment_records
        WHERE account_id = ?1 AND snapshot_date >= ?2 AND snapshot_date <= ?3 AND total_assets_cents > 0
        ORDER BY snapshot_date ASC
        LIMIT 1
        "#,
        &[&account_id, &wf, &wt],
    )? {
        return Ok(Some(row));
    }

    fetch(
        r#"
        SELECT snapshot_date, total_assets_cents
        FROM investment_records
        WHERE account_id = ?1 AND snapshot_date <= ?2
        ORDER BY snapshot_date DESC
        LIMIT 1
        "#,
        &[&account_id, &wf],
    )
}

pub(super) fn select_end_snapshot(
    conn: &Connection,
    account_id: &str,
    begin_date: NaiveDate,
    window_to: NaiveDate,
) -> Result<Option<SnapshotRow>, String> {
    let bd = begin_date.format("%Y-%m-%d").to_string();
    let wt = window_to.format("%Y-%m-%d").to_string();
    let first = conn
        .query_row(
            r#"
            SELECT snapshot_date, total_assets_cents
            FROM investment_records
            WHERE account_id = ?1 AND snapshot_date >= ?2 AND snapshot_date <= ?3 AND total_assets_cents > 0
            ORDER BY snapshot_date DESC
            LIMIT 1
            "#,
            params![account_id, bd, wt],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
        )
        .optional()
        .map_err(|e| format!("查询期末快照失败: {e}"))?;
    let row = match first {
        Some(r) => Some(r),
        None => conn
            .query_row(
                r#"
                SELECT snapshot_date, total_assets_cents
                FROM investment_records
                WHERE account_id = ?1 AND snapshot_date >= ?2 AND snapshot_date <= ?3
                ORDER BY snapshot_date DESC
                LIMIT 1
                "#,
                params![
                    account_id,
                    begin_date.format("%Y-%m-%d").to_string(),
                    window_to.format("%Y-%m-%d").to_string()
                ],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
            )
            .optional()
            .map_err(|e| format!("查询期末快照失败: {e}"))?,
    };
    row.map(|(date_raw, total_assets_cents)| {
        Ok(SnapshotRow {
            snapshot_date: parse_db_date(date_raw, "snapshot_date")?,
            total_assets_cents,
        })
    })
    .transpose()
}

pub(super) fn load_transfer_rows(
    conn: &Connection,
    account_id: &str,
    begin_date: NaiveDate,
    end_date: NaiveDate,
) -> Result<Vec<TransferRow>, String> {
    let mut stmt = conn
        .prepare(
            r#"
            SELECT snapshot_date, transfer_amount_cents
            FROM investment_records
            WHERE account_id = ?1
              AND snapshot_date > ?2
              AND snapshot_date <= ?3
              AND transfer_amount_cents != 0
            ORDER BY snapshot_date ASC
            "#,
        )
        .map_err(|e| format!("查询资金流失败: {e}"))?;

    let rows = stmt
        .query_map(
            params![
                account_id,
                begin_date.format("%Y-%m-%d").to_string(),
                end_date.format("%Y-%m-%d").to_string()
            ],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
        )
        .map_err(|e| format!("查询资金流失败: {e}"))?;

    let mut out = Vec::new();
    for row in rows {
        let (date_raw, cents) = row.map_err(|e| format!("读取资金流行失败: {e}"))?;
        out.push(TransferRow {
            snapshot_date: parse_db_date(date_raw, "flow_date")?,
            transfer_amount_cents: cents,
        });
    }
    Ok(out)
}

pub(super) fn calculate_modified_dietz(
    begin_date: NaiveDate,
    end_date: NaiveDate,
    begin_assets_cents: i64,
    end_assets_cents: i64,
    flow_rows: &[TransferRow],
    allow_zero_interval: bool,
) -> Result<ModifiedDietzCalc, String> {
    let interval_days = (end_date - begin_date).num_days();
    if interval_days < 0 {
        return Err("结束日期不能早于开始日期".to_string());
    }
    if interval_days == 0 && !allow_zero_interval {
        return Err("区间内有效快照不足，无法计算收益率".to_string());
    }

    let net_flow_cents = flow_rows
        .iter()
        .map(|r| r.transfer_amount_cents)
        .sum::<i64>();
    let profit_cents = end_assets_cents - begin_assets_cents - net_flow_cents;

    let mut weighted_flow = 0.0_f64;
    let mut cash_flows = Vec::new();
    for row in flow_rows {
        let flow_cents = row.transfer_amount_cents;
        if flow_cents == 0 {
            continue;
        }
        let weight = if interval_days > 0 {
            (end_date - row.snapshot_date).num_days() as f64 / interval_days as f64
        } else {
            0.0
        };
        weighted_flow += (flow_cents as f64) * weight;
        cash_flows.push(json!({
            "snapshot_date": row.snapshot_date.format("%Y-%m-%d").to_string(),
            "transfer_amount_cents": flow_cents,
            "transfer_amount_yuan": cents_to_yuan_text(flow_cents),
            "weight": round_to(weight, 6),
        }));
    }

    let denominator = begin_assets_cents as f64 + weighted_flow;
    let (return_rate, annualized_rate, note) = if interval_days == 0 {
        if denominator <= 0.0 {
            (
                None,
                None,
                "加权本金小于等于 0，无法计算现金加权收益率。".to_string(),
            )
        } else {
            (Some(0.0), None, String::new())
        }
    } else if denominator <= 0.0 {
        (
            None,
            None,
            "加权本金小于等于 0，无法计算现金加权收益率。".to_string(),
        )
    } else {
        let rr = profit_cents as f64 / denominator;
        let annualized = if 1.0 + rr > 0.0 {
            Some((1.0 + rr).powf(365.0 / interval_days as f64) - 1.0)
        } else {
            None
        };
        (Some(rr), annualized, String::new())
    };

    Ok(ModifiedDietzCalc {
        interval_days,
        net_flow_cents,
        profit_cents,
        weighted_capital_cents: denominator.round() as i64,
        return_rate,
        annualized_rate,
        note,
        cash_flows,
    })
}

pub(super) fn build_portfolio_asof_totals(
    dates: &[NaiveDate],
    history_rows: &[PortfolioHistoryRow],
) -> HashMap<String, i64> {
    let mut totals = HashMap::<String, i64>::new();
    for d in dates {
        totals.insert(d.format("%Y-%m-%d").to_string(), 0);
    }

    let mut by_account: HashMap<String, Vec<&PortfolioHistoryRow>> = HashMap::new();
    for row in history_rows {
        by_account
            .entry(row.account_id.clone())
            .or_default()
            .push(row);
    }

    for series in by_account.values_mut() {
        series.sort_by_key(|r| r.snapshot_date);
        let mut idx = 0usize;
        let mut current = 0_i64;
        for d in dates {
            while idx < series.len() && series[idx].snapshot_date <= *d {
                let raw_value = series[idx].value_cents;
                let flow_cents = series[idx].flow_cents;
                if raw_value == 0 && flow_cents != 0 && current > 0 {
                    // keep previous current for compatibility with Python behavior
                } else {
                    current = raw_value;
                }
                idx += 1;
            }
            let key = d.format("%Y-%m-%d").to_string();
            if let Some(total) = totals.get_mut(&key) {
                *total += current;
            }
        }
    }
    totals
}
