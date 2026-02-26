# Contract: investment-return (Concise)

接口：`GET /api/analytics/investment-return`

## 目的

返回指定投资账户（或组合）在区间内的现金加权收益率（Modified Dietz）结果。

## 核心参数

- `account_id`（支持 `__portfolio__`）
- `preset`（默认 `ytd`）
- `start_date` / `end_date`（仅 `custom` 时）

## 关键返回字段（应稳定）

- `range.start_date`
- `range.end_date`
- `summary.return_rate`
- `summary.annualized_return_rate`
- `summary.ending_total_assets_cents`
- `summary.net_contribution_cents`
- `summary.net_gain_cents`

## 不变量（人工审核重点）

- 自定义区间时日期合法性校验一致
- 组合口径与曲线终点收益率口径一致
- 金额类字段单位统一为分（`*_cents`）
