use super::*;

pub fn query_fire_progress_at_db_path(
    db_path: &Path,
    req: FireProgressQueryRequest,
) -> Result<Value, String> {
    let today = Local::now().date_naive();
    let year = parse_year_param(req.year.as_deref(), today.year())?;
    let withdrawal_rate =
        parse_withdrawal_rate_param(req.withdrawal_rate.as_deref(), DEFAULT_FIRE_WITHDRAWAL_RATE)?;

    let budget_overview = query_budget_overview_at_db_path(
        db_path,
        BudgetYearQueryRequest {
            year: Some(year.to_string()),
        },
    )?;
    let wealth_overview = wealth_overview_query_at_db_path(
        db_path,
        WealthOverviewQueryRequest {
            as_of_date: None,
            include_investment: Some("true".to_string()),
            include_cash: Some("true".to_string()),
            include_real_estate: Some("false".to_string()),
            include_liability: Some("false".to_string()),
        },
    )?;

    let annual_budget_cents = budget_overview
        .get("budget")
        .and_then(|v| v.get("annual_total_cents"))
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let investment_cents = wealth_overview
        .get("summary")
        .and_then(|v| v.get("investment_total_cents"))
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let cash_cents = wealth_overview
        .get("summary")
        .and_then(|v| v.get("cash_total_cents"))
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let investable_assets_cents = investment_cents + cash_cents;

    let (
        coverage_years,
        freedom_ratio,
        required_assets_cents,
        goal_gap_cents,
        remaining_to_goal_cents,
    ) = if annual_budget_cents > 0 {
        let coverage_years = investable_assets_cents as f64 / annual_budget_cents as f64;
        let freedom_ratio =
            (investable_assets_cents as f64 * withdrawal_rate) / annual_budget_cents as f64;
        let required_assets_cents = (annual_budget_cents as f64 / withdrawal_rate).ceil() as i64;
        let goal_gap_cents = investable_assets_cents - required_assets_cents;
        let remaining_to_goal_cents = (required_assets_cents - investable_assets_cents).max(0);
        (
            Some(coverage_years),
            Some(freedom_ratio),
            required_assets_cents,
            goal_gap_cents,
            remaining_to_goal_cents,
        )
    } else {
        (None, None, 0, 0, 0)
    };

    Ok(json!({
        "year": year,
        "withdrawal_rate": withdrawal_rate,
        "withdrawal_rate_pct_text": format!("{:.2}%", withdrawal_rate * 100.0),
        "budget": budget_overview.get("budget").cloned().unwrap_or_else(|| json!({})),
        "investable_assets": {
            "as_of": wealth_overview.get("as_of").cloned().unwrap_or(Value::Null),
            "investment_cents": investment_cents,
            "investment_yuan": cents_to_yuan_text(investment_cents),
            "cash_cents": cash_cents,
            "cash_yuan": cents_to_yuan_text(cash_cents),
            "total_cents": investable_assets_cents,
            "total_yuan": cents_to_yuan_text(investable_assets_cents),
        },
        "metrics": {
            "coverage_years": coverage_years.map(|v| round_to(v, 8)),
            "coverage_years_text": coverage_years.map(|v| format!("{v:.2} 年")).unwrap_or_else(|| "-".to_string()),
            "freedom_ratio": freedom_ratio.map(|v| round_to(v, 8)),
            "freedom_ratio_pct_text": freedom_ratio.map(|v| format!("{:.2}%", v * 100.0)).unwrap_or_else(|| "-".to_string()),
            "required_assets_cents": required_assets_cents,
            "required_assets_yuan": cents_to_yuan_text(required_assets_cents),
            "goal_gap_cents": goal_gap_cents,
            "goal_gap_yuan": cents_to_yuan_text(goal_gap_cents),
            "remaining_to_goal_cents": remaining_to_goal_cents,
            "remaining_to_goal_yuan": cents_to_yuan_text(remaining_to_goal_cents),
        }
    }))
}
