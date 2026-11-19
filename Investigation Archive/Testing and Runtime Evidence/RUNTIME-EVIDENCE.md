# Testing and Runtime Evidence — Session 1 (2026-11-17)

## Environment

- Clone: `/home/z/my-project/repo` @ `ff2c4d19` (branch `main`, clean tree at start).
- Node/npm available in sandbox. Dependencies installed with `npm install --ignore-scripts --no-audit --no-fund` (931 packages, 13 s; postinstall scripts skipped — Electron binary not downloaded, which only affects `electron:dev`/packaging, not typecheck/vitest).
- No database access: all live-Supabase verification scripts (`scripts/verify_t-*.sql`, `apply_*_live.sh`) were NOT executed — they require `SUPABASE_ACCESS_TOKEN` and would touch the live project. This is a documented limitation, consistent with the investigation charter.

## Executed diagnostics

### 1. TypeScript typecheck — `npx tsc --noEmit`

**Result: PASS (zero errors, zero output).** The entire 961-file renderer+electron codebase compiles cleanly against `tsconfig.json`. This is strong evidence that the dead exports and unused imports catalogued in this investigation are *type-level* debt, not broken builds.

### 2. Vitest suite — `npx vitest run`

- **Full suite does not complete within the sandbox's command timeout (~9.5 min).** Two partial runs were executed; observed output showed hundreds of passing suites (404 ✓-marked files in the captured partial log) across domain/features/infrastructure/security/rbac/app tests.
- **One targeted single-file run was executed to completion and produced a REAL failure:**

```
FAIL src/tests/domain/t-502-wave-meter-thresholds.test.ts
  > T-502 (STATS-403) — the wave meter's overdue verdict follows the CONFIGURED grace period
  > PARITY under one configuration: Statistics view model + Finance strip + pooled derivation agree on the verdicts
AssertionError: expected true to be false
  at t-502-wave-meter-thresholds.test.ts:169
  167|     expect(pooledT1.anyUnsettledOverdue).toBe(false);
  168|     expect(statsTuition1.phase).toBe("in_window");
  169|     expect(financeT1.isOverdue).toBe(false);   // ← received true
```

**Interpretation (evidence-based):** the PARITY contract "Statistics view model + Finance strip + pooled derivation agree on the overdue verdict" is currently violated: the Finance strip computes `isOverdue === true` for a T1 wave that the pooled derivation (`pooledT1.anyUnsettledOverdue === false`) and the Statistics view (`phase === "in_window"`) both consider not-overdue, under the configured grace period. This is a **reproduced cross-surface business-logic inconsistency in the tranche-wave overdue verdict family** — the exact class of divergence this investigation catalogued statically (DUP-016/BUG-012 family: parallel overdue predicates). It corroborates the static findings with runtime evidence.

**Relation to the documented baseline:** `elimtiyaz-desktop/scripts/test-baseline.json` records `tests: passed 5247 / failed 0 / skipped 5, testFiles total 320`, with `desktopRunner 810/820 errored 10`. The single observed failure above is either (a) a regression after the baseline was recorded, or (b) environment-sensitive (date-dependent test logic — the failing assertion involves grace-period windows against "today"). This was NOT further root-caused in Session 1 (the run-on-repeat cost is high); it is registered as an open verification item (see Unresolved Issues).

### 3. Migration append-only guard — `npm run check:migrations`

Not executed in Session 1 (time budget). It is wired into `npm test` per `package.json:21` and enforced by `t-058-migration-append-only.test.ts`; the guard's static behavior was verified by reading `scripts/check-migrations-append-only.sh` (report 05 §2).

### 4. Git-history diagnostics (read-only)

- `git log --diff-filter=M --name-only` over `elimtiyaz-desktop/supabase/migrations/` shows **22 migration files modified after their initial commit** (0004, 0022, 0024–0036, 0039, 0040, 0096, 0104, 0138, …) — recorded as OPS-010 (append-only policy vs actual history).
- Commit `ff2c4d19 "new"` is the current HEAD; commit subjects show the documented task-governance style.

## What was NOT run (and why)

| Diagnostic | Reason not run |
|---|---|
| `npm test` (full unified runner) | Includes typecheck + full vitest + equivalence pipeline; exceeds sandbox command timeout. Partial evidence collected instead (above). |
| Live Supabase verification scripts (`run_verify_sql_live.sh`, `verify_t-*.sql`, `apply_*_live.sh`) | Require `SUPABASE_ACCESS_TOKEN`; would contact the production project. Forbidden by the investigation charter (no remote/DB operations). |
| Electron packaging (`package:win`, `build-windows.*`) | Requires Electron binaries/Wine; out of investigation scope. |
| App runtime (`npm run electron:dev`) | Requires display + Electron download. Not available in sandbox. |

## Reproduction commands (for a later session with a fuller environment)

```bash
cd elimtiyaz-desktop
npm install --ignore-scripts
npx tsc --noEmit                       # expected: clean
npx vitest run src/tests/domain/t-502-wave-meter-thresholds.test.ts   # observed: 1 failed | 7 passed
npx vitest run                          # full suite (allow >10 min)
```

---

# Session 5 addendum (2026-11-19) — full suite completed; t-502 resolved

**The Session 1 open item is closed.** The full vitest suite was completed this session via ten foreground shard runs (the sandbox's background processes do not survive tool-call boundaries; sharding is vitest-native and the union is the complete suite): **321 files / 5,270 passed / 1 failed / 5 skipped** — the single failure is the same t-502 assertion, now **root-caused at source** as the finance adapter's hard-coded wall clock (`installment-schedule-tab.tsx:246` `derivePooledTrancheWaves(rows, Date.now(), …)` vs the test's fixed `NOW = 2026-10-11`): the parity test compares different instants, green by accident through 2026-10-15, deterministically red from **2026-10-16 onward**. Registered as **BUG-038** (fix path documented there; execution scope, not investigation scope). Session 1's interpretation ("corroborates the DUP-016/BUG-012 parallel-predicate family") is **corrected** — the three surfaces agree at a common instant; the divergence is clock-injection asymmetry, not predicate divergence. Full detail: `S5-VITEST-CENSUS-2026-11-19.md` (per-shard results, baseline deviation ledger, failure-onset arithmetic).
