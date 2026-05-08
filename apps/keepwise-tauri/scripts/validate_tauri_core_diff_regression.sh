#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TAURI_CRATE_DIR="$ROOT_DIR/apps/keepwise-tauri/src-tauri"
BASELINE_DIFF_BIN="$TAURI_CRATE_DIR/target/debug/kw_baseline_diff"
REPORT_DIR="${KEEPWISE_DIFF_REPORT_DIR:-$ROOT_DIR/.artifacts/tauri-desktop-check}"
REPORT_PATH="${KEEPWISE_DIFF_REPORT_PATH:-$REPORT_DIR/core_analytics_diff_regression.json}"

mkdir -p "$(dirname "$REPORT_PATH")"

echo "[1/2] Build Rust baseline diff runner"
cargo build --manifest-path "$TAURI_CRATE_DIR/Cargo.toml" --bin kw_baseline_diff

echo "[2/2] Run core analytics baseline regression"
"$BASELINE_DIFF_BIN" --json-out "$REPORT_PATH"

echo
echo "Core baseline regression passed."
echo "Report: $REPORT_PATH"
