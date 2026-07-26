use super::*;

pub(super) fn stable_source_name(header: &PdfHeader) -> String {
    format!(
        "cmb_bank_statement_{}_{}_{}.pdf",
        header.account_last4, header.range_start, header.range_end
    )
}

pub(super) fn load_historical_mortgage_records(
    db_path: &Path,
    account_last4: &str,
) -> Result<Vec<BankPdfTransaction>, String> {
    if !db_path.exists() {
        return Ok(Vec::new());
    }

    let conn = match Connection::open(db_path) {
        Ok(conn) => conn,
        Err(_) => return Ok(Vec::new()),
    };
    let transactions_table_exists = conn
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='transactions' LIMIT 1",
            [],
            |_row| Ok(true),
        )
        .unwrap_or(false);
    if !transactions_table_exists {
        return Ok(Vec::new());
    }

    let account_id = format!("acct_cmb_debit_{account_last4}");
    let mut stmt = conn
        .prepare(
            r#"
            SELECT
                COALESCE(occurred_at, posted_at, '') AS tx_date,
                currency,
                amount_cents,
                COALESCE(
                    NULLIF(TRIM(merchant), ''),
                    NULLIF(TRIM(merchant_normalized), ''),
                    COALESCE(description, '')
                ) AS counterparty,
                COALESCE(description, '个贷交易') AS raw_detail
            FROM transactions
            WHERE source_type = 'cmb_bank_pdf'
              AND account_id = ?1
              AND statement_category = '个贷交易'
              AND direction = 'expense'
              AND currency = 'CNY'
            GROUP BY
                COALESCE(occurred_at, posted_at, ''),
                currency,
                amount_cents,
                COALESCE(description, ''),
                COALESCE(merchant, ''),
                COALESCE(merchant_normalized, '')
            "#,
        )
        .map_err(|e| format!("查询历史房贷样本失败: {e}"))?;

    let rows = stmt
        .query_map(params![account_id], |row| {
            Ok(BankPdfTransaction {
                page: 0,
                date: row.get::<_, String>(0)?,
                currency: row.get::<_, String>(1)?,
                amount_text: String::new(),
                amount_cents: row.get::<_, i64>(2)?,
                balance_text: String::new(),
                raw_detail: row.get::<_, String>(4)?,
                summary: "个贷交易".to_string(),
                counterparty: row.get::<_, String>(3)?,
            })
        })
        .map_err(|e| format!("读取历史房贷样本失败: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("组装历史房贷样本失败: {e}"))?;

    Ok(rows
        .into_iter()
        .filter(|row| !row.date.trim().is_empty() && !row.counterparty.trim().is_empty())
        .collect())
}

pub(super) fn build_preview_and_rows_with_rules_dir(
    pdf_path: &Path,
    review_threshold: f64,
    rules_root: &Path,
    historical_mortgage_records: &[BankPdfTransaction],
) -> Result<(PdfHeader, Vec<ClassifiedPdfRow>, Value), String> {
    let (header, records) = parse_pdf(pdf_path)?;
    let merchant_map = load_merchant_map(&rules_root.join("merchant_map.csv"));
    let category_rules = load_category_rules(&rules_root.join("category_rules.csv"));
    let transfer_whitelist =
        load_bank_transfer_whitelist_names(&rules_root.join("bank_transfer_whitelist.csv"));
    let (rows, mut preview) = classify_transactions(
        &header,
        &records,
        historical_mortgage_records,
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
    Ok((header, rows, preview))
}
