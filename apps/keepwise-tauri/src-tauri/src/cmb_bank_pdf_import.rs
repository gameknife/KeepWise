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

fn resolve_review_threshold(raw: Option<f64>) -> Result<f64, String> {
    let v = raw.unwrap_or(DEFAULT_REVIEW_THRESHOLD);
    if !(0.0..=1.0).contains(&v) {
        return Err("review_threshold 必须在 0~1 之间".to_string());
    }
    Ok(v)
}

fn extract_header(first_page_text: &str) -> Result<PdfHeader, String> {
    let account_no = account_no_re()
        .captures(first_page_text)
        .and_then(|c| c.get(1).map(|m| m.as_str().to_string()))
        .ok_or_else(|| "无法识别招商银行流水 PDF 头部信息（账号/日期范围）".to_string())?;
    let caps = date_range_re()
        .captures(first_page_text)
        .ok_or_else(|| "无法识别招商银行流水 PDF 头部信息（账号/日期范围）".to_string())?;
    let range_start = caps
        .get(1)
        .map(|m| m.as_str().to_string())
        .unwrap_or_default();
    let range_end = caps
        .get(2)
        .map(|m| m.as_str().to_string())
        .unwrap_or_default();
    Ok(PdfHeader {
        account_last4: account_no
            .chars()
            .rev()
            .take(4)
            .collect::<String>()
            .chars()
            .rev()
            .collect(),
        range_start,
        range_end,
    })
}

fn parse_summary_and_counterparty(raw_detail: &str) -> (String, String) {
    let text = raw_detail.trim();
    if text.is_empty() {
        return (String::new(), String::new());
    }
    for prefix in SUMMARY_PREFIXES {
        if text.starts_with(prefix) {
            return (
                (*prefix).to_string(),
                text[prefix.len()..].trim().to_string(),
            );
        }
    }
    let mut split = text.splitn(2, ' ');
    let token = split.next().unwrap_or_default().trim().to_string();
    let rest = split.next().unwrap_or_default().trim().to_string();
    (token, rest)
}

fn parse_pdf(pdf_path: &Path) -> Result<(PdfHeader, Vec<BankPdfTransaction>), String> {
    if !pdf_path.exists() || !pdf_path.is_file() {
        return Err(format!("未找到 PDF 文件: {}", pdf_path.to_string_lossy()));
    }

    let full_text = extract_text(pdf_path).map_err(|e| format!("读取 PDF 文本失败: {e}"))?;
    let pages = full_text
        .split('\u{000C}')
        .map(|s| s.to_string())
        .filter(|s| !s.trim().is_empty())
        .collect::<Vec<_>>();
    if pages.is_empty() {
        return Err("PDF 无页面内容".to_string());
    }

    let header = extract_header(&pages[0])?;
    let mut records = Vec::<BankPdfTransaction>::new();

    let skip_prefixes = [
        "记账日期 货币 交易金额 联机余额 交易摘要 对手信息",
        "Date Currency Transaction",
        "Amount Balance Transaction Type Counter Party",
    ];
    let meta_prefixes = [
        "户 名：",
        "户 名:",
        "户\u{00a0}\u{00a0}名：",
        "账户类型：",
        "申请时间：",
        "账号：",
        "开 户 行：",
        "验 证 码：",
    ];
    let meta_exact = [
        "招商银行交易流水",
        "Transaction Statement of China Merchants Bank",
        "Name",
        "Account Type",
        "Date",
        "Account No",
        "Sub Branch",
        "Verification Code",
    ];

    #[derive(Default)]
    struct PendingRow {
        page: i64,
        date: String,
        currency: String,
        amount_text: String,
        balance_text: String,
        raw_detail: String,
    }

    let mut current: Option<PendingRow> = None;
    let flush_current = |current: &mut Option<PendingRow>,
                         out: &mut Vec<BankPdfTransaction>|
     -> Result<(), String> {
        if let Some(p) = current.take() {
            let (summary, counterparty) = parse_summary_and_counterparty(&p.raw_detail);
            let amount_cents = parse_amount_to_cents(&p.amount_text)?;
            out.push(BankPdfTransaction {
                page: p.page,
                date: p.date,
                currency: p.currency,
                amount_text: p.amount_text,
                amount_cents,
                balance_text: p.balance_text,
                raw_detail: p.raw_detail.trim().to_string(),
                summary,
                counterparty,
            });
        }
        Ok(())
    };

    for (page_idx, page_text) in pages.iter().enumerate() {
        for raw_line in page_text.lines() {
            let line = normalize_line(raw_line);
            if line.is_empty() {
                continue;
            }
            if Regex::new(r"^\d+/\d+$")
                .expect("page regex")
                .is_match(&line)
            {
                continue;
            }
            if meta_exact.contains(&line.as_str()) {
                continue;
            }
            if skip_prefixes.iter().any(|p| line.starts_with(p)) {
                continue;
            }
            if meta_prefixes.iter().any(|p| line.starts_with(p)) {
                continue;
            }
            if date_range_re().is_match(&line) && line.contains("--") {
                continue;
            }

            if let Some(m) = row_start_re().captures(&line) {
                flush_current(&mut current, &mut records)?;
                current = Some(PendingRow {
                    page: (page_idx + 1) as i64,
                    date: m.get(1).map(|v| v.as_str().to_string()).unwrap_or_default(),
                    currency: m.get(2).map(|v| v.as_str().to_string()).unwrap_or_default(),
                    amount_text: m.get(3).map(|v| v.as_str().to_string()).unwrap_or_default(),
                    balance_text: m.get(4).map(|v| v.as_str().to_string()).unwrap_or_default(),
                    raw_detail: m.get(5).map(|v| v.as_str().to_string()).unwrap_or_default(),
                });
                continue;
            }

            if let Some(cur) = current.as_mut() {
                cur.raw_detail = format!("{} {}", cur.raw_detail, line).trim().to_string();
            }
        }
    }
    flush_current(&mut current, &mut records)?;
    Ok((header, records))
}

fn looks_like_person_counterparty(counterparty: &str) -> Option<String> {
    let text = normalize_counterparty(counterparty);
    if text.is_empty() {
        return None;
    }
    if WECHAT_TRANSFER_PREFIXES.iter().any(|p| text.starts_with(p)) {
        return None;
    }
    let merchant_markers = [
        "公司",
        "银行",
        "基金",
        "理财",
        "中心",
        "管理",
        "有限",
        "科技",
        "股份",
        "平台",
        "商户",
        "机场",
        "高速",
        "停车",
        "美团",
        "肯德基",
        "面馆",
        "智泊",
    ];
    if merchant_markers.iter().any(|m| text.contains(m)) {
        return None;
    }
    person_name_re()
        .captures(&text)
        .and_then(|c| c.get(1).map(|m| m.as_str().to_string()))
}

fn loan_key(counterparty: &str) -> String {
    loan_id_re()
        .captures(counterparty)
        .and_then(|c| c.get(1).map(|m| m.as_str().to_string()))
        .unwrap_or_else(|| "unknown".to_string())
}

fn median_i64(values: &mut [i64]) -> i64 {
    values.sort_unstable();
    let n = values.len();
    if n == 0 {
        return 0;
    }
    if n % 2 == 1 {
        values[n / 2]
    } else {
        let a = values[(n / 2) - 1];
        let b = values[n / 2];
        ((a as i128 + b as i128) / 2) as i64
    }
}

fn mortgage_fixed_profiles(records: &[BankPdfTransaction]) -> HashMap<String, MortgageProfile> {
    let mut grouped: HashMap<String, Vec<i64>> = HashMap::new();
    for rec in records {
        if rec.currency != "CNY" || rec.summary != "个贷交易" || rec.amount_cents >= 0 {
            continue;
        }
        grouped
            .entry(loan_key(&rec.counterparty))
            .or_default()
            .push(rec.amount_cents.abs());
    }
    let mut out = HashMap::new();
    for (k, mut amounts) in grouped {
        if amounts.is_empty() {
            continue;
        }
        let med = median_i64(&mut amounts);
        let threshold = std::cmp::max((med as f64 * 1.8).round() as i64, med + 300_000);
        out.insert(
            k,
            MortgageProfile {
                count: amounts.len(),
                median_abs_amount_cents: med,
                fixed_threshold_cents: threshold,
            },
        );
    }
    out
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
        let pattern = row
            .get("pattern")
            .map(|s| s.trim().to_string())
            .unwrap_or_default();
        let expense_category = row
            .get("expense_category")
            .map(|s| s.trim().to_string())
            .unwrap_or_default();
        if pattern.is_empty() || expense_category.is_empty() {
            continue;
        }
        out.push(CategoryRule {
            priority: row
                .get("priority")
                .and_then(|v| v.trim().parse::<i64>().ok())
                .unwrap_or(999),
            match_type: row
                .get("match_type")
                .map(|s| s.trim().to_lowercase())
                .unwrap_or_else(|| "contains".to_string()),
            pattern,
            expense_category,
            confidence: row
                .get("confidence")
                .and_then(|v| v.trim().parse::<f64>().ok())
                .unwrap_or(0.7)
                .clamp(0.0, 1.0),
        });
    }
    out.sort_by_key(|r| r.priority);
    out
}

fn boolish_text(s: &str) -> bool {
    matches!(
        s.trim().to_lowercase().as_str(),
        "1" | "true" | "yes" | "y" | "on"
    )
}

fn load_bank_transfer_whitelist_names(path: &Path) -> HashSet<String> {
    let mut names = HashSet::new();
    if let Ok(mut rdr) = csv::Reader::from_path(path) {
        for row in rdr.deserialize::<HashMap<String, String>>().flatten() {
            let name = row
                .get("name")
                .map(|s| s.trim().to_string())
                .unwrap_or_default();
            if name.is_empty() {
                continue;
            }
            let active = row
                .get("is_active")
                .map(|s| boolish_text(s))
                .unwrap_or(true);
            if active {
                names.insert(name);
            }
        }
    }
    if names.is_empty() {
        for n in DEFAULT_PERSONAL_TRANSFER_WHITELIST {
            names.insert((*n).to_string());
        }
    }
    names
}

fn match_rule(rule: &CategoryRule, merchant: &str) -> bool {
    let target = merchant.to_lowercase();
    match rule.match_type.as_str() {
        "exact" => target == rule.pattern.to_lowercase(),
        "prefix" => target.starts_with(&rule.pattern.to_lowercase()),
        "regex" => Regex::new(&rule.pattern)
            .ok()
            .map(|re| re.is_match(merchant))
            .unwrap_or(false),
        _ => rule
            .pattern
            .split('|')
            .map(str::trim)
            .filter(|p| !p.is_empty())
            .any(|part| target.contains(&part.to_lowercase())),
    }
}

fn classify_debit_merchant_spend(
    counterparty: &str,
    merchant_map: &HashMap<String, (String, f64)>,
    category_rules: &[CategoryRule],
    review_threshold: f64,
    fallback_category: &str,
) -> (String, f64, i64, String) {
    let merchant = normalize_merchant(&normalize_counterparty(counterparty));
    if merchant_map.is_empty() && category_rules.is_empty() {
        return (
            fallback_category.to_string(),
            0.92,
            0,
            "fallback".to_string(),
        );
    }
    if let Some((category, confidence)) = merchant_map.get(&merchant) {
        return (
            category.clone(),
            *confidence,
            if *confidence < review_threshold { 1 } else { 0 },
            "merchant_map".to_string(),
        );
    }
    for rule in category_rules {
        if match_rule(rule, &merchant) {
            return (
                rule.expense_category.clone(),
                rule.confidence,
                if rule.confidence < review_threshold {
                    1
                } else {
                    0
                },
                "keyword_rule".to_string(),
            );
        }
    }
    ("待分类".to_string(), 0.0, 1, "unmatched".to_string())
}

fn is_skip_summary(summary: &str) -> bool {
    INVESTMENT_OR_FX_SUMMARIES.contains(&summary) || SKIP_SUMMARIES_EXTRA.contains(&summary)
}

fn classify_transactions(
    header: &PdfHeader,
    records: &[BankPdfTransaction],
    transfer_whitelist: &HashSet<String>,
    merchant_map: &HashMap<String, (String, f64)>,
    category_rules: &[CategoryRule],
    review_threshold: f64,
) -> (Vec<ClassifiedPdfRow>, Value) {
    let _ = header;
    let mortgage_profiles = mortgage_fixed_profiles(records);
    let mut rows = Vec::<ClassifiedPdfRow>::new();
    let mut counters: BTreeMap<String, i64> = BTreeMap::new();
    let mut amount_cents_by_tag: BTreeMap<String, i64> = BTreeMap::new();

    let mut bump = |tag: &str, amount_cents: Option<i64>| {
        *counters.entry(tag.to_string()).or_insert(0) += 1;
        if let Some(v) = amount_cents {
            *amount_cents_by_tag.entry(tag.to_string()).or_insert(0) += v;
        }
    };

    for tx in records {
        if tx.currency != "CNY" {
            rows.push(ClassifiedPdfRow {
                tx: tx.clone(),
                include_in_import: false,
                include_in_expense_analysis: false,
                rule_tag: "skip_non_cny".to_string(),
                expense_category: "非人民币交易".to_string(),
                direction: "other".to_string(),
                confidence: 1.0,
                needs_review: 0,
                excluded_in_analysis: 1,
                exclude_reason: "非人民币交易，当前版本暂不导入".to_string(),
            });
            bump("skip_non_cny", None);
            continue;
        }

        if tx.summary == "代发工资" && tx.amount_cents > 0 {
            rows.push(ClassifiedPdfRow {
                tx: tx.clone(),
                include_in_import: true,
                include_in_expense_analysis: false,
                rule_tag: "salary".to_string(),
                expense_category: "工资收入".to_string(),
                direction: "income".to_string(),
                confidence: 0.99,
                needs_review: 0,
                excluded_in_analysis: 0,
                exclude_reason: String::new(),
            });
            bump("salary", Some(tx.amount_cents));
            continue;
        }

        if tx.summary == "代发住房公积金" && tx.amount_cents > 0 {
            rows.push(ClassifiedPdfRow {
                tx: tx.clone(),
                include_in_import: true,
                include_in_expense_analysis: false,
                rule_tag: "housing_fund_income".to_string(),
                expense_category: "公积金收入".to_string(),
                direction: "income".to_string(),
                confidence: 0.99,
                needs_review: 0,
                excluded_in_analysis: 0,
                exclude_reason: String::new(),
            });
            bump("housing_fund_income", Some(tx.amount_cents));
            continue;
        }

        if tx.summary == "个贷交易" && tx.amount_cents < 0 {
            let key = loan_key(&tx.counterparty);
            let profile = mortgage_profiles.get(&key);
            let is_fixed = profile
                .map(|p| p.count >= 3 && tx.amount_cents.abs() <= p.fixed_threshold_cents)
                .unwrap_or(false);
            if is_fixed {
                rows.push(ClassifiedPdfRow {
                    tx: tx.clone(),
                    include_in_import: true,
                    include_in_expense_analysis: true,
                    rule_tag: "mortgage_fixed".to_string(),
                    expense_category: "房贷固定还款".to_string(),
                    direction: "expense".to_string(),
                    confidence: 0.95,
                    needs_review: 0,
                    excluded_in_analysis: 0,
                    exclude_reason: String::new(),
                });
                bump("mortgage_fixed", Some(tx.amount_cents));
            } else {
                rows.push(ClassifiedPdfRow {
                    tx: tx.clone(),
                    include_in_import: false,
                    include_in_expense_analysis: false,
                    rule_tag: "skip_mortgage_early_or_unknown".to_string(),
                    expense_category: "房贷提前还款/异常".to_string(),
                    direction: "expense".to_string(),
                    confidence: 0.9,
                    needs_review: 0,
                    excluded_in_analysis: 1,
                    exclude_reason: "仅统计固定月供；提前还贷/异常金额已忽略".to_string(),
                });
                bump("skip_mortgage_early_or_unknown", Some(tx.amount_cents));
            }
            continue;
        }

        if tx.summary == "本行ATM无卡取款" && tx.amount_cents < 0 {
            rows.push(ClassifiedPdfRow {
                tx: tx.clone(),
                include_in_import: true,
                include_in_expense_analysis: true,
                rule_tag: "atm_cash".to_string(),
                expense_category: "ATM取现".to_string(),
                direction: "expense".to_string(),
                confidence: 0.99,
                needs_review: 0,
                excluded_in_analysis: 0,
                exclude_reason: String::new(),
            });
            bump("atm_cash", Some(tx.amount_cents));
            continue;
        }

        if BANK_TRANSFER_OUT_SUMMARIES.contains(&tx.summary.as_str()) && tx.amount_cents < 0 {
            if let Some(person_name) = looks_like_person_counterparty(&tx.counterparty) {
                if transfer_whitelist.contains(&person_name) {
                    rows.push(ClassifiedPdfRow {
                        tx: tx.clone(),
                        include_in_import: true,
                        include_in_expense_analysis: true,
                        rule_tag: "bank_transfer_whitelist".to_string(),
                        expense_category: format!("个人转账(白名单:{person_name})"),
                        direction: "expense".to_string(),
                        confidence: 0.95,
                        needs_review: 0,
                        excluded_in_analysis: 0,
                        exclude_reason: String::new(),
                    });
                    bump("bank_transfer_whitelist", Some(tx.amount_cents));
                } else {
                    rows.push(ClassifiedPdfRow {
                        tx: tx.clone(),
                        include_in_import: false,
                        include_in_expense_analysis: false,
                        rule_tag: "skip_bank_transfer_non_whitelist".to_string(),
                        expense_category: "银行卡个人转账(非白名单)".to_string(),
                        direction: "transfer".to_string(),
                        confidence: 0.9,
                        needs_review: 0,
                        excluded_in_analysis: 1,
                        exclude_reason: "银行卡个人转账仅统计白名单对象".to_string(),
                    });
                    bump("skip_bank_transfer_non_whitelist", Some(tx.amount_cents));
                }
                continue;
            }
        }

        if DEBIT_PAYMENT_SUMMARIES.contains(&tx.summary.as_str()) && tx.amount_cents < 0 {
            let counterparty = normalize_counterparty(&tx.counterparty);
            let is_wechat_p2p = ["快捷支付", "银联快捷支付"].contains(&tx.summary.as_str())
                && WECHAT_TRANSFER_PREFIXES
                    .iter()
                    .any(|p| counterparty.starts_with(p));
            if is_wechat_p2p {
                rows.push(ClassifiedPdfRow {
                    tx: tx.clone(),
                    include_in_import: true,
                    include_in_expense_analysis: true,
                    rule_tag: "wechat_transfer_redpacket".to_string(),
                    expense_category: "微信转账/红包".to_string(),
                    direction: "expense".to_string(),
                    confidence: 0.95,
                    needs_review: 0,
                    excluded_in_analysis: 0,
                    exclude_reason: String::new(),
                });
                bump("wechat_transfer_redpacket", Some(tx.amount_cents));
                continue;
            }

            let allow_quickpay_person_heuristic =
                QUICKPAY_PERSON_DETECTION_SUMMARIES.contains(&tx.summary.as_str());
            if allow_quickpay_person_heuristic {
                if let Some(person_name) = looks_like_person_counterparty(&counterparty) {
                    rows.push(ClassifiedPdfRow {
                        tx: tx.clone(),
                        include_in_import: false,
                        include_in_expense_analysis: false,
                        rule_tag: "skip_quickpay_person_non_whitelist".to_string(),
                        expense_category: format!("个人转账(非白名单:{person_name})"),
                        direction: "transfer".to_string(),
                        confidence: 0.85,
                        needs_review: 0,
                        excluded_in_analysis: 1,
                        exclude_reason: "个人转账仅统计微信转账/红包；快捷支付实名个人默认忽略"
                            .to_string(),
                    });
                    bump("skip_quickpay_person_non_whitelist", Some(tx.amount_cents));
                    continue;
                }
            }

            let fallback_category = if ["快捷支付", "银联快捷支付"].contains(&tx.summary.as_str())
            {
                "借记卡商户消费"
            } else {
                "借记卡直接商户消费"
            };
            let (category, conf, needs_review, match_source) = classify_debit_merchant_spend(
                &counterparty,
                merchant_map,
                category_rules,
                review_threshold,
                fallback_category,
            );
            rows.push(ClassifiedPdfRow {
                tx: tx.clone(),
                include_in_import: true,
                include_in_expense_analysis: true,
                rule_tag: if match_source == "fallback" {
                    "debit_merchant_spend".to_string()
                } else {
                    format!("debit_merchant_spend_{match_source}")
                },
                expense_category: category,
                direction: "expense".to_string(),
                confidence: conf,
                needs_review,
                excluded_in_analysis: 0,
                exclude_reason: String::new(),
            });
            bump("debit_merchant_spend", Some(tx.amount_cents));
            continue;
        }

        if is_skip_summary(&tx.summary) {
            rows.push(ClassifiedPdfRow {
                tx: tx.clone(),
                include_in_import: false,
                include_in_expense_analysis: false,
                rule_tag: "skip_irrelevant_summary".to_string(),
                expense_category: "忽略项".to_string(),
                direction: "other".to_string(),
                confidence: 0.99,
                needs_review: 0,
                excluded_in_analysis: 1,
                exclude_reason: "按规则忽略（投资/还款/转入等）".to_string(),
            });
            bump("skip_irrelevant_summary", Some(tx.amount_cents));
            continue;
        }

        rows.push(ClassifiedPdfRow {
            tx: tx.clone(),
            include_in_import: false,
            include_in_expense_analysis: false,
            rule_tag: "skip_unclassified".to_string(),
            expense_category: "未纳入口径".to_string(),
            direction: "other".to_string(),
            confidence: 0.5,
            needs_review: 1,
            excluded_in_analysis: 1,
            exclude_reason: "当前规则未纳入该类型".to_string(),
        });
        bump("skip_unclassified", Some(tx.amount_cents));
    }

    let total_records = records.len();
    let cny_records = records.iter().filter(|t| t.currency == "CNY").count();
    let non_cny_records = total_records.saturating_sub(cny_records);
    let import_rows_count = rows.iter().filter(|r| r.include_in_import).count();
    let expense_rows_count = rows
        .iter()
        .filter(|r| r.include_in_import && r.direction == "expense")
        .count();
    let income_rows_count = rows
        .iter()
        .filter(|r| r.include_in_import && r.direction == "income")
        .count();
    let expense_total_cents: i64 = rows
        .iter()
        .filter(|r| r.include_in_import && r.direction == "expense")
        .map(|r| r.tx.amount_cents)
        .sum();
    let income_total_cents: i64 = rows
        .iter()
        .filter(|r| r.include_in_import && r.direction == "income")
        .map(|r| r.tx.amount_cents)
        .sum();

    let samples_by_tag = |tag: &str| {
        rows.iter()
            .filter(|r| r.rule_tag == tag)
            .take(8)
            .map(|r| {
                json!({
                    "date": r.tx.date,
                    "amount": r.tx.amount_text,
                    "counterparty": r.tx.counterparty,
                })
            })
            .collect::<Vec<_>>()
    };

    let mortgage_profiles_json = mortgage_profiles
        .iter()
        .map(|(k, p)| {
            (
                k.clone(),
                json!({
                    "count": p.count,
                    "median_abs_amount_cents": p.median_abs_amount_cents,
                    "fixed_threshold_cents": p.fixed_threshold_cents,
                }),
            )
        })
        .collect::<serde_json::Map<String, Value>>();

    let preview = json!({
        "header": {
            "account_last4": header.account_last4,
            "range_start": header.range_start,
            "range_end": header.range_end,
        },
        "summary": {
            "total_records": total_records,
            "cny_records": cny_records,
            "non_cny_records": non_cny_records,
            "import_rows_count": import_rows_count,
            "expense_rows_count": expense_rows_count,
            "income_rows_count": income_rows_count,
            "expense_total_cents": expense_total_cents,
            "income_total_cents": income_total_cents,
            "skipped_rows_count": total_records.saturating_sub(import_rows_count),
            "date_start": records.first().map(|r| r.date.clone()),
            "date_end": records.last().map(|r| r.date.clone()),
        },
        "rule_counts": counters,
        "rule_amount_cents": amount_cents_by_tag,
        "mortgage_profiles": mortgage_profiles_json,
        "samples": {
            "salary": samples_by_tag("salary"),
            "mortgage_skipped": samples_by_tag("skip_mortgage_early_or_unknown"),
            "bank_transfer_whitelist": samples_by_tag("bank_transfer_whitelist"),
        }
    });

    (rows, preview)
}

fn stable_source_name(header: &PdfHeader) -> String {
    format!(
        "cmb_bank_statement_{}_{}_{}.pdf",
        header.account_last4, header.range_start, header.range_end
    )
}

fn build_preview_and_rows_with_rules_dir(
    pdf_path: &Path,
    review_threshold: f64,
    rules_root: &Path,
) -> Result<(PdfHeader, Vec<ClassifiedPdfRow>, Value), String> {
    let (header, records) = parse_pdf(pdf_path)?;
    let merchant_map = load_merchant_map(&rules_root.join("merchant_map.csv"));
    let category_rules = load_category_rules(&rules_root.join("category_rules.csv"));
    let transfer_whitelist =
        load_bank_transfer_whitelist_names(&rules_root.join("bank_transfer_whitelist.csv"));
    let (rows, mut preview) = classify_transactions(
        &header,
        &records,
        &transfer_whitelist,
        &merchant_map,
        &category_rules,
        review_threshold,
    );
    preview["file"] = json!({
        "path": pdf_path.to_string_lossy().to_string(),
        "name": pdf_path.file_name().and_then(|s| s.to_str()).unwrap_or_default(),
        "stable_source_name": stable_source_name(&header),
    });
    Ok((header, rows, preview))
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
    let mut names = HashSet::new();
    for r in rows {
        names.insert(r.map_err(|e| format!("读取数据库表失败: {e}"))?);
    }
    for required in ["accounts", "categories", "transactions", "import_jobs"] {
        if !names.contains(required) {
            return Err(format!("数据库缺少必要表: {required}。请先执行迁移。"));
        }
    }
    Ok(())
}

fn upsert_account(conn: &Connection, account_id: &str, account_name: &str) -> Result<(), String> {
    conn.execute(
        r#"
        INSERT INTO accounts(id, name, account_type, currency, initial_balance_cents)
        VALUES (?1, ?2, 'bank', 'CNY', 0)
        ON CONFLICT(id) DO UPDATE SET
            name=excluded.name,
            account_type='bank',
            updated_at=datetime('now')
        "#,
        params![account_id, account_name],
    )
    .map_err(|e| format!("写入银行账户失败: {e}"))?;
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

fn transaction_identity_base(row: &ClassifiedPdfRow, header: &PdfHeader) -> String {
    let source_name = stable_source_name(header);
    let tx = &row.tx;
    [
        source_name.as_str(),
        source_name.as_str(),
        &tx.date[0..4],
        &format!("{}", tx.date[5..7].parse::<u32>().unwrap_or(0)),
        tx.summary.as_str(),
        tx.date.as_str(),
        tx.date.as_str(),
        tx.raw_detail.as_str(),
        tx.amount_text.as_str(),
        header.account_last4.as_str(),
        "",
        "",
    ]
    .join("|")
}

fn transaction_id(
    row: &ClassifiedPdfRow,
    header: &PdfHeader,
    source_type: &str,
    occurrence_index: usize,
) -> String {
    let source = format!(
        "{source_type}|{}|{occurrence_index}",
        transaction_identity_base(row, header)
    );
    let mut hasher = Sha1::new();
    hasher.update(source.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn upsert_transaction(
    conn: &Connection,
    row: &ClassifiedPdfRow,
    header: &PdfHeader,
    tx_id: &str,
    category_id: &str,
    source_type: &str,
    import_job_id: &str,
) -> Result<(), String> {
    let source_name = stable_source_name(header);
    let account_id = format!("acct_cmb_debit_{}", header.account_last4);
    let account_name = format!("招行借记卡尾号{}", header.account_last4);
    let merchant = normalize_counterparty(&row.tx.counterparty);
    let merchant_normalized = normalize_merchant(&merchant);
    upsert_account(conn, &account_id, &account_name)?;
    upsert_category(conn, category_id, &row.expense_category)?;

    conn.execute(
        r#"
        INSERT INTO transactions(
            id, external_ref, occurred_at, posted_at, month_key, amount_cents, currency, direction,
            description, merchant, merchant_normalized, statement_category, category_id, account_id,
            source_type, source_file, import_job_id, confidence, needs_review, excluded_in_analysis, exclude_reason
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21)
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
                     AND SUBSTR(COALESCE(transactions.exclude_reason, ''), 1, 19) = ?22
                THEN 1
                ELSE excluded.excluded_in_analysis
            END,
            exclude_reason=CASE
                WHEN transactions.excluded_in_analysis = 1
                     AND SUBSTR(COALESCE(transactions.exclude_reason, ''), 1, 19) = ?22
                THEN transactions.exclude_reason
                ELSE excluded.exclude_reason
            END,
            updated_at=datetime('now')
        "#,
        params![
            tx_id,
            format!("{source_type}:{tx_id}"),
            row.tx.date,
            row.tx.date,
            &row.tx.date[..7],
            row.tx.amount_cents,
            row.tx.currency,
            row.direction,
            row.tx.raw_detail,
            merchant,
            merchant_normalized,
            row.tx.summary,
            category_id,
            account_id,
            source_type,
            source_name,
            import_job_id,
            row.confidence.clamp(0.0, 1.0),
            row.needs_review,
            row.excluded_in_analysis,
            row.exclude_reason,
            MANUAL_TX_EXCLUDE_REASON_PREFIX,
        ],
    )
    .map_err(|e| format!("写入 PDF 交易失败: {e}"))?;
    Ok(())
}

fn preview_at_path_with_rules_dir(
    pdf_path: &Path,
    review_threshold: f64,
    rules_root: &Path,
) -> Result<Value, String> {
    let (_header, _rows, preview) =
        build_preview_and_rows_with_rules_dir(pdf_path, review_threshold, rules_root)?;
    Ok(preview)
}

fn import_at_db_path(
    db_path: &Path,
    pdf_path: &Path,
    review_threshold: f64,
    source_type: &str,
    rules_root: &Path,
) -> Result<Value, String> {
    let (header, rows, preview) =
        build_preview_and_rows_with_rules_dir(pdf_path, review_threshold, rules_root)?;

    let conn = Connection::open(db_path).map_err(|e| format!("打开数据库失败: {e}"))?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|e| format!("设置 foreign_keys 失败: {e}"))?;
    ensure_schema_ready(&conn)?;

    let job_id = Uuid::new_v4().to_string();
    let started_at = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
    let metadata_json = serde_json::to_string(&json!({
        "source_path": pdf_path.to_string_lossy().to_string(),
        "source_type": source_type,
        "review_threshold": review_threshold,
        "stable_source_name": stable_source_name(&header),
    }))
    .map_err(|e| format!("序列化导入任务元数据失败: {e}"))?;

    conn.execute(
        r#"
        INSERT INTO import_jobs(id, source_type, source_file, status, started_at, total_count, imported_count, error_count, metadata_json)
        VALUES (?1, ?2, ?3, 'running', ?4, 0, 0, 0, ?5)
        "#,
        params![job_id, source_type, pdf_path.to_string_lossy().to_string(), started_at, metadata_json],
    )
    .map_err(|e| format!("创建导入任务失败: {e}"))?;

    let import_rows: Vec<&ClassifiedPdfRow> = rows.iter().filter(|r| r.include_in_import).collect();
    let total_count = i64::try_from(import_rows.len()).unwrap_or(i64::MAX);
    let mut imported_count = 0_i64;
    let mut error_count = 0_i64;
    let mut error_samples = Vec::<String>::new();
    let mut occurrence_counters: HashMap<String, usize> = HashMap::new();

    for row in import_rows {
        let identity = transaction_identity_base(row, &header);
        let occurrence = occurrence_counters.get(&identity).copied().unwrap_or(0) + 1;
        occurrence_counters.insert(identity, occurrence);
        let tx_id = transaction_id(row, &header, source_type, occurrence);
        let category_id = category_id_from_name(&row.expense_category);

        let step: Result<(), String> = (|| {
            let tx = conn
                .unchecked_transaction()
                .map_err(|e| format!("开始导入事务失败: {e}"))?;
            upsert_transaction(
                &tx,
                row,
                &header,
                &tx_id,
                &category_id,
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
        SET status='success', finished_at=?1, total_count=?2, imported_count=?3, error_count=?4, error_message=?5
        WHERE id=?6
        "#,
        params![
            finished_at,
            total_count,
            imported_count,
            error_count,
            if error_samples.is_empty() { None::<String> } else { Some(error_samples.join("\n")) },
            job_id,
        ],
    )
    .map_err(|e| format!("更新导入任务状态失败: {e}"))?;

    Ok(json!({
        "db_path": db_path.to_string_lossy().to_string(),
        "source_path": pdf_path.to_string_lossy().to_string(),
        "source_type": source_type,
        "review_threshold": review_threshold,
        "imported_count": imported_count,
        "import_error_count": error_count,
        "import_job_id": job_id,
        "preview": preview,
        "error_samples": error_samples,
    }))
}

#[tauri::command]
pub fn cmb_bank_pdf_preview(
    app: AppHandle,
    req: CmbBankPdfPreviewRequest,
) -> Result<Value, String> {
    let source_path = resolve_source_path_text(req.source_path)?;
    let review_threshold = resolve_review_threshold(req.review_threshold)?;
    let rules_dir = ensure_app_rules_dir_seeded(&app)?;
    preview_at_path_with_rules_dir(Path::new(&source_path), review_threshold, &rules_dir)
}

#[tauri::command]
pub fn cmb_bank_pdf_import(app: AppHandle, req: CmbBankPdfImportRequest) -> Result<Value, String> {
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
    import_at_db_path(
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
    use rusqlite::params;
    use std::fs;

    fn repo_root_for_tests() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("src-tauri parent")
            .parent()
            .expect("keepwise-tauri parent")
            .parent()
            .expect("apps parent")
            .to_path_buf()
    }

    fn temp_db_path(name: &str) -> PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!("keepwise_cmb_pdf_test_{}_{}.db", name, Uuid::new_v4()));
        p
    }

    fn apply_all_migrations(conn: &Connection) {
        let migrations_dir = repo_root_for_tests().join("db/migrations");
        let mut entries = fs::read_dir(&migrations_dir)
            .expect("read migrations")
            .map(|e| e.expect("dir entry").path())
            .filter(|p| p.extension().and_then(|e| e.to_str()) == Some("sql"))
            .collect::<Vec<_>>();
        entries.sort();
        for path in entries {
            let sql = fs::read_to_string(&path).expect("read migration");
            conn.execute_batch(&sql)
                .unwrap_or_else(|e| panic!("migration failed {}: {e}", path.display()));
        }
    }

    fn seeded_conn() -> Connection {
        let db_path = temp_db_path("seeded");
        let conn = Connection::open(&db_path).expect("open temp db");
        conn.execute_batch("PRAGMA foreign_keys = ON;")
            .expect("enable fk");
        apply_all_migrations(&conn);
        ensure_schema_ready(&conn).expect("schema ready");
        conn
    }

    fn sample_header() -> PdfHeader {
        PdfHeader {
            account_last4: "1234".to_string(),
            range_start: "2026-01-01".to_string(),
            range_end: "2026-01-31".to_string(),
        }
    }

    fn sample_row() -> ClassifiedPdfRow {
        ClassifiedPdfRow {
            tx: BankPdfTransaction {
                page: 1,
                date: "2026-01-15".to_string(),
                currency: "CNY".to_string(),
                amount_text: "-123.45".to_string(),
                amount_cents: -12_345,
                balance_text: "1000.00".to_string(),
                raw_detail: "银联消费 星巴克".to_string(),
                summary: "银联消费".to_string(),
                counterparty: "星巴克".to_string(),
            },
            include_in_import: true,
            include_in_expense_analysis: true,
            rule_tag: "debit_consume".to_string(),
            expense_category: "餐饮".to_string(),
            direction: "expense".to_string(),
            confidence: 0.95,
            needs_review: 0,
            excluded_in_analysis: 0,
            exclude_reason: String::new(),
        }
    }

    fn sample_bank_tx(
        date: &str,
        summary: &str,
        counterparty: &str,
        amount_cents: i64,
        currency: &str,
    ) -> BankPdfTransaction {
        let sign = if amount_cents >= 0 { "" } else { "-" };
        let abs = amount_cents.abs();
        let amount_text = format!("{sign}{}.{:02}", abs / 100, abs % 100);
        BankPdfTransaction {
            page: 1,
            date: date.to_string(),
            currency: currency.to_string(),
            amount_text,
            amount_cents,
            balance_text: "0.00".to_string(),
            raw_detail: format!("{summary} {counterparty}"),
            summary: summary.to_string(),
            counterparty: counterparty.to_string(),
        }
    }

    #[test]
    fn pdf_transaction_id_is_stable_for_same_occurrence() {
        let header = sample_header();
        let row = sample_row();
        let a = transaction_id(&row, &header, "cmb_bank_pdf", 1);
        let b = transaction_id(&row, &header, "cmb_bank_pdf", 1);
        let c = transaction_id(&row, &header, "cmb_bank_pdf", 2);
        assert_eq!(a, b);
        assert_ne!(a, c);
    }

    #[test]
    fn pdf_upsert_transaction_is_idempotent_for_same_tx_id() {
        let conn = seeded_conn();
        let header = sample_header();
        let row = sample_row();
        let tx_id = transaction_id(&row, &header, "cmb_bank_pdf", 1);
        let category_id = category_id_from_name(&row.expense_category);
        let import_job_id = Uuid::new_v4().to_string();

        conn.execute(
            r#"
            INSERT INTO import_jobs(id, source_type, source_file, status, started_at, total_count, imported_count, error_count)
            VALUES (?1, 'cmb_bank_pdf', 'sample.pdf', 'success', datetime('now'), 1, 1, 0)
            "#,
            params![import_job_id],
        )
        .expect("seed import job");

        upsert_transaction(
            &conn,
            &row,
            &header,
            &tx_id,
            &category_id,
            "cmb_bank_pdf",
            &import_job_id,
        )
        .expect("first upsert");
        upsert_transaction(
            &conn,
            &row,
            &header,
            &tx_id,
            &category_id,
            "cmb_bank_pdf",
            &import_job_id,
        )
        .expect("second upsert");

        let tx_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM transactions", [], |r| r.get(0))
            .expect("tx count");
        assert_eq!(tx_count, 1);

        let (merchant, account_id, source_type, amount_cents): (String, String, String, i64) = conn
            .query_row(
                "SELECT merchant, account_id, source_type, amount_cents FROM transactions WHERE id = ?1",
                params![tx_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .expect("load tx");
        assert_eq!(merchant, "星巴克");
        assert_eq!(account_id, "acct_cmb_debit_1234");
        assert_eq!(source_type, "cmb_bank_pdf");
        assert_eq!(amount_cents, -12_345);
    }

    #[test]
    fn pdf_classification_preview_summary_counts_are_consistent() {
        let header = sample_header();
        let records = vec![
            sample_bank_tx("2026-01-05", "代发工资", "某公司", 30_000_00, "CNY"),
            sample_bank_tx("2026-01-06", "代发住房公积金", "某公司", 5_000_00, "CNY"),
            sample_bank_tx("2026-01-07", "银联消费", "星巴克", -35_00, "CNY"),
            sample_bank_tx("2026-01-08", "转账汇款", "张三 6222021234567890", -200_00, "CNY"),
            sample_bank_tx("2026-01-09", "基金申购", "基金公司", -1000_00, "CNY"),
            sample_bank_tx("2026-01-10", "银联消费", "Tokyo Shop", -50_00, "USD"),
        ];
        let mut whitelist = HashSet::new();
        whitelist.insert("张三".to_string());
        let merchant_map = HashMap::from([(
            "星巴克".to_string(),
            ("餐饮".to_string(), 0.99_f64),
        )]);
        let category_rules = Vec::<CategoryRule>::new();

        let (rows, preview) = classify_transactions(
            &header,
            &records,
            &whitelist,
            &merchant_map,
            &category_rules,
            0.7,
        );
        assert_eq!(rows.len(), records.len());
        assert_eq!(preview["summary"]["total_records"].as_i64(), Some(6));
        assert_eq!(preview["summary"]["cny_records"].as_i64(), Some(5));
        assert_eq!(preview["summary"]["non_cny_records"].as_i64(), Some(1));
        assert_eq!(preview["summary"]["import_rows_count"].as_i64(), Some(4));
        assert_eq!(preview["summary"]["expense_rows_count"].as_i64(), Some(2));
        assert_eq!(preview["summary"]["income_rows_count"].as_i64(), Some(2));
        assert_eq!(preview["summary"]["skipped_rows_count"].as_i64(), Some(2));
        assert_eq!(preview["summary"]["expense_total_cents"].as_i64(), Some(-23500));
        assert_eq!(preview["summary"]["income_total_cents"].as_i64(), Some(3500000));

        assert_eq!(preview["rule_counts"]["salary"].as_i64(), Some(1));
        assert_eq!(preview["rule_counts"]["housing_fund_income"].as_i64(), Some(1));
        assert_eq!(preview["rule_counts"]["debit_merchant_spend"].as_i64(), Some(1));
        assert_eq!(preview["rule_counts"]["bank_transfer_whitelist"].as_i64(), Some(1));
        assert_eq!(preview["rule_counts"]["skip_irrelevant_summary"].as_i64(), Some(1));
        assert_eq!(preview["rule_counts"]["skip_non_cny"].as_i64(), Some(1));
    }

    #[test]
    fn pdf_debit_consume_chinese_merchant_is_not_misclassified_as_person_transfer() {
        let header = sample_header();
        let records = vec![sample_bank_tx(
            "2026-01-07",
            "银联消费",
            "星巴克",
            -35_00,
            "CNY",
        )];
        let whitelist = HashSet::<String>::new();
        let merchant_map = HashMap::from([(
            "星巴克".to_string(),
            ("餐饮".to_string(), 0.99_f64),
        )]);
        let category_rules = Vec::<CategoryRule>::new();

        let (rows, preview) = classify_transactions(
            &header,
            &records,
            &whitelist,
            &merchant_map,
            &category_rules,
            0.7,
        );

        assert_eq!(rows.len(), 1);
        assert_eq!(preview["summary"]["import_rows_count"].as_i64(), Some(1));
        assert_eq!(preview["summary"]["expense_rows_count"].as_i64(), Some(1));
        assert_eq!(preview["rule_counts"]["debit_merchant_spend"].as_i64(), Some(1));
        assert_eq!(
            preview["rule_counts"]["skip_quickpay_person_non_whitelist"]
                .as_i64()
                .unwrap_or(0),
            0
        );
        assert_eq!(rows[0].direction, "expense");
        assert_eq!(rows[0].expense_category, "餐饮");
    }
}
