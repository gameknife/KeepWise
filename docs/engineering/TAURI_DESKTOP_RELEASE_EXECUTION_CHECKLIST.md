# KeepWise Desktop 发布执行清单（发布者视角）

用途：

- 作为一次完整桌面发布（含 RC）的人为执行 checklist
- 串联 `prepare -> check -> RC -> （签名/公证）-> 发布`

适用范围：

- 当前 `desktop first` 阶段（Tauri 桌面）
- 移动端不在本清单范围内

## A. 发布前准备（版本与范围）

1. 确认本次发布目标版本号（如 `0.2.0` 或 `0.2.0-rc.1`）
2. 确认发布范围（功能点、修复点、是否包含数据口径变更）
3. 确认基线 commit / 变更起点（用于 changelog 草稿）
4. 确认是否需要同步更新版本号文件（`package.json` / `Cargo.toml`）

## B. 生成发布草稿（必须）

1. 生成发布草稿（预览模式，不写版本）

```bash
cd /Users/gameknife/github/BeyondYZYX/apps/keepwise-tauri
npm run desktop:release:prepare -- <version> [--from-ref <git-ref>]
```

2. 检查输出目录（`.artifacts/releases/...`）是否生成：
- `CHANGELOG_DRAFT.md`
- `GROUPED_COMMITS_DRAFT.md`
- `release_meta.json`
- `prepare_summary.txt`

3. 人工补充 `CHANGELOG_DRAFT.md`：
- 用户可见变化
- 风险点
- 验证重点

4. 若决定本次正式写版本号，再执行：

```bash
cd /Users/gameknife/github/BeyondYZYX/apps/keepwise-tauri
npm run desktop:release:prepare -- <version> --write-version [--from-ref <git-ref>]
```

## C. 本地回归检查（必须）

1. 执行：

```bash
cd /Users/gameknife/github/BeyondYZYX/apps/keepwise-tauri
npm run desktop:release:check
```

2. 检查本地摘要文件：
- `/Users/gameknife/github/BeyondYZYX/.artifacts/tauri-desktop-check/regression_summary_local.txt`
- `/Users/gameknife/github/BeyondYZYX/.artifacts/tauri-desktop-check/core_analytics_diff_regression.json`

3. 必须满足：
- Rust regression 子集通过
- 核心 4 analytics diff `25/25 PASS`、cross-check `2/2 PASS`
- 前端构建通过
- Rust `cargo check` 通过

## D. 用户视角人工回归（建议每次 RC）

1. 按文档执行：
- `/Users/gameknife/github/BeyondYZYX/docs/engineering/TAURI_DESKTOP_USER_REGRESSION_CHECKLIST.md`

2. 至少覆盖：
- 导入中心（YZXY / EML / PDF）
- 收益分析 / 财富总览
- 消费分析（筛选与图表）
- 高级管理（健康检查 / 冒烟验证）

## E. 构建 Release Candidate（CI 推荐）

1. 在 GitHub Actions 手动运行：
- `tauri-desktop-release-candidate`

2. 输入：
- `target_version`
- `run_prechecks`（建议 `true`）

3. 检查 workflow 结果：
- `Version Consistency Preview Check` 通过
- RC 构建步骤通过
- artifact 上传成功

4. 下载 artifact 并核对：
- `.artifacts/desktop-builds/...`
- `artifact_inventory.txt`
- `.artifacts/release-candidate/artifact_inventory_summary.txt`

## F. 签名 / 公证（正式外部分发前）

当前为模板阶段（未接入真实签名 workflow），参考：

- `/Users/gameknife/github/BeyondYZYX/docs/engineering/TAURI_DESKTOP_SIGNING_NOTARIZATION_TEMPLATE.md`
- `/Users/gameknife/github/BeyondYZYX/scripts/macos_sign_notarize_template.sh`

建议流程：

1. 在本地或专用 CI 环境准备证书与 Apple 凭证
2. 先执行 `--check-only` 验证环境变量与文件路径
3. 再执行 `--execute`（仅在确认流程后）
4. notarization 成功后 staple

## G. 发布前最终确认（Go / No-Go）

1. 版本号一致（`package.json` == `Cargo.toml`）
2. 发布草稿已人工完善
3. 自动化回归通过
4. 人工回归通过
5. RC 产物安装/启动验证通过
6. （正式发布）签名/公证通过

## H. 发布后记录（建议）

记录以下信息以便追溯：

- 发布版本号
- 发布 commit SHA
- RC workflow run 链接
- 发布者
- 发布时间（UTC + 本地时区）
- 已知问题列表（如有）
