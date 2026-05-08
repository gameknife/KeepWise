use appskeepwise_tauri_lib::{
    investment_curve_query_at_db_path, investment_return_query_at_db_path,
    investment_returns_query_at_db_path, wealth_curve_query_at_db_path,
    wealth_overview_query_at_db_path, InvestmentCurveQueryRequest, InvestmentReturnQueryRequest,
    InvestmentReturnsQueryRequest, WealthCurveQueryRequest, WealthOverviewQueryRequest,
};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha1::{Digest, Sha1};
use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;

const BASELINE_JSON: &str =
    include_str!("../../tests/baseline/core_analytics_diff_regression.baseline.json");

const MIGRATIONS: &[(&str, &str)] = &[
    (
        "0001_init.sql",
        include_str!("../../../../../db/migrations/0001_init.sql"),
    ),
    (
        "0002_m0_investment_import_support.sql",
        include_str!("../../../../../db/migrations/0002_m0_investment_import_support.sql"),
    ),
    (
        "0003_simplify_investment_records.sql",
        include_str!("../../../../../db/migrations/0003_simplify_investment_records.sql"),
    ),
    (
        "0004_add_account_valuations.sql",
        include_str!("../../../../../db/migrations/0004_add_account_valuations.sql"),
    ),
    (
        "0005_account_valuations_add_liability.sql",
        include_str!("../../../../../db/migrations/0005_account_valuations_add_liability.sql"),
    ),
    (
        "0006_add_monthly_budget_items.sql",
        include_str!("../../../../../db/migrations/0006_add_monthly_budget_items.sql"),
    ),
];

#[derive(Debug, Deserialize)]
struct BaselineFile {
    schema_version: u64,
    cases: Vec<BaselineCase>,
}

#[derive(Debug, Deserialize)]
struct BaselineCase {
    case_id: String,
    endpoint_profile: String,
    path: String,
    dataset_ref: String,
    query: Value,
    expected_outcome: String,
    rust: BaselineRustResult,
}

#[derive(Debug, Deserialize)]
struct BaselineRustResult {
    configured_status: Option<String>,
    status: String,
    payload: Option<Value>,
    error: Option<Value>,
}

#[derive(Debug, Serialize)]
struct DiffItem {
    kind: String,
    path: String,
    detail: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    baseline_value: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    current_value: Option<Value>,
}

#[derive(Debug, Serialize)]
struct CaseReport {
    case_id: String,
    endpoint_profile: String,
    path: String,
    dataset_ref: String,
    query: Value,
    expected_outcome: String,
    baseline: Value,
    current: Value,
    status: String,
    diff_errors: Vec<DiffItem>,
}

struct DatasetRuntime {
    db_path: PathBuf,
}

impl Drop for DatasetRuntime {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.db_path);
        let _ = fs::remove_file(self.db_path.with_extension("db-wal"));
        let _ = fs::remove_file(self.db_path.with_extension("db-shm"));
    }
}

fn main() {
    if let Err(err) = run() {
        eprintln!("{err}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let args = env::args().skip(1).collect::<Vec<_>>();
    let json_out = parse_path_flag(&args, "--json-out");
    let baseline_path = parse_path_flag(&args, "--baseline");
    let baseline_raw = match baseline_path {
        Some(path) => fs::read_to_string(&path)
            .map_err(|e| format!("读取 baseline 失败 ({}): {e}", path.to_string_lossy()))?,
        None => BASELINE_JSON.to_string(),
    };
    let baseline: BaselineFile =
        serde_json::from_str(&baseline_raw).map_err(|e| format!("解析 baseline JSON 失败: {e}"))?;
    if baseline.schema_version != 1 {
        return Err(format!(
            "不支持的 baseline schema_version: {}",
            baseline.schema_version
        ));
    }

    let mut datasets = BTreeMap::<String, DatasetRuntime>::new();
    let mut reports = Vec::<CaseReport>::new();
    for case in &baseline.cases {
        if !datasets.contains_key(&case.dataset_ref) {
            datasets.insert(case.dataset_ref.clone(), build_dataset(&case.dataset_ref)?);
        }
        let dataset = datasets
            .get(&case.dataset_ref)
            .ok_or_else(|| format!("数据集不存在: {}", case.dataset_ref))?;
        reports.push(run_case(case, dataset));
    }

    let cross_checks = run_cross_case_checks(&reports);
    let summary = summarize(&reports, &cross_checks);
    print_summary(&reports, &cross_checks, &summary);

    let report = json!({
        "manifest": "embedded:analytics_core",
        "baseline": "tests/baseline/core_analytics_diff_regression.baseline.json",
        "summary": summary,
        "results": reports,
        "cross_case_checks": cross_checks,
        "environment": {
            "cwd": env::current_dir().map(|p| p.to_string_lossy().to_string()).unwrap_or_default(),
        },
    });
    if let Some(path) = json_out {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| {
                format!("创建报告目录失败 ({}): {e}", parent.to_string_lossy())
            })?;
        }
        fs::write(
            &path,
            serde_json::to_string_pretty(&report).map_err(|e| format!("序列化报告失败: {e}"))?,
        )
        .map_err(|e| format!("写入报告失败 ({}): {e}", path.to_string_lossy()))?;
        println!("JSON report written: {}", path.to_string_lossy());
    }

    let failed_cases = reports.iter().filter(|r| r.status == "fail").count();
    let failed_cross = cross_checks
        .iter()
        .filter(|c| c.get("status").and_then(Value::as_str) == Some("fail"))
        .count();
    if failed_cases > 0 || failed_cross > 0 {
        return Err(format!(
            "Core baseline diff failed: cases={failed_cases}, cross_checks={failed_cross}"
        ));
    }
    Ok(())
}

fn parse_path_flag(args: &[String], flag: &str) -> Option<PathBuf> {
    args.windows(2)
        .find(|pair| pair[0] == flag)
        .map(|pair| PathBuf::from(&pair[1]))
}

fn run_case(case: &BaselineCase, dataset: &DatasetRuntime) -> CaseReport {
    let baseline = rust_result_to_value(&case.rust);
    let current = match dispatch(&case.path, &dataset.db_path, case.query.clone()) {
        Ok(payload) => json!({
            "configured_status": case.rust.configured_status.as_deref().unwrap_or("active"),
            "status": "success",
            "payload": payload,
        }),
        Err(message) => json!({
            "configured_status": case.rust.configured_status.as_deref().unwrap_or("active"),
            "status": "error",
            "error": {
                "category": classify_error_message(&message),
                "message": message,
                "type": "AdapterError",
            },
        }),
    };
    let diff_errors = diff_values("", &baseline, &current);
    CaseReport {
        case_id: case.case_id.clone(),
        endpoint_profile: case.endpoint_profile.clone(),
        path: case.path.clone(),
        dataset_ref: case.dataset_ref.clone(),
        query: case.query.clone(),
        expected_outcome: case.expected_outcome.clone(),
        baseline,
        current,
        status: if diff_errors.is_empty() {
            "pass".to_string()
        } else {
            "fail".to_string()
        },
        diff_errors,
    }
}

fn rust_result_to_value(result: &BaselineRustResult) -> Value {
    match result.status.as_str() {
        "success" => json!({
            "configured_status": result.configured_status.as_deref().unwrap_or("active"),
            "status": "success",
            "payload": result.payload.clone().unwrap_or(Value::Null),
        }),
        "error" => json!({
            "configured_status": result.configured_status.as_deref().unwrap_or("active"),
            "status": "error",
            "error": result.error.clone().unwrap_or(Value::Null),
        }),
        other => json!({
            "configured_status": result.configured_status.as_deref().unwrap_or("active"),
            "status": other,
        }),
    }
}

fn dispatch(path: &str, db_path: &Path, query: Value) -> Result<Value, String> {
    match path {
        "/api/analytics/investment-return" => {
            let req: InvestmentReturnQueryRequest = serde_json::from_value(query).map_err(|e| {
                let msg = e.to_string();
                if msg.contains("missing field `account_id`") {
                    "account_id 必填".to_string()
                } else {
                    format!("request.query invalid for investment-return: {msg}")
                }
            })?;
            investment_return_query_at_db_path(db_path, req)
        }
        "/api/analytics/investment-curve" => {
            let req: InvestmentCurveQueryRequest = serde_json::from_value(query).map_err(|e| {
                let msg = e.to_string();
                if msg.contains("missing field `account_id`") {
                    "account_id 必填".to_string()
                } else {
                    format!("request.query invalid for investment-curve: {msg}")
                }
            })?;
            investment_curve_query_at_db_path(db_path, req)
        }
        "/api/analytics/investment-returns" => {
            let req: InvestmentReturnsQueryRequest = serde_json::from_value(query)
                .map_err(|e| format!("request.query invalid for investment-returns: {e}"))?;
            investment_returns_query_at_db_path(db_path, req)
        }
        "/api/analytics/wealth-overview" => {
            let req: WealthOverviewQueryRequest = serde_json::from_value(query)
                .map_err(|e| format!("request.query invalid for wealth-overview: {e}"))?;
            wealth_overview_query_at_db_path(db_path, req)
        }
        "/api/analytics/wealth-curve" => {
            let req: WealthCurveQueryRequest = serde_json::from_value(query)
                .map_err(|e| format!("request.query invalid for wealth-curve: {e}"))?;
            wealth_curve_query_at_db_path(db_path, req)
        }
        _ => Err(format!("unsupported endpoint path: {path}")),
    }
}

fn classify_error_message(message: &str) -> String {
    let validation_keywords = [
        "必填",
        "布尔参数不合法",
        "日期格式必须",
        "缺少字段",
        "preset 不支持",
        "至少需要选择",
    ];
    if validation_keywords.iter().any(|k| message.contains(k)) {
        return "VALIDATION_ERROR".to_string();
    }
    let invalid_range_keywords = ["起始日期晚于结束日期", "结束日期早于最早可用记录"];
    if invalid_range_keywords.iter().any(|k| message.contains(k)) {
        return "INVALID_RANGE_ERROR".to_string();
    }
    let no_data_keywords = [
        "没有可用",
        "有效快照不足",
        "当前没有可用于",
        "无可用时间范围",
    ];
    if no_data_keywords.iter().any(|k| message.contains(k)) {
        return "NO_DATA_ERROR".to_string();
    }
    "UNKNOWN_ERROR".to_string()
}

fn diff_values(path: &str, baseline: &Value, current: &Value) -> Vec<DiffItem> {
    if baseline == current {
        return Vec::new();
    }
    match (baseline, current) {
        (Value::Object(a), Value::Object(b)) => {
            let mut items = Vec::new();
            for key in a.keys().chain(b.keys()) {
                if a.contains_key(key) && b.contains_key(key) {
                    let child_path = join_path(path, key);
                    items.extend(diff_values(&child_path, &a[key], &b[key]));
                } else {
                    items.push(DiffItem {
                        kind: "missing_key".to_string(),
                        path: join_path(path, key),
                        detail: "object key differs".to_string(),
                        baseline_value: a.get(key).cloned(),
                        current_value: b.get(key).cloned(),
                    });
                }
            }
            items
        }
        (Value::Array(a), Value::Array(b)) => {
            if a.len() != b.len() {
                return vec![DiffItem {
                    kind: "array_length_mismatch".to_string(),
                    path: path.to_string(),
                    detail: format!("array length differs: baseline={}, current={}", a.len(), b.len()),
                    baseline_value: Some(json!(a.len())),
                    current_value: Some(json!(b.len())),
                }];
            }
            let mut items = Vec::new();
            for (idx, (left, right)) in a.iter().zip(b.iter()).enumerate() {
                items.extend(diff_values(&format!("{path}[{idx}]"), left, right));
            }
            items
        }
        _ => vec![DiffItem {
            kind: "value_mismatch".to_string(),
            path: path.to_string(),
            detail: "value differs".to_string(),
            baseline_value: Some(baseline.clone()),
            current_value: Some(current.clone()),
        }],
    }
}

fn join_path(prefix: &str, key: &str) -> String {
    if prefix.is_empty() {
        key.to_string()
    } else {
        format!("{prefix}.{key}")
    }
}

fn run_cross_case_checks(reports: &[CaseReport]) -> Vec<Value> {
    vec![
        cross_case_approx(
            reports,
            "inv_curve_end_return_matches_single_custom",
            "inv_curve_single_custom",
            "baseline.payload.summary.end_cumulative_return_rate",
            "inv_return_single_custom",
            "baseline.payload.metrics.return_rate",
        ),
        cross_case_approx(
            reports,
            "inv_curve_end_return_matches_portfolio_ytd",
            "inv_curve_portfolio_ytd",
            "baseline.payload.summary.end_cumulative_return_rate",
            "inv_return_portfolio_ytd",
            "baseline.payload.metrics.return_rate",
        ),
    ]
}

fn cross_case_approx(
    reports: &[CaseReport],
    id: &str,
    left_case: &str,
    left_path: &str,
    right_case: &str,
    right_path: &str,
) -> Value {
    let Some(left) = reports.iter().find(|r| r.case_id == left_case) else {
        return json!({"id": id, "status": "skipped", "reason": "left case missing"});
    };
    let Some(right) = reports.iter().find(|r| r.case_id == right_case) else {
        return json!({"id": id, "status": "skipped", "reason": "right case missing"});
    };
    if left.status != "pass" || right.status != "pass" {
        return json!({
            "id": id,
            "status": "skipped",
            "reason": format!("dependent case not pass: [{}, {}]", left.status, right.status),
        });
    }
    let Some(left_value) = get_path_number(left, left_path) else {
        return json!({"id": id, "status": "fail", "detail": format!("left path missing: {left_path}")});
    };
    let Some(right_value) = get_path_number(right, right_path) else {
        return json!({"id": id, "status": "fail", "detail": format!("right path missing: {right_path}")});
    };
    let ok = (left_value - right_value).abs() <= 1.0e-8;
    json!({
        "id": id,
        "status": if ok { "pass" } else { "fail" },
        "detail": format!("{left_case}.{left_path} ~= {right_case}.{right_path} -> {left_value:?} vs {right_value:?}"),
    })
}

fn get_path_number(report: &CaseReport, path: &str) -> Option<f64> {
    let mut current = match path.split('.').next()? {
        "baseline" => &report.baseline,
        "current" => &report.current,
        _ => return None,
    };
    for part in path.split('.').skip(1) {
        current = current.get(part)?;
    }
    current.as_f64()
}

fn summarize(reports: &[CaseReport], cross_checks: &[Value]) -> Value {
    let mut case_counts = BTreeMap::<String, usize>::new();
    for report in reports {
        *case_counts.entry(report.status.clone()).or_default() += 1;
    }
    let mut cross_counts = BTreeMap::<String, usize>::new();
    for check in cross_checks {
        let status = check
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .to_string();
        *cross_counts.entry(status).or_default() += 1;
    }
    json!({
        "cases": {
            "total": reports.len(),
            "status_counts": case_counts,
        },
        "cross_case_checks": {
            "total": cross_checks.len(),
            "status_counts": cross_counts,
        },
    })
}

fn print_summary(reports: &[CaseReport], cross_checks: &[Value], summary: &Value) {
    println!("Manifest: embedded:analytics_core");
    println!("Selected cases: {}", reports.len());
    println!(
        "Case status counts: {}",
        summary["cases"]["status_counts"]
    );
    println!(
        "Cross-case check counts: {}",
        summary["cross_case_checks"]["status_counts"]
    );
    for report in reports {
        println!(
            "[{:4}] {}  ({}, {})",
            report.status.to_uppercase(),
            report.case_id,
            report.path,
            report.dataset_ref
        );
        for err in &report.diff_errors {
            println!("  - DIFF {}: {} @ {}", err.kind, err.detail, err.path);
        }
    }
    for check in cross_checks {
        if check.get("status").and_then(Value::as_str) != Some("pass") {
            println!(
                "[XCHK {}] {}: {}",
                check
                    .get("status")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown")
                    .to_uppercase(),
                check.get("id").and_then(Value::as_str).unwrap_or("unknown"),
                check
                    .get("detail")
                    .or_else(|| check.get("reason"))
                    .and_then(Value::as_str)
                    .unwrap_or("")
            );
        }
    }
}

fn build_dataset(dataset_ref: &str) -> Result<DatasetRuntime, String> {
    let db_path = env::temp_dir().join(format!(
        "kw_baseline_diff_{}_{}.db",
        dataset_ref,
        Uuid::new_v4()
    ));
    apply_migrations(&db_path)?;
    match dataset_ref {
        "m1_analytics_minimal" => seed_minimal_dataset(&db_path)?,
        "m1_analytics_edge_cases" => seed_edge_case_dataset(&db_path)?,
        other => {
            return Err(format!("未实现的数据集构建器: {other}"));
        }
    }
    Ok(DatasetRuntime { db_path })
}

fn apply_migrations(db_path: &Path) -> Result<(), String> {
    if let Some(parent) = db_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建临时数据库目录失败: {e}"))?;
    }
    let conn = Connection::open(db_path).map_err(|e| format!("打开临时数据库失败: {e}"))?;
    for (version, sql) in MIGRATIONS {
        conn.execute_batch(sql)
            .map_err(|e| format!("执行迁移失败 ({version}): {e}"))?;
    }
    Ok(())
}

fn seed_minimal_dataset(db_path: &Path) -> Result<(), String> {
    let conn = Connection::open(db_path).map_err(|e| format!("打开临时数据库失败: {e}"))?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|e| format!("启用外键失败: {e}"))?;

    insert_account(&conn, "acct_inv_regression", "回归测试投资账户", "investment")?;
    insert_account(&conn, "acct_cash_regression", "回归测试现金账户", "cash")?;
    insert_account(&conn, "acct_re_regression", "回归测试不动产账户", "other")?;
    insert_account(&conn, "acct_tx_regression", "回归测试信用卡", "credit_card")?;
    insert_account(&conn, "acct_bank_income_regression", "回归测试银行卡", "bank")?;

    insert_investment(&conn, "acct_inv_regression", "2025-01-15", 9_200_000, 0)?;
    insert_investment(&conn, "acct_inv_regression", "2026-01-01", 10_000_000, 0)?;
    insert_investment(&conn, "acct_inv_regression", "2026-01-10", 13_000_000, 2_000_000)?;
    insert_investment(&conn, "acct_inv_regression", "2026-01-20", 12_500_000, -1_000_000)?;
    insert_investment(&conn, "acct_inv_regression", "2026-01-31", 14_000_000, 0)?;

    insert_asset_valuation(
        &conn,
        "acct_cash_regression",
        "回归测试现金账户",
        "cash",
        "2026-01-15",
        5_000_000,
    )?;
    insert_asset_valuation(
        &conn,
        "acct_cash_regression",
        "回归测试现金账户",
        "cash",
        "2026-01-31",
        5_500_000,
    )?;
    insert_asset_valuation(
        &conn,
        "acct_re_regression",
        "回归测试不动产账户",
        "real_estate",
        "2026-01-05",
        80_000_000,
    )?;

    conn.execute(
        r#"
        INSERT INTO categories(id, name, level, budget_enabled, is_active)
        VALUES ('cat_reg_food', '餐饮', 1, 1, 1)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name, updated_at=datetime('now')
        "#,
        [],
    )
    .map_err(|e| format!("写入餐饮分类失败: {e}"))?;
    conn.execute(
        r#"
        INSERT INTO transactions(
            id, external_ref, occurred_at, posted_at, month_key, amount_cents, currency, direction,
            description, merchant, merchant_normalized, statement_category, category_id, account_id,
            source_type, source_file, import_job_id, confidence, needs_review, excluded_in_analysis, exclude_reason
        )
        VALUES (
            'tx_reg_1', 'cmb:tx_reg_1', '2026-01-10', '2026-01-10', '2026-01', 12345, 'CNY', 'expense',
            '回归测试餐饮消费', '测试商户', '测试商户', '消费', 'cat_reg_food', 'acct_tx_regression',
            'cmb_eml', 'sample.eml', NULL, 0.95, 0, 0, ''
        )
        ON CONFLICT(id) DO UPDATE SET category_id=excluded.category_id, updated_at=datetime('now')
        "#,
        [],
    )
    .map_err(|e| format!("写入消费交易失败: {e}"))?;

    let salary_cat = category_id_from_name("工资收入");
    let housing_fund_cat = category_id_from_name("公积金收入");
    insert_category(&conn, &salary_cat, "工资收入")?;
    insert_category(&conn, &housing_fund_cat, "公积金收入")?;
    insert_income_tx(
        &conn,
        "tx_income_salary_1",
        "cmb_bank_pdf:tx_income_salary_1",
        "2026-01-10",
        "2026-01",
        5_000_000,
        "代发工资 测试公司A 123456789012",
        "测试公司A",
        "代发工资",
        &salary_cat,
    )?;
    insert_income_tx(
        &conn,
        "tx_income_salary_2",
        "cmb_bank_pdf:tx_income_salary_2",
        "2026-02-10",
        "2026-02",
        5_100_000,
        "代发工资 测试公司A 123456789012",
        "测试公司A",
        "代发工资",
        &salary_cat,
    )?;
    insert_income_tx(
        &conn,
        "tx_income_hf_1",
        "cmb_bank_pdf:tx_income_hf_1",
        "2026-02-11",
        "2026-02",
        700_000,
        "代发住房公积金 公积金中心 123456789012",
        "公积金中心",
        "代发住房公积金",
        &housing_fund_cat,
    )?;

    Ok(())
}

fn seed_edge_case_dataset(db_path: &Path) -> Result<(), String> {
    let conn = Connection::open(db_path).map_err(|e| format!("打开临时数据库失败: {e}"))?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|e| format!("启用外键失败: {e}"))?;
    insert_account(&conn, "acct_sparse_inv", "稀疏投资账户", "investment")?;
    insert_investment(&conn, "acct_sparse_inv", "2026-01-10", 1_000_000, 0)?;
    Ok(())
}

fn insert_account(
    conn: &Connection,
    account_id: &str,
    name: &str,
    account_type: &str,
) -> Result<(), String> {
    conn.execute(
        r#"
        INSERT INTO accounts(id, name, account_type, currency, initial_balance_cents)
        VALUES (?1, ?2, ?3, 'CNY', 0)
        ON CONFLICT(id) DO UPDATE SET
            name=excluded.name,
            account_type=excluded.account_type,
            updated_at=datetime('now')
        "#,
        params![account_id, name, account_type],
    )
    .map_err(|e| format!("写入账户失败: {e}"))?;
    Ok(())
}

fn insert_investment(
    conn: &Connection,
    account_id: &str,
    snapshot_date: &str,
    total_assets_cents: i64,
    transfer_amount_cents: i64,
) -> Result<(), String> {
    let row_id = Uuid::new_v5(
        &Uuid::NAMESPACE_URL,
        format!("regression:inv:{account_id}:{snapshot_date}").as_bytes(),
    )
    .to_string();
    conn.execute(
        r#"
        INSERT INTO investment_records(
            id, account_id, snapshot_date, total_assets_cents, transfer_amount_cents, source_type
        )
        VALUES (?1, ?2, ?3, ?4, ?5, 'manual')
        ON CONFLICT(account_id, snapshot_date) DO UPDATE SET
            total_assets_cents=excluded.total_assets_cents,
            transfer_amount_cents=excluded.transfer_amount_cents,
            source_type='manual',
            updated_at=datetime('now')
        "#,
        params![
            row_id,
            account_id,
            snapshot_date,
            total_assets_cents,
            transfer_amount_cents
        ],
    )
    .map_err(|e| format!("写入投资快照失败: {e}"))?;
    Ok(())
}

fn insert_asset_valuation(
    conn: &Connection,
    account_id: &str,
    account_name: &str,
    asset_class: &str,
    snapshot_date: &str,
    value_cents: i64,
) -> Result<(), String> {
    let row_id = Uuid::new_v5(
        &Uuid::NAMESPACE_URL,
        format!("regression:asset:{account_id}:{asset_class}:{snapshot_date}").as_bytes(),
    )
    .to_string();
    conn.execute(
        r#"
        INSERT INTO account_valuations(
            id, account_id, account_name, asset_class, snapshot_date, value_cents, source_type
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'manual')
        ON CONFLICT(account_id, asset_class, snapshot_date) DO UPDATE SET
            account_name=excluded.account_name,
            value_cents=excluded.value_cents,
            source_type='manual',
            updated_at=datetime('now')
        "#,
        params![
            row_id,
            account_id,
            account_name,
            asset_class,
            snapshot_date,
            value_cents
        ],
    )
    .map_err(|e| format!("写入资产估值失败: {e}"))?;
    Ok(())
}

fn insert_category(conn: &Connection, id: &str, name: &str) -> Result<(), String> {
    conn.execute(
        r#"
        INSERT INTO categories(id, name, level, budget_enabled, is_active)
        VALUES (?1, ?2, 1, 1, 1)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name, updated_at=datetime('now')
        "#,
        params![id, name],
    )
    .map_err(|e| format!("写入分类失败: {e}"))?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn insert_income_tx(
    conn: &Connection,
    id: &str,
    external_ref: &str,
    date: &str,
    month_key: &str,
    amount_cents: i64,
    description: &str,
    merchant: &str,
    statement_category: &str,
    category_id: &str,
) -> Result<(), String> {
    conn.execute(
        r#"
        INSERT INTO transactions(
            id, external_ref, occurred_at, posted_at, month_key, amount_cents, currency, direction,
            description, merchant, merchant_normalized, statement_category, category_id, account_id,
            source_type, source_file, import_job_id, confidence, needs_review, excluded_in_analysis, exclude_reason
        )
        VALUES (
            ?1, ?2, ?3, ?3, ?4, ?5, 'CNY', 'income',
            ?6, ?7, ?7, ?8, ?9, 'acct_bank_income_regression',
            'cmb_bank_pdf', 'bank_stmt.pdf', NULL, 0.99, 0, 0, ''
        )
        ON CONFLICT(id) DO UPDATE SET amount_cents=excluded.amount_cents, updated_at=datetime('now')
        "#,
        params![
            id,
            external_ref,
            date,
            month_key,
            amount_cents,
            description,
            merchant,
            statement_category,
            category_id
        ],
    )
    .map_err(|e| format!("写入收入交易失败: {e}"))?;
    Ok(())
}

fn category_id_from_name(name: &str) -> String {
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
