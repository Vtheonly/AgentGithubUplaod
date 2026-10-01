# T-456 — The INV-20e Per-Year Debt-History Android Surface — Verification Record — 2026-10-02 (128th session)

> **The registered follow-up** (T-449's Left item #2, T-455's "What remains"
> #1, the next-task standing recommendation #1): the desktop's §17.3
> INV-20e year-history derivation (T-436/T-442) — the per-year
> debt-origin breakdown, « who owed what, for what, in WHICH academic
> year » — had NO Android counterpart: neither the engine port nor the
> surface. This task delivers both: the verbatim Kotlin mirror of
> `computeParentYearHistory` + the « Par année » drawer on the Debt
> Dashboard + the « Historique par Année Scolaire » section on the CRM
> parent screen (one engine, one rendering component, two surfaces —
> financial-rules §17.3's exact contract).
>
> **VERDICT: DELIVERED and TESTED.** The engine suite (the desktop's own
> corpus, mirrored) 28/28 GREEN, the rendering suite 4/4 GREEN, the FULL
> Android debug suite **629 tests / 0 failures** (was 597 at T-454:
> +32), lint green, the corpus-equivalence suites untouched-green.

---

## 1. What was wrong

The desktop gained the canonical year-history derivation in T-436
(engine, migration 0127) and the INV-20e per-service breakdown +
coverage lines in T-442 (the « Par année » tab on the Debt Aging
drawer + the CRM « Historique par Année Scolaire » section). The
Android app had NOTHING of it: `core/` had zero year-history code, the
Debt Dashboard's family rows drilled into the plain CRM profile with
no per-year financial history, and the parent screen showed only the
current-year billing breakdown. Registered as the standing Android
follow-up since the 126th session (T-449's Left: "the INV-20e
per-year debt-history SURFACE (T-442's Android UI — the engine side
lands with the wave semantics; the Android drawer UI is a follow-up
task)") — a §10 cross-platform divergence (a change shipped to one
platform only), now closed as **PARITY-008**.

## 2. What was delivered (android commit — this task)

- **`core/DebtAging.kt`** — the attribution + status half (the mirror
  of the desktop's `debt-aging.ts` attribution block): INV-14
  (`resolveAcademicYearForDate` — the Algerian school-year convention,
  July→`YYYY-(YYYY+1)`, January–June→`(YYYY-1)-YYYY`), the INV-18a
  persisted precedence (`attributeInstallmentAcademicYear`), the
  payment-made attribution, `academicYearStart`, plus the §15.1 4-tier
  status contract (the labels/tone tables + `computeDebtAgingStatus`
  — consumed by T-457). **Platform adaptations, documented in-file:**
  (a) Android's persisted installment column is `academic_cycle` (a
  year CODE string) — the desktop resolves its `academic_year_id` FK
  through the year windows; the precedence semantics are IDENTICAL,
  only the id→code lookup step is unnecessary; (b) amounts are Long
  centimes (the platform convention; the desktop's DZD doubles × 100),
  so the 0.001-DZD epsilon degenerates to `<= 0L` exactly.
- **`core/YearHistory.kt`** — the verbatim engine mirror of
  `year-history.ts` (`computeParentYearHistory`): the full record
  contract (`AcademicYearFinancialRecord` with `serviceBreakdown`,
  `outstandingStillOwedNow`, `paymentsMadeInYear` with
  `coveredCharges`/`coverageBasis`, `settlementsReceivedFromLaterYears`,
  `balanceEvolution`, the flags) + the T-442 additions
  (`PaymentCoverageLine`, `priorYearsStillOwed`, the CALC-003 fund
  classification — a bounced/refunded/cancelled payment's retained
  allocation rows are NOT coverage and NOT settlements; the honest
  `unavailable` basis when allocation rows are absent). Allocations
  are OPTIONAL input exactly as on the desktop (the legacy/import-era
  corpus path); Android has no `payment_allocations` persistence yet
  (a registered Left item — the surfaces degrade honestly per INV-18d).
- **`ui/features/crm/ParentYearHistorySection.kt`** — the ONE shared
  rendering component (the mirror of the desktop's
  `parent-year-history-section.tsx`): the prior-years banner with the
  per-year chips, the collapsible per-year cards (en cours / clôturée,
  réinscrit avec dette, parti avec dette), the « Services de l'année »
  INV-20e block, the charges with their settlement chips, the payments
  with the coverage lines (the italic « couverture non enregistrée »
  honest degradation), the cross-year settlements block, the
  balance-evolution summary. It computes via the ONE engine; it is a
  consumer, never a re-implementation (§15.53a).
- **The Debt Dashboard « Par année » drawer** (`DebtDashboardScreen.kt`
  + `DebtDashboardViewModel.yearHistory(parentId)`): the per-family
  drill-down (a calendar icon on each family row) opening a bottom
  sheet with the canonical year history — the T-430 conditional-mount
  discipline (the per-parent collectors start on open, stop on
  dismiss; the flow is cold in the ViewModel).
- **The CRM parent screen mount** (`ParentDetailScreen.kt`): the
  « Historique par Année Scolaire » section renders under the Finances
  card from the SAME streams the screen already collects
  (installments / payments / ledgerEntries).

## 3. The verification evidence (all commands actually run)

| Gate | Command | Result |
|---|---|---|
| The engine mirror suite | `./gradlew testDebugUnitTest --tests "com.example.core.YearHistoryTest"` | **28/28 GREEN** — the desktop's own `year-history.test.ts` (the owner's 100k/80k/20k scenario) + `t-442-year-breakdown.test.ts` (the three-year, every-service, bounced-cheque, legacy-payment scenario) mirrored verbatim in centimes |
| The rendering suite | `--tests "com.example.ui.features.financials.ParentYearHistorySectionTest"` | **4/4 GREEN** — the honest empty state, the year cards + flags, the expanded « Services de l'année » block, the prior-years banner chips (semantic assertions, ARCH-012 discipline) |
| The FULL Android debug suite | `./gradlew testDebugUnitTest` | **629 tests, 0 failures, 0 errors, 1 skipped** (was 597: +32; the pre-existing skipped is the documented Robolectric one) |
| Compile | `./gradlew :app:compileDebugKotlin` | BUILD SUCCESSFUL |
| Lint | `./gradlew lint` | BUILD SUCCESSFUL (0 new errors) |
| Corpus/equivalence suites | included in the full suite | CrossPlatformEquivalenceTest + the engine suites — GREEN (untouched) |

**Port fidelity notes (the honest list):** the Kotlin port's expected
values are the desktop's own numbers × 100 (centimes); the desktop
asserts `yearEndBasis: "allocations"` on the owner scenario (every
charge has allocations) and the T-442 year is MIXED (charges without
allocation rows) — the Kotlin suite pins the SAME verdicts. Two
engine-repair items found BY the suite during porting: the
`take(-1)` crash on the empty-records edge (the desktop's
`filter(idx < lastYearWithChargesIdx)` semantics handle -1; Kotlin's
`take` throws — fixed with `filterIndexed`) and one wrong test
expectation corrected against the desktop's own assertion.

## 4. The en-passant discoveries (registered)

1. **`NumberFormat(Locale.FRANCE)` groups with U+202F** (NARROW
   NO-BREAK SPACE), not U+00A0 and not a plain space — in BOTH the
   Robolectric and production JVMs. Any test asserting a rendered
   DZD amount string MUST build the expected string with the same
   `formatDzd()` formatter (never a literal "175 000"). Registered in
   the Android AGENTS.md §8.1 addendum (the T-456 lesson).
2. **The desktop's `paidUpToClock` exact/heuristic basis:** a year
   whose charges have NO allocation rows reports `yearEndBasis:
   "paid_date_heuristic"`/`"mixed"` — the honest-mixed verdict is the
   DESKTOP behavior; a future port that "fixes" this to pure
   `allocations` would diverge. Pinned by the Kotlin suite's MIXED
   assertion (mirrors the desktop exactly).
3. **Kotlin `List.take(n)` throws for negative n** while the desktop
   TS `filter(idx < n)` semantics silently return empty — the
   prior-years enumeration edge (no years with charges). Pinned by
   the empty-inputs test.

## 5. What remains (the honest list)

1. **Android `payment_allocations` persistence** (the registered
   follow-up): the engine takes allocations optionally (the desktop's
   own optional-allocation pattern); until Android pulls the
   allocation rows, every payment's coverage basis renders the honest
   « couverture non enregistrée » and the cross-year settlement block
   stays empty on real data. The engine + UI contracts are ready; the
   data leg (a Room table + DTO + pull sync) is its own task.
2. **Per-year pricing references** (`YearPricingConfigRef`): the
   engine carries the ADR-025 reference slot; Android's pricing model
   is not year-keyed yet, so the repository passes null (the Tarif
   line is absent — the honest empty).
3. **The corpus family for year-history** (the `derive_year_history`
   op + the cross-platform comparator leg) — the desktop's
   `AndroidEquivalenceRunner` extension; registered as the
   cross-platform follow-up (the unit suite pins the port against the
   desktop's own fixtures meanwhile).
4. The academic-year windows input is empty on Android (no
   `academic_years` pull) — the INV-14 convention + the persisted
   `academicCycle` column carry the attribution today; pulling the
   tenant's year windows (open/closed precision) is a follow-up.

**Evidence index:** PARITY-008 (the problem registry — RESOLVED-TESTED)
· T-456 (the task registry) · the Android commit (this task) ·
financial-rules §17.3 (the INV-20e contract this port mirrors).
