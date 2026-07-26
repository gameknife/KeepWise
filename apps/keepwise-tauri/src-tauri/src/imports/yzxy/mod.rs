use calamine::{open_workbook_auto, Reader};
use chrono::{Duration, NaiveDate, SecondsFormat, Utc};
use rusqlite::{params, Connection};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::Path;
use tauri::AppHandle;
use uuid::Uuid;

use crate::ledger_db::resolve_ledger_db_path;

const DEFAULT_SOURCE_TYPE: &str = "youzhiyouxing_export";

#[derive(Debug, Clone)]
struct ParsedInvestmentRow {
    snapshot_date: String,
    account_name: String,
    total_assets_cents: i64,
    transfer_amount_cents: i64,
}

#[derive(Debug)]
struct ParseInputFileResult {
    rows: Vec<ParsedInvestmentRow>,
    errors: Vec<String>,
    mapping: BTreeMap<String, String>,
    parser_kind: String,
}

#[derive(Debug, Default)]
struct Bucket {
    account_name: String,
    total_assets_cents: i64,
    transfer_amount_cents: i64,
    has_total_assets: bool,
}

#[derive(Debug, Deserialize)]
pub struct YzxyPreviewRequest {
    pub source_path: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct YzxyImportRequest {
    pub source_path: Option<String>,
    pub source_type: Option<String>,
}

#[derive(Debug)]
struct AliasSpec {
    field: &'static str,
    aliases: &'static [&'static str],
}

const SUMMARY_ALIAS_SPECS: &[AliasSpec] = &[
    AliasSpec {
        field: "snapshot_date",
        aliases: &["日期", "快照日期", "记录日期", "date", "记账时间"],
    },
    AliasSpec {
        field: "account_name",
        aliases: &[
            "账户",
            "账户名称",
            "组合",
            "组合名称",
            "account",
            "accountname",
        ],
    },
    AliasSpec {
        field: "total_assets",
        aliases: &[
            "总资产",
            "总资产(元)",
            "资产总额",
            "市值",
            "totalassets",
            "总资产金额",
        ],
    },
    AliasSpec {
        field: "transfer_amount",
        aliases: &[
            "转入转出金额",
            "资金进出金额",
            "净转入金额",
            "转入转出",
            "transfer",
        ],
    },
    AliasSpec {
        field: "external_in",
        aliases: &["外部转入", "外部入金", "净转入(入)", "externalin"],
    },
    AliasSpec {
        field: "external_out",
        aliases: &["外部转出", "外部出金", "净转入(出)", "externalout"],
    },
];

const MANUAL_ALIAS_SPECS: &[AliasSpec] = &[
    AliasSpec {
        field: "record_type",
        aliases: &["记录类型", "type"],
    },
    AliasSpec {
        field: "snapshot_date",
        aliases: &["记账时间", "日期", "记录日期", "date"],
    },
    AliasSpec {
        field: "transfer_amount",
        aliases: &["转入转出金额", "资金进出金额", "转入转出", "净转入金额"],
    },
    AliasSpec {
        field: "total_assets",
        aliases: &["总资产金额", "总资产", "总资产(元)", "市值"],
    },
    AliasSpec {
        field: "account_name",
        aliases: &["账户", "账户名称", "组合", "组合名称"],
    },
];

fn trim_cell(text: &str) -> String {
    text.trim()
        .trim_start_matches('\u{feff}')
        .trim()
        .to_string()
}

fn normalize_key(key: &str) -> String {
    trim_cell(key)
        .to_lowercase()
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect()
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

fn parse_ymd_parts(text: &str) -> Option<(i32, u32, u32)> {
    let parts = text.split('-').collect::<Vec<_>>();
    if parts.len() != 3 {
        return None;
    }
    let year = parts[0].parse::<i32>().ok()?;
    let month = parts[1].parse::<u32>().ok()?;
    let day = parts[2].parse::<u32>().ok()?;
    Some((year, month, day))
}

fn normalize_date(raw: &str) -> Result<String, String> {
    let text = trim_cell(raw).replace('/', "-").replace('.', "-");
    if text.is_empty() {
        return Err("缺少日期字段".to_string());
    }

    let first_token = text
        .split([' ', 'T'])
        .next()
        .map(trim_cell)
        .unwrap_or_default();
    if let Some((year, month, day)) = parse_ymd_parts(&first_token) {
        if NaiveDate::from_ymd_opt(year, month, day).is_some() {
            return Ok(format!("{year:04}-{month:02}-{day:02}"));
        }
    }

    Err(format!("日期格式不支持: {raw}"))
}

fn normalize_date_flexible(raw: &str) -> Result<String, String> {
    let text = trim_cell(raw);
    if text.is_empty() {
        return Err("缺少日期字段".to_string());
    }
    if let Ok(date) = normalize_date(&text) {
        return Ok(date);
    }

    let number = text
        .parse::<f64>()
        .map_err(|_| format!("日期格式不支持: {raw}"))?;
    if !(number.is_finite()) || number <= 0.0 {
        return Err(format!("日期格式不支持: {raw}"));
    }
    let days = number.floor() as i64;
    let base =
        NaiveDate::from_ymd_opt(1899, 12, 30).ok_or_else(|| "内部日期基准错误".to_string())?;
    let date = base
        .checked_add_signed(Duration::days(days))
        .ok_or_else(|| format!("日期格式不支持: {raw}"))?;
    Ok(date.format("%Y-%m-%d").to_string())
}

fn row_get(row: &[String], idx: Option<usize>) -> String {
    idx.and_then(|i| row.get(i).cloned())
        .map(|s| trim_cell(&s))
        .unwrap_or_default()
}

fn resolve_alias_mapping_from_row(row: &[String], specs: &[AliasSpec]) -> HashMap<String, usize> {
    let mut normalized: HashMap<String, usize> = HashMap::new();
    for (idx, cell) in row.iter().enumerate() {
        let key = normalize_key(cell);
        if !key.is_empty() {
            normalized.entry(key).or_insert(idx);
        }
    }

    let mut mapping = HashMap::new();
    for spec in specs {
        for alias in spec.aliases {
            let key = normalize_key(alias);
            if let Some(idx) = normalized.get(&key) {
                mapping.insert(spec.field.to_string(), *idx);
                break;
            }
        }
    }
    mapping
}

fn find_header_row(
    rows: &[Vec<String>],
    specs: &[AliasSpec],
    required: &[&str],
) -> Result<(usize, HashMap<String, usize>), String> {
    'outer: for (idx, row) in rows.iter().enumerate() {
        let mapping = resolve_alias_mapping_from_row(row, specs);
        for req in required {
            if !mapping.contains_key(*req) {
                continue 'outer;
            }
        }
        return Ok((idx, mapping));
    }
    Err(format!("未找到必要表头: {}", required.join(", ")))
}

fn extract_account_name_hint(rows: &[Vec<String>], fallback: &str) -> String {
    let target_keys: HashSet<String> = ["账户名称", "账户"]
        .iter()
        .map(|s| normalize_key(s))
        .collect();

    for i in 0..rows.len().saturating_sub(1) {
        let row = &rows[i];
        let next_row = &rows[i + 1];
        for (j, cell) in row.iter().enumerate() {
            if target_keys.contains(&normalize_key(cell)) {
                if let Some(candidate) = next_row.get(j) {
                    let candidate = trim_cell(candidate);
                    if !candidate.is_empty() {
                        return candidate;
                    }
                }
            }
        }
    }

    fallback.to_string()
}

mod commands;
mod operations;
mod parser;
mod persistence;
#[cfg(test)]
mod tests;

pub use commands::*;
use operations::*;
use parser::*;
use persistence::*;
