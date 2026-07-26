use super::*;

pub fn investment_returns_query_at_db_path(
    db_path: &Path,
    req: InvestmentReturnsQueryRequest,
) -> Result<Value, String> {
    let preset = parse_preset(req.preset.as_deref())?;
    let from_raw = req.from_date.unwrap_or_default();
    let to_raw = req.to_date.unwrap_or_default();
    let keyword = req.keyword.unwrap_or_default().trim().to_lowercase();
    let limit = req.limit.unwrap_or(200).clamp(1, 500) as usize;

    if preset == "custom" {
        let _ = parse_iso_date(&from_raw, "from")?;
    }
    let requested_to_text = if to_raw.trim().is_empty() {
        String::new()
    } else {
        parse_iso_date(&to_raw, "to")?
            .format("%Y-%m-%d")
            .to_string()
    };

    let conn = Connection::open(db_path).map_err(|e| format!("打开数据库失败: {e}"))?;
    let mut stmt = conn
        .prepare(
            r#"
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
            "#,
        )
        .map_err(|e| format!("查询投资账户列表失败: {e}"))?;
    let mapped = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
            ))
        })
        .map_err(|e| format!("查询投资账户列表失败: {e}"))?;

    let mut account_rows: Vec<(String, String, i64, String, String)> = Vec::new();
    for row in mapped {
        let row = row.map_err(|e| format!("读取投资账户列表失败: {e}"))?;
        if !keyword.is_empty()
            && !row.0.to_lowercase().contains(&keyword)
            && !row.1.to_lowercase().contains(&keyword)
        {
            continue;
        }
        account_rows.push(row);
        if account_rows.len() >= limit {
            break;
        }
    }

    let mut rows: Vec<Value> = Vec::new();
    let mut errors: Vec<Value> = Vec::new();
    for (account_id, account_name, record_count, first_snapshot_date, latest_snapshot_date) in
        &account_rows
    {
        let payload = match build_single_account_investment_return_payload(
            &conn, account_id, &preset, &from_raw, &to_raw,
        ) {
            Ok(v) => v,
            Err(e) => {
                errors.push(json!({
                    "account_id": account_id,
                    "account_name": account_name,
                    "error": e,
                }));
                continue;
            }
        };
        let metrics = payload
            .get("metrics")
            .and_then(Value::as_object)
            .ok_or_else(|| "investment-return payload 缺少 metrics".to_string())?;
        let range = payload
            .get("range")
            .and_then(Value::as_object)
            .ok_or_else(|| "investment-return payload 缺少 range".to_string())?;

        let get_i64 = |obj: &serde_json::Map<String, Value>, key: &str| -> Result<i64, String> {
            obj.get(key)
                .and_then(Value::as_i64)
                .ok_or_else(|| format!("investment-return payload 缺少整数字段: {key}"))
        };
        let get_str = |obj: &serde_json::Map<String, Value>, key: &str| -> Result<String, String> {
            obj.get(key)
                .and_then(Value::as_str)
                .map(|s| s.to_string())
                .ok_or_else(|| format!("investment-return payload 缺少字符串字段: {key}"))
        };
        let get_opt_f64 = |obj: &serde_json::Map<String, Value>, key: &str| -> Option<f64> {
            obj.get(key).and_then(Value::as_f64)
        };
        let get_opt_str = |obj: &serde_json::Map<String, Value>, key: &str| -> Option<String> {
            obj.get(key).and_then(Value::as_str).map(|s| s.to_string())
        };

        rows.push(json!({
            "account_id": account_id,
            "account_name": account_name,
            "record_count": *record_count,
            "first_snapshot_date": first_snapshot_date,
            "latest_snapshot_date": latest_snapshot_date,
            "effective_from": get_str(range, "effective_from")?,
            "effective_to": get_str(range, "effective_to")?,
            "interval_days": get_i64(range, "interval_days")?,
            "begin_assets_cents": get_i64(metrics, "begin_assets_cents")?,
            "begin_assets_yuan": get_str(metrics, "begin_assets_yuan")?,
            "end_assets_cents": get_i64(metrics, "end_assets_cents")?,
            "end_assets_yuan": get_str(metrics, "end_assets_yuan")?,
            "net_flow_cents": get_i64(metrics, "net_flow_cents")?,
            "net_flow_yuan": get_str(metrics, "net_flow_yuan")?,
            "profit_cents": get_i64(metrics, "profit_cents")?,
            "profit_yuan": get_str(metrics, "profit_yuan")?,
            "net_growth_cents": get_i64(metrics, "net_growth_cents")?,
            "net_growth_yuan": get_str(metrics, "net_growth_yuan")?,
            "return_rate": get_opt_f64(metrics, "return_rate"),
            "return_rate_pct": get_opt_str(metrics, "return_rate_pct"),
            "annualized_rate": get_opt_f64(metrics, "annualized_rate"),
            "annualized_rate_pct": get_opt_str(metrics, "annualized_rate_pct"),
            "note": get_opt_str(metrics, "note").unwrap_or_default(),
        }));
    }

    rows.sort_by(|a, b| {
        let a_rate = a.get("return_rate").and_then(Value::as_f64);
        let b_rate = b.get("return_rate").and_then(Value::as_f64);
        match (a_rate, b_rate) {
            (Some(ra), Some(rb)) => rb
                .partial_cmp(&ra)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| {
                    let an = a
                        .get("account_name")
                        .and_then(Value::as_str)
                        .unwrap_or_default();
                    let bn = b
                        .get("account_name")
                        .and_then(Value::as_str)
                        .unwrap_or_default();
                    an.cmp(bn)
                }),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => {
                let an = a
                    .get("account_name")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let bn = b
                    .get("account_name")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                an.cmp(bn)
            }
        }
    });

    let valid_rates: Vec<f64> = rows
        .iter()
        .filter_map(|row| row.get("return_rate").and_then(Value::as_f64))
        .collect();
    let avg_rate = if valid_rates.is_empty() {
        None
    } else {
        Some(valid_rates.iter().sum::<f64>() / valid_rates.len() as f64)
    };
    let avg_rate_rounded = avg_rate.map(|v| round_to(v, 8));

    Ok(json!({
        "range": {
            "preset": preset,
            "requested_from": if from_raw.trim().is_empty() { "".to_string() } else { from_raw },
            "requested_to": requested_to_text,
            "input_limit": limit,
            "keyword": keyword,
        },
        "summary": {
            "account_count": account_rows.len(),
            "computed_count": rows.len(),
            "error_count": errors.len(),
            "avg_return_rate": avg_rate_rounded,
            "avg_return_pct": avg_rate.map(|v| format!("{:.2}%", v * 100.0)),
        },
        "rows": rows,
        "errors": errors,
    }))
}
