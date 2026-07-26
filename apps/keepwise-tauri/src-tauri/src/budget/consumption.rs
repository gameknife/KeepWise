use super::*;

#[cfg_attr(not(test), allow(dead_code))]
pub fn query_consumption_report_at_db_path(
    db_path: &Path,
    req: ConsumptionReportQueryRequest,
) -> Result<Value, String> {
    query_consumption_report_with_category_overrides_at_db_path(db_path, req, None)
}

pub(super) fn query_consumption_report_with_category_overrides_at_db_path(
    db_path: &Path,
    req: ConsumptionReportQueryRequest,
    merchant_category_overrides: Option<&HashMap<String, String>>,
) -> Result<Value, String> {
    let conn = Connection::open(db_path).map_err(|e| format!("打开数据库失败: {e}"))?;

    // 先查询所有可用年份（不受 year 参数影响）
    let available_years = {
        let mut stmt = conn
            .prepare(
                r#"
                SELECT DISTINCT SUBSTR(COALESCE(month_key, SUBSTR(COALESCE(posted_at, occurred_at), 1, 7)), 1, 4) AS yr
                FROM transactions
                WHERE direction = 'expense' AND currency = 'CNY'
                  AND yr IS NOT NULL AND yr != ''
                ORDER BY yr DESC
                "#,
            )
            .map_err(|e| format!("查询可用年份失败: {e}"))?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| format!("查询可用年份失败: {e}"))?;
        let mut years = Vec::<String>::new();
        for row in rows {
            let y = row.map_err(|e| format!("读取可用年份失败: {e}"))?;
            if !y.is_empty() && y.len() == 4 {
                years.push(y);
            }
        }
        years
    };

    // 解析 year 参数：若指定则按年度筛选，否则返回全量
    let year_filter: Option<i32> = if let Some(ref y) = req.year {
        let trimmed = y.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(parse_year_param(
                Some(trimmed),
                Local::now().date_naive().year(),
            )?)
        }
    } else {
        None
    };

    let (sql, params_vec): (String, Vec<String>) = if let Some(year) = year_filter {
        let month_start = format!("{year:04}-01");
        let month_end = format!("{year:04}-12");
        (
            r#"
            SELECT
                t.id,
                t.month_key,
                t.posted_at,
                t.occurred_at,
                t.amount_cents,
                t.description,
                t.merchant_normalized,
                t.source_file,
                t.source_type,
                t.confidence,
                t.needs_review,
                t.excluded_in_analysis,
                COALESCE(c.name, '待分类') AS expense_category
            FROM transactions t
            LEFT JOIN categories c ON c.id = t.category_id
            WHERE t.direction = 'expense'
              AND t.currency = 'CNY'
              AND COALESCE(t.month_key, SUBSTR(COALESCE(t.posted_at, t.occurred_at), 1, 7)) >= ?1
              AND COALESCE(t.month_key, SUBSTR(COALESCE(t.posted_at, t.occurred_at), 1, 7)) <= ?2
            ORDER BY COALESCE(t.posted_at, t.occurred_at) DESC, t.id DESC
            "#
            .to_string(),
            vec![month_start, month_end],
        )
    } else {
        (
            r#"
            SELECT
                t.id,
                t.month_key,
                t.posted_at,
                t.occurred_at,
                t.amount_cents,
                t.description,
                t.merchant_normalized,
                t.source_file,
                t.source_type,
                t.confidence,
                t.needs_review,
                t.excluded_in_analysis,
                COALESCE(c.name, '待分类') AS expense_category
            FROM transactions t
            LEFT JOIN categories c ON c.id = t.category_id
            WHERE t.direction = 'expense'
              AND t.currency = 'CNY'
            ORDER BY COALESCE(t.posted_at, t.occurred_at) DESC, t.id DESC
            "#
            .to_string(),
            vec![],
        )
    };

    let mut tx_stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("查询消费总览交易失败: {e}"))?;

    type TxRow = (
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        i64,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<f64>,
        i64,
        i64,
        String,
    );
    let row_mapper = |row: &rusqlite::Row<'_>| -> rusqlite::Result<TxRow> {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, Option<String>>(1)?,
            row.get::<_, Option<String>>(2)?,
            row.get::<_, Option<String>>(3)?,
            row.get::<_, i64>(4)?,
            row.get::<_, Option<String>>(5)?,
            row.get::<_, Option<String>>(6)?,
            row.get::<_, Option<String>>(7)?,
            row.get::<_, Option<String>>(8)?,
            row.get::<_, Option<f64>>(9)?,
            row.get::<_, i64>(10)?,
            row.get::<_, i64>(11)?,
            row.get::<_, String>(12)?,
        ))
    };
    let tx_rows: Vec<TxRow> = if params_vec.len() == 2 {
        tx_stmt
            .query_map(params![params_vec[0], params_vec[1]], row_mapper)
            .map_err(|e| format!("查询消费总览交易失败: {e}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("读取消费总览交易失败: {e}"))?
    } else {
        tx_stmt
            .query_map([], row_mapper)
            .map_err(|e| format!("查询消费总览交易失败: {e}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("读取消费总览交易失败: {e}"))?
    };

    let import_jobs_exists = conn
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='import_jobs' LIMIT 1",
            [],
            |_row| Ok(true),
        )
        .unwrap_or(false);
    let failed_jobs_count = if import_jobs_exists {
        conn.query_row(
            r#"
            SELECT COUNT(*)
            FROM import_jobs
            WHERE source_type IN (?1, ?2)
              AND status = 'failed'
            "#,
            params![
                TRANSACTION_IMPORT_SOURCE_TYPES[0],
                TRANSACTION_IMPORT_SOURCE_TYPES[1]
            ],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|e| format!("查询失败导入任务数失败: {e}"))?
    } else {
        0
    };

    let mut all_consume_rows = Vec::<Value>::new();
    for row in tx_rows {
        let (
            id,
            month_key_opt,
            posted_at_opt,
            occurred_at_opt,
            amount_cents,
            description_opt,
            merchant_normalized_opt,
            source_file_opt,
            source_type_opt,
            confidence_opt,
            needs_review_i,
            excluded_in_analysis_i,
            expense_category,
        ) = row;

        let amount_cents_abs = amount_cents.abs();
        let tx_date = posted_at_opt
            .clone()
            .or(occurred_at_opt.clone())
            .unwrap_or_default();
        let mut month_key = month_key_opt.unwrap_or_default();
        if month_key.is_empty() && tx_date.len() >= 7 {
            month_key = tx_date[..7].to_string();
        }
        let source_file = source_file_opt.unwrap_or_default();
        let source_type = source_type_opt.unwrap_or_default();
        let description = description_opt.unwrap_or_default();
        let merchant_normalized = merchant_normalized_opt
            .unwrap_or_default()
            .trim()
            .to_string();
        let merchant = if merchant_normalized.is_empty() {
            description.trim().to_string()
        } else {
            merchant_normalized
        };
        let source_path = if !source_file.trim().is_empty() {
            source_file
        } else {
            format!("{source_type}:{id}")
        };
        let date = if !tx_date.is_empty() {
            tx_date
        } else if month_key.len() == 7 {
            format!("{month_key}-01")
        } else {
            String::new()
        };
        let confidence = round_to(confidence_opt.unwrap_or(0.0), 2);

        let resolved_category = resolve_display_expense_category(
            &expense_category,
            &merchant,
            merchant_category_overrides,
        );

        all_consume_rows.push(json!({
            "id": id,
            "month": month_key,
            "date": date,
            "merchant": merchant,
            "description": description,
            "category": resolved_category,
            "amount_cents_abs": amount_cents_abs,
            "amount": cents_to_yuan_value(amount_cents_abs),
            "needs_review": needs_review_i != 0,
            "confidence": confidence,
            "source_path": source_path,
            "excluded_in_analysis": excluded_in_analysis_i != 0,
        }));
    }

    let excluded_rows = all_consume_rows
        .iter()
        .filter(|r| r.get("excluded_in_analysis").and_then(Value::as_bool) == Some(true))
        .cloned()
        .collect::<Vec<_>>();
    let consume_rows = all_consume_rows
        .iter()
        .filter(|r| r.get("excluded_in_analysis").and_then(Value::as_bool) != Some(true))
        .cloned()
        .collect::<Vec<_>>();

    let consumption_total_cents = consume_rows
        .iter()
        .map(|r| {
            r.get("amount_cents_abs")
                .and_then(Value::as_i64)
                .unwrap_or(0)
        })
        .sum::<i64>();
    let excluded_total_cents = excluded_rows
        .iter()
        .map(|r| {
            r.get("amount_cents_abs")
                .and_then(Value::as_i64)
                .unwrap_or(0)
        })
        .sum::<i64>();
    let review_count = consume_rows
        .iter()
        .filter(|r| r.get("needs_review").and_then(Value::as_bool) == Some(true))
        .count() as i64;

    let mut by_expense = std::collections::HashMap::<String, (i64, i64, i64)>::new(); // amount, count, review_count
    let mut by_month = std::collections::HashMap::<String, (i64, i64, i64)>::new();
    let mut by_merchant = std::collections::HashMap::<String, (i64, i64, String)>::new(); // amount, count, category
    let mut transactions = Vec::<Value>::new();

    for rec in &consume_rows {
        let category = rec
            .get("category")
            .and_then(Value::as_str)
            .unwrap_or("待分类")
            .to_string();
        let month = rec
            .get("month")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let merchant = rec
            .get("merchant")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let amount_cents_abs = rec
            .get("amount_cents_abs")
            .and_then(Value::as_i64)
            .unwrap_or(0);
        let needs_review = rec
            .get("needs_review")
            .and_then(Value::as_bool)
            .unwrap_or(false);

        let exp_bucket = by_expense.entry(category.clone()).or_insert((0, 0, 0));
        exp_bucket.0 += amount_cents_abs;
        exp_bucket.1 += 1;
        exp_bucket.2 += if needs_review { 1 } else { 0 };

        let month_bucket = by_month.entry(month.clone()).or_insert((0, 0, 0));
        month_bucket.0 += amount_cents_abs;
        month_bucket.1 += 1;
        month_bucket.2 += if needs_review { 1 } else { 0 };

        let merchant_bucket =
            by_merchant
                .entry(merchant.clone())
                .or_insert((0, 0, category.clone()));
        merchant_bucket.0 += amount_cents_abs;
        merchant_bucket.1 += 1;

        transactions.push(json!({
            "id": rec.get("id").cloned().unwrap_or(Value::String(String::new())),
            "month": month,
            "date": rec.get("date").cloned().unwrap_or(Value::String(String::new())),
            "merchant": merchant,
            "description": rec.get("description").cloned().unwrap_or(Value::String(String::new())),
            "category": category,
            "amount": rec.get("amount").cloned().unwrap_or(Value::from(0.0)),
            "needs_review": needs_review,
            "confidence": rec.get("confidence").cloned().unwrap_or(Value::from(0.0)),
            "source_path": rec.get("source_path").cloned().unwrap_or(Value::String(String::new())),
        }));
    }

    let mut categories = by_expense
        .into_iter()
        .map(|(cat, (amount_cents, count, review_count))| {
            json!({
                "category": cat,
                "amount": cents_to_yuan_value(amount_cents),
                "count": count,
                "review_count": review_count,
            })
        })
        .collect::<Vec<_>>();
    categories.sort_by(|a, b| {
        let bv = b.get("amount").and_then(Value::as_f64).unwrap_or(0.0);
        let av = a.get("amount").and_then(Value::as_f64).unwrap_or(0.0);
        bv.partial_cmp(&av).unwrap_or(std::cmp::Ordering::Equal)
    });

    let mut months = by_month
        .into_iter()
        .filter(|(month, _)| !month.is_empty())
        .map(|(month, (amount_cents, count, review_count))| {
            json!({
                "month": month,
                "amount": cents_to_yuan_value(amount_cents),
                "count": count,
                "review_count": review_count,
            })
        })
        .collect::<Vec<_>>();
    months.sort_by(|a, b| {
        a.get("month")
            .and_then(Value::as_str)
            .unwrap_or("")
            .cmp(b.get("month").and_then(Value::as_str).unwrap_or(""))
    });

    let mut merchants = by_merchant
        .into_iter()
        .map(|(merchant, (amount_cents, count, category))| {
            json!({
                "merchant": merchant,
                "amount": cents_to_yuan_value(amount_cents),
                "count": count,
                "category": category,
            })
        })
        .collect::<Vec<_>>();
    merchants.sort_by(|a, b| {
        let bv = b.get("amount").and_then(Value::as_f64).unwrap_or(0.0);
        let av = a.get("amount").and_then(Value::as_f64).unwrap_or(0.0);
        bv.partial_cmp(&av).unwrap_or(std::cmp::Ordering::Equal)
    });
    merchants.truncate(80);

    transactions.sort_by(|a, b| {
        let ad = a.get("date").and_then(Value::as_str).unwrap_or("");
        let bd = b.get("date").and_then(Value::as_str).unwrap_or("");
        let date_cmp = bd.cmp(ad);
        if date_cmp != std::cmp::Ordering::Equal {
            return date_cmp;
        }
        let aa = a.get("amount").and_then(Value::as_f64).unwrap_or(0.0);
        let ba = b.get("amount").and_then(Value::as_f64).unwrap_or(0.0);
        ba.partial_cmp(&aa).unwrap_or(std::cmp::Ordering::Equal)
    });

    let top_expense_categories = categories
        .iter()
        .take(10)
        .map(|item| {
            let category = item
                .get("category")
                .and_then(Value::as_str)
                .unwrap_or("待分类");
            let amount = item.get("amount").and_then(Value::as_f64).unwrap_or(0.0);
            json!({
                "expense_category": category,
                "amount": format!("{amount:.2}"),
            })
        })
        .collect::<Vec<_>>();

    let source_files = all_consume_rows
        .iter()
        .filter_map(|r| r.get("source_path").and_then(Value::as_str))
        .filter(|s| !s.trim().is_empty())
        .collect::<std::collections::HashSet<_>>();
    let all_expense_categories =
        collect_all_expense_categories(&conn, merchant_category_overrides)?;

    let raw_total_cents = consumption_total_cents + excluded_total_cents;
    Ok(json!({
        "generated_at": Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
        "year": year_filter.map(|y| format!("{y:04}")),
        "available_years": available_years,
        "input_files_count": source_files.len(),
        "failed_files_count": failed_jobs_count,
        "consumption_count": consume_rows.len(),
        "consumption_total": cents_to_yuan_text(consumption_total_cents),
        "consumption_total_value": cents_to_yuan_value(consumption_total_cents),
        "needs_review_count": review_count,
        "needs_review_ratio": if consume_rows.is_empty() { 0.0 } else { round_to(review_count as f64 / consume_rows.len() as f64, 4) },
        "excluded_consumption_count": excluded_rows.len(),
        "excluded_consumption_total": cents_to_yuan_text(excluded_total_cents),
        "excluded_consumption_total_value": cents_to_yuan_value(excluded_total_cents),
        "raw_consumption_count": all_consume_rows.len(),
        "raw_consumption_total": cents_to_yuan_text(raw_total_cents),
        "raw_consumption_total_value": cents_to_yuan_value(raw_total_cents),
        "top_expense_categories": top_expense_categories,
        "categories": categories,
        "all_expense_categories": all_expense_categories,
        "months": months,
        "merchants": merchants,
        "transactions": transactions,
    }))
}
