# 产品化前重构基线（v1）

目标：

- 在不改变现有核心功能行为的前提下，先做一轮“架构去耦 + 冗余清理 + 边界明确”的重构。
- 为后续可能的技术栈切换（后端运行时 / 前端框架）提供稳定的领域层边界。
- 保证每一步都可回归验证，不做“大爆炸式重写”。

当前结论（本轮梳理）

- 核心功能已具备可用性：
  - 投资记录维护、收益分析、财富总览/趋势
  - 预算与 FIRE（极简预算 + 总额对比 + 月度复盘）
  - 消费分析（已整合到工作台）
  - EML / 有知有行 / 招行 PDF 导入
- 主要架构风险集中在：
  - `scripts/keepwise_web_app.py` 单文件过大（历史累计，路由 + 领域逻辑 + 数据访问混合）
  - 前端页面脚本内联较多（功能可用，但后续迭代成本上升）
  - 领域逻辑和 HTTP 层耦合较紧（不利于技术栈切换）

## 重构原则（必须遵守）

1. 先加/用回归，再移动代码。
2. 每次只拆一个稳定边界（规则、预算、消费、投资收益、财富等）。
3. 保持 API 路径与返回结构兼容，优先“不改前端”。
4. 新代码优先沉淀为“纯函数/服务模块”，HTTP 层只做参数解析与路由。
5. 能复用现有验证脚本就复用，不引入新的未验证通路。

## 当前代码结构（梳理结果）

- `scripts/keepwise_web_app.py`
  - 本地 Web 入口
  - HTTP 路由（GET/POST）
  - 数据库 CRUD
  - 投资收益/财富聚合
  - 预算/FIRE/消费/收入聚合
  - 规则管理（已开始拆分）
- `scripts/import_classified_to_ledger.py`
  - 通用交易导入（EML/PDF 共用）
- `scripts/import_cmb_bank_pdf_transactions.py`
  - 招行 PDF 解析与规则分类
- `scripts/validate_m1_analytics.py`
  - 贯穿式回归（当前最重要的稳定器）
- `scripts/assets/*.html`
  - 工作台/规则管理/消费分析（内联脚本较重）

## 本轮已完成的结构重构（已落地）

### 1) 抽离规则管理服务模块

新增：

- `scripts/rules_service.py`

职责：

- 规则文件初始化与读写（商户映射、关键词规则、分析排除依赖文件初始化、银行卡转账白名单）
- 规则管理 CRUD（商户映射 / 关键词规则 / 转账白名单）
- 商户规则建议聚合查询

收益：

- `keepwise_web_app.py` 中“规则管理 + 白名单 + 商户建议”领域逻辑已从 HTTP 文件中移出
- 规则逻辑形成可复用服务模块，后续技术栈切换时可直接复用
- 路由层保持兼容（通过别名接入），前端无需改动

### 2) 抽离 M4 聚合服务模块（预算 / 消费 / 收入 / FIRE）

新增：

- `scripts/budget_fire_analytics_service.py`

职责：

- 月度预算项 CRUD 聚合与格式化
- 预算总览 / 月度预算复盘
- 消费分析聚合（供工作台消费分析页使用）
- 招行 PDF 收入分析（工资 / 公积金）
- FIRE 进度聚合（通过财富总览回调注入，避免反向依赖 HTTP 层）

当前处理策略（务实）：

- `keepwise_web_app.py` 保留 `ensure_db(...)` 与对外函数名（wrapper）
- wrapper 内调用 `budget_fire_analytics_service.py`
- 保持现有 API 路径与返回结构不变

收益：

- M4 高频迭代逻辑已与 HTTP 路由文件解耦
- 预算/消费/收入口径可以独立测试与迁移
- FIRE 口径已并入同一服务模块，M4 领域边界更完整
- `keepwise_web_app.py` 已进一步收敛到约 `1823` 行（继续降低中）

### 3) 抽离投资与财富聚合服务模块（Phase 3）

新增：

- `scripts/investment_analytics_service.py`
- `scripts/wealth_analytics_service.py`
- `scripts/http_route_tables.py`（Phase 4 中新增）

职责（当前已拆）：

- 投资账户/组合时间边界查询
- 期初/期末快照选择
- 区间转入转出记录加载
- Modified Dietz 现金加权收益率计算
- 投资收益与收益曲线聚合（单账户 / 组合 / 批量）
- 财富总览聚合（含负债/净资产/对账/滞后天数）
- 财富曲线聚合（含负债/净资产/净增长/区间预设）

当前处理策略（务实）：

- `keepwise_web_app.py` 保留原函数名，通过服务别名接入
- 所有上层调用点保持不变（收益分析/曲线/回归无需改）

收益：

- 核心收益率计算逻辑开始脱离 HTTP 文件
- 投资收益核心链路（收益/曲线/批量收益）已形成独立服务模块
- 财富总览/财富曲线口径也已脱离 HTTP 文件，核心口径边界已基本成型
- `query_fire_progress` 通过回调依赖财富总览，仍可保持服务层解耦

## 建议的下一阶段重构顺序（务实版）

### Phase 2：M4 聚合服务抽离（预算 / 消费 / 收入 / FIRE）

状态：

- 已完成（包含 `query_fire_progress`，通过财富总览回调注入）

目标：

- 把以下函数从 `keepwise_web_app.py` 抽到独立模块（如 `budget_fire_analytics_service.py`）：
  - `query_monthly_budget_items`
  - `upsert_monthly_budget_item`
  - `delete_monthly_budget_item`
  - `query_budget_overview`
  - `query_budget_monthly_review`
  - `query_consumption_report`
  - `query_salary_income_overview`
  - `query_fire_progress`

结果：

- M4 预算/消费/收入/FIRE 的核心聚合逻辑已集中在 `scripts/budget_fire_analytics_service.py`
- `keepwise_web_app.py` 中对应函数保留为薄 wrapper，API 对外行为不变
- 回归脚本验证通过（预算/FIRE/消费分析/收入分析）

### Phase 3：投资收益与财富聚合抽离（含 FIRE 依赖收口）

状态：

- 已完成：投资收益 + 财富总览/曲线聚合抽离（HTTP 层保留 wrapper）
- 下一步建议：进入 Phase 4（HTTP 路由注册表化）

目标：

- 把 Dietz 收益率、投资曲线、财富总览/财富曲线聚合抽离到服务模块

原因：

- 这是核心口径资产，需要独立成“领域层”
- 后续技术栈切换时最不应该重写这部分逻辑

### Phase 4：HTTP 路由注册表化

状态：

- 已完成（本轮）：`GET` / `POST` 路由已改为注册表分发，并抽离到 `scripts/http_route_tables.py`
- 待完成：按 domain 进一步拆分路由表（可选优化，不阻塞产品化）

目标：

- 将 `do_GET` / `do_POST` 巨型 `if` 链改为路由表（path -> handler）

收益：

- 新接口接入成本下降
- 更容易迁移到 FastAPI/Go HTTP router 等实现

### Phase 5：前端脚本模块化（先不换框架）

目标：

- 将 `workbench.html` 内联脚本逐步拆为 `assets/js/*.js`
- 保持当前原生 JS，不先引入前端框架

收益：

- 降低页面级回归成本
- 后续若切框架，也能先复用纯函数与数据适配层

## 技术栈切换前的“冻结条件”（建议）

满足以下条件再考虑整体技术栈切换：

1. 核心口径回归脚本长期稳定（收益/财富/预算/FIRE/导入）。
2. 领域逻辑至少完成 Phase 2 + Phase 3 抽离。
3. HTTP 层与领域层依赖方向清晰（路由 -> 服务，不反向依赖）。
4. 消费分析 / 预算 / 财富页面的 API schema 基本稳定。

## 实施方式建议（避免返工）

- 每一轮重构提交都使用“无行为变化”原则：
  - 先抽模块
  - 再改调用
  - 最后补回归
- 业务口径改动和重构改动不要混在同一 commit（便于回滚与定位）
