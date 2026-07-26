use super::*;

pub(super) fn resolve_source_path_text(source_path: Option<String>) -> Result<String, String> {
    let path = source_path.unwrap_or_default();
    let path = path.trim().to_string();
    if path.is_empty() {
        return Err("source_path 必填".to_string());
    }
    Ok(path)
}

pub(super) fn yzxy_preview_file_at_path(file_path: &Path) -> Result<Value, String> {
    let parsed = parse_input_file(file_path)?;
    let preview_rows = parsed
        .rows
        .iter()
        .take(10)
        .map(|row| {
            json!({
                "snapshot_date": row.snapshot_date,
                "account_name": row.account_name,
                "total_assets_cents": row.total_assets_cents,
                "transfer_amount_cents": row.transfer_amount_cents,
            })
        })
        .collect::<Vec<_>>();

    Ok(json!({
        "file": file_path.to_string_lossy().to_string(),
        "parser_kind": parsed.parser_kind,
        "mapping": parsed.mapping,
        "parsed_count": parsed.rows.len(),
        "error_count": parsed.errors.len(),
        "errors": parsed.errors.into_iter().take(20).collect::<Vec<_>>(),
        "preview_rows": preview_rows,
    }))
}

pub(super) fn yzxy_import_file_at_db_path(
    db_path: &Path,
    file_path: &Path,
    source_type: &str,
) -> Result<Value, String> {
    let parsed = parse_input_file(file_path)?;

    let conn = Connection::open(db_path).map_err(|e| format!("打开数据库失败: {e}"))?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|e| format!("设置 foreign_keys 失败: {e}"))?;
    ensure_schema_ready(&conn)?;

    let job_id = Uuid::new_v4().to_string();
    let started_at = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
    let metadata_json = serde_json::to_string(&json!({
        "source_type": source_type,
        "source_file": file_path.to_string_lossy().to_string(),
        "parser_kind": parsed.parser_kind,
        "mapping": parsed.mapping,
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
            file_path.to_string_lossy().to_string(),
            started_at,
            metadata_json
        ],
    )
    .map_err(|e| format!("创建导入任务失败: {e}"))?;

    let total_count = (parsed.rows.len() + parsed.errors.len()) as i64;
    let mut imported_count = 0_i64;
    let mut error_count = parsed.errors.len() as i64;

    let mut db_error_samples = Vec::<String>::new();
    let file_text = file_path.to_string_lossy().to_string();
    for row in &parsed.rows {
        let account_id = account_id_from_name(&row.account_name);
        let step: Result<(), String> = (|| {
            let tx = conn
                .unchecked_transaction()
                .map_err(|e| format!("开始导入记录事务失败: {e}"))?;
            ensure_account(&tx, &account_id, &row.account_name)?;
            upsert_investment_record(
                &tx,
                &account_id,
                row,
                source_type,
                Some(&file_text),
                Some(&job_id),
            )?;
            tx.commit()
                .map_err(|e| format!("提交导入记录事务失败: {e}"))?;
            Ok(())
        })();

        match step {
            Ok(()) => imported_count += 1,
            Err(err) => {
                error_count += 1;
                if db_error_samples.len() < 20 {
                    db_error_samples.push(err);
                }
            }
        }
    }

    let finished_at = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
    let parse_error_samples = parsed.errors.iter().take(20).cloned().collect::<Vec<_>>();
    let mut all_error_samples = parse_error_samples;
    for item in db_error_samples {
        if all_error_samples.len() >= 20 {
            break;
        }
        all_error_samples.push(item);
    }
    let error_message = if all_error_samples.is_empty() {
        None
    } else {
        Some(all_error_samples.join("\n"))
    };

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
            error_message,
            job_id
        ],
    )
    .map_err(|e| format!("更新导入任务状态失败: {e}"))?;

    Ok(json!({
        "db_path": db_path.to_string_lossy().to_string(),
        "file": file_text,
        "source_type": source_type,
        "imported_count": imported_count,
        "error_count": error_count,
        "import_job_id": job_id,
        "preview": {
            "parser_kind": parsed.parser_kind,
            "mapping": parsed.mapping,
            "parsed_count": parsed.rows.len(),
            "parse_error_count": parsed.errors.len(),
            "errors": all_error_samples,
            "preview_rows": parsed.rows.iter().take(10).map(|row| json!({
                "snapshot_date": row.snapshot_date,
                "account_name": row.account_name,
                "total_assets_cents": row.total_assets_cents,
                "transfer_amount_cents": row.transfer_amount_cents,
            })).collect::<Vec<_>>()
        }
    }))
}
