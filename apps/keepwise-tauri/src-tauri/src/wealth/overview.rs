use super::*;

fn load_overview_investment_rows(
    conn: &Connection,
    as_of: &str,
) -> Result<Vec<OverviewItemRow>, String> {
    let mut stmt = conn
        .prepare(
            r#"
            SELECT
                r.account_id,
                COALESCE(a.name, r.account_id) AS account_name,
                r.snapshot_date,
                r.total_assets_cents AS value_cents
            FROM investment_records r
            JOIN (
                SELECT account_id, MAX(snapshot_date) AS snapshot_date
                FROM investment_records
                WHERE snapshot_date <= ?1 AND total_assets_cents > 0
                GROUP BY account_id
            ) latest
              ON latest.account_id = r.account_id
             AND latest.snapshot_date = r.snapshot_date
            LEFT JOIN accounts a ON a.id = r.account_id
            ORDER BY value_cents DESC, account_name
            "#,
        )
        .map_err(|e| format!("查询投资账户总览失败: {e}"))?;
    let iter = stmt
        .query_map(params![as_of], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
            ))
        })
        .map_err(|e| format!("查询投资账户总览失败: {e}"))?;
    let mut out = Vec::new();
    for row in iter {
        let (account_id, account_name, snapshot_date_raw, value_cents) =
            row.map_err(|e| format!("读取投资账户总览失败: {e}"))?;
        out.push(OverviewItemRow {
            account_id,
            account_name,
            snapshot_date: parse_iso_date(&snapshot_date_raw, "snapshot_date")?,
            value_cents,
        });
    }
    Ok(out)
}

fn load_overview_asset_rows(
    conn: &Connection,
    as_of: &str,
) -> Result<Vec<AssetValuationRow>, String> {
    let mut stmt = conn
        .prepare(
            r#"
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
                WHERE snapshot_date <= ?1
                GROUP BY account_id, asset_class
            ) latest
              ON latest.account_id = v.account_id
             AND latest.asset_class = v.asset_class
             AND latest.snapshot_date = v.snapshot_date
            ORDER BY v.asset_class, v.value_cents DESC, v.account_name
            "#,
        )
        .map_err(|e| format!("查询资产估值总览失败: {e}"))?;
    let iter = stmt
        .query_map(params![as_of], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i64>(4)?,
            ))
        })
        .map_err(|e| format!("查询资产估值总览失败: {e}"))?;
    let mut out = Vec::new();
    for row in iter {
        let (account_id, account_name, asset_class, snapshot_date_raw, value_cents) =
            row.map_err(|e| format!("读取资产估值总览失败: {e}"))?;
        out.push(AssetValuationRow {
            account_id,
            account_name,
            asset_class,
            snapshot_date: parse_iso_date(&snapshot_date_raw, "snapshot_date")?,
            value_cents,
        });
    }
    Ok(out)
}

fn map_overview_items(
    rows: &[OverviewItemRow],
    effective_as_of: NaiveDate,
    asset_class: &str,
) -> Vec<Value> {
    rows.iter()
        .map(|row| {
            let stale_days = (effective_as_of - row.snapshot_date).num_days();
            json!({
                "asset_class": asset_class,
                "account_id": row.account_id,
                "account_name": row.account_name,
                "snapshot_date": row.snapshot_date.format("%Y-%m-%d").to_string(),
                "value_cents": row.value_cents,
                "value_yuan": cents_to_yuan_text(row.value_cents),
                "stale_days": stale_days,
            })
        })
        .collect()
}

fn map_asset_items(
    rows: &[AssetValuationRow],
    effective_as_of: NaiveDate,
    asset_class: &str,
) -> Vec<Value> {
    rows.iter()
        .map(|row| {
            let stale_days = (effective_as_of - row.snapshot_date).num_days();
            json!({
                "asset_class": asset_class,
                "account_id": row.account_id,
                "account_name": row.account_name,
                "snapshot_date": row.snapshot_date.format("%Y-%m-%d").to_string(),
                "value_cents": row.value_cents,
                "value_yuan": cents_to_yuan_text(row.value_cents),
                "stale_days": stale_days,
            })
        })
        .collect()
}

pub fn wealth_overview_query_at_db_path(
    db_path: &Path,
    req: WealthOverviewQueryRequest,
) -> Result<Value, String> {
    let as_of_raw = req.as_of_date.unwrap_or_default();
    let filters = parse_wealth_filters(
        req.include_investment.as_deref(),
        req.include_cash.as_deref(),
        req.include_real_estate.as_deref(),
        req.include_liability.as_deref(),
    )?;

    let conn = Connection::open(db_path).map_err(|e| format!("打开数据库失败: {e}"))?;
    let latest_available = query_latest_union_date(&conn)?
        .ok_or_else(|| "当前没有可用于财富总览的数据".to_string())?;
    let requested_as_of = if as_of_raw.trim().is_empty() {
        latest_available
    } else {
        parse_iso_date(&as_of_raw, "as_of")?
    };
    let effective_as_of = if requested_as_of < latest_available {
        requested_as_of
    } else {
        latest_available
    };
    let as_of = effective_as_of.format("%Y-%m-%d").to_string();

    let investment_rows = load_overview_investment_rows(&conn, &as_of)?;
    let asset_rows = load_overview_asset_rows(&conn, &as_of)?;

    let investment_total = investment_rows.iter().map(|r| r.value_cents).sum::<i64>();
    let cash_rows = asset_rows
        .iter()
        .filter(|r| r.asset_class == "cash")
        .cloned()
        .collect::<Vec<_>>();
    let real_estate_rows = asset_rows
        .iter()
        .filter(|r| r.asset_class == "real_estate")
        .cloned()
        .collect::<Vec<_>>();
    let liability_rows = asset_rows
        .iter()
        .filter(|r| r.asset_class == "liability")
        .cloned()
        .collect::<Vec<_>>();
    let cash_total = cash_rows.iter().map(|r| r.value_cents).sum::<i64>();
    let real_estate_total = real_estate_rows.iter().map(|r| r.value_cents).sum::<i64>();
    let liability_total = liability_rows.iter().map(|r| r.value_cents).sum::<i64>();

    let gross_assets_total = (if filters.include_investment {
        investment_total
    } else {
        0
    }) + (if filters.include_cash { cash_total } else { 0 })
        + (if filters.include_real_estate {
            real_estate_total
        } else {
            0
        });
    let selected_liability_total = if filters.include_liability {
        liability_total
    } else {
        0
    };
    let net_asset_total = gross_assets_total - selected_liability_total;

    let investment_items = map_overview_items(&investment_rows, effective_as_of, "investment");
    let cash_items = map_asset_items(&cash_rows, effective_as_of, "cash");
    let real_estate_items = map_asset_items(&real_estate_rows, effective_as_of, "real_estate");
    let liability_items = map_asset_items(&liability_rows, effective_as_of, "liability");

    let mut selected_rows = Vec::<Value>::new();
    if filters.include_investment {
        selected_rows.extend(investment_items);
    }
    if filters.include_cash {
        selected_rows.extend(cash_items);
    }
    if filters.include_real_estate {
        selected_rows.extend(real_estate_items);
    }
    if filters.include_liability {
        selected_rows.extend(liability_items);
    }

    let selected_rows_assets_total_cents = selected_rows
        .iter()
        .filter(|row| row.get("asset_class").and_then(Value::as_str) != Some("liability"))
        .map(|row| row.get("value_cents").and_then(Value::as_i64).unwrap_or(0))
        .sum::<i64>();
    let selected_rows_liability_total_cents = selected_rows
        .iter()
        .filter(|row| row.get("asset_class").and_then(Value::as_str) == Some("liability"))
        .map(|row| row.get("value_cents").and_then(Value::as_i64).unwrap_or(0))
        .sum::<i64>();
    let selected_rows_total_cents =
        selected_rows_assets_total_cents - selected_rows_liability_total_cents;
    let reconciliation_delta_cents = selected_rows_total_cents - net_asset_total;
    let stale_account_count = selected_rows
        .iter()
        .filter(|row| row.get("stale_days").and_then(Value::as_i64).unwrap_or(0) > 0)
        .count();

    Ok(json!({
        "as_of": as_of,
        "requested_as_of": requested_as_of.format("%Y-%m-%d").to_string(),
        "filters": {
            "include_investment": filters.include_investment,
            "include_cash": filters.include_cash,
            "include_real_estate": filters.include_real_estate,
            "include_liability": filters.include_liability,
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
    }))
}
