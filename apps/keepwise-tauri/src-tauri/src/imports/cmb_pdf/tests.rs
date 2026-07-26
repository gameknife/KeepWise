use super::*;
use rusqlite::params;
use std::fs;

fn repo_root_for_tests() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("src-tauri parent")
        .parent()
        .expect("keepwise-tauri parent")
        .parent()
        .expect("apps parent")
        .to_path_buf()
}

fn temp_db_path(name: &str) -> PathBuf {
    let mut p = std::env::temp_dir();
    p.push(format!(
        "keepwise_cmb_pdf_test_{}_{}.db",
        name,
        Uuid::new_v4()
    ));
    p
}

fn apply_all_migrations(conn: &Connection) {
    let migrations_dir = repo_root_for_tests().join("db/migrations");
    let mut entries = fs::read_dir(&migrations_dir)
        .expect("read migrations")
        .map(|e| e.expect("dir entry").path())
        .filter(|p| p.extension().and_then(|e| e.to_str()) == Some("sql"))
        .collect::<Vec<_>>();
    entries.sort();
    for path in entries {
        let sql = fs::read_to_string(&path).expect("read migration");
        conn.execute_batch(&sql)
            .unwrap_or_else(|e| panic!("migration failed {}: {e}", path.display()));
    }
}

fn seeded_conn() -> Connection {
    let db_path = temp_db_path("seeded");
    let conn = Connection::open(&db_path).expect("open temp db");
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .expect("enable fk");
    apply_all_migrations(&conn);
    ensure_schema_ready(&conn).expect("schema ready");
    conn
}

fn sample_header() -> PdfHeader {
    PdfHeader {
        account_last4: "1234".to_string(),
        range_start: "2026-01-01".to_string(),
        range_end: "2026-01-31".to_string(),
    }
}

fn sample_row() -> ClassifiedPdfRow {
    ClassifiedPdfRow {
        tx: BankPdfTransaction {
            page: 1,
            date: "2026-01-15".to_string(),
            currency: "CNY".to_string(),
            amount_text: "-123.45".to_string(),
            amount_cents: -12_345,
            balance_text: "1000.00".to_string(),
            raw_detail: "银联消费 星巴克".to_string(),
            summary: "银联消费".to_string(),
            counterparty: "星巴克".to_string(),
        },
        include_in_import: true,
        include_in_expense_analysis: true,
        rule_tag: "debit_consume".to_string(),
        expense_category: "餐饮".to_string(),
        direction: "expense".to_string(),
        confidence: 0.95,
        needs_review: 0,
        excluded_in_analysis: 0,
        exclude_reason: String::new(),
    }
}

fn sample_bank_tx(
    date: &str,
    summary: &str,
    counterparty: &str,
    amount_cents: i64,
    currency: &str,
) -> BankPdfTransaction {
    let sign = if amount_cents >= 0 { "" } else { "-" };
    let abs = amount_cents.abs();
    let amount_text = format!("{sign}{}.{:02}", abs / 100, abs % 100);
    BankPdfTransaction {
        page: 1,
        date: date.to_string(),
        currency: currency.to_string(),
        amount_text,
        amount_cents,
        balance_text: "0.00".to_string(),
        raw_detail: format!("{summary} {counterparty}"),
        summary: summary.to_string(),
        counterparty: counterparty.to_string(),
    }
}

#[test]
fn pdf_transaction_id_is_stable_for_same_occurrence() {
    let header = sample_header();
    let row = sample_row();
    let a = transaction_id(&row, &header, "cmb_bank_pdf", 1);
    let b = transaction_id(&row, &header, "cmb_bank_pdf", 1);
    let c = transaction_id(&row, &header, "cmb_bank_pdf", 2);
    assert_eq!(a, b);
    assert_ne!(a, c);
}

#[test]
fn pdf_upsert_transaction_is_idempotent_for_same_tx_id() {
    let conn = seeded_conn();
    let header = sample_header();
    let row = sample_row();
    let tx_id = transaction_id(&row, &header, "cmb_bank_pdf", 1);
    let category_id = category_id_from_name(&row.expense_category);
    let import_job_id = Uuid::new_v4().to_string();

    conn.execute(
            r#"
            INSERT INTO import_jobs(id, source_type, source_file, status, started_at, total_count, imported_count, error_count)
            VALUES (?1, 'cmb_bank_pdf', 'sample.pdf', 'success', datetime('now'), 1, 1, 0)
            "#,
            params![import_job_id],
        )
        .expect("seed import job");

    upsert_transaction(
        &conn,
        &row,
        &header,
        &tx_id,
        &category_id,
        "cmb_bank_pdf",
        &import_job_id,
    )
    .expect("first upsert");
    upsert_transaction(
        &conn,
        &row,
        &header,
        &tx_id,
        &category_id,
        "cmb_bank_pdf",
        &import_job_id,
    )
    .expect("second upsert");

    let tx_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM transactions", [], |r| r.get(0))
        .expect("tx count");
    assert_eq!(tx_count, 1);

    let (merchant, account_id, source_type, amount_cents): (String, String, String, i64) = conn
            .query_row(
                "SELECT merchant, account_id, source_type, amount_cents FROM transactions WHERE id = ?1",
                params![tx_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .expect("load tx");
    assert_eq!(merchant, "星巴克");
    assert_eq!(account_id, "acct_cmb_debit_1234");
    assert_eq!(source_type, "cmb_bank_pdf");
    assert_eq!(amount_cents, -12_345);
}

#[test]
fn pdf_transaction_id_is_stable_across_overlapping_statement_files() {
    let row = sample_row();
    let header_a = PdfHeader {
        account_last4: "1234".to_string(),
        range_start: "2026-02-20".to_string(),
        range_end: "2026-03-10".to_string(),
    };
    let header_b = PdfHeader {
        account_last4: "1234".to_string(),
        range_start: "2026-02-24".to_string(),
        range_end: "2026-03-24".to_string(),
    };

    let tx_id_a = transaction_id(&row, &header_a, "cmb_bank_pdf", 1);
    let tx_id_b = transaction_id(&row, &header_b, "cmb_bank_pdf", 1);

    assert_eq!(tx_id_a, tx_id_b);
}

#[test]
fn pdf_import_skips_exact_duplicate_rows_in_same_batch() {
    let conn = seeded_conn();
    let header = sample_header();
    let mut first = sample_row();
    first.tx.page = 1;
    let mut duplicate = first.clone();
    duplicate.tx.page = 2;
    let import_job_id = Uuid::new_v4().to_string();

    conn.execute(
            r#"
            INSERT INTO import_jobs(id, source_type, source_file, status, started_at, total_count, imported_count, error_count)
            VALUES (?1, 'cmb_bank_pdf', 'sample.pdf', 'success', datetime('now'), 2, 1, 0)
            "#,
            params![import_job_id],
        )
        .expect("seed import job");

    let rows = vec![&first, &duplicate];
    let outcome = import_classified_rows(&conn, &header, &rows, "cmb_bank_pdf", &import_job_id);

    assert_eq!(outcome.total_count, 2);
    assert_eq!(outcome.imported_count, 1);
    assert_eq!(outcome.duplicate_skipped_count, 1);
    assert_eq!(outcome.error_count, 0);

    let tx_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM transactions", [], |r| r.get(0))
        .expect("tx count");
    assert_eq!(tx_count, 1);
}

#[test]
fn pdf_import_upserts_same_transaction_from_overlapping_statement_files() {
    let conn = seeded_conn();
    let row = sample_row();
    let header_a = PdfHeader {
        account_last4: "1234".to_string(),
        range_start: "2026-02-20".to_string(),
        range_end: "2026-03-10".to_string(),
    };
    let header_b = PdfHeader {
        account_last4: "1234".to_string(),
        range_start: "2026-02-24".to_string(),
        range_end: "2026-03-24".to_string(),
    };
    let import_job_id = Uuid::new_v4().to_string();

    conn.execute(
            r#"
            INSERT INTO import_jobs(id, source_type, source_file, status, started_at, total_count, imported_count, error_count)
            VALUES (?1, 'cmb_bank_pdf', 'sample.pdf', 'success', datetime('now'), 2, 2, 0)
            "#,
            params![import_job_id],
        )
        .expect("seed import job");

    let tx_id_a = transaction_id(&row, &header_a, "cmb_bank_pdf", 1);
    let tx_id_b = transaction_id(&row, &header_b, "cmb_bank_pdf", 1);
    assert_eq!(tx_id_a, tx_id_b);

    let category_id = category_id_from_name(&row.expense_category);
    upsert_transaction(
        &conn,
        &row,
        &header_a,
        &tx_id_a,
        &category_id,
        "cmb_bank_pdf",
        &import_job_id,
    )
    .expect("first overlapping import");
    upsert_transaction(
        &conn,
        &row,
        &header_b,
        &tx_id_b,
        &category_id,
        "cmb_bank_pdf",
        &import_job_id,
    )
    .expect("second overlapping import");

    let tx_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM transactions", [], |r| r.get(0))
        .expect("tx count");
    assert_eq!(tx_count, 1);
}

#[test]
fn pdf_classification_preview_summary_counts_are_consistent() {
    let header = sample_header();
    let records = vec![
        sample_bank_tx("2026-01-05", "代发工资", "某公司", 30_000_00, "CNY"),
        sample_bank_tx("2026-01-06", "代发住房公积金", "某公司", 5_000_00, "CNY"),
        sample_bank_tx("2026-01-07", "银联消费", "星巴克", -35_00, "CNY"),
        sample_bank_tx(
            "2026-01-08",
            "转账汇款",
            "张三 6222021234567890",
            -200_00,
            "CNY",
        ),
        sample_bank_tx("2026-01-09", "基金申购", "基金公司", -1000_00, "CNY"),
        sample_bank_tx("2026-01-10", "银联消费", "Tokyo Shop", -50_00, "USD"),
    ];
    let mut whitelist = HashSet::new();
    whitelist.insert("张三".to_string());
    let merchant_map = HashMap::from([("星巴克".to_string(), ("餐饮".to_string(), 0.99_f64))]);
    let category_rules = Vec::<CategoryRule>::new();

    let (rows, preview) = classify_transactions(
        &header,
        &records,
        &[],
        &whitelist,
        &merchant_map,
        &category_rules,
        0.7,
    );
    assert_eq!(rows.len(), records.len());
    assert_eq!(preview["summary"]["total_records"].as_i64(), Some(6));
    assert_eq!(preview["summary"]["cny_records"].as_i64(), Some(5));
    assert_eq!(preview["summary"]["non_cny_records"].as_i64(), Some(1));
    assert_eq!(preview["summary"]["import_rows_count"].as_i64(), Some(4));
    assert_eq!(preview["summary"]["expense_rows_count"].as_i64(), Some(2));
    assert_eq!(preview["summary"]["income_rows_count"].as_i64(), Some(2));
    assert_eq!(preview["summary"]["skipped_rows_count"].as_i64(), Some(2));
    assert_eq!(
        preview["summary"]["expense_total_cents"].as_i64(),
        Some(-23500)
    );
    assert_eq!(
        preview["summary"]["income_total_cents"].as_i64(),
        Some(3500000)
    );

    assert_eq!(preview["rule_counts"]["salary"].as_i64(), Some(1));
    assert_eq!(
        preview["rule_counts"]["housing_fund_income"].as_i64(),
        Some(1)
    );
    assert_eq!(
        preview["rule_counts"]["debit_merchant_spend"].as_i64(),
        Some(1)
    );
    assert_eq!(
        preview["rule_counts"]["bank_transfer_whitelist"].as_i64(),
        Some(1)
    );
    assert_eq!(
        preview["rule_counts"]["skip_irrelevant_summary"].as_i64(),
        Some(1)
    );
    assert_eq!(preview["rule_counts"]["skip_non_cny"].as_i64(), Some(1));
}

#[test]
fn pdf_debit_consume_chinese_merchant_is_not_misclassified_as_person_transfer() {
    let header = sample_header();
    let records = vec![sample_bank_tx(
        "2026-01-07",
        "银联消费",
        "星巴克",
        -35_00,
        "CNY",
    )];
    let whitelist = HashSet::<String>::new();
    let merchant_map = HashMap::from([("星巴克".to_string(), ("餐饮".to_string(), 0.99_f64))]);
    let category_rules = Vec::<CategoryRule>::new();

    let (rows, preview) = classify_transactions(
        &header,
        &records,
        &[],
        &whitelist,
        &merchant_map,
        &category_rules,
        0.7,
    );

    assert_eq!(rows.len(), 1);
    assert_eq!(preview["summary"]["import_rows_count"].as_i64(), Some(1));
    assert_eq!(preview["summary"]["expense_rows_count"].as_i64(), Some(1));
    assert_eq!(
        preview["rule_counts"]["debit_merchant_spend"].as_i64(),
        Some(1)
    );
    assert_eq!(
        preview["rule_counts"]["skip_quickpay_person_non_whitelist"]
            .as_i64()
            .unwrap_or(0),
        0
    );
    assert_eq!(rows[0].direction, "expense");
    assert_eq!(rows[0].expense_category, "餐饮");
}

#[test]
fn pdf_mortgage_fixed_can_be_recognized_from_historical_samples() {
    let header = sample_header();
    let records = vec![sample_bank_tx(
        "2026-05-20",
        "个贷交易",
        "招商银行股份有限公司 6110394856200003",
        -922_853,
        "CNY",
    )];
    let historical_mortgage_records = vec![
        sample_bank_tx(
            "2026-04-20",
            "个贷交易",
            "招商银行股份有限公司 6110394856200003",
            -922_853,
            "CNY",
        ),
        sample_bank_tx(
            "2026-03-20",
            "个贷交易",
            "招商银行股份有限公司 6110394856200003",
            -924_159,
            "CNY",
        ),
    ];

    let (rows, preview) = classify_transactions(
        &header,
        &records,
        &historical_mortgage_records,
        &HashSet::new(),
        &HashMap::new(),
        &Vec::<CategoryRule>::new(),
        0.7,
    );

    assert_eq!(rows.len(), 1);
    assert!(rows[0].include_in_import);
    assert!(rows[0].include_in_expense_analysis);
    assert_eq!(rows[0].rule_tag, "mortgage_fixed");
    assert_eq!(rows[0].expense_category, "房贷固定还款");
    assert_eq!(preview["summary"]["import_rows_count"].as_i64(), Some(1));
    assert_eq!(preview["summary"]["expense_rows_count"].as_i64(), Some(1));
    assert_eq!(preview["rule_counts"]["mortgage_fixed"].as_i64(), Some(1));
    assert_eq!(
        preview["mortgage_profiles"]["6110394856200003"]["count"].as_u64(),
        Some(3)
    );
}
