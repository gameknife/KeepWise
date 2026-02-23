# 知恒 KeepWise

[![Demo](https://img.shields.io/badge/Demo-GitHub%20Pages-2ea44f?style=for-the-badge)](https://gameknife.github.io/KeepWise/examples/demo/)

> 本地优先的个人财富管理工具。  
> 当前版本已实现：信用卡账单自动解析、消费分类、预算核对分析报告。

## 在线 Demo

**立即体验（GitHub Pages）：[https://gameknife.github.io/KeepWise/examples/demo/](https://gameknife.github.io/KeepWise/examples/demo/)**

## 为自己开发的FIRE进度指示器

我拥有多个投资账户，信用卡账户，工资卡账户，每个账户都可以方便的看到资产的各种加权收益率，资金增长情况等。但我始终没法对整体资产有一个全面的了解，对于整体资产的加权收益率，乃至月度，年度的增长金额，也始终没有一个地方可以查看。对于FIRE的目标，也只是简单的做了一个支出预算，按照一时兴起的一个安全提取率，来计算了一个存够xxx万就退休的目标。

因此我非常需要一个记投资帐的工具，来帮我获得一个准确的fire进度条。

我在2025年遇见了“有知有行”，这个软件几乎解决了我所有的需求，我确实使用了他很久，目前已经超过半年，但我始终有一个顾虑：

> 我的所有数据都存在他们的服务器上

因此我特别想要一个本地版的有知有行，如果我能自己开发一个，那么还可以加上我自认为急需的一些功能，比如根据信用卡账单自动分析消费，和预算核对等。
但之前由于时间和技术栈的问题，这个想法也永远只是一个想法，今年不同了，今年有了claude code，codex，gemini cli。我花了一下午尝试，确定了我可以很快的为自己做一个。当然，可能也可以为很多和我一样的人做一个。

## 项目定位

**知恒（KeepWise）** 目标是做一个本地运行、数据可控的财富管理软件：

- 投资记录与资产管理是核心
- 消费记录用于预算核对与资金复盘
- 默认本地处理，不依赖云端保存个人财务数据

当前仓库阶段：已完成“支出盘点模块”。

## 当前可用功能

- 批量解析招行信用卡 `eml` 账单
- 自动分类（商户映射 + 关键词规则）
- 待确认交易输出（便于人工校对）
- 排除规则（如购车大额：保留明细、排除统计）
- 交互式 HTML 报告：
  - 月份单选
  - 分类/商户筛选
  - 交易列表排序
  - 趋势图金额点位
  - 金额隐私开关（`***`）

## 快速开始（3 步）

1. 把账单文件放到：`data/input/raw/eml/cmb/`
2. 在项目根目录运行：

```bash
./run_report.sh
```

3. 打开报告：`data/output/reports/consumption_report.html`

## M0/M1 交互式工作台（新增）

启动本地 Web（默认 `http://127.0.0.1:8081`）：

```bash
./run_keepwise_app.sh
```

当前支持：
- EML 文件交互式预览与确认导入（浏览器选文件）
- 投资记录单条录入（手工）
- 投资记录修改 / 删除（含导入记录纠错）
- 现金/不动产记录单条录入（手工）
- 现金/不动产记录修改 / 删除
- 有知有行导出 CSV / XLSX 批量导入
- 交易/投资记录基础查询与简单汇总
- 交易查询展示真实消费分类（`expense_category`）
- 投资账户区间收益率（现金加权 / Modified Dietz）
- 支持“全部投资账户（组合）”区间收益率与收益率曲线
- 同一区间全部投资账户收益率对比（自动排序）
- 财富总览（投资/现金/不动产/负债）与净资产趋势
- 财富页支持资产类型胶囊筛选、趋势预设切换（成立以来 / 近一年 / YTD）
- 财富页包含资产趋势堆叠图与财富关系图（Sankey）
- 投资曲线同时展示总资产与区间累计收益率变化
- 收益分析 / 财富分析支持净增长资金统计与曲线切换
- 高级管理：数据库全量清理（确认口令）并支持重新导入验证
- 独立规则页：`/rules`，支持消费分类规则管理（商户映射/关键词规则/建议回填）
- 主工作台与规则页支持统一“隐私截图模式（金额隐藏）”

M1 回归校验（建议每次改收益算法后执行）：

```bash
python3 scripts/validate_m1_analytics.py
```

运行库健康检查（真实 `keepwise.db`，只读检查核心接口）：

```bash
python3 scripts/check_runtime_db_health.py
```

## Demo 示例（已脱敏）

在线地址（推荐直接访问）：

- [https://gameknife.github.io/KeepWise/examples/demo/](https://gameknife.github.io/KeepWise/examples/demo/)

仓库内已提供可交互示例：

- `examples/demo/consumption_report.html`
- `examples/demo/index.html`（用于 GitHub Pages 目录入口）

配套数据与 CSV：

- `examples/demo/consumption_analysis.json`
- `examples/category/summary_by_expense_category.csv`
- `examples/category/summary_by_merchant.csv`
- `examples/category/needs_review.csv`

说明：

- 示例数据已做商户/摘要/来源脱敏。
- 金额已做混淆处理，仅用于交互展示。
- 若希望在 GitHub 上直接在线访问交互页面，建议启用 GitHub Pages 并指向该文件。

## 目录说明

- `data/input/raw/eml/cmb/`：原始账单输入目录
- `data/rules/`：可编辑规则目录
- `data/output/reports/`：用户查看报告目录
- `data/work/processed/`：处理中间数据目录

## 规则维护

首次运行会自动生成规则文件：

- `data/rules/merchant_map.csv`
- `data/rules/category_rules.csv`
- `data/rules/analysis_exclusions.csv`

建议流程：

1. 先跑一次报告
2. 查看待确认与商户建议
3. 补充规则
4. 再跑一次提升准确率

## 生成脱敏 Demo（可选）

当你更新了本地真实数据后，可重新生成示例：

```bash
python3 scripts/generate_demo_example.py
```

## 输出文件

主要查看：

- `data/output/reports/consumption_report.html`
- `data/output/reports/consumption_analysis.json`

分析明细：

- `data/work/processed/statements/transactions.csv`
- `data/work/processed/category/classified_transactions.csv`
- `data/work/processed/category/needs_review.csv`

本地账本数据库（M1 底座）：

- `data/work/processed/ledger/keepwise.db`

可选检查：

```bash
python3 scripts/migrate_ledger_db.py --db data/work/processed/ledger/keepwise.db
python3 scripts/import_classified_to_ledger.py \
  --db data/work/processed/ledger/keepwise.db \
  --classified-csv data/work/processed/category/classified_transactions.csv
```

## 隐私与安全

- 数据默认仅在本地处理
- 支持报告金额隐藏（隐私眼睛）
- `.gitignore` 默认忽略用户账单、规则内容、处理中间数据与报告产物

## 开发计划

后续将进入“本地财富管理主模块”开发（投资账户、资产总览、预算、AI 建议）。  
详见：`DEVELOPMENT_PLAN.md`

## M0 产物（流程与架构）

- 产品流程定义：`docs/foundation/PRODUCT_FLOW.md`
- 信息架构：`docs/foundation/INFORMATION_ARCHITECTURE.md`
- 数据字典 v1：`docs/foundation/DATA_DICTIONARY_V1.md`
