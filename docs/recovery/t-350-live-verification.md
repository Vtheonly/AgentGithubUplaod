# T-350 — Live Verification: the dashboard-statistics data-flow investigation (63rd session, 2026-09-14)

> Owner mandate: investigate all three possibilities (Excel import / statistics engine / data fed into statistics), trace the ENTIRE data flow, verify with the live database before concluding anything. A pasted diagnostic report (12 claimed defects) was provided as reference only.

## 1. Method

Every claim from the pasted report was re-verified against (a) the current tree at `ae553ab` and (b) the LIVE Supabase database through the Management-API SQL endpoint (`POST /v1/projects/hkvkefubghbbotgnteir/database/query`, the T-091 pattern). The Excel source (the ETAT CSV export of `Suivis clients  2026_2027.xlsx`, 390 student rows) was cross-compared against the imported DB aggregates with a row-by-row + column-total script.

## 2. The full data-flow trace (verified state at each hop)

| Hop | Verification | Result |
|---|---|---|
| Excel ETAT (390 student rows) → parser/validator | Row-drop simulation of `isSummaryOrNonDataRow` over the real CSV | **0 student rows dropped** (the keyword rule never fires on this workbook) |
| → payments table | Column totals: FI 5,938,000 / V2 28,286,500 / 2V 10,299,800 / v3 8,638,800 / 1T+T2+t3 2,064,000 → Σ 55,227,100 | **EXACT parity**: `payments` (paid, 2026-08-11) = 891 rows / 55,227,100 DZD |
| → ledger_entries | Import+0063-reconciliation payment entries (description LIKE 'import Excel%' OR 'réconciliation 0063%') | **EXACT parity**: 891 entries / −55,227,100 DZD |
| → parents/students | CSV 390 students → DB 390 imported (391 active = +1 manual student, birthdate 2026-09-02) | **Parity** (the +1 is a post-import manual row) |
| → installments | 3-tranche structure (T1 41.75M / T2 31.15M / T3 38.76M due) + the 0063 alignDelta reconciliation | Consistent with the ledger (T-341 already proved engine≡SQL, 299 checks) |
| → data access layer (dashboard/debt/installment repos) | Code trace + live probes | **4 wiring defects found** (DASH-401/402/403/407 — see §3) |
| → statistics engines (executive-statistics / analytics-derivations / operational-query-engine) | Code trace | Engines are canonical + live-verified (61st session); defects are in the INPUTS they receive, not their math |
| → Dashboard components (Overview/Analytics/SeeDetails/Reports/Financials schedule tab) | Code trace | **4 consumption defects found** (DASH-401/404/405/406) |

## 3. Confirmed LIVE defects (registered: DASH-401..407, DATA-017/018)

1. **DASH-401** — `dashboard-page.tsx:137` reads `repos.debt.observeSummary().get()` synchronously; the Supabase cache seeds async (`void seedSummary()`) → the first render feeds `[]` to the Pareto, "À relancer", the modal's top-debtors table, and the risk engine. Live: 197 debtor families / 58,602,700 DZD. Also: the page slices to top-10 BEFORE the risk engine (incomplete dataset).
2. **DASH-402** — `analytics-tab.tsx:94-95` calls `repos.grades.observeForClass("")` / `repos.attendance.observeByStudent("", …)`; the Supabase repos build `.eq("class_id", "")` / `.eq("student_id", "")` (UUID = empty string → 0 rows; the mock filters `classId === ""` — also 0). GPA → null, attendance → 1.0, debt → 0 (DASH-401) → the entire Diagnostic Actif surface shows zeros. Live: 4 assessments + 3 attendance rows exist but are unreachable through the `""` queries.
3. **DASH-403** — the installments stream is unscoped: `SupabaseInstallmentRepository.observe()` seeds ALL tenant installments; `installments` has NO academic_year column; the waves/triage/concentration/transport derivations consume the raw stream, so switching the year selector changes the KPIs but not the executive cards. Live: 2025-2026 due-dates (2025-09-15 / 2025-12-15 / 2026-03-15) + 4 rows with 2026/2027 due-dates.
4. **DASH-404** — `installment-schedule-tab.tsx:96` `trancheNumberOf` = `/^\s*Tranche\s*([1-3])\b/i`. Live tuition labels: "INSCRIPTION (FI)" / "2EME TRANCHE (V2)" / "3ème TRANCHE (2V)" / "4ème TRANCHE (v3)" — ZERO match. The Financials tab's wave header computes TRANSPORT-ONLY totals (109 rows) while the canonical engine groups 1,170 tuition rows by `tranche_number`. Two derivations of the same concept, different numbers.
5. **DASH-405** — the SeeDetailsModal Departments tab renders "données par catégorie non exposées" while the page holds the canonical payments stream (T-243) one prop away.
6. **DASH-406** — `reports-tab.tsx` reads `payments` / `debt.observeSummary()` / `students` / `personnel` with synchronous `.get()` inside click handlers → exports written before the async seeds complete are empty/partial.
7. **DASH-407** — `SupabaseDashboardRepository.revenueForRange` builds NOW-relative last-12-month buckets; `MockDashboardRepository.revenueForRange` builds range-anchored buckets (Sep→Août). Same contract, different series (§15.15 mock-vs-Supabase tell).
8. **DATA-017** — all 891 imported payments are stamped 2026-08-11 (the import date). The workbook has NO payment-date columns. Monthly/YoY/weekly time-series degenerate to one spike. **Documented data-quality boundary — dates must NOT be fabricated.**
9. **DATA-018** — 390/391 students carry `date_of_birth='2000-01-01'` (the importer's documented placeholder) + 391/391 `gender IS NULL` → "18+ ans: 391" + a gray gender donut. Display must render "Non renseigné".

## 4. Claims from the pasted report that were REFUTED or found STALE (negative findings — do NOT re-chase)

| Claim | Verdict | Evidence |
|---|---|---|
| "Over-aggressive row drops (TOTAL/SOMME/NB keyword rule)" | **REFUTED** | Keyword-rule simulation over the real ETAT CSV: 0 student rows match. Import count parity 390 = 390. |
| "Excel data lost/misrecorded in payments" | **REFUTED** | CSV Σ 55,227,100 DZD = payments table Σ 55,227,100 DZD = ledger Σ −55,227,100 DZD (891 entries). Exact. |
| "Remise excluded from ledger → 0% erosion" | **STALE** | The 0063 reconciliation netted the historical double-discount (318 cancels +9,709,700 vs 318 remises −9,709,700); `deriveDiscountErosion` reads both → live erosion 8% (61st session, 299-check verify). The importer now writes NO remise entry by design (the devis is already net). |
| "REGLEMENTS_DETTES inserted as tuition revenue (the 55.2M vs 44.3M split)" | **NOT LIVE** | 0 REGLEMENTS_DETTES payment rows on live (DETTES charges: 2 rows / 15,000 DZD). The current wave encaissé (55.16M) ≈ the payments total (55.23M) — the contradiction the screenshots showed was repaired by the 0063 corpus alignment. The `category: "tuition"` assignment for future REGLEMENTS_DETTES imports remains a REGISTERED modeling note ( importer code, `repository-adapter.ts:992-1013`). |
| "Prior debt (DETTES) folded into tranche 4 creating a phantom deficit" | **SANCTIONED CONVENTION** | The alignDelta reconciliation (T-105 / migrations 0062/0063) IS the documented deterministic rule: "the LAST tuition tranche absorbs the delta" — live impact today ≈ 0 (DETTES 15k). Not a defect; changing it would re-open DATA-003. |
| "Split-brain: materialized views vs live streams contradict on the dashboard" | **MISATTRIBUTED** | The desktop dashboard NEVER reads `mv_dashboard_kpis` / `mv_debt_aging` / `mv_top_debtors` (rg: zero references in `src/`; the matviews are migration 0021/0049 artifacts + a refresh EF). The stale matview CONTENT (389 students, 48.58M debt) is real but harmless to the desktop; the actual contradiction mechanism was DASH-401 (the `.get()` race) + the 0063-era data. |
| "Encaissé mismatch 55.2M vs 44.3M / créances 58.6M vs 42.6M" | **REPAIRED EARLIER** | Current live: waves encaissé 55.16M ≈ KPI 55.23M (Δ = the 2 post-import Sept payments + refunds, explained); waves remaining 58.55M ≈ KPI outstanding 58.60M. The 0063 alignment closed the gap the screenshots captured. |
| "Importer only generated T3 for 130/390 students, T4 never → 16M unrepresented" | **STALE** | Live: T1 391 / T2 390 / T3 390 rows (no T4 — the 3-tranche structure with the alignDelta residual absorbed into T3 is the current sanctioned shape; the importer CODE now builds the 4-tranche BON structure for future imports). |

## 5. Live census snapshot (the numbers behind the investigation)

- Payments: 893 paid / 55,462,600 DZD (891 @ 2026-08-11 = 55,227,100 + 2 @ 2026-09-13 = 235,500). Categories: tuition 787 (53.40M), transport 106 (2.06M); 9 refunded tuition (8.1k), 2 refunded other (1.66M).
- Ledger: charges 393 tuition (113.72M) + 57 transport (2.11M); payments 797 tuition (−53.41M) + 106 transport (−2.06M); adjustments 690 tuition (−2.06M: 318 remises −9.71M + 318 double_remise_cancels +9.71M + alignment rows); 3 parent_credit adjustments.
- Installments (unpaid): T1 10,600,600 (147 rows) / T2 20,834,350 (259) / T3 26,919,750 (285) + 4 transport rows (248k) = 58.6M across 197 families. Due dates 2025-09-15 / 2025-12-15 / 2026-03-15 (+ 2 rows 2026-09-15, 1 @ 2026-12-15, 1 @ 2027-03-15).
- Students: 391 active; date_of_birth '2000-01-01' × 390; gender NULL × 391.
- Assessments: 4 rows; attendance_records: 3 rows (the school has not recorded the year's data yet — the honest-empty diagnostics are correct behavior ONCE the streams are wired).
- Matviews: 5 exist; `mv_dashboard_kpis` content is STALE (389 students, 54.96M revenue, 48.58M debt) — not read by the desktop.

## 6. Conclusion (root-cause statement)

The statistics **engines** are correct and consistent (T-338/T-341, 299 live checks). The **import** is faithful on the money dimension (exact CSV↔DB parity) with two DOCUMENTED source limitations (no payment dates → DATA-017; no birth dates/gender → DATA-018). The live defects the owner observed are concentrated in the **wiring layer**: statistics consuming empty, race-lost, unscoped, or incompletely-sliced datasets (DASH-401..407). Fixing the wiring — not the engines, not the data — is what makes the dashboard "one consistent source of truth".

**Verification commands** (re-runnable): the Management-API SQL probes above; `python3 scripts/excel_vs_db.py` (the CSV↔DB cross-comparison, evidence in §2); `npx tsc --noEmit` (0 errors), `npm run lint` (0 errors / 515 pre-existing warnings), `npm test` (144 files / 3198 / 0 / 5 pre-existing skips) — baseline at session open.
