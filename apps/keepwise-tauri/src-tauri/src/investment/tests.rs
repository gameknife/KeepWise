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
        "keepwise_investment_analytics_test_{}_{}.db",
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

fn seed_investment_fixture(db_path: &Path) {
    let conn = Connection::open(db_path).expect("open db");
    conn.execute_batch(
            r#"
            INSERT INTO accounts(id, name, account_type) VALUES
              ('acct_inv_alpha', 'Alpha策略', 'investment'),
              ('acct_inv_beta', 'Beta策略', 'investment');

            INSERT INTO investment_records(id, account_id, snapshot_date, total_assets_cents, transfer_amount_cents, source_type) VALUES
              ('alpha_1', 'acct_inv_alpha', '2026-01-01', 1000000, 0, 'manual'),
              ('alpha_2', 'acct_inv_alpha', '2026-03-01', 1100000, 0, 'manual'),
              ('beta_1', 'acct_inv_beta', '2026-01-01', 2000000, 0, 'manual'),
              ('beta_2', 'acct_inv_beta', '2026-03-01', 2020000, 0, 'manual');
            "#,
        )
        .expect("seed investment fixture");
}

fn seed_daily_curve_fixture(db_path: &Path) {
    let conn = Connection::open(db_path).expect("open db");
    conn.execute_batch(
            r#"
            INSERT INTO accounts(id, name, account_type) VALUES
              ('acct_curve_alpha', '日频Alpha', 'investment'),
              ('acct_curve_beta', '日频Beta', 'investment');

            INSERT INTO investment_records(id, account_id, snapshot_date, total_assets_cents, transfer_amount_cents, source_type) VALUES
              ('curve_alpha_1', 'acct_curve_alpha', '2026-01-01', 1000000, 0, 'manual'),
              ('curve_alpha_2', 'acct_curve_alpha', '2026-01-03', 1200000, 0, 'manual'),
              ('curve_beta_1', 'acct_curve_beta', '2026-01-01', 2000000, 0, 'manual'),
              ('curve_beta_2', 'acct_curve_beta', '2026-01-03', 2600000, 0, 'manual');
            "#,
        )
        .expect("seed daily curve fixture");
}

fn approx_eq(a: f64, b: f64, eps: f64) {
    assert!(
        (a - b).abs() <= eps,
        "approx not equal: left={a} right={b} eps={eps}"
    );
}

#[test]
fn investment_returns_query_sorts_by_return_rate_and_supports_filter_limit() {
    let db_path = create_temp_test_db();
    apply_all_migrations_for_test(&db_path);
    seed_investment_fixture(&db_path);

    let payload = investment_returns_query_at_db_path(
        &db_path,
        InvestmentReturnsQueryRequest {
            preset: Some("custom".to_string()),
            from_date: Some("2026-01-01".to_string()),
            to_date: Some("2026-03-01".to_string()),
            keyword: None,
            limit: Some(10),
        },
    )
    .expect("query investment returns");

    assert_eq!(
        payload
            .get("summary")
            .and_then(|v| v.get("computed_count"))
            .and_then(Value::as_i64),
        Some(2)
    );
    assert_eq!(
        payload
            .get("summary")
            .and_then(|v| v.get("error_count"))
            .and_then(Value::as_i64),
        Some(0)
    );

    let rows = payload
        .get("rows")
        .and_then(Value::as_array)
        .expect("rows array");
    assert_eq!(rows.len(), 2);
    assert_eq!(
        rows[0].get("account_id").and_then(Value::as_str),
        Some("acct_inv_alpha"),
        "higher return account should be ranked first"
    );
    approx_eq(
        rows[0]
            .get("return_rate")
            .and_then(Value::as_f64)
            .expect("alpha return_rate"),
        0.10,
        1e-8,
    );
    approx_eq(
        rows[1]
            .get("return_rate")
            .and_then(Value::as_f64)
            .expect("beta return_rate"),
        0.01,
        1e-8,
    );

    let filtered = investment_returns_query_at_db_path(
        &db_path,
        InvestmentReturnsQueryRequest {
            preset: Some("custom".to_string()),
            from_date: Some("2026-01-01".to_string()),
            to_date: Some("2026-03-01".to_string()),
            keyword: Some("beta".to_string()),
            limit: Some(1),
        },
    )
    .expect("query filtered investment returns");
    let filtered_rows = filtered
        .get("rows")
        .and_then(Value::as_array)
        .expect("filtered rows");
    assert_eq!(filtered_rows.len(), 1);
    assert_eq!(
        filtered_rows[0].get("account_id").and_then(Value::as_str),
        Some("acct_inv_beta")
    );
    assert_eq!(
        filtered
            .get("range")
            .and_then(|v| v.get("input_limit"))
            .and_then(Value::as_i64),
        Some(1)
    );

    let _ = fs::remove_file(&db_path);
}

#[test]
fn single_account_curve_query_expands_to_calendar_days_with_interpolated_rows() {
    let db_path = create_temp_test_db();
    apply_all_migrations_for_test(&db_path);
    seed_daily_curve_fixture(&db_path);

    let payload = investment_curve_query_at_db_path(
        &db_path,
        InvestmentCurveQueryRequest {
            account_id: "acct_curve_alpha".to_string(),
            preset: Some("custom".to_string()),
            from_date: Some("2026-01-01".to_string()),
            to_date: Some("2026-01-03".to_string()),
            benchmark_source: None,
        },
    )
    .expect("query single account daily curve");

    let rows = payload
        .get("rows")
        .and_then(Value::as_array)
        .expect("rows array");
    assert_eq!(rows.len(), 3);
    assert_eq!(
        rows[1].get("snapshot_date").and_then(Value::as_str),
        Some("2026-01-02")
    );
    assert_eq!(
        rows[1].get("is_interpolated").and_then(Value::as_bool),
        Some(true)
    );
    assert_eq!(
        rows[1].get("total_assets_cents").and_then(Value::as_i64),
        Some(1100000)
    );
    approx_eq(
        rows[1]
            .get("cumulative_return_rate")
            .and_then(Value::as_f64)
            .expect("interpolated return"),
        0.10,
        1e-8,
    );

    let _ = fs::remove_file(&db_path);
}

#[test]
fn portfolio_curve_query_expands_to_calendar_days_with_interpolated_rows() {
    let db_path = create_temp_test_db();
    apply_all_migrations_for_test(&db_path);
    seed_daily_curve_fixture(&db_path);

    let payload = investment_curve_query_at_db_path(
        &db_path,
        InvestmentCurveQueryRequest {
            account_id: PORTFOLIO_ACCOUNT_ID.to_string(),
            preset: Some("custom".to_string()),
            from_date: Some("2026-01-01".to_string()),
            to_date: Some("2026-01-03".to_string()),
            benchmark_source: None,
        },
    )
    .expect("query portfolio daily curve");

    let rows = payload
        .get("rows")
        .and_then(Value::as_array)
        .expect("rows array");
    assert_eq!(rows.len(), 3);
    assert_eq!(
        rows[1].get("snapshot_date").and_then(Value::as_str),
        Some("2026-01-02")
    );
    assert_eq!(
        rows[1].get("is_interpolated").and_then(Value::as_bool),
        Some(true)
    );
    assert_eq!(
        rows[1].get("total_assets_cents").and_then(Value::as_i64),
        Some(3400000)
    );
    approx_eq(
        rows[2]
            .get("cumulative_return_rate")
            .and_then(Value::as_f64)
            .expect("portfolio end return"),
        0.26666667,
        1e-8,
    );

    let _ = fs::remove_file(&db_path);
}

#[test]
fn portfolio_curve_query_returns_transfer_details_by_account() {
    let db_path = create_temp_test_db();
    apply_all_migrations_for_test(&db_path);
    let conn = Connection::open(&db_path).expect("open db");
    conn.execute_batch(
            r#"
            INSERT INTO accounts(id, name, account_type) VALUES
              ('acct_curve_alpha', '日频Alpha', 'investment'),
              ('acct_curve_beta', '日频Beta', 'investment');

            INSERT INTO investment_records(id, account_id, snapshot_date, total_assets_cents, transfer_amount_cents, source_type) VALUES
              ('curve_alpha_1', 'acct_curve_alpha', '2026-01-01', 1000000, 0, 'manual'),
              ('curve_alpha_2', 'acct_curve_alpha', '2026-01-03', 1500000, 300000, 'manual'),
              ('curve_beta_1', 'acct_curve_beta', '2026-01-01', 2000000, 0, 'manual'),
              ('curve_beta_2', 'acct_curve_beta', '2026-01-03', 1800000, -300000, 'manual');
            "#,
        )
        .expect("seed transfer details fixture");

    let payload = investment_curve_query_at_db_path(
        &db_path,
        InvestmentCurveQueryRequest {
            account_id: PORTFOLIO_ACCOUNT_ID.to_string(),
            preset: Some("custom".to_string()),
            from_date: Some("2026-01-01".to_string()),
            to_date: Some("2026-01-03".to_string()),
            benchmark_source: None,
        },
    )
    .expect("query portfolio curve with transfer details");

    let rows = payload
        .get("rows")
        .and_then(Value::as_array)
        .expect("rows array");
    let transfer_row = rows
        .iter()
        .find(|row| row.get("snapshot_date").and_then(Value::as_str) == Some("2026-01-03"))
        .expect("transfer row");
    assert_eq!(
        transfer_row
            .get("transfer_amount_cents")
            .and_then(Value::as_i64),
        Some(0)
    );
    let transfer_details = transfer_row
        .get("transfer_details")
        .and_then(Value::as_array)
        .expect("transfer details array");
    assert_eq!(transfer_details.len(), 2);
    assert_eq!(
        transfer_details[0]
            .get("account_name")
            .and_then(Value::as_str),
        Some("日频Alpha")
    );
    assert_eq!(
        transfer_details[0]
            .get("transfer_amount_cents")
            .and_then(Value::as_i64),
        Some(300000)
    );
    assert_eq!(
        transfer_details[1]
            .get("account_name")
            .and_then(Value::as_str),
        Some("日频Beta")
    );
    assert_eq!(
        transfer_details[1]
            .get("transfer_amount_cents")
            .and_then(Value::as_i64),
        Some(-300000)
    );

    let _ = fs::remove_file(&db_path);
}

#[test]
fn portfolio_curve_query_ignores_start_date_transfers_in_return_calc() {
    let db_path = create_temp_test_db();
    apply_all_migrations_for_test(&db_path);
    let conn = Connection::open(&db_path).expect("open db");
    conn.execute_batch(
            r#"
            INSERT INTO accounts(id, name, account_type) VALUES
              ('acct_curve_alpha', '日频Alpha', 'investment');

            INSERT INTO investment_records(id, account_id, snapshot_date, total_assets_cents, transfer_amount_cents, source_type) VALUES
              ('curve_alpha_1', 'acct_curve_alpha', '2026-01-01', 1000000, 1000000, 'manual'),
              ('curve_alpha_2', 'acct_curve_alpha', '2026-01-03', 1100000, 0, 'manual');
            "#,
        )
        .expect("seed start-date flow fixture");

    let payload = investment_curve_query_at_db_path(
        &db_path,
        InvestmentCurveQueryRequest {
            account_id: PORTFOLIO_ACCOUNT_ID.to_string(),
            preset: Some("custom".to_string()),
            from_date: Some("2026-01-01".to_string()),
            to_date: Some("2026-01-03".to_string()),
            benchmark_source: None,
        },
    )
    .expect("query portfolio curve with start-date flow");

    let rows = payload
        .get("rows")
        .and_then(Value::as_array)
        .expect("rows array");
    let first_row = rows.first().and_then(Value::as_object).expect("first row");
    assert_eq!(
        first_row.get("snapshot_date").and_then(Value::as_str),
        Some("2026-01-01")
    );
    assert_eq!(
        first_row
            .get("transfer_amount_cents")
            .and_then(Value::as_i64),
        Some(1000000)
    );
    assert_eq!(
        first_row
            .get("cumulative_net_growth_cents")
            .and_then(Value::as_i64),
        Some(0)
    );
    approx_eq(
        first_row
            .get("cumulative_return_rate")
            .and_then(Value::as_f64)
            .expect("first row return"),
        0.0,
        1e-8,
    );

    let last_row = rows.last().and_then(Value::as_object).expect("last row");
    assert_eq!(
        last_row
            .get("cumulative_net_growth_cents")
            .and_then(Value::as_i64),
        Some(100000)
    );
    approx_eq(
        last_row
            .get("cumulative_return_rate")
            .and_then(Value::as_f64)
            .expect("last row return"),
        0.10,
        1e-8,
    );

    let _ = fs::remove_file(&db_path);
}

#[test]
fn parse_yahoo_chart_history_reads_adjusted_close_dates() {
    let market_ts = NaiveDate::from_ymd_opt(2026, 1, 2)
        .expect("date")
        .and_hms_opt(8, 0, 0)
        .expect("time")
        .and_utc()
        .timestamp();
    let payload = json!({
        "chart": {
            "result": [{
                "meta": {
                    "gmtoffset": 28800
                },
                "timestamp": [market_ts],
                "indicators": {
                    "adjclose": [{
                        "adjclose": [3210.55]
                    }]
                }
            }],
            "error": null
        }
    });

    let rows = parse_yahoo_chart_history(&payload).expect("parse yahoo history");
    assert_eq!(rows.len(), 1);
    assert_eq!(
        rows[0].market_date,
        NaiveDate::from_ymd_opt(2026, 1, 2).expect("expected date")
    );
    approx_eq(rows[0].close, 3210.55, 1e-8);
}

#[test]
fn parse_eastmoney_kline_history_reads_daily_close_dates() {
    let payload = json!({
        "rc": 0,
        "data": {
            "klines": [
                "2026-01-02,3178.00,3210.55,3220.00,3168.00,100,200,0.50",
                "2026-01-05,3215.00,3233.12,3240.00,3201.00,120,240,0.40"
            ]
        }
    });

    let rows = parse_eastmoney_kline_history(&payload).expect("parse eastmoney history");
    assert_eq!(rows.len(), 2);
    assert_eq!(
        rows[0].market_date,
        NaiveDate::from_ymd_opt(2026, 1, 2).expect("expected date")
    );
    approx_eq(rows[0].close, 3210.55, 1e-8);
    assert_eq!(
        rows[1].market_date,
        NaiveDate::from_ymd_opt(2026, 1, 5).expect("expected date")
    );
    approx_eq(rows[1].close, 3233.12, 1e-8);
}

#[test]
fn build_benchmark_curve_rows_aligns_to_latest_available_market_close() {
    let history = vec![
        BenchmarkHistoryRow {
            market_date: NaiveDate::from_ymd_opt(2026, 1, 2).expect("date"),
            close: 100.0,
        },
        BenchmarkHistoryRow {
            market_date: NaiveDate::from_ymd_opt(2026, 1, 5).expect("date"),
            close: 110.0,
        },
    ];
    let curve_dates = vec![
        NaiveDate::from_ymd_opt(2026, 1, 4).expect("date"),
        NaiveDate::from_ymd_opt(2026, 1, 6).expect("date"),
    ];

    let (baseline_date, baseline_close, rows) = build_benchmark_curve_rows(
        &curve_dates,
        &history,
        NaiveDate::from_ymd_opt(2026, 1, 4).expect("date"),
    )
    .expect("build benchmark rows");

    assert_eq!(baseline_date, "2026-01-02");
    approx_eq(baseline_close, 100.0, 1e-8);
    assert_eq!(rows.len(), 2);
    assert_eq!(
        rows[0].get("effective_market_date").and_then(Value::as_str),
        Some("2026-01-02")
    );
    approx_eq(
        rows[0]
            .get("cumulative_return_rate")
            .and_then(Value::as_f64)
            .expect("first rate"),
        0.0,
        1e-8,
    );
    assert_eq!(
        rows[1].get("effective_market_date").and_then(Value::as_str),
        Some("2026-01-05")
    );
    approx_eq(
        rows[1]
            .get("cumulative_return_rate")
            .and_then(Value::as_f64)
            .expect("second rate"),
        0.10,
        1e-8,
    );
}
