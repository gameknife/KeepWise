use super::*;

pub(super) fn ensure_schema_ready(conn: &Connection) -> Result<(), String> {
    let mut stmt = conn
        .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('accounts','categories','transactions','import_jobs')",
        )
        .map_err(|e| format!("检查数据库表失败: {e}"))?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| format!("读取数据库表失败: {e}"))?;
    let mut table_names = HashSet::new();
    for row in rows {
        table_names.insert(row.map_err(|e| format!("读取数据库表失败: {e}"))?);
    }
    let required = ["accounts", "categories", "transactions", "import_jobs"];
    let missing = required
        .iter()
        .filter(|t| !table_names.contains(**t))
        .copied()
        .collect::<Vec<_>>();
    if !missing.is_empty() {
        return Err(format!(
            "数据库缺少必要表: {}。请先执行迁移。",
            missing.join(", ")
        ));
    }
    Ok(())
}

pub(super) fn upsert_account(
    conn: &Connection,
    account_id: &str,
    account_name: &str,
) -> Result<(), String> {
    conn.execute(
        r#"
        INSERT INTO accounts(id, name, account_type, currency, initial_balance_cents)
        VALUES (?1, ?2, 'credit_card', 'CNY', 0)
        ON CONFLICT(id) DO UPDATE SET
            name=excluded.name,
            account_type='credit_card',
            updated_at=datetime('now')
        "#,
        params![account_id, account_name],
    )
    .map_err(|e| format!("写入账户失败: {e}"))?;
    Ok(())
}

pub(super) fn upsert_category(
    conn: &Connection,
    category_id: &str,
    category_name: &str,
) -> Result<(), String> {
    conn.execute(
        r#"
        INSERT INTO categories(id, name, level, budget_enabled, is_active)
        VALUES (?1, ?2, 1, 1, 1)
        ON CONFLICT(id) DO UPDATE SET
            name=excluded.name,
            is_active=1,
            updated_at=datetime('now')
        "#,
        params![category_id, category_name],
    )
    .map_err(|e| format!("写入分类失败: {e}"))?;
    Ok(())
}

pub(super) fn upsert_transaction(
    conn: &Connection,
    rec: &ClassifiedTransaction,
    tx_id: &str,
    category_id: &str,
    account_id: &str,
    source_type: &str,
    import_job_id: &str,
) -> Result<(), String> {
    let txn = &rec.txn;
    let description = txn.description.trim();
    let merchant = if description.is_empty() {
        ""
    } else {
        description
    };
    let merchant_normalized = if rec.merchant_normalized.trim().is_empty() {
        merchant
    } else {
        rec.merchant_normalized.trim()
    };
    let external_ref = format!("{source_type}:{tx_id}");
    let source_file = txn.source_file.trim();

    conn.execute(
        r#"
        INSERT INTO transactions(
            id, external_ref, occurred_at, posted_at, month_key, amount_cents, currency, direction,
            description, merchant, merchant_normalized, statement_category, category_id, account_id,
            source_type, source_file, import_job_id, confidence, needs_review, excluded_in_analysis, exclude_reason
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'CNY', ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20)
        ON CONFLICT(id) DO UPDATE SET
            external_ref=excluded.external_ref,
            occurred_at=excluded.occurred_at,
            posted_at=excluded.posted_at,
            month_key=excluded.month_key,
            amount_cents=excluded.amount_cents,
            currency=excluded.currency,
            direction=excluded.direction,
            description=excluded.description,
            merchant=excluded.merchant,
            merchant_normalized=excluded.merchant_normalized,
            statement_category=excluded.statement_category,
            category_id=excluded.category_id,
            account_id=excluded.account_id,
            source_type=excluded.source_type,
            source_file=excluded.source_file,
            import_job_id=excluded.import_job_id,
            confidence=excluded.confidence,
            needs_review=excluded.needs_review,
            excluded_in_analysis=CASE
                WHEN transactions.excluded_in_analysis = 1
                     AND SUBSTR(COALESCE(transactions.exclude_reason, ''), 1, 19) = ?21
                THEN 1
                ELSE excluded.excluded_in_analysis
            END,
            exclude_reason=CASE
                WHEN transactions.excluded_in_analysis = 1
                     AND SUBSTR(COALESCE(transactions.exclude_reason, ''), 1, 19) = ?21
                THEN transactions.exclude_reason
                ELSE excluded.exclude_reason
            END,
            updated_at=datetime('now')
        "#,
        params![
            tx_id,
            external_ref,
            if txn.trans_date.trim().is_empty() { None::<String> } else { Some(txn.trans_date.clone()) },
            if txn.post_date.trim().is_empty() { None::<String> } else { Some(txn.post_date.clone()) },
            resolve_month_key(txn),
            txn.amount_cents,
            direction_from_statement_category(&txn.statement_category),
            description,
            merchant,
            merchant_normalized,
            txn.statement_category,
            category_id,
            account_id,
            source_type,
            source_file,
            import_job_id,
            safe_confidence(rec.confidence),
            rec.needs_review,
            rec.excluded_in_analysis,
            rec.exclude_reason,
            MANUAL_TX_EXCLUDE_REASON_PREFIX,
        ],
    )
    .map_err(|e| format!("写入交易失败: {e}"))?;
    Ok(())
}
