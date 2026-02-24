use rusqlite::{params, Connection};
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::Path;
use tauri::AppHandle;
use uuid::Uuid;

use crate::ledger_db::resolve_ledger_db_path;

const ACCOUNT_KIND_CHOICES: &[&str] = &[
    "investment",
    "cash",
    "real_estate",
    "bank",
    "credit_card",
    "wallet",
    "liability",
    "other",
];

#[derive(Debug, Deserialize)]
pub struct AccountCatalogQueryRequest {
    pub kind: Option<String>,
    pub keyword: Option<String>,
    pub limit: Option<u32>,
}

#[derive(Debug, Deserialize)]
pub struct UpsertAccountCatalogEntryRequest {
    pub account_id: Option<String>,
    pub account_name: Option<String>,
    pub account_kind: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct DeleteAccountCatalogEntryRequest {
    pub account_id: Option<String>,
}

fn cents_to_yuan_text(cents: i64) -> String {
    format!("{:.2}", cents as f64 / 100.0)
}

fn normalize_account_kind(raw: &str) -> Result<String, String> {
    let kind = raw.trim().to_lowercase();
    if ACCOUNT_KIND_CHOICES.iter().any(|k| *k == kind) {
        Ok(kind)
    } else {
        Err(format!("account_kind 不支持: {kind}"))
    }
}

fn account_kind_to_db_type(kind: &str) -> &str {
    if kind == "real_estate" {
        "other"
    } else {
        kind
    }
}

fn uuid_v5_suffix12(name: &str) -> String {
    let id = Uuid::new_v5(&Uuid::NAMESPACE_URL, name.as_bytes());
    id.simple().to_string()[..12].to_string()
}

fn account_id_from_asset_name(asset_class: &str, account_name: &str) -> String {
    let suffix = uuid_v5_suffix12(&format!("keepwise:{asset_class}:{account_name}"));
    match asset_class {
        "cash" => format!("acct_cash_{suffix}"),
        "liability" => format!("acct_liab_{suffix}"),
        _ => format!("acct_re_{suffix}"),
    }
}

fn account_id_from_manual_account(kind: &str, account_name: &str) -> String {
    if kind == "investment" {
        let suffix = uuid_v5_suffix12(&format!("keepwise:investment:{account_name}"));
        return format!("acct_inv_{suffix}");
    }
    if kind == "cash" || kind == "real_estate" {
        return account_id_from_asset_name(kind, account_name);
    }
    let suffix = uuid_v5_suffix12(&format!("keepwise:{kind}:{account_name}"));
    let prefix = match kind {
        "bank" => "acct_bank",
        "credit_card" => "acct_cc",
        "wallet" => "acct_wallet",
        "liability" => "acct_liab",
        _ => "acct_other",
    };
    format!("{prefix}_{suffix}")
}

fn infer_account_kind(
    account_id: &str,
    account_type: &str,
    asset_cash_count: i64,
    asset_real_estate_count: i64,
) -> String {
    if account_type == "liability" || account_id.starts_with("acct_liab_") {
        return "liability".to_string();
    }
    if asset_real_estate_count > 0 || account_id.starts_with("acct_re_") {
        return "real_estate".to_string();
    }
    if asset_cash_count > 0 || account_id.starts_with("acct_cash_") {
        return "cash".to_string();
    }
    account_type.to_string()
}

fn parse_query_kind(raw: Option<String>) -> Result<String, String> {
    let kind = raw.unwrap_or_default().trim().to_lowercase();
    let kind = if kind.is_empty() {
        "all".to_string()
    } else {
        kind
    };
    let mut valid = vec!["all".to_string()];
    valid.extend(ACCOUNT_KIND_CHOICES.iter().map(|s| s.to_string()));
    if valid.iter().any(|v| v == &kind) {
        Ok(kind)
    } else {
        Err(format!("kind 仅支持: {}", valid.join(", ")))
    }
}

fn parse_query_limit(raw: Option<u32>) -> u32 {
    raw.unwrap_or(500).clamp(1, 1000)
}

fn build_account_catalog_rows(
    conn: &Connection,
    kind_filter: &str,
    keyword: &str,
    limit: u32,
) -> Result<Value, String> {
    let mut stmt = conn
        .prepare(
            r#"
            SELECT
                a.id,
                a.name,
                a.account_type,
                a.currency,
                a.initial_balance_cents,
                a.created_at,
                a.updated_at,
                COALESCE(t.tx_count, 0) AS transaction_count,
                COALESCE(inv.inv_count, 0) AS investment_record_count,
                COALESCE(av.asset_val_count, 0) AS asset_valuation_count,
                COALESCE(av.cash_count, 0) AS cash_valuation_count,
                COALESCE(av.real_estate_count, 0) AS real_estate_valuation_count
            FROM accounts a
            LEFT JOIN (
                SELECT account_id, COUNT(*) AS tx_count
                FROM transactions
                GROUP BY account_id
            ) t ON t.account_id = a.id
            LEFT JOIN (
                SELECT account_id, COUNT(*) AS inv_count
                FROM investment_records
                GROUP BY account_id
            ) inv ON inv.account_id = a.id
            LEFT JOIN (
                SELECT
                    account_id,
                    COUNT(*) AS asset_val_count,
                    SUM(CASE WHEN asset_class = 'cash' THEN 1 ELSE 0 END) AS cash_count,
                    SUM(CASE WHEN asset_class = 'real_estate' THEN 1 ELSE 0 END) AS real_estate_count
                FROM account_valuations
                GROUP BY account_id
            ) av ON av.account_id = a.id
            ORDER BY a.updated_at DESC, a.name ASC
            LIMIT ?1
            "#,
        )
        .map_err(|e| format!("查询账户目录失败: {e}"))?;

    let iter = stmt
        .query_map([limit as i64], |row| {
            let account_id = row.get::<_, String>(0)?;
            let account_name = row.get::<_, String>(1)?;
            let account_type = row.get::<_, String>(2)?;
            let currency = row.get::<_, String>(3)?;
            let initial_balance_cents = row.get::<_, i64>(4)?;
            let created_at = row.get::<_, String>(5)?;
            let updated_at = row.get::<_, String>(6)?;
            let tx_count = row.get::<_, i64>(7)?;
            let inv_count = row.get::<_, i64>(8)?;
            let asset_val_count = row.get::<_, i64>(9)?;
            let cash_count = row.get::<_, i64>(10)?;
            let real_estate_count = row.get::<_, i64>(11)?;
            Ok((
                account_id,
                account_name,
                account_type,
                currency,
                initial_balance_cents,
                created_at,
                updated_at,
                tx_count,
                inv_count,
                asset_val_count,
                cash_count,
                real_estate_count,
            ))
        })
        .map_err(|e| format!("查询账户目录失败: {e}"))?;

    let keyword_lower = keyword.to_lowercase();
    let mut items = Vec::<Value>::new();
    for row in iter {
        let (
            account_id,
            account_name,
            account_type,
            currency,
            initial_balance_cents,
            created_at,
            updated_at,
            transaction_count,
            investment_record_count,
            asset_valuation_count,
            cash_valuation_count,
            real_estate_valuation_count,
        ) = row.map_err(|e| format!("读取账户目录失败: {e}"))?;

        let inferred_kind = infer_account_kind(
            &account_id,
            &account_type,
            cash_valuation_count,
            real_estate_valuation_count,
        );

        if kind_filter != "all" && inferred_kind != kind_filter {
            continue;
        }
        if !keyword_lower.is_empty() {
            let hay = format!(
                "{} {} {} {}",
                account_id, account_name, inferred_kind, account_type
            )
            .to_lowercase();
            if !hay.contains(&keyword_lower) {
                continue;
            }
        }

        items.push(json!({
            "account_id": account_id,
            "account_name": account_name,
            "account_type": account_type,
            "account_kind": inferred_kind,
            "currency": currency,
            "initial_balance_cents": initial_balance_cents,
            "initial_balance_yuan": cents_to_yuan_text(initial_balance_cents),
            "transaction_count": transaction_count,
            "investment_record_count": investment_record_count,
            "asset_valuation_count": asset_valuation_count,
            "cash_valuation_count": cash_valuation_count,
            "real_estate_valuation_count": real_estate_valuation_count,
            "created_at": created_at,
            "updated_at": updated_at,
        }));
    }

    let mut groups_obj = serde_json::Map::new();
    for kind in ACCOUNT_KIND_CHOICES {
        groups_obj.insert((*kind).to_string(), Value::Array(Vec::new()));
    }
    for item in &items {
        if let Some(kind) = item.get("account_kind").and_then(Value::as_str) {
            if let Some(slot) = groups_obj.get_mut(kind).and_then(Value::as_array_mut) {
                slot.push(item.clone());
            }
        }
    }

    Ok(json!({
        "summary": {
            "count": items.len(),
            "kind": kind_filter,
            "keyword": keyword_lower,
            "limit": limit,
        },
        "rows": items,
        "groups": groups_obj,
    }))
}

pub fn query_account_catalog_at_db_path(
    db_path: &Path,
    req: AccountCatalogQueryRequest,
) -> Result<Value, String> {
    let kind = parse_query_kind(req.kind)?;
    let keyword = req.keyword.unwrap_or_default().trim().to_string();
    let limit = parse_query_limit(req.limit);
    let conn = Connection::open(db_path).map_err(|e| format!("打开数据库失败: {e}"))?;
    build_account_catalog_rows(&conn, &kind, &keyword, limit)
}

fn load_account_row_by_id(
    conn: &Connection,
    account_id: &str,
) -> Result<(String, String, String), String> {
    conn.query_row(
        "SELECT id, name, account_type FROM accounts WHERE id = ?1",
        [account_id],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        },
    )
    .map_err(|_| "未找到对应账户".to_string())
}

pub fn upsert_account_catalog_entry_at_db_path(
    db_path: &Path,
    req: UpsertAccountCatalogEntryRequest,
) -> Result<Value, String> {
    let account_name = req.account_name.unwrap_or_default().trim().to_string();
    if account_name.is_empty() {
        return Err("account_name 必填".to_string());
    }
    let account_kind = normalize_account_kind(req.account_kind.unwrap_or_default().as_str())?;
    let account_id_raw = req.account_id.unwrap_or_default().trim().to_string();
    let account_id = if account_id_raw.is_empty() {
        account_id_from_manual_account(&account_kind, &account_name)
    } else {
        account_id_raw.clone()
    };
    let account_type = account_kind_to_db_type(&account_kind).to_string();

    let mut conn = Connection::open(db_path).map_err(|e| format!("打开数据库失败: {e}"))?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|e| format!("设置 foreign_keys 失败: {e}"))?;

    {
        let tx = conn
            .transaction()
            .map_err(|e| format!("开始事务失败: {e}"))?;
        tx.execute(
            r#"
            INSERT INTO accounts(id, name, account_type, currency, initial_balance_cents)
            VALUES (?1, ?2, ?3, 'CNY', 0)
            ON CONFLICT(id) DO UPDATE SET
                name=excluded.name,
                account_type=excluded.account_type,
                updated_at=datetime('now')
            "#,
            params![account_id, account_name, account_type],
        )
        .map_err(|e| format!("写入 accounts 失败: {e}"))?;

        tx.execute(
            r#"
            UPDATE account_valuations
            SET account_name = ?1, updated_at = datetime('now')
            WHERE account_id = ?2
            "#,
            params![account_name, account_id],
        )
        .map_err(|e| format!("同步 account_valuations.account_name 失败: {e}"))?;

        tx.commit().map_err(|e| format!("提交事务失败: {e}"))?;
    }

    let refreshed = build_account_catalog_rows(&conn, "all", &account_id, 5)?;
    let row = refreshed
        .get("rows")
        .and_then(Value::as_array)
        .and_then(|rows| {
            rows.iter().find(|item| {
                item.get("account_id")
                    .and_then(Value::as_str)
                    .map(|id| id == account_id)
                    .unwrap_or(false)
            })
        })
        .cloned()
        .unwrap_or_else(|| {
            json!({
                "account_id": account_id,
                "account_name": account_name,
                "account_kind": account_kind,
                "account_type": account_type,
            })
        });

    Ok(json!({
        "created": account_id_raw.is_empty(),
        "updated": !account_id_raw.is_empty(),
        "row": row,
    }))
}

pub fn delete_account_catalog_entry_at_db_path(
    db_path: &Path,
    req: DeleteAccountCatalogEntryRequest,
) -> Result<Value, String> {
    let account_id = req.account_id.unwrap_or_default().trim().to_string();
    if account_id.is_empty() {
        return Err("account_id 必填".to_string());
    }

    let conn = Connection::open(db_path).map_err(|e| format!("打开数据库失败: {e}"))?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|e| format!("设置 foreign_keys 失败: {e}"))?;

    let (_id, account_name, _account_type) = load_account_row_by_id(&conn, &account_id)?;
    let tx_count = conn
        .query_row(
            "SELECT COUNT(*) FROM transactions WHERE account_id = ?1",
            [account_id.clone()],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|e| format!("统计 transactions 失败: {e}"))?;
    let inv_count = conn
        .query_row(
            "SELECT COUNT(*) FROM investment_records WHERE account_id = ?1",
            [account_id.clone()],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|e| format!("统计 investment_records 失败: {e}"))?;
    let asset_count = conn
        .query_row(
            "SELECT COUNT(*) FROM account_valuations WHERE account_id = ?1",
            [account_id.clone()],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|e| format!("统计 account_valuations 失败: {e}"))?;

    if tx_count > 0 || inv_count > 0 || asset_count > 0 {
        return Err(format!(
            "账户仍被引用，不能删除（transactions={tx_count}, investments={inv_count}, assets={asset_count}）"
        ));
    }

    conn.execute("DELETE FROM accounts WHERE id = ?1", [account_id.clone()])
        .map_err(|e| format!("删除账户失败: {e}"))?;

    Ok(json!({
        "deleted": true,
        "account_id": account_id,
        "account_name": account_name,
    }))
}

#[tauri::command]
pub fn query_account_catalog(
    app: AppHandle,
    req: AccountCatalogQueryRequest,
) -> Result<Value, String> {
    let db_path = resolve_ledger_db_path(&app)?;
    query_account_catalog_at_db_path(&db_path, req)
}

#[tauri::command]
pub fn upsert_account_catalog_entry(
    app: AppHandle,
    req: UpsertAccountCatalogEntryRequest,
) -> Result<Value, String> {
    let db_path = resolve_ledger_db_path(&app)?;
    upsert_account_catalog_entry_at_db_path(&db_path, req)
}

#[tauri::command]
pub fn delete_account_catalog_entry(
    app: AppHandle,
    req: DeleteAccountCatalogEntryRequest,
) -> Result<Value, String> {
    let db_path = resolve_ledger_db_path(&app)?;
    delete_account_catalog_entry_at_db_path(&db_path, req)
}
