use super::*;

#[tauri::command]
pub async fn analysis_export_run_local_cli(
    app: AppHandle,
    req: AnalysisExportRunLocalCliRequest,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || analysis_export_run_local_cli_blocking(app, req))
        .await
        .map_err(|e| format!("本地 CLI 后台任务失败: {e}"))?
}

#[tauri::command]
pub async fn analysis_export_run_openai_compatible(
    app: AppHandle,
    req: AnalysisExportRunOpenAiCompatibleRequest,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        analysis_export_run_openai_compatible_blocking(app, req)
    })
    .await
    .map_err(|e| format!("AI API 后台任务失败: {e}"))?
}

#[tauri::command]
pub async fn analysis_export_run_codex(
    app: AppHandle,
    req: AnalysisExportRunCodexRequest,
) -> Result<Value, String> {
    analysis_export_run_local_cli(
        app,
        AnalysisExportRunLocalCliRequest {
            cli_key: Some("codex".to_string()),
            content: req.content,
            analysis_prompt: req.analysis_prompt,
            timeout_seconds: req.timeout_seconds,
            run_id: req.run_id,
        },
    )
    .await
}
