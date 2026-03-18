use rusqlite::{params, Connection};
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::Path;
use tauri::AppHandle;

use crate::ledger_db::resolve_ledger_db_path;

const MANUAL_TX_EXCLUDE_REASON_PREFIX: &str = "[manual_tx_exclude]";

#[derive(Debug, Deserialize)]
pub struct UpdateTransactionAnalysisExclusionRequest {
    pub id: Option<String>,
    pub action: Option<String>,
    pub excluded_in_analysis: Option<bool>,
    pub reason: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ConfirmTransactionReviewRequest {
    pub id: Option<String>,
}

pub fn update_transaction_analysis_exclusion_at_db_path(
    db_path: &Path,
    req: UpdateTransactionAnalysisExclusionRequest,
) -> Result<Value, String> {
    let tx_id = req.id.unwrap_or_default().trim().to_string();
    if tx_id.is_empty() {
        return Err("id 必填".to_string());
    }

    let action_input = req.action.unwrap_or_default().trim().to_lowercase();
    let action = if action_input.is_empty() {
        if req.excluded_in_analysis.unwrap_or(false) {
            "exclude".to_string()
        } else {
            "restore".to_string()
        }
    } else {
        action_input
    };
    if action != "exclude" && action != "restore" {
        return Err("action 必须是 exclude 或 restore".to_string());
    }
    let user_reason = req.reason.unwrap_or_default().trim().to_string();

    let conn = Connection::open(db_path).map_err(|e| format!("打开数据库失败: {e}"))?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|e| format!("设置 foreign_keys 失败: {e}"))?;

    let (current_excluded, current_reason) = conn
        .query_row(
            r#"
            SELECT excluded_in_analysis, COALESCE(exclude_reason, '')
            FROM transactions
            WHERE id = ?1
            "#,
            [tx_id.as_str()],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
        )
        .map_err(|_| "未找到交易记录".to_string())?;

    let current_excluded = current_excluded != 0;
    let current_manual =
        current_excluded && current_reason.starts_with(MANUAL_TX_EXCLUDE_REASON_PREFIX);

    let (excluded, manual_excluded, reason) = if action == "exclude" {
        let suffix = if user_reason.is_empty() {
            "手动剔除（查询页）".to_string()
        } else {
            user_reason
        };
        let new_reason = format!("{MANUAL_TX_EXCLUDE_REASON_PREFIX} {suffix}");
        conn.execute(
            r#"
            UPDATE transactions
            SET excluded_in_analysis = 1,
                exclude_reason = ?1,
                updated_at = datetime('now')
            WHERE id = ?2
            "#,
            params![new_reason, tx_id],
        )
        .map_err(|e| format!("更新交易剔除状态失败: {e}"))?;
        (true, true, new_reason)
    } else {
        if !current_manual {
            return Err("该交易不是“手动剔除”状态，无法在此处恢复".to_string());
        }
        conn.execute(
            r#"
            UPDATE transactions
            SET excluded_in_analysis = 0,
                exclude_reason = '',
                updated_at = datetime('now')
            WHERE id = ?1
            "#,
            [tx_id.as_str()],
        )
        .map_err(|e| format!("恢复交易剔除状态失败: {e}"))?;
        (false, false, String::new())
    };

    let manual_exclude_reason =
        if manual_excluded && reason.starts_with(MANUAL_TX_EXCLUDE_REASON_PREFIX) {
            reason[MANUAL_TX_EXCLUDE_REASON_PREFIX.len()..]
                .trim_start_matches([' ', ':'])
                .to_string()
        } else {
            String::new()
        };

    Ok(json!({
        "id": tx_id,
        "excluded_in_analysis": if excluded { 1 } else { 0 },
        "manual_excluded": manual_excluded,
        "exclude_reason": reason,
        "manual_exclude_reason": manual_exclude_reason,
        "action": action,
    }))
}

#[tauri::command]
pub fn update_transaction_analysis_exclusion(
    app: AppHandle,
    req: UpdateTransactionAnalysisExclusionRequest,
) -> Result<Value, String> {
    let db_path = resolve_ledger_db_path(&app)?;
    update_transaction_analysis_exclusion_at_db_path(&db_path, req)
}

pub fn confirm_transaction_review_at_db_path(
    db_path: &Path,
    req: ConfirmTransactionReviewRequest,
) -> Result<Value, String> {
    let tx_id = req.id.unwrap_or_default().trim().to_string();
    if tx_id.is_empty() {
        return Err("id 必填".to_string());
    }

    let conn = Connection::open(db_path).map_err(|e| format!("打开数据库失败: {e}"))?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|e| format!("设置 foreign_keys 失败: {e}"))?;

    let affected = conn
        .execute(
            r#"
            UPDATE transactions
            SET needs_review = 0,
                updated_at = datetime('now')
            WHERE id = ?1
            "#,
            [tx_id.as_str()],
        )
        .map_err(|e| format!("确认交易失败: {e}"))?;
    if affected == 0 {
        return Err("未找到交易记录".to_string());
    }

    Ok(json!({
        "id": tx_id,
        "needs_review": 0,
        "confirmed": true,
    }))
}

#[tauri::command]
pub fn confirm_transaction_review(
    app: AppHandle,
    req: ConfirmTransactionReviewRequest,
) -> Result<Value, String> {
    let db_path = resolve_ledger_db_path(&app)?;
    confirm_transaction_review_at_db_path(&db_path, req)
}

#[cfg(test)]
mod tests {
    use super::{confirm_transaction_review_at_db_path, ConfirmTransactionReviewRequest};
    use rusqlite::{params, Connection};
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
        let path = std::env::temp_dir().join(format!("kw_tx_mut_{}.sqlite", Uuid::new_v4()));
        if path.exists() {
            let _ = fs::remove_file(&path);
        }
        path
    }

    fn apply_all_migrations_for_test(db_path: &Path) {
        let conn = Connection::open(db_path).expect("open temp db");
        let mut entries = fs::read_dir(repo_root().join("db/migrations"))
            .expect("read migrations")
            .map(|e| e.expect("migration dir entry").path())
            .collect::<Vec<_>>();
        entries.sort();
        for path in entries {
            let sql = fs::read_to_string(&path).expect("read migration sql");
            conn.execute_batch(&sql)
                .unwrap_or_else(|e| panic!("apply migration {} failed: {e}", path.display()));
        }
    }

    #[test]
    fn confirm_transaction_review_clears_needs_review_flag() {
        let db_path = create_temp_test_db();
        apply_all_migrations_for_test(&db_path);
        let conn = Connection::open(&db_path).expect("open db");

        conn.execute(
            r#"
            INSERT INTO accounts (id, name, account_type, currency, initial_balance_cents)
            VALUES ('acct_cc_test', '测试信用卡', 'credit_card', 'CNY', 0)
            "#,
            [],
        )
        .expect("insert account");

        conn.execute(
            r#"
            INSERT INTO transactions (
              id, occurred_at, posted_at, month_key, account_id, description, statement_category,
              direction, amount_cents, currency,
              merchant, merchant_normalized,
              source_type, source_file,
              confidence, needs_review, excluded_in_analysis
            ) VALUES (
              ?1, '2026-03-18T08:00:00', '2026-03-18T08:00:00', '2026-03', 'acct_cc_test', '测试交易', '消费',
              'expense', 1234, 'CNY',
              '测试商户', '测试商户',
              'test', 'test.csv',
              0.5, 1, 0
            )
            "#,
            params!["tx_confirm_test"],
        )
        .expect("insert tx");

        let payload = confirm_transaction_review_at_db_path(
            &db_path,
            ConfirmTransactionReviewRequest {
                id: Some("tx_confirm_test".to_string()),
            },
        )
        .expect("confirm review");

        assert_eq!(payload.get("confirmed").and_then(Value::as_bool), Some(true));
        let needs_review: i64 = conn
            .query_row(
                "SELECT needs_review FROM transactions WHERE id = ?1",
                ["tx_confirm_test"],
                |row| row.get(0),
            )
            .expect("query updated tx");
        assert_eq!(needs_review, 0);
    }
}
