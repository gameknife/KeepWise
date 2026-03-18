use crate::ledger_db::{ledger_db_migrate, resolve_ledger_db_path};
use crate::rules_store::resolve_app_rules_dir;
use argon2::Argon2;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::{Key, XChaCha20Poly1305, XNonce};
use chrono::{Duration, SecondsFormat, Utc};
use hmac::{Hmac, Mac};
use rand::rngs::OsRng;
use rand::RngCore;
use reqwest::blocking::Client;
use reqwest::Method;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::time::Duration as StdDuration;
use tauri::{AppHandle, Manager};
use url::Url;
use uuid::Uuid;

type HmacSha256 = Hmac<Sha256>;

const SYNC_DIR_NAME: &str = "sync";
const SYNC_CONFIG_FILE: &str = "sync_config.json";
const SYNC_STATE_FILE: &str = "sync_state.json";
const SYNC_PROVIDER: &str = "cos_s3";
const SHARE_CODE_PREFIX_V1: &str = "kwsync1_";
const SHARE_CODE_PREFIX_V2: &str = "kwsync2_";
const SHARE_CODE_VERSION_V1: u8 = 1;
const SHARE_CODE_VERSION_V2: u8 = 2;
const SNAPSHOT_VERSION: u8 = 1;
const MANIFEST_VERSION: u8 = 1;
const SERVICE_NAME_S3: &str = "s3";
const S3_REQUEST_MAX_ATTEMPTS: u32 = 3;
const S3_REQUEST_RETRY_BASE_MS: u64 = 500;
const SINGLE_SNAPSHOT_OBJECT_NAME: &str = "snapshot-latest.kwsnap";

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default)]
struct SyncAutoPolicy {
    enabled: bool,
    interval_minutes: u32,
    startup_delay_seconds: u32,
    change_debounce_seconds: u32,
}

impl Default for SyncAutoPolicy {
    fn default() -> Self {
        Self {
            enabled: false,
            interval_minutes: 5,
            startup_delay_seconds: 5,
            change_debounce_seconds: 15,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct PersistedSyncConfig {
    provider: String,
    endpoint: String,
    region: String,
    bucket: String,
    prefix: String,
    workspace_id: String,
    access_key_id: String,
    secret_key: String,
    #[serde(default)]
    app_id: Option<String>,
    #[serde(default)]
    session_token: Option<String>,
    path_style: bool,
    #[serde(default)]
    sync_key_b64: String,
    created_at: String,
    updated_at: String,
    #[serde(default)]
    auto_policy: SyncAutoPolicy,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct PersistedSyncState {
    device_id: String,
    local_head: Option<String>,
    remote_head: Option<String>,
    syncing: bool,
    last_sync_at: Option<String>,
    last_push_at: Option<String>,
    last_pull_at: Option<String>,
    last_error: Option<String>,
    conflict: bool,
    next_sync_at: Option<String>,
    #[serde(default)]
    last_synced_hash: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ShareCodePayload {
    provider: String,
    endpoint: String,
    region: String,
    bucket: String,
    prefix: String,
    workspace_id: String,
    access_key_id: String,
    secret_key: String,
    app_id: Option<String>,
    session_token: Option<String>,
    path_style: bool,
    issued_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct ShareCodeEnvelope {
    v: u8,
    salt: String,
    nonce: String,
    cipher: String,
    checksum: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct SyncManifest {
    version: u8,
    provider: String,
    workspace_id: String,
    created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct SyncHeadRef {
    snapshot_id: Option<String>,
    parent_snapshot_id: Option<String>,
    updated_at: String,
    device_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct SnapshotRuleFile {
    name: String,
    content_b64: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct SnapshotPlainBundle {
    created_at: String,
    db_content_b64: String,
    rules: Vec<SnapshotRuleFile>,
}

#[derive(Debug, Serialize, Deserialize)]
struct SnapshotEnvelope {
    v: u8,
    created_at: String,
    parent_snapshot_id: Option<String>,
    device_id: String,
    nonce: String,
    cipher: String,
    checksum: String,
    plain_hash: String,
}

#[derive(Debug, Clone)]
struct RuleFileBinary {
    name: String,
    bytes: Vec<u8>,
}

#[derive(Debug, Clone)]
struct LocalSyncMaterial {
    db_bytes: Vec<u8>,
    rules: Vec<RuleFileBinary>,
}

#[derive(Debug)]
struct S3Response {
    status: u16,
    body: Vec<u8>,
}

#[derive(Debug)]
struct S3Target {
    url: String,
    host: String,
    canonical_uri: String,
}

struct S3Client<'a> {
    cfg: &'a PersistedSyncConfig,
    client: Client,
}

#[derive(Debug, Deserialize)]
pub struct SyncSetupCreateRequest {
    pub secret_id: Option<String>,
    pub secret_key: Option<String>,
    pub region: Option<String>,
    pub sync_password: Option<String>,
    pub app_id: Option<String>,
    pub endpoint: Option<String>,
    pub bucket: Option<String>,
    pub prefix: Option<String>,
    pub workspace_id: Option<String>,
    pub path_style: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct SyncSetupLinkRequest {
    pub share_code: Option<String>,
    pub sync_password: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SyncShareCodeGenerateRequest {
    pub sync_password: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SyncShareCodeParseRequest {
    pub share_code: Option<String>,
    pub sync_password: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SyncResolveConflictRequest {
    pub action: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SyncSetAutoPolicyRequest {
    pub enabled: Option<bool>,
    pub interval_minutes: Option<u32>,
    pub startup_delay_seconds: Option<u32>,
    pub change_debounce_seconds: Option<u32>,
}

#[derive(Debug, Serialize)]
pub struct SyncStatus {
    pub configured: bool,
    pub provider: Option<String>,
    pub workspace_id: Option<String>,
    pub device_id: Option<String>,
    pub local_head: Option<String>,
    pub remote_head: Option<String>,
    pub syncing: bool,
    pub last_sync_at: Option<String>,
    pub last_push_at: Option<String>,
    pub last_pull_at: Option<String>,
    pub last_error: Option<String>,
    pub conflict: bool,
    pub auto_sync_enabled: bool,
    pub interval_minutes: u32,
    pub next_sync_at: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SyncSetupCreateResult {
    pub configured: bool,
    pub endpoint: String,
    pub bucket: String,
    pub prefix: String,
    pub workspace_id: String,
    pub share_code: String,
    pub status: SyncStatus,
}

#[derive(Debug, Serialize)]
pub struct SyncSetupLinkResult {
    pub configured: bool,
    pub endpoint: String,
    pub bucket: String,
    pub prefix: String,
    pub workspace_id: String,
    pub status: SyncStatus,
}

#[derive(Debug, Serialize)]
pub struct SyncShareCodeResult {
    pub share_code: String,
}

#[derive(Debug, Serialize)]
pub struct SyncShareCodeParseResult {
    pub provider: String,
    pub endpoint: String,
    pub region: String,
    pub bucket: String,
    pub prefix: String,
    pub workspace_id: String,
    pub access_key_id: String,
    pub app_id: Option<String>,
    pub path_style: bool,
}

#[derive(Debug, Serialize)]
pub struct SyncConnectionTestResult {
    pub ok: bool,
    pub endpoint: Option<String>,
    pub message: String,
}

#[derive(Debug, Serialize)]
pub struct SyncReconcileResult {
    pub ok: bool,
    pub message: String,
    pub status: SyncStatus,
}

#[derive(Debug, Serialize)]
pub struct SyncResolveConflictResult {
    pub action: String,
    pub status: SyncStatus,
}

#[derive(Debug, Serialize)]
pub struct SyncAutoPolicyResult {
    pub status: SyncStatus,
}

#[derive(Debug, Serialize)]
pub struct SyncRemotePollResult {
    pub configured: bool,
    pub has_remote_update: bool,
    pub remote_head: Option<String>,
    pub message: String,
    pub status: SyncStatus,
}

impl<'a> S3Client<'a> {
    fn new(cfg: &'a PersistedSyncConfig) -> Result<Self, String> {
        let client = Client::builder()
            .connect_timeout(StdDuration::from_secs(5))
            .timeout(StdDuration::from_secs(20))
            .build()
            .map_err(|e| format!("初始化 HTTP 客户端失败: {e}"))?;
        Ok(Self { cfg, client })
    }

    fn build_target(&self, object_key: Option<&str>) -> Result<S3Target, String> {
        let endpoint = self.cfg.endpoint.trim();
        if endpoint.is_empty() {
            return Err("endpoint 不能为空".to_string());
        }
        let parsed = Url::parse(endpoint).map_err(|e| format!("endpoint 非法: {e}"))?;
        let scheme = parsed.scheme();
        let base_host = parsed
            .host_str()
            .ok_or_else(|| "endpoint 缺少 host".to_string())?;
        let host_with_port = if let Some(port) = parsed.port() {
            format!("{base_host}:{port}")
        } else {
            base_host.to_string()
        };
        let base_path = {
            let raw = parsed.path().trim_end_matches('/');
            if raw == "/" {
                "".to_string()
            } else {
                raw.to_string()
            }
        };
        let key = object_key.unwrap_or("").trim_start_matches('/');

        let force_virtual_host = object_key.is_none();
        let (host_for_url, host_header, raw_path) = if self.cfg.path_style && !force_virtual_host {
            let mut path = String::new();
            if !base_path.is_empty() {
                path.push_str(&base_path);
            }
            path.push('/');
            path.push_str(self.cfg.bucket.trim());
            if !key.is_empty() {
                path.push('/');
                path.push_str(key);
            }
            if path.is_empty() {
                path.push('/');
            }
            (host_with_port.clone(), host_with_port, path)
        } else {
            let host_core = if let Some((host, _)) = host_with_port.split_once(':') {
                host.to_string()
            } else {
                host_with_port.clone()
            };
            let host_vhost = if let Some((_, port)) = host_with_port.split_once(':') {
                format!("{}.{}:{port}", self.cfg.bucket.trim(), host_core)
            } else {
                format!("{}.{}", self.cfg.bucket.trim(), host_core)
            };
            let mut path = String::new();
            if !base_path.is_empty() {
                path.push_str(&base_path);
            }
            if !path.ends_with('/') {
                path.push('/');
            }
            if !key.is_empty() {
                path.push_str(key);
            }
            if path.is_empty() {
                path.push('/');
            }
            (host_vhost.clone(), host_vhost, path)
        };

        let canonical_uri = encode_uri_path(&raw_path);
        let url = format!("{scheme}://{host_for_url}{canonical_uri}");
        Ok(S3Target {
            url,
            host: host_header,
            canonical_uri,
        })
    }

    fn signed_request(
        &self,
        method: &str,
        object_key: Option<&str>,
        query: &[(String, String)],
        body: &[u8],
        content_type: Option<&str>,
    ) -> Result<S3Response, String> {
        let target = self.build_target(object_key)?;
        let canonical_query = build_canonical_query(query);
        let request_url = if canonical_query.is_empty() {
            target.url.clone()
        } else {
            format!("{}?{}", target.url, canonical_query)
        };

        for attempt in 0..S3_REQUEST_MAX_ATTEMPTS {
            let amz_date = Utc::now().format("%Y%m%dT%H%M%SZ").to_string();
            let date_stamp = Utc::now().format("%Y%m%d").to_string();
            let payload_hash = sha256_hex(body);

            let mut canonical_headers = BTreeMap::<String, String>::new();
            canonical_headers.insert("host".to_string(), target.host.clone());
            canonical_headers.insert("x-amz-content-sha256".to_string(), payload_hash.clone());
            canonical_headers.insert("x-amz-date".to_string(), amz_date.clone());
            if let Some(app_id) = self.cfg.app_id.as_ref() {
                let appid = app_id.trim();
                if !appid.is_empty() {
                    canonical_headers.insert("appid".to_string(), appid.to_string());
                    canonical_headers.insert("x-cos-appid".to_string(), appid.to_string());
                }
            }
            if let Some(token) = self.cfg.session_token.as_ref() {
                if !token.trim().is_empty() {
                    canonical_headers
                        .insert("x-amz-security-token".to_string(), token.trim().to_string());
                }
            }

            let signed_headers = canonical_headers
                .keys()
                .map(|k| k.as_str())
                .collect::<Vec<_>>()
                .join(";");
            let canonical_headers_text = canonical_headers
                .iter()
                .map(|(k, v)| format!("{}:{}\n", k, v.trim()))
                .collect::<String>();

            let canonical_request = format!(
                "{}\n{}\n{}\n{}\n{}\n{}",
                method.to_uppercase(),
                target.canonical_uri,
                canonical_query,
                canonical_headers_text,
                signed_headers,
                payload_hash
            );
            let credential_scope = format!(
                "{}/{}/{}/aws4_request",
                date_stamp,
                self.cfg.region.trim(),
                SERVICE_NAME_S3
            );
            let string_to_sign = format!(
                "AWS4-HMAC-SHA256\n{}\n{}\n{}",
                amz_date,
                credential_scope,
                sha256_hex(canonical_request.as_bytes())
            );
            let signing_key =
                build_signing_key(&self.cfg.secret_key, &date_stamp, self.cfg.region.trim())?;
            let signature = hex::encode(hmac_sign(&signing_key, string_to_sign.as_bytes())?);
            let authorization = format!(
                "AWS4-HMAC-SHA256 Credential={}/{}, SignedHeaders={}, Signature={}",
                self.cfg.access_key_id.trim(),
                credential_scope,
                signed_headers,
                signature
            );

            let method_parsed = Method::from_bytes(method.as_bytes())
                .map_err(|e| format!("HTTP method 不合法: {e}"))?;
            let mut builder = self
                .client
                .request(method_parsed, request_url.clone())
                .header("x-amz-date", amz_date)
                .header("x-amz-content-sha256", payload_hash)
                .header("Authorization", authorization)
                .header("Host", target.host.clone());
            if let Some(app_id) = self.cfg.app_id.as_ref() {
                let appid = app_id.trim();
                if !appid.is_empty() {
                    builder = builder.header("Appid", appid).header("x-cos-appid", appid);
                }
            }
            if let Some(token) = self.cfg.session_token.as_ref() {
                if !token.trim().is_empty() {
                    builder = builder.header("x-amz-security-token", token.trim());
                }
            }
            if let Some(ct) = content_type {
                builder = builder.header("Content-Type", ct);
            }
            if !body.is_empty() {
                builder = builder.body(body.to_vec());
            }

            let response = match builder.send() {
                Ok(resp) => resp,
                Err(e) => {
                    if should_retry_request_error(&e) && attempt + 1 < S3_REQUEST_MAX_ATTEMPTS {
                        let backoff_ms = S3_REQUEST_RETRY_BASE_MS * u64::from(attempt + 1);
                        std::thread::sleep(StdDuration::from_millis(backoff_ms));
                        continue;
                    }
                    return Err(format!("请求对象存储失败: {e}"));
                }
            };
            let status = response.status().as_u16();
            let body = response
                .bytes()
                .map_err(|e| format!("读取对象存储响应失败: {e}"))?
                .to_vec();
            return Ok(S3Response { status, body });
        }

        Err("请求对象存储失败：超过重试次数".to_string())
    }

    fn put_bucket_if_missing(&self) -> Result<(), String> {
        let probe = self.signed_request(
            "GET",
            None,
            &[
                ("list-type".to_string(), "2".to_string()),
                ("max-keys".to_string(), "1".to_string()),
            ],
            &[],
            None,
        )?;
        if (200..300).contains(&probe.status) {
            return Ok(());
        }

        if probe.status == 404 {
            let create = self.signed_request("PUT", None, &[], &[], None)?;
            if (200..300).contains(&create.status) || create.status == 409 {
                return self.wait_bucket_ready_after_create();
            }
            return Err(format!(
                "创建 bucket 失败 (status={}): {}",
                create.status,
                summarize_body(&create.body)
            ));
        }

        Err(format!(
            "访问 bucket 失败 (status={}): {}",
            probe.status,
            summarize_body(&probe.body)
        ))
    }

    fn wait_bucket_ready_after_create(&self) -> Result<(), String> {
        let mut last_err: Option<String> = None;
        for _ in 0..6 {
            match self.ensure_bucket_accessible() {
                Ok(()) => return Ok(()),
                Err(err) => {
                    last_err = Some(err);
                    std::thread::sleep(StdDuration::from_millis(600));
                }
            }
        }
        Err(match last_err {
            Some(err) => format!("bucket 创建后尚未就绪: {err}"),
            None => "bucket 创建后尚未就绪".to_string(),
        })
    }

    fn ensure_bucket_accessible(&self) -> Result<(), String> {
        let probe = self.signed_request(
            "GET",
            None,
            &[
                ("list-type".to_string(), "2".to_string()),
                ("max-keys".to_string(), "1".to_string()),
            ],
            &[],
            None,
        )?;
        if (200..300).contains(&probe.status) {
            return Ok(());
        }
        Err(format!(
            "访问 bucket 失败 (status={}): {}",
            probe.status,
            summarize_body(&probe.body)
        ))
    }

    fn put_object(&self, key: &str, body: &[u8], content_type: Option<&str>) -> Result<(), String> {
        let resp = self.signed_request("PUT", Some(key), &[], body, content_type)?;
        if (200..300).contains(&resp.status) {
            return Ok(());
        }
        Err(format!(
            "上传对象失败 (key={}, status={}): {}",
            key,
            resp.status,
            summarize_body(&resp.body)
        ))
    }

    fn get_object_optional(&self, key: &str) -> Result<Option<Vec<u8>>, String> {
        let resp = self.signed_request("GET", Some(key), &[], &[], None)?;
        if (200..300).contains(&resp.status) {
            return Ok(Some(resp.body));
        }
        if resp.status == 404 {
            return Ok(None);
        }
        Err(format!(
            "读取对象失败 (key={}, status={}): {}",
            key,
            resp.status,
            summarize_body(&resp.body)
        ))
    }
}

fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}

fn summarize_body(body: &[u8]) -> String {
    let text = String::from_utf8_lossy(body).trim().to_string();
    if text.len() > 280 {
        format!("{}...", &text[..280])
    } else {
        text
    }
}

fn is_no_such_bucket_error_text(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    lower.contains("nosuchbucket")
        || lower.contains("the specified bucket does not exist")
        || lower.contains("bucket does not exist")
}

fn should_retry_request_error(err: &reqwest::Error) -> bool {
    if err.is_timeout() || err.is_connect() {
        return true;
    }
    let lower = err.to_string().to_ascii_lowercase();
    lower.contains("error sending request")
        || lower.contains("connection reset")
        || lower.contains("broken pipe")
        || lower.contains("failed to lookup address")
        || lower.contains("dns")
        || lower.contains("timed out")
}

fn read_optional_json<T>(path: &Path) -> Result<Option<T>, String>
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

fn write_json_atomic<T: Serialize>(path: &Path, payload: &T) -> Result<(), String> {
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

fn resolve_sync_dir(app: &AppHandle, create: bool) -> Result<PathBuf, String> {
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

fn sync_config_path(app: &AppHandle, create: bool) -> Result<PathBuf, String> {
    Ok(resolve_sync_dir(app, create)?.join(SYNC_CONFIG_FILE))
}

fn sync_state_path(app: &AppHandle, create: bool) -> Result<PathBuf, String> {
    Ok(resolve_sync_dir(app, create)?.join(SYNC_STATE_FILE))
}

fn load_sync_config(app: &AppHandle) -> Result<Option<PersistedSyncConfig>, String> {
    let path = sync_config_path(app, false)?;
    read_optional_json::<PersistedSyncConfig>(&path)
}

fn save_sync_config(app: &AppHandle, cfg: &PersistedSyncConfig) -> Result<(), String> {
    let path = sync_config_path(app, true)?;
    write_json_atomic(&path, cfg)
}

fn load_sync_state(app: &AppHandle) -> Result<Option<PersistedSyncState>, String> {
    let path = sync_state_path(app, false)?;
    read_optional_json::<PersistedSyncState>(&path)
}

fn save_sync_state(app: &AppHandle, state: &PersistedSyncState) -> Result<(), String> {
    let path = sync_state_path(app, true)?;
    write_json_atomic(&path, state)
}

fn ensure_required_text(value: Option<String>, field: &str) -> Result<String, String> {
    let text = value.unwrap_or_default().trim().to_string();
    if text.is_empty() {
        return Err(format!("{field} 必填"));
    }
    Ok(text)
}

fn infer_endpoint(region: &str) -> String {
    format!("https://cos.{region}.myqcloud.com")
}

fn sanitize_token(raw: &str) -> String {
    raw.chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}

fn infer_bucket(region: &str) -> String {
    let region_norm = sanitize_token(region).to_lowercase();
    let default_bucket = format!("keepwise-sync-{region_norm}");
    if default_bucket.len() > 63 {
        default_bucket[..63].to_string()
    } else {
        default_bucket
    }
}

fn normalize_bucket_for_cos(base_bucket: String, app_id: Option<&str>) -> String {
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

fn infer_prefix() -> String {
    "keepwise-sync".to_string()
}

fn next_sync_at(last_sync_at: Option<&str>, policy: &SyncAutoPolicy) -> Option<String> {
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

fn default_state(device_id: String) -> PersistedSyncState {
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

fn compose_status(
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

fn derive_key(password: &str, salt: &[u8]) -> Result<[u8; 32], String> {
    if password.trim().is_empty() {
        return Err("sync_password 必填".to_string());
    }
    let mut out = [0_u8; 32];
    Argon2::default()
        .hash_password_into(password.as_bytes(), salt, &mut out)
        .map_err(|e| format!("派生密钥失败: {e}"))?;
    Ok(out)
}

fn derive_workspace_sync_key(password: &str, workspace_id: &str) -> Result<[u8; 32], String> {
    if workspace_id.trim().is_empty() {
        return Err("workspace_id 为空，无法派生同步密钥".to_string());
    }
    let salt_seed = format!("keepwise-sync-key::{workspace_id}");
    let hash = blake3::hash(salt_seed.as_bytes());
    derive_key(password, &hash.as_bytes()[..16])
}

fn get_sync_key_bytes(cfg: &PersistedSyncConfig) -> Result<[u8; 32], String> {
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

fn encrypt_share_payload(
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

fn decrypt_share_payload(
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

fn to_share_payload(cfg: &PersistedSyncConfig) -> ShareCodePayload {
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

fn workspace_root_prefix(cfg: &PersistedSyncConfig) -> String {
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

fn manifest_key(cfg: &PersistedSyncConfig) -> String {
    format!("{}/manifest.json", workspace_root_prefix(cfg))
}

fn head_key(cfg: &PersistedSyncConfig) -> String {
    format!("{}/refs/head.json", workspace_root_prefix(cfg))
}

fn snapshot_key(cfg: &PersistedSyncConfig, snapshot_id: &str) -> String {
    let _ = snapshot_id;
    format!(
        "{}/snapshots/{}",
        workspace_root_prefix(cfg),
        SINGLE_SNAPSHOT_OBJECT_NAME
    )
}

fn read_remote_head(
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

fn write_remote_head(
    client: &S3Client,
    cfg: &PersistedSyncConfig,
    head: &SyncHeadRef,
) -> Result<(), String> {
    let key = head_key(cfg);
    let body = serde_json::to_vec_pretty(head).map_err(|e| format!("序列化 head 失败: {e}"))?;
    client.put_object(&key, &body, Some("application/json"))
}

fn ensure_workspace_initialized(
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
        };
        write_remote_head(client, cfg, &head)?;
    }
    Ok(())
}

fn ensure_workspace_exists(client: &S3Client, cfg: &PersistedSyncConfig) -> Result<(), String> {
    let manifest_k = manifest_key(cfg);
    if client.get_object_optional(&manifest_k)?.is_none() {
        return Err("远端同步库不存在，请确认链接码或先在首台设备创建同步库".to_string());
    }
    Ok(())
}

fn read_local_sync_material(app: &AppHandle) -> Result<LocalSyncMaterial, String> {
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

fn compute_material_hash(material: &LocalSyncMaterial) -> String {
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

fn write_local_material(app: &AppHandle, material: &LocalSyncMaterial) -> Result<(), String> {
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

fn build_snapshot_bytes(
    material: &LocalSyncMaterial,
    sync_key: &[u8; 32],
    parent_snapshot_id: Option<String>,
    device_id: &str,
) -> Result<Vec<u8>, String> {
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
        created_at: now_iso(),
        parent_snapshot_id,
        device_id: device_id.to_string(),
        nonce: URL_SAFE_NO_PAD.encode(nonce),
        cipher: URL_SAFE_NO_PAD.encode(&encrypted),
        checksum: blake3::hash(&encrypted).to_hex().to_string(),
        plain_hash,
    };
    serde_json::to_vec(&envelope).map_err(|e| format!("序列化快照封装失败: {e}"))
}

fn parse_snapshot_bytes(
    snapshot_bytes: &[u8],
    sync_key: &[u8; 32],
) -> Result<LocalSyncMaterial, String> {
    let envelope = serde_json::from_slice::<SnapshotEnvelope>(snapshot_bytes)
        .map_err(|e| format!("解析快照封装失败: {e}"))?;
    if envelope.v != SNAPSHOT_VERSION {
        return Err(format!("不支持的快照版本: {}", envelope.v));
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

fn create_sync_snapshot_id() -> String {
    format!("snap-{}", Uuid::new_v4().simple())
}

fn sqlite_ident(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

fn merge_sqlite_db_bytes(remote_db: &[u8], local_db: &[u8]) -> Result<Vec<u8>, String> {
    let temp_root =
        std::env::temp_dir().join(format!("keepwise-sync-merge-{}", Uuid::new_v4().simple()));
    fs::create_dir_all(&temp_root).map_err(|e| format!("创建临时目录失败: {e}"))?;
    let remote_path = temp_root.join("remote.db");
    let local_path = temp_root.join("local.db");
    let merged_path = temp_root.join("merged.db");

    let result = (|| -> Result<Vec<u8>, String> {
        fs::write(&remote_path, remote_db).map_err(|e| format!("写入远端临时数据库失败: {e}"))?;
        fs::write(&local_path, local_db).map_err(|e| format!("写入本地临时数据库失败: {e}"))?;
        fs::copy(&remote_path, &merged_path).map_err(|e| format!("初始化合并数据库失败: {e}"))?;

        let conn = rusqlite::Connection::open(&merged_path)
            .map_err(|e| format!("打开合并数据库失败: {e}"))?;
        let local_escaped = local_path.to_string_lossy().replace('\'', "''");
        conn.execute_batch(&format!("ATTACH DATABASE '{local_escaped}' AS src;"))
            .map_err(|e| format!("附加本地数据库失败: {e}"))?;

        let tables = {
            let mut stmt = conn
                .prepare(
                    "SELECT name FROM main.sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
                )
                .map_err(|e| format!("读取远端表清单失败: {e}"))?;
            let rows = stmt
                .query_map([], |row| row.get::<_, String>(0))
                .map_err(|e| format!("遍历远端表清单失败: {e}"))?;
            let mut out = Vec::<String>::new();
            for row in rows {
                out.push(row.map_err(|e| format!("读取远端表名失败: {e}"))?);
            }
            out
        };

        for table in tables {
            let src_exists: i64 = conn
                .query_row(
                    "SELECT COUNT(1) FROM src.sqlite_master WHERE type='table' AND name=?1",
                    [&table],
                    |row| row.get(0),
                )
                .map_err(|e| format!("检测本地表存在失败 ({table}): {e}"))?;
            if src_exists == 0 {
                continue;
            }

            let columns = {
                let pragma_sql = format!("PRAGMA main.table_info({})", sqlite_ident(&table));
                let mut stmt = conn
                    .prepare(&pragma_sql)
                    .map_err(|e| format!("读取表结构失败 ({table}): {e}"))?;
                let rows = stmt
                    .query_map([], |row| row.get::<_, String>(1))
                    .map_err(|e| format!("遍历字段失败 ({table}): {e}"))?;
                let mut cols = Vec::<String>::new();
                for row in rows {
                    cols.push(row.map_err(|e| format!("读取字段名失败 ({table}): {e}"))?);
                }
                cols
            };
            if columns.is_empty() {
                continue;
            }

            let table_q = sqlite_ident(&table);
            let cols_csv = columns
                .iter()
                .map(|c| sqlite_ident(c))
                .collect::<Vec<_>>()
                .join(", ");
            let merge_sql = format!(
                "INSERT OR REPLACE INTO main.{table_q} ({cols_csv}) SELECT {cols_csv} FROM src.{table_q};"
            );
            conn.execute_batch(&merge_sql)
                .map_err(|e| format!("合并数据失败 ({table}): {e}"))?;
        }

        conn.execute_batch("DETACH DATABASE src;")
            .map_err(|e| format!("分离本地数据库失败: {e}"))?;
        fs::read(&merged_path).map_err(|e| format!("读取合并数据库失败: {e}"))
    })();

    let _ = fs::remove_dir_all(&temp_root);
    result
}

fn merge_sync_material(
    remote: &LocalSyncMaterial,
    local: &LocalSyncMaterial,
) -> Result<LocalSyncMaterial, String> {
    let db_bytes = merge_sqlite_db_bytes(&remote.db_bytes, &local.db_bytes)?;
    let mut rules_by_name = BTreeMap::<String, Vec<u8>>::new();
    for rule in &remote.rules {
        rules_by_name.insert(rule.name.clone(), rule.bytes.clone());
    }
    for rule in &local.rules {
        rules_by_name.insert(rule.name.clone(), rule.bytes.clone());
    }
    let rules = rules_by_name
        .into_iter()
        .map(|(name, bytes)| RuleFileBinary { name, bytes })
        .collect::<Vec<_>>();
    Ok(LocalSyncMaterial { db_bytes, rules })
}

fn fetch_remote_snapshot_material(
    client: &S3Client,
    cfg: &PersistedSyncConfig,
    snapshot_id: &str,
) -> Result<LocalSyncMaterial, String> {
    let key = snapshot_key(cfg, snapshot_id);
    let raw = client
        .get_object_optional(&key)?
        .ok_or_else(|| format!("远端快照不存在: {key}"))?;
    let sync_key = get_sync_key_bytes(cfg)?;
    parse_snapshot_bytes(&raw, &sync_key)
}

fn perform_remote_first_pull(
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

    let material = fetch_remote_snapshot_material(client, cfg, &snapshot_id)?;
    write_local_material(app, &material)?;

    state.remote_head = Some(snapshot_id.clone());
    state.local_head = Some(snapshot_id);
    state.last_pull_at = Some(now.to_string());
    state.last_synced_hash = Some(compute_material_hash(&read_local_sync_material(app)?));
    state.conflict = false;
    Ok(())
}

fn push_local_snapshot(
    cfg: &PersistedSyncConfig,
    state: &mut PersistedSyncState,
    client: &S3Client,
    material: &LocalSyncMaterial,
    now: &str,
) -> Result<(), String> {
    let parent_snapshot_id = state.remote_head.clone();
    let snapshot_id = create_sync_snapshot_id();
    let sync_key = get_sync_key_bytes(cfg)?;
    let snapshot_bytes = build_snapshot_bytes(
        material,
        &sync_key,
        parent_snapshot_id.clone(),
        &state.device_id,
    )?;
    let key = snapshot_key(cfg, &snapshot_id);
    client.put_object(&key, &snapshot_bytes, Some("application/octet-stream"))?;

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
    };
    write_remote_head(client, cfg, &new_head)?;

    state.remote_head = Some(snapshot_id.clone());
    state.local_head = Some(snapshot_id);
    state.last_push_at = Some(now.to_string());
    state.conflict = false;
    Ok(())
}

fn backup_local_db_for_conflict(app: &AppHandle) -> Result<PathBuf, String> {
    let db_path = resolve_ledger_db_path(app)?;
    let backup_name = format!(
        "keepwise-conflict-{}.db",
        Utc::now().format("%Y%m%d-%H%M%S")
    );
    let backup_path = db_path.with_file_name(backup_name);
    fs::copy(&db_path, &backup_path).map_err(|e| format!("备份冲突数据库失败: {e}"))?;
    Ok(backup_path)
}

fn run_reconcile_impl(
    app: &AppHandle,
    cfg: &PersistedSyncConfig,
    state: &mut PersistedSyncState,
) -> Result<String, String> {
    let client = S3Client::new(cfg)?;
    client.ensure_bucket_accessible()?;
    ensure_workspace_initialized(&client, cfg)?;

    let now = now_iso();
    let remote_head_id = read_remote_head(&client, cfg)?
        .and_then(|h| h.snapshot_id)
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());

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
            let remote_material = fetch_remote_snapshot_material(&client, cfg, &snapshot_id)?;
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

fn is_unreserved(ch: u8) -> bool {
    ch.is_ascii_alphanumeric() || ch == b'-' || ch == b'_' || ch == b'.' || ch == b'~'
}

fn encode_rfc3986(input: &str) -> String {
    let mut out = String::new();
    for b in input.as_bytes() {
        if is_unreserved(*b) {
            out.push(*b as char);
        } else {
            out.push('%');
            out.push_str(&format!("{:02X}", b));
        }
    }
    out
}

fn encode_uri_path(path: &str) -> String {
    let mut out = String::new();
    for b in path.as_bytes() {
        if *b == b'/' || is_unreserved(*b) {
            out.push(*b as char);
        } else {
            out.push('%');
            out.push_str(&format!("{:02X}", b));
        }
    }
    if out.is_empty() {
        "/".to_string()
    } else {
        out
    }
}

fn build_canonical_query(query: &[(String, String)]) -> String {
    let mut encoded = query
        .iter()
        .map(|(k, v)| (encode_rfc3986(k), encode_rfc3986(v)))
        .collect::<Vec<_>>();
    encoded.sort_by(|a, b| {
        if a.0 == b.0 {
            a.1.cmp(&b.1)
        } else {
            a.0.cmp(&b.0)
        }
    });
    encoded
        .into_iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join("&")
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

fn hmac_sign(key: &[u8], data: &[u8]) -> Result<Vec<u8>, String> {
    let mut mac =
        <HmacSha256 as Mac>::new_from_slice(key).map_err(|e| format!("初始化 HMAC 失败: {e}"))?;
    mac.update(data);
    Ok(mac.finalize().into_bytes().to_vec())
}

fn build_signing_key(secret_key: &str, date_stamp: &str, region: &str) -> Result<Vec<u8>, String> {
    let k_date = hmac_sign(
        format!("AWS4{}", secret_key).as_bytes(),
        date_stamp.as_bytes(),
    )?;
    let k_region = hmac_sign(&k_date, region.as_bytes())?;
    let k_service = hmac_sign(&k_region, SERVICE_NAME_S3.as_bytes())?;
    hmac_sign(&k_service, b"aws4_request")
}

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
pub fn sync_poll_remote_update(app: AppHandle) -> Result<SyncRemotePollResult, String> {
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
pub fn sync_reconcile(app: AppHandle) -> Result<SyncReconcileResult, String> {
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

#[cfg(test)]
mod tests {
    use super::{
        build_snapshot_bytes, decrypt_share_payload, derive_workspace_sync_key, encode_rfc3986,
        encrypt_share_payload, now_iso, parse_snapshot_bytes, LocalSyncMaterial, RuleFileBinary,
        ShareCodePayload, SYNC_PROVIDER,
    };

    #[test]
    fn share_code_roundtrip_ok() {
        let payload = ShareCodePayload {
            provider: SYNC_PROVIDER.to_string(),
            endpoint: "https://cos.ap-shanghai.myqcloud.com".to_string(),
            region: "ap-shanghai".to_string(),
            bucket: "keepwise-sync-ap-shanghai-1234567890".to_string(),
            prefix: "keepwise-sync".to_string(),
            workspace_id: "ws-1".to_string(),
            access_key_id: "AKIDEXAMPLE".to_string(),
            secret_key: "SECRETEXAMPLE".to_string(),
            app_id: Some("1234567890".to_string()),
            session_token: None,
            path_style: true,
            issued_at: now_iso(),
        };
        let code = encrypt_share_payload("pass-123", &payload).expect("encrypt");
        let decoded = decrypt_share_payload("pass-123", &code).expect("decrypt");
        assert_eq!(decoded.endpoint, payload.endpoint);
        assert_eq!(decoded.bucket, payload.bucket);
        assert_eq!(decoded.secret_key, payload.secret_key);
    }

    #[test]
    fn share_code_wrong_password_should_fail() {
        let payload = ShareCodePayload {
            provider: SYNC_PROVIDER.to_string(),
            endpoint: "https://cos.ap-shanghai.myqcloud.com".to_string(),
            region: "ap-shanghai".to_string(),
            bucket: "keepwise-sync-ap-shanghai-1234567890".to_string(),
            prefix: "keepwise-sync".to_string(),
            workspace_id: "ws-1".to_string(),
            access_key_id: "AKIDEXAMPLE".to_string(),
            secret_key: "SECRETEXAMPLE".to_string(),
            app_id: Some("1234567890".to_string()),
            session_token: None,
            path_style: true,
            issued_at: now_iso(),
        };
        let code = encrypt_share_payload("pass-123", &payload).expect("encrypt");
        let err = decrypt_share_payload("pass-456", &code).expect_err("must fail");
        assert!(err.contains("同步密码错误") || err.contains("损坏"));
    }

    #[test]
    fn snapshot_roundtrip_ok() {
        let key = derive_workspace_sync_key("sync-pass", "ws-1").expect("derive");
        let material = LocalSyncMaterial {
            db_bytes: b"db-bytes".to_vec(),
            rules: vec![RuleFileBinary {
                name: "merchant_map.csv".to_string(),
                bytes: b"a,b,c".to_vec(),
            }],
        };
        let snap = build_snapshot_bytes(&material, &key, None, "device-a").expect("build snapshot");
        let decoded = parse_snapshot_bytes(&snap, &key).expect("parse snapshot");
        assert_eq!(decoded.db_bytes, material.db_bytes);
        assert_eq!(decoded.rules.len(), 1);
        assert_eq!(decoded.rules[0].name, "merchant_map.csv");
    }

    #[test]
    fn encode_rfc3986_should_escape_slash_in_query() {
        assert_eq!(encode_rfc3986("a/b"), "a%2Fb");
    }
}
