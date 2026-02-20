# 数据字典 v1（M0 收敛版）

生效日期：2026-02-12

## 1. 目标范围

本字典仅覆盖 M0 四项能力：
- EML 交互式导入。
- 投资记录单条录入。
- 有知有行导出表批量导入。
- 基础查询展示。

## 2. 核心表

### 2.1 import_jobs（导入任务）

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| id | TEXT | 是 | 主键 |
| source_type | TEXT | 是 | `cmb_eml` / `youzhiyouxing_export` |
| source_file | TEXT | 否 | 来源文件路径 |
| status | TEXT | 是 | `running/success/failed` |
| started_at | TEXT | 是 | 开始时间 |
| finished_at | TEXT | 否 | 结束时间 |
| total_count | INTEGER | 是 | 总处理数 |
| imported_count | INTEGER | 是 | 成功数 |
| error_count | INTEGER | 是 | 失败数 |
| error_message | TEXT | 否 | 错误摘要 |
| metadata_json | TEXT | 否 | 预览摘要、列映射等 |

### 2.2 transactions（EML 导入交易）

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| id | TEXT | 是 | 主键 |
| external_ref | TEXT | 否 | 外部标识（用于幂等） |
| occurred_at | TEXT | 否 | 交易日 |
| posted_at | TEXT | 否 | 入账日 |
| month_key | TEXT | 是 | `YYYY-MM` |
| amount_cents | INTEGER | 是 | 金额（分） |
| currency | TEXT | 是 | 默认 `CNY` |
| direction | TEXT | 是 | `expense/income/transfer/other` |
| description | TEXT | 是 | 交易摘要 |
| merchant_normalized | TEXT | 否 | 归一化商户 |
| statement_category | TEXT | 否 | 账单分类 |
| account_id | TEXT | 是 | 账户外键 |
| source_type | TEXT | 是 | 固定 `cmb_eml` |
| source_file | TEXT | 否 | 来源文件 |
| import_job_id | TEXT | 否 | 对应导入任务 |
| confidence | REAL | 否 | 分类置信度 |
| needs_review | INTEGER | 是 | `0/1` |
| excluded_in_analysis | INTEGER | 是 | `0/1` |
| exclude_reason | TEXT | 否 | 排除原因 |

### 2.3 investment_records（投资记录）

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| id | TEXT | 是 | 主键 |
| account_id | TEXT | 是 | 投资账户 |
| snapshot_date | TEXT | 是 | 快照日期 |
| total_assets_cents | INTEGER | 是 | 账户总资产（分） |
| transfer_amount_cents | INTEGER | 是 | 转入转出金额（分，正=转入，负=转出） |
| source_type | TEXT | 是 | `manual` / `youzhiyouxing_export` |
| source_file | TEXT | 否 | 批量导入来源文件 |
| import_job_id | TEXT | 否 | 批量导入任务 |
| created_at | TEXT | 是 | 创建时间 |
| updated_at | TEXT | 是 | 更新时间 |

### 2.4 accounts（账户）

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| id | TEXT | 是 | 主键 |
| name | TEXT | 是 | 账户名 |
| account_type | TEXT | 是 | `credit_card/investment/...` |
| currency | TEXT | 是 | 币种 |

### 2.5 account_valuations（现金/不动产快照）

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| id | TEXT | 是 | 主键 |
| account_id | TEXT | 是 | 账户 ID |
| account_name | TEXT | 是 | 账户名称 |
| asset_class | TEXT | 是 | `cash` / `real_estate` |
| snapshot_date | TEXT | 是 | 快照日期 |
| value_cents | INTEGER | 是 | 资产金额（分） |
| source_type | TEXT | 是 | 目前为 `manual` |
| source_file | TEXT | 否 | 文件来源（预留） |
| import_job_id | TEXT | 否 | 导入任务（预留） |
| created_at | TEXT | 是 | 创建时间 |
| updated_at | TEXT | 是 | 更新时间 |

## 3. 必要数据结构调整（M0）

1. `import_jobs.source_type` 扩展支持 `youzhiyouxing_export`。
2. `investment_records` 补充来源追踪字段：`source_type/source_file/import_job_id`。
3. 为基础查询建立索引：
   - `transactions(month_key, source_type)`
   - `investment_records(snapshot_date, source_type, account_id)`
   - `account_valuations(asset_class, snapshot_date, account_id)`

## 4. 基础查询口径（M0）

### 4.1 交易查询

筛选：月份、来源、账户、关键词。
输出：交易列表 + 总笔数 + 总金额。

### 4.2 投资记录查询

筛选：日期范围、来源、账户。
输出：记录列表 + 最新总资产 + 区间转入转出汇总。

## 5. 统一约束

- 金额统一使用 `*_cents` 整数。
- 时间统一使用 ISO 字符串。
- 导入数据必须可追溯到任务：`import_job_id`。
