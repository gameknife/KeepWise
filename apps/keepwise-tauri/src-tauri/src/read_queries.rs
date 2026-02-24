use chrono::NaiveDate;
use rusqlite::{params_from_iter, types::Value as SqlValue, Connection};
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::Path;
use tauri::AppHandle;

use crate::ledger_db::resolve_ledger_db_path;

const MANUAL_TX_EXCLUDE_REASON_PREFIX: &str = "[manual_tx_exclude]";
const SUPPORTED_ASSET_CLASSES: &[&str] = &["cash", "real_estate", "liability"];

#[derive(Debug, Deserialize)]
pub struct MetaAccountsQueryRequest {
    pub kind: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct TransactionsQueryRequest {
    pub limit: Option<u32>,
    pub month_key: Option<String>,
    pub source_type: Option<String>,
    pub account_id: Option<String>,
    pub keyword: Option<String>,
    pub sort: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct InvestmentsQueryRequest {
    pub limit: Option<u32>,
    #[serde(rename = "from")]
    pub from_date: Option<String>,
    #[serde(rename = "to")]
    pub to_date: Option<String>,
    pub source_type: Option<String>,
    pub account_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct AssetValuationsQueryRequest {
    pub limit: Option<u32>,
    #[serde(rename = "from")]
    pub from_date: Option<String>,
    #[serde(rename = "to")]
    pub to_date: Option<String>,
    pub asset_class: Option<String>,
    pub account_id: Option<String>,
}

fn cents_to_yuan_text(cents: i64) -> String {
    format!("{:.2}", cents as f64 / 100.0)
}

fn parse_limit(raw: Option<u32>, default_limit: u32, max_limit: u32) -> u32 {
    raw.unwrap_or(default_limit).clamp(1, max_limit)
}

fn parse_optional_text(raw: Option<String>) -> String {
    raw.unwrap_or_default().trim().to_string()
}

fn parse_optional_date_text(raw: Option<String>, field_name: &str) -> Result<String, String> {
    let text = parse_optional_text(raw);
    if text.is_empty() {
        return Ok(text);
    }
    NaiveDate::parse_from_str(&text, "%Y-%m-%d")
        .map_err(|_| format!("{field_name} 日期格式必须为 YYYY-MM-DD"))?;
    Ok(text)
}

pub fn meta_accounts_query_at_db_path(
    db_path: &Path,
    req: MetaAccountsQueryRequest,
) -> Result<Value, String> {
    let kind = parse_optional_text(req.kind).to_lowercase();
    let kind = if kind.is_empty() {
        "all".to_string()
    } else {
        kind
    };
    if !["all", "investment", "cash", "real_estate", "liability"].contains(&kind.as_str()) {
        return Err("kind 仅支持 all/investment/cash/real_estate/liability".to_string());
    }

    let conn = Connection::open(db_path).map_err(|e| format!("打开数据库失败: {e}"))?;

    let mut inv_stmt = conn
        .prepare(
            r#"
            SELECT
                r.account_id,
                COALESCE(a.name, r.account_id) AS account_name,
                COUNT(*) AS record_count,
                MIN(r.snapshot_date) AS first_snapshot_date,
                MAX(r.snapshot_date) AS latest_snapshot_date
            FROM investment_records r
            LEFT JOIN accounts a ON a.id = r.account_id
            GROUP BY r.account_id
            ORDER BY latest_snapshot_date DESC, account_name
            "#,
        )
        .map_err(|e| format!("查询投资账户失败: {e}"))?;
    let inv_iter = inv_stmt
        .query_map([], |row| {
            Ok(json!({
                "account_id": row.get::<_, String>(0)?,
                "account_name": row.get::<_, String>(1)?,
                "record_count": row.get::<_, i64>(2)?,
                "first_snapshot_date": row.get::<_, String>(3)?,
                "latest_snapshot_date": row.get::<_, String>(4)?,
            }))
        })
        .map_err(|e| format!("查询投资账户失败: {e}"))?;
    let mut investment_items = Vec::<Value>::new();
    for row in inv_iter {
        investment_items.push(row.map_err(|e| format!("读取投资账户失败: {e}"))?);
    }

    let mut asset_stmt = conn
        .prepare(
            r#"
            SELECT
                v.account_id,
                v.account_name,
                v.asset_class,
                COUNT(*) AS record_count,
                MIN(v.snapshot_date) AS first_snapshot_date,
                MAX(v.snapshot_date) AS latest_snapshot_date
            FROM account_valuations v
            GROUP BY v.account_id, v.asset_class
            ORDER BY latest_snapshot_date DESC, v.account_name
            "#,
        )
        .map_err(|e| format!("查询资产账户失败: {e}"))?;
    let asset_iter = asset_stmt
        .query_map([], |row| {
            Ok(json!({
                "account_id": row.get::<_, String>(0)?,
                "account_name": row.get::<_, String>(1)?,
                "asset_class": row.get::<_, String>(2)?,
                "record_count": row.get::<_, i64>(3)?,
                "first_snapshot_date": row.get::<_, String>(4)?,
                "latest_snapshot_date": row.get::<_, String>(5)?,
            }))
        })
        .map_err(|e| format!("查询资产账户失败: {e}"))?;
    let mut cash_items = Vec::<Value>::new();
    let mut real_estate_items = Vec::<Value>::new();
    let mut liability_items = Vec::<Value>::new();
    for row in asset_iter {
        let item = row.map_err(|e| format!("读取资产账户失败: {e}"))?;
        match item
            .get("asset_class")
            .and_then(Value::as_str)
            .unwrap_or_default()
        {
            "cash" => cash_items.push(item),
            "real_estate" => real_estate_items.push(item),
            "liability" => liability_items.push(item),
            _ => {}
        }
    }

    let accounts = match kind.as_str() {
        "investment" => investment_items.clone(),
        "cash" => cash_items.clone(),
        "real_estate" => real_estate_items.clone(),
        "liability" => liability_items.clone(),
        _ => {
            let mut out = Vec::new();
            out.extend(investment_items.clone());
            out.extend(cash_items.clone());
            out.extend(real_estate_items.clone());
            out.extend(liability_items.clone());
            out
        }
    };

    Ok(json!({
        "kind": kind,
        "accounts": accounts,
        "investment_accounts": investment_items,
        "cash_accounts": cash_items,
        "real_estate_accounts": real_estate_items,
        "liability_accounts": liability_items,
    }))
}

pub fn query_asset_valuations_at_db_path(
    db_path: &Path,
    req: AssetValuationsQueryRequest,
) -> Result<Value, String> {
    let limit = parse_limit(req.limit, 100, 500) as i64;
    let date_from = parse_optional_date_text(req.from_date, "from")?;
    let date_to = parse_optional_date_text(req.to_date, "to")?;
    let asset_class = parse_optional_text(req.asset_class).to_lowercase();
    let account_id = parse_optional_text(req.account_id);

    if !asset_class.is_empty() && !SUPPORTED_ASSET_CLASSES.contains(&asset_class.as_str()) {
        return Err("asset_class 仅支持 cash/real_estate/liability".to_string());
    }

    let mut conditions: Vec<&str> = Vec::new();
    let mut params: Vec<SqlValue> = Vec::new();
    if !date_from.is_empty() {
        conditions.push("snapshot_date >= ?");
        params.push(SqlValue::Text(date_from.clone()));
    }
    if !date_to.is_empty() {
        conditions.push("snapshot_date <= ?");
        params.push(SqlValue::Text(date_to.clone()));
    }
    if !asset_class.is_empty() {
        conditions.push("asset_class = ?");
        params.push(SqlValue::Text(asset_class.clone()));
    }
    if !account_id.is_empty() {
        conditions.push("account_id = ?");
        params.push(SqlValue::Text(account_id.clone()));
    }
    let where_sql = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };

    let conn = Connection::open(db_path).map_err(|e| format!("打开数据库失败: {e}"))?;

    let rows_sql = format!(
        r#"
        SELECT id, account_id, account_name, asset_class, snapshot_date, value_cents, source_type
        FROM account_valuations
        {where_sql}
        ORDER BY snapshot_date DESC, updated_at DESC
        LIMIT ?
        "#
    );
    let mut rows_params = params.clone();
    rows_params.push(SqlValue::Integer(limit));
    let mut rows_stmt = conn
        .prepare(&rows_sql)
        .map_err(|e| format!("查询资产估值失败: {e}"))?;
    let rows_iter = rows_stmt
        .query_map(params_from_iter(rows_params.iter()), |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "account_id": row.get::<_, String>(1)?,
                "account_name": row.get::<_, String>(2)?,
                "asset_class": row.get::<_, String>(3)?,
                "snapshot_date": row.get::<_, String>(4)?,
                "value_cents": row.get::<_, i64>(5)?,
                "source_type": row.get::<_, Option<String>>(6)?,
            }))
        })
        .map_err(|e| format!("查询资产估值失败: {e}"))?;
    let mut rows = Vec::<Value>::new();
    for row in rows_iter {
        rows.push(row.map_err(|e| format!("读取资产估值失败: {e}"))?);
    }

    let summary_sql = format!(
        r#"
        SELECT COUNT(*) AS count, COALESCE(SUM(value_cents), 0) AS total_cents
        FROM account_valuations
        {where_sql}
        "#
    );
    let summary_row = conn
        .query_row(&summary_sql, params_from_iter(params.iter()), |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?))
        })
        .map_err(|e| format!("汇总资产估值失败: {e}"))?;

    let total_cents = summary_row.1;
    Ok(json!({
        "summary": {
            "count": summary_row.0,
            "sum_value_cents": total_cents,
            "sum_value_yuan": cents_to_yuan_text(total_cents),
            "asset_class": if asset_class.is_empty() { "".to_string() } else { asset_class },
        },
        "rows": rows,
    }))
}

pub fn query_investments_at_db_path(
    db_path: &Path,
    req: InvestmentsQueryRequest,
) -> Result<Value, String> {
    let limit = parse_limit(req.limit, 100, 500) as i64;
    let date_from = parse_optional_date_text(req.from_date, "from")?;
    let date_to = parse_optional_date_text(req.to_date, "to")?;
    let source_type = parse_optional_text(req.source_type);
    let account_id = parse_optional_text(req.account_id);

    let mut conditions: Vec<&str> = Vec::new();
    let mut params: Vec<SqlValue> = Vec::new();
    if !date_from.is_empty() {
        conditions.push("r.snapshot_date >= ?");
        params.push(SqlValue::Text(date_from.clone()));
    }
    if !date_to.is_empty() {
        conditions.push("r.snapshot_date <= ?");
        params.push(SqlValue::Text(date_to.clone()));
    }
    if !source_type.is_empty() {
        conditions.push("r.source_type = ?");
        params.push(SqlValue::Text(source_type.clone()));
    }
    if !account_id.is_empty() {
        conditions.push("r.account_id = ?");
        params.push(SqlValue::Text(account_id.clone()));
    }
    let where_sql = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };

    let conn = Connection::open(db_path).map_err(|e| format!("打开数据库失败: {e}"))?;

    let rows_sql = format!(
        r#"
        SELECT r.id, r.snapshot_date, r.account_id, a.name AS account_name, r.total_assets_cents,
               r.transfer_amount_cents, r.source_type
        FROM investment_records r
        LEFT JOIN accounts a ON a.id = r.account_id
        {where_sql}
        ORDER BY r.snapshot_date DESC, r.updated_at DESC
        LIMIT ?
        "#
    );
    let mut rows_params = params.clone();
    rows_params.push(SqlValue::Integer(limit));
    let mut rows_stmt = conn
        .prepare(&rows_sql)
        .map_err(|e| format!("查询投资记录失败: {e}"))?;
    let rows_iter = rows_stmt
        .query_map(params_from_iter(rows_params.iter()), |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "snapshot_date": row.get::<_, String>(1)?,
                "account_id": row.get::<_, String>(2)?,
                "account_name": row.get::<_, Option<String>>(3)?,
                "total_assets_cents": row.get::<_, i64>(4)?,
                "transfer_amount_cents": row.get::<_, i64>(5)?,
                "source_type": row.get::<_, Option<String>>(6)?,
            }))
        })
        .map_err(|e| format!("查询投资记录失败: {e}"))?;
    let mut rows = Vec::<Value>::new();
    for row in rows_iter {
        rows.push(row.map_err(|e| format!("读取投资记录失败: {e}"))?);
    }

    let summary_sql = format!(
        r#"
        SELECT COUNT(*) AS count,
               COALESCE(SUM(r.transfer_amount_cents), 0) AS net_flow_cents
        FROM investment_records r
        {where_sql}
        "#
    );
    let (count, net_flow_cents) = conn
        .query_row(&summary_sql, params_from_iter(params.iter()), |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?))
        })
        .map_err(|e| format!("汇总投资记录失败: {e}"))?;

    let latest_sql = format!(
        r#"
        SELECT COALESCE(r.total_assets_cents, 0) AS total_assets_cents
        FROM investment_records r
        {where_sql}
        ORDER BY r.snapshot_date DESC, r.updated_at DESC
        LIMIT 1
        "#
    );
    let latest_assets = conn
        .query_row(&latest_sql, params_from_iter(params.iter()), |row| {
            row.get::<_, i64>(0)
        })
        .unwrap_or(0);

    Ok(json!({
        "summary": {
            "count": count,
            "latest_total_assets_cents": latest_assets,
            "latest_total_assets_yuan": cents_to_yuan_text(latest_assets),
            "net_transfer_amount_cents": net_flow_cents,
            "net_transfer_amount_yuan": cents_to_yuan_text(net_flow_cents),
            "source_type": source_type,
        },
        "rows": rows,
    }))
}

pub fn query_transactions_at_db_path(
    db_path: &Path,
    req: TransactionsQueryRequest,
) -> Result<Value, String> {
    let limit = parse_limit(req.limit, 100, 500) as i64;
    let month_key = parse_optional_text(req.month_key);
    let source_type = parse_optional_text(req.source_type);
    let account_id = parse_optional_text(req.account_id);
    let keyword = parse_optional_text(req.keyword);
    let sort_key = {
        let v = parse_optional_text(req.sort);
        if v.is_empty() {
            "date_desc".to_string()
        } else {
            v
        }
    };
    let sort_sql = match sort_key.as_str() {
        "date_desc" => "COALESCE(t.posted_at, t.occurred_at) DESC, t.id DESC",
        "date_asc" => "COALESCE(t.posted_at, t.occurred_at) ASC, t.id ASC",
        "amount_desc" => {
            "ABS(t.amount_cents) DESC, COALESCE(t.posted_at, t.occurred_at) DESC, t.id DESC"
        }
        "amount_asc" => {
            "ABS(t.amount_cents) ASC, COALESCE(t.posted_at, t.occurred_at) DESC, t.id DESC"
        }
        _ => return Err(format!("sort 不支持: {sort_key}")),
    };

    let mut conditions: Vec<&str> = Vec::new();
    let mut params: Vec<SqlValue> = Vec::new();
    if !month_key.is_empty() {
        conditions.push("t.month_key = ?");
        params.push(SqlValue::Text(month_key.clone()));
    }
    if !source_type.is_empty() {
        conditions.push("t.source_type = ?");
        params.push(SqlValue::Text(source_type.clone()));
    }
    if !account_id.is_empty() {
        conditions.push("t.account_id = ?");
        params.push(SqlValue::Text(account_id.clone()));
    }
    if !keyword.is_empty() {
        conditions.push(
            "(t.description LIKE ? OR t.merchant_normalized LIKE ? OR COALESCE(c.name, '') LIKE ?)",
        );
        let kw = format!("%{keyword}%");
        params.push(SqlValue::Text(kw.clone()));
        params.push(SqlValue::Text(kw.clone()));
        params.push(SqlValue::Text(kw));
    }
    let where_sql = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };

    let conn = Connection::open(db_path).map_err(|e| format!("打开数据库失败: {e}"))?;

    let rows_sql = format!(
        r#"
        SELECT
            t.id,
            t.posted_at,
            t.occurred_at,
            t.direction,
            t.merchant,
            t.merchant_normalized,
            t.description,
            t.amount_cents,
            t.statement_category,
            t.source_type,
            t.category_id,
            t.excluded_in_analysis,
            t.exclude_reason,
            COALESCE(c.name, '待分类') AS expense_category
        FROM transactions t
        LEFT JOIN categories c ON c.id = t.category_id
        {where_sql}
        ORDER BY {sort_sql}
        LIMIT ?
        "#
    );
    let mut rows_params = params.clone();
    rows_params.push(SqlValue::Integer(limit));
    let mut rows_stmt = conn
        .prepare(&rows_sql)
        .map_err(|e| format!("查询交易记录失败: {e}"))?;
    let raw_rows = rows_stmt
        .query_map(params_from_iter(rows_params.iter()), |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, i64>(7)?,
                row.get::<_, Option<String>>(8)?,
                row.get::<_, Option<String>>(9)?,
                row.get::<_, Option<String>>(10)?,
                row.get::<_, i64>(11)?,
                row.get::<_, Option<String>>(12)?,
                row.get::<_, String>(13)?,
            ))
        })
        .map_err(|e| format!("查询交易记录失败: {e}"))?;

    let mut result_rows = Vec::<Value>::new();
    let mut excluded_count = 0_i64;
    let mut excluded_total_abs_cents = 0_i64;
    for row in raw_rows {
        let (
            id,
            posted_at,
            occurred_at,
            direction,
            merchant,
            merchant_normalized,
            description,
            amount_cents,
            statement_category,
            source_type_row,
            category_id,
            excluded_in_analysis_raw,
            exclude_reason_opt,
            expense_category,
        ) = row.map_err(|e| format!("读取交易记录失败: {e}"))?;
        let excluded = excluded_in_analysis_raw != 0;
        let reason = exclude_reason_opt.unwrap_or_default();
        let manual_excluded = excluded && reason.starts_with(MANUAL_TX_EXCLUDE_REASON_PREFIX);
        let manual_exclude_reason = if manual_excluded {
            reason[MANUAL_TX_EXCLUDE_REASON_PREFIX.len()..]
                .trim_start_matches([' ', ':'])
                .to_string()
        } else {
            String::new()
        };
        if excluded {
            excluded_count += 1;
            excluded_total_abs_cents += amount_cents.abs();
        }
        result_rows.push(json!({
            "id": id,
            "posted_at": posted_at,
            "occurred_at": occurred_at,
            "direction": direction,
            "merchant": merchant,
            "merchant_normalized": merchant_normalized,
            "description": description,
            "amount_cents": amount_cents,
            "statement_category": statement_category,
            "source_type": source_type_row,
            "category_id": category_id,
            "excluded_in_analysis": if excluded { 1 } else { 0 },
            "exclude_reason": reason,
            "expense_category": expense_category,
            "manual_excluded": manual_excluded,
            "manual_exclude_reason": manual_exclude_reason,
        }));
    }

    let summary_sql = format!(
        r#"
        SELECT COUNT(*) AS count, COALESCE(SUM(t.amount_cents), 0) AS total_cents
        FROM transactions t
        LEFT JOIN categories c ON c.id = t.category_id
        {where_sql}
        "#
    );
    let (count, total_cents) = conn
        .query_row(&summary_sql, params_from_iter(params.iter()), |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?))
        })
        .map_err(|e| format!("汇总交易记录失败: {e}"))?;

    Ok(json!({
        "summary": {
            "count": count,
            "total_amount_cents": total_cents,
            "total_amount_yuan": cents_to_yuan_text(total_cents),
            "source_type": source_type,
            "excluded_count_in_rows": excluded_count,
            "excluded_total_abs_cents_in_rows": excluded_total_abs_cents,
            "excluded_total_abs_yuan_in_rows": cents_to_yuan_text(excluded_total_abs_cents),
            "sort": sort_key,
        },
        "rows": result_rows,
    }))
}

#[tauri::command]
pub fn meta_accounts_query(app: AppHandle, req: MetaAccountsQueryRequest) -> Result<Value, String> {
    let db_path = resolve_ledger_db_path(&app)?;
    meta_accounts_query_at_db_path(&db_path, req)
}

#[tauri::command]
pub fn query_transactions(app: AppHandle, req: TransactionsQueryRequest) -> Result<Value, String> {
    let db_path = resolve_ledger_db_path(&app)?;
    query_transactions_at_db_path(&db_path, req)
}

#[tauri::command]
pub fn query_investments(app: AppHandle, req: InvestmentsQueryRequest) -> Result<Value, String> {
    let db_path = resolve_ledger_db_path(&app)?;
    query_investments_at_db_path(&db_path, req)
}

#[tauri::command]
pub fn query_asset_valuations(
    app: AppHandle,
    req: AssetValuationsQueryRequest,
) -> Result<Value, String> {
    let db_path = resolve_ledger_db_path(&app)?;
    query_asset_valuations_at_db_path(&db_path, req)
}
