use super::*;

pub(super) fn workspace_root_prefix(cfg: &PersistedSyncConfig) -> String {
    let prefix = cfg.prefix.trim().trim_matches('/');
    if prefix.is_empty() {
        return format!("keepwise-sync/{}", cfg.workspace_id.trim());
    }
    if prefix.starts_with("keepwise-sync") {
        format!("{}/{}", prefix, cfg.workspace_id.trim())
    } else {
        format!("{}/keepwise-sync/{}", prefix, cfg.workspace_id.trim())
    }
}

pub(super) fn manifest_key(cfg: &PersistedSyncConfig) -> String {
    format!("{}/manifest.json", workspace_root_prefix(cfg))
}

pub(super) fn head_key(cfg: &PersistedSyncConfig) -> String {
    format!("{}/refs/head.json", workspace_root_prefix(cfg))
}

pub(super) fn snapshot_key(cfg: &PersistedSyncConfig, snapshot_id: &str) -> String {
    format!(
        "{}/snapshots/{}.kwsnap",
        workspace_root_prefix(cfg),
        snapshot_id.trim()
    )
}

pub(super) fn legacy_snapshot_key(cfg: &PersistedSyncConfig) -> String {
    format!(
        "{}/snapshots/{}",
        workspace_root_prefix(cfg),
        SINGLE_SNAPSHOT_OBJECT_NAME
    )
}

pub(super) fn snapshots_prefix(cfg: &PersistedSyncConfig) -> String {
    format!("{}/snapshots/", workspace_root_prefix(cfg))
}

pub(super) fn read_remote_head(
    client: &S3Client,
    cfg: &PersistedSyncConfig,
) -> Result<Option<SyncHeadRef>, String> {
    let key = head_key(cfg);
    let raw = match client.get_object_optional(&key)? {
        Some(v) => v,
        None => return Ok(None),
    };
    let head = serde_json::from_slice::<SyncHeadRef>(&raw)
        .map_err(|e| format!("解析远端 head 失败: {e}"))?;
    Ok(Some(head))
}

pub(super) fn write_remote_head(
    client: &S3Client,
    cfg: &PersistedSyncConfig,
    head: &SyncHeadRef,
) -> Result<(), String> {
    let key = head_key(cfg);
    let body = serde_json::to_vec_pretty(head).map_err(|e| format!("序列化 head 失败: {e}"))?;
    client.put_object(&key, &body, Some("application/json"))
}

pub(super) fn ensure_workspace_initialized(
    client: &S3Client,
    cfg: &PersistedSyncConfig,
) -> Result<(), String> {
    let manifest_k = manifest_key(cfg);
    if client.get_object_optional(&manifest_k)?.is_none() {
        let manifest = SyncManifest {
            version: MANIFEST_VERSION,
            provider: SYNC_PROVIDER.to_string(),
            workspace_id: cfg.workspace_id.clone(),
            created_at: now_iso(),
        };
        let body = serde_json::to_vec_pretty(&manifest)
            .map_err(|e| format!("序列化 manifest 失败: {e}"))?;
        if let Err(err) = client.put_object(&manifest_k, &body, Some("application/json")) {
            if is_no_such_bucket_error_text(&err) {
                client.put_bucket_if_missing()?;
                client.put_object(&manifest_k, &body, Some("application/json"))?;
            } else {
                return Err(err);
            }
        }
    }

    let head_k = head_key(cfg);
    if client.get_object_optional(&head_k)?.is_none() {
        let head = SyncHeadRef {
            snapshot_id: None,
            parent_snapshot_id: None,
            updated_at: now_iso(),
            device_id: None,
            snapshot_plain_hash: None,
        };
        write_remote_head(client, cfg, &head)?;
    }
    Ok(())
}

pub(super) fn ensure_workspace_exists(
    client: &S3Client,
    cfg: &PersistedSyncConfig,
) -> Result<(), String> {
    let manifest_k = manifest_key(cfg);
    if client.get_object_optional(&manifest_k)?.is_none() {
        return Err("远端同步库不存在，请确认链接码或先在首台设备创建同步库".to_string());
    }
    Ok(())
}
