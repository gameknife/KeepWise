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
CURRENT_CARGO_VERSION="$(sed -n '/^\[package\]/,/^\[/s/^version[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' "$CARGO_TOML" | head -1)"

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
node - <<'JS' "$COMMITS_TSV_PATH" "$GROUPED_COMMITS_MD"
const fs = require('fs');
const [tsvPath, outPath] = process.argv.slice(2);
const rows = fs.readFileSync(tsvPath, 'utf8')
  .split(/\r?\n/)
  .filter((line) => line.trim())
  .map((line) => {
    if (line.includes('\t')) {
      const [sha, ...rest] = line.split('\t');
      return [sha.trim(), rest.join('\t').trim()];
    }
    const [sha, ...rest] = line.split(' ');
    return [sha.trim(), rest.join(' ').trim()];
  });
const orderedBuckets = [
  '导入与规则',
  '分析与查询',
  '界面与交互',
  '桌面/Tauri 与构建发布',
  '测试与验证',
  '文档与规划',
  '其他',
];
const groups = new Map(orderedBuckets.map((name) => [name, []]));
function classify(msg) {
  const m = msg.toLowerCase();
  if (['eml', 'pdf', 'yzxy', 'import', 'merchant', 'rules', 'whitelist', 'category-rules', 'merchant-map'].some((k) => m.includes(k))) return '导入与规则';
  if (['analytics', 'investment', 'wealth', 'budget', 'fire', 'income', 'consumption', 'account catalog', 'query'].some((k) => m.includes(k))) return '分析与查询';
  if (['ui', 'frontend', 'workbench', 'layout', 'tab', 'chart', 'style', 'logo', 'icon'].some((k) => m.includes(k))) return '界面与交互';
  if (['tauri', 'desktop', 'build', 'release', 'workflow', 'ci', 'dmg', 'msi', 'appimage'].some((k) => m.includes(k))) return '桌面/Tauri 与构建发布';
  if (['test', 'regression', 'validate', 'check', 'diff'].some((k) => m.includes(k))) return '测试与验证';
  if (['docs', 'runbook', 'roadmap', 'plan'].some((k) => m.includes(k))) return '文档与规划';
  return '其他';
}
for (const [sha, msg] of rows) groups.get(classify(msg)).push([sha, msg]);
const lines = [];
if (rows.length) {
  for (const bucket of orderedBuckets) {
    const items = groups.get(bucket);
    if (!items.length) continue;
    lines.push(`### ${bucket}`);
    for (const [sha, msg] of items) lines.push(`- ${sha} ${msg}`);
    lines.push('');
  }
}
const content = lines.join('\n').trimEnd();
fs.writeFileSync(outPath, content ? `${content}\n` : '', 'utf8');
JS

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
node - <<'JS' "$META_PATH" "$TARGET_VERSION" "$CURRENT_PACKAGE_VERSION" "$CURRENT_CARGO_VERSION" "$WRITE_VERSION" "$FROM_REF" "$TO_REF" "$COMMIT_COUNT" "$PACKAGE_JSON" "$CARGO_TOML" "$CHANGELOG_PATH" "$GROUPED_COMMITS_MD"
const fs = require('fs');
const [
  path,
  targetVersion,
  packageVersion,
  cargoVersion,
  writeVersion,
  fromRef,
  toRef,
  commitCount,
  packageJson,
  cargoToml,
  changelogDraft,
  groupedCommitsDraft,
] = process.argv.slice(2);
const payload = {
  target_version: targetVersion,
  current_versions: {
    package_json: packageVersion,
    cargo_toml: cargoVersion,
  },
  write_version: writeVersion === '1',
  git: {
    from_ref: fromRef,
    to_ref_short: toRef,
    commit_count_non_merge: Number.parseInt(commitCount || '0', 10),
  },
  paths: {
    package_json: packageJson,
    cargo_toml: cargoToml,
    changelog_draft: changelogDraft,
    grouped_commits_draft: groupedCommitsDraft,
  },
};
fs.writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
JS

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
  node - <<'JS' "$CARGO_TOML" "$TARGET_VERSION"
const fs = require('fs');
const [cargoPath, version] = process.argv.slice(2);
const text = fs.readFileSync(cargoPath, 'utf8');
let replaced = false;
const updated = text.replace(/(^\[package\][\s\S]*?^version\s*=\s*")([^"]+)(")/m, (_m, left, _old, right) => {
  replaced = true;
  return `${left}${version}${right}`;
});
if (!replaced) {
  console.error('Failed to update [package] version in Cargo.toml');
  process.exit(1);
}
fs.writeFileSync(cargoPath, updated, 'utf8');
JS
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
