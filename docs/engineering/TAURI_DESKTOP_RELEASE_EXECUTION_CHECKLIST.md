# Desktop Release Execution Checklist (Publisher View)

发布执行清单（面向发布者，精简版）。

## 1. 准备版本草稿

```bash
cd /Users/gameknife/github/BeyondYZYX/apps/keepwise-tauri
npm run desktop:release:prepare -- <version>
```

检查草稿目录中的：
- `CHANGELOG_DRAFT.md`
- `GROUPED_COMMITS_DRAFT.md`
- `release_meta.json`

## 2. 跑本地综合检查（必做）

```bash
npm run desktop:release:check
```

要求：
- Rust 回归子集通过
- 核心差分通过
- 前端构建与 `cargo check` 通过

## 3. 人工回归（按 TAB）

参考：
- `/Users/gameknife/github/BeyondYZYX/docs/engineering/TAURI_DESKTOP_USER_REGRESSION_CHECKLIST.md`

## 4. 生成 RC（CI 手动）

在 GitHub Actions 运行：
- `tauri-desktop-release-candidate`

检查 artifact：
- 构建产物
- 清单摘要
- 下载后验证说明

## 5. 签名/公证（后续启用）

- 使用模板脚本/模板 workflow 演练通过后，再接入真实证书与 secrets

## 6. Go / No-Go

确认以下三项后再发布：
- 自动化检查通过
- 人工回归通过
- 发布说明可读且准确
