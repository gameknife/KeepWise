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

use crate::ledger_db::resolve_ledger_db_path;
use crate::rules_store::ensure_app_rules_dir_seeded;
#[cfg(test)]
use crate::rules_store::resolve_repo_rules_dir;

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

#[cfg(test)]
fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..")
}

fn resolve_source_path_text(raw: Option<String>) -> Result<String, String> {
    let path = raw.unwrap_or_default().trim().to_string();
    if path.is_empty() {
        return Err("source_path 必填（可为 .eml 文件或包含 .eml 的目录）".to_string());
    }
    Ok(path)
}

fn resolve_review_threshold(raw: Option<f64>) -> Result<f64, String> {
    let v = raw.unwrap_or(DEFAULT_REVIEW_THRESHOLD);
    if !(0.0..=1.0).contains(&v) {
        return Err("review_threshold 必须在 0~1 之间".to_string());
    }
    Ok(v)
}

fn collect_eml_files(input_path: &Path) -> Result<(Vec<PathBuf>, PathBuf), String> {
    if !input_path.exists() {
        return Err(format!("未找到路径: {}", input_path.to_string_lossy()));
    }
    if input_path.is_file() {
        let is_eml = input_path
            .extension()
            .and_then(|s| s.to_str())
            .map(|s| s.eq_ignore_ascii_case("eml"))
            .unwrap_or(false);
        if !is_eml {
            return Err("仅支持 .eml 文件或包含 .eml 的目录".to_string());
        }
        let root = input_path
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from("."));
        return Ok((vec![input_path.to_path_buf()], root));
    }
    if !input_path.is_dir() {
        return Err(format!(
            "不支持的路径类型: {}",
            input_path.to_string_lossy()
        ));
    }

    let mut files = WalkDir::new(input_path)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .map(|e| e.into_path())
        .filter(|p| {
            p.extension()
                .and_then(|s| s.to_str())
                .map(|s| s.eq_ignore_ascii_case("eml"))
                .unwrap_or(false)
        })
        .collect::<Vec<_>>();
    files.sort();
    if files.is_empty() {
        return Err("没有可解析的 .eml 文件".to_string());
    }
    Ok((files, input_path.to_path_buf()))
}

fn extract_best_body(mail: &ParsedMail) -> Option<String> {
    fn walk(mail: &ParsedMail, want_html: bool) -> Option<String> {
        let mime = mail.ctype.mimetype.to_ascii_lowercase();
        if (want_html && mime == "text/html") || (!want_html && mime == "text/plain") {
            if let Ok(body) = mail.get_body() {
                return Some(body);
            }
        }
        for part in &mail.subparts {
            if let Some(body) = walk(part, want_html) {
                return Some(body);
            }
        }
        None
    }

    walk(mail, true).or_else(|| walk(mail, false))
}

fn extract_table_rows(html: &str) -> Vec<Vec<String>> {
    let doc = Html::parse_document(html);
    let mut rows = Vec::new();
    for tr in doc.select(tr_selector()) {
        let row = tr
            .children()
            .filter_map(scraper::ElementRef::wrap)
            .filter(|cell| {
                let name = cell.value().name();
                name.eq_ignore_ascii_case("td") || name.eq_ignore_ascii_case("th")
            })
            .map(|cell| trim_text(&cell.text().collect::<Vec<_>>().join(" ")))
            .collect::<Vec<_>>();
        if row.iter().any(|c| !c.is_empty()) {
            rows.push(row);
        }
    }
    rows
}

fn parse_statement_year_month(rows: &[Vec<String>]) -> Result<(i32, u32), String> {
    for row in rows {
        let text = row.join(" ");
        if let Some(caps) = year_month_re().captures(&text) {
            let year = caps
                .get(1)
                .and_then(|m| m.as_str().parse::<i32>().ok())
                .ok_or_else(|| "无法识别账单年份".to_string())?;
            let month = caps
                .get(2)
                .and_then(|m| m.as_str().parse::<u32>().ok())
                .ok_or_else(|| "无法识别账单月份".to_string())?;
            return Ok((year, month));
        }
    }
    Err("无法识别账单年月。".to_string())
}

fn find_transaction_header_index(rows: &[Vec<String>]) -> Result<usize, String> {
    for (idx, row) in rows.iter().enumerate() {
        let line = row.join(" ");
        if HEADER_KEYWORDS.iter().all(|kw| line.contains(kw)) {
            return Ok(idx);
        }
    }
    Err("未找到交易明细表头。".to_string())
}

fn parse_amount_to_cents_from_text(raw: &str) -> Option<i64> {
    let stripped = raw.replace('¥', "").replace('￥', "");
    let m = amount_re().find(&stripped)?;
    parse_amount_text_to_cents(m.as_str()).ok()
}

fn parse_amount_text_to_cents(raw: &str) -> Result<i64, String> {
    let mut s = raw.trim().replace(',', "");
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

fn normalize_mmdd(mmdd: &str, statement_year: i32, statement_month: u32) -> String {
    let text = mmdd.trim();
    if text.len() != 4 || !text.chars().all(|c| c.is_ascii_digit()) {
        return String::new();
    }
    let month = text[0..2].parse::<u32>().ok();
    let day = text[2..4].parse::<u32>().ok();
    let (month, day) = match (month, day) {
        (Some(m), Some(d)) => (m, d),
        _ => return String::new(),
    };
    let year = if month > statement_month {
        statement_year - 1
    } else {
        statement_year
    };
    chrono::NaiveDate::from_ymd_opt(year, month, day)
        .map(|d| d.format("%Y-%m-%d").to_string())
        .unwrap_or_default()
}

fn extract_card_last4(raw: &str) -> Option<String> {
    let text = trim_text(raw);
    if text.is_empty() {
        return None;
    }
    if text.chars().all(|c| c.is_ascii_digit()) && text.len() == 4 {
        return Some(text);
    }
    card_last4_re()
        .find_iter(&text)
        .last()
        .map(|m| m.as_str().to_string())
}

fn parse_single_eml(path: &Path, root_for_rel: &Path) -> Result<Vec<ParsedEmlTransaction>, String> {
    let bytes = fs::read(path).map_err(|e| format!("读取 eml 失败: {e}"))?;
    let mail = parse_mail(&bytes).map_err(|e| format!("解析 eml MIME 失败: {e}"))?;
    let body =
        extract_best_body(&mail).ok_or_else(|| "邮件不包含可解析正文（html/plain）".to_string())?;

    let rows = extract_table_rows(&body);
    let (statement_year, statement_month) = parse_statement_year_month(&rows)?;
    let header_idx = find_transaction_header_index(&rows)?;

    let mut current_statement_category = "未分类".to_string();
    let mut out = Vec::new();
    for (source_row_index, row) in rows.iter().enumerate().skip(header_idx + 1) {
        let non_empty = row
            .iter()
            .filter(|c| !c.is_empty())
            .cloned()
            .collect::<Vec<_>>();
        if non_empty.is_empty() {
            continue;
        }
        if non_empty.len() == 1 && stat_category_set().contains(non_empty[0].as_str()) {
            current_statement_category = non_empty[0].clone();
            continue;
        }
        let line = non_empty.join(" ");
        if line.contains('★') {
            break;
        }
        if row.len() < 7 {
            continue;
        }

        let country = row[row.len() - 1].trim().to_string();
        let original_amount = row[row.len() - 2].trim().to_string();
        let card_last4 = row[row.len() - 3].trim().to_string();
        let amount_text = row[row.len() - 4].trim().to_string();
        let description = row[row.len() - 5].trim().to_string();
        let post_raw = row[row.len() - 6].trim().to_string();
        let trans_raw = row[row.len() - 7].trim().to_string();

        let Some(amount_cents) = parse_amount_to_cents_from_text(&amount_text) else {
            continue;
        };
        let trans_date = normalize_mmdd(&trans_raw, statement_year, statement_month);
        let post_date = normalize_mmdd(&post_raw, statement_year, statement_month);
        let Some(card_last4) = extract_card_last4(&card_last4) else {
            continue;
        };
        // Guard against segmented/non-transaction rows that happen to contain a numeric amount.
        if trans_date.is_empty() && post_date.is_empty() {
            continue;
        }

        let rel_path = path
            .strip_prefix(root_for_rel)
            .unwrap_or(path)
            .to_string_lossy()
            .to_string();

        out.push(ParsedEmlTransaction {
            source_file: path
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or_default()
                .to_string(),
            source_path: rel_path,
            source_row_index,
            statement_year,
            statement_month,
            statement_category: current_statement_category.clone(),
            trans_date,
            post_date,
            description,
            amount_cents,
            card_last4,
            original_amount,
            country_area: country,
        });
    }
    Ok(out)
}

fn normalize_merchant(text: &str) -> String {
    let mut merchant = trim_text(text);
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

fn load_merchant_map(path: &Path) -> HashMap<String, (String, f64)> {
    let mut out = HashMap::new();
    let Ok(mut rdr) = csv::Reader::from_path(path) else {
        return out;
    };
    for row in rdr.deserialize::<HashMap<String, String>>().flatten() {
        let merchant = row
            .get("merchant_normalized")
            .map(|s| s.trim().to_string())
            .unwrap_or_default();
        let category = row
            .get("expense_category")
            .map(|s| s.trim().to_string())
            .unwrap_or_default();
        if merchant.is_empty() || category.is_empty() {
            continue;
        }
        let confidence = row
            .get("confidence")
            .and_then(|v| v.trim().parse::<f64>().ok())
            .filter(|v| (0.0..=1.0).contains(v))
            .unwrap_or(0.95);
        out.insert(merchant, (category, confidence));
    }
    out
}

fn load_category_rules(path: &Path) -> Vec<CategoryRule> {
    let mut out = Vec::new();
    let Ok(mut rdr) = csv::Reader::from_path(path) else {
        return out;
    };
    for row in rdr.deserialize::<HashMap<String, String>>().flatten() {
        let priority = row
            .get("priority")
            .and_then(|v| v.trim().parse::<i64>().ok())
            .unwrap_or(999);
        let match_type = row
            .get("match_type")
            .map(|s| s.trim().to_lowercase())
            .unwrap_or_else(|| "contains".to_string());
        let pattern = row
            .get("pattern")
            .map(|s| s.trim().to_string())
            .unwrap_or_default();
        let expense_category = row
            .get("expense_category")
            .map(|s| s.trim().to_string())
            .unwrap_or_default();
        let confidence = row
            .get("confidence")
            .and_then(|v| v.trim().parse::<f64>().ok())
            .unwrap_or(0.7)
            .clamp(0.0, 1.0);
        if pattern.is_empty() || expense_category.is_empty() {
            continue;
        }
        out.push(CategoryRule {
            priority,
            match_type,
            pattern,
            expense_category,
            confidence,
        });
    }
    out.sort_by_key(|r| r.priority);
    out
}

fn parse_enabled_flag(raw: &str) -> bool {
    matches!(
        raw.trim().to_lowercase().as_str(),
        "1" | "true" | "yes" | "y" | "on"
    )
}

fn load_analysis_exclusion_rules(path: &Path) -> Vec<AnalysisExclusionRule> {
    let mut out = Vec::new();
    let Ok(mut rdr) = csv::Reader::from_path(path) else {
        return out;
    };
    for row in rdr.deserialize::<HashMap<String, String>>().flatten() {
        if !parse_enabled_flag(row.get("enabled").map(String::as_str).unwrap_or("")) {
            continue;
        }
        let min_amount_cents = row
            .get("min_amount")
            .map(String::as_str)
            .unwrap_or("")
            .trim()
            .strip_prefix('￥')
            .unwrap_or(row.get("min_amount").map(String::as_str).unwrap_or(""))
            .trim()
            .to_string();
        let max_amount_cents = row
            .get("max_amount")
            .map(String::as_str)
            .unwrap_or("")
            .trim()
            .strip_prefix('￥')
            .unwrap_or(row.get("max_amount").map(String::as_str).unwrap_or(""))
            .trim()
            .to_string();

        out.push(AnalysisExclusionRule {
            rule_name: row
                .get("rule_name")
                .map(|s| s.trim().to_string())
                .unwrap_or_default(),
            merchant_contains: row
                .get("merchant_contains")
                .map(|s| s.trim().to_string())
                .unwrap_or_default(),
            description_contains: row
                .get("description_contains")
                .map(|s| s.trim().to_string())
                .unwrap_or_default(),
            expense_category: row
                .get("expense_category")
                .map(|s| s.trim().to_string())
                .unwrap_or_default(),
            min_amount_cents: if min_amount_cents.is_empty() {
                None
            } else {
                parse_amount_text_to_cents(&min_amount_cents).ok()
            },
            max_amount_cents: if max_amount_cents.is_empty() {
                None
            } else {
                parse_amount_text_to_cents(&max_amount_cents).ok()
            },
            start_date: row
                .get("start_date")
                .map(|s| s.trim().to_string())
                .unwrap_or_default(),
            end_date: row
                .get("end_date")
                .map(|s| s.trim().to_string())
                .unwrap_or_default(),
            reason: row
                .get("reason")
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "排除分析".to_string()),
        });
    }
    out
}

fn match_rule(rule: &CategoryRule, merchant: &str) -> bool {
    let target = merchant.to_lowercase();
    match rule.match_type.as_str() {
        "exact" => target == rule.pattern.to_lowercase(),
        "prefix" => target.starts_with(&rule.pattern.to_lowercase()),
        "regex" => Regex::new(&rule.pattern)
            .ok()
            .and_then(|re| re.is_match(merchant).then_some(true))
            .unwrap_or(false),
        _ => rule
            .pattern
            .split('|')
            .map(str::trim)
            .filter(|p| !p.is_empty())
            .any(|part| target.contains(&part.to_lowercase())),
    }
}

fn classify_transactions(
    records: Vec<ParsedEmlTransaction>,
    merchant_map: &HashMap<String, (String, f64)>,
    rules: &[CategoryRule],
    review_threshold: f64,
) -> Vec<ClassifiedTransaction> {
    let mut out = Vec::with_capacity(records.len());
    for txn in records {
        let merchant = normalize_merchant(&txn.description);
        if txn.statement_category != "消费" {
            let statement_category = txn.statement_category.clone();
            out.push(ClassifiedTransaction {
                txn,
                merchant_normalized: merchant,
                expense_category: format!("非消费/{statement_category}"),
                classify_source: "statement_category".to_string(),
                confidence: 1.0,
                needs_review: 0,
                excluded_in_analysis: 0,
                exclude_reason: String::new(),
            });
            continue;
        }

        if let Some((category, confidence)) = merchant_map.get(&merchant) {
            out.push(ClassifiedTransaction {
                txn,
                merchant_normalized: merchant,
                expense_category: category.clone(),
                classify_source: "merchant_map".to_string(),
                confidence: *confidence,
                needs_review: if *confidence < review_threshold { 1 } else { 0 },
                excluded_in_analysis: 0,
                exclude_reason: String::new(),
            });
            continue;
        }

        let mut matched: Option<(&CategoryRule, String)> = None;
        for rule in rules {
            if match_rule(rule, &merchant) {
                matched = Some((rule, format!("rule:{}:{}", rule.match_type, rule.pattern)));
                break;
            }
        }

        if let Some((rule, source)) = matched {
            out.push(ClassifiedTransaction {
                txn,
                merchant_normalized: merchant,
                expense_category: rule.expense_category.clone(),
                classify_source: source,
                confidence: rule.confidence,
                needs_review: if rule.confidence < review_threshold {
                    1
                } else {
                    0
                },
                excluded_in_analysis: 0,
                exclude_reason: String::new(),
            });
        } else {
            out.push(ClassifiedTransaction {
                txn,
                merchant_normalized: merchant,
                expense_category: "待分类".to_string(),
                classify_source: "unmatched".to_string(),
                confidence: 0.0,
                needs_review: 1,
                excluded_in_analysis: 0,
                exclude_reason: String::new(),
            });
        }
    }
    out
}

fn in_date_range(post_date: &str, start_date: &str, end_date: &str) -> bool {
    if post_date.is_empty() {
        return false;
    }
    if !start_date.is_empty() && post_date < start_date {
        return false;
    }
    if !end_date.is_empty() && post_date > end_date {
        return false;
    }
    true
}

fn matches_exclusion_rule(rec: &ClassifiedTransaction, rule: &AnalysisExclusionRule) -> bool {
    if rec.txn.statement_category != "消费" {
        return false;
    }
    if !rule.expense_category.is_empty() && rec.expense_category != rule.expense_category {
        return false;
    }
    if !rule.merchant_contains.is_empty()
        && !rec
            .merchant_normalized
            .to_lowercase()
            .contains(&rule.merchant_contains.to_lowercase())
    {
        return false;
    }
    if !rule.description_contains.is_empty()
        && !rec
            .txn
            .description
            .to_lowercase()
            .contains(&rule.description_contains.to_lowercase())
    {
        return false;
    }
    if let Some(min) = rule.min_amount_cents {
        if rec.txn.amount_cents < min {
            return false;
        }
    }
    if let Some(max) = rule.max_amount_cents {
        if rec.txn.amount_cents > max {
            return false;
        }
    }
    if (!rule.start_date.is_empty() || !rule.end_date.is_empty())
        && !in_date_range(&rec.txn.post_date, &rule.start_date, &rule.end_date)
    {
        return false;
    }
    true
}

fn apply_analysis_exclusions(
    records: &mut [ClassifiedTransaction],
    rules: &[AnalysisExclusionRule],
) {
    if rules.is_empty() {
        return;
    }
    for rec in records.iter_mut() {
        rec.excluded_in_analysis = 0;
        rec.exclude_reason.clear();
        for rule in rules {
            if matches_exclusion_rule(rec, rule) {
                rec.excluded_in_analysis = 1;
                rec.exclude_reason = format!(
                    "{}: {}",
                    if rule.rule_name.is_empty() {
                        "custom"
                    } else {
                        &rule.rule_name
                    },
                    rule.reason
                );
                break;
            }
        }
    }
}

fn load_rules_bundle(
    rules_dir: &Path,
) -> (
    HashMap<String, (String, f64)>,
    Vec<CategoryRule>,
    Vec<AnalysisExclusionRule>,
) {
    (
        load_merchant_map(&rules_dir.join("merchant_map.csv")),
        load_category_rules(&rules_dir.join("category_rules.csv")),
        load_analysis_exclusion_rules(&rules_dir.join("analysis_exclusions.csv")),
    )
}

#[cfg(test)]
fn parse_and_classify_emls(
    source_path: &Path,
    review_threshold: f64,
) -> Result<(Vec<ClassifiedTransaction>, PreviewSummary), String> {
    parse_and_classify_emls_with_rules_dir(source_path, review_threshold, &resolve_repo_rules_dir())
}

fn parse_and_classify_emls_with_rules_dir(
    source_path: &Path,
    review_threshold: f64,
    rules_dir: &Path,
) -> Result<(Vec<ClassifiedTransaction>, PreviewSummary), String> {
    let (files, root_for_rel) = collect_eml_files(source_path)?;
    let (merchant_map, category_rules, exclusion_rules) = load_rules_bundle(rules_dir);

    let mut parsed_records = Vec::<ParsedEmlTransaction>::new();
    let mut failed_files = Vec::<Value>::new();
    let mut failed_files_total = 0_usize;

    for file in &files {
        match parse_single_eml(file, &root_for_rel) {
            Ok(mut rows) => parsed_records.append(&mut rows),
            Err(err) => {
                failed_files_total += 1;
                if failed_files.len() < 20 {
                    failed_files.push(json!({
                        "file": file.to_string_lossy().to_string(),
                        "error": err,
                    }));
                }
            }
        }
    }

    if parsed_records.is_empty() {
        let details = failed_files
            .iter()
            .map(|v| {
                let file = v.get("file").and_then(Value::as_str).unwrap_or("unknown");
                let err = v.get("error").and_then(Value::as_str).unwrap_or("unknown");
                format!("{file}: {err}")
            })
            .collect::<Vec<_>>()
            .join("; ");
        return Err(if details.is_empty() {
            "未产出任何交易记录。无可解析交易记录".to_string()
        } else {
            format!("未产出任何交易记录。{details}")
        });
    }

    let mut classified = classify_transactions(
        parsed_records,
        &merchant_map,
        &category_rules,
        review_threshold,
    );
    apply_analysis_exclusions(&mut classified, &exclusion_rules);

    let consume_rows = classified
        .iter()
        .filter(|r| r.txn.statement_category == "消费" && r.excluded_in_analysis == 0)
        .count();
    let review_count = classified
        .iter()
        .filter(|r| {
            r.txn.statement_category == "消费" && r.excluded_in_analysis == 0 && r.needs_review == 1
        })
        .count();
    let excluded_count = classified
        .iter()
        .filter(|r| r.txn.statement_category == "消费" && r.excluded_in_analysis == 1)
        .count();

    let preview_rows = classified
        .iter()
        .take(10)
        .map(|r| {
            json!({
                "post_date": r.txn.post_date,
                "trans_date": r.txn.trans_date,
                "description": r.txn.description,
                "merchant_normalized": r.merchant_normalized,
                "amount_cents": r.txn.amount_cents,
                "statement_category": r.txn.statement_category,
                "expense_category": r.expense_category,
                "classify_source": r.classify_source,
                "confidence": r.confidence,
                "needs_review": r.needs_review,
                "excluded_in_analysis": r.excluded_in_analysis,
                "exclude_reason": r.exclude_reason,
            })
        })
        .collect::<Vec<_>>();

    let summary = PreviewSummary {
        input_files_count: files.len(),
        records_count: classified.len(),
        consume_count: consume_rows,
        needs_review_count: review_count,
        excluded_count,
        failed_files_count: failed_files_total,
        failed_files,
        preview_rows,
    };
    Ok((classified, summary))
}

fn preview_summary_to_json(summary: &PreviewSummary) -> Value {
    json!({
        "input_files_count": summary.input_files_count,
        "records_count": summary.records_count,
        "consume_count": summary.consume_count,
        "needs_review_count": summary.needs_review_count,
        "excluded_count": summary.excluded_count,
        "failed_files_count": summary.failed_files_count,
        "failed_files": summary.failed_files,
        "preview_rows": summary.preview_rows,
    })
}

fn safe_confidence(v: f64) -> f64 {
    v.clamp(0.0, 1.0)
}

fn resolve_month_key(txn: &ParsedEmlTransaction) -> String {
    if txn.post_date.len() >= 7 {
        return txn.post_date[..7].to_string();
    }
    if txn.trans_date.len() >= 7 {
        return txn.trans_date[..7].to_string();
    }
    format!("{:04}-{:02}", txn.statement_year, txn.statement_month)
}

fn account_id_from_last4(last4: &str) -> String {
    let clean = last4.trim();
    format!(
        "acct_cmb_credit_{}",
        if clean.is_empty() { "unknown" } else { clean }
    )
}

fn account_name_from_last4(last4: &str) -> String {
    let clean = last4.trim();
    if clean.is_empty() {
        "招行信用卡".to_string()
    } else {
        format!("招行信用卡尾号{clean}")
    }
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

fn direction_from_statement_category(statement_category: &str) -> &'static str {
    match statement_category.trim() {
        "消费" => "expense",
        "还款" => "transfer",
        _ => "other",
    }
}

fn transaction_identity_base(rec: &ClassifiedTransaction) -> String {
    let txn = &rec.txn;
    [
        txn.source_file.as_str(),
        txn.source_path.as_str(),
        &txn.source_row_index.to_string(),
        &txn.statement_year.to_string(),
        &txn.statement_month.to_string(),
        txn.statement_category.as_str(),
        txn.post_date.as_str(),
        txn.trans_date.as_str(),
        txn.description.as_str(),
        &format_amount_cents(txn.amount_cents),
        txn.card_last4.as_str(),
        txn.original_amount.as_str(),
        txn.country_area.as_str(),
    ]
    .join("|")
}

fn transaction_id(rec: &ClassifiedTransaction, source_type: &str) -> String {
    let source = format!("{source_type}|{}", transaction_identity_base(rec));
    let mut hasher = Sha1::new();
    hasher.update(source.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn format_amount_cents(cents: i64) -> String {
    let sign = if cents < 0 { "-" } else { "" };
    let abs = cents.abs();
    format!("{sign}{}.{:02}", abs / 100, abs % 100)
}

fn ensure_schema_ready(conn: &Connection) -> Result<(), String> {
    let mut stmt = conn
        .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('accounts','categories','transactions','import_jobs')",
        )
        .map_err(|e| format!("检查数据库表失败: {e}"))?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| format!("读取数据库表失败: {e}"))?;
    let mut table_names = HashSet::new();
    for row in rows {
        table_names.insert(row.map_err(|e| format!("读取数据库表失败: {e}"))?);
    }
    let required = ["accounts", "categories", "transactions", "import_jobs"];
    let missing = required
        .iter()
        .filter(|t| !table_names.contains(**t))
        .copied()
        .collect::<Vec<_>>();
    if !missing.is_empty() {
        return Err(format!(
            "数据库缺少必要表: {}。请先执行迁移。",
            missing.join(", ")
        ));
    }
    Ok(())
}

fn upsert_account(conn: &Connection, account_id: &str, account_name: &str) -> Result<(), String> {
    conn.execute(
        r#"
        INSERT INTO accounts(id, name, account_type, currency, initial_balance_cents)
        VALUES (?1, ?2, 'credit_card', 'CNY', 0)
        ON CONFLICT(id) DO UPDATE SET
            name=excluded.name,
            account_type='credit_card',
            updated_at=datetime('now')
        "#,
        params![account_id, account_name],
    )
    .map_err(|e| format!("写入账户失败: {e}"))?;
    Ok(())
}

fn upsert_category(
    conn: &Connection,
    category_id: &str,
    category_name: &str,
) -> Result<(), String> {
    conn.execute(
        r#"
        INSERT INTO categories(id, name, level, budget_enabled, is_active)
        VALUES (?1, ?2, 1, 1, 1)
        ON CONFLICT(id) DO UPDATE SET
            name=excluded.name,
            is_active=1,
            updated_at=datetime('now')
        "#,
        params![category_id, category_name],
    )
    .map_err(|e| format!("写入分类失败: {e}"))?;
    Ok(())
}

fn upsert_transaction(
    conn: &Connection,
    rec: &ClassifiedTransaction,
    tx_id: &str,
    category_id: &str,
    account_id: &str,
    source_type: &str,
    import_job_id: &str,
) -> Result<(), String> {
    let txn = &rec.txn;
    let description = txn.description.trim();
    let merchant = if description.is_empty() {
        ""
    } else {
        description
    };
    let merchant_normalized = if rec.merchant_normalized.trim().is_empty() {
        merchant
    } else {
        rec.merchant_normalized.trim()
    };
    let external_ref = format!("{source_type}:{tx_id}");
    let source_file = txn.source_file.trim();

    conn.execute(
        r#"
        INSERT INTO transactions(
            id, external_ref, occurred_at, posted_at, month_key, amount_cents, currency, direction,
            description, merchant, merchant_normalized, statement_category, category_id, account_id,
            source_type, source_file, import_job_id, confidence, needs_review, excluded_in_analysis, exclude_reason
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'CNY', ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20)
        ON CONFLICT(id) DO UPDATE SET
            external_ref=excluded.external_ref,
            occurred_at=excluded.occurred_at,
            posted_at=excluded.posted_at,
            month_key=excluded.month_key,
            amount_cents=excluded.amount_cents,
            currency=excluded.currency,
            direction=excluded.direction,
            description=excluded.description,
            merchant=excluded.merchant,
            merchant_normalized=excluded.merchant_normalized,
            statement_category=excluded.statement_category,
            category_id=excluded.category_id,
            account_id=excluded.account_id,
            source_type=excluded.source_type,
            source_file=excluded.source_file,
            import_job_id=excluded.import_job_id,
            confidence=excluded.confidence,
            needs_review=excluded.needs_review,
            excluded_in_analysis=CASE
                WHEN transactions.excluded_in_analysis = 1
                     AND SUBSTR(COALESCE(transactions.exclude_reason, ''), 1, 19) = ?21
                THEN 1
                ELSE excluded.excluded_in_analysis
            END,
            exclude_reason=CASE
                WHEN transactions.excluded_in_analysis = 1
                     AND SUBSTR(COALESCE(transactions.exclude_reason, ''), 1, 19) = ?21
                THEN transactions.exclude_reason
                ELSE excluded.exclude_reason
            END,
            updated_at=datetime('now')
        "#,
        params![
            tx_id,
            external_ref,
            if txn.trans_date.trim().is_empty() { None::<String> } else { Some(txn.trans_date.clone()) },
            if txn.post_date.trim().is_empty() { None::<String> } else { Some(txn.post_date.clone()) },
            resolve_month_key(txn),
            txn.amount_cents,
            direction_from_statement_category(&txn.statement_category),
            description,
            merchant,
            merchant_normalized,
            txn.statement_category,
            category_id,
            account_id,
            source_type,
            source_file,
            import_job_id,
            safe_confidence(rec.confidence),
            rec.needs_review,
            rec.excluded_in_analysis,
            rec.exclude_reason,
            MANUAL_TX_EXCLUDE_REASON_PREFIX,
        ],
    )
    .map_err(|e| format!("写入交易失败: {e}"))?;
    Ok(())
}

fn cmb_eml_preview_at_path_with_rules_dir(
    source_path: &Path,
    review_threshold: f64,
    rules_dir: &Path,
) -> Result<Value, String> {
    let (_classified, summary) =
        parse_and_classify_emls_with_rules_dir(source_path, review_threshold, rules_dir)?;
    Ok(json!({
        "source_path": source_path.to_string_lossy().to_string(),
        "review_threshold": review_threshold,
        "summary": preview_summary_to_json(&summary),
    }))
}

fn cmb_eml_import_at_db_path(
    db_path: &Path,
    source_path: &Path,
    review_threshold: f64,
    source_type: &str,
    rules_dir: &Path,
) -> Result<Value, String> {
    let (classified, summary) =
        parse_and_classify_emls_with_rules_dir(source_path, review_threshold, rules_dir)?;

    let conn = Connection::open(db_path).map_err(|e| format!("打开数据库失败: {e}"))?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|e| format!("设置 foreign_keys 失败: {e}"))?;
    ensure_schema_ready(&conn)?;

    let job_id = Uuid::new_v4().to_string();
    let started_at = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
    let metadata_json = serde_json::to_string(&json!({
        "source_path": source_path.to_string_lossy().to_string(),
        "source_type": source_type,
        "review_threshold": review_threshold,
        "mode": "rust_cmb_eml_import",
    }))
    .map_err(|e| format!("序列化导入任务元数据失败: {e}"))?;

    conn.execute(
        r#"
        INSERT INTO import_jobs(id, source_type, source_file, status, started_at, total_count, imported_count, error_count, metadata_json)
        VALUES (?1, ?2, ?3, 'running', ?4, 0, 0, 0, ?5)
        "#,
        params![
            job_id,
            source_type,
            source_path.to_string_lossy().to_string(),
            started_at,
            metadata_json,
        ],
    )
    .map_err(|e| format!("创建导入任务失败: {e}"))?;

    let mut imported_count = 0_i64;
    let mut error_count = 0_i64;
    let mut error_samples = Vec::<String>::new();
    let total_count = i64::try_from(classified.len()).unwrap_or(i64::MAX);

    for rec in &classified {
        let tx_id = transaction_id(rec, source_type);
        let category_id = category_id_from_name(&rec.expense_category);
        let account_id = account_id_from_last4(&rec.txn.card_last4);
        let account_name = account_name_from_last4(&rec.txn.card_last4);

        let step: Result<(), String> = (|| {
            let tx = conn
                .unchecked_transaction()
                .map_err(|e| format!("开始导入事务失败: {e}"))?;
            upsert_account(&tx, &account_id, &account_name)?;
            upsert_category(&tx, &category_id, &rec.expense_category)?;
            upsert_transaction(
                &tx,
                rec,
                &tx_id,
                &category_id,
                &account_id,
                source_type,
                &job_id,
            )?;
            tx.commit().map_err(|e| format!("提交导入事务失败: {e}"))?;
            Ok(())
        })();

        match step {
            Ok(()) => imported_count += 1,
            Err(err) => {
                error_count += 1;
                if error_samples.len() < 20 {
                    error_samples.push(err);
                }
            }
        }
    }

    let finished_at = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
    conn.execute(
        r#"
        UPDATE import_jobs
        SET status='success',
            finished_at=?1,
            total_count=?2,
            imported_count=?3,
            error_count=?4,
            error_message=?5
        WHERE id=?6
        "#,
        params![
            finished_at,
            total_count,
            imported_count,
            error_count,
            if error_samples.is_empty() {
                None::<String>
            } else {
                Some(error_samples.join("\n"))
            },
            job_id,
        ],
    )
    .map_err(|e| format!("更新导入任务状态失败: {e}"))?;

    Ok(json!({
        "db_path": db_path.to_string_lossy().to_string(),
        "source_path": source_path.to_string_lossy().to_string(),
        "source_type": source_type,
        "review_threshold": review_threshold,
        "imported_count": imported_count,
        "import_error_count": error_count,
        "import_job_id": job_id,
        "summary": preview_summary_to_json(&summary),
        "error_samples": error_samples,
    }))
}

#[tauri::command]
pub fn cmb_eml_preview(app: AppHandle, req: CmbEmlPreviewRequest) -> Result<Value, String> {
    let source_path = resolve_source_path_text(req.source_path)?;
    let review_threshold = resolve_review_threshold(req.review_threshold)?;
    let rules_dir = ensure_app_rules_dir_seeded(&app)?;
    cmb_eml_preview_at_path_with_rules_dir(Path::new(&source_path), review_threshold, &rules_dir)
}

#[tauri::command]
pub fn cmb_eml_import(app: AppHandle, req: CmbEmlImportRequest) -> Result<Value, String> {
    let source_path = resolve_source_path_text(req.source_path)?;
    let review_threshold = resolve_review_threshold(req.review_threshold)?;
    let source_type = req
        .source_type
        .unwrap_or_else(|| DEFAULT_SOURCE_TYPE.to_string())
        .trim()
        .to_string();
    if source_type.is_empty() {
        return Err("source_type 不能为空".to_string());
    }
    let db_path = resolve_ledger_db_path(&app)?;
    let rules_dir = ensure_app_rules_dir_seeded(&app)?;
    cmb_eml_import_at_db_path(
        &db_path,
        Path::new(&source_path),
        review_threshold,
        &source_type,
        &rules_dir,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn create_temp_test_db() -> PathBuf {
        let unique = format!(
            "keepwise_eml_import_test_{}_{}.db",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time before epoch")
                .as_nanos()
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

    #[test]
    fn parses_2025_sample_with_stable_card_last4_set() {
        let sample_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../..")
            .join("data/input/raw/eml/cmb/2025");
        if !sample_dir.exists() {
            return;
        }
        let (classified, summary) = parse_and_classify_emls(&sample_dir, DEFAULT_REVIEW_THRESHOLD)
            .expect("parse sample eml dir");
        assert!(
            !classified.is_empty(),
            "expected parsed transactions from sample dir"
        );
        assert!(
            summary.input_files_count > 0,
            "expected sample dir to contain eml files"
        );

        let mut card_set = BTreeSet::new();
        for row in &classified {
            let last4 = row.txn.card_last4.trim();
            assert_eq!(
                last4.len(),
                4,
                "unexpected card_last4 length from row: {:?}",
                row.txn
            );
            assert!(
                last4.chars().all(|c| c.is_ascii_digit()),
                "unexpected non-digit card_last4 from row: {:?}",
                row.txn
            );
            card_set.insert(last4.to_string());
        }

        // Current 2025 sample set should be a very small number of credit card tails.
        assert!(
            card_set.len() <= 4,
            "too many distinct card tails parsed from sample: {:?}",
            card_set
        );
    }

    #[test]
    fn sample_2025_transaction_ids_are_unique_and_stable_across_parses() {
        let sample_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../..")
            .join("data/input/raw/eml/cmb/2025");
        if !sample_dir.exists() {
            return;
        }

        let (classified_a, _) =
            parse_and_classify_emls(&sample_dir, DEFAULT_REVIEW_THRESHOLD).expect("first parse");
        let (classified_b, _) =
            parse_and_classify_emls(&sample_dir, DEFAULT_REVIEW_THRESHOLD).expect("second parse");

        let ids_a = classified_a
            .iter()
            .map(|rec| transaction_id(rec, DEFAULT_SOURCE_TYPE))
            .collect::<Vec<_>>();
        let ids_b = classified_b
            .iter()
            .map(|rec| transaction_id(rec, DEFAULT_SOURCE_TYPE))
            .collect::<Vec<_>>();

        assert_eq!(
            ids_a, ids_b,
            "transaction id sequence should be stable across repeated parses"
        );

        let unique = ids_a.iter().collect::<BTreeSet<_>>();
        assert_eq!(
            unique.len(),
            ids_a.len(),
            "transaction ids should be unique within parsed sample"
        );
    }

    #[test]
    fn importing_same_2025_samples_twice_is_idempotent_for_transactions() {
        let sample_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../..")
            .join("data/input/raw/eml/cmb/2025");
        if !sample_dir.exists() {
            return;
        }

        let db_path = create_temp_test_db();
        apply_all_migrations_for_test(&db_path);
        let rules_dir = repo_root().join("data/rules");

        let import1 = cmb_eml_import_at_db_path(
            &db_path,
            &sample_dir,
            DEFAULT_REVIEW_THRESHOLD,
            DEFAULT_SOURCE_TYPE,
            &rules_dir,
        )
        .expect("first import");
        let import2 = cmb_eml_import_at_db_path(
            &db_path,
            &sample_dir,
            DEFAULT_REVIEW_THRESHOLD,
            DEFAULT_SOURCE_TYPE,
            &rules_dir,
        )
        .expect("second import");

        let conn = Connection::open(&db_path).expect("open temp db for count");
        let total_tx: i64 = conn
            .query_row("SELECT COUNT(*) FROM transactions", [], |row| row.get(0))
            .expect("count transactions");

        let imported1 = import1
            .get("imported_count")
            .and_then(Value::as_i64)
            .expect("import1.imported_count");
        let imported2 = import2
            .get("imported_count")
            .and_then(Value::as_i64)
            .expect("import2.imported_count");

        assert!(
            imported1 > 0,
            "first import should import sample transactions"
        );
        assert_eq!(
            total_tx, imported1,
            "second import should upsert existing transactions instead of creating duplicates"
        );
        assert_eq!(
            imported2, imported1,
            "second import still processes all rows, but should not increase transaction row count"
        );

        let _ = fs::remove_file(&db_path);
    }

    #[test]
    fn parses_problematic_2026_sample_file_with_expected_row_count() {
        let sample_file = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../..")
            .join("data/input/raw/eml/cmb/2026/招商银行信用卡电子账单 (12).eml");
        if !sample_file.exists() {
            return;
        }
        let rows = parse_single_eml(&sample_file, sample_file.parent().expect("parent"))
            .expect("parse problematic 2026 sample file");
        assert_eq!(
            rows.len(),
            118,
            "parser row count for known problematic sample drifted; likely table extraction regressed"
        );
    }

    #[test]
    fn preview_problematic_2026_sample_summary_matches_expected_counts() {
        let sample_file = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../..")
            .join("data/input/raw/eml/cmb/2026/招商银行信用卡电子账单 (12).eml");
        if !sample_file.exists() {
            return;
        }
        let rules_dir = repo_root().join("data/rules");
        let preview = cmb_eml_preview_at_path_with_rules_dir(
            &sample_file,
            DEFAULT_REVIEW_THRESHOLD,
            &rules_dir,
        )
        .expect("preview problematic 2026 sample");
        let summary = preview
            .get("summary")
            .and_then(Value::as_object)
            .expect("preview.summary object");
        assert_eq!(
            summary.get("records_count").and_then(Value::as_u64),
            Some(118),
            "records_count drifted for known problematic sample"
        );
        assert_eq!(
            summary.get("consume_count").and_then(Value::as_u64),
            Some(113),
            "consume_count drifted for known problematic sample"
        );
        assert_eq!(
            summary.get("needs_review_count").and_then(Value::as_u64),
            Some(22),
            "needs_review_count drifted for known problematic sample"
        );
    }

    #[test]
    #[ignore]
    fn debug_problematic_2026_sample_preview_summary() {
        let sample_file = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../..")
            .join("data/input/raw/eml/cmb/2026/招商银行信用卡电子账单 (12).eml");
        if !sample_file.exists() {
            return;
        }
        let (_classified, summary) =
            parse_and_classify_emls(&sample_file, DEFAULT_REVIEW_THRESHOLD)
                .expect("preview summary");
        eprintln!(
            "records={} consume={} review={} excluded={}",
            summary.records_count,
            summary.consume_count,
            summary.needs_review_count,
            summary.excluded_count
        );
    }
}
