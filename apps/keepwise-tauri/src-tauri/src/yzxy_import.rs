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

fn finalize_rows_with_inferred_assets(
    buckets: BTreeMap<String, Bucket>,
    errors: &mut Vec<String>,
) -> Vec<ParsedInvestmentRow> {
    let mut parsed = Vec::new();
    let mut last_known_assets_cents: Option<i64> = None;

    for (snapshot_date, item) in buckets {
        let mut total_assets_cents = item.total_assets_cents;
        let transfer_amount_cents = item.transfer_amount_cents;
        let has_total_assets = item.has_total_assets;

        if has_total_assets {
            last_known_assets_cents = Some(total_assets_cents);
        } else if let Some(last) = last_known_assets_cents {
            total_assets_cents = last + transfer_amount_cents;
            last_known_assets_cents = Some(total_assets_cents);
        } else if transfer_amount_cents != 0 {
            errors.push(format!(
                "{snapshot_date}: 缺少总资产金额且无可继承历史值，已跳过该日期"
            ));
            continue;
        }

        if total_assets_cents == 0 && transfer_amount_cents == 0 {
            continue;
        }

        parsed.push(ParsedInvestmentRow {
            snapshot_date,
            account_name: item.account_name,
            total_assets_cents,
            transfer_amount_cents,
        });
    }

    parsed
}

fn mapping_headers(
    header_row: &[String],
    mapping_idx: &HashMap<String, usize>,
) -> BTreeMap<String, String> {
    let mut mapping = BTreeMap::new();
    for (field, idx) in mapping_idx {
        if let Some(header) = header_row.get(*idx) {
            mapping.insert(field.clone(), trim_cell(header));
        }
    }
    mapping
}

fn parse_summary_rows(
    rows: &[Vec<String>],
    account_hint: &str,
) -> Result<
    (
        Vec<ParsedInvestmentRow>,
        Vec<String>,
        BTreeMap<String, String>,
    ),
    String,
> {
    let (header_idx, mapping_idx) = find_header_row(rows, SUMMARY_ALIAS_SPECS, &["snapshot_date"])?;
    let has_total_assets = mapping_idx.contains_key("total_assets");
    let has_transfer = mapping_idx.contains_key("transfer_amount")
        || (mapping_idx.contains_key("external_in") && mapping_idx.contains_key("external_out"));
    if !(has_total_assets && has_transfer) {
        return Err(
            "摘要记录缺少必要列：需要日期、总资产以及转入转出金额（或外部转入/转出）".to_string(),
        );
    }

    let mapping = mapping_headers(&rows[header_idx], &mapping_idx);
    let mut buckets: BTreeMap<String, Bucket> = BTreeMap::new();
    let mut errors = Vec::new();

    for (offset, row) in rows[(header_idx + 1)..].iter().enumerate() {
        let line_no = header_idx + 2 + offset;
        if row.iter().all(|c| trim_cell(c).is_empty()) {
            continue;
        }
        let res: Result<(), String> = (|| {
            let snapshot_raw = row_get(row, mapping_idx.get("snapshot_date").copied());
            if snapshot_raw.is_empty() {
                return Ok(());
            }
            let snapshot_date = normalize_date_flexible(&snapshot_raw)?;
            let account_name = {
                let v = row_get(row, mapping_idx.get("account_name").copied());
                if v.is_empty() {
                    account_hint.to_string()
                } else {
                    v
                }
            };

            let bucket = buckets.entry(snapshot_date.clone()).or_default();
            if bucket.account_name.is_empty() && !account_name.is_empty() {
                bucket.account_name = account_name;
            } else if !account_name.is_empty() {
                bucket.account_name = account_name;
            }

            let total_assets_text = row_get(row, mapping_idx.get("total_assets").copied());
            if !total_assets_text.is_empty() {
                bucket.total_assets_cents = parse_amount_to_cents(&total_assets_text)?;
                bucket.has_total_assets = true;
            }

            let transfer_amount_cents = {
                let transfer_text = row_get(row, mapping_idx.get("transfer_amount").copied());
                if !transfer_text.is_empty() {
                    parse_amount_to_cents(&transfer_text)?
                } else {
                    parse_amount_to_cents(&row_get(row, mapping_idx.get("external_in").copied()))?
                        - parse_amount_to_cents(&row_get(
                            row,
                            mapping_idx.get("external_out").copied(),
                        ))?
                }
            };
            bucket.transfer_amount_cents += transfer_amount_cents;
            Ok(())
        })();
        if let Err(err) = res {
            errors.push(format!("第{line_no}行: {err}"));
        }
    }

    let parsed = finalize_rows_with_inferred_assets(buckets, &mut errors);
    Ok((parsed, errors, mapping))
}

fn parse_manual_rows(
    rows: &[Vec<String>],
    account_hint: &str,
) -> Result<
    (
        Vec<ParsedInvestmentRow>,
        Vec<String>,
        BTreeMap<String, String>,
    ),
    String,
> {
    let (header_idx, mapping_idx) =
        find_header_row(rows, MANUAL_ALIAS_SPECS, &["record_type", "snapshot_date"])?;
    if !mapping_idx.contains_key("transfer_amount") && !mapping_idx.contains_key("total_assets") {
        return Err("手动记录缺少转入转出金额或总资产金额列".to_string());
    }

    let mapping = mapping_headers(&rows[header_idx], &mapping_idx);
    let mut buckets: BTreeMap<String, Bucket> = BTreeMap::new();
    let mut errors = Vec::new();

    for (offset, row) in rows[(header_idx + 1)..].iter().enumerate() {
        let line_no = header_idx + 2 + offset;
        if row.iter().all(|c| trim_cell(c).is_empty()) {
            continue;
        }

        let record_type = row_get(row, mapping_idx.get("record_type").copied());
        let date_raw = row_get(row, mapping_idx.get("snapshot_date").copied());
        if record_type.is_empty() && date_raw.is_empty() {
            continue;
        }

        let res: Result<(), String> = (|| {
            let snapshot_date = normalize_date_flexible(&date_raw)?;
            let account_name = {
                let v = row_get(row, mapping_idx.get("account_name").copied());
                if v.is_empty() {
                    account_hint.to_string()
                } else {
                    v
                }
            };

            let bucket = buckets.entry(snapshot_date.clone()).or_default();
            if !account_name.is_empty() {
                bucket.account_name = account_name;
            }

            let transfer_text = row_get(row, mapping_idx.get("transfer_amount").copied());
            if !transfer_text.is_empty() {
                bucket.transfer_amount_cents += parse_amount_to_cents(&transfer_text)?;
            }

            let total_assets_text = row_get(row, mapping_idx.get("total_assets").copied());
            if !total_assets_text.is_empty() {
                bucket.total_assets_cents = parse_amount_to_cents(&total_assets_text)?;
                bucket.has_total_assets = true;
            }
            Ok(())
        })();
        if let Err(err) = res {
            errors.push(format!("第{line_no}行: {err}"));
        }
    }

    let parsed = finalize_rows_with_inferred_assets(buckets, &mut errors);
    Ok((parsed, errors, mapping))
}

fn read_csv_rows(path: &Path) -> Result<Vec<Vec<String>>, String> {
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(false)
        .flexible(true)
        .from_path(path)
        .map_err(|e| format!("读取 CSV 失败: {e}"))?;

    let mut rows = Vec::new();
    for rec in reader.records() {
        let rec = rec.map_err(|e| format!("读取 CSV 行失败: {e}"))?;
        rows.push(rec.iter().map(trim_cell).collect());
    }
    Ok(rows)
}

fn read_xlsx_rows(path: &Path) -> Result<Vec<Vec<String>>, String> {
    let mut workbook = open_workbook_auto(path).map_err(|e| format!("打开 xlsx 失败: {e}"))?;
    let sheet_names = workbook.sheet_names().to_owned();
    let first_sheet = sheet_names
        .first()
        .cloned()
        .ok_or_else(|| "xlsx 中未找到工作表".to_string())?;

    let range = workbook
        .worksheet_range(&first_sheet)
        .map_err(|e| format!("读取 xlsx 工作表失败: {e}"))?;

    let rows = range
        .rows()
        .map(|row| {
            row.iter()
                .map(|cell| trim_cell(&cell.to_string()))
                .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>();
    Ok(rows)
}

fn parse_input_file(file_path: &Path) -> Result<ParseInputFileResult, String> {
    if !file_path.exists() {
        return Err(format!("未找到导入文件: {}", file_path.to_string_lossy()));
    }
    if !file_path.is_file() {
        return Err(format!("导入路径不是文件: {}", file_path.to_string_lossy()));
    }

    let suffix = file_path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    let rows = match suffix.as_str() {
        "csv" => read_csv_rows(file_path)?,
        "xlsx" => read_xlsx_rows(file_path)?,
        _ => {
            return Err(format!(
                "不支持的文件格式: .{}（仅支持 .csv/.xlsx）",
                suffix
            ))
        }
    };

    let account_hint = extract_account_name_hint(&rows, "有知有行投资账户");

    if let Ok((manual_rows, manual_errors, manual_mapping)) =
        parse_manual_rows(&rows, &account_hint)
    {
        if !manual_rows.is_empty() || !manual_errors.is_empty() {
            return Ok(ParseInputFileResult {
                rows: manual_rows,
                errors: manual_errors,
                mapping: manual_mapping,
                parser_kind: "manual_ledger".to_string(),
            });
        }
    }

    let (summary_rows, summary_errors, summary_mapping) = parse_summary_rows(&rows, &account_hint)?;
    Ok(ParseInputFileResult {
        rows: summary_rows,
        errors: summary_errors,
        mapping: summary_mapping,
        parser_kind: "summary".to_string(),
    })
}

fn account_id_from_name(account_name: &str) -> String {
    let digest = Uuid::new_v5(
        &Uuid::NAMESPACE_URL,
        format!("keepwise:investment:{account_name}").as_bytes(),
    );
    let hex = digest.simple().to_string();
    format!("acct_inv_{}", &hex[..12])
}

fn ensure_schema_ready(conn: &Connection) -> Result<(), String> {
    let mut stmt = conn
        .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('accounts','investment_records','import_jobs')",
        )
        .map_err(|e| format!("检查数据库表失败: {e}"))?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| format!("读取数据库表失败: {e}"))?;
    let mut table_names = HashSet::new();
    for row in rows {
        table_names.insert(row.map_err(|e| format!("读取数据库表失败: {e}"))?);
    }
    let required_tables = ["accounts", "investment_records", "import_jobs"];
    let missing_tables = required_tables
        .iter()
        .filter(|t| !table_names.contains(**t))
        .copied()
        .collect::<Vec<_>>();
    if !missing_tables.is_empty() {
        return Err(format!(
            "数据库缺少必要表: {}。请先执行迁移。",
            missing_tables.join(", ")
        ));
    }

    let mut stmt = conn
        .prepare("PRAGMA table_info(investment_records)")
        .map_err(|e| format!("读取 investment_records 字段失败: {e}"))?;
    let cols = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| format!("读取 investment_records 字段失败: {e}"))?;
    let mut col_set = HashSet::new();
    for col in cols {
        col_set.insert(col.map_err(|e| format!("读取 investment_records 字段失败: {e}"))?);
    }
    let required_cols = [
        "account_id",
        "snapshot_date",
        "total_assets_cents",
        "transfer_amount_cents",
        "source_type",
        "source_file",
        "import_job_id",
    ];
    let missing_cols = required_cols
        .iter()
        .filter(|c| !col_set.contains(**c))
        .copied()
        .collect::<Vec<_>>();
    if !missing_cols.is_empty() {
        return Err(format!(
            "investment_records 缺少字段: {}。请执行最新迁移。",
            missing_cols.join(", ")
        ));
    }

    Ok(())
}

fn ensure_account(conn: &Connection, account_id: &str, account_name: &str) -> Result<(), String> {
    conn.execute(
        r#"
        INSERT INTO accounts(id, name, account_type, currency, initial_balance_cents)
        VALUES (?1, ?2, 'investment', 'CNY', 0)
        ON CONFLICT(id) DO UPDATE SET
            name=excluded.name,
            updated_at=datetime('now')
        "#,
        params![account_id, account_name],
    )
    .map_err(|e| format!("写入投资账户失败: {e}"))?;
    Ok(())
}

fn upsert_investment_record(
    conn: &Connection,
    account_id: &str,
    row: &ParsedInvestmentRow,
    source_type: &str,
    source_file: Option<&str>,
    import_job_id: Option<&str>,
) -> Result<(), String> {
    let rec_id = Uuid::new_v5(
        &Uuid::NAMESPACE_URL,
        format!("{account_id}:{}:{source_type}", row.snapshot_date).as_bytes(),
    )
    .to_string();

    conn.execute(
        r#"
        INSERT INTO investment_records(
            id, account_id, snapshot_date, total_assets_cents, transfer_amount_cents,
            source_type, source_file, import_job_id
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        ON CONFLICT(account_id, snapshot_date) DO UPDATE SET
            total_assets_cents=excluded.total_assets_cents,
            transfer_amount_cents=excluded.transfer_amount_cents,
            source_type=excluded.source_type,
            source_file=excluded.source_file,
            import_job_id=excluded.import_job_id,
            updated_at=datetime('now')
        "#,
        params![
            rec_id,
            account_id,
            row.snapshot_date,
            row.total_assets_cents,
            row.transfer_amount_cents,
            source_type,
            source_file,
            import_job_id,
        ],
    )
    .map_err(|e| format!("写入投资记录失败: {e}"))?;
    Ok(())
}

fn resolve_source_path_text(source_path: Option<String>) -> Result<String, String> {
    let path = source_path.unwrap_or_default();
    let path = path.trim().to_string();
    if path.is_empty() {
        return Err("source_path 必填".to_string());
    }
    Ok(path)
}

fn yzxy_preview_file_at_path(file_path: &Path) -> Result<Value, String> {
    let parsed = parse_input_file(file_path)?;
    let preview_rows = parsed
        .rows
        .iter()
        .take(10)
        .map(|row| {
            json!({
                "snapshot_date": row.snapshot_date,
                "account_name": row.account_name,
                "total_assets_cents": row.total_assets_cents,
                "transfer_amount_cents": row.transfer_amount_cents,
            })
        })
        .collect::<Vec<_>>();

    Ok(json!({
        "file": file_path.to_string_lossy().to_string(),
        "parser_kind": parsed.parser_kind,
        "mapping": parsed.mapping,
        "parsed_count": parsed.rows.len(),
        "error_count": parsed.errors.len(),
        "errors": parsed.errors.into_iter().take(20).collect::<Vec<_>>(),
        "preview_rows": preview_rows,
    }))
}

fn yzxy_import_file_at_db_path(
    db_path: &Path,
    file_path: &Path,
    source_type: &str,
) -> Result<Value, String> {
    let parsed = parse_input_file(file_path)?;

    let conn = Connection::open(db_path).map_err(|e| format!("打开数据库失败: {e}"))?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|e| format!("设置 foreign_keys 失败: {e}"))?;
    ensure_schema_ready(&conn)?;

    let job_id = Uuid::new_v4().to_string();
    let started_at = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
    let metadata_json = serde_json::to_string(&json!({
        "source_type": source_type,
        "source_file": file_path.to_string_lossy().to_string(),
        "parser_kind": parsed.parser_kind,
        "mapping": parsed.mapping,
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
            file_path.to_string_lossy().to_string(),
            started_at,
            metadata_json
        ],
    )
    .map_err(|e| format!("创建导入任务失败: {e}"))?;

    let total_count = (parsed.rows.len() + parsed.errors.len()) as i64;
    let mut imported_count = 0_i64;
    let mut error_count = parsed.errors.len() as i64;

    let mut db_error_samples = Vec::<String>::new();
    let file_text = file_path.to_string_lossy().to_string();
    for row in &parsed.rows {
        let account_id = account_id_from_name(&row.account_name);
        let step: Result<(), String> = (|| {
            let tx = conn
                .unchecked_transaction()
                .map_err(|e| format!("开始导入记录事务失败: {e}"))?;
            ensure_account(&tx, &account_id, &row.account_name)?;
            upsert_investment_record(
                &tx,
                &account_id,
                row,
                source_type,
                Some(&file_text),
                Some(&job_id),
            )?;
            tx.commit()
                .map_err(|e| format!("提交导入记录事务失败: {e}"))?;
            Ok(())
        })();

        match step {
            Ok(()) => imported_count += 1,
            Err(err) => {
                error_count += 1;
                if db_error_samples.len() < 20 {
                    db_error_samples.push(err);
                }
            }
        }
    }

    let finished_at = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
    let parse_error_samples = parsed.errors.iter().take(20).cloned().collect::<Vec<_>>();
    let mut all_error_samples = parse_error_samples;
    for item in db_error_samples {
        if all_error_samples.len() >= 20 {
            break;
        }
        all_error_samples.push(item);
    }
    let error_message = if all_error_samples.is_empty() {
        None
    } else {
        Some(all_error_samples.join("\n"))
    };

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
            error_message,
            job_id
        ],
    )
    .map_err(|e| format!("更新导入任务状态失败: {e}"))?;

    Ok(json!({
        "db_path": db_path.to_string_lossy().to_string(),
        "file": file_text,
        "source_type": source_type,
        "imported_count": imported_count,
        "error_count": error_count,
        "import_job_id": job_id,
        "preview": {
            "parser_kind": parsed.parser_kind,
            "mapping": parsed.mapping,
            "parsed_count": parsed.rows.len(),
            "parse_error_count": parsed.errors.len(),
            "errors": all_error_samples,
            "preview_rows": parsed.rows.iter().take(10).map(|row| json!({
                "snapshot_date": row.snapshot_date,
                "account_name": row.account_name,
                "total_assets_cents": row.total_assets_cents,
                "transfer_amount_cents": row.transfer_amount_cents,
            })).collect::<Vec<_>>()
        }
    }))
}

#[tauri::command]
pub fn yzxy_preview_file(req: YzxyPreviewRequest) -> Result<Value, String> {
    let source_path = resolve_source_path_text(req.source_path)?;
    yzxy_preview_file_at_path(Path::new(&source_path))
}

#[tauri::command]
pub fn yzxy_import_file(app: AppHandle, req: YzxyImportRequest) -> Result<Value, String> {
    let source_path = resolve_source_path_text(req.source_path)?;
    let source_type = req
        .source_type
        .unwrap_or_else(|| DEFAULT_SOURCE_TYPE.to_string());
    let source_type = source_type.trim();
    if source_type.is_empty() {
        return Err("source_type 不能为空".to_string());
    }

    let db_path = resolve_ledger_db_path(&app)?;
    yzxy_import_file_at_db_path(&db_path, Path::new(&source_path), source_type)
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

    fn create_temp_path(prefix: &str, ext: &str) -> PathBuf {
        let unique = format!("{prefix}_{}_{}.{}", std::process::id(), Uuid::new_v4(), ext);
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

    fn write_sample_yzxy_csv(path: &Path) {
        let csv = "\
日期,账户,总资产,转入转出金额\n\
2026-01-31,测试组合A,10000.00,1000.00\n\
2026-02-28,测试组合A,10800.00,-200.00\n";
        fs::write(path, csv).expect("write temp yzxy csv");
    }

    #[test]
    fn yzxy_csv_preview_and_import_are_idempotent() {
        let db_path = create_temp_path("keepwise_yzxy_import_test", "db");
        let csv_path = create_temp_path("keepwise_yzxy_fixture", "csv");
        write_sample_yzxy_csv(&csv_path);
        apply_all_migrations_for_test(&db_path);

        let preview = yzxy_preview_file_at_path(&csv_path).expect("preview yzxy csv");
        assert_eq!(preview.get("parsed_count").and_then(Value::as_i64), Some(2));
        assert_eq!(preview.get("error_count").and_then(Value::as_i64), Some(0));
        assert_eq!(
            preview.get("parser_kind").and_then(Value::as_str),
            Some("summary")
        );

        let import1 =
            yzxy_import_file_at_db_path(&db_path, &csv_path, "yzxy_csv").expect("first import");
        let import2 =
            yzxy_import_file_at_db_path(&db_path, &csv_path, "yzxy_csv").expect("second import");
        assert_eq!(import1.get("imported_count").and_then(Value::as_i64), Some(2));
        assert_eq!(import2.get("imported_count").and_then(Value::as_i64), Some(2));
        assert_eq!(import1.get("error_count").and_then(Value::as_i64), Some(0));
        assert_eq!(import2.get("error_count").and_then(Value::as_i64), Some(0));

        let conn = Connection::open(&db_path).expect("open temp db for verification");
        let inv_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM investment_records", [], |row| row.get(0))
            .expect("count investment_records");
        let acct_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM accounts WHERE account_type='investment'",
                [],
                |row| row.get(0),
            )
            .expect("count investment accounts");
        let import_job_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM import_jobs WHERE source_type='yzxy_csv'",
                [],
                |row| row.get(0),
            )
            .expect("count import_jobs");
        let latest_assets: i64 = conn
            .query_row(
                "SELECT total_assets_cents FROM investment_records WHERE snapshot_date='2026-02-28'",
                [],
                |row| row.get(0),
            )
            .expect("query latest assets");

        assert_eq!(inv_count, 2, "same file re-import should upsert, not duplicate");
        assert_eq!(acct_count, 1, "same account name should map to one investment account");
        assert_eq!(import_job_count, 2, "import jobs should record each import run");
        assert_eq!(latest_assets, 1_080_000);

        let _ = fs::remove_file(&csv_path);
        let _ = fs::remove_file(&db_path);
    }
}
