# Canonical Financial Rules

> The financial invariants of the system, reconstructed from the audited code and the (now removed) legacy `CANONICAL-FINANCIAL-LOGIC.md` spec, with §-references preserved where the audits cite them. These rules are **the** business rules: the SQL RPCs (canonical writer), the desktop TS engine (reference implementation), the Android Kotlin engine (mirror), and the website port must all satisfy them. Any behaviour change here requires an ADR and equivalence-suite runs.

## 1. Money & precision

- Currency is DZD. Desktop uses dinero.js; Android uses centime `Long`s; SQL uses numeric. Equality comparisons use a **0.001 DZD epsilon** (see overdue rule).

## 2. Identity codes — determinism (§7.1) [ADR-003]

- `parent_code` = `PAR-{year}-{4-char hash}` where the hash is **FNV-1a over the trimmed, non-empty identity fields (firstName|lastName|primaryPhone) joined by `|`** — deterministic, idempotent.
- `student_code` = `ELV-…` derived deterministically from `(parentId, displayName, firstName, lastName)`.
- Activation codes: deterministic variant is FNV-1a over `tenantId|parentCode`, mapped into a 6-digit range (canonical function `deterministicActivationCode`).
- Consequence: the same logical entity pushed/imported twice converges to one row (idempotent upsert). Random or sequential generators are **forbidden** — every remaining one is registered under `DRIFT-001`.
- ⚠ Open question on activation-code *entropy* (DB currently uses non-crypto `random()`, 7 digits): see `WEAK-100` / `UNKNOWN-008`.

## 3. Ledger & balances (INV-1)

- **Balances are never stored; they are always replayed** from `ledger_entries` (charges, payments, adjustments, refunds, reversals, transfers).
- Ledger entry types are exactly: `charge | payment | adjustment | refund | reversal | transfer`.
- The reference replay is the desktop `computeParentSummary`; the SQL `compute_parent_summary` (migration 0042) mirrors it; Android mirrors it; the website port replays fetched rows (⚠ limited to 500 — WEAK-022).

## 4. Waterfall allocation (INV-6)

- A payment allocates to outstanding installments **oldest-due-date first**, within the payment's category filter.
- Category filter semantics: `NULL` / absent = **all categories** (canonical). A specific category (tuition, transport, canteen, …) restricts allocation to that category's installments.
- Remaining installment amount (INV-4 family): `clampNonNegative(amount_due − amount_paid − amount_pending)` — uncleared pending funds reduce what the parent owes.
- **Every read surface MUST use the canonical helper for this formula** (desktop `installmentRemaining` / website `installmentRemainingAmount` / Android `Installment.remaining` / SQL `GREATEST(0, amount_due − amount_paid − amount_pending)`). Inline `due − paid` formulas in UI code are a registered defect class (DATA-008, fixed 2026-09-01) — do not reintroduce them.
- Overpayment → `parent_credit` adjustment (never negative installment amounts).
- ⚠ **parent_credit display semantics (DATA-009, open decision T-104):** the canonical writer books the FULL payment entry (−amount) plus a parent_credit adjustment (−unallocated) when a payment over-satisfies the schedule, so the raw ledger balance double-counts the credit (verified live 2026-09-01: 100k charge + −150k payment + −50k credit → balance −100k for a 50k overpayment). Read surfaces must derive the displayed "credit" from `totalUnallocatedCredit` (the true value), NOT from the raw negative balance, for parents overpaid through the canonical path. The 0062-reconciled historical corpus intentionally has no parent_credit entries (balance = −excess is already exact).

## 5. Overdue rule (INV-4)

- An account is overdue iff:
  1. `balance > 0.001 DZD`, AND
  2. the latest charge (`MAX(charge.at)`) predates `now`, AND
  3. the category due date (`overdueCategoryDueDates[account]`) predates `now`.
- The due-date map MUST be built (desktop `buildOverdueDueDateMap`) and passed to the summary computation — omitting it silently yields 0 overdue (the Android defect WEAK-007).
- "Days overdue" is measured from the due date, never from the charge creation date (Android violation: BUSINESS-007).

## 6. Reconciliation (INV-9)

- The reconciler MUST run **all 6 cross-checks**: `crossCheckPayments`, `crossCheckInstallments`, `crossCheckBalanceSum`, `crossCheckInstallmentPayments`, `crossCheckClearedBalance`, `crossCheckParentCredit`. "A reconciler that runs only 3 is broken." (Desktop currently runs 4 — BUSINESS-001.)

## 7. Payments & lifecycle

- Payment statuses: `pending, partial, paid, overdue, refunded, cancelled, pending_clearance, unpaid`.
- Terminal states `refunded` and `cancelled` are immutable; a refund cannot be un-refunded.
- Proof requirements: `method=check` ⇒ `proof_path + check_number + check_bank_name` required; `method=transfer` ⇒ `proof_path + transfer_reference` required (enforced by `enforce_payment_proof` trigger on INSERT; re-validating unchanged rows on UPDATE is a registered defect — WEAK-200).
- Collection is atomic: payment + ledger entry + waterfall updates + optional parent_credit + audit entry (canonical RPC `collect_and_allocate_payment`). Any path that writes less and reports success is a defect (BUSINESS-002/100).

## 8. Refunds (§7.2)

- Refund = **LIFO reversal** via `revert_payment_allocation`: creates compensating ledger entries and reverts installment allocations in reverse allocation order.
- A refund MUST carry the actor's identity and a meaningful reason (≥3 chars); hardcoded reasons or dropped actor identity are audit violations (BUSINESS-003, CROSS-102).
- Refunds of `refunded`/`cancelled` payments must be rejected (idempotency guard) — re-refunding creates duplicate reversals and negative `amount_paid` (BUSINESS-102).
- Refund state changes (payment status AND installment reverts) must propagate to the server so all platforms converge (CROSS-103).

## 9. Receipt numbers (§7.x) [ADR-004]

- Canonical format: `REC-YYYY-NNNNNN`, sequential per (tenant, year), generated **server-side, atomically** inside the canonical RPC (`MAX(suffix)+1`, zero-padded).
- Client-side numbering (random `PAY-YYYY-…`, per-device counters) is forbidden (DRIFT-011).

## 10. Discounts & pricing

- **CALC-001 (2026-09-12, 54th session): the canonical pricing source is the legacy workbook `Suivis clients  2026_2027.xlsx` — its RAW FORMULAS, not the retired fictional "Prices.md".** The extracted matrix lives in `src/domain/calc/pricing/school-price-matrix.ts` (desktop reference) and is pinned by the corpus suite `src/tests/domain/pricing/real-school-corpus.test.ts` (390 ETAT rows + 10 Devis quotes replayed). Key rules:
  - **FI per student, per grade** (never a flat family fee): PS/MS/GS 18 000 · CP–CM1 25 000 · CM2 30 000 · 1AAM–3AAM 25 000 · 4AAM 30 000 · 1ER/2EM 25 000 · 3EM 30 000 · AUTISTE 23 000.
  - **Scolarité per grade** (gross, FI excluded): MS 135 000 · GS 165 000 · CP 220 000 · CE1 240 000 · CE2 255 000 · CM1 265 000 · CM2 270 000 · 1AAM 305 000 · 2AAM 320 000 · 3AAM 330 000 · 4AAM 340 000 · 1ER 350 000 · 2EM 355 000 · 3EM 365 000 · AUTISTE 250 000.
  - **Tranche schedule: FI (at registration) + V2 + 2V + v3** where 2V = v3 ≈ 30% of the scolarité (fixed per class) and V2 ≈ 40% **minus the REMISE** — the remise lands on V2 ONLY (workbook S-column formulas: `=122000-J58`, `=132000-J57`, `=110000-J95`). Exact stickers per class in the matrix.
  - **Transport: 20 real towns in 6 tiers** (40 000/43 000/52 000/55 000/57 000/65 000) with the observed T1/T2/T3 splits (e.g. Zemmouri 30+15+12 = 57 000; Beni Amrane/Reghaïa/Ouled Heddadj/Lagata 30+20+15 = 65 000). The 4 legacy grouped zones remain resolvable for old data.
  - **Real services:** PSY1/PSY2, ORTH1/ORTH2, E-PLANT, Ratrapage, AUTISTE (the ETAT's actual billable columns). The fictional canteen/uniform/books/chess catalog is retired.
- **System discount engine has exactly 2 REAL rules** (CALC-001): `sibling_fixed` (−5 000 DZD per additional child — the DEFAULT component of the negotiated remise, visible in the J-column decompositions) and `full_annual` (early annual payment: **−5% of the FRAIS DE SCOLARISATION ONLY**, FI and transport excluded — the Devis formula `=+SUM(F…)*0.05`, before June 30). The previously-mirrored `passage_palier` (−10 000), `highest_average` (−10%) and `seniority_5y` (−5%) rules NEVER EXISTED at the school and are removed from the engine (desktop + Android) and deactivated in the DB (migration 0089). Discounts apply **once, on the gross scolarité**.
- **The negotiated REMISE is a manual input** (per student), not a formula — the school's real remises are individually negotiated (HEBBAZ 3 kids = 10 000 vs KOUBA 3 kids = 41 500). It is deducted from the devis total AND from the V2 tranche. **STICKER-PRICE special case** (2 rows in the workbook, SEDIKI l5/l6): the remise is recorded but NOT subtracted from the devis (`chargeStickerPrice` flag) while V2 still absorbs it.
- Pricing tables (migration 0006 + the CALC-001 realignment 0089: per-grade FI column, real grid, 20 towns, real services, 5% rate) drive NEW quotes; installment due dates come from the official tranche schedule (Sep 15 / Dec 15 / Mar 15 pattern) unless a custom schedule is set.
- **REMISE from the Excel workbook is ALREADY NET in the DEVIS (T-105 / DATA-010, 2026-09-01):** the workbook's `DEVIS ANNUEL` (column L) formula is `components − J` (raw formulas verified 390/390: e.g. row 2 `=25000+205000+35000-J2`, row 235 `=300000-J235`) — the devis charge imported from L is the net obligation and MUST NOT be accompanied by a second "Remise sur devis" −J ledger adjustment (that double-discounted 223 parents, Σ −9,709,700 DZD — repaired by migration 0063). The remise informs only the tranche proration (`OFFICIAL_TUITION_SCHEDULE × (1 − J/annual)`), never the ledger twice. NOTE (CALC-001): for FRESH imports the proration schedule is now the REAL matrix (V2/2V/v3) — see `repository-adapter.ts buildInstallmentRows`.
- **Corpus-to-workbook invariant (T-105):** for every parent of the source workbook — `netdue (charges+adjustments) == Σ(DEVIS + DETTES − REGLEMENTS)`, `paid == TOTAL VERSEMENTS (P = FI+V2+2V+v3+1T+T2+t3)`, `balance == TOTAL*CREANCE (Q = L − P)`; and for every student — `Σ installments amount_due == the student's ledger net obligation` (C3). Verified live 259/259 × 6 (`scripts/verify_t-105.sql`); the importer enforces the same shapes on fresh imports (`buildInstallmentRows` C3 reconciliation).

## 11. Audit trail (§7.6)

- **Every mutation MUST emit at least one audit entry** with `{action, entityType, entityId, actorId, actorRole, before, after}`; actions come from the canonical `AuditActions` registry (desktop `src/core/audit-actions.ts`, Android mirror `AuditActions.kt`).
- Audit-log write failures must NOT be silently swallowed (SEC-001).
- Actor identity and tenant must be the real session's, never hardcoded demo values (WEAK-011).

## 12. Tenant isolation

- Every financial row carries `tenant_id`; every query path filters by the caller's tenant; RPCs verify `p_tenant_id` against the payment/parent's actual tenant (violations registered: SEC-111, SEC-112, TENANT-*).

## 13. Synchronization semantics

- Sync pushes are idempotent upserts keyed by deterministic identity; a push must either succeed observably or stay queued — never report success for a rejected write (CROSS-200).
- Offline collections captured locally must eventually produce **the same server-side state** as an online collection through the canonical path (TARGET — ADR-005).

## 14. Parent billing breakdown — the itemized read-side derivation (T-164/166/167, 2026-09-05)

- The "Prestations facturées / Décomposition du prix" surfaces (desktop parent-drawer Finances tab, website portal `Facturation` tab, Android `ParentDetailScreen` card) are derived by ONE canonical engine per platform — never re-implemented in a component: desktop `domain/calc/payment/billing-breakdown.ts` (reference), website `src/lib/canonical/billing-breakdown.ts` (read-side port), Android `core/BillingBreakdown.kt` (mirror). All three are pinned by the same test vectors (the 285 000 DZD / 125 000 DZD headline: T1 114 000 paid, T2 85 500 with 11 000 → 74 500 remaining, T3 85 500 untouched, Σ remaining 160 000).
- **REAL installment rows are authoritative** (ADR-002): their `amount_paid`/`amount_pending` come from the server waterfall (`collect_and_allocate_payment`); clients render them verbatim and MUST NOT re-allocate. Attribution: per-student via `student_id`; single-child families inherit family-scoped rows/charges (legacy import shape).
- **The 40/30/30 synthesis is a display-only LAST resort**, used solely when a child has charges but zero physical tranche rows: amounts via `splitNetTuitionByOfficialSchedule` (exact conservation), due dates via the official Sept 15 / Dec 15 / Mar 15 calendar, and the cleared-payment coverage via ONE global `allocatePaymentToInstallments` call (chronological across ALL synthetic tranches — never child-by-child). It MUST be flagged (`isSynthetic`) and money already reflected on real rows MUST be reserved from the waterfall pool (`clearedPaid − Σ real amountPaid`) so no payment is counted as covering both a real and a synthetic tranche. The website port contains NO synthesis (read-only portal renders exactly what the server produced).
- **Adjustment diagnostics** (`describeAdjustment`) are shared wording across all three platforms: negative = "Crédit / Déduction" (remise), positive = "Débit / Majoration" (e.g. a discount reversal); blank legacy reasons render the italic system diagnostic — and since migration 0069 no NEW blank adjustment/reversal description can be written (DB CHECK: `length(btrim(description)) >= 3`).
- The billing academic year resolves in priority order: charge metadata `academicYear` → charge description regex → class placement → tenant current year → "2025-2026".

- **T-168 (2026-09-05, 27th session) — provenance + reconciliation contract (all three platforms):**
  - **Provenance classification is canonical:** every adjustments surface derives its labels from `classifyAdjustmentHistory` / `classifyAdjustmentRows` (TS) / `classifyAdjustmentHistory` (Kotlin) — never re-implemented in a component. Three classes with identical FR wording everywhere: `documented` (actual operator content — "Contenu réel…"), `reversal_pair` (a detected net-zero +X/−X counter-pass — "Contrepassation… Effet net sur le solde : nul"), `undocumented` (legacy blank row — "Non documenté… à auditer"). Pairing algorithm is frozen: chronological order (at, then id), FIFO pool per |amount|, opposite-sign matching ONLY (two same-sign entries never pair), zero amounts skip, caller's list order preserved.
  - **Reconciliation equation (INV-12):** every billing surface can explain the balance it shows: `grossBilled − adjustmentsCredit + adjustmentsDebit = netDue`; `netDue − clearedPaid − pendingPaid = derivedRemaining`; `derivedRemaining + bridge = serverOutstanding`. The `bridge` (shown only when |bridge| > 1) absorbs refunds/reversal-chains/legacy conventions and MUST be displayed when non-trivial — a surface is NOT allowed to show a server number with no derivation or a derivation that silently disagrees with the server balance.
  - **Itemization conservation (INV-13):** the itemized shopping list is exhaustive — `Σ byChild.billedTotal + unattributedTotal === totalBilled` (single-child families own their family-level rows; multi-child families list them in the explicit "Famille" block). No charge row may be rendered nowhere (DATA-015).
  - **Share-percentage parity (PARITY-001):** display ratios in mirrors MUST round identically to the TS reference (`Math.round(x*100)`); Kotlin integer division truncates (90 000/700 000 → 12 vs 13) and is forbidden for cross-platform figures.
  - **`sumPendingPayments`** (status-strict, mirrors `sumPaidPayments`) is the only sanctioned way to sum uncleared cheque/transfer money for the reconciliation footer.

## 15. Cross-year debt aging & payment-behavior status (T-405, 2026-09-22)

T-405 adds a canonical **debt-aging / payment-behavior status** derivation on TOP of the existing finance system. It creates NO new ledger, NO new balance formula, NO new payment history — every input is an existing canonical fact:

- **Outstanding per obligation** = the INV-4 family formula on REAL installment rows: `clampNonNegative(amount_due − amount_paid − amount_pending)` — the SAME number the Créances tab (`DebtRepository.observeSummary`) and the billing surfaces show. A parent's `outstandingAmount` = Σ remaining over their unpaid installments. Debt Aging MUST NOT show a different amount than the Finance tab.
- **Original due date** = the installment's `due_date`. **Debt age** is measured from the OLDEST outstanding obligation's due date (INV-4 basis: from the due date, never the charge creation date) and is **NEVER reset by a partial payment** — age is a property of the obligation, not of the balance.
- **Payment behavior** = the parent's non-reversed `payment` ledger entries (the same replay source as `computeParentSummary.totalPaid`). **Last payment** = MAX(`at`) over those entries. **Inactivity** = days since the last payment; a parent who has NEVER paid has inactivity measured from the oldest outstanding obligation's due date (the obligation has sat unpaid its whole life). Inactivity is clamped to the debt age only in the never-paid case (they are equal by construction there).
- **Origin academic year** (INV-14): attributed from the obligation's due date — if the date falls inside a known `academic_years` row's `[start_date, end_date]` for the tenant, that year's label is used; otherwise the Algerian school-year calendar convention applies (a date in July–December belongs to the `YYYY-(YYYY+1)` year, January–June to the `(YYYY-1)-YYYY` year). Historical due dates MUST keep their original year attribution — a later payment never rewrites the origin year.
- **Subsequent-year payment activity** (INV-15): a payment counts as "subsequent-year activity" when its `at` falls in an academic year STRICTLY LATER than the origin year of the parent's oldest outstanding obligation. This fact is REPORTED (count + total) and used in the status explanation; it is what separates "old debt + kept paying" from "old debt + stopped paying".

### 15.1 The canonical status levels (INV-16)

The status is an ordered evaluation over three factors — `outstandingAmount`, `debtAgeDays` (from the oldest outstanding due date), and `inactivityDays` — using ONLY thresholds that already exist as canonical boundaries (the aging-bucket edges 60/90/180 days from `AgingBucket`, and the 90-day delinquency convention behind `lockDelinquentAccounts`):

1. `outstandingAmount ≤ 0.001 DZD` → **GREEN** *(Soldé — the debt is resolved; INV-4 epsilon).*
2. `inactivityDays ≤ 60` → **GREEN** *(Actif — a payment landed within the last 60 days: the parent is still paying despite the outstanding balance; an old balance with continued payment is NOT delinquency).*
3. `debtAgeDays > 180 AND inactivityDays > 180` → **RED** *(Critique — long-standing debt combined with prolonged non-payment: both the obligation and the silence are older than the 180-plus aging bucket).*
4. `debtAgeDays > 90 AND inactivityDays > 60` → **ORANGE** *(Retard soutenu — the debt is older than the 90-day delinquency threshold AND payment has stopped: sustained delinquency requiring attention).*
5. otherwise → **YELLOW** *(À surveiller — the account is becoming behind or inactive: a young debt without recent payment, or payment that stopped within the debt's first 90 days).*

Invariants:

- **INV-16a (order matters):** the rules are evaluated top-down; rule 2 dominates rules 3–5 (a parent who paid 30 days ago is GREEN even with a 2-year-old balance).
- **INV-16b (never-paid parents):** `inactivityDays` defaults to `debtAgeDays`, so a never-payer reaches RED exactly when their debt passes 180 days.
- **INV-16c (no amount tiers):** the status is a payment-behavior classification, not a magnitude ranking — the amount is displayed, never a status input (beyond the 0.001 epsilon). No page may add amount-based status overrides.
- **INV-16d (explanation is part of the contract):** every computed status carries the derived factors (age, inactivity, last payment, subsequent-year activity, origin year) and a canonical reason string, so a UI can never show a bare color.
- **INV-16e (recency, not count):** "continued paying" is measured by the LAST payment's recency — not by the number or total of payments. A single recent payment qualifies; many stale ones do not.

### 15.2 Where the calculation lives

One canonical calculation, mirrored per the established pattern (reference TS + SQL mirror + platform ports):

- **Reference implementation:** desktop `src/domain/calc/ledger/debt-aging.ts` (`computeDebtAgingAnalysis` + `computeDebtAgingStatus`), pure and deterministic, pinned by unit fixtures that reproduce the task's two archetype parents.
- **SQL mirror:** migration 0111 `compute_debt_aging_summary(p_tenant_id, p_as_of)` — computes the same fields server-side from `installments` + `ledger_entries` + `academic_years` so statistics, reports, and the portal consume one server contract.
- **Platform consumers** (Desktop UI, Website portal, future Android mirror, dashboards, search/filter, exports) render the same fields and labels — Green/Yellow/Orange/Red are PRESENTATION of this one calculation; page-local thresholds, color rules, or debt recomputations are a registered defect class (the DUP family).

### 15.3 Status labels (FR, canonical wording)

GREEN = « Actif / Soldé » · YELLOW = « À surveiller » · ORANGE = « Retard soutenu » · RED = « Critique » — identical wording on every surface that shows a debt status.

## 16. Personnel payroll cash-flow forecast & pre-payroll funding requirements (T-412 / ADR-024, 2026-09-25)

T-412 adds the canonical **payroll forecast** — a READ-SIDE projection over the existing payroll facts (`personnel` + `salary_payments`, the T-369 persistence surface). It creates NO new tables, NO new ledger semantics, NO waterfall interaction: `salary_payments` stays OUT of `ledger_entries` and the historical "Flux Net Opérationnel (hors masse salariale)" basis is UNCHANGED (the T-411/FA-08 label is preserved — moving payroll into the ledger basis remains a separate owner decision requiring its own ADR + migration + equivalence run).

**The ONE canonical calculation** is `src/domain/calc/payroll/payroll-forecast.ts` (`computePayrollForecast`) — every surface (Personnel's « Paiements du Personnel à Venir », Finance's pre-payroll funding card, Statistics' monthly/quarterly trend) is a CONSUMER of its output; page-local forecast math is a registered defect class (§15.53a). The parity suite `src/tests/domain/calc/t-412-cross-page-parity.test.ts` pins the three views to identical values from identical inputs.

### 16.1 The semantic vocabulary (binding, FR labels included)

- **Vague de paie (payroll wave)** — one monthly payroll period `YYYY-MM`. The "current" period derives in **Africa/Algiers** (the Payroll tab's selector convention).
- **Eligibility (the PayrollManagement basis, reused)** — `status = "active"` AND `salary > 0` AND hired on/before the period's last day AND not terminated before the period's first day. The forecast's current-period expected payroll therefore EQUALS the Payroll tab's « Masse Salariale » KPI (same basis by construction). Note: `on_leave` staff are NOT on this basis (the tab's KPI excludes them) — including them is an owner decision, not a silent change.
- **Masse salariale attendue (expected payroll)** — Σ current base salaries of the eligible staff. Future one-off bonuses/deductions are unknowable before their `salary_adjustments` rows exist — the projection is CURRENT-salary-only, and every surface renders that limitation.
- **Date de paiement canonique (canonical payment date)** — the LAST CALENDAR DAY of the period month (leap-safe). Actual `salary_payments.payment_date` overrides it for historical evidence.
- **Fonds requis (required cash)** — the expected payroll that must be available before the payment date.
- **Fonds sécurisés (secured/reserved)** — Σ `net_paid` of the period's `paid` + `pending` disbursement rows (committed funds; a pending bank transfer is reserved but not yet an actual outflow).
- **Besoin de financement restant (remaining funding requirement)** — `max(0, expected − secured)`. This is THE "required funds before each payroll date" figure (full expected for future waves — nothing is secured yet).
- **Disponibilité (readiness)** — `settled` (secured ≥ expected) / `partial` (0 < secured < expected) / `unfunded` (secured = 0 AND the canonical date has passed) / `upcoming` (secured = 0, date ahead).

### 16.2 Invariants

- **INV-17a (one engine):** Personnel, Finance and Statistics derive their payroll-forecast figures from the SAME `computePayrollForecast` output object; the Finance treasury block is a VERBATIM pass-through of the totals (the only derived value is `coverage30d` = `round(expectedInflow30d / requiredCash30d × 100)`, a presentation of two canonical numbers against each other — the inflow figure itself is NOT modified).
- **INV-17b (real data only):** historical waves carry ACTUALS from `salary_payments` (no anachronistic projection onto past rosters); months without recorded disbursements read as 0 in the trend; empty inputs → empty outputs → honest empty states (§15.49a).
- **INV-17c (the overdue carry-over):** periods between the LAST RECORDED disbursement and the current period surface as phase `overdue` (readiness `unfunded`) — a missed payroll is never silently dropped. Guards: requires existing disbursement history (a fresh install fabricates nothing), capped by the history window (default 12 months), per-period eligibility. The amount is the today's-roster projection (the documented limitation applies).
- **INV-17d (reactive restatement):** the forecast is a pure function of the two canonical streams — personnel/salary/status/schedule changes restate every consumer automatically.
- **INV-17e (mid-month hires):** a hire landing on/before a period's last day is owed that FULL period (the tab's budget does not prorate — neither does the forecast); a termination removes the person from every period starting AFTER the termination date.
