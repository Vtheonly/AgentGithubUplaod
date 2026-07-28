# El-Imtiyaz Desktop — Multi-Agent Worklog

This file is the single shared work log for all agents working on the
El-Imtiyaz desktop rebuild. Append new sections at the bottom; never
overwrite previous entries.

---
Task ID: 0
Agent: Main (Super Z)
Task: Set up working copy of the project from the reference repository, install dependencies, recreate lost Tailwind/PostCSS configs, and verify baseline build + tests pass before starting iteration 6 work.

Work Log:
- Cloned reference repos into `/home/z/my-project/reference/` (AgentGithubUplaod + elimtiyaz-android).
- Launched 3 parallel research agents to digest: (a) the entire project plan, (b) all iteration docs, (c) the existing source code audit.
- Copied `el-imtiyaz-source/` from reference into `/home/z/my-project/el-imtiyaz-source/` as the working tree.
- Discovered `tailwind.config.js` and `postcss.config.js` were missing (known iter-4/5 issue — root `.gitignore` excluded them).
- Recreated both config files. Project has `"type": "module"` in package.json so renamed to `.cjs` extension to avoid ESM/CJS conflict.
- Updated local `.gitignore` to explicitly NOT exclude these files going forward, with a warning comment.
- Installed dependencies via `npm ci` (147 packages, no install scripts approved).
- Verified TypeScript: `tsc --noEmit` clean.
- Verified tests: `vitest run` → 273/273 passing in ~41s.
- Verified build: `vite build` → 10 chunks emitted, CSS bundle 36.91 kB (7.53 kB gz) — confirms Tailwind pipeline is now healthy.

Stage Summary:
- Working tree ready at `/home/z/my-project/el-imtiyaz-source/`.
- Baseline established: typecheck clean, 273 tests pass, build succeeds.
- Known iteration-5 remaining items to address in this iteration:
  1. Wire dynamic Excel importer into `excel-import-modal.tsx` (replaces old `import-pipeline.ts`).
  2. Update default pricing configuration to match user-provided spec (tuition, transport, discounts, services).
  3. Replace T1/T2/T3 transport tiers with named destinations (Ville BOUMERDES, TIDJELABINE, BOUDOUAOU, AUTRES).
  4. Add new discount types (passage palier, seniority, full annual, highest average, sibling fixed).
  5. Add complementary services (psychology, speech therapy, 2nd apron).
  6. Reconcile ledger seed with new pricing — keep accounting engine consistent.
  7. Fix `MockStudentRepository.batchRegister` atomicity (rollback on failure).
  8. Fix `MockPaymentRepository.refund` to create ledger reversal entry.
  9. Fix `MockExpenseRepository.transition` to enforce no self-approval.
  10. Fix `attendanceRateToday` hardcoded value — derive from attendance records.
  11. Seed mock read paths (subjects by class, grades, attendance, homework, releve) with real data.
  12. Wire up unused UI buttons (CRM Parent Detail Reçu PDF, Personnel Filter + Export).
  13. Implement dashboard Personnel export + Outstanding debt export properly.
  14. Audit and verify Unified Modal System is 100% consistent.
  15. Audit and verify Tab Navigation is consistent and polished across all pages.
  16. Verify and polish particle animation / splash screen.
  17. Polish UI/design — shadows, borders, depth, transitions, premium feel.
  18. Add tests for new pricing logic, transport tranches, new discount types, atomic batchRegister, refund reversal, self-approval prevention.
  19. Take screenshots of all major UI states for verification.
  20. Create `ITERATION-6-DONE.md` documentation.


---
Task ID: 1
Agent: Main (Super Z)
Task: Iteration 6 — Update pricing to match user's exact spec, fix mock stubs, wire dynamic Excel importer, wire unused UI buttons.

Work Log:
- Domain model expansion:
  - Added `GradeLevel` enum (14 grades: prescolaire_1/2, 1ap-5ap, 1am-4am, 1ere/2eme/3eme_annee) to `student.ts` with bidirectional mappers (`gradeLevelFromLevelYear`, `academicLevelFromGradeLevel`, `gradeYearFromGradeLevel`).
  - Added `TransportDestination` enum (4 named zones: ville_boumerdes, tidjelabine_sahel_figuier_corso, boudouaou_thenia_zemmouri, autres) to `parent.ts` with `cityTierToDestination` legacy mapper.
  - Expanded `PricingConfig` to use `tuitionByGradeLevel: Record<GradeLevel, TuitionPricing>` (14 entries, each with annualAmount + 3-tranche installments) and `transportByDestination: Record<TransportDestination, TransportPricing>` (4 entries, same shape).
  - Added `DiscountCode` enum with 5 canonical codes (passage_palier, seniority_5y, full_annual, highest_average, sibling_fixed) plus 4 legacy codes.
  - Added `ComplementaryServicePricing` interface with semesterAmount + annualAmount.
  - Added `secondApronFee` field to `PricingConfig` for the 2,000 DA 2nd apron surcharge.
  - Added new helper functions: `tuitionForGradeLevel`, `tuitionTranchesForGrade`, `transportForDestination`, `transportTranchesForDestination`, `findDiscountByCode`, `computeSiblingDiscount`.
  - Kept legacy helpers (`tuitionForLevel`, `transportForTier`, `tuitionTranches`) for backward-compat — they delegate to the new structure with sensible defaults.
- Pricing seed (`pricing-seed.ts`): rewrote with the OFFICIAL 2026-2027 fee schedule — 14 grade-level tuitions (130k-395k DA, each with the exact 3-tranche split from the spec), 4 transport destinations (40k/43k/52k/55k DA with the exact tranche splits), 5 canonical discounts, 6 additional services (canteen/uniform/books/chess/english/2nd-apron), 2 complementary services (psychology + speech therapy with 10k semester / 20k annual), 2,000 DA 2nd apron fee.
- Domain layer `ledger.ts`: updated `buildTuitionChargeEntries` and `buildTransportChargeEntry` to prefer per-grade-level / per-destination pricing when the new fields are provided. Added new `buildTransportChargeEntriesForDestination` for 3-tranche transport schedules.
- Ledger seed (`ledger-seed.ts`): rewrote to use the new per-grade-level tuition and per-destination transport. Each parent+student now generates 3 tuition tranches + 3 transport tranches (was 1 transport charge before). Sibling discount now uses `sibling_fixed` (-5 000 DA per additional child) instead of the removed legacy `sibling_10`/`sibling_15`.
- Seed data (`seed-data.ts`): added `transportDestination` to all 8 parents (derived from cityTier), added `gradeLevel` to all 15 students (derived from level+gradeYear). Updated `seedInstallments` and `seedPayments` to use the granular per-grade-level tuition.
- New `academic-seed.ts` file: created with 22 class-subject mappings, 17 assessments (T1 grades across 6 classes), 30 attendance records (5 days × 6 students), 4 homework assignments, 9 relevé entries (3 teachers). All previously-stubbed read paths now return real data.
- Mock repository fixes (`mock-repositories.ts`):
  - `MockStore`: added `classSubjects`, `assessments`, `attendance`, `homework`, `releve` collections + their observables + notify methods.
  - `MockParentRepository.createParent`: derives `transportDestination` from `cityTier` if not explicitly provided.
  - `MockStudentRepository.createStudent` + `updateStudent`: derives `gradeLevel` from `level`+`gradeYear` if not explicitly provided.
  - `MockStudentRepository.batchRegister`: COMPLETE REWRITE for true atomicity — pre-validates ALL inputs, snapshots state, creates parent+all students in a try/catch, rolls back on ANY failure, writes audit entry recording success OR failure with rollback reason.
  - `MockSubjectRepository.observeByClass` + `assignSubjectToClass` + `removeSubjectFromClass`: now return real data + persist changes (previously stubs returning empty/Err).
  - `MockGradeRepository.observeForStudent` + `observeForClass`: now return real seeded assessments + persist new entries via `enterGrade`.
  - `MockAttendanceRepository.observeByClass` + `observeByStudent`: now return real seeded attendance + persist new records via `recordRollCall`.
  - `MockHomeworkRepository.observeForClass` + `observeByTeacher`: now return real seeded homework + persist new entries via `push`. The `subjectName` is now looked up from the subjects store instead of hardcoded to "Français".
  - `MockReleveRepository.observeByPersonnel`: now returns real seeded relevé entries + persists new entries via `logEntry`.
  - `MockPaymentRepository.refund`: now appends a corresponding `LedgerEntry` of type=reversal that negates the original payment's ledger entry. The reversal entry links to the original via `reversesId`. Reconciliation will now correctly reflect the refund.
  - `MockExpenseRepository.approve` + `reject`: now ENFORCE the no-self-approval rule (plan §08) at the repository layer. If approver === submittedBy, returns `Err(Errors.forbidden(...))` and writes an audit entry documenting the blocked attempt. Previously the mock allowed it (UI was supposed to prevent).
  - `MockExpenseRepository.transition`: added state-machine validation — only allows submitted→approved/rejected, approved→disbursed, disbursed→settled. Returns `Err(Errors.conflict(...))` for invalid transitions.
  - `MockDashboardRepository.kpis`: `attendanceRateToday` is now computed from the most recent day's attendance records (was hardcoded `0.93` with a TODO). Falls back to 0 when no records exist.
  - `MockPricingRepository`: implemented all 5 new interface methods (`updateTuitionForGradeLevel`, `updateTransportForDestination`, `updateSecondApronFee`, `addComplementaryService`, `removeComplementaryService`). Legacy methods (`updateTuition`, `updateTransport`, `addDiscount`) now delegate to the new structure with sensible defaults.
- Pricing UI (`pricing-tab.tsx`): COMPLETE REWRITE for the new structure. Now displays 14 grade-level tuition editors (each with annual + 3 tranche inputs), 4 transport destination editors (same shape), registration/monthly/penalties/2nd-apron card, complementary services card with add/remove, discounts card with 9-code dropdown selector, additional services card. All editors show "À jour / Non enregistré" badges and disable save when not dirty.
- Excel import modal (`excel-import-modal.tsx`): rewired to use the dynamic, schema-driven importer (`dynamic-import.ts` + `client-schema.ts`) instead of the legacy `import-pipeline.ts`. The new pipeline supports the school's actual `Suivis clients 2026_2027.xlsx` workbook with FR/EN header aliases and Algerian naming convention.
- Parent detail drawer (`parent-detail-drawer.tsx`): wired up the "Reçu PDF" button (was disabled). Now generates a full account statement PDF via `generateAccountStatementPdf` and triggers a browser download. Disabled only when the parent has no payments.
- Personnel page (`personnel-page.tsx`): wired up the Filter button (was no-op) as a category dropdown that filters the directory. Wired up the Export button (was no-op) to generate an XLSX roster of the currently-filtered personnel via `exportToXlsx`.
- Dashboard page (`dashboard-page.tsx`): implemented the personnel export (was a `console.log` stub) — now generates the same XLSX roster as the Personnel page export.
- Pricing repository interface: extended `PricingRepository` with the 5 new methods + added `discountCode?: DiscountCode` to `addDiscount` input. Kept all legacy methods for backward-compat.
- Tests:
  - Rewrote `pricing.test.ts` to test the new structure: `tuitionForGradeLevel`, `tuitionTranchesForGrade`, `transportForDestination`, `transportTranchesForDestination`, `findDiscountByCode`, `computeSiblingDiscount` (with 6 cases including -25 000 DA for 6 children), legacy helpers, `applyDiscount` with the new discount codes.
  - Updated `ledger.test.ts`: replaced removed `tuitionByLevel.cem` / `transportByTier.t2` references with `tuitionForLevel(cfg, "cem")` / `transportForTier(cfg, "t2")` (which now delegate to the new structure). Replaced removed `sibling_10` with `sibling_fixed` in the discount test.
  - Updated `mock-repositories.test.ts`: rewrote pricing tests to use `tuitionByGradeLevel["1ap"].annualAmount === 245_000` etc. Added new tests for `updateTuitionForGradeLevel` (with sum validation), `updateTransportForDestination`, `addComplementaryService`. Updated the self-approval test to assert the new forbidden error + added a positive test for cross-user approval.
- Test count: 273 → 303 (+30 new tests, all passing).
- Typecheck: clean.
- Build: 11.28s, 10 chunks, CSS 37.42 kB (7.59 kB gzipped) — confirms Tailwind pipeline is healthy.

Stage Summary:
- All 5 user-requested pricing categories now match the official 2026-2027 fee schedule EXACTLY:
  - 14 grade-level tuitions (130k-395k DA, each with the exact 3-tranche split from the spec)
  - 4 transport destinations (40k/43k/52k/55k DA with the exact tranche splits: 20k+10k+10k, 20k+13k+10k, 30k+12k+10k, 30k+15k+10k)
  - 5 canonical discounts (passage palier -10k, seniority -5%, full annual -10%, highest average -10%, sibling -5k per additional)
  - 2 complementary services (psychology + speech therapy with 10k semester / 20k annual)
  - 2,000 DA 2nd apron surcharge
- Ledger seed regenerated with new pricing — accounting engine stays consistent. Reconciliation smoke test still passes (Dashboard outstandingDebt matches ledger total).
- All previously-stubbed mock read paths now return real data (subjects by class, grades, attendance, homework, relevé).
- batchRegister is now truly atomic with rollback.
- Payment refunds now create proper ledger reversal entries.
- Expense workflow enforces no-self-approval at the repository layer.
- attendanceRateToday is now computed from real attendance records.
- Dynamic Excel importer is now wired into the UI modal.
- CRM parent PDF receipt button works (downloads account statement).
- Personnel Filter + Export buttons work.
- Dashboard personnel export works.
- 303 tests passing.
- Typecheck clean.
- Build succeeds.
