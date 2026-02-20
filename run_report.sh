#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_PATH="$ROOT_DIR/scripts/parse_cmb_statements.py"
DB_MIGRATE_SCRIPT="$ROOT_DIR/scripts/migrate_ledger_db.py"
DB_IMPORT_SCRIPT="$ROOT_DIR/scripts/import_classified_to_ledger.py"
INPUT_DIR="$ROOT_DIR/data/input/raw/eml/cmb"
WORK_DIR="$ROOT_DIR/data/work/processed"
RULES_DIR="$ROOT_DIR/data/rules"
REPORT_DIR="$ROOT_DIR/data/output/reports"
WORK_REPORT_DIR="$WORK_DIR/reports"
REPORT_PATH="$REPORT_DIR/consumption_report.html"
DB_PATH="$WORK_DIR/ledger/keepwise.db"
CLASSIFIED_CSV_PATH="$WORK_DIR/category/classified_transactions.csv"

if [[ ! -f "$SCRIPT_PATH" ]]; then
  echo "未找到解析脚本: $SCRIPT_PATH" >&2
  exit 1
fi
if [[ ! -f "$DB_MIGRATE_SCRIPT" ]]; then
  echo "未找到迁移脚本: $DB_MIGRATE_SCRIPT" >&2
  exit 1
fi
if [[ ! -f "$DB_IMPORT_SCRIPT" ]]; then
  echo "未找到导入脚本: $DB_IMPORT_SCRIPT" >&2
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
echo "初始化本地账本数据库..."
python3 "$DB_MIGRATE_SCRIPT" --db "$DB_PATH"
python3 "$DB_IMPORT_SCRIPT" --db "$DB_PATH" --classified-csv "$CLASSIFIED_CSV_PATH"

echo ""
echo "处理完成。"
echo "报告路径: $REPORT_PATH"
echo "账本数据库: $DB_PATH"
echo "可直接在浏览器打开该 HTML 文件查看结果。"
