use super::*;

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

pub(super) fn build_local_cli_prompt(markdown_path: &Path, analysis_prompt: &str) -> String {
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

pub(super) fn analysis_export_run_local_cli_blocking(
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
