# macOS Signing / Notarization Template (Placeholder)

本文件为签名/公证模板说明，当前仓库已提供脚本与 workflow 骨架，但尚未接入真实证书和凭证。

## 模板脚本

- `/Users/gameknife/github/BeyondYZYX/apps/keepwise-tauri/scripts/macos_sign_notarize_template.sh`

默认行为为 `--check-only`（只校验参数与环境变量，不执行真实签名）。

## 需要准备（后续）

- Apple Developer 证书（Developer ID Application）
- Apple Notary 凭证（App Store Connect API key 或 Apple ID + app-specific password）
- CI Secrets（如启用 workflow）

## 常见环境变量（模板占位）

- `APPLE_TEAM_ID`
- `APPLE_ID`（若走 Apple ID 流程）
- `APPLE_APP_SPECIFIC_PASSWORD`（若走 Apple ID 流程）
- 或 Notary API Key 相关变量（按团队最终方案确定）

## 使用方式（检查模式）

```bash
bash /Users/gameknife/github/BeyondYZYX/apps/keepwise-tauri/scripts/macos_sign_notarize_template.sh --check-only --app <path-to-app> --dmg <path-to-dmg>
```

## 当前状态

- 模板存在，可用于流程演练
- 真实签名/公证尚未启用（待证书与 secrets）
