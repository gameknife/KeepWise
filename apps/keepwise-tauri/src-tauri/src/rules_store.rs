use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const DEFAULT_APP_RULES_RELATIVE_DIR: &str = "rules";
const DEFAULT_RULE_FILES: &[(&str, &str)] = &[
    (
        "merchant_map.csv",
        include_str!("../seeds/rules/merchant_map.csv"),
    ),
    (
        "category_rules.csv",
        include_str!("../seeds/rules/category_rules.csv"),
    ),
    (
        "analysis_exclusions.csv",
        include_str!("../seeds/rules/analysis_exclusions.csv"),
    ),
    (
        "bank_transfer_whitelist.csv",
        include_str!("../seeds/rules/bank_transfer_whitelist.csv"),
    ),
];

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

    for (file_name, contents) in DEFAULT_RULE_FILES {
        let target_path = app_rules_dir.join(file_name);
        if target_path.exists() {
            continue;
        }
        fs::write(&target_path, contents).map_err(|e| {
            format!(
                "写入默认规则文件失败 ({}): {e}",
                target_path.to_string_lossy()
            )
        })?;
    }

    Ok(app_rules_dir)
}
