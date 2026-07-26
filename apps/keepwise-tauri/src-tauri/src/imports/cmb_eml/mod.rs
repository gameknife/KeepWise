use chrono::{SecondsFormat, Utc};
use mailparse::{parse_mail, ParsedMail};
use regex::Regex;
use rusqlite::{params, Connection};
use scraper::{Html, Selector};
use serde::Deserialize;
use serde_json::{json, Value};
use sha1::{Digest, Sha1};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use tauri::AppHandle;
use uuid::Uuid;
use walkdir::WalkDir;

use crate::imports::resolve_review_threshold;
use crate::ledger_db::resolve_ledger_db_path;
use crate::rules_store::ensure_app_rules_dir_seeded;

const DEFAULT_SOURCE_TYPE: &str = "cmb_eml";
const DEFAULT_REVIEW_THRESHOLD: f64 = 0.70;
const MANUAL_TX_EXCLUDE_REASON_PREFIX: &str = "[manual_tx_exclude]";

const HEADER_KEYWORDS: [&str; 4] = ["交易日", "记账日", "交易摘要", "人民币金额"];
const STATEMENT_CATEGORIES: [&str; 9] = [
    "消费",
    "还款",
    "分期",
    "取现",
    "费用",
    "利息",
    "调账",
    "其他",
    "未分类",
];

#[derive(Debug, Deserialize)]
pub struct CmbEmlPreviewRequest {
    pub source_path: Option<String>,
    pub review_threshold: Option<f64>,
}

#[derive(Debug, Deserialize)]
pub struct CmbEmlImportRequest {
    pub source_path: Option<String>,
    pub review_threshold: Option<f64>,
    pub source_type: Option<String>,
}

#[derive(Debug, Clone)]
struct ParsedEmlTransaction {
    source_file: String,
    source_path: String,
    source_row_index: usize,
    statement_year: i32,
    statement_month: u32,
    statement_category: String,
    trans_date: String,
    post_date: String,
    description: String,
    amount_cents: i64,
    card_last4: String,
    original_amount: String,
    country_area: String,
}

#[derive(Debug, Clone)]
struct ClassifiedTransaction {
    txn: ParsedEmlTransaction,
    merchant_normalized: String,
    expense_category: String,
    classify_source: String,
    confidence: f64,
    needs_review: i64,
    excluded_in_analysis: i64,
    exclude_reason: String,
}

#[derive(Debug, Clone)]
struct CategoryRule {
    priority: i64,
    match_type: String,
    pattern: String,
    expense_category: String,
    confidence: f64,
}

#[derive(Debug, Clone)]
struct AnalysisExclusionRule {
    rule_name: String,
    merchant_contains: String,
    description_contains: String,
    expense_category: String,
    min_amount_cents: Option<i64>,
    max_amount_cents: Option<i64>,
    start_date: String,
    end_date: String,
    reason: String,
}

#[derive(Debug, Default, Clone)]
struct PreviewSummary {
    input_files_count: usize,
    records_count: usize,
    consume_count: usize,
    needs_review_count: usize,
    excluded_count: usize,
    failed_files_count: usize,
    failed_files: Vec<Value>,
    preview_rows: Vec<Value>,
}

fn ws_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\s+").expect("invalid ws regex"))
}

fn year_month_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"您(\d{4})年(\d{1,2})月信用卡账单已出").expect("invalid ym regex")
    })
}

fn amount_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"[-+]?\d[\d,]*(?:\.\d+)?").expect("invalid amount regex"))
}

fn rate_suffix_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"\s*汇率\s*\d+(?:\.\d+)?\s*$").expect("invalid rate suffix regex")
    })
}

fn channel_prefix_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r"^(?:支付宝|财付通|京东支付|云闪付|微信支付|银联|掌上生活|手机银行|美团支付|抖音支付|Apple\.com/bill)[-－—_:：\s]*",
        )
        .expect("invalid channel prefix regex")
    })
}

fn card_last4_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\d{4}").expect("invalid card last4 regex"))
}

fn tr_selector() -> &'static Selector {
    static SEL: OnceLock<Selector> = OnceLock::new();
    SEL.get_or_init(|| Selector::parse("tr").expect("invalid tr selector"))
}

fn stat_category_set() -> &'static HashSet<&'static str> {
    static SET: OnceLock<HashSet<&'static str>> = OnceLock::new();
    SET.get_or_init(|| STATEMENT_CATEGORIES.into_iter().collect())
}

fn trim_text(s: &str) -> String {
    ws_re().replace_all(s.trim(), " ").trim().to_string()
}

fn resolve_source_path_text(raw: Option<String>) -> Result<String, String> {
    let path = raw.unwrap_or_default().trim().to_string();
    if path.is_empty() {
        return Err("source_path 必填（可为 .eml 文件或包含 .eml 的目录）".to_string());
    }
    Ok(path)
}

mod commands;
mod operations;
mod parser;
mod persistence;
mod rules;
mod service;
#[cfg(test)]
mod tests;

pub use commands::*;
use operations::*;
use parser::*;
use persistence::*;
use rules::*;
use service::*;
