# Import & Fetching Logic Unification Audit — Session 2 (2026-11-19)

Read-only sweep of (a) every path that brings data INTO the application and (b) the runtime data-fetching architecture. All claims file-verified.

## 1. Import logic — inventory of all data-ingestion paths

| # | Path | Engine / files | Persistence | Notes |
|---|---|---|---|---|
| 1 | **Excel bulk import** (ETAT/BON/Devis/REF schemas) | `infrastructure/excel/import-engine/**` (29 files: parsers, schemas, validators, mappers, dedupe/upsert-matcher, er-matcher, reporters, storage adapters) + `import-config/configs/{etat-2026-2027,etat-2027-2026}.ts` | `RepositoryStorageAdapter` → repositories → `upsert_student_from_import` RPC family | idempotent upsert, per-run audit trail, JSON+Excel reports; UI = `features/crm/excel-import-modal.tsx` (973 lines — the only consumer) |
| 2 | **Batch registration** (manual family enrollment) | `features/crm/batch-registration/**` (compute-billing + 4 steps + wizard) | `batchRegister` → `register_family_batch` RPC (0128, BUG-006) | uses devis engine #3 (DUP-001) |
| 3 | **Re-enrollment** (year transition) | `features/crm/re-enrollment/**` | `reEnrollment` repo (0128-era) | separate flow from batch registration, similar shape |
| 4 | **Mock fixtures autofill** (Ctrl+O) | `shared/devtools/test-data/**` + `infrastructure/mock/fixtures` | in-memory mock store | production-mounted (ARCH-010) |
| 5 | **Backup restore** | `infrastructure/backup/**` | vault file → repositories | mock-only restore documented in S1 |
| 6 | **Offline sync replay** | `infrastructure/sync/**` (7 files) | queue → repositories | the sync layer's ingestion path |

**Verdict on import:** the engine itself is the codebase's best-factored subsystem (single engine, schema registry, storage-adapter port, idempotency, audit integration). The redundancy is NOT in the engine — it is in (a) the **billing computation** that runs at import/registration time (four engines, S1 DUP-001, unchanged) and (b) the **973-line single UI file** that stages all five steps (select/preview/commit/done + ER review) in one component.

**Import-specific recommendations:** (1) no new import engine work needed — the roadmap's C-1 devis consolidation (Phase 1) is the only cross-cutting fix; (2) decompose `excel-import-modal.tsx` into step components when next touched (no standalone task); (3) DEAD-013's unreachable abort modes (ATOMIC_IMPORT_ABORTED/STRICT_MODE_REJECTED) remain a Phase 0.8-adjacent decision (restore fail-closed or remove enum — roadmap 4.8).

## 2. Fetching logic — the runtime data architecture (verified)

### 2.1 The layers

```
features (UI)  ──useRepositories()──▶ RepositoryProvider (service locator, ARCH-005)
                                          │ selectDefaultRepositories() (repository-provider.tsx:171-192)
                                          │   useSupabase=false → mockRepositories (54 slots)
                                          │   useSupabase=true  → getSupabaseRepositories()
                                          │       = {...mock, 49 supabase overrides} + approvals
                                          │       5 slots stay mock live: clubs, psychology,
                                          │       orthophonie, aiConfig, performanceReviews (ARCH-006)
                                          ▼
repositories (54+ slots, repository-provider.tsx:100-167) ──▶ Supabase adapters / mock adapters
                                          ▼
UI reads: useObservable(() => repo.observeX(), deps) ?? default   (165 sites / 45+ files)
UI writes: await repo.mutate(...) → Result<T, AppError>
realtime: financial-realtime swaps repositories.debt via Object.defineProperty (S1 map §2)
```

### 2.2 Verified strengths (keep, document)

- Fail-closed live mode (no silent mock fallback, provider lines 174-179).
- Result-type error channel with the T-313 anti-fake-success guard documented inline (lines 203-212).
- One observable idiom (`useObservable` + `?? default` + subscribe/unsub in effect) applied app-wide.
- Realtime overlay isolated to the financial domain.

### 2.3 Verified gaps (this session's new findings)

1. **ARCH-019 — repository-layer bypasses (9 feature files import `infrastructure/supabase/supabase-client` directly):** `settings/configuration-tab.tsx`, `settings/backup-tab.tsx`, `settings/supabase-diagnostics/{diagnostics-runner,crud-test-tab,supabase-diagnostics-tab}`, `settings/danger-zone-card.tsx`, `settings/contextual-thresholds-config.tsx`, `crm/excel-import-modal.tsx` (mode check only), **`crm/parent-detail-drawer.tsx`** (a person drawer doing direct client work — the only non-settings offender; investigate and route through the parent repository).
   Settings-diagnostics surfaces are arguably legitimate tooling (they test the platform, not domain data), but they should consume an explicit `PlatformDiagnosticsPort` rather than raw client imports; the parent-detail-drawer case is a plain violation.
2. **DUP-029 — per-page subscription boilerplate:** 165 hand-written subscription ceremonies; 18-subscription pages (financials-page, academic-year-detail-drawer) are the maintenance ceiling. No view-model/selector layer exists between repositories and pages (`dashboard-page.tsx:322`'s no-op memo is the smoking gun).
3. **No query-cache invalidation story beyond realtime:** cache freshness relies on the repo subjects + the financial-realtime swap; non-financial entities refresh only via re-subscription or manual refetch. Acceptable for desktop scale — document as the intended architecture rather than migrate to react-query (see §4).
4. **TanStack Query is a phantom dependency for data-fetching**: only `@tanstack/react-table` (data-table.tsx) and one main.tsx import exist; the stack description overstates it. Either drop the query package or document observables as the data layer (prefer the latter — 165 sites vs 0).

### 2.4 Fetching unification plan

1. **F-U1 (S):** ADR: "the data layer is repositories + observables" (extends ARCH-005's ADR); name the idiom (subscribe-effect + `?? default` + Result writes) in AGENTS.md boundaries section.
2. **F-U2 (M):** extract per-feature view-model hooks for the heaviest pages (financials-page 18 subs, academic-year-detail-drawer 18, dashboard tabs per D-U1) — same pattern, one hook per tab/section, unit-testable.
3. **F-U3 (S):** route `parent-detail-drawer.tsx` off direct supabase-client usage; introduce `PlatformDiagnosticsPort` for the 6 settings diagnostics/config surfaces (ARCH-019).
4. **F-U4 (XS):** prune the unused @tanstack/react-query dependency if truly unimported in main.tsx beyond types (verify at execution time; keep react-table).

## 3. Migration impact

- F-U2 is internal to feature files; no repository or contract changes; per-page T-tasks under the existing governance.
- F-U3 touches 7 files + adds one port interface; parent-detail-drawer change requires reading its current client usage and expressing it as a repository method (behavior-preserving).
- No schema, migration, or EF changes anywhere in this plan.
