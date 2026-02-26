#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
APP_DIR="$ROOT_DIR/apps/keepwise-tauri"
PACKAGE_JSON="$APP_DIR/package.json"
CARGO_TOML="$APP_DIR/src-tauri/Cargo.toml"

usage() {
  cat <<'EOF'
Usage:
  prepare_keepwise_desktop_release.sh <version> [--write-version] [--from-ref <git-ref>]

Examples:
  # 仅生成发布草稿（不改版本号）
  bash scripts/prepare_keepwise_desktop_release.sh 0.2.0

  # 生成发布草稿并同步写入 package.json / Cargo.toml
  bash scripts/prepare_keepwise_desktop_release.sh 0.2.0 --write-version

  # 指定变更起点 ref（默认优先最近 tag，否则首个 commit）
  bash scripts/prepare_keepwise_desktop_release.sh 0.2.0 --from-ref 7bbff4c
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ $# -lt 1 ]]; then
  usage
  exit 1
fi

TARGET_VERSION="$1"
shift

WRITE_VERSION=0
FROM_REF=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --write-version)
      WRITE_VERSION=1
      shift
      ;;
    --from-ref)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --from-ref" >&2
        exit 1
      fi
      FROM_REF="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if ! [[ "$TARGET_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$ ]]; then
  echo "Invalid version: $TARGET_VERSION (expected semver like 0.2.0 or 0.2.0-rc.1)" >&2
  exit 1
fi

CURRENT_PACKAGE_VERSION="$(node -p "require('$PACKAGE_JSON').version")"
CURRENT_CARGO_VERSION="$(python3 - <<PY
import pathlib,re
text = pathlib.Path(r'''$CARGO_TOML''').read_text(encoding='utf-8')
m = re.search(r'(?ms)^\\[package\\].*?^version\\s*=\\s*\"([^\"]+)\"', text)
print(m.group(1) if m else '')
PY
)"

if [[ -z "$CURRENT_CARGO_VERSION" ]]; then
  echo "Failed to read version from $CARGO_TOML" >&2
  exit 1
fi

if [[ -z "$FROM_REF" ]]; then
  FROM_REF="$(git -C "$ROOT_DIR" tag --list 'v*' --sort=-creatordate | head -1 || true)"
fi
if [[ -z "$FROM_REF" ]]; then
  FROM_REF="$(git -C "$ROOT_DIR" rev-list --max-parents=0 HEAD | tail -1)"
fi

if ! git -C "$ROOT_DIR" rev-parse --verify "$FROM_REF^{commit}" >/dev/null 2>&1; then
  echo "Invalid --from-ref / baseline ref: $FROM_REF" >&2
  exit 1
fi

TO_REF="$(git -C "$ROOT_DIR" rev-parse --short HEAD)"
BUILD_STAMP="$(date +%Y%m%d-%H%M%S)"
RELEASE_DIR="$ROOT_DIR/.artifacts/releases/keepwise-desktop-v${TARGET_VERSION}-${BUILD_STAMP}"
mkdir -p "$RELEASE_DIR"

COMMITS_RANGE="${FROM_REF}..HEAD"
COMMITS_TSV="$(git -C "$ROOT_DIR" log --pretty=format:'%h%x09%s' --no-merges "$COMMITS_RANGE" || true)"
COMMITS_FULL="$(git -C "$ROOT_DIR" log --pretty=format:'- %h %s' --no-merges "$COMMITS_RANGE" || true)"
COMMIT_COUNT="$(git -C "$ROOT_DIR" rev-list --count "$COMMITS_RANGE" 2>/dev/null || echo 0)"

GROUPED_COMMITS_MD="$RELEASE_DIR/GROUPED_COMMITS_DRAFT.md"
COMMITS_TSV_PATH="$RELEASE_DIR/commits_for_grouping.tsv"
printf "%s\n" "$COMMITS_TSV" > "$COMMITS_TSV_PATH"
python3 - <<PY
import pathlib

tsv_path = pathlib.Path(r'''$COMMITS_TSV_PATH''')
out_path = pathlib.Path(r'''$GROUPED_COMMITS_MD''')
rows = []
for line in tsv_path.read_text(encoding='utf-8').splitlines():
    if not line.strip():
        continue
    if "\t" in line:
        sha, msg = line.split("\t", 1)
    else:
        parts = line.split(" ", 1)
        sha = parts[0]
        msg = parts[1] if len(parts) > 1 else ""
    rows.append((sha.strip(), msg.strip()))

ordered_buckets = [
    "导入与规则",
    "分析与查询",
    "界面与交互",
    "桌面/Tauri 与构建发布",
    "测试与验证",
    "文档与规划",
    "其他",
]
groups = {name: [] for name in ordered_buckets}

def classify(msg: str) -> str:
    m = msg.lower()
    if any(k in m for k in ["eml", "pdf", "yzxy", "import", "merchant", "rules", "whitelist", "category-rules", "merchant-map"]):
        return "导入与规则"
    if any(k in m for k in ["analytics", "investment", "wealth", "budget", "fire", "income", "consumption", "account catalog", "query"]):
        return "分析与查询"
    if any(k in m for k in ["ui", "frontend", "workbench", "layout", "tab", "chart", "style", "logo", "icon"]):
        return "界面与交互"
    if any(k in m for k in ["tauri", "desktop", "build", "release", "workflow", "ci", "dmg", "msi", "appimage"]):
        return "桌面/Tauri 与构建发布"
    if any(k in m for k in ["test", "regression", "validate", "check", "diff"]):
        return "测试与验证"
    if any(k in m for k in ["docs", "runbook", "roadmap", "plan"]):
        return "文档与规划"
    return "其他"

for sha, msg in rows:
    groups[classify(msg)].append((sha, msg))

lines = []
if rows:
    for bucket in ordered_buckets:
        items = groups[bucket]
        if not items:
            continue
        lines.append(f"### {bucket}")
        for sha, msg in items:
            lines.append(f"- {sha} {msg}")
        lines.append("")

content = "\n".join(lines).rstrip()
out_path.write_text((content + "\n") if content else "", encoding="utf-8")
PY

CHANGELOG_PATH="$RELEASE_DIR/CHANGELOG_DRAFT.md"
cat > "$CHANGELOG_PATH" <<EOF
# KeepWise Desktop v${TARGET_VERSION} 发布说明（草稿）

生成时间：$(date -u +%Y-%m-%dT%H:%M:%SZ) UTC

## 发布范围

- 版本目标：\`v${TARGET_VERSION}\`
- 基线版本（前端）：\`${CURRENT_PACKAGE_VERSION}\`
- 基线版本（Rust crate）：\`${CURRENT_CARGO_VERSION}\`
- 变更起点：\`${FROM_REF}\`
- 变更终点：\`${TO_REF}\`
- 提交数（非 merge）：\`${COMMIT_COUNT}\`

## 建议重点验证

1. 导入中心（YZXY / 招行 EML / 招行 PDF）
2. 收益分析 / 财富总览（核心曲线与摘要）
3. 消费分析（总览筛选与图表交互）
4. 高级管理（健康检查 / 重置 / 验证流水线）
5. 桌面构建与图标/窗口配置

## 变更摘要（待人工整理）

- （在此补充本版本对用户可见的变化）

## 已知风险 / 回归关注点（待人工确认）

- （在此补充风险点）

## 自动分组提交（辅助整理）

（按 commit message 关键词自动归类，仅用于帮助审核整理）

## 提交列表（自动生成）

EOF

cat "$GROUPED_COMMITS_MD" >> "$CHANGELOG_PATH"
echo >> "$CHANGELOG_PATH"

if [[ -n "$COMMITS_FULL" ]]; then
  printf "%s\n" "$COMMITS_FULL" >> "$CHANGELOG_PATH"
else
  echo "- （无可用提交记录，可能是首次发布）" >> "$CHANGELOG_PATH"
fi

META_PATH="$RELEASE_DIR/release_meta.json"
python3 - <<PY
import json, pathlib
path = pathlib.Path(r'''$META_PATH''')
payload = {
  "target_version": "$TARGET_VERSION",
  "current_versions": {
    "package_json": "$CURRENT_PACKAGE_VERSION",
    "cargo_toml": "$CURRENT_CARGO_VERSION",
  },
  "write_version": bool($WRITE_VERSION),
  "git": {
    "from_ref": "$FROM_REF",
    "to_ref_short": "$TO_REF",
    "commit_count_non_merge": int("$COMMIT_COUNT" or 0),
  },
  "paths": {
    "package_json": "$PACKAGE_JSON",
    "cargo_toml": "$CARGO_TOML",
    "changelog_draft": str(pathlib.Path(r'''$CHANGELOG_PATH''')),
    "grouped_commits_draft": str(pathlib.Path(r'''$GROUPED_COMMITS_MD''')),
  },
}
path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
PY

if [[ "$WRITE_VERSION" -eq 1 ]]; then
  echo "[write-version] update package.json -> $TARGET_VERSION"
  node - <<'JS' "$PACKAGE_JSON" "$TARGET_VERSION"
const fs = require('fs');
const [pkgPath, version] = process.argv.slice(2);
const data = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
data.version = version;
fs.writeFileSync(pkgPath, JSON.stringify(data, null, 2) + '\n');
JS

  echo "[write-version] update Cargo.toml -> $TARGET_VERSION"
  python3 - <<PY
import pathlib, re
path = pathlib.Path(r'''$CARGO_TOML''')
text = path.read_text(encoding='utf-8')
updated, count = re.subn(
    r'(?ms)^(\\[package\\].*?^version\\s*=\\s*\")([^\"]+)(\")',
    lambda m: m.group(1) + "$TARGET_VERSION" + m.group(3),
    text,
    count=1,
)
if count != 1:
    raise SystemExit("Failed to update [package] version in Cargo.toml")
path.write_text(updated, encoding='utf-8')
PY
fi

SUMMARY_PATH="$RELEASE_DIR/prepare_summary.txt"
{
  echo "KeepWise Desktop release prep"
  echo "target_version=$TARGET_VERSION"
  echo "from_ref=$FROM_REF"
  echo "to_ref=$TO_REF"
  echo "commit_count_non_merge=$COMMIT_COUNT"
  echo "write_version=$WRITE_VERSION"
  echo "changelog_draft=$CHANGELOG_PATH"
  echo "grouped_commits_draft=$GROUPED_COMMITS_MD"
  echo "release_meta=$META_PATH"
} > "$SUMMARY_PATH"

echo
echo "Release preparation complete."
echo "  Release dir: $RELEASE_DIR"
echo "  Changelog draft: $CHANGELOG_PATH"
echo "  Meta: $META_PATH"
if [[ "$WRITE_VERSION" -eq 1 ]]; then
  echo "  Version files updated: $PACKAGE_JSON, $CARGO_TOML"
else
  echo "  Version files unchanged (preview mode). Use --write-version to apply."
fi
