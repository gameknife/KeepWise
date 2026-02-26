# Contract: wealth-overview (Concise)

接口：`GET /api/analytics/wealth-overview`

## 目的

返回指定日期（或最新）的财富总览聚合结果，可按资产类型开关筛选。

## 核心参数

- `as_of`（可选）
- `include_investment`
- `include_cash`
- `include_real_estate`
- `include_liability`

## 关键返回字段（应稳定）

- `summary.total_assets_cents`
- `summary.total_liabilities_cents`
- `summary.net_worth_cents`
- `summary.reconciliation_ok`
- `summary.stale_account_count`
- `rows[]`（账户明细）

## 不变量（人工审核重点）

- 至少选择一类资产/负债；全关应报错
- 汇总与明细合计口径一致（允许明确标注的对账字段）
- `stale_days` 计算口径稳定
