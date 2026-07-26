use chrono::{Datelike, Local};
use reqwest::blocking::Client;
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use url::Url;

use crate::account_catalog::{query_account_catalog_at_db_path, AccountCatalogQueryRequest};
use crate::account_notes::{query_account_notes_at_db_path, AccountNotesQueryRequest};
use crate::budget::{
    query_budget_overview_at_db_path, query_consumption_report_at_db_path,
    query_fire_progress_at_db_path, query_salary_income_overview_at_db_path,
    BudgetYearQueryRequest, ConsumptionReportQueryRequest, FireProgressQueryRequest,
};
use crate::investment::{
    investment_return_query_at_db_path, investment_returns_query_at_db_path,
    InvestmentReturnQueryRequest, InvestmentReturnsQueryRequest,
};
use crate::ledger_db::resolve_ledger_db_path;
use crate::wealth::{
    wealth_curve_query_at_db_path, wealth_overview_query_at_db_path, WealthCurveQueryRequest,
    WealthOverviewQueryRequest,
};

const PORTFOLIO_ACCOUNT_ID: &str = "__portfolio__";
const MAX_EXPORT_BYTES: usize = 10 * 1024 * 1024;
const DEFAULT_LOCAL_CLI_TIMEOUT_SECONDS: u64 = 900;
const DEFAULT_OPENAI_COMPAT_TIMEOUT_SECONDS: u64 = 180;
const OPENAI_COMPAT_FACT_CONTEXT_CHAR_LIMIT: usize = 32_000;
const OPENAI_COMPAT_REVIEW_CONTEXT_CHAR_LIMIT: usize = 12_000;
const OPENAI_COMPAT_FACT_SHEET_CHAR_LIMIT: usize = 8_000;
const OPENAI_COMPAT_DRAFT_CHAR_LIMIT: usize = 8_000;
const OPENAI_COMPAT_REVIEW_NOTES_CHAR_LIMIT: usize = 4_000;

#[derive(Debug, Default, Deserialize)]
pub struct AnalysisExportRequest {
    pub year: Option<String>,
    pub wealth_curve_preset: Option<String>,
    pub include_consumption_detail: Option<String>,
    pub fire_withdrawal_rate: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
pub struct AnalysisExportRunLocalCliRequest {
    pub cli_key: Option<String>,
    pub content: Option<String>,
    pub analysis_prompt: Option<String>,
    pub timeout_seconds: Option<u64>,
    pub run_id: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
pub struct AnalysisExportRunOpenAiCompatibleRequest {
    pub endpoint: Option<String>,
    pub api_key: Option<String>,
    pub model: Option<String>,
    pub content: Option<String>,
    pub analysis_prompt: Option<String>,
    pub timeout_seconds: Option<u64>,
    pub run_id: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
pub struct AnalysisExportRunCodexRequest {
    pub content: Option<String>,
    pub analysis_prompt: Option<String>,
    pub timeout_seconds: Option<u64>,
    pub run_id: Option<String>,
}

#[derive(Clone, Copy)]
struct LocalAnalysisCliSpec {
    key: &'static str,
    label: &'static str,
    executable: &'static str,
}

const LOCAL_ANALYSIS_CLIS: [LocalAnalysisCliSpec; 3] = [
    LocalAnalysisCliSpec {
        key: "codex",
        label: "Codex CLI",
        executable: "codex",
    },
    LocalAnalysisCliSpec {
        key: "copilot",
        label: "Copilot CLI",
        executable: "copilot",
    },
    LocalAnalysisCliSpec {
        key: "claude",
        label: "Claude CLI",
        executable: "claude",
    },
];

enum CliPipeEvent {
    Stdout(String),
    Stderr(String),
}

fn bool_param(raw: Option<&str>, default_value: bool) -> bool {
    match raw.unwrap_or_default().trim().to_lowercase().as_str() {
        "true" | "1" | "yes" => true,
        "false" | "0" | "no" => false,
        _ => default_value,
    }
}

fn safe_payload(label: &str, result: Result<Value, String>) -> Value {
    match result {
        Ok(value) => value,
        Err(err) => json!({
            "error": err,
            "source": label,
        }),
    }
}

fn prune_consumption_detail(mut payload: Value) -> Value {
    if let Some(obj) = payload.as_object_mut() {
        obj.remove("transactions");
        obj.remove("merchants");
        obj.remove("categories");
        obj.remove("all_expense_categories");
    }
    payload
}

fn prepare_analysis_export_markdown(
    app: &AppHandle,
    provider_key: &str,
    content: &str,
) -> Result<(PathBuf, PathBuf), String> {
    let base_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("无法解析 app_local_data_dir: {e}"))?
        .join("analysis_exports");
    std::fs::create_dir_all(&base_dir).map_err(|e| format!("创建分析临时目录失败: {e}"))?;
    let stamp = Local::now().format("%Y%m%d-%H%M%S").to_string();
    let markdown_path = base_dir.join(format!("keepwise-{provider_key}-analysis-{stamp}.md"));
    std::fs::write(&markdown_path, content.as_bytes())
        .map_err(|e| format!("写入分析临时 Markdown 失败: {e}"))?;
    Ok((base_dir, markdown_path))
}

mod commands;
mod file;
mod local_cli;
mod openai;
mod snapshot;
#[cfg(test)]
mod tests;

pub use commands::*;
pub use file::*;
pub use local_cli::*;
use openai::*;
pub use snapshot::*;
