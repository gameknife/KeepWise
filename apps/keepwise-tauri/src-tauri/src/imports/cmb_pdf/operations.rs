use super::*;

pub(super) fn preview_at_path_with_rules_dir(
    pdf_path: &Path,
    review_threshold: f64,
    rules_root: &Path,
    historical_mortgage_records: &[BankPdfTransaction],
) -> Result<Value, String> {
    let (_header, _rows, preview) = build_preview_and_rows_with_rules_dir(
        pdf_path,
        review_threshold,
        rules_root,
        historical_mortgage_records,
    )?;
    Ok(preview)
}

pub(super) fn import_at_db_path(
    db_path: &Path,
    pdf_path: &Path,
    review_threshold: f64,
    source_type: &str,
    rules_root: &Path,
) -> Result<Value, String> {
    let (header, records) = parse_pdf(pdf_path)?;
    let historical_mortgage_records =
        load_historical_mortgage_records(db_path, &header.account_last4)?;
    let merchant_map = load_merchant_map(&rules_root.join("merchant_map.csv"));
    let category_rules = load_category_rules(&rules_root.join("category_rules.csv"));
    let transfer_whitelist =
        load_bank_transfer_whitelist_names(&rules_root.join("bank_transfer_whitelist.csv"));
    let (rows, mut preview) = classify_transactions(
        &header,
        &records,
        &historical_mortgage_records,
        &transfer_whitelist,
        &merchant_map,
        &category_rules,
        review_threshold,
    );
    preview["file"] = json!({
        "path": pdf_path.to_string_lossy().to_string(),
        "name": pdf_path.file_name().and_then(|s| s.to_str()).unwrap_or_default(),
        "stable_source_name": stable_source_name(&header),
    });

    let conn = Connection::open(db_path).map_err(|e| format!("打开数据库失败: {e}"))?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|e| format!("设置 foreign_keys 失败: {e}"))?;
    ensure_schema_ready(&conn)?;

    let job_id = Uuid::new_v4().to_string();
    let started_at = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
    let metadata_json = serde_json::to_string(&json!({
        "source_path": pdf_path.to_string_lossy().to_string(),
        "source_type": source_type,
        "review_threshold": review_threshold,
        "stable_source_name": stable_source_name(&header),
    }))
    .map_err(|e| format!("序列化导入任务元数据失败: {e}"))?;

    conn.execute(
        r#"
        INSERT INTO import_jobs(id, source_type, source_file, status, started_at, total_count, imported_count, error_count, metadata_json)
        VALUES (?1, ?2, ?3, 'running', ?4, 0, 0, 0, ?5)
        "#,
        params![job_id, source_type, pdf_path.to_string_lossy().to_string(), started_at, metadata_json],
    )
    .map_err(|e| format!("创建导入任务失败: {e}"))?;

    let import_rows: Vec<&ClassifiedPdfRow> = rows.iter().filter(|r| r.include_in_import).collect();
    let import_outcome = import_classified_rows(&conn, &header, &import_rows, source_type, &job_id);

    let finished_at = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
    conn.execute(
        r#"
        UPDATE import_jobs
        SET status='success', finished_at=?1, total_count=?2, imported_count=?3, error_count=?4, error_message=?5
        WHERE id=?6
        "#,
        params![
            finished_at,
            import_outcome.total_count,
            import_outcome.imported_count,
            import_outcome.error_count,
            if import_outcome.error_samples.is_empty() {
                None::<String>
            } else {
                Some(import_outcome.error_samples.join("\n"))
            },
            job_id,
        ],
    )
    .map_err(|e| format!("更新导入任务状态失败: {e}"))?;

    Ok(json!({
        "db_path": db_path.to_string_lossy().to_string(),
        "source_path": pdf_path.to_string_lossy().to_string(),
        "source_type": source_type,
        "review_threshold": review_threshold,
        "imported_count": import_outcome.imported_count,
        "duplicate_skipped_count": import_outcome.duplicate_skipped_count,
        "import_error_count": import_outcome.error_count,
        "import_job_id": job_id,
        "preview": preview,
        "error_samples": import_outcome.error_samples,
    }))
}
