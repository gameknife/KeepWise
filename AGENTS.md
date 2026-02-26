# BeyondYZYX / KeepWise - Agent Guide

Tauri Desktop app (React 19 + TypeScript 5.8 + Vite 7 frontend, Rust 2021 + SQLite backend).
Personal finance tool: import bank/investment data, analyze wealth, track budgets.

## Repository Layout

```
apps/keepwise-tauri/          # Main (only) application
  src/App.tsx                 # Entire React UI (single-file, ~10K lines)
  src/lib/desktopApi.ts       # Typed Tauri invoke wrappers
  src-tauri/src/              # Rust backend (flat module-per-domain)
    lib.rs                    # Module declarations + pub use re-exports
    commands.rs               # Health ping, app metadata, paths
    ledger_db.rs              # SQLite migration & DB path resolution
    investment_analytics.rs   # Investment return/curve queries
    wealth_analytics.rs       # Wealth overview/curve queries
    budget_fire_analytics.rs  # Budget, income, consumption, FIRE
    rules_management.rs       # CSV-based rule CRUD
    cmb_eml_import.rs         # CMB credit card EML import
    cmb_bank_pdf_import.rs    # CMB bank statement PDF import
    yzxy_import.rs            # YZXY CSV/XLSX import
    bin/kw_migration_adapter.rs  # CLI adapter for diff regression
  scripts/                    # Tauri build/validation shell scripts
apps/keepwise-legacy/         # Legacy Python/BS app (deprecated)
  scripts/                    # Python analytics & web app scripts
  examples/                   # Demo examples
db/migrations/                # SQLite migration SQL files (0001-0006)
tools/migration/              # Python-vs-Rust diff regression framework
docs/engineering/             # Architecture & runbook docs
```

## Build & Dev Commands

All npm commands run from `apps/keepwise-tauri/`:

```bash
npm run tauri dev              # Start dev (Vite + Rust hot-reload)
npm run build                  # Frontend only: tsc && vite build
npm run tauri:build            # Full production bundle
npm run tauri:build:debug      # Debug production bundle
npm run tauri:build:mac        # macOS app + dmg only
```

## Test Commands

```bash
# All Rust unit tests (14 tests across 5 files)
npm run test:rust
# Equivalent: cargo test --manifest-path src-tauri/Cargo.toml

# Run a single Rust test by name
cargo test --manifest-path src-tauri/Cargo.toml <test_name>
# Example:
cargo test --manifest-path src-tauri/Cargo.toml investment_returns_query_sorts_by_return_rate

# Run tests in a single Rust module
cargo test --manifest-path src-tauri/Cargo.toml --lib cmb_eml_import

# Curated Rust regression subset (7 named tests via shell script)
npm run test:rust:regression

# Core analytics diff regression (Python baseline vs Rust, 25 cases)
npm run test:diff:core

# Full release gate (regression + diff + frontend build + cargo check)
npm run desktop:release:check
```

## CI/CD

GitHub Actions at `.github/workflows/`:
- `tauri-desktop-check.yml` - Auto on PR/push: frontend build, cargo check, rust regression, diff regression
- `tauri-desktop-release-candidate.yml` - Manual: version check + RC bundle
- `tauri-desktop-release-signed-macos-template.yml` - Manual: signing + notarization

## TypeScript Code Style

**No ESLint/Prettier/Biome configured.** Linting relies on `tsc --strict` only.

### tsconfig strictness
- `strict: true`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`
- Target: ES2020, module: ESNext, JSX: react-jsx

### Imports
1. React core: `import { useState, useEffect } from "react"`
2. Third-party: `react-datepicker`, `d3-sankey`, `@tauri-apps/*`
3. CSS/assets: `"./App.css"`, SVG imports
4. Local modules: `"./lib/desktopApi"` with inline `type` keyword for type imports

### Naming
- Components: **PascalCase** function declarations - `function LineAreaChart(...)`
- Functions/variables: **camelCase** - `formatCentsShort()`, `amountPrivacyMaskedGlobal`
- Types: **PascalCase** with `type` keyword (never `interface`) - `type LoadStatus`, `type AppSettings`
- API types: PascalCase with suffixes - `*Request`, `*Payload`, `*QueryRequest`
- Constants: **UPPER_SNAKE_CASE** - `PRODUCT_TABS`, `APP_SETTINGS_STORAGE_KEY`

### Types
- Always use `type`, never `interface`
- Inline object types for component props (no separate `Props` type)
- API response types are often aliased to `unknown` (loose response, strict request)
- Union literals for state: `type LoadStatus = "idle" | "loading" | "ready" | "error"`

### Exports
- Named exports everywhere (`export type`, `export async function`)
- Only `App.tsx` uses `export default`

### Error Handling
```typescript
catch (err) {
  const msg = err instanceof Error ? err.message : typeof err === "string" ? err : "Unknown error";
}
```
- `RootErrorBoundary` class component in `main.tsx` for unhandled errors
- `desktopApi.ts` functions propagate Rust errors as rejected Promises (no try/catch in API layer)

### UI Strings & Comments
- All user-facing strings are in **Chinese**
- Code comments are minimal and mostly in Chinese
- No JSDoc/TSDoc

### Architecture Notes
- Entire UI lives in `App.tsx` (monolithic single-file, ~10K lines) - no component splitting
- State management: raw `useState` only (no Redux/Zustand)
- CSS: single `App.css` with BEM-like classes (`preview-stat-label`, `line-area-chart-wrap`)
- Conditional rendering: ternary `{cond ? <X /> : null}` (not `&&` short-circuit)

## Rust Code Style

### Module Organization
- Flat structure: one file per domain, all declared as `mod` in `lib.rs`
- Public API: `#[tauri::command] pub fn foo(app, req) -> Result<Value, String>`
- Testable internals: `*_at_db_path` variants that accept a DB path directly
- Re-exports in `lib.rs` via `pub use` for external consumption

### Naming
- Structs: **PascalCase** - `InvestmentReturnQueryRequest`, `ModifiedDietzCalc`
- Functions: **snake_case** - `resolve_window`, `build_single_account_investment_return_payload`
- Constants: **UPPER_SNAKE_CASE** - `PORTFOLIO_ACCOUNT_ID`, `SUPPORTED_PRESETS`
- Tauri commands: snake_case matching JS invoke name

### Error Handling
- Universal return type: `Result<Value, String>` (no custom error types, no `thiserror`)
- Error conversion: `.map_err(|e| format!("描述: {e}"))`
- Error messages are in **Chinese**: `"打开数据库失败"`, `"account_id 必填"`
- Early returns with `?` operator; `let Some(x) = y else { return Err(...) };`

### Response Construction
- `serde_json::json!` macro for all responses (no typed response structs)
- Request types: `#[derive(Debug, Deserialize)]` with `Option<String>` fields
- `#[serde(rename = "from")]` for Rust reserved-word field names

### Imports (Rust)
1. External crates: `chrono`, `rusqlite`, `serde`, `serde_json`, `csv`, `std::*`
2. Internal: `use crate::ledger_db::resolve_ledger_db_path`
3. No blank-line separation between groups

### Test Patterns
- Inline `#[cfg(test)] mod tests` in each source file
- Each test module duplicates helpers: `create_temp_test_db()`, `apply_all_migrations_for_test()`, `repo_root()`, `approx_eq()`
- Tests create temp SQLite DBs with `uuid::Uuid` filenames
- Idempotency testing: import data twice, verify no duplicates
- ID stability: deterministic transaction IDs across repeated parses
- Conditional skip for real-data tests: `if !sample_dir.exists() { return; }`
- No `[dev-dependencies]` in Cargo.toml - tests use production deps

## Key Engineering Facts

- Core 4 analytics APIs have Python-vs-Rust differential regression (baseline passing)
- CMB EML import: fixed HTML line parsing duplication + ID instability on re-import
- CMB PDF import: fixed Chinese short-merchant false "personal transfer" classification
- Rules runtime directory: app-local rules dir (seeded from repo `data/rules` on first run)
- Version must be synced across: `package.json`, `Cargo.toml`, `tauri.conf.json`

## Documentation

- Migration master plan: `docs/engineering/TAURI_STACK_MIGRATION_MASTER_PLAN.md`
- Build runbook: `docs/engineering/TAURI_DESKTOP_BUILD_RUNBOOK.md`
- Release checklist: `docs/engineering/TAURI_DESKTOP_RELEASE_EXECUTION_CHECKLIST.md`
- Data dictionary: `docs/foundation/DATA_DICTIONARY_V1.md`
- Product flow: `docs/foundation/PRODUCT_FLOW.md`
