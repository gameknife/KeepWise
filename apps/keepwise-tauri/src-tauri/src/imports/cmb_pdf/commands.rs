use super::*;

#[tauri::command]
pub fn cmb_bank_pdf_preview(
    app: AppHandle,
    req: CmbBankPdfPreviewRequest,
) -> Result<Value, String> {
    let source_path = resolve_source_path_text(req.source_path)?;
    let review_threshold =
        resolve_review_threshold(req.review_threshold, DEFAULT_REVIEW_THRESHOLD)?;
    let rules_dir = ensure_app_rules_dir_seeded(&app)?;
    let db_path = resolve_ledger_db_path(&app)?;
    let (header, _records) = parse_pdf(Path::new(&source_path))?;
    let historical_mortgage_records =
        load_historical_mortgage_records(&db_path, &header.account_last4)?;
    preview_at_path_with_rules_dir(
        Path::new(&source_path),
        review_threshold,
        &rules_dir,
        &historical_mortgage_records,
    )
}

#[tauri::command]
pub fn cmb_bank_pdf_import(app: AppHandle, req: CmbBankPdfImportRequest) -> Result<Value, String> {
    let source_path = resolve_source_path_text(req.source_path)?;
    let review_threshold =
        resolve_review_threshold(req.review_threshold, DEFAULT_REVIEW_THRESHOLD)?;
    let source_type = req
        .source_type
        .unwrap_or_else(|| DEFAULT_SOURCE_TYPE.to_string())
        .trim()
        .to_string();
    if source_type.is_empty() {
        return Err("source_type 不能为空".to_string());
    }
    let db_path = resolve_ledger_db_path(&app)?;
    let rules_dir = ensure_app_rules_dir_seeded(&app)?;
    import_at_db_path(
        &db_path,
        Path::new(&source_path),
        review_threshold,
        &source_type,
        &rules_dir,
    )
}
