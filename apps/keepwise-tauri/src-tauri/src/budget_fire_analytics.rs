use chrono::{Datelike, Local};
use rusqlite::{params, Connection};
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::Path;
use tauri::AppHandle;
use uuid::Uuid;

use crate::ledger_db::resolve_ledger_db_path;
use crate::wealth_analytics::{wealth_overview_query_at_db_path, WealthOverviewQueryRequest};

const DEFAULT_FIRE_WITHDRAWAL_RATE: f64 = 0.04;
const TRANSACTION_IMPORT_SOURCE_TYPES: [&str; 2] = ["cmb_eml", "cmb_bank_pdf"];

#[derive(Debug, Default, Deserialize)]
pub struct MonthlyBudgetItemsQueryRequest {}

#[derive(Debug, Deserialize)]
pub struct MonthlyBudgetItemUpsertRequest {
    pub id: Option<String>,
    pub name: Option<String>,
    pub monthly_amount: Option<String>,
    pub sort_order: Option<String>,
    pub is_active: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct MonthlyBudgetItemDeleteRequest {
    pub id: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
pub struct BudgetYearQueryRequest {
    pub year: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
pub struct FireProgressQueryRequest {
    pub year: Option<String>,
    pub withdrawal_rate: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
pub struct ConsumptionReportQueryRequest {
    pub year: Option<String>,
}

#[derive(Debug)]
struct MonthlyBudgetItemRow {
    id: String,
    name: String,
    monthly_amount_cents: i64,
    sort_order: i64,
    is_active: bool,
    is_builtin: bool,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Clone, Copy)]
struct BudgetItemsSummary {
    total_count: i64,
    active_count: i64,
    monthly_total_cents: i64,
    annual_total_cents: i64,
}

fn cents_to_yuan_text(cents: i64) -> String {
    format!("{:.2}", cents as f64 / 100.0)
}

fn cents_to_yuan_value(cents: i64) -> f64 {
    round_to(cents as f64 / 100.0, 2)
}

fn round_to(value: f64, digits: i32) -> f64 {
    let factor = 10_f64.powi(digits);
    (value * factor).round() / factor
}

fn parse_bool_param(raw: Option<&str>, default: bool) -> Result<bool, String> {
    let text = raw.unwrap_or("").trim().to_lowercase();
    if text.is_empty() {
        return Ok(default);
    }
    if ["1", "true", "yes", "y", "on"].contains(&text.as_str()) {
        return Ok(true);
    }
    if ["0", "false", "no", "n", "off"].contains(&text.as_str()) {
        return Ok(false);
    }
    Err(format!("布尔参数不合法: {}", raw.unwrap_or("")))
}

fn parse_year_param(raw: Option<&str>, default_year: i32) -> Result<i32, String> {
    let text = raw.unwrap_or("").trim();
    if text.is_empty() {
        return Ok(default_year);
    }
    let value = text
        .parse::<i32>()
        .map_err(|_| "year 必须是整数年份".to_string())?;
    if !(2000..=2100).contains(&value) {
        return Err("year 超出支持范围（2000-2100）".to_string());
    }
    Ok(value)
}

fn parse_withdrawal_rate_param(raw: Option<&str>, default_rate: f64) -> Result<f64, String> {
    let text = raw.unwrap_or("").trim();
    if text.is_empty() {
        return Ok(default_rate);
    }
    let value = text
        .parse::<f64>()
        .map_err(|_| "withdrawal_rate 必须是数字（例如 0.04）".to_string())?;
    if !(0.0..1.0).contains(&value) {
        return Err("withdrawal_rate 必须在 0 和 1 之间（例如 0.04 表示 4%）".to_string());
    }
    if value <= 0.0 {
        return Err("withdrawal_rate 必须在 0 和 1 之间（例如 0.04 表示 4%）".to_string());
    }
    Ok(value)
}

fn parse_amount_to_cents(raw: &str) -> Result<i64, String> {
    let mut s = raw.trim().to_string();
    if s.is_empty() {
        return Ok(0);
    }
    s = s
        .replace(',', "")
        .replace('￥', "")
        .replace('¥', "")
        .replace('元', "")
        .replace(' ', "");
    if s.is_empty() {
        return Ok(0);
    }
    let negative = s.starts_with('-');
    if s.starts_with('-') || s.starts_with('+') {
        s = s[1..].to_string();
    }
    if s.is_empty() {
        return Err("金额格式不合法".to_string());
    }
    let parts = s.split('.').collect::<Vec<_>>();
    if parts.len() > 2 {
        return Err("金额格式不合法".to_string());
    }
    let int_part = if parts[0].is_empty() { "0" } else { parts[0] };
    if !int_part.chars().all(|c| c.is_ascii_digit()) {
        return Err("金额格式不合法".to_string());
    }
    let frac_part = if parts.len() == 2 { parts[1] } else { "" };
    if !frac_part.chars().all(|c| c.is_ascii_digit()) {
        return Err("金额格式不合法".to_string());
    }
    if frac_part.len() > 2 {
        return Err("金额最多支持两位小数".to_string());
    }
    let int_val = int_part
        .parse::<i64>()
        .map_err(|_| "金额数值超出范围".to_string())?;
    let frac_val = match frac_part.len() {
        0 => 0_i64,
        1 => {
            frac_part
                .parse::<i64>()
                .map_err(|_| "金额格式不合法".to_string())?
                * 10
        }
        2 => frac_part
            .parse::<i64>()
            .map_err(|_| "金额格式不合法".to_string())?,
        _ => unreachable!(),
    };
    let mut cents = int_val
        .checked_mul(100)
        .and_then(|v| v.checked_add(frac_val))
        .ok_or_else(|| "金额数值超出范围".to_string())?;
    if negative {
        cents = -cents;
    }
    Ok(cents)
}

fn parse_sort_order(raw: Option<&str>) -> Result<i64, String> {
    let text = raw.unwrap_or("").trim();
    if text.is_empty() {
        return Ok(1000);
    }
    text.parse::<i64>()
        .map_err(|_| "sort_order 必须是整数".to_string())
}

fn load_monthly_budget_items(conn: &Connection) -> Result<Vec<MonthlyBudgetItemRow>, String> {
    let mut stmt = conn
        .prepare(
            r#"
            SELECT id, name, monthly_amount_cents, sort_order, is_active, is_builtin, created_at, updated_at
            FROM monthly_budget_items
            ORDER BY sort_order ASC, is_builtin DESC, created_at ASC, id ASC
            "#,
        )
        .map_err(|e| format!("查询预算项失败: {e}"))?;
    let iter = stmt
        .query_map([], |row| {
            Ok(MonthlyBudgetItemRow {
                id: row.get::<_, String>(0)?,
                name: row.get::<_, String>(1)?,
                monthly_amount_cents: row.get::<_, i64>(2)?,
                sort_order: row.get::<_, i64>(3)?,
                is_active: row.get::<_, i64>(4)? != 0,
                is_builtin: row.get::<_, i64>(5)? != 0,
                created_at: row.get::<_, String>(6)?,
                updated_at: row.get::<_, String>(7)?,
            })
        })
        .map_err(|e| format!("查询预算项失败: {e}"))?;
    let mut out = Vec::new();
    for row in iter {
        out.push(row.map_err(|e| format!("读取预算项失败: {e}"))?);
    }
    Ok(out)
}

fn summarize_monthly_budget_items(rows: &[MonthlyBudgetItemRow]) -> BudgetItemsSummary {
    let total_count = rows.len() as i64;
    let active_rows = rows.iter().filter(|r| r.is_active).collect::<Vec<_>>();
    let active_count = active_rows.len() as i64;
    let monthly_total_cents = active_rows
        .iter()
        .map(|r| r.monthly_amount_cents)
        .sum::<i64>();
    let annual_total_cents = monthly_total_cents * 12;
    BudgetItemsSummary {
        total_count,
        active_count,
        monthly_total_cents,
        annual_total_cents,
    }
}

fn monthly_budget_item_row_to_json(row: &MonthlyBudgetItemRow) -> Value {
    let annual_amount_cents = row.monthly_amount_cents * 12;
    json!({
        "id": row.id,
        "name": row.name,
        "monthly_amount_cents": row.monthly_amount_cents,
        "monthly_amount_yuan": cents_to_yuan_text(row.monthly_amount_cents),
        "annual_amount_cents": annual_amount_cents,
        "annual_amount_yuan": cents_to_yuan_text(annual_amount_cents),
        "sort_order": row.sort_order,
        "is_active": row.is_active,
        "is_builtin": row.is_builtin,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    })
}

fn budget_year_months_elapsed(selected_year: i32, today: chrono::NaiveDate) -> i32 {
    if selected_year < today.year() {
        12
    } else if selected_year > today.year() {
        0
    } else {
        today.month() as i32
    }
}

pub fn query_monthly_budget_items_at_db_path(
    db_path: &Path,
    _req: MonthlyBudgetItemsQueryRequest,
) -> Result<Value, String> {
    let conn = Connection::open(db_path).map_err(|e| format!("打开数据库失败: {e}"))?;
    let rows = load_monthly_budget_items(&conn)?;
    let summary = summarize_monthly_budget_items(&rows);
    Ok(json!({
        "summary": {
            "total_count": summary.total_count,
            "active_count": summary.active_count,
            "monthly_budget_total_cents": summary.monthly_total_cents,
            "monthly_budget_total_yuan": cents_to_yuan_text(summary.monthly_total_cents),
            "annual_budget_cents": summary.annual_total_cents,
            "annual_budget_yuan": cents_to_yuan_text(summary.annual_total_cents),
        },
        "rows": rows.iter().map(monthly_budget_item_row_to_json).collect::<Vec<_>>(),
    }))
}

pub fn upsert_monthly_budget_item_at_db_path(
    db_path: &Path,
    req: MonthlyBudgetItemUpsertRequest,
) -> Result<Value, String> {
    let mut item_id = req.id.unwrap_or_default().trim().to_string();
    let name = req.name.unwrap_or_default().trim().to_string();
    if name.is_empty() {
        return Err("name 必填".to_string());
    }
    let monthly_amount_cents = parse_amount_to_cents(
        req.monthly_amount
            .unwrap_or_else(|| "0".to_string())
            .as_str(),
    )?;
    if monthly_amount_cents < 0 {
        return Err("monthly_amount 不能为负数".to_string());
    }
    let is_active = parse_bool_param(req.is_active.as_deref(), true)?;
    let sort_order = parse_sort_order(req.sort_order.as_deref())?;

    let mut conn = Connection::open(db_path).map_err(|e| format!("打开数据库失败: {e}"))?;
    conn.execute("PRAGMA foreign_keys = ON", [])
        .map_err(|e| format!("启用外键失败: {e}"))?;

    let save_result: Result<MonthlyBudgetItemRow, String> = (|| {
        let tx = conn
            .transaction()
            .map_err(|e| format!("开启事务失败: {e}"))?;
        if !item_id.is_empty() {
            let exists = tx
                .query_row(
                    "SELECT id FROM monthly_budget_items WHERE id = ?1",
                    [item_id.as_str()],
                    |_row| Ok(()),
                )
                .map(|_| true)
                .unwrap_or(false);
            if !exists {
                return Err("未找到要修改的预算项".to_string());
            }
            tx.execute(
                r#"
                UPDATE monthly_budget_items
                SET name = ?1,
                    monthly_amount_cents = ?2,
                    sort_order = ?3,
                    is_active = ?4,
                    updated_at = datetime('now')
                WHERE id = ?5
                "#,
                params![
                    name,
                    monthly_amount_cents,
                    sort_order,
                    if is_active { 1 } else { 0 },
                    item_id
                ],
            )
            .map_err(|e| format!("预算项保存失败（名称可能重复）: {e}"))?;
        } else {
            item_id = Uuid::new_v4().to_string();
            tx.execute(
                r#"
                INSERT INTO monthly_budget_items(
                    id, name, monthly_amount_cents, sort_order, is_active, is_builtin
                ) VALUES (?1, ?2, ?3, ?4, ?5, 0)
                "#,
                params![
                    item_id,
                    name,
                    monthly_amount_cents,
                    sort_order,
                    if is_active { 1 } else { 0 }
                ],
            )
            .map_err(|e| format!("预算项保存失败（名称可能重复）: {e}"))?;
        }

        let saved = tx
            .query_row(
                r#"
                SELECT id, name, monthly_amount_cents, sort_order, is_active, is_builtin, created_at, updated_at
                FROM monthly_budget_items
                WHERE id = ?1
                "#,
                [item_id.as_str()],
                |row| {
                    Ok(MonthlyBudgetItemRow {
                        id: row.get::<_, String>(0)?,
                        name: row.get::<_, String>(1)?,
                        monthly_amount_cents: row.get::<_, i64>(2)?,
                        sort_order: row.get::<_, i64>(3)?,
                        is_active: row.get::<_, i64>(4)? != 0,
                        is_builtin: row.get::<_, i64>(5)? != 0,
                        created_at: row.get::<_, String>(6)?,
                        updated_at: row.get::<_, String>(7)?,
                    })
                },
            )
            .map_err(|_| "预算项保存后读取失败".to_string())?;
        tx.commit().map_err(|e| format!("提交事务失败: {e}"))?;
        Ok(saved)
    })();

    save_result.map(|row| monthly_budget_item_row_to_json(&row))
}

pub fn delete_monthly_budget_item_at_db_path(
    db_path: &Path,
    req: MonthlyBudgetItemDeleteRequest,
) -> Result<Value, String> {
    let item_id = req.id.unwrap_or_default().trim().to_string();
    if item_id.is_empty() {
        return Err("id 必填".to_string());
    }

    let mut conn = Connection::open(db_path).map_err(|e| format!("打开数据库失败: {e}"))?;
    conn.execute("PRAGMA foreign_keys = ON", [])
        .map_err(|e| format!("启用外键失败: {e}"))?;

    let tx = conn
        .transaction()
        .map_err(|e| format!("开启事务失败: {e}"))?;
    let row = tx
        .query_row(
            "SELECT id, name, monthly_amount_cents, is_builtin FROM monthly_budget_items WHERE id = ?1",
            [item_id.as_str()],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)? != 0,
                ))
            },
        )
        .map_err(|_| "未找到要删除的预算项".to_string())?;
    tx.execute(
        "DELETE FROM monthly_budget_items WHERE id = ?1",
        [item_id.as_str()],
    )
    .map_err(|e| format!("删除预算项失败: {e}"))?;
    tx.commit().map_err(|e| format!("提交事务失败: {e}"))?;

    Ok(json!({
        "id": row.0,
        "name": row.1,
        "monthly_amount_cents": row.2,
        "is_builtin": row.3,
        "deleted": true,
    }))
}

pub fn query_budget_overview_at_db_path(
    db_path: &Path,
    req: BudgetYearQueryRequest,
) -> Result<Value, String> {
    let today = Local::now().date_naive();
    let year = parse_year_param(req.year.as_deref(), today.year())?;
    let month_start = format!("{year:04}-01");
    let month_end = format!("{year:04}-12");
    let elapsed_months = budget_year_months_elapsed(year, today);

    let conn = Connection::open(db_path).map_err(|e| format!("打开数据库失败: {e}"))?;
    let budget_rows = load_monthly_budget_items(&conn)?;
    let budget_summary = summarize_monthly_budget_items(&budget_rows);
    let actual_spent_cents = conn
        .query_row(
            r#"
            SELECT COALESCE(SUM(ABS(amount_cents)), 0) AS spent_cents
            FROM transactions
            WHERE direction = 'expense'
              AND month_key >= ?1
              AND month_key <= ?2
              AND needs_review = 0
              AND excluded_in_analysis = 0
            "#,
            params![month_start, month_end],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|e| format!("查询预算执行情况失败: {e}"))?;

    let monthly_budget_total_cents = budget_summary.monthly_total_cents;
    let annual_budget_cents = budget_summary.annual_total_cents;
    let ytd_budget_cents = monthly_budget_total_cents * elapsed_months as i64;
    let ytd_actual_cents = actual_spent_cents;
    let annual_remaining_cents = annual_budget_cents - actual_spent_cents;
    let ytd_variance_cents = ytd_budget_cents - ytd_actual_cents;
    let usage_rate = if annual_budget_cents > 0 {
        Some(actual_spent_cents as f64 / annual_budget_cents as f64)
    } else {
        None
    };
    let ytd_usage_rate = if ytd_budget_cents > 0 {
        Some(ytd_actual_cents as f64 / ytd_budget_cents as f64)
    } else {
        None
    };

    Ok(json!({
        "year": year,
        "as_of_date": today.format("%Y-%m-%d").to_string(),
        "analysis_scope": {
            "exclude_needs_review": true,
            "exclude_excluded_in_analysis": true,
            "ytd_budget_mode": "elapsed_months_integer",
            "elapsed_months": elapsed_months,
        },
        "budget": {
            "monthly_total_cents": monthly_budget_total_cents,
            "monthly_total_yuan": cents_to_yuan_text(monthly_budget_total_cents),
            "annual_total_cents": annual_budget_cents,
            "annual_total_yuan": cents_to_yuan_text(annual_budget_cents),
            "ytd_budget_cents": ytd_budget_cents,
            "ytd_budget_yuan": cents_to_yuan_text(ytd_budget_cents),
            "active_item_count": budget_summary.active_count,
            "total_item_count": budget_summary.total_count,
        },
        "actual": {
            "spent_total_cents": actual_spent_cents,
            "spent_total_yuan": cents_to_yuan_text(actual_spent_cents),
            "ytd_spent_cents": ytd_actual_cents,
            "ytd_spent_yuan": cents_to_yuan_text(ytd_actual_cents),
        },
        "metrics": {
            "annual_remaining_cents": annual_remaining_cents,
            "annual_remaining_yuan": cents_to_yuan_text(annual_remaining_cents),
            "usage_rate": usage_rate.map(|v| round_to(v, 8)),
            "usage_rate_pct_text": usage_rate.map(|v| format!("{:.2}%", v * 100.0)).unwrap_or_else(|| "-".to_string()),
            "ytd_variance_cents": ytd_variance_cents,
            "ytd_variance_yuan": cents_to_yuan_text(ytd_variance_cents),
            "ytd_usage_rate": ytd_usage_rate.map(|v| round_to(v, 8)),
            "ytd_usage_rate_pct_text": ytd_usage_rate.map(|v| format!("{:.2}%", v * 100.0)).unwrap_or_else(|| "-".to_string()),
        }
    }))
}

pub fn query_budget_monthly_review_at_db_path(
    db_path: &Path,
    req: BudgetYearQueryRequest,
) -> Result<Value, String> {
    let today = Local::now().date_naive();
    let year = parse_year_param(req.year.as_deref(), today.year())?;
    let month_start = format!("{year:04}-01");
    let month_end = format!("{year:04}-12");

    let conn = Connection::open(db_path).map_err(|e| format!("打开数据库失败: {e}"))?;
    let budget_rows = load_monthly_budget_items(&conn)?;
    let budget_summary = summarize_monthly_budget_items(&budget_rows);
    let mut stmt = conn
        .prepare(
            r#"
            SELECT
                month_key,
                COUNT(*) AS tx_count,
                COALESCE(SUM(ABS(amount_cents)), 0) AS spent_cents
            FROM transactions
            WHERE direction = 'expense'
              AND month_key >= ?1
              AND month_key <= ?2
              AND needs_review = 0
              AND excluded_in_analysis = 0
            GROUP BY month_key
            ORDER BY month_key ASC
            "#,
        )
        .map_err(|e| format!("查询预算月度复盘失败: {e}"))?;
    let tx_iter = stmt
        .query_map(params![month_start, month_end], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })
        .map_err(|e| format!("查询预算月度复盘失败: {e}"))?;

    let mut tx_map = std::collections::HashMap::<String, (i64, i64)>::new();
    for row in tx_iter {
        let (month_key, tx_count, spent_cents) =
            row.map_err(|e| format!("读取预算月度复盘失败: {e}"))?;
        tx_map.insert(month_key, (tx_count, spent_cents));
    }

    let monthly_budget_cents = budget_summary.monthly_total_cents;
    let annual_budget_cents = monthly_budget_cents * 12;
    let mut rows = Vec::<Value>::new();
    let mut over_budget_months = 0_i64;
    let mut under_budget_months = 0_i64;
    let mut equal_months = 0_i64;
    let mut annual_spent_cents = 0_i64;

    for month in 1..=12 {
        let month_key = format!("{year:04}-{month:02}");
        let (tx_count, spent_cents) = tx_map.get(&month_key).copied().unwrap_or((0, 0));
        let variance_cents = monthly_budget_cents - spent_cents;
        let usage_rate = if monthly_budget_cents > 0 {
            Some(spent_cents as f64 / monthly_budget_cents as f64)
        } else {
            None
        };
        let status = if spent_cents > monthly_budget_cents {
            over_budget_months += 1;
            "超预算"
        } else if spent_cents < monthly_budget_cents {
            under_budget_months += 1;
            "低于预算"
        } else {
            equal_months += 1;
            "持平"
        };
        annual_spent_cents += spent_cents;
        rows.push(json!({
            "month_key": month_key,
            "month_index": month,
            "tx_count": tx_count,
            "budget_cents": monthly_budget_cents,
            "budget_yuan": cents_to_yuan_text(monthly_budget_cents),
            "spent_cents": spent_cents,
            "spent_yuan": cents_to_yuan_text(spent_cents),
            "variance_cents": variance_cents,
            "variance_yuan": cents_to_yuan_text(variance_cents),
            "usage_rate": usage_rate.map(|v| round_to(v, 8)),
            "usage_rate_pct_text": usage_rate.map(|v| format!("{:.2}%", v * 100.0)).unwrap_or_else(|| "-".to_string()),
            "status": status,
        }));
    }

    let annual_variance_cents = annual_budget_cents - annual_spent_cents;
    let annual_usage_rate = if annual_budget_cents > 0 {
        Some(annual_spent_cents as f64 / annual_budget_cents as f64)
    } else {
        None
    };

    Ok(json!({
        "year": year,
        "analysis_scope": {
            "exclude_needs_review": true,
            "exclude_excluded_in_analysis": true,
        },
        "summary": {
            "monthly_budget_cents": monthly_budget_cents,
            "monthly_budget_yuan": cents_to_yuan_text(monthly_budget_cents),
            "annual_budget_cents": annual_budget_cents,
            "annual_budget_yuan": cents_to_yuan_text(annual_budget_cents),
            "annual_spent_cents": annual_spent_cents,
            "annual_spent_yuan": cents_to_yuan_text(annual_spent_cents),
            "annual_variance_cents": annual_variance_cents,
            "annual_variance_yuan": cents_to_yuan_text(annual_variance_cents),
            "annual_usage_rate": annual_usage_rate.map(|v| round_to(v, 8)),
            "annual_usage_rate_pct_text": annual_usage_rate.map(|v| format!("{:.2}%", v * 100.0)).unwrap_or_else(|| "-".to_string()),
            "over_budget_months": over_budget_months,
            "under_budget_months": under_budget_months,
            "equal_months": equal_months,
        },
        "rows": rows,
    }))
}

pub fn query_consumption_report_at_db_path(
    db_path: &Path,
    req: ConsumptionReportQueryRequest,
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

        all_consume_rows.push(json!({
            "id": id,
            "month": month_key,
            "date": date,
            "merchant": merchant,
            "description": description,
            "category": if expense_category.is_empty() { "待分类" } else { expense_category.as_str() },
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
        "months": months,
        "merchants": merchants,
        "transactions": transactions,
    }))
}

pub fn query_salary_income_overview_at_db_path(
    db_path: &Path,
    req: BudgetYearQueryRequest,
) -> Result<Value, String> {
    let today = Local::now().date_naive();
    let year = parse_year_param(req.year.as_deref(), today.year())?;
    let month_start = format!("{year:04}-01");
    let month_end = format!("{year:04}-12");

    let conn = Connection::open(db_path).map_err(|e| format!("打开数据库失败: {e}"))?;

    let mut monthly_stmt = conn
        .prepare(
            r#"
            SELECT
                month_key,
                statement_category,
                COUNT(*) AS tx_count,
                COALESCE(SUM(amount_cents), 0) AS amount_cents
            FROM transactions
            WHERE source_type = 'cmb_bank_pdf'
              AND direction = 'income'
              AND month_key >= ?1
              AND month_key <= ?2
              AND statement_category IN ('代发工资', '代发住房公积金')
            GROUP BY month_key, statement_category
            ORDER BY month_key ASC, statement_category ASC
            "#,
        )
        .map_err(|e| format!("查询收入月度明细失败: {e}"))?;
    let monthly_iter = monthly_stmt
        .query_map(params![month_start, month_end], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
            ))
        })
        .map_err(|e| format!("查询收入月度明细失败: {e}"))?;
    let mut monthly_rows = Vec::<(String, String, i64, i64)>::new();
    for row in monthly_iter {
        monthly_rows.push(row.map_err(|e| format!("读取收入月度明细失败: {e}"))?);
    }

    let mut employer_stmt = conn
        .prepare(
            r#"
            SELECT
                COALESCE(NULLIF(TRIM(merchant_normalized), ''), NULLIF(TRIM(merchant), ''), '未知来源') AS employer,
                COUNT(*) AS tx_count,
                COALESCE(SUM(amount_cents), 0) AS amount_cents
            FROM transactions
            WHERE source_type = 'cmb_bank_pdf'
              AND direction = 'income'
              AND month_key >= ?1
              AND month_key <= ?2
              AND statement_category = '代发工资'
            GROUP BY employer
            ORDER BY amount_cents DESC, employer ASC
            "#,
        )
        .map_err(|e| format!("查询收入雇主分布失败: {e}"))?;
    let employer_iter = employer_stmt
        .query_map(params![month_start, month_end], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })
        .map_err(|e| format!("查询收入雇主分布失败: {e}"))?;
    let mut employers = Vec::<Value>::new();
    for row in employer_iter {
        let (employer, tx_count, amount_cents) =
            row.map_err(|e| format!("读取收入雇主分布失败: {e}"))?;
        employers.push(json!({
            "employer": employer,
            "tx_count": tx_count,
            "amount_cents": amount_cents,
            "amount_yuan": cents_to_yuan_text(amount_cents),
        }));
    }

    let totals = conn
        .query_row(
            r#"
            SELECT
                COALESCE(SUM(CASE WHEN statement_category = '代发工资' THEN amount_cents ELSE 0 END), 0) AS salary_cents,
                COALESCE(SUM(CASE WHEN statement_category = '代发住房公积金' THEN amount_cents ELSE 0 END), 0) AS housing_fund_cents,
                COALESCE(SUM(CASE WHEN statement_category = '代发工资' THEN 1 ELSE 0 END), 0) AS salary_count,
                COALESCE(SUM(CASE WHEN statement_category = '代发住房公积金' THEN 1 ELSE 0 END), 0) AS housing_fund_count
            FROM transactions
            WHERE source_type = 'cmb_bank_pdf'
              AND direction = 'income'
              AND month_key >= ?1
              AND month_key <= ?2
              AND statement_category IN ('代发工资', '代发住房公积金')
            "#,
            params![month_start, month_end],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            },
        )
        .map_err(|e| format!("查询收入汇总失败: {e}"))?;

    let mut month_map = std::collections::HashMap::<String, (i64, i64, i64, i64)>::new();
    for (month_key, statement_category, tx_count, amount_cents) in monthly_rows {
        let entry = month_map.entry(month_key).or_insert((0, 0, 0, 0)); // salary_cents, salary_tx, fund_cents, fund_tx
        match statement_category.as_str() {
            "代发工资" => {
                entry.0 += amount_cents;
                entry.1 += tx_count;
            }
            "代发住房公积金" => {
                entry.2 += amount_cents;
                entry.3 += tx_count;
            }
            _ => {}
        }
    }

    let mut rows = Vec::<Value>::new();
    let mut months_with_salary = 0_i64;
    let mut months_with_housing_fund = 0_i64;
    for month in 1..=12 {
        let month_key = format!("{year:04}-{month:02}");
        let (salary_cents, salary_tx_count, housing_fund_cents, housing_fund_tx_count) =
            month_map.get(&month_key).copied().unwrap_or((0, 0, 0, 0));
        if salary_cents > 0 {
            months_with_salary += 1;
        }
        if housing_fund_cents > 0 {
            months_with_housing_fund += 1;
        }
        let total_income_cents = salary_cents + housing_fund_cents;
        rows.push(json!({
            "month_key": month_key,
            "salary_cents": salary_cents,
            "salary_yuan": cents_to_yuan_text(salary_cents),
            "salary_tx_count": salary_tx_count,
            "housing_fund_cents": housing_fund_cents,
            "housing_fund_yuan": cents_to_yuan_text(housing_fund_cents),
            "housing_fund_tx_count": housing_fund_tx_count,
            "total_income_cents": total_income_cents,
            "total_income_yuan": cents_to_yuan_text(total_income_cents),
        }));
    }

    let (salary_total_cents, housing_fund_total_cents, salary_tx_count, housing_fund_tx_count) =
        totals;

    Ok(json!({
        "year": year,
        "as_of_date": today.format("%Y-%m-%d").to_string(),
        "source_type": "cmb_bank_pdf",
        "summary": {
            "salary_total_cents": salary_total_cents,
            "salary_total_yuan": cents_to_yuan_text(salary_total_cents),
            "salary_tx_count": salary_tx_count,
            "housing_fund_total_cents": housing_fund_total_cents,
            "housing_fund_total_yuan": cents_to_yuan_text(housing_fund_total_cents),
            "housing_fund_tx_count": housing_fund_tx_count,
            "total_income_cents": salary_total_cents + housing_fund_total_cents,
            "total_income_yuan": cents_to_yuan_text(salary_total_cents + housing_fund_total_cents),
            "months_with_salary": months_with_salary,
            "months_with_housing_fund": months_with_housing_fund,
            "employer_count": employers.len(),
        },
        "employers": employers,
        "rows": rows,
    }))
}

pub fn query_fire_progress_at_db_path(
    db_path: &Path,
    req: FireProgressQueryRequest,
) -> Result<Value, String> {
    let today = Local::now().date_naive();
    let year = parse_year_param(req.year.as_deref(), today.year())?;
    let withdrawal_rate =
        parse_withdrawal_rate_param(req.withdrawal_rate.as_deref(), DEFAULT_FIRE_WITHDRAWAL_RATE)?;

    let budget_overview = query_budget_overview_at_db_path(
        db_path,
        BudgetYearQueryRequest {
            year: Some(year.to_string()),
        },
    )?;
    let wealth_overview = wealth_overview_query_at_db_path(
        db_path,
        WealthOverviewQueryRequest {
            as_of_date: None,
            include_investment: Some("true".to_string()),
            include_cash: Some("true".to_string()),
            include_real_estate: Some("false".to_string()),
            include_liability: Some("false".to_string()),
        },
    )?;

    let annual_budget_cents = budget_overview
        .get("budget")
        .and_then(|v| v.get("annual_total_cents"))
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let investment_cents = wealth_overview
        .get("summary")
        .and_then(|v| v.get("investment_total_cents"))
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let cash_cents = wealth_overview
        .get("summary")
        .and_then(|v| v.get("cash_total_cents"))
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let investable_assets_cents = investment_cents + cash_cents;

    let (
        coverage_years,
        freedom_ratio,
        required_assets_cents,
        goal_gap_cents,
        remaining_to_goal_cents,
    ) = if annual_budget_cents > 0 {
        let coverage_years = investable_assets_cents as f64 / annual_budget_cents as f64;
        let freedom_ratio =
            (investable_assets_cents as f64 * withdrawal_rate) / annual_budget_cents as f64;
        let required_assets_cents = (annual_budget_cents as f64 / withdrawal_rate).ceil() as i64;
        let goal_gap_cents = investable_assets_cents - required_assets_cents;
        let remaining_to_goal_cents = (required_assets_cents - investable_assets_cents).max(0);
        (
            Some(coverage_years),
            Some(freedom_ratio),
            required_assets_cents,
            goal_gap_cents,
            remaining_to_goal_cents,
        )
    } else {
        (None, None, 0, 0, 0)
    };

    Ok(json!({
        "year": year,
        "withdrawal_rate": withdrawal_rate,
        "withdrawal_rate_pct_text": format!("{:.2}%", withdrawal_rate * 100.0),
        "budget": budget_overview.get("budget").cloned().unwrap_or_else(|| json!({})),
        "investable_assets": {
            "as_of": wealth_overview.get("as_of").cloned().unwrap_or(Value::Null),
            "investment_cents": investment_cents,
            "investment_yuan": cents_to_yuan_text(investment_cents),
            "cash_cents": cash_cents,
            "cash_yuan": cents_to_yuan_text(cash_cents),
            "total_cents": investable_assets_cents,
            "total_yuan": cents_to_yuan_text(investable_assets_cents),
        },
        "metrics": {
            "coverage_years": coverage_years.map(|v| round_to(v, 8)),
            "coverage_years_text": coverage_years.map(|v| format!("{v:.2} 年")).unwrap_or_else(|| "-".to_string()),
            "freedom_ratio": freedom_ratio.map(|v| round_to(v, 8)),
            "freedom_ratio_pct_text": freedom_ratio.map(|v| format!("{:.2}%", v * 100.0)).unwrap_or_else(|| "-".to_string()),
            "required_assets_cents": required_assets_cents,
            "required_assets_yuan": cents_to_yuan_text(required_assets_cents),
            "goal_gap_cents": goal_gap_cents,
            "goal_gap_yuan": cents_to_yuan_text(goal_gap_cents),
            "remaining_to_goal_cents": remaining_to_goal_cents,
            "remaining_to_goal_yuan": cents_to_yuan_text(remaining_to_goal_cents),
        }
    }))
}

#[tauri::command]
pub fn query_monthly_budget_items(
    app: AppHandle,
    req: MonthlyBudgetItemsQueryRequest,
) -> Result<Value, String> {
    let db_path = resolve_ledger_db_path(&app)?;
    query_monthly_budget_items_at_db_path(&db_path, req)
}

#[tauri::command]
pub fn upsert_monthly_budget_item(
    app: AppHandle,
    req: MonthlyBudgetItemUpsertRequest,
) -> Result<Value, String> {
    let db_path = resolve_ledger_db_path(&app)?;
    upsert_monthly_budget_item_at_db_path(&db_path, req)
}

#[tauri::command]
pub fn delete_monthly_budget_item(
    app: AppHandle,
    req: MonthlyBudgetItemDeleteRequest,
) -> Result<Value, String> {
    let db_path = resolve_ledger_db_path(&app)?;
    delete_monthly_budget_item_at_db_path(&db_path, req)
}

#[tauri::command]
pub fn query_budget_overview(app: AppHandle, req: BudgetYearQueryRequest) -> Result<Value, String> {
    let db_path = resolve_ledger_db_path(&app)?;
    query_budget_overview_at_db_path(&db_path, req)
}

#[tauri::command]
pub fn query_budget_monthly_review(
    app: AppHandle,
    req: BudgetYearQueryRequest,
) -> Result<Value, String> {
    let db_path = resolve_ledger_db_path(&app)?;
    query_budget_monthly_review_at_db_path(&db_path, req)
}

#[tauri::command]
pub fn query_salary_income_overview(
    app: AppHandle,
    req: BudgetYearQueryRequest,
) -> Result<Value, String> {
    let db_path = resolve_ledger_db_path(&app)?;
    query_salary_income_overview_at_db_path(&db_path, req)
}

#[tauri::command]
pub fn query_consumption_report(
    app: AppHandle,
    req: ConsumptionReportQueryRequest,
) -> Result<Value, String> {
    let db_path = resolve_ledger_db_path(&app)?;
    query_consumption_report_at_db_path(&db_path, req)
}

#[tauri::command]
pub fn query_fire_progress(app: AppHandle, req: FireProgressQueryRequest) -> Result<Value, String> {
    let db_path = resolve_ledger_db_path(&app)?;
    query_fire_progress_at_db_path(&db_path, req)
}

#[cfg(test)]
mod tests {
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
              ('cat_transport', '交通', 2);

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

        let budget_items = query_monthly_budget_items_at_db_path(
            &db_path,
            MonthlyBudgetItemsQueryRequest::default(),
        )
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
}
