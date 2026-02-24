# Contract: `GET /api/analytics/wealth-curve`

状态：Draft（Phase 1 冻结模板）
优先级：P1-A（必须）
最后更新：2026-02-23

## 1. 接口用途

返回财富时间序列（投资/现金/不动产/负债/总财富/净资产）及区间变化汇总。

当前实现参考：

- `scripts/http_route_tables.py`
- `scripts/wealth_analytics_service.py`（`query_wealth_curve`）

## 2. 请求定义

- Method: `GET`
- Path: `/api/analytics/wealth-curve`

### 2.1 Query 参数

| 参数 | 必填 | 默认值 | 示例 | 说明 |
| --- | --- | --- | --- | --- |
| `preset` | 否 | `1y` | `1y`, `ytd`, `custom` | 区间预设 |
| `from` | 条件必填 | 无 | `2026-01-01` | `preset=custom` 时使用 |
| `to` | 否 | 空（按服务逻辑取） | `2026-01-31` | 自定义结束日期 |
| `include_investment` | 否 | `true` | `true/false/1/0` | 纳入投资 |
| `include_cash` | 否 | `true` | `true/false/1/0` | 纳入现金 |
| `include_real_estate` | 否 | `true` | `true/false/1/0` | 纳入不动产 |
| `include_liability` | 否 | `true` | `true/false/1/0` | 纳入负债 |

### 2.2 参数行为（冻结）

- 四个 `include_*` 全为 `false`：报错
- `preset` 非法值：报错
- 区间边界由 `preset` 与 `from`/`to` 共同决定
- 返回点位包含区间边界补点（依当前实现）

## 3. 错误语义（冻结模板）

| 场景 | 当前行为（Python） | 建议错误类别 |
| --- | --- | --- |
| 全部 `include_* = false` | `ValueError` | `VALIDATION_ERROR` |
| 布尔值不合法 | `ValueError` | `VALIDATION_ERROR` |
| 无可用于曲线的数据 | `ValueError` | `NO_DATA_ERROR` |
| 自定义区间非法 | `ValueError` | `INVALID_RANGE_ERROR` |

## 4. 返回结构（字段树骨架）

```text
root (object)
├─ range [EXACT] (object)
│  ├─ preset [EXACT] (string)
│  ├─ requested_from [EXACT] (date string)
│  ├─ requested_to [EXACT] (date string)
│  ├─ effective_from [EXACT] (date string)
│  ├─ effective_to [EXACT] (date string)
│  └─ points [EXACT] (int)
├─ filters [EXACT] (object)
│  ├─ include_investment [EXACT] (bool)
│  ├─ include_cash [EXACT] (bool)
│  ├─ include_real_estate [EXACT] (bool)
│  └─ include_liability [EXACT] (bool)
├─ summary (object)
│  ├─ start_wealth_cents [EXACT] (int)
│  ├─ start_wealth_yuan [FORMAT] (string)
│  ├─ end_wealth_cents [EXACT] (int)
│  ├─ end_wealth_yuan [FORMAT] (string)
│  ├─ change_cents [EXACT] (int)
│  ├─ change_yuan [FORMAT] (string)
│  ├─ net_growth_cents [EXACT] (int)
│  ├─ net_growth_yuan [FORMAT] (string)
│  ├─ change_pct [APPROX] (float|null)
│  ├─ change_pct_text [FORMAT] (string|null)
│  ├─ start_liability_cents [EXACT] (int)
│  ├─ end_liability_cents [EXACT] (int)
│  ├─ liability_net_growth_cents [EXACT] (int)
│  ├─ liability_change_pct [APPROX] (float|null)
│  ├─ start_net_asset_cents [EXACT] (int)
│  ├─ end_net_asset_cents [EXACT] (int)
│  ├─ net_asset_change_cents [EXACT] (int)
│  ├─ net_asset_change_pct [APPROX] (float|null)
│  ├─ start_investment_cents [EXACT] (int)
│  ├─ end_investment_cents [EXACT] (int)
│  ├─ investment_net_growth_cents [EXACT] (int)
│  ├─ investment_change_pct [APPROX] (float|null)
│  ├─ start_cash_cents [EXACT] (int)
│  ├─ end_cash_cents [EXACT] (int)
│  ├─ cash_net_growth_cents [EXACT] (int)
│  ├─ cash_change_pct [APPROX] (float|null)
│  ├─ start_real_estate_cents [EXACT] (int)
│  ├─ end_real_estate_cents [EXACT] (int)
│  ├─ real_estate_net_growth_cents [EXACT] (int)
│  └─ real_estate_change_pct [APPROX] (float|null)
└─ rows [ORDERED ASC by snapshot_date] (array<object>)
   └─ item
      ├─ snapshot_date [EXACT] (date string)
      ├─ investment_total_cents [EXACT] (int)
      ├─ cash_total_cents [EXACT] (int)
      ├─ real_estate_total_cents [EXACT] (int)
      ├─ liability_total_cents [EXACT] (int)
      ├─ wealth_total_cents [EXACT] (int)
      ├─ wealth_total_yuan [FORMAT] (string)
      ├─ net_asset_total_cents [EXACT] (int)
      ├─ net_asset_total_yuan [FORMAT] (string)
      ├─ wealth_net_growth_cents [EXACT] (int)
      ├─ wealth_net_growth_yuan [FORMAT] (string)
      ├─ liability_net_growth_cents [EXACT] (int)
      ├─ net_asset_net_growth_cents [EXACT] (int)
      ├─ investment_net_growth_cents [EXACT] (int)
      ├─ cash_net_growth_cents [EXACT] (int)
      └─ real_estate_net_growth_cents [EXACT] (int)
```

## 5. 关键不变量（必须断言）

- `range.points == len(rows)`
- `rows` 按 `snapshot_date` 升序
- `summary.start_wealth_cents == rows[0].wealth_total_cents`（`rows` 非空）
- `summary.end_wealth_cents == rows[-1].wealth_total_cents`（`rows` 非空）
- `summary.change_cents == summary.end_wealth_cents - summary.start_wealth_cents`
- `summary.net_growth_cents == summary.change_cents`（当前语义）
- 对每个点位：
  - `net_asset_total_cents == wealth_total_cents - (include_liability ? liability_total_cents : 0)`（按筛选口径）

## 6. 归一化与比较规则（本接口）

- `rows` 顺序为契约承诺的一部分
- `*_cents`、布尔、日期、计数字段：`EXACT`
- `*_change_pct` / `*_pct`（数值型）：`APPROX`
- `*_yuan`, `*_pct_text`：`FORMAT`

## 7. 样例（占位）

### 7.1 成功样例（默认筛选）

```json
{
  "range": {
    "preset": "1y",
    "requested_from": "2025-02-01",
    "requested_to": "2026-01-31",
    "effective_from": "2025-02-01",
    "effective_to": "2026-01-31",
    "points": 4
  },
  "filters": {
    "include_investment": true,
    "include_cash": true,
    "include_real_estate": true,
    "include_liability": true
  },
  "summary": {
    "start_wealth_cents": 100000000,
    "end_wealth_cents": 110000000,
    "change_cents": 10000000
  },
  "rows": [
    {
      "snapshot_date": "2026-01-01",
      "investment_total_cents": 10000000,
      "cash_total_cents": 5000000,
      "real_estate_total_cents": 80000000,
      "liability_total_cents": 10000000,
      "wealth_total_cents": 95000000,
      "net_asset_total_cents": 85000000
    }
  ]
}
```

### 7.2 错误样例（全部筛选关闭）

```json
{
  "error": "至少需要选择一个资产类型"
}
```

## 8. 待补充（进入冻结前完成）

- 明确 `summary` 在空 `rows` 场景的字段全集和默认值
- 补充各筛选组合对 `net_asset_total_cents` 计算的样例
- 补充与 `wealth-overview` 汇总口径联动的交叉校验说明
