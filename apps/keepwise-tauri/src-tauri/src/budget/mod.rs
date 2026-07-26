use chrono::{Datelike, Local};
use csv::ReaderBuilder;
use rusqlite::{params, Connection};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{BTreeSet, HashMap};
use std::path::Path;
use tauri::AppHandle;
use uuid::Uuid;

use crate::ledger_db::resolve_ledger_db_path;
use crate::rules_store::ensure_app_rules_dir_seeded;
use crate::wealth::{wealth_overview_query_at_db_path, WealthOverviewQueryRequest};

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

fn normalize_merchant_key(raw: &str) -> String {
    raw.trim().to_lowercase()
}

fn resolve_display_expense_category(
    db_expense_category: &str,
    merchant: &str,
    merchant_category_overrides: Option<&HashMap<String, String>>,
) -> String {
    if let Some(overrides) = merchant_category_overrides {
        let merchant_key = normalize_merchant_key(merchant);
        if !merchant_key.is_empty() {
            if let Some(mapped) = overrides.get(&merchant_key) {
                let mapped_trimmed = mapped.trim();
                if !mapped_trimmed.is_empty() {
                    return mapped_trimmed.to_string();
                }
            }
        }
    }
    if db_expense_category.trim().is_empty() {
        "待分类".to_string()
    } else {
        db_expense_category.trim().to_string()
    }
}

fn load_merchant_category_overrides(app: &AppHandle) -> Result<HashMap<String, String>, String> {
    let rules_dir = ensure_app_rules_dir_seeded(app)?;
    let merchant_map_path = rules_dir.join("merchant_map.csv");
    if !merchant_map_path.exists() {
        return Ok(HashMap::new());
    }
    let mut reader = ReaderBuilder::new()
        .flexible(true)
        .from_path(&merchant_map_path)
        .map_err(|e| format!("读取商户映射规则失败: {e}"))?;
    let mut rows = HashMap::<String, String>::new();
    for rec in reader.records() {
        let record = rec.map_err(|e| format!("解析商户映射规则失败: {e}"))?;
        let merchant_normalized = record.get(0).unwrap_or_default().trim();
        let expense_category = record.get(1).unwrap_or_default().trim();
        if merchant_normalized.is_empty() || expense_category.is_empty() {
            continue;
        }
        rows.insert(
            normalize_merchant_key(merchant_normalized),
            expense_category.to_string(),
        );
    }
    Ok(rows)
}

fn collect_all_expense_categories(
    conn: &Connection,
    merchant_category_overrides: Option<&HashMap<String, String>>,
) -> Result<Vec<String>, String> {
    let mut category_set = BTreeSet::<String>::new();

    let mut stmt = conn
        .prepare(
            r#"
            SELECT DISTINCT TRIM(name) AS category_name
            FROM categories
            WHERE name IS NOT NULL AND TRIM(name) != ''
            "#,
        )
        .map_err(|e| format!("查询分类候选失败: {e}"))?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| format!("查询分类候选失败: {e}"))?;
    for row in rows {
        let category = row.map_err(|e| format!("读取分类候选失败: {e}"))?;
        let category_trimmed = category.trim();
        if !category_trimmed.is_empty() {
            category_set.insert(category_trimmed.to_string());
        }
    }

    if let Some(overrides) = merchant_category_overrides {
        for mapped in overrides.values() {
            let mapped_trimmed = mapped.trim();
            if !mapped_trimmed.is_empty() {
                category_set.insert(mapped_trimmed.to_string());
            }
        }
    }

    Ok(category_set.into_iter().collect())
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

fn deduped_cmb_pdf_income_cte() -> &'static str {
    r#"
    WITH deduped_income AS (
        SELECT
            COALESCE(month_key, SUBSTR(COALESCE(posted_at, occurred_at), 1, 7)) AS month_key,
            COALESCE(posted_at, occurred_at, '') AS tx_date,
            statement_category,
            COALESCE(NULLIF(TRIM(merchant_normalized), ''), NULLIF(TRIM(merchant), ''), '未知来源') AS employer,
            amount_cents
        FROM transactions
        WHERE source_type = 'cmb_bank_pdf'
          AND direction = 'income'
          AND month_key >= ?1
          AND month_key <= ?2
          AND statement_category IN ('代发工资', '代发住房公积金')
        GROUP BY
            account_id,
            COALESCE(month_key, SUBSTR(COALESCE(posted_at, occurred_at), 1, 7)),
            COALESCE(posted_at, occurred_at, ''),
            amount_cents,
            currency,
            COALESCE(description, ''),
            COALESCE(merchant, ''),
            COALESCE(merchant_normalized, ''),
            COALESCE(statement_category, '')
    )
    "#
}

mod commands;
mod consumption;
mod fire;
mod income;
mod items;
mod overview;
#[cfg(test)]
mod tests;

pub use commands::*;
pub use consumption::*;
pub use fire::*;
pub use income::*;
pub use items::*;
pub use overview::*;
