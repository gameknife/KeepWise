# AI 资产分析 Markdown 导出 - 开发计划

> Status: Draft / Ready for implementation
> Owner: TBD（前端 + Rust 后端）
> 适用版本：基于当前 Tauri Desktop 主线（apps/keepwise-tauri）

## 1. 背景与目标

KeepWise 已具备较完整的金融数据：投资账户快照、现金/不动产/负债估值、消费交易、工资/公积金代发流水、规则化分类。但用户没有"持仓股票/基金代码"，账户层只有总资产数字。要进行更深入的资产配置/回报归因/再平衡建议，需要把这些信息**结构化导出为 Markdown**，并允许用户在导出时**补充缺失的语义信息**（如"这个账户重仓 600519 / 510300 / QDII 美股"）。

### 1.1 目标使用场景

1. **网页端 LLM 分析**：用户复制 Markdown，粘贴到 Gemini / ChatGPT / Claude 网页对话窗口。
2. **Agent 工作流**：用户保存 Markdown 文件，丢给 Codex / Claude Code 等本地 agent 做多轮分析。
3. **本地一键分析（P2）**：在 KeepWise 内点击"用 Codex 分析"，调用本地 `codex` CLI（或 `claude` CLI）执行 prompt + Markdown，把分析结果回显在软件内或外部终端。

### 1.2 非目标

- 不做联网调用 LLM（用户自己选 LLM）。
- 不做账户级"持仓代码 -> 实时行情"自动抓取（仅由用户人工标注）。
- 不做 Markdown -> PDF / HTML 转换（导出物保持纯文本 Markdown）。

## 2. 用户价值

| 角色 | 当前痛点 | 导出后改善 |
|---|---|---|
| 投资者本人 | 多账户/多资产分散，难以一次性"喂"给 LLM | 一份结构化文档即可；带分类口径与隐私选项 |
| LLM | 只看到大盘资产数字，无法做归因 | 可基于用户标注的"重仓代码 + 比例 + 风险偏好"做更精细分析 |
| 本地 Agent | 需要人为反复粘贴 / 手工组织 | 一次生成，多轮使用；Agent 可读取 Markdown 上下文 |

## 3. 现有数据盘点（导出可调用的后端能力）

下列命令均已在 `apps/keepwise-tauri/src-tauri/src/lib.rs` 注册并通过 `desktopApi.ts` 暴露，导出聚合层**只调用现成命令，不直接读 SQLite**，避免重复一份 SQL。

| 段落 | 调用 | 关键字段 |
|---|---|---|
| 净资产摘要 | `wealth_overview_query` | `summary.investment_total_cents` / `cash_total_cents` / `real_estate_total_cents` / `liability_total_cents` / `net_asset_total_cents` / `stale_account_count` / `as_of` |
| 账户明细（投资/现金/房产/负债） | `wealth_overview_query`（同上）的 `rows[]` | `asset_class` / `account_id` / `account_name` / `value_cents` / `snapshot_date` / `stale_days` |
| 财富曲线 | `wealth_curve_query`（preset=`since_inception` 或 `3y`） | `rows[].snapshot_date` / `wealth_total_cents` / `net_asset_total_cents`，`summary.change_pct` |
| 投资收益（账户级） | `investment_returns_query` + `investment_return_query`（组合 `__portfolio__`） | `rows[].return_rate` / `annualized_rate` / `begin_assets_cents` / `end_assets_cents` / `net_flow_cents` / `profit_cents` / `interval_days` |
| FIRE 进度 | `query_fire_progress` | `metrics.coverage_years` / `freedom_ratio` / `required_assets_cents` / `goal_gap_cents`，附带 `budget` / `investable_assets` |
| 预算 / 月度复盘 | `query_budget_overview` + `query_budget_monthly_review` | `budget.annual_total_cents` / `actual.spent_total_cents` / `metrics.usage_rate` |
| 收入 | `query_salary_income_overview` | `summary.salary_total_cents` / `housing_fund_total_cents`，`employers[]`，`rows[]`（按月） |
| 消费 | `query_consumption_report` | `consumption_total` / `top_expense_categories` / `merchants` 头部 / `months[]` |
| 账户目录 | `query_account_catalog` | `rows[].account_id` / `account_name` / `account_kind` / `transaction_count` 等 |

> 备注：所有金额字段同时提供 `*_cents`（i64，精确）和 `*_yuan`（"123.45"，已格式化）两种形态，导出层优先使用 `_yuan`，但可附带 `_cents` 给 LLM 做精算。

## 4. 用户辅助信息（解决"丢失持仓代码"问题）

导出界面要让用户对现有数据做"语义增强"。所有辅助信息**只在导出 Markdown 中出现**，并**持久化**以便下次复用。

### 4.1 全局信息（一次填写、跨账户共享）

存到 `keepwise.desktop.export-profile.v1`（localStorage，与 `AppSettings` 同形态）：

| 字段 | 类型 | 示例 / 说明 |
|---|---|---|
| `personaSummary` | 多行文本 | "30 岁、一线城市、双职工、计划 2040 退休；可承受 30% 回撤" |
| `riskAppetite` | 单选 | 保守 / 平衡 / 进取 |
| `liquidityNeed` | 多行文本 | "未来 18 个月需 50 万现金用于换房" |
| `investmentGoals` | 多行文本 | "10 年内做到 FIRE / 子女教育 5 年内 100 万" |
| `analysisAsk` | 多行文本 | "请帮我分析现有持仓是否过度集中、是否需要再平衡" |
| `currency` | 字符串 | 默认 `CNY`，仅作为说明输出 |

### 4.2 账户级备注（核心补足项）

新增 SQLite 表 `account_notes`（见 §7.2），允许用户对**每个账户**填写：

| 字段 | 类型 | 用途 |
|---|---|---|
| `account_id` | TEXT PK | 关联 `accounts.id` |
| `holdings_text` | TEXT | "60% 沪深 300（510300） / 30% 中概互联（513050） / 10% 现金" |
| `risk_note` | TEXT | "高波动、长期持有；不接受 T+0" |
| `note_text` | TEXT | 任意补充说明 |
| `updated_at` | TEXT | datetime('now') |

UI 在导出弹窗内提供"账户备注表格"：每行 = 账户，列 = 持仓代码 / 风险备注 / 一般备注。**默认仅展示投资账户**（可切换显示其它种类）。

### 4.3 隐私 / 脱敏选项

| 选项 | 默认 | 行为 |
|---|---|---|
| 包含具体金额 | 是 | 关闭后所有金额改为占比 + 区间标签（"≥ 100 万 / 50–100 万 / 10–50 万 / < 10 万"） |
| 包含消费明细 | 否 | 默认仅输出消费汇总，不输出商户/交易明细 |
| 包含工资雇主名称 | 否 | 关闭后雇主匿名化为"雇主 A / B" |
| 包含账户 ID | 否 | 关闭后仅显示 `account_name`（更适合贴到公网 LLM） |
| 全局四舍五入到万元 | 否 | 适合金额很大的用户做去精确化 |

## 5. 导出物结构（Markdown 模板）

固定章节顺序，方便 LLM 做 chunked 阅读。每段顶部一行 `> 数据口径：...` 提示分析者注意。

```markdown
# KeepWise 资产分析快照

- 生成时间：2026-05-10 12:00
- 数据截至：2026-05-09
- 货币单位：CNY
- 隐私模式：金额可见、消费明细已脱敏

## 1. 用户画像
{personaSummary}

- 风险偏好：平衡
- 短期流动性需求：{liquidityNeed}
- 长期目标：{investmentGoals}

## 2. 净资产摘要

| 资产类别 | 金额（元） | 占比 | 最近更新 |
|---|---:|---:|---|
| 投资 | 1,234,567.89 | 62.3% | 2026-05-09 |
| 现金 | 350,000.00 | 17.7% | 2026-05-08 |
| 不动产 | 800,000.00 | 40.4% | 2026-04-30 |
| 负债 | -400,000.00 | -20.4% | 2026-05-01 |
| **净资产** | **1,984,567.89** | 100% | — |

> 数据口径：净资产 = 投资 + 现金 + 不动产 − 负债；过期超过 30 天的账户已用 ⚠️ 标注。

## 3. 账户明细

### 3.1 投资账户

| 账户 | 最新资产 | 快照日期 | stale_days | 用户备注（持仓） | 风险备注 |
|---|---:|---|---:|---|---|
| 招商证券 A 股 | 612,300.00 | 2026-05-09 | 1 | 50% 600519、20% 510300、30% 现金 | 长期持有 |
| YZXY 指数组合 | 422,267.89 | 2026-05-09 | 1 | 100% 中证 500 ETF（510500） | 高波动 |

### 3.2 现金账户
...

### 3.3 不动产账户
...

### 3.4 负债账户
...

## 4. 财富曲线（最近 3 年采样）

| 日期 | 总资产（元） | 净资产（元） | 期间净增长 |
|---|---:|---:|---:|
| 2023-05-01 | ... | ... | — |
| 2023-12-31 | ... | ... | +234,000.00 |
| ...（按月或季度采样） |

> 数据口径：曲线采样自 `wealth_curve_query`，采样点 = 数据库内出现的快照日期，期间净增长 = 当点 − 起点。

## 5. 投资收益分析

### 5.1 组合层（Modified Dietz）

| 区间 | 期初 | 期末 | 净流 | 净利 | 区间收益率 | 年化 |
|---|---:|---:|---:|---:|---:|---:|
| YTD | ... | ... | ... | ... | +12.3% | +18.5% |
| 近 1 年 | ... |
| 近 3 年 | ... |
| since_inception | ... |

### 5.2 账户层（since_inception）

| 账户 | 期初 | 期末 | 净流 | 净利 | 收益率 | 年化 | 占比 |
|---|---:|---:|---:|---:|---:|---:|---:|

## 6. 收入与消费现状

### 6.1 收入（基于招行 PDF 流水）
- {year} 年累计工资：xxx 元
- 累计住房公积金：xxx 元
- 雇主分布：雇主 A 100%

### 6.2 消费
- {year} 年累计消费：xxx 元（已排除"待确认"与"分析排除"）
- TOP 5 类别：餐饮 18%、交通 12%、...
- 月均支出：xxx 元

## 7. 预算与 FIRE 进度

- 年度预算：xxx 元；YTD 已用：xxx 元（usage_rate xx%）
- 投资性资产：xxx 元
- 自由度（4% 法则）：xx%
- 覆盖年限：xx 年
- 距 FIRE 目标：xxx 元

## 8. 我希望分析师关注的问题
{analysisAsk}

---

## 附录 A：数据口径说明
- 金额单位：元（部分附 cents 精确值）
- 投资收益率算法：Modified Dietz（现金加权），见 `investment_analytics.rs`
- 消费默认排除：`needs_review = 0` 且 `excluded_in_analysis = 0` 的支出交易
- "stale_days" = 数据快照日期距 `as_of` 的天数

## 附录 B：原始 JSON 摘要（可选）
（关闭"调试模式"时不输出）

```json
{ ... }
```
```

实现层用一个**模板字符串拼装**而非 Markdown DSL 库，以便后续微调。参考 `app/summaries.ts` 的格式化复用。

## 6. UI 设计

### 6.1 入口

新增 TAB：`export-analysis` / 标签 "导出分析" / 图标 "↑"，放在"高级管理"前一位（`PRODUCT_TABS` 中）。
> 不放在"高级管理"内，因为这是常用导出动作，不是管理功能。
> 移动端可见（`getVisibleTabsForMode` 不过滤）。

### 6.2 页面布局（左右两列）

```
┌────────────────────────────────┬─────────────────────────────────┐
│ 左：辅助信息编辑                  │ 右：导出预览 + 操作                │
│ - 用户画像（textarea）           │ [生成预览] 按钮                    │
│ - 风险偏好（select）              │                                  │
│ - 风险/流动性/目标/分析诉求        │ Markdown 预览区（只读 <pre>，等宽 │
│   （4×textarea）                  │ + 行号；最大 600px 高，溢出滚动）  │
│                                  │                                  │
│ 账户备注表（投资/现金/...筛选）   │ 操作：                             │
│ ┌─账户────持仓────风险────备注─┐ │   [复制到剪贴板]                  │
│ │ ...                         │ │   [保存为 .md]                   │
│ └────────────────────────────┘ │   [用 Codex 分析]（P2，可置灰）    │
│                                  │                                  │
│ 隐私 / 范围选项                   │                                  │
│ - 是否包含金额                    │                                  │
│ - 是否包含消费明细                 │                                  │
│ - 财富曲线采样区间（preset 下拉） │                                  │
│ - FIRE withdrawal_rate           │                                  │
│ - 是否输出 JSON 附录              │                                  │
└────────────────────────────────┴─────────────────────────────────┘
```

### 6.3 关键交互

- **首次打开**：自动调用 `query_account_catalog` 拉取账户列表，与 `account_notes` 表 LEFT JOIN 后渲染。
- **保存账户备注**：用 `useDebouncedAutoRun` debounce 800ms，自动写库（`upsert_account_note`）；不需要"保存"按钮。
- **生成预览**：聚合调用 §7.1 的 `analysis_export_snapshot`，再前端渲染 Markdown 字符串（不需要后端拼模板）。
- **复制剪贴板**：使用 `tauri-plugin-clipboard-manager`，复制成功后 toast 提示。
- **保存 .md**：用现有 `tauri-plugin-dialog` `save()`，再调用 Tauri 命令 `analysis_export_write_file(path, content)`。
- **Codex 分析**（P2）：用 `tauri-plugin-shell`，命令模板可在设置里配置，例如 `codex exec --markdown {path}`，输出转到外部终端 / 内嵌 viewer。

### 6.4 隐私基线

- 所有金额渲染遵循全局 `defaultPrivacyMaskOnLaunch`：默认值与 `App.tsx` 全局隐私一致（不是新建一套）。
- "包含具体金额"= false 时，Markdown 内的金额全部替换为分桶标签（与 `formatCentsShort` 不混用，新建 `bucketAmount` 工具）。

## 7. 后端设计

### 7.1 新命令：`analysis_export_snapshot`

**目的**：一次性聚合所有现成命令的 payload，避免前端发 8 次 invoke。

签名（Rust，`src-tauri/src/analysis_export.rs` 新文件）：

```rust
#[derive(Debug, Deserialize)]
pub struct AnalysisExportRequest {
    pub year: Option<String>,                  // 默认当前年（消费/收入/预算/FIRE 用）
    pub wealth_curve_preset: Option<String>,   // 默认 "since_inception"
    pub include_consumption_detail: Option<String>,  // "true"/"false"
    pub fire_withdrawal_rate: Option<String>,
}
```

实现路径：
1. 复用 `wealth_overview_query_at_db_path` / `wealth_curve_query_at_db_path` / `investment_returns_query_at_db_path` / `investment_return_query_at_db_path`（组合 `__portfolio__`，多 preset 串行：YTD / 1y / 3y / since_inception）/ `query_fire_progress_at_db_path` / `query_budget_overview_at_db_path` / `query_salary_income_overview_at_db_path` / `query_consumption_report_at_db_path` / `query_account_catalog_at_db_path`。
2. 加载 `account_notes`（见 §7.2）合并到 `accounts` 段。
3. 输出聚合 JSON，外层结构：
   ```json
   {
     "generated_at": "2026-05-10T12:00:00+08:00",
     "as_of": "2026-05-09",
     "wealth_overview": { ... },
     "wealth_curve": { ... },
     "investment_returns": {
       "portfolio_ytd": { ... },
       "portfolio_1y": { ... },
       "portfolio_3y": { ... },
       "portfolio_since_inception": { ... },
       "accounts_since_inception": { ... }
     },
     "fire": { ... },
     "budget_overview": { ... },
     "salary_income": { ... },
     "consumption": { ... },          // include_consumption_detail=false 时只保留 summary
     "account_catalog": { ... },
     "account_notes": [ { account_id, holdings_text, risk_note, note_text, updated_at } ]
   }
   ```

> 选择"后端只输出 JSON、前端拼 Markdown"的理由：
> - Markdown 模板要本地化（中文文案）、要随 UI 反复改 wording，让前端做更敏捷。
> - 后端聚合层稳定、可测；前端模板可走 snapshot 测试。
> - 调试模式下"原始 JSON 附录"刚好就是这个 payload，零成本。

注册到 `lib.rs::generate_handler!`。

### 7.2 新命令：账户备注 CRUD

```rust
#[tauri::command] pub fn query_account_notes(app, req) -> Result<Value, String>;
#[tauri::command] pub fn upsert_account_note(app, req) -> Result<Value, String>;  // upsert by account_id
#[tauri::command] pub fn delete_account_note(app, req) -> Result<Value, String>;
```

新建文件 `src-tauri/src/account_notes.rs`，仿 `account_catalog.rs` 风格。

### 7.3 新命令：写文件

由于 Tauri 已含 `tauri-plugin-dialog`，让前端先打开 `save()` 对话框拿到 path，再调用：

```rust
#[tauri::command]
pub fn analysis_export_write_file(path: String, content: String) -> Result<Value, String> {
    // 限制：必须以 .md 结尾、文件大小上限（例如 10MB）以防误用
    // 写入 utf-8 BOM-less
}
```

### 7.4 数据库迁移：`db/migrations/0007_add_account_notes.sql`

```sql
CREATE TABLE IF NOT EXISTS account_notes (
    account_id    TEXT PRIMARY KEY,
    holdings_text TEXT NOT NULL DEFAULT '',
    risk_note     TEXT NOT NULL DEFAULT '',
    note_text     TEXT NOT NULL DEFAULT '',
    updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_account_notes_updated_at ON account_notes(updated_at);
```

注意：在 `ledger_db.rs` 中走现有 schema_migrations 流程；表名小写、所有字段必填默认空串避免空值判定。

### 7.5 Cargo / 插件依赖

| 用途 | 现状 | 行动 |
|---|---|---|
| 文件保存对话框 | 已有 `tauri-plugin-dialog` | 复用 |
| 写文件 | Rust `std::fs` | 在新命令内做，不引入插件 |
| 剪贴板 | 未引入 | 新增 `tauri-plugin-clipboard-manager`（Tauri 2 官方）；Cargo + `App.tsx` 注册 |
| 调用本地 CLI（P2） | 未引入 | 新增 `tauri-plugin-shell`，仅在 P2 阶段；要在 capabilities 里允许 `codex` / `claude` 命令路径 |

### 7.6 不变更项

- 不修改现有 `wealth_*` / `investment_*` / `budget_fire_*` 模块的对外接口。
- 不在 `accounts` 表上增字段（保持迁移最小）。

## 8. 前端设计

### 8.1 新文件

```
src/features/export/
  AnalysisExportSection.tsx     // TAB 主面板
  AnalysisExportForm.tsx        // 左列表单（profile + privacy + scope）
  AccountNotesEditor.tsx        // 账户备注表格
  buildMarkdown.ts              // 纯函数：JSON payload + form -> string（可单测）
  buildMarkdown.test-fixtures.ts (可选 snapshot fixture)
src/lib/desktopApi.ts            // 加 4 个新 wrapper：
                                  //   queryAnalysisExportSnapshot
                                  //   queryAccountNotes / upsertAccountNote / deleteAccountNote
                                  //   writeAnalysisExportFile
```

### 8.2 类型补充（`desktopApi.ts`）

```ts
export type AnalysisExportSnapshotRequest = {
  year?: string;
  wealth_curve_preset?: string;
  include_consumption_detail?: BoolString;
  fire_withdrawal_rate?: string;
};
export type AnalysisExportSnapshotPayload = LoosePayload;
export type AccountNote = {
  account_id: string;
  holdings_text: string;
  risk_note: string;
  note_text: string;
  updated_at: string;
};
```

### 8.3 状态来源

- 表单 / 选项 / 备注：`useState` + 本地 `localStorage` key `keepwise.desktop.export-profile.v1` + 后端 `account_notes` 表（debounced upsert）。
- 后端聚合数据：`useAsyncQuery` 包裹 `queryAnalysisExportSnapshot`。
- Markdown 字符串：`useMemo(() => buildMarkdown(payload, form, options))`。

### 8.4 `buildMarkdown.ts` 关键约束

- 纯函数，输入只来自 props/参数，**不读 window/不调 invoke**，便于做 snapshot 测试。
- 读取金额走 §4.3 的隐私选项分支。
- 缺数据段落降级（"暂无投资账户记录"），不抛错。
- 输出末尾不自动加多余换行，避免编辑器风格差异。

### 8.5 与全局隐私开关的关系

- 全局隐私开关只影响**屏幕渲染**（mask 为 ****）。
- 导出 Markdown 是"独立隐私决策"，独立选项：
  - 默认 = 当前全局开关（开 -> 默认勾选"不包含具体金额"）；
  - 用户可在导出界面单独覆盖。

### 8.6 入口集成（`src/app/App.tsx` & 路由）

- `PRODUCT_TABS` 加：
  ```ts
  { key: "export-analysis", icon: "↗", label: "导出分析", subtitle: "生成 AI 分析所需的 Markdown 资产快照", status: "ready" },
  ```
- `ProductTabKey` 联合类型补 `"export-analysis"`。
- `WorkspaceContentPanels` 路由分支接入新组件。
- 在"财富总览" / "投资收益"页右上角各放一个"导出 AI 分析"二级入口（点击 -> 切换到该 TAB），降低发现成本。

## 9. 实现里程碑

| 阶段 | 目标 | 主要交付 | 估时（人日） |
|---|---|---|---|
| **M1 数据层** | DB 迁移 + 备注 CRUD + 聚合命令 | 0007 迁移、`account_notes.rs`、`analysis_export.rs`、Rust 单测覆盖空库 / 无投资 / 无消费 三个边界 | 2 |
| **M2 UI MVP** | 表单 + 备注编辑 + Markdown 预览 + 复制 + 保存 | `AnalysisExportSection` + `buildMarkdown` + clipboard 插件接线 | 3 |
| **M3 隐私 / 体验** | 隐私桶化、采样选项、错误边界、多语言文案核对 | 隐私选项分支、`buildMarkdown` snapshot 测试 ≥ 4 个 | 1 |
| **M4 P2：本地 Codex** | 调用 `codex` CLI 直接分析 | `tauri-plugin-shell` 接入、设置面板里配置命令模板、超时与失败回显 | 2 |
| **M5 文档与回归** | README + AGENTS + 用户回归清单更新 | 文档 + `npm run desktop:release:check` 通过 | 0.5 |

## 10. 验证与回归

### 10.1 Rust 单测（在 `analysis_export.rs` 内）

- 空库：聚合命令应返回结构化空段，不 panic；
- 仅有投资数据：消费/收入段落 `summary.*_total = 0`，曲线段落点数 ≥ 1；
- include_consumption_detail = false：payload 中 `consumption.transactions/merchants` 不存在或为空数组；
- 账户备注：upsert 后查得，删除后消失。

### 10.2 前端 snapshot 测试（可选 vitest，不强制）

- `buildMarkdown(samplePayload, baseProfile, baseOptions)` 输出固定字符串；
- 隐私桶化分支：金额段不含 `,` 数字串。

### 10.3 手动回归（追加到 `TAURI_DESKTOP_USER_REGRESSION_CHECKLIST.md`）

- 切到"导出分析"TAB → 显示账户列表
- 给一个投资账户填持仓代码 → 切走再切回 → 备注仍在
- 选 since_inception → 生成预览 → 文档有"### 5.2 账户层" 段
- 复制剪贴板 → 任意编辑器粘贴 → 内容一致
- 保存到 .md → 文件可被 `cat` 出来 → 大小 < 200KB（消费明细关时）
- 关闭"包含具体金额"→ 金额全部变成分桶标签 → 文档不含 `\d{1,3}(,\d{3})+`

### 10.4 自动化

- 在 `npm run desktop:release:check` 链路里：
  - cargo check 自然覆盖编译错；
  - 新增 cargo 单测纳入 `npm run test:rust`；
  - 不需要新的 baseline regression（不是核心 4 接口范畴）。

## 11. 风险与权衡

| 风险 | 触发 | 缓解 |
|---|---|---|
| 用户把含金额的 Markdown 粘到公网 LLM | 默认就是金额可见 | 第一次打开导出 TAB 时弹一次"安全提示"对话框，复制按钮旁也常驻提示 |
| 账户备注与持仓代码错填导致 LLM 误导 | 自由文本输入 | UI 提示"代码请用 6 位 A 股 / 6 位场内基金代码 / xx.HK 港股"；不强校验 |
| 聚合命令耗时（多 invoke 串行） | 大库 | 在 Rust 内部串行实现而非前端 Promise.all，省 IPC 往返；预期 < 800ms |
| `tauri-plugin-shell` 引入扩大攻击面 | 仅 P2 阶段 | capabilities 显式允许 `codex` / `claude` 命令；不接受用户自由命令；命令模板列入白名单 |
| 数据库迁移失败 | 加新表 | 0007 走与 0006 相同流程，迁移前后均可启动；表只 INSERT/UPDATE，不影响现有查询 |

## 12. 后续可拓展（不在本期）

- 模板可选：让用户选"再平衡"/"FIRE 校验"/"风险体检"等不同 prompt 头。
- 把 Markdown 推送到 GitHub Gist / Obsidian Vault。
- 让 LLM 反向回写"建议买入/卖出"之后，KeepWise 内做 dry-run 模拟。
- 多语言导出（en-US 模板）。

---

## 附录 A：示例 invoke 调用顺序（参考）

```ts
// 一次聚合，前端只发 1 次
const snapshot = await queryAnalysisExportSnapshot({
  year: "2026",
  wealth_curve_preset: "since_inception",
  include_consumption_detail: "false",
  fire_withdrawal_rate: "0.04",
});

// 备注：进入 TAB 时，1 次拉取
const notes = await queryAccountNotes({});

// 写文件
await writeAnalysisExportFile({ path, content: markdown });
```

## 附录 B：与现有命令的字段映射对照表

| 导出 Markdown 段 | 现有命令 | 取的字段 |
|---|---|---|
| 净资产摘要表 | `wealth_overview_query` | `summary.investment_total_yuan/cash_total_yuan/real_estate_total_yuan/liability_total_yuan/net_asset_total_yuan`、`as_of`、`stale_account_count` |
| 投资账户行 | `wealth_overview_query.rows[asset_class==investment]` | `account_id/account_name/value_yuan/snapshot_date/stale_days` |
| 现金 / 不动产 / 负债 | 同上 `asset_class` 切换 | 同上 |
| 财富曲线 | `wealth_curve_query` | `rows[].snapshot_date/wealth_total_yuan/net_asset_total_yuan/wealth_net_growth_yuan` |
| 组合 YTD/1y/3y | `investment_return_query`（account_id="__portfolio__"，preset 各取一次） | `metrics.return_rate_pct/annualized_rate_pct/begin_assets_yuan/end_assets_yuan/net_flow_yuan/profit_yuan` |
| 账户层 since_inception | `investment_returns_query`（preset=since_inception） | `rows[].account_name/return_rate_pct/annualized_rate_pct/...` |
| FIRE | `query_fire_progress` | `metrics.coverage_years_text/freedom_ratio_pct_text/required_assets_yuan/goal_gap_yuan` |
| 预算 | `query_budget_overview` | `budget.annual_total_yuan/actual.spent_total_yuan/metrics.usage_rate_pct_text` |
| 月度复盘（可选） | `query_budget_monthly_review` | `rows[].month_key/spent_yuan/variance_yuan/usage_rate` |
| 收入 | `query_salary_income_overview` | `summary.salary_total_yuan/housing_fund_total_yuan`、`employers[]` |
| 消费总览 | `query_consumption_report` | `consumption_total/top_expense_categories/months[]` |
| 账户目录（生成备注表） | `query_account_catalog` | `rows[].account_id/account_name/account_kind/transaction_count` |

