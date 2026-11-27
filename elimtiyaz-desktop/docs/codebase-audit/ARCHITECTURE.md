# ARCHITECTURE — layering, coupling, cycles, boundaries

Sources: **dependency-cruiser 18.9.0** (layer matrix, `raw/dependency-cruiser.json`), **madge 8.0.0** (`raw/madge-circular.txt`), **Fallow 3.49.0 architecture + health** (`raw/fallow-architecture.json`, `raw/fallow-health.json`), plus targeted reading of the boundary files. Executed 2026-11-27.

## 1. The declared layering (tsconfig `paths` + folders)

```
app (shell, providers, routing)        2,199 LOC
 ├─ features (11 areas)               86,354 LOC
 │   └─ domain (model + calc)          34,376 LOC
 ├─ infrastructure (supabase, mock,   69,318 LOC
 │   excel, sync, backup, ai, …)
 ├─ core (ai, format, rbac, theme)     7,118 LOC
 └─ shared (ui, layout, nav, hooks)    9,666 LOC
electron (main/preload, .cts)          1,296 LOC
```

Enforced direction (dependency-cruiser config committed as `.dependency-cruiser.cjs`): `app → features → {domain, infrastructure} → {shared, core}`; `tests → anything`; `electron` is a separate process graph; renderer must reach Electron only through the preload bridge.

## 2. Boundary violations (404 total, dependency-cruiser, executed)

| Rule | Count | What it means | Classification |
|---|---:|---|---|
| `features-no-app` | **337** | 148 feature files import app-layer **providers** (`repository-provider` ×132, `toast-provider` ×102, `auth-provider` ×94, `ai-copilot` ×5, `sync-provider` ×3) | Confirmed — the single dominant coupling. The provider implementations live in `app/` but are the de-facto public context API for everything. Mechanical fix: move provider implementations to `shared/providers`, keep `app/` for composition only. |
| `shared-no-upward` | 32 | `shared/layout/topbar.tsx` (9 imports), `shared/search-index.ts` (4), `shared/layout/audit-activity-toaster.tsx` (4) import app providers; `shared/navigation/person-navigation-context.tsx` imports **features/crm** drawers | Confirmed — `person-navigation-context` is the root of the shared↔features **cycles** (§3) |
| `core-no-upward` | 26 | `core/ai/tools/*` import `domain/model/*` and `domain/calc/*` (AI tools operate on domain models) | Confirmed — `core/ai/tools` is functionally an application service, not a core utility; it belongs beside features' AI tooling or the tools should receive plain data |
| `renderer-no-electron-internals` | 5 | `src/infrastructure/supabase/supabase-client.ts:39` imports `electron/backend-profile-contract.cts` (+4 test files) | **Already resolved** by design — the import is the shared contract type, loaded via the `ctsSourcePlugin` ESM transform (BUG-054 ADR); the dependency-cruiser rule needs a type-only exemption, not a code change |
| `infra-no-features` | 3 | `mock/repositories/dashboard-layout-repository.ts` → features/dashboard storage; `sync/sync-indicator.tsx` → features + app | Confirmed — infrastructure reaching up into feature/app UI |
| `domain-no-upward` | 1 | `domain/calc/ledger/non-tuition-charges.ts` → `infrastructure/mock/pricing-seed.ts` | Confirmed — domain logic seeded from a mock fixture (inverts ownership: the seed should consume the domain function) |

## 3. Circular dependencies

- **Fallow architecture: 9 clusters** (minimal cycle basis, severity error)
- **Madge: 34 raw cycles** (supersets of the same clusters)

| Cluster | Files | Root cause | Fix |
|---|---|---|---|
| `shared/navigation/person-navigation-context.tsx` ↔ `features/crm/{parent,student}-detail-drawer.tsx` (+ `shared/ui/{student,parent}-actions-menu.tsx`) | 5 cycles | shared context imports the feature drawers it should navigate to | invert: navigation context exposes a `navigate(person)` port; features register handlers (observer/registry pattern) — breaks 5 cycles at once |
| `domain/model ↔ domain/calc` (payment, pricing, ledger, student, academic) | 14 madge cycles | model files import calc functions (e.g., `pricing.ts` → `discount-rules.ts`) while calc imports the model | split "model" (pure types) from "model logic" (factories calling calc); types-only file for the cycle edges |
| `app/providers/repository-provider` ↔ `infrastructure/{mock,supabase}` | 7 cycles | the DI provider is imported BY the factories it assembles (T-470 comment documents one such cycle already fixed by moving to infrastructure) | finish the T-470 move: the composite selection lives in infrastructure; provider only injects |
| `infrastructure/supabase/*` internal (delta-cache, shared-repos, backup, pricing) | 5 cycles | barrel re-exports + cache back-references | repository files must not import the aggregation barrel (`supabase-repositories.ts`); pass deps explicitly |
| `shared/ui/unified-modal.tsx` ↔ `unified-modal/confirm-modal.tsx` | 1 | facade + subcomponent import each other | subcomponent receives a close callback instead of importing the facade |

## 4. Coupling hotspots (Fallow health hotspots, executed)

`src/infrastructure/supabase/repositories/supabase-shared-repositories.ts` — **fan-in 81, 80 commits, 7,098 lines added over history, complexity density 0.21, maintainability score 44.7/100, trend "cooling"**. It is the single most load-bearing file in the app: six repository classes (`SupabaseParentRepository`, `SupabaseStudentRepository`, `SupabasePaymentRepository`, `SupabaseLedgerRepository`, `SupabaseInstallmentRepository`, `SupabaseDebtRepository`) in one 5,563-LOC module. This is a **God module** (DESIGN-PATTERN-AUDIT.md A-1) and the prime refactor target (REFACTORING-PLAN step R-2).

## 5. The nested foreign app (structural anomaly, Confirmed)

`src/features/academics/elimtiyaz-desktop/src/shared/ui/markdown-view.tsx` — a directory tree of a *different* app (`elimtiyaz-desktop` inside `features/academics/`) with its own `src/` + `shared/ui` convention. Only `markdown-view.tsx` remains (unused per Knip+Fallow). Leftover of a copied module; delete the subtree (already counted in UNUSED-CODE §1.1).

## 6. The DI switch (by design)

`src/app/providers/repository-provider.tsx` (222 LOC) selects `mockRepositories` vs `getSupabaseRepositories()` behind `Repositories` ports — a clean ports-and-adapters switch (mock default, `VITE_USE_SUPABASE=true` for live). The architecture is sound; the problem is scale of the twins (21,885 LOC mock) and the cycles in §3, not the pattern.

## 7. What the tool verdicts mean together

- The layering **exists and is mostly respected** — 404 violations in 1,035 files is a 39%-per-file raw rate, but 337 of them are one mechanical provider-location issue.
- The cycles are **concentrated in two design decisions** (navigation context; repository aggregation) — 2 changes break ~12 of the 34 raw cycles.
- The domain is the healthiest layer (1 upward violation), which is why the equivalence suite can pin financial parity at all.
