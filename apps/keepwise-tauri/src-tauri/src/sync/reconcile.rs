use super::*;

pub(super) fn fetch_remote_snapshot_material(
    client: &S3Client,
    cfg: &PersistedSyncConfig,
    snapshot_id: &str,
    expected_parent_snapshot_id: Option<&str>,
    expected_plain_hash: Option<&str>,
) -> Result<LocalSyncMaterial, String> {
    let key = snapshot_key(cfg, snapshot_id);
    let raw = match client.get_object_optional(&key)? {
        Some(v) => v,
        None => {
            let legacy_key = legacy_snapshot_key(cfg);
            client
                .get_object_optional(&legacy_key)?
                .ok_or_else(|| format!("远端快照不存在: {key}"))?
        }
    };
    let sync_key = get_sync_key_bytes(cfg)?;
    parse_snapshot_bytes_for_ref(
        &raw,
        &sync_key,
        Some(snapshot_id),
        expected_parent_snapshot_id,
        expected_plain_hash,
    )
}

pub(super) fn cleanup_old_remote_snapshots(
    client: &S3Client,
    cfg: &PersistedSyncConfig,
    current_snapshot_id: &str,
) -> Result<usize, String> {
    let current_key = snapshot_key(cfg, current_snapshot_id);
    let mut snapshots = client.list_objects(&snapshots_prefix(cfg))?;
    snapshots.sort_by(|a, b| {
        b.last_modified
            .cmp(&a.last_modified)
            .then_with(|| b.key.cmp(&a.key))
    });

    let mut retained = Vec::<String>::new();
    retained.push(current_key.clone());
    for snapshot in &snapshots {
        if retained.len() >= SNAPSHOT_RETENTION_COUNT {
            break;
        }
        if !retained.iter().any(|key| key == &snapshot.key) {
            retained.push(snapshot.key.clone());
        }
    }

    let mut deleted = 0_usize;
    for snapshot in snapshots {
        if retained.iter().any(|key| key == &snapshot.key) {
            continue;
        }
        client.delete_object(&snapshot.key)?;
        deleted += 1;
    }
    Ok(deleted)
}

pub(super) fn perform_remote_first_pull(
    app: &AppHandle,
    cfg: &PersistedSyncConfig,
    state: &mut PersistedSyncState,
    client: &S3Client,
    now: &str,
) -> Result<(), String> {
    let remote_head = read_remote_head(client, cfg)?;
    let Some(head) = remote_head else {
        state.remote_head = None;
        state.local_head = None;
        state.last_pull_at = Some(now.to_string());
        state.last_synced_hash = Some(compute_material_hash(&read_local_sync_material(app)?));
        return Ok(());
    };
    let Some(snapshot_id) = head.snapshot_id.clone() else {
        state.remote_head = None;
        state.local_head = None;
        state.last_pull_at = Some(now.to_string());
        state.last_synced_hash = Some(compute_material_hash(&read_local_sync_material(app)?));
        return Ok(());
    };

    let material = fetch_remote_snapshot_material(
        client,
        cfg,
        &snapshot_id,
        head.parent_snapshot_id.as_deref(),
        head.snapshot_plain_hash.as_deref(),
    )?;
    write_local_material(app, &material)?;

    state.remote_head = Some(snapshot_id.clone());
    state.local_head = Some(snapshot_id);
    state.last_pull_at = Some(now.to_string());
    state.last_synced_hash = Some(compute_material_hash(&read_local_sync_material(app)?));
    state.conflict = false;
    Ok(())
}

pub(super) fn push_local_snapshot(
    cfg: &PersistedSyncConfig,
    state: &mut PersistedSyncState,
    client: &S3Client,
    material: &LocalSyncMaterial,
    now: &str,
) -> Result<(), String> {
    let parent_snapshot_id = state.remote_head.clone();
    let snapshot_id = create_sync_snapshot_id();
    let sync_key = get_sync_key_bytes(cfg)?;
    let snapshot = build_snapshot_bytes(
        material,
        &sync_key,
        &snapshot_id,
        parent_snapshot_id.clone(),
        &state.device_id,
    )?;
    let key = snapshot_key(cfg, &snapshot_id);
    client.put_object(&key, &snapshot.bytes, Some("application/octet-stream"))?;

    let latest_remote = read_remote_head(client, cfg)?
        .and_then(|h| h.snapshot_id)
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());
    if latest_remote != parent_snapshot_id {
        return Err("远端 head 在推送时发生变化，请重试或处理冲突".to_string());
    }

    let new_head = SyncHeadRef {
        snapshot_id: Some(snapshot_id.clone()),
        parent_snapshot_id,
        updated_at: now.to_string(),
        device_id: Some(state.device_id.clone()),
        snapshot_plain_hash: Some(snapshot.plain_hash),
    };
    write_remote_head(client, cfg, &new_head)?;
    let _ = cleanup_old_remote_snapshots(client, cfg, &snapshot_id);

    state.remote_head = Some(snapshot_id.clone());
    state.local_head = Some(snapshot_id);
    state.last_push_at = Some(now.to_string());
    state.conflict = false;
    Ok(())
}

pub(super) fn backup_local_db_for_conflict(app: &AppHandle) -> Result<PathBuf, String> {
    let db_path = resolve_ledger_db_path(app)?;
    let backup_name = format!(
        "keepwise-conflict-{}.db",
        Utc::now().format("%Y%m%d-%H%M%S")
    );
    let backup_path = db_path.with_file_name(backup_name);
    fs::copy(&db_path, &backup_path).map_err(|e| format!("备份冲突数据库失败: {e}"))?;
    Ok(backup_path)
}

pub(super) fn run_reconcile_impl(
    app: &AppHandle,
    cfg: &PersistedSyncConfig,
    state: &mut PersistedSyncState,
) -> Result<String, String> {
    let client = S3Client::new(cfg)?;
    client.ensure_bucket_accessible()?;
    ensure_workspace_initialized(&client, cfg)?;

    let now = now_iso();
    let remote_head_ref = read_remote_head(&client, cfg)?;
    let remote_head_id = remote_head_ref
        .as_ref()
        .and_then(|h| h.snapshot_id.clone())
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());
    let remote_head_plain_hash = remote_head_ref
        .as_ref()
        .and_then(|h| h.snapshot_plain_hash.as_deref());
    let remote_head_parent_id = remote_head_ref
        .as_ref()
        .and_then(|h| h.parent_snapshot_id.as_deref());

    let local_material_before = read_local_sync_material(app)?;
    let local_hash_before = compute_material_hash(&local_material_before);
    let local_dirty = match state.last_synced_hash.as_ref() {
        Some(prev) => prev != &local_hash_before,
        None => false,
    };
    let known_remote_head = state.remote_head.clone();
    let mut auto_merged = false;

    if remote_head_id != known_remote_head {
        if let Some(snapshot_id) = remote_head_id.clone() {
            let remote_material_result = fetch_remote_snapshot_material(
                &client,
                cfg,
                &snapshot_id,
                remote_head_parent_id,
                remote_head_plain_hash,
            );
            let remote_material = match remote_material_result {
                Ok(material) => material,
                Err(err) if local_dirty => {
                    state.remote_head = Some(snapshot_id.clone());
                    push_local_snapshot(cfg, state, &client, &local_material_before, &now)?;
                    state.last_synced_hash = Some(local_hash_before);
                    return Ok(format!("远端快照不完整，已使用本地数据修复同步链: {err}"));
                }
                Err(err) => return Err(err),
            };
            let remote_hash = compute_material_hash(&remote_material);
            if local_dirty && known_remote_head.is_some() {
                let _ = backup_local_db_for_conflict(app);
                let merged = merge_sync_material(&remote_material, &local_material_before)?;
                write_local_material(app, &merged)?;
                auto_merged = true;
                state.last_synced_hash = Some(remote_hash);
            } else {
                write_local_material(app, &remote_material)?;
                state.last_synced_hash = Some(remote_hash);
            }
            state.local_head = Some(snapshot_id.clone());
            state.remote_head = Some(snapshot_id);
            state.last_pull_at = Some(now.clone());
            state.conflict = false;
        } else {
            state.remote_head = None;
            state.local_head = None;
            state.last_pull_at = Some(now.clone());
        }
    }

    let local_material_after = read_local_sync_material(app)?;
    let local_hash_after = compute_material_hash(&local_material_after);
    let local_changed = state.last_synced_hash.as_deref() != Some(local_hash_after.as_str());

    if local_changed {
        push_local_snapshot(cfg, state, &client, &local_material_after, &now)?;
        state.last_synced_hash = Some(local_hash_after);
        if auto_merged {
            return Ok("检测到双端更新，已自动合并并推送".to_string());
        }
        return Ok("已完成推送同步".to_string());
    }

    state.last_synced_hash = Some(local_hash_after);
    if auto_merged {
        return Ok("检测到双端更新，已自动合并".to_string());
    }
    Ok("已是最新状态".to_string())
}
