# Contract: `GET /api/analytics/investment-curve`

状态：Draft（Phase 1 冻结模板）
优先级：P1-A（必须）
最后更新：2026-02-23

## 1. 接口用途

返回单账户或投资组合的资产曲线与累计收益率曲线点位数据。

当前实现参考：

- `scripts/http_route_tables.py`
- `scripts/investment_analytics_service.py`（`query_investment_curve`）

## 2. 请求定义

- Method: `GET`
- Path: `/api/analytics/investment-curve`

### 2.1 Query 参数

| 参数 | 必填 | 默认值 | 示例 | 说明 |
| --- | --- | --- | --- | --- |
| `account_id` | 是 | 无 | `acct_xxx` / `__portfolio__` | 投资账户 ID 或组合占位符 |
| `preset` | 否 | `1y` | `1y`, `ytd`, `custom` | 区间预设 |
| `from` | 条件必填 | 无 | `2026-01-01` | `preset=custom` 时使用 |
| `to` | 否 | 空（按服务逻辑取） | `2026-01-31` | 自定义结束日期 |

### 2.2 参数行为（冻结）

- `account_id` 为空：报错
- `preset` 非法值：报错
- 区间内无有效快照：报错
- 单账户与组合返回结构高度相似，组合场景包含 `account_count`

## 3. 错误语义（冻结模板）

| 场景 | 当前行为（Python） | 建议错误类别 |
| --- | --- | --- |
| 缺失 `account_id` | `ValueError` | `VALIDATION_ERROR` |
| 区间无可用期初/期末快照 | `ValueError` | `NO_DATA_ERROR` |
| 区间有效快照不足 | `ValueError` | `INVALID_RANGE_ERROR` |

## 4. 返回结构（字段树骨架）

```text
root (object)
├─ account_id [EXACT] (string)
├─ account_name [EXACT] (string)
├─ account_count [EXACT] (int, 仅组合场景出现)
├─ range [EXACT] (object)
│  ├─ preset [EXACT] (string)
│  ├─ requested_from [EXACT] (date string)
│  ├─ requested_to [EXACT] (date string)
│  ├─ effective_from [EXACT] (date string)
│  └─ effective_to [EXACT] (date string)
├─ summary (object)
│  ├─ count [EXACT] (int)
│  ├─ start_assets_cents [EXACT] (int, count>0 时)
│  ├─ start_assets_yuan [FORMAT] (string)
│  ├─ end_assets_cents [EXACT] (int, count>0 时)
│  ├─ end_assets_yuan [FORMAT] (string)
│  ├─ change_cents [EXACT] (int)
│  ├─ change_yuan [FORMAT] (string)
│  ├─ change_pct [APPROX] (float|null)
│  ├─ change_pct_text [FORMAT] (string|null)
│  ├─ end_net_growth_cents [EXACT] (int)
│  ├─ end_net_growth_yuan [FORMAT] (string)
│  ├─ end_cumulative_return_rate [APPROX] (float|null)
│  └─ end_cumulative_return_pct_text [FORMAT] (string|null)
└─ rows [ORDERED ASC by snapshot_date] (array<object>)
   └─ item
      ├─ snapshot_date [EXACT] (date string)
      ├─ effective_snapshot_date [EXACT] (date string)
      ├─ total_assets_cents [EXACT] (int)
      ├─ total_assets_yuan [FORMAT] (string)
      ├─ transfer_amount_cents [EXACT] (int)
      ├─ transfer_amount_yuan [FORMAT] (string)
      ├─ cumulative_net_growth_cents [EXACT] (int)
      ├─ cumulative_net_growth_yuan [FORMAT] (string)
      ├─ cumulative_return_rate [APPROX] (float|null)
      ├─ cumulative_return_pct [APPROX] (float|null)
      └─ cumulative_return_pct_text [FORMAT] (string|null)
```

## 5. 关键不变量（必须断言）

- `summary.count == len(rows)`
- `rows` 按 `snapshot_date` 升序
- `summary.end_assets_cents == rows[-1].total_assets_cents`（当 `rows` 非空）
- `summary.end_net_growth_cents == rows[-1].cumulative_net_growth_cents`（当 `rows` 非空）
- `summary.end_cumulative_return_rate == rows[-1].cumulative_return_rate`（近似比较）
- 曲线终点累计收益率与同区间 `investment-return.metrics.return_rate` 一致（近似比较）

## 6. 归一化与比较规则（本接口）

- `rows` 顺序为契约承诺的一部分，不允许无规则重排
- `*_cents` / 日期 / 计数字段：`EXACT`
- `*_rate`, `*_pct`（数值型）：`APPROX`
- `*_yuan`, `*_pct_text`：`FORMAT`

## 7. 样例（占位）

### 7.1 成功样例（单账户）

```json
{
  "account_id": "acct_sample",
  "account_name": "示例账户",
  "range": {
    "preset": "1y",
    "requested_from": "2025-02-01",
    "requested_to": "2026-01-31",
    "effective_from": "2025-02-01",
    "effective_to": "2026-01-31"
  },
  "summary": {
    "count": 3,
    "end_cumulative_return_rate": 0.12345678
  },
  "rows": [
    {
      "snapshot_date": "2026-01-01",
      "effective_snapshot_date": "2026-01-01",
      "total_assets_cents": 1000000,
      "cumulative_return_rate": 0.0
    }
  ]
}
```

### 7.2 错误样例（区间无数据）

```json
{
  "error": "区间内没有可用的期末资产记录"
}
```

## 8. 待补充（进入冻结前完成）

- 明确空 `rows` 场景下 `summary` 字段全集（单账户 / 组合）
- 补充组合场景 `account_count` 与 `rows` 关系说明
- 在样例中加入 `transfer_amount_*` 与累计收益字段完整示例
