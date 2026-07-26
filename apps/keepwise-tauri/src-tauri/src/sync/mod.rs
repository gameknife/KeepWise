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
use tauri::{async_runtime, AppHandle, Manager};
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
const SNAPSHOT_RETENTION_COUNT: usize = 5;

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
    #[serde(default)]
    snapshot_plain_hash: Option<String>,
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
    #[serde(default)]
    snapshot_id: Option<String>,
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

#[derive(Debug, Clone)]
struct SnapshotBuildResult {
    bytes: Vec<u8>,
    plain_hash: String,
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

#[derive(Debug, Clone)]
struct RemoteSnapshotObject {
    key: String,
    last_modified: String,
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

mod commands;
mod config_store;
mod crypto;
mod merge;
mod reconcile;
mod s3;
mod signing;
mod snapshot;
#[cfg(test)]
mod tests;
mod workspace;

pub use commands::*;
use config_store::*;
use crypto::*;
use merge::*;
use reconcile::*;
use s3::*;
use signing::*;
use snapshot::*;
use workspace::*;
