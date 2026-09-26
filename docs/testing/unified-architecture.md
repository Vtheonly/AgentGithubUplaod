# The Unified Testing Architecture — the map + the migration manifest (T-419 / ADR-029, issue #22)

> This is the ONE architecture document for the desktop test system. It replaces the scattered "where do tests live / how do I run them / what covers what" knowledge that previously had to be reverse-engineed from three trees' histories. The authoritative ENTRY POINT is `npm test` (the unified runner). The registries (`docs/recovery/`) remain the authoritative task/problem state; this document owns the ARCHITECTURE and the ACCOUNTING (the issue #22 §38 manifest — every testing artifact's disposition).

## 1. The architecture (what the ONE system is)

```
npm test  ──►  scripts/run-unified-tests.mjs  (the ONE orchestrator)
   │
   ├─ Layer 0 — typecheck            tsc --noEmit (§15.25: a green vitest is NOT a typecheck)
   │
   ├─ Layer 1 — the Vitest suite     the ONE root: src/tests/** (224 files / 4 175 tests)
   │     ├─ domain/        43 files   the calc engines (waterfall, ledger, discounts, GPA, …)
   │     ├─ features/      40 files   feature-level suites
   │     ├─ infrastructure/80 files   repositories (mock + Supabase shims), sync, backup, import
   │     ├─ integration/   15 files   cross-layer integration
   │     ├─ cross-platform/11 files   Tier-2/Tier-4 + the corpus in-process (ScenarioRunner)
   │     ├─ security/ + rbac/ 21 files
   │     ├─ ai/ app/ ui/ performance/ 15 files
   │     └─ _helpers/        4 files  the SHARED SUPPORT layer (setup, radix-mouse,
   │                                    finance-isolation — grows per TEST-309's census)
   │
   ├─ Layer 2 — the equivalence TS pipeline (financial-tests/equivalence/ — the ADR-006
   │             canonical framework; corpus location pinned by the Android cross-repo
   │             contract, execution unified under npm test)
   │     ├─ 2.1 generators/scenario_generator.ts   mulberry32, seed 42 → 500 deterministic
   │     ├─ 2.2 desktop/desktop_runner.ts          the canonical TS engine  [GATING]
   │     ├─ 2.3 android_mirror/…runner.ts          the Kotlin-port engine  [GATING; skips reported]
   │     ├─ 2.4 comparison/tier4_comparator.ts     desktop vs mirror       [REPORTED while PARITY-005 open]
   │     └─ 2.5 comparison/comparator.ts (sanity)  desktop vs temp-copy: the canonical
   │                                                 `then`-expectations gate  [GATING]
   │
   └─ Layer 3 — the environment-gated census (reported with reasons, never silent — §20)
         ├─ 3.1 the REAL Kotlin runner   Android repo as sibling + JDK/gradle
         ├─ 3.2 the backend runner       live PostgreSQL + the canonical chain
         └─ 3.3 the live-E2E family      the owner-credential verify_t-XXX convention
```

**Why the corpus stays at `financial-tests/equivalence/`:** the Android repo's `AndroidEquivalenceTest.kt` reads `scenarios/` IN PLACE at the fixed sibling path (ADR-006 decision 4; `docs/testing/cross-platform.md` §2.1). A physical move would break the real-Kotlin runner on the standard three-repo layout — a coverage REDUCTION the issue forbids (§32). The unification is at the ORCHESTRATION layer (one entry point, one report) and the SUPPORT layer (one shared-helpers root) — see ADR-029 for the full constraint analysis.

**What was physically moved (Phase 2, 2026-09-27):** `src/test/` (12 files — the second Vitest root, a pure naming accident) → `src/tests/cross-platform/` + `src/tests/_helpers/setup.ts`. Depth-preserving (every relative import kept resolving); the vitest failing set stayed byte-identical to the documented baseline. `src/test/` no longer exists.

## 2. The migration manifest (issue #22 §38 — every artifact accounted for)

### 2.1 `src/tests/` — the main Vitest suite (216 files, unchanged location: it IS the surviving root)

| Original | New Location | Action | Status | Correctness Review |
|---|---|---|---|---|
| `src/tests/domain/**` (43) | same | preserved | verified (baseline-matched every phase) | reviewed — the CALC-001-era suites carry the post-fix expectations; the 3 pre-existing cross-platform failures are documented baseline |
| `src/tests/features/**` (40) | same | preserved | verified | reviewed |
| `src/tests/infrastructure/**` (80) | same | preserved | verified | reviewed — 24 files carry local FakeClient twins (TEST-309 census §4) |
| `src/tests/integration/**` (15) | same | preserved | verified | reviewed — vault-compliance imports the android mirror (cross-tree import; sanctioned: the mirror IS the Tier-4 engine source) |
| `src/tests/security/**` (15) + `rbac/**` (6) | same | preserved | verified | reviewed |
| `src/tests/ai/**` (6), `app/**` (1), `ui/**` (7), `performance/**` (1) | same | preserved | verified | reviewed |
| `src/tests/_helpers/radix-mouse.ts` | same | preserved (the §15.45d ONE implementation) | verified | reviewed |
| `src/tests/_helpers/finance-isolation.ts` | same | preserved | verified | reviewed |

### 2.2 `src/test/` → absorbed (Phase 2, commit cf507a9)

| Original | New Location | Action | Status | Correctness Review |
|---|---|---|---|---|
| `src/test/cross-platform/*.test.ts` (11) | `src/tests/cross-platform/` | **moved** (git mv, 0 content changes) | verified — the failing set byte-identical post-move | reviewed — the 3 documented failures preserved (ScenarioRunner INV-8, Tier4Boundary, Tier4OperationSequences — the pre-existing baseline) |
| `src/test/setup.ts` | `src/tests/_helpers/setup.ts` | **moved** (extends the existing shared-support dir) | verified — the suite runs with the same setup | reviewed |
| `src/test/` (the directory) | — | **removed** (empty after the moves) | verified | n/a |

### 2.3 `financial-tests/equivalence/` — the ADR-006 canonical framework (406 files; corpus location contractual)

| Original | New Location | Action | Status | Correctness Review |
|---|---|---|---|---|
| `scenarios/*.json` (319) | same (contractual) | preserved | verified — 318/318 canonical expectations met by the desktop engine | **AUDITED (Phase 3)**: `017_zero_payment`'s `then` was STALE (no-op-success expectations contradicting the entry-factory validation on every platform) — CORRECTED to the error-expectation form with traceability (entries.ts require(amount>0) + SQL 0034); the schema gained the optional `then.error` key |
| `generated/**` (500, gitignored) | same | preserved (regenerated deterministically, seed 42) | verified — same seed → same scenarios (§23) | reviewed |
| `desktop/desktop_runner.ts` + `analytics_bridge.ts` | same | preserved | verified (809/0/10) | reviewed |
| `android_mirror/kotlin_mirror_engine.ts` | same | preserved | verified (784/0/0+35 skipped via the runner) | **AUDITED (Phase 3)**: the ENGINE is PARITY-005-STALE (the CALC-001-removed discount rules + no zero-payment validation) — repair is the registered follow-up, NOT silently absorbed |
| `android_mirror/android_mirror_runner.ts` | same | **refactored (Phase 3)**: not-implemented ops now REPORT as `{skipped, reason}` (the backend_runner convention) instead of ERROR | verified — 35 skips carry reasons | reviewed |
| `android/AndroidEquivalenceRunner.kt` | same | preserved (the REAL Kotlin runner source) | environment-gated (needs the Android repo + JDK) | reviewed — implements the app-layer ops the TS mirror runner lacks |
| `backend/backend_runner.ts` | same | preserved | environment-gated (live PG) | reviewed — the skipped-reason convention is now shared by the mirror runner |
| `comparison/comparator.ts` | same | **refactored (Phase 3)**: the error-expectation contract + the NaN guard + `--desktop-dir/--android-dir` CLI (Phase 4) | verified — sanity 819/819, canonical 318/318, negative test (tampered error message → flagged) | **AUDITED**: the missing all-error rule was TEST-308 — FIXED |
| `comparison/tier4_comparator.ts` | same | **refactored (Phase 3)**: undefined-safe report rows (the crash), skip-aware + error-aware comparison, skipped counts | verified — completes and writes its report for the first time in recorded history | **AUDITED**: never run before T-419; its first completed run is the PARITY-005 evidence |
| `comparison/triple_comparator.ts` | same | preserved (the 3-way comparator — distinct scope per ADR-029 d6) | environment-gated (needs android + backend results) | reviewed — the all-error rule's original source |
| `comparison/backend_rpc_equivalence.test.ts` | same | preserved (the Tier-3 contract suite — runs in the Vitest Layer) | verified (in the 4 175) | reviewed |
| `generators/scenario_generator.ts` | same | preserved | verified (deterministic) | reviewed |
| `integration/sync_round_trip.ts` | same | preserved | environment-gated (live PG) | reviewed |
| `schema/scenario.schema.json` | same | **extended (Phase 3)**: the optional `error` key on Expectation | verified | reviewed |
| `scripts/run_all.sh, run_desktop.sh, run_android.sh, run_comparison.sh` | same | preserved (still functional for manual flows; the unified runner orchestrates the same steps) | verified | reviewed |
| `regression/*.json` (69) | same | **classified (issue §16), preserved** | verified — no test INPUT reads them (only the comparator writes) | **CLASSIFIED**: historical evidence — 40 unique scenarios × two dated snapshots (2026-08-19: 25, 2026-08-27: 44), all status DISCOVERED (the pre-alignment discrepancy era). Deletion is NOT warranted: they are the forensic record of past cross-platform divergences; the gitignored `regression/` writes of future runs remain the convention for NEW evidence |

### 2.4 The execution layer

| Original | New | Action | Status |
|---|---|---|---|
| `npm test` = `vitest run` | `npm test` = `node scripts/run-unified-tests.mjs` | **rewired (Phase 4)** | verified — all layers report; baseline-deviation detection live |
| — | `npm run test:vitest` | added (the Layer-1 fast loop) | verified |
| — | `scripts/test-baseline.json` | added (the documented baseline manifest) | verified — BASELINE-MATCHED on the full run |
| — | `test-reports/` (gitignored) | added (the unified report outputs) | verified |

**Accounting total: 216 + 12 + 406 + the execution layer = every artifact has a row. Nothing was deleted except the empty `src/test/` directory; nothing was rewritten except the three comparator/runner refactors above, each with its own verified commit.**

## 3. The layer responsibilities (what runs where, and what it proves)

| Question | Answered by |
|---|---|
| Does the TS code typecheck? | Layer 0 (tsc) — the §15.25 rule: vitest transpiles WITHOUT typechecking |
| Do the domain engines satisfy their unit contracts? | Layer 1 (`src/tests/domain`, `features`, `infrastructure`, …) |
| Do the repository contracts hold (mock + Supabase shapes)? | Layer 1 (infrastructure suites, the t-0XX families) |
| Does the DESKTOP engine satisfy the canonical corpus expectations? | Layer 2.5 (the sanity comparator's canonical gate — 318/318) |
| Do desktop and the Kotlin-port engine agree? | Layer 2.4 (tier-4; currently PARITY-005-red — the KNOWN, registered state) |
| Do desktop and the REAL Kotlin engine agree? | Layer 3.1 (the Android gradle run — reads the corpus in place) |
| Does the BACKEND (SQL/RPCs) agree? | Layer 3.2 (backend_runner against live PG) + the verify_t-XXX convention for live probes |
| Independent invariants (not just A==B)? | Layer 1's CanonicalInvariants/Tier4Invariants suites + the corpus `then` blocks (Layer 2.5) — the issue §7 distinction is preserved: equivalence and invariants are SEPARATE checks |
| Performance contracts (import budgets)? | Layer 1 (`performance/` — the T-417 budget suite) |

## 4. The shared-support layer + the Supabase-fakes census (TEST-309)

`src/tests/_helpers/` is the ONE shared-support root (the §15.45d convention, extended by T-419):
- `setup.ts` (the Vitest setup) · `radix-mouse.ts` (the ONE Radix interaction dance) · `finance-isolation.ts`.

**The TEST-309 census (24 files carry hand-rolled FakeClient/FakeQuery/FakeTable twins — issue §18):**

| Group | Files |
|---|---|
| Repository suites (entity-specific fakes) | supabase-calendar, -delivery, -expense, -inventory, -leave-request, -overdue-alert-generator, -pricing ×2, -purchase-request, -repositories, -supplier, -task, -workflow ×2, -workforce-attendance (15) |
| Task-era suites (t-0XX fakes) | t-011-payment-atomicity, t-012-bulkcollect-failfast, t-013-markcleared-atomic, t-099-supabase-chat, t-369-workforce-backend, t-372-student-documents-sync, t-402-academic-history-embedding, t-408-academic-setup, t-415-supabase-backup-repository (9) |

**The consolidation pattern (the registered follow-up, suite-by-suite):** a shared fake layer in `_helpers/fakes/` modeling the chainable PostgREST builder + rpc capture ONCE; each suite migrates with a byte-identical result gate (a suite's numbers must not move when its local fake is replaced — any movement is a modeled-contract difference to be REGISTERED, not absorbed). The shared fake must NOT pretend to be a full Supabase (issue §18: model the tested repository contracts; live behavior stays with the verify_t-XXX convention — the §15.19/§15.30b hazards stay visible).

## 5. The correctness audit record (issue #22 §1-§8 — what was audited, what was found)

| Audit surface | Finding | Disposition |
|---|---|---|
| Comparator normalization (§8) | No normalization-weakening found: centime comparisons stay exact; date/key-order/severity normalization is representational only | Preserved |
| All-error semantics (§8/§14) | TEST-308: `comparator.ts` lacked the all-error rule → NaN false positives + a false regression artifact per run; scenario 017's `then` was stale (contradicting its own description + the desktop engine + the SQL RPC) | FIXED (Phase 3): the error-expectation contract + the corrected 017 + the schema `error` key; verified 819/819 + 318/318 + a negative test |
| The tier-4 comparison layer (§7/§9) | Never run in recorded history; crashed on undefined values; its first completed run exposed PARITY-005 (the CALC-001 mirror drift: 77 scenarios / 499 rows) | Infrastructure FIXED (Phase 3); the engine drift REGISTERED (PARITY-005) — not silently absorbed, not "fixed" by weakening the comparator |
| Cross-platform agreement vs correctness (§7) | The desktop side is canonical on the PARITY-005 surface (post-CALC-001 + the SQL RPC's identical validation); the mirror is the stale side | The distinction is now explicit: Layer 2.4 REPORTS the divergence; the corpus `then` blocks + Layer 2.5 keep the canonical check independent |
| Silent skipping (§20) | The 35 not-implemented mirror ops errored as failures; the zero-payment family's error-equivalence was unrecognised | FIXED (Phase 3): skips carry reasons; error-equivalence is a first-class semantic; Layer 3 gates always print their reasons |
| Regression artifacts as inputs (§35) | Confirmed: nothing reads `regression/` as test input (only the comparator writes) | Classified + preserved (§2.3) |
| Test-as-second-engine (§5/§34) | No copied pricing tables/formulas found in the audited surfaces; the corpus `then` blocks are canonical expectations (now including the error form), not re-derivations | Preserved |

## 6. Operating the system

- **The authoritative run:** `npm test` (every layer, the unified report, baseline-deviation detection).
- **The fast loop:** `npm run test:vitest` or `npm test -- --layer=1 --skip-typecheck`.
- **Targeted suites:** `npm test -- --suite=domain` (a MODE of the one framework — never a second framework, issue §12).
- **Parity work:** `npm test -- --strict-tier4` gates on the mirror comparison (use it while developing the PARITY-005 repair).
- **The documented baseline:** `scripts/test-baseline.json` — update ONLY via a registered, verified change that intentionally moves it (cite the task ID in `_comment`).
- **Adding a test:** under `src/tests/<responsibility>/` — never a new root. Adding an equivalence op: extend the desktop runner + the mirror runner (or register the skip) + the real Kotlin runner, per the corpus conventions.
- **A new suite must not** re-implement a helper that `_helpers/` already owns (§15.45d) or a fake that `_helpers/fakes/` will own (TEST-309's census is the migration queue).
