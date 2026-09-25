# T-412 Second-Round Verification Record — 2026-09-26 (98th session)

> **Mandate:** the owner's issue-#11 second-verification directive — *"Even if they are already marked as closed and have previously been tested, perform another additional layer of testing, especially for the personnel payroll / cash-flow functionality. I want a deeper second round of testing to make sure there are no remaining issues."*
>
> **Outcome:** the deeper round found **2 genuine defects** the first round missed (WORKFORCE-505, WORKFORCE-506), **fixed** them, and re-verified everything: 70/70 T-412 tests green, the full-suite baseline byte-identical, the live read-only probe 6/6, and the full live E2E 15/15 with zero residue. T-412 is now **VERIFIED** (all machine-verifiable gates; the owner's packaged-app UI pass remains the standing convention for the final visual acceptance, as with T-408..T-413).

---

## 1. What the second round did (layer by layer)

1. **Re-ran every first-round gate from a clean clone** (commit `0b457cd`): `tsc --noEmit` 0 errors · eslint 0 errors on the T-412 files · 47/47 first-round T-412 tests · FULL `vitest run` 3 939 passed / 25 failed / 5 skipped with the failing set byte-identical to the documented baseline families (t-034 / t-390 / vault / t-134 / ai-review / analytics-visuals / dashboard-3zone / t-355-356 / cross-platform) — confirmed the 96th session's claims reproduce.
2. **White-box re-derivation:** read `payroll-forecast.ts` line-by-line against the issue's Definition of Done and wrote a NEW 23-test suite (`src/tests/domain/calc/t-412-second-round-verification.test.ts`) targeting the boundary conditions the first round did not pin (R2-1..R2-14 in the suite header).
3. **The 7 initial failures triaged** into 2 genuine engine defects (below) + 3 test-expectation errors in the NEW suite itself (30-day-window arithmetic — the corrected expectations are now part of the pinned contract).
4. **Live read-only verification** (`scripts/t-412-live-forecast-verification.ts`): the canonical engine over the REAL `personnel` + `salary_payments` streams, cross-checked against independent SQL aggregations.
5. **Full live E2E** (`scripts/t-412-payroll-forecast-e2e.ts`): the complete loop — probe personnel → forecast → canonical `record_salary_disbursement` RPC → restatement → idempotence → the WORKFORCE-506 live proof → parity over mutated data → zero-residue cleanup.

## 2. The two defects found, fixed, and re-verified

### WORKFORCE-505 — the eligibility gate keyed on the CURRENT period

- **What was wrong:** the projected-wave loop was wrapped in `if (hasAnyEligibleStaff)` where the predicate was eligibility for the CURRENT period. A roster whose staff are all hired from a future month (the natural pre-academic-year state; any new school before opening) produced **zero waves** — the Personnel section rendered its "no eligible staff" empty state while November's payroll was upcoming and required funding.
- **Fix:** the outer gate removed; the per-period guard (`eligible.length === 0 → continue`) already prevents fabrication for every individual period. Pinned by R2-2 (hire-boundary on/after a future period's edges) and R2-9 (the all-hired-next-month roster: November wave present, `projectedMonthlyPayroll` = the first upcoming wave, `securedCurrentPeriod` 0).
- **Behavior preservation:** all 47 first-round tests unchanged and green (the empty-roster and terminated-roster cases still yield zero waves through the per-period guard).

### WORKFORCE-506 — current-period rows masked earlier missed-payroll gaps

- **What was wrong:** the overdue carry-over anchored on `recordedPeriods.at(-1)` — the maximum of ALL recorded periods *including the current one*. A single disbursement recorded for the current payroll made the guard `lastRecordedPeriod < currentPeriod` false, so every earlier gap vanished: July recorded → August/September missed → partial October recorded → the engine showed only October; the owed carry-over disappeared from `totalRemainingFunding` / `requiredCash30d` and `nextFundingWave` skipped to October.
- **Fix:** the anchor is now `recordedPeriods.filter(p => p < currentPeriod).at(-1)` — the last recorded period STRICTLY BEFORE the current period. Pinned by R2-13 (July + partial-October → nextFundingWave 2026-08, totalRemainingFunding 360 000) and **live-proven** by the E2E STEP 5 (2026-07 record after current-period rows → the 2026-08 gap surfaced as an overdue unfunded wave; the pre-fix engine showed no wave there).
- **Documented limitation (owner decision pending):** INTERIOR gaps — months without rows between two older recorded periods — still do not surface; distinguishing "no payroll due that month" (e.g. summer) from "payroll missed" needs the school's payroll-calendar convention (registered in unknowns; the §16 semantics deliberately left conservative).

## 3. The evidence stack (all re-runnable)

| Gate | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | **0 errors** |
| Lint (changed files) | `npx eslint <the 4 T-412 files + 2 scripts>` | **0 errors** (2 no-explicit-any warnings in the E2E http helper, the t-408 harness style) |
| T-412 suites (all 5) | `npx vitest run src/tests/domain/calc/t-412-*.test.ts src/tests/features/t-412-*.test.tsx src/tests/features/dashboard/t-412-*.test.tsx` | **70/70 green** (47 first-round unchanged + 23 second-round) |
| FULL suite | `npx vitest run` | **3 962 passed / 25 failed / 5 skipped** — the failing set byte-identical to the documented pre-change baseline; +23 passed = exactly the new suite |
| Live read-only | `npx tsx scripts/t-412-live-forecast-verification.ts` | **6/6 GREEN** (run before the E2E and again after cleanup — the live state unchanged) |
| Live E2E | `npx tsx scripts/t-412-payroll-forecast-e2e.ts` | **15/15 GREEN, zero residue** (payments deleted, probe archived; audit rows stay per §15.26) |

Live census during verification: 8 active FAKE T-408 staff @ 45 000 DZD (360 000 DZD current expected payroll — matched the independent SQL aggregation to the centime), 0 salary_payments before/after.

## 4. What remains

- **The owner's packaged-app UI pass** over the three surfaces (Personnel forecast section, Finance funding card, Statistics trend card) — the standing VERIFIED convention for the visual acceptance (identical to T-408..T-413); every machine-verifiable layer beneath it is now green.
- **The two owner decisions** (unchanged from the 96th session + one new): (a) `on_leave` staff in the eligibility basis; (b) the interior-gap payroll-calendar convention (WORKFORCE-506's documented limitation).
- **Android:** no shared contract changed (the read-side engine is desktop TS; no Android surface exists) — unchanged from the 96th session's assessment.

## 5. The commit chain of this round

1. `33ca46c` — docs(recovery): register WORKFORCE-505/506 (before the fix, §13).
2. `c566e96` — fix(personnel): the engine repairs + the 23-test second-round suite.
3. `1f9c8ca` — test(personnel): the live read-only probe + the live E2E (15/15).
4. The docs close-out commit (this record + the registry/task-registry/change-log/next-task/financial-rules updates).
