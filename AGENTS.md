# BeyondYZYX - Session Notes / Agent Quickstart

本文件用于记录本轮开发沉淀，帮助下一次会话快速接手。

## 1) 本轮已完成功能

- EML 账单批量解析（招行信用卡）。
- 消费分类引擎（无 MCC 的场景）：
  - 商户映射优先（`merchant_map.csv`）。
  - 关键词规则兜底（`category_rules.csv`）。
  - 低置信度进入待确认清单。
- 分析排除机制：
  - 支持“保留原始交易，但排除统计”（如购车大额）。
  - 规则文件：`analysis_exclusions.csv`。
- 报告页面（HTML + 独立 CSS）：
  - 月份单选筛选。
  - 分类芯片多选（含“全选/清空”）。
  - 高频商户芯片多选，支持取消筛选。
  - 筛选条件 pills（可逐项删除 + 清空全部）。
  - 交易表头点击升降序排序。
  - 默认不展示待确认交易（通过开关可显示）。
  - 月度趋势图点位显示金额标签。
  - 隐私眼睛：一键隐藏/显示金额（显示 `***`）。
- 一键执行脚本：`run_report.sh`。
- SQLite 本地账本底座（M1 起步）：
  - 迁移脚本：`scripts/migrate_ledger_db.py`
  - 导入脚本：`scripts/import_classified_to_ledger.py`
  - 迁移文件：`db/migrations/0001_init.sql`
  - 默认数据库：`data/work/processed/ledger/keepwise.db`

## 2) 当前目录约定（非常重要）

- 用户输入（原始账单）：
  - `data/input/raw/eml/cmb/`
- 用户可编辑规则：
  - `data/rules/`
- 用户查看报告：
  - `data/output/reports/consumption_report.html`
- 中间处理数据（后续分析用）：
  - `data/work/processed/`

## 3) 运行方式（默认推荐）

```bash
./run_report.sh
```

脚本行为：

1. 从 `data/input/raw/eml/cmb/` 扫描 `*.eml`。
2. 解析并输出中间结果到 `data/work/processed/`。
3. 将用户报告产物移动到 `data/output/reports/`：
   - `consumption_report.html`
   - `consumption_report.css`
   - `consumption_analysis.json`
4. 初始化/迁移 SQLite 账本（`db/migrations/*.sql`）。
5. 将 `classified_transactions.csv` 导入 SQLite 总账。

## 4) 无 MCC 场景下的分类经验

- 最有效路线：`商户映射 + 关键词规则 + 人工回填` 的闭环。
- 建议每次流程：
  1. 跑一次报告；
  2. 查看 `needs_review.csv` 与 `merchant_map_suggestions.csv`；
  3. 更新 `data/rules/merchant_map.csv`；
  4. 再跑一次提高准确度。
- 规则优先级建议：
  - 固定商户优先于关键词规则。
  - 大类关键词避免过宽，防止误分类。

## 5) 报告代码结构注意事项

- HTML 模板在：`scripts/parse_cmb_statements.py`（`write_html_report`）。
- 样式源文件在：`scripts/assets/consumption_report.css`。
- 生成报告时会把 CSS 同步到报告目录。
- 如需改样式，请改 `scripts/assets/consumption_report.css`，不要直接改输出目录里的 CSS。

## 6) 已确认的关键业务口径

- “购车等一次性大额”可排除统计，但交易明细仍保留。
- 统计口径默认排除待确认交易（可手动打开）。
- 月份筛选是单选，不是多选。
- 分类筛选为芯片多选，交互与商户筛选一致。

## 7) Git 与数据管理约定

- 已初始化本地仓库，默认分支：`main`。
- `.gitignore` 已忽略用户数据与过程产物：
  - `data/input/raw/**`
  - `data/rules/**`
  - `data/work/processed/**`
  - `data/output/reports/**`
- 同时保留各目录 `.gitkeep`，确保新环境 clone 后目录可直接使用。

## 8) 下次会话快速启动清单

1. 确认账单已放入 `data/input/raw/eml/cmb/`。
2. 运行 `./run_report.sh`。
3. 打开 `data/output/reports/consumption_report.html` 检查结果。
4. 若待确认较多，先编辑 `data/rules/merchant_map.csv` 再重跑。
5. 若存在异常大额干扰，编辑 `data/rules/analysis_exclusions.csv` 再重跑。

## 9) 已知注意事项

- `run_report.sh` 会把报告文件从 `data/work/processed/reports/` 移到 `data/output/reports/`，这是设计行为。
- 如果要做自动化/定时任务，建议固定只读输入目录、只写输出目录，避免覆盖规则文件。

## 10) M0 文档入口

- 产品流程定义：`docs/m0/PRODUCT_FLOW_M0.md`
- 信息架构：`docs/m0/INFORMATION_ARCHITECTURE_M0.md`
- 数据字典：`docs/m0/DATA_DICTIONARY_V1.md`
- 当前收敛范围：仅做 EML 交互导入、投资记录单条录入、有知有行导出表批量导入、以及基础查询展示。

## 11) M0 开发进展（已开始落地）

- 新增本地工作台启动脚本：`run_m0_app.sh`。
- 新增 M0 Web 应用：`scripts/m0_web_app.py`。
  - EML 文件交互预览与确认导入。
  - 投资记录单条录入。
  - 有知有行 CSV / XLSX 预览与批量导入。
  - 交易/投资记录基础查询 API。
- 新增有知有行导入脚本：`scripts/import_youzhiyouxing_investments.py`。
- 新增数据库迁移：`db/migrations/0002_m0_investment_import_support.sql`。
  - `investment_records` 增加来源追溯字段：`source_type/source_file/import_job_id`。
  - 增加基础查询索引（交易与投资记录）。

## 12) 方向收敛（M1 及以后）

- 用户已确认：M1 之后只聚焦“有知有行核心价值”，其他模块暂缓。
- 当前主线仅保留四项：
  1. 投资记录手动更新（已实现）。
  2. 按账户计算区间收益率（现金加权，支持年度/近一年等区间）。
  3. 财富总览（投资账户 + 现金账户 + 不动产账户加总）。
  4. 上述记录随时间增长曲线可视化。
- 暂缓能力：
  - 交易总账深度 CRUD。
  - 预算、对账、AI 建议。
  - 云同步与复杂自动化。

## 13) M1 当前落地进展（已实现）

- 新增迁移：`db/migrations/0004_add_account_valuations.sql`
  - 新表 `account_valuations`：用于现金/不动产按账户快照记录。
- `scripts/m0_web_app.py` 新增能力：
  - 现金/不动产手工录入：`POST /api/assets/manual`
  - 账户元数据：`GET /api/meta/accounts`
  - 投资区间收益率（现金加权/Modified Dietz）：
    - `GET /api/analytics/investment-return`
  - 投资资产曲线：
    - `GET /api/analytics/investment-curve`
  - 财富总览：
    - `GET /api/analytics/wealth-overview`
  - 财富增长曲线：
    - `GET /api/analytics/wealth-curve`
- `scripts/assets/m0_app.html` 与 `scripts/assets/m0_app.css` 已扩展为 M1 工作台：
  - 导入中心（保留）
  - 记录录入（投资 + 现金/不动产）
  - 收益分析（区间收益率 + 投资总资产曲线 + 区间累计收益率曲线）
  - 财富总览（聚合 + 财富曲线）
  - 基础查询（交易/投资/非投资资产）

## 14) 回归校验（新增）

- 新增回归脚本：`scripts/validate_m1_analytics.py`。
- 用临时数据库构造固定样本，自动校验：
  - 区间收益率（Modified Dietz）数值稳定。
  - 曲线终点累计收益率 = 同区间收益率。
  - 曲线每个点累计收益率 = 区间起点到该点的收益率。
  - 财富总览与财富曲线聚合口径一致。
- 建议在每次调整收益算法后执行：
  - `python3 scripts/validate_m1_analytics.py`
