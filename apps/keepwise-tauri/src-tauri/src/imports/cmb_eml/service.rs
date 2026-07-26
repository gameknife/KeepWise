use super::*;

#[cfg(test)]
pub(super) fn parse_and_classify_emls(
    source_path: &Path,
    review_threshold: f64,
) -> Result<(Vec<ClassifiedTransaction>, PreviewSummary), String> {
    let rules_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("seeds/rules");
    parse_and_classify_emls_with_rules_dir(source_path, review_threshold, &rules_dir)
}

pub(super) fn parse_and_classify_emls_with_rules_dir(
    source_path: &Path,
    review_threshold: f64,
    rules_dir: &Path,
) -> Result<(Vec<ClassifiedTransaction>, PreviewSummary), String> {
    let (files, root_for_rel) = collect_eml_files(source_path)?;
    let (merchant_map, category_rules, exclusion_rules) = load_rules_bundle(rules_dir);

    let mut parsed_records = Vec::<ParsedEmlTransaction>::new();
    let mut failed_files = Vec::<Value>::new();
    let mut failed_files_total = 0_usize;

    for file in &files {
        match parse_single_eml(file, &root_for_rel) {
            Ok(mut rows) => parsed_records.append(&mut rows),
            Err(err) => {
                failed_files_total += 1;
                if failed_files.len() < 20 {
                    failed_files.push(json!({
                        "file": file.to_string_lossy().to_string(),
                        "error": err,
                    }));
                }
            }
        }
    }

    if parsed_records.is_empty() {
        let details = failed_files
            .iter()
            .map(|v| {
                let file = v.get("file").and_then(Value::as_str).unwrap_or("unknown");
                let err = v.get("error").and_then(Value::as_str).unwrap_or("unknown");
                format!("{file}: {err}")
            })
            .collect::<Vec<_>>()
            .join("; ");
        return Err(if details.is_empty() {
            "未产出任何交易记录。无可解析交易记录".to_string()
        } else {
            format!("未产出任何交易记录。{details}")
        });
    }

    let mut classified = classify_transactions(
        parsed_records,
        &merchant_map,
        &category_rules,
        review_threshold,
    );
    apply_analysis_exclusions(&mut classified, &exclusion_rules);

    let consume_rows = classified
        .iter()
        .filter(|r| r.txn.statement_category == "消费" && r.excluded_in_analysis == 0)
        .count();
    let review_count = classified
        .iter()
        .filter(|r| {
            r.txn.statement_category == "消费" && r.excluded_in_analysis == 0 && r.needs_review == 1
        })
        .count();
    let excluded_count = classified
        .iter()
        .filter(|r| r.txn.statement_category == "消费" && r.excluded_in_analysis == 1)
        .count();

    let preview_rows = classified
        .iter()
        .take(10)
        .map(|r| {
            json!({
                "post_date": r.txn.post_date,
                "trans_date": r.txn.trans_date,
                "description": r.txn.description,
                "merchant_normalized": r.merchant_normalized,
                "amount_cents": r.txn.amount_cents,
                "statement_category": r.txn.statement_category,
                "expense_category": r.expense_category,
                "classify_source": r.classify_source,
                "confidence": r.confidence,
                "needs_review": r.needs_review,
                "excluded_in_analysis": r.excluded_in_analysis,
                "exclude_reason": r.exclude_reason,
            })
        })
        .collect::<Vec<_>>();

    let summary = PreviewSummary {
        input_files_count: files.len(),
        records_count: classified.len(),
        consume_count: consume_rows,
        needs_review_count: review_count,
        excluded_count,
        failed_files_count: failed_files_total,
        failed_files,
        preview_rows,
    };
    Ok((classified, summary))
}

pub(super) fn preview_summary_to_json(summary: &PreviewSummary) -> Value {
    json!({
        "input_files_count": summary.input_files_count,
        "records_count": summary.records_count,
        "consume_count": summary.consume_count,
        "needs_review_count": summary.needs_review_count,
        "excluded_count": summary.excluded_count,
        "failed_files_count": summary.failed_files_count,
        "failed_files": summary.failed_files,
        "preview_rows": summary.preview_rows,
    })
}

pub(super) fn safe_confidence(v: f64) -> f64 {
    v.clamp(0.0, 1.0)
}

pub(super) fn resolve_month_key(txn: &ParsedEmlTransaction) -> String {
    if txn.post_date.len() >= 7 {
        return txn.post_date[..7].to_string();
    }
    if txn.trans_date.len() >= 7 {
        return txn.trans_date[..7].to_string();
    }
    format!("{:04}-{:02}", txn.statement_year, txn.statement_month)
}

pub(super) fn account_id_from_last4(last4: &str) -> String {
    let clean = last4.trim();
    format!(
        "acct_cmb_credit_{}",
        if clean.is_empty() { "unknown" } else { clean }
    )
}

pub(super) fn account_name_from_last4(last4: &str) -> String {
    let clean = last4.trim();
    if clean.is_empty() {
        "招行信用卡".to_string()
    } else {
        format!("招行信用卡尾号{clean}")
    }
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

pub(super) fn direction_from_statement_category(statement_category: &str) -> &'static str {
    match statement_category.trim() {
        "消费" => "expense",
        "还款" => "transfer",
        _ => "other",
    }
}

pub(super) fn transaction_identity_base(rec: &ClassifiedTransaction) -> String {
    let txn = &rec.txn;
    [
        txn.source_file.as_str(),
        txn.source_path.as_str(),
        &txn.source_row_index.to_string(),
        &txn.statement_year.to_string(),
        &txn.statement_month.to_string(),
        txn.statement_category.as_str(),
        txn.post_date.as_str(),
        txn.trans_date.as_str(),
        txn.description.as_str(),
        &format_amount_cents(txn.amount_cents),
        txn.card_last4.as_str(),
        txn.original_amount.as_str(),
        txn.country_area.as_str(),
    ]
    .join("|")
}

pub(super) fn transaction_id(rec: &ClassifiedTransaction, source_type: &str) -> String {
    let source = format!("{source_type}|{}", transaction_identity_base(rec));
    let mut hasher = Sha1::new();
    hasher.update(source.as_bytes());
    format!("{:x}", hasher.finalize())
}

pub(super) fn format_amount_cents(cents: i64) -> String {
    let sign = if cents < 0 { "-" } else { "" };
    let abs = cents.abs();
    format!("{sign}{}.{:02}", abs / 100, abs % 100)
}
