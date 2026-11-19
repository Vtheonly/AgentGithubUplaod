# Session 5 — Full vitest census + the t-502 verdict (2026-11-19)

**Resolves SESSION_LOG open question 3** (carried since Session 1: root cause of the reproduced t-502 wave-meter parity failure).

## 1. Environment and method

- Clone `/home/z/my-project/AgentGithubUplaod` @ `c2613d1f` (branch `investigation/session-05`; application tree untouched — the vitest run is read-only execution evidence).
- Node v24.22.3, 2 sandbox cores; `npm install --ignore-scripts --no-audit --no-fund` (931 packages, 12 s; identical to Session 1's procedure).
- **The full suite cannot be run in one foreground command in this sandbox** (Session 1's documented limitation; background processes do not survive tool-call boundaries here). Method this session: **ten foreground shard runs** — `npx vitest run --shard=i/10 --reporter=json --outputFile=/tmp/vitest-sN.json` — executed sequentially at 01:50–02:02 UTC and aggregated from the ten JSON reports. Sharding is a vitest-native partition of the same file set; the union is the complete suite.

## 2. Results

| Shard | Test files | Tests passed | Failed | Skipped | Duration |
|---|---|---|---|---|---|
| 1/10 | 33 | 391 | **1** | 0 | 89 s |
| 2/10 | 39 | 1,136 | 0 | 0 | 50 s |
| 3/10 | 29 | 420 | 0 | 0 | 63 s |
| 4/10 | 28 | 408 | 0 | 0 | 70 s |
| 5/10 | 27 | 353 | 0 | 5 | 61 s |
| 6/10 | 40 | 1,004 | 0 | 0 | 83 s |
| 7/10 | 31 | 524 | 0 | 0 | 48 s |
| 8/10 | 29 | 388 | 0 | 0 | 66 s |
| 9/10 | 30 | 349 | 0 | 0 | 74 s |
| 10/10 | 34 | 297 | 0 | 0 | 37 s |
| **Σ** | **321** | **5,270** | **1** | **5** | **~10.5 min** |

Per-directory file distribution (321 files): infrastructure 107, features 83, domain 56, integration 16, ui 16, security 15, cross-platform 12, ai 6, rbac 6, app 2, core 1, performance 1.

## 3. Deviation from the documented baseline (`scripts/test-baseline.json`)

| Metric | Baseline (T-533/T-534, 2026-10-14) | This census (2026-11-19) | Δ |
|---|---|---|---|
| Test files total | 320 | **321** | +1 — `src/tests/ui/t-546-clair-epure-tooltips-latex.test.tsx` (commit `eba7f4c5`, T-546, post-baseline) |
| Tests passed | 5,247 | 5,270 | +29 (the t-546 suite + post-baseline additions; the exact per-file attribution of +29 was not decomposed — the failing-set comparison below is the governed criterion) |
| Tests failed | 0 | **1** | the single t-502 failure, root-caused below |
| Tests skipped | 5 | 5 | 0 |

**The governed criterion** (baseline `_comment`: "ANY deviation (new failure or vanished failure) is flagged loudly"): the failing-file set deviates by exactly one entry — `t-502-wave-meter-thresholds.test.ts` — and that entry is a **documented, root-caused, date-deterministic failure**, not a code regression (§4). No NEW failure of any other kind appeared in 5,276 tests.

## 4. The t-502 verdict (open question 3 — RESOLVED)

### 4.1 Reproduction (this session, 01:40 UTC)

`npx vitest run src/tests/domain/t-502-wave-meter-thresholds.test.ts` → 1 failed / 7 passed; failing assertion `t-502-wave-meter-thresholds.test.ts:169 expect(financeT1.isOverdue).toBe(false)` received `true`.

### 4.2 Root cause (established at source, not inferred)

The PARITY test pins a **fixed evaluation clock** `NOW = 2026-10-11T00:00:00Z` (test line 49) and injects it into two of the three surfaces:

- pooled derivation: `derivePooledTrancheWaves(rows, NOW, thresholds)` — clock **explicit** ✓
- Statistics view model: `deriveStatisticsWaves(rows, NOW, thresholds)` — clock **explicit** ✓ (`executive-statistics.ts` signature takes `nowEpochMs`)
- Finance strip: `deriveFinanceWaves(rows, thresholds)` — **no clock parameter exists** (`installment-schedule-tab.tsx:228-231`), and the adapter **hard-codes the wall clock**:

  `installment-schedule-tab.tsx:246` → `const pooled = derivePooledTrancheWaves(rows, Date.now(), thresholds);`

So the finance surface evaluated T1 (due 2026-09-15) against the *real* current date while the other two surfaces evaluated against 2026-10-11. Under the configured grace=30: fixed-clock age = 26 days → in-window (`false`); real-clock age on 2026-11-19 = 65 days → overdue (`true`). **The surfaces agree at a common instant; the test compares different instants.**

### 4.3 Failure-onset arithmetic (why the baseline was green and every later run is red)

The test became red the first real date where `daysBetweenFloor(2026-09-15, realNow) > 30`:

- baseline recorded 2026-10-14 → real age 29 ≤ 30 → finance said not-overdue → green (accidentally);
- **2026-10-15** → age 30 ≤ 30 → still green (boundary day);
- **2026-10-16 onward** → age 31 > 30 → permanently red.

Every run since 2026-10-16 fails deterministically at line 169. This is a **date bomb planted by the T-502 implementation itself** (STATS-403, `eba7f4c5`-era): the parity suite was written against a fixed clock but one surface's production signature cannot accept one.

### 4.4 Verdict and classification

1. **Verdict: date-sensitivity — of the production adapter, not of the test fixture.** The T-502 *business-logic* change (configured grace flows into every surface) is correct and all 7 non-parity assertions pass on any date; the defect is the **missing clock-injection parameter** on `deriveTrancheWaves` (`installment-schedule-tab.tsx`), i.e. the §15.81 wall-clock class re-introduced at the adapter boundary (the T-470 discipline — explicit evaluation clocks — was applied to the domain function but not to this feature adapter).
2. **Registered as BUG-038** (see FINDINGS_INDEX): `installment-schedule-tab.tsx:246` hard-codes `Date.now()` in the finance wave adapter; the same file also has unticketed wall-clock reads at `:330` (`daysBetweenFloor(w.dueDate, Date.now())`) and `:708`. **Fix path (execution scope, NOT this session):** add an optional `nowEpochMs` parameter defaulting to `Date.now()` (call sites unchanged), pass the test clock in t-502, re-pin per the T-470 convention. One-line signature change + one test-line change.
3. **Correction to the Session 1 interpretation (RUNTIME-EVIDENCE §2):** Session 1 wrote that the failure "corroborates the static findings DUP-016/BUG-012 family (parallel overdue predicates)". **Corrected:** the three surfaces share ONE predicate since T-502 (that was the point of the change) and agree at a common instant; the runtime divergence is clock-injection asymmetry, not predicate divergence. The static DUP-016/BUG-012 findings stand on their own static evidence; the runtime corroboration claim is withdrawn.
4. **Production impact (bounded):** the adapter's wall-clock read is the *correct* behavior in production (the strip always renders "now"-relative verdicts); the defect is hermeticity/testability, not user-visible wrongness at a single instant. It still matters for the unified pipeline/local-first work: any replay/backtest that renders the finance strip will re-read the wall clock instead of the replay clock (cross-reference R-1's replay contract).

## 5. What was NOT run (and why)

| Diagnostic | Reason |
|---|---|
| `npm test` unified runner (Layer 2 equivalence: desktopRunner 810/820, canonical 319/319, sanity) | Exceeds the per-command sandbox budget even sharded; the vitest census above is the Layer 1 ladder equivalent. Layer 2 remains executable in a longer-lived environment. |
| `eslint` | Time budget; the baseline carries 993 warnings / 0 errors and no execution-session code changed. |
| `check:migrations` | Unchanged inputs since S1 static verification; no migration was touched. |

## 6. Reproduction commands

```bash
cd elimtiyaz-desktop
npm install --ignore-scripts --no-audit --no-fund
for i in 1 2 3 4 5 6 7 8 9 10; do
  npx vitest run --shard=$i/10 --reporter=json --outputFile=/tmp/vitest-s$i.json
done   # aggregate the ten JSON reports; union = full suite (~10.5 min wall on 2 cores)
npx vitest run src/tests/domain/t-502-wave-meter-thresholds.test.ts   # 1 failed | 7 passed (any date ≥ 2026-10-16)
```

*No application source, configuration, schema, or dependency was modified; the census only executed the existing suite and wrote JSON reports under `/tmp`.*
