# 招行信用卡账单自动分析（本地）

这个项目用于读取你导出的 `eml` 账单，自动生成分类统计和可交互 HTML 报告。

## 快速开始（3 步）

1. 把账单文件放到这个目录：`data/input/raw/eml/cmb/`
2. 在项目根目录执行：`./run_report.sh`
3. 打开报告：`data/output/reports/consumption_report.html`

就这么简单。日常使用只需要这 3 步。

## 你只需要记住的目录

- `data/input/raw/eml/cmb/`  
  放原始账单 `eml` 文件。
- `data/output/reports/`  
  查看最终报告（用户主要使用这里）。
- `data/rules/`  
  可编辑规则文件（分类、排除等）。
- `data/work/processed/`  
  中间和分析数据（给后续深度分析使用）。

## 规则文件怎么用

首次运行后会自动生成这 3 个文件：

- `data/rules/merchant_map.csv`：商户映射到分类
- `data/rules/category_rules.csv`：关键词分类规则
- `data/rules/analysis_exclusions.csv`：排除分析规则（如购车大额）

常见做法：

1. 跑一次脚本，看报告和待确认记录。
2. 补充 `merchant_map.csv` 里未识别商户的分类。
3. 再跑一次脚本，分类会更准确。

## 报告里能看到什么

- 总消费、均额、月度趋势、分类占比
- 高频商户筛选、分类筛选、关键词筛选
- 可排序交易列表
- 隐私眼睛开关（隐藏金额为 `***`）

## 关于“排除统计但保留数据”

如果有一次性大额支出（例如购车）会干扰日常消费分析，可以在  
`data/rules/analysis_exclusions.csv` 增加规则。

效果是：

- 原始交易仍然保留在明细数据里
- 但不会计入日常消费分析口径

## 进阶：手动运行命令（可选）

如果你需要自定义参数，可以使用：

```bash
python3 scripts/parse_cmb_statements.py \
  --input data/input/raw/eml/cmb \
  --glob "*.eml" \
  --out data/work/processed \
  --merchant-map data/rules/merchant_map.csv \
  --category-rules data/rules/category_rules.csv \
  --analysis-exclusions data/rules/analysis_exclusions.csv
```
