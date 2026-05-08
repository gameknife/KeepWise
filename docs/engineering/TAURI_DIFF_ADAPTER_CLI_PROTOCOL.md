# Core Analytics Baseline Diff Protocol

> Updated: 2026-05-08. The old Python-vs-Rust adapter protocol has been retired.

## Current Runner

`npm run test:diff:core` builds and runs:

```
apps/keepwise-tauri/src-tauri/src/bin/kw_baseline_diff.rs
```

The runner:

1. Reads the frozen Rust baseline JSON.
2. Creates deterministic temporary SQLite datasets.
3. Calls the current Rust analytics query functions directly.
4. Compares current JSON envelopes against the baseline.
5. Writes `.artifacts/tauri-desktop-check/core_analytics_diff_regression.json`.

## Baseline

```
apps/keepwise-tauri/src-tauri/tests/baseline/core_analytics_diff_regression.baseline.json
```

The baseline is a frozen behavior snapshot, not an external oracle. If a future analytics fix intentionally changes output, regenerate and review this file in the same change.

## Retired Pieces

- `tools/migration/run_diff_regression.py`
- `tools/migration/python_adapter_cli.py`
- `tools/migration/mock_rust_adapter.py`
- `tools/migration/cases/analytics_core.yaml`

These files were removed to eliminate the Python oracle dependency.
