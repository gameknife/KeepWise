# Contract Freeze & Baseline Regression Plan

> Updated: 2026-05-08.

## Goal

Keep the four core analytics APIs stable after the migration cleanup without retaining the legacy Python implementation.

## Covered APIs

1. `investment-return`
2. `investment-curve`
3. `wealth-overview`
4. `wealth-curve`

Current baseline run:

- `25/25` cases pass
- `2/2` cross-case checks pass

## Files

- Runner: `apps/keepwise-tauri/src-tauri/src/bin/kw_baseline_diff.rs`
- Baseline: `apps/keepwise-tauri/src-tauri/tests/baseline/core_analytics_diff_regression.baseline.json`
- Script: `apps/keepwise-tauri/scripts/validate_tauri_core_diff_regression.sh`

## Run

```bash
cd /Users/gameknife/github/BeyondYZYX/apps/keepwise-tauri
npm run test:diff:core
```

## Updating The Baseline

Baseline updates are allowed only when the analytics behavior change is intentional. The review should include:

- the code change that alters behavior
- the regenerated baseline JSON
- a short explanation of why the changed output is correct

Do not regenerate the baseline to hide unexplained drift.
