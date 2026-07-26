use super::*;

pub(super) fn cmb_eml_preview_at_path_with_rules_dir(
    source_path: &Path,
    review_threshold: f64,
    rules_dir: &Path,
) -> Result<Value, String> {
    let (_classified, summary) =
        parse_and_classify_emls_with_rules_dir(source_path, review_threshold, rules_dir)?;
    Ok(json!({
        "source_path": source_path.to_string_lossy().to_string(),
        "review_threshold": review_threshold,
        "summary": preview_summary_to_json(&summary),
    }))
}

pub(super) fn cmb_eml_import_at_db_path(
    db_path: &Path,
    source_path: &Path,
    review_threshold: f64,
    source_type: &str,
    rules_dir: &Path,
) -> Result<Value, String> {
    let (classified, summary) =
        parse_and_classify_emls_with_rules_dir(source_path, review_threshold, rules_dir)?;

    let conn = Connection::open(db_path).map_err(|e| format!("打开数据库失败: {e}"))?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|e| format!("设置 foreign_keys 失败: {e}"))?;
    ensure_schema_ready(&conn)?;

    let job_id = Uuid::new_v4().to_string();
    let started_at = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
    let metadata_json = serde_json::to_string(&json!({
        "source_path": source_path.to_string_lossy().to_string(),
        "source_type": source_type,
        "review_threshold": review_threshold,
        "mode": "rust_cmb_eml_import",
    }))
    .map_err(|e| format!("序列化导入任务元数据失败: {e}"))?;

    conn.execute(
        r#"
        INSERT INTO import_jobs(id, source_type, source_file, status, started_at, total_count, imported_count, error_count, metadata_json)
        VALUES (?1, ?2, ?3, 'running', ?4, 0, 0, 0, ?5)
        "#,
        params![
            job_id,
            source_type,
            source_path.to_string_lossy().to_string(),
            started_at,
            metadata_json,
        ],
    )
    .map_err(|e| format!("创建导入任务失败: {e}"))?;

    let mut imported_count = 0_i64;
    let mut error_count = 0_i64;
    let mut error_samples = Vec::<String>::new();
    let total_count = i64::try_from(classified.len()).unwrap_or(i64::MAX);

    for rec in &classified {
        let tx_id = transaction_id(rec, source_type);
        let category_id = category_id_from_name(&rec.expense_category);
        let account_id = account_id_from_last4(&rec.txn.card_last4);
        let account_name = account_name_from_last4(&rec.txn.card_last4);

        let step: Result<(), String> = (|| {
            let tx = conn
                .unchecked_transaction()
                .map_err(|e| format!("开始导入事务失败: {e}"))?;
            upsert_account(&tx, &account_id, &account_name)?;
            upsert_category(&tx, &category_id, &rec.expense_category)?;
            upsert_transaction(
                &tx,
                rec,
                &tx_id,
                &category_id,
                &account_id,
                source_type,
                &job_id,
            )?;
            tx.commit().map_err(|e| format!("提交导入事务失败: {e}"))?;
            Ok(())
        })();

        match step {
            Ok(()) => imported_count += 1,
            Err(err) => {
                error_count += 1;
                if error_samples.len() < 20 {
                    error_samples.push(err);
                }
            }
        }
    }

    let finished_at = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
    conn.execute(
        r#"
        UPDATE import_jobs
        SET status='success',
            finished_at=?1,
            total_count=?2,
            imported_count=?3,
            error_count=?4,
            error_message=?5
        WHERE id=?6
        "#,
        params![
            finished_at,
            total_count,
            imported_count,
            error_count,
            if error_samples.is_empty() {
                None::<String>
            } else {
                Some(error_samples.join("\n"))
            },
            job_id,
        ],
    )
    .map_err(|e| format!("更新导入任务状态失败: {e}"))?;

    Ok(json!({
        "db_path": db_path.to_string_lossy().to_string(),
        "source_path": source_path.to_string_lossy().to_string(),
        "source_type": source_type,
        "review_threshold": review_threshold,
        "imported_count": imported_count,
        "import_error_count": error_count,
        "import_job_id": job_id,
        "summary": preview_summary_to_json(&summary),
        "error_samples": error_samples,
    }))
}
