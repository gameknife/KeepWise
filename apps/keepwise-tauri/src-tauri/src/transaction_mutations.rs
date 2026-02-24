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
