use super::*;

#[tauri::command]
pub fn analysis_export_snapshot(
    app: AppHandle,
    req: AnalysisExportRequest,
) -> Result<Value, String> {
    let db_path = resolve_ledger_db_path(&app)?;
    analysis_export_snapshot_at_db_path(&db_path, req)
}

#[tauri::command]
pub fn analysis_export_write_file(path: String, content: String) -> Result<Value, String> {
    let target = path.trim();
    if target.is_empty() {
        return Err("path 必填".to_string());
    }
    let path = Path::new(target);
    if path
        .extension()
        .and_then(|v| v.to_str())
        .map(|v| v.to_lowercase() != "md")
        .unwrap_or(true)
    {
        return Err("导出文件必须以 .md 结尾".to_string());
    }
    let bytes = content.as_bytes();
    if bytes.len() > MAX_EXPORT_BYTES {
        return Err("导出内容超过 10MB 上限".to_string());
    }
    if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建导出目录失败: {e}"))?;
    }
    std::fs::write(path, bytes).map_err(|e| format!("写入 Markdown 文件失败: {e}"))?;
    Ok(json!({
        "written": true,
        "path": path.to_string_lossy().to_string(),
        "bytes": bytes.len(),
    }))
}
