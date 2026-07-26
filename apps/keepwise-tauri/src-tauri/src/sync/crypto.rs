use super::*;

pub(super) fn derive_key(password: &str, salt: &[u8]) -> Result<[u8; 32], String> {
    if password.trim().is_empty() {
        return Err("sync_password 必填".to_string());
    }
    let mut out = [0_u8; 32];
    Argon2::default()
        .hash_password_into(password.as_bytes(), salt, &mut out)
        .map_err(|e| format!("派生密钥失败: {e}"))?;
    Ok(out)
}

pub(super) fn derive_workspace_sync_key(
    password: &str,
    workspace_id: &str,
) -> Result<[u8; 32], String> {
    if workspace_id.trim().is_empty() {
        return Err("workspace_id 为空，无法派生同步密钥".to_string());
    }
    let salt_seed = format!("keepwise-sync-key::{workspace_id}");
    let hash = blake3::hash(salt_seed.as_bytes());
    derive_key(password, &hash.as_bytes()[..16])
}

pub(super) fn get_sync_key_bytes(cfg: &PersistedSyncConfig) -> Result<[u8; 32], String> {
    let raw = URL_SAFE_NO_PAD
        .decode(cfg.sync_key_b64.as_bytes())
        .map_err(|e| format!("解析 sync_key 失败: {e}"))?;
    if raw.len() != 32 {
        return Err("sync_key 长度非法，请重新绑定同步库".to_string());
    }
    let mut out = [0_u8; 32];
    out.copy_from_slice(&raw);
    Ok(out)
}

pub(super) fn encrypt_share_payload(
    sync_password: &str,
    payload: &ShareCodePayload,
) -> Result<String, String> {
    let plaintext =
        serde_json::to_vec(payload).map_err(|e| format!("序列化链接码载荷失败: {e}"))?;

    let mut salt = [0_u8; 16];
    OsRng.fill_bytes(&mut salt);
    let key_bytes = derive_key(sync_password, &salt)?;
    let key = Key::from_slice(&key_bytes);
    let cipher = XChaCha20Poly1305::new(key);

    let mut nonce = [0_u8; 24];
    OsRng.fill_bytes(&mut nonce);
    let nonce_ref = XNonce::from_slice(&nonce);

    let encrypted = cipher
        .encrypt(nonce_ref, plaintext.as_ref())
        .map_err(|e| format!("加密同步链接码失败: {e}"))?;
    let mut envelope_bin = Vec::<u8>::with_capacity(1 + 16 + 24 + encrypted.len());
    envelope_bin.push(SHARE_CODE_VERSION_V2);
    envelope_bin.extend_from_slice(&salt);
    envelope_bin.extend_from_slice(&nonce);
    envelope_bin.extend_from_slice(&encrypted);
    Ok(format!(
        "{SHARE_CODE_PREFIX_V2}{}",
        URL_SAFE_NO_PAD.encode(envelope_bin)
    ))
}

pub(super) fn decrypt_share_payload(
    sync_password: &str,
    share_code: &str,
) -> Result<ShareCodePayload, String> {
    let (encoded, is_v2) = if let Some(rest) = share_code.strip_prefix(SHARE_CODE_PREFIX_V2) {
        (rest, true)
    } else if let Some(rest) = share_code.strip_prefix(SHARE_CODE_PREFIX_V1) {
        (rest, false)
    } else {
        return Err("同步链接码格式错误".to_string());
    };
    let raw_envelope = URL_SAFE_NO_PAD
        .decode(encoded)
        .map_err(|e| format!("解码同步链接码失败: {e}"))?;
    if is_v2 {
        if raw_envelope.len() <= 41 {
            return Err("同步链接码内容不完整".to_string());
        }
        if raw_envelope[0] != SHARE_CODE_VERSION_V2 {
            return Err(format!("不支持的同步链接码版本: {}", raw_envelope[0]));
        }
        let salt = &raw_envelope[1..17];
        let nonce = &raw_envelope[17..41];
        let cipher_bytes = &raw_envelope[41..];

        let key_bytes = derive_key(sync_password, salt)?;
        let key = Key::from_slice(&key_bytes);
        let cipher = XChaCha20Poly1305::new(key);
        let nonce_ref = XNonce::from_slice(nonce);
        let plaintext = cipher
            .decrypt(nonce_ref, cipher_bytes)
            .map_err(|_| "同步密码错误或链接码已损坏".to_string())?;
        return serde_json::from_slice::<ShareCodePayload>(&plaintext)
            .map_err(|e| format!("解析同步链接码载荷失败: {e}"));
    }

    let envelope = serde_json::from_slice::<ShareCodeEnvelope>(&raw_envelope)
        .map_err(|e| format!("解析同步链接码失败: {e}"))?;
    if envelope.v != SHARE_CODE_VERSION_V1 {
        return Err(format!("不支持的同步链接码版本: {}", envelope.v));
    }

    let salt = URL_SAFE_NO_PAD
        .decode(envelope.salt.as_bytes())
        .map_err(|e| format!("解码 salt 失败: {e}"))?;
    let nonce = URL_SAFE_NO_PAD
        .decode(envelope.nonce.as_bytes())
        .map_err(|e| format!("解码 nonce 失败: {e}"))?;
    let cipher_bytes = URL_SAFE_NO_PAD
        .decode(envelope.cipher.as_bytes())
        .map_err(|e| format!("解码密文失败: {e}"))?;

    let checksum_now = blake3::hash(&cipher_bytes).to_hex().to_string();
    if checksum_now != envelope.checksum {
        return Err("同步链接码完整性校验失败".to_string());
    }

    let key_bytes = derive_key(sync_password, &salt)?;
    let key = Key::from_slice(&key_bytes);
    let cipher = XChaCha20Poly1305::new(key);
    let nonce_ref = XNonce::from_slice(&nonce);
    let plaintext = cipher
        .decrypt(nonce_ref, cipher_bytes.as_ref())
        .map_err(|_| "同步密码错误或链接码已损坏".to_string())?;
    serde_json::from_slice::<ShareCodePayload>(&plaintext)
        .map_err(|e| format!("解析同步链接码载荷失败: {e}"))
}

pub(super) fn to_share_payload(cfg: &PersistedSyncConfig) -> ShareCodePayload {
    ShareCodePayload {
        provider: cfg.provider.clone(),
        endpoint: cfg.endpoint.clone(),
        region: cfg.region.clone(),
        bucket: cfg.bucket.clone(),
        prefix: cfg.prefix.clone(),
        workspace_id: cfg.workspace_id.clone(),
        access_key_id: cfg.access_key_id.clone(),
        secret_key: cfg.secret_key.clone(),
        app_id: cfg.app_id.clone(),
        session_token: cfg.session_token.clone(),
        path_style: cfg.path_style,
        issued_at: now_iso(),
    }
}
