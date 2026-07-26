use super::*;

pub fn analysis_export_snapshot_at_db_path(
    db_path: &Path,
    req: AnalysisExportRequest,
) -> Result<Value, String> {
    let now = Local::now();
    let year = req
        .year
        .unwrap_or_else(|| now.date_naive().year().to_string())
        .trim()
        .to_string();
    let wealth_curve_preset = req
        .wealth_curve_preset
        .unwrap_or_else(|| "since_inception".to_string())
        .trim()
        .to_string();
    let include_consumption_detail = bool_param(req.include_consumption_detail.as_deref(), false);
    let fire_withdrawal_rate = req
        .fire_withdrawal_rate
        .unwrap_or_else(|| "0.04".to_string())
        .trim()
        .to_string();

    let wealth_overview = safe_payload(
        "wealth_overview",
        wealth_overview_query_at_db_path(
            db_path,
            WealthOverviewQueryRequest {
                as_of_date: None,
                include_investment: Some("true".to_string()),
                include_cash: Some("true".to_string()),
                include_real_estate: Some("true".to_string()),
                include_liability: Some("true".to_string()),
            },
        ),
    );
    let as_of = wealth_overview
        .get("summary")
        .and_then(|v| v.get("as_of"))
        .and_then(Value::as_str)
        .or_else(|| wealth_overview.get("as_of").and_then(Value::as_str))
        .unwrap_or("")
        .to_string();

    let wealth_curve = safe_payload(
        "wealth_curve",
        wealth_curve_query_at_db_path(
            db_path,
            WealthCurveQueryRequest {
                preset: Some(wealth_curve_preset.clone()),
                from_date: None,
                to_date: None,
                include_investment: Some("true".to_string()),
                include_cash: Some("true".to_string()),
                include_real_estate: Some("true".to_string()),
                include_liability: Some("true".to_string()),
            },
        ),
    );

    let portfolio_return = |preset: &str| {
        safe_payload(
            &format!("portfolio_{preset}"),
            investment_return_query_at_db_path(
                db_path,
                InvestmentReturnQueryRequest {
                    account_id: PORTFOLIO_ACCOUNT_ID.to_string(),
                    preset: Some(preset.to_string()),
                    from_date: None,
                    to_date: None,
                },
            ),
        )
    };

    let accounts_since_inception = safe_payload(
        "accounts_since_inception",
        investment_returns_query_at_db_path(
            db_path,
            InvestmentReturnsQueryRequest {
                preset: Some("since_inception".to_string()),
                from_date: None,
                to_date: None,
                keyword: None,
                limit: Some(500),
            },
        ),
    );

    let fire_req = FireProgressQueryRequest {
        year: Some(year.clone()),
        withdrawal_rate: Some(fire_withdrawal_rate.clone()),
    };
    let consumption_req = ConsumptionReportQueryRequest {
        year: Some(year.clone()),
    };

    let consumption = safe_payload(
        "consumption",
        query_consumption_report_at_db_path(db_path, consumption_req),
    );
    let consumption = if include_consumption_detail {
        consumption
    } else {
        prune_consumption_detail(consumption)
    };

    let account_notes_payload =
        query_account_notes_at_db_path(db_path, AccountNotesQueryRequest { account_id: None })?;
    let account_notes = account_notes_payload
        .get("rows")
        .cloned()
        .unwrap_or_else(|| json!([]));

    Ok(json!({
        "generated_at": now.format("%Y-%m-%dT%H:%M:%S%:z").to_string(),
        "as_of": as_of,
        "year": year,
        "wealth_curve_preset": wealth_curve_preset,
        "include_consumption_detail": include_consumption_detail,
        "fire_withdrawal_rate": fire_withdrawal_rate,
        "wealth_overview": wealth_overview,
        "wealth_curve": wealth_curve,
        "investment_returns": {
            "portfolio_ytd": portfolio_return("ytd"),
            "portfolio_1y": portfolio_return("1y"),
            "portfolio_3y": portfolio_return("3y"),
            "portfolio_since_inception": portfolio_return("since_inception"),
            "accounts_since_inception": accounts_since_inception,
        },
        "fire": safe_payload("fire", query_fire_progress_at_db_path(db_path, fire_req)),
        "budget_overview": safe_payload(
            "budget_overview",
            query_budget_overview_at_db_path(
                db_path,
                BudgetYearQueryRequest {
                    year: Some(year.clone()),
                },
            ),
        ),
        "salary_income": safe_payload(
            "salary_income",
            query_salary_income_overview_at_db_path(
                db_path,
                BudgetYearQueryRequest {
                    year: Some(year.clone()),
                },
            ),
        ),
        "consumption": consumption,
        "account_catalog": safe_payload(
            "account_catalog",
            query_account_catalog_at_db_path(
                db_path,
                AccountCatalogQueryRequest {
                    kind: Some("all".to_string()),
                    keyword: None,
                    limit: Some(1000),
                },
            ),
        ),
        "account_notes": account_notes,
    }))
}
