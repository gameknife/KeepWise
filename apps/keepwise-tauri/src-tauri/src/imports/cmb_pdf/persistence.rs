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
    let mut names = HashSet::new();
    for r in rows {
        names.insert(r.map_err(|e| format!("读取数据库表失败: {e}"))?);
    }
    for required in ["accounts", "categories", "transactions", "import_jobs"] {
        if !names.contains(required) {
            return Err(format!("数据库缺少必要表: {required}。请先执行迁移。"));
        }
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
        VALUES (?1, ?2, 'bank', 'CNY', 0)
        ON CONFLICT(id) DO UPDATE SET
            name=excluded.name,
            account_type='bank',
            updated_at=datetime('now')
        "#,
        params![account_id, account_name],
    )
    .map_err(|e| format!("写入银行账户失败: {e}"))?;
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

pub(super) fn category_id_from_name(name: &str) -> String {
    let normalized = if name.trim().is_empty() {
        "待分类"
    } else {
        name.trim()
    };
    let mut hasher = Sha1::new();
    hasher.update(normalized.as_bytes());
    let hex = format!("{:x}", hasher.finalize());
    format!("cat_{}", &hex[..12])
}

pub(super) fn transaction_identity_base(row: &ClassifiedPdfRow, header: &PdfHeader) -> String {
    let tx = &row.tx;
    [
        header.account_last4.as_str(),
        &tx.date[0..4],
        &format!("{}", tx.date[5..7].parse::<u32>().unwrap_or(0)),
        tx.currency.as_str(),
        tx.summary.as_str(),
        tx.date.as_str(),
        tx.raw_detail.as_str(),
        tx.amount_text.as_str(),
        tx.balance_text.as_str(),
    ]
    .join("|")
}

pub(super) fn transaction_id(
    row: &ClassifiedPdfRow,
    header: &PdfHeader,
    source_type: &str,
    occurrence_index: usize,
) -> String {
    let source = format!(
        "{source_type}|{}|{occurrence_index}",
        transaction_identity_base(row, header)
    );
    let mut hasher = Sha1::new();
    hasher.update(source.as_bytes());
    format!("{:x}", hasher.finalize())
}

#[derive(Debug, Default)]
pub(super) struct ImportRowsOutcome {
    pub(super) total_count: i64,
    pub(super) imported_count: i64,
    pub(super) duplicate_skipped_count: i64,
    pub(super) error_count: i64,
    pub(super) error_samples: Vec<String>,
}

pub(super) fn parsed_row_fingerprint(row: &ClassifiedPdfRow) -> String {
    let tx = &row.tx;
    [
        tx.date.as_str(),
        tx.currency.as_str(),
        tx.amount_text.as_str(),
        tx.balance_text.as_str(),
        tx.raw_detail.as_str(),
        tx.summary.as_str(),
        tx.counterparty.as_str(),
        row.direction.as_str(),
    ]
    .join("|")
}

pub(super) fn import_classified_rows(
    conn: &Connection,
    header: &PdfHeader,
    rows: &[&ClassifiedPdfRow],
    source_type: &str,
    import_job_id: &str,
) -> ImportRowsOutcome {
    let mut outcome = ImportRowsOutcome {
        total_count: i64::try_from(rows.len()).unwrap_or(i64::MAX),
        ..ImportRowsOutcome::default()
    };
    let mut occurrence_counters: HashMap<String, usize> = HashMap::new();
    let mut seen_fingerprints = HashSet::<String>::new();

    for row in rows {
        let fingerprint = parsed_row_fingerprint(row);
        if !seen_fingerprints.insert(fingerprint) {
            outcome.duplicate_skipped_count += 1;
            continue;
        }

        let identity = transaction_identity_base(row, header);
        let occurrence = occurrence_counters.get(&identity).copied().unwrap_or(0) + 1;
        occurrence_counters.insert(identity, occurrence);
        let tx_id = transaction_id(row, header, source_type, occurrence);
        let category_id = category_id_from_name(&row.expense_category);

        let step: Result<(), String> = (|| {
            let tx = conn
                .unchecked_transaction()
                .map_err(|e| format!("开始导入事务失败: {e}"))?;
            upsert_transaction(
                &tx,
                row,
                header,
                &tx_id,
                &category_id,
                source_type,
                import_job_id,
            )?;
            tx.commit().map_err(|e| format!("提交导入事务失败: {e}"))?;
            Ok(())
        })();

        match step {
            Ok(()) => outcome.imported_count += 1,
            Err(err) => {
                outcome.error_count += 1;
                if outcome.error_samples.len() < 20 {
                    outcome.error_samples.push(err);
                }
            }
        }
    }

    outcome
}

pub(super) fn upsert_transaction(
    conn: &Connection,
    row: &ClassifiedPdfRow,
    header: &PdfHeader,
    tx_id: &str,
    category_id: &str,
    source_type: &str,
    import_job_id: &str,
) -> Result<(), String> {
    let source_name = stable_source_name(header);
    let account_id = format!("acct_cmb_debit_{}", header.account_last4);
    let account_name = format!("招行借记卡尾号{}", header.account_last4);
    let merchant = normalize_counterparty(&row.tx.counterparty);
    let merchant_normalized = normalize_merchant(&merchant);
    upsert_account(conn, &account_id, &account_name)?;
    upsert_category(conn, category_id, &row.expense_category)?;

    conn.execute(
        r#"
        INSERT INTO transactions(
            id, external_ref, occurred_at, posted_at, month_key, amount_cents, currency, direction,
            description, merchant, merchant_normalized, statement_category, category_id, account_id,
            source_type, source_file, import_job_id, confidence, needs_review, excluded_in_analysis, exclude_reason
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21)
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
                     AND SUBSTR(COALESCE(transactions.exclude_reason, ''), 1, 19) = ?22
                THEN 1
                ELSE excluded.excluded_in_analysis
            END,
            exclude_reason=CASE
                WHEN transactions.excluded_in_analysis = 1
                     AND SUBSTR(COALESCE(transactions.exclude_reason, ''), 1, 19) = ?22
                THEN transactions.exclude_reason
                ELSE excluded.exclude_reason
            END,
            updated_at=datetime('now')
        "#,
        params![
            tx_id,
            format!("{source_type}:{tx_id}"),
            row.tx.date,
            row.tx.date,
            &row.tx.date[..7],
            row.tx.amount_cents,
            row.tx.currency,
            row.direction,
            row.tx.raw_detail,
            merchant,
            merchant_normalized,
            row.tx.summary,
            category_id,
            account_id,
            source_type,
            source_name,
            import_job_id,
            row.confidence.clamp(0.0, 1.0),
            row.needs_review,
            row.excluded_in_analysis,
            row.exclude_reason,
            MANUAL_TX_EXCLUDE_REASON_PREFIX,
        ],
    )
    .map_err(|e| format!("写入 PDF 交易失败: {e}"))?;
    Ok(())
}
