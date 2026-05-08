# KeepWise Frontend Architecture

> Updated: 2026-05-08. Current frontend is a React 19 + TypeScript 5.8 Vite app inside `apps/keepwise-tauri`.

## Current Shape

The UI is no longer a single `src/App.tsx` implementation. The public entry is still intentionally thin:

```
src/main.tsx                  # React entry + RootErrorBoundary
src/App.tsx                   # default export forwarding to ./app/App
src/app/App.tsx               # product shell, state orchestration, feature assembly
src/app/helpers.ts            # shared app helpers
src/app/requestBuilders.ts    # request object builders
src/app/summaries.ts          # app-level summary helpers
src/app/amountFormatting.ts   # amount display and privacy masking helpers
src/features/<domain>/        # sections, previews, modals, layout
src/hooks/                    # useAsyncQuery, useDebouncedAutoRun
src/lib/desktopApi.ts         # Tauri invoke wrappers and request/payload types
src/types/app.ts              # cross-feature UI types
src/utils/value.ts            # loose payload read helpers
```

`src/app/App.tsx` remains the largest file and still owns most feature state. That is the main remaining frontend refactor target.

## Product Tabs

| Tab key | Name | Main modules |
|---|---|---|
| `manual-entry` | 更新收益 | manual investment/asset modals, records previews, account catalog |
| `wealth-overview` | 财富总览 | `features/analytics/WealthOverviewSection`, `features/wealth/*` |
| `return-analysis` | 投资收益 | `features/analytics/ReturnAnalysisSection`, investment curve preview |
| `budget-fire` | FIRE进度 | `features/budget/BudgetFirePreviews` |
| `income-analysis` | 收入分析 | `features/income/SalaryIncomeOverviewPreview` |
| `consumption-analysis` | 消费分析 | `features/consumption/ConsumptionOverviewPreview` |
| `import-center` | 导入中心 | `features/import/ImportCenterSections`, import summary previews |
| `admin` | 高级管理 | DB panel, probes, rules, query workbench, sync management |

## Feature Inventory

| Domain | Files |
|---|---|
| `admin` | DB panel, runtime previews, health/probe panels, account catalog, admin sections |
| `analytics` | investment return section, wealth overview section |
| `budget` | budget items, yearly overview, monthly review, FIRE progress previews |
| `consumption` | yearly consumption report preview |
| `import` | YZXY / CMB EML / CMB PDF import center and summary cards |
| `income` | salary and housing fund income overview |
| `layout` | mobile home grid, sidebar, content panel router |
| `modals` | app settings, investment edit, quick manual investment, quick manual asset valuation |
| `records` | investment curve, investment rows, asset valuations, accounts, account catalog previews |
| `rules` | rules CRUD panel for merchant map, category rules, whitelist, analysis exclusions |
| `shared` | primitive controls, chart primitives, table helpers |
| `wealth` | wealth overview, curve, stacked trend, sankey previews |

## Data Flow

Frontend calls backend exclusively through `src/lib/desktopApi.ts`. Components do not call `invoke` directly.

The common flow is:

1. UI state in `src/app/App.tsx` builds a strict request object.
2. `desktopApi.ts` invokes a Tauri command.
3. Rust returns JSON payloads or a rejected promise with a Chinese error string.
4. App state stores `{ busy, error, result }` and feature panels render from props.

`useAsyncQuery` is available for repeated query flows, but many older domains still keep explicit `useState` triplets in `App.tsx`.

## Styling

Styling is still centralized in `src/App.css`. Class names are BEM-like and shared across feature components. CSS module extraction has not happened yet.

Current rule: keep new CSS conservative and local to existing class patterns unless the stylesheet is intentionally split in a dedicated refactor.

## Remaining Refactor Items

- Type the feature section props and remove the remaining `// @ts-nocheck` files.
- Move feature state out of `src/app/App.tsx` into domain hooks.
- Replace loose `unknown` response payloads in `desktopApi.ts` with explicit payload types.
- Split `src/App.css` once component boundaries are stable.
