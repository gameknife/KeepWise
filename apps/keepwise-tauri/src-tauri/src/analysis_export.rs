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
use crate::budget_fire_analytics::{
    query_budget_overview_at_db_path, query_consumption_report_at_db_path,
    query_fire_progress_at_db_path, query_salary_income_overview_at_db_path,
    BudgetYearQueryRequest, ConsumptionReportQueryRequest, FireProgressQueryRequest,
};
use crate::investment_analytics::{
    investment_return_query_at_db_path, investment_returns_query_at_db_path,
    InvestmentReturnQueryRequest, InvestmentReturnsQueryRequest,
};
use crate::ledger_db::resolve_ledger_db_path;
use crate::wealth_analytics::{
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

pub fn analysis_export_snapshot_at_db_path(
    db_path: &Path,
    req: AnalysisExportRequest,
) -> Result<Value, String> {
    let now = Local::now();
    let year = req
        .year
        .unwrap_or_else(|| now.date_naive().year().to_string())
        .trim()
        .to_string();
    let wealth_curve_preset = req
        .wealth_curve_preset
        .unwrap_or_else(|| "since_inception".to_string())
        .trim()
        .to_string();
    let include_consumption_detail = bool_param(req.include_consumption_detail.as_deref(), false);
    let fire_withdrawal_rate = req
        .fire_withdrawal_rate
        .unwrap_or_else(|| "0.04".to_string())
        .trim()
        .to_string();

    let wealth_overview = safe_payload(
        "wealth_overview",
        wealth_overview_query_at_db_path(
            db_path,
            WealthOverviewQueryRequest {
                as_of_date: None,
                include_investment: Some("true".to_string()),
                include_cash: Some("true".to_string()),
                include_real_estate: Some("true".to_string()),
                include_liability: Some("true".to_string()),
            },
        ),
    );
    let as_of = wealth_overview
        .get("summary")
        .and_then(|v| v.get("as_of"))
        .and_then(Value::as_str)
        .or_else(|| wealth_overview.get("as_of").and_then(Value::as_str))
        .unwrap_or("")
        .to_string();

    let wealth_curve = safe_payload(
        "wealth_curve",
        wealth_curve_query_at_db_path(
            db_path,
            WealthCurveQueryRequest {
                preset: Some(wealth_curve_preset.clone()),
                from_date: None,
                to_date: None,
                include_investment: Some("true".to_string()),
                include_cash: Some("true".to_string()),
                include_real_estate: Some("true".to_string()),
                include_liability: Some("true".to_string()),
            },
        ),
    );

    let portfolio_return = |preset: &str| {
        safe_payload(
            &format!("portfolio_{preset}"),
            investment_return_query_at_db_path(
                db_path,
                InvestmentReturnQueryRequest {
                    account_id: PORTFOLIO_ACCOUNT_ID.to_string(),
                    preset: Some(preset.to_string()),
                    from_date: None,
                    to_date: None,
                },
            ),
        )
    };

    let accounts_since_inception = safe_payload(
        "accounts_since_inception",
        investment_returns_query_at_db_path(
            db_path,
            InvestmentReturnsQueryRequest {
                preset: Some("since_inception".to_string()),
                from_date: None,
                to_date: None,
                keyword: None,
                limit: Some(500),
            },
        ),
    );

    let fire_req = FireProgressQueryRequest {
        year: Some(year.clone()),
        withdrawal_rate: Some(fire_withdrawal_rate.clone()),
    };
    let consumption_req = ConsumptionReportQueryRequest {
        year: Some(year.clone()),
    };

    let consumption = safe_payload(
        "consumption",
        query_consumption_report_at_db_path(db_path, consumption_req),
    );
    let consumption = if include_consumption_detail {
        consumption
    } else {
        prune_consumption_detail(consumption)
    };

    let account_notes_payload =
        query_account_notes_at_db_path(db_path, AccountNotesQueryRequest { account_id: None })?;
    let account_notes = account_notes_payload
        .get("rows")
        .cloned()
        .unwrap_or_else(|| json!([]));

    Ok(json!({
        "generated_at": now.format("%Y-%m-%dT%H:%M:%S%:z").to_string(),
        "as_of": as_of,
        "year": year,
        "wealth_curve_preset": wealth_curve_preset,
        "include_consumption_detail": include_consumption_detail,
        "fire_withdrawal_rate": fire_withdrawal_rate,
        "wealth_overview": wealth_overview,
        "wealth_curve": wealth_curve,
        "investment_returns": {
            "portfolio_ytd": portfolio_return("ytd"),
            "portfolio_1y": portfolio_return("1y"),
            "portfolio_3y": portfolio_return("3y"),
            "portfolio_since_inception": portfolio_return("since_inception"),
            "accounts_since_inception": accounts_since_inception,
        },
        "fire": safe_payload("fire", query_fire_progress_at_db_path(db_path, fire_req)),
        "budget_overview": safe_payload(
            "budget_overview",
            query_budget_overview_at_db_path(
                db_path,
                BudgetYearQueryRequest {
                    year: Some(year.clone()),
                },
            ),
        ),
        "salary_income": safe_payload(
            "salary_income",
            query_salary_income_overview_at_db_path(
                db_path,
                BudgetYearQueryRequest {
                    year: Some(year.clone()),
                },
            ),
        ),
        "consumption": consumption,
        "account_catalog": safe_payload(
            "account_catalog",
            query_account_catalog_at_db_path(
                db_path,
                AccountCatalogQueryRequest {
                    kind: Some("all".to_string()),
                    keyword: None,
                    limit: Some(1000),
                },
            ),
        ),
        "account_notes": account_notes,
    }))
}

#[tauri::command]
pub fn analysis_export_snapshot(
    app: AppHandle,
    req: AnalysisExportRequest,
) -> Result<Value, String> {
    let db_path = resolve_ledger_db_path(&app)?;
    analysis_export_snapshot_at_db_path(&db_path, req)
}

#[tauri::command]
pub fn analysis_export_write_file(path: String, content: String) -> Result<Value, String> {
    let target = path.trim();
    if target.is_empty() {
        return Err("path 必填".to_string());
    }
    let path = Path::new(target);
    if path
        .extension()
        .and_then(|v| v.to_str())
        .map(|v| v.to_lowercase() != "md")
        .unwrap_or(true)
    {
        return Err("导出文件必须以 .md 结尾".to_string());
    }
    let bytes = content.as_bytes();
    if bytes.len() > MAX_EXPORT_BYTES {
        return Err("导出内容超过 10MB 上限".to_string());
    }
    if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建导出目录失败: {e}"))?;
    }
    std::fs::write(path, bytes).map_err(|e| format!("写入 Markdown 文件失败: {e}"))?;
    Ok(json!({
        "written": true,
        "path": path.to_string_lossy().to_string(),
        "bytes": bytes.len(),
    }))
}

fn candidate_cli_paths(executable: &str) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Ok(path_env) = std::env::var("PATH") {
        for path in std::env::split_paths(&path_env) {
            paths.push(path.join(executable));
        }
    }
    if let Ok(home) = std::env::var("HOME") {
        paths.push(PathBuf::from(&home).join(".local/bin").join(executable));
        paths.push(PathBuf::from(&home).join(".cargo/bin").join(executable));
        paths.push(PathBuf::from(&home).join("bin").join(executable));
    }
    paths.push(PathBuf::from("/opt/homebrew/bin").join(executable));
    paths.push(PathBuf::from("/usr/local/bin").join(executable));
    paths.push(PathBuf::from("/usr/bin").join(executable));
    paths
}

fn resolve_local_cli_spec(cli_key: &str) -> Result<LocalAnalysisCliSpec, String> {
    LOCAL_ANALYSIS_CLIS
        .into_iter()
        .find(|item| item.key == cli_key)
        .ok_or_else(|| format!("不支持的本地分析 CLI: {cli_key}"))
}

fn resolve_local_cli_path(spec: LocalAnalysisCliSpec) -> Result<PathBuf, String> {
    candidate_cli_paths(spec.executable)
        .into_iter()
        .find(|path| path.is_file())
        .ok_or_else(|| {
            format!(
                "未找到 {}。请先在本机安装并登录 {}，并确认 {} 在 PATH 中。",
                spec.label, spec.label, spec.executable
            )
        })
}

#[tauri::command]
pub fn analysis_export_list_local_clis() -> Result<Value, String> {
    let mut seen = HashSet::new();
    let rows = LOCAL_ANALYSIS_CLIS
        .iter()
        .filter_map(|spec| {
            let path = resolve_local_cli_path(*spec).ok()?;
            let key = path.to_string_lossy().to_string();
            if !seen.insert(key.clone()) {
                return None;
            }
            Some(json!({
                "cli_key": spec.key,
                "label": spec.label,
                "executable": spec.executable,
                "path": key,
            }))
        })
        .collect::<Vec<_>>();
    Ok(json!({
        "rows": rows,
    }))
}

fn build_local_cli_prompt(markdown_path: &Path, analysis_prompt: &str) -> String {
    let file_name = markdown_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("keepwise-analysis.md");
    format!(
        "你是一个谨慎的个人资产分析助手。当前工作目录中有一份 KeepWise Markdown 资产快照文件，请先读取它，再输出中文分析报告。\n\
        \n\
         分析要求：\n\
         1. 先列出关键结论，不要给出无法从数据支持的判断。\n\
         2. 分析资产配置、集中度、流动性、投资收益、收入消费、预算与 FIRE 进度。\n\
         3. 明确区分事实、推断和需要用户补充的信息。\n\
         4. 给出可执行的下一步建议，但不要假装知道实时行情或税务细节。\n\
         5. 如数据缺失或用户备注不足，请列出缺口。\n\
         6. 报告必须简明扼要：控制在 800 字以内，最多 5 个小节，每节优先写 2-4 条要点，避免复述快照明细。\n\
         7. 只输出最终中文分析结果，不要解释你如何调用工具。\n\
         \n\
         用户额外诉求：\n\
         {analysis_prompt}\n\
         \n\
         需要先读取的 Markdown 文件：{file_name}\n\
         文件绝对路径：{}\n",
        markdown_path.to_string_lossy()
    )
}

fn truncate_text_middle(text: &str, max_chars: usize) -> String {
    let char_count = text.chars().count();
    if char_count <= max_chars {
        return text.to_string();
    }
    if max_chars <= 80 {
        return text.chars().take(max_chars).collect();
    }
    let head_chars = max_chars * 2 / 3;
    let tail_chars = max_chars.saturating_sub(head_chars + 24);
    let head: String = text.chars().take(head_chars).collect();
    let tail: String = text
        .chars()
        .skip(char_count.saturating_sub(tail_chars))
        .collect();
    format!("{head}\n\n[...中间内容已压缩以兼容 API 上下文长度...]\n\n{tail}")
}

fn build_openai_compatible_context(
    content: &str,
    analysis_prompt: &str,
    snapshot_char_limit: usize,
) -> String {
    format!(
        "用户额外诉求：\n{analysis_prompt}\n\n以下是 KeepWise 导出的 Markdown 资产快照：\n\n{}",
        truncate_text_middle(content, snapshot_char_limit)
    )
}

fn build_openai_compatible_fact_messages(source_context: &str) -> Value {
    json!([
        {
            "role": "system",
            "content": "你是个人资产分析助手的研究员。只能基于输入的 KeepWise 快照提取事实，不要补充外部知识，不要做最终结论。输出必须使用中文，并严格按以下小节：1. 已确认事实 2. 关键风险或集中点 3. 信息缺口与待确认项。每节 3-6 条要点，尽量引用快照中的数字、占比、趋势和时间。"
        },
        {
            "role": "user",
            "content": source_context
        }
    ])
}

fn build_openai_compatible_draft_messages(source_context: &str, fact_sheet: &str) -> Value {
    json!([
        {
            "role": "system",
            "content": "你是一个谨慎的个人资产分析助手。请先给关键结论，再展开原因；明确区分事实、推断和需要用户补充的信息；分析资产配置、集中度、流动性、投资收益、收入消费、预算与 FIRE 进度；给出可执行的下一步建议，但不要假装知道实时行情、税务细节或用户未提供的信息。输出控制在 800 字以内，最多 5 个小节，每节优先 2-4 条要点。"
        },
        {
            "role": "user",
            "content": format!(
                "{}\n\n下面是预先整理的事实卡片，请优先基于这些事实起草分析报告：\n\n{}",
                source_context,
                truncate_text_middle(fact_sheet, OPENAI_COMPAT_FACT_SHEET_CHAR_LIMIT)
            )
        }
    ])
}

fn build_openai_compatible_review_messages(
    source_context: &str,
    fact_sheet: &str,
    draft: &str,
) -> Value {
    json!([
        {
            "role": "system",
            "content": "你是严格的审稿人。请检查草稿里是否存在证据不足、遗漏关键矛盾、建议太空泛、没有指出数据缺口等问题。不要重写全文，只输出 3 个小节：1. 证据不足或可疑表述 2. 漏掉的重点 3. 对最终成稿的修改指令。每节 2-5 条要点。"
        },
        {
            "role": "user",
            "content": format!(
                "压缩后的原始快照：\n\n{}\n\n事实卡片：\n\n{}\n\n当前草稿：\n\n{}",
                source_context,
                truncate_text_middle(fact_sheet, OPENAI_COMPAT_FACT_SHEET_CHAR_LIMIT),
                truncate_text_middle(draft, OPENAI_COMPAT_DRAFT_CHAR_LIMIT)
            )
        }
    ])
}

fn build_openai_compatible_final_messages(
    source_context: &str,
    fact_sheet: &str,
    draft: &str,
    review: &str,
) -> Value {
    json!([
        {
            "role": "system",
            "content": "你是一个谨慎的个人资产分析助手。请综合事实卡片、草稿和审稿意见，输出最终中文报告。要求：1. 开头先给 3-5 条关键结论；2. 明确区分事实、推断和待补充信息；3. 建议必须可执行，且和快照中的问题一一对应；4. 语言尽量像资深分析师，避免模板腔；5. 不要暴露中间推理过程；6. 不要引用任何外部最新信息。"
        },
        {
            "role": "user",
            "content": format!(
                "{}\n\n事实卡片：\n\n{}\n\n上一版草稿：\n\n{}\n\n审稿意见：\n\n{}\n\n请据此输出最终版本。",
                source_context,
                truncate_text_middle(fact_sheet, OPENAI_COMPAT_FACT_SHEET_CHAR_LIMIT),
                truncate_text_middle(draft, OPENAI_COMPAT_DRAFT_CHAR_LIMIT),
                truncate_text_middle(review, OPENAI_COMPAT_REVIEW_NOTES_CHAR_LIMIT)
            )
        }
    ])
}

fn build_openai_compatible_single_pass_messages(source_context: &str) -> Value {
    json!([
        {
            "role": "system",
            "content": "你是一个谨慎的个人资产分析助手。请基于 KeepWise 资产快照输出最终中文分析报告。要求：1. 先给 3-5 条关键结论；2. 明确区分事实、推断和待补充信息；3. 分析资产配置、集中度、流动性、投资收益、收入消费、预算与 FIRE 进度；4. 给出可执行建议；5. 不要假装知道外部实时信息；6. 语言尽量像资深分析师，避免模板腔；7. 控制在 900 字以内。"
        },
        {
            "role": "user",
            "content": source_context
        }
    ])
}

fn remaining_timeout_seconds(
    started_at: Instant,
    total_timeout_seconds: u64,
    min_step_seconds: u64,
    phase: &str,
) -> Result<u64, String> {
    let elapsed = started_at.elapsed().as_secs();
    let remaining = total_timeout_seconds.saturating_sub(elapsed);
    if remaining < min_step_seconds {
        return Err(format!(
            "AI API 在 {phase} 阶段前已接近超时，请提高超时时间后重试"
        ));
    }
    Ok(remaining)
}

fn request_openai_compatible_chat_completion(
    endpoint: &str,
    api_key: &str,
    model: &str,
    messages: Value,
    temperature: f64,
    timeout_seconds: u64,
    phase: &str,
) -> Result<Value, String> {
    let request_body = json!({
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "stream": false,
    });
    let request_text = request_body.to_string();
    let client = Client::builder()
        .timeout(Duration::from_secs(timeout_seconds))
        .build()
        .map_err(|e| format!("创建 AI HTTP 客户端失败: {e}"))?;
    let response = client
        .post(endpoint)
        .header(AUTHORIZATION, format!("Bearer {api_key}"))
        .header(CONTENT_TYPE, "application/json")
        .body(request_text.clone())
        .send()
        .map_err(|e| {
            format!(
                "调用 AI API 失败（阶段：{phase}，请求约 {} KB）: {e:?}",
                request_text.len() / 1024
            )
        })?;
    let status = response.status();
    let response_text = response
        .text()
        .map_err(|e| format!("读取 AI API 响应失败: {e}"))?;
    if !status.is_success() {
        return Err(format!(
            "AI API 返回失败状态 {}: {}",
            status,
            tail_text(&response_text, 1500)
        ));
    }
    serde_json::from_str(&response_text).map_err(|e| format!("解析 AI API 响应失败: {e}"))
}

fn normalize_openai_compatible_endpoint(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("AI API endpoint 不能为空".to_string());
    }
    let mut url = Url::parse(trimmed).map_err(|e| format!("AI API endpoint 格式无效: {e}"))?;
    match url.scheme() {
        "http" | "https" => {}
        other => return Err(format!("AI API endpoint 仅支持 http/https，当前为 {other}")),
    }
    let path = url.path().trim_end_matches('/');
    if !path.ends_with("/chat/completions") {
        let normalized_path = if path.is_empty() || path == "/" {
            "/chat/completions".to_string()
        } else {
            format!("{path}/chat/completions")
        };
        url.set_path(&normalized_path);
    }
    Ok(url.to_string())
}

fn extract_openai_compatible_text(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        Value::Array(items) => {
            let merged = items
                .iter()
                .filter_map(extract_openai_compatible_text)
                .collect::<Vec<_>>()
                .join("\n");
            if merged.trim().is_empty() {
                None
            } else {
                Some(merged)
            }
        }
        Value::Object(map) => map
            .get("text")
            .or_else(|| map.get("content"))
            .and_then(extract_openai_compatible_text),
        _ => None,
    }
}

fn extract_openai_compatible_response_content(payload: &Value) -> Option<String> {
    payload
        .get("choices")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .find_map(|choice| {
            choice
                .get("message")
                .and_then(|message| message.get("content"))
                .and_then(extract_openai_compatible_text)
                .or_else(|| choice.get("text").and_then(extract_openai_compatible_text))
        })
}

fn tail_text(text: &str, max_chars: usize) -> String {
    let len = text.chars().count();
    if len <= max_chars {
        return text.to_string();
    }
    text.chars().skip(len - max_chars).collect()
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

fn emit_cli_progress(
    app: &AppHandle,
    run_id: &str,
    cli: LocalAnalysisCliSpec,
    stage: &str,
    message: &str,
    started_at: Instant,
    timeout_seconds: u64,
    stdout: &str,
    stderr: &str,
) {
    let elapsed_ms = started_at.elapsed().as_millis() as u64;
    let _ = app.emit(
        "analysis-export-cli-progress",
        json!({
            "run_id": run_id,
            "cli_key": cli.key,
            "cli_label": cli.label,
            "stage": stage,
            "message": message,
            "elapsed_ms": elapsed_ms,
            "timeout_seconds": timeout_seconds,
            "stdout_tail": tail_text(stdout, 1600),
            "stderr_tail": tail_text(stderr, 1600),
            "stdout_bytes": stdout.len(),
            "stderr_bytes": stderr.len(),
            "timestamp": Local::now().format("%Y-%m-%dT%H:%M:%S%:z").to_string(),
        }),
    );
}

fn spawn_pipe_reader<R: Read + Send + 'static>(
    mut reader: R,
    tx: mpsc::Sender<CliPipeEvent>,
    is_stdout: bool,
) -> std::thread::JoinHandle<Result<(), String>> {
    std::thread::spawn(move || {
        let mut buf = [0_u8; 4096];
        loop {
            let n = reader.read(&mut buf).map_err(|e| {
                if is_stdout {
                    format!("读取分析 CLI stdout 失败: {e}")
                } else {
                    format!("读取分析 CLI stderr 失败: {e}")
                }
            })?;
            if n == 0 {
                break;
            }
            let chunk = String::from_utf8_lossy(&buf[..n]).to_string();
            let event = if is_stdout {
                CliPipeEvent::Stdout(chunk)
            } else {
                CliPipeEvent::Stderr(chunk)
            };
            if tx.send(event).is_err() {
                break;
            }
        }
        Ok(())
    })
}

fn drain_cli_pipe_events(
    rx: &mpsc::Receiver<CliPipeEvent>,
    stdout: &mut String,
    stderr: &mut String,
) -> bool {
    let mut changed = false;
    while let Ok(event) = rx.try_recv() {
        match event {
            CliPipeEvent::Stdout(chunk) => stdout.push_str(&chunk),
            CliPipeEvent::Stderr(chunk) => stderr.push_str(&chunk),
        }
        changed = true;
    }
    changed
}

fn spawn_local_cli_child(
    spec: LocalAnalysisCliSpec,
    cli_path: &Path,
    cwd: &Path,
    prompt: &str,
) -> Result<std::process::Child, String> {
    let mut command = Command::new(cli_path);
    match spec.key {
        "codex" => {
            command
                .arg("exec")
                .arg("--skip-git-repo-check")
                .arg("--sandbox")
                .arg("read-only")
                .arg("--color")
                .arg("never")
                .arg(prompt);
        }
        "copilot" => {
            command
                .arg("-C")
                .arg(cwd)
                .arg("-p")
                .arg(prompt)
                .arg("--allow-all-tools")
                .arg("--allow-all-paths")
                .arg("--output-format")
                .arg("text")
                .arg("-s")
                .arg("--no-color");
        }
        "claude" => {
            command
                .arg("-p")
                .arg(prompt)
                .arg("--output-format")
                .arg("text")
                .arg("--permission-mode")
                .arg("bypassPermissions")
                .arg("--tools")
                .arg("Read")
                .arg("--add-dir")
                .arg(cwd)
                .arg("--no-session-persistence");
        }
        _ => return Err(format!("不支持的本地分析 CLI: {}", spec.key)),
    }
    command
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("启动 {} 失败: {e}", spec.label))
}

fn run_local_cli_exec(
    app: &AppHandle,
    run_id: &str,
    cli: LocalAnalysisCliSpec,
    cli_path: &Path,
    cwd: &Path,
    prompt: &str,
    timeout_seconds: u64,
) -> Result<(i32, String, String, bool), String> {
    let started_at = Instant::now();
    let mut stdout = String::new();
    let mut stderr = String::new();
    emit_cli_progress(
        app,
        run_id,
        cli,
        "starting",
        &format!("正在启动本地 {}", cli.label),
        started_at,
        timeout_seconds,
        &stdout,
        &stderr,
    );

    let mut child = spawn_local_cli_child(cli, cli_path, cwd, prompt)?;

    let stdout_pipe = child
        .stdout
        .take()
        .ok_or_else(|| format!("打开 {} stdout 失败", cli.label))?;
    let stderr_pipe = child
        .stderr
        .take()
        .ok_or_else(|| format!("打开 {} stderr 失败", cli.label))?;
    let (tx, rx) = mpsc::channel::<CliPipeEvent>();
    let stdout_reader = spawn_pipe_reader(stdout_pipe, tx.clone(), true);
    let stderr_reader = spawn_pipe_reader(stderr_pipe, tx, false);

    emit_cli_progress(
        app,
        run_id,
        cli,
        "prompt_sent",
        &format!("资产 Markdown 已交给 {}，等待模型分析", cli.label),
        started_at,
        timeout_seconds,
        &stdout,
        &stderr,
    );

    let deadline = Instant::now() + Duration::from_secs(timeout_seconds);
    let mut last_emit = Instant::now();
    let mut timed_out = false;
    loop {
        let changed = drain_cli_pipe_events(&rx, &mut stdout, &mut stderr);
        if changed && last_emit.elapsed() >= Duration::from_millis(700) {
            emit_cli_progress(
                app,
                run_id,
                cli,
                "running",
                &format!("{} 正在分析，已收到部分输出", cli.label),
                started_at,
                timeout_seconds,
                &stdout,
                &stderr,
            );
            last_emit = Instant::now();
        }

        if child
            .try_wait()
            .map_err(|e| format!("等待 {} 进程失败: {e}", cli.label))?
            .is_some()
        {
            break;
        }
        if Instant::now() >= deadline {
            timed_out = true;
            emit_cli_progress(
                app,
                run_id,
                cli,
                "timeout",
                &format!("{} 分析达到超时上限，正在终止进程", cli.label),
                started_at,
                timeout_seconds,
                &stdout,
                &stderr,
            );
            let _ = child.kill();
            break;
        }
        std::thread::sleep(Duration::from_millis(200));
    }

    let status = child
        .wait()
        .map_err(|e| format!("读取 {} 退出状态失败: {e}", cli.label))?;
    let exit_code = status.code().unwrap_or(-1);
    stdout_reader
        .join()
        .map_err(|_| format!("读取 {} stdout 线程异常", cli.label))?
        .map_err(|e| format!("读取 {} stdout 失败: {e}", cli.label))?;
    stderr_reader
        .join()
        .map_err(|_| format!("读取 {} stderr 线程异常", cli.label))?
        .map_err(|e| format!("读取 {} stderr 失败: {e}", cli.label))?;
    let _ = drain_cli_pipe_events(&rx, &mut stdout, &mut stderr);
    let completion_message = if timed_out {
        format!("{} 分析已超时结束", cli.label)
    } else {
        format!("{} 分析已完成，正在回填结果", cli.label)
    };
    emit_cli_progress(
        app,
        run_id,
        cli,
        if timed_out { "timeout" } else { "completed" },
        &completion_message,
        started_at,
        timeout_seconds,
        &stdout,
        &stderr,
    );
    Ok((exit_code, stdout, stderr, timed_out))
}

fn analysis_export_run_local_cli_blocking(
    app: AppHandle,
    req: AnalysisExportRunLocalCliRequest,
) -> Result<Value, String> {
    let cli_key = req
        .cli_key
        .unwrap_or_else(|| "codex".to_string())
        .trim()
        .to_string();
    let cli = resolve_local_cli_spec(&cli_key)?;
    let content = req.content.unwrap_or_default();
    if content.trim().is_empty() {
        return Err("Markdown 内容为空，请先生成预览".to_string());
    }
    let bytes = content.as_bytes();
    if bytes.len() > MAX_EXPORT_BYTES {
        return Err("Markdown 内容超过 10MB 上限".to_string());
    }

    let (base_dir, markdown_path) = prepare_analysis_export_markdown(&app, cli.key, &content)?;

    let cli_path = resolve_local_cli_path(cli)?;
    let analysis_prompt = req.analysis_prompt.unwrap_or_else(|| {
        "请给出资产配置、风险集中度、再平衡、现金流与 FIRE 进度建议。".to_string()
    });
    let prompt = build_local_cli_prompt(&markdown_path, &analysis_prompt);
    let timeout_seconds = req
        .timeout_seconds
        .unwrap_or(DEFAULT_LOCAL_CLI_TIMEOUT_SECONDS)
        .clamp(60, 3600);
    let run_id = req
        .run_id
        .unwrap_or_else(|| format!("{}-{}", cli.key, Local::now().format("%Y%m%d-%H%M%S")));
    let (exit_code, stdout, stderr, timed_out) = run_local_cli_exec(
        &app,
        &run_id,
        cli,
        &cli_path,
        &base_dir,
        &prompt,
        timeout_seconds,
    )?;
    let success = exit_code == 0 && !timed_out;

    Ok(json!({
        "run_id": run_id,
        "cli_key": cli.key,
        "provider": "local_cli",
        "provider_label": cli.label,
        "cli_label": cli.label,
        "success": success,
        "exit_code": exit_code,
        "timed_out": timed_out,
        "cli_path": cli_path.to_string_lossy().to_string(),
        "markdown_path": markdown_path.to_string_lossy().to_string(),
        "stdout": stdout,
        "stderr": stderr,
    }))
}

fn analysis_export_run_openai_compatible_blocking(
    app: AppHandle,
    req: AnalysisExportRunOpenAiCompatibleRequest,
) -> Result<Value, String> {
    let endpoint = normalize_openai_compatible_endpoint(req.endpoint.unwrap_or_default().as_str())?;
    let api_key = req.api_key.unwrap_or_default().trim().to_string();
    if api_key.is_empty() {
        return Err("AI API key 不能为空".to_string());
    }
    let model = req.model.unwrap_or_default().trim().to_string();
    if model.is_empty() {
        return Err("AI 模型名称不能为空".to_string());
    }
    let content = req.content.unwrap_or_default();
    if content.trim().is_empty() {
        return Err("Markdown 内容为空，请先生成预览".to_string());
    }
    if content.as_bytes().len() > MAX_EXPORT_BYTES {
        return Err("Markdown 内容超过 10MB 上限".to_string());
    }
    let analysis_prompt = req.analysis_prompt.unwrap_or_else(|| {
        "请给出资产配置、风险集中度、再平衡、现金流与 FIRE 进度建议。".to_string()
    });
    let timeout_seconds = req
        .timeout_seconds
        .unwrap_or(DEFAULT_OPENAI_COMPAT_TIMEOUT_SECONDS)
        .clamp(30, 900);
    let run_id = req
        .run_id
        .unwrap_or_else(|| format!("openai-compatible-{}", Local::now().format("%Y%m%d-%H%M%S")));
    let (_base_dir, markdown_path) = prepare_analysis_export_markdown(&app, "openai", &content)?;
    let started_at = Instant::now();
    let fact_context = build_openai_compatible_context(
        &content,
        &analysis_prompt,
        OPENAI_COMPAT_FACT_CONTEXT_CHAR_LIMIT,
    );
    let review_context = build_openai_compatible_context(
        &content,
        &analysis_prompt,
        OPENAI_COMPAT_REVIEW_CONTEXT_CHAR_LIMIT,
    );
    let multi_pass_result = (|| -> Result<(Value, String, String, String, String), String> {
        let fact_payload = request_openai_compatible_chat_completion(
            &endpoint,
            &api_key,
            &model,
            build_openai_compatible_fact_messages(&fact_context),
            0.1,
            remaining_timeout_seconds(started_at, timeout_seconds, 20, "事实提取")?,
            "事实提取",
        )?;
        let fact_sheet = extract_openai_compatible_response_content(&fact_payload)
            .ok_or_else(|| "AI API 事实提取阶段没有返回可解析的文本".to_string())?;

        let draft_payload = request_openai_compatible_chat_completion(
            &endpoint,
            &api_key,
            &model,
            build_openai_compatible_draft_messages(&review_context, &fact_sheet),
            0.2,
            remaining_timeout_seconds(started_at, timeout_seconds, 20, "草稿生成")?,
            "草稿生成",
        )?;
        let draft_content = extract_openai_compatible_response_content(&draft_payload)
            .ok_or_else(|| "AI API 草稿阶段没有返回可解析的文本".to_string())?;

        let review_payload = request_openai_compatible_chat_completion(
            &endpoint,
            &api_key,
            &model,
            build_openai_compatible_review_messages(&review_context, &fact_sheet, &draft_content),
            0.1,
            remaining_timeout_seconds(started_at, timeout_seconds, 15, "审稿复核")?,
            "审稿复核",
        )?;
        let review_notes = extract_openai_compatible_response_content(&review_payload)
            .ok_or_else(|| "AI API 审稿阶段没有返回可解析的文本".to_string())?;

        let final_payload = request_openai_compatible_chat_completion(
            &endpoint,
            &api_key,
            &model,
            build_openai_compatible_final_messages(
                &review_context,
                &fact_sheet,
                &draft_content,
                &review_notes,
            ),
            0.2,
            remaining_timeout_seconds(started_at, timeout_seconds, 10, "最终成稿")?,
            "最终成稿",
        )?;
        let analysis_content = extract_openai_compatible_response_content(&final_payload)
            .ok_or_else(|| "AI API 最终成稿阶段没有返回可解析的分析文本".to_string())?;
        Ok((
            final_payload,
            analysis_content,
            fact_sheet,
            draft_content,
            review_notes,
        ))
    })();
    let (
        final_payload,
        analysis_content,
        fact_sheet,
        draft_content,
        review_notes,
        analysis_mode,
        fallback_note,
    ) = match multi_pass_result {
        Ok((payload, content, fact_sheet, draft_content, review_notes)) => (
            payload,
            content,
            fact_sheet,
            draft_content,
            review_notes,
            "multi_pass",
            None,
        ),
        Err(multi_pass_error) => {
            let fallback_payload = request_openai_compatible_chat_completion(
                &endpoint,
                &api_key,
                &model,
                build_openai_compatible_single_pass_messages(&fact_context),
                0.2,
                remaining_timeout_seconds(started_at, timeout_seconds, 20, "单轮回退")?,
                "单轮回退",
            )
            .map_err(|fallback_error| {
                format!("{multi_pass_error}\n\n回退到单轮分析也失败：{fallback_error}")
            })?;
            let fallback_content = extract_openai_compatible_response_content(&fallback_payload)
                .ok_or_else(|| "AI API 单轮回退阶段没有返回可解析的分析文本".to_string())?;
            (
                fallback_payload,
                fallback_content,
                String::new(),
                String::new(),
                String::new(),
                "single_pass_fallback",
                Some(multi_pass_error),
            )
        }
    };
    Ok(json!({
        "run_id": run_id,
        "provider": "openai_compatible",
        "provider_label": "OpenAI 兼容 API",
        "success": true,
        "analysis_mode": analysis_mode,
        "endpoint": endpoint,
        "model": model,
        "markdown_path": markdown_path.to_string_lossy().to_string(),
        "content": analysis_content,
        "response_id": final_payload.get("id").cloned().unwrap_or(Value::Null),
        "usage": final_payload.get("usage").cloned().unwrap_or(Value::Null),
        "fallback_note": fallback_note,
        "passes": json!({
            "fact_sheet": fact_sheet,
            "draft": draft_content,
            "review": review_notes,
        }),
    }))
}

#[tauri::command]
pub async fn analysis_export_run_local_cli(
    app: AppHandle,
    req: AnalysisExportRunLocalCliRequest,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || analysis_export_run_local_cli_blocking(app, req))
        .await
        .map_err(|e| format!("本地 CLI 后台任务失败: {e}"))?
}

#[tauri::command]
pub async fn analysis_export_run_openai_compatible(
    app: AppHandle,
    req: AnalysisExportRunOpenAiCompatibleRequest,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        analysis_export_run_openai_compatible_blocking(app, req)
    })
    .await
    .map_err(|e| format!("AI API 后台任务失败: {e}"))?
}

#[tauri::command]
pub async fn analysis_export_run_codex(
    app: AppHandle,
    req: AnalysisExportRunCodexRequest,
) -> Result<Value, String> {
    analysis_export_run_local_cli(
        app,
        AnalysisExportRunLocalCliRequest {
            cli_key: Some("codex".to_string()),
            content: req.content,
            analysis_prompt: req.analysis_prompt,
            timeout_seconds: req.timeout_seconds,
            run_id: req.run_id,
        },
    )
    .await
}

#[cfg(test)]
mod tests {
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
        let path =
            std::env::temp_dir().join(format!("kw_analysis_export_{}.sqlite", Uuid::new_v4()));
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
        let target =
            std::env::temp_dir().join(format!("kw_analysis_export_{}.txt", Uuid::new_v4()));
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
            normalize_openai_compatible_endpoint("https://example.com/v1/chat/completions")
                .unwrap(),
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
}
