# T-419 — The Unified Testing Architecture (issue #22) — Phase 1 Baseline Evidence

**Registered:** 2026-09-27 (the 103rd session) — recorded BEFORE any change, per the issue's own §37 Phase 1 ("run existing suites exactly as they are and record") and AGENTS.md §13 (register problems BEFORE the fix).

**Scope of this document:** the pre-change baseline of ALL THREE test systems + the forensic inventory summary. This is the yardstick every phase of T-419 must reproduce (byte-identical failing sets) or improve (with the improvement attributed to a registered, verified change).

---

## 1. The forensic inventory (the issue §9 census)

### 1.1 `src/tests/` — the main Vitest suite (216 files)

| Subtree | Files | Responsibility |
|---|---|---|
| `_helpers/` | 2 | shared helpers: `radix-mouse.ts` (the §15.45d ONE Radix interaction dance), `finance-isolation.ts` |
| `ai/` | 6 | AI copilot / LLM adapter suites |
| `app/` | 1 | app-level shell |
| `domain/` | 43 | domain/calc engines (financial waterfall, ledger, discounts, GPA, attendance, timetable solver…) |
| `features/` | 40 | feature-level suites (dashboard, CRM, academics, workforce…) |
| `infrastructure/` | 80 | repositories (mock + Supabase shims), sync, backup, import engine |
| `integration/` | 15 | cross-layer integration (incl. the vault-compliance suite that imports the android mirror) |
| `performance/` | 1 | the T-417 Excel-import performance budget suite |
| `rbac/` | 6 | role-boundary matrix suites |
| `security/` | 15 | security/source-guard suites |
| `ui/` | 7 | UI harness suites (analytics, dashboards, AI review screens) |

### 1.2 `src/test/` — the second Vitest root (12 files)

| File | Layer |
|---|---|
| `setup.ts` | the shared Vitest setup (jest-dom) — referenced by `vitest.config.ts setupFiles` |
| `cross-platform/BoundaryConditions.test.ts` | Tier-4 boundary |
| `cross-platform/CanonicalInvariants.test.ts` | invariant validation (INV-1…INV-9) |
| `cross-platform/PropertyBasedEquivalence.test.ts` | property-based (in-process corpus) |
| `cross-platform/ScenarioRunner.test.ts` | the 319-scenario corpus in-process |
| `cross-platform/Tier2SeedLedgerTest.test.ts` | Tier-2 seed ledger |
| `cross-platform/Tier4Boundary.test.ts` | Tier-4 boundary |
| `cross-platform/Tier4ConflictResolution.test.ts` | Tier-4 conflict resolution |
| `cross-platform/Tier4Invariants.test.ts` | Tier-4 invariants |
| `cross-platform/Tier4OperationSequences.test.ts` | Tier-4 operation sequences |
| `cross-platform/Tier4PropertyBased.test.ts` | Tier-4 property-based |
| `cross-platform/Tier4SyncRoundTrip.test.ts` | Tier-4 sync round-trip |

**Cross-directory imports (the issue §11 flag):** 7 of the 11 Tier-4 files + `src/tests/integration/vault-compliance-architecture.test.tsx` import `../../../financial-tests/equivalence/android_mirror/kotlin_mirror_engine` — a path OUTSIDE both declared Vitest roots, reachable only because both old and new locations sit two levels under `src/`.

### 1.3 `financial-tests/equivalence/` — the ADR-006 canonical framework (406 files)

| Component | Files | Role |
|---|---|---|
| `scenarios/*.json` | 319 | the canonical scenario corpus (foundational 001–021+, T-105 corpus, T-345 fixtures, analytics/executive) |
| `regression/*.json` | 69 | historical regression evidence (dated artifacts — classified per issue §16) |
| `desktop/` | 2 | `desktop_runner.ts` + `analytics_bridge.ts` (the T-285 analytics parity bridge) |
| `android_mirror/` | 2 | `kotlin_mirror_engine.ts` (the line-by-line TS port) + `android_mirror_runner.ts` |
| `android/` | 1 | `AndroidEquivalenceRunner.kt` (the REAL Kotlin runner source; synced to the Android repo) |
| `backend/` | 1 | `backend_runner.ts` (live PostgreSQL, transaction-rollback isolated) |
| `comparison/` | 4 | `comparator.ts` (desktop↔android), `tier4_comparator.ts` (desktop↔mirror), `triple_comparator.ts` (3-way), `backend_rpc_equivalence.test.ts` (Tier-3 contract) |
| `generators/` | 1 | `scenario_generator.ts` (mulberry32 seeded, `--count=500 --seed=42`) |
| `integration/` | 1 | `sync_round_trip.ts` (live full-stack round-trip) |
| `schema/` | 1 | `scenario.schema.json` |
| `scripts/` | 4 | `run_all.sh`, `run_desktop.sh`, `run_android.sh`, `run_comparison.sh` |

**External contract:** the Android repo's `AndroidEquivalenceTest.kt` reads `scenarios/` in place at the fixed sibling path (ADR-006 decision 4) — the corpus location is FROZEN (see ADR-0029's constraint analysis).

---

## 2. The baseline gates (run 2026-09-27, fresh clone at `55ba661`, before any T-419 change)

### 2.1 TypeScript — `npm run typecheck`

```
tsc --noEmit → 0 errors
```

### 2.2 The full Vitest suite — `npm test` (= `vitest run`)

```
Test Files  11 failed | 212 passed | 1 skipped (224)
     Tests  25 failed | 4145 passed | 5 skipped (4175)
   Duration  381.25s
```

The 25 failures are the **documented pre-existing baseline** (101st/102nd sessions' records): the failing set is byte-identical to the T-418 closeout run. Failing families (11 files):

| File | Failing tests | Documented family |
|---|---|---|
| `src/tests/ui/dashboard-3zone.test.tsx` | 7 | pre-existing UI baseline |
| `src/tests/ui/analytics-visuals.test.tsx` | 2 | pre-existing UI baseline |
| `src/tests/ui/ai-review-screens.test.tsx` | 3 | pre-existing UI baseline |
| `src/tests/infrastructure/t-034-cache-freshness.test.ts` | 4 | pre-existing |
| `src/tests/infrastructure/t-390-financial-realtime.test.ts` | 1 (file-level) | pre-existing |
| `src/tests/features/dashboard/t-355-t-356-departments-bucket-parity.test.tsx` | 3 | pre-existing |
| `src/tests/integration/vault-compliance-architecture.test.tsx` | 2 | pre-existing |
| `src/tests/security/t-134-parent-name-rendering.test.ts` | 1 | pre-existing |
| `src/test/cross-platform/ScenarioRunner.test.ts` | 1 | pre-existing (INV-8 cleared-branch) |
| `src/test/cross-platform/Tier4Boundary.test.ts` | 1 | pre-existing |
| `src/test/cross-platform/Tier4OperationSequences.test.ts` | 1 | pre-existing |

(Full per-test list preserved in the session evidence; the 1 skipped file is a workbook-dependent `describeOrSkip` suite — the §15.58a-documented class, pinned by its own guards.)

### 2.3 The equivalence pipeline (Layer 2) — `scripts/run_desktop.sh`

```
Desktop runner: 809 passed, 0 failed, 10 errored (of 819 total)
```

- 819 scenarios = 319 committed corpus + 500 generated (seed 42, deterministic).
- The **10 errored** are the zero-payment boundary family (`017_zero_payment` + 9 `gen_boundary_*`): the engine's entry factory correctly rejects `amount ≤ 0` on BOTH engines — these are **error-equivalence scenarios by design** (the corpus's own description says "both engines must reject identically").

### 2.4 The comparator sanity run (desktop vs desktop-copy — the framework self-check)

```
Equivalence rate: 818/819 (99.88%)
Discrepancies: 1  →  017_zero_payment
Canonical expected verified: 317/318
```

**Audit finding (registered TEST-308):** the single "discrepancy" is a FALSE POSITIVE — both sides ERRORED identically ("Payment amount must be > 0 (got 0)"), but `comparator.ts` lacks the all-error-equivalence rule that `triple_comparator.ts` implements, and its delta table then renders `NaN` vs `NaN` (JS `NaN !== NaN`) as 10 "differences". No financial value differs; the engines agree. Corollary: each sanity/comparison run writes a false regression artifact (`regression/017_zero_payment__<ts>.json` — 1 such artifact was generated by this baseline run and removed as a byproduct).

**Canonical expected 317/318:** the one unverified expectation is on the same all-error scenario (the error result cannot satisfy the numeric `then` block) — same root cause as TEST-308.

### 2.5 Environment-gated layers (Layer 3) — honest prerequisite census

| Layer | Prerequisite | Status in this session |
|---|---|---|
| Real Kotlin runner | Android repo checked out as sibling + JDK 21 + gradle | NOT AVAILABLE (Android repo not cloned in this environment) |
| Backend runner (live PostgreSQL) | `--database`/`--host`/`--port` reachable + the canonical chain | NOT RUN (no local PG provisioned; the live Supabase SQL endpoint is not a runner target — the verify_t-XXX.sql convention owns live verification per ADR-006's recorded deviation) |
| Live E2E family | owner credentials + run-unique probes | available in principle (credentials supplied by the owner for this session); NOT part of the T-419 unification surface — the live convention is unchanged |

---

## 3. The preservation contract for every T-419 phase

1. **The failing-set rule:** after every phase, the full Vitest run must produce the SAME 25 failing tests in the SAME 11 files (plus/minus ONLY changes attributed to a registered, verified fix — e.g. TEST-308 changes comparator numbers, not Vitest numbers). Any NEW failure = the phase is broken, fix before commit.
2. **The coverage rule:** file counts are accounted for in the migration manifest (`docs/testing/unified-architecture.md`); no test file may disappear without a manifest row saying where its coverage went.
3. **The determinism rule:** the generator's `--count=500 --seed=42` must reproduce the identical 500 generated scenarios before/after any change (same seed → same scenarios — issue §23).
4. **The environment rule:** Layer-3 layers are reported with their reason, never silently skipped (issue §20/§31).
