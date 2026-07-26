use super::*;

#[tauri::command]
pub fn yzxy_preview_file(req: YzxyPreviewRequest) -> Result<Value, String> {
    let source_path = resolve_source_path_text(req.source_path)?;
    yzxy_preview_file_at_path(Path::new(&source_path))
}

#[tauri::command]
pub fn yzxy_import_file(app: AppHandle, req: YzxyImportRequest) -> Result<Value, String> {
    let source_path = resolve_source_path_text(req.source_path)?;
    let source_type = req
        .source_type
        .unwrap_or_else(|| DEFAULT_SOURCE_TYPE.to_string());
    let source_type = source_type.trim();
    if source_type.is_empty() {
        return Err("source_type 不能为空".to_string());
    }

    let db_path = resolve_ledger_db_path(&app)?;
    yzxy_import_file_at_db_path(&db_path, Path::new(&source_path), source_type)
}
