use super::*;

#[tauri::command]
pub fn sync_setup_create(
    app: AppHandle,
    req: SyncSetupCreateRequest,
) -> Result<SyncSetupCreateResult, String> {
    let access_key_id = ensure_required_text(req.secret_id, "secret_id")?;
    let secret_key = ensure_required_text(req.secret_key, "secret_key")?;
    let region = ensure_required_text(req.region, "region")?;
    let sync_password = ensure_required_text(req.sync_password, "sync_password")?;
    let app_id = ensure_required_text(req.app_id, "app_id")?;

    let endpoint = req
        .endpoint
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| infer_endpoint(&region));
    let bucket_raw = req
        .bucket
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| infer_bucket(&region));
    let bucket = normalize_bucket_for_cos(bucket_raw, Some(&app_id));
    let prefix = req
        .prefix
        .map(|v| v.trim().trim_matches('/').to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(infer_prefix);
    let workspace_id = req
        .workspace_id
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    let sync_key = derive_workspace_sync_key(&sync_password, &workspace_id)?;
    let now = now_iso();
    let cfg = PersistedSyncConfig {
        provider: SYNC_PROVIDER.to_string(),
        endpoint,
        region,
        bucket,
        prefix,
        workspace_id,
        access_key_id,
        secret_key,
        app_id: Some(app_id),
        session_token: None,
        path_style: req.path_style.unwrap_or(false),
        sync_key_b64: URL_SAFE_NO_PAD.encode(sync_key),
        created_at: now.clone(),
        updated_at: now,
        auto_policy: SyncAutoPolicy::default(),
    };

    let client = S3Client::new(&cfg)?;
    client.put_bucket_if_missing()?;
    ensure_workspace_initialized(&client, &cfg)?;
    let remote_head = read_remote_head(&client, &cfg)?
        .and_then(|h| h.snapshot_id)
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());

    save_sync_config(&app, &cfg)?;
    let mut state =
        load_sync_state(&app)?.unwrap_or_else(|| default_state(Uuid::new_v4().to_string()));
    state.syncing = false;
    state.conflict = false;
    state.remote_head = remote_head;
    state.local_head = None;
    state.last_error = None;
    state.last_synced_hash = None;
    state.next_sync_at = None;
    save_sync_state(&app, &state)?;

    let share_code = encrypt_share_payload(&sync_password, &to_share_payload(&cfg))?;
    let status = compose_status(Some(&cfg), Some(&state));
    Ok(SyncSetupCreateResult {
        configured: true,
        endpoint: cfg.endpoint,
        bucket: cfg.bucket,
        prefix: cfg.prefix,
        workspace_id: cfg.workspace_id,
        share_code,
        status,
    })
}

#[tauri::command]
pub fn sync_share_code_generate(
    app: AppHandle,
    req: SyncShareCodeGenerateRequest,
) -> Result<SyncShareCodeResult, String> {
    let cfg = load_sync_config(&app)?.ok_or_else(|| "尚未配置同步".to_string())?;
    let sync_password = ensure_required_text(req.sync_password, "sync_password")?;
    let share_code = encrypt_share_payload(&sync_password, &to_share_payload(&cfg))?;
    Ok(SyncShareCodeResult { share_code })
}

#[tauri::command]
pub fn sync_share_code_parse(
    req: SyncShareCodeParseRequest,
) -> Result<SyncShareCodeParseResult, String> {
    let share_code = ensure_required_text(req.share_code, "share_code")?;
    let sync_password = ensure_required_text(req.sync_password, "sync_password")?;
    let payload = decrypt_share_payload(&sync_password, &share_code)?;
    Ok(SyncShareCodeParseResult {
        provider: payload.provider,
        endpoint: payload.endpoint,
        region: payload.region,
        bucket: payload.bucket,
        prefix: payload.prefix,
        workspace_id: payload.workspace_id,
        access_key_id: payload.access_key_id,
        app_id: payload.app_id,
        path_style: payload.path_style,
    })
}

#[tauri::command]
pub fn sync_setup_link(
    app: AppHandle,
    req: SyncSetupLinkRequest,
) -> Result<SyncSetupLinkResult, String> {
    let share_code = ensure_required_text(req.share_code, "share_code")?;
    let sync_password = ensure_required_text(req.sync_password, "sync_password")?;
    let payload = decrypt_share_payload(&sync_password, &share_code)?;
    let sync_key = derive_workspace_sync_key(&sync_password, &payload.workspace_id)?;
    let now = now_iso();

    let cfg = PersistedSyncConfig {
        provider: payload.provider,
        endpoint: payload.endpoint,
        region: payload.region,
        bucket: normalize_bucket_for_cos(payload.bucket, payload.app_id.as_deref()),
        prefix: payload.prefix,
        workspace_id: payload.workspace_id,
        access_key_id: payload.access_key_id,
        secret_key: payload.secret_key,
        app_id: payload.app_id,
        session_token: payload.session_token,
        path_style: payload.path_style,
        sync_key_b64: URL_SAFE_NO_PAD.encode(sync_key),
        created_at: now.clone(),
        updated_at: now,
        auto_policy: SyncAutoPolicy::default(),
    };

    let client = S3Client::new(&cfg)?;
    client.ensure_bucket_accessible()?;
    ensure_workspace_exists(&client, &cfg)?;

    save_sync_config(&app, &cfg)?;
    let mut state =
        load_sync_state(&app)?.unwrap_or_else(|| default_state(Uuid::new_v4().to_string()));
    state.syncing = false;
    state.conflict = false;
    state.remote_head = None;
    state.local_head = None;
    state.last_error = None;
    state.last_synced_hash = None;
    state.next_sync_at = None;
    save_sync_state(&app, &state)?;

    let status = compose_status(Some(&cfg), Some(&state));
    Ok(SyncSetupLinkResult {
        configured: true,
        endpoint: cfg.endpoint,
        bucket: cfg.bucket,
        prefix: cfg.prefix,
        workspace_id: cfg.workspace_id,
        status,
    })
}

#[tauri::command]
pub fn sync_test_connection(app: AppHandle) -> Result<SyncConnectionTestResult, String> {
    let cfg = match load_sync_config(&app)? {
        Some(v) => v,
        None => {
            return Ok(SyncConnectionTestResult {
                ok: false,
                endpoint: None,
                message: "尚未配置同步".to_string(),
            });
        }
    };

    let client = S3Client::new(&cfg)?;
    match client.ensure_bucket_accessible() {
        Ok(_) => Ok(SyncConnectionTestResult {
            ok: true,
            endpoint: Some(cfg.endpoint),
            message: "连接成功，可访问 COS bucket".to_string(),
        }),
        Err(e) => Ok(SyncConnectionTestResult {
            ok: false,
            endpoint: Some(cfg.endpoint),
            message: e,
        }),
    }
}

#[tauri::command]
pub fn sync_status(app: AppHandle) -> Result<SyncStatus, String> {
    let cfg = load_sync_config(&app)?;
    let state = load_sync_state(&app)?;
    Ok(compose_status(cfg.as_ref(), state.as_ref()))
}

#[tauri::command]
pub async fn sync_poll_remote_update(app: AppHandle) -> Result<SyncRemotePollResult, String> {
    async_runtime::spawn_blocking(move || sync_poll_remote_update_blocking(app))
        .await
        .map_err(|e| format!("同步轮询任务失败: {e}"))?
}

fn sync_poll_remote_update_blocking(app: AppHandle) -> Result<SyncRemotePollResult, String> {
    let cfg = match load_sync_config(&app)? {
        Some(v) => v,
        None => {
            let status = compose_status(None, None);
            return Ok(SyncRemotePollResult {
                configured: false,
                has_remote_update: false,
                remote_head: None,
                message: "尚未配置同步".to_string(),
                status,
            });
        }
    };
    let state = load_sync_state(&app)?;
    let status = compose_status(Some(&cfg), state.as_ref());
    let local_known_remote = state
        .as_ref()
        .and_then(|s| s.remote_head.clone())
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());

    let remote_head = (|| -> Result<Option<String>, String> {
        let client = S3Client::new(&cfg)?;
        client.ensure_bucket_accessible()?;
        ensure_workspace_exists(&client, &cfg)?;
        Ok(read_remote_head(&client, &cfg)?
            .and_then(|h| h.snapshot_id)
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty()))
    })();

    match remote_head {
        Ok(remote_head_id) => {
            let has_remote_update = remote_head_id != local_known_remote;
            Ok(SyncRemotePollResult {
                configured: true,
                has_remote_update,
                remote_head: remote_head_id,
                message: if has_remote_update {
                    "检测到远端更新".to_string()
                } else {
                    "远端无更新".to_string()
                },
                status,
            })
        }
        Err(err) => Ok(SyncRemotePollResult {
            configured: true,
            has_remote_update: false,
            remote_head: None,
            message: err,
            status,
        }),
    }
}

#[tauri::command]
pub async fn sync_reconcile(app: AppHandle) -> Result<SyncReconcileResult, String> {
    async_runtime::spawn_blocking(move || sync_reconcile_blocking(app))
        .await
        .map_err(|e| format!("同步任务失败: {e}"))?
}

fn sync_reconcile_blocking(app: AppHandle) -> Result<SyncReconcileResult, String> {
    let cfg = load_sync_config(&app)?.ok_or_else(|| "尚未配置同步".to_string())?;
    let mut state =
        load_sync_state(&app)?.unwrap_or_else(|| default_state(Uuid::new_v4().to_string()));

    if state.syncing {
        let status = compose_status(Some(&cfg), Some(&state));
        return Ok(SyncReconcileResult {
            ok: true,
            message: "已有同步任务在执行".to_string(),
            status,
        });
    }

    state.syncing = true;
    save_sync_state(&app, &state)?;

    let mut ok = true;
    let message;
    match run_reconcile_impl(&app, &cfg, &mut state) {
        Ok(msg) => {
            message = msg;
            state.last_error = None;
            state.conflict = false;
        }
        Err(e) => {
            ok = false;
            message = e.clone();
            state.last_error = Some(e);
        }
    }

    let now = now_iso();
    state.syncing = false;
    state.last_sync_at = Some(now.clone());
    state.next_sync_at = None;
    save_sync_state(&app, &state)?;

    let status = compose_status(Some(&cfg), Some(&state));
    Ok(SyncReconcileResult {
        ok,
        message,
        status,
    })
}

#[tauri::command]
pub fn sync_resolve_conflict(
    app: AppHandle,
    req: SyncResolveConflictRequest,
) -> Result<SyncResolveConflictResult, String> {
    let cfg = load_sync_config(&app)?.ok_or_else(|| "尚未配置同步".to_string())?;
    let mut state =
        load_sync_state(&app)?.unwrap_or_else(|| default_state(Uuid::new_v4().to_string()));
    let action = ensure_required_text(req.action, "action")?;
    let now = now_iso();
    let client = S3Client::new(&cfg)?;

    match action.as_str() {
        "remote_first" => {
            perform_remote_first_pull(&app, &cfg, &mut state, &client, &now)?;
            state.last_error = None;
            state.conflict = false;
        }
        "local_first" => {
            let material = read_local_sync_material(&app)?;
            push_local_snapshot(&cfg, &mut state, &client, &material, &now)?;
            state.last_synced_hash = Some(compute_material_hash(&material));
            state.last_error = None;
            state.conflict = false;
        }
        "keep_both" => {
            let backup_path = backup_local_db_for_conflict(&app)?;
            perform_remote_first_pull(&app, &cfg, &mut state, &client, &now)?;
            state.last_error = Some(format!(
                "已备份本地冲突数据库: {}",
                backup_path.to_string_lossy()
            ));
            state.conflict = false;
        }
        _ => {
            return Err("action 仅支持 remote_first/local_first/keep_both".to_string());
        }
    }

    state.last_sync_at = Some(now.clone());
    state.next_sync_at = None;
    save_sync_state(&app, &state)?;
    let status = compose_status(Some(&cfg), Some(&state));
    Ok(SyncResolveConflictResult { action, status })
}

#[tauri::command]
pub fn sync_set_auto_policy(
    app: AppHandle,
    req: SyncSetAutoPolicyRequest,
) -> Result<SyncAutoPolicyResult, String> {
    let mut cfg = load_sync_config(&app)?.ok_or_else(|| "尚未配置同步".to_string())?;
    if let Some(enabled) = req.enabled {
        cfg.auto_policy.enabled = enabled;
    }
    if let Some(interval_minutes) = req.interval_minutes {
        if interval_minutes == 0 || interval_minutes > 24 * 60 {
            return Err("interval_minutes 必须在 1-1440 之间".to_string());
        }
        cfg.auto_policy.interval_minutes = interval_minutes;
    }
    if let Some(startup_delay_seconds) = req.startup_delay_seconds {
        if startup_delay_seconds > 3600 {
            return Err("startup_delay_seconds 不能超过 3600".to_string());
        }
        cfg.auto_policy.startup_delay_seconds = startup_delay_seconds;
    }
    if let Some(change_debounce_seconds) = req.change_debounce_seconds {
        if change_debounce_seconds == 0 || change_debounce_seconds > 3600 {
            return Err("change_debounce_seconds 必须在 1-3600 之间".to_string());
        }
        cfg.auto_policy.change_debounce_seconds = change_debounce_seconds;
    }

    cfg.updated_at = now_iso();
    save_sync_config(&app, &cfg)?;
    let mut state =
        load_sync_state(&app)?.unwrap_or_else(|| default_state(Uuid::new_v4().to_string()));
    state.next_sync_at = None;
    save_sync_state(&app, &state)?;

    let status = compose_status(Some(&cfg), Some(&state));
    Ok(SyncAutoPolicyResult { status })
}
