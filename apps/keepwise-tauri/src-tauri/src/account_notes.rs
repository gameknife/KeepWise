use rusqlite::{params, Connection};
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::Path;
use tauri::AppHandle;

use crate::ledger_db::resolve_ledger_db_path;

#[derive(Debug, Default, Deserialize)]
pub struct AccountNotesQueryRequest {
    pub account_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpsertAccountNoteRequest {
    pub account_id: Option<String>,
    pub holdings_text: Option<String>,
    pub risk_note: Option<String>,
    pub note_text: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct DeleteAccountNoteRequest {
    pub account_id: Option<String>,
}

fn trim_optional(value: Option<String>) -> String {
    value.unwrap_or_default().trim().to_string()
}

pub fn query_account_notes_at_db_path(
    db_path: &Path,
    req: AccountNotesQueryRequest,
) -> Result<Value, String> {
    let account_id = req.account_id.unwrap_or_default().trim().to_string();
    let conn = Connection::open(db_path).map_err(|e| format!("打开数据库失败: {e}"))?;

    let mut rows = Vec::new();
    if account_id.is_empty() {
        let mut stmt = conn
            .prepare(
                r#"
                SELECT account_id, holdings_text, risk_note, note_text, updated_at
                FROM account_notes
                ORDER BY updated_at DESC, account_id ASC
                "#,
            )
            .map_err(|e| format!("查询账户备注失败: {e}"))?;
        let iter = stmt
            .query_map([], |row| {
                Ok(json!({
                    "account_id": row.get::<_, String>(0)?,
                    "holdings_text": row.get::<_, String>(1)?,
                    "risk_note": row.get::<_, String>(2)?,
                    "note_text": row.get::<_, String>(3)?,
                    "updated_at": row.get::<_, String>(4)?,
                }))
            })
            .map_err(|e| format!("查询账户备注失败: {e}"))?;
        for row in iter {
            rows.push(row.map_err(|e| format!("读取账户备注失败: {e}"))?);
        }
    } else {
        let mut stmt = conn
            .prepare(
                r#"
                SELECT account_id, holdings_text, risk_note, note_text, updated_at
                FROM account_notes
                WHERE account_id = ?1
                "#,
            )
            .map_err(|e| format!("查询账户备注失败: {e}"))?;
        let iter = stmt
            .query_map([account_id.clone()], |row| {
                Ok(json!({
                    "account_id": row.get::<_, String>(0)?,
                    "holdings_text": row.get::<_, String>(1)?,
                    "risk_note": row.get::<_, String>(2)?,
                    "note_text": row.get::<_, String>(3)?,
                    "updated_at": row.get::<_, String>(4)?,
                }))
            })
            .map_err(|e| format!("查询账户备注失败: {e}"))?;
        for row in iter {
            rows.push(row.map_err(|e| format!("读取账户备注失败: {e}"))?);
        }
    }

    Ok(json!({
        "summary": {
            "count": rows.len(),
            "account_id": if account_id.is_empty() { Value::Null } else { Value::String(account_id) },
        },
        "rows": rows,
    }))
}

pub fn upsert_account_note_at_db_path(
    db_path: &Path,
    req: UpsertAccountNoteRequest,
) -> Result<Value, String> {
    let account_id = trim_optional(req.account_id);
    if account_id.is_empty() {
        return Err("account_id 必填".to_string());
    }
    let holdings_text = trim_optional(req.holdings_text);
    let risk_note = trim_optional(req.risk_note);
    let note_text = trim_optional(req.note_text);

    let conn = Connection::open(db_path).map_err(|e| format!("打开数据库失败: {e}"))?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|e| format!("设置 foreign_keys 失败: {e}"))?;
    conn.execute(
        r#"
        INSERT INTO account_notes(account_id, holdings_text, risk_note, note_text, updated_at)
        VALUES (?1, ?2, ?3, ?4, datetime('now'))
        ON CONFLICT(account_id) DO UPDATE SET
            holdings_text=excluded.holdings_text,
            risk_note=excluded.risk_note,
            note_text=excluded.note_text,
            updated_at=datetime('now')
        "#,
        params![account_id, holdings_text, risk_note, note_text],
    )
    .map_err(|e| format!("保存账户备注失败: {e}"))?;

    let refreshed = query_account_notes_at_db_path(
        db_path,
        AccountNotesQueryRequest {
            account_id: Some(account_id.clone()),
        },
    )?;
    let row = refreshed
        .get("rows")
        .and_then(Value::as_array)
        .and_then(|items| items.first())
        .cloned()
        .unwrap_or_else(|| json!({ "account_id": account_id }));

    Ok(json!({
        "saved": true,
        "row": row,
    }))
}

pub fn delete_account_note_at_db_path(
    db_path: &Path,
    req: DeleteAccountNoteRequest,
) -> Result<Value, String> {
    let account_id = trim_optional(req.account_id);
    if account_id.is_empty() {
        return Err("account_id 必填".to_string());
    }
    let conn = Connection::open(db_path).map_err(|e| format!("打开数据库失败: {e}"))?;
    let deleted = conn
        .execute(
            "DELETE FROM account_notes WHERE account_id = ?1",
            [account_id.clone()],
        )
        .map_err(|e| format!("删除账户备注失败: {e}"))?;
    Ok(json!({
        "deleted": deleted > 0,
        "account_id": account_id,
    }))
}

#[tauri::command]
pub fn query_account_notes(app: AppHandle, req: AccountNotesQueryRequest) -> Result<Value, String> {
    let db_path = resolve_ledger_db_path(&app)?;
    query_account_notes_at_db_path(&db_path, req)
}

#[tauri::command]
pub fn upsert_account_note(app: AppHandle, req: UpsertAccountNoteRequest) -> Result<Value, String> {
    let db_path = resolve_ledger_db_path(&app)?;
    upsert_account_note_at_db_path(&db_path, req)
}

#[tauri::command]
pub fn delete_account_note(app: AppHandle, req: DeleteAccountNoteRequest) -> Result<Value, String> {
    let db_path = resolve_ledger_db_path(&app)?;
    delete_account_note_at_db_path(&db_path, req)
}

#[cfg(test)]
mod tests {
    use super::{
        delete_account_note_at_db_path, query_account_notes_at_db_path,
        upsert_account_note_at_db_path, AccountNotesQueryRequest, DeleteAccountNoteRequest,
        UpsertAccountNoteRequest,
    };
    use rusqlite::Connection;
    use serde_json::Value;
    use std::fs;
    use std::path::{Path, PathBuf};
    use uuid::Uuid;

    fn repo_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("src-tauri parent")
            .parent()
            .expect("app root parent")
            .parent()
            .expect("repo root")
            .to_path_buf()
    }

    fn create_temp_test_db() -> PathBuf {
        let path = std::env::temp_dir().join(format!("kw_account_notes_{}.sqlite", Uuid::new_v4()));
        if path.exists() {
            let _ = fs::remove_file(&path);
        }
        path
    }

    fn apply_all_migrations_for_test(db_path: &Path) {
        let conn = Connection::open(db_path).expect("open temp db");
        let mut entries = fs::read_dir(repo_root().join("db/migrations"))
            .expect("read migrations")
            .map(|entry| entry.expect("migration dir entry").path())
            .collect::<Vec<_>>();
        entries.sort();
        for path in entries {
            let sql = fs::read_to_string(&path).expect("read migration sql");
            conn.execute_batch(&sql)
                .unwrap_or_else(|e| panic!("apply migration {} failed: {e}", path.display()));
        }
    }

    #[test]
    fn account_note_upsert_query_and_delete_round_trip() {
        let db_path = create_temp_test_db();
        apply_all_migrations_for_test(&db_path);
        let conn = Connection::open(&db_path).expect("open db");
        conn.execute(
            "INSERT INTO accounts(id, name, account_type, currency) VALUES ('acct_note_test', '测试账户', 'investment', 'CNY')",
            [],
        )
        .expect("insert account");

        upsert_account_note_at_db_path(
            &db_path,
            UpsertAccountNoteRequest {
                account_id: Some("acct_note_test".to_string()),
                holdings_text: Some("60% 510300".to_string()),
                risk_note: Some("高波动".to_string()),
                note_text: Some("长期持有".to_string()),
            },
        )
        .expect("upsert note");

        let payload = query_account_notes_at_db_path(&db_path, AccountNotesQueryRequest::default())
            .expect("query notes");
        let rows = payload.get("rows").and_then(Value::as_array).expect("rows");
        assert_eq!(rows.len(), 1);
        assert_eq!(
            rows[0].get("holdings_text").and_then(Value::as_str),
            Some("60% 510300")
        );

        let deleted = delete_account_note_at_db_path(
            &db_path,
            DeleteAccountNoteRequest {
                account_id: Some("acct_note_test".to_string()),
            },
        )
        .expect("delete note");
        assert_eq!(deleted.get("deleted").and_then(Value::as_bool), Some(true));
    }
}
