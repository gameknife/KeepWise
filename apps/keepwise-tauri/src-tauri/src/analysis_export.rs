use chrono::{Datelike, Local};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

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
    let include_consumption_detail =
        bool_param(req.include_consumption_detail.as_deref(), false);
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

    let account_notes_payload = query_account_notes_at_db_path(
        db_path,
        AccountNotesQueryRequest { account_id: None },
    )?;
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
pub fn analysis_export_snapshot(app: AppHandle, req: AnalysisExportRequest) -> Result<Value, String> {
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
         6. 只输出最终中文分析结果，不要解释你如何调用工具。\n\
         \n\
         用户额外诉求：\n\
         {analysis_prompt}\n\
         \n\
         需要先读取的 Markdown 文件：{file_name}\n\
         文件绝对路径：{}\n",
        markdown_path.to_string_lossy()
    )
}

fn tail_text(text: &str, max_chars: usize) -> String {
    let len = text.chars().count();
    if len <= max_chars {
        return text.to_string();
    }
    text.chars().skip(len - max_chars).collect()
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

    let base_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("无法解析 app_local_data_dir: {e}"))?
        .join("analysis_exports");
    std::fs::create_dir_all(&base_dir).map_err(|e| format!("创建分析临时目录失败: {e}"))?;
    let stamp = Local::now().format("%Y%m%d-%H%M%S").to_string();
    let markdown_path = base_dir.join(format!("keepwise-{}-analysis-{stamp}.md", cli.key));
    std::fs::write(&markdown_path, bytes).map_err(|e| format!("写入分析临时 Markdown 失败: {e}"))?;

    let cli_path = resolve_local_cli_path(cli)?;
    let analysis_prompt = req
        .analysis_prompt
        .unwrap_or_else(|| "请给出资产配置、风险集中度、再平衡、现金流与 FIRE 进度建议。".to_string());
    let prompt = build_local_cli_prompt(&markdown_path, &analysis_prompt);
    let timeout_seconds = req
        .timeout_seconds
        .unwrap_or(DEFAULT_LOCAL_CLI_TIMEOUT_SECONDS)
        .clamp(60, 3600);
    let run_id = req
        .run_id
        .unwrap_or_else(|| format!("{}-{}", cli.key, Local::now().format("%Y%m%d-%H%M%S")));
    let (exit_code, stdout, stderr, timed_out) =
        run_local_cli_exec(&app, &run_id, cli, &cli_path, &base_dir, &prompt, timeout_seconds)?;
    let success = exit_code == 0 && !timed_out;

    Ok(json!({
        "run_id": run_id,
        "cli_key": cli.key,
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
        AnalysisExportRequest,
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

        assert!(payload.get("generated_at").and_then(Value::as_str).is_some());
        assert!(payload.get("wealth_overview").is_some());
        assert_eq!(
            payload.get("account_notes").and_then(Value::as_array).map(Vec::len),
            Some(0)
        );
        assert!(
            payload
                .get("consumption")
                .and_then(|v| v.get("transactions"))
                .is_none()
        );
    }

    #[test]
    fn write_file_rejects_non_markdown_path() {
        let target = std::env::temp_dir().join(format!("kw_analysis_export_{}.txt", Uuid::new_v4()));
        let result = analysis_export_write_file(target.to_string_lossy().to_string(), "# x".to_string());
        assert!(result.is_err());
    }

    #[test]
    fn local_cli_prompt_contains_markdown_path_and_analysis_prompt() {
        let path = PathBuf::from("/tmp/keepwise-test.md");
        let prompt = build_local_cli_prompt(&path, "关注再平衡");
        assert!(prompt.contains("/tmp/keepwise-test.md"));
        assert!(prompt.contains("keepwise-test.md"));
        assert!(prompt.contains("关注再平衡"));
    }
}
