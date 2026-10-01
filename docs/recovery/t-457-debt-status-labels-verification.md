# T-457 — The §15.1 Debt-Status Surface Labels on the Android Debt Screens — Verification Record — 2026-10-02 (128th session)

> **The registered follow-up** (T-449's Left item #3, the next-task
> standing recommendation #1): the Android debt surfaces showed NO
> canonical debt-status vocabulary — the family rows carried 5-bucket
> aging tags ("31-60 j") and the Créances tab a bare "Retard de X
> jours", while the desktop renders the §15.1 4-tier status (the
> configurable aging hierarchy whose §15.3 labels are IDENTICAL on
> every surface). This task delivers the status end to end: the factor
> derivation + the evaluation port, the DebtSummary contract fields,
> and the labels + INV-16d explanations on both debt surfaces.
>
> **VERDICT: DELIVERED and TESTED.** The status suite (the desktop's
> own T-429 hierarchy corpus) 17/17 GREEN, the FULL Android debug suite
> **646 tests / 0 failures** (was 629: +17), lint green.

---

## 1. What was wrong

Two divergences (registered as **PARITY-009**):

1. **No §15.1 status on the debt rows.** The desktop's debt surfaces
   render the 4-tier status (GREEN « Soldé / À échoir » · YELLOW « À
   surveiller » · ORANGE « Retard soutenu » · RED « Critique /
   Contentieux ») with the INV-16d explanation; the Android rows
   showed only the aging-bucket tag — the aging census vocabulary,
   never the debt status.
2. **A stale hardcoded number on the DebtTriageCard.** The call-list
   header read « LISTE D'APPEL IMMÉDIATE (> 45 j …) » while the
   derivation (T-450's configurable-thresholds port) applies the
   60-day red edge — a wrong number on the card since T-443 changed
   the live thresholds (the DEBT-101 (e) class: "the configured values
   are not applied where the operator looks").

## 2. What was delivered (android commit aa0f577)

- **`core/DebtAging.kt`** — `deriveDebtAgingStatusFactors` (the §15
  factor semantics: the INV-4 outstanding, the oldest-outstanding
  aging, the INV-16b never-paid inactivity default, the INV-15
  subsequent-year payment flag), REUSING the shared
  `daysBetweenFloor` (WaterfallAllocation.kt — the desktop's ms-floor
  semantics; no parallel implementation).
- **`DebtSummary`** gains `statusLevel` / `statusLabel` (§15.3
  wording) / `statusExplanation` (INV-16d) — additive, defaulted, so
  existing consumers keep compiling.
- **`LocalDebtRepository.observeSummary`** computes the status per
  row via `computeDebtAgingStatus` (the T-456 port of the desktop's
  evaluation) over the derived factors (the non-reversed payment
  entries are the inactivity source — the §15 replay convention).
- **`DebtDashboardScreen` + `FinancialsCreancesTab`** — the §15.3
  label chip, the explanation line, and the status-tone accents
  (green success · yellow/orange warning · red danger — the desktop's
  `DEBT_AGING_STATUS_TONE` mapping).
- **`ExecutiveCards.kt` DebtTriageCard** — the call-list header
  derives « > {redDays} j » from the snapshot's new `redDays` field
  (populated from the thresholds the derivation actually applied).

## 3. The verification evidence (all commands actually run)

| Gate | Command | Result |
|---|---|---|
| The status evaluation suite | `./gradlew testDebugUnitTest --tests "com.example.core.DebtAgingTest"` | **17/17 GREEN** — the desktop's own T-429 corpus: the tier boundaries (5/6, 15/16, 60/61), THE DECOUPLING pin (a payment 10 days ago never makes an ancient debt green; the « Payeur actif » annotation survives), INV-16c (amount magnitude never changes the level), the custom-threshold boundaries + the active-payer window, the §15.3 wording table, the factor derivation (INV-16b default, the last-payment inactivity, INV-15) |
| The FULL suite | `./gradlew testDebugUnitTest` | **646 tests, 0 failures, 0 errors, 1 skipped** (was 629: +17) |
| Lint | `./gradlew lint` | BUILD SUCCESSFUL |

## 4. What remains (the honest list)

1. **The live thresholds reader on Android** (the registered
   follow-up): the status uses the documented DEFAULTS (grace 5 /
   yellow 15 / red 60 — migration 0125's seed, which ARE the live
   values today) until the `system_settings` reader +
   `observeThresholds` equivalent lands (the desktop reads them live
   reactively; the corpus then-blocks were regenerated through the
   documented generator).
2. **The bucket FILTERS stay the aging-census navigation** (a
   legitimate second dimension — deliberately kept per scope control;
   the tier labels live on the rows themselves).
3. The corpus `debt_status` family (the cross-platform comparator leg
   over §15.1) is a follow-up; the unit suite pins the evaluation
   against the desktop's own fixtures meanwhile.

**Evidence index:** PARITY-009 (the problem registry — RESOLVED-TESTED)
· T-457 (the task registry) · the android commit `aa0f577` ·
financial-rules §15.1/§15.3 (the contract this mirrors).
