# Tauri Desktop 本地打包 Runbook（阶段版）

适用范围：当前 `desktop first` 阶段（未接入签名/公证/CI 发布）。

## 目标

- 统一本地打包入口（debug / release / mac bundle）
- 在打包前强制跑一轮桌面 Rust 回归子集
- 降低“手工漏跑校验”导致的回归风险

## 入口命令

### 1. 仅做打包前检查（推荐每次开发完成先跑）

```bash
cd /Users/gameknife/github/BeyondYZYX/apps/keepwise-tauri
npm run desktop:release:check
```

包含：

- Rust 回归子集（预算/FIRE/收入/消费、investment-returns、YZXY 导入）
- 核心 4 分析接口差分（Python baseline vs Rust adapter）
- 前端构建
- Rust `cargo check`

本地会同步写入检查摘要（便于排障和留档）：

- `/Users/gameknife/github/BeyondYZYX/.artifacts/tauri-desktop-check/regression_summary_local.txt`
- `/Users/gameknife/github/BeyondYZYX/.artifacts/tauri-desktop-check/manifest_local.txt`
- `/Users/gameknife/github/BeyondYZYX/.artifacts/tauri-desktop-check/core_analytics_diff_regression.json`

### 1.5 准备发布草稿（版本号 / changelog 草稿）

默认只生成草稿，不改版本文件：

```bash
cd /Users/gameknife/github/BeyondYZYX/apps/keepwise-tauri
npm run desktop:release:prepare -- 0.2.0
```

同步写入 `package.json` 与 `src-tauri/Cargo.toml` 版本号：

```bash
cd /Users/gameknife/github/BeyondYZYX/apps/keepwise-tauri
npm run desktop:release:prepare -- 0.2.0 --write-version
```

可选指定变更起点（默认优先最近 tag，否则首个 commit）：

```bash
cd /Users/gameknife/github/BeyondYZYX/apps/keepwise-tauri
npm run desktop:release:prepare -- 0.2.0 --from-ref 7bbff4c
```

输出目录：

- `/Users/gameknife/github/BeyondYZYX/.artifacts/releases/keepwise-desktop-v<version>-<timestamp>/`
  - `CHANGELOG_DRAFT.md`
  - `release_meta.json`
  - `prepare_summary.txt`

### 2. 本地 debug 打包

```bash
bash /Users/gameknife/github/BeyondYZYX/scripts/build_keepwise_desktop_local.sh debug
```

### 3. 本地 release 打包

```bash
bash /Users/gameknife/github/BeyondYZYX/scripts/build_keepwise_desktop_local.sh release
```

### 4. macOS `.app + .dmg` 打包

```bash
bash /Users/gameknife/github/BeyondYZYX/scripts/build_keepwise_desktop_local.sh mac
```

## 产物位置（Tauri 默认）

- `apps/keepwise-tauri/src-tauri/target/debug/bundle/`
- `apps/keepwise-tauri/src-tauri/target/release/bundle/`

常见 macOS 产物：

- `.app`
- `.dmg`

## 本地导出命名规范（新增）

`scripts/build_keepwise_desktop_local.sh` 现在会在构建完成后把可分发产物复制到统一导出目录：

- `/Users/gameknife/github/BeyondYZYX/.artifacts/desktop-builds/<artifact_prefix>/`

默认 `artifact_prefix` 格式：

- `keepwise-desktop-v<version>-<mode>-<git_sha>-<YYYYmmdd-HHMMSS>`

示例：

- `keepwise-desktop-v0.1.0-mac-7bbff4c-20260224-214500`

导出目录内容：

- 平台产物（如 `.dmg`、`.app`）
- `build_meta.json`（版本、模式、commit、时间戳、bundle 源目录）
- `artifact_inventory.txt`（产物清点统计）

如果 Tauri 构建完成但没有发现可分发产物（如 `.app/.dmg/.exe/...`），脚本会直接报错退出，避免误以为打包成功。

可选环境变量（本地 CI/手动构建时有用）：

- `KEEPWISE_ARTIFACT_PREFIX`：覆盖默认命名
- `KEEPWISE_DESKTOP_EXPORT_ROOT`：覆盖导出根目录

## 当前阶段未覆盖（后续补）

- Apple 签名 / notarization
- Windows 安装包签名
- Linux 包矩阵构建
- CI 自动发布（tag 触发）
- changelog 自动化

## 下一步建议（发布流程收口）

1. 增加 GitHub Actions：`desktop-check`（build + rust regression subset + core diff）
2. 增加 `release-candidate` 工作流（手动触发构建 mac artifact）
3. 补签名配置模板（环境变量占位，不提交密钥）

## 已新增工作流（当前状态）

- `tauri-desktop-check`：PR / push / 手动触发，做构建与回归校验，并上传 `.artifacts/tauri-desktop-check`
- `tauri-desktop-release-candidate`：手动触发，生成 macOS RC 产物（未签名），并上传导出目录 artifact
  - 包含 `target_version` 输入校验（支持 `0.2.0` / `0.2.0-rc.1`）
  - 在 `Step Summary` 中输出产物清点摘要
- `tauri-desktop-release-signed-macos-template`：手动触发，构建 macOS 产物并运行签名/公证模板
  - 默认 `check-only`
  - 可切换 `execute_signing=true`（需要先配置 secrets）

## 相关文档（新增）

- 签名/公证占位模板：`/Users/gameknife/github/BeyondYZYX/docs/engineering/TAURI_DESKTOP_SIGNING_NOTARIZATION_TEMPLATE.md`
- 用户视角回归清单：`/Users/gameknife/github/BeyondYZYX/docs/engineering/TAURI_DESKTOP_USER_REGRESSION_CHECKLIST.md`
- 发布执行清单（发布者视角）：`/Users/gameknife/github/BeyondYZYX/docs/engineering/TAURI_DESKTOP_RELEASE_EXECUTION_CHECKLIST.md`

## 辅助脚本（模板）

- macOS 签名/公证模板脚本：`/Users/gameknife/github/BeyondYZYX/scripts/macos_sign_notarize_template.sh`
  - 默认 `check-only`
  - `--execute` 前请先完成证书与 Apple 凭证配置
- 本地桌面发布检查包装脚本：`/Users/gameknife/github/BeyondYZYX/scripts/validate_tauri_desktop_release_check.sh`
  - 产出本地回归摘要与 manifest
