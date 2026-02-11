#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_PATH="$ROOT_DIR/scripts/parse_cmb_statements.py"
INPUT_DIR="$ROOT_DIR/data/input/raw/eml/cmb"
WORK_DIR="$ROOT_DIR/data/work/processed"
RULES_DIR="$ROOT_DIR/data/rules"
REPORT_DIR="$ROOT_DIR/data/output/reports"
WORK_REPORT_DIR="$WORK_DIR/reports"
REPORT_PATH="$REPORT_DIR/consumption_report.html"

if [[ ! -f "$SCRIPT_PATH" ]]; then
  echo "未找到解析脚本: $SCRIPT_PATH" >&2
  exit 1
fi

mkdir -p "$REPORT_DIR"

echo "开始执行账单处理..."
python3 "$SCRIPT_PATH" \
  --input "$INPUT_DIR" \
  --out "$WORK_DIR" \
  --merchant-map "$RULES_DIR/merchant_map.csv" \
  --category-rules "$RULES_DIR/category_rules.csv" \
  --analysis-exclusions "$RULES_DIR/analysis_exclusions.csv"

mv -f "$WORK_REPORT_DIR/consumption_report.html" "$REPORT_DIR/"
mv -f "$WORK_REPORT_DIR/consumption_report.css" "$REPORT_DIR/"
mv -f "$WORK_REPORT_DIR/consumption_analysis.json" "$REPORT_DIR/"

echo ""
echo "处理完成。"
echo "报告路径: $REPORT_PATH"
echo "可直接在浏览器打开该 HTML 文件查看结果。"
