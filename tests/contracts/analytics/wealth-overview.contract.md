# Contract: `GET /api/analytics/wealth-overview`

状态：Draft（Phase 1 冻结模板）
优先级：P1-A（必须）
最后更新：2026-02-23

## 1. 接口用途

按指定 `as_of` 日期聚合投资、现金、不动产、负债，并输出汇总与明细（含对账校验与滞后天数）。

当前实现参考：

- `scripts/http_route_tables.py`
- `scripts/wealth_analytics_service.py`（`query_wealth_overview`）

## 2. 请求定义

- Method: `GET`
- Path: `/api/analytics/wealth-overview`

### 2.1 Query 参数

| 参数 | 必填 | 默认值 | 示例 | 说明 |
| --- | --- | --- | --- | --- |
| `as_of` | 否 | 最新可用日期 | `2026-01-31` | 查询时点 |
| `include_investment` | 否 | `true` | `true/false/1/0` | 是否纳入投资 |
| `include_cash` | 否 | `true` | `true/false/1/0` | 是否纳入现金 |
| `include_real_estate` | 否 | `true` | `true/false/1/0` | 是否纳入不动产 |
| `include_liability` | 否 | `true` | `true/false/1/0` | 是否纳入负债（用于净资产扣减） |

### 2.2 参数行为（冻结）

- 四个 `include_*` 全为 `false`：报错（至少选择一个资产类型）
- `as_of` 为空：使用当前可用最大日期
- `as_of` 晚于最新可用日期：`requested_as_of` 保留请求值，`as_of` 使用有效日期
- 布尔参数支持多种文本值（`true/false/yes/no/on/off/1/0`）

## 3. 错误语义（冻结模板）

| 场景 | 当前行为（Python） | 建议错误类别 |
| --- | --- | --- |
| 全部 `include_* = false` | `ValueError` | `VALIDATION_ERROR` |
| 布尔值不合法 | `ValueError` | `VALIDATION_ERROR` |
| 没有任何可用于财富总览的数据 | `ValueError` | `NO_DATA_ERROR` |

## 4. 返回结构（字段树骨架）

```text
root (object)
├─ as_of [EXACT] (date string, 实际生效日期)
├─ requested_as_of [EXACT] (date string)
├─ filters [EXACT] (object)
│  ├─ include_investment [EXACT] (bool)
│  ├─ include_cash [EXACT] (bool)
│  ├─ include_real_estate [EXACT] (bool)
│  └─ include_liability [EXACT] (bool)
├─ summary (object)
│  ├─ investment_total_cents [EXACT] (int)
│  ├─ investment_total_yuan [FORMAT] (string)
│  ├─ cash_total_cents [EXACT] (int)
│  ├─ cash_total_yuan [FORMAT] (string)
│  ├─ real_estate_total_cents [EXACT] (int)
│  ├─ real_estate_total_yuan [FORMAT] (string)
│  ├─ liability_total_cents [EXACT] (int)
│  ├─ liability_total_yuan [FORMAT] (string)
│  ├─ wealth_total_cents [EXACT] (int)
│  ├─ wealth_total_yuan [FORMAT] (string)
│  ├─ gross_assets_total_cents [EXACT] (int)
│  ├─ gross_assets_total_yuan [FORMAT] (string)
│  ├─ net_asset_total_cents [EXACT] (int)
│  ├─ net_asset_total_yuan [FORMAT] (string)
│  ├─ selected_rows_total_cents [EXACT] (int)
│  ├─ selected_rows_total_yuan [FORMAT] (string)
│  ├─ selected_rows_assets_total_cents [EXACT] (int)
│  ├─ selected_rows_assets_total_yuan [FORMAT] (string)
│  ├─ selected_rows_liability_total_cents [EXACT] (int)
│  ├─ selected_rows_liability_total_yuan [FORMAT] (string)
│  ├─ reconciliation_delta_cents [EXACT] (int)
│  ├─ reconciliation_delta_yuan [FORMAT] (string)
│  ├─ reconciliation_ok [EXACT] (bool)
│  └─ stale_account_count [EXACT] (int)
└─ rows [ORDER NOT STRICT unless front-end depends] (array<object>)
   └─ item
      ├─ asset_class [EXACT] (enum: investment/cash/real_estate/liability)
      ├─ account_id [EXACT] (string)
      ├─ account_name [EXACT] (string)
      ├─ snapshot_date [EXACT] (date string)
      ├─ value_cents [EXACT] (int)
      ├─ value_yuan [FORMAT] (string)
      └─ stale_days [EXACT] (int)
```

## 5. 关键不变量（必须断言）

- `summary.reconciliation_ok == (summary.reconciliation_delta_cents == 0)`
- `summary.stale_account_count == count(rows where stale_days > 0)`
- `summary.selected_rows_assets_total_cents - summary.selected_rows_liability_total_cents == summary.selected_rows_total_cents`
- 在 `reconciliation_ok=true` 时：`summary.selected_rows_total_cents == summary.net_asset_total_cents`

## 6. 归一化与比较规则（本接口）

- `rows` 若前端未依赖固定顺序，可按 `(asset_class, account_id, snapshot_date)` 排序后比较
- `*_cents`、布尔、日期：`EXACT`
- `*_yuan`：`FORMAT`

## 7. 样例（占位）

### 7.1 成功样例（默认筛选）

```json
{
  "as_of": "2026-01-31",
  "requested_as_of": "2026-02-10",
  "filters": {
    "include_investment": true,
    "include_cash": true,
    "include_real_estate": true,
    "include_liability": true
  },
  "summary": {
    "gross_assets_total_cents": 100000000,
    "liability_total_cents": 10000000,
    "net_asset_total_cents": 90000000,
    "reconciliation_delta_cents": 0,
    "reconciliation_ok": true,
    "stale_account_count": 1
  },
  "rows": []
}
```

### 7.2 错误样例（全部筛选关闭）

```json
{
  "error": "至少需要选择一个资产类型"
}
```

## 8. 待补充（进入冻结前完成）

- 确认 `rows` 顺序是否被前端依赖（若依赖则升级为顺序契约）
- 补齐 `requested_as_of` 在空参场景下的表现样例
- 补充仅负债、仅现金等筛选组合样例
