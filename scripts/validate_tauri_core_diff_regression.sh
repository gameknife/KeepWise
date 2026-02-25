#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TAURI_CRATE_DIR="$ROOT_DIR/apps/keepwise-tauri/src-tauri"
ADAPTER_BIN="$TAURI_CRATE_DIR/target/debug/kw_migration_adapter"
REPORT_DIR="${KEEPWISE_DIFF_REPORT_DIR:-$ROOT_DIR/.artifacts/tauri-desktop-check}"
REPORT_PATH="${KEEPWISE_DIFF_REPORT_PATH:-$REPORT_DIR/core_analytics_diff_regression.json}"

mkdir -p "$(dirname "$REPORT_PATH")"

echo "[1/2] Build Rust migration adapter"
cargo build --manifest-path "$TAURI_CRATE_DIR/Cargo.toml" --bin kw_migration_adapter

echo "[2/2] Run core analytics diff regression (Python baseline vs Rust adapter)"
python3 "$ROOT_DIR/tools/migration/run_diff_regression.py" \
  --rust-adapter-cmd "$ADAPTER_BIN" \
  --json-out "$REPORT_PATH"

echo
echo "Core diff regression passed."
echo "Report: $REPORT_PATH"
