# Statistics Metric Audit — 2026-09-30 (inspection-first, then remediated by T-447)

> **What this is:** the complete per-metric audit of the **Statistics tab** (`AnalyticsTab` — the three view modes Pilotage Exécutif / Diagnostic Actif / Flux Financiers) and every overlapping Statistics surface (the Overview tab's wave hero), performed **before any code change** per the owner's 2026-09-30 mandate ("audit every single metric in Statistics. Verify calculations, data sources, props, state, and reactive updates. Fix metrics that are incorrect, disconnected, using stale/wrong data, incorrectly calculated, dead code, or using mock/hardcoded values").
>
> **Method:** every metric was traced end-to-end — the rendered JSX → its view-model derivation → the canonical domain module → the repository stream → the scope filters — and cross-checked against the Finance surfaces that render the same concepts. Evidence is file:line based from the working tree at `f0ca6f9` (main, 123rd session close).
>
> **Verdict vocabulary:** `CANONICAL` (verified correct, canonical source, correctly wired) · `DEFECT-FIXED` (wrong, fixed by T-447 — cross-linked) · `PRESENTATION-FIXED` (numbers correct, the label/presentation lied — fixed) · `NOTED` (correct but a documented risk) · `DEAD-CODE-REMOVED`.
>
> **Registry mapping:** STATS-401 (the parity defect family) · UI-325 (the tooltip mandate) · STATS-402 (this ledger). The audit basis for the Finance side is `finance-ui-architecture-audit-2026-09-23.md` (§15.53).

---

## 1. The chain audit — Source Data → Domain Engine → Frontend

| Layer | Files | Verdict |
|---|---|---|
| Repository streams | `repos.installments.observe()` (dashboard-page:255) → `installmentsForAcademicYear` (T-353 scoping, dashboard-page:260) → `AnalyticsTab.props.installments` | CANONICAL — the Statistics installment-derived metrics all consume the year-scoped stream (the same `installmentsForAcademicYear` the Finance Tranches tab applies — T-431). |
| Payments stream | `repos.payments.observe()` (dashboard-page:250) → `AnalyticsTab.props.payments` (UNSCOPED) | **DEFECT-FIXED (STATS-402 ledger #1)** — the ServiceYieldCard consumed the raw all-years stream while every sibling installment card is year-scoped and the tab's own "Encaissements services" InspectTrigger is range-scoped (`applyAnalyticsFilters(payments, range, …)` — analytics-tab.tsx:308). The card and its own inspector trigger disagreed by every payment outside the active range. Fixed: the card now consumes the same range-scoped slice. |
| Canonical grouping | `domain/calc/payment/tranche-waves.ts#deriveTrancheWaveStats` | CANONICAL — one grouping (category × wave 1..3), INV-4 remaining, `isInstallmentSettled`, per-row rounding. |
| Statistics view model | `executive-statistics.ts#deriveTrancheWaves` (per-category waves + phase + pcts) | CANONICAL — thin presentation over the canonical stats; **but the CARD renders only its tuition subset as the main grid (STATS-401)**. |
| Finance view model | `installment-schedule-tab.tsx#deriveTrancheWaves` (pools every category per wave) | **DEFECT-FIXED (STATS-401)** — the pooling math (sums, date ranges, overdue union, tuition isolation, first-with-remaining) was a hand-rolled duplicate in a feature file with `Date.now()` hidden inside (§15.54d); retired in favor of the canonical `derivePooledTrancheWaves`. |

## 2. Per-metric verdict table (the Statistics tab)

### 2.1 The wave analysis (WaveVelocityCard) — the mandate's core

| Metric | Derivation | Verdict |
|---|---|---|
| Main T1/T2/T3 cards (collectedPct, dossiers, Facturé, Encaissé, Reste dû, Familles, phase badge, échéance) | `waves.filter(category === "tuition")` → **tuition only** | **DEFECT-FIXED (STATS-401)** — the mandate: the MAIN analysis must be ALL categories. Now renders the canonical pooled rows (see §3). |
| `pendingTotal` (En cours) | — (absent from the card) | **DEFECT-FIXED** — the card showed Facturé/Encaissé/Reste dû without En cours, so the mandate's "Total Due = Paid + Pending + Remaining" identity was unverifiable at a glance. Now displayed + the reconciliation line. |
| Global header badges (globalPct, restant) | Σ over all wave rows | CANONICAL — but the pooled per-wave identity now pinned by tests. |
| T1 subtitle "Rentrée & Inscription (Sept)" | `WAVE_TITLES` constant | **PRESENTATION-FIXED** — FI (inscription) is tranche 0, a NON-WAVE row (§15.65a — the presentation contradicted the billing model; the owner's own T-425 confirmation). |
| `daysLate` on the card | `daysBetweenFloor(w.dueDate, Date.now())` at render | **DEFECT-FIXED (clock split)** — the phase came from the derivation's `nowEpochMs` but the days-late recomputed `Date.now()` at render — the two could disagree across a due-date boundary. Now one clock: the card receives the derivation's `nowEpochMs`. |
| Auxiliary waves section (transport & services) | `others` per-category rows | CANONICAL — kept as the per-category detail; the main cards now carry the pool. |
| FI / non-wave categories | — (excluded by design, invisible everywhere) | **DEFECT-FIXED (completeness)** — the mandate lists FI/registration among the required categories; the wave model excludes tranche-0 rows BY DESIGN, so the analysis card now carries an explicit "hors tranches" section (FI + every other non-wave category) — visible, not silently dropped. |

### 2.2 The other Pilotage cards

| Metric | Derivation | Verdict |
|---|---|---|
| TripleRiskSummary (Moyenne < 10 / Absences ≥ 3 / Dette ouverte / triple critical) | `evaluateStudentRiskProfiles` + `deriveTripleRiskSummary` | CANONICAL — pure counts over the risk profiles; PARITY-001 sharePct. |
| DebtTriage 4 buckets + call list | `deriveDebtTriage(installments, now, thresholds)` | CANONICAL — T-443 wired the CONFIGURABLE thresholds (`observeThresholds`) into the tab (analytics-tab.tsx:145-146); edges match Finances by construction. |
| DiscountErosion (remise count/total/net/erosionPct/avg/min/max/families) | `deriveDiscountErosion(ledger)` + `isRemiseAdjustment` (T-389 contract) | CANONICAL. |
| FamilyConcentration (top-10, concentration pct, worst overdue) | `deriveFamilyConcentration` (explicit nowEpochMs) | CANONICAL. |
| EnrollmentDynamics (sibling index, family sizes, section imbalance) | `deriveEnrollmentDynamics` | CANONICAL — no fabricated ceilings (the T-338 fix verified). |
| TransportYield (riders, routes, per-route pct, unresolved towns) | `deriveTransportYield` | CANONICAL — route financials from transport installments (not payments); unresolved spellings reported verbatim. |
| ServiceYield (revenue/paymentCount/studentCount per service) | `deriveServiceYield(payments, …)` | **DEFECT-FIXED (scope — §1 above)**. |
| OperationalQueryConsole (Dossiers filtrés / Créances cumulées / Moyenne cohorte + the console body) | `evaluateStudentRiskProfiles` | CANONICAL — reuses the same riskProfiles object as every other card (one evaluation, many consumers). |

### 2.3 The Flux Financiers view

| Metric | Derivation | Verdict |
|---|---|---|
| StatStrip 6 tiles (total, count, mean, median, best month, σ) | `derivePaymentStats(slice)` | CANONICAL — over the filtered PAID slice; median/stdDev conventions documented. |
| MethodMix / CategoryMix | `deriveMethodMix` / `deriveCategoryMix` | CANONICAL — ADR-023 null-category semantics; honest "Autres (N)" tail merge. |
| YoY comparison | `deriveYearOverYear(revenue, prevRevenue)` | CANONICAL — like-for-like months; null delta on divide-by-zero. |
| AgingComposition (5 buckets) | `deriveAgingComposition(debtAging)` | CANONICAL — consumes the repository's `debtByAgingForRange`. |
| DebtorsPareto | `derivePareto(riskDebt)` | CANONICAL — all-years debt summaries (labeled). |
| PayrollCostTrend | `computePayrollForecast` (T-412 canonical) → `derivePayrollCostTrend` | CANONICAL — the same forecast Personnel and Finance read. |
| AnalyticsSlicers (method chips, category chips, reset, badge) | `applyAnalyticsFilters` — the ONE cross-filtering engine | CANONICAL — reactive: `setFilters` → memo re-derivation → every payments-derived card re-renders (verified: `slice`, `sliceTotal`, `unfilteredCount`, `categories` all depend on `filters`). |

### 2.4 The scoping/filter reactivity audit (stale state & closures)

| Check | Verdict |
|---|---|
| Slicer → card reactivity | CANONICAL — `slice`/`sliceTotal`/mix cards re-derive on every `filters` change (useMemo deps include `filters`); no stale closures found (`toggleMethod`/`toggleCategory` use functional setState). |
| Academic-year switch → installment cards | CANONICAL — `scopedInstallments` re-derives (dashboard-page:260); waves/triage/concentration/transport memos all key on `installments`. |
| Academic-year switch → payments cards | CANONICAL — `range` flows through `applyAnalyticsFilters`. |
| Clock staleness (§15.54d) | **NOTED + partially fixed** — `waves`/`triage`/`concentration` memos embed `Date.now()` (deps exclude the clock), so a long-open tab keeps yesterday's phases until the data changes. The days-late/phase split (2.1) was the visible symptom — fixed with the single-clock card; the memo-level freeze is documented as accepted (re-deriving every render would defeat the memo; the corpus equivalence REQUIRES the explicit-now shape). |
| Dead code | **DEAD-CODE-REMOVED** — `ExecutiveDashboard` (executive-cards.tsx, ~100 lines): exported, ZERO importers (verified: `rg ExecutiveDashboard src/ --glob '!*.test.*'` → definition only; no test references). Already flagged by T-443 in the TECHDEBT-100 standing queue; removed by T-447 Phase 4. |
| Mock/hardcoded values | NONE FOUND — every Statistics number traces to a repository stream or a derivation thereof (the T-355/T-356/T-357/T-389 purge held). The only hardcoded strings are presentation labels (see UI-325 for the bilingual layer). |

## 3. The parity defect (STATS-401) — the exact-dinar requirement

The two surfaces' headline T1/T2/T3 numbers, over the SAME rows:

| Concept | Statistics (WaveVelocityCard) | Finance (Tranches strip) | Same number? |
|---|---|---|---|
| Main T1/T2/T3 pool | **tuition subset only** | all categories pooled | **NO — different by construction** |
| Pooled pct formula | `sharePct` (round, no clamp) | `Math.min(100, round)` | **NO when paid > due** (over-coverage) |
| Pending (En cours) | absent | shown | NO (missing column) |
| Pooling implementation | per-category view model | hand-rolled pooling in the feature file | duplicated math (§15.53a) |

**The fix (T-447):** the domain module owns the pooled derivation (`derivePooledTrancheWaves` — union-accurate family sets, `pendingTotal`, the `overCoverage` reconciliation field, PARITY-001 pct, explicit `nowEpochMs`); the Finance strip consumes it; the Statistics main grid renders it. The parity suite (`t-447`) pins: for T1, T2 AND T3 — Statistics pool === Finance pool === canonical pool, to the dinar, over every category, including the FI/non-wave section.

## 4. The bilingual tooltip audit (UI-325)

Zero explanatory tooltips existed on any Statistics card/chart/metric/header/slicer/control (the only `Tooltip` imports in the analytics tree are RECHARTS chart-data hovers). The radix Tooltip infrastructure (shared/ui/tooltip.tsx + TooltipProvider at app.tsx:122) was ready but unconsumed. The i18n system (react-i18next, T-388: hand-maintained fr/en/ar + generated gen/*) had no Statistics-explanation namespace. → Fixed by T-447 Phase 3 (the `statsTips` dictionary namespace + the InfoTip component wired onto every Statistics element; zero explanations in JSX).

## 5. What was deliberately NOT changed

- The canonical `deriveTrancheWaveStats` grouping semantics (INV-4, 1..3 waves, per-row rounding) — the pooled derivation is ADDITIVE (new groupings of the same numbers, never new numbers).
- The per-category wave view model (`executive-statistics.deriveTrancheWaves`) — kept as the breakdown detail layer.
- The Android mirror (`StatisticsEngine.kt`) — the corpus + verify_t-338.sql stay the cross-platform contract; the pooled derivation's port is a registered follow-up (cross-platform rule §10).
- The Statistics surface's French presentation labels (the T-388 codemod's scope; the tooltip layer adds the bilingual explanations the mandate requires without re-translating the whole surface).
- The data-inspector lineage contract (T-389) — the closed domain union.

---

## 6. Remediation record (T-447 Phases 1–4, 2026-09-30 — the closed loop)

Every DEFECT/DEAD-CODE verdict above is remediated and pinned by tests (the verdict table's "Fixed by T-447" claims are now backed by runs):

| Audit finding | Fix (phase) | Evidence |
|---|---|---|
| §1 ServiceYield scope defect (raw all-years stream) | Phase 4 — the card derives from the range-scoped paid slice (`applyAnalyticsFilters`) | `src/tests/features/dashboard/t-447-audit-remediation.test.tsx` 4/4 (source pin + behavior: the out-of-range payment excluded, the in-range one counted) |
| §2.1 main grid tuition-only + missing pending + T1 label lie + FI invisible | Phase 2 — the canonical pooled all-categories main cards + the FI section + the reconciliation line + the corrected subtitles | `t-447-pooled-waves.test.ts` 16/16 + the wave family re-run 40/40 (t-424/t-427/t-434/t-435) |
| §2.1 days-late clock split (phase vs daysLate) | Phase 2 — the card receives the derivation's `nowEpochMs` (ONE clock) | the audit-remediation suite's source pin (no `daysBetweenFloor(…, Date.now())` remains in the card) |
| §2.1 pct clamp divergence (Finance Math.min(100) vs Statistics round) | Phase 1 — the canonical pooled `collectedPct` (PARITY-001, never clamped) consumed by BOTH surfaces | `t-447-pooled-waves.test.ts` ("collectedPct is round(paid/due × 100) — NEVER clamped") |
| §2.4 dead ExecutiveDashboard composite | Phase 2 — removed (zero importers; the orphaned imports cleaned) | the audit-remediation suite's removal pin |
| §4 zero tooltips | Phase 3 — the bilingual glossary + InfoTip wired everywhere | `t-447-statistics-tooltips.test.tsx` 12/12 (completeness ×3 locales, resolution, rendering, the fr↔en switch, the wired surfaces) |
| §2.4 clock-staleness (memo-level freeze) | NOTED (accepted) — re-deriving every render would defeat the memo; the corpus equivalence REQUIRES the explicit-now shape; the visible symptom (the phase/days-late split) is fixed | documented in §2.4; the single-clock card is the fix's scope |

The CANONICAL rows need no remediation by definition — the audit's contribution is the verdict table itself (the next "is this metric right?" question answers from §2).
