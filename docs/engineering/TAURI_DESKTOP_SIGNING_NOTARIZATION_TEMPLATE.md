# Tauri Desktop 签名与公证配置模板（占位）

适用范围：KeepWise Desktop 在进入正式外部分发前的发布准备阶段。

当前状态：

- 已有 desktop 构建与 RC workflow（未签名）
- 本文档用于定义环境变量、CI secret 命名和人工步骤
- 不包含任何真实证书/密钥

## 目标

1. 明确各平台签名所需材料
2. 统一 CI Secret 命名
3. 降低“构建成功但安装/启动被系统拦截”的发布风险

## macOS（优先）

### 产物

- `.app`
- `.dmg`

### 需要准备（人工）

1. Apple Developer 账号（Developer ID Application / Installer）
2. App 专用密码（用于 notarization）
3. Keychain 中可用签名证书（本地）或导出为 CI 可导入格式

### 建议 Secret 命名（CI）

- `APPLE_CERTIFICATE_P12_BASE64`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_SIGNING_IDENTITY`
- `APPLE_ID_EMAIL`
- `APPLE_TEAM_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `KEYCHAIN_PASSWORD`（CI 临时 keychain）

### 需要确认的配置（项目）

1. `bundle identifier` 是否固定且可用
2. 应用名称与签名主体一致性
3. 版本号策略（`package.json` / `Cargo.toml`）

## Windows（后续）

### 产物

- `.msi` / `.exe`

### 建议 Secret 命名（CI）

- `WINDOWS_CERTIFICATE_PFX_BASE64`
- `WINDOWS_CERTIFICATE_PASSWORD`
- `WINDOWS_TIMESTAMP_URL`（如时间戳服务）

### 当前阶段建议

- 先完成 unsigned RC 构建与功能验证
- 等桌面主线稳定后再接 Windows 签名

## Linux（后续）

Linux 通常不要求统一签名流程（按发行格式而定），当前阶段只需保证：

- 包可构建
- 运行依赖清晰
- 产物命名可追踪版本

## CI 集成建议（分阶段）

### Phase A（当前）

- `tauri-desktop-check`：构建与回归校验
- `tauri-desktop-release-candidate`：构建 unsigned macOS RC artifact

### Phase B（下一阶段）

- 新增 `release-signed-macos` workflow（手动触发）
- 导入 Apple 证书到临时 keychain
- `tauri build` 签名产物
- notarize + staple
- 上传签名后 artifact

当前仓库已提供一个模板 workflow 骨架（默认可运行 check-only）：

- `/Users/gameknife/github/BeyondYZYX/.github/workflows/tauri-desktop-release-signed-macos-template.yml`

以及本地模板脚本：

- `/Users/gameknife/github/BeyondYZYX/scripts/macos_sign_notarize_template.sh`

### Phase C（正式发布）

- tag 触发
- 签名 + 公证 + 发布说明 + 发布产物

## 人工发布前核对（最小集）

1. `npm run desktop:release:check` 通过
2. `npm run desktop:release:prepare -- <version>` 生成草稿完成
3. RC workflow 构建完成并下载 artifact
4. macOS 本机安装/启动验证通过（Gatekeeper 路径）
5. 用户视角回归清单通过（见 `TAURI_DESKTOP_USER_REGRESSION_CHECKLIST.md`）

## 后续落地 TODO（未实现）

1. 编写 `macos_sign_notarize.sh`（本地模板脚本）
2. 将 `tauri-desktop-release-signed-macos-template` 从模板提升为正式 signed workflow
3. 在 runbook 中补“证书导入 / notarization 故障排查”
