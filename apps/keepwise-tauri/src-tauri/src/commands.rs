use serde::Serialize;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize)]
pub struct HealthPing {
    pub status: &'static str,
    pub unix_ts: u64,
    pub mode: &'static str,
}

#[derive(Debug, Serialize)]
pub struct AppMetadata {
    pub app_name: String,
    pub app_version: String,
    pub app_identifier: Option<String>,
    pub target_os: String,
    pub target_arch: String,
    pub debug: bool,
    pub tauri_major: u8,
}

#[derive(Debug, Serialize)]
pub struct PathProbe {
    pub path: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct AppPaths {
    pub app_data_dir: PathProbe,
    pub app_config_dir: PathProbe,
    pub app_cache_dir: PathProbe,
    pub app_log_dir: PathProbe,
    pub app_local_data_dir: PathProbe,
}

fn now_unix_ts() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn path_probe(result: Result<PathBuf, tauri::Error>) -> PathProbe {
    match result {
        Ok(path) => PathProbe {
            path: Some(path.to_string_lossy().to_string()),
            error: None,
        },
        Err(err) => PathProbe {
            path: None,
            error: Some(err.to_string()),
        },
    }
}

#[tauri::command]
pub fn health_ping() -> HealthPing {
    HealthPing {
        status: "ok",
        unix_ts: now_unix_ts(),
        mode: "desktop",
    }
}

#[tauri::command]
pub fn app_metadata(app: AppHandle) -> AppMetadata {
    let package = app.package_info();
    let identifier = {
        let raw = app.config().identifier.clone();
        if raw.trim().is_empty() {
            None
        } else {
            Some(raw)
        }
    };

    AppMetadata {
        app_name: package.name.clone(),
        app_version: package.version.to_string(),
        app_identifier: identifier,
        target_os: std::env::consts::OS.to_string(),
        target_arch: std::env::consts::ARCH.to_string(),
        debug: cfg!(debug_assertions),
        tauri_major: 2,
    }
}

#[tauri::command]
pub fn app_paths(app: AppHandle) -> AppPaths {
    let resolver = app.path();
    AppPaths {
        app_data_dir: path_probe(resolver.app_data_dir()),
        app_config_dir: path_probe(resolver.app_config_dir()),
        app_cache_dir: path_probe(resolver.app_cache_dir()),
        app_log_dir: path_probe(resolver.app_log_dir()),
        app_local_data_dir: path_probe(resolver.app_local_data_dir()),
    }
}
