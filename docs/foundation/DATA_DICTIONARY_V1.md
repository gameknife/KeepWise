# Data Dictionary (Current Practical Scope)

本文件只保留当前桌面端迁移主线涉及的核心实体（精简版）。

## 核心表（运行时）

### `transactions`
- 用途：消费/流水交易总账（含导入来源与分类）
- 主要来源：`cmb_eml`、`cmb_bank_pdf`
- 关键字段：交易日期、金额、商户、分类、是否手动排除、导入追踪信息

### `investment_records`
- 用途：投资账户快照（总资产、净转入/转出）
- 来源：手工录入、YZXY 导入
- 关键字段：`account_id`、`snapshot_date`、`total_assets_cents`、`transfer_amount_cents`

### `account_valuations`
- 用途：现金/不动产/负债等非投资账户快照
- 来源：手工录入
- 关键字段：`account_id`、`snapshot_date`、`asset_class`、`amount_cents`

### `import_jobs`
- 用途：记录导入任务与来源文件、统计结果、时间戳
- 来源：各导入器统一写入

## 账户相关（逻辑层）

### 账户种类（UI 术语）
- 投资
- 现金
- 不动产
- 负债

说明：底层仍存在 `account_type/account_kind` 映射，但 UI 已收束为“账户种类”概念。

## 核心分析口径（当前已稳定）

- 投资收益率：现金加权（Modified Dietz）
- 财富总览：投资 + 非投资资产聚合，可按资产类型筛选
- 财富趋势：时间序列曲线；桌面端已支持结构图 + 趋势图联动
- 消费总览：默认排除待确认交易（可切换）

## 规则文件（桌面运行时）

桌面端运行时会在 app 本地目录维护规则，并在首次使用时从仓库 `data/rules` seed：

- `merchant_map.csv`
- `category_rules.csv`
- `bank_transfer_whitelist.csv`
- `analysis_exclusions.csv`
