# Contract: `GET /api/analytics/investment-return`

状态：Draft（Phase 1 冻结模板）
优先级：P1-A（必须）
最后更新：2026-02-23

## 1. 接口用途

计算单账户或投资组合（`account_id=__portfolio__`）在指定区间内的现金加权收益率（Modified Dietz）。

当前实现参考：

- `scripts/http_route_tables.py`
- `scripts/investment_analytics_service.py`（`query_investment_return`）

## 2. 请求定义

- Method: `GET`
- Path: `/api/analytics/investment-return`

### 2.1 Query 参数

| 参数 | 必填 | 默认值 | 示例 | 说明 |
| --- | --- | --- | --- | --- |
| `account_id` | 是 | 无 | `acct_xxx` / `__portfolio__` | 投资账户 ID 或组合占位符 |
| `preset` | 否 | `ytd` | `ytd`, `1y`, `custom` | 区间预设 |
| `from` | 条件必填 | 无 | `2026-01-01` | `preset=custom` 时使用 |
| `to` | 否 | 空（按服务逻辑取） | `2026-01-31` | 自定义结束日期 |

### 2.2 参数行为（冻结）

- `account_id` 为空：报错（验证错误）
- `preset` 非法值：报错（验证错误）
- `preset=custom` 且 `from` 非法：报错（验证错误）
- 单账户与组合都返回同一根结构，但组合场景包含 `account_count`

## 3. 错误语义（冻结模板）

建议在差分时先冻结“错误类别 + 关键语义”，文案允许迭代。

| 场景 | 当前行为（Python） | 建议错误类别 |
| --- | --- | --- |
| 缺失 `account_id` | 抛 `ValueError`，文案含 `account_id 必填` | `VALIDATION_ERROR` |
| 区间无有效快照 | 抛 `ValueError` | `NO_DATA_ERROR` / `INVALID_RANGE_ERROR` |
| 自定义日期非法 | 抛 `ValueError` | `VALIDATION_ERROR` |

## 4. 返回结构（字段树骨架）

比较标签说明：

- `EXACT`: 必须精确一致
- `APPROX`: 浮点近似比较（默认 `abs_tol=1e-8`）
- `FORMAT`: 展示格式字段，可弱化
- `WEAK`: 文案字段，弱比较

```text
root (object)
├─ account_id [EXACT] (string)
├─ account_name [EXACT] (string)
├─ account_count [EXACT] (int, 仅组合场景出现)
├─ range [EXACT] (object)
│  ├─ preset [EXACT] (string)
│  ├─ requested_from [EXACT] (date string: YYYY-MM-DD)
│  ├─ requested_to [EXACT] (date string: YYYY-MM-DD)
│  ├─ effective_from [EXACT] (date string: YYYY-MM-DD)
│  ├─ effective_to [EXACT] (date string: YYYY-MM-DD)
│  └─ interval_days [EXACT] (int)
├─ metrics (object)
│  ├─ begin_assets_cents [EXACT] (int)
│  ├─ begin_assets_yuan [FORMAT] (string)
│  ├─ end_assets_cents [EXACT] (int)
│  ├─ end_assets_yuan [FORMAT] (string)
│  ├─ net_flow_cents [EXACT] (int)
│  ├─ net_flow_yuan [FORMAT] (string)
│  ├─ profit_cents [EXACT] (int)
│  ├─ profit_yuan [FORMAT] (string)
│  ├─ net_growth_cents [EXACT] (int)
│  ├─ net_growth_yuan [FORMAT] (string)
│  ├─ weighted_capital_cents [EXACT] (int)
│  ├─ weighted_capital_yuan [FORMAT] (string)
│  ├─ return_rate [APPROX] (float|null)
│  ├─ return_rate_pct [FORMAT] (string|null)
│  ├─ annualized_rate [APPROX] (float|null)
│  ├─ annualized_rate_pct [FORMAT] (string|null)
│  └─ note [WEAK] (string)
└─ cash_flows [EXACT for cents/date; FORMAT for yuan] (array<object>)
   └─ item
      ├─ snapshot_date [EXACT] (date string)
      ├─ transfer_amount_cents [EXACT] (int)
      ├─ transfer_amount_yuan [FORMAT] (string)
      ├─ weighted_days [EXACT] (int, 若存在)
      ├─ weight [APPROX] (float, 若存在)
      └─ ... [TBD，按真实输出补齐]
```

## 5. 关键不变量（必须断言）

- `metrics.net_growth_cents == metrics.profit_cents`（当前语义）
- `range.interval_days > 0`（成功场景）
- `range.effective_from <= range.effective_to`
- `cash_flows` 按 `snapshot_date` 升序（如当前实现承诺）

## 6. 归一化与比较规则（本接口）

- 金额字段 `*_cents`：`EXACT`
- 比率字段 `return_rate`, `annualized_rate`：`APPROX`
- 展示字段 `*_yuan`, `*_pct`：`FORMAT`（默认比较，允许降级 warning）
- `note`：`WEAK`

## 7. 样例（占位）

### 7.1 成功样例（单账户）

```json
{
  "account_id": "acct_sample",
  "account_name": "示例账户",
  "range": {
    "preset": "ytd",
    "requested_from": "2026-01-01",
    "requested_to": "2026-01-31",
    "effective_from": "2026-01-01",
    "effective_to": "2026-01-31",
    "interval_days": 30
  },
  "metrics": {
    "begin_assets_cents": 1000000,
    "end_assets_cents": 1100000,
    "net_flow_cents": 50000,
    "profit_cents": 50000,
    "weighted_capital_cents": 1025000,
    "return_rate": 0.04878049,
    "annualized_rate": 0.7
  },
  "cash_flows": []
}
```

### 7.2 成功样例（组合）

```json
{
  "account_id": "__portfolio__",
  "account_name": "投资组合",
  "account_count": 3,
  "range": {},
  "metrics": {},
  "cash_flows": []
}
```

### 7.3 错误样例（缺失 `account_id`）

```json
{
  "error": "account_id 必填"
}
```

## 8. 待补充（进入冻结前完成）

- 补齐 `cash_flows` 实际字段集合（以真实输出样本为准）
- 明确 `preset` 合法值全集（从 `parse_preset` 实现提取）
- 补充组合场景与单账户场景差异字段说明
