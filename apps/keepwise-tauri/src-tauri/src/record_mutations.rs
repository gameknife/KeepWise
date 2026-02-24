use chrono::NaiveDate;
use rusqlite::{params, Connection};
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::Path;
use tauri::AppHandle;
use uuid::Uuid;

use crate::ledger_db::resolve_ledger_db_path;

const SUPPORTED_ASSET_CLASSES: &[&str] = &["cash", "real_estate", "liability"];

#[derive(Debug, Deserialize)]
pub struct ManualInvestmentUpsertRequest {
    pub snapshot_date: Option<String>,
    pub account_id: Option<String>,
    pub account_name: Option<String>,
    pub total_assets: Option<String>,
    pub transfer_amount: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct InvestmentRecordUpdateRequest {
    pub id: Option<String>,
    pub snapshot_date: Option<String>,
    pub account_id: Option<String>,
    pub account_name: Option<String>,
    pub total_assets: Option<String>,
    pub transfer_amount: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RecordDeleteRequest {
    pub id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ManualAssetValuationUpsertRequest {
    pub asset_class: Option<String>,
    pub snapshot_date: Option<String>,
    pub account_id: Option<String>,
    pub account_name: Option<String>,
    pub value: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct AssetValuationUpdateRequest {
    pub id: Option<String>,
    pub asset_class: Option<String>,
    pub snapshot_date: Option<String>,
    pub account_id: Option<String>,
    pub account_name: Option<String>,
    pub value: Option<String>,
}

fn normalize_date(raw: &str) -> Result<String, String> {
    let text = raw.trim();
    if text.is_empty() {
        return Err("snapshot_date 必填".to_string());
    }
    NaiveDate::parse_from_str(text, "%Y-%m-%d")
        .map_err(|_| "snapshot_date 日期格式必须为 YYYY-MM-DD".to_string())?;
    Ok(text.to_string())
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

fn cents_to_yuan_text(cents: i64) -> String {
    format!("{:.2}", cents as f64 / 100.0)
}

fn uuid_v5_full(name: &str) -> String {
    Uuid::new_v5(&Uuid::NAMESPACE_URL, name.as_bytes()).to_string()
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

fn investment_account_id_from_name(account_name: &str) -> String {
    let suffix = uuid_v5_suffix12(&format!("keepwise:investment:{account_name}"));
    format!("acct_inv_{suffix}")
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

fn ensure_investment_account(
    conn: &Connection,
    account_id: &str,
    account_name: &str,
) -> Result<(), String> {
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

fn upsert_account(
    conn: &Connection,
    account_id: &str,
    account_name: &str,
    account_type: &str,
) -> Result<(), String> {
    conn.execute(
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
    .map_err(|e| format!("写入账户失败: {e}"))?;
    Ok(())
}

fn validate_asset_account_match(
    asset_class: &str,
    account_id: &str,
    account_type: &str,
) -> Result<(), String> {
    match asset_class {
        "cash" => {
            if account_type != "cash" {
                return Err("所选账户不是现金账户".to_string());
            }
        }
        "real_estate" => {
            if account_type != "other" && !account_id.starts_with("acct_re_") {
                return Err("所选账户不是不动产账户".to_string());
            }
        }
        "liability" => {
            if account_type != "liability" {
                return Err("所选账户不是负债账户".to_string());
            }
        }
        _ => return Err("asset_class 必须是 cash、real_estate 或 liability".to_string()),
    }
    Ok(())
}

fn map_sqlite_conflict(prefix: &str, err: rusqlite::Error) -> String {
    let msg = err.to_string();
    if msg.contains("UNIQUE constraint failed") {
        format!("{prefix}（可能与现有记录冲突）: {msg}")
    } else {
        format!("{prefix}: {msg}")
    }
}

pub fn upsert_manual_investment_at_db_path(
    db_path: &Path,
    req: ManualInvestmentUpsertRequest,
) -> Result<Value, String> {
    let snapshot_date = normalize_date(req.snapshot_date.unwrap_or_default().as_str())?;
    let account_id_input = req.account_id.unwrap_or_default().trim().to_string();
    let account_name_input = req.account_name.unwrap_or_default().trim().to_string();
    let total_assets_cents =
        parse_amount_to_cents(req.total_assets.unwrap_or_else(|| "0".to_string()).as_str())?;
    let transfer_amount_cents = parse_amount_to_cents(
        req.transfer_amount
            .unwrap_or_else(|| "0".to_string())
            .as_str(),
    )?;
    if total_assets_cents <= 0 {
        return Err("总资产必须大于 0".to_string());
    }

    let mut conn = Connection::open(db_path).map_err(|e| format!("打开数据库失败: {e}"))?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|e| format!("设置 foreign_keys 失败: {e}"))?;

    let (account_id, account_name) = if !account_id_input.is_empty() {
        let (id, name, account_type) = load_account_row_by_id(&conn, &account_id_input)?;
        if account_type != "investment" {
            return Err("所选账户不是投资账户".to_string());
        }
        (id, name)
    } else {
        let name = if account_name_input.is_empty() {
            "手工投资账户".to_string()
        } else {
            account_name_input.clone()
        };
        (investment_account_id_from_name(&name), name)
    };

    let rec_id = uuid_v5_full(&format!("{account_id}:{snapshot_date}:manual"));
    {
        let tx = conn
            .transaction()
            .map_err(|e| format!("开始事务失败: {e}"))?;
        ensure_investment_account(&tx, &account_id, &account_name)?;
        tx.execute(
            r#"
            INSERT INTO investment_records(
                id, account_id, snapshot_date, total_assets_cents, transfer_amount_cents,
                source_type, source_file, import_job_id
            )
            VALUES (?1, ?2, ?3, ?4, ?5, 'manual', NULL, NULL)
            ON CONFLICT(account_id, snapshot_date) DO UPDATE SET
                total_assets_cents=excluded.total_assets_cents,
                transfer_amount_cents=excluded.transfer_amount_cents,
                source_type='manual',
                source_file=NULL,
                import_job_id=NULL,
                updated_at=datetime('now')
            "#,
            params![
                rec_id,
                account_id,
                snapshot_date,
                total_assets_cents,
                transfer_amount_cents
            ],
        )
        .map_err(|e| map_sqlite_conflict("写入投资记录失败", e))?;
        tx.commit().map_err(|e| format!("提交事务失败: {e}"))?;
    }

    Ok(json!({
        "account_id": account_id,
        "account_name": account_name,
        "snapshot_date": snapshot_date,
    }))
}

pub fn update_investment_record_at_db_path(
    db_path: &Path,
    req: InvestmentRecordUpdateRequest,
) -> Result<Value, String> {
    let record_id = req.id.unwrap_or_default().trim().to_string();
    if record_id.is_empty() {
        return Err("id 必填".to_string());
    }
    let snapshot_date = normalize_date(req.snapshot_date.unwrap_or_default().as_str())?;
    let account_id_input = req.account_id.unwrap_or_default().trim().to_string();
    let account_name_input = req.account_name.unwrap_or_default().trim().to_string();
    let total_assets_cents =
        parse_amount_to_cents(req.total_assets.unwrap_or_else(|| "0".to_string()).as_str())?;
    let transfer_amount_cents = parse_amount_to_cents(
        req.transfer_amount
            .unwrap_or_else(|| "0".to_string())
            .as_str(),
    )?;
    if total_assets_cents <= 0 {
        return Err("总资产必须大于 0".to_string());
    }

    let mut conn = Connection::open(db_path).map_err(|e| format!("打开数据库失败: {e}"))?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|e| format!("设置 foreign_keys 失败: {e}"))?;
    let exists = conn
        .query_row(
            "SELECT 1 FROM investment_records WHERE id = ?1",
            [record_id.clone()],
            |row| row.get::<_, i64>(0),
        )
        .map(|_| true)
        .unwrap_or(false);
    if !exists {
        return Err("未找到要修改的投资记录".to_string());
    }

    let (account_id, account_name) = if !account_id_input.is_empty() {
        let (id, name, account_type) = load_account_row_by_id(&conn, &account_id_input)?;
        if account_type != "investment" {
            return Err("所选账户不是投资账户".to_string());
        }
        (id, name)
    } else {
        let name = if account_name_input.is_empty() {
            "手工投资账户".to_string()
        } else {
            account_name_input.clone()
        };
        (investment_account_id_from_name(&name), name)
    };

    {
        let tx = conn
            .transaction()
            .map_err(|e| format!("开始事务失败: {e}"))?;
        ensure_investment_account(&tx, &account_id, &account_name)?;
        tx.execute(
            r#"
            UPDATE investment_records
            SET account_id = ?1,
                snapshot_date = ?2,
                total_assets_cents = ?3,
                transfer_amount_cents = ?4,
                updated_at = datetime('now')
            WHERE id = ?5
            "#,
            params![
                account_id,
                snapshot_date,
                total_assets_cents,
                transfer_amount_cents,
                record_id
            ],
        )
        .map_err(|e| map_sqlite_conflict("修改失败", e))?;
        tx.commit().map_err(|e| format!("提交事务失败: {e}"))?;
    }

    Ok(json!({
        "id": record_id,
        "account_id": account_id,
        "account_name": account_name,
        "snapshot_date": snapshot_date,
        "total_assets_cents": total_assets_cents,
        "transfer_amount_cents": transfer_amount_cents,
    }))
}

pub fn delete_investment_record_at_db_path(
    db_path: &Path,
    req: RecordDeleteRequest,
) -> Result<Value, String> {
    let record_id = req.id.unwrap_or_default().trim().to_string();
    if record_id.is_empty() {
        return Err("id 必填".to_string());
    }
    let conn = Connection::open(db_path).map_err(|e| format!("打开数据库失败: {e}"))?;
    let (id, account_id, account_name, snapshot_date) = conn
        .query_row(
            r#"
            SELECT r.id, r.account_id, COALESCE(a.name, r.account_id) AS account_name, r.snapshot_date
            FROM investment_records r
            LEFT JOIN accounts a ON a.id = r.account_id
            WHERE r.id = ?1
            "#,
            [record_id.clone()],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            },
        )
        .map_err(|_| "未找到要删除的投资记录".to_string())?;
    conn.execute("DELETE FROM investment_records WHERE id = ?1", [record_id])
        .map_err(|e| format!("删除投资记录失败: {e}"))?;
    Ok(json!({
        "id": id,
        "account_id": account_id,
        "account_name": account_name,
        "snapshot_date": snapshot_date,
        "deleted": true,
    }))
}

fn parse_asset_class(raw: &str) -> Result<String, String> {
    let v = raw.trim().to_lowercase();
    if SUPPORTED_ASSET_CLASSES.iter().any(|c| *c == v) {
        Ok(v)
    } else {
        Err("asset_class 必须是 cash、real_estate 或 liability".to_string())
    }
}

fn ensure_account_valuations_table(conn: &Connection) -> Result<(), String> {
    let exists = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='account_valuations')",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|e| format!("检查 account_valuations 表失败: {e}"))?;
    if exists == 0 {
        Err("数据库缺少 account_valuations 表，请先执行最新迁移。".to_string())
    } else {
        Ok(())
    }
}

pub fn upsert_manual_asset_valuation_at_db_path(
    db_path: &Path,
    req: ManualAssetValuationUpsertRequest,
) -> Result<Value, String> {
    let asset_class = parse_asset_class(req.asset_class.unwrap_or_default().as_str())?;
    let snapshot_date = normalize_date(req.snapshot_date.unwrap_or_default().as_str())?;
    let default_name = match asset_class.as_str() {
        "cash" => "现金账户",
        "real_estate" => "不动产账户",
        "liability" => "负债账户",
        _ => "资产账户",
    };
    let account_id_input = req.account_id.unwrap_or_default().trim().to_string();
    let account_name_input = req.account_name.unwrap_or_default().trim().to_string();
    let mut account_name = if account_name_input.is_empty() {
        default_name.to_string()
    } else {
        account_name_input
    };
    let value_cents = parse_amount_to_cents(req.value.unwrap_or_else(|| "0".to_string()).as_str())?;
    if value_cents <= 0 {
        return Err("资产金额必须大于 0".to_string());
    }

    let mut conn = Connection::open(db_path).map_err(|e| format!("打开数据库失败: {e}"))?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|e| format!("设置 foreign_keys 失败: {e}"))?;
    ensure_account_valuations_table(&conn)?;

    let (account_id, account_type) = if !account_id_input.is_empty() {
        let (id, name, ty) = load_account_row_by_id(&conn, &account_id_input)?;
        validate_asset_account_match(&asset_class, &id, &ty)?;
        account_name = name;
        (id, ty)
    } else {
        let id = account_id_from_asset_name(&asset_class, &account_name);
        let ty = match asset_class.as_str() {
            "cash" => "cash".to_string(),
            "liability" => "liability".to_string(),
            _ => "other".to_string(),
        };
        (id, ty)
    };

    let record_id = uuid_v5_full(&format!("{account_id}:{asset_class}:{snapshot_date}"));
    {
        let tx = conn
            .transaction()
            .map_err(|e| format!("开始事务失败: {e}"))?;
        upsert_account(&tx, &account_id, &account_name, &account_type)?;
        tx.execute(
            r#"
            INSERT INTO account_valuations(
                id, account_id, account_name, asset_class, snapshot_date, value_cents, source_type
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'manual')
            ON CONFLICT(account_id, asset_class, snapshot_date) DO UPDATE SET
                account_name=excluded.account_name,
                value_cents=excluded.value_cents,
                source_type='manual',
                updated_at=datetime('now')
            "#,
            params![
                record_id,
                account_id,
                account_name,
                asset_class,
                snapshot_date,
                value_cents
            ],
        )
        .map_err(|e| map_sqlite_conflict("写入资产记录失败", e))?;
        tx.commit().map_err(|e| format!("提交事务失败: {e}"))?;
    }

    Ok(json!({
        "account_id": account_id,
        "account_name": account_name,
        "asset_class": asset_class,
        "snapshot_date": snapshot_date,
        "value_cents": value_cents,
        "value_yuan": cents_to_yuan_text(value_cents),
    }))
}

pub fn update_asset_valuation_at_db_path(
    db_path: &Path,
    req: AssetValuationUpdateRequest,
) -> Result<Value, String> {
    let record_id = req.id.unwrap_or_default().trim().to_string();
    if record_id.is_empty() {
        return Err("id 必填".to_string());
    }
    let asset_class = parse_asset_class(req.asset_class.unwrap_or_default().as_str())?;
    let snapshot_date = normalize_date(req.snapshot_date.unwrap_or_default().as_str())?;
    let default_name = match asset_class.as_str() {
        "cash" => "现金账户",
        "real_estate" => "不动产账户",
        "liability" => "负债账户",
        _ => "资产账户",
    };
    let account_id_input = req.account_id.unwrap_or_default().trim().to_string();
    let account_name_input = req.account_name.unwrap_or_default().trim().to_string();
    let mut account_name = if account_name_input.is_empty() {
        default_name.to_string()
    } else {
        account_name_input
    };
    let value_cents = parse_amount_to_cents(req.value.unwrap_or_else(|| "0".to_string()).as_str())?;
    if value_cents <= 0 {
        return Err("资产金额必须大于 0".to_string());
    }

    let mut conn = Connection::open(db_path).map_err(|e| format!("打开数据库失败: {e}"))?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|e| format!("设置 foreign_keys 失败: {e}"))?;
    ensure_account_valuations_table(&conn)?;
    let exists = conn
        .query_row(
            "SELECT 1 FROM account_valuations WHERE id = ?1",
            [record_id.clone()],
            |row| row.get::<_, i64>(0),
        )
        .map(|_| true)
        .unwrap_or(false);
    if !exists {
        return Err("未找到要修改的资产记录".to_string());
    }

    let (account_id, account_type) = if !account_id_input.is_empty() {
        let (id, name, ty) = load_account_row_by_id(&conn, &account_id_input)?;
        validate_asset_account_match(&asset_class, &id, &ty)?;
        account_name = name;
        (id, ty)
    } else {
        let id = account_id_from_asset_name(&asset_class, &account_name);
        let ty = match asset_class.as_str() {
            "cash" => "cash".to_string(),
            "liability" => "liability".to_string(),
            _ => "other".to_string(),
        };
        (id, ty)
    };

    {
        let tx = conn
            .transaction()
            .map_err(|e| format!("开始事务失败: {e}"))?;
        upsert_account(&tx, &account_id, &account_name, &account_type)?;
        tx.execute(
            r#"
            UPDATE account_valuations
            SET account_id = ?1,
                account_name = ?2,
                asset_class = ?3,
                snapshot_date = ?4,
                value_cents = ?5,
                updated_at = datetime('now')
            WHERE id = ?6
            "#,
            params![
                account_id,
                account_name,
                asset_class,
                snapshot_date,
                value_cents,
                record_id
            ],
        )
        .map_err(|e| map_sqlite_conflict("修改失败", e))?;
        tx.commit().map_err(|e| format!("提交事务失败: {e}"))?;
    }

    Ok(json!({
        "id": record_id,
        "account_id": account_id,
        "account_name": account_name,
        "asset_class": asset_class,
        "snapshot_date": snapshot_date,
        "value_cents": value_cents,
        "value_yuan": cents_to_yuan_text(value_cents),
    }))
}

pub fn delete_asset_valuation_at_db_path(
    db_path: &Path,
    req: RecordDeleteRequest,
) -> Result<Value, String> {
    let record_id = req.id.unwrap_or_default().trim().to_string();
    if record_id.is_empty() {
        return Err("id 必填".to_string());
    }
    let conn = Connection::open(db_path).map_err(|e| format!("打开数据库失败: {e}"))?;
    let (id, account_id, account_name, asset_class, snapshot_date) = conn
        .query_row(
            "SELECT id, account_id, account_name, asset_class, snapshot_date FROM account_valuations WHERE id = ?1",
            [record_id.clone()],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                ))
            },
        )
        .map_err(|_| "未找到要删除的资产记录".to_string())?;
    conn.execute("DELETE FROM account_valuations WHERE id = ?1", [record_id])
        .map_err(|e| format!("删除资产记录失败: {e}"))?;
    Ok(json!({
        "id": id,
        "account_id": account_id,
        "account_name": account_name,
        "asset_class": asset_class,
        "snapshot_date": snapshot_date,
        "deleted": true,
    }))
}

#[tauri::command]
pub fn upsert_manual_investment(
    app: AppHandle,
    req: ManualInvestmentUpsertRequest,
) -> Result<Value, String> {
    let db_path = resolve_ledger_db_path(&app)?;
    upsert_manual_investment_at_db_path(&db_path, req)
}

#[tauri::command]
pub fn update_investment_record(
    app: AppHandle,
    req: InvestmentRecordUpdateRequest,
) -> Result<Value, String> {
    let db_path = resolve_ledger_db_path(&app)?;
    update_investment_record_at_db_path(&db_path, req)
}

#[tauri::command]
pub fn delete_investment_record(app: AppHandle, req: RecordDeleteRequest) -> Result<Value, String> {
    let db_path = resolve_ledger_db_path(&app)?;
    delete_investment_record_at_db_path(&db_path, req)
}

#[tauri::command]
pub fn upsert_manual_asset_valuation(
    app: AppHandle,
    req: ManualAssetValuationUpsertRequest,
) -> Result<Value, String> {
    let db_path = resolve_ledger_db_path(&app)?;
    upsert_manual_asset_valuation_at_db_path(&db_path, req)
}

#[tauri::command]
pub fn update_asset_valuation(
    app: AppHandle,
    req: AssetValuationUpdateRequest,
) -> Result<Value, String> {
    let db_path = resolve_ledger_db_path(&app)?;
    update_asset_valuation_at_db_path(&db_path, req)
}

#[tauri::command]
pub fn delete_asset_valuation(app: AppHandle, req: RecordDeleteRequest) -> Result<Value, String> {
    let db_path = resolve_ledger_db_path(&app)?;
    delete_asset_valuation_at_db_path(&db_path, req)
}
