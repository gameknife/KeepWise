use chrono::Utc;
use rusqlite::Connection;
use serde_json::{json, Map, Value};
use tauri::AppHandle;

use crate::investment_analytics::{investment_curve_query_at_db_path, InvestmentCurveQueryRequest};
use crate::ledger_db::{ledger_db_admin_stats, resolve_ledger_db_path};
use crate::wealth_analytics::{wealth_overview_query_at_db_path, WealthOverviewQueryRequest};

fn quote_ident(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

fn table_exists(conn: &Connection, table: &str) -> Result<bool, String> {
    let exists = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)",
            [table],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|e| format!("检查表存在性失败 ({table}): {e}"))?;
    Ok(exists != 0)
}

fn count_rows_if_exists(conn: &Connection, table: &str) -> Result<Option<i64>, String> {
    if !table_exists(conn, table)? {
        return Ok(None);
    }
    let sql = format!("SELECT COUNT(*) FROM {}", quote_ident(table));
    let count = conn
        .query_row(&sql, [], |row| row.get::<_, i64>(0))
        .map_err(|e| format!("统计表行数失败 ({table}): {e}"))?;
    Ok(Some(count))
}

fn count_distinct_accounts_investment(conn: &Connection) -> Result<i64, String> {
    let Some(_) = count_rows_if_exists(conn, "investment_records")? else {
        return Ok(0);
    };
    conn.query_row(
        "SELECT COUNT(DISTINCT account_id) FROM investment_records WHERE TRIM(COALESCE(account_id, '')) <> ''",
        [],
        |row| row.get::<_, i64>(0),
    )
    .map_err(|e| format!("统计投资账户数失败: {e}"))
}

fn count_distinct_accounts_by_asset_class(
    conn: &Connection,
    asset_class: &str,
) -> Result<i64, String> {
    let Some(_) = count_rows_if_exists(conn, "account_valuations")? else {
        return Ok(0);
    };
    conn.query_row(
        "SELECT COUNT(DISTINCT account_id) FROM account_valuations WHERE asset_class = ?1 AND TRIM(COALESCE(account_id, '')) <> ''",
        [asset_class],
        |row| row.get::<_, i64>(0),
    )
    .map_err(|e| format!("统计资产账户数失败 ({asset_class}): {e}"))
}

fn push_table_probe(
    checks: &mut Map<String, Value>,
    failures: &mut Vec<String>,
    conn: &Connection,
    check_name: &str,
    table: &str,
) {
    match count_rows_if_exists(conn, table) {
        Ok(Some(row_count)) => {
            checks.insert(
                check_name.to_string(),
                json!({
                    "ok": true,
                    "rows": row_count,
                }),
            );
        }
        Ok(None) => {
            failures.push(format!("{check_name} 失败: 缺少表 {table}"));
        }
        Err(e) => {
            failures.push(format!("{check_name} 失败: {e}"));
        }
    }
}

fn is_wealth_overview_no_data(msg: &str) -> bool {
    msg.contains("当前没有可用于财富总览的数据")
}

fn is_curve_insufficient_data(msg: &str) -> bool {
    msg.contains("当前没有可用于曲线展示的数据")
        || msg.contains("无可用快照")
        || msg.contains("至少需要")
        || msg.contains("不足")
}

fn as_object<'a>(v: &'a Value) -> Option<&'a serde_json::Map<String, Value>> {
    v.as_object()
}

fn get_path<'a>(v: &'a Value, path: &[&str]) -> Option<&'a Value> {
    let mut current = v;
    for part in path {
        current = as_object(current)?.get(*part)?;
    }
    Some(current)
}

fn get_bool(v: &Value, path: &[&str]) -> Option<bool> {
    get_path(v, path)?.as_bool()
}

fn get_i64(v: &Value, path: &[&str]) -> Option<i64> {
    get_path(v, path)?.as_i64()
}

fn get_string(v: &Value, path: &[&str]) -> Option<String> {
    get_path(v, path)?.as_str().map(|s| s.to_string())
}

#[tauri::command]
pub fn runtime_db_health_check(app: AppHandle) -> Result<Value, String> {
    let db_path = resolve_ledger_db_path(&app)?;
    let db_path_text = db_path.to_string_lossy().to_string();

    let mut failures: Vec<String> = Vec::new();
    let mut warnings: Vec<String> = Vec::new();
    let mut checks = Map::<String, Value>::new();
    checks.insert("db_path".to_string(), Value::String(db_path_text.clone()));

    let db_stats = match ledger_db_admin_stats(app.clone()) {
        Ok(v) => {
            checks.insert(
                "db_stats".to_string(),
                json!({
                    "table_count": v.summary.table_count,
                    "total_rows": v.summary.total_rows,
                }),
            );
            v
        }
        Err(e) => {
            failures.push(format!("db_stats 失败: {e}"));
            return Ok(json!({
                "ok": false,
                "checked_at": Utc::now().format("%Y-%m-%dT%H:%M:%S").to_string(),
                "failures": failures,
                "warnings": warnings,
                "checks": Value::Object(checks),
            }));
        }
    };

    let total_rows = db_stats.summary.total_rows;
    let conn = match Connection::open(&db_path) {
        Ok(c) => c,
        Err(e) => {
            failures.push(format!("open_db 失败: {e}"));
            return Ok(json!({
                "ok": false,
                "checked_at": Utc::now().format("%Y-%m-%dT%H:%M:%S").to_string(),
                "failures": failures,
                "warnings": warnings,
                "checks": Value::Object(checks),
            }));
        }
    };

    match (
        count_distinct_accounts_investment(&conn),
        count_distinct_accounts_by_asset_class(&conn, "cash"),
        count_distinct_accounts_by_asset_class(&conn, "real_estate"),
        count_distinct_accounts_by_asset_class(&conn, "liability"),
    ) {
        (Ok(investment_count), Ok(cash_count), Ok(real_estate_count), Ok(liability_count)) => {
            checks.insert(
                "accounts".to_string(),
                json!({
                    "investment_count": investment_count,
                    "cash_count": cash_count,
                    "real_estate_count": real_estate_count,
                    "liability_count": liability_count,
                }),
            );
        }
        (a, b, c, d) => {
            let mut parts = Vec::new();
            if let Err(e) = a {
                parts.push(e);
            }
            if let Err(e) = b {
                parts.push(e);
            }
            if let Err(e) = c {
                parts.push(e);
            }
            if let Err(e) = d {
                parts.push(e);
            }
            failures.push(format!("meta_accounts 失败: {}", parts.join(" | ")));
            checks.insert(
                "accounts".to_string(),
                json!({
                    "investment_count": 0,
                    "cash_count": 0,
                    "real_estate_count": 0,
                    "liability_count": 0,
                }),
            );
        }
    }

    push_table_probe(
        &mut checks,
        &mut failures,
        &conn,
        "query_transactions",
        "transactions",
    );
    push_table_probe(
        &mut checks,
        &mut failures,
        &conn,
        "query_investments",
        "investment_records",
    );
    push_table_probe(
        &mut checks,
        &mut failures,
        &conn,
        "query_assets",
        "account_valuations",
    );

    match wealth_overview_query_at_db_path(
        &db_path,
        WealthOverviewQueryRequest {
            as_of_date: None,
            include_investment: None,
            include_cash: None,
            include_real_estate: None,
            include_liability: None,
        },
    ) {
        Ok(payload) => {
            let row_count = payload
                .get("rows")
                .and_then(Value::as_array)
                .map(|v| v.len())
                .unwrap_or(0);
            let reconciliation_ok =
                get_bool(&payload, &["summary", "reconciliation_ok"]).unwrap_or(false);
            let stale_account_count =
                get_i64(&payload, &["summary", "stale_account_count"]).unwrap_or(0);
            checks.insert(
                "wealth_overview".to_string(),
                json!({
                    "ok": true,
                    "as_of": get_string(&payload, &["as_of"]),
                    "reconciliation_ok": reconciliation_ok,
                    "stale_account_count": stale_account_count,
                    "row_count": row_count,
                }),
            );
            if !reconciliation_ok {
                warnings.push(
                    "wealth_overview 对账不一致（selected_rows_total 与 wealth_total 存在差异）"
                        .to_string(),
                );
            }
        }
        Err(e) if is_wealth_overview_no_data(&e) => {
            warnings.push(format!("wealth_overview 无可用数据: {e}"));
            checks.insert(
                "wealth_overview".to_string(),
                json!({
                    "ok": false,
                    "reason": e,
                }),
            );
        }
        Err(e) => {
            failures.push(format!("wealth_overview 失败: {e}"));
        }
    }

    let investment_accounts = checks
        .get("accounts")
        .and_then(|v| get_i64(v, &["investment_count"]))
        .unwrap_or(0);
    if investment_accounts > 0 {
        match investment_curve_query_at_db_path(
            &db_path,
            InvestmentCurveQueryRequest {
                account_id: "__portfolio__".to_string(),
                preset: Some("1y".to_string()),
                from_date: None,
                to_date: None,
            },
        ) {
            Ok(payload) => {
                checks.insert(
                    "portfolio_curve".to_string(),
                    json!({
                        "ok": true,
                        "points": get_i64(&payload, &["summary", "count"]),
                        "end_cumulative_return_pct_text": get_string(&payload, &["summary", "end_cumulative_return_pct_text"]),
                        "end_net_growth_yuan": get_string(&payload, &["summary", "end_net_growth_yuan"]),
                    }),
                );
            }
            Err(e) if is_curve_insufficient_data(&e) => {
                warnings.push(format!("portfolio_curve 数据不足: {e}"));
                checks.insert(
                    "portfolio_curve".to_string(),
                    json!({
                        "ok": false,
                        "reason": e,
                    }),
                );
            }
            Err(e) => {
                failures.push(format!("portfolio_curve 失败: {e}"));
            }
        }
    } else {
        warnings.push("当前无投资账户，跳过组合收益曲线检查".to_string());
        checks.insert(
            "portfolio_curve".to_string(),
            json!({
                "ok": false,
                "reason": "no_investment_accounts",
            }),
        );
    }

    if total_rows == 0 {
        warnings.push("数据库当前无业务数据（total_rows = 0）".to_string());
    }

    Ok(json!({
        "ok": failures.is_empty(),
        "checked_at": Utc::now().format("%Y-%m-%dT%H:%M:%S").to_string(),
        "failures": failures,
        "warnings": warnings,
        "checks": Value::Object(checks),
    }))
}
