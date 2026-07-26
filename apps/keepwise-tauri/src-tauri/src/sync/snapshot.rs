use super::*;

pub(super) fn read_local_sync_material(app: &AppHandle) -> Result<LocalSyncMaterial, String> {
    let db_path = resolve_ledger_db_path(app)?;
    if let Ok(conn) = rusqlite::Connection::open(&db_path) {
        let _ = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
    }
    let db_bytes = fs::read(&db_path).map_err(|e| format!("读取本地数据库失败: {e}"))?;

    let rules_dir = resolve_app_rules_dir(app)?;
    fs::create_dir_all(&rules_dir).map_err(|e| format!("创建规则目录失败: {e}"))?;
    let mut rules = Vec::<RuleFileBinary>::new();
    let entries = fs::read_dir(&rules_dir).map_err(|e| format!("读取规则目录失败: {e}"))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("读取规则目录项失败: {e}"))?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let ext = path
            .extension()
            .and_then(|v| v.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        if ext != "csv" {
            continue;
        }
        let Some(name) = path.file_name().and_then(|v| v.to_str()) else {
            continue;
        };
        let bytes = fs::read(&path)
            .map_err(|e| format!("读取规则文件失败 ({}): {e}", path.to_string_lossy()))?;
        rules.push(RuleFileBinary {
            name: name.to_string(),
            bytes,
        });
    }
    rules.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(LocalSyncMaterial { db_bytes, rules })
}

pub(super) fn compute_material_hash(material: &LocalSyncMaterial) -> String {
    let mut hasher = blake3::Hasher::new();
    hasher.update(b"db\0");
    hasher.update(&(material.db_bytes.len() as u64).to_le_bytes());
    hasher.update(&material.db_bytes);
    hasher.update(b"rules\0");
    for rule in &material.rules {
        hasher.update(rule.name.as_bytes());
        hasher.update(&[0]);
        hasher.update(&(rule.bytes.len() as u64).to_le_bytes());
        hasher.update(&rule.bytes);
    }
    hasher.finalize().to_hex().to_string()
}

pub(super) fn write_local_material(
    app: &AppHandle,
    material: &LocalSyncMaterial,
) -> Result<(), String> {
    let db_path = resolve_ledger_db_path(app)?;
    if let Some(parent) = db_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建数据库目录失败: {e}"))?;
    }
    let db_tmp = db_path.with_extension("sync.tmp.db");
    fs::write(&db_tmp, &material.db_bytes).map_err(|e| format!("写入数据库临时文件失败: {e}"))?;
    fs::rename(&db_tmp, &db_path).map_err(|e| format!("替换数据库文件失败: {e}"))?;

    let rules_dir = resolve_app_rules_dir(app)?;
    fs::create_dir_all(&rules_dir).map_err(|e| format!("创建规则目录失败: {e}"))?;
    let existing = fs::read_dir(&rules_dir).map_err(|e| format!("读取规则目录失败: {e}"))?;
    for entry in existing {
        let entry = entry.map_err(|e| format!("读取规则目录项失败: {e}"))?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let ext = path
            .extension()
            .and_then(|v| v.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        if ext == "csv" {
            fs::remove_file(&path)
                .map_err(|e| format!("删除旧规则文件失败 ({}): {e}", path.to_string_lossy()))?;
        }
    }

    for rule in &material.rules {
        let file_name = Path::new(&rule.name)
            .file_name()
            .and_then(|v| v.to_str())
            .ok_or_else(|| format!("规则文件名非法: {}", rule.name))?;
        let target = rules_dir.join(file_name);
        let tmp = rules_dir.join(format!("{}.tmp", file_name));
        fs::write(&tmp, &rule.bytes)
            .map_err(|e| format!("写入规则临时文件失败 ({}): {e}", tmp.to_string_lossy()))?;
        fs::rename(&tmp, &target)
            .map_err(|e| format!("替换规则文件失败 ({}): {e}", target.to_string_lossy()))?;
    }

    let _ = ledger_db_migrate(app.clone());
    Ok(())
}

pub(super) fn build_snapshot_bytes(
    material: &LocalSyncMaterial,
    sync_key: &[u8; 32],
    snapshot_id: &str,
    parent_snapshot_id: Option<String>,
    device_id: &str,
) -> Result<SnapshotBuildResult, String> {
    let plain = SnapshotPlainBundle {
        created_at: now_iso(),
        db_content_b64: URL_SAFE_NO_PAD.encode(&material.db_bytes),
        rules: material
            .rules
            .iter()
            .map(|rule| SnapshotRuleFile {
                name: rule.name.clone(),
                content_b64: URL_SAFE_NO_PAD.encode(&rule.bytes),
            })
            .collect::<Vec<_>>(),
    };
    let plain_bytes = serde_json::to_vec(&plain).map_err(|e| format!("序列化快照载荷失败: {e}"))?;
    let plain_hash = blake3::hash(&plain_bytes).to_hex().to_string();

    let key = Key::from_slice(sync_key);
    let cipher = XChaCha20Poly1305::new(key);
    let mut nonce = [0_u8; 24];
    OsRng.fill_bytes(&mut nonce);
    let encrypted = cipher
        .encrypt(XNonce::from_slice(&nonce), plain_bytes.as_ref())
        .map_err(|e| format!("加密快照失败: {e}"))?;

    let envelope = SnapshotEnvelope {
        v: SNAPSHOT_VERSION,
        snapshot_id: Some(snapshot_id.to_string()),
        created_at: now_iso(),
        parent_snapshot_id,
        device_id: device_id.to_string(),
        nonce: URL_SAFE_NO_PAD.encode(nonce),
        cipher: URL_SAFE_NO_PAD.encode(&encrypted),
        checksum: blake3::hash(&encrypted).to_hex().to_string(),
        plain_hash: plain_hash.clone(),
    };
    let bytes = serde_json::to_vec(&envelope).map_err(|e| format!("序列化快照封装失败: {e}"))?;
    Ok(SnapshotBuildResult { bytes, plain_hash })
}

pub(super) fn parse_snapshot_bytes_for_ref(
    snapshot_bytes: &[u8],
    sync_key: &[u8; 32],
    expected_snapshot_id: Option<&str>,
    expected_parent_snapshot_id: Option<&str>,
    expected_plain_hash: Option<&str>,
) -> Result<LocalSyncMaterial, String> {
    let envelope = serde_json::from_slice::<SnapshotEnvelope>(snapshot_bytes)
        .map_err(|e| format!("解析快照封装失败: {e}"))?;
    if envelope.v != SNAPSHOT_VERSION {
        return Err(format!("不支持的快照版本: {}", envelope.v));
    }
    if let (Some(expected), Some(actual)) = (expected_snapshot_id, envelope.snapshot_id.as_deref())
    {
        if expected != actual {
            return Err(format!(
                "远端 head 与快照不匹配：head={}, snapshot={}",
                expected, actual
            ));
        }
    }
    if envelope.snapshot_id.is_none() {
        match (
            expected_parent_snapshot_id,
            envelope.parent_snapshot_id.as_deref(),
        ) {
            (Some(expected), Some(actual)) if expected != actual => {
                return Err(format!(
                    "远端 head 与旧版快照 parent 不匹配：head_parent={}, snapshot_parent={}",
                    expected, actual
                ));
            }
            (Some(_), None) | (None, Some(_)) => {
                return Err("远端 head 与旧版快照 parent 不匹配".to_string());
            }
            _ => {}
        }
    }

    let nonce = URL_SAFE_NO_PAD
        .decode(envelope.nonce.as_bytes())
        .map_err(|e| format!("解码快照 nonce 失败: {e}"))?;
    let cipher_bytes = URL_SAFE_NO_PAD
        .decode(envelope.cipher.as_bytes())
        .map_err(|e| format!("解码快照密文失败: {e}"))?;

    let checksum_now = blake3::hash(&cipher_bytes).to_hex().to_string();
    if checksum_now != envelope.checksum {
        return Err("快照完整性校验失败".to_string());
    }

    let key = Key::from_slice(sync_key);
    let cipher = XChaCha20Poly1305::new(key);
    let plain = cipher
        .decrypt(XNonce::from_slice(&nonce), cipher_bytes.as_ref())
        .map_err(|_| "解密快照失败：同步密码可能错误".to_string())?;

    let plain_hash = blake3::hash(&plain).to_hex().to_string();
    if plain_hash != envelope.plain_hash {
        return Err("快照明文校验失败".to_string());
    }
    if let Some(expected) = expected_plain_hash {
        if expected != plain_hash {
            return Err("远端 head 与快照内容校验不匹配".to_string());
        }
    }

    let decoded = serde_json::from_slice::<SnapshotPlainBundle>(&plain)
        .map_err(|e| format!("解析快照明文失败: {e}"))?;
    let db_bytes = URL_SAFE_NO_PAD
        .decode(decoded.db_content_b64.as_bytes())
        .map_err(|e| format!("解码快照数据库失败: {e}"))?;

    let mut rules = Vec::<RuleFileBinary>::new();
    for rule in decoded.rules {
        let bytes = URL_SAFE_NO_PAD
            .decode(rule.content_b64.as_bytes())
            .map_err(|e| format!("解码规则文件失败 ({}): {e}", rule.name))?;
        rules.push(RuleFileBinary {
            name: rule.name,
            bytes,
        });
    }
    rules.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(LocalSyncMaterial { db_bytes, rules })
}
