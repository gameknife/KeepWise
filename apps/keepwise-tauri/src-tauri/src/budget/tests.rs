use super::*;
use rusqlite::Connection;
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..")
}

fn create_temp_test_db() -> PathBuf {
    let unique = format!(
        "keepwise_budget_fire_test_{}_{}.db",
        std::process::id(),
        Uuid::new_v4()
    );
    std::env::temp_dir().join(unique)
}

fn apply_all_migrations_for_test(db_path: &Path) {
    let conn = Connection::open(db_path).expect("open temp db");
    let mut entries = fs::read_dir(repo_root().join("db/migrations"))
        .expect("read migrations dir")
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.extension()
                .and_then(|s| s.to_str())
                .map(|s| s.eq_ignore_ascii_case("sql"))
                .unwrap_or(false)
        })
        .collect::<Vec<_>>();
    entries.sort();
    for path in entries {
        let sql = fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("read migration {:?} failed: {e}", path));
        conn.execute_batch(&sql)
            .unwrap_or_else(|e| panic!("apply migration {:?} failed: {e}", path));
    }
}

fn seed_budget_fire_fixture(db_path: &Path) {
    let conn = Connection::open(db_path).expect("open seeded db");

    conn.execute_batch(
            r#"
            INSERT INTO accounts(id, name, account_type) VALUES
              ('acct_cc_1', '招行信用卡', 'credit_card'),
              ('acct_bank_1', '招行储蓄卡', 'bank'),
              ('acct_inv_1', '投资账户A', 'investment'),
              ('acct_cash_1', '现金账户A', 'cash');

            INSERT INTO categories(id, name, level) VALUES
              ('cat_living', '日常消费', 2),
              ('cat_transport', '交通', 2),
              ('cat_learning', '教育学习', 2);

            UPDATE monthly_budget_items SET monthly_amount_cents = 50000 WHERE id = 'budget_item_mortgage';
            UPDATE monthly_budget_items SET monthly_amount_cents = 30000 WHERE id = 'budget_item_living';
            UPDATE monthly_budget_items SET monthly_amount_cents = 20000 WHERE id = 'budget_item_bills';

            INSERT INTO import_jobs(id, source_type, source_file, status, started_at, finished_at, total_count, imported_count, error_count, error_message)
            VALUES ('job_failed_eml', 'cmb_eml', '/tmp/fail.eml', 'failed', '2026-03-01 10:00:00', '2026-03-01 10:01:00', 1, 0, 1, 'parse failed');

            INSERT INTO transactions(
              id, external_ref, occurred_at, posted_at, month_key, amount_cents, direction, description,
              merchant, merchant_normalized, statement_category, category_id, account_id, source_type, source_file,
              import_job_id, confidence, needs_review, excluded_in_analysis
            ) VALUES
              -- budget + consumption counted
              ('tx_exp_1', 'tx_exp_1', '2026-01-10', '2026-01-10', '2026-01', -20000, 'expense', '超市购物',
               '某超市', '某超市', '消费', 'cat_living', 'acct_cc_1', 'cmb_eml', '/tmp/eml_01.eml',
               NULL, 0.98, 0, 0),
              ('tx_exp_2', 'tx_exp_2', '2026-02-15', '2026-02-15', '2026-02', -30000, 'expense', '地铁公交',
               '地铁', '地铁', '消费', 'cat_transport', 'acct_cc_1', 'cmb_eml', '/tmp/eml_02.eml',
               NULL, 0.95, 0, 0),
              -- counted in consumption but not budget (needs_review)
              ('tx_exp_3', 'tx_exp_3', '2026-02-20', '2026-02-20', '2026-02', -10000, 'expense', '待确认消费',
               '未知商户', '未知商户', '消费', NULL, 'acct_cc_1', 'cmb_eml', '/tmp/eml_02.eml',
               NULL, 0.40, 1, 0),
              -- excluded from consumption统计与预算统计，但仍计入raw
              ('tx_exp_4', 'tx_exp_4', '2026-03-05', '2026-03-05', '2026-03', -5000, 'expense', '一次性支出',
               '大额支出', '大额支出', '消费', 'cat_living', 'acct_cc_1', 'cmb_bank_pdf', '/tmp/cmb_03.pdf',
               NULL, 0.90, 0, 1),
              -- income rows for salary overview
              ('tx_inc_1', 'tx_inc_1', '2026-01-08', '2026-01-08', '2026-01', 1000000, 'income', '工资',
               '某公司', '某公司', '代发工资', NULL, 'acct_bank_1', 'cmb_bank_pdf', '/tmp/cmb_bank_01.pdf',
               NULL, 1.0, 0, 0),
              ('tx_inc_2', 'tx_inc_2', '2026-01-09', '2026-01-09', '2026-01', 200000, 'income', '公积金',
               '公积金中心', '公积金中心', '代发住房公积金', NULL, 'acct_bank_1', 'cmb_bank_pdf', '/tmp/cmb_bank_01.pdf',
               NULL, 1.0, 0, 0),
              ('tx_inc_3', 'tx_inc_3', '2026-02-08', '2026-02-08', '2026-02', 1100000, 'income', '工资',
               '某公司', '某公司', '代发工资', NULL, 'acct_bank_1', 'cmb_bank_pdf', '/tmp/cmb_bank_02.pdf',
               NULL, 1.0, 0, 0);

            INSERT INTO investment_records(id, account_id, snapshot_date, total_assets_cents, transfer_amount_cents, source_type)
            VALUES
              ('inv_1_20260331', 'acct_inv_1', '2026-03-31', 5000000, 0, 'manual');

            INSERT INTO account_valuations(id, account_id, account_name, asset_class, snapshot_date, value_cents, source_type)
            VALUES
              ('asset_cash_1_20260331', 'acct_cash_1', '现金账户A', 'cash', '2026-03-31', 2000000, 'manual');
            "#,
        )
        .expect("seed fixture sql");
}

fn v_i64(v: &Value, path: &[&str]) -> i64 {
    let mut cur = v;
    for key in path {
        cur = cur
            .get(*key)
            .unwrap_or_else(|| panic!("missing key: {}", key));
    }
    cur.as_i64()
        .unwrap_or_else(|| panic!("expected i64 at path {:?}", path))
}

fn v_f64(v: &Value, path: &[&str]) -> f64 {
    let mut cur = v;
    for key in path {
        cur = cur
            .get(*key)
            .unwrap_or_else(|| panic!("missing key: {}", key));
    }
    cur.as_f64()
        .unwrap_or_else(|| panic!("expected f64 at path {:?}", path))
}

fn v_str<'a>(v: &'a Value, path: &[&str]) -> &'a str {
    let mut cur = v;
    for key in path {
        cur = cur
            .get(*key)
            .unwrap_or_else(|| panic!("missing key: {}", key));
    }
    cur.as_str()
        .unwrap_or_else(|| panic!("expected str at path {:?}", path))
}

fn approx_eq(a: f64, b: f64, eps: f64) {
    assert!(
        (a - b).abs() <= eps,
        "approx not equal: left={a} right={b} eps={eps}"
    );
}

#[test]
fn budget_income_and_consumption_queries_match_seeded_fixture() {
    let db_path = create_temp_test_db();
    apply_all_migrations_for_test(&db_path);
    seed_budget_fire_fixture(&db_path);

    let budget_items =
        query_monthly_budget_items_at_db_path(&db_path, MonthlyBudgetItemsQueryRequest::default())
            .expect("query budget items");
    assert_eq!(v_i64(&budget_items, &["summary", "active_count"]), 3);
    assert_eq!(
        v_i64(&budget_items, &["summary", "monthly_budget_total_cents"]),
        100000
    );

    let budget_overview = query_budget_overview_at_db_path(
        &db_path,
        BudgetYearQueryRequest {
            year: Some("2026".to_string()),
        },
    )
    .expect("query budget overview");
    assert_eq!(
        v_i64(&budget_overview, &["budget", "annual_total_cents"]),
        1_200_000
    );
    assert_eq!(
        v_i64(&budget_overview, &["actual", "spent_total_cents"]),
        50_000
    );
    assert_eq!(
        v_i64(&budget_overview, &["metrics", "annual_remaining_cents"]),
        1_150_000
    );
    approx_eq(
        v_f64(&budget_overview, &["metrics", "usage_rate"]),
        50_000_f64 / 1_200_000_f64,
        1e-8,
    );

    let budget_review = query_budget_monthly_review_at_db_path(
        &db_path,
        BudgetYearQueryRequest {
            year: Some("2026".to_string()),
        },
    )
    .expect("query budget monthly review");
    let review_rows = budget_review
        .get("rows")
        .and_then(Value::as_array)
        .expect("rows array");
    assert_eq!(review_rows.len(), 12);
    assert_eq!(
        v_i64(&budget_review, &["summary", "annual_spent_cents"]),
        50_000
    );
    let jan = review_rows
        .iter()
        .find(|row| row.get("month_key").and_then(Value::as_str) == Some("2026-01"))
        .expect("jan row");
    let feb = review_rows
        .iter()
        .find(|row| row.get("month_key").and_then(Value::as_str) == Some("2026-02"))
        .expect("feb row");
    assert_eq!(jan.get("spent_cents").and_then(Value::as_i64), Some(20_000));
    assert_eq!(jan.get("tx_count").and_then(Value::as_i64), Some(1));
    assert_eq!(feb.get("spent_cents").and_then(Value::as_i64), Some(30_000));
    assert_eq!(feb.get("tx_count").and_then(Value::as_i64), Some(1));

    let salary = query_salary_income_overview_at_db_path(
        &db_path,
        BudgetYearQueryRequest {
            year: Some("2026".to_string()),
        },
    )
    .expect("query salary overview");
    assert_eq!(
        v_i64(&salary, &["summary", "salary_total_cents"]),
        2_100_000
    );
    assert_eq!(
        v_i64(&salary, &["summary", "housing_fund_total_cents"]),
        200_000
    );
    assert_eq!(
        v_i64(&salary, &["summary", "total_income_cents"]),
        2_300_000
    );
    assert_eq!(v_i64(&salary, &["summary", "months_with_salary"]), 2);
    assert_eq!(v_i64(&salary, &["summary", "months_with_housing_fund"]), 1);
    assert_eq!(v_i64(&salary, &["summary", "employer_count"]), 1);

    let consumption =
        query_consumption_report_at_db_path(&db_path, ConsumptionReportQueryRequest::default())
            .expect("query consumption report");
    assert_eq!(v_i64(&consumption, &["consumption_count"]), 3);
    assert_eq!(v_i64(&consumption, &["excluded_consumption_count"]), 1);
    assert_eq!(v_i64(&consumption, &["raw_consumption_count"]), 4);
    assert_eq!(v_i64(&consumption, &["needs_review_count"]), 1);
    assert_eq!(v_i64(&consumption, &["failed_files_count"]), 1);
    approx_eq(
        v_f64(&consumption, &["consumption_total_value"]),
        600.0,
        1e-6,
    );
    let categories = consumption
        .get("categories")
        .and_then(Value::as_array)
        .expect("categories array");
    assert!(
        !categories.is_empty(),
        "expected categories in consumption payload"
    );
    assert_eq!(
        categories[0].get("category").and_then(Value::as_str),
        Some("交通")
    );
    assert_eq!(
        categories[0].get("amount").and_then(Value::as_f64),
        Some(300.0)
    );
    let all_expense_categories = consumption
        .get("all_expense_categories")
        .and_then(Value::as_array)
        .expect("all_expense_categories array");
    assert!(
        all_expense_categories
            .iter()
            .any(|row| row.as_str() == Some("教育学习")),
        "expected 教育学习 in all_expense_categories"
    );

    let _ = fs::remove_file(&db_path);
}

#[test]
fn salary_income_overview_dedupes_income_rows_from_overlapping_statement_files() {
    let db_path = create_temp_test_db();
    apply_all_migrations_for_test(&db_path);
    seed_budget_fire_fixture(&db_path);

    let conn = Connection::open(&db_path).expect("open temp db");
    conn.execute(
            r#"
            INSERT INTO transactions(
              id, external_ref, occurred_at, posted_at, month_key, amount_cents, direction, description,
              merchant, merchant_normalized, statement_category, category_id, account_id, source_type, source_file,
              import_job_id, confidence, needs_review, excluded_in_analysis
            ) VALUES (
              'tx_inc_dup_1', 'tx_inc_dup_1', '2026-01-08', '2026-01-08', '2026-01', 1000000, 'income', '工资',
              '某公司', '某公司', '代发工资', NULL, 'acct_bank_1', 'cmb_bank_pdf', '/tmp/cmb_bank_overlap_01.pdf',
              NULL, 1.0, 0, 0
            )
            "#,
            [],
        )
        .expect("insert duplicate income row");

    conn.execute(
        r#"
            UPDATE transactions
            SET source_file = '/tmp/cmb_bank_overlap_02.pdf'
            WHERE id = 'tx_inc_1'
            "#,
        [],
    )
    .expect("mutate original source file to overlapping statement");

    let salary = query_salary_income_overview_at_db_path(
        &db_path,
        BudgetYearQueryRequest {
            year: Some("2026".to_string()),
        },
    )
    .expect("query salary overview");

    assert_eq!(
        v_i64(&salary, &["summary", "salary_total_cents"]),
        2_100_000
    );
    assert_eq!(v_i64(&salary, &["summary", "salary_tx_count"]), 2);
    assert_eq!(
        v_i64(&salary, &["summary", "housing_fund_total_cents"]),
        200_000
    );
    assert_eq!(
        v_i64(&salary, &["summary", "total_income_cents"]),
        2_300_000
    );

    let rows = salary
        .get("rows")
        .and_then(Value::as_array)
        .expect("rows array");
    let jan = rows
        .iter()
        .find(|row| row.get("month_key").and_then(Value::as_str) == Some("2026-01"))
        .expect("jan row");
    assert_eq!(
        jan.get("salary_cents").and_then(Value::as_i64),
        Some(1_000_000)
    );
    assert_eq!(jan.get("salary_tx_count").and_then(Value::as_i64), Some(1));

    let _ = fs::remove_file(&db_path);
}

#[test]
fn consumption_report_applies_merchant_category_overrides() {
    let db_path = create_temp_test_db();
    apply_all_migrations_for_test(&db_path);
    seed_budget_fire_fixture(&db_path);

    let mut overrides = std::collections::HashMap::<String, String>::new();
    overrides.insert("地铁".to_string(), "日常消费".to_string());
    overrides.insert("不存在商户".to_string(), "全新分类".to_string());

    let consumption = query_consumption_report_with_category_overrides_at_db_path(
        &db_path,
        ConsumptionReportQueryRequest::default(),
        Some(&overrides),
    )
    .expect("query consumption report with overrides");

    let categories = consumption
        .get("categories")
        .and_then(Value::as_array)
        .expect("categories array");
    let living = categories
        .iter()
        .find(|row| row.get("category").and_then(Value::as_str) == Some("日常消费"))
        .expect("日常消费 category row");
    assert_eq!(living.get("amount").and_then(Value::as_f64), Some(500.0));

    let txs = consumption
        .get("transactions")
        .and_then(Value::as_array)
        .expect("transactions array");
    let metro_tx = txs
        .iter()
        .find(|row| row.get("merchant").and_then(Value::as_str) == Some("地铁"))
        .expect("地铁 transaction");
    assert_eq!(
        metro_tx.get("category").and_then(Value::as_str),
        Some("日常消费")
    );
    let all_expense_categories = consumption
        .get("all_expense_categories")
        .and_then(Value::as_array)
        .expect("all_expense_categories array");
    assert!(
        all_expense_categories
            .iter()
            .any(|row| row.as_str() == Some("全新分类")),
        "expected 全新分类 in all_expense_categories"
    );

    let _ = fs::remove_file(&db_path);
}

#[test]
fn fire_progress_uses_budget_and_wealth_totals_from_seeded_fixture() {
    let db_path = create_temp_test_db();
    apply_all_migrations_for_test(&db_path);
    seed_budget_fire_fixture(&db_path);

    let payload = query_fire_progress_at_db_path(
        &db_path,
        FireProgressQueryRequest {
            year: Some("2026".to_string()),
            withdrawal_rate: Some("0.04".to_string()),
        },
    )
    .expect("query fire progress");

    assert_eq!(
        v_i64(&payload, &["budget", "annual_total_cents"]),
        1_200_000
    );
    assert_eq!(
        v_i64(&payload, &["investable_assets", "investment_cents"]),
        5_000_000
    );
    assert_eq!(
        v_i64(&payload, &["investable_assets", "cash_cents"]),
        2_000_000
    );
    assert_eq!(
        v_i64(&payload, &["investable_assets", "total_cents"]),
        7_000_000
    );
    assert_eq!(
        v_i64(&payload, &["metrics", "required_assets_cents"]),
        30_000_000
    );
    assert_eq!(
        v_i64(&payload, &["metrics", "remaining_to_goal_cents"]),
        23_000_000
    );
    approx_eq(
        v_f64(&payload, &["metrics", "coverage_years"]),
        7_000_000_f64 / 1_200_000_f64,
        1e-8,
    );
    approx_eq(
        v_f64(&payload, &["metrics", "freedom_ratio"]),
        (7_000_000_f64 * 0.04) / 1_200_000_f64,
        1e-8,
    );
    assert_eq!(v_str(&payload, &["withdrawal_rate_pct_text"]), "4.00%");

    let _ = fs::remove_file(&db_path);
}
