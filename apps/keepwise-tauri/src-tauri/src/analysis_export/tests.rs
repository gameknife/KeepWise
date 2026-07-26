use super::{
    analysis_export_snapshot_at_db_path, analysis_export_write_file, build_local_cli_prompt,
    build_openai_compatible_context, build_openai_compatible_fact_messages,
    extract_openai_compatible_response_content, normalize_openai_compatible_endpoint,
    remaining_timeout_seconds, truncate_text_middle, AnalysisExportRequest,
};
use rusqlite::Connection;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
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
    let path = std::env::temp_dir().join(format!("kw_analysis_export_{}.sqlite", Uuid::new_v4()));
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
fn snapshot_returns_structured_payload_for_empty_db() {
    let db_path = create_temp_test_db();
    apply_all_migrations_for_test(&db_path);
    let payload = analysis_export_snapshot_at_db_path(
        &db_path,
        AnalysisExportRequest {
            year: Some("2026".to_string()),
            wealth_curve_preset: Some("since_inception".to_string()),
            include_consumption_detail: Some("false".to_string()),
            fire_withdrawal_rate: Some("0.04".to_string()),
        },
    )
    .expect("snapshot");

    assert!(payload
        .get("generated_at")
        .and_then(Value::as_str)
        .is_some());
    assert!(payload.get("wealth_overview").is_some());
    assert_eq!(
        payload
            .get("account_notes")
            .and_then(Value::as_array)
            .map(Vec::len),
        Some(0)
    );
    assert!(payload
        .get("consumption")
        .and_then(|v| v.get("transactions"))
        .is_none());
}

#[test]
fn write_file_rejects_non_markdown_path() {
    let target = std::env::temp_dir().join(format!("kw_analysis_export_{}.txt", Uuid::new_v4()));
    let result =
        analysis_export_write_file(target.to_string_lossy().to_string(), "# x".to_string());
    assert!(result.is_err());
}

#[test]
fn local_cli_prompt_contains_markdown_path_and_analysis_prompt() {
    let path = PathBuf::from("/tmp/keepwise-test.md");
    let prompt = build_local_cli_prompt(&path, "关注再平衡");
    assert!(prompt.contains("/tmp/keepwise-test.md"));
    assert!(prompt.contains("keepwise-test.md"));
    assert!(prompt.contains("关注再平衡"));
    assert!(prompt.contains("简明扼要"));
}

#[test]
fn normalize_openai_compatible_endpoint_appends_chat_completions() {
    assert_eq!(
        normalize_openai_compatible_endpoint("https://api.openai.com/v1").unwrap(),
        "https://api.openai.com/v1/chat/completions"
    );
    assert_eq!(
        normalize_openai_compatible_endpoint("https://example.com/custom/openai").unwrap(),
        "https://example.com/custom/openai/chat/completions"
    );
    assert_eq!(
        normalize_openai_compatible_endpoint("https://example.com/v1/chat/completions").unwrap(),
        "https://example.com/v1/chat/completions"
    );
}

#[test]
fn extract_openai_compatible_response_content_supports_string_and_array_content() {
    let string_payload = json!({
        "choices": [
            {
                "message": {
                    "content": "结论：保持现金缓冲。"
                }
            }
        ]
    });
    assert_eq!(
        extract_openai_compatible_response_content(&string_payload).as_deref(),
        Some("结论：保持现金缓冲。")
    );

    let array_payload = json!({
        "choices": [
            {
                "message": {
                    "content": [
                        { "type": "text", "text": "第一段" },
                        { "type": "text", "text": "第二段" }
                    ]
                }
            }
        ]
    });
    assert_eq!(
        extract_openai_compatible_response_content(&array_payload).as_deref(),
        Some("第一段\n第二段")
    );
}

#[test]
fn openai_fact_prompt_keeps_user_goal_and_snapshot() {
    let context = build_openai_compatible_context("# 快照正文", "关注再平衡", 1000);
    let messages = build_openai_compatible_fact_messages(&context);
    let content = messages
        .get(1)
        .and_then(|item| item.get("content"))
        .and_then(Value::as_str)
        .unwrap_or("");
    assert!(content.contains("关注再平衡"));
    assert!(content.contains("# 快照正文"));
}

#[test]
fn truncate_text_middle_keeps_both_ends() {
    let text = format!("{}{}", "前文".repeat(80), "后文".repeat(40));
    let truncated = truncate_text_middle(&text, 120);
    assert!(truncated.contains("前文前文"));
    assert!(truncated.contains("后文后文"));
    assert!(truncated.contains("中间内容已压缩"));
}

#[test]
fn remaining_timeout_rejects_near_timeout() {
    let started_at = Instant::now() - Duration::from_secs(58);
    let result = remaining_timeout_seconds(started_at, 60, 5, "最终成稿");
    assert!(result.is_err());
}
