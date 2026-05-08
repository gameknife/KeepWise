# Tauri IPC API Protocol — KeepWise Desktop

> Updated: 2026-05-08. Source of truth: `apps/keepwise-tauri/src-tauri/src/lib.rs` `generate_handler![]`.

## Overview

The desktop frontend calls Rust through Tauri v2 `invoke`. All wrappers live in `apps/keepwise-tauri/src/lib/desktopApi.ts`; React components should not call `invoke` directly.

Current registered command count: **69**.

## Command Table

| # | Command | Domain |
|---:|---|---|
| 1 | `health_ping` | system |
| 2 | `app_metadata` | system |
| 3 | `app_paths` | system |
| 4 | `ledger_db_status` | database |
| 5 | `ledger_db_migrate` | database |
| 6 | `ledger_db_import_from_path` | database |
| 7 | `ledger_db_admin_stats` | database |
| 8 | `runtime_db_health_check` | admin |
| 9 | `investment_return_query` | investment analytics |
| 10 | `investment_returns_query` | investment analytics |
| 11 | `investment_curve_query` | investment analytics |
| 12 | `investment_curve_benchmarks_query` | investment analytics |
| 13 | `wealth_overview_query` | wealth analytics |
| 14 | `wealth_curve_query` | wealth analytics |
| 15 | `query_monthly_budget_items` | budget / FIRE |
| 16 | `upsert_monthly_budget_item` | budget / FIRE |
| 17 | `delete_monthly_budget_item` | budget / FIRE |
| 18 | `query_budget_overview` | budget / FIRE |
| 19 | `query_budget_monthly_review` | budget / FIRE |
| 20 | `query_salary_income_overview` | income |
| 21 | `query_consumption_report` | consumption |
| 22 | `query_fire_progress` | FIRE |
| 23 | `meta_accounts_query` | read query |
| 24 | `query_transactions` | read query |
| 25 | `query_investments` | read query |
| 26 | `query_asset_valuations` | read query |
| 27 | `query_import_jobs` | read query |
| 28 | `query_account_catalog` | account catalog |
| 29 | `upsert_account_catalog_entry` | account catalog |
| 30 | `delete_account_catalog_entry` | account catalog |
| 31 | `upsert_manual_investment` | record mutation |
| 32 | `update_investment_record` | record mutation |
| 33 | `delete_investment_record` | record mutation |
| 34 | `upsert_manual_asset_valuation` | record mutation |
| 35 | `update_asset_valuation` | record mutation |
| 36 | `delete_asset_valuation` | record mutation |
| 37 | `update_transaction_analysis_exclusion` | transaction mutation |
| 38 | `confirm_transaction_review` | transaction mutation |
| 39 | `ledger_db_admin_reset_all` | database admin |
| 40 | `ledger_db_admin_reset_transactions` | database admin |
| 41 | `yzxy_preview_file` | import |
| 42 | `yzxy_import_file` | import |
| 43 | `cmb_eml_preview` | import |
| 44 | `cmb_eml_import` | import |
| 45 | `cmb_bank_pdf_preview` | import |
| 46 | `cmb_bank_pdf_import` | import |
| 47 | `query_merchant_map_rules` | rules |
| 48 | `upsert_merchant_map_rule` | rules |
| 49 | `delete_merchant_map_rule` | rules |
| 50 | `query_category_rules` | rules |
| 51 | `upsert_category_rule` | rules |
| 52 | `delete_category_rule` | rules |
| 53 | `query_bank_transfer_whitelist_rules` | rules |
| 54 | `upsert_bank_transfer_whitelist_rule` | rules |
| 55 | `delete_bank_transfer_whitelist_rule` | rules |
| 56 | `query_analysis_exclusion_rules` | rules |
| 57 | `upsert_analysis_exclusion_rule` | rules |
| 58 | `delete_analysis_exclusion_rule` | rules |
| 59 | `query_merchant_rule_suggestions` | rules |
| 60 | `sync_setup_create` | sync |
| 61 | `sync_share_code_generate` | sync |
| 62 | `sync_share_code_parse` | sync |
| 63 | `sync_setup_link` | sync |
| 64 | `sync_test_connection` | sync |
| 65 | `sync_status` | sync |
| 66 | `sync_poll_remote_update` | sync |
| 67 | `sync_reconcile` | sync |
| 68 | `sync_resolve_conflict` | sync |
| 69 | `sync_set_auto_policy` | sync |

## Payload Conventions

- Rust command entrypoints currently return `Result<Value, String>` or typed serializable structs that Tauri serializes as JSON.
- Request structs are `serde::Deserialize` types with optional string fields where the UI allows empty filters.
- Frontend wrappers expose typed request objects and, where still pending, loose payload aliases.
- Tauri argument naming uses both snake_case and camelCase in selected wrappers for compatibility with Tauri serialization.
- User-visible error messages are Chinese strings.

## Database Lifecycle

The app-local SQLite database is resolved through `app_local_data_dir()/ledger/keepwise.db`.

`ledger_db_import_repo_runtime` was removed in the 2026 cleanup. Database import is now only path-based through `ledger_db_import_from_path`.

Migrations are embedded with `include_str!` from `db/migrations`.

## Rules Runtime

Rules are edited in the app-local rules directory. First-run defaults are seeded from CSV files embedded under:

```
apps/keepwise-tauri/src-tauri/seeds/rules/
```

The repository root `data/rules` directory no longer exists.

## Regression Protocol

`npm run test:diff:core` now runs Rust baseline regression through `kw_baseline_diff`.

The frozen baseline lives at:

```
apps/keepwise-tauri/src-tauri/tests/baseline/core_analytics_diff_regression.baseline.json
```

The removed Python oracle and `tools/migration` are no longer required in CI.
