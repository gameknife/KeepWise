use csv::{ReaderBuilder, WriterBuilder};
use rusqlite::{params_from_iter, types::Value as SqlValue, Connection};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

use crate::ledger_db::resolve_ledger_db_path;

const MERCHANT_MAP_HEADERS: &[&str] = &[
    "merchant_normalized",
    "expense_category",
    "confidence",
    "note",
];
const CATEGORY_RULE_HEADERS: &[&str] = &[
    "priority",
    "match_type",
    "pattern",
    "expense_category",
    "confidence",
    "note",
];
const BANK_TRANSFER_WHITELIST_HEADERS: &[&str] = &["name", "is_active", "note"];
const ANALYSIS_EXCLUSION_HEADERS: &[&str] = &[
    "enabled",
    "rule_name",
    "merchant_contains",
    "description_contains",
    "expense_category",
    "min_amount",
    "max_amount",
    "start_date",
    "end_date",
    "reason",
];
const DEFAULT_BANK_TRANSFER_WHITELIST_ROWS: &[(&str, &str, &str)] =
    &[("徐凯", "1", "银行卡个人转账消费白名单（默认）")];
const RULE_MATCH_TYPES: &[&str] = &["exact", "contains", "prefix", "regex"];

#[derive(Debug, Deserialize)]
pub struct RulesListQueryRequest {
    pub keyword: Option<String>,
    pub limit: Option<u32>,
}

#[derive(Debug, Deserialize)]
pub struct MerchantMapUpsertRequest {
    pub merchant_normalized: Option<String>,
    pub expense_category: Option<String>,
    pub confidence: Option<String>,
    pub note: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct MerchantMapDeleteRequest {
    pub merchant_normalized: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CategoryRuleUpsertRequest {
    pub priority: Option<String>,
    pub match_type: Option<String>,
    pub pattern: Option<String>,
    pub expense_category: Option<String>,
    pub confidence: Option<String>,
    pub note: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CategoryRuleDeleteRequest {
    pub match_type: Option<String>,
    pub pattern: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct BankTransferWhitelistQueryRequest {
    pub keyword: Option<String>,
    pub limit: Option<u32>,
    pub active_only: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct BankTransferWhitelistUpsertRequest {
    pub name: Option<String>,
    pub is_active: Option<String>,
    pub note: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct BankTransferWhitelistDeleteRequest {
    pub name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct AnalysisExclusionQueryRequest {
    pub keyword: Option<String>,
    pub limit: Option<u32>,
    pub enabled_only: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct AnalysisExclusionUpsertRequest {
    pub enabled: Option<String>,
    pub rule_name: Option<String>,
    pub merchant_contains: Option<String>,
    pub description_contains: Option<String>,
    pub expense_category: Option<String>,
    pub min_amount: Option<String>,
    pub max_amount: Option<String>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub reason: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct AnalysisExclusionDeleteRequest {
    pub rule_name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct MerchantRuleSuggestionsQueryRequest {
    pub keyword: Option<String>,
    pub limit: Option<u32>,
    pub only_unmapped: Option<String>,
}

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..")
}

fn rules_dir() -> PathBuf {
    repo_root().join("data/rules")
}

fn ensure_rules_dir() -> Result<PathBuf, String> {
    let dir = rules_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("创建规则目录失败: {e}"))?;
    Ok(dir)
}

fn ensure_csv_file_with_headers(path: &Path, headers: &[&str]) -> Result<(), String> {
    if path.exists() {
        return Ok(());
    }
    let mut writer = WriterBuilder::new()
        .has_headers(true)
        .from_path(path)
        .map_err(|e| format!("创建规则文件失败 ({}): {e}", path.to_string_lossy()))?;
    writer
        .write_record(headers)
        .map_err(|e| format!("写入规则文件表头失败 ({}): {e}", path.to_string_lossy()))?;
    writer
        .flush()
        .map_err(|e| format!("刷新规则文件失败 ({}): {e}", path.to_string_lossy()))
}

fn read_csv_rows(path: &Path, headers: &[&str]) -> Result<Vec<BTreeMap<String, String>>, String> {
    let mut rows = Vec::<BTreeMap<String, String>>::new();
    let mut reader = ReaderBuilder::new()
        .flexible(true)
        .from_path(path)
        .map_err(|e| format!("读取规则文件失败 ({}): {e}", path.to_string_lossy()))?;
    for rec in reader.records() {
        let record = rec.map_err(|e| format!("解析规则文件失败 ({}): {e}", path.to_string_lossy()))?;
        let mut row = BTreeMap::<String, String>::new();
        let mut has_any = false;
        for (idx, key) in headers.iter().enumerate() {
            let val = record.get(idx).unwrap_or_default().trim().to_string();
            if !val.is_empty() {
                has_any = true;
            }
            row.insert((*key).to_string(), val);
        }
        if has_any {
            rows.push(row);
        }
    }
    Ok(rows)
}

fn write_csv_rows(path: &Path, headers: &[&str], rows: &[BTreeMap<String, String>]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建规则目录失败: {e}"))?;
    }
    let mut writer = WriterBuilder::new()
        .has_headers(true)
        .from_path(path)
        .map_err(|e| format!("打开规则文件写入失败 ({}): {e}", path.to_string_lossy()))?;
    writer
        .write_record(headers)
        .map_err(|e| format!("写入规则表头失败 ({}): {e}", path.to_string_lossy()))?;
    for row in rows {
        let record = headers
            .iter()
            .map(|h| row.get(*h).cloned().unwrap_or_default())
            .collect::<Vec<_>>();
        writer
            .write_record(record)
            .map_err(|e| format!("写入规则行失败 ({}): {e}", path.to_string_lossy()))?;
    }
    writer
        .flush()
        .map_err(|e| format!("刷新规则文件失败 ({}): {e}", path.to_string_lossy()))
}

fn ensure_merchant_map_file() -> Result<PathBuf, String> {
    let path = ensure_rules_dir()?.join("merchant_map.csv");
    ensure_csv_file_with_headers(&path, MERCHANT_MAP_HEADERS)?;
    Ok(path)
}

fn ensure_category_rules_file() -> Result<PathBuf, String> {
    let path = ensure_rules_dir()?.join("category_rules.csv");
    ensure_csv_file_with_headers(&path, CATEGORY_RULE_HEADERS)?;
    Ok(path)
}

fn ensure_analysis_exclusions_file() -> Result<PathBuf, String> {
    let path = ensure_rules_dir()?.join("analysis_exclusions.csv");
    ensure_csv_file_with_headers(&path, ANALYSIS_EXCLUSION_HEADERS)?;
    Ok(path)
}

fn ensure_bank_transfer_whitelist_file() -> Result<PathBuf, String> {
    let path = ensure_rules_dir()?.join("bank_transfer_whitelist.csv");
    ensure_csv_file_with_headers(&path, BANK_TRANSFER_WHITELIST_HEADERS)?;
    let mut rows = read_csv_rows(&path, BANK_TRANSFER_WHITELIST_HEADERS)?;
    let mut changed = false;
    for (name, is_active, note) in DEFAULT_BANK_TRANSFER_WHITELIST_ROWS {
        let exists = rows
            .iter()
            .any(|r| r.get("name").map(|v| v.trim()) == Some(*name));
        if !exists {
            let mut row = BTreeMap::<String, String>::new();
            row.insert("name".to_string(), (*name).to_string());
            row.insert("is_active".to_string(), (*is_active).to_string());
            row.insert("note".to_string(), (*note).to_string());
            rows.push(row);
            changed = true;
        }
    }
    if changed {
        sort_bank_transfer_rows(&mut rows);
        write_csv_rows(&path, BANK_TRANSFER_WHITELIST_HEADERS, &rows)?;
    }
    Ok(path)
}

fn parse_limit(raw: Option<u32>, default: u32) -> u32 {
    raw.unwrap_or(default).clamp(1, 500)
}

fn parse_confidence_text(raw: Option<String>, default: f64) -> Result<String, String> {
    let text = raw.unwrap_or_default().trim().to_string();
    if text.is_empty() {
        return Ok(format!("{default:.2}"));
    }
    let val = text
        .parse::<f64>()
        .map_err(|_| "confidence 必须是 0~1 之间的小数".to_string())?;
    if !(0.0..=1.0).contains(&val) {
        return Err("confidence 必须是 0~1 之间的小数".to_string());
    }
    Ok(format!("{val:.2}"))
}

fn parse_boolish(raw: Option<&str>, default: bool) -> Result<bool, String> {
    match raw.unwrap_or_default().trim().to_lowercase().as_str() {
        "" => Ok(default),
        "1" | "true" | "yes" | "y" | "on" => Ok(true),
        "0" | "false" | "no" | "n" | "off" => Ok(false),
        other => Err(format!("布尔参数不合法: {other}")),
    }
}

fn cents_to_yuan_text(cents: i64) -> String {
    format!("{:.2}", cents as f64 / 100.0)
}

fn row_to_json(headers: &[&str], row: &BTreeMap<String, String>) -> Value {
    let mut obj = serde_json::Map::new();
    for h in headers {
        obj.insert((*h).to_string(), json!(row.get(*h).cloned().unwrap_or_default()));
    }
    Value::Object(obj)
}

fn sort_bank_transfer_rows(rows: &mut [BTreeMap<String, String>]) {
    rows.sort_by(|a, b| {
        let a_active = parse_boolish(a.get("is_active").map(|s| s.as_str()), true).unwrap_or(true);
        let b_active = parse_boolish(b.get("is_active").map(|s| s.as_str()), true).unwrap_or(true);
        (!a_active)
            .cmp(&(!b_active))
            .then_with(|| a.get("name").unwrap_or(&String::new()).cmp(b.get("name").unwrap_or(&String::new())))
    });
}

fn sort_category_rows(rows: &mut [BTreeMap<String, String>]) {
    rows.sort_by(|a, b| {
        let ap = a
            .get("priority")
            .and_then(|v| v.parse::<i32>().ok())
            .unwrap_or(999);
        let bp = b
            .get("priority")
            .and_then(|v| v.parse::<i32>().ok())
            .unwrap_or(999);
        ap.cmp(&bp)
            .then_with(|| a.get("match_type").unwrap_or(&String::new()).cmp(b.get("match_type").unwrap_or(&String::new())))
            .then_with(|| a.get("pattern").unwrap_or(&String::new()).cmp(b.get("pattern").unwrap_or(&String::new())))
    });
}

fn sort_merchant_map_rows(rows: &mut [BTreeMap<String, String>]) {
    rows.sort_by(|a, b| {
        a.get("merchant_normalized")
            .unwrap_or(&String::new())
            .cmp(b.get("merchant_normalized").unwrap_or(&String::new()))
            .then_with(|| a.get("expense_category").unwrap_or(&String::new()).cmp(b.get("expense_category").unwrap_or(&String::new())))
    });
}

fn sort_analysis_exclusion_rows(rows: &mut [BTreeMap<String, String>]) {
    rows.sort_by(|a, b| {
        let a_enabled = parse_boolish(a.get("enabled").map(|s| s.as_str()), false).unwrap_or(false);
        let b_enabled = parse_boolish(b.get("enabled").map(|s| s.as_str()), false).unwrap_or(false);
        (!a_enabled)
            .cmp(&(!b_enabled))
            .then_with(|| a.get("rule_name").unwrap_or(&String::new()).cmp(b.get("rule_name").unwrap_or(&String::new())))
    });
}

#[tauri::command]
pub fn query_merchant_map_rules(req: Option<RulesListQueryRequest>) -> Result<Value, String> {
    let req = req.unwrap_or(RulesListQueryRequest { keyword: None, limit: None });
    let keyword = req.keyword.unwrap_or_default().trim().to_lowercase();
    let limit = parse_limit(req.limit, 200);
    let path = ensure_merchant_map_file()?;
    let mut rows = read_csv_rows(&path, MERCHANT_MAP_HEADERS)?;
    if !keyword.is_empty() {
        rows.retain(|row| {
            let hay = format!(
                "{} {} {}",
                row.get("merchant_normalized").cloned().unwrap_or_default(),
                row.get("expense_category").cloned().unwrap_or_default(),
                row.get("note").cloned().unwrap_or_default()
            )
            .to_lowercase();
            hay.contains(&keyword)
        });
    }
    sort_merchant_map_rows(&mut rows);
    rows.truncate(limit as usize);
    Ok(json!({
        "summary": {
            "count": rows.len(),
            "keyword": keyword,
            "limit": limit,
            "file_path": path.to_string_lossy().to_string(),
        },
        "rows": rows.iter().map(|r| row_to_json(MERCHANT_MAP_HEADERS, r)).collect::<Vec<_>>(),
    }))
}

#[tauri::command]
pub fn upsert_merchant_map_rule(req: MerchantMapUpsertRequest) -> Result<Value, String> {
    let merchant = req.merchant_normalized.unwrap_or_default().trim().to_string();
    let category = req.expense_category.unwrap_or_default().trim().to_string();
    let note = req.note.unwrap_or_default().trim().to_string();
    let confidence = parse_confidence_text(req.confidence, 0.95)?;
    if merchant.is_empty() {
        return Err("merchant_normalized 必填".to_string());
    }
    if category.is_empty() {
        return Err("expense_category 必填".to_string());
    }
    let path = ensure_merchant_map_file()?;
    let mut rows = read_csv_rows(&path, MERCHANT_MAP_HEADERS)?;
    let mut updated = false;
    for row in &mut rows {
        if row.get("merchant_normalized").map(|s| s.as_str()) == Some(merchant.as_str()) {
            row.insert("expense_category".to_string(), category.clone());
            row.insert("confidence".to_string(), confidence.clone());
            row.insert("note".to_string(), note.clone());
            updated = true;
            break;
        }
    }
    if !updated {
        let mut row = BTreeMap::<String, String>::new();
        row.insert("merchant_normalized".to_string(), merchant.clone());
        row.insert("expense_category".to_string(), category.clone());
        row.insert("confidence".to_string(), confidence.clone());
        row.insert("note".to_string(), note.clone());
        rows.push(row);
    }
    sort_merchant_map_rows(&mut rows);
    write_csv_rows(&path, MERCHANT_MAP_HEADERS, &rows)?;
    Ok(json!({
        "updated": updated,
        "file_path": path.to_string_lossy().to_string(),
        "row": {
            "merchant_normalized": merchant,
            "expense_category": category,
            "confidence": confidence,
            "note": note,
        }
    }))
}

#[tauri::command]
pub fn delete_merchant_map_rule(req: MerchantMapDeleteRequest) -> Result<Value, String> {
    let merchant = req.merchant_normalized.unwrap_or_default().trim().to_string();
    if merchant.is_empty() {
        return Err("merchant_normalized 必填".to_string());
    }
    let path = ensure_merchant_map_file()?;
    let mut rows = read_csv_rows(&path, MERCHANT_MAP_HEADERS)?;
    let before = rows.len();
    rows.retain(|row| row.get("merchant_normalized").map(|s| s.as_str()) != Some(merchant.as_str()));
    let deleted = before.saturating_sub(rows.len());
    write_csv_rows(&path, MERCHANT_MAP_HEADERS, &rows)?;
    Ok(json!({
        "deleted": deleted > 0,
        "deleted_count": deleted,
        "file_path": path.to_string_lossy().to_string(),
        "merchant_normalized": merchant,
    }))
}

#[tauri::command]
pub fn query_category_rules(req: Option<RulesListQueryRequest>) -> Result<Value, String> {
    let req = req.unwrap_or(RulesListQueryRequest { keyword: None, limit: None });
    let keyword = req.keyword.unwrap_or_default().trim().to_lowercase();
    let limit = parse_limit(req.limit, 200);
    let path = ensure_category_rules_file()?;
    let mut rows = read_csv_rows(&path, CATEGORY_RULE_HEADERS)?;
    if !keyword.is_empty() {
        rows.retain(|row| {
            let hay = format!(
                "{} {} {} {}",
                row.get("match_type").cloned().unwrap_or_default(),
                row.get("pattern").cloned().unwrap_or_default(),
                row.get("expense_category").cloned().unwrap_or_default(),
                row.get("note").cloned().unwrap_or_default()
            )
            .to_lowercase();
            hay.contains(&keyword)
        });
    }
    sort_category_rows(&mut rows);
    rows.truncate(limit as usize);
    Ok(json!({
        "summary": {
            "count": rows.len(),
            "keyword": keyword,
            "limit": limit,
            "file_path": path.to_string_lossy().to_string(),
        },
        "rows": rows.iter().map(|r| row_to_json(CATEGORY_RULE_HEADERS, r)).collect::<Vec<_>>(),
    }))
}

#[tauri::command]
pub fn upsert_category_rule(req: CategoryRuleUpsertRequest) -> Result<Value, String> {
    let match_type = req
        .match_type
        .unwrap_or_else(|| "contains".to_string())
        .trim()
        .to_lowercase();
    let pattern = req.pattern.unwrap_or_default().trim().to_string();
    let category = req.expense_category.unwrap_or_default().trim().to_string();
    let note = req.note.unwrap_or_default().trim().to_string();
    let confidence = parse_confidence_text(req.confidence, 0.70)?;
    if !RULE_MATCH_TYPES.iter().any(|v| *v == match_type) {
        return Err("match_type 仅支持 exact/contains/prefix/regex".to_string());
    }
    if pattern.is_empty() {
        return Err("pattern 必填".to_string());
    }
    if category.is_empty() {
        return Err("expense_category 必填".to_string());
    }
    let priority_text = req.priority.unwrap_or_else(|| "500".to_string()).trim().to_string();
    let priority = priority_text
        .parse::<i32>()
        .map_err(|_| "priority 必须是整数".to_string())?;

    let path = ensure_category_rules_file()?;
    let mut rows = read_csv_rows(&path, CATEGORY_RULE_HEADERS)?;
    let mut updated = false;
    for row in &mut rows {
        if row.get("match_type").map(|s| s.as_str()) == Some(match_type.as_str())
            && row.get("pattern").map(|s| s.as_str()) == Some(pattern.as_str())
        {
            row.insert("priority".to_string(), priority.to_string());
            row.insert("expense_category".to_string(), category.clone());
            row.insert("confidence".to_string(), confidence.clone());
            row.insert("note".to_string(), note.clone());
            updated = true;
            break;
        }
    }
    if !updated {
        let mut row = BTreeMap::<String, String>::new();
        row.insert("priority".to_string(), priority.to_string());
        row.insert("match_type".to_string(), match_type.clone());
        row.insert("pattern".to_string(), pattern.clone());
        row.insert("expense_category".to_string(), category.clone());
        row.insert("confidence".to_string(), confidence.clone());
        row.insert("note".to_string(), note.clone());
        rows.push(row);
    }
    sort_category_rows(&mut rows);
    write_csv_rows(&path, CATEGORY_RULE_HEADERS, &rows)?;
    Ok(json!({
        "updated": updated,
        "file_path": path.to_string_lossy().to_string(),
        "row": {
            "priority": priority.to_string(),
            "match_type": match_type,
            "pattern": pattern,
            "expense_category": category,
            "confidence": confidence,
            "note": note,
        }
    }))
}

#[tauri::command]
pub fn delete_category_rule(req: CategoryRuleDeleteRequest) -> Result<Value, String> {
    let match_type = req.match_type.unwrap_or_default().trim().to_lowercase();
    let pattern = req.pattern.unwrap_or_default().trim().to_string();
    if !RULE_MATCH_TYPES.iter().any(|v| *v == match_type) {
        return Err("match_type 仅支持 exact/contains/prefix/regex".to_string());
    }
    if pattern.is_empty() {
        return Err("pattern 必填".to_string());
    }
    let path = ensure_category_rules_file()?;
    let mut rows = read_csv_rows(&path, CATEGORY_RULE_HEADERS)?;
    let before = rows.len();
    rows.retain(|row| {
        !(row.get("match_type").map(|s| s.as_str()) == Some(match_type.as_str())
            && row.get("pattern").map(|s| s.as_str()) == Some(pattern.as_str()))
    });
    let deleted = before.saturating_sub(rows.len());
    write_csv_rows(&path, CATEGORY_RULE_HEADERS, &rows)?;
    Ok(json!({
        "deleted": deleted > 0,
        "deleted_count": deleted,
        "file_path": path.to_string_lossy().to_string(),
        "match_type": match_type,
        "pattern": pattern,
    }))
}

#[tauri::command]
pub fn query_bank_transfer_whitelist_rules(
    req: Option<BankTransferWhitelistQueryRequest>,
) -> Result<Value, String> {
    let req = req.unwrap_or(BankTransferWhitelistQueryRequest {
        keyword: None,
        limit: None,
        active_only: None,
    });
    let keyword = req.keyword.unwrap_or_default().trim().to_lowercase();
    let limit = parse_limit(req.limit, 200);
    let active_only = parse_boolish(req.active_only.as_deref(), false)?;
    let path = ensure_bank_transfer_whitelist_file()?;
    let mut rows = read_csv_rows(&path, BANK_TRANSFER_WHITELIST_HEADERS)?;
    rows.retain(|row| {
        let name = row.get("name").cloned().unwrap_or_default();
        if name.trim().is_empty() {
            return false;
        }
        let active = parse_boolish(row.get("is_active").map(|s| s.as_str()), true).unwrap_or(true);
        if active_only && !active {
            return false;
        }
        if keyword.is_empty() {
            return true;
        }
        let hay = format!("{} {}", name, row.get("note").cloned().unwrap_or_default()).to_lowercase();
        hay.contains(&keyword)
    });
    sort_bank_transfer_rows(&mut rows);
    rows.truncate(limit as usize);
    let normalized_rows = rows
        .iter()
        .map(|row| {
            json!({
                "name": row.get("name").cloned().unwrap_or_default(),
                "is_active": if parse_boolish(row.get("is_active").map(|s| s.as_str()), true).unwrap_or(true) { 1 } else { 0 },
                "note": row.get("note").cloned().unwrap_or_default(),
            })
        })
        .collect::<Vec<_>>();
    let active_count = normalized_rows
        .iter()
        .filter(|row| row.get("is_active").and_then(|v| v.as_i64()).unwrap_or(0) == 1)
        .count();
    Ok(json!({
        "summary": {
            "count": normalized_rows.len(),
            "active_count": active_count,
            "inactive_count": normalized_rows.len().saturating_sub(active_count),
            "keyword": keyword,
            "limit": limit,
            "active_only": active_only,
            "file_path": path.to_string_lossy().to_string(),
        },
        "rows": normalized_rows,
    }))
}

#[tauri::command]
pub fn upsert_bank_transfer_whitelist_rule(
    req: BankTransferWhitelistUpsertRequest,
) -> Result<Value, String> {
    let name = req.name.unwrap_or_default().trim().to_string();
    let note = req.note.unwrap_or_default().trim().to_string();
    let is_active = parse_boolish(req.is_active.as_deref(), true)?;
    if name.is_empty() {
        return Err("name 必填".to_string());
    }
    let path = ensure_bank_transfer_whitelist_file()?;
    let mut rows = read_csv_rows(&path, BANK_TRANSFER_WHITELIST_HEADERS)?;
    let mut updated = false;
    for row in &mut rows {
        if row.get("name").map(|s| s.as_str()) == Some(name.as_str()) {
            row.insert(
                "is_active".to_string(),
                if is_active { "1" } else { "0" }.to_string(),
            );
            row.insert("note".to_string(), note.clone());
            updated = true;
            break;
        }
    }
    if !updated {
        let mut row = BTreeMap::<String, String>::new();
        row.insert("name".to_string(), name.clone());
        row.insert(
            "is_active".to_string(),
            if is_active { "1" } else { "0" }.to_string(),
        );
        row.insert("note".to_string(), note.clone());
        rows.push(row);
    }
    sort_bank_transfer_rows(&mut rows);
    write_csv_rows(&path, BANK_TRANSFER_WHITELIST_HEADERS, &rows)?;
    Ok(json!({
        "updated": updated,
        "file_path": path.to_string_lossy().to_string(),
        "row": {
            "name": name,
            "is_active": if is_active { 1 } else { 0 },
            "note": note,
        }
    }))
}

#[tauri::command]
pub fn delete_bank_transfer_whitelist_rule(
    req: BankTransferWhitelistDeleteRequest,
) -> Result<Value, String> {
    let name = req.name.unwrap_or_default().trim().to_string();
    if name.is_empty() {
        return Err("name 必填".to_string());
    }
    let path = ensure_bank_transfer_whitelist_file()?;
    let mut rows = read_csv_rows(&path, BANK_TRANSFER_WHITELIST_HEADERS)?;
    let before = rows.len();
    rows.retain(|row| row.get("name").map(|s| s.as_str()) != Some(name.as_str()));
    let deleted = before.saturating_sub(rows.len());
    write_csv_rows(&path, BANK_TRANSFER_WHITELIST_HEADERS, &rows)?;
    Ok(json!({
        "deleted": deleted > 0,
        "deleted_count": deleted,
        "file_path": path.to_string_lossy().to_string(),
        "name": name,
    }))
}

#[tauri::command]
pub fn query_analysis_exclusion_rules(
    req: Option<AnalysisExclusionQueryRequest>,
) -> Result<Value, String> {
    let req = req.unwrap_or(AnalysisExclusionQueryRequest {
        keyword: None,
        limit: None,
        enabled_only: None,
    });
    let keyword = req.keyword.unwrap_or_default().trim().to_lowercase();
    let limit = parse_limit(req.limit, 200);
    let enabled_only = parse_boolish(req.enabled_only.as_deref(), false)?;
    let path = ensure_analysis_exclusions_file()?;
    let mut rows = read_csv_rows(&path, ANALYSIS_EXCLUSION_HEADERS)?;
    rows.retain(|row| {
        let enabled = parse_boolish(row.get("enabled").map(|s| s.as_str()), false).unwrap_or(false);
        if enabled_only && !enabled {
            return false;
        }
        if keyword.is_empty() {
            return true;
        }
        let hay = format!(
            "{} {} {} {} {}",
            row.get("rule_name").cloned().unwrap_or_default(),
            row.get("merchant_contains").cloned().unwrap_or_default(),
            row.get("description_contains").cloned().unwrap_or_default(),
            row.get("expense_category").cloned().unwrap_or_default(),
            row.get("reason").cloned().unwrap_or_default(),
        )
        .to_lowercase();
        hay.contains(&keyword)
    });
    sort_analysis_exclusion_rows(&mut rows);
    rows.truncate(limit as usize);
    let normalized_rows = rows
        .iter()
        .map(|row| {
            let mut obj = serde_json::Map::new();
            for h in ANALYSIS_EXCLUSION_HEADERS {
                if *h == "enabled" {
                    let enabled = parse_boolish(row.get("enabled").map(|s| s.as_str()), false).unwrap_or(false);
                    obj.insert((*h).to_string(), json!(if enabled { 1 } else { 0 }));
                } else {
                    obj.insert((*h).to_string(), json!(row.get(*h).cloned().unwrap_or_default()));
                }
            }
            Value::Object(obj)
        })
        .collect::<Vec<_>>();
    let enabled_count = normalized_rows
        .iter()
        .filter(|row| row.get("enabled").and_then(|v| v.as_i64()).unwrap_or(0) == 1)
        .count();
    Ok(json!({
        "summary": {
            "count": normalized_rows.len(),
            "enabled_count": enabled_count,
            "disabled_count": normalized_rows.len().saturating_sub(enabled_count),
            "keyword": keyword,
            "limit": limit,
            "enabled_only": enabled_only,
            "file_path": path.to_string_lossy().to_string(),
        },
        "rows": normalized_rows,
    }))
}

#[tauri::command]
pub fn upsert_analysis_exclusion_rule(req: AnalysisExclusionUpsertRequest) -> Result<Value, String> {
    let rule_name = req.rule_name.unwrap_or_default().trim().to_string();
    if rule_name.is_empty() {
        return Err("rule_name 必填".to_string());
    }
    let enabled = parse_boolish(req.enabled.as_deref(), true)?;
    let mut next = BTreeMap::<String, String>::new();
    next.insert("enabled".to_string(), if enabled { "1" } else { "0" }.to_string());
    next.insert("rule_name".to_string(), rule_name.clone());
    next.insert(
        "merchant_contains".to_string(),
        req.merchant_contains.unwrap_or_default().trim().to_string(),
    );
    next.insert(
        "description_contains".to_string(),
        req.description_contains.unwrap_or_default().trim().to_string(),
    );
    next.insert(
        "expense_category".to_string(),
        req.expense_category.unwrap_or_default().trim().to_string(),
    );
    next.insert("min_amount".to_string(), req.min_amount.unwrap_or_default().trim().to_string());
    next.insert("max_amount".to_string(), req.max_amount.unwrap_or_default().trim().to_string());
    next.insert("start_date".to_string(), req.start_date.unwrap_or_default().trim().to_string());
    next.insert("end_date".to_string(), req.end_date.unwrap_or_default().trim().to_string());
    next.insert(
        "reason".to_string(),
        {
            let v = req.reason.unwrap_or_default().trim().to_string();
            if v.is_empty() { "排除分析".to_string() } else { v }
        },
    );

    let path = ensure_analysis_exclusions_file()?;
    let mut rows = read_csv_rows(&path, ANALYSIS_EXCLUSION_HEADERS)?;
    let mut updated = false;
    for row in &mut rows {
        if row.get("rule_name").map(|s| s.as_str()) == Some(rule_name.as_str()) {
            *row = next.clone();
            updated = true;
            break;
        }
    }
    if !updated {
        rows.push(next.clone());
    }
    sort_analysis_exclusion_rows(&mut rows);
    write_csv_rows(&path, ANALYSIS_EXCLUSION_HEADERS, &rows)?;
    let mut obj = serde_json::Map::new();
    for h in ANALYSIS_EXCLUSION_HEADERS {
        if *h == "enabled" {
            obj.insert((*h).to_string(), json!(if enabled { 1 } else { 0 }));
        } else {
            obj.insert((*h).to_string(), json!(next.get(*h).cloned().unwrap_or_default()));
        }
    }
    Ok(json!({
        "updated": updated,
        "file_path": path.to_string_lossy().to_string(),
        "row": Value::Object(obj),
    }))
}

#[tauri::command]
pub fn delete_analysis_exclusion_rule(req: AnalysisExclusionDeleteRequest) -> Result<Value, String> {
    let rule_name = req.rule_name.unwrap_or_default().trim().to_string();
    if rule_name.is_empty() {
        return Err("rule_name 必填".to_string());
    }
    let path = ensure_analysis_exclusions_file()?;
    let mut rows = read_csv_rows(&path, ANALYSIS_EXCLUSION_HEADERS)?;
    let before = rows.len();
    rows.retain(|row| row.get("rule_name").map(|s| s.as_str()) != Some(rule_name.as_str()));
    let deleted = before.saturating_sub(rows.len());
    write_csv_rows(&path, ANALYSIS_EXCLUSION_HEADERS, &rows)?;
    Ok(json!({
        "deleted": deleted > 0,
        "deleted_count": deleted,
        "file_path": path.to_string_lossy().to_string(),
        "rule_name": rule_name,
    }))
}

#[tauri::command]
pub fn query_merchant_rule_suggestions(
    app: AppHandle,
    req: Option<MerchantRuleSuggestionsQueryRequest>,
) -> Result<Value, String> {
    let req = req.unwrap_or(MerchantRuleSuggestionsQueryRequest {
        keyword: None,
        limit: None,
        only_unmapped: None,
    });
    let limit = parse_limit(req.limit, 200);
    let keyword = req.keyword.unwrap_or_default().trim().to_lowercase();
    let only_unmapped = parse_boolish(req.only_unmapped.as_deref(), true)?;

    let merchant_map_path = ensure_merchant_map_file()?;
    let merchant_map_rows = read_csv_rows(&merchant_map_path, MERCHANT_MAP_HEADERS)?;
    let mut merchant_map: HashMap<String, (String, f64, String)> = HashMap::new();
    for row in merchant_map_rows {
        let merchant = row
            .get("merchant_normalized")
            .cloned()
            .unwrap_or_default()
            .trim()
            .to_string();
        if merchant.is_empty() {
            continue;
        }
        let category = row
            .get("expense_category")
            .cloned()
            .unwrap_or_default()
            .trim()
            .to_string();
        if category.is_empty() {
            continue;
        }
        let confidence = row
            .get("confidence")
            .and_then(|v| v.trim().parse::<f64>().ok())
            .filter(|v| (0.0..=1.0).contains(v))
            .unwrap_or(0.95);
        let note = row.get("note").cloned().unwrap_or_default();
        merchant_map.insert(merchant, (category, confidence, note));
    }

    let db_path = resolve_ledger_db_path(&app)?;
    let conn = Connection::open(&db_path).map_err(|e| format!("打开数据库失败: {e}"))?;

    let mut params: Vec<SqlValue> = Vec::new();
    let keyword_clause = if keyword.is_empty() {
        String::new()
    } else {
        params.push(SqlValue::Text(format!("%{keyword}%")));
        "AND t.merchant_normalized LIKE ?1".to_string()
    };
    let limit_placeholder = if keyword.is_empty() { "?1" } else { "?2" };
    params.push(SqlValue::Integer(limit as i64));

    let sql = format!(
        r#"
        SELECT
            t.merchant_normalized,
            COUNT(*) AS txn_count,
            COALESCE(SUM(t.amount_cents), 0) AS total_amount_cents,
            SUM(CASE WHEN t.needs_review = 1 THEN 1 ELSE 0 END) AS review_count,
            (
                SELECT c2.name
                FROM transactions t2
                LEFT JOIN categories c2 ON c2.id = t2.category_id
                WHERE t2.statement_category = '消费'
                  AND t2.merchant_normalized = t.merchant_normalized
                  AND COALESCE(c2.name, '') != ''
                GROUP BY c2.name
                ORDER BY COUNT(*) DESC, c2.name
                LIMIT 1
            ) AS suggested_expense_category
        FROM transactions t
        WHERE t.statement_category = '消费'
          AND COALESCE(t.merchant_normalized, '') != ''
          {keyword_clause}
        GROUP BY t.merchant_normalized
        ORDER BY review_count DESC, txn_count DESC, total_amount_cents DESC
        LIMIT {limit_placeholder}
        "#
    );

    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("查询 merchant suggestions 失败: {e}"))?;
    let iter = stmt
        .query_map(params_from_iter(params.iter()), |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, Option<String>>(4)?,
            ))
        })
        .map_err(|e| format!("查询 merchant suggestions 失败: {e}"))?;

    let mut rows = Vec::<Value>::new();
    for rec in iter {
        let (merchant_normalized, txn_count, total_amount_cents, review_count, suggested_category_opt) =
            rec.map_err(|e| format!("读取 merchant suggestions 结果失败: {e}"))?;
        let mapped = merchant_map.get(&merchant_normalized);
        if only_unmapped && mapped.is_some() {
            continue;
        }
        let (mapped_expense_category, mapped_confidence, mapped_note) = match mapped {
            Some((c, conf, note)) => (c.clone(), Some(*conf), note.clone()),
            None => ("".to_string(), None, "".to_string()),
        };
        let suggested_expense_category = suggested_category_opt.unwrap_or_default().trim().to_string();
        rows.push(json!({
            "merchant_normalized": merchant_normalized,
            "txn_count": txn_count,
            "total_amount_cents": total_amount_cents,
            "total_amount_yuan": cents_to_yuan_text(total_amount_cents),
            "review_count": review_count,
            "suggested_expense_category": suggested_expense_category,
            "mapped_expense_category": mapped_expense_category,
            "mapped_confidence": mapped_confidence.map(|v| (v * 100.0).round() / 100.0),
            "mapped_note": mapped_note,
        }));
    }

    Ok(json!({
        "summary": {
            "count": rows.len(),
            "limit": limit,
            "only_unmapped": only_unmapped,
            "keyword": keyword,
            "file_path": merchant_map_path.to_string_lossy().to_string(),
            "db_path": db_path.to_string_lossy().to_string(),
        },
        "rows": rows,
    }))
}
