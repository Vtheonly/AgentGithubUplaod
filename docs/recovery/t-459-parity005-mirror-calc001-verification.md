# T-459 — PARITY-005 Closed: the TS Mirror's CALC-001 Discount Rules — Verification Record — 2026-10-02 (128th session)

> **The registered follow-up** (the 103rd session's T-419 Phase 3
> registration; non-gating by mandate): the Kotlin-mirror engine
> (`financial-tests/equivalence/android_mirror/kotlin_mirror_engine.ts`
> — the in-repo TS stand-in for the Android engine) still applied the
> three CALC-001-REMOVED fictional discount rules
> (passage_palier / highest_average / seniority_5y) plus the OLD 10%
> early-annual rate, the un-grouped sibling label, no zero-payment
> validation, and the details-less ORPHAN_REVERSAL violation — the
> documented KNOWN tier-4 divergence.
>
> **VERDICT: DELIVERED, TESTED, and CROSS-PLATFORM-VERIFIED.** The
> tier-4 comparison is **284/284 equivalent with ZERO discrepancies**
> (was 8 scenarios / 32 rows at the session's baseline; 77/499 at
> registration), the unified Layer-2 pipeline is GREEN with the tier-4
> comparison PROMOTED to the gating layer (the registered close
> condition), the desktop vitest BASELINE-MATCHED, tsc 0.

---

## 1. What was wrong (the audit at the session's baseline)

Re-registered live at the session open (the T-419 numbers had partially
aged — the corpus was cleaned in the interim):

| Divergence class | Scenario(s) | Rows |
|---|---|---|
| The three fictional rules still evaluated (passage_palier, highest_average, seniority_5y) + the OLD 10% early-annual rate + the un-grouped sibling label + the "(−10%)" label | 007, 008, 009, 010, 011, 012 | 30 |
| The zero-payment boundary: the desktop + the SQL RPC + the REAL Android all REJECT; the mirror ACCEPTED (error-vs-success) | 017 | 1 (ERROR) |
| The ORPHAN_REVERSAL violation's `details` object missing on the mirror (the canonical violation contract) | 015 | 1 (WARNING) |

**Total: 8 scenarios / 32 rows (9 ERROR, 23 WARNING).**

## 2. What was changed (the hub commit — this task)

- **`kotlin_mirror_engine.ts` — the verbatim re-mirror of the REAL
  Kotlin `core/DiscountEngine.kt`** (the CALC-001-clean engine):
  the three fictional rules + their constants
  (PASSAGE_DE_PALIER_AMOUNT / HIGHEST_AVERAGE_RATE / SENIORITY_RATE /
  SENIORITY_YEARS / CYCLE_TRANSITIONS) DELETED exactly as the Kotlin
  deleted them (the removal note mirrors the canonical
  discount-rules.ts header); `EARLY_ANNUAL_RATE` 0.10 → **0.05** (the
  workbook `SUM(F)*0.05`); the `groupAmountFr` helper (the Kotlin
  mirror — the byte-identical plain-space fr-FR grouping); the
  sibling label now `Fratrie — enfant #N (−{grouped} DA)`; the
  full_annual label now « Paiement annuel avant le 30 juin (−5%
  scolarité) »; the `grossScolarite` canonical slot + the deprecated
  `grossTuition` alias (the Kotlin data-class shape).
- **`android_mirror_runner.ts`** — the `allocatePayment` op gains the
  canonical zero-payment rejection (`Payment amount must be > 0 (got
  X)` — byte-identical to the desktop runner's AND the real Android
  runner's error string → all-error equivalence).
- **`kotlin_mirror_engine.ts` reconcile** — the ORPHAN_REVERSAL
  violation gains its canonical `details: { reversesId }` (the
  checks.ts violation contract).
- **`scripts/run-unified-tests.mjs`** — the REGISTERED CLOSE
  CONDITION executed: the tier-4 comparison is PROMOTED to the gating
  layer (any ERROR row now fails the run — the `--strict-tier4` flag
  becomes a documented legacy; the header comments updated).

## 3. The verification evidence (all commands actually run)

| Gate | Command | Result |
|---|---|---|
| The mirror runner | `npx tsx android_mirror/android_mirror_runner.ts` | 283 passed, 0 failed, 1 errored (017 — the error-equivalence leg), 36 skipped (the documented op-coverage boundary) |
| The tier-4 comparison | `npx tsx comparison/tier4_comparator.ts` | **284/320 equivalent, 36 skipped, Discrepancies: 0 (0 errors, 0 warnings)** — was 32 rows |
| The unified Layer-2 pipeline | `npm test -- --layer=2 --skip-typecheck` | **Verdict: GREEN** — desktop 810/0/10 (the documented zero-payment family), mirror 774/0/10/36, tier-4 784/820 equivalent / 0 rows (GATING, promoted), sanity 820/820 + canonical 319/319 + 0 discrepancies |
| The desktop pricing suites | `npx vitest run src/tests/domain/pricing/ src/tests/domain/ledger/debt-aging.test.ts` | **73/73** (discounts 19, the real-school corpus 11, the official schedule 13, debt-aging 30) |
| Typecheck | `npx tsc --noEmit` | **0 errors** |
| The REAL Kotlin engine (PARITY-005 item 2) | this session's `./gradlew testDebugUnitTest` (T-458's run) | **654 tests / 0 failures** — the corpus's discount scenarios run through the REAL `DiscountEngine.kt` (the runner's `evaluateAllSystemDiscounts` op), CALC-001-clean since f210cc4; the zero-payment leg errors identically (`Payment amount must be > 0` — LocalPaymentRepository.collect's own validation) |
| The full desktop vitest | `npx vitest run` | BASELINE-MATCHED (the documented 17-failure set — see the change-log entry for the exact counts) |

## 4. What remains (the honest list)

1. The 36 SKIPPED tier-4 scenarios (the ops the TS mirror runner does
   not implement — the app-layer/analytics families) — the documented
   coverage boundary, NOT a divergence: the REAL Kotlin runner covers
   them (the 320-scenario corpus run inside the Android suite).
2. The fictional-rule corpus scenarios (007/010/011/012) still exist
   and now verify the CORRECT post-CALC-001 behaviour (the ignored
   params) — they are the regression pins for this fix; retiring them
   is a corpus-hygiene decision for a future session (not needed for
   parity).
3. `--strict-tier4` remains as a documented legacy flag (harmless).

**Evidence index:** PARITY-005 (the problem registry — RESOLVED-TESTED)
· T-459 (the task registry) · the tier-4 report
`reports/tier4_equivalence_report_*.md` (regenerated this session) ·
CALC-001 (the original rule removal) · ADR-029 Layer 2 (the gating
promotion).
