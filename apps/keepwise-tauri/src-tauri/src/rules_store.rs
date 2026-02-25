use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const DEFAULT_APP_RULES_RELATIVE_DIR: &str = "rules";
const DEFAULT_REPO_RULES_RELATIVE_DIR: &str = "data/rules";
const DEFAULT_RULE_FILE_NAMES: &[&str] = &[
    "merchant_map.csv",
    "category_rules.csv",
    "analysis_exclusions.csv",
    "bank_transfer_whitelist.csv",
];

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..")
}

pub(crate) fn resolve_repo_rules_dir() -> PathBuf {
    repo_root().join(DEFAULT_REPO_RULES_RELATIVE_DIR)
}

pub(crate) fn resolve_app_rules_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("无法解析 app_local_data_dir: {e}"))?;
    Ok(base.join(DEFAULT_APP_RULES_RELATIVE_DIR))
}

pub(crate) fn ensure_app_rules_dir_seeded(app: &AppHandle) -> Result<PathBuf, String> {
    let app_rules_dir = resolve_app_rules_dir(app)?;
    fs::create_dir_all(&app_rules_dir).map_err(|e| format!("创建 app 规则目录失败: {e}"))?;

    let repo_rules_dir = resolve_repo_rules_dir();
    for file_name in DEFAULT_RULE_FILE_NAMES {
        let target_path = app_rules_dir.join(file_name);
        if target_path.exists() {
            continue;
        }
        let source_path = repo_rules_dir.join(file_name);
        if !source_path.exists() || !source_path.is_file() {
            continue;
        }
        fs::copy(&source_path, &target_path).map_err(|e| {
            format!(
                "复制默认规则文件失败 ({} -> {}): {e}",
                source_path.to_string_lossy(),
                target_path.to_string_lossy()
            )
        })?;
    }

    Ok(app_rules_dir)
}
