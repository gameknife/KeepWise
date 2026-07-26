use super::*;

pub(super) fn read_optional_json<T>(path: &Path) -> Result<Option<T>, String>
where
    T: for<'de> Deserialize<'de>,
{
    match fs::read(path) {
        Ok(raw) => {
            let parsed = serde_json::from_slice::<T>(&raw)
                .map_err(|e| format!("解析 JSON 失败 ({}): {e}", path.to_string_lossy()))?;
            Ok(Some(parsed))
        }
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("读取文件失败 ({}): {e}", path.to_string_lossy())),
    }
}

pub(super) fn write_json_atomic<T: Serialize>(path: &Path, payload: &T) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("路径没有父目录: {}", path.to_string_lossy()))?;
    fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
    let tmp = path.with_extension("tmp");
    let bytes = serde_json::to_vec_pretty(payload).map_err(|e| format!("序列化 JSON 失败: {e}"))?;
    fs::write(&tmp, bytes).map_err(|e| format!("写入临时文件失败: {e}"))?;
    fs::rename(&tmp, path).map_err(|e| format!("替换文件失败: {e}"))?;
    Ok(())
}

pub(super) fn resolve_sync_dir(app: &AppHandle, create: bool) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("解析 app_config_dir 失败: {e}"))?;
    let sync_dir = base.join(SYNC_DIR_NAME);
    if create {
        fs::create_dir_all(&sync_dir).map_err(|e| format!("创建同步目录失败: {e}"))?;
    }
    Ok(sync_dir)
}

pub(super) fn sync_config_path(app: &AppHandle, create: bool) -> Result<PathBuf, String> {
    Ok(resolve_sync_dir(app, create)?.join(SYNC_CONFIG_FILE))
}

pub(super) fn sync_state_path(app: &AppHandle, create: bool) -> Result<PathBuf, String> {
    Ok(resolve_sync_dir(app, create)?.join(SYNC_STATE_FILE))
}

pub(super) fn load_sync_config(app: &AppHandle) -> Result<Option<PersistedSyncConfig>, String> {
    let path = sync_config_path(app, false)?;
    read_optional_json::<PersistedSyncConfig>(&path)
}

pub(super) fn save_sync_config(app: &AppHandle, cfg: &PersistedSyncConfig) -> Result<(), String> {
    let path = sync_config_path(app, true)?;
    write_json_atomic(&path, cfg)
}

pub(super) fn load_sync_state(app: &AppHandle) -> Result<Option<PersistedSyncState>, String> {
    let path = sync_state_path(app, false)?;
    read_optional_json::<PersistedSyncState>(&path)
}

pub(super) fn save_sync_state(app: &AppHandle, state: &PersistedSyncState) -> Result<(), String> {
    let path = sync_state_path(app, true)?;
    write_json_atomic(&path, state)
}

pub(super) fn ensure_required_text(value: Option<String>, field: &str) -> Result<String, String> {
    let text = value.unwrap_or_default().trim().to_string();
    if text.is_empty() {
        return Err(format!("{field} 必填"));
    }
    Ok(text)
}

pub(super) fn infer_endpoint(region: &str) -> String {
    format!("https://cos.{region}.myqcloud.com")
}

pub(super) fn sanitize_token(raw: &str) -> String {
    raw.chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}

pub(super) fn infer_bucket(region: &str) -> String {
    let region_norm = sanitize_token(region).to_lowercase();
    let default_bucket = format!("keepwise-sync-{region_norm}");
    if default_bucket.len() > 63 {
        default_bucket[..63].to_string()
    } else {
        default_bucket
    }
}

pub(super) fn normalize_bucket_for_cos(base_bucket: String, app_id: Option<&str>) -> String {
    let mut bucket = sanitize_token(base_bucket.trim()).to_ascii_lowercase();
    if bucket.is_empty() {
        bucket = "keepwise-sync".to_string();
    }
    if bucket.len() > 48 {
        bucket = bucket[..48].to_string();
    }
    if let Some(appid) = app_id {
        let appid_trim = appid.trim();
        if !appid_trim.is_empty() {
            let suffix = format!("-{}", sanitize_token(appid_trim));
            if !bucket.ends_with(&suffix) {
                bucket.push_str(&suffix);
            }
        }
    }
    if bucket.len() > 63 {
        bucket = bucket[..63].to_string();
    }
    bucket.trim_matches('-').to_string()
}

pub(super) fn infer_prefix() -> String {
    "keepwise-sync".to_string()
}

pub(super) fn next_sync_at(last_sync_at: Option<&str>, policy: &SyncAutoPolicy) -> Option<String> {
    if !policy.enabled {
        return None;
    }
    let base = last_sync_at
        .and_then(|v| {
            chrono::DateTime::parse_from_rfc3339(v)
                .ok()
                .map(|dt| dt.with_timezone(&Utc))
        })
        .unwrap_or_else(Utc::now);
    Some(
        (base + Duration::minutes(i64::from(policy.interval_minutes)))
            .to_rfc3339_opts(SecondsFormat::Secs, true),
    )
}

pub(super) fn default_state(device_id: String) -> PersistedSyncState {
    PersistedSyncState {
        device_id,
        local_head: None,
        remote_head: None,
        syncing: false,
        last_sync_at: None,
        last_push_at: None,
        last_pull_at: None,
        last_error: None,
        conflict: false,
        next_sync_at: None,
        last_synced_hash: None,
    }
}

pub(super) fn compose_status(
    cfg: Option<&PersistedSyncConfig>,
    state: Option<&PersistedSyncState>,
) -> SyncStatus {
    match (cfg, state) {
        (Some(c), Some(s)) => SyncStatus {
            configured: true,
            provider: Some(c.provider.clone()),
            workspace_id: Some(c.workspace_id.clone()),
            device_id: Some(s.device_id.clone()),
            local_head: s.local_head.clone(),
            remote_head: s.remote_head.clone(),
            syncing: s.syncing,
            last_sync_at: s.last_sync_at.clone(),
            last_push_at: s.last_push_at.clone(),
            last_pull_at: s.last_pull_at.clone(),
            last_error: s.last_error.clone(),
            conflict: s.conflict,
            auto_sync_enabled: c.auto_policy.enabled,
            interval_minutes: c.auto_policy.interval_minutes,
            next_sync_at: s
                .next_sync_at
                .clone()
                .or_else(|| next_sync_at(s.last_sync_at.as_deref(), &c.auto_policy)),
        },
        (Some(c), None) => SyncStatus {
            configured: true,
            provider: Some(c.provider.clone()),
            workspace_id: Some(c.workspace_id.clone()),
            device_id: None,
            local_head: None,
            remote_head: None,
            syncing: false,
            last_sync_at: None,
            last_push_at: None,
            last_pull_at: None,
            last_error: None,
            conflict: false,
            auto_sync_enabled: c.auto_policy.enabled,
            interval_minutes: c.auto_policy.interval_minutes,
            next_sync_at: next_sync_at(None, &c.auto_policy),
        },
        _ => SyncStatus {
            configured: false,
            provider: None,
            workspace_id: None,
            device_id: None,
            local_head: None,
            remote_head: None,
            syncing: false,
            last_sync_at: None,
            last_push_at: None,
            last_pull_at: None,
            last_error: None,
            conflict: false,
            auto_sync_enabled: false,
            interval_minutes: 0,
            next_sync_at: None,
        },
    }
}
