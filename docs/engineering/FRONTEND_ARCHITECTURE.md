# KeepWise Frontend Architecture

> Updated: 2026-07-16. React 19 + TypeScript 5.8 + Vite 7 frontend in `apps/keepwise-tauri`.

## Current Structure

```text
src/main.tsx                       # React entry + RootErrorBoundary
src/App.tsx                        # thin default-export forwarding entry
src/app/App.tsx                    # controller installation, invalidation coordination and feature assembly
src/app/useAppShellController.ts   # viewport, navigation, settings persistence and mobile back lifecycle
src/app/useAppAutoRefresh.ts       # visibility/filter-driven query orchestration
src/app/{helpers,requestBuilders,summaries,amountFormatting}.ts
src/api/desktop/invoke.ts          # sole @tauri-apps/api/core invoke entry
src/api/desktop/<domain>.ts        # precise request/response contracts by domain
src/features/<domain>/             # pages, previews, modals and domain controllers
src/features/layout/useSidebarMetrics.ts # quick metrics independent of mounted pages
src/hooks/                         # shared async/debounce hooks
src/styles/index.css               # ordered CSS composition root
src/styles/*.css                   # tokens, shell, controls, analytics and responsive layers
src/types/app.ts                   # cross-feature UI types
src/utils/value.ts                 # adapters for intentionally dynamic payload subtrees
```

The deleted `src/lib/desktopApi.ts` compatibility barrel must not be restored. Feature code imports from `src/api/desktop` or a specific domain client. `invoke` is allowed only in `src/api/desktop/invoke.ts`; `npm run test:boundaries` enforces this and checks the 78-command protocol inventory.

## State and Feature Boundaries

- Import, sync, budget/FIRE/income, consumption, investment, wealth, accounts, records, manual entry and admin runtime/validation use domain controllers.
- Investment curve benchmark hydration retains request-sequence protection and deferred hydration.
- `WorkspaceContentPanels`, investment and wealth pages receive domain controllers plus small shell configuration, not UI primitives or loose prop bags.
- Public feature props contain no `Record<string, any>` and the frontend has no `LoosePayload` references.
- Settings/privacy, viewport, navigation and mobile back handling live in the shell controller because multiple shell surfaces consume them.
- `App.tsx` keeps only two direct state values (import invalidation epoch and debug JSON visibility); business forms, CRUD and selectors remain inside their domains.

## API Contracts

`src/api/desktop/index.ts` is the public domain barrel. Responses used directly by pages are named TypeScript payloads. A small number of inherently aggregate payloads—analysis snapshot, rules and import summaries—retain `Record<string, unknown>` only at the API boundary and are narrowed through adapters.

Rust command names, snake_case JSON fields and rejected-Promise Chinese error strings remain compatible. Rust uses named DTOs where stable and permits localized `serde_json::Value` for dynamic analytics/export trees.

## Styling and Bundles

CSS is imported in explicit cascade order from `src/styles/index.css`. The original selector/declaration order was preserved during the mechanical split. Responsive and platform overrides remain last.

Vite creates separate vendor chunks and lazy-loads low-frequency import, export and admin pages. On the 2026-07-16 final release build the entry chunk is 400.96 kB (gzip 114.91 kB), below Vite's 500 kB warning threshold.

## Verification

```bash
npm run test:frontend
npm run test:boundaries
npm run build
npm run test:rust
npm run test:diff:core
npm run desktop:release:check
```

Frontend tests cover request builders, formatting/privacy, settings/helpers, Markdown export, `useAsyncQuery`, and investment controller success/error behavior. Forced-mobile browser smoke verifies the home grid, page transition/back header and absence of horizontal overflow; Tauri data calls require the native host.
