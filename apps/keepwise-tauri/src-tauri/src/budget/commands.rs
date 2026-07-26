use super::*;

#[tauri::command]
pub fn query_monthly_budget_items(
    app: AppHandle,
    req: MonthlyBudgetItemsQueryRequest,
) -> Result<Value, String> {
    let db_path = resolve_ledger_db_path(&app)?;
    query_monthly_budget_items_at_db_path(&db_path, req)
}

#[tauri::command]
pub fn upsert_monthly_budget_item(
    app: AppHandle,
    req: MonthlyBudgetItemUpsertRequest,
) -> Result<Value, String> {
    let db_path = resolve_ledger_db_path(&app)?;
    upsert_monthly_budget_item_at_db_path(&db_path, req)
}

#[tauri::command]
pub fn delete_monthly_budget_item(
    app: AppHandle,
    req: MonthlyBudgetItemDeleteRequest,
) -> Result<Value, String> {
    let db_path = resolve_ledger_db_path(&app)?;
    delete_monthly_budget_item_at_db_path(&db_path, req)
}

#[tauri::command]
pub fn query_budget_overview(app: AppHandle, req: BudgetYearQueryRequest) -> Result<Value, String> {
    let db_path = resolve_ledger_db_path(&app)?;
    query_budget_overview_at_db_path(&db_path, req)
}

#[tauri::command]
pub fn query_budget_monthly_review(
    app: AppHandle,
    req: BudgetYearQueryRequest,
) -> Result<Value, String> {
    let db_path = resolve_ledger_db_path(&app)?;
    query_budget_monthly_review_at_db_path(&db_path, req)
}

#[tauri::command]
pub fn query_salary_income_overview(
    app: AppHandle,
    req: BudgetYearQueryRequest,
) -> Result<Value, String> {
    let db_path = resolve_ledger_db_path(&app)?;
    query_salary_income_overview_at_db_path(&db_path, req)
}

#[tauri::command]
pub fn query_consumption_report(
    app: AppHandle,
    req: ConsumptionReportQueryRequest,
) -> Result<Value, String> {
    let db_path = resolve_ledger_db_path(&app)?;
    let merchant_category_overrides = load_merchant_category_overrides(&app)?;
    query_consumption_report_with_category_overrides_at_db_path(
        &db_path,
        req,
        Some(&merchant_category_overrides),
    )
}

#[tauri::command]
pub fn query_fire_progress(app: AppHandle, req: FireProgressQueryRequest) -> Result<Value, String> {
    let db_path = resolve_ledger_db_path(&app)?;
    query_fire_progress_at_db_path(&db_path, req)
}
