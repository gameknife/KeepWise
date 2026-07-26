use super::*;

pub(super) fn truncate_text_middle(text: &str, max_chars: usize) -> String {
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

pub(super) fn build_openai_compatible_context(
    content: &str,
    analysis_prompt: &str,
    snapshot_char_limit: usize,
) -> String {
    format!(
        "用户额外诉求：\n{analysis_prompt}\n\n以下是 KeepWise 导出的 Markdown 资产快照：\n\n{}",
        truncate_text_middle(content, snapshot_char_limit)
    )
}

pub(super) fn build_openai_compatible_fact_messages(source_context: &str) -> Value {
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

pub(super) fn remaining_timeout_seconds(
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

pub(super) fn normalize_openai_compatible_endpoint(raw: &str) -> Result<String, String> {
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

pub(super) fn extract_openai_compatible_response_content(payload: &Value) -> Option<String> {
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

pub(super) fn tail_text(text: &str, max_chars: usize) -> String {
    let len = text.chars().count();
    if len <= max_chars {
        return text.to_string();
    }
    text.chars().skip(len - max_chars).collect()
}

pub(super) fn analysis_export_run_openai_compatible_blocking(
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
