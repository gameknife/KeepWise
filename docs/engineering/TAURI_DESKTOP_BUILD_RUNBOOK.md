# Tauri Desktop Build Runbook (Current)

## 目标

提供桌面端本地构建、回归检查、RC 准备的最短路径。

## 本地开发

```bash
cd /Users/gameknife/github/BeyondYZYX/apps/keepwise-tauri
npm run tauri dev
```

## 发布前检查（推荐必跑）

```bash
cd /Users/gameknife/github/BeyondYZYX/apps/keepwise-tauri
npm run desktop:release:check
```

该命令会覆盖：
- Rust 回归子集
- 核心 4 接口差分回归
- 前端构建
- Rust `cargo check`

本地摘要产物目录：
- `/Users/gameknife/github/BeyondYZYX/.artifacts/tauri-desktop-check/`

## 本地构建产物（未签名）

```bash
bash /Users/gameknife/github/BeyondYZYX/apps/keepwise-tauri/scripts/build_keepwise_desktop_local.sh
```

产物输出目录：
- `/Users/gameknife/github/BeyondYZYX/.artifacts/desktop-builds/<artifact_prefix>/`

脚本会生成：
- `artifact_inventory.txt`
- `build_meta.json`

## 发布草稿准备（版本/changelog）

```bash
cd /Users/gameknife/github/BeyondYZYX/apps/keepwise-tauri
npm run desktop:release:prepare -- 0.2.0-rc.1
```

可选：`--write-version`（会写入版本号）

产物目录：
- `/Users/gameknife/github/BeyondYZYX/.artifacts/releases/...`

## CI Workflows（当前）

- `tauri-desktop-check`：自动检查（PR / main）
- `tauri-desktop-release-candidate`：手动 RC 构建（未签名）
- `tauri-desktop-release-signed-macos-template`：签名/公证模板流程（手动）
