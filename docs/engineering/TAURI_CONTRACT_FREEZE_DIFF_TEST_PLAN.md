# KeepWise Tauri Phase 1 契约冻结与跨语言差分测试计划（Draft v1）

更新时间：2026-02-23
状态：执行计划草案（待评审后进入实施）
适用阶段：`Migrate-P1`（契约冻结 + 黄金样本 + 差分框架）

关联文档：

- `docs/engineering/TAURI_STACK_MIGRATION_MASTER_PLAN.md`
- `docs/engineering/TAURI_TECH_SELECTION_DECISION_MATRIX.md`

## 1. 文档目的

本计划用于把“先冻结契约/口径，再迁移 Rust”的原则落到可执行任务上，重点解决两件事：

1. **契约冻结**：明确当前 Python 实现的接口输入/输出契约、默认值、错误语义、关键字段口径。
2. **跨语言差分测试**：在 Rust 逐步替换 Python 的过程中，自动验证输出口径一致（尤其收益率与财富分析）。

本计划优先覆盖当前最核心、最容易造成财务口径漂移的接口：

- `/api/analytics/investment-return`
- `/api/analytics/investment-curve`
- `/api/analytics/wealth-overview`
- `/api/analytics/wealth-curve`

## 2. 背景与已确认前提

根据已确认决策（2026-02-23）：

- 前端：`React + TypeScript + Vite`
- Rust SQLite：`rusqlite`
- 迁移策略：允许桌面端临时 Python bridge，移动端不允许长期依赖
- 执行顺序：**先契约冻结与差分测试，再进行大规模前端重构**

这意味着 Phase 1 的目标不是“多写功能”，而是建立一套后续每次迁移都能复用的正确性护栏。

## 3. Phase 1 成功定义（本计划范围）

本计划完成时，应满足：

1. 已形成核心分析接口的契约文档与黄金样本（脱敏）。
2. 已形成可执行的 Python vs Rust 差分测试框架（即使 Rust 仅完成 1 条链路）。
3. 差分结果能区分：
   - 数值误差（可容忍）
   - 非语义差异（可归一化）
   - 真实口径回归（必须阻断）
4. 至少跑通一条完整差分链路：
   - 推荐优先：`investment-return`（单账户 + 组合）

## 4. 非目标（Phase 1 不做）

- 不做大规模 UI 视觉重构
- 不做全量接口一次性冻结（先做核心高价值接口）
- 不要求 Rust 完成全部分析逻辑
- 不要求移动端自动化测试体系一次到位

## 5. 当前实现基线（作为冻结对象）

当前核心接口与实现位置（已重构）：

- 路由注册：`scripts/http_route_tables.py`
- 投资分析服务：`scripts/investment_analytics_service.py`
- 财富分析服务：`scripts/wealth_analytics_service.py`
- 回归基线脚本：`scripts/validate_m1_analytics.py`

已确认相关接口（核心分析）：

- `GET /api/analytics/investment-return`
- `GET /api/analytics/investment-returns`
- `GET /api/analytics/investment-curve`
- `GET /api/analytics/wealth-overview`
- `GET /api/analytics/wealth-curve`

本计划先冻结其中 4 个最关键接口（`investment-returns` 作为第二优先级扩展）。

## 6. 术语定义（统一口径）

- **契约（Contract）**：
  - 接口路径、方法、参数、默认值、错误条件、返回 JSON 结构、字段类型与字段语义。
- **契约冻结（Contract Freeze）**：
  - 在迁移窗口期内，将关键接口的行为视为“基线”，变更必须经过评审并同步更新样本与差分规则。
- **黄金样本（Golden Dataset / Golden Output）**：
  - 脱敏且可重复使用的输入数据 + 对应基线输出样本。
- **差分测试（Diff Test）**：
  - 同一输入分别调用 Python 与 Rust 实现，比较输出差异并给出分类结果。
- **归一化（Normalization）**：
  - 在比较前，对非语义差异做标准化处理（例如键顺序、格式化字符串、行顺序）。

## 7. 范围与优先级（Phase 1）

## 7.1 P1-A（必须完成）

优先冻结并纳入差分的接口：

1. `GET /api/analytics/investment-return`
2. `GET /api/analytics/investment-curve`
3. `GET /api/analytics/wealth-overview`
4. `GET /api/analytics/wealth-curve`

原因：

- 对应核心产品价值（收益率与财富分析）
- 财务口径最敏感，最需要自动化护栏
- 现有 `scripts/validate_m1_analytics.py` 已覆盖部分一致性校验，便于复用

## 7.2 P1-B（建议完成）

作为 Phase 1 扩展（时间允许）：

1. `GET /api/analytics/investment-returns`（批量账户收益率）
2. `GET /api/meta/accounts`（前端依赖较高）
3. `GET /api/query/investments` / `GET /api/query/assets`（为前端基础展示做铺垫）

## 7.3 P1-C（不进入首轮冻结）

暂不进入首轮契约冻结（后续阶段处理）：

- 导入预览/导入执行接口（EML / YZXY / CMB PDF）
- 规则管理 CRUD
- 预算/消费/FIRE 分析

说明：这些接口仍需要文档化，但不阻塞 P1 主目标。

## 8. 契约冻结策略（怎么冻结）

契约冻结不是只写一份文档，而是建立 4 层资产：

1. **接口契约文档**（人读）
2. **样例请求/响应 JSON**（机器可读）
3. **TS 类型定义（冻结版）**（前端使用）
4. **差分测试用例清单**（自动验证）

## 8.1 契约文档内容模板（建议）

每个接口文档至少包含以下章节：

1. 接口用途（业务语义）
2. 请求参数
3. 参数默认值与合法值范围
4. 错误条件与错误信息（当前行为）
5. 返回结构（字段树）
6. 字段语义说明（尤其金额、比率、日期）
7. 排序与稳定性规则（如 rows 顺序）
8. 口径不变量（invariants）
9. 样例（正常 / 边界 / 错误）

## 8.2 冻结规则（变更控制）

对于已冻结接口，以下变更视为 **breaking change**（需要评审与版本记录）：

- 删除字段
- 改字段类型
- 改字段含义（例如 `net_growth_cents` 从利润改成净值变化）
- 改默认参数行为
- 改错误触发条件
- 改行排序导致前端依赖行为变化

以下变更可视为 **非破坏性**（仍需更新样例/文档）：

- 新增可选字段
- 新增不影响默认行为的可选参数
- 错误消息文案细化（前提是可归类错误码/类别不变）

## 9. 优先接口契约冻结清单（P1-A）

本节定义首轮冻结的重点字段和行为，避免 Phase 1 写成“泛泛文档”。

## 9.1 `GET /api/analytics/investment-return`

用途：

- 计算单账户或组合账户（`__portfolio__`）在指定区间的现金加权收益率（Modified Dietz）

关键参数（当前行为）：

- `account_id`（必填）
- `preset`（默认 `ytd`）
- `from` / `to`（`preset=custom` 时关键）

需要冻结的关键行为：

- `account_id` 为空时报错
- 单账户与组合账户返回结构兼容（但组合可能多 `account_count`）
- `range` 内 `requested_*` 与 `effective_*` 的区别
- `metrics.return_rate` / `annualized_rate` 保留小数精度与 `None` 语义
- `cash_flows` 列表结构与排序

关键口径字段（优先差分）：

- `range.effective_from`
- `range.effective_to`
- `range.interval_days`
- `metrics.begin_assets_cents`
- `metrics.end_assets_cents`
- `metrics.net_flow_cents`
- `metrics.profit_cents`
- `metrics.weighted_capital_cents`
- `metrics.return_rate`
- `metrics.annualized_rate`

可归一化字段（不作为核心数值口径）：

- `*_yuan` 格式化字符串
- `*_pct` 格式化字符串
- `note` 文案（如仅文案差异但数值一致，可降级为告警）

## 9.2 `GET /api/analytics/investment-curve`

用途：

- 返回账户/组合在区间内的资产曲线与累计收益率曲线

关键参数（当前行为）：

- `account_id`（必填）
- `preset`（默认 `1y`）
- `from` / `to`

需要冻结的关键行为：

- 点位集合生成规则（含区间边界补点）
- `rows` 时间顺序（升序）
- 曲线终点累计收益率与同区间 `investment-return` 一致
- 每个点的累计收益率 = 区间起点至该点收益率

关键口径字段（优先差分）：

- `range.effective_from`
- `range.effective_to`
- `summary.end_cumulative_return_rate`（组合/单账户场景均适用时）
- `rows[*].effective_snapshot_date`
- `rows[*].total_assets_cents`
- `rows[*].cumulative_net_growth_cents`
- `rows[*].cumulative_return_rate`

不变量（必须断言）：

- `rows` 按 `snapshot_date` 升序
- `summary.count == len(rows)`（若接口定义含该字段）
- 最后一行累计收益率与区间收益率一致（允许误差阈值）

## 9.3 `GET /api/analytics/wealth-overview`

用途：

- 按 `as_of` 聚合投资/现金/不动产/负债，并输出汇总与明细

关键参数（当前行为）：

- `as_of`（可选）
- `include_investment`
- `include_cash`
- `include_real_estate`
- `include_liability`

需要冻结的关键行为：

- 全部筛选项都为 `false` 时返回错误
- `as_of` 超过最新可用日期时，`effective as_of` 取可用最新值（当前返回 `as_of` + `requested_as_of`）
- 明细行 `stale_days` 计算逻辑
- 汇总与明细对账字段（`reconciliation_*`）口径

关键口径字段（优先差分）：

- `as_of`
- `requested_as_of`
- `filters.*`
- `summary.gross_assets_total_cents`
- `summary.liability_total_cents`
- `summary.net_asset_total_cents`
- `summary.selected_rows_total_cents`
- `summary.reconciliation_delta_cents`
- `summary.reconciliation_ok`
- `summary.stale_account_count`
- `rows[*].asset_class`
- `rows[*].account_id`
- `rows[*].snapshot_date`
- `rows[*].value_cents`
- `rows[*].stale_days`

不变量（必须断言）：

- `reconciliation_ok == (reconciliation_delta_cents == 0)`
- `selected_rows_total_cents == net_asset_total_cents`（在当前对账通过时）
- `stale_account_count == count(rows where stale_days > 0)`

## 9.4 `GET /api/analytics/wealth-curve`

用途：

- 返回指定区间内财富/净资产/负债等时间序列与汇总变化

关键参数（当前行为）：

- `preset`（默认 `1y`）
- `from` / `to`
- `include_investment`
- `include_cash`
- `include_real_estate`
- `include_liability`

需要冻结的关键行为：

- 全部筛选项为 `false` 时返回错误
- 区间边界与补点逻辑
- `rows` 中各资产类型与净资产、总财富的聚合关系
- `summary` 与 `rows[0]` / `rows[-1]` 的一致性

关键口径字段（优先差分）：

- `range.requested_from`
- `range.requested_to`
- `range.effective_from`
- `range.effective_to`
- `range.points`
- `filters.*`
- `summary.start_wealth_cents`
- `summary.end_wealth_cents`
- `summary.change_cents`
- `summary.start_liability_cents`
- `summary.end_liability_cents`
- `summary.net_asset_change_cents`
- `rows[*].snapshot_date`
- `rows[*].investment_total_cents`
- `rows[*].cash_total_cents`
- `rows[*].real_estate_total_cents`
- `rows[*].liability_total_cents`
- `rows[*].wealth_total_cents`
- `rows[*].net_asset_total_cents`

不变量（必须断言）：

- `range.points == len(rows)`
- `summary.start_wealth_cents == rows[0].wealth_total_cents`（有点位时）
- `summary.end_wealth_cents == rows[-1].wealth_total_cents`（有点位时）
- `rows[*].net_asset_total_cents == rows[*].wealth_total_cents - selected_liability`（按筛选计算）

## 10. 契约资产与目录结构建议（新增）

建议在仓库内新增（示意）：

```text
tests/
  contracts/
    analytics/
      investment-return.contract.md
      investment-curve.contract.md
      wealth-overview.contract.md
      wealth-curve.contract.md
    schemas/
      analytics/
        investment-return.sample.success.single.json
        investment-return.sample.success.portfolio.json
        investment-return.sample.error.missing-account-id.json
        ...
  golden/
    datasets/
      m1_analytics_minimal/
        seed_manifest.json
        expected/
          python/
            investment-return__single__ytd.json
            wealth-overview__default.json
      m1_analytics_edge_cases/
        ...
  diff/
    cases/
      analytics_core.yaml
    baselines/
      ...
```

前端类型（Phase 1 冻结版）建议位置：

- `frontend/src/types/contracts/analytics.ts`

说明：

- Phase 1 可先手写类型；
- Phase 2+ 再考虑 Rust DTO -> TS 自动生成。

## 11. 黄金样本策略（Golden Dataset）

## 11.1 样本分层

建议建立 4 层样本：

1. **S0 最小样本（必做）**
   - 使用脚本构造临时数据库
   - 覆盖收益率、财富总览、财富曲线最小场景
   - 可复用 `scripts/validate_m1_analytics.py` 的构造逻辑

2. **S1 典型样本（必做）**
   - 多投资账户 + 现金 + 不动产 + 负债
   - 覆盖组合收益率、筛选组合、滞后天数

3. **S2 边界样本（必做）**
   - 空区间 / 无有效快照 / 全筛选关闭 / 自定义日期错误
   - 用于错误语义冻结

4. **S3 脱敏真实样本（建议）**
   - 从真实库导出最小必要字段并脱敏
   - 用于验证口径稳定性与真实分布

## 11.2 样本生成原则

- 金额以分为单位保存，避免浮点误差源
- 日期固定，避免“今天/当前时间”导致样本漂移
- 明确每个样本的目标（覆盖哪些 invariants）
- 样本必须可重复构建（幂等）

## 11.3 样本脱敏原则（真实样本）

- 替换账户 ID / 账户名（保留结构，不保留真实标识）
- 替换商户名、来源文件名、描述文本中的敏感内容
- 保留金额、日期与资产类型关系（这是口径核心）
- 保留多账户/滞后日期/筛选组合特征

## 12. 差分测试设计（Python vs Rust）

## 12.1 总体架构（Phase 1 推荐）

初期复用 Python 做编排（已在决策表确认），建议采用“适配器 + 归一化 + 比较器”结构：

1. **Case Loader**
   - 读取用例定义（接口、参数、数据集、预期结果模式）
2. **Python Adapter**
   - 调用当前 Python 实现（优先函数级调用，避免 HTTP 噪音）
3. **Rust Adapter**
   - 调用 Rust 命令实现（初期可通过 CLI/command mock 输出 JSON）
4. **Normalizer**
   - 对两侧输出做统一归一化
5. **Comparator**
   - 执行精确比较 / 近似比较 / 不变量断言
6. **Reporter**
   - 输出差异报告（字段路径、旧值、新值、差异类型）

## 12.2 调用方式建议（避免不必要噪音）

Phase 1 推荐优先顺序：

1. **函数级调用（Python）**
   - 直接调用 `query_*` 函数，减少 HTTP 层编码/排序/错误封装噪音
2. **命令级调用（Rust）**
   - Rust 侧提供可直接执行的测试命令或 CLI wrapper，输出 JSON
3. **HTTP 级调用（补充）**
   - 用于最终端到端校验，不作为首轮差分主路径

原因：

- 契约冻结阶段重点是领域口径，不是网络层兼容细节。

## 12.3 归一化规则（必须明确）

差分前统一做以下归一化：

### 结构归一化

- JSON 对象按 key 排序（比较器内部处理）
- 列表按业务主键排序（若接口未承诺顺序）
- 对明确承诺顺序的列表（如曲线 `rows`）保持原顺序并校验顺序

### 类型归一化

- `int` 金额字段（`*_cents`）必须精确相等
- `float` 比率字段（`*_rate`, `*_pct` 非文本）允许误差阈值比较
- 日期字段统一 ISO `YYYY-MM-DD`
- 布尔字段必须精确相等

### 文本字段归一化（可选策略）

- `*_yuan`、`*_pct_text`、`*_pct` 文本可按阶段处理：
  - Phase 1：默认比较并报告
  - 若仅格式细节差异且数值一致，可降级为 warning
- `note` 字段可单独设为“弱比较字段”

### 空值归一化

- 明确区分 `null` / `0` / `""`
- 不允许将 `None`（null）无规则替换为 0

## 12.4 比较规则（按字段类型）

建议支持 4 种比较模式：

1. **Exact（精确）**
   - 适用：`*_cents`、布尔、日期、枚举、ID
2. **Approx（近似）**
   - 适用：收益率、变化率等浮点字段
   - 默认阈值：`abs_tol = 1e-8`
3. **Derived Invariant（派生不变量）**
   - 适用：`summary` 与 `rows` 一致性、对账字段一致性
4. **Weak Text（弱文本）**
   - 适用：文案说明字段（如 `note`）

## 12.5 错误语义比较（很重要）

差分测试不仅比较成功响应，也要比较错误行为：

- 参数缺失错误（如 `account_id` 缺失）
- 非法布尔参数错误
- 区间无有效快照错误
- 全筛选关闭错误

Phase 1 建议先冻结“错误类别 + 关键语义”，不要过早绑定完整文案逐字一致：

- 示例分类：
  - `VALIDATION_ERROR`
  - `NO_DATA_ERROR`
  - `INVALID_RANGE_ERROR`

实现方式（Phase 1 可简单实现）：

- 在差分 case 中配置“错误关键字匹配”或“错误类别映射函数”
- Rust 与 Python 返回文案不同但语义相同，可判为通过（warning）

## 13. 差分用例设计（首轮）

本节给出 Phase 1 需要落地的最小用例集，避免计划过大无法执行。

## 13.1 `investment-return` 用例（首轮必须）

成功场景：

1. 单账户 + `preset=ytd`
2. 单账户 + `preset=1y`
3. 单账户 + `preset=custom`（明确 `from` / `to`）
4. 组合账户（`account_id=__portfolio__`）+ `preset=ytd`

错误场景：

5. 缺失 `account_id`
6. `preset=custom` 但 `from` 非法
7. 区间有效快照不足（样本触发）

不变量校验：

- `metrics.net_growth_cents == metrics.profit_cents`（当前语义）
- `range.interval_days > 0`（成功场景）

## 13.2 `investment-curve` 用例（首轮必须）

成功场景：

1. 单账户 + `preset=1y`
2. 单账户 + `preset=custom`
3. 组合账户 + `preset=ytd`

错误场景：

4. 缺失 `account_id`
5. 区间无可用快照

不变量校验：

- `rows` 升序
- 曲线终点累计收益率与 `investment-return` 同区间一致（`abs_tol=1e-8`）
- 每点累计收益率与“起点到该点收益率”一致（可复用现有回归逻辑）

## 13.3 `wealth-overview` 用例（首轮必须）

成功场景：

1. 默认筛选（全开）
2. `as_of` 指定历史日期
3. `as_of` 超过最新日期（验证 `requested_as_of` / `as_of`）
4. 关闭投资，仅现金/不动产/负债
5. 仅负债（验证净资产为负或减法逻辑）

错误场景：

6. 全部 `include_* = false`
7. 非法布尔参数值

不变量校验：

- 对账字段一致性（`reconciliation_*`）
- `stale_account_count` 与明细计算一致

## 13.4 `wealth-curve` 用例（首轮必须）

成功场景：

1. 默认筛选 + `preset=1y`
2. `preset=ytd`
3. `preset=custom`
4. 关闭投资（仅现金/不动产/负债）
5. 关闭负债（验证净资产与总资产关系）

错误场景：

6. 全部 `include_* = false`

不变量校验：

- `range.points == len(rows)`
- `summary.start/end_*` 与首尾行一致
- `rows[*].wealth_total_cents` 与分项聚合关系一致

## 14. 实施步骤（Phase 1 执行清单）

建议按以下顺序推进，降低返工：

## Step 1：冻结接口范围与字段树（1-2 天）

产出：

- 4 个核心接口的契约文档初版
- 字段树清单（标记：核心口径字段 / 格式字段 / 弱比较字段）

重点：

- 明确哪些字段必须精确对齐
- 明确哪些字段允许弱比较或后置

## Step 2：建立黄金样本目录与样本生成脚本（1-2 天）

产出：

- `tests/golden/datasets/...` 初版目录
- S0/S1/S2 样本最小集
- 样本清单与覆盖目标说明

重点：

- 复用 `scripts/validate_m1_analytics.py` 的样本构造逻辑
- 保持样本可重复、幂等、脱敏

## Step 3：实现差分测试运行器（Python 编排）（2-4 天）

产出：

- 差分运行器脚本（建议放 `tools/migration/`）
- 归一化器与比较器
- 差异报告输出格式（CLI 文本 + JSON）

重点：

- 先支持 `investment-return`
- 框架设计要能扩展到其余接口

## Step 4：接入第一条 Rust 链路并跑通差分（2-4 天）

产出：

- Rust 最小 `investment-return` 实现（或 stub + 部分逻辑）
- Python vs Rust 差分跑通至少 1 个成功场景 + 1 个错误场景

重点：

- 先证明框架有效，再扩展覆盖面

## Step 5：扩展到财富接口并接入 CI（2-4 天）

产出：

- `wealth-overview` / `wealth-curve` 差分用例接入
- 本地开发脚本 + CI 任务（至少 PR 可跑核心差分）

重点：

- 报告可读性（失败时能快速定位字段路径）

## 15. 建议新增脚本与文件（具体到仓库）

建议新增（示意）：

- `tools/migration/run_diff_regression.py`
- `tools/migration/diff_normalizers.py`
- `tools/migration/diff_comparators.py`
- `tools/migration/cases/analytics_core.yaml`
- `tests/contracts/analytics/*.contract.md`
- `tests/golden/datasets/*`

可复用/参考：

- `scripts/validate_m1_analytics.py`
- `scripts/investment_analytics_service.py`
- `scripts/wealth_analytics_service.py`

## 16. 本地执行与 CI 接入建议

## 16.1 本地执行（开发阶段）

建议分 3 类命令：

1. 契约检查（样例/文档同步）
2. Python 基线回归（现有脚本）
3. Python vs Rust 差分

示例（占位，后续实现时再定最终命令名）：

```bash
python3 scripts/validate_m1_analytics.py
python3 tools/migration/run_diff_regression.py --suite analytics_core
python3 tools/migration/run_diff_regression.py --suite analytics_core --endpoint investment-return
```

## 16.2 CI 接入（Phase 1 最小版）

PR 检查建议顺序：

1. Python 基线回归（必须）
2. Rust 单元测试（若 Rust 模块已存在）
3. 差分测试（仅执行已迁移接口）

注意：

- 在 Rust 尚未覆盖某接口前，差分 case 可标记 `pending` / `python-only-baseline`
- 不要因为“未实现”把整个 CI 设计成常年红灯

## 17. 验收标准（Phase 1 Go/No-Go）

满足以下条件即视为本计划完成：

1. 4 个核心接口的契约文档已落盘并包含样例。
2. S0/S1/S2 黄金样本已建立并可重复生成/执行。
3. 差分测试运行器可执行，至少支持：
   - 成功响应比较
   - 错误响应比较
   - 不变量断言
4. 已跑通 `investment-return` 的 Python vs Rust 差分（至少单账户 + 组合）
5. 差异报告可读，可定位到字段路径。

建议加分项（但不阻塞）：

- `wealth-overview` / `wealth-curve` 差分已跑通
- `investment-curve` 点位级不变量差分已接入

## 18. 风险与应对（Phase 1）

1. **契约文档写得过宽，无法指导比较器实现**
   - 应对：本计划已要求“字段树 + 字段比较强度”标注

2. **差分测试过度绑定格式文案，导致大量噪音**
   - 应对：引入“弱文本字段”与错误类别映射

3. **样本不足导致 Rust 迁移后才暴露口径问题**
   - 应对：S0/S1/S2 分层 + 尽早补 S3 脱敏真实样本

4. **CI 过早全量化导致开发效率下降**
   - 应对：Phase 1 只跑核心套件，按接口迁移进度逐步扩展

## 19. 下一步（建议我继续产出）

如果你确认这份计划方向正确，下一轮我建议直接继续做其中一个：

1. 新建 `tests/contracts/analytics/` 下 4 个接口的契约模板（含字段树骨架）
2. 新建 `tools/migration/cases/analytics_core.yaml` 差分用例清单（首轮最小集）
3. 新建 `tools/migration/run_diff_regression.py` 脚手架（先跑 Python baseline / 预留 Rust adapter）
4. 新建 `TAURI_P0_POC_PLAN.md`（并与本计划配套）

---

注：本文件将“契约冻结”和“差分策略”合并在一个执行计划中，后续如内容增长可拆分为：

- `TAURI_CONTRACT_FREEZE_PLAN.md`
- `TAURI_DIFF_TEST_STRATEGY.md`
