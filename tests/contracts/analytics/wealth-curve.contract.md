# Contract: wealth-curve (Concise)

接口：`GET /api/analytics/wealth-curve`

## 目的

返回财富时间序列（总资产 / 负债 / 净资产），支持按资产类型筛选。

## 核心参数

- `preset`（默认 `1y`，当前 UI 常用 `ytd`）
- `start_date` / `end_date`（仅 `custom` 时）
- `include_investment / include_cash / include_real_estate / include_liability`

## 关键返回字段（应稳定）

- `range.*`
- `rows[].snapshot_date`
- `rows[].total_assets_cents`
- `rows[].total_liabilities_cents`
- `rows[].net_worth_cents`

## 不变量（人工审核重点）

- `net_worth_cents = total_assets_cents - total_liabilities_cents`
- 日期序列有序
- 资产类型筛选影响聚合结果且口径一致
