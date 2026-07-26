use chrono::{Datelike, Duration, NaiveDate};
use rusqlite::{params, Connection};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::Path;
use tauri::AppHandle;

use crate::ledger_db::resolve_ledger_db_path;

const SUPPORTED_PRESETS: &[&str] = &["ytd", "3m", "6m", "1y", "3y", "since_inception", "custom"];

#[derive(Debug, Deserialize)]
pub struct WealthOverviewQueryRequest {
    #[serde(rename = "as_of")]
    pub as_of_date: Option<String>,
    pub include_investment: Option<String>,
    pub include_cash: Option<String>,
    pub include_real_estate: Option<String>,
    pub include_liability: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct WealthCurveQueryRequest {
    pub preset: Option<String>,
    #[serde(rename = "from")]
    pub from_date: Option<String>,
    #[serde(rename = "to")]
    pub to_date: Option<String>,
    pub include_investment: Option<String>,
    pub include_cash: Option<String>,
    pub include_real_estate: Option<String>,
    pub include_liability: Option<String>,
}

#[derive(Debug, Clone)]
struct Window {
    requested_from: NaiveDate,
    effective_from: NaiveDate,
    effective_to: NaiveDate,
    latest: NaiveDate,
}

#[derive(Debug, Clone)]
struct AsOfHistoryRow {
    account_id: String,
    snapshot_date: NaiveDate,
    value_cents: i64,
    flow_cents: i64,
}

#[derive(Debug, Clone)]
struct OverviewItemRow {
    account_id: String,
    account_name: String,
    snapshot_date: NaiveDate,
    value_cents: i64,
}

#[derive(Debug, Clone)]
struct AssetValuationRow {
    account_id: String,
    account_name: String,
    asset_class: String,
    snapshot_date: NaiveDate,
    value_cents: i64,
}

#[derive(Debug, Clone, Copy)]
struct WealthFilters {
    include_investment: bool,
    include_cash: bool,
    include_real_estate: bool,
    include_liability: bool,
}

fn parse_iso_date(raw: &str, field_name: &str) -> Result<NaiveDate, String> {
    let text = raw.trim();
    if text.is_empty() {
        return Err(format!("缺少字段: {field_name}"));
    }
    NaiveDate::parse_from_str(text, "%Y-%m-%d")
        .map_err(|_| format!("{field_name} 日期格式必须为 YYYY-MM-DD"))
}

fn cents_to_yuan_text(cents: i64) -> String {
    format!("{:.2}", cents as f64 / 100.0)
}

fn round_to(value: f64, digits: i32) -> f64 {
    let factor = 10_f64.powi(digits);
    (value * factor).round() / factor
}

fn parse_preset_with_default(raw: Option<&str>, default_preset: &str) -> Result<String, String> {
    let preset = raw.unwrap_or(default_preset).trim().to_lowercase();
    let preset = if preset.is_empty() {
        default_preset.to_string()
    } else {
        preset
    };
    if SUPPORTED_PRESETS.iter().any(|x| *x == preset) {
        Ok(preset)
    } else {
        Err(format!(
            "preset 不支持: {preset}，可选 {}",
            SUPPORTED_PRESETS.join(", ")
        ))
    }
}

fn resolve_window(
    preset: &str,
    from_raw: &str,
    to_raw: &str,
    earliest: NaiveDate,
    latest: NaiveDate,
) -> Result<Window, String> {
    if latest < earliest {
        return Err("无可用时间范围".to_string());
    }

    let requested_to = if to_raw.trim().is_empty() {
        latest
    } else {
        parse_iso_date(to_raw, "to")?
    };
    let effective_to = if requested_to < latest {
        requested_to
    } else {
        latest
    };
    if effective_to < earliest {
        return Err("结束日期早于最早可用记录".to_string());
    }

    let requested_from = match preset {
        "custom" => parse_iso_date(from_raw, "from")?,
        "ytd" => NaiveDate::from_ymd_opt(effective_to.year(), 1, 1).ok_or("无效 ytd 日期范围")?,
        "3m" => effective_to - Duration::days(90),
        "6m" => effective_to - Duration::days(180),
        "1y" => effective_to - Duration::days(365),
        "3y" => effective_to - Duration::days(365 * 3),
        "since_inception" => earliest,
        _ => return Err(format!("preset 不支持: {preset}")),
    };

    let effective_from = if requested_from > earliest {
        requested_from
    } else {
        earliest
    };
    if effective_from > effective_to {
        return Err("起始日期晚于结束日期".to_string());
    }

    Ok(Window {
        requested_from,
        effective_from,
        effective_to,
        latest,
    })
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

fn parse_wealth_filters(
    include_investment: Option<&str>,
    include_cash: Option<&str>,
    include_real_estate: Option<&str>,
    include_liability: Option<&str>,
) -> Result<WealthFilters, String> {
    let filters = WealthFilters {
        include_investment: parse_bool_param(include_investment, true)?,
        include_cash: parse_bool_param(include_cash, true)?,
        include_real_estate: parse_bool_param(include_real_estate, true)?,
        include_liability: parse_bool_param(include_liability, true)?,
    };
    if !(filters.include_investment
        || filters.include_cash
        || filters.include_real_estate
        || filters.include_liability)
    {
        return Err("至少需要选择一个资产类型".to_string());
    }
    Ok(filters)
}

fn build_asof_totals(dates: &[NaiveDate], history_rows: &[AsOfHistoryRow]) -> HashMap<String, i64> {
    let mut totals = HashMap::<String, i64>::new();
    for d in dates {
        totals.insert(d.format("%Y-%m-%d").to_string(), 0);
    }

    let mut by_account: HashMap<String, Vec<&AsOfHistoryRow>> = HashMap::new();
    for row in history_rows {
        by_account
            .entry(row.account_id.clone())
            .or_default()
            .push(row);
    }

    for series in by_account.values_mut() {
        series.sort_by_key(|r| r.snapshot_date);
        let mut idx = 0usize;
        let mut current = 0_i64;
        for d in dates {
            while idx < series.len() && series[idx].snapshot_date <= *d {
                let raw_value = series[idx].value_cents;
                let flow_cents = series[idx].flow_cents;
                if raw_value == 0 && flow_cents != 0 && current > 0 {
                    // Compatibility with Python importer behavior when only flow is present.
                } else {
                    current = raw_value;
                }
                idx += 1;
            }
            let key = d.format("%Y-%m-%d").to_string();
            if let Some(total) = totals.get_mut(&key) {
                *total += current;
            }
        }
    }
    totals
}

fn query_latest_union_date(conn: &Connection) -> Result<Option<NaiveDate>, String> {
    let row = conn
        .query_row(
            r#"
            SELECT MAX(snapshot_date) AS max_date
            FROM (
                SELECT snapshot_date FROM investment_records
                UNION ALL
                SELECT snapshot_date FROM account_valuations
            )
            "#,
            [],
            |row| row.get::<_, Option<String>>(0),
        )
        .map_err(|e| format!("查询最大日期失败: {e}"))?;
    row.map(|s| parse_iso_date(&s, "max_date")).transpose()
}

fn query_union_bounds(conn: &Connection) -> Result<Option<(NaiveDate, NaiveDate)>, String> {
    let row = conn
        .query_row(
            r#"
            SELECT
                MIN(snapshot_date) AS min_date,
                MAX(snapshot_date) AS max_date
            FROM (
                SELECT snapshot_date FROM investment_records
                UNION ALL
                SELECT snapshot_date FROM account_valuations
            )
            "#,
            [],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, Option<String>>(1)?,
                ))
            },
        )
        .map_err(|e| format!("查询日期边界失败: {e}"))?;
    let (min_raw, max_raw) = row;
    match (min_raw, max_raw) {
        (Some(min_raw), Some(max_raw)) => Ok(Some((
            parse_iso_date(&min_raw, "min_date")?,
            parse_iso_date(&max_raw, "max_date")?,
        ))),
        _ => Ok(None),
    }
}

mod commands;
mod curve;
mod overview;

pub use commands::*;
pub use curve::*;
pub use overview::*;
