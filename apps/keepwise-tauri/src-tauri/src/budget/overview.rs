use super::*;

pub fn query_budget_overview_at_db_path(
    db_path: &Path,
    req: BudgetYearQueryRequest,
) -> Result<Value, String> {
    let today = Local::now().date_naive();
    let year = parse_year_param(req.year.as_deref(), today.year())?;
    let month_start = format!("{year:04}-01");
    let month_end = format!("{year:04}-12");
    let elapsed_months = budget_year_months_elapsed(year, today);

    let conn = Connection::open(db_path).map_err(|e| format!("打开数据库失败: {e}"))?;
    let budget_rows = load_monthly_budget_items(&conn)?;
    let budget_summary = summarize_monthly_budget_items(&budget_rows);
    let actual_spent_cents = conn
        .query_row(
            r#"
            SELECT COALESCE(SUM(ABS(amount_cents)), 0) AS spent_cents
            FROM transactions
            WHERE direction = 'expense'
              AND month_key >= ?1
              AND month_key <= ?2
              AND needs_review = 0
              AND excluded_in_analysis = 0
            "#,
            params![month_start, month_end],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|e| format!("查询预算执行情况失败: {e}"))?;

    let monthly_budget_total_cents = budget_summary.monthly_total_cents;
    let annual_budget_cents = budget_summary.annual_total_cents;
    let ytd_budget_cents = monthly_budget_total_cents * elapsed_months as i64;
    let ytd_actual_cents = actual_spent_cents;
    let annual_remaining_cents = annual_budget_cents - actual_spent_cents;
    let ytd_variance_cents = ytd_budget_cents - ytd_actual_cents;
    let usage_rate = if annual_budget_cents > 0 {
        Some(actual_spent_cents as f64 / annual_budget_cents as f64)
    } else {
        None
    };
    let ytd_usage_rate = if ytd_budget_cents > 0 {
        Some(ytd_actual_cents as f64 / ytd_budget_cents as f64)
    } else {
        None
    };

    Ok(json!({
        "year": year,
        "as_of_date": today.format("%Y-%m-%d").to_string(),
        "analysis_scope": {
            "exclude_needs_review": true,
            "exclude_excluded_in_analysis": true,
            "ytd_budget_mode": "elapsed_months_integer",
            "elapsed_months": elapsed_months,
        },
        "budget": {
            "monthly_total_cents": monthly_budget_total_cents,
            "monthly_total_yuan": cents_to_yuan_text(monthly_budget_total_cents),
            "annual_total_cents": annual_budget_cents,
            "annual_total_yuan": cents_to_yuan_text(annual_budget_cents),
            "ytd_budget_cents": ytd_budget_cents,
            "ytd_budget_yuan": cents_to_yuan_text(ytd_budget_cents),
            "active_item_count": budget_summary.active_count,
            "total_item_count": budget_summary.total_count,
        },
        "actual": {
            "spent_total_cents": actual_spent_cents,
            "spent_total_yuan": cents_to_yuan_text(actual_spent_cents),
            "ytd_spent_cents": ytd_actual_cents,
            "ytd_spent_yuan": cents_to_yuan_text(ytd_actual_cents),
        },
        "metrics": {
            "annual_remaining_cents": annual_remaining_cents,
            "annual_remaining_yuan": cents_to_yuan_text(annual_remaining_cents),
            "usage_rate": usage_rate.map(|v| round_to(v, 8)),
            "usage_rate_pct_text": usage_rate.map(|v| format!("{:.2}%", v * 100.0)).unwrap_or_else(|| "-".to_string()),
            "ytd_variance_cents": ytd_variance_cents,
            "ytd_variance_yuan": cents_to_yuan_text(ytd_variance_cents),
            "ytd_usage_rate": ytd_usage_rate.map(|v| round_to(v, 8)),
            "ytd_usage_rate_pct_text": ytd_usage_rate.map(|v| format!("{:.2}%", v * 100.0)).unwrap_or_else(|| "-".to_string()),
        }
    }))
}

pub fn query_budget_monthly_review_at_db_path(
    db_path: &Path,
    req: BudgetYearQueryRequest,
) -> Result<Value, String> {
    let today = Local::now().date_naive();
    let year = parse_year_param(req.year.as_deref(), today.year())?;
    let month_start = format!("{year:04}-01");
    let month_end = format!("{year:04}-12");

    let conn = Connection::open(db_path).map_err(|e| format!("打开数据库失败: {e}"))?;
    let budget_rows = load_monthly_budget_items(&conn)?;
    let budget_summary = summarize_monthly_budget_items(&budget_rows);
    let mut stmt = conn
        .prepare(
            r#"
            SELECT
                month_key,
                COUNT(*) AS tx_count,
                COALESCE(SUM(ABS(amount_cents)), 0) AS spent_cents
            FROM transactions
            WHERE direction = 'expense'
              AND month_key >= ?1
              AND month_key <= ?2
              AND needs_review = 0
              AND excluded_in_analysis = 0
            GROUP BY month_key
            ORDER BY month_key ASC
            "#,
        )
        .map_err(|e| format!("查询预算月度复盘失败: {e}"))?;
    let tx_iter = stmt
        .query_map(params![month_start, month_end], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })
        .map_err(|e| format!("查询预算月度复盘失败: {e}"))?;

    let mut tx_map = std::collections::HashMap::<String, (i64, i64)>::new();
    for row in tx_iter {
        let (month_key, tx_count, spent_cents) =
            row.map_err(|e| format!("读取预算月度复盘失败: {e}"))?;
        tx_map.insert(month_key, (tx_count, spent_cents));
    }

    let monthly_budget_cents = budget_summary.monthly_total_cents;
    let annual_budget_cents = monthly_budget_cents * 12;
    let mut rows = Vec::<Value>::new();
    let mut over_budget_months = 0_i64;
    let mut under_budget_months = 0_i64;
    let mut equal_months = 0_i64;
    let mut annual_spent_cents = 0_i64;

    for month in 1..=12 {
        let month_key = format!("{year:04}-{month:02}");
        let (tx_count, spent_cents) = tx_map.get(&month_key).copied().unwrap_or((0, 0));
        let variance_cents = monthly_budget_cents - spent_cents;
        let usage_rate = if monthly_budget_cents > 0 {
            Some(spent_cents as f64 / monthly_budget_cents as f64)
        } else {
            None
        };
        let status = if spent_cents > monthly_budget_cents {
            over_budget_months += 1;
            "超预算"
        } else if spent_cents < monthly_budget_cents {
            under_budget_months += 1;
            "低于预算"
        } else {
            equal_months += 1;
            "持平"
        };
        annual_spent_cents += spent_cents;
        rows.push(json!({
            "month_key": month_key,
            "month_index": month,
            "tx_count": tx_count,
            "budget_cents": monthly_budget_cents,
            "budget_yuan": cents_to_yuan_text(monthly_budget_cents),
            "spent_cents": spent_cents,
            "spent_yuan": cents_to_yuan_text(spent_cents),
            "variance_cents": variance_cents,
            "variance_yuan": cents_to_yuan_text(variance_cents),
            "usage_rate": usage_rate.map(|v| round_to(v, 8)),
            "usage_rate_pct_text": usage_rate.map(|v| format!("{:.2}%", v * 100.0)).unwrap_or_else(|| "-".to_string()),
            "status": status,
        }));
    }

    let annual_variance_cents = annual_budget_cents - annual_spent_cents;
    let annual_usage_rate = if annual_budget_cents > 0 {
        Some(annual_spent_cents as f64 / annual_budget_cents as f64)
    } else {
        None
    };

    Ok(json!({
        "year": year,
        "analysis_scope": {
            "exclude_needs_review": true,
            "exclude_excluded_in_analysis": true,
        },
        "summary": {
            "monthly_budget_cents": monthly_budget_cents,
            "monthly_budget_yuan": cents_to_yuan_text(monthly_budget_cents),
            "annual_budget_cents": annual_budget_cents,
            "annual_budget_yuan": cents_to_yuan_text(annual_budget_cents),
            "annual_spent_cents": annual_spent_cents,
            "annual_spent_yuan": cents_to_yuan_text(annual_spent_cents),
            "annual_variance_cents": annual_variance_cents,
            "annual_variance_yuan": cents_to_yuan_text(annual_variance_cents),
            "annual_usage_rate": annual_usage_rate.map(|v| round_to(v, 8)),
            "annual_usage_rate_pct_text": annual_usage_rate.map(|v| format!("{:.2}%", v * 100.0)).unwrap_or_else(|| "-".to_string()),
            "over_budget_months": over_budget_months,
            "under_budget_months": under_budget_months,
            "equal_months": equal_months,
        },
        "rows": rows,
    }))
}
