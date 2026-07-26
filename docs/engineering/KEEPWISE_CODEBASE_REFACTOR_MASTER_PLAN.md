# KeepWise 全代码库渐进式重构方案与 Agent 执行计划

> 状态：Wave 0–5 已全部完成（2026-07-16）；最终度量、验证结果与兼容保留项见 `KEEPWISE_CODEBASE_REFACTOR_COMPLETION_REPORT.md`
> 代码快照：2026-07-10 当前工作树
> 适用范围：`apps/keepwise-tauri` React/TypeScript 前端、Rust/Tauri 后端及其测试和工程文档
> 核心目标：在不改变可见功能、财务口径、数据格式和同步兼容性的前提下，提高可读性、模块内聚性、类型安全和可测试性，并减少重复代码。

本文档是给后续 agent 的可执行交接文档。`REFACTOR_CLEANUP_PLAN_2026.md` 记录了此前的仓库清理工作，其中多个仓库清理阶段已经落地，部分现状数据和待办已经过期；后续结构重构以本文为准，不应机械重做旧计划。

---

## 1. 结论先行

本次不建议更换技术栈，也不建议做一次性“大重写”。当前产品功能、Rust 回归和 SQLite 数据模型已经有较好的稳定基础，主要问题集中在边界不清和编排代码膨胀，而不是技术选型错误。

推荐的重构主线是：

1. 先把当前红色差分基线处理清楚，取得可信的全绿起点。
2. 用测试和 IPC 契约锁住现有行为，不允许通过盲目更新 baseline 掩盖差异。
3. 把前端 IPC 从单文件和宽松响应类型改为按业务域组织的精确契约。
4. 把业务状态和操作从 `App.tsx` 下沉到各业务页面/controller，让应用根组件只负责装配。
5. 把 Rust 大文件按真实职责拆开，保持 Tauri command 名称、JSON 字段和错误文本兼容。
6. 等组件边界稳定后再机械拆分 CSS，最后做死代码、兼容层和构建体积清理。

整个计划分为 6 个 Wave、26 个可独立领取的执行卡。每个卡片都必须独立可回退、可验证、可发布；严禁跨多个业务域同时重写。

---

## 2. 分析范围与当前基线

### 2.1 分析过的主要对象

- 前端入口、应用编排、全部 feature、hooks、类型、Tauri API wrapper 和全局 CSS。
- Rust 全部 command 注册、分析查询、导入器、同步、导出、规则、数据库和测试辅助。
- `package.json`、`Cargo.toml`、TypeScript 严格配置、CI workflow、发布校验脚本。
- 现有重构计划、前端架构文档、IPC 文档、迁移 SQL 和回归 baseline。

### 2.2 当前工作树不是干净基线

分析开始前已经存在 8 个用户修改文件，合计约 `+853/-56`，主要是分析导出、AI 调用、设置和相应 IPC 接入：

- `src-tauri/src/analysis_export.rs`
- `src-tauri/src/lib.rs`
- `src/app/App.tsx`
- `src/app/helpers.ts`
- `src/features/export/AnalysisExportSection.tsx`
- `src/features/modals/AppSettingsModal.tsx`
- `src/lib/desktopApi.ts`
- `src/types/app.ts`

这些修改不属于本次计划文档，不得被后续 agent 丢弃、覆盖或擅自回滚。正式开始 RF-000 前，应由当前所有者先提交、拆分或明确处置这些变更。重构 agent 不得用 `git reset --hard`、`git checkout --` 或 stash 后遗忘的方式“清理”工作树。

### 2.3 实测验证结果

在上述当前工作树上执行了验证：

| 验证项 | 结果 | 备注 |
|---|---|---|
| `npm run build` | 通过 | Vite 提示主 JS chunk 714.71 kB，gzip 201.31 kB，超过 500 kB warning 阈值 |
| `cargo check` | 通过 | 当前 Rust 代码可编译 |
| `cargo test` | 通过 | 43 个测试：42 passed，1 ignored |
| 精选 Rust regression | 通过 | 7 个步骤全部通过 |
| 核心 analytics baseline diff | 失败 | 25 cases 中 22 pass / 3 fail，2 个 cross-check skipped |
| `npm run desktop:release:check` | 失败 | 在 core diff 阶段提前停止 |

失败的 3 个 case 是：

- `inv_curve_single_1y`
- `inv_curve_single_custom`
- `inv_curve_portfolio_ytd`

三者都与当前投资曲线输出中的 `payload.rows[*].transfer_details` 和冻结 baseline 不一致有关。当前代码还包含专门验证该字段的 Rust 测试，因此不能简单判断为“代码错误”或“baseline 旧了”。这是重构开始前必须由 RF-000 明确解决的契约决策。

---

## 3. 当前代码库诊断

### 3.1 前端：根组件仍是全局控制器

`src/app/App.tsx` 当前 3,569 行，包含 192 次 `useState` 和约 80 个顶层 handler。它同时负责：

- 应用启动、数据库、导入、管理探针和验证流水线；
- 投资、财富、预算、收入、消费、账户和记录查询；
- 手工录入、编辑、删除及多个弹窗；
- 设置、隐私、移动端导航、侧栏快捷指标；
- 同步状态、自动同步、冲突处理后的跨域刷新；
- 页面装配和大量展示派生值。

这导致任何局部功能都可能触碰 `App.tsx`，增加合并冲突和无意回归概率。已经抽出的 Section 多数只是“展示文件搬家”，状态和业务动作仍留在根组件。

### 3.2 前端：组件边界看似拆分，类型和依赖仍未真正隔离

当前没有遗留的 `@ts-nocheck`，这是旧计划已经过期的一项。但仍有 13 个 feature 文件使用以下模式：

```typescript
type SomeProps = Record<string, unknown>;

export function SomeComponent(props: SomeProps) {
  const { /* 大量字段 */ } = props as Record<string, any>;
}
```

代表性问题：

- `AdminSections` 解构约 85 个 prop。
- `WorkspaceContentPanels` 解构约 83 个 prop。
- `WorkspaceSidebar` 解构约 44 个 prop。
- 多个页面把 `DateInput`、`PreviewStat`、`JsonResultCard`、图表和表格组件本身作为 prop 传递，而不是直接 import。
- `src/features` 中约有 106 次 `any`，严格 TypeScript 在这些整体断言之后无法继续保护真实组件边界。

这既是 prop drilling，也是依赖方向不清。后续不能只把 85 个 prop 换成一个巨大 `controller` 对象；正确做法是让业务页面自己拥有业务状态和 API 调用，只接收真正跨应用的少量依赖。

### 3.3 前端：IPC 契约是主要类型漏洞

`src/lib/desktopApi.ts` 当前 992 行，包含：

- 128 个导出 type；
- 76 个导出 async wrapper，覆盖当前 78 个已注册 Tauri command；
- 46 个 `= LoosePayload` 响应别名；
- 一个最终通过 `as T` 返回的通用 `invoke<T>`。

因为大量响应最终是 `Record<string, any>`，渲染层只能反复使用 `readNumber`、`readString`、`readArray`、`isRecord` 等防御性读取。当前这些读取在多个预览、导出和 summary 文件中出现数百次，使后端字段变化无法在编译期暴露，并制造了大量样板代码。

### 3.4 前端：目录按“组件形态”与“业务域”混合划分

当前同时存在：

- `features/analytics` 中的页面 Section；
- `features/records`、`features/wealth` 中的具体展示；
- `features/layout/WorkspaceContentPanels` 中的预算、收入和消费页面装配；
- `features/modals` 中由 `App.tsx` 控制的业务弹窗；
- `features/shared/UiPrimitives.tsx` 中 853 行、从输入控件到大型图表的混合 UI。

因此“修改投资收益页面”需要跨 `app`、`analytics`、`records`、`shared`、`lib` 和全局 CSS。目标结构应以产品业务域为主，通用 UI 只保存真正无业务语义的组件。

### 3.5 前端：样式和初始包体是次级问题

- `src/App.css` 为 4,567 行单文件，包含基础样式、shell、弹窗、设置、表格、图表、各业务页面和 7 个响应式区块。
- 大量 selector 在响应式覆盖中重复出现，不能简单用文本去重，否则会改变 CSS cascade。
- Vite 当前生成单个 714.71 kB 主 JS chunk。对于本地 Tauri 应用这不是首要性能故障，但它说明所有业务页面和大型图表都被入口静态加载。

CSS 必须在组件边界稳定后处理，并分成“机械搬移”和“规则清理”两个不同提交。页面 lazy-load 也应在页面变成独立边界后再做。

### 3.6 后端：文件已经按域命名，但文件内部仍混合多个层次

当前较大的 Rust 文件包括：

| 文件 | 行数 | 混合职责 |
|---|---:|---|
| `investment_analytics.rs` | 2,845 | 日期窗口、SQL、Modified Dietz、曲线插值、benchmark 网络请求、JSON、commands、tests |
| `sync_management.rs` | 2,466 | 配置、密钥、分享码、S3 签名/传输、snapshot、SQLite merge、冲突策略、commands |
| `cmb_bank_pdf_import.rs` | 2,071 | PDF 解析、分类、规则、入库、稳定 ID、commands、tests |
| `budget_fire_analytics.rs` | 2,052 | 预算 CRUD、预算分析、消费、收入、FIRE、JSON、commands、tests |
| `cmb_eml_import.rs` | 1,575 | EML/HTML 解析、分类、规则、入库、稳定 ID、commands、tests |
| `analysis_export.rs` | 1,410 | snapshot、文件写入、本地 CLI、OpenAI-compatible 多阶段流程、进程管道、commands、tests |

行数不是唯一问题。更关键的是纯计算、数据库、文件/网络 I/O、Tauri 适配和测试都在同一模块，导致局部调整必须理解整条链路。

### 3.7 后端：确有可合并的重复，但必须先证明语义相同

CMB EML 和 CMB PDF 导入器中明显重复：

- source path、review threshold 和金额解析；
- merchant normalization；
- merchant/category rules 加载与匹配；
- schema 检查、account/category upsert、transaction upsert；
- category ID 和稳定导入流程的部分逻辑。

金额格式化、rounding、日期和数据库打开也在多个分析/查询模块重复。

但不能为了“DRY”直接统一所有同名函数。导入器的交易方向、稳定 ID、重复账单处理和分类优先级属于高风险财务语义。只有在两侧 characterization test 已覆盖并证明相同行为后，才允许抽取共同实现；有细微差异的逻辑应保留域内函数，最多共享底层原语。

### 3.8 后端：响应和错误边界宽松

- 大量 command 返回 `Result<Value, String>`，响应结构由 `serde_json::json!` 临时拼装。
- 错误上下文直接被格式化为中文字符串，内部无法按类型组合，前端也无法可靠分类。
- 当前 78 个 command 全部集中注册在 `lib.rs`；集中注册本身是合理的 composition root，不需要为了减少行数发明动态注册框架。

本轮应逐域引入可序列化响应 DTO 和内部 `AppError/AppResult`，但 Tauri command 边界继续输出原有字符串错误，避免改变前端拒绝 Promise 的兼容行为。结构化错误协议属于另一个产品契约升级，不应夹在本轮重构中。

### 3.9 测试：Rust 有基础，前端和契约层不足

- Rust 当前 43 个测试，主要集中在 investment、import、analysis export 和 sync 的纯逻辑。
- 核心 analytics 有 25 cases + 2 cross-check 的冻结差分基线，这是财务口径的重要护栏。
- `test_support.rs` 已经存在，旧计划中“首次提取测试辅助”的任务已经完成，不应重复。
- `read_queries.rs`、`record_mutations.rs`、`rules_management.rs`、`ledger_db.rs` 等缺少同模块测试，部分风险只被间接覆盖。
- 前端当前没有 `*.test.ts(x)` 或 `*.spec.ts(x)`，request builder、金额隐私、selector、Markdown 导出和业务 controller 没有自动回归。
- UI 仍主要依赖 TypeScript build 和人工桌面回归，无法保护状态下沉过程中的 loading/error/auto-refresh 行为。

### 3.10 文档已经漂移

- `FRONTEND_ARCHITECTURE.md` 仍声称需要删除 `@ts-nocheck`，但当前已不存在。
- `TAURI_IPC_API_PROTOCOL.md` 记录 69 个 command，当前工作树实际注册 78 个。
- `AGENTS.md` 仍写 migration `0001-0006` 和 14 个 Rust 测试，当前已经有 `0007` 且 `cargo test` 发现 43 个测试。
- 旧重构计划记录的 App.css、Rust 大文件和 payload 数量也已变化。

文档不应在每个机械移动提交中频繁大改，但每个 Wave 结束必须同步架构和命令清单。

---

## 4. 重构边界与不变量

### 4.1 必须保持不变

除非用户单独批准契约升级，下列内容在本轮全部视为冻结：

- 现有用户可见功能、中文文案、交互入口和金额隐私行为。
- 78 个现有 Tauri command 名称、参数命名兼容和 JSON 字段名。
- 财务计算口径、rounding、时间窗口、过滤逻辑和排序逻辑。
- SQLite migration 历史、现有数据库路径和老数据库可迁移性。
- 导入 transaction ID、import job 语义、跨账单去重和重复导入幂等性。
- 本地设置 storage key 和已保存设置的解析兼容。
- 同步 share code v1/v2、snapshot/manifest 版本、加密参数、远端 object key 和冲突行为。
- 分析导出文件格式及已有 CLI/OpenAI-compatible 调用行为。
- 桌面和移动端现有入口、横竖屏布局与返回导航。

### 4.2 明确不做

- 不改成 Web 服务、Electron 或其他桌面框架。
- 不引入 Redux/Zustand、React Router、ORM、CSS-in-JS 或新的 UI 组件库。
- 不借重构调整产品视觉、财务口径或数据模型。
- 不一次性替换所有 `serde_json::Value`、所有错误字符串或所有 CSS class。
- 不为了追求文件行数引入一层只有转发作用的 service/repository/interface。
- 不把后端 Rust 和前端 TypeScript 同一业务域的大改塞入一个无法审查的超大提交。
- 不自动更新 analytics baseline；任何 baseline 改动都必须解释字段差异和业务依据。

### 4.3 设计原则

1. **行为先锁定，结构后迁移。** 先添加 characterization test，再移动代码。
2. **边界精确，内部简单。** IPC 和组件 props 必须精确；模块内部不为“架构感”制造样板。
3. **业务垂直切片。** 一个功能的页面、controller、selector 和局部类型尽量在同一业务域。
4. **跨域状态最小化。** 只有设置/隐私、运行时同步和数据失效通知可以成为应用级状态。
5. **命令适配薄。** Tauri command 只负责解析 app/path/state、调用域函数和映射兼容错误。
6. **纯逻辑优先。** 计算、解析和分类函数尽量与文件、网络、Tauri 和数据库连接解耦。
7. **一次只改变一个维度。** 移文件时不优化逻辑，类型化时不改 UI，拆 CSS 时不改 selector。

---

## 5. 目标前端架构

### 5.1 建议目录

```text
src/
  app/
    App.tsx                     # 仅装配 providers、shell、当前页面和全局 modal
    AppProviders.tsx            # 仅真正跨域的 Context
    navigation.ts               # tab/mobile 路由元数据
    useAppRuntime.ts            # bootstrap、DB ready、viewport 等应用运行态
  api/
    desktop/
      invoke.ts                 # normalize + 唯一 tauri invoke 入口
      system.ts                 # system / DB / admin commands
      accounts.ts               # account / records commands
      investment.ts
      wealth.ts
      budget.ts
      income.ts
      consumption.ts
      imports.ts
      rules.ts
      sync.ts
      export.ts
      contracts/
        <domain>.ts             # 精确 request/response type
      index.ts                  # 迁移期兼容 barrel；最终可删除
  features/
    accounts/
      AccountsPage.tsx
      ManualInvestmentModal.tsx
      ManualAssetValuationModal.tsx
      useAccountsController.ts
      selectors.ts
    investment/
      InvestmentPage.tsx
      InvestmentCurve.tsx
      useInvestmentController.ts
      selectors.ts
    wealth/
    budget/
    income/
    consumption/
    imports/
    export/
    rules/
    sync/
    admin/
  shared/
    hooks/                       # useAsyncQuery/useAsyncAction 等无业务语义 hooks
    ui/                          # Input/Modal/Table/Chart 等真正通用组件
    format/                      # 金额、百分比、日期展示
    utils/                       # 小型、无业务语义纯函数
  styles/
    index.css                    # 唯一总入口，显式维持 cascade 顺序
    tokens.css
    base.css
    shell.css
    controls.css
    tables.css
    charts.css
    modals.css
    features/<domain>.css
    responsive.css
```

目录名可以在执行时小幅调整，但依赖方向必须保持：

```text
app -> features -> api/shared
api -> contracts
shared -X-> features
feature A -X-> feature B 的内部文件
```

跨 feature 需要复用的数据请求，应调用 `api/desktop/<domain>`；跨 feature 需要复用的业务类型，应放到对应 API contract 或明确的共享 domain type，而不是互相深层 import。

### 5.2 App 的最终职责

最终 `App.tsx` 只负责：

- 安装 settings/privacy、runtime、sync/invalidation provider；
- 保存 active tab、mobile view、sidebar/modal 等 shell 状态；
- 渲染 sidebar/mobile header、当前业务 Page 和全局设置入口；
- 处理真正的应用生命周期事件。

目标指标不是硬性代码高尔夫，但建议：

- `App.tsx` 不超过约 500 行；
- 根组件 `useState` 不超过约 15 个；
- 不再包含业务 SQL request builder、CRUD handler、业务表单或业务图表派生逻辑；
- 业务 Page 通常只接收 `isActive` 或少量跨域值，不接收几十个字段。

### 5.3 状态模型

不引入全局状态库。按以下规则分配状态：

- 输入、query、result、busy、error、modal：由对应 feature controller 持有。
- settings/privacy：`AppSettingsContext`，保持现有 localStorage 格式兼容。
- sync runtime：独立 `SyncRuntimeContext`，因为 sidebar、设置和 app lifecycle 都需要。
- 数据变更通知：极小的 `DataInvalidationContext`，只暴露按 key 增加 epoch 的 `invalidate(keys)`；例如 `ledger`、`accounts`、`rules`。
- sidebar quick metrics：单独的 `useSidebarMetrics`，不能依赖某个未挂载页面的局部 state。

数据失效机制必须先用测试描述当前自动刷新时机。不得让每个 mutation 无差别刷新全部页面，也不得通过匿名全局 event bus 隐藏依赖。

### 5.4 共享 hooks

建议形成两个明确原语：

- `useAsyncQuery<TReq, TRes>`：query、result、busy、error、lastRunAt，以及显式的并发请求策略。
- `useAsyncAction<TReq, TRes>`：一次性 mutation，不保存 query，支持成功后的精确 invalidation。

现有 `useAsyncQuery` 可渐进扩展，但必须先复现各域当前的并发行为；“忽略旧请求结果”只能作为显式 opt-in 策略，并在单独测试证明兼容后落地。不要用一个高度可配置的万能 hook 覆盖 import pipeline、文件选择、流式 CLI 等差异很大的流程。

### 5.5 IPC 类型策略

主路线采用“精确手写 TypeScript contract + Rust serialization snapshot/fixture test”。原因是当前 Rust 响应仍大量由动态 JSON 构建，直接同时引入类型生成框架会把契约重构、命令 wiring 和依赖升级绑定在一起。

在首批 5 个代表性 DTO 完成后，可以做一个不进入主分支的 ADR spike，评估 `ts-rs` 或 `specta/tauri-specta`。只有满足以下条件才建议转为生成类型：

- 能无损表达现有 snake_case、optional/null 和嵌套动态字段；
- 不要求改 78 个 command 的调用协议；
- 不影响 desktop/mobile 构建；
- 生成文件稳定、可审查，且确实减少维护量。

在此决策前，后续任务不得各自引入不同的 runtime schema/type generator。

---

## 6. 目标 Rust 架构

### 6.1 建议目录

保持结构直接，不增加一个笼统的 `services/` 层：

```text
src-tauri/src/
  lib.rs                         # plugin + command composition root
  commands.rs                    # system metadata only
  db/
    mod.rs                       # path/connection/public helpers
    migrations.rs
    admin.rs
  investment/
    mod.rs                       # public re-export
    commands.rs
    dto.rs
    window.rs
    returns.rs
    curve.rs
    benchmark.rs
    repository.rs
  wealth/
    mod.rs
    commands.rs
    dto.rs
    overview.rs
    curve.rs
  budget/
    mod.rs
    items.rs
    overview.rs
  income/
  consumption/
  fire/
  imports/
    mod.rs
    common/
      rules.rs
      persistence.rs
      validation.rs
    yzxy/
    cmb_eml/
      parser.rs
      classifier.rs
      service.rs
      commands.rs
    cmb_pdf/
      parser.rs
      classifier.rs
      mortgage.rs
      service.rs
      commands.rs
  accounts/
  rules/
  sync/
    model.rs
    config_store.rs
    crypto.rs
    share_code.rs
    s3.rs
    snapshot.rs
    merge.rs
    reconcile.rs
    commands.rs
  analysis_export/
    snapshot.rs
    file.rs
    local_cli.rs
    openai_compatible.rs
    commands.rs
  error.rs
  test_support.rs
```

这是一张职责地图，不要求第一批就创建全部目录。只有文件被实际拆分时才创建对应模块。

### 6.2 command、域逻辑和 I/O 的边界

每个 Tauri command 应尽量保持为：

1. 接收 `AppHandle`/request；
2. 解析 app-local 路径或 state；
3. 调用可测试的域函数；
4. 把内部错误映射回兼容的中文字符串。

域函数不依赖 Tauri；纯计算不直接打开数据库或发网络请求；repository/I/O 函数不负责拼 UI 友好的文本。

### 6.3 DTO 与错误

- 新增或迁移的 command 响应优先使用 `#[derive(Serialize)]` 的命名 DTO。
- 对确实包含动态聚合子树的 export/admin payload，可以在命名 DTO 的局部字段中保留 `Value`，不能因此让整个响应退回无名 JSON。
- 内部逐域引入 `AppError`/`AppResult<T>`，保留 error source/context。
- command 返回仍可暂时是 `Result<T, String>`，统一在边界 `.map_err(|e| e.to_string())`，确保前端错误行为不变。
- 不在本轮切换为结构化 error JSON。

### 6.4 测试位置

小型纯函数测试可继续与模块同文件。大型模块拆分后：

- 每个解析器、分类器、计算器保留就近 unit test；
- 跨模块 DB 行为放到域内 `tests.rs`；
- fixture 放在 `src-tauri/tests/fixtures/<domain>`；
- 通用临时 DB/migration helper 继续复用 `test_support.rs`；
- 不把所有测试集中迁到一个巨大的集成测试文件。

---

## 7. 分阶段开发计划

| Wave | 目标 | 执行卡 | 风险 | 并行建议 |
|---|---|---:|---|---|
| 0 | 干净且全绿的可信起点 | 3 | 阻断级 | 完全串行 |
| 1 | 前端/Rust/边界测试护栏 | 3 | 中 | 非重叠测试可并行 |
| 2 | IPC 与组件边界精确类型化 | 3 | 高 | 以业务域拆分，API barrel 单一 owner |
| 3 | 前端业务状态下沉 | 6 | 高 | feature 内可并行，`App.tsx` 单一 owner |
| 4 | Rust 共享基础与域拆分 | 7 | 最高 | 不同域有限并行，sync 串行且最后执行 |
| 5 | CSS、包体、兼容层和文档收口 | 4 | 中 | RF-050 必须先完成，之后有限并行 |

### Wave 0：取得可信、干净、全绿的起点

#### RF-000 处置当前未提交工作

范围：仓库状态，不改重构逻辑。

操作：

1. 由当前变更所有者确认 8 个既有修改文件的功能目标。
2. 将它们提交到独立功能 commit/branch，或明确继续保留；重构 agent 不代替产品所有者回滚。
3. 记录开始重构时的 commit SHA、分支、Node/Rust 版本和工作树状态。

验收：重构分支开始时 `git status --short` 为空，或仅包含经用户明确列出的非重叠文件。

#### RF-001 解决 investment curve baseline 分歧

范围：`investment_analytics.rs`、baseline runner、frozen baseline；禁止顺便拆文件。

操作：

1. 追溯 `transfer_details` 的引入意图、当前 Rust test 和消费方。
2. 若该字段是批准的向后兼容契约新增：更新冻结 baseline，保留新增字段测试，并确认 25 cases + 2 cross-check 全部 pass。
3. 若不是批准行为：修复当前输出或回退错误差异，不得只删测试。
4. 在 PR 描述逐字段说明 baseline 变化，不接受“刷新快照”式说明。

验收：

- `npm run test:diff:core` 全绿；
- `npm run desktop:release:check` 全绿；
- 3 个失败 case 和 2 个 skipped cross-check 全部恢复 pass。

停止条件：在上述决策不明确时，整个结构重构暂停。

#### RF-002 冻结兼容性清单

产出：一份机器可核对的 command/contract 清单和一份人工回归快照，不改业务行为。

至少记录：

- command 名称与数量；
- 关键请求/响应 JSON fixture；
- localStorage key 和设置默认值；
- 导入稳定 ID/幂等测试；
- sync version/prefix/object key 常量；
- desktop 与 forced-mobile 的关键页面截图；
- 主 bundle 和大文件度量，仅作趋势参考。

Wave 0 出口：干净工作树上的完整 release gate 全绿，兼容性清单可复现。

### Wave 1：补齐重构护栏

#### RF-010 建立最小前端测试环境

建议引入 Vitest，并只添加与重构直接相关的测试依赖。第一批测试覆盖：

- `requestBuilders.ts` 的空值裁剪和请求格式；
- `amountFormatting.ts` 的金额、涨跌色和隐私遮罩；
- `helpers.ts` 中日期/数字/设置兼容解析；
- `buildMarkdown.ts` 的结构、隐私和 notes；
- `useAsyncQuery` 的 success/error/busy 和并发请求行为；
- 至少一个 feature controller 的 loading/error/result 集成行为。

新增统一命令 `npm run test:frontend`，并接入 `desktop:release:check` 和 CI。不要以覆盖率百分比为目标，也不要创建脆弱的大型 DOM snapshot。

#### RF-011 增强 Rust characterization tests

优先补当前没有直接测试但重构会触碰的边界：

- `read_queries` 的排序、过滤、空结果和金额字段；
- `record_mutations` 的写入、更新、删除和关联账户；
- `rules_management` 的 CRUD 与优先级；
- `ledger_db` migration/import 的兼容行为；
- command DTO 的序列化字段名。

实时网络不进入默认 CI。benchmark、OpenAI-compatible 和 COS/S3 使用 parser/signature fixture 或可注入 transport 的 deterministic test。

#### RF-012 定义代码边界检查

先用轻量脚本/`rg` 规则，不急于引入全套 lint：

- `@tauri-apps/api/core` 的 `invoke` 只能出现在 `api/desktop/invoke.ts`；
- 新增 feature 组件禁止 `Record<string, any>` props；
- 禁止新增 `LoosePayload`；
- 禁止 feature 深层互相 import；
- 命令清单数量与协议文档不一致时 CI 提醒。

Wave 1 出口：重构所需前端测试命令进入 release gate，关键后端无测试边界已有 characterization test。

### Wave 2：IPC 契约和组件边界类型化

#### RF-020 机械拆分 desktop API

先只拆文件，不改变 wrapper 名称、参数或返回结构：

1. 创建 `api/desktop/invoke.ts` 和按域 client 文件。
2. 保留临时 `desktopApi.ts` barrel，使现有 import 继续工作。
3. 每移动一个域就运行 build 和对应测试。
4. 禁止在此卡同时重写 React state 或 Rust JSON。

建议顺序：system/db → accounts/records → investment/wealth → budget/income/consumption → imports/rules → sync/export/admin。

#### RF-021 逐域定义精确 TypeScript 响应类型

每次只处理一个业务域：

1. 从 Rust 当前序列化输出和 baseline/fixture 提取精确 type。
2. 把对应 `LoosePayload` 替换为命名类型。
3. 让 selector/preview 直接使用类型字段。
4. 删除该域不再需要的 `read*` 防御性读取。
5. 添加至少一个真实 fixture 的解析/渲染测试。

不得一次性写几十个未经消费方验证的“猜测类型”。如果字段确实动态，使用局部 `unknown` 并在单一 adapter 中收窄，而不是扩散 `any`。

#### RF-022 修复 13 个宽松组件边界

按 leaf component 到 page component 的顺序：

- 共享 UI 组件由页面直接 import，不再作为 prop 传递。
- 每个导出组件写精确 inline object prop type，遵守仓库 type/style 约定。
- 删除 `props as Record<string, any>` 和 Loose UI event，改用 React 事件类型。
- 只做类型和依赖修复，暂时不移动 state，便于审查行为等价。

先选择 `ImportCenterSections` 作为 pilot；验证模式后再处理 analytics、modals、layout 和 admin。

Wave 2 出口：

- `desktopApi.ts` 只剩短期 barrel 或已删除；
- 不再新增 `LoosePayload`；已有 loose payload 按域有明确剩余清单；
- feature 公开组件边界没有 `Record<string, any>`；
- UI primitives 不再通过 App 层层透传。

### Wave 3：前端按业务域下沉状态

每张卡都遵循同一模板：先把 handler/derived selector 搬入 `use<Domain>Controller`，再让 Page 直接使用 controller，最后从 `App.tsx` 删除相应 state。搬移时保持 API 调用次数、debounce、loading/error 文案和刷新时机不变。

#### RF-030 导入中心 pilot

范围：YZXY、CMB EML、CMB PDF、import jobs 和文件选择。

理由：业务边界清楚、已有较强 Rust 幂等测试、与侧栏指标耦合低，适合作为 controller 模式样板。

#### RF-031 预算、收入、消费和 FIRE

操作：

- 把 `WorkspaceContentPanels` 内四个业务页面拆成真实 Page。
- 每个域拥有 query/result/controller；预算 item mutation 只 invalidates budget。
- 消费分类更新明确 invalidates consumption/rules，不刷新无关投资页面。
- 删除 `WorkspaceContentPanels`，或只保留不含业务 props 的轻量 tab switch。

#### RF-032 投资和财富

操作：

- 分别建立 investment/wealth controller 和 selector。
- 保持投资 curve benchmark hydration 的 request sequence 语义。
- 把侧栏 quick metric 从页面 state 中解开，迁入 `useSidebarMetrics`。
- 现有 25-case baseline 和跨用例检查必须每个提交运行。

#### RF-033 账户、手工录入、记录和规则

操作：

- 合并当前散落在 admin/records/modals 中的账户相关组件到清晰业务域。
- 手工写入成功后通过精确 invalidation 通知 accounts/investment/wealth。
- 编辑、删除、账户重命名和资产估值必须保留现有刷新和关联更新行为。
- Rules 页面自己拥有 CRUD state，不再通过 `AdminSections` 接收几十个回调。

#### RF-034 export、settings 和 sync

前置条件：本计划生成时的 export/settings 未提交功能已经稳定合并。

操作：

- export 页面继续拥有自己的本地 state，只从 settings 读取 AI 配置和隐私默认值。
- settings 使用精确 `AppSettings` 和 sync controller，不接收松散表单对象。
- sync runtime 提升为唯一跨域 controller；reconcile 成功后发出明确 invalidation。
- 保持 share code、密码、远端状态和冲突策略协议完全不变。

#### RF-035 收口 App shell

操作：

- 建立页面 registry/switch 和真正的 App providers。
- `WorkspaceSidebar` 接收精确导航模型与 quick metrics，不接收每一个格式化字段。
- 移除 App 中已经迁走的业务 state、handler、request builder 和 selector。
- 删除过渡 controller prop bag，不得把原来的 192 个 state 只是搬到一个同样巨大的 hook。

Wave 3 出口指标：

- `App.tsx` 约 500 行以内、根 `useState` 约 15 个以内；若超出须在 PR 说明剩余职责。
- 每个业务 Page 自主拥有业务 query/mutation state。
- `AdminSections`、`WorkspaceContentPanels` 这类 80+ props 组件消失。
- 前端测试、Rust 测试、core diff、desktop release gate 全绿。

### Wave 4：Rust 共享基础和按域拆分

#### RF-040 内部错误、DTO 和 DB 基础

操作：

- 引入内部 `AppError/AppResult`，先在一个低风险域 pilot。
- 提取稳定的 DB connection/migration/test helper；不隐藏事务边界。
- 为已由前端精确消费的响应增加 Rust DTO 和 serialization test。
- command 名称、JSON 字段和外部错误字符串保持不变。

#### RF-041 拆分 budget/income/consumption/FIRE

从 `budget_fire_analytics.rs` 按四个真实领域拆出模块，共享的金额/年份解析只保留一份。先机械移动，再在独立提交中清理重复。

验收：seeded fixture 相关测试、消费 rule override、income dedupe 和 FIRE cross-check 全绿。

#### RF-042 拆分 investment/wealth

建议顺序：benchmark network/parser → window/validation → returns calculation → curve/interpolation → repository → commands。

要求：

- Modified Dietz 和 curve interpolation 保持纯函数可测。
- benchmark transport 与 payload parser 分离，默认测试不访问网络。
- 25 cases + 2 cross-check 每个子步骤全绿。
- 保持 `*_at_db_path` 或等价可测试入口供 baseline runner 使用。

#### RF-043 提取 import common 并拆三个导入器

顺序：

1. 为两类 CMB importer 的重复函数补对照测试。
2. 只抽取确定相同的 rules 读取、底层 persistence 和通用 validation。
3. 分别把 EML/PDF parser、classifier、service、commands 拆开。
4. YZXY 只复用真正相同的 DB 原语，不强行套统一 importer trait。

硬性验收：同一 fixture 的 transaction ID 不变；重复导入不增行；跨账单重复处理不变；分类 summary 不变。

#### RF-044 拆分 analysis export

前置条件：当前 AI/export 功能已完成并有测试。

拆为 snapshot、file writer、local CLI process、OpenAI-compatible client/pipeline、Tauri commands。进程 pipe event 和 HTTP transport 分别可测，默认 CI 不调用真实模型或本地 agent。

#### RF-045 拆分 sync（最后执行）

同步是后端最高风险域，必须最后拆：

1. model/config store；
2. crypto/share code；
3. S3 signing/client；
4. snapshot encode/decode；
5. SQLite merge；
6. reconcile/conflict orchestration；
7. commands。

每一步使用固定 fixture 验证旧 share code、snapshot 和签名结果。不得在结构重构中升级密码学参数、snapshot version 或对象布局。

#### RF-046 评估其余中型模块

对 rules、read queries、record mutations、ledger DB、admin health 做职责审查。只有同时承担多种职责时才拆；不以“所有文件必须小于 N 行”为目标。`lib.rs` 保持明确的 command composition root。

Wave 4 出口指标：

- 生产模块原则上不同时混合 command、网络/文件 I/O、核心计算和大型测试。
- 新迁移响应有命名 DTO；动态 `Value` 例外有文档说明。
- importer 重复逻辑减少但业务差异仍显式存在。
- sync/import/analytics 所有兼容 fixture 全绿。

### Wave 5：样式、包体和最终清理

#### RF-050 机械拆分 CSS

第一提交只按原始顺序移动规则到 `styles/*`，由 `styles/index.css` 显式 import；不改 selector、不合并 declaration、不重命名 class。

使用 Wave 0 的 desktop/mobile 截图做视觉比较，重点覆盖：sidebar、设置 modal、表格、收益/财富图表、消费页面、导入中心和移动端首页。

#### RF-051 CSS 去重与 token 收口

机械拆分全绿后再：

- 合并真正相同且不依赖 cascade 的规则；
- 收口颜色、间距、圆角和 typography token；
- 删除已不存在组件的 class；
- 保持第三方 datepicker 覆盖和 mobile media 顺序。

每个提交只处理一个样式域，禁止顺便 redesign。

#### RF-052 页面 lazy-load 与 bundle 检查

对低频且已独立的 admin、import、export、rules 等页面使用 `React.lazy`/dynamic import。确保 loading fallback 不闪烁、不破坏 Tauri 文件选择或 modal state。

目标是让入口主 chunk 低于当前 500 kB warning 阈值；这是建议目标，不得为数字牺牲可读性。

#### RF-053 删除过渡层和同步文档

清理：

- 临时 `desktopApi.ts` barrel；
- 无消费方的 `LoosePayload`、旧 request type 和 `utils/value` 读取；
- 已替代的 section/layout 文件；
- 未使用 CSS 和过期注释；
- 旧 command 数量和架构说明。

更新至少：

- `AGENTS.md` repository layout（如结构已改变）；
- `FRONTEND_ARCHITECTURE.md`；
- `TAURI_IPC_API_PROTOCOL.md`；
- 本文档的完成状态和偏差说明。

Wave 5 出口：完整 release gate、全量 Rust、前端测试、desktop/mobile 人工清单全部通过，无未解释兼容层。

---

## 8. 每张执行卡的标准工作流

后续 agent 领取任意 RF 卡时必须执行：

### 8.1 Preflight

1. 完整阅读本文、仓库根 `AGENTS.md` 和涉及域的现有测试。
2. `git status --short`；发现未知或重叠修改立即停止，不覆盖用户工作。
3. 记录当前 commit SHA。
4. 运行该域相关测试；Wave 0 完成后，开始卡片前 `desktop:release:check` 必须全绿。
5. 明确本卡的冻结行为、允许文件和回退点。

### 8.2 实现

- 先测试后移动；先机械移动后清理。
- 一张卡只处理一个业务域或一个基础设施边界。
- 尽量控制在可单独审查的 commit；纯文件移动与逻辑修改分开。
- 保留中文 UI 和错误字符串。
- 发现真实业务 bug 时先记录，不夹带修复；另开任务取得授权。

### 8.3 验证

至少执行：

```bash
cd apps/keepwise-tauri
npm run test:frontend       # RF-010 落地后
npm run build
npm run test:rust
npm run test:diff:core
npm run desktop:release:check
```

另外执行域专项测试和必要的 desktop/mobile 人工回归。最后运行 `git diff --check`，确认没有意外格式化或无关变更。

### 8.4 交接说明模板

```text
Task: RF-0xx
Baseline commit:
Changed files:
Behavioral invariants checked:
Tests run and results:
Known exceptions / remaining loose types:
Manual checks:
Rollback commit:
Recommended next task:
```

不得只写“重构完成、测试通过”；必须给出具体命令和结果。

---

## 9. Agent 并行与热点文件规则

### 9.1 不可并行的热点

以下文件/入口同一时间只能有一个 integration owner：

- `src/app/App.tsx`
- `src/lib/desktopApi.ts` 及迁移后的 API barrel
- `src/App.css` / `styles/index.css`
- `src-tauri/src/lib.rs`
- `package.json` / `Cargo.toml`
- analytics frozen baseline

其他 agent 可以在独立 feature/Rust domain 中工作，但不要同时修改这些 composition root。由 integration owner 在域提交合并后做最小注册变更。

### 9.2 可以在契约稳定后并行的工作

- 不同前端 feature 的精确类型和 leaf component。
- 不同 Rust domain 的 characterization tests。
- 前端某域 controller 与不重叠的后端另一域模块拆分。
- 文档盘点与不修改 command 的测试补齐。

### 9.3 必须串行的依赖

```text
RF-000 -> RF-001 -> RF-002
RF-010/011/012 -> RF-020 -> RF-021 -> RF-022
RF-022 -> RF-030..035
RF-021/011 -> RF-040 -> RF-041..046
RF-035 -> RF-050 -> RF-051/052 -> RF-053
```

sync 和 CSS 无论 agent 数量多少都不应提前并行执行。

---

## 10. 风险清单与控制措施

| 风险 | 后果 | 控制措施 |
|---|---|---|
| 盲目刷新 baseline | 把真实财务回归伪装成通过 | baseline 变更逐字段解释；25 cases 与 cross-check 同时通过 |
| IPC JSON 字段漂移 | UI 静默显示空值或旧客户端失效 | 精确 TS type、Rust serialization fixture、command 名冻结 |
| state 下沉改变自动刷新 | 页面数据陈旧、重复请求或竞态覆盖 | controller 测试、latest-request 测试、精确 invalidation |
| 导入公共化过度 | transaction ID、分类或幂等改变 | 先对照测试，只共享已证明相同的底层原语 |
| 财务计算拆分 | rounding、日期边界和组合收益改变 | core diff 每个子提交运行，纯函数 fixture 固定 |
| sync 拆分 | 旧设备无法解密/合并，远端数据损坏 | sync 最后做；固定 share/snapshot fixture；不升级协议 |
| CSS 移动改变 cascade | 桌面/移动视觉回归 | 保持原顺序机械拆分；截图比较；清理另开提交 |
| 多 agent 同改根文件 | 合并冲突和逻辑丢失 | composition root 单一 owner；域提交后最小集成 |
| 超大 rename + rewrite | 无法审查、难回滚 | rename/move 与逻辑修改分 commit |
| 依赖生成框架实验扩散 | 构建和移动端风险上升 | 类型生成只做 ADR spike，未经决策不得进入主线 |

---

## 11. 业务回归矩阵

每个 Wave 至少按受影响范围执行；最终 Wave 全量执行。

### 11.1 启动与数据库

- 新安装首次启动、embedded migration、已有 DB 升级。
- DB status、手工 migrate、path import、admin stats/reset 确认保护。
- 数据库路径、rules seed 和本地目录不变。

### 11.2 导入

- YZXY CSV/XLSX preview + import。
- CMB EML 单文件/文件夹 preview + import。
- CMB PDF preview + import、房贷和中文商户分类。
- 同一输入执行两次不产生重复交易。
- 重叠账单、稳定 transaction ID、import job summary 不变。

### 11.3 手工记录与账户

- 新增投资记录、资产/负债估值。
- 编辑/删除投资记录。
- 账户创建、重命名、删除保护和关联展示名更新。
- 写入后投资、财富和侧栏指标按当前时机刷新。

### 11.4 分析

- 单账户/组合收益，YTD/custom 等窗口。
- 投资曲线、transfer details、benchmark hydration/retry。
- 财富总览、曲线、资产过滤、负债和历史 as-of。
- 预算 items、年度预算、月度复盘、收入、消费、FIRE。
- 金额格式、隐私遮罩和涨跌颜色设置。

### 11.5 规则与复核

- merchant/category/whitelist/exclusion CRUD。
- 消费商户分类覆盖和 needs-review 确认。
- 规则更新后相关页面刷新，非相关页面不重复请求。

### 11.6 导出与 AI

- snapshot、Markdown、notes、隐私隐藏、写文件。
- local CLI 列表/运行/超时/进度管道。
- OpenAI-compatible endpoint normalization、单阶段/多阶段结果。
- 默认 CI 使用 deterministic test；真实 CLI/API 只在明确配置的人工环境验证。

### 11.7 同步

- 新建/链接 workspace、share code v1/v2、错误密码。
- connection test、status、poll、reconcile、conflict resolution、auto policy。
- 默认 CI 使用固定 crypto/snapshot/S3 signing fixture；真实 COS 只在隔离测试 workspace 人工验证。

### 11.8 桌面与移动

- desktop sidebar 折叠、tab、快捷指标、设置和隐私按钮。
- forced-mobile 首页、进入 tab、返回、modal、iOS input 字号和横屏 desktop layout。
- 图表、表格、空状态、loading/error、developer mode/raw JSON。

---

## 12. 最终完成定义

只有同时满足以下条件，整体重构才可标记完成：

- 干净工作树上 `desktop:release:check` 全绿，25 cases + 2 cross-check 全绿。
- 全量 Rust 测试、前端测试、frontend build、cargo check 全绿。
- Tauri command、数据库、导入 ID、同步格式和设置持久化兼容清单无未批准变化。
- `App.tsx` 已变为应用装配层，业务 state/handler 已下沉。
- 不再存在 80+ props 的页面容器，不再把共享 UI 组件作为 props 传递。
- 公开 feature props 无 `Record<string, any>`，无新增 `LoosePayload`；遗留动态 `unknown/Value` 有明确边界和说明。
- desktop API 按域组织，单一 invoke 入口，响应 contract 可定位。
- Rust 大域按职责拆分，command、I/O 和纯逻辑可独立测试。
- CSS 已按稳定顺序模块化，关键 desktop/mobile 截图无非预期差异。
- 当前 500 kB 主 chunk warning 已消除或有书面保留理由。
- `AGENTS.md`、前端架构、IPC 协议和本文与最终代码一致。
- 没有为了达成行数指标保留新的万能 hook、巨大 controller、无意义 service 或转发层。

最终交付应附一份“重构前后度量 + 兼容性验证 + 剩余技术债”报告。若仍有例外，应列出文件、原因、风险和后续任务，而不是笼统写“后续优化”。
