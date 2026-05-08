# KeepWise 重构 / 减负 / 清理 开发计划（2026）

> 目的：在 Tauri Desktop 已是唯一目标形态的前提下，
> 一次性卸掉历史包袱、收口结构性问题，让后续开发轻装上阵。
>
> 范围：**只保留 `apps/keepwise-tauri` 一条主线**，
> 其它（Python legacy、过渡产物、半成品重构、文档漂移）全部清理或补齐。
>
> 执行方：本计划由 Claude 编写，后续交由 codex 按章节顺序执行。
> 每个阶段都写明 **变更面 / 操作步骤 / 验收门**，codex 可独立完成而无需追溯本计划上下文。

---

## 0. 总览

### 0.1 当前真实状态（截至 2026-05-08）

| 维度 | 现状 | 问题 |
|------|------|------|
| 唯一形态 | `apps/keepwise-tauri`（React + Rust + SQLite） | ✅ 已确定 |
| 旧实现 | `apps/keepwise-legacy/`（16 个 Python 脚本） | ❌ 完全废弃但仍在仓库内 |
| Python 依赖 | `tools/migration/` 差分回归仍是 CI 必装项 | ⚠️ 已锁定的核心口径仍把 Python 当 oracle |
| 数据目录 | `data/rules`（rules seed，仍用）、`data/input/raw/...`（仅测试 fixture）、`data/work/processed/...`（legacy import 路径）、`data/output/`（legacy 报表） | ⚠️ 三个子目录已无业务价值，其中一个仍被 Rust 测试硬编码引用 |
| `db/migrations/` | 在仓库根，被 Rust 通过相对路径 `include_str!` 嵌入 | ⚠️ 跨仓库目录耦合，且不属于 monorepo |
| 前端 `App.tsx` | 3548 行、192 个 useState | ⚠️ 已抽 8 个阶段但状态仍集中、JSX 仍庞大 |
| 抽出的 Section 组件 | 13 个文件 `// @ts-nocheck + props: any` | ❌ 重构丢失类型，是负资产 |
| 前端 `App.css` | 3856 行单文件 | ⚠️ 全局作用域、风格系统未模块化 |
| `desktopApi.ts` | 25+ payload 类型为 `unknown` | ⚠️ 后端结构变更前端无感知 |
| 后端 Rust 文件 | 5 个文件 >1500 行（investment 2617 / sync 2175 / budget_fire 2052 / cmb_pdf 1902 / cmb_eml 1617） | ⚠️ 单文件囊括解析+SQL+API+测试 |
| 测试辅助 | `create_temp_test_db / apply_all_migrations_for_test / repo_root` 在 5+ 文件中重复 | ⚠️ 维护成本 N 倍 |
| 错误类型 | 全栈 `Result<Value, String>` | ⚠️ 信息丢失，前端无法分类处理 |
| 工程文档 | `AGENTS.md / FRONTEND_ARCHITECTURE.md / TAURI_IPC_API_PROTOCOL.md` | ❌ 仍引用"单文件 9860 行 App.tsx" |
| 仓库根 | 残留 `url`、`.DS_Store`、空 `features/manual-entry/`、`features/investment/` | ❌ 噪声 |

### 0.2 计划目标

按"从最低风险到最高价值"的顺序，分 **9 个阶段**完成：

```
阶段 1 ── 仓库级清理（删 legacy / 空目录 / 噪声文件）
阶段 2 ── 数据目录与路径解耦（cut data/work、data/input、data/output；test fixture 内移）
阶段 3 ── Python 差分回归的最终归宿（baseline 冻结或 Rust 自洽）
阶段 4 ── 文档同步现状（删除/重写漂移的工程文档）
阶段 5 ── 前端重构补完 ① ：13 个 ts-nocheck 组件类型化 + 删 prop drilling
阶段 6 ── 前端重构补完 ② ：状态分域 + App.tsx 真正瘦身
阶段 7 ── 前端 desktopApi 与响应类型对齐
阶段 8 ── 后端 Rust 大文件拆分 + 测试辅助提取
阶段 9 ── 错误类型 / 响应类型 / 工程化收尾
```

### 0.3 全程通用约束

- **每个阶段必须独立可发布**：单独完成后跑通 `npm run desktop:release:check`
- **保持业务可见行为不变**：UI 文案、数据口径、Tauri command 名称不可改动；本计划是**结构重构**，不是产品改动
- **不引入新依赖** 除非阶段说明显式允许；优先使用现有 React 19 / Rust 2021 能力
- **保留中文界面文案**（与 `AGENTS.md` 风格约定一致）
- **commit 粒度**：每个阶段以 1~5 个 commit 完成；commit message 中文/英文均可，与现有提交风格一致即可
- **不加 emoji** 到代码 / 文档 / 提交信息中（除非现有文件已有）

---

## 阶段 1 — 仓库级清理（最低风险）

### 1.1 目标

删除/隔离三类垃圾：**已确认废弃的旧实现**、**空目录**、**根目录噪声文件**。

### 1.2 变更面（删除）

#### 1.2.1 删除 `apps/keepwise-legacy/` 整个目录
- 包含 16 个 Python 脚本（旧 Web 工作台、旧导入器、旧分析服务）
- 已知引用：仅 `README.md`、`AGENTS.md` 文字提及；无任何 Tauri / CI / 脚本依赖
- 操作：
  ```bash
  git rm -r apps/keepwise-legacy
  ```
- 验证：`grep -r "apps/keepwise-legacy\|keepwise-legacy" apps .github docs tools` 应为空

#### 1.2.2 删除空目录占位
- `apps/keepwise-tauri/src/features/manual-entry/`（空）
- `apps/keepwise-tauri/src/features/investment/`（空）
- 这两个目录在 `App.tsx` 第 227 行 `PRODUCT_TABS` 里有 tab key 但实现仍在 `App.tsx` 主体，未提取
- 操作：直接 `git rm -r` 这两个空目录（git 不跟踪空目录，但工作树要清掉）

#### 1.2.3 删除根目录噪声
- `/Users/gameknife/github/BeyondYZYX/url`：内容是疑似 token/URL 片段，**不是项目配置**，可能是误提交
  - 操作：`git rm url`，并向 `.gitignore` 加一行 `/url`
- `.DS_Store`：repo 多处存在；已在 `.gitignore` 但被历史误提交
  - 操作：`git rm --cached -r '*.DS_Store'`（保留本地文件，仅取消跟踪）；`.gitignore` 已含 `.DS_Store`，无需新增

#### 1.2.4 评估并删除 `tests/contracts/`
- README 自述 "人工参考"，无任何工具读取
- 操作：与上面同步删除 `git rm -r tests/contracts`，若 `tests/` 因此为空则一并删除该目录

### 1.3 同步更新

#### 1.3.1 `README.md`
- 删除"旧版脚本/Web 工作台：`apps/keepwise-legacy`"那一节
- 删除"测试契约（人工参考）：`tests/contracts/...`"那一节

#### 1.3.2 `AGENTS.md`
- 删除"`apps/keepwise-legacy/  # Legacy Python/BS app (deprecated)`"块

### 1.4 验收门

- `npm run desktop:release:check` 通过
- `git ls-files | grep -E '(keepwise-legacy|tests/contracts/|^url$)'` 为空

### 1.5 不做的事

- **不**删除 `tools/migration/`（阶段 3 处理）
- **不**删除 `data/`（阶段 2 处理）
- **不**改任何 `.tsx / .rs` 业务代码

---

## 阶段 2 — 数据目录与路径解耦

### 2.1 目标

把"运行时依赖"和"测试 fixture"从仓库根的 `data/` 目录里**解开**，
让 Rust 代码不再硬编码 `repo_root().join("data/...")`，让仓库根少一个迷惑性目录。

### 2.2 现状盘点

| 路径 | 谁用 | 处置 |
|------|------|------|
| `data/rules/*.csv` | Rust `rules_store.rs` 首次启动 seed app local rules dir | 内移到 `apps/keepwise-tauri/src-tauri/seeds/rules/` 并 `include_str!` 嵌入 |
| `data/work/processed/ledger/keepwise.db` | Rust `ledger_db::ledger_db_import_repo_runtime` 这条命令唯一引用 | 与该 command 一起删除（命令本身已被"用文件选择器从路径导入"替代） |
| `data/input/raw/eml/cmb/2025/...` | `cmb_eml_import.rs` 5 处测试硬编码路径 | fixture 移入 `apps/keepwise-tauri/src-tauri/tests/fixtures/cmb_eml/`，测试改读相对路径 |
| `data/input/raw/eml/cmb/2026/招商银行信用卡电子账单 (12).eml` | 同上 | 同上 |
| `data/output/reports/` | 仅 legacy 输出目录 | 删除 |

### 2.3 操作步骤

#### 2.3.1 内嵌 rules seed
1. 创建 `apps/keepwise-tauri/src-tauri/seeds/rules/`
2. 把 4 个 CSV 复制进去：`merchant_map.csv / category_rules.csv / analysis_exclusions.csv / bank_transfer_whitelist.csv`
3. 重写 `apps/keepwise-tauri/src-tauri/src/rules_store.rs`：
   - 改用 `include_str!("../seeds/rules/<file>.csv")` 把 4 个 CSV 编译进二进制
   - `ensure_app_rules_dir_seeded`：如目标文件不存在，从内嵌字节写入，不再读 repo
   - 删除 `repo_root()` 与 `resolve_repo_rules_dir`
4. 验证：删掉本机 `data/rules/` 后跑 `cargo test --manifest-path src-tauri/Cargo.toml` 仍全绿

#### 2.3.2 删除 `ledger_db_import_repo_runtime` 命令
- 该命令历史用途是"从仓库 work 目录导入预置 DB"——现在 demo.db 已 `include_bytes!` 嵌入，且文件选择器导入命令存在，这个 command 是死路径
- 删除：
  - `apps/keepwise-tauri/src-tauri/src/ledger_db.rs` 中的 `ledger_db_import_repo_runtime`、`resolve_repo_runtime_db_path`、`DEFAULT_REPO_RUNTIME_DB_RELATIVE_PATH`
  - `apps/keepwise-tauri/src-tauri/src/lib.rs` `invoke_handler!` 列表里对应那行
  - `apps/keepwise-tauri/src/lib/desktopApi.ts` `importRepoRuntimeLedgerDb` 整段
  - `apps/keepwise-tauri/src/app/App.tsx` 调用点（搜 `importRepoRuntimeLedgerDb` / `runDbImportSequence("repo")` / `handleImportRepoRuntimeDb`）
  - `apps/keepwise-tauri/src/features/admin/AdminDbPanel.tsx` "从仓库 runtime 目录导入" 按钮 + 相关 prop
- 文档：`docs/engineering/TAURI_IPC_API_PROTOCOL.md` 命令表删除第 7 项
- 验证：UI 端 "高级管理 → 数据库管理" 仍能用文件选择器导入，命令计数从 57 降到 56

#### 2.3.3 测试 fixture 内移
1. 创建 `apps/keepwise-tauri/src-tauri/tests/fixtures/cmb_eml/`（与 src 同级新建 tests 目录）
2. 把 `data/input/raw/eml/cmb/2025/*.eml`、`data/input/raw/eml/cmb/2026/招商银行信用卡电子账单 (12).eml` 中**仅被测试引用的具体文件**移入；其它整理为不再保留
3. 修改 `cmb_eml_import.rs` 测试模块：
   - 引用方式改为 `Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/cmb_eml/...")`
   - 删除每个测试模块顶部的 `repo_root()` 辅助函数（统一从 `crate::test_support::repo_root` 引入，或直接弃用）
4. 验证：`cargo test --manifest-path src-tauri/Cargo.toml --lib cmb_eml_import` 全绿

#### 2.3.4 清空 `data/`
- 上面三步完成后，`data/rules/`、`data/work/`、`data/input/`、`data/output/` 全部不再被任何代码引用
- 操作：`git rm -r data`
- 验证：`grep -rn '"data/' apps/keepwise-tauri/src-tauri/src` 应仅剩可选的注释痕迹，无 `include_str!` / `Path::new` 引用

### 2.4 验收门

- `npm run test:rust` 全绿（14 个测试）
- `npm run desktop:release:check` 通过
- `data/` 目录完全消失
- Tauri 启动后冷启动仍能正确生成本地 rules 目录与 4 个 CSV

### 2.5 风险与回退

- 风险点 A：rules seed CSV 二进制嵌入后无法在不重编的情况下更新——可接受，未来如需热更新再单独立项
- 风险点 B：`ledger_db_import_repo_runtime` 删除后用户若依赖该路径的脚本会失效——基本不存在，命令的 UI 入口仅在"高级管理"开发者模式下；release notes 标注

---

## 阶段 3 — Python 差分回归的最终归宿

### 3.1 背景

`tools/migration/` 的 Python 脚本是当年 "Python 实现作 oracle, Rust 实现作被验证方" 的差分回归框架。
现在 Python 实现已经从仓库里删除（阶段 1 完成后 `apps/keepwise-legacy/` 已不存在），
但 `tools/migration/python_adapter_cli.py` 仍引用旧 Python 实现作 oracle——这是悬挂依赖。

需要做出决策。

### 3.2 决策矩阵

| 选项 | 含义 | 推荐 |
|------|------|------|
| A. 冻结 baseline + 删 Python | 用一次最后跑通的 JSON 报告作为冻结 baseline，CI 改为 "Rust 跑出当前结果 → 与 baseline diff"；删除 `tools/migration/python_adapter_cli.py` 与 mock 实现 | ✅ |
| B. 把 Python oracle 留在仓库 | 保留 Python 仅供回归用，但与产品代码隔离 | ❌（与"减负"目标冲突） |
| C. 只跑 Rust 自洽测试 | 删除整个 diff regression，依赖 cargo test 的 25 个 case | ❌（损失了已建立的精确口径锁） |

**默认选 A**。如 codex 在执行前发现 Python adapter 仍隐性依赖 `apps/keepwise-legacy`（阶段 1 已删），那 A 是唯一可执行选项。

### 3.3 操作步骤（选项 A）

#### 3.3.1 生成 baseline 快照
1. 在阶段 1 删除 legacy 之前，先 `npm run test:diff:core` 跑一次，把 `.artifacts/tauri-desktop-check/core_analytics_diff_regression.json` 作为 oracle baseline
2. 把它移到 `apps/keepwise-tauri/src-tauri/tests/baseline/core_analytics_diff_regression.baseline.json`
3. **如果阶段 1 已先于阶段 3 执行**，把 codex 引导回到 git 历史的最后一次 main commit（`4b61e79` 或之前），生成 baseline，然后回到 head 继续

#### 3.3.2 重写 diff runner
- 把 `tools/migration/run_diff_regression.py` 替换为 Rust 二进制 `kw_baseline_diff`：
  - 读取 baseline JSON
  - 调用现有 `kw_migration_adapter` 跑出当前 25 case 结果
  - 字段级 diff，输出与原 Python runner 同结构的报告
- 删除：
  - `tools/migration/python_adapter_cli.py`
  - `tools/migration/mock_rust_adapter.py`
  - `tools/migration/run_diff_regression.py`
  - 整个 `tools/` 目录（如此后无其它内容）
- `apps/keepwise-tauri/scripts/validate_tauri_core_diff_regression.sh`：
  - 改为调用新的 Rust baseline diff 二进制，去掉 `python3` 调用

#### 3.3.3 CI 去 Python 化
修改三个 workflow，删除 `Setup Python` / `Install diff regression Python deps` / 任何 `python3 - <<PY` 内联脚本：
- `.github/workflows/tauri-desktop-check.yml`
  - 删 step 46-52、82-112（regression summary 内联 Python）→ summary 改为 shell + jq 实现
- `.github/workflows/tauri-desktop-release-candidate.yml`
  - 删 step 48-54、67 行附近的 Python 内联
- `.github/workflows/tauri-desktop-release-signed-macos-template.yml`
  - 删 step 53-59、所有 `python3 - <<PY`
- `apps/keepwise-tauri/scripts/validate_tauri_desktop_release_check.sh` 第 28-39 行 inline Python：改为 jq 解析 JSON
- `apps/keepwise-tauri/scripts/prepare_keepwise_desktop_release.sh` 第 70/108/219/255 行的 inline `python3`：改用 `node -e` 或 jq；这是版本同步脚本，jq+sed 即可

#### 3.3.4 demo db 构建脚本
- `apps/keepwise-tauri/package.json` 中 `db:demo:build` 仍调 `python3 scripts/make_demo_db.py`
- 选择：
  - A. 把 `make_demo_db.py` 用 Rust bin（`apps/keepwise-tauri/src-tauri/src/bin/kw_make_demo_db.rs`）重写
  - B. 删除该脚本与 `package.json` 中的 script，因为 demo.db 已 `include_bytes!` 嵌入，重新生成是低频运维动作
- 推荐 B：开发期重生成 demo.db 是开发者本地动作，不需要让 CI/team 都装 Python；保留 Python 脚本但**不进 CI**

### 3.4 验收门

- `which python3` 不可用的环境上仍能跑 `npm run desktop:release:check`
- `git grep -n "python\|setup-python" .github apps/keepwise-tauri/scripts apps/keepwise-tauri/package.json` 应仅命中阶段 3 选 B 时的 `db:demo:build` 一处（且不在 CI workflow 中）

### 3.5 风险

- baseline 一旦冻结，后续若 Rust 实现发现新 bug 修了，baseline 也会"假装"有那个 bug——
  应在文档中记录"baseline = 冻结时的 Rust 实现行为"，每次有意修改口径需手动 `regenerate-baseline` 命令更新

---

## 阶段 4 — 文档同步现状

### 4.1 目标

让 `README.md / AGENTS.md / docs/engineering/*.md` 反映**当前真实状态**，
而不是 2026-02 时单文件 ~10K 行的 App.tsx。

### 4.2 操作

#### 4.2.1 重写 `AGENTS.md` 第 8-31 行的"Repository Layout"
- 删除"`apps/keepwise-legacy/`"块
- 把 `src/App.tsx                 # Entire React UI (single-file, ~10K lines)` 改为：
  ```
  src/main.tsx                  # 入口 + ErrorBoundary
  src/App.tsx                   # 顶层 default export, 转发到 ./app/App
  src/app/App.tsx               # 主组装层 (~3500 行, 装配 features)
  src/app/{helpers,summaries,requestBuilders,amountFormatting}.ts
  src/features/<domain>/        # 14 个领域子模块
  src/lib/desktopApi.ts         # Tauri invoke 包装 + payload 类型
  src/hooks/{useAsyncQuery,useDebouncedAutoRun}.ts
  src/types/app.ts              # 全局类型
  src/utils/value.ts            # 安全字段读取
  ```
- 把 `### Architecture Notes` 中 "Entire UI lives in App.tsx (monolithic single-file, ~10K lines) - no component splitting" 改为反映已分层的现实

#### 4.2.2 重写 `docs/engineering/FRONTEND_ARCHITECTURE.md`
- 整篇基于"~9860 行 App.tsx"的描述已过时，必须重写
- 推荐保留章节：应用布局、产品 Tab、组件清单（按 14 个 feature 子目录重新分组）、数据流
- 删除"优化方向"章节中已落地的项（按 `CEO_REQ.md` 已完成 8 个阶段对照），仅保留**仍未完成**的 4 项
- 修订日期更新为本阶段执行日期

#### 4.2.3 重写 `docs/engineering/TAURI_IPC_API_PROTOCOL.md`
- 命令总数 57 → **阶段 2 删 1 后为 56**
- 检查每个命令的请求/响应描述是否仍与 `desktopApi.ts` 类型一致；不一致的全部修正
- 删除"前端全貌 — App.tsx & App.css"章节（与 `FRONTEND_ARCHITECTURE.md` 重复）

#### 4.2.4 整理 `docs/engineering/` 文件
- `TAURI_STACK_MIGRATION_MASTER_PLAN.md`：迁移已完成 90%+，文档定位是"迁移期路线"——保留但加 "**HISTORICAL**" 标头，不再作为当前路线参考
- `TAURI_TECH_SELECTION_DECISION_MATRIX.md`：保留，已定版，无需改
- `TAURI_DESKTOP_BUILD_RUNBOOK.md` / `TAURI_DESKTOP_RELEASE_EXECUTION_CHECKLIST.md` / `TAURI_DESKTOP_SIGNING_NOTARIZATION_TEMPLATE.md`：保留
- `TAURI_DESKTOP_USER_REGRESSION_CHECKLIST.md`：保留
- `TAURI_DIFF_ADAPTER_CLI_PROTOCOL.md`：阶段 3 后 Python adapter 删除，需要更新或删除
- `TAURI_CONTRACT_FREEZE_DIFF_TEST_PLAN.md`：阶段 3 后改为 baseline 冻结方案，重写
- `TAURI_MULTI_DEVICE_SYNC_PLAN.md`：与 `sync_management.rs` 现状对照，更新或保留
- `PRODUCTIZATION_REFACTOR_BASELINE.md`：保留，是 UI 设计约定
- 本文件 `REFACTOR_CLEANUP_PLAN_2026.md`：保留，作为执行档案

#### 4.2.5 同步 `DEVELOPMENT_PLAN.md`
- "已完成"摘要追加阶段 1-3 的产物
- "进行中"段落加上阶段 5-9

#### 4.2.6 `CEO_REQ.md`
- 不动结构。但本计划完成后，把"对前端框架作第N阶段拆分"的旧条目挪到独立的 `docs/engineering/REFACTOR_HISTORY.md`（可选；如不挪，CEO_REQ.md 也不再追加新阶段）

### 4.3 验收门

- `git grep -n "10K\|9860\|monolithic single-file\|keepwise-legacy" docs README.md AGENTS.md` 应为空
- 文档新提及的命令数与 `lib.rs` `invoke_handler!` 实际数量对得上

---

## 阶段 5 — 前端重构补完 ① ：消除 ts-nocheck + prop drilling

### 5.1 目标

13 个 `// @ts-nocheck` + `props: any` 的 Section 组件**类型化并瘦身**。
现状下它们没有提供任何抽象价值，仅起"文件搬家"的作用，反而把 60-100 个 prop 从 `App.tsx` 漏出来。

### 5.2 涉及文件

```
features/admin/AccountCatalogAdminPanel.tsx         (props: any)
features/admin/AdminDbPanel.tsx                     (props: any)
features/admin/AdminProbePanels.tsx                 (props: any)
features/admin/AdminSections.tsx                    (props: any, 564 行, 100+ props)
features/analytics/ReturnAnalysisSection.tsx        (props: any)
features/analytics/WealthOverviewSection.tsx        (props: any)
features/import/ImportCenterSections.tsx            (props: any)
features/layout/WorkspaceContentPanels.tsx         (props: any, 446 行)
features/layout/WorkspaceSidebar.tsx                (props: any)
features/modals/AppSettingsModal.tsx                (props: any, 554 行)
features/modals/InvestmentEditModal.tsx             (props: any)
features/modals/QuickManualAssetValuationModal.tsx  (props: any)
features/modals/QuickManualInvestmentModal.tsx      (props: any)
```

### 5.3 操作策略

**对每个文件采用相同手术**：

1. **删 `// @ts-nocheck`**
2. 把 `function X(props: any) { const { ... } = props; ... }` 改为
   `type XProps = { ... }; export function X({ ...props }: XProps) { ... }`
3. props 类型从 `App.tsx` 中实际传入处反推：所有 `import` 的类型 / handler 签名 / state setter 签名都已存在
4. 跑 `tsc --noEmit` 直到无错

**优先级（从小到大）**：
- 先改 5 个 modal（每个 100-560 行，状态多但闭合）
- 再改 3 个 admin/probe/db 单板（200-240 行）
- 再改 2 个 analytics section（160-200 行）
- 再改 import 中心（389 行）
- 最后改 `WorkspaceContentPanels`（446 行）和 `AdminSections`（564 行）这两个最"吃 prop"的

### 5.4 重要：本阶段**只补类型不动状态**

不要试图在本阶段就把状态下沉到子组件。
状态下沉是阶段 6 的任务。
本阶段产出：13 个文件的 `XProps = { ... }` 类型定义全部写齐，无 `any`、无 `@ts-nocheck`。

### 5.5 验收门

- `git grep -n "@ts-nocheck\|: any" apps/keepwise-tauri/src/features` 完全为空
- `npm run build` 通过（含 `tsc`）
- UI 行为零变化（手动跑一遍 8 个 Tab）

---

## 阶段 6 — 前端重构补完 ② ：状态分域 + App.tsx 真正瘦身

### 6.1 目标

把 `App.tsx`（3548 行 / 192 useState）的状态按业务域下沉到 feature 子树。
最终目标：`App.tsx` < 800 行，仅做 Tab 路由 + 全局上下文 + 子树组装。

### 6.2 分域计划

按现有 `useDebouncedAutoRun` 与 setState 邻接关系，划成 9 个域：

| 域 | 状态变量前缀 | 目标位置 | 对外接口 |
|----|--------------|----------|----------|
| db-bootstrap | `dbStatus / dbBusy / dbImportPath / dbLastResult / dbImportLastResult` | `features/admin/useDbBootstrap.ts` | hook 返回 `{ status, actions }` |
| investment | `inv* / invCurve* / invBatch*` | `features/analytics/useInvestmentAnalysis.ts` | hook |
| wealth | `wealth*` | `features/analytics/useWealthAnalysis.ts` | hook |
| budget-fire | `budget* / fireProgress*` | `features/budget/useBudgetFire.ts` | hook |
| income | `salaryIncome*` | `features/income/useSalaryIncome.ts` | hook |
| consumption | `consumption*` | `features/consumption/useConsumption.ts` | 已有 `useAsyncQuery` 包装，整理即可 |
| import-center | `yzxy* / eml* / cmbPdf* / importJobs*` | `features/import/useImportCenter.ts` | hook，含 3 类导入子状态 |
| manual-entry | `quickManualInv* / quickManualAsset* / invEdit* / updateInv*` | `features/manual-entry/useManualEntry.ts` | hook |
| admin | `adminDbStats* / adminReset* / runtimeHealth* / smoke* / pipeline*` | `features/admin/useAdminConsole.ts` | hook |
| sync | `sync*` | `features/sync/useSyncManagement.ts` | hook（新建 `features/sync/` 目录） |
| query-workbench | `metaAccounts* / txList* / invList* / assetList* / acctCatalog*` | `features/admin/useQueryWorkbench.ts` | hook |
| ui-shell | `appSettings / activeTab / sidebarCollapsed / settingsOpen / showRawJson / viewportSize` | 留在 `App.tsx`（这是 shell 责任） | — |

### 6.3 重构模板（每个 hook）

```typescript
// features/<domain>/use<Domain>.ts
export function useInvestmentAnalysis() {
  const single = useAsyncQuery(queryInvestmentReturn, { account_id: "__portfolio__", preset: "ytd" }, toErrorMessage);
  const batch  = useAsyncQuery(queryInvestmentReturns,  { preset: "ytd" }, toErrorMessage);
  const curve  = useAsyncQuery(queryInvestmentCurve,    { account_id: "__portfolio__", preset: "ytd" }, toErrorMessage);

  const sharedQuery = single.query; // 三者共享 account_id/preset/from/to
  const setSharedQuery = useCallback(/* ... */, []);

  return { single, batch, curve, sharedQuery, setSharedQuery };
}
```

### 6.4 落地步骤

#### 6.4.1 先扩展 `useAsyncQuery`
当前 `hooks/useAsyncQuery.ts`（51 行）只有最基础的 `{ busy, error, result, run }`。
扩展为：
```typescript
type AsyncQueryState<TReq, TRes> = {
  busy: boolean;
  error: string;
  result: TRes | null;
  query: TReq;
  setQuery: Dispatch<SetStateAction<TReq>>;
  run: (override?: TReq) => Promise<TRes | null>;
  lastRunAt: number | null;
};
```

#### 6.4.2 按"由叶到根"顺序迁移
每次只迁一个域：把 `App.tsx` 中该域的 useState 和 handler 整体剪到 hook 文件，
然后在使用该域状态的子组件位置改用 `const x = useDomain()`。

推荐顺序：
1. consumption（已用 `useAsyncQuery`，最容易完成）
2. income
3. budget-fire
4. wealth
5. investment
6. import-center
7. admin
8. manual-entry
9. sync
10. query-workbench
11. db-bootstrap

#### 6.4.3 跨域联动的处理
现有 `runYzxyImportRequest` 完成后会 `void handle*Query()` 触发 7-8 个其它域的刷新。
迁移后这种"跨域副作用"应改为：
- 通过简单的全局事件总线（自建 1 个 `tinyEventBus`，~30 行实现），或
- 在 `App.tsx` shell 层订阅每个域的 `lastSuccessAt`，按需联动

阶段 6 内**不要新建 Context/Redux/Zustand**。约定：仍用 hook + props 直传 + 极简事件总线。

### 6.5 CSS 不动

阶段 6 **不**改 `App.css`。CSS 模块化放阶段 9。

### 6.6 验收门

- `apps/keepwise-tauri/src/app/App.tsx` 行数 < 800
- `grep -c useState src/app/App.tsx` < 30（只剩 ui-shell 状态）
- `npm run desktop:release:check` 通过
- 所有 8 个 Tab 行为不变（手动验证 + 现有 Rust 测试）

---

## 阶段 7 — 前端 desktopApi 与响应类型对齐

### 7.1 目标

`apps/keepwise-tauri/src/lib/desktopApi.ts` 中 25+ payload 类型为 `unknown`：
```typescript
export type InvestmentReturnPayload = unknown;
export type WealthOverviewPayload = unknown;
// ... 23 more
```

让前端能在编译期捕获后端字段变更。

### 7.2 操作

#### 7.2.1 从 Rust `serde_json::json!({...})` 提取响应结构
对每个 `*_query_at_db_path` / `*_query` 返回的 `json!` 块，写出对应 TS type。
工作量预估：57 个 command 中，写返回的约 30 个；每个 type 5-30 行。

#### 7.2.2 优先级
- 高：前端有强 UI 渲染依赖的（`InvestmentReturn / WealthOverview / WealthCurve / ConsumptionReport / BudgetOverview / FireProgress / SalaryIncomeOverview`）
- 中：管理面板和导入摘要（`MetaAccounts / Investments / AssetValuations / AccountCatalog / *PreviewPayload / *ImportPayload`）
- 低：admin reset / health check 等仅 JSON 显示的

#### 7.2.3 类型校验策略
不引入 `zod` —— 保持依赖最小。
做"轻量验证"：
- `desktopApi.ts` 在 `normalizeTauriValue` 后加一层 `assertShape<T>(value, schema)` 仅在 dev mode 下校验关键字段存在
- 生产构建直接信任后端类型

#### 7.2.4 删除 `utils/value.ts` 的"防御性"读取
当前 `readString / readNumber / readArray` 是为响应 `unknown` 而生的。
类型化后，预览组件应直接 `data.summary.total_assets_cents`，不再 `readNumber(payload, "summary.total_assets_cents")`。
- 保留 `utils/value.ts` 仅做**真正不可信**的边界（如 `localStorage` 解析），其它使用点全部删除

### 7.3 验收门

- `git grep -n "= unknown;" apps/keepwise-tauri/src/lib/desktopApi.ts` 应仅剩 < 5 项（确实无前端解析需求的）
- `npm run build` 通过
- 在某个 feature 组件里故意拼错字段名（如 `data.summarry.x`），`tsc` 应报错

---

## 阶段 8 — 后端 Rust 大文件拆分 + 测试辅助提取

### 8.1 目标

5 个 >1500 行的 Rust 文件按子领域拆分；
5 个测试模块共有的 helper 提取到一个公共 `test_support` 模块。

### 8.2 拆分计划

#### 8.2.1 `investment_analytics.rs` (2617) → 模块化
拆为 `investment_analytics/` 目录：
```
investment_analytics/
  mod.rs                  # 仅 pub use & Tauri command 入口
  query_request.rs        # InvestmentReturnQueryRequest 等
  preset.rs               # parse_preset, resolve_window
  modified_dietz.rs       # ModifiedDietzCalc
  benchmark.rs            # BenchmarkSpec, eastmoney/yahoo fetch
  curve.rs                # investment_curve_query 实现
  single_account.rs       # build_single_account_*
  portfolio.rs            # build_portfolio_*
  batch.rs                # investment_returns_query (批量) 实现
```
每个文件目标 < 600 行。

#### 8.2.2 `sync_management.rs` (2175) → 模块化
拆为 `sync_management/` 目录：
```
sync_management/
  mod.rs                  # Tauri command + 类型 re-export
  config.rs               # PersistedSyncConfig, SyncAutoPolicy
  state.rs                # PersistedSyncState
  share_code.rs           # encode/decode share code (v1/v2)
  snapshot.rs             # SnapshotPlainBundle 序列化/反序列化
  s3.rs                   # S3 签名 + retry
  reconcile.rs            # reconcile/conflict 逻辑
  crypto.rs               # argon2/chacha20poly1305 包装
```

#### 8.2.3 `budget_fire_analytics.rs` (2052) → 4 个独立 feature 模块
拆为 `budget_fire_analytics/` 目录：
```
budget_fire_analytics/
  mod.rs                  # command 入口
  monthly_items.rs        # query/upsert/delete monthly_budget_item
  budget_overview.rs      # query_budget_overview / monthly_review
  salary_income.rs        # query_salary_income_overview
  consumption_report.rs   # query_consumption_report
  fire_progress.rs        # query_fire_progress
```

#### 8.2.4 `cmb_bank_pdf_import.rs` (1902) → `cmb_bank_pdf_import/` 目录
```
cmb_bank_pdf_import/
  mod.rs                  # cmb_bank_pdf_preview/import command
  parser.rs               # PDF 文本提取 + 结构化
  classifier.rs           # 商户 / 类别归类
  whitelist.rs            # bank_transfer_whitelist 应用
  ingest.rs               # 写入 transactions 表
```

#### 8.2.5 `cmb_eml_import.rs` (1617) → `cmb_eml_import/` 目录
```
cmb_eml_import/
  mod.rs
  parser.rs               # mail/HTML 解析
  merchant.rs             # 商户提取 + 短名修复
  ingest.rs
```

### 8.3 测试辅助提取

新建 `apps/keepwise-tauri/src-tauri/src/test_support.rs`（仅 `#[cfg(test)]` 公开）：
```rust
#[cfg(test)]
pub(crate) mod test_support {
    use std::path::PathBuf;
    use rusqlite::Connection;

    pub fn create_temp_test_db() -> PathBuf { /* 来自现有 5 处重复实现 */ }
    pub fn apply_all_migrations_for_test(db_path: &Path) -> Result<(), String> { /* 同上 */ }
    pub fn repo_root() -> PathBuf { PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..") }
    pub fn approx_eq(a: f64, b: f64, eps: f64) -> bool { (a - b).abs() < eps }
}
```
然后把 `cmb_eml_import.rs / cmb_bank_pdf_import.rs / yzxy_import.rs / investment_analytics.rs / wealth_analytics.rs` 5 处重复 helper 替换为 `use crate::test_support::test_support::*;`。

### 8.4 验收门

- 所有原有 14 个 Rust 单元测试**仍存在且全绿**（不要趁机删/合并测试）
- `npm run test:rust:regression` 通过
- `npm run test:diff:core` 通过（阶段 3 后改为 baseline diff）
- 拆分后无任何文件超过 700 行（main entry mod.rs 除外，但也应 < 300）

### 8.5 注意

- 不要改任何 `pub fn` 的签名 / 名字 / 模块路径，因为：
  - `lib.rs` 中 `pub use` 列表与 `bin/kw_migration_adapter.rs` 都依赖现有 path
  - 前端 invoke 名字必须保持一致
- 拆分时一律用 `mod` 内嵌 + `pub use` re-export，让外部 import 路径不变

---

## 阶段 9 — 错误类型 / 响应类型 / 工程化收尾

### 9.1 错误类型

#### 9.1.1 引入 `thiserror`
当前全栈用 `Result<Value, String>`，错误信息中文字符串硬编码。
引入：
```toml
# Cargo.toml
thiserror = "1"
```
新建 `apps/keepwise-tauri/src-tauri/src/error.rs`：
```rust
#[derive(thiserror::Error, Debug, Serialize)]
#[serde(tag = "kind")]
pub enum KwError {
    #[error("数据库不存在: {0}")]
    DbMissing(String),
    #[error("参数缺失: {0}")]
    BadRequest(String),
    #[error("解析失败: {0}")]
    Parse(String),
    #[error("IO 错误: {0}")]
    Io(String),
    #[error("外部服务错误: {0}")]
    ExternalService(String),
    #[error("内部错误: {0}")]
    Internal(String),
}
pub type KwResult<T> = Result<T, KwError>;
```

#### 9.1.2 渐进迁移
每个 Tauri command 改为 `Result<TPayload, KwError>`，前端从 string 改为 `{ kind, message }` 解析。
**这是高影响动作，单独一个 PR**，且必须随阶段 7 的响应类型一起做（前端两侧同步）。

#### 9.1.3 范围控制
若工作量过大，本计划允许将 9.1 缩小为：仅顶层 Tauri command 包装一层 `KwError`，内部仍用 `String`。

### 9.2 CSS 模块化

`App.css` 3856 行单文件。
按已识别的 26 个分区，拆为：
```
src/
  styles/
    base/                  # variables / reset / scrollbars
    components/            # buttons, modals, status pills
    charts/                # line-area, sparkline, stacked-wealth
    layout/                # workspace, sidebar
  features/<domain>/styles.css   # 域级样式
```
然后 `main.tsx` 中 `import "./styles/index.css"`，每个 feature 自己 import 自己的 styles.css。

**或者**：每个 feature `.tsx` 旁同名 `.module.css`，自动 hash 命名空间。
推荐后者（与现有 BEM 风格命名兼容性好），但要求每个组件改一次 className。

### 9.3 ESLint / Prettier / Biome

`AGENTS.md` 标注 "No ESLint/Prettier/Biome configured. Linting relies on `tsc --strict` only."
长期看是负债。本阶段引入 **Biome**（一个二进制覆盖 lint+format，启动快，与 TS 19 兼容）：
```bash
npm i -D --save-exact @biomejs/biome@latest
npx biome init
```
配置仅启用：
- `noUnusedImports`
- `noExplicitAny`（强制阶段 5 的成果不被回退）
- `useConst`
- `noDoubleEquals`
- 风格规则全 disabled（避免一次大规模 reformat）

### 9.4 GitHub Actions 简化

阶段 3 已去 Python；阶段 9 进一步合并 workflow：
- `tauri-desktop-check.yml`：保留（PR 主门）
- `tauri-desktop-release-candidate.yml`：保留
- `tauri-desktop-release-signed-macos-template.yml`：模板未启用，加 `# DRAFT — not wired` 注释或 `if: false` 守卫
- `tauri-android-internal-build.yml`：检查现状，与 README 中 Android 状态对齐

### 9.5 验收门

- `npm run desktop:release:check` 通过
- `npx biome check src` 通过
- `git grep -n "Result<Value, String>" apps/keepwise-tauri/src-tauri/src` 数量从全量降到仅 `*_at_db_path` 内部 helper（顶层 command 必须用 KwError）

---

## 附录 A — 不在本计划范围的事

显式排除，避免范围蔓延：

- **不**做 Android / iOS 相关重构（README 自述 Android 是"内部测试包"阶段，iOS 暂缓）
- **不**重写图表（d3-sankey + 自实现 SVG 已稳定）
- **不**重写云同步加密协议（`sync_management.rs` 已落地 ChaCha20Poly1305 / Argon2，且已有用户使用）
- **不**做产品功能改动（CEO_REQ.md 的"规划中"由产品流程驱动）
- **不**做性能优化（除非阶段 6 的状态分域顺带得到）
- **不**引入 Redux / Zustand / Jotai / React Query
- **不**引入 zod / typia / 任何 runtime 类型校验库
- **不**引入 specta（Rust→TS 类型生成）—— 工作量过大，见阶段 7 用手写类型方式

## 附录 B — 阶段对照执行卡

供 codex 复制使用的最小化任务卡（每行一个独立 PR）：

```
P1-1   rm -r apps/keepwise-legacy
P1-2   rm -r tests/contracts
P1-3   rm features/manual-entry features/investment (空目录) + rm url + .gitignore
P1-4   README.md / AGENTS.md 移除 legacy 引用

P2-1   rules seed 内嵌 (include_str!), 删 repo_root in rules_store.rs
P2-2   删除 ledger_db_import_repo_runtime 命令 (后端+前端+UI)
P2-3   测试 fixture 移入 src-tauri/tests/fixtures/
P2-4   删除整个 data/ 目录

P3-0   生成 baseline JSON 快照并提交 (在 P1-1 之前!)
P3-1   重写 diff runner 为 Rust 二进制 kw_baseline_diff
P3-2   删除 tools/migration/ Python 脚本
P3-3   去 Python 化 .github/workflows/* 与 scripts/*
P3-4   make_demo_db.py 处置 (推荐保留但移出 CI)

P4-1   重写 AGENTS.md 仓库结构 + 删 legacy 引用
P4-2   重写 docs/engineering/FRONTEND_ARCHITECTURE.md
P4-3   修订 docs/engineering/TAURI_IPC_API_PROTOCOL.md (57 → 56)
P4-4   整理 docs/engineering/ 其它文件 (HISTORICAL 标头)

P5-1..13 每个 ts-nocheck 文件类型化 (按 §5.3 顺序)

P6-1   扩展 useAsyncQuery
P6-2..12 每个域 use<Domain>.ts 抽取 (按 §6.4.2 顺序)
P6-13  极简事件总线接管跨域联动

P7-1   高优先级 payload 类型化 (7 个核心)
P7-2   中优先级 payload 类型化 (其它)
P7-3   删除 utils/value.ts 在 feature 中的使用

P8-1   investment_analytics 拆分
P8-2   sync_management 拆分
P8-3   budget_fire_analytics 拆分
P8-4   cmb_bank_pdf_import 拆分
P8-5   cmb_eml_import 拆分
P8-6   test_support 提取

P9-1   引入 thiserror + KwError, command 顶层包装
P9-2   CSS 模块化 (推荐 .module.css 跟随组件)
P9-3   引入 Biome (最小规则集)
P9-4   workflow 标注与对齐
```

## 附录 C — 全程业务回归清单

每个阶段的"验收门"中"UI 行为不变"必须覆盖以下 8 条手测路径，
对应 `docs/engineering/TAURI_DESKTOP_USER_REGRESSION_CHECKLIST.md`：

1. 启动 → 无 DB 提示 → 触发首次 migrate → 主面板可见
2. 导入 YZXY xlsx → 投资曲线刷新 → 财富总览刷新
3. 导入 CMB EML 目录 → 消费分析刷新 → 月度复盘刷新
4. 导入 CMB PDF → 消费分析刷新 → 收入分析刷新
5. 快捷录入投资快照 → 投资收益 + 财富总览 双联动
6. 编辑 / 删除一条投资记录 → 收益曲线一致性
7. 切换隐私遮罩 → 全 8 个 Tab 金额脱敏
8. 切换涨跌配色 → 收益曲线 / 财富 sankey 颜色翻转

---

## 附录 D — 计划生成所基于的现状证据

```
- App.tsx 行数: 3548 行
- App.css 行数: 3856 行
- App.tsx useState 计数: 192
- 后端 Rust 总行数: 17512 行（19 文件）
- 5 个 >1500 行 Rust 文件: investment_analytics(2617) / sync_management(2175) / budget_fire_analytics(2052) / cmb_bank_pdf_import(1902) / cmb_eml_import(1617)
- Tauri command 总数: 57 (lib.rs invoke_handler!)
- desktopApi.ts 标 unknown 的 payload 类型: ~25
- ts-nocheck 文件数: 13
- Python 在 CI 中的引用: 3 个 workflow + 5 个 shell 脚本 + 1 个 npm script
- 仓库根残留: url, .DS_Store
- 已废弃但仍存在: apps/keepwise-legacy/ (16 Python 文件), tests/contracts/, data/work/, data/input/, data/output/, features/manual-entry/, features/investment/
- 文档漂移: AGENTS.md / FRONTEND_ARCHITECTURE.md 引用"App.tsx ~10K 行 单文件"
```

---

> 本文件由 Claude 于 2026-05-08 基于代码考古生成。
> 后续由 codex 执行；执行过程中若发现现状已变（例如有人提前清理了 legacy），按"附录 B 对照执行卡"略过对应 PR 即可。
