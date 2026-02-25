#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TAURI_CRATE_DIR="$ROOT_DIR/apps/keepwise-tauri/src-tauri"

echo "[1/7] Rust regression: budget/fire/income/consumption seeded fixture"
cargo test --manifest-path "$TAURI_CRATE_DIR/Cargo.toml" seeded_fixture -- --nocapture

echo "[2/7] Rust regression: investment-returns sort/filter/limit"
cargo test --manifest-path "$TAURI_CRATE_DIR/Cargo.toml" investment_returns_query_sorts_by_return_rate_and_supports_filter_limit -- --nocapture

echo "[3/7] Rust regression: YZXY CSV preview/import idempotency"
cargo test --manifest-path "$TAURI_CRATE_DIR/Cargo.toml" yzxy_csv_preview_and_import_are_idempotent -- --nocapture

echo "[4/7] Rust regression: CMB EML known-sample preview summary (skips if sample absent)"
cargo test --manifest-path "$TAURI_CRATE_DIR/Cargo.toml" preview_problematic_2026_sample_summary_matches_expected_counts -- --nocapture

echo "[5/7] Rust regression: CMB PDF transaction id stability"
cargo test --manifest-path "$TAURI_CRATE_DIR/Cargo.toml" pdf_transaction_id_is_stable_for_same_occurrence -- --nocapture

echo "[6/7] Rust regression: CMB PDF transaction upsert idempotency"
cargo test --manifest-path "$TAURI_CRATE_DIR/Cargo.toml" pdf_upsert_transaction_is_idempotent_for_same_tx_id -- --nocapture

echo "[7/7] Rust regression: CMB PDF classification preview summary"
cargo test --manifest-path "$TAURI_CRATE_DIR/Cargo.toml" pdf_classification_preview_summary_counts_are_consistent -- --nocapture

echo
echo "Rust regression subset passed."
