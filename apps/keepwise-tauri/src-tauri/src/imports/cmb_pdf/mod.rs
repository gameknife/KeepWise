use chrono::{SecondsFormat, Utc};
use pdf_extract::extract_text;
use regex::Regex;
use rusqlite::{params, Connection};
use serde::Deserialize;
use serde_json::{json, Value};
use sha1::{Digest, Sha1};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::Path;
#[cfg(test)]
use std::path::PathBuf;
use std::sync::OnceLock;
use tauri::AppHandle;
use uuid::Uuid;

use crate::imports::resolve_review_threshold;
use crate::ledger_db::resolve_ledger_db_path;
use crate::rules_store::ensure_app_rules_dir_seeded;

const DEFAULT_SOURCE_TYPE: &str = "cmb_bank_pdf";
const DEFAULT_REVIEW_THRESHOLD: f64 = 0.70;
const MANUAL_TX_EXCLUDE_REASON_PREFIX: &str = "[manual_tx_exclude]";

const SUMMARY_PREFIXES: &[&str] = &[
    "代发住房公积金",
    "信用卡自动还款",
    "本行ATM无卡取款",
    "一网通支付鼓励金",
    "结售汇即时售汇",
    "结售汇即时结汇",
    "基金快速赎回",
    "基金申购",
    "基金赎回",
    "基金认购",
    "行内转账转入",
    "行内转账转出",
    "朝朝宝转入",
    "朝朝宝转出",
    "国际结算解付款项",
    "银联无卡自助消费",
    "银联快捷支付",
    "信用卡还款",
    "转账汇款",
    "个贷交易",
    "个贷放款",
    "账户结息",
    "快捷退款",
    "快捷支付",
    "银联消费",
    "银联代付",
    "汇入汇款",
    "代发工资",
    "转出到分仓",
    "转入到分仓",
    "从分仓转入",
    "基金退款",
    "即时委托",
    "分红",
    "强赎",
    "还本",
    "申购",
    "赎回",
];

const INVESTMENT_OR_FX_SUMMARIES: &[&str] = &[
    "基金申购",
    "基金赎回",
    "基金快速赎回",
    "基金认购",
    "基金退款",
    "申购",
    "赎回",
    "朝朝宝转入",
    "朝朝宝转出",
    "转出到分仓",
    "转入到分仓",
    "从分仓转入",
    "分红",
    "强赎",
    "还本",
    "即时委托",
    "国际结算解付款项",
    "结售汇即时售汇",
    "结售汇即时结汇",
];

const SKIP_SUMMARIES_EXTRA: &[&str] = &[
    "信用卡自动还款",
    "信用卡还款",
    "个贷放款",
    "汇入汇款",
    "行内转账转入",
    "账户结息",
    "一网通支付鼓励金",
    "快捷退款",
    "银联代付",
];

const DEBIT_PAYMENT_SUMMARIES: &[&str] =
    &["快捷支付", "银联快捷支付", "银联消费", "银联无卡自助消费"];
const QUICKPAY_PERSON_DETECTION_SUMMARIES: &[&str] = &["快捷支付", "银联快捷支付"];
const BANK_TRANSFER_OUT_SUMMARIES: &[&str] = &["转账汇款", "行内转账转出"];
const WECHAT_TRANSFER_PREFIXES: &[&str] = &["微信转账", "微信红包"];
const DEFAULT_PERSONAL_TRANSFER_WHITELIST: &[&str] = &["徐凯"];

#[derive(Debug, Deserialize)]
pub struct CmbBankPdfPreviewRequest {
    pub source_path: Option<String>,
    pub review_threshold: Option<f64>,
}

#[derive(Debug, Deserialize)]
pub struct CmbBankPdfImportRequest {
    pub source_path: Option<String>,
    pub review_threshold: Option<f64>,
    pub source_type: Option<String>,
}

#[allow(dead_code)]
#[derive(Debug, Clone)]
struct PdfHeader {
    account_last4: String,
    range_start: String,
    range_end: String,
}

#[allow(dead_code)]
#[derive(Debug, Clone)]
struct BankPdfTransaction {
    page: i64,
    date: String,
    currency: String,
    amount_text: String,
    amount_cents: i64,
    balance_text: String,
    raw_detail: String,
    summary: String,
    counterparty: String,
}

#[allow(dead_code)]
#[derive(Debug, Clone)]
struct ClassifiedPdfRow {
    tx: BankPdfTransaction,
    include_in_import: bool,
    include_in_expense_analysis: bool,
    rule_tag: String,
    expense_category: String,
    direction: String,
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
struct MortgageProfile {
    count: usize,
    median_abs_amount_cents: i64,
    fixed_threshold_cents: i64,
}

fn account_no_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"账号[:：]\s*([0-9]{8,})").expect("account regex"))
}

fn date_range_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(\d{4}-\d{2}-\d{2})\s*--\s*(\d{4}-\d{2}-\d{2})").expect("range regex")
    })
}

fn row_start_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"^(\d{4}-\d{2}-\d{2})\s+([A-Z]{3})\s+([+-]?\d[\d,]*\.\d{2})\s+(\d[\d,]*\.\d{2})\s+(.*)$")
            .expect("row start regex")
    })
}

fn person_name_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^([\u4e00-\u9fa5]{2,4})(?:\s+\d{6,}|\b)").expect("person regex"))
}

fn loan_id_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(\d{16,})$").expect("loan id regex"))
}

fn rate_suffix_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\s*汇率\s*\d+(?:\.\d+)?\s*$").expect("rate regex"))
}

fn channel_prefix_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r"^(?:支付宝|财付通|京东支付|云闪付|微信支付|银联|掌上生活|手机银行|美团支付|抖音支付|Apple\.com/bill)[-－—_:：\s]*",
        )
        .expect("channel regex")
    })
}

fn ws_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\s+").expect("ws regex"))
}

fn parse_amount_to_cents(raw: &str) -> Result<i64, String> {
    let mut s = raw.trim().replace(',', "");
    if s.is_empty() {
        return Ok(0);
    }
    s = s.replace('￥', "").replace('¥', "").replace('元', "");
    let negative = s.starts_with('-');
    if s.starts_with('-') || s.starts_with('+') {
        s = s[1..].to_string();
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
    if !frac_part.chars().all(|c| c.is_ascii_digit()) || frac_part.len() > 2 {
        return Err("金额格式不合法".to_string());
    }
    let int_val = int_part
        .parse::<i64>()
        .map_err(|_| "金额超范围".to_string())?;
    let frac_val = match frac_part.len() {
        0 => 0,
        1 => {
            frac_part
                .parse::<i64>()
                .map_err(|_| "金额格式不合法".to_string())?
                * 10
        }
        2 => frac_part
            .parse::<i64>()
            .map_err(|_| "金额格式不合法".to_string())?,
        _ => 0,
    };
    let mut cents = int_val
        .checked_mul(100)
        .and_then(|v| v.checked_add(frac_val))
        .ok_or_else(|| "金额超范围".to_string())?;
    if negative {
        cents = -cents;
    }
    Ok(cents)
}

fn normalize_line(raw: &str) -> String {
    ws_re().replace_all(raw.trim(), " ").trim().to_string()
}

fn normalize_counterparty(text: &str) -> String {
    normalize_line(text)
}

fn normalize_merchant(text: &str) -> String {
    let mut merchant = normalize_line(text);
    merchant = rate_suffix_re().replace(&merchant, "").trim().to_string();
    if let Some(rest) = merchant.strip_prefix("ULT-") {
        merchant = rest.trim().to_string();
    }
    loop {
        let next = channel_prefix_re()
            .replace(&merchant, "")
            .trim()
            .to_string();
        if next == merchant {
            break;
        }
        merchant = next;
    }
    merchant
}

fn resolve_source_path_text(raw: Option<String>) -> Result<String, String> {
    let s = raw.unwrap_or_default().trim().to_string();
    if s.is_empty() {
        return Err("source_path 必填（PDF 文件路径）".to_string());
    }
    Ok(s)
}

mod classifier;
mod commands;
mod operations;
mod parser;
mod persistence;
mod service;
#[cfg(test)]
mod tests;

use classifier::*;
pub use commands::*;
use operations::*;
use parser::*;
use persistence::*;
use service::*;
