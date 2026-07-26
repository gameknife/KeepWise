use super::*;

#[tauri::command]
pub fn wealth_overview_query(
    app: AppHandle,
    req: WealthOverviewQueryRequest,
) -> Result<Value, String> {
    let db_path = resolve_ledger_db_path(&app)?;
    wealth_overview_query_at_db_path(&db_path, req)
}

#[tauri::command]
pub fn wealth_curve_query(app: AppHandle, req: WealthCurveQueryRequest) -> Result<Value, String> {
    let db_path = resolve_ledger_db_path(&app)?;
    wealth_curve_query_at_db_path(&db_path, req)
}
