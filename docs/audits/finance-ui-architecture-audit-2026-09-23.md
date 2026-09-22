# Finance UI Architecture & Bug Audit — 2026-09-23 (inspection-only)

> **What this is:** a complete, inspection-only audit of the El-Imtiyaz **Finance architecture** (desktop `FinancialsPage` + every overlapping financial surface, including the parent portal's financial view), performed **before any code changes, unification, relocation, refactoring or bug fixing**. Its purpose is to give a later task a reliable map so functionality can be unified and relocated safely **without losing anything**.
>
> **HARD RULE honored:** zero source files, migrations, tests, dependencies or UI were modified. The only artifacts produced by this audit are documentation (this file + registry entries). Every finding below is evidence-backed from the current repository state; anything that could not be proven from the repository or a read-only live probe is marked **UNVERIFIED**.
>
> **Audited by:** AI audit session, 2026-09-23.
> **Commits audited:** hub `AgentGithubUplaod` @ `a5f1c1e` (main), website `elimtiyaz-website` @ `6f96ff7` (main).
> **Registry mapping:** audit-local finding IDs `FA-xx` are mapped to newly-registered problem IDs (DUP-006, BUSINESS-106..108, DATA-023..029) in `docs/recovery/problem-registry.md`.

---

## 0. Method, scope and evidence rules

1. **Read-only.** No edits, creates, deletes, renames or moves of source files; no refactors; no fixes; no UI/DB/test/dependency changes. Verified: `git status` clean on both repos after the audit (documentation commits only).
2. **Context read first** (AGENTS.md §5 order): `docs/recovery/task-registry.md`, `problem-registry.md`, `docs/audits/` README + prior audits, `docs/architecture/source-of-truth.md`, `boundaries.md`, `system-map.md`, `docs/domain/financial-rules.md` (§1–§15), `docs/recovery/current-state.md`, `next-task.md`, `unknowns.md` skim, ADR-002/004/010/017, recent git history (T-333..T-410 finance-relevant commits).
3. **Required-context availability note.** The task brief lists `Clients_Sheet_Merged.md`, `Entire_Project_Plan.md` and `Prices.md` as required reading. **None of these files exist in either repository today** (verified by filesystem search and `git log --all --diff-filter=A`). `Prices.md` is specifically documented as **"the retired fictional 'Prices.md'"** (`docs/domain/financial-rules.md` §10, CALC-001) — the canonical pricing source is the legacy workbook's raw formulas extracted into `src/domain/calc/pricing/school-price-matrix.ts`. The equivalent authoritative context was therefore read from `financial-rules.md`, `source-of-truth.md`, and the workbook CSV exports at the repo root (`Suivis clients  CSV/`). This substitution is recorded so the next agent does not hunt for missing files.
4. **Evidence sources:** current source trees of both repos; the canonical migration chain (0001–0113); git history/forensics (notably the origin of the Diagnostic tab, commit `db5e159`); and **read-only live SQL probes** against the current live project (Management API SQL endpoint, AGENTS.md §11.1 convention — SELECTs only, zero mutations; probe scripts preserved at `scripts/` in the audit workspace, results reproduced in §F where cited).
5. **Live-DB context (critical for interpreting every finding).** The current live project `vebfehrpzajhstyhinnw` is the **fresh clone** (switched 2026-09-17, PR #8 / OPS-314). Live probe census (2026-09-23): **4 payments, 71 ledger entries (67 charge + 4 payment — zero adjustments/refunds/reversals), 55 installments (46 tuition / 9 transport / 0 other), 51 unpaid (10 past-due / 41 future-due), 25 parents (0 restricted), 0 expense_tickets rows, 0 anomaly scores, `receipts` table dropped**. The 259-parent production corpus described in the docs lived on the **OLD** project (`hkvkefubghbbotgnteir`). Consequences: (a) most findings are **structural** (proven from code, not yet materialized in data); (b) any "mock vs live" divergence is currently amplified because live mode renders near-empty states while mock mode renders a rich seeded corpus.
6. **No external analysis was treated as evidence.** The session was told a pasted analysis "may or may not be the issue"; no such document was available in-repo, so every claim below was re-derived from repository evidence only.

---

## A. Finance architecture map

### A.1 Desktop — `FinancialsPage` (`elimtiyaz-desktop/src/features/financials/`)

Entry: `financials-page.tsx` (`FinancialsPage`), routed under `/financials`. Tab union type at line 99: `payments | installments | debt | debt-aging | expenses | receipts | diagnostic`.

| Tab (FR label) | Feature | Component (file) | Logic (domain/calc) | Repository (infrastructure) | Query / RPC | Data model (tables) |
|---|---|---|---|---|---|---|
| **Paiements** | Payments journal; issuer identity (parent avatar, family code, student), receipt + collector, exact timestamp, method + check/transfer refs, category, amount, status; search; row → detail drawer | `PaymentsTab` in `financials-page.tsx:424-572` | `sumPaidPayments`, `monthlyRevenue` (KPIs, page-level); label maps `PAYMENT_*_LABELS_FR` (`domain/model/payment`) | `repos.payments.observe()` → `SupabasePaymentRepository` (`supabase-shared-repositories.ts:1801+`) | `select * from payments` (tenant-scoped, unpaginated — see FA-14) | `payments` |
| — | Payment detail drawer + lifecycle: confirm clearance (PENDING→PAID), mark bounced (LIFO reversal), refund (canonical RPC), open parent | `PaymentDetailDrawer` (`payment-detail-drawer.tsx`) + `PaymentBreakdownCard` (`payment-breakdown-card.tsx`) | canonical coverage chain T-330: `payment_allocations` → ledger receipt-join → single line | `repos.payments.markCleared/markBounced/refund`, `allocationsForPayment` | `mark_payment_cleared`, `revert_payment_allocation` RPCs (0039/0041); `select * from payment_allocations` | `payments`, `payment_allocations`, `ledger_entries` |
| **Tranches** | Consolidated installment schedule: T1/T2/T3 wave header (canonical trancheNumber grouping), totals (due/paid/remaining/overdue-count), category+status filters, per-row Encaisser / edit due date / regenerate by cycle, overdue scan | `InstallmentScheduleTab` (`installment-schedule-tab.tsx`) | `deriveTrancheWaves` (local, canonical helpers inside), `sumInstallmentsDue/Paid/Pending`, `totalOutstanding`, `installmentRemaining` (`calc/payment/queries.ts`) | `repos.installments.observeByParent` per parent (N subscriptions), `repos.installments.updateDueDate/regenerateForCycle`, `repos.overdueAlerts.run` | table reads; `update_installment_due_date` (repo); overdue scan → `SupabaseOverdueAlertGenerator` | `installments` |
| **Créances** | Top-20 family debtors + per-grade breakdown (proportional split); MoM debt trend; bulk actions: broadcast reminders, lock delinquent (>90j); per-debtor reminder (WhatsApp + portal notification) + Encaisser (consolidated) | `DebtTab` in `financials-page.tsx:665-1041` | client-side MoM replay (inline ledger sum at 30-day cutoff, lines 683-702); aging bucket labels | `repos.debt.observeSummary()` → raw `SupabaseDebtRepository.seedSummary` (installment-based) **replaced at runtime** by `RealtimeFinancialDebtRepository` facade (`financial-realtime.ts:190+`, canonical ledger replay) when armed | `select parent_id, amount_due, amount_paid, amount_pending, due_date from installments where status<>paid` + parents lookup; `notify_parent_user` (0077); `write_audit_log` (0014); `update parents set is_financially_restricted` | `installments`, `parents`, `notifications`, `audit_logs`, `ledger_entries` (bridge) |
| **Suivi des Dettes** | Cross-year debt aging: status distribution KPIs (green/yellow/orange/red), per-family origin year, outstanding, age, last payment, subsequent-year activity, inactivity, canonical status + explanation; filters; detail drawer; Encaisser | `DebtAgingTab` (`debt-aging-tab.tsx`) | **zero local computation** — consumes `repos.debt.observeAging()`; presentation of `DebtAgingAnalysis` (`calc/ledger/debt-aging.ts`, financial-rules §15) | `SupabaseDebtRepository.observeAging` → RPC `compute_debt_aging_summary` (migration 0111); mock twin → canonical TS engine | `compute_debt_aging_summary(p_tenant_id, p_as_of)` | `installments`, `ledger_entries`, `academic_years` (server-side) |
| **Dépenses** | Expense tickets list (ref, title, category, payee, amount, status + anomaly badge); submit modal; detail drawer with two-tier workflow (Submitted→Approved/Rejected→Disbursed→Settled + proof upload + final amount + variance banner); anomaly explainer (AI) | `ExpensesTab` (`financials-page.tsx:587-649`), `ExpenseSubmitModal`, `ExpenseDetailDrawer`, `AnomalyExplainerModal` | status/category/urgency label maps (`domain/model/expense`); anomaly signals **fabricated client-side** (see FA-11) | `repos.expenses.observe/submit/…` → `SupabaseExpenseRepository` | `select * from expense_tickets`; workflow transition RPCs | `expense_tickets` |
| **Reçus** | Re-downloadable receipt PDFs per payment + full account-statement generator (parent selector) | `ReceiptsTab` (`receipts-tab.tsx`) | client-side PDF (`infrastructure/receipt-pdf`, pdf-lib; ADR-014) | `repos.payments.observe()`, `repos.payments.generateReceipt` | `select * from payments`; receipt record + PDF bytes via repository | `payments` (the DB `receipts` table is **dropped** — 0079 / CROSS-101) |
| **Diagnostic & Requêtes** | Interactive query console (6 preset queries + search + sort + live aggregates + AI copilot actions), cross-service performance matrix, cash-flow radar | `FinancialQueryConsole`, `CrossServiceMatrix`, `CashFlowRadar` | `evaluateFamilyFinancialDiagnoses`, `computeCrossServicePerformance`, `computeTreasuryHealth` (`calc/payment/financial-query-engine.ts`) — **parallel engine, see §H** | page-level streams: `repos.parents/students/installments/payments/ledger/debt` | no dedicated queries — full-table client caches | `parents`, `students`, `installments`, `payments`, `ledger_entries`, `expense_tickets` |
| *(page-level)* | 4 clickable KPI cards: Encaissé (cumul), Revenu mensuel, Créances en retard, Dépenses en attente; deep link `/financials?paymentId=`; tab-scoped action buttons; CounterPaymentModal wrapper | `FinancialsPage` body | `sumPaidPayments`, `monthlyRevenue`, `debtSummary.reduce(outstanding)` | same streams as tabs | — | — |
| *(modals)* | Unified payment collection (Stage 1 form + slider + debt meter + waterfall preview + proof upload to tenant vault; Stage 2 success + PDF + WhatsApp share + change calculator) | `UnifiedPaymentModal` (`unified-payment-modal.tsx`, 1183 lines), `CounterPaymentModal` wrapper, `PaymentSlider`, `DebtMeter` | `allocatePaymentToInstallments` (preview, T-060 exact-category), `displayParentCredit` (T-157), `currentTrancheLabel` | `repos.payments.collect` → **canonical atomic RPC** `collect_and_allocate_payment` (0026/0039/0040); `generateReceipt` | `collect_and_allocate_payment` | `payments`, `ledger_entries`, `installments`, `payment_allocations`, storage `payment_proofs` |

Realtime/freshness seam: `financial-realtime.ts` — `RealtimeFinancialDebtRepository` facade + cache invalidation on `payments/installments/ledger_entries/expense_tickets/parents/students` realtime events (audit-log stream fallback) + 30s poll fallback; `fetchAllPages` paginates at 1000.

### A.2 Canonical engines and repositories consumed by the Finance UI

| Layer | File | Role |
|---|---|---|
| Balance replay (INV-1) | `domain/calc/ledger/balance.ts` — `computeAccountBalance`, `computeParentSummary`, `displayParentCredit` (ADR-010) | THE balance derivation; SQL mirror `compute_parent_summary` (0042) |
| Overdue (INV-4) | `domain/calc/ledger/overdue.ts` — `buildOverdueDueDateMap`, `maxDaysOverdueFromLedger` | due-date basis for overdue classification |
| Debt aging (§15) | `domain/calc/ledger/debt-aging.ts` — `computeDebtAgingAnalysis/Status` | reference; SQL mirror 0111; website port sha-pinned |
| Installment queries (INV-4 family) | `domain/calc/payment/queries.ts` — `installmentRemaining`, `totalOutstanding`, `agingBucketFromDays`, `currentTrancheLabel` | per-tranche remaining `due−paid−pending` |
| Sums | `domain/calc/payment/sums.ts` — `sumPaidPayments` (status-strict "paid"), `sumInstallmentsDue/Paid/Pending`, `sumPendingPayments` | single source for "total collected" |
| Revenue | `domain/calc/payment/revenue.ts` — `monthlyRevenue`, `revenueByMonth`, `revenueByCategory` | status-strict paid revenue |
| Waterfall | `domain/calc/payment/waterfall-allocator.ts` — `allocatePaymentToInstallments` (cleared branch `due−paid`; pending branch `due−paid−pending` — see FA-03) | reference client waterfall |
| Clearance / reversal | `clearance.ts` (FIFO pending→paid), `lifo-reversal.ts` | lifecycle transitions |
| Billing breakdown | `domain/calc/payment/billing-breakdown.ts` — `computeParentBillingBreakdown`, `classifyAdjustmentHistory`, reconciliation INV-12/13 | canonical read-side itemization (T-164/166/167/168) |
| Service pricing profile | `domain/calc/payment/service-pricing-profile.ts` | T-333 exhaustive per-service pricing |
| Payment mutation (server) | migrations 0026/0033/0034/0039/0040 — `collect_and_allocate_payment` (+ `payment_allocations` written server-side), `mark_payment_cleared`, `revert_payment_allocation` | ⭐ canonical writers (ADR-002/004) |
| Debt repository | `SupabaseDebtRepository` (seedSummary raw / observeAging RPC / profiles canonical) + `RealtimeFinancialDebtRepository` facade | see §C/§F for the dual-basis issue |
| Reconciliation | `domain/calc/reconcile/reconciliation.ts` — 6 cross-checks (INV-9) | **no UI caller** (registry: reconciler dead surface — confirmed still true) |

### A.3 Parent portal — `FinancialView` (`elimtiyaz-website/src/features/financial/financial-view.tsx`)

Read-mostly. Tabs: **Facturation** (default; per-child/per-service billing breakdown + reconciliation footer + `ServicePricingCard`), **Tranches**, **Paiements** (with T-330 coverage details + proof dialog), **Relevé** (ledger timeline with running balance), **Ajustements** (provenance classification). Plus: 4 KPI cards (`portalFinancialSummary` → canonical port `computeParentSummary`), `DebtAgingStatusCard` (T-405 port), account-statement PDF (top-25 payments), per-payment receipt PDF. Queries: `src/lib/hooks/portal-queries.ts` (ledger fully paged at 1000/page since T-035; installments capped at 100/200; payments capped at 50/200). Canonical ports in `src/lib/canonical/` (sha-pinned twins of the desktop engine). Full map with file:line evidence in §C/§F of the website sub-report (below, folded into §F/G).

---

## B. Complete feature inventory

Every meaningful Finance feature found, with its surface(s). *(This is the preservation baseline for §I.)*

### B.1 Desktop `FinancialsPage`

**Page-level**
1. Four clickable KPI cards (Encaissé cumul / Revenu mensuel / Créances en retard / Dépenses en attente) — each navigates to its tab.
2. Tab-scoped header actions: Encaissement (installments + diagnostic tabs), Nouvelle dépense (expenses tab) — permission-gated (`CollectPayment`, `SubmitExpense`).
3. Deep link `/financials?paymentId=…` → opens Payments tab + payment drawer, cleans param (`financials-page.tsx:132-146`). (Note: `?expenseId=` / `?installment=` / `?expense=` deep links emitted elsewhere are NOT consumed — FA-16.)
4. Per-tab descriptive subtitle (`descriptionFor`).

**Paiements**
5. Payments journal DataTable (issuer identity enrichment from parents/students, receipt + collector attribution, exact date-time + relative, method + check/transfer refs, category, amount, status chip) with multi-field search.
6. Payment detail drawer: full metadata + parent/student navigation + `PaymentBreakdownCard` (what this payment covers — T-330 canonical chain) + lifecycle actions:
   7. Confirmer compensation bancaire (PENDING→PAID; moves pending→cleared per tranche).
   8. Marquer comme échoué (bounce; LIFO reversal + contrepassation; mandatory reason).
   9. Rembourser (full refund via `revert_payment_allocation`; permission-gated; mandatory reason ≥3 chars; real actor identity — T-014).

**Tranches**
10. T1/T2/T3 collection-wave header (canonical `trancheNumber` grouping — T-248/T-354; next-target highlight; pending-funds note).
11. Totals strip (Total dû / Payé / Reste / En retard count) over the filtered selection.
12. Category + status filters; text search (parent, label).
13. Per-row **Encaisser** → `UnifiedPaymentModal` in `installment_tranche` mode (INV-4 remaining preset, overdue context).
14. Per-row **Échéance** editor (due date + custom-schedule note; audited).
15. **Re-modéliser par cycle** (primaire/cem/lycee re-calendarization of pending tranches).
16. **Scan retards** — manual overdue scan (confirmation-gated) → `repos.overdueAlerts.run()` (alerts for overdue + ≤7-day-upcoming, deduped, audited).

**Créances**
17. Total-outstanding card with **30-day MoM trend** (client-side as-of ledger replay).
18. Bulk actions (both confirmation-gated): **Diffuser les rappels** (portal notification per debtor + audit summary; honest undeliverable count), **Verrouiller comptes délinquants** (>90j → `is_financially_restricted` + per-account + bulk audit).
19. Top-20 debtors table (rank, parent + phone, student count, aging bucket chip, days overdue, créance).
20. Per-debtor **Rappel** (audit + WhatsApp message prefilled with the live outstanding) and **Encaisser** (consolidated-debt payment context).
21. Per-grade breakdown bars (family outstanding split proportionally across children; "Inconnu" bucket).

**Suivi des Dettes (T-405)**
22. Status-distribution KPI strip (Familles endettées / Vert / Orange / Rouge / Jaune — clickable filters).
23. Family table: origin academic year + oldest due date, outstanding (same basis as Créances), age, open-obligation count, last payment (date + relative + "Jamais"), subsequent-year activity (count + total), inactivity, canonical status chip + explanation.
24. Status + origin-year filters.
25. Per-family detail drawer (obligation drill-down: category, label, due date, remaining, status) + "Fiche famille" (CRM) + **Encaisser** (same `UnifiedPaymentModal`).

**Dépenses**
26. Expense list (ref, title, category, payee, amount, status chip + Anomalie badge when score > 0.7) + search + details action.
27. **Nouvelle dépense** modal (title/category/urgency/amount/payee/justification; Zod-validated).
28. Expense detail drawer: two-tier workflow timeline; approve / reject (mandatory reason) / disburse / settle with **proof upload** (real file, size cap) + **final spent amount** + variance banner; audit on every step.
29. **Anomaly explainer** modal: 3 signals + AI summary + "Demander une justification" (comment persisted to anomalyNote; audited; PII-masked AI prompt).

**Reçus**
30. Receipt PDF re-download per payment (client-side pdf-lib; server receipt numbers REC-YYYY-NNNNNN).
31. Account-statement generator (parent selector → PDF of all their payments).
32. Row click = download; generation progress toast.

**Diagnostic & Requêtes**
33. Interactive query console: 6 preset queries (Fuite de Revenus Services / Compensations Immédiates / Risque Chèques Flottants >15j / Défaut Lourd Tranche 1 Bloquée / Créances Majeures >50 000 DA / Gros Versements Espèces >150 000 DA), text search, sort (dette / retard), live aggregate header (familles, créances, crédit, float).
34. Per-family row: contact, solde dû + retard, crédit dispo, diagnostic summary + recommended action; actions: **AI audit** (per-family prompt), **WhatsApp**, **Encaisser** (preset), **open parent dossier** (CRM).
35. **Audit IA sur la sélection** — batch AI analysis of the current filter (top-5 sample embedded).
36. Cross-service performance matrix (per service: engagé, encaissé, taux de rentrée bar, créances, débiteurs/total; row click → Tranches tab).
37. Cash-flow radar: flux net opérationnel (encaissé − dépensé), float chèques en banque, T1/T2/T3 velocity bars, rentrées prévues sous 30j (estimé).

**Shared modals**
38. `UnifiedPaymentModal` — the single collection UX: context modes (`installment_tranche` / `consolidated_debt` / `single_item`), inline parent search fallback, amount slider + tranche specs, debt meter (paid/paying/remaining + credit + over/underpaid badges + change calculator for cash), method + structured check/transfer fields, proof upload to tenant-scoped private vault, waterfall allocation preview (T-060 exact-category), single-item partial violation guard, Stage-2 receipt (PDF preview + download + WhatsApp share), audit identity propagation.
39. `CounterPaymentModal` — backward-compat wrapper (presets → context).

### B.2 Overlapping desktop surfaces outside `FinancialsPage` (audit-relevant; full map in the sub-report)

40. CRM parent drawer **Finances tab**: balance cards (brut/net/payé/reste-crédit via canonical breakdown + `displayParentCredit`), annual commitment coverage, Par Enfant / Par Service itemization + tranche coverage + per-tranche Encaisser, unattributed family items, T-168 reconciliation footer, recent payments, classified adjustment history (provenance chips); actions Encaisser (consolidated), Ajuster le compte (`repos.payments.adjust`), Relevé PDF.
41. CRM student drawer **Paiements tab**: per-student payments + installments + INV-4 remaining + inline pending sum.
42. Registration flows: batch wizard `computeBilling` (REAL matrix preview), mock `buildRegistrationBilling`, Supabase `register_family_batch` (0102/0103) — see FA-17 for the preview-vs-persisted divergence.
43. Excel import `buildInstallmentRows` (4-tranche BON structure + transport tranches; C3 reconciliation).
44. Dashboards/analytics: overview KPIs (`kpisForRange`), analytics executive engine (local `installmentRemaining` twin — FA-15), see-details modal (40/30/30 projection + collection %), alert-detail modal (INV-4-violating preset — FA-13), reports tab (revenue/aged-debt/expenses/workbook export).
45. Overdue alert generator (`SupabaseOverdueAlertGenerator` + EF `run-overdue-scan`): remaining = `due − paid` (no pending — FA-12).
46. AI copilot financial tools (`system-tools.ts`, `analysis-tools.ts`): ledger summaries (no due-date map → `total_overdue` always 0 — FA-15b), payment history totals (includes `pending_clearance` — FA-15c), collection-rate formula duplicated.
47. Global search: payments (receipt/method) → `/financials?paymentId=`; expenses → dead `?expenseId=` param (FA-16).
48. Workflow engine debt conditions (mock bridge re-implements outstanding/daysOverdue inline).
49. Personnel payroll — separate silo (`salary_payments`, never in `ledger_entries`; invisible to treasury radar).

### B.3 Parent portal (website)

50. Facturation tab (per-child/per-service breakdown, reconciliation footer with bridge, `ServicePricingCard` 7-section detail).
51. Tranches tab (per-student, INV-4 remaining, near-due/overdue badges, full_annual chip).
52. Paiements tab (coverage details T-330, proof signed-URL dialog, receipt PDF download).
53. Relevé tab (ledger timeline, month grouping, running balance).
54. Ajustements tab (provenance classification, reversal-pair links).
55. KPI cards + debt-aging status card + restriction banner; dashboard financial KPIs; calendar installment events; profile fee schedule; account-statement PDF.

---

## C. Duplication matrix

For each duplicated concept: the implementations, whether they are truly the same thing, the differences, and the likely canonical owner. **Nothing here is proposed for removal** — the goal is one source of truth with other surfaces consuming it (§J).

| # | Concept | Implementations (location) | Truly the same? | Differences | Likely canonical owner |
|---|---|---|---|---|---|
| C-1 | **Per-tranche remaining (INV-4)** | (a) `installmentRemaining` (`calc/payment/queries.ts:27`) ⭐; (b) inline in `SupabaseDebtRepository.seedSummary` (3399-3402) & `collectDebtors` (3774); (c) inline `Math.max(0, due−paid−pending)` in website `debt-aging.ts:313`; (d) **local twin** `executive-statistics.ts:83-86` (adds `Math.round` + status short-circuit) feeding the whole dashboard analytics layer; (e) inline `due−paid−pending` in `operational-query-console.tsx:312,343-347`; (f) **INV-4-VIOLATING** copies: `alert-detail-modal.tsx:143` (`due−paid`), `supabase-overdue-alert-generator.ts:163,167,205` + mock twin (`due−paid`), `unified-payment-modal.tsx:253` auto-suggest (`due−paid`) | Same formula intended; (f) variants are **wrong** (omit pending) | (d) rounds + status-gates; (f) omit `amount_pending` → overstate remaining/debt | `installmentRemaining` (a) — the others should call it |
| C-2 | **Parent balance / outstanding** | (a) `computeParentSummary` (`calc/ledger/balance.ts`) ⭐ + SQL `compute_parent_summary` (0042) + website sha-pinned port; (b) installment-basis Σ remaining (`seedSummary`, dashboard `kpisForRange`, debt-aging §15 basis); (c) `buildCanonicalDebtSummary` (realtime bridge — canonical (a) per parent); (d) workflow-bridge inline `outstandingFromLedger` (raw signed sum, clamped ≥0); (e) `DebtTab` MoM inline as-of replay | (a) vs (b) are **different bases** (ledger replay vs installment remaining — can disagree by adjustments/credits/charges-without-tranches; DATA-020 registered); (d) approximates (a) | (a) includes adjustments/refunds/credits; (b) only tranches; both are *legitimate but distinct* metrics currently presented as the same thing | `computeParentSummary` for balance; §15 installment-basis for debt-aging outstanding — **both must be labeled distinctly** |
| C-3 | **Unallocated credit** | (a) `computeAccountBalance.unallocatedCredit` (excludes reversed) + `displayParentCredit` (ADR-010) ⭐; (b) diagnostic `creditByParent` (`financial-query-engine.ts:175-187`) — raw filter `category=parent_credit ∧ type=adjustment ∧ amount<0`, **no reversal exclusion**, bypasses ADR-010 | Same business concept (parent credit) | (b) counts reversed credits; (b) ignores the 0062-era convention (historical overpayers have no credit rows) | (a) — `displayParentCredit(totalOutstanding, totalUnallocatedCredit)` |
| C-4 | **T1/T2/T3 tranche grouping + rates** | (a) `deriveTrancheWaves` (`installment-schedule-tab.tsx:135-158`) — canonical `trancheNumber` ⭐ (T-354/DASH-404 fix); (b) dashboard `WaveVelocityCard`/`deriveTrancheWaves` (dashboard copy of the same derivation — canonical column, shared helper); (c) diagnostic `computeTrancheRate` (`financial-query-engine.ts:414-419`) — **`label.includes("1"/"2"/"3")`** (the retired substring hack) | Same intended metric (tranche collection rate) | (c) groups by label text → on live BON labels T1=transport-only, T2/T3 overlap (2V counted twice); includes probe/test rows | (a) + the canonical sum helpers; the engine should accept wave rows, not re-derive |
| C-5 | **Per-service collection (billed/cleared/outstanding)** | (a) `ServicePricingProfile` engine (T-333) + `payment_allocations` (0033) ⭐ canonical per-service facts; (b) diagnostic `computeCrossServicePerformance` — cleared from `payments.category` (not allocations), outstanding from installments, recoveryRate = cleared/billed | Related but **not the same computation** | (b) attributes a payment to the category on the payment row (not where the waterfall put it); overpayment→credit inflates in-category cleared; NULL-category payments invisible | per-service cleared should derive from `payment_allocations` (T-330 chain), not `payments.category` |
| C-6 | **"Total collected" (KPI)** | (a) `sumPaidPayments` ⭐ (status-strict `paid`); (b) diagnostic `computeTreasuryHealth.totalClearedInflow` — same `status==='paid'` filter (equivalent); (c) AI `get_payment_history` total (`paid ∥ pending_clearance`) — **different**; (d) dashboard SQL inline reduce (`status='paid'` in window) — equivalent but windowed | (a)=(b)=(d); (c) diverges | (c) includes uncleared funds | `sumPaidPayments` semantics |
| C-7 | **Overdue amount / days** | (a) canonical INV-4+due-date map (`computeParentSummary.totalOverdue`, `maxDaysOverdueFromLedger`) ⭐; (b) `seedSummary` days = max per-installment `floor((now−due)/day)` incl. future-due clamped to 0; (c) `collectDebtors` days (past-due only); (d) AI/ledger call sites omitting the due-date map → `totalOverdue` always 0 | Same concept | (b) vs (c) use different row sets; (d) silently wrong | (a) |
| C-8 | **Aging buckets** | (a) `agingBucketFromDays` ⭐ (single helper, used everywhere incl. both debt repos) | same | — | (a) — correctly shared |
| C-9 | **Receipt numbering** | (a) server-side `REC-YYYY-NNNNNN` inside `collect_and_allocate_payment` ⭐ (ADR-004); (b) mock `collectPayment` local `REC-year-seq` (mock-mode only — accepted); historic client-side algorithms retired (DRIFT-011) | same format | mock seq is store-local | (a) |
| C-10 | **Account statement PDF** | desktop `generateAccountStatementPdf` (`infrastructure/receipt-pdf`) vs website `account-statement.ts` | Same deliverable, two platforms, **different derivations**: desktop passes profile totals (ledger-based); website passes `charged − unallocatedCredit` (not adjustment-aware, includes uncleared in payé) and hardcodes "2026-2027" | both must consume one canonical totals contract | shared totals contract (portal `portalFinancialSummary` shape) |
| C-11 | **Status/category label maps** | `PAYMENT_*_LABELS_FR` (model) ⭐ vs website i18n `finance.status.*`/`finance.category.*` + `finance.svc.category.*` (two maps) vs PDF-local `STATUS_LABELS`/`CATEGORY_LABELS` (receipt, **key-set mismatch**) vs statement `STATUS_FR` (**missing partial/unpaid/overdue**) | Same labels | wording + coverage drift across 5+ maps (website D1/D3) | one label contract per platform fed from the enum |
| C-12 | **Collection-rate ratio** | `system-tools.ts:508-511` (`monthlyRevenue/(monthlyRevenue+outstandingDebt)`) vs `see-details-modal.tsx:219-221` (annual variant) | Same invented metric, two copies | period basis differs | not canonical — needs a definition or removal decision (owner) |
| C-13 | **Debt summary (Créances)** | raw `SupabaseDebtRepository.seedSummary` (installment basis, one-shot, studentCount 0) vs `RealtimeFinancialDebtRepository` facade (canonical replay, reactive) vs mock `debt-ops.ts` (canonical replay) | facade ≈ mock; raw ≠ both (DATA-020) | raw: no adjustments/credits, studentCount=0, seeded once | facade's `buildCanonicalDebtSummary` |
| C-14 | **Excel import price construction vs registration price construction** | `buildInstallmentRows` (BON 4-tranche, remise on V2, REAL matrix) ⭐ vs `computeBilling` (wizard preview — same REAL matrix) vs mock `buildRegistrationBilling` (no system discounts) vs Supabase `register_family_batch` (40/30/30 split, flat family FI, **remise/sticker/prior-credit dropped**) | Intended to be the same business pricing | persisted paths differ from preview and from each other (FA-17) | the REAL matrix + one persisted construction (owner decision needed) |

---

## D. Misplaced functionality

Features exposed in a place that does not match their business responsibility — **preserved, only relocated in the future**:

1. **Expense anomaly explainer (AI)** lives in Finance → Dépenses, but its signals are fabricated (FA-11) and the real anomaly scoring column (`expense_tickets.anomaly_score`) has **no writer anywhere**. The capability belongs to a server-side anomaly evaluation (or must be honestly labeled as unavailable) — currently it is a Finance-tab UI presenting fiction.
2. **Overdue scan trigger** lives on the Tranches tab toolbar (a per-tab manual action for a cross-cutting notification concern). It works, but it is the only surface that can run the scan besides the daily EF cron. The trigger is arguably fine there, but the *generator's* remaining-formula belongs to the canonical INV-4 helper (FA-12) — the misplacement is the duplicated formula, not the button.
3. **Treasury health / cash-flow radar** (Diagnostic tab) consumes expenses + payments + installments + debt — a legitimate cross-finance analytical layer — but silently **excludes payroll** (`salary_payments` never enters `ledger_entries`), so "Flux Net Opérationnel" understates outflow by the whole payroll. Either payroll joins the treasury basis or the card must label the exclusion (owner decision).
4. **Account-statement generator** exists on BOTH desktop Reçus tab and (per-payment/parent) website — with different derivations (C-10). The website's is parent-self-service; the desktop's is staff-side; both should consume one totals contract.
5. **MoM debt trend** is computed inline inside `DebtTab` (a component-level as-of replay — §15.18 class). The derivation belongs in `calc/ledger` as an as-of variant of `computeParentSummary` (results today are equivalent, but it is an unguarded parallel implementation).
6. **`CounterPaymentModal`** is a compatibility wrapper kept for legacy prop APIs — fine, but its preset-only context makes the Diagnostic console's Encaisser default to category "tuition" (FA-02), i.e., the *wrapper's* shape leaks into collection semantics.
7. **Website invoice/adjustment hooks** (`useInvoices`, `useAccountAdjustments` in `portal-queries.ts`) are dead code reading empty/orphaned tables — misplaced legacy, candidates for removal in a cleanup task (not this audit's action).

---

## E. Source-of-truth map

For every major financial concept: the **current** implementation(s) actually feeding Finance surfaces, and the **recommended canonical source**. (Aligned with `docs/architecture/source-of-truth.md`; deviations flagged.)

| Concept | Current implementation(s) feeding Finance UI | Recommended canonical source | Notes |
|---|---|---|---|
| Total due (gross) | `sumInstallmentsDue` (Tranches) / `totalCharged` (profiles) / diagnostic `Σ amountDue` | `installments.amount_due` Σ (wave/parity via canonical helper); ledger `totalCharged` for charge-basis | two bases coexist by design (tranche vs charge) — label them |
| Total due (net) | profile `totalCharged + totalAdjusted` (T-103) | ledger replay `computeParentSummary` | OK |
| Total paid | `sumPaidPayments` (KPI) vs `sumInstallmentsPaid` (tranche progress, includes uncleared) vs ledger `totalPaid` | keep the three **named** semantics; each surface labels which it shows | sums.ts already documents the distinction |
| Outstanding balance | ledger replay (bridge, profiles, portal) vs installment Σ remaining (raw repo, debt-aging §15, dashboard) | ledger replay = balance; installment basis = debt-aging/collection outstanding — **one shared helper each, labeled** | DATA-020 family |
| Credits | `displayParentCredit` (modal meter, drawer, portal finance tab) vs diagnostic raw filter vs portal dashboard `Math.abs(unallocatedCredit)` | `displayParentCredit(totalOutstanding, totalUnallocatedCredit)` everywhere (ADR-010) | portal dashboard bypass (website B2) |
| Adjustments / discounts | canonical writer `payments.adjust` + `classifyAdjustmentHistory` (drawer, portal Ajustements) | unchanged | engine has exactly 2 real rules (CALC-001) |
| Payment allocation | server waterfall `collect_and_allocate_payment` + `payment_allocations` read (T-330) | unchanged; diagnostic per-service cleared should also read allocations | C-5 |
| Installment coverage | real rows authoritative; 40/30/30 synthesis display-only flagged `isSynthetic` (billing-breakdown) | unchanged | OK |
| Overdue debt | INV-4 + due-date map (canonical) vs per-installment days (raw repo) vs `due−paid` (alert generators) | canonical INV-4 + `buildOverdueDueDateMap` | FA-12/13 |
| Debt aging / status | `compute_debt_aging_summary` RPC (0111) + TS reference + website port | unchanged (T-405 VERIFIED) | clean |
| Payment history | `payments` table (journal, drawer) + ledger payment entries | `payments` for documents; ledger for replays | OK |
| Family financial summary | `ParentFinancialProfile` (canonical replay + real installments since T-164) | unchanged | OK |
| Service-level collection | diagnostic `computeCrossServicePerformance` (payment.category basis) | `payment_allocations` + `ServicePricingProfile` | C-5 / FA-06 |
| Treasury health | diagnostic `computeTreasuryHealth` (cash-only basis) | needs an owner decision on payroll + recovery factor | FA-07/08 |
| Receipts | client-side PDF + server receipt numbers | unchanged (ADR-004/014) | `receipts` table dropped (live-proven) |
| Reminders / restrictions | `notify_parent_user` (0077) + `parents.is_financially_restricted` | unchanged; debtor selection must use ONE basis | FA-05/09 |

---

## F. Bug audit

Every discovered bug: severity, exact location, evidence, expected vs actual, root cause, affected surfaces, classification. **None were fixed** (audit-only). Live-probe citations reference the read-only census of 2026-09-23 (§0.5).

---

### FA-01 — Consolidated-debt collection cannot allocate across categories (CRITICAL, integration)

- **Location:** `financials-page.tsx:966-987` (DebtTab context, `category: "other"`), `crm/parent-detail-drawer.tsx:582-609` (same), `financials-page.tsx:286-289` + `counter-payment-modal.tsx:43-72` (Diagnostic console → no category → modal default `"tuition"` at `unified-payment-modal.tsx:126`), `unified-payment-modal.tsx:221-224` (category := first line item's category), RPC filter `supabase/migrations/0040:115,162` — `AND (p_category IS NULL OR category = p_category)`.
- **Evidence:** every consolidated entry point builds a line item whose `category` is `"other"` (CRM drawer line 593, DebtTab line 974) or passes none (diagnostic → default `"tuition"`); the modal then sends that single category to `collect()`, and the server waterfall restricts allocation to `installments.category = p_category`. T-060 deliberately made every collection exact-category (BUSINESS-005 fix) but the consolidated mode was never reconciled with that semantics. Live probe P2: **zero installments with category `'other'` exist** — a consolidated cash collection today allocates to **nothing** and books the entire amount as `parent_credit` (0040's unallocated branch), leaving the Créances/Suivi outstanding untouched.
- **Expected:** "Encaisser le solde familial consolidé" allocates across ALL categories (canonical NULL semantics — financial-rules §4: "`NULL` / absent = all categories (canonical)").
- **Actual:** allocation restricted to one category; remainder becomes credit (cash) or sits unallocated-pending (cheque); debt surfaces unchanged; the payment row itself is filed under the wrong category.
- **Root cause:** T-060's exact-category fix applied uniformly without a cross-category mode for consolidated contexts; the context type has no `category: null` representation for line items.
- **Affected:** Créances Encaisser, Suivi des Dettes Encaisser, CRM drawer Encaisser, Diagnostic Encaisser — the four consolidated entry points; parent_credit ledger; every outstanding/balance surface afterwards.
- **Class:** integration + duplicate-logic problem (UI context contract vs canonical RPC semantics). Registered as **BUSINESS-106**.

### FA-02 — Diagnostic Encaisser defaults to category "tuition" (HIGH, integration; sibling of FA-01)

- **Location:** `financials-page.tsx:286-289` → `counter-payment-modal.tsx:43-72` (no `presetCategory` → `lineItems: []`) → `unified-payment-modal.tsx:126` default `"tuition"`.
- **Evidence:** the diagnostic console's one-click Encaisser (preset = family's total debt across all services) opens the modal with NO category; the modal keeps `"tuition"`; the waterfall then allocates only to tuition. Inconsistent with the other consolidated surfaces (which at least use `"other"`) — three entry points, two different wrong categories.
- **Expected/Actual/Root cause/Affected/Class:** as FA-01. Folded into **BUSINESS-106**.

### FA-03 — Cleared-branch waterfall ignores `amount_pending` (TS + SQL) and clearance has no overflow guard (HIGH, logic; latent on current data)

- **Location:** `domain/calc/payment/waterfall-allocator.ts:66-70` (cleared branch `clampNonNegative(due − paid)`; pending branch correctly subtracts pending — the A-0042 fix was applied to the pending branch only), `supabase/migrations/0040:119` (same asymmetry, cash branch), `supabase/migrations/0039:296-310` (`mark_payment_cleared` moves pending→paid with **no cap at amount_due and no parent_credit booking for overflow**).
- **Evidence:** the allocator's own comment states the canonical capacity is `due − paid − pending`, then the ternary applies it only when `!cleared`. Chain: (1) cheque 50k lands on a 100k tranche → `pending=50k`; (2) cash 100k arrives → cleared capacity computed as 100k → allocates 100k → `paid=100k, pending=50k` (INV-4 remaining says 0, but 150k is booked); (3) cheque clears → `mark_payment_cleared` adds the 50k → `paid=150k` on a 100k tranche; the 50k excess never becomes credit and vanishes from every read surface. Live probe P9: 0 over-allocated tranches today (data never exercised the chain — 4 payments, all cash/tuition).
- **Expected:** cleared-branch capacity = `clampNonNegative(due − paid − pending)` (INV-4); clearance overflow → `parent_credit`.
- **Actual:** over-allocation possible; excess money silently absorbed.
- **Root cause:** A-0042's fix covered pending-pending only; the cleared-pending twin and the clearance RPC were not audited with it.
- **Affected:** Paiements lifecycle (clearance), Tranches remaining, every outstanding surface.
- **Class:** duplicate-logic divergence between the INV-4 rule family and the allocation engines. Registered as **BUSINESS-107**.

### FA-04 — Diagnostic T1/T2/T3 rates use the retired label-substring hack (HIGH, data/logic)

- **Location:** `domain/calc/payment/financial-query-engine.ts:414-429` (`computeTrancheRate(prefix)` — `installments.filter(i => i.label.includes(prefix))` with prefixes `"1"`, `"2"`, `"3"`), same engine `t1Unpaid` at 230-234 (`i.label.includes("1")`); rendered by `cash-flow-radar.tsx:96-134`.
- **Evidence:** T-248/T-354's own documentation (`installment-schedule-tab.tsx:14-31`) bans exactly this: *"never the review's `label.includes("1")` substring hack (which would also match 'Tranche 10' and 'Année complète 1')… the live data carries the workbook's BON receipt labels ('INSCRIPTION (FI)', '2EME TRANCHE (V2)', '3ème TRANCHE (2V)', '4ème TRANCHE (v3)')"*. On those labels: T1 rate matches **no tuition row** (transport-only if transport labels carry "1"); T2 matches V2 **and** 2V; T3 matches 2V **and** v3 — 2V is double-counted across T2/T3 and the FI tranche is excluded from T1. On the CURRENT fresh-clone DB (probe P3) labels are a mix of `"Tranche N"`, `"Transport TN"`, `"Sonde CRUD T396 — T1"`, `"Probe …"` — the substring match then includes **test/probe rows** in the rates. The `early_default_critical` anomaly ("Tranche 1 initiale toujours impayée") checks the **transport** tranche on live BON labels — misclassification.
- **Expected:** grouping by canonical `tranche_number` (probe P8: fully populated — 18/19/18), as every other wave surface does since DASH-404.
- **Actual:** label-text grouping; wrong velocities; anomaly fires on the wrong tranche.
- **Root cause:** the diagnostic layer came from the unregistered owner commit `db5e159` (2026-09-11) which predated/ignored the T-354 fix and was never canonicalized (no task, no registry entry — AGENTS.md §15.14's exact hazard).
- **Affected:** Diagnostic tab (CashFlowRadar velocity, "Défaut Lourd" preset rows, diagnosticAlertCount badge on the tab).
- **Class:** duplicate implementation of the tranche-grouping concept (DASH-404 class). Registered as **DATA-023**.

### FA-05 — "Créances en retard" KPI shows TOTAL outstanding incl. not-yet-due; reminders/locking use a different basis (MEDIUM, data/semantics)

- **Location:** `financials-page.tsx:150,236-238` (KPI `overdueDebt = Σ debtSummary.outstandingAmount`, label "Créances en retard"); `supabase-shared-repositories.ts:3379-3457` (`seedSummary` selects `status<>'paid'` with **no due-date filter**); `financial-realtime.ts:95-123` (bridge: all parents with outstanding > 0.001); contrast `collectDebtors` (`supabase-shared-repositories.ts:3753-3757`) which filters `.lt("due_date", now)`.
- **Evidence (live):** probe P13 — of 51 unpaid installments, **10 past-due vs 41 future-due**; the KPI and the Créances tab count all 51 rows' remaining as "en retard" (≈80% of the displayed "overdue" is not yet due), while "Diffuser les rappels"/"Verrouiller" act on the 10 past-due only. The DebtTab's own "Créances totales" card (line 855) shows the same number as the "en retard" KPI — two labels, one value, different implied semantics. Also `agingBucketFromDays(0)` labels future-due debtors "0_30" (looks overdue-ish).
- **Expected:** the "en retard" figure = past-due outstanding (INV-4 + due-date basis), or the label changed to "Encours total" with a separate overdue figure.
- **Actual:** mislabeled total; bulk actions and display disagree on the debtor set.
- **Root cause:** the summary stream never distinguished outstanding from overdue; DATA-020 registered the mock-vs-live basis split, but the overdue-vs-total semantics gap is unregistered.
- **Affected:** page KPI, Créances tab (Top-20, per-grade, trend), tab count badge.
- **Class:** data/semantics + cross-tab inconsistency. Registered as **DATA-025**.

### FA-06 — CrossServiceMatrix "Encaissé" per service derives from `payments.category`, not allocations (MEDIUM, logic)

- **Location:** `financial-query-engine.ts:336-380` (`catPayments = payments.filter(p => p.category === key && p.status === "paid")`).
- **Evidence:** the canonical per-payment coverage source is `payment_allocations` (T-330, `payment-breakdown-card.tsx:10-19`; website `payment-coverage.ts` — same precedence). Consequences: (a) an overpayment that became `parent_credit` still counts fully as in-category "cleared" (recoveryRate capped at 100 hides it, but `Engagé`/`Encaissé`/`Créances` become internally inconsistent: cleared > billed with outstanding 0); (b) a payment whose row category differs from where the waterfall actually allocated it (e.g. FA-01's consolidated collections filed under `other`) is invisible to its real service row; (c) `recoveryRate` mixes a payments-basis numerator with an installments-basis denominator.
- **Expected:** per-service cleared from `payment_allocations` (or ledger replay by account).
- **Actual:** payment-row category attribution.
- **Root cause:** db5e159 parallel engine unaware of the 0033 allocations table contract.
- **Affected:** Diagnostic tab matrix. **Class:** duplicate logic. Registered as **DATA-029**.

### FA-07 — Treasury "Rentrées prévues sous 30j" uses an undocumented 85% factor and the wrong basis (LOW, logic)

- **Location:** `financial-query-engine.ts:408-411` — `debtSummaries.filter(d => d.daysOverdue <= 30).reduce((s,d) => s + d.outstandingAmount * 0.85, 0)`; comment claims "+ tranches due in next 30 days" but no future-due computation exists.
- **Evidence:** 0.85 is an arbitrary constant (no business rule in financial-rules.md); `daysOverdue <= 30` includes never-overdue debtors (days=0) but excludes future tranches due within 30 days (the comment's promise); includes only DebtSummary rows (basis of FA-05).
- **Expected:** a documented recovery model or an honest "encours ≤30j" figure without a fabricated factor. **Class:** logic/documentation. Folded into **DUP-006** evidence.

### FA-08 — Treasury health ignores payroll (MEDIUM, scope/integration)

- **Location:** `financial-query-engine.ts:386-431` (inputs: payments, installments, expenses, debtSummaries only); payroll lives in `salary_payments` (migration 0095) and never enters `ledger_entries` (verified: no writer).
- **Evidence:** "Flux Net Opérationnel" = cleared payments − disbursed expenses; salary disbursements (usually a school's largest outflow) are invisible. **Expected:** either payroll in the treasury basis or an explicit label. **Class:** integration/scope. Folded into **DUP-006** evidence (owner decision required).

### FA-09 — `lockDelinquentAccounts` never skips already-restricted accounts (LOW, logic)

- **Location:** `supabase-shared-repositories.ts:3785` (`restricted: false` hardcoded in `collectDebtors`'s return) vs the docstring/UI promise "Les comptes déjà restreints sont ignorés" (`financials-page.tsx:1013-1015`, confirm dialog).
- **Evidence:** the loop `if (d.restricted) continue` (3715) can never trigger; every run re-restricts and re-audits all matching debtors and the returned count includes previously-restricted ones. Idempotent at the DB level but the promise and the count are wrong. **Expected:** read `parents.is_financially_restricted` in `collectDebtors`. Registered as **BUSINESS-108**.

### FA-10 — Live Créances rows show "0 enfant(s)" and the raw summary is one-shot (MEDIUM, data; DATA-020 sibling)

- **Location:** `supabase-shared-repositories.ts:3446` (`studentCount: 0` hardcoded); `summarySeeded` one-shot guard (3380) — no reactive reseed.
- **Evidence:** the DebtTab "Élèves" column renders `d.studentCount` → always "0 enfant(s)" whenever the raw repo serves the tab (before the realtime bridge arms / when unconfigured). The bridge fixes both (real studentCount + reactivity) — so severity depends on mode. Registered as **DATA-026** (sibling of DATA-020).

### FA-11 — Expense anomaly signals are fabricated (MEDIUM, mock-vs-live divergence)

- **Location:** `anomaly-explainer-modal.tsx:52-71` (`buildMockSignals` — the same 3 hardcoded signals for EVERY expense: "dépense identique… il y a 2 heures", "aucun historique", "3× la moyenne"); badge source `expense.anomalyScore` (`expense-detail-drawer.tsx:93`) — mock seeds 0.1/0.72/0.45…; live column `expense_tickets.anomaly_score` (renamed from `n` by a later migration; 0008 created it, 0020 indexes it).
- **Evidence (live):** probe P4b — **0 expense rows, 0 with anomaly_score**; grep shows **no writer** populates `anomaly_score` anywhere (no RPC, no EF, no client write). In live mode the badge never shows; when it ever shows, the explainer still presents fabricated signals as "detected". The modal header itself admits "the 3 mock signals".
- **Expected:** either a real anomaly evaluation or an honest "signal non disponible" state. **Class:** mock-data-in-production. Registered as **DATA-027**.

### FA-12 — Overdue alert generator overstates overdue amounts (MEDIUM, logic)

- **Location:** `supabase-overdue-alert-generator.ts:157-168,205,251` (remaining = `due − paid`, comment claims INV-4); mock twin `notification-alerts-repository.ts:171,215` (same; inconsistently uses INV-4 at 207 in the same function).
- **Evidence:** tranches covered by uncleared cheques (`amount_pending`) are reported at their full remaining in overdue alerts — the exact DATA-008 defect class the Finance tab fixed (T-103). Separate root cause from DATA-023 (kept as an audit finding; registry entry deferred to the unification task to keep this session's registry edit controlled — see §K).

### FA-13 — Dashboard alert-detail collect preset violates INV-4 (MEDIUM, logic)

- **Location:** `features/dashboard/alert-detail-modal.tsx:143` — `Math.max(0, inst.amountDue - inst.amountPaid)` (no pending) vs canonical `parent-detail-drawer.tsx:237`.
- **Evidence:** opening collection from an overdue alert presets an amount larger than the true remaining when a cheque sits on the tranche. Also emits dead deep links `?expense=`/`?installment=` (94,114). Queued with FA-12 for the unification task's registry pass.

### FA-14 — `SupabasePaymentRepository.seed()` is unpaginated (MEDIUM-latent, data)

- **Location:** `supabase-shared-repositories.ts:1808-1823` — single `select("*")`, no `.range()`; PostgREST caps at 1000 rows. The realtime bridge's own `fetchAllPages` (financial-realtime.ts:167-180) documents the hazard.
- **Evidence (live):** 4 payments today (probe P1) — latent. With the production corpus (259 parents, thousands of payments), payments beyond row 1000 silently vanish from the journal/KPIs/diagnostic/search caches. Queued for the unification task.

### FA-15 — Analytics/AI parallel derivations (MEDIUM, duplication family)

- (a) `features/dashboard/components/analytics/executive-statistics.ts:83-86` local `installmentRemaining` twin (rounds + status-gates) feeds `analytics-derivations.ts:52` + `data-inspector-lineage.ts:60` — the entire analytics layer runs on the copy, violating the module's own "never re-implemented" comment.
- (b) `computeParentSummary` called WITHOUT the due-date map at `system-tools.ts:434`, `workflow-tools.ts:336`, `ai-copilot-provider.tsx:393`, mock `ledger-repository.ts:109` → AI `get_financial_ledger_summary` reports `total_overdue: 0` always.
- (c) AI `get_payment_history` totals include `pending_clearance` (`system-tools.ts:538-540`) vs canonical `sumPaidPayments` (`paid` only).
- (d) `supabase-dashboard-repository.ts:62,189,244` hardcoded academic year `"2025-2026"` defaults feeding AI answers post-rollover.
- All queued as evidence for **DUP-006**'s family; the desktop dashboard belongs to the next task's scope (registered in the audit, not individually in the registry this session — see §K).

### FA-16 — Dead deep-link params (LOW, navigation)

- **Location:** emitters: `search-index.ts:128` (`/financials?expenseId=`), `alert-detail-modal.tsx:94,114` (`?expense=`, `?installment=`); consumer: `financials-page.tsx:133-146` reads only `paymentId`.
- **Evidence:** grep of `financials-page.tsx` — no `expenseId`/`expense`/`installment` searchParams handling; expense opening is internal state only. Global-search expense results navigate to a URL that silently lands on the payments tab default. Queued for the unification task.

### FA-17 — Registration pricing: preview ≠ persisted, mock ≠ live (HIGH, cross-path consistency — outside Finance page but finance-writing)

- **Location:** preview `compute-billing.ts` (REAL matrix, remise on V2, per-grade FI) vs mock `buildRegistrationBilling` (`student-repository.ts:444-549`, no system discounts) vs Supabase `batchRegister` (`supabase-shared-repositories.ts:1332-1668`, config-grid tuition + system discounts + 40/30/30 split + flat family FI; **zero references to `remise`/`chargeStickerPrice`/`priorCredit`/`priorDebt`** — the wizard's negotiated remise is silently dropped in live mode).
- **Evidence:** three constructions of the same business event; the Excel import uses the fourth (BON 4-tranche). This was known-adjacent (WEAK-005 historical) but the remise-drop in `register_family_batch` is not registered. Queued as **DATA-028** (registered).

### FA-18 — UnifiedPaymentModal auto-suggest preset omits `amountPending` (LOW, INV-4)

- **Location:** `unified-payment-modal.tsx:252-254` — `setAmount(matching[0].amountDue - matching[0].amountPaid)` for tuition/transport when no preset. Data-008 class; the collection itself is server-canonical, only the suggested amount can over-collect when a cheque sits on the oldest tranche. Folded into **DATA-028** evidence.

### FA-19 — Website (portal) findings family (MEDIUM, cross-platform parity)

From the portal sub-audit (all file:line-verified in the website repo @6f96ff7):
- **B1** dashboard recent-payments pill hardcodes `tone="success"` + "Payé" for every status (`dashboard-view.tsx:273-277`);
- **B2** dashboard credit KPI bypasses `displayCredit` (`dashboard-view.tsx:208-219` vs `portal-derive.ts:465-468`) — shows phantom credit in the ADR-010 double-count case where the finance tab correctly shows 0;
- **B3** no realtime subscription on `ledger_entries` (`use-realtime.ts:146-163`) — all ledger-derived surfaces (KPIs, Relevé, Facturation, Ajustements, debt-aging) wait for the 5-min poll;
- **B4** statement PDF always prints "Année : 2026-2027" (`account-statement.ts:63` + caller passes `academicYear: null`);
- **B5/B11** statement totals not adjustment-aware and include uncleared in "Total payé" (`financial-view.tsx:242-246`);
- **B6** receipt `CATEGORY_LABELS` key-set mismatch (canonical categories print raw codes; null prints "Scolarité") (`payment-receipt.ts:50-59,119`);
- **B7** recon `clearedPaid = paid − pending` ≠ canonical `totalCleared` (`financial-view.tsx:166`);
- **B8** ledger-timeline React key falls back to `Math.random()` (`ledger-timeline.tsx:166`);
- **B9** installments capped at 100/200 rows (statement/debt-aging truncation risk) (`financial-view.tsx:113-116,153-156`);
- **D7** two "outstanding" numbers shown to the same parent (ledger replay KPI vs §15 installment-basis debt-aging card) without a bridge.
Registered collectively as **DATA-032 (portal finance family)** with this audit as evidence.

### FA-20 — `mock` ledger `summary()` returns `totalOverdue: 0` while Supabase returns the correct value (LOW, mock↔live)

- **Location:** `mock/ledger-repository.ts:109` (no due-date map) vs `supabase-shared-repositories.ts:2610` (with map). Same contract, divergent semantics — a latent mock-mode trap for any future consumer of `repos.ledger.summary()` (currently zero production callers — dead contract method, like `reconcileFinancials`). Queued for the unification task.

---

**Severity roll-up:** CRITICAL ×1 (FA-01/02), HIGH ×3 (FA-03, FA-04, FA-17), MEDIUM ×10 (FA-05, 06, 08, 10, 11, 12, 13, 14, 15, 19), LOW ×4 (FA-07, 09, 16, 18, 20).

---

## G. Cross-tab inconsistency audit

The same financial facts as presented by different Finance tabs and related screens:

| Fact | Surface A | Surface B | Inconsistency |
|---|---|---|---|
| Family outstanding | **Créances** Top-20 / KPI "Créances en retard" (ledger replay via bridge, or installment Σ via raw repo — mode-dependent, DATA-020) | **Suivi des Dettes** "Encours" (§15 installment basis, 0111 RPC) | Two bases presented side-by-side without a bridge; raw-repo mode additionally drops adjustments/credits. Also the "en retard" label vs total value (FA-05). |
| T1/T2/T3 collection rate | **Tranches** wave header (canonical `trancheNumber`) | **Diagnostic** CashFlowRadar (`label.includes`) | Different numbers for the same concept on two tabs (FA-04) — the exact DASH-404 symptom, now tab-vs-tab. |
| Parent credit | Payment modal `DebtMeter` + CRM drawer + portal Facturation (`displayParentCredit`) | **Diagnostic** console "Crédit Dispo" (raw parent_credit filter) + portal dashboard (`Math.abs(unallocatedCredit)`) | Different values when credits were reversed or for 0062-era overpayers (C-3, FA-19/B2). |
| Per-service "encaissé" | **Diagnostic** matrix (`payments.category`) | CRM/portal per-service pricing profile + payment coverage (`payment_allocations`) | Same concept, different attribution (C-5/FA-06). |
| "Total dû / Payé" (family) | CRM drawer Finances (net = charges + adjustments; payé = ledger totalPaid) | **Diagnostic** row (`Σ installments amountDue/amountPaid` — gross, uncleared-inclusive) | Different meanings of "facturé/réglé" between the staff dossier and the diagnostic console; the engine's `totalDebt` fallback (`max(0, due−paid)`) additionally omits pending (engine lines 198-203). |
| Overdue debtor set | **Créances** display (all outstanding) | Créances bulk actions + overdue alerts (past-due only) | 41 vs 10 rows on the live DB (FA-05/FA-12). |
| Payment "what it covers" | Paiements drawer `PaymentBreakdownCard` (allocations → ledger join → single line, T-330) | portal Paiements coverage (same chain, sha-pinned port) | **consistent** — the one concept that is fully unified cross-platform. |
| Statement totals | Desktop Relevé PDF (profile totals) | Portal statement PDF (`charged − unallocatedCredit`, hardcoded year) | Different totals for the same document (C-10/FA-19 B4/B5/B11). |
| "Encaissé" KPI | Page KPI (`sumPaidPayments`, all time) | Tranches "Payé" (`sumInstallmentsPaid`, includes uncleared) | Intentional different semantics, but both read as "payé" with no qualifier. |
| Debt status color | **Suivi des Dettes** canonical §15 status (green/yellow/orange/red with explanation) | **Créances** aging bucket chip (0_30…180_plus from daysOverdue) | Two different color vocabularies for debt health on sibling tabs (both canonical in origin, but visually unreconciled; INV-16d explanations exist only on Suivi). |

---

## H. Diagnostic & Requêtes audit (deep-dive)

**Origin forensics.** The tab and its engine arrived in the owner's unregistered commit **`db5e159`** (2026-09-11, subject "Here is the complete Git Commit Message…", 4 686 insertions) together with the dashboard analytics layer (`operational-query-console/engine`, `pivot-matrix-card`, `cross-risk-card`, `class-capacity-analyzer`, `see-details-modal` rework). The task registry refers to it only as "the owner's db5e159 analytics overhaul" and as "the CONCURRENT AGENT's in-flight commits"; **no task ID, no problem-registry entries, no ADR cover the financial logic it introduced** — the exact §15.14 hazard. This audit is the first canonical review of that layer.

### H.1 `evaluateFamilyFinancialDiagnoses()` — classification: **genuinely new analytical functionality, built on non-canonical inputs**

- **What is genuinely new (must survive):** the per-family anomaly taxonomy (`service_leakage`, `pending_check_risk`, `unabsorbed_credit`, `early_default_critical`, `large_cash_volume`), preset queries, recommended-action heuristics, and the AI-copilot integration (per-family + per-selection prompts). No other surface computes these classifications.
- **Non-canonical inputs (must be re-based, not removed):**
  - `totalDue`/`totalPaid` = `Σ installments.amountDue/amountPaid` (lines 198-199) — gross basis, uncleared-inclusive, inconsistent with the dossier's net/ledger basis;
  - `totalDebt` fallback `max(0, due−paid)` (200-202) — omits `amountPending` (INV-4 violation) when a debt summary is missing;
  - `unallocatedCredit` from raw `parent_credit` ledger filter (175-187) — no reversal exclusion, no ADR-010 display convention (C-3);
  - `t1Unpaid` via `label.includes("1")` (230-234) — FA-04: on live BON labels this tests the **transport** tranche while the UI calls it "Tranche 1 (initiale)" i.e. tuition;
  - thresholds (auxiliary debt > 5 000, credit>0 ∧ debt>0, >15 days float, >60 days, 150 000 cash, 40 000/50 000 debt) — **none documented in financial-rules.md** (INV-16c's "no page-local thresholds" spirit; these are engine-local).
- **Verdict:** analytical layer = legitimate; derivation layer = duplicate/parallel (DUP-006). The engine should consume `DebtAgingAnalysis` (§15), `ParentFinancialProfile`, `paymentCoverageLines` and canonical sums instead of re-deriving.

### H.2 `FinancialQueryConsole` — classification: **legitimate cross-finance query UI; minor defects**

- Preset filter + search + sort + aggregate header are pure presentation over the diagnoses — fine.
- Defects: WhatsApp button strips `+` then opens `wa.me/<clean>` — for Algerian numbers stored with `+213…` this yields a valid international URI, but numbers stored with a leading `0` produce an invalid `wa.me/0…` link (inconsistent with `DebtTab.sendReminder`, which uses `wa.me/?text=` without a number). Minor.
- `queryTotals.totalDebt` labels itself "Créances" — inherits FA-05's semantics (outstanding, not overdue).
- The tab badge `diagnosticAlertCount` (page line 181-184) counts families with any anomaly — includes `large_cash_volume` (an informational signal) in a "warning" badge.

### H.3 `computeCrossServicePerformance()` + `CrossServiceMatrix` — classification: **overlapping presentation of existing functionality with a duplicate derivation**

- The billed/outstanding/debtor columns duplicate what `ServicePricingProfile` (T-333) and the §15 aging already derive, but from `payments.category` instead of allocations (FA-06) — i.e., it is **both** another presentation **and** a duplicate implementation of per-service collection.
- The category list includes the retired fictional catalog (`canteen`, `uniform`, `books`, `extracurricular` — CALC-001 retired those services); rows self-hide when no data (`.filter(totalBilled>0 || totalCleared>0)`), so the taxonomy drift is latent, not user-visible today.
- Row click → `onFilterService` → `setTab("installments")` — navigates to Tranches but **does not apply the category filter** (the callback ignores its argument — `financials-page.tsx:297`). Minor UX defect.

### H.4 `computeTreasuryHealth()` + `CashFlowRadar` — classification: **legitimate cross-finance analytical layer with basis gaps**

- Net operating flow (cleared payments − disbursed/settled expenses) and bank float are genuinely new aggregates (no other surface computes them) — **provided** the payroll exclusion is labeled or fixed (FA-08).
- T1/T2/T3 velocity = duplicate of the wave concept with the broken derivation (FA-04).
- `recoverableDebt30d` = undocumented 85% factor + wrong basis (FA-07).

### H.5 Placement verdict

The Diagnostic tab is **a legitimate cross-finance analytical layer** (the owner's stated intent in db5e159: "static KPI cards → interactive financial intelligence"). Nothing in it should be removed. It is **misplaced only in its derivation layer**: every number it shows should be produced by the canonical engines (or a new canonical "analytics" module formally registered like T-405 did for debt-aging), not by a parallel engine embedded next to the UI. Its "Encaisser" action must adopt the consolidated-collection fix (FA-01) — it is currently the *worst* of the three entry points (defaults to tuition silently).

---

## I. Preservation checklist

Every capability that MUST remain available after any future unification (superset of §B; nothing may be dropped):

**Collection & lifecycle**
1. Atomic collection with waterfall + parent_credit + audit + server receipt numbers (canonical RPC path) — unchanged.
2. Per-tranche collection from Tranches tab (INV-4 preset, overdue context).
3. Consolidated family-balance collection from Créances / Suivi / CRM / Diagnostic (fixed to allocate across categories — the *capability* is preserved, the semantics are repaired).
4. Counter collection from scratch (inline parent search).
5. Payment lifecycle: clearance confirmation, bounce with LIFO reversal, full refund — all reason-gated, permission-gated, audited.
6. Proof upload (tenant-scoped private vault) + structured check/transfer fields + change calculator + Stage-2 receipt (PDF preview/download/WhatsApp).

**Read surfaces**
7. Payments journal with issuer identity + receipt attribution + exact timestamps + search.
8. Payment detail drawer + "what this payment covers" (T-330 chain).
9. Tranches schedule: wave header (canonical grouping), totals, filters, due-date editor, cycle regeneration, overdue scan.
10. Créances: Top-20 + per-grade breakdown + MoM trend + bulk reminders/locking + per-debtor reminder (WhatsApp + portal notification).
11. Suivi des Dettes: the full §15 record per family (origin year, age, last payment, subsequent-year activity, inactivity, status + explanation) + filters + drill-down.
12. Dépenses: full two-tier workflow with proof, final amount, variance, rejection reasons, audit.
13. Reçus: receipt PDF re-download + account statement generation.
14. Diagnostic: all six preset queries, free search/sort, per-family + per-selection AI actions, cross-service matrix, cash-flow radar (treasury), WhatsApp/encaisser/dossier actions.
15. CRM parent drawer Finances tab (itemization, per-service view, reconciliation footer, adjustment provenance) and student drawer payments tab.
16. Portal: Facturation/Tranches/Paiements/Relevé/Ajustements tabs, KPI cards, debt-aging card, statement + receipt PDFs.

**Engines & contracts (the unification targets — preserve behavior, single the implementation)**
17. `computeParentSummary` + `displayParentCredit` + overdue due-date map (INV-1/4, ADR-010).
18. `installmentRemaining` family (INV-4) — sole per-tranche remaining.
19. §15 debt-aging engine + 0111 RPC + ports.
20. `billing-breakdown` + `service-pricing-profile` + `payment-coverage` (T-164/330/333).
21. Waterfall/clearance/LIFO engines (after FA-03 repair).
22. `notify_parent_user` reminders + `is_financially_restricted` locking (with FA-09's honest skip).
23. Expense workflow RPCs; receipt PDF generators; the REAL price matrix (CALC-001).

---

## J. Recommended future architecture (target ownership only — NOT implemented)

1. **One derivation layer per concept, consumed by every surface.** The diagnostic engine's inputs are replaced by canonical records: `DebtAgingAnalysis` (§15) for age/inactivity/subsequent-year/status; `ParentFinancialProfile`/`computeParentSummary` for balance/credit (via `displayParentCredit`); `payment_allocations` for per-service cleared; canonical wave rows (`deriveTrancheWaves` promoted to `calc/payment`) for T1/T2/T3. `financial-query-engine.ts` shrinks to **classification + presets + prompts only** (the genuinely-new part), or is formally registered as a canonical analytics module (T-405 pattern: rules-first in financial-rules.md, engine, SQL mirror if needed, ports).
2. **Consolidated collection semantics.** Either (a) the modal gains a cross-category mode that sends `p_category = NULL` (canonical §4 semantics) for consolidated contexts, or (b) the RPC gains an explicit multi-category allocation contract. Presets from debt surfaces must set category `null` explicitly. (Owner decision: which form.)
3. **Two named outstanding metrics, one helper each:** `outstandingBalance` (ledger replay) and `collectionOutstanding` (installment §15 basis) — every surface labels which it shows; the Créances KPI either becomes past-due-only or is renamed "Encours".
4. **INV-4 everywhere:** delete the inline `due−paid` copies (alert generators, alert modal, auto-suggest, analytics twin, operational console) in favor of `installmentRemaining`; fix the cleared-branch capacity + clearance overflow (FA-03) behind the equivalence suites.
5. **Payments cache pagination** (`fetchAllPages` pattern) and the **restricted-flag read** in `collectDebtors`.
6. **Anomaly honesty:** either a real `anomaly_score` writer (server-side evaluation on submit) or the badge/explainer present an explicit "signal non disponible" state; the fabricated signals never ship as "detected".
7. **Treasury basis decision (owner):** payroll in or out, and a documented recovery model for the 30-day forecast (or drop the factor).
8. **Portal parity repairs** (B1-B9 family): dashboard credit/paid pill, ledger realtime subscription, statement totals contract + year, receipt label maps, recon `totalCleared`.
9. **Registration discipline:** the unification work itself must be task-registered (T-411) with ADRs for the consolidated-collection semantics and the outstanding-metric naming — no more db5e159-style unregistered financial logic.

---

## K. Registry actions taken by this audit (documentation-only)

- New problems registered in `docs/recovery/problem-registry.md`: **DUP-006, BUSINESS-106, BUSINESS-107, BUSINESS-108, DATA-023, DATA-024, DATA-025, DATA-026, DATA-027, DATA-028, DATA-029, DATA-032** (mapping from FA-xx per section F). Findings FA-07/08 (folded into DUP-006 evidence), FA-12/13/14/15/16/20 (queued as T-411 sub-findings) are deliberately NOT yet separate registry entries to keep this session's edit additive and conflict-safe with the concurrent agent; T-411's first step is to register them.
- New task registered: **T-411** (Finance UI unification — see task registry).
- `AGENTS.md` §15.53 added (permanent rule: analytical layers must consume canonical engines; unregistered analytics commits must be audited before becoming baseline).
- `docs/recovery/next-task.md` + `change-log.md` updated.
- **Zero code, migration, test or dependency changes.** `git status` on both repos: documentation-only diffs.



