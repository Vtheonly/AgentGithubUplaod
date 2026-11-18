# Dead-Code Census (Session 1 — consolidated)

Consolidated from reports 01, 02, 03, 04, 06 + the independent import-graph pass (`Dependency Analysis/import-graph-analysis.md`). Every entry was verified by repo-wide reference search (imports + string references + registry/dynamic patterns considered). Tests were excluded from "consumers" unless stated.

## A. Whole-file dead / test-only (application tree)

| File (elimtiyaz-desktop/src/…) | Size | Consumers | Verdict |
|---|---|---|---|
| `features/dashboard/dashboard-tab-layout-editor.tsx` | 267 lines | none (orphaned storage prefix) | DEAD — remove |
| `features/personnel/management/department-management.tsx` | 340 lines | none (only generated i18n keys mention it) | DEAD — remove or wire (owner decision) |
| `features/academics/elimtiyaz-desktop/src/shared/ui/markdown-view.tsx` | 0 bytes | none (corrupted nested path) | EMPTY ARTIFACT — remove |
| `infrastructure/ai/narrative-generator.ts` | ~120 lines | none in prod or tests (modal uses `defaultLLMAdapter`) | DEAD — remove |
| `domain/calc/shared/money-dzd.ts` | ~40 lines | its test only | TEST-ONLY — move to tests or remove |
| `domain/calc/reconcile/reconciliation.ts` | ~80 lines | 2 test files (`reconcileFinancials`); repos use `reconcileLedger` | TEST-ONLY — move to tests or promote deliberately |
| `domain/calc/academics/algerian-curriculum.ts` | ~200 lines | t-408 test only (SQL mirror of 0113) | TEST-ONLY — document as fixture |
| `domain/calc/timetable/fixture.ts` | ~100 lines | 3 test files | TEST-ONLY — move to tests |
| `domain/identity/index.ts` (barrel) | small | none | DEAD — remove |
| `infrastructure/mock/fixtures/index.ts` (barrel) | small | none (direct imports used) | DEAD — remove |
| `shared/devtools/test-data/index.ts` (barrel) | small | none | DEAD — remove |
| repo-root `src/features/academics/hooks/use-class-placement-studio.ts` | 0 bytes | none | STRAY — remove |

## B. Symbol-level dead exports (per-layer censuses)

- **core (~25):** see `Initial Reports Analysis/01-Core-report-verification.md` §4 — full table with per-symbol consumers (result combinators, RBAC helpers, id formatters, AI option types, theme/statistics internals).
- **shared (~16):** see `06-Shared-report-verification.md` §4 — UI census shows **no dead files**, dead symbols only.
- **domain:** money-dzd, balance aliases, `revenueByCategory` (superseded), `missing_proof` variant, `AcademicCycleLegacy`, 4 unused import clusters, fictional discount labels.
- **features:** `STEP_ICONS` ×2, `ExportLaunchButton`, `ExportPackageIcon`, plus 12 in-file dead-code bullets (report 03 §2).
- **infrastructure:** `dispatchPaymentOverdue`, `TENANT_FALLBACK`, `getBillingRepos`, `export { delay, store }` from mock backup repo, unreachable import-abort modes, `coerceMonthlyArray` branch, unwired `ImportConfigStore.useStore`.

## C. Dead configuration / data surface

- i18n generated dictionaries `src/i18n/gen/{fr,ar,en}.ts` — ~1,028 keys × 3 locales, zero call sites (DEAD-005).
- Base-dict dead keys: `app.name`, `app.tagline`, `common.previous`.
- RBAC feature-flag machinery (provider param, `feature_flag_off` state, dead switch case).
- `PERMANENTLY_DISABLED` registry content (stale claims — the export is alive, its data is wrong).
- `vite-env.d.ts` phantom `Window.elImtiyaz` type shape (declares members the bridge never exposes).

## D. Not-dead (explicitly protected — refuted removal candidates)

| Candidate | Why it must stay |
|---|---|
| `infrastructure/mock/subject-behavior.ts` | Production-shared reactive primitive; 26+ Supabase repositories import it |
| `infrastructure/mock/pricing-seed.ts` | Runtime price fallback for Supabase pricing/student repos + domain non-tuition-charges |
| `mock/fixtures/*` | Reachable in production via ungated Ctrl+O autofill (ARCH-010) |
| `mock-composite` + `mock-store` | Spread base of `getSupabaseRepositories`; backup restore + sync staging touch the store |
| `domain/calc/ledger/non-tuition-charges.ts` | Canonical manual-charge builder used by Supabase `appendManualCharge` (fix its import, don't delete it) |
| `particle-engine/color-interpolator.ts` | Dead in this repo, but the engine was verbatim-ported to the website repo — cross-repo parity consideration |
| `supabase/functions/workflow-execute/engine.ts` | Consumed by desktop vitest (cross-tree test seam) and by the live EF |

## E. Quantification

- Whole-file dead/test-only inside the application: **12 files** (~1,150 lines + 2 empty).
- Symbol-level dead exports: **~60+** across core/shared/domain/features/infrastructure.
- Dead i18n keys: **~3,087** (3,084 generated + 3 base).
- Repo-level: 985 MB `deliverables/`, stub root lockfile, 9+ broken one-off scripts, ~120 redundant script family members.
