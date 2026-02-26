# Contract: investment-curve (Concise)

接口：`GET /api/analytics/investment-curve`

## 目的

返回投资账户（或组合）的时间序列曲线，用于展示总资产、净增长与累计收益率趋势。

## 核心参数

- `account_id`（支持 `__portfolio__`）
- `preset`（默认 `1y`，当前 UI 常用 `ytd`）
- `start_date` / `end_date`（仅 `custom` 时）

## 关键返回字段（应稳定）

- `range.*`
- `rows[].snapshot_date`
- `rows[].total_assets_cents`
- `rows[].net_gain_cents`
- `rows[].cumulative_return_rate`

## 不变量（人工审核重点）

- 曲线终点 `cumulative_return_rate` 应与同区间 `investment-return` 一致
- 日期序列有序、无重复点
- 金额字段单位为分
