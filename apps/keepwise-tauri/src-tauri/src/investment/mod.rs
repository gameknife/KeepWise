use chrono::{Datelike, Duration, NaiveDate};
use reqwest::blocking::Client;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap};
use std::path::Path;
use std::time::Duration as StdDuration;
use tauri::AppHandle;
use url::Url;

use crate::ledger_db::resolve_ledger_db_path;

const PORTFOLIO_ACCOUNT_ID: &str = "__portfolio__";
const PORTFOLIO_ACCOUNT_NAME: &str = "全部投资账户（组合）";
const SUPPORTED_PRESETS: &[&str] = &["ytd", "3m", "6m", "1y", "3y", "since_inception", "custom"];
const YAHOO_FINANCE_SOURCE_NAME: &str = "Yahoo Finance";
const EASTMONEY_SOURCE_NAME: &str = "东方财富";

#[derive(Debug, Clone, Copy)]
struct BenchmarkSpec {
    key: &'static str,
    label: &'static str,
    symbol: &'static str,
    eastmoney_secid: &'static str,
}

const BENCHMARK_SPECS: &[BenchmarkSpec] = &[
    BenchmarkSpec {
        key: "sse",
        label: "上证指数",
        symbol: "000001.SS",
        eastmoney_secid: "1.000001",
    },
    BenchmarkSpec {
        key: "hsi",
        label: "恒生指数",
        symbol: "^HSI",
        eastmoney_secid: "100.HSI",
    },
    BenchmarkSpec {
        key: "sp500",
        label: "标普500",
        symbol: "^GSPC",
        eastmoney_secid: "100.SPX",
    },
];

#[derive(Debug, Deserialize)]
pub struct InvestmentReturnQueryRequest {
    pub account_id: String,
    pub preset: Option<String>,
    #[serde(rename = "from")]
    pub from_date: Option<String>,
    #[serde(rename = "to")]
    pub to_date: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct InvestmentCurveQueryRequest {
    pub account_id: String,
    pub preset: Option<String>,
    #[serde(rename = "from")]
    pub from_date: Option<String>,
    #[serde(rename = "to")]
    pub to_date: Option<String>,
    pub benchmark_source: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct InvestmentReturnsQueryRequest {
    pub preset: Option<String>,
    #[serde(rename = "from")]
    pub from_date: Option<String>,
    #[serde(rename = "to")]
    pub to_date: Option<String>,
    pub keyword: Option<String>,
    pub limit: Option<u32>,
}

pub fn investment_return_query_at_db_path(
    db_path: &Path,
    req: InvestmentReturnQueryRequest,
) -> Result<Value, String> {
    let account_id = req.account_id.trim().to_string();
    if account_id.is_empty() {
        return Err("account_id 必填".to_string());
    }
    let preset = parse_preset(req.preset.as_deref())?;
    let from_raw = req.from_date.unwrap_or_default();
    let to_raw = req.to_date.unwrap_or_default();

    let conn = Connection::open(db_path).map_err(|e| format!("打开数据库失败: {e}"))?;

    if account_id == PORTFOLIO_ACCOUNT_ID {
        build_portfolio_investment_return_payload(&conn, &preset, &from_raw, &to_raw)
    } else {
        build_single_account_investment_return_payload(
            &conn,
            &account_id,
            &preset,
            &from_raw,
            &to_raw,
        )
    }
}

#[derive(Debug, Clone)]
struct Window {
    requested_from: NaiveDate,
    effective_from: NaiveDate,
    effective_to: NaiveDate,
    latest: NaiveDate,
}

#[derive(Debug)]
struct TransferRow {
    snapshot_date: NaiveDate,
    transfer_amount_cents: i64,
}

#[derive(Debug)]
struct ModifiedDietzCalc {
    interval_days: i64,
    net_flow_cents: i64,
    profit_cents: i64,
    weighted_capital_cents: i64,
    return_rate: Option<f64>,
    annualized_rate: Option<f64>,
    note: String,
    cash_flows: Vec<Value>,
}

#[derive(Debug)]
struct AccountBounds {
    account_name: String,
    earliest: NaiveDate,
    latest: NaiveDate,
}

#[derive(Debug)]
struct SnapshotRow {
    snapshot_date: NaiveDate,
    total_assets_cents: i64,
}

#[derive(Debug)]
struct PortfolioBounds {
    earliest: NaiveDate,
    latest: NaiveDate,
    account_count: i64,
}

#[derive(Debug)]
struct PortfolioHistoryRow {
    account_id: String,
    snapshot_date: NaiveDate,
    value_cents: i64,
    flow_cents: i64,
}

#[derive(Debug, Clone)]
struct TransferDetail {
    account_id: String,
    account_name: String,
    transfer_amount_cents: i64,
}

#[derive(Debug, Clone)]
struct BenchmarkHistoryRow {
    market_date: NaiveDate,
    close: f64,
}

#[derive(Debug, Clone)]
struct CurveAnchorRow {
    snapshot_date: NaiveDate,
    effective_snapshot_date: NaiveDate,
    total_assets_cents: i64,
    transfer_amount_cents: i64,
    transfer_details: Vec<TransferDetail>,
    cumulative_net_growth_cents: i64,
    cumulative_return_rate: Option<f64>,
    is_observed: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BenchmarkMarketDataSource {
    Eastmoney,
    Yahoo,
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

mod benchmark;
mod commands;
mod curve;
mod curve_queries;
mod repository;
mod returns;
mod returns_list;
#[cfg(test)]
mod tests;

use benchmark::*;
pub use commands::*;
use curve::*;
pub use curve_queries::*;
use repository::*;
use returns::*;
pub use returns_list::*;
