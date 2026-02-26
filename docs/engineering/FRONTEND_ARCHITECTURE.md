# KeepWise 前端架构全貌

> `App.tsx` (~9860 行) + `App.css` (~2860 行) 单文件实现。
> 无路由库、无状态管理库、无组件拆分——纯 `useState` + 条件渲染。

---

## 目录

1. [应用布局](#应用布局)
2. [产品 Tab](#产品-tab)
3. [组件清单](#组件清单)
4. [类型定义](#类型定义)
5. [工具函数](#工具函数)
6. [App 组件状态管理](#app-组件状态管理)
7. [组件树](#组件树)
8. [CSS 架构](#css-架构)
9. [优化方向](#优化方向)

---

## 应用布局

```
┌─────────────────────────────────────────────────┐
│  .workspace-layout (CSS Grid: 260px | 1fr)      │
│  ┌──────────┐ ┌────────────────────────────────┐│
│  │ Sidebar  │ │ .workspace-content             ││
│  │          │ │ ┌────────────────────────────┐  ││
│  │ Brand    │ │ │ .workspace-tab-header      │  ││
│  │ Logo     │ │ │ 标题 + 操作按钮            │  ││
│  │          │ │ └────────────────────────────┘  ││
│  │ Tab Nav  │ │ ┌────────────────────────────┐  ││
│  │ 8 个     │ │ │ 当前 Tab 内容区域          │  ││
│  │ 导航项   │ │ │ (条件渲染，同时仅一个可见) │  ││
│  │          │ │ │                            │  ││
│  │          │ │ │ Preview 组件 + 图表 + 表格 │  ││
│  │          │ │ └────────────────────────────┘  ││
│  │ Footer   │ │                                ││
│  │ Tools    │ │                                ││
│  └──────────┘ └────────────────────────────────┘│
└─────────────────────────────────────────────────┘
  ▲ 侧边栏可折叠（84px），带动画过渡
  ▲ 3 个模态：快捷录入投资 / 编辑投资记录 / 设置
```

---

## 产品 Tab

| Tab Key | 图标 | 名称 | 说明 |
|---------|------|------|------|
| `manual-entry` | ✎ | 更新收益 | 快捷录入投资快照，管理账户目录 |
| `wealth-overview` | ◔ | 财富总览 | 财富概览快照 + Sankey 图 + 趋势曲线 |
| `return-analysis` | ↗ | 投资收益 | 单账户/多账户收益率 + 净值曲线 |
| `budget-fire` | ◎ | FIRE进度 | 预算管理 + 月度复盘 + FIRE 进度 |
| `income-analysis` | ¥ | 收入分析 | 工资/公积金收入结构与趋势 |
| `consumption-analysis` | ¤ | 消费分析 | 年度消费报告（分类/商户/月份/交易明细） |
| `import-center` | ⇩ | 导入中心 | YZXY / 招行 EML / 招行 PDF 数据导入 |
| `admin` | ⚙ | 高级管理 | DB 管理、健康检查、规则管理、烟雾测试 |

---

## 组件清单

38 个组件，按职责分 4 类。

### 基础 UI 组件

| 组件 | 行号 | 说明 |
|------|------|------|
| `PathRow` | 196 | 显示路径键值对（标签 + 等宽路径值） |
| `BoolField` | 213 | 布尔值开关字段（是/否按钮组） |
| `DateInput` | 290 | 日期输入（封装 react-datepicker） |
| `JsonResultCard` | 333 | 可折叠 JSON 结果展示卡片 |
| `AccountIdSelect` | 648 | 账户选择下拉框（分组显示投资/现金/不动产/负债） |
| `PreviewStat` | 694 | 单个统计数值卡片（标签 + 数值 + 色调） |
| `InlineProgressSpinner` | 3539 | 内联加载旋转动画（14px 圆形） |
| `AutoRefreshHint` | 3557 | 自动刷新状态提示条 |
| `SortableHeaderButton` | 4081 | 可排序表头按钮（升序/降序指示器） |

### 图表可视化组件

| 组件 | 行号 | 说明 |
|------|------|------|
| `LineAreaChart` | 711 | 通用折线/面积 SVG 图表（支持双系列、十字准线、Tooltip） |
| `InvestmentCurvePreview` | 969 | 投资净值曲线预览（封装 LineAreaChart + 指标汇总） |
| `WealthStackedTrendChart` | 1074 | 财富堆叠面积图（按资产类型分层，SVG 实现） |
| `WealthSankeyDiagram` | 1403 | 财富 Sankey 桑基图（ECharts 实现，资产流向） |

### 数据预览组件

| 组件 | 行号 | 说明 |
|------|------|------|
| `WealthOverviewPreview` | 1656 | 财富总览面板（资产分组统计 + sparkline） |
| `WealthCurvePreview` | 1698 | 财富曲线预览（封装 WealthStackedTrendChart） |
| `BudgetItemsPreview` | 1764 | 月度预算项目列表（含排序、新增/删除操作） |
| `BudgetOverviewPreview` | 1882 | 年度预算概览（预算 vs 实际指标卡片） |
| `BudgetMonthlyReviewPreview` | 1918 | 年度预算月度回顾表格（12 个月逐月对比） |
| `FireProgressPreview` | 2000 | FIRE 进度面板（自由率、覆盖年数、缺口金额） |
| `SalaryIncomeOverviewPreview` | 2050 | 工资收入概览（月度明细 + 雇主汇总） |
| `ConsumptionOverviewPreview` | 2206 | 消费分析面板（年份Tab + 环形图 + 分类/商户/月份排行 + 交易明细表） |
| `AdminDbStatsPreview` | 2862 | 数据库统计面板（各表行数排序表格） |
| `RuntimeHealthPreview` | 2931 | 运行时健康检查结果面板 |
| `InvestmentReturnsPreview` | 3020 | 多账户投资收益排行表格 |
| `MetaAccountsPreview` | 3128 | 账户元数据列表 |
| `InvestmentsListPreview` | 3212 | 投资记录列表（含编辑/删除操作） |
| `AssetValuationsPreview` | 3334 | 资产估值记录列表 |
| `AccountCatalogPreview` | 3418 | 账户目录管理（含新增/删除） |

### 导入 & 管理组件

| 组件 | 行号 | 说明 |
|------|------|------|
| `YzxyPreviewSummaryReport` | 3693 | 有知有行预览结果汇总 |
| `YzxyImportSummaryReport` | 3731 | 有知有行导入结果汇总 |
| `CmbEmlPreviewSummaryReport` | 3754 | 招行信用卡 EML 预览汇总 |
| `CmbEmlImportSummaryReport` | 3791 | 招行信用卡 EML 导入汇总 |
| `CmbBankPdfPreviewSummaryReport` | 3811 | 招行借记卡 PDF 预览汇总 |
| `CmbBankPdfImportSummaryReport` | 3860 | 招行借记卡 PDF 导入汇总 |
| `MerchantSuggestionsPreview` | 3884 | 商户映射建议列表 |
| `RulesRowsPreview` | 4109 | 通用规则行列表（可排序表格） |
| `RulesAdminPanel` | 4240 | 规则管理面板（商户映射/分类/白名单/排除规则 4 类 CRUD，~960 行） |
| `App` | 5207 | 主应用组件（~4650 行，全部状态和渲染逻辑） |

---

## 类型定义

| 类型 | 行号 | 说明 |
|------|------|------|
| `LoadStatus` | 138 | `"idle" \| "loading" \| "ready" \| "error"` |
| `BoolString` | 139 | `"true" \| "false"` |
| `GainLossColorScheme` | 140 | 涨跌配色：中国红涨绿跌 / 国际绿涨红跌 |
| `AppSettings` | 141 | 应用设置（配色、隐私遮罩、动画开关） |
| `SmokeStatus` | 146 | 烟雾测试状态 |
| `SmokeKey` | 147 | 烟雾测试用例 key（4 种） |
| `PipelineStatus` | 148 | 流水线状态 |
| `ImportStepStatus` | 149 | 导入步骤状态 |
| `ImportStepKey` | 150 | 导入步骤 key（3 种） |
| `ProductTabKey` | 151 | 8 个产品 Tab 标识 |
| `SmokeRow` | 161 | 烟雾测试行数据 |
| `ImportStepRow` | 169 | 导入步骤行数据 |
| `ProductTabDef` | 177 | Tab 定义（key、图标、标签、副标题、状态） |
| `AccountSelectOption` | 597 | 账户选择选项（value、label、kind） |
| `RulesPreviewColumn` | 4038 | 规则预览表列定义 |
| `TableSortDirection` | 4044 | `"asc" \| "desc"` |

---

## 工具函数

### 金额格式化

| 函数 | 行号 | 说明 |
|------|------|------|
| `formatCentsShort` | 494 | 分→万元/亿元短格式（如 `"12.5万"`） |
| `formatSignedDeltaCentsShort` | 504 | 带正负号的增量金额 |
| `formatCentsInputValue` | 511 | 分→元输入框值 |
| `formatRatePct` | 516 | 收益率→百分比 |
| `formatPct` | 521 | 通用百分比 |
| `formatCentsCompactCny` | 1392 | 分→紧凑人民币（Sankey 用） |

### 隐私遮罩

| 函数 | 行号 | 说明 |
|------|------|------|
| `isAmountPrivacyMasked` | 411 | 判断是否启用金额遮罩 |
| `maskAmountDisplayText` | 463 | 金额文本→`"***"` |
| `isMonetaryLabel` | 470 | 判断标签是否是金额类 |
| `maskAmountValueByLabel` | 484 | 按标签名自动遮罩 |
| `isLikelyAmountJsonKey` | 490 | JSON key 是否是金额类 |

### 数据解析

| 函数 | 行号 | 说明 |
|------|------|------|
| `isRecord` | 373 | 判断值是否是 Record 对象 |
| `readPath` / `readString` / `readNumber` / `readBool` / `readArray` | 377-401 | 安全路径读取工具集 |
| `parseStoredAppSettings` | 440 | 解析 localStorage 设置 |
| `safeNumericInputValue` | 588 | 安全数值输入解析 |
| `buildAccountSelectOptionsFromCatalog` | 603 | 账户目录→下拉选项 |

### 日期 & 显示

| 函数 | 行号 | 说明 |
|------|------|------|
| `parseDateInputValue` | 253 | 日期字符串→Date |
| `formatDateInputValue` | 273 | Date→`YYYY-MM-DD` |
| `getTodayDateInputValueLocal` | 427 | 今日日期字符串 |
| `getCurrentMonthDateRangeLocal` | 435 | 当月起止日期 |
| `formatMonthDayLabel` | 526 | ISO→`M/D` 短格式 |
| `formatPresetLabel` | 571 | 时段 key→中文标签 |
| `signedMetricTone` | 419 | 数值正负→色调 |

### 自定义 Hook

| 函数 | 行号 | 说明 |
|------|------|------|
| `useDebouncedAutoRun` | 3578 | 防抖自动执行——deps 变化后延迟执行 task，支持 `enabled` 控制 |

---

## App 组件状态管理

`App`（5207-9860 行）包含约 **160+ 个 useState** 和 **25+ 个 useDebouncedAutoRun**。

### 状态分域

| 域 | useState | 关键变量 | 驱动 UI |
|----|----------|----------|---------|
| 启动引导 | 10 | `status`, `probe`, `dbStatus`, `dbBusy` | 初始化、DB 迁移 |
| 投资收益 | 12 | `invResult`, `invBatchResult`, `invCurveResult` + query/busy/error | 投资收益 Tab |
| 财富分析 | 8 | `wealthOverviewResult`, `wealthCurveResult` + query/busy/error | 财富总览 Tab |
| 预算 & FIRE | 18 | `budgetItemsResult`, `budgetOverviewResult`, `fireProgressResult` | FIRE 进度 Tab |
| 收入分析 | 4 | `salaryIncomeResult` + query/busy/error | 收入分析 Tab |
| 消费分析 | 4 | `consumptionOverviewResult`, `consumptionYear` | 消费分析 Tab |
| 数据导入 | 30 | `yzxy*`, `eml*`, `cmbPdf*`（path/type/preview/import × busy/error/result） | 导入中心 Tab |
| 管理后台 | 18 | `adminDbStats*`, `adminReset*`, `runtimeHealth*`, `smokeRows` | 高级管理 Tab |
| 手动录入 | 20 | `manualInv*`, `quickManualInv*`, `invEdit*`, `manualAsset*` | 更新收益 Tab |
| 查询列表 | 16 | `metaAccounts*`, `txList*`, `invList*`, `assetList*`, `acctCatalog*` | 管理 Tab 数据表 |
| UI 控制 | 6 | `activeTab`, `sidebarCollapsed`, `appSettings`, `settingsOpen` | 全局导航 & 设置 |

### 数据流

```
用户切换 Tab → activeTab 变化
  → useDebouncedAutoRun 按 enabled 条件触发
    → handle*Query() 调用 desktopApi.*()
      → invoke("command", { req })
        → Rust 后端查询
      → normalizeTauriValue(raw)
    → setState(result)
  → Preview 组件接收 data prop 渲染
```

### useEffect 汇总

| 行号 | 作用 | 依赖 |
|------|------|------|
| 7074 | 启动初始化：`refreshProbe()` + `refreshDbStatus()` | `[]` |
| 7096 | 持久化 appSettings 到 localStorage | `[appSettings]` |
| 7104 | 持久化最近录入账户 ID | `[quickManualInvLastAccountId]` |
| 6655 | 派生导入中心行状态 | 多个导入状态变量 |

25+ 个 `useDebouncedAutoRun`（7173-7255 行）实现按需加载——切到哪个 Tab 就自动查询哪个数据。

---

## 组件树

```
App
├── [模态] 快捷录入投资 (quickManualInvOpen)
├── [模态] 编辑投资记录 (invEditModalOpen)
├── [模态] 设置面板 (settingsOpen)
├── Sidebar
│   ├── Brand Logo + Toggle
│   ├── Tab Nav (8 个 tab-nav-btn)
│   └── Footer Tools (隐私遮罩/快捷录入/设置)
└── Content Area (activeTab 条件渲染)
    ├── manual-entry
    │   ├── AccountCatalogPreview
    │   ├── InvestmentsListPreview
    │   └── AssetValuationsPreview
    ├── wealth-overview
    │   ├── WealthOverviewPreview
    │   ├── WealthSankeyDiagram
    │   └── WealthCurvePreview → WealthStackedTrendChart
    ├── return-analysis
    │   ├── InvestmentReturnsPreview
    │   ├── InvestmentCurvePreview → LineAreaChart
    │   └── PreviewStat
    ├── budget-fire
    │   ├── FireProgressPreview
    │   ├── BudgetOverviewPreview
    │   ├── BudgetMonthlyReviewPreview
    │   └── BudgetItemsPreview
    ├── income-analysis
    │   └── SalaryIncomeOverviewPreview
    ├── consumption-analysis
    │   └── ConsumptionOverviewPreview
    ├── import-center
    │   ├── Yzxy Preview / Import Report
    │   ├── CmbEml Preview / Import Report
    │   └── CmbBankPdf Preview / Import Report
    └── admin
        ├── AdminDbStatsPreview
        ├── RuntimeHealthPreview
        ├── MetaAccountsPreview
        ├── RulesAdminPanel → MerchantSuggestionsPreview + RulesRowsPreview ×4
        └── Smoke Test / Pipeline 面板
```

---

## CSS 架构

`App.css` (2858 行) — 纯 CSS，无预处理器、无 CSS Modules。

### 设计系统

| 维度 | 说明 |
|------|------|
| **色彩模式** | 仅暗色主题，`color-scheme: dark` |
| **主色** | `#34c6ad` 薄荷绿（`--kw-accent`） |
| **背景** | `#0b1319` 深蓝黑 + 多层 radial-gradient |
| **文字** | `#f3efe5` 暖白 |
| **卡片** | Glassmorphism（`backdrop-filter: blur(16px)` + 半透明渐变 + 阴影） |
| **字体** | Avenir Next, SF Pro, Segoe UI, PingFang SC, 微软雅黑 |
| **圆角** | 999px(药丸) / 18px(主卡) / 14px(子卡) / 12px(按钮) / 10px(输入框) |
| **动画** | 1 个 @keyframes (`kw-spin`)；transition 120-220ms |
| **响应式** | 3 断点：980px / 900px / 760px |

### 样式分区

| # | 前缀 | 行范围 | UI |
|---|------|--------|----|
| 1 | `:root`, `*`, `body` | 1-91 | 变量、重置、滚动条 |
| 2 | `.app-shell`, `.card`, `.hero-*` | 93-467 | 壳层、卡片、Hero |
| 3 | `.primary-btn`, `.secondary-btn`, `.danger-btn` | 159-244 | 按钮系统 |
| 4 | `.kw-modal-*` | 246-278 | 模态 |
| 5 | `.status-*` | 280-311 | 状态药丸 |
| 6 | `.workbench-*` | 371-427 | 工作台 |
| 7 | `.path-*`, `.db-*` | 469-578 | 路径、DB 操作 |
| 8 | `.inline-progress-spinner` | 541-559 | 旋转器 |
| 9 | `.pipeline-*`, `.smoke-*` | 586-666 | 测试结果 |
| 10 | `.query-form-grid`, `.field`, `.kw-date-*` | 681-872 | 表单、日期 |
| 11 | `.preview-*` | 889-1077 | 预览面板 |
| 12 | `.consumption-*` | 904-998, 1573-1656, 2520-2717 | 消费分析 |
| 13 | `.fire-progress-*` | 1080-1130 | FIRE |
| 14 | `.return-analysis-*` | 1132-1177 | 投资收益 |
| 15 | `.wealth-*` | 893-1276 | 财富分析 |
| 16 | `.sparkline-*` | 1235-1302 | 迷你图 |
| 17 | `.line-area-*` | 1304-1571 | 折线图 |
| 18 | `.stacked-wealth-*` | 1326-1484 | 堆叠图 |
| 19 | `.preview-table`, `.data-table` | 1658-1813 | 表格 |
| 20 | `.alert-card` | 1815-1838 | 错误提示 |
| 21 | `.roadmap-*` | 1840-1867 | 路线图 |
| 22 | `.workspace-*` | 1869-2506 | 主布局 |
| 23 | `.sidebar-*`, `.tab-nav-*`, `.tab-icon-*` | 1949-2462 | 导航 |
| 24 | `.settings-*` | 2176-2312 | 设置 |
| 25 | `.placeholder-panel*` | 2508-2518 | 空状态 |
| 26 | `@media` | 1666-1703, 2719-2858 | 响应式 |

---

## 优化方向

### 1. 文件拆分 — 最高优先级

**现状**：单文件 `App.tsx` 9860 行，`App.css` 2858 行。所有组件、状态、逻辑、类型都在一个文件中。

**问题**：
- 认知负荷极高：新开发者需要在近万行中定位修改点
- 热更新慢：任何改动都触发全文件重编译
- 无法并行开发：多人同时修改必然冲突
- Tree-shaking 失效：未使用的组件代码无法被排除

**建议拆分策略**：

```
src/
├── App.tsx                  # 仅保留 Shell + Router (< 200 行)
├── App.css                  # 仅保留全局样式 + 变量 (< 300 行)
├── types/
│   └── index.ts             # 所有 type 定义
├── utils/
│   ├── format.ts            # formatCentsShort, formatRatePct 等
│   ├── privacy.ts           # maskAmount*, isMonetaryLabel 等
│   ├── parse.ts             # isRecord, readPath, readString 等
│   └── date.ts              # parseDateInputValue, getTodayDate 等
├── hooks/
│   └── useDebouncedAutoRun.ts
├── components/
│   ├── ui/                  # 基础 UI：PathRow, BoolField, DateInput...
│   ├── charts/              # LineAreaChart, WealthStackedTrendChart...
│   └── previews/            # WealthOverviewPreview, BudgetItemsPreview...
├── features/
│   ├── wealth/              # WealthTab 组件 + 状态 + 样式
│   ├── investment/          # ReturnAnalysisTab + 状态 + 样式
│   ├── budget/              # BudgetFireTab + 状态 + 样式
│   ├── income/              # IncomeTab + 状态 + 样式
│   ├── consumption/         # ConsumptionTab + 状态 + 样式
│   ├── import/              # ImportCenterTab + 状态 + 样式
│   ├── manual-entry/        # ManualEntryTab + 状态 + 样式
│   └── admin/               # AdminTab + RulesAdminPanel + 状态 + 样式
└── styles/
    ├── variables.css         # :root 变量
    ├── reset.css             # 重置 + 滚动条
    ├── components.css        # 按钮、模态、状态药丸等共享样式
    └── layout.css            # workspace、sidebar、响应式
```

**实施路径**（渐进式，不破坏现有功能）：

1. 先提取 `types/` 和 `utils/` — 纯数据，零风险
2. 提取基础 UI 组件（`PathRow`, `BoolField` 等）— 无状态，独立性强
3. 提取图表组件 — 自包含，仅依赖 props
4. 按 Tab 提取 feature 模块 — 每次一个 Tab，连同其状态和 handler
5. 最后瘦身 `App.tsx` 为纯 Shell

### 2. 状态管理 — 高优先级

**现状**：160+ 个 `useState` 全部平铺在 `App` 组件中，每个域重复 `busy/error/result/query` 四件套。

**问题**：
- 每次任意 state 变更都可能触发整棵组件树重渲染
- 重复模式未抽象：每个 API 调用都手写 try/busy/catch/error/finally/busy 逻辑
- 不相关的域互相耦合（消费分析的 state 变更会重渲染投资分析）

**建议**：

#### 方案 A：useReducer + Context 分域（轻量）

```typescript
// 每个域一个 context
type InvestmentState = {
  busy: boolean; error: string; result: InvestmentReturnPayload | null;
  batchBusy: boolean; batchResult: InvestmentReturnsPayload | null;
  curveBusy: boolean; curveResult: InvestmentCurvePayload | null;
  query: { account_id: string; preset: string; from: string; to: string };
};

const InvestmentContext = createContext<{ state: InvestmentState; dispatch: Dispatch<InvestmentAction> }>(null!);
```

#### 方案 B：自定义 `useAsyncQuery` hook（最小改动）

```typescript
function useAsyncQuery<TReq, TRes>(
  apiFn: (req: TReq) => Promise<TRes>,
  initialQuery: TReq,
) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<TRes | null>(null);
  const [query, setQuery] = useState(initialQuery);

  const run = useCallback(async (req?: TReq) => {
    setBusy(true); setError("");
    try { setResult(await apiFn(req ?? query)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }, [apiFn, query]);

  return { busy, error, result, query, setQuery, run };
}

// 使用：160+ useState → ~30 个 useAsyncQuery 调用
const inv = useAsyncQuery(investmentReturnQuery, { account_id: "", preset: "ytd" });
const invBatch = useAsyncQuery(investmentReturnsQuery, { preset: "ytd" });
```

**推荐路径**：先实施方案 B（可逐步迁移，不需要 Context），再考虑方案 A。

### 3. 渲染性能 — 中优先级

**现状**：
- 8 个 Tab 的内容虽然条件渲染（`isTab("x") ? <Section/> : null`），但所有 Tab 的状态和 handler 始终存在于 App 中
- 每次 setState 都可能触发 App 组件函数体全部重新执行（包含 30+ 个 handler 函数重新创建）
- 无 `useMemo` / `useCallback` 包裹

**建议**：

| 措施 | 影响 | 难度 |
|------|------|------|
| 将每个 Tab 内容区抽为独立组件 | 缩小重渲染范围 | 低 |
| handler 函数用 `useCallback` 包裹 | 避免子组件无效重渲染 | 低 |
| 数据预览组件用 `React.memo` 包裹 | 跳过 props 未变的渲染 | 低 |
| `RulesAdminPanel` 已独立但内含 80+ useState，可进一步拆 | 减少局部重渲染 | 中 |
| 消费分析交易表支持虚拟滚动（数据量可达数千行） | 大幅减少 DOM 节点 | 中 |

### 4. 响应类型安全 — 中优先级

**现状**：后端响应在前端标注为 `unknown`，依赖 `readString`/`readNumber`/`readArray` 等运行时 helper 逐字段提取。

**问题**：
- 无编译期类型检查：字段拼写错误只在运行时暴露
- 重复的 `readXxx` 调用使组件代码冗长
- 重构后端字段名时前端无法自动发现断裂

**建议**：
- 为每个 API 响应定义完整 TS 类型（与 Rust `json!({})` 结构对齐）
- `desktopApi.ts` 返回强类型而非 `unknown`
- 可考虑用 `zod` schema 做运行时验证 + 类型推断一体化
- 长期可引入 `specta`（Tauri 生态）从 Rust struct 自动生成 TS 类型

### 5. CSS 改进 — 低优先级

**现状**：2858 行纯 CSS，全局作用域，BEM-like 命名约定手动避免冲突。

**问题**：
- 无作用域隔离：全靠命名前缀约定
- 样式分散：消费分析的样式分布在 3 个不连续区域（904-998, 1573-1656, 2520-2717）
- 无法与组件共存亡：删除组件后对应样式变为死代码

**建议**：

| 方案 | 说明 | 适合时机 |
|------|------|----------|
| CSS Modules | `.module.css` 文件，编译期作用域隔离，改动最小 | 文件拆分后立即可用 |
| Tailwind CSS | 原子化，无需写 CSS 文件 | 全面重写时 |
| 保持现状 + 整理 | 按组件重排 CSS 区域，消除分散 | 过渡期 |

**建议路径**：文件拆分后自然切到 CSS Modules（`.module.css` 跟随组件文件），既保留现有设计系统又获得作用域隔离。

### 6. 全局可变状态 — 低优先级

**现状**：隐私遮罩和涨跌配色通过模块级可变变量实现：

```typescript
let amountPrivacyMaskedGlobal = false;     // 模块顶层
let gainLossColorSchemeGlobal: GainLossColorScheme = "cn_red_up_green_down";

// App 组件中每次渲染都重新赋值
amountPrivacyMaskedGlobal = amountPrivacyMasked;
gainLossColorSchemeGlobal = appSettings.gainLossColorScheme;
```

**问题**：
- 违反 React 数据流：非组件函数读取全局变量，绕过了 props/context
- 渲染时序依赖：子组件必须在 App 赋值之后渲染才能拿到正确值

**建议**：改用 React Context，或至少用 `useRef` + `useSyncExternalStore`。但这是低优先级，当前实现在单线程渲染中实际可工作。

### 优化实施优先级总览

```
紧急度 高 ──────────────────────────────────── 低
  │
  │  ┌─────────────────┐
  │  │ 1. useAsyncQuery │ ← 最小改动、最高收益
  │  │    hook 抽象     │    160+ useState → ~30
  │  └─────────────────┘
  │  ┌─────────────────┐
  │  │ 2. 工具函数提取  │ ← 零风险，立即可做
  │  │    types/utils/  │
  │  └─────────────────┘
  │  ┌─────────────────┐
  │  │ 3. 基础组件拆分  │ ← 9 个基础 UI 组件
  │  │    + 图表组件    │    + 4 个图表组件
  │  └─────────────────┘
  │  ┌─────────────────┐
  │  │ 4. Tab 级拆分   │ ← 每次一个 Tab
  │  │    feature 模块  │    逐步瘦身 App.tsx
  │  └─────────────────┘
  │  ┌─────────────────┐
  │  │ 5. 响应类型收紧  │ ← unknown → typed
  │  │                 │
  │  └─────────────────┘
  │  ┌─────────────────┐
  │  │ 6. CSS Modules  │ ← 随文件拆分自然切入
  │  │                 │
  │  └─────────────────┘
  ▼
```

---

> 文档生成时间：2026-02-26
> 基于 App.tsx (9860 行) + App.css (2858 行) 分析
