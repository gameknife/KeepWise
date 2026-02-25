#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$ROOT_DIR/apps/keepwise-tauri"
ARTIFACT_DIR="${KEEPWISE_DESKTOP_CHECK_ARTIFACT_DIR:-$ROOT_DIR/.artifacts/tauri-desktop-check}"
mkdir -p "$ARTIFACT_DIR"

frontend_status="not_run"
rust_check_status="not_run"
rust_regression_status="not_run"
core_diff_status="not_run"
overall_status="running"

write_summary() {
  local summary_path="$ARTIFACT_DIR/regression_summary_local.txt"
  {
    echo "KeepWise Tauri desktop local release-check summary"
    echo "created_at_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "root_dir=$ROOT_DIR"
    echo "app_dir=$APP_DIR"
    echo "frontend_build_outcome=$frontend_status"
    echo "rust_check_outcome=$rust_check_status"
    echo "rust_regression_outcome=$rust_regression_status"
    echo "core_diff_outcome=$core_diff_status"
    echo "overall_status=$overall_status"
    if [[ -f "$ARTIFACT_DIR/core_analytics_diff_regression.json" ]]; then
      python3 - <<PY
import json, pathlib
path = pathlib.Path(r'''$ARTIFACT_DIR/core_analytics_diff_regression.json''')
payload = json.loads(path.read_text(encoding='utf-8'))
summary = payload.get("summary", {})
cases = summary.get("cases", {})
cross = summary.get("cross_case_checks", {})
print(f"core_diff_cases_total={cases.get('total', 'n/a')}")
print(f"core_diff_cases_status_counts={cases.get('status_counts', {})}")
print(f"core_diff_cross_total={cross.get('total', 'n/a')}")
print(f"core_diff_cross_status_counts={cross.get('status_counts', {})}")
PY
    else
      echo "core_diff_report_missing=1"
    fi
  } > "$summary_path"

  {
    echo "workflow=desktop-release-check-local"
    echo "created_at_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "git_sha=$(git -C "$ROOT_DIR" rev-parse HEAD 2>/dev/null || echo unknown)"
    echo "git_branch=$(git -C "$ROOT_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
    echo "overall_status=$overall_status"
  } > "$ARTIFACT_DIR/manifest_local.txt"
}

on_exit() {
  local code=$?
  if [[ $code -eq 0 ]]; then
    overall_status="pass"
  else
    overall_status="fail"
  fi
  write_summary
  trap - EXIT
  exit $code
}
trap on_exit EXIT

echo "[1/4] Rust regression subset"
rust_regression_status="running"
bash "$ROOT_DIR/scripts/validate_tauri_desktop_rust_regression.sh"
rust_regression_status="pass"

echo "[2/4] Core analytics diff regression"
core_diff_status="running"
KEEPWISE_DIFF_REPORT_DIR="$ARTIFACT_DIR" bash "$ROOT_DIR/scripts/validate_tauri_core_diff_regression.sh"
core_diff_status="pass"

echo "[3/4] Frontend build"
frontend_status="running"
(
  cd "$APP_DIR"
  npm run build
)
frontend_status="pass"

echo "[4/4] Rust check"
rust_check_status="running"
cargo check --manifest-path "$APP_DIR/src-tauri/Cargo.toml"
rust_check_status="pass"

echo
echo "Desktop release check passed."
echo "Local artifact summary dir:"
echo "  $ARTIFACT_DIR"
