# 知恒 KeepWise

> 本地优先的个人财富管理工具。  
> 当前版本已实现：信用卡账单自动解析、消费分类、预算核对分析报告。

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

## 输出文件

主要查看：

- `data/output/reports/consumption_report.html`
- `data/output/reports/consumption_analysis.json`

分析明细：

- `data/work/processed/statements/transactions.csv`
- `data/work/processed/category/classified_transactions.csv`
- `data/work/processed/category/needs_review.csv`

## 隐私与安全

- 数据默认仅在本地处理
- 支持报告金额隐藏（隐私眼睛）
- `.gitignore` 默认忽略用户账单、规则内容、处理中间数据与报告产物

## 开发计划

后续将进入“本地财富管理主模块”开发（投资账户、资产总览、预算、AI 建议）。  
详见：`DEVELOPMENT_PLAN.md`
