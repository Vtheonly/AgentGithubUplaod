# Verification Report — 'Optimizing AI Context for Development — Domain.md'

**Task RPT-2 · Agent DM · Read-only investigation · Repo: `/home/z/my-project/repo` (app root: `elimtiyaz-desktop/`)**
All paths below are relative to the repo root. Line numbers come from files read during this session. No files were modified.

---

## 1. Report summary (10–15 bullets)

- **Overall verdict: the report is highly accurate.** Of ~40 significant claims checked, ~32 verified verbatim, ~6 verified with corrections/nuance, 1 detail rejected (`CYCLE_OF_GRADE` in `promotion.ts`), and 1 detail rejected (C14's assertion that `calc/ledger/index.ts` omits `debt-aging.ts`).
- The scope statement is exact: 111 files in `src/domain` (calc 64, identity 11, model 24, repository 9, root 3) — counted and confirmed.
- The **canonical financial engine** (INV-4 family, waterfall/clearance/LIFO, debt-aging thresholds, year-history replay, as-of sums) is documented faithfully; every formula, constant, and epsilon checked matches the source.
- The two headline **code defects are real**: `terms.ts currentTermWindow` misclassifies Jan 1–Mar 15 as T3 (elimtiyaz-desktop/src/domain/calc/academics/terms.ts:39-46), and `gpa.ts` calls `resolveSubjectConfiguration` without `academicLevelId`/`academicYearId` so no configuration row can ever match (elimtiyaz-desktop/src/domain/calc/academics/gpa.ts:49 vs subject-config.ts:86-92).
- The **layering violation is real** (elimtiyaz-desktop/src/domain/calc/ledger/non-tuition-charges.ts:29 imports `infrastructure/mock/pricing-seed`), but the report's blacklist recommendation is **dangerous as stated**: `buildAdditionalServiceCharge` from this same file is the canonical builder used by the *Supabase* `PaymentRepository.appendManualCharge` (supabase-shared-repositories.ts:2954-2988) and by feature tabs for price previews.
- **C1 (duplicate repository interfaces)** is real and sharper than described: implementations bind to `academic-repository.ts`'s versions, the app provider consumes `repository.ts`'s versions, and `arrivalTimes` works only because both implementations inline it beyond the interface they `implements` (supabase-academic-repository.ts:1257).
- **Repository census**: every domain interface has ≥1 implementation — but `PsychologyRepository`, `OrthophonieRepository`, `ClubRepository`, and `PerformanceReviewRepository` are **mock-only** (in Supabase mode they stay in-memory because `getSupabaseRepositories` spreads `mockRepositories` and never overrides those slots). Conversely, `SupabaseApprovalRepository` and the purge functions have **no domain interface** at all.
- The **barrels are incomplete** (C14) but the report under- and over-shoots: `calc/index.ts` omits *entire directories* (academics, timetable, workflow, diff, clubs, therapy, expense); `debt-aging` **is** exported from the ledger barrel; `model/index.ts` omits more models than listed (ledger, pricing, timetable, workforce, ai, calendar, operations-workforce).
- The report missed that the **billing/devis computation exists in 4 places**, not 2: `school-price-matrix.computeSchoolDevis`, `tuition.splitNetTuitionByOfficialSchedule` consumers, `features/crm/batch-registration/compute-billing.ts`, and `infrastructure/supabase/repositories/registration-billing-wires.ts` — with three *different* remise/tranche strategies.
- The label-parsing anti-pattern the report blacklists also lives in **infrastructure**: mock `installment-ops.ts:136` parses tranche numbers from `ins.label`.
- Dead-code claims (money-dzd, balance aliases, deprecated params, unused imports, fictional discount codes, `AcademicCycleLegacy`, `DEBT_AGING_ACTIVE_PAYER_WINDOW_DAYS`) all verified; small correction: `discount-engine`'s `grossTuition` is *not* fully ignored — it remains a fallback at discount-engine.ts:84.
- New finds beyond the report: `missing_proof` anomaly type is defined + translated but never derived anywhere; `psychology-tab.tsx:429` hardcodes a tenant ID; `void DEFAULT_CYCLE_TRANCHE_MONTHS;` dead-import silencer; `revenueByCategory` superseded.

---

## 2. Claim-by-claim verification table

| Claim | Classification | Evidence: exact file paths + line numbers | Notes |
|---|---|---|---|
| Export contained 111 files: calc 64, identity 11, model 24, repository 9, root domain 3 | **VERIFIED** | `find` counts on elimtiyaz-desktop/src/domain: 64/11/24/9/3 = 111 | Root files: `pii-mask.ts`, `kahn.ts`, `reconcile-types.ts` |
| `deriveAccountId` format `parent:{id}:category:{cat}` (+`:student:`), null category → `category:all` | **VERIFIED** | elimtiyaz-desktop/src/domain/calc/ledger/account-id.ts:23-37 (line 34: `category ?? "all"`) | ADR-023 note confirms SQL RPC parity |
| Signed-entry convention: charge>0, payment/refund −amount, reversal = −original.amount | **VERIFIED** | elimtiyaz-desktop/src/domain/calc/ledger/entries.ts:9-13, 118 (`amount: -input.amount`), 248 (`amount: -original.amount`) | Factories enforce positivity at entries.ts:54, 105, 153, 198 |
| Balances never stored; replay excludes future entries and excludes reversed ids from typed totals | **VERIFIED** | elimtiyaz-desktop/src/domain/calc/ledger/balance.ts:39-51 (as-of filter), 66-72 (`reversedIds` skip) | `displayParentCredit` convention at balance.ts:234-240 matches report §2.1 |
| INV-4: `installmentRemaining = clampNonNegative(due − paid − pending)`; settled/overdue predicates dynamic | **VERIFIED** | elimtiyaz-desktop/src/domain/calc/payment/queries.ts:37-45, 62-76, 100-119 | Aging buckets `0_30…180_plus` at queries.ts:155-161 |
| Waterfall FIFO, capacity = due−paid−pending, uncleared → `pending_clearance`, excess → unallocated | **VERIFIED** | elimtiyaz-desktop/src/domain/calc/payment/waterfall-allocator.ts:47-51 (chronological sort), 68-70 (capacity), 88-92 | Dead `"pending"` fallback branch confirmed at waterfall-allocator.ts:85-87 (unreachable: `allocate>0 ⇒ newAmountPaid>0`) |
| Clearance caps at `due − paid`, excess returns as `overflowCredit` | **VERIFIED** | elimtiyaz-desktop/src/domain/calc/payment/clearance.ts:96-98 (capacity), 113-120 (`overflowCredit`) | |
| LIFO reversal; zero-paid future-due → `"unpaid"` (ADR-033) | **VERIFIED** | elimtiyaz-desktop/src/domain/calc/payment/lifo-reversal.ts:43-49 (`reevaluateInstallmentStatus`), 51-56 (reverse-chronological) | |
| C10: `sumPendingPayments` filters `"pending"` only, while query-engine/year-history check `pending \|\| pending_clearance` | **VERIFIED** | sums.ts:74-79 vs financial-query-engine.ts:272, 423, 442, 520 and year-history.ts:517 | Divergence is real; report calls it "defensive guard" |
| As-of pair `sumPaidPaymentsAsOf` / `sumFutureRecordedPaidPayments` partition `sumPaidPayments` | **VERIFIED** | elimtiyaz-desktop/src/domain/calc/payment/sums.ts:104-146 (comment at 99-102 states the partition) | |
| Debt-aging defaults: grace 5, yellow 15, red 60, activePayerGrace 15, amountYellow 20 000, amountRed 60 000, severe 40 000; epsilon 0.001; removed 60-day window const | **VERIFIED** | elimtiyaz-desktop/src/domain/calc/ledger/debt-aging.ts:107-119, 130, 121-127 | `DEBT_AGING_ACTIVE_PAYER_WINDOW_DAYS = 60` retained as historical reference only |
| INV-18a attribution: persisted `academicYearId` precedence + `resolveAcademicYearForDate` fallback | **VERIFIED** | debt-aging.ts:293 (`resolveAcademicYearForDate`), 353 (`attributeInstallmentAcademicYear`), 377 (`attributePaymentAcademicYear`) | |
| year-history re-declares epsilon + `inv4Remaining` (duplication of debt-aging/queries) | **VERIFIED** | elimtiyaz-desktop/src/domain/calc/ledger/year-history.ts:61 (`YEAR_HISTORY_EPSILON_DZD = 0.001`), 370 (`function inv4Remaining`) | |
| C9: `currentTermWindow` returns T3 for `month < 8`, misclassifying Jan 1–Mar 15 | **VERIFIED** | elimtiyaz-desktop/src/domain/calc/academics/terms.ts:39-46 — docstring (lines 5-7) says T2 = Dec 16–Mar 15, but `if (month < 8)` (Jan–Aug) unconditionally returns T3 | Real bug; only consumed via `supabase-academic-repository.ts:78` |
| C4: `gpa.ts` omits `academicLevelId`/`academicYearId` when resolving configurations → silent legacy fallback | **VERIFIED** | gpa.ts:49 `resolveSubjectConfiguration({ subject, configurations })` vs subject-config.ts:86-92 requiring `c.academicLevelId === input.academicLevelId && c.academicYearId === input.academicYearId` | With `undefined` inputs no row can match; falls to layer 3 |
| C5: 5% scolarité-only is real; 10% claims live in docstrings | **VERIFIED** | discount-rules.ts:41 (`EARLY_ANNUAL_RATE = 0.05`), school-price-matrix.ts:231-236; 10% at model/pricing.ts:29-30, model/payment.ts:91, model/student.ts:344 | |
| C6: `non-tuition-charges.ts` imports `infrastructure/mock/pricing-seed` inside domain | **VERIFIED (with correction)** | non-tuition-charges.ts:29 | Correction: `buildAdditionalServiceCharge` (lines 179-226) rejects fictional codes (throws at 206-208) and is the canonical path for Supabase `appendManualCharge` (supabase-shared-repositories.ts:2968-2988). Only club/therapy builders carry fictional prices (CLUB_CATEGORY_PRICE, lines 50-57) |
| C7: flat family FI vs per-grade FI coexist | **VERIFIED** | model/pricing.ts:163 (`registrationFee`) + 169 (`registrationFeeByGrade`); webhook-diagnostics.ts:210-213 models both; school-price-matrix.ts:41-56 per-student FI | |
| C8: two tranche strategies (remise-on-V2 vs 40/30/30 net split) + legacy month maps | **VERIFIED (extended)** | school-price-matrix.ts:315-333 (`v2 = max(0, v2 - remise)`) vs tuition.ts:105-112; DEFAULT_CYCLE_TRANCHE_MONTHS cem `[9,12,4]`/lycee `[9,1,5]` at model/payment.ts:306-311 | Extension: two MORE devis engines exist outside domain (see §3) |
| C11: `service-pricing-profile.ts` label-parses tranche numbers, hardcodes 2026-06-30 deadline, sums adjustments without `reversesId` exclusion | **VERIFIED** | service-pricing-profile.ts:319 (`trancheNumberFromLabel`), 593 (use), 658 (`EARLY_PAYMENT_DEADLINE = "2026-06-30"`), 353-354 (`adjustmentRows` filter has no `reversesId` check) | Contrast balance.ts:66-72 |
| C12: `crossCheckInstallments` matches PK only; `crossCheckPayments` Map overwrites duplicates; webhook-diagnostics resolves reg- identities | **VERIFIED** | cross-checks.ts:96-103 (`ledgerBySourceId.get(inst.id)`), 42-45 (`Map.set` overwrite); webhook-diagnostics.ts:26-30, 460-490 | |
| C13: three promotion entry points; class-placement computes GPA inline via legacy Subject columns | **VERIFIED** | repository.ts:245 (`StudentRepository.promote` — only tests call it), academic-repository.ts:199-206 (`PromotionRepository`), 372-408 (`PromotionCycleRepository`); class-placement.ts:399-414 (inline `a.coefficient \|\| 1`, `subjects.find(...)?.isExtracurricular`) | class-placement does reuse `computeOverallGpa` (line 49) but with legacy-column mapping |
| C14: barrels omit critical modules | **CORRECTED** | calc/index.ts:25-30 exports only shared/ledger/payment/payroll/pricing/reconc (omits academics, timetable, workflow, diff, clubs, therapy, expense — whole dirs); calc/payment/index.ts:24-30 omits tranche-waves, webhook-diagnostics, **and** financial-query-engine + service-pricing-profile; model/index.ts:15-90 omits ledger, pricing, timetable, workflow, filiere, promotion-cycle, re-enrollment, workforce, ai, calendar, operations-workforce | Correction: `calc/ledger/index.ts:23` **does** export `./debt-aging` (report said it was omitted). What ledger barrel actually omits: `year-history.ts`, `non-tuition-charges.ts` |
| C15: `ExpenseAnomalySignal` duplicates `AnomalySignal`, missing `"missing_proof"` | **VERIFIED** | model/ai.ts:158-162 (4 variants incl. missing_proof) vs calc/expense/anomaly-signals.ts:34-38 (3 variants) | See §3: `missing_proof` is never derived anywhere |
| C16: `TaskRepository.observeByAssignee` takes `user_profiles.id`, not `Personnel.id` | **VERIFIED** | workforce-repository.ts:80-87 (docblock: "the argument is the ACCOUNT id (user_profiles.id)… legacy parameter NAME kept") | |
| Unused: `money-dzd.ts` zero callers | **VERIFIED** | Only reference outside the file: tests/domain/shared/money-dzd.test.ts:8; not exported by calc/shared/index.ts:7-8 | Effectively dead in production code |
| Unused aliases `replayParentLedger`, `balanceForAccount`, `totalOutstandingAcrossAccounts` | **VERIFIED** | balance.ts:249-286; only tests/domain/calc/phase2-modules.test.ts:12 uses the first two; `totalOutstandingAcrossAccounts` has zero callers anywhere | |
| Deprecated/ignored params: charges `discounts`; discount-engine `previousGradeLevel/previousRank/enrollmentDate/academicYearStart` | **VERIFIED (one correction)** | charges.ts:82-83 (`@deprecated… Ignored`); discount-engine.ts:49, 55, 61-63, 113-114 | Correction: `grossTuition` (line 49) is NOT ignored — still consumed as fallback at discount-engine.ts:84 |
| Unused imports: `PromotionRepository` (repository.ts), salary types (workforce-repository.ts), `GradeLevel/AcademicCycle/AcademicTerm` (teacher.ts), `computeSubjectAverage` (gpa.ts) | **VERIFIED** | repository.ts:85 (import only, no other occurrence); workforce-repository.ts:32-35 (no other occurrence); model/teacher.ts:37-38 (no other occurrence); gpa.ts:6 (only `computeSubjectAverageFromRecipe` used at line 53) | |
| Fictional discount codes retained in union for legacy DB compat; `ADMIN_PALETTE_HIDDEN_SUBTYPES`; `AcademicCycleLegacy` | **VERIFIED** | model/pricing.ts:66-74 (union), 78-86 (labels marked "RÈGLE FICTIVE"); model/workflow.ts:351-353; model/payment.ts:279 | |
| C2: Mon–Fri legacy teacher timetable vs Sun–Thu canonical timetable | **VERIFIED** | model/teacher.ts:135-139 (`SchoolDay = "monday"…"friday"`, comment "Saturday and Sunday are excluded") vs calc/timetable/algerian-profile.ts:29-39 (`"sunday"…"thursday"`, S1…) | Legacy stack used only by mock teacher-repository (see §5) |
| C3: Teacher-ID space ambiguity (`Teacher.id` vs `Personnel.id`) unresolved in domain | **VERIFIED** | model/teacher.ts:16-18 ("Schedules… reference a Teacher"); calc/teacher/validation.ts:255 ("référence l'entité Teacher") vs model/timetable.ts:228-229 (`entityId` = "class / personnel / room id") and fixture.ts:41 ("Teachers (personnel references)") | Still unresolved without reading migration 0113 FKs |
| Identity pipeline constants: saturation 50, bands 0.92/0.80/0.60, density 0.75, deterministic gate 0.85, 4 blocking passes, synthesis tiers | **VERIFIED** | identity/types.ts:311-331, 338; identity/blocking.ts:15-26 (P1 phone, P2 token-pair, P3 phonetic, P4 initial); identity/engine.ts:4-5; identity/synthesis.ts:33-40, 95 (`SET_UNION`); identity/clustering.ts:81-84; identity/repository.ts:127, 147, 154 (`decideProposal`/`mergeParents`/`unmergeParents`) | Vetoes at identity/vetoes.ts:18, 51, 58, 70 |
| Payroll forecast rules (Africa/Algiers, eligibility, secured = paid+pending, overdue carry-over) | **VERIFIED** | payroll-forecast.ts:90, 281-291, 301-304, 322-336 | |
| Workflow: Kahn guard, and/or/not evaluator, `sourceHandle` true/false dry-run, 20px auto-layout, 3 templates | **VERIFIED** | kahn.ts:46; condition-evaluator.ts:18, 162-166, 185; dry-run.ts:197-222, 284, 377-382; auto-layout.ts:21 (`LAYOUT_GRID = 20`); templates.ts:288-292 (exactly 3) | |
| PII mask order IBAN → phone → email → NN → parent/student names | **VERIFIED** | pii-mask.ts:30 (docstring), 163-166 (actual call order) | |
| Backup: AES-256-GCM, 100 000 PBKDF2, 12-byte IV, 365-day retention | **VERIFIED** | model/backup.ts:62 (`BACKUP_RETENTION_DAYS = 365`), 68 (`100_000`), 71 (`12`) | |
| `DEFAULT_AI_PROVIDER_CONFIG`: Groq `openai/gpt-oss-120b` default/reasoning, `openai/gpt-oss-20b` fast/fallback | **VERIFIED** | model/ai.ts:226-229 | |
| Expense anomaly thresholds: duplicate ±100 DA/48h, new_vendor, budget_overrun ≥3× with ≥3 samples | **VERIFIED** | calc/expense/anomaly-signals.ts:26-32, 40-70 | |
| `CYCLE_OF_GRADE` re-derived manually in `promotion.ts` and `service-pricing-profile.ts` | **REJECTED (half)** | `CYCLE_OF_GRADE` exists only in service-pricing-profile.ts:193-208. promotion.ts has no such map; it hardcodes per-grade cycle transitions inside `getNextGradeProgression` (promotion.ts:47-80) — cycle-from-grade duplication in spirit, not the named map | |
| 5 separate FR category-label maps incl. inline map in financial-query-engine | **VERIFIED** | model/payment.ts:393 (`PAYMENT_CATEGORY_LABELS_FR`), billing-breakdown.ts:732 (`SERVICE_LABELS_FR`), service-pricing-profile.ts:211 (`SERVICE_LABEL_FR`), financial-query-engine.ts:399-405 (inline `categories` array), year-history.ts:82 (`YEAR_SERVICE_GROUP_LABELS_FR`); `paymentCategoryLabelFr` null → "Multi-services" at model/payment.ts:414-417 | |
| `periodMinutes` privately re-implemented in constraints/feasibility/class-reports | **VERIFIED (extended)** | constraints.ts:563 (`periodMinutesSafe`); feasibility.ts:248 (`endMinutes - startMinutes`); class-reports.ts:242-244 | Missed 4th copy: greedy-solver.ts:353 |
| Pricing matrix values (FI 18k/25k/30k/23k-autiste; tuition 135k–365k, autiste 250k; transport 40k–65k; service codes) | **VERIFIED** | school-price-matrix.ts:41-59, 99-138, 157-190, 202-210 | 40/30/30 splits confirmed in the tuition table |
| Official due dates Sept 15/Dec 15/Mar 15; transport autres fallback | **VERIFIED** | tuition.ts:59-71; transport.ts:106-112 (`TOWN_ALIASES[s] ?? "autres"`), 130 | |
| Tranche waves: official numbers 1\|2\|3 only; 0=fi, null=unnumbered, out-of-range non-wave; `gracePeriodDays` for overdue family counts | **VERIFIED** | tranche-waves.ts:357, 530-532, 340-349, 386 | |
| `StudentRepository.promote` is legacy (authoritative = PromotionCycleRepository flow) | **VERIFIED** | repository.ts:245; grep for `.promote(` shows only test callers (tests/infrastructure/t-041-promotion-flow.test.ts:350 etc.) | |

---

## 3. Missed discoveries in the Domain area (with file paths + line numbers)

1. **SupabaseApprovalRepository has no domain interface.** elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-approval-repository.ts:92 (`export class SupabaseApprovalRepository {` — no `implements`). It is bolted onto the repository composite via `Object.assign` and a cast type `RepositoriesWithApprovals` (supabase-repositories.ts:488-504), consumed by features/settings/approvals-tab.tsx:112. Account-approval business logic lives outside `domain/repository/*`.
2. **Purge operations have no repository contract at all.** elimtiyaz-desktop/src/infrastructure/supabase/repositories/supabase-purge-repository.ts:135 (`dryRunPurge`) and :144 (`executePurge`) are free functions consumed directly by features/settings/danger-zone-card.tsx:44-45, 151, 169 — a tenant-purge business flow with no `Repositories` slot and no domain interface.
3. **Four repositories are mock-only and silently remain mocks in live/Supabase mode:** `PsychologyRepository`, `OrthophonieRepository` (domain/repository/therapy-repository.ts; only implementations: infrastructure/mock/repositories/therapy-repository.ts:75, 476), `ClubRepository` (domain/repository/club-repository.ts; mock club-repository.ts:44), and `PerformanceReviewRepository` (workforce-repository.ts:210; mock workforce/index.ts:1058). `getSupabaseRepositories` builds on `...mockRepositories` (supabase-repositories.ts:423-424) and its override list (lines 425-486) never overrides psychology/orthophonie/clubs/performanceReviews — the comment at 483-485 admits "Other repositories remain on the mock layer for now."
4. **A third and fourth devis/billing engine exist outside domain (extends C8):** features/crm/batch-registration/compute-billing.ts:49+ (`computeBilling` — FI-first, remise on V2 only, sticker T2/T3) and infrastructure/supabase/repositories/registration-billing-wires.ts:95 (`buildRegistrationBillingWires` — remise subtracted from annual net then 40/30/30 split via `splitNetTuitionByOfficialSchedule`, lines 141-147). Together with `computeSchoolDevis` and `tuition.ts`, four client-side tranche strategies coexist.
5. **Label-parsing anti-pattern in infrastructure:** infrastructure/mock/repositories/financial/installment-ops.ts:136 parses the tranche number from `ins.label` (`ins.label.startsWith("Tranche ") ? parseInt(ins.label.slice(8), 10) : 1`) — the exact pattern the report blacklists for `trancheNumber`.
6. **`calc/index.ts` omits entire directories** (academics, timetable, workflow, diff, clubs, therapy, expense) — calc/index.ts:25-30. Any consumer importing from `@/domain/calc` cannot reach ~28 of the 64 calc files; report only listed individual files.
7. **`calc/payment/index.ts` also omits `financial-query-engine.ts` and `service-pricing-profile.ts`** (index.ts:24-30) in addition to the report's `tranche-waves.ts` and `webhook-diagnostics.ts`.
8. **`model/index.ts` omits more models than reported:** ledger.ts, pricing.ts, timetable.ts, workforce.ts, ai.ts, calendar.ts, operations-workforce.ts are also absent (model/index.ts:15-90 exports only parent/student/academic/partial-payment/expense/personnel/operations/audit/backup/club/therapy/teacher).
9. **`missing_proof` anomaly type is dead:** defined in model/ai.ts:160 and translated in i18n (fr.ts:215, en.ts:219, ar.ts:219) but `deriveExpenseAnomalySignals` (anomaly-signals.ts:34-38) never emits it and nothing else derives it — the C15 "merge" should note one side is a phantom variant.
10. **Hardcoded tenant ID in a feature using a domain builder:** features/academics/therapy/psychology-tab.tsx:429 passes `tenantId: "tenant-el-imtiyaz-oran-001"` into `buildTherapyCharge` (preview-only, `sourceId: preview-…` at line 435) — brittle for multi-tenant deployments.
11. **Dead-import silencer:** installment-ops.ts:162 `void DEFAULT_CYCLE_TRANCHE_MONTHS;` — the legacy cycle-month map is imported "for backward compat elsewhere" but unused in that module.
12. **`revenueByCategory` appears superseded:** calc/payment/revenue.ts exports it, but the only non-test consumer found is `monthlyRevenue` in features/financials/financials-page.tsx:55, 265; tests/features/dashboard/t-355-t-356-departments-bucket-parity.test.tsx:10 states the `DashboardRepository.revenueByCategory` breakdown is superseded.
13. **C1 is sharper than reported:** the mock and Supabase academic repositories `implements` the `academic-repository.ts` interfaces (mock academic-repository.ts:1-12; supabase-academic-repository.ts:60-73), while the central provider types those slots from `repository.ts` (app/providers/repository-provider.tsx:10-37). `arrivalTimes` functions at runtime only because both implementations re-declare it inline beyond their interface (supabase-academic-repository.ts:1257, 1292; mock academic-repository.ts:551, 574) — the interface split is masked by TypeScript structural assignability.
14. **Legacy teacher-timetable stack is even deader than claimed:** calc/teacher/validation.ts is imported only by infrastructure/mock/repositories/teacher-repository.ts (grep: single non-test consumer); the Supabase teacher repository does not use it, and no feature imports it.
15. **`buildAdditionalServiceCharge` throws on unpriced codes** (non-tuition-charges.ts:206-208) — the fictional canteen/uniform/books qualifiers cannot be billed anymore; the report's "fictional … logic" blacklist item overstates what remains executable (only club prices + therapy forfaits at lines 50-57, 121-127).

---

## 4. Repository interface vs implementation census

Legend: interface file → implementing file(s) → consumers. "S" = Supabase impl, "M" = mock impl. Central consumer for nearly all: `app/providers/repository-provider.tsx` (the `Repositories` context used by features via `useRepositories()`).

**elimtiyaz-desktop/src/domain/repository/repository.ts** (26 interfaces + `Observable`)
- `AuthRepository` → S: supabase-auth-repository.ts:62 · M: mock auth-repository.ts → provider, login flow
- `UserAccountRepository` → S: supabase-user-account-repository.ts:70 · M: mock user-account-repository.ts → settings/users
- `ParentRepository` → S: supabase-shared-repositories.ts:1176 · M: mock parent-repository.ts → CRM
- `StudentRepository` → S: supabase-shared-repositories.ts:1483 · M: mock student-repository.ts → CRM (incl. legacy `promote`, repository.ts:245 — no production caller)
- `PaymentRepository` → S: supabase-shared-repositories.ts:2287 (incl. `appendManualCharge` :2954) · M: mock financial-repository.ts → Financials/CRM
- `InstallmentRepository` → S: supabase-shared-repositories.ts:3542 · M: mock financial/installment-ops.ts → Financials
- `DebtRepository` → S: supabase-shared-repositories.ts:4588 · M: mock financial/debt-ops.ts → Financials/dashboard
- `LedgerRepository` → S: supabase-shared-repositories.ts:3023 · M: mock ledger-repository.ts → Financials
- `DashboardRepository` → S: supabase-dashboard-repository.ts:36 · M: mock dashboard-repository.ts → Dashboard
- `PricingRepository` → S: supabase-pricing-repository.ts:403 · M: mock pricing-repository.ts → Settings/financials
- `ExpenseRepository` → S: supabase-expense-repository.ts:259 · M: mock financial/expense-ops.ts → Financials/expenses
- `PersonnelRepository` → S: supabase-personnel-repository.ts:411 · M: mock personnel-audit-repository.ts:47 → Personnel
- `ReleveRepository` → S: supabase-releve-repository.ts:193 · M: mock personnel-audit-repository.ts:279 → Workforce
- `AuditRepository` → S: supabase-audit-log-repository.ts:171 · M: mock personnel-audit-repository.ts:329 → Audit surfaces
- `NotificationRepository` → S: supabase-notification-repository.ts:117 · M: mock notification-alerts-repository.ts:27 → topbar/toasts
- `WorkflowRepository` / `WorkflowRunRepository` → S: supabase-workflow-repository.ts:218 / supabase-workflow-run-repository.ts:52 · M: mock workflow-repository.ts → Workflow feature
- `BackupRepository` → S: supabase-backup-repository.ts:111 · M: mock backup-repository.ts → Settings backup tab
- `AIConfigRepository` / `LLMAdapter` → M: mock ai-config-repository.ts; S-side AI config in infrastructure/ai/* → AI settings
- `CalendarRepository` → S: supabase-calendar-repository.ts:432 · M: mock calendar-repository.ts → Dashboard calendar
- `OverdueAlertGenerator` → S: supabase-overdue-alert-generator.ts:116 · M: mock notification-alerts-repository.ts:150 → alerts
- **Duplicate set (C1)** `ClassRepository`/`SubjectRepository`/`GradeRepository`/`AttendanceRepository`/`HomeworkRepository` — ALSO declared in academic-repository.ts; implementations bind to the **academic-repository.ts** versions while the provider types them from repository.ts

**elimtiyaz-desktop/src/domain/repository/academic-repository.ts**
- `AcademicYearRepository` → S: supabase-academic-repository.ts:88 · M: mock academic-year-repository.ts
- `AcademicLevelRepository` → S: supabase-academic-repository.ts:285 · M: mock academic-level-repository.ts
- `ClassRepository`/`SubjectRepository`/`GradeRepository`/`AttendanceRepository`/`HomeworkRepository` → S: supabase-academic-repository.ts:325/536/867/1096/1533 · M: mock academic-repository.ts:62…
- `PromotionRepository` → S: supabase-academic-repository.ts:1680 · M: mock academic-repository.ts
- `StudentNarrativeRepository` → S: supabase-student-narrative-repository.ts:54 · M: mock student-narrative-repository.ts
- `ClassPlacementRepository` → S: supabase-academic-repository.ts:1767 · M: mock academic-repository.ts
- `PromotionCycleRepository` → S: supabase-academic-repository.ts:2246 · M: mock academic-repository.ts (wired late: supabase-repositories.ts:445-453)
- `ReEnrollmentRepository` → S: supabase-academic-repository.ts:2479 · M: mock re-enrollment-repository.ts

**elimtiyaz-desktop/src/domain/repository/timetable-repository.ts**
- `TimetableRepository` → S: supabase-timetable-repository.ts:197 · M: mock timetable-repository.ts

**elimtiyaz-desktop/src/domain/repository/teacher-repository.ts**
- `TeacherRepository` → S: supabase-teacher-repository.ts:91 · M: mock teacher-repository.ts

**elimtiyaz-desktop/src/domain/repository/workforce-repository.ts**
- `DepartmentRepository` → S: supabase-personnel-repository.ts:774 · M: mock workforce/index.ts
- `ShiftRepository` / `ScheduleRepository` → S: supabase-shift-schedule-repositories.ts:128/260 · M: mock workforce/index.ts
- `TaskRepository` → S: supabase-task-repository.ts:194 · M: mock workforce/index.ts
- `AttendanceRepository` (staff) → S: supabase-workforce-attendance-repository.ts:195 · M: mock workforce/index.ts
- `LeaveRequestRepository` → S: supabase-leave-request-repository.ts:143 · M: mock workforce/index.ts
- `PerformanceReviewRepository` → **M only** (mock workforce/index.ts:1058) — no Supabase impl
- `ChatRepository` → S: supabase-chat-repository.ts:134 · M: mock workforce/index.ts
- `OnboardingRepository` → S: supabase-onboarding-repository.ts:116 · M: mock workforce/index.ts

**elimtiyaz-desktop/src/domain/repository/operations-repository.ts**
- `SupplierRepository` → S: supabase-supplier-repository.ts:124 · M: mock operations/index.ts
- `PurchaseRequestRepository` → S: supabase-purchase-request-repository.ts:166 · M: mock operations/index.ts
- `DeliveryRepository` → S: supabase-delivery-repository.ts:162 · M: mock operations/index.ts
- `InventoryRepository` → S: supabase-inventory-repository.ts:176 · M: mock operations/index.ts
- `WarehouseTaskRepository` → S: supabase-warehouse-task-repository.ts:196 · M: mock operations/index.ts

**elimtiyaz-desktop/src/domain/repository/club-repository.ts**
- `ClubRepository` → **M only** (mock club-repository.ts:44) — no Supabase impl; stays mock in live mode

**elimtiyaz-desktop/src/domain/repository/therapy-repository.ts**
- `PsychologyRepository` / `OrthophonieRepository` → **M only** (mock therapy-repository.ts:75/476) — no Supabase impl

**elimtiyaz-desktop/src/domain/repository/dashboard-layout-repository.ts**
- `DashboardLayoutRepository` → S: supabase-dashboard-layout-repository.ts:41 · M: mock dashboard-layout-repository.ts:27

**elimtiyaz-desktop/src/domain/identity/repository.ts**
- `IdentityResolutionRepository` → S: supabase-identity-resolution-repository.ts:145 · M: mock identity-resolution-repository.ts → Excel import ER gate, experimental tab

**Implementations with NO domain interface (the other direction of mismatch):**
- `SupabaseApprovalRepository` (supabase-approval-repository.ts:92) — consumed via `RepositoriesWithApprovals` cast (supabase-repositories.ts:502-504; features/settings/approvals-tab.tsx:112)
- Purge free functions `dryRunPurge`/`executePurge` (supabase-purge-repository.ts:135/144) — consumed directly by features/settings/danger-zone-card.tsx:44-45
- `auto-releve-bridge.ts`, `workflow-dispatch.ts`, `registration-billing-wires.ts` — infrastructure helpers (not repositories), but they embed business wiring (billing legs, workflow triggers) outside domain contracts

**Interfaces with no *Supabase* implementation (mock-only, live-mode gap):** `ClubRepository`, `PsychologyRepository`, `OrthophonieRepository`, `PerformanceReviewRepository`.

---

## 5. domain/calc module-by-module summary (responsibility, consumers, duplication risk)

**shared/** — integer-DZD math (`clampNonNegative`, `sumOf`, `splitIntoParts`) and date predicates. Consumers: every other calc module. **`money-dzd.ts` is dead** (only its test). Duplication risk: none (canonical).

**pricing/** — `school-price-matrix.ts` (real 2026/2027 stickers, devis, 5% early rate), `tuition.ts` (config lookups, official dates, 40/30/30 split), `transport.ts`, `discount-rules.ts`, `discount-engine.ts`. Consumers: mock financial ops, supabase `registration-billing-wires.ts`, features/crm/batch-registration/compute-billing.ts, dashboard analytics, Excel import mappers/tests. **Duplication risk: HIGH** — four devis/tranche engines with three remise strategies; plus `EARLY_PAYMENT_RATE` vs `EARLY_ANNUAL_RATE` twin constants (school-price-matrix.ts:236, discount-rules.ts:41).

**ledger/** — account-id, balance (replay), entries (factories), charges, overdue, debt-aging, year-history, non-tuition-charges. Consumers: 50+ files. **Duplication risk: MEDIUM** — INV-4 re-derivations in year-history; `non-tuition-charges` prices overlap `school-price-matrix` via the mock seed.

**payment/** — queries, sums, waterfall-allocator, clearance, lifo-reversal, revenue, billing-breakdown, tranche-waves, webhook-diagnostics, financial-query-engine, service-pricing-profile. Consumers: 50+ files. **Duplication risk: HIGH (internal)** — INV-4 repeated in ≥6 files; `service-pricing-profile` deviates on three axes (C11); label-map × 5. Server RPC `collect_and_allocate_payment` is authoritative for writes.

**payroll/** — `payroll-forecast.ts` single engine. Consumers: financials-page, payroll-funding-card, dashboard analytics, core/ai system-tools. **Duplication risk: LOW**.

**academics/** — subject-config (ADR-018), gpa, terms, school-year, promotion, class-placement, algerian-curriculum. Consumers: features/academics/*, crm student-detail, core/ai tools, repos. **Duplication risk: MEDIUM** — class-placement inline GPA mapping; grade→cycle logic in two places; terms.ts window bug (C9).

**timetable/** — algerian-profile, constraints, feasibility, solver/greedy-solver, generation-progress, class-reports, fixture. Consumers: **only infrastructure** (mock + supabase timetable repos). **Duplication risk: MEDIUM** — `periodMinutes` derived independently in 4 files; constraint indexing repeated.

**workflow/** — condition-evaluator, dry-run, auto-layout, templates. Consumers: features/workflow/*, mock workflow repositories, tests. **Duplication risk: LOW-MEDIUM** — server-side executor mirrors semantics.

**identity/** — ER-PMAE pipeline. Consumers: mock + supabase identity-resolution-repository, excel import er-matcher, features/crm/excel-import-modal, experimental-tab. **Duplication risk: LOW**.

**diff/** — field-diff, three-way. Consumers: conflict-resolver-modal, audit drawers, repos. **Duplication risk: LOW.**

**clubs/** & **therapy/** — validation.ts each. Consumers: mock repositories, features tabs, RBAC tests. **Duplication risk: LOW** — but the charge builders they complement live in `calc/ledger/non-tuition-charges.ts` (cross-module coupling).

**expense/** — anomaly-signals.ts. Consumers: anomaly-explainer-modal, tests. **Duplication risk: MEDIUM** — parallel `AnomalySignal` type in model/ai.ts with an extra dead variant (`missing_proof`).

**teacher/** — validation.ts (legacy Mon–Fri timetable validation). Consumers: **mock teacher-repository only**. **Duplication risk: HIGH (obsolescence)** — superseded by calc/timetable; deleting it would only affect the mock.

**reconcile/** — checks, cross-checks, reconciliation. Consumers: mock financial-repository + supabase `LedgerRepository.reconcile`, integration tests. **Duplication risk: MEDIUM** — PK-only charge matching blind spot (C12).

---

## 6. Unresolved questions for later sessions

1. **C3 teacher-ID space:** does the live DB FK `class_subjects.teacher_id` point at `personnel.id` or a teachers table? Migration `0113_class_subjects_teacher_fk.sql` exists but was not read this session.
2. **`terms.ts` blast radius:** `currentTermWindow` is consumed by `supabase-academic-repository.ts:78` (absence-alert threshold per current term). Confirm whether any Jan–Mar alert path depends on the misclassification before fixing.
3. **`service-pricing-profile.ts` hardcoded `EARLY_PAYMENT_DEADLINE = "2026-06-30"` (line 658):** will silently become wrong for the 2027/2028 year.
4. **Mock-only repositories in live mode (clubs, psychology, orthophonie, performanceReviews):** intentional staging or forgotten ports? `PerformanceReviewRepository` looks like an oversight.
5. **`missing_proof` anomaly variant:** should `deriveExpenseAnomalySignals` emit it, or should the variant be dropped?
6. **Four devis engines:** which is authoritative for *persisted* tranches? They can produce different installment shapes for the same student.
7. **`DEFAULT_CYCLE_TRANCHE_MONTHS`:** safe-delete candidate once seeds are confirmed gone (still imported dead at installment-ops.ts:162).
8. **`revenueByCategory`:** confirm nothing consumes it before removing.
9. **Interface merge (C1):** decide the canonical `recordRollCall` (with `arrivalTimes`) and `createClass` signatures — implementations already inline `arrivalTimes` beyond their declared interface, so the merge is low-risk but must keep the provider's types intact.
10. **`non-tuition-charges.ts` import of `infrastructure/mock/pricing-seed`:** since the Supabase `appendManualCharge` depends on this module, the fix must move the price source to `PricingConfig`/`school-price-matrix` *before* severing the import — deleting the file would break the canonical manual-charge path.
