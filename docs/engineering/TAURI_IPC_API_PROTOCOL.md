# Tauri IPC API Protocol — KeepWise Desktop

> 前后端通信协议完整参考。覆盖全部 57 个 Tauri command，按业务域分组。

---

## 目录

1. [命令速查表](#命令速查表)
2. [架构概述](#架构概述)
3. [通信机制](#通信机制)
4. [系统 & 健康检查 (4)](#系统--健康检查)
5. [数据库生命周期 (7)](#数据库生命周期)
6. [数据查询 (4)](#数据查询)
7. [投资分析 (3)](#投资分析)
8. [财富分析 (2)](#财富分析)
9. [预算 & FIRE 分析 (8)](#预算--fire-分析)
10. [账户目录 (3)](#账户目录)
11. [记录变更 (7)](#记录变更)
12. [规则管理 (13)](#规则管理)
13. [数据导入 (6)](#数据导入)
14. [设计模式 & 约定](#设计模式--约定)
15. [优化方向](#优化方向)
16. [前端全貌 — App.tsx & App.css](#前端全貌--apptsx--appcss)

---

## 命令速查表

全部 57 个 Tauri IPC command，按业务域分组。

| # | 命令名 | 用途 |
|---|--------|------|
| | **系统 & 健康检查** | |
| 1 | `health_ping` | 存活检测，返回状态和版本号 |
| 2 | `app_metadata` | 获取应用名称、版本、构建类型等元数据 |
| 3 | `app_paths` | 获取应用各目录路径（数据、配置、日志、缓存） |
| 4 | `runtime_db_health_check` | 运行时数据库健康检查，验证各表数据完整性 |
| | **数据库生命周期** | |
| 5 | `ledger_db_status` | 查询数据库迁移状态（已应用/待执行版本） |
| 6 | `ledger_db_migrate` | 执行待定的数据库迁移 |
| 7 | `ledger_db_import_repo_runtime` | 从仓库 runtime 目录导入预置数据库 |
| 8 | `ledger_db_import_from_path` | 从用户指定路径导入数据库文件 |
| 9 | `ledger_db_admin_stats` | 查询各表行数等管理统计信息 |
| 10 | `ledger_db_admin_reset_all` | 重置全部数据库数据（需确认短语） |
| 11 | `ledger_db_admin_reset_transactions` | 仅重置交易相关数据（需确认短语） |
| | **数据查询** | |
| 12 | `meta_accounts_query` | 查询账户元数据，按类型分组 |
| 13 | `query_transactions` | 多维过滤查询交易记录 |
| 14 | `query_investments` | 查询投资记录快照 |
| 15 | `query_asset_valuations` | 查询资产估值记录 |
| | **投资分析** | |
| 16 | `investment_return_query` | 计算单账户投资收益（Modified Dietz） |
| 17 | `investment_returns_query` | 批量查询多账户投资收益汇总 |
| 18 | `investment_curve_query` | 查询单账户投资净值曲线（时间序列） |
| | **财富分析** | |
| 19 | `wealth_overview_query` | 财富概览快照，按资产类型分组汇总 |
| 20 | `wealth_curve_query` | 财富趋势曲线（时间序列） |
| | **预算 & FIRE 分析** | |
| 21 | `query_monthly_budget_items` | 查询全部月度预算项目 |
| 22 | `upsert_monthly_budget_item` | 新增或更新月度预算项目 |
| 23 | `delete_monthly_budget_item` | 删除月度预算项目 |
| 24 | `query_budget_overview` | 年度预算概览（预算 vs 实际支出） |
| 25 | `query_budget_monthly_review` | 年度预算月度回顾（12 个月逐月对比） |
| 26 | `query_salary_income_overview` | 年度工资收入概览（含公积金） |
| 27 | `query_consumption_report` | 年度消费分析报告（分类/商户/月份/明细） |
| 28 | `query_fire_progress` | FIRE 财务自由进度计算 |
| | **账户目录** | |
| 29 | `query_account_catalog` | 查询账户目录，支持分类和关键词过滤 |
| 30 | `upsert_account_catalog_entry` | 新增或更新账户目录条目 |
| 31 | `delete_account_catalog_entry` | 删除账户目录条目 |
| | **记录变更** | |
| 32 | `update_transaction_analysis_exclusion` | 切换交易的分析排除状态 |
| 33 | `upsert_manual_investment` | 手动录入投资快照 |
| 34 | `update_investment_record` | 更新已有投资记录 |
| 35 | `delete_investment_record` | 删除投资记录 |
| 36 | `upsert_manual_asset_valuation` | 手动录入资产估值 |
| 37 | `update_asset_valuation` | 更新已有资产估值记录 |
| 38 | `delete_asset_valuation` | 删除资产估值记录 |
| | **规则管理（CSV 存储）** | |
| 39 | `query_merchant_map_rules` | 查询商户名映射规则 |
| 40 | `upsert_merchant_map_rule` | 新增或更新商户映射规则 |
| 41 | `delete_merchant_map_rule` | 删除商户映射规则 |
| 42 | `query_category_rules` | 查询分类规则 |
| 43 | `upsert_category_rule` | 新增或更新分类规则 |
| 44 | `delete_category_rule` | 删除分类规则 |
| 45 | `query_bank_transfer_whitelist_rules` | 查询银行转账白名单 |
| 46 | `upsert_bank_transfer_whitelist_rule` | 新增或更新转账白名单条目 |
| 47 | `delete_bank_transfer_whitelist_rule` | 删除转账白名单条目 |
| 48 | `query_analysis_exclusion_rules` | 查询分析排除规则 |
| 49 | `upsert_analysis_exclusion_rule` | 新增或更新分析排除规则 |
| 50 | `delete_analysis_exclusion_rule` | 删除分析排除规则 |
| 51 | `query_merchant_rule_suggestions` | 发现未映射的高频商户，生成映射建议 |
| | **数据导入** | |
| 52 | `cmb_eml_preview` | 预览招行信用卡账单邮件（EML）解析结果 |
| 53 | `cmb_eml_import` | 导入招行信用卡账单到数据库 |
| 54 | `cmb_bank_pdf_preview` | 预览招行借记卡对账单（PDF）解析结果 |
| 55 | `cmb_bank_pdf_import` | 导入招行借记卡对账单到数据库 |
| 56 | `yzxy_preview_file` | 预览有知有行投资数据文件（CSV/XLSX） |
| 57 | `yzxy_import_file` | 导入有知有行投资数据到数据库 |

---

## 架构概述

```
┌──────────────────────────────────────────────────┐
│  React 19 Frontend (App.tsx, ~10K lines)         │
│  ┌────────────────────────────────────────────┐  │
│  │  desktopApi.ts — 48 typed invoke wrappers  │  │
│  │  normalizeTauriValue() — BigInt→Number     │  │
│  └─────────────────┬──────────────────────────┘  │
│                    │ invoke("cmd", { req })       │
├────────────────────┼─────────────────────────────┤
│  Tauri v2 IPC      │ JSON-serialized             │
├────────────────────┼─────────────────────────────┤
│  Rust Backend      ▼                             │
│  ┌────────────────────────────────────────────┐  │
│  │  lib.rs — 57 commands in generate_handler! │  │
│  │  13 source modules (flat, one per domain)  │  │
│  ├────────────────────────────────────────────┤  │
│  │  SQLite (ledger.db)  │  CSV files (rules/) │  │
│  └────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

**关键文件：**

| 层级 | 文件 | 说明 |
|------|------|------|
| 前端 API 层 | `src/lib/desktopApi.ts` | 全部 invoke 封装，TS 类型定义 |
| 命令注册 | `src-tauri/src/lib.rs` | 模块声明 + `generate_handler![]` |
| 系统命令 | `src-tauri/src/commands.rs` | health_ping, app_metadata, app_paths |
| 运行时健康 | `src-tauri/src/admin_health.rs` | runtime_db_health_check |
| 数据库管理 | `src-tauri/src/ledger_db.rs` | 迁移、导入、重置 |
| 数据查询 | `src-tauri/src/read_queries.rs` | 账户/交易/投资/估值查询 |
| 交易变更 | `src-tauri/src/transaction_mutations.rs` | 分析排除切换 |
| 投资分析 | `src-tauri/src/investment_analytics.rs` | 收益率 (Modified Dietz)、曲线 |
| 财富分析 | `src-tauri/src/wealth_analytics.rs` | 财富概览、趋势曲线 |
| 预算/FIRE | `src-tauri/src/budget_fire_analytics.rs` | 预算、收入、消费、FIRE |
| 记录变更 | `src-tauri/src/record_mutations.rs` | 投资/估值 CRUD |
| 账户目录 | `src-tauri/src/account_catalog.rs` | 账户目录 CRUD |
| 规则管理 | `src-tauri/src/rules_management.rs` | 商户映射/分类/白名单/排除 (CSV) |
| 规则存储 | `src-tauri/src/rules_store.rs` | 规则目录初始化 & seed |
| 招行信用卡 | `src-tauri/src/cmb_eml_import.rs` | EML 解析 & 导入 |
| 招行借记卡 | `src-tauri/src/cmb_bank_pdf_import.rs` | PDF 解析 & 导入 |
| 有知有行 | `src-tauri/src/yzxy_import.rs` | CSV/XLSX 解析 & 导入 |

---

## 通信机制

### 调用模式

```typescript
// 前端 (desktopApi.ts)
export async function queryTransactions(req: TransactionsQueryRequest) {
  const raw = await invoke<unknown>("query_transactions", { req });
  return normalizeTauriValue(raw);
}
```

```rust
// 后端 (read_queries.rs)
#[tauri::command]
pub fn query_transactions(
    app: AppHandle,
    req: TransactionsQueryRequest,
) -> Result<Value, String> {
    let db_path = resolve_ledger_db_path(&app)?;
    let conn = Connection::open(&db_path).map_err(|e| format!("打开数据库失败: {e}"))?;
    // ... query logic
    Ok(serde_json::json!({ "summary": {...}, "rows": [...] }))
}
```

### 核心约定

| 约定 | 说明 |
|------|------|
| **调用方式** | `invoke<T>("command_name", { req })` — 全部通过单一 `req` 对象传参 |
| **返回类型** | Rust 统一返回 `Result<Value, String>`，无自定义错误类型 |
| **请求结构** | `#[derive(Debug, Deserialize)]` 结构体，字段均为 `Option<String>` |
| **响应构造** | `serde_json::json!({})` 宏直接构建，无 typed response struct |
| **BigInt 处理** | `normalizeTauriValue()` 递归将 BigInt 转换为 Number |
| **金额约定** | 存储单位为**分 (cents, i64)**，响应同时返回 `_cents` 和 `_yuan` 字段 |
| **错误消息** | 中文描述，`.map_err(\|e\| format!("描述: {e}"))` |
| **DB 解析** | 命令内部调用 `resolve_ledger_db_path(&app)` 获取 DB 路径 |
| **无 DB 命令** | `health_ping`, `app_metadata`, `app_paths` 不访问数据库 |
| **规则存储** | 商户映射/分类/白名单等存储在 CSV 文件中，非 SQLite |

### 前端类型策略

- 请求类型：严格定义（`type TransactionsQueryRequest = { ... }`）
- 响应类型：多数标注为 `unknown`，使用运行时辅助函数提取：
  - `isRecord(v)` — 检查是否为对象
  - `readNumber(obj, key)` / `readString(obj, key)` / `readArray(obj, key)` — 安全取值

---

## 系统 & 健康检查

### `health_ping`

基础存活检测，无 DB 访问。

| 项目 | 值 |
|------|---|
| **Rust 模块** | `commands.rs` |
| **TS 封装** | `healthPing()` |
| **请求** | 无参数 |
| **响应** | `{ status: "ok", timestamp: string, version: string }` |

### `app_metadata`

返回应用元数据。

| 项目 | 值 |
|------|---|
| **Rust 模块** | `commands.rs` |
| **TS 封装** | `appMetadata()` |
| **请求** | 无参数 |
| **响应** | `{ app_name, version, tauri_version, build_type }` |

### `app_paths`

返回应用关键目录路径。

| 项目 | 值 |
|------|---|
| **Rust 模块** | `commands.rs` |
| **TS 封装** | `appPaths()` |
| **请求** | 无参数 |
| **响应** | `{ app_local_data_dir, app_config_dir, app_data_dir, app_log_dir, app_cache_dir }` |

### `runtime_db_health_check`

运行时数据库健康检查，执行多个子查询验证各表数据。

| 项目 | 值 |
|------|---|
| **Rust 模块** | `admin_health.rs` |
| **TS 封装** | `runtimeDbHealthCheck()` |
| **请求** | 无参数 |
| **响应** | 见下 |

```json
{
  "db_path": "/path/to/ledger.db",
  "status": "healthy",
  "checks": [
    { "name": "accounts", "status": "ok", "count": 5, "details": "..." },
    { "name": "categories", "status": "ok", "count": 20 },
    { "name": "transactions", "status": "ok", "count": 1500 },
    { "name": "investment_records", "status": "ok", "count": 200 },
    { "name": "account_valuations", "status": "ok", "count": 50 }
  ],
  "summary": { "total_checks": 5, "passed": 5, "failed": 0 }
}
```

---

## 数据库生命周期

### `ledger_db_status`

查询数据库迁移状态。

| 项目 | 值 |
|------|---|
| **Rust 模块** | `ledger_db.rs` |
| **TS 封装** | `ledgerDbStatus()` |
| **请求** | 无参数 |

```json
{
  "db_path": "/path/to/ledger.db",
  "exists": true,
  "migration_files": ["0001_initial.sql", "0002_add_indexes.sql"],
  "applied_versions": ["0001", "0002"],
  "pending_versions": [],
  "ready": true
}
```

### `ledger_db_migrate`

执行待定的数据库迁移。

| 项目 | 值 |
|------|---|
| **Rust 模块** | `ledger_db.rs` |
| **TS 封装** | `ledgerDbMigrate()` |
| **请求** | 无参数 |

```json
{
  "db_path": "/path/to/ledger.db",
  "created": false,
  "applied_now": ["0003_new_table.sql"],
  "skipped": [],
  "applied_total": 3,
  "pending_total": 0
}
```

### `ledger_db_import_repo_runtime`

从仓库 runtime 目录导入预置数据库。

| 项目 | 值 |
|------|---|
| **Rust 模块** | `ledger_db.rs` |
| **TS 封装** | `ledgerDbImportRepoRuntime()` |
| **请求** | 无参数 |

```json
{
  "source_db_path": "/repo/db/ledger.db",
  "target_db_path": "/app-data/ledger.db",
  "replaced_existing": true,
  "copied_bytes": 1048576,
  "migrate_result": { "applied_now": [], "applied_total": 6, "pending_total": 0 }
}
```

### `ledger_db_import_from_path`

从用户指定路径导入数据库文件。

| 项目 | 值 |
|------|---|
| **Rust 模块** | `ledger_db.rs` |
| **TS 封装** | `ledgerDbImportFromPath(req)` |
| **请求** | `{ source_path: string }` |
| **响应** | 同 `ledger_db_import_repo_runtime` |

### `ledger_db_admin_stats`

查询数据库管理统计信息（各表行数）。

| 项目 | 值 |
|------|---|
| **Rust 模块** | `ledger_db.rs` |
| **TS 封装** | `ledgerDbAdminStats()` |
| **请求** | 无参数 |

```json
{
  "db_path": "/path/to/ledger.db",
  "confirm_phrase": "RESET-ALL",
  "summary": { "table_count": 8, "total_rows": 2500 },
  "rows": [
    { "table_name": "transactions", "row_count": 1500 },
    { "table_name": "investment_records", "row_count": 200 }
  ]
}
```

### `ledger_db_admin_reset_all`

**危险操作**：重置全部数据库数据。需确认短语。

| 项目 | 值 |
|------|---|
| **Rust 模块** | `ledger_db.rs` |
| **TS 封装** | `ledgerDbAdminResetAll(req)` |
| **请求** | `{ confirm_text: string }` — 必须匹配确认短语 |

```json
{
  "summary": { "deleted_rows": 2500, "tables_cleared": 8 },
  "before_rows": [{ "table_name": "transactions", "row_count": 1500 }],
  "after_rows": [{ "table_name": "transactions", "row_count": 0 }]
}
```

### `ledger_db_admin_reset_transactions`

**危险操作**：仅重置交易相关数据（transactions, reconciliations, import_jobs）。

| 项目 | 值 |
|------|---|
| **Rust 模块** | `ledger_db.rs` |
| **TS 封装** | `ledgerDbAdminResetTransactions(req)` |
| **请求** | `{ confirm_text: string }` |
| **响应** | 同 `ledger_db_admin_reset_all`，但仅含交易相关表 |

---

## 数据查询

### `meta_accounts_query`

查询账户元数据，按类型分组返回。

| 项目 | 值 |
|------|---|
| **Rust 模块** | `read_queries.rs` |
| **TS 封装** | `metaAccountsQuery(req)` |
| **请求** | `{ kind?: string }` — 可选过滤：`"investment"`, `"cash"`, `"real_estate"`, `"liability"` |

```json
{
  "kind": "all",
  "accounts": [{ "account_id": "...", "account_name": "...", "kind": "investment" }],
  "investment_accounts": [...],
  "cash_accounts": [...],
  "real_estate_accounts": [...],
  "liability_accounts": [...]
}
```

### `query_transactions`

查询交易记录，支持多维过滤和排序。

| 项目 | 值 |
|------|---|
| **Rust 模块** | `read_queries.rs` |
| **TS 封装** | `queryTransactions(req)` |

**请求参数：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `limit` | `Option<String>` | 返回行数限制 |
| `month_key` | `Option<String>` | 月份过滤 `"2025-01"` |
| `source_type` | `Option<String>` | 来源类型过滤 |
| `account_id` | `Option<String>` | 账户过滤 |
| `keyword` | `Option<String>` | 关键词搜索（商户名/备注） |
| `sort` | `Option<String>` | 排序方式 |

```json
{
  "summary": {
    "count": 150,
    "total_amount_cents": -50000,
    "total_amount_yuan": "-500.00"
  },
  "rows": [{
    "id": "tx_abc123",
    "tx_date": "2025-01-15",
    "merchant": "星巴克",
    "amount_cents": -3500,
    "amount_yuan": "-35.00",
    "category": "餐饮",
    "source_type": "cmb_credit",
    "account_id": "...",
    "excluded_in_analysis": false
  }]
}
```

### `query_investments`

查询投资记录快照。

| 项目 | 值 |
|------|---|
| **Rust 模块** | `read_queries.rs` |
| **TS 封装** | `queryInvestments(req)` |

**请求参数：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `limit` | `Option<String>` | 行数限制 |
| `from` | `Option<String>` | 起始日期 |
| `to` | `Option<String>` | 结束日期 |
| `source_type` | `Option<String>` | 来源类型 |
| `account_id` | `Option<String>` | 账户过滤 |

```json
{
  "summary": {
    "count": 50,
    "latest_total_assets_cents": 10000000,
    "net_transfer_amount_cents": 8000000
  },
  "rows": [{
    "id": "inv_001",
    "snapshot_date": "2025-01-01",
    "account_id": "...",
    "account_name": "沪深300",
    "total_assets_cents": 10000000,
    "total_assets_yuan": "100,000.00",
    "transfer_amount_cents": 5000,
    "transfer_amount_yuan": "50.00",
    "source_type": "yzxy"
  }]
}
```

### `query_asset_valuations`

查询资产估值记录。

| 项目 | 值 |
|------|---|
| **Rust 模块** | `read_queries.rs` |
| **TS 封装** | `queryAssetValuations(req)` |

**请求参数：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `limit` | `Option<String>` | 行数限制 |
| `from` / `to` | `Option<String>` | 日期范围 |
| `asset_class` | `Option<String>` | 资产类型过滤 |
| `account_id` | `Option<String>` | 账户过滤 |

```json
{
  "summary": { "count": 20, "sum_value_cents": 50000000 },
  "rows": [{
    "id": "val_001",
    "snapshot_date": "2025-01-01",
    "asset_class": "real_estate",
    "account_id": "...",
    "account_name": "自住房产",
    "value_cents": 50000000,
    "value_yuan": "500,000.00"
  }]
}
```

---

## 投资分析

### `investment_return_query`

计算单个账户的投资收益（Modified Dietz 方法）。

| 项目 | 值 |
|------|---|
| **Rust 模块** | `investment_analytics.rs` |
| **TS 封装** | `investmentReturnQuery(req)` |

**请求参数：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `account_id` | `Option<String>` | 账户 ID（空则计算组合） |
| `preset` | `Option<String>` | 预设时段：`"ytd"`, `"1y"`, `"3y"`, `"max"` 等 |
| `from` / `to` | `Option<String>` | 自定义日期范围 |

```json
{
  "account_id": "...",
  "account_name": "沪深300",
  "range": {
    "preset": "ytd",
    "effective_from": "2025-01-01",
    "effective_to": "2025-06-15",
    "interval_days": 166
  },
  "metrics": {
    "begin_assets_cents": 10000000,
    "end_assets_cents": 11500000,
    "net_transfer_cents": 200000,
    "profit_cents": 1300000,
    "profit_yuan": "13,000.00",
    "return_rate": 0.1285,
    "return_rate_pct": "12.85%",
    "annualized_rate": 0.2950,
    "annualized_rate_pct": "29.50%"
  },
  "cash_flows": [
    { "date": "2025-03-01", "amount_cents": 100000, "direction": "in" }
  ]
}
```

### `investment_returns_query`

批量查询多个账户的投资收益汇总。

| 项目 | 值 |
|------|---|
| **Rust 模块** | `investment_analytics.rs` |
| **TS 封装** | `investmentReturnsQuery(req)` |

**请求参数：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `preset` | `Option<String>` | 预设时段 |
| `from` / `to` | `Option<String>` | 自定义范围 |
| `keyword` | `Option<String>` | 账户名关键词 |
| `limit` | `Option<String>` | 结果数量限制 |

```json
{
  "rows": [{
    "account_id": "...",
    "account_name": "沪深300",
    "return_rate": 0.1285,
    "annualized_rate": 0.2950,
    "profit_cents": 1300000,
    "begin_assets_cents": 10000000,
    "end_assets_cents": 11500000
  }],
  "errors": []
}
```

### `investment_curve_query`

查询单个账户的投资净值曲线（时间序列）。

| 项目 | 值 |
|------|---|
| **Rust 模块** | `investment_analytics.rs` |
| **TS 封装** | `investmentCurveQuery(req)` |

**请求参数：** 同 `investment_return_query`

```json
{
  "account_id": "...",
  "range": { "preset": "1y", "effective_from": "...", "effective_to": "..." },
  "summary": {
    "count": 52,
    "change_cents": 1300000,
    "end_cumulative_return_rate": 0.1285
  },
  "rows": [
    { "date": "2025-01-07", "total_assets_cents": 10050000, "cumulative_return_rate": 0.005 }
  ]
}
```

---

## 财富分析

### `wealth_overview_query`

财富概览快照，按资产类型分组。

| 项目 | 值 |
|------|---|
| **Rust 模块** | `wealth_analytics.rs` |
| **TS 封装** | `wealthOverviewQuery(req)` |

**请求参数：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `as_of` | `Option<String>` | 截止日期（默认今天） |
| `include_investment` | `Option<String>` | `"true"/"false"` 是否包含投资类 |
| `include_cash` | `Option<String>` | 是否包含现金类 |
| `include_real_estate` | `Option<String>` | 是否包含不动产 |
| `include_liability` | `Option<String>` | 是否包含负债 |

```json
{
  "as_of": "2025-06-15",
  "filters": { "include_investment": true, "include_cash": true, ... },
  "summary": {
    "investment_total_cents": 50000000,
    "cash_total_cents": 20000000,
    "real_estate_total_cents": 300000000,
    "liability_total_cents": -100000000,
    "net_asset_total_cents": 270000000,
    "net_asset_total_yuan": "2,700,000.00"
  },
  "rows": [{
    "account_id": "...",
    "account_name": "沪深300",
    "asset_class": "investment",
    "value_cents": 10000000,
    "snapshot_date": "2025-06-15"
  }]
}
```

### `wealth_curve_query`

财富趋势曲线（时间序列），按资产类型可选过滤。

| 项目 | 值 |
|------|---|
| **Rust 模块** | `wealth_analytics.rs` |
| **TS 封装** | `wealthCurveQuery(req)` |

**请求参数：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `preset` | `Option<String>` | 预设时段 |
| `from` / `to` | `Option<String>` | 自定义范围 |
| `include_investment` | `Option<String>` | 过滤投资类 |
| `include_cash` | `Option<String>` | 过滤现金类 |
| `include_real_estate` | `Option<String>` | 过滤不动产 |
| `include_liability` | `Option<String>` | 过滤负债 |

```json
{
  "range": { "preset": "1y", "effective_from": "...", "effective_to": "..." },
  "filters": { ... },
  "summary": {
    "start_wealth_cents": 250000000,
    "end_wealth_cents": 270000000,
    "change_cents": 20000000,
    "change_pct": 0.08,
    "investment_start_cents": 45000000,
    "investment_end_cents": 50000000,
    "cash_start_cents": 18000000,
    "cash_end_cents": 20000000
  },
  "rows": [
    { "date": "2025-01-01", "total_cents": 250000000, "investment_cents": 45000000, "cash_cents": 18000000 }
  ]
}
```

---

## 预算 & FIRE 分析

### `query_monthly_budget_items`

查询全部月度预算项目。

| 项目 | 值 |
|------|---|
| **Rust 模块** | `budget_fire_analytics.rs` |
| **TS 封装** | `queryMonthlyBudgetItems(req)` |
| **请求** | `{}` 空对象 |

```json
{
  "summary": {
    "total_count": 10,
    "active_count": 8,
    "monthly_budget_total_cents": 1500000,
    "annual_budget_cents": 18000000
  },
  "rows": [{
    "id": "budget_001",
    "name": "餐饮",
    "monthly_amount_cents": 300000,
    "monthly_amount_yuan": "3,000.00",
    "sort_order": 1,
    "is_active": true
  }]
}
```

### `upsert_monthly_budget_item`

新增或更新月度预算项目。

| 项目 | 值 |
|------|---|
| **Rust 模块** | `budget_fire_analytics.rs` |
| **TS 封装** | `upsertMonthlyBudgetItem(req)` |

**请求参数：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `Option<String>` | 已有项目 ID（空则新增） |
| `name` | `Option<String>` | 预算项名称 |
| `monthly_amount` | `Option<String>` | 月度金额（元） |
| `sort_order` | `Option<String>` | 排序序号 |
| `is_active` | `Option<String>` | `"true"/"false"` |

**响应**：返回 upsert 后的完整预算项目 JSON。

### `delete_monthly_budget_item`

删除月度预算项目。

| 项目 | 值 |
|------|---|
| **Rust 模块** | `budget_fire_analytics.rs` |
| **TS 封装** | `deleteMonthlyBudgetItem(req)` |
| **请求** | `{ id: string }` |
| **响应** | `{ id, name, deleted: true }` |

### `query_budget_overview`

年度预算概览：预算 vs 实际支出。

| 项目 | 值 |
|------|---|
| **Rust 模块** | `budget_fire_analytics.rs` |
| **TS 封装** | `queryBudgetOverview(req)` |
| **请求** | `{ year: string }` — 如 `"2025"` |

```json
{
  "year": "2025",
  "budget": {
    "monthly_total_cents": 1500000,
    "annual_total_cents": 18000000,
    "ytd_budget_cents": 9000000
  },
  "actual": {
    "spent_total_cents": 8500000
  },
  "metrics": {
    "usage_rate": 0.9444,
    "ytd_variance_cents": 500000
  }
}
```

### `query_budget_monthly_review`

年度预算月度回顾（12 个月逐月对比）。

| 项目 | 值 |
|------|---|
| **Rust 模块** | `budget_fire_analytics.rs` |
| **TS 封装** | `queryBudgetMonthlyReview(req)` |
| **请求** | `{ year: string }` |

```json
{
  "year": "2025",
  "summary": {
    "annual_budget_cents": 18000000,
    "annual_spent_cents": 17000000,
    "over_budget_months": 3
  },
  "rows": [{
    "month": "2025-01",
    "budget_cents": 1500000,
    "spent_cents": 1600000,
    "variance_cents": -100000,
    "over_budget": true
  }]
}
```

### `query_salary_income_overview`

年度工资收入概览（含公积金、雇主维度）。

| 项目 | 值 |
|------|---|
| **Rust 模块** | `budget_fire_analytics.rs` |
| **TS 封装** | `querySalaryIncomeOverview(req)` |
| **请求** | `{ year: string }` |

```json
{
  "year": "2025",
  "summary": {
    "salary_total_cents": 36000000,
    "housing_fund_total_cents": 3600000,
    "total_income_cents": 39600000
  },
  "employers": [{ "name": "公司A", "salary_cents": 36000000 }],
  "rows": [{
    "month": "2025-01",
    "salary_cents": 3000000,
    "housing_fund_cents": 300000
  }]
}
```

### `query_consumption_report`

年度消费分析报告：按分类、商户、月份多维度汇总，含交易明细。

| 项目 | 值 |
|------|---|
| **Rust 模块** | `budget_fire_analytics.rs` |
| **TS 封装** | `queryConsumptionReport(req)` |
| **请求** | `{ year?: string }` — 可选年份，空则返回全部 |

```json
{
  "available_years": ["2023", "2024", "2025"],
  "year": "2025",
  "consumption_count": 500,
  "consumption_total": { "cents": -15000000, "yuan": "-150,000.00" },
  "categories": [{
    "category": "餐饮",
    "count": 120,
    "total_cents": -3600000,
    "total_yuan": "-36,000.00",
    "pct": 0.24
  }],
  "months": [{
    "month": "2025-01",
    "count": 45,
    "total_cents": -1200000
  }],
  "merchants": [{
    "merchant": "星巴克",
    "count": 30,
    "total_cents": -900000
  }],
  "transactions": [{
    "id": "tx_001",
    "tx_date": "2025-01-15",
    "merchant": "星巴克",
    "amount_cents": -3500,
    "amount_yuan": "-35.00",
    "category": "餐饮"
  }]
}
```

### `query_fire_progress`

FIRE（财务自由）进度计算。

| 项目 | 值 |
|------|---|
| **Rust 模块** | `budget_fire_analytics.rs` |
| **TS 封装** | `queryFireProgress(req)` |

**请求参数：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `year` | `Option<String>` | 年份 |
| `withdrawal_rate` | `Option<String>` | 年提取率（如 `"0.04"` 即 4%） |

```json
{
  "withdrawal_rate": 0.04,
  "budget": {
    "annual_budget_cents": 18000000,
    "annual_budget_yuan": "180,000.00"
  },
  "investable_assets": {
    "total_cents": 50000000,
    "total_yuan": "500,000.00"
  },
  "metrics": {
    "coverage_years": 11.1,
    "freedom_ratio": 0.444,
    "required_assets_cents": 450000000,
    "required_assets_yuan": "4,500,000.00",
    "goal_gap_cents": 400000000,
    "goal_gap_yuan": "4,000,000.00"
  }
}
```

---

## 账户目录

### `query_account_catalog`

查询账户目录，支持分类过滤和关键词搜索。

| 项目 | 值 |
|------|---|
| **Rust 模块** | `account_catalog.rs` |
| **TS 封装** | `queryAccountCatalog(req)` |

**请求参数：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `kind` | `Option<String>` | 账户类型过滤 |
| `keyword` | `Option<String>` | 关键词搜索 |
| `limit` | `Option<String>` | 行数限制 |

```json
{
  "summary": { "count": 15 },
  "rows": [{
    "account_id": "...",
    "account_name": "沪深300",
    "account_kind": "investment",
    "created_at": "2025-01-01"
  }],
  "groups": {
    "investment": [...],
    "cash": [...],
    "real_estate": [...],
    "liability": [...]
  }
}
```

### `upsert_account_catalog_entry`

新增或更新账户目录条目。

| 项目 | 值 |
|------|---|
| **Rust 模块** | `account_catalog.rs` |
| **TS 封装** | `upsertAccountCatalogEntry(req)` |
| **请求** | `{ account_id?: string, account_name: string, account_kind: string }` |
| **响应** | `{ created: bool, updated: bool, row: {...} }` |

### `delete_account_catalog_entry`

删除账户目录条目。

| 项目 | 值 |
|------|---|
| **Rust 模块** | `account_catalog.rs` |
| **TS 封装** | `deleteAccountCatalogEntry(req)` |
| **请求** | `{ account_id: string }` |
| **响应** | `{ deleted: true, account_id, account_name }` |

---

## 记录变更

### `update_transaction_analysis_exclusion`

切换交易的分析排除状态。

| 项目 | 值 |
|------|---|
| **Rust 模块** | `transaction_mutations.rs` |
| **TS 封装** | `updateTransactionAnalysisExclusion(req)` |
| **请求** | `{ id: string, excluded_in_analysis: string, exclude_reason?: string }` |
| **响应** | `{ id, excluded_in_analysis: bool, exclude_reason, updated: true }` |

### `upsert_manual_investment`

手动录入投资快照。

| 项目 | 值 |
|------|---|
| **Rust 模块** | `record_mutations.rs` |
| **TS 封装** | `upsertManualInvestment(req)` |

**请求参数：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `snapshot_date` | `Option<String>` | 快照日期 |
| `account_id` | `Option<String>` | 账户 ID |
| `account_name` | `Option<String>` | 账户名 |
| `total_assets` | `Option<String>` | 总资产（元） |
| `transfer_amount` | `Option<String>` | 转入/转出金额（元） |

**响应**：`{ account_id, account_name, snapshot_date }`

### `update_investment_record`

更新已有投资记录。

| 项目 | 值 |
|------|---|
| **Rust 模块** | `record_mutations.rs` |
| **TS 封装** | `updateInvestmentRecord(req)` |
| **请求** | `{ id, snapshot_date, account_id, account_name, total_assets, transfer_amount }` — 全部 `Option<String>` |
| **响应** | `{ id, account_id, snapshot_date, total_assets_cents, transfer_amount_cents }` |

### `delete_investment_record`

删除投资记录。

| 项目 | 值 |
|------|---|
| **Rust 模块** | `record_mutations.rs` |
| **TS 封装** | `deleteInvestmentRecord(req)` |
| **请求** | `{ id: string }` |
| **响应** | `{ id, deleted: true }` |

### `upsert_manual_asset_valuation`

手动录入资产估值。

| 项目 | 值 |
|------|---|
| **Rust 模块** | `record_mutations.rs` |
| **TS 封装** | `upsertManualAssetValuation(req)` |

**请求参数：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `asset_class` | `Option<String>` | 资产类型 |
| `snapshot_date` | `Option<String>` | 快照日期 |
| `account_id` | `Option<String>` | 账户 ID |
| `account_name` | `Option<String>` | 账户名 |
| `value` | `Option<String>` | 估值（元） |

**响应**：`{ account_id, asset_class, snapshot_date, value_cents }`

### `update_asset_valuation`

更新已有资产估值记录。

| 项目 | 值 |
|------|---|
| **Rust 模块** | `record_mutations.rs` |
| **TS 封装** | `updateAssetValuation(req)` |
| **请求** | `{ id, asset_class, snapshot_date, account_id, account_name, value }` — 全部 `Option<String>` |
| **响应** | 同 `upsert_manual_asset_valuation` + `id` 字段 |

### `delete_asset_valuation`

删除资产估值记录。

| 项目 | 值 |
|------|---|
| **Rust 模块** | `record_mutations.rs` |
| **TS 封装** | `deleteAssetValuation(req)` |
| **请求** | `{ id: string }` |
| **响应** | `{ id, deleted: true }` |

---

## 规则管理

> 规则数据存储在 **CSV 文件**中（非 SQLite），位于应用本地规则目录。
> 首次运行时从仓库 `data/rules/` seed 初始数据（`rules_store.rs`）。

### 商户映射规则 (Merchant Map)

将原始商户名映射到标准化商户名。

#### `query_merchant_map_rules`

| 项目 | 值 |
|------|---|
| **Rust 模块** | `rules_management.rs` |
| **TS 封装** | `queryMerchantMapRules()` |
| **请求** | 无参数 |
| **响应** | `{ count, rows: [{ raw_merchant, mapped_merchant, category }] }` |

#### `upsert_merchant_map_rule`

| 项目 | 值 |
|------|---|
| **Rust 模块** | `rules_management.rs` |
| **TS 封装** | `upsertMerchantMapRule(req)` |
| **请求** | `{ raw_merchant, mapped_merchant, category }` |
| **响应** | `{ upserted: true, row: {...} }` |

#### `delete_merchant_map_rule`

| 项目 | 值 |
|------|---|
| **Rust 模块** | `rules_management.rs` |
| **TS 封装** | `deleteMerchantMapRule(req)` |
| **请求** | `{ raw_merchant: string }` |
| **响应** | `{ deleted: true, raw_merchant }` |

### 分类规则 (Category Rules)

基于关键词自动分类交易。

#### `query_category_rules`

| **TS 封装** | `queryCategoryRules()` |
| **响应** | `{ count, rows: [{ keyword, category, priority }] }` |

#### `upsert_category_rule`

| **请求** | `{ keyword, category, priority }` |
| **响应** | `{ upserted: true, row: {...} }` |

#### `delete_category_rule`

| **请求** | `{ keyword: string }` |
| **响应** | `{ deleted: true, keyword }` |

### 银行转账白名单 (Bank Transfer Whitelist)

标记特定交易为银行间转账（排除消费统计）。

#### `query_bank_transfer_whitelist_rules`

| **TS 封装** | `queryBankTransferWhitelistRules()` |
| **响应** | `{ count, rows: [{ merchant, note }] }` |

#### `upsert_bank_transfer_whitelist_rule`

| **请求** | `{ merchant, note }` |
| **响应** | `{ upserted: true, row: {...} }` |

#### `delete_bank_transfer_whitelist_rule`

| **请求** | `{ merchant: string }` |
| **响应** | `{ deleted: true, merchant }` |

### 分析排除规则 (Analysis Exclusion Rules)

排除特定交易不计入分析。

#### `query_analysis_exclusion_rules`

| **TS 封装** | `queryAnalysisExclusionRules()` |
| **响应** | `{ count, rows: [{ merchant, reason }] }` |

#### `upsert_analysis_exclusion_rule`

| **请求** | `{ merchant, reason }` |
| **响应** | `{ upserted: true, row: {...} }` |

#### `delete_analysis_exclusion_rule`

| **请求** | `{ merchant: string }` |
| **响应** | `{ deleted: true, merchant }` |

### 商户规则建议

#### `query_merchant_rule_suggestions`

将已有商户映射规则与 DB 中的交易记录 JOIN，找出尚未映射的高频商户。

| 项目 | 值 |
|------|---|
| **Rust 模块** | `rules_management.rs` |
| **TS 封装** | `queryMerchantRuleSuggestions()` |
| **请求** | 无参数 |
| **响应** | `{ count, rows: [{ raw_merchant, tx_count, sample_amount_cents }] }` |

---

## 数据导入

### 招商银行信用卡 (CMB Credit Card EML)

解析招行信用卡账单邮件（EML 格式）中的 HTML 表格。

#### `cmb_eml_preview`

| 项目 | 值 |
|------|---|
| **Rust 模块** | `cmb_eml_import.rs` |
| **TS 封装** | `cmbEmlPreview(req)` |

**请求参数：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `source_path` | `Option<String>` | EML 文件/目录路径 |
| `review_threshold` | `Option<String>` | 需人工审核的金额阈值（元） |

```json
{
  "source_path": "/path/to/eml",
  "review_threshold": 500.0,
  "summary": {
    "input_files_count": 3,
    "records_count": 150,
    "consume_count": 140,
    "needs_review_count": 5,
    "excluded_count": 5,
    "preview_rows": [{
      "tx_date": "2025-01-15",
      "merchant": "星巴克",
      "amount_cents": -3500,
      "category": "餐饮",
      "needs_review": false
    }]
  }
}
```

#### `cmb_eml_import`

| 项目 | 值 |
|------|---|
| **Rust 模块** | `cmb_eml_import.rs` |
| **TS 封装** | `cmbEmlImport(req)` |

**请求参数：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `source_path` | `Option<String>` | EML 文件/目录路径 |
| `review_threshold` | `Option<String>` | 审核阈值 |
| `source_type` | `Option<String>` | 来源标识（如 `"cmb_credit"`) |

```json
{
  "db_path": "/path/to/ledger.db",
  "imported_count": 140,
  "import_error_count": 2,
  "import_job_id": "job_abc123",
  "summary": { ... },
  "error_samples": [{ "line": 45, "error": "日期解析失败" }]
}
```

### 招商银行借记卡 (CMB Bank PDF)

解析招行借记卡对账单 PDF。

#### `cmb_bank_pdf_preview`

| 项目 | 值 |
|------|---|
| **Rust 模块** | `cmb_bank_pdf_import.rs` |
| **TS 封装** | `cmbBankPdfPreview(req)` |

**请求参数：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `source_path` | `Option<String>` | PDF 文件路径 |
| `review_threshold` | `Option<String>` | 审核阈值 |

```json
{
  "header": {
    "account_last4": "1234",
    "range_start": "2025-01-01",
    "range_end": "2025-01-31"
  },
  "summary": {
    "total_records": 50,
    "import_rows_count": 45,
    "expense_count": 30,
    "expense_total_cents": -5000000,
    "income_count": 15,
    "income_total_cents": 8000000
  },
  "rule_counts": { "merchant_map": 20, "bank_transfer": 5 },
  "mortgage_profiles": [{ "merchant": "住房贷款", "monthly_cents": -500000 }],
  "samples": [...]
}
```

#### `cmb_bank_pdf_import`

| 项目 | 值 |
|------|---|
| **Rust 模块** | `cmb_bank_pdf_import.rs` |
| **TS 封装** | `cmbBankPdfImport(req)` |

**请求参数：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `source_path` | `Option<String>` | PDF 文件路径 |
| `review_threshold` | `Option<String>` | 审核阈值 |
| `source_type` | `Option<String>` | 来源标识 |

```json
{
  "db_path": "/path/to/ledger.db",
  "imported_count": 45,
  "import_error_count": 0,
  "import_job_id": "job_def456",
  "preview": { ... },
  "error_samples": []
}
```

### 有知有行 (YZXY CSV/XLSX)

解析有知有行导出的投资数据文件。

#### `yzxy_preview_file`

| 项目 | 值 |
|------|---|
| **Rust 模块** | `yzxy_import.rs` |
| **TS 封装** | `yzxyPreviewFile(req)` |
| **请求** | `{ source_path: string }` |

```json
{
  "file": "/path/to/data.csv",
  "parser_kind": "yzxy_v2",
  "mapping": { "date_col": 0, "amount_col": 3 },
  "parsed_count": 200,
  "error_count": 0,
  "errors": [],
  "preview_rows": [{
    "snapshot_date": "2025-01-01",
    "account_name": "沪深300",
    "total_assets_cents": 10000000,
    "transfer_amount_cents": 0
  }]
}
```

#### `yzxy_import_file`

| 项目 | 值 |
|------|---|
| **Rust 模块** | `yzxy_import.rs` |
| **TS 封装** | `yzxyImportFile(req)` |
| **请求** | `{ source_path: string, source_type?: string }` |

```json
{
  "db_path": "/path/to/ledger.db",
  "file": "/path/to/data.csv",
  "source_type": "yzxy",
  "imported_count": 200,
  "error_count": 0,
  "import_job_id": "job_ghi789",
  "preview": { ... }
}
```

---

## 设计模式 & 约定

### 请求参数一律 `Option<String>`

所有 Rust 请求结构体字段均为 `Option<String>`，在处理函数内部解析和校验：

```rust
#[derive(Debug, Deserialize)]
pub struct SomeQueryRequest {
    pub account_id: Option<String>,
    pub from: Option<String>,    // 日期字符串 "2025-01-01"
    pub limit: Option<String>,   // 数字字符串 "100"
}
```

**优点**：前端可以灵活传参，空值自然对应"不过滤"。
**缺点**：类型安全延迟到运行时，错误只能在执行时发现。

### 金额双格式返回

所有金额在响应中同时返回分和元两种格式：

```json
{
  "amount_cents": -3500,
  "amount_yuan": "-35.00"
}
```

### BigInt 安全处理

Tauri IPC 可能将大整数序列化为 BigInt（超出 JS `Number.MAX_SAFE_INTEGER`），前端通过递归 `normalizeTauriValue()` 转换：

```typescript
function normalizeTauriValue(val: unknown): unknown {
  if (typeof val === "bigint") return Number(val);
  if (Array.isArray(val)) return val.map(normalizeTauriValue);
  if (isRecord(val)) { /* 递归处理对象字段 */ }
  return val;
}
```

### 错误处理

- Rust 端统一返回 `Result<Value, String>`，错误消息为中文
- 前端 `invoke()` rejected Promise 直接向上抛出
- UI 层 catch 后展示错误消息

### 幂等性保证

- 导入操作（EML/PDF/YZXY）基于确定性 ID 生成，重复导入不会产生重复记录
- Budget CRUD 通过 `id` 判断 upsert vs insert

### 可测试性设计

各 Rust 模块提供 `*_at_db_path` 内部变体，直接接受 DB 路径参数，便于单元测试：

```rust
// 对外暴露的 Tauri command
pub fn query_transactions(app: AppHandle, req: ...) -> Result<Value, String> {
    let db_path = resolve_ledger_db_path(&app)?;
    query_transactions_at_db_path(&db_path, req)
}

// 可测试的内部函数
fn query_transactions_at_db_path(db_path: &str, req: ...) -> Result<Value, String> { ... }
```

---

## 优化方向

### 1. 类型安全增强

**现状**：请求全部 `Option<String>`，响应全部 `Value`（`unknown` in TS）。

**建议**：
- 为核心请求引入强类型字段（`Option<i32>` for limit, `Option<NaiveDate>` for dates）
- 定义 typed response structs 替代 `json!({})` 宏
- 前端生成对应的 TypeScript 类型（可考虑 `specta` 或手动同步）

### 2. 响应体积优化

**现状**：`query_consumption_report` 返回完整交易明细（可达数千条），每次切换年份全量传输。

**建议**：
- 拆分汇总查询和明细查询为两个独立 command
- 明细查询支持分页参数（`offset` / `limit`）
- 大数据量场景考虑 Tauri streaming channel

### 3. 批量操作支持

**现状**：规则 CRUD 逐条操作，批量导入规则需多次 invoke。

**建议**：
- 新增 `batch_upsert_*` 命令，单次传入多条规则
- 减少 IPC 往返次数

### 4. 查询缓存

**现状**：每次 invoke 都打开新的 SQLite 连接并执行查询。

**建议**：
- 使用 Tauri managed state 持有连接池（`r2d2` / `deadpool`）
- 对不变的元数据查询（账户列表、规则列表）添加内存缓存
- 投资曲线等计算密集型查询可缓存结果，仅在数据变更时失效

### 5. 错误类型结构化

**现状**：所有错误为裸 `String`，前端无法程序化判断错误类型。

**建议**：
- 引入 `AppError` enum 或结构化错误 JSON（含 error_code）
- 前端可根据 error_code 决定重试/提示策略

### 6. 导入流程优化

**现状**：Preview 和 Import 是两个独立 command，Preview 的解析结果未被 Import 复用。

**建议**：
- Preview 结果缓存在 Rust managed state 中
- Import 直接使用缓存的 Preview 结果，避免重复解析
- 或合并为单一 command，通过参数控制 dry-run/commit 模式

### 7. 前端 API 层类型收紧

**现状**：多数响应类型为 `unknown`，依赖运行时 helper 提取。

**建议**：
- 为高频使用的响应定义完整 TypeScript 类型
- 利用 `zod` 等库做运行时 schema 验证
- 或使用 `specta`（Tauri 生态）自动生成 TS 绑定

---

## 前端全貌 — App.tsx & App.css

> 整个 UI 在单文件 `App.tsx` (~9860 行) + `App.css` (~2860 行) 中实现。
> 无路由库、无状态管理库、无组件拆分——纯 `useState` + 条件渲染。

### 应用布局

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

### 8 个产品 Tab

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

### 组件清单 (38 个)

按文件出现顺序，分为 4 类：

#### 基础 UI 组件

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

#### 图表可视化组件

| 组件 | 行号 | 说明 |
|------|------|------|
| `LineAreaChart` | 711 | 通用折线/面积 SVG 图表（支持双系列、十字准线、Tooltip） |
| `InvestmentCurvePreview` | 969 | 投资净值曲线预览（封装 LineAreaChart + 指标汇总） |
| `WealthStackedTrendChart` | 1074 | 财富堆叠面积图（按资产类型分层，SVG 实现） |
| `WealthSankeyDiagram` | 1403 | 财富 Sankey 桑基图（ECharts 实现，资产流向） |

#### 数据预览组件

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

#### 导入流程组件

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
| `RulesAdminPanel` | 4240 | 规则管理面板（商户映射/分类/白名单/排除规则 4 类 CRUD） |
| `App` | 5207 | 主应用组件（~4650 行，包含全部状态和渲染逻辑） |

### 类型定义 (15 个)

| 类型 | 行号 | 说明 |
|------|------|------|
| `LoadStatus` | 138 | 加载状态枚举：`"idle" \| "loading" \| "ready" \| "error"` |
| `BoolString` | 139 | 布尔字符串：`"true" \| "false"` |
| `GainLossColorScheme` | 140 | 涨跌配色方案：中国红涨绿跌 / 国际绿涨红跌 |
| `AppSettings` | 141 | 应用设置（配色方案、隐私遮罩、动画开关） |
| `SmokeStatus` | 146 | 烟雾测试状态 |
| `SmokeKey` | 147 | 烟雾测试用例 key |
| `PipelineStatus` | 148 | 流水线状态 |
| `ImportStepStatus` | 149 | 导入步骤状态 |
| `ImportStepKey` | 150 | 导入步骤 key |
| `ProductTabKey` | 151 | 8 个产品 Tab 标识 |
| `SmokeRow` | 161 | 烟雾测试行数据 |
| `ImportStepRow` | 169 | 导入步骤行数据 |
| `ProductTabDef` | 177 | Tab 定义（key、图标、标签、副标题、状态） |
| `AccountSelectOption` | 597 | 账户选择选项（value、label、kind） |
| `RulesPreviewColumn` | 4038 | 规则预览表列定义 |
| `TableSortDirection` | 4044 | 排序方向：`"asc" \| "desc"` |

### 工具函数 (30+ 个)

按用途分组：

#### 金额格式化

| 函数 | 行号 | 说明 |
|------|------|------|
| `formatCentsShort` | 494 | 分→万元/亿元短格式（如 `"12.5万"`） |
| `formatSignedDeltaCentsShort` | 504 | 带正负号的增量金额格式化 |
| `formatCentsInputValue` | 511 | 分→元输入框值 |
| `formatRatePct` | 516 | 收益率→百分比（如 `"12.85%"`） |
| `formatPct` | 521 | 通用百分比格式化 |
| `formatCentsCompactCny` | 1392 | 分→紧凑人民币格式（用于 Sankey） |

#### 隐私遮罩

| 函数 | 行号 | 说明 |
|------|------|------|
| `isAmountPrivacyMasked` | 411 | 判断是否启用金额遮罩 |
| `maskAmountDisplayText` | 463 | 将金额文本替换为 `"***"` |
| `isMonetaryLabel` | 470 | 判断标签是否是金额类 |
| `maskAmountValueByLabel` | 484 | 根据标签名自动遮罩值 |
| `isLikelyAmountJsonKey` | 490 | 判断 JSON key 是否是金额类 |

#### 数据解析

| 函数 | 行号 | 说明 |
|------|------|------|
| `isRecord` | 373 | 判断值是否是 Record 对象 |
| `readPath` / `readString` / `readNumber` / `readBool` / `readArray` | 377-401 | 安全路径读取工具集 |
| `parseStoredAppSettings` | 440 | 解析 localStorage 中的设置 |
| `safeNumericInputValue` | 588 | 安全数值输入解析 |
| `buildAccountSelectOptionsFromCatalog` | 603 | 从账户目录构建下拉选项 |

#### 日期 & 显示

| 函数 | 行号 | 说明 |
|------|------|------|
| `parseDateInputValue` | 253 | 日期字符串→Date 对象 |
| `formatDateInputValue` | 273 | Date→`YYYY-MM-DD` 字符串 |
| `getTodayDateInputValueLocal` | 427 | 获取今日日期字符串 |
| `getCurrentMonthDateRangeLocal` | 435 | 获取当月起止日期 |
| `formatMonthDayLabel` | 526 | ISO 日期→`M/D` 短格式 |
| `formatPresetLabel` | 571 | 预设时段 key→中文标签 |
| `signedMetricTone` | 419 | 数值正负→色调（good/warn/default） |

#### 自定义 Hook

| 函数 | 行号 | 说明 |
|------|------|------|
| `useDebouncedAutoRun` | 3578 | 防抖自动执行 hook——deps 变化后延迟执行 task，支持 enabled 控制 |

### App 组件状态管理

`App` 组件（5207-9860 行）包含约 **160+ 个 useState** 和 **25+ 个 useDebouncedAutoRun** 调用。

#### 状态分域

| 域 | useState 数量 | 关键状态变量 | 驱动的 UI |
|----|--------|------|------|
| **启动引导** | 10 | `status`, `probe`, `error`, `dbStatus`, `dbBusy` | 初始化流程、DB 迁移 |
| **投资收益** | 12 | `invResult`, `invBatchResult`, `invCurveResult` + 对应 query/busy/error | 投资收益 Tab |
| **财富分析** | 8 | `wealthOverviewResult`, `wealthCurveResult` + query/busy/error | 财富总览 Tab |
| **预算 & FIRE** | 18 | `budgetItemsResult`, `budgetOverviewResult`, `budgetReviewResult`, `fireProgressResult` | FIRE 进度 Tab |
| **收入分析** | 4 | `salaryIncomeResult` + query/busy/error | 收入分析 Tab |
| **消费分析** | 4 | `consumptionOverviewResult`, `consumptionYear` + busy/error | 消费分析 Tab |
| **数据导入** | 30 | `yzxy*`, `eml*`, `cmbPdf*` 系列（每种：path/type/preview/import × busy/error/result） | 导入中心 Tab |
| **管理后台** | 18 | `adminDbStats*`, `adminReset*`, `runtimeHealth*`, `pipelineStatus`, `smokeRows` | 高级管理 Tab |
| **手动录入** | 20 | `manualInv*`, `quickManualInv*`, `invEdit*`, `manualAsset*`, `updateAsset*`, `deleteAsset*` | 更新收益 Tab |
| **查询列表** | 16 | `metaAccounts*`, `txList*`, `invList*`, `assetList*`, `acctCatalog*` | 管理 Tab 数据表 |
| **UI 控制** | 6 | `activeTab`, `sidebarCollapsed`, `appSettings`, `amountPrivacyMasked`, `settingsOpen`, `developerMode` | 全局导航 & 设置 |

#### 数据流模式

```
用户切换 Tab → activeTab 变化
  → useDebouncedAutoRun 根据 enabled 条件触发
    → handle*Query 异步函数调用 desktopApi.*()
      → invoke("command_name", { req })
        → Rust 后端查询 SQLite / CSV
          → Result<Value, String>
        → normalizeTauriValue(raw)
      → setState({ busy: false, result: data })
    → Preview 组件接收 data prop 渲染
```

#### useEffect 汇总

| 行号 | 作用 | 依赖 |
|------|------|------|
| 7074 | 启动时初始化：并行执行 `refreshProbe()` + `refreshDbStatus()` | `[]` |
| 7096 | 持久化 `appSettings` 到 localStorage | `[appSettings]` |
| 7104 | 持久化快捷录入最近账户 ID 到 localStorage | `[quickManualInvLastAccountId]` |
| 6655 | 派生导入中心行状态（聚合 yzxy/eml/pdf 各步状态） | 多个导入状态变量 |

此外有 **25+ 个 `useDebouncedAutoRun`** 调用（7173-7255 行），每个绑定一个异步查询函数和对应 Tab 的 `enabled` 条件，实现「切到哪个 Tab 就自动查询哪个数据」的按需加载模式。

### 组件树

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
    │   └── WealthCurvePreview
    │       └── WealthStackedTrendChart
    ├── return-analysis
    │   ├── InvestmentReturnsPreview (多账户排行)
    │   ├── InvestmentCurvePreview
    │   │   └── LineAreaChart
    │   └── PreviewStat (指标卡片)
    ├── budget-fire
    │   ├── FireProgressPreview
    │   ├── BudgetOverviewPreview
    │   ├── BudgetMonthlyReviewPreview
    │   └── BudgetItemsPreview
    ├── income-analysis
    │   └── SalaryIncomeOverviewPreview
    ├── consumption-analysis
    │   └── ConsumptionOverviewPreview (环形图 + 表格)
    ├── import-center
    │   ├── YzxyPreviewSummaryReport / YzxyImportSummaryReport
    │   ├── CmbEmlPreviewSummaryReport / CmbEmlImportSummaryReport
    │   └── CmbBankPdfPreviewSummaryReport / CmbBankPdfImportSummaryReport
    └── admin
        ├── AdminDbStatsPreview
        ├── RuntimeHealthPreview
        ├── MetaAccountsPreview
        ├── RulesAdminPanel
        │   ├── MerchantSuggestionsPreview
        │   └── RulesRowsPreview (×4 规则类型)
        └── Smoke Test / Pipeline 面板
```

### CSS 架构概要

`App.css` (2858 行) — 纯 CSS，无预处理器、无 CSS Modules。

#### 设计系统

| 维度 | 说明 |
|------|------|
| **色彩模式** | 仅暗色主题，`color-scheme: dark` |
| **主色** | `#34c6ad` 薄荷绿（CSS 变量 `--kw-accent`） |
| **背景** | `#0b1319` 深蓝黑 + 多层 radial-gradient 环境光 |
| **文字** | `#f3efe5` 暖白 |
| **卡片风格** | Glassmorphism（`backdrop-filter: blur(16px)` + 半透明渐变 + 阴影） |
| **字体栈** | Avenir Next, SF Pro, Segoe UI, PingFang SC, 微软雅黑 |
| **圆角体系** | 999px(药丸) / 18px(主卡) / 14px(子卡) / 12px(按钮) / 10px(输入框) |
| **动画** | 仅 1 个 @keyframes (`kw-spin`)；transition 普遍 120-220ms |
| **响应式** | 3 个断点：980px(侧边栏折叠) / 900px(图表堆叠) / 760px(单列) |

#### 样式分区 (27 组)

| # | 前缀模式 | 行范围 | 对应 UI |
|---|----------|--------|---------|
| 1 | `:root`, `*`, `body` | 1-91 | CSS 变量、重置、滚动条 |
| 2 | `.app-shell`, `.card`, `.hero-*` | 93-467 | 壳层、玻璃卡片、Hero 区 |
| 3 | `.primary-btn`, `.secondary-btn`, `.danger-btn` | 159-244 | 三级按钮系统 |
| 4 | `.kw-modal-*` | 246-278 | 模态遮罩与对话框 |
| 5 | `.status-*` | 280-311 | 状态药丸 |
| 6 | `.workbench-*` | 371-427 | 工作台模块卡片 |
| 7 | `.path-*`, `.db-*` | 469-578 | 路径显示、数据库操作 |
| 8 | `.inline-progress-spinner` | 541-559 | 加载旋转器 |
| 9 | `.pipeline-*`, `.smoke-*` | 586-666 | 流水线/烟雾测试结果 |
| 10 | `.query-form-grid`, `.field`, `.kw-date-*` | 681-872 | 表单、日期选择器 |
| 11 | `.preview-*` | 889-1077 | 数据预览面板、统计卡片 |
| 12 | `.consumption-*` | 904-998, 1573-1656, 2520-2717 | 消费分析（筛选/环形图/交易表） |
| 13 | `.fire-progress-*` | 1080-1130 | FIRE 进度 |
| 14 | `.return-analysis-*` | 1132-1177 | 投资收益分析 |
| 15 | `.wealth-*` | 893-1276 | 财富分析（Sankey/趋势/筛选） |
| 16 | `.sparkline-*` | 1235-1302 | 迷你趋势图 |
| 17 | `.line-area-*` | 1304-1571 | 折线/面积图 + Tooltip |
| 18 | `.stacked-wealth-*` | 1326-1484 | 堆叠面积图 + 图例 |
| 19 | `.preview-table`, `.data-table` | 1658-1813 | 数据表格 |
| 20 | `.alert-card` | 1815-1838 | 错误提示 |
| 21 | `.roadmap-*` | 1840-1867 | 路线图 |
| 22 | `.workspace-*` | 1869-2506 | 主布局（侧边栏+内容区） |
| 23 | `.sidebar-*`, `.tab-nav-*`, `.tab-icon-*` | 1949-2462 | 侧边栏导航、图标主题色 |
| 24 | `.settings-*` | 2176-2312 | 设置模态内部 |
| 25 | `.placeholder-panel*` | 2508-2518 | 空状态占位 |
| 26 | `@media (max-width)` | 1666-1703, 2719-2858 | 响应式断点 |

---

> 文档生成时间：2026-02-26
> 命令总数：57（14 个 Rust 模块）
> 覆盖范围：全部前后端 IPC 通信协议 + 前端 UI 架构全貌
