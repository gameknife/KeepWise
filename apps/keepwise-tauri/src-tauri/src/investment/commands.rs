use super::*;

#[tauri::command]
pub fn investment_return_query(
    app: AppHandle,
    req: InvestmentReturnQueryRequest,
) -> Result<Value, String> {
    let db_path = resolve_ledger_db_path(&app)?;
    investment_return_query_at_db_path(&db_path, req)
}

#[tauri::command]
pub fn investment_curve_query(
    app: AppHandle,
    req: InvestmentCurveQueryRequest,
) -> Result<Value, String> {
    let db_path = resolve_ledger_db_path(&app)?;
    investment_curve_query_at_db_path(&db_path, req)
}

#[tauri::command]
pub async fn investment_curve_benchmarks_query(
    app: AppHandle,
    req: InvestmentCurveQueryRequest,
) -> Result<Value, String> {
    let db_path = resolve_ledger_db_path(&app)?;
    let join_result = tauri::async_runtime::spawn_blocking(move || {
        investment_curve_benchmarks_query_at_db_path(&db_path, req)
    })
    .await;
    match join_result {
        Ok(result) => result,
        Err(err) => Err(format!("加载指数对比失败: {err}")),
    }
}

#[tauri::command]
pub fn investment_returns_query(
    app: AppHandle,
    req: InvestmentReturnsQueryRequest,
) -> Result<Value, String> {
    let db_path = resolve_ledger_db_path(&app)?;
    investment_returns_query_at_db_path(&db_path, req)
}
