# OPERATION-DUPLICATION — the same operation implemented N times

Source: ts-morph IPC + Supabase census (`tools/audit-ipc-supabase.ts`, executed), Fallow exact/near families, jscpd cross-app, plus direct code reading of the operation chains. Every claim cites its evidence file.

## 1. The operation registry (measured, not aspirational)

The app's canonical operation path is:

```
React UI (src/features) 
  → repository-provider (src/app/providers, DI switch mock ↔ supabase)
    → Supabase repositories (src/infrastructure/supabase/repositories/*)
      → supabase-js client (src/infrastructure/supabase/supabase-client.ts)
        → PostgREST tables / 60+ RPC functions (project gvuvibcsfjhwcjikgxql)
```

with a **parallel mock twin** of nearly every repository (`src/infrastructure/mock/**`, 21,885 LOC) and a **third copy of the financial engines** in the website (`lib/canonical/**`) and a fourth in Kotlin (android `domain/`). Electron IPC is deliberately thin (window/backend-profile only): 25 registered channels, 24 used, 0 broken, 1 dead (`backend-profile:get-sync`, `ipcMain.on` in `electron/main.cts` — **Confirmed**, no preload invoke references it).

## 2. Operation duplication across processes (the expensive class)

| Operation | Copy 1 | Copy 2 | Copy 3 | Evidence | Classification |
|---|---|---|---|---|---|
| Workflow condition evaluation | `src/domain/calc/workflow/condition-evaluator.ts` | `supabase/functions/workflow-execute/engine.ts` | — | Fallow exact family, 68 lines, 2 instances | **Confirmed** — a DSL interpreted in two runtimes; any operator added client-side silently diverges from the server's engine |
| Dashboard KPI aggregation | `src/infrastructure/supabase/repositories/supabase-dashboard-repository.ts` | `financial-tests/equivalence/desktop/analytics_bridge.ts` | migration `0002_stage_a_dashboard_aggregation.sql` (SQL-side) | Fallow exact 47 lines + DB functions | Confirmed — KPI math in TS and SQL must be kept numerically identical by hand |
| Financial engines (ledger balance, debt aging, overdue, billing breakdown, pricing profile) | `src/domain/calc/**` | website `lib/canonical/**` | android Kotlin `domain/` | jscpd cross-app: 30 file pairs / 4,128 lines; `kotlin_mirror_engine.ts` | Confirmed — **intentional but unshared**; parity enforced by the equivalence suite (ADR-006), not by code reuse |
| PDF receipts | `src/infrastructure/receipt-pdf/payment-receipt.ts` | website `lib/pdf/payment-receipt.ts` (+ `account-statement.ts`) | — | jscpd cross-app | Confirmed |
| Particle engine | `src/shared/particle-engine/**` | website `lib/particle-engine/**` | — | jscpd cross-app (12 files) | Confirmed — 100% fork |
| URL/credential validation | `electron/backend-profile-contract.cts:151` | `src/infrastructure/supabase/supabase-client.ts:85` | — | Fallow exact family #1 | Confirmed — https/URL trim logic in main + renderer |
| Auth-user relocation tooling | `src/tests/infrastructure/t-574-relocate-auth.test.ts` | `scripts/prepare-cutover-profile.mjs` etc. | — | ops scripts (archive class) | Likely |

## 3. Operation duplication inside the app (layer twins)

- **Supabase repo ↔ Mock repo**: every `Supabase*Repository` has a `mock/*` twin implementing the same port. This is **architectural** (offline/mock mode is a deliberate T-419 feature) — but today the twins live as 21,885 LOC of parallel code with duplicated scenario logic (jscpd families: `mock-composite` ↔ `backup-repository`, 46 lines; Fallow `near` mode flags the whole mock layer as the top near-dup cluster). The dedup lever is **generated fixtures + shared scenario harness**, not deleting the layer.
- **Port definitions duplicated**: `src/domain/repository/academic-repository.ts` ↔ `repository.ts` (Fallow exact, 48 lines) — two files declaring overlapping repository ports. Single authoritative ports file needed (AGENTS.md rule 1).
- **Feature-tab scaffolds**: `supabase-diagnostics/crud-test-tab.tsx` ↔ `supabase-diagnostics-tab.tsx` (55 lines exact), `therapy/orthophonie-tab.tsx` ↔ `psychology-tab.tsx` (48) — the "tab page" shape is re-implemented per feature instead of a shared layout primitive (a `shared/ui/entity-tab-layout` exists but these bypass it).
- **RPC vs app-layer logic**: 60+ RPCs exist and are used (`write_audit_log` ×11, `upsert_ledger_entry_from_import` ×6, promotion-cycle suite, re-enrollment suite, debt-aging suite). The critical invariant already holds — **write paths go through idempotent RPCs shared with Android** (migration 0027 + supabase-repositories.ts header). Read-side aggregation, however, is split between TS (dashboard repository) and SQL (0002 migration) — see row 2 of §2.

## 4. Supabase call-site census (from `raw/tsmorph-ipc-supabase.json`)

- 414 `.from("<table>")` call sites across 73 distinct tables; 57 distinct RPCs.
- Hot tables: `installments` ×30, `parents` ×24, `students` ×21, `timetable_entries` ×19, `notifications` ×16, `timetable_versions` ×16, `academic_years` ×15, `personnel` ×15, `payments` ×14.
- **308 unbounded `select()` chains** (no `.limit()`/`.range()`) — see PERFORMANCE.md §4 and DATABASE-AUDIT.md §8. Classification: Confirmed (ts-morph chain walk; includes intentional `select:*` full-table reads in import flows — each needs a pagination decision, not a blanket fix).

## 5. Single-owner recommendation matrix (feeds AGENTS.md)

| Concept | Current owners | Authoritative owner (proposed) |
|---|---|---|
| Workflow condition language | domain + edge function | `src/domain/calc/workflow/condition-evaluator.ts` — compiled into the EF via shared module |
| Result type | 5 files | `src/core/result.ts` |
| Repository ports | 2 files | `src/domain/repository/repository.ts` (delete `academic-repository.ts` port dupes) |
| DB row types | desktop + website forks | one `supabase gen types` artifact |
| Financial engines | desktop / website / android | shared package `@elimtiyaz/canonical` (TS) + generated Kotlin mirror from the equivalence corpus |
| Money/date utils | `domain/calc/shared`, `domain/calc/*/shared`, website `lib/canonical/calc/shared` | `domain/calc/shared` |
| Dashboard KPIs | TS repo + SQL migration | SQL (single source), TS reads it — or keep TS and drop the SQL twin; **pick one** |
