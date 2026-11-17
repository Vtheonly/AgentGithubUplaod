### Diagnostic Assessment of the Current Export

Your export currently has a **signal-to-noise inversion**:

* **What is missing:** The header claims `(entire project)`, yet **100% of the exported files live inside `elimtiyaz-desktop/src/features/`** (220 UI/view-model files). The actual authoritative layers that `features/` imports—`src/domain/` (models, calculations, invariants, repository interfaces), `src/core/` (RBAC, audit actions, formatting, theme), `src/infrastructure/` (Supabase RPCs, Excel import/export, PDF generators, media vault, sync, backup), `src/app/` (providers, routing), and DB migrations—are **absent**.
* **What bloats the context:** Tens of thousands of lines of repetitive Radix/Tailwind JSX markup (`Card`, `Select`, `DataTable` column definitions, toast copy), thin compatibility wrappers, and extensive historical changelog comments (`T-XXX`, `Iteration N`, `"Previously this did X..."`). Reading old changelog comments causes an AI to confuse historical bugs with current behaviour.

Below is the full 5-part audit grounded strictly in the code provided, followed by a **consolidated authoritative AI context** you can use in place of dumping raw UI files.

---

### 1. What Must Always Be Included

To prevent an AI from breaking business rules, duplicating repositories, or violating RBAC/accounting invariants, the context must always retain:

1. **Authoritative Domain & Calculation Engines** *(currently missing from this export and only visible via imports from `features/`)*:
   * Financial invariants: INV-4 tranche remaining (`installmentRemaining`), settled/overdue predicates (`isInstallmentSettled`, `isInstallmentOverdue`), ADR-010 parent credit display (`displayParentCredit`), ADR-023 cross-category allocation (`category: null`), waterfall allocation (`allocatePaymentToInstallments`), and T-168 / year-history reconciliation (`computeParentBillingBreakdown`, `computeParentYearHistory`).
   * Billing & pricing matrix: `computeBilling` (`features/crm/batch-registration/compute-billing.ts`), `buildRegistrationBillingWires`, ADR-025 per-year pricing configs (`pricing-year-config-bar.tsx`), and real 2026/2027 `REAL_TUITION_BY_GRADE` / `REAL_FI_BY_GRADE` / `REAL_TRANSPORT_MATRIX`.
   * Academic calculations: `computeOverallGpa`, `computeSubjectAverageFromRecipe`, ADR-018 `resolveSubjectConfiguration`, promotion engine (`buildPromotionReviewQueue`, `applyDecisionOverride`), placement engine (`class-placement.ts`), and canonical timetable engine (`TimetableRepository`).
   * Risk & debt aging: `DEFAULT_DEBT_AGING_THRESHOLDS`, `computeDebtAgingStatus`, `classifyOutstandingAmount`, `deriveDebtTriage`, `evaluateStudentRiskProfiles`, and `computePayrollForecast`.
2. **Repository & RPC Contracts + Id-Space Rules:**
   * Which tables/RPCs are authoritative (e.g., `upsert_parent_from_import`, `upsert_student_from_import`, `collect_and_allocate_payment`, `adjust_installment_amount`, `fn_re_enroll_student`, `fn_confirm_promotion_cycle_class`, `purge_student_parent_domain`, `adjust_personnel_salary`, `record_salary_disbursement`).
   * **ID-space rules:**
     * `tasks.assignee_ids` and `expenses.responsible_profile_id` store **`user_profiles.id`** (via `personnel.userId`), whereas `leave_requests.personnel_id`, `workforce_attendance`, `releve_entries`, `salary_payments`, and `classes.homeroomTeacherId` store **`personnel.id`**.
     * `student_documents` is the canonical shared table with the web portal (not `students.documents_json`), uploaded via `uploadPrivateMedia` / read via `freshSignedMediaUrl`.
3. **RBAC, Multi-Tenancy, and Offline/Sync Boundaries:**
   * Session gating (`Permission.*`, `Role.*`), super-admin-only boundaries (`AccountsTab`, `ConfigurationTab`, `DangerZoneCard`, `thresholdsConfig`), and isolated module access (`ViewPsychology`, `ViewOrthophonie`).
   * Strict separation between **internal staff chat** (`scope="internal"` in `PersonnelPage`) and **parent/student portal chat** (`scope="portal"` in `CrmPage`).
   * Supabase-vs-Mock dual execution rules (e.g., `ExcelImportModal` writes directly via bulk RPCs in Supabase mode and only queues sync entries in mock mode; `pauseFinancialRealtime` / `resumeFinancialRealtime` wraps bulk imports).
4. **Cross-Page Deep-Link & Navigation Contracts:**
   * `?parentId=`, `?studentId=`, `?action=add-child`, `?action=portal-chat&channelId=` on `/crm`
   * `?familyId=`, `?paymentId=`, `?expenseId=`, `?installmentId=`, `?tab=` on `/financials`
   * `?studentId=` on `/academics`, `/academics/class/:classId?tab=...`
   * `/?tab=analytics` on `/`
   * `?tab=chat&channelId=` on `/personnel`
   * `?tab=backup|audit|...` on `/settings`

---

### 2. What Can Be Unified or Consolidated

Multiple features repeat the same logic, wrappers, or descriptions across files:

| Domain | Scattered / Duplicate Files | How to Consolidate |
| :--- | :--- | :--- |
| **Year-Tracking Financial History** | `crm/parent-year-history-section.tsx`, `financials/debt-aging-year-history.tsx` (`FamilyYearHistoryPanel`), `crm/parent-detail-drawer.tsx` (`FinancesTab`) | Document `ParentYearHistorySection` as the single UI consumer of `computeParentYearHistory`; collapse `FamilyYearHistoryPanel` as just a thin observable wrapper inside `DebtAgingTab`. |
| **Payment Collection Modal** | `financials/unified-payment-modal.tsx` + `financials/counter-payment-modal.tsx` | Treat `UnifiedPaymentModal` (driven by `PaymentNavigationContext`) as the single canonical modal; note `CounterPaymentModal` is just a backward-compat prop adapter used by `FinancialsPage`. |
| **Data Inspector** | `dashboard/components/analytics/data-inspector-core.tsx`, `data-inspector-lineage.ts`, `data-inspector.tsx` | Merge into one summary: `data-inspector-lineage.ts` resolves metrics from live streams; `data-inspector-core.tsx` renders compact + forensic drawers and `INSPECT_TRIGGER_CLASS`; `data-inspector.tsx` is only a label wrapper. |
| **Dashboard Layout Storage & Editor** | `dashboard-layout-editor.tsx`, `dashboard-layout-storage.ts`, `overview-tab.tsx`, `analytics-tab.tsx` | Collapse into one specification of the 12-column draggable/hideable layout engine persisted via `repos.dashboardLayouts` + `el-imtiyaz:dashboard-layout:` local cache. |
| **Debt Threshold Configuration** | `settings/contextual-thresholds-config.tsx`, `settings/configuration/category-cards.ts`, `configuration-tab.tsx` | Consolidate: `system_settings` (`category="debt"`) is the single persisted source; `validateDebtThresholdUpdate` enforces `grace ≤ yellow ≤ red` and `amountYellow ≤ amountRed`; `useThresholdsConfigHost` provides scoped live-preview modals on `OverviewTab`, `AnalyticsTab`, `DebtAgingTab`, and `InstallmentScheduleTab`. |
| **Export & Backup Workflows** | `settings/export-dialog.tsx`, `settings/backup-tab.tsx`, `settings/configuration-tab.tsx`, `crm/crm-page.tsx`, `dashboard/tabs/reports-tab.tsx` | Unify archive/Excel export behavior around `ExportDialog` (warmed collection via `collectWarmedExportData`, OS save picker `saveExportWithPicker`, formats `entire-archive` / `excel-zip`), distinct from entity-specific CSV/XLSX/PDF report buttons (`ReportsTab`, `CrmPage`, `ReceiptsTab`). |
| **Student Registration & Re-enrollment** | `crm/batch-registration-modal.tsx` (`batch` and `direct` modes) + `batch-registration/step1..4` + `re-enrollment/re-enroll-modal.tsx` | Summarize as one billing engine (`computeBilling`) feeding two entry flows: `BatchRegistrationModal` (new family or `direct` parent picker) and `ReEnrollModal` (existing candidate snapshot for target year). |
| **Expenses UI** | `financials/expense-submit-modal.tsx`, `expense-detail-drawer.tsx`, `expense-attachments-gallery.tsx`, `personnel/management/expense-review-section.tsx` | Document as one expense system (`repos.expenses` + `expense_attachments` vault) surfaced in both `FinancialsPage` and `PersonnelPage`. |
| **Analytics & Executive Cards** | 15+ files in `dashboard/components/analytics/` | Collapse UI component files into a compact map of card → canonical derivation function (`analytics-derivations.ts`, `executive-statistics.ts`, `operational-query-engine.ts`, `tranche-waves.ts`). |
| **Settings Configuration UI** | `settings/configuration/*` + `configuration-tab.tsx` + `pricing/*` + `pricing-tab.tsx` | Summarize the card lists and schema keys rather than keeping 15 separate presentation wrapper descriptions. |

---

### 3. What Can Be Removed From the Context

1. **Dead / Empty / Unused Files & Symbols:**
   * **`elimtiyaz-desktop/src/features/academics/elimtiyaz-desktop/src/shared/ui/markdown-view.tsx`**: Completely empty 0-line nested file inside `academics/` (actual `MarkdownView` is in `src/shared/ui/markdown-view`).
   * **`elimtiyaz-desktop/src/features/dashboard/dashboard-tab-layout-editor.tsx`**: Obsolete DOM-mutating layout editor using `el-imtiyaz:dashboard-layout:tab:`—**never imported anywhere**; replaced by `dashboard-layout-editor.tsx`.
   * **Dead code inside active files:**
     * `academic-year-detail-drawer.tsx` (`OverviewTab`): `allStudents` subscription and `gradeBreakdown` memo (never rendered).
     * `promotion-class-review-modal.tsx`: `cls` subscription and `{cls ? "" : ""}` no-op.
     * `timetable-entry-dialog.tsx`: `void TIMETABLE_CONSTRAINT_KINDS;`.
     * `onboarding-wizard.tsx`: `void ONBOARDING_STEPS;` and unused `STEP_ICONS` in `steps/shared.ts`.
     * `payment-slider.tsx`: `snapPointsFromGross` / `grossBoundaries` and `<span className="hidden">{grossBoundaries.length}</span>`.
     * `use-class-placement-studio.ts`: trailing `// TEMP DEBUG` comment.
     * `batch-registration-modal.tsx`: unused exported `STEP_ICONS`.
     * `exams-tab.tsx`: unused `onSchedule` prop.
     * `financials-page.tsx` (`DebtTab`): unused `reminding` state (set, never read).
     * `export-dialog.tsx`: unused `ExportLaunchButton` and `ExportPackageIcon` exports.
     * `pricing-year-config-bar.tsx`: unused `Copy` icon import.
2. **Pure UI Boilerplate & Repetitive Markup:**
   * Tailwind class strings, SVG gradient definitions (`chart-svg.tsx`, `diagram-svg.tsx`, `sparkline-kpi-card.tsx`, `insights-rail.tsx`), particle animation math (`splash-screen.tsx`), theme color-picker rows (`theme-editor-modal.tsx`), and static `DataTableColumn` layout markup.
3. **Historical Changelog Comments:**
   * Multi-paragraph `"BEFORE this..."`, `"Iteration 6-a"`, `"37th session"`, `"Savings: 702 → ~280 lines"`, and `"restored verbatim by T-536"` commentary across `parent-detail-drawer.tsx`, `installment-schedule-tab.tsx`, `unified-payment-modal.tsx`, `see-details-modal.tsx`, `executive-statistics.ts`, `data-inspector-core.tsx`, and `recovery-funnel-card.tsx`. Keep **only the active rule**, not the history of how it replaced an older bug.
4. **Mock / Preview Helper Noise:**
   * `yoy-mock.ts` (`deriveMockPrevYearRevenue`): isolated UI-only deterministic preview generator used strictly when `prevRevenue.length === 0`. Does not touch data or repositories.

---

### 4. What Is Already Covered Elsewhere

* **Shared UI Primitives & Wizard/Form Shells:** `AutoFormModal`, `UnifiedModal`, `ConfirmModal`, `EntityDetailDrawer`, `DataTable`, `Wizard`, `PageTabs`, `StudentActionsMenu`, `ParentActionsMenu` are reused uniformly across features. Document their patterns once at the shell level instead of repeating form layouts per modal (`school-years-tab.tsx`, `clubs-tab.tsx`, `subjects-directory-tab.tsx`, `employee-form-modal.tsx`, `task-form-modal.tsx`, `alert-creator-modal.tsx`, `calendar-event-creator-modal.tsx`, `change-password-modal.tsx`, `secret-edit-modal.tsx`).
* **`CounterPaymentModal` (`counter-payment-modal.tsx`):** Fully covered by `UnifiedPaymentModal`.
* **`FamilyYearHistoryPanel` (`debt-aging-year-history.tsx`):** Fully covered by `ParentYearHistorySection`.
* **`data-inspector.tsx`:** Fully covered by `data-inspector-core.tsx`.
* **`WorkflowMonitorTab` (`personnel/workflow-monitor-tab.tsx`):** Read-only 50-run subset of `WorkflowPage`'s `RunsTab` reusing `WorkflowRunDetailDrawer`.
* **`Dashboard` `RecoveryFunnelCard` + `Stats` `DebtTriageCard` + `DebtAgingTab`:** All share `DebtAgingThresholds` and `installmentRemaining`.
* **Supabase Diagnostics & CRUD Test Tabs:** `crud-test-tab.tsx` and `supabase-diagnostics-tab.tsx` share `diagnostics-types.ts`, `formatDiagnosticsReportText`, and the same UI pattern; `crud-test-runner.ts` just exercises existing repository RPC/REST contracts.

---

### 5. What Is Contradictory, Duplicated, or Outdated (With Authoritative Decisions)

Below are the real conflicts present in the codebase right now:

1. **Grading Formula & Coefficient Resolution (`grade-entry-screen.tsx` vs `academic-tab.tsx` vs `class-subjects-tab.tsx`):**
   * **Authoritative:** ADR-018 `resolveSubjectConfiguration` + `computeSubjectAverageFromRecipe` (supports configurable weights including Contrôle continu `cc`, non-retroactive snapshots stored on each `Assessment` row).
   * **Outdated / Contradictory:**
     * `student-detail/academic-tab.tsx` description hardcodes `"Moyenne = (D1 + D2 + 2·Examen) / 4"`, and its `gpa` `useMemo` omits `subjectConfigurations` from its dependency array.
     * `grade-entry-screen.tsx` PageHeader subtitle still prints legacy `subject.coefficient` instead of `resolved.coefficient`.
     * `class-subjects-tab.tsx`, `teachers-tab.tsx`, and `academic-year-detail-drawer.tsx` display `s.coefficient` (legacy `Subject` field) in dropdowns, and `class-subjects-tab.tsx` pre-populates the form with `s.coefficient` instead of `resolveSubjectConfiguration`.
2. **Academic Year Fallbacks (`use-current-academic-year.ts` vs stale literals):**
   * **Authoritative:** `useCurrentAcademicYear()` returns `{ id: null, code: null }` when no year is flagged current; writes must fail cleanly rather than fabricate synthetic years.
   * **Outdated / Contradictory:**
     * `use-class-placement-studio.ts` defaults to `"2026-2027"` and synthesizes `targetYearId = \`ay-${targetYearCode}\``.
     * `class-detail-page.tsx` (`"2026-2027"`), `promotion-cycles-tab.tsx` (`"2026-2027"` / `"2027-2028"`), `student-detail/academic-tab.tsx` (`"2025-2026"`), and `psych-followup-detail-drawer.tsx` (`"T1 2025-2026"`) still hardcode literal year strings.
3. **Tuition Tranches & Early-Payment Discount (`compute-billing.ts` vs `edit-student-modal.tsx` vs `see-details-modal.tsx`):**
   * **Authoritative:** `computeBilling` + `PricingConfig` (`REAL_TUITION_BY_GRADE` / `tuitionByGradeLevel`): 3 non-equal fixed tranches per grade (`V1` / `2V` / `v3`), negotiated `remise` deducted from tranche 1 only, **5%** early-payment discount on scolarité before June 30, and `prescolaire` included in `GRADE_LEVELS`.
   * **Outdated / Contradictory:**
     * `edit-student-modal.tsx` still displays `"3 tranches (40/30/30)"` and `"Année complète (−10% avant le 30 juin)"`.
     * `step2-students.tsx` `<Select>` for `level` only offers `primaire`, `cem`, `lycee` (omits `prescolaire`), whereas `computeBilling`, `EditStudentModal`, `ReEnrollModal`, and `GradeLevelsClassView` support `prescolaire_1` / `prescolaire_2`.
     * `step3-billing.tsx` says `"déduite de V2"` while `compute-billing.ts` names Tranche 1 `(V1)` and comments about legacy `v2` naming.
     * `pricing/transport-card.tsx` title still reads `"Transport scolaire (4 destinations)"` despite rendering all `TRANSPORT_DESTINATIONS` (20+ towns).
4. **Installment Settled / Overdue Checks (`isInstallmentSettled`/`isInstallmentOverdue` vs `status` string checks):**
   * **Authoritative:** Dynamic predicates `isInstallmentSettled(i)`, `isInstallmentOverdue(i)`, and `installmentRemaining(i)` (INV-4: `max(0, amountDue - amountPaid - amountPending)`), because live DB rows only use `paid | unpaid | partial` and never set `status = "overdue"`.
   * **Contradictory:**
     * `installment-schedule-tab.tsx` disables the due-date edit button using `i.status === "paid"` instead of `isInstallmentSettled(i)`.
     * `student-detail/payments-tab.tsx` filters `installments.filter((i) => i.status !== "paid")` instead of `!isInstallmentSettled(i)`.
     * `operational-query-console.tsx` (`Student360Modal`) checks `item.status !== "paid"` and inline `amountDue - amountPaid - amountPending`.
     * `data-inspector-lineage.ts` (`transport` branch) checks `installment.status === "paid"`.
5. **Payment Status Values (`payment-detail-drawer.tsx` vs `financials-page.tsx`):**
   * `payment-detail-drawer.tsx` displays a failed-payment alert for `entity?.status === "unpaid"`, whereas `financials-page.tsx` (`PAYMENT_STATUS_TONE`) tracks `paid | pending | overdue | refunded | partial`.
6. **Two Functions Named `deriveTrancheWaves`:**
   * `features/dashboard/components/analytics/executive-statistics.ts` (`deriveTrancheWaves`: grouped per `category × wave`) vs. `features/financials/installment-schedule-tab.tsx` (`deriveTrancheWaves`: pooled across categories via `derivePooledTrancheWaves`).
7. **Risk Thresholds (`operational-query-engine.ts` vs `debt-aging` settings):**
   * **Authoritative:** `system_settings` category `"debt"` (`repos.debt.observeThresholds()`).
   * **Contradictory:** `operational-query-engine.ts` hardcodes `debtAmount >= 25_000`, `>= 30_000`, and `daysOverdue >= 30` (only `severeDebtDzd` is injected dynamically via `operationalPresetsFor`).
8. **Role Names in Workflow Inspector (`node-inspector-drawer.tsx` vs `core/rbac/roles.ts`):**
   * `node-inspector-drawer.tsx` `RoleSelect` uses `"superadmin"`, `"supervisor"`, `"finance_officer"`, whereas canonical `Role` values across the app are `"super_admin"`, `"manager"`, `"financial_officer"`.
9. **Teacher Filtering & Therapist Identification:**
   * **Teachers:** Most `academics/` files filter `p.staffCategory === "teacher" || p.roleId === "teacher"`, but `timetable-tab.tsx` filters only `p.staffCategory === "teacher"`.
   * **Therapists:** `employee-form-modal.tsx` includes `staffCategory === "medical"` for therapists, yet `psychology-tab.tsx` and `orthophonie-tab.tsx` filter staff by hardcoded name checks (`"leila"`, `"bensaïd"`, `"amel"`, `"kaci"`).
10. **Therapy Attachments & Hardcoded Tenant/Actor Metadata:**
    * `therapy-attachments-card.tsx` only creates metadata-only objects (`id: thatt-...`) with no binary upload to `media-vault.ts` (unlike `documents-tab.tsx` and `expense-attachments-gallery.tsx`).
    * Both `ortho-followup-detail-drawer.tsx` and `psych-followup-detail-drawer.tsx` hardcode `"usr-current"` / `"Session courante"` on attachment save instead of reading `useAuth()`.
    * `club-detail-drawer.tsx`, `orthophonie-tab.tsx`, and `psychology-tab.tsx` hardcode `tenantId: "tenant-el-imtiyaz-oran-001"` in charge-builder calls rather than `session.tenantId`.
11. **Dual Spending/Expense Flows in Personnel (`requests-management.tsx`):**
    * `RequestsManagement` renders `ExpenseReviewSection` (`repos.expenses` — canonical expense tickets) *and* `leaveRequests` with `type === "spending_reimbursement"`, creating two separate employee reimbursement/expense paths on the same tab.
12. **Portal vs. Internal Chat Labeling (`parent-detail-drawer.tsx`):**
    * `CrmPage` + `ChatPanel` enforce `scope="portal"` (`"Messagerie Portail"`) vs `PersonnelPage` `scope="internal"` (`"Messagerie Interne"`), but `parent-detail-drawer.tsx` still labels the button `"Messager interne"` and silently no-ops navigation if `onOpenPortalChat` isn't wired.
13. **RBAC Overrides Persistence (`rbac-matrix-editor.tsx`):**
    * Saves overrides only to `localStorage` (`el-imtiyaz:rbac-overrides`), not Supabase `tenant_role_overrides`, and UI text still states `"6 rôles × 28 permissions"` despite `STAFF_ROLES` having 9 roles.
14. **Date/Timezone Handling (`toISOString().slice(0,10)` vs `Africa/Algiers`):**
    * Student attendance (`roll-call-screen.tsx`, `class-attendance-tab.tsx`, `student-detail/attendance-tab.tsx`) uses UTC `new Date().toISOString().slice(0, 10)`, whereas staff attendance & scheduling (`staff-attendance-center.tsx`, `worker-dashboard.tsx`, `manager-dashboard.tsx`, `dashboard-calendar.tsx`) explicitly use `Africa/Algiers` / local date parts to avoid midnight-to-01:00 UTC day drift.
15. **React State Mutation During Render:**
    * `academics-page.tsx`, `students-directory-tab.tsx`, `grade-levels-class-view.tsx`, `roll-call-screen.tsx`, and `timetable-tab.tsx` (`ConfigurationPanel`) call React state setters inside `useMemo` or directly during the render pass instead of `useEffect`.
16. **Duplicate Config Surfaces for AI & Backups (`settings/`):**
    * Both `configuration-tab.tsx` (via `system_settings` categories `ai` and `backup`) and dedicated tabs (`ai-config-tab.tsx` via `repos.aiConfig`, `backup-tab.tsx` via `backup-service.ts` passphrase + `system_settings`) touch AI and backup settings.
17. **Class Detail Query Alias Stuck on Mount (`class-detail-page.tsx` & `class-grades-tab.tsx`):**
    * `ClassDetailPage` reads `?tab=` only in initial `useState(initialTab)` on mount; navigating between `?tab=grades` and `?tab=notes` while already mounted on the page will not switch tabs.

---

### Consolidated, Restructured Authoritative AI Context (`elimtiyaz-desktop`)

Below is the compressed, restructured reference context representing the **actual, active architecture of `src/features/`**, eliminating JSX noise, dead files, and historical commentary.

```markdown
# El-Imtiyaz Desktop — Features Architecture & Business Context

## 1. Platform Stack & Core Conventions
- **Stack:** React + TypeScript + Vite/Electron (`window.elImtiyazDesktop` preload bridges for native file/directory pickers & local config), Supabase (`isSupabaseConfigured()`, `getSupabaseClient()`) with an in-memory mock fallback.
- **Data Access:** Components subscribe to repository observables via `useObservable(() => repos.<domain>.observe*(), deps)` from `useRepositories()`, mutate via repository methods returning `Result<T>`, and read session/permissions via `useAuth()` (`session.userId`, `session.tenantId`, `session.role`, `session.permissions`).
- **UI Primitives (`src/shared/ui/`):** `PageHeader`, `PageTabs`, `UnifiedModal` (`variant="dialog" | "drawer"`), `ConfirmModal`, `AutoFormModal` (Zod + field descriptors), `EntityDetailDrawer`, `DataTable`, `Wizard`, `StatusChip`, `PersonLink`, `StudentActionsMenu`, `ParentActionsMenu`.
- **Locale/Currency/Time:** French UI (`fr-DZ` / `fr-FR`, RTL support for `ar`), amounts in integer DZD (`formatDzd`, `formatDzdPlain`), school timezone `Africa/Algiers` (avoid `toISOString().slice(0,10)` for local dates).

---

## 2. Module Map & Authoritative Implementations

### A. Auth (`features/auth/`)
- `SplashScreen`: ParticleEngine canvas intro (`splash-screen.tsx`).
- `LoginScreen`: Email/password login (`signIn`). Parent/student roles are web-portal-only.

### B. Academics & Pedagogy (`features/academics/`)
- **Entry (`AcademicsPage`):** Tabs gated by RBAC (`ViewAcademics`, `ManageClasses`, `AssignHomework`, `ViewAttendance`, `ViewClubs`, `ViewPsychology`, `ViewOrthophonie`). Deep-links `/academics?studentId=...` to `StudentsDirectoryTab`.
- **Academic Years (`SchoolYearsTab`, `AcademicYearDetailDrawer`, `useCurrentAcademicYear`):**
  - `useCurrentAcademicYear()` returns `{ id: string | null; code: string | null }` from `repos.academicYears`. Never fabricate synthetic `ay-*` IDs or hardcode `"2025-2026"`/`"2026-2027"` on writes.
- **Classes & Rosters (`GradeLevelsClassView`, `ClassDetailPage`, `ClassStudentMultiSelect`):**
  - Grade levels (`GRADE_LEVELS`): `prescolaire_1..2`, `1ap..5ap`, `1am..4am`, `1annee..3annee`. Classes have no max-capacity ceiling.
  - Class creation requires real `academicYearId` + `academicLevelId` (`repos.academicLevels.getByGradeCode`) and normalized `filiereCode`/`specialiteCode` (`normalizeTrackCode`).
  - Roster links/removals in `CreateClassModal` & `ClassDetailPage` edit modal use `ClassStudentMultiSelect` → `repos.students.updateStudent(id, { classId })` (batching with `disabled` freeze while in-flight, followed by `repos.classes.refresh()`).
- **Class Placement Studio (`useClassPlacementStudio`, `ClassPlacementStudioModal`):**
  - Drafts persist locally per `tenant:year:grade` (`placement-draft-storage.ts`) and re-validate against live candidates/classes on restore.
  - Final commit is atomic via `repos.classPlacement.finalizePlacements`.
- **Promotion Cycles (`PromotionCyclesTab`, `PromotionCycleDetail`, `PromotionClassReviewModal`):**
  - Single workflow per `(tenant, sourceAcademicYear)`: `openOrCreateCycle` → class-by-class review using `buildPromotionReviewQueue` + `applyDecisionOverride` → `confirmClass` (two-phase `[NOTES_INCOMPLETES]` warning acknowledgment) → `reopenClass` / `completeCycle`.
- **Subjects & Grading (`SubjectsDirectoryTab`, `SubjectConfigurationsPanel`, `ClassSubjectsTab`, `GradeEntryScreen`, `ClassGradesTab`, `NarrativeGeneratorModal`):**
  - **Authoritative rule (ADR-018):** `subjects` table holds year/level-agnostic identity; `subject_configurations` holds per `(subject, academicYearId, academicLevelId, direction)` coefficients, passing grades, extracurricular flags, and `gradingRecipe` (`devoir1`, `devoir2`, `examen`, `cc`).
  - `GradeEntryScreen` resolves via `resolveSubjectConfiguration` and `computeSubjectAverageFromRecipe`, saving entry-time snapshots on `Assessment` (non-retroactive; blocked if `isArchived` year or lacking `EnterGrades`).
  - `NarrativeGeneratorModal`: Groq LLM + PII masking (`maskPII`/`unmaskPII`), requires explicit human approval, persists via `repos.studentNarratives.saveNarrative`.
- **Attendance & Justifications (`RollCallScreen`, `ClassAttendanceTab`, `JustificationsTab`):**
  - 4 attendance statuses (`present`, `absent_excused`, `absent_unexcused`, `late` with arrival time). `JustificationsTab` reviews parent-submitted portal justifications (`submitted` → `accepted` / `rejected`).
- **Homework & Exams (`HomeworkPushModal`, `HomeworkHistoryTab`, `ExamSchedulingModal`, `ExamsTab`):**
  - Homework attachments upload to private `homework-attachments` vault (`uploadPrivateMedia`).
  - Exams persist via `repos.calendar.create/update/delete` (`kind: "exam"`), synced to the portal Exam Timetable without duplicating rows on edit.
- **Timetable (`TimetableTab`, `TimetableGrid`, `TimetableEntryDialog`):**
  - Canonical store via `repos.timetable`. Grid always renders a single selected entity (`class`, `teacher`, or `room`—never all classes mixed), stacking colliding cells cleanly. Supports generation progress stream (`onProgress`), scope (`school` vs single `classId`), constraints, rooms, and live-validated manual moves/pinning.
- **Clubs & Therapy (`ClubsTab`, `ClubDetailDrawer`, `PsychologyTab`, `OrthophonieTab`, `PsychFollowUpDetailDrawer`, `OrthoFollowUpDetailDrawer`, `TherapyAttachmentsCard`):**
  - Enrolling in a club or opening a therapy follow-up creates a corresponding non-tuition ledger charge (`buildClubEnrollmentCharge`, `buildTherapyCharge`) and supports 1-click "Inscrire/Ouvrir & Encaisser" via `UnifiedPaymentModal` (`single_item`).

### C. CRM (`features/crm/`)
- **Entry (`CrmPage`):** Tabs: `parents`, `students`, `reenrollment`, `batch`, `portalmessages`.
- **Registration & Re-Enrollment:**
  - `BatchRegistrationModal`: 4-step `<Wizard>` (`mode="batch"` creates new parent; `mode="direct"` searches/binds existing parent via `ParentPickerStep` or accepts `presetParent`). Computes quote with `computeBilling` (FI per student/grade + scolarité + transport per town − negotiated remise on tranche 1; 5% early-payment discount on scolarité if `full_annual` before June 30) and persists atomically via `repos.students.batchRegister`. Issues deterministic 6–7 digit activation code + QR (`ActivationCodeModal`).
  - `ReEnrollmentTab` & `ReEnrollModal`: Manages existing students transitioning to target year (`waiting | started | re_enrolled | not_continuing`, list freeze blocked while `waitingCount > 0`). Submits `repos.reEnrollment.reEnroll` with `buildRegistrationBillingWires`.
  - `ExcelImportModal`: 5-step pipeline (`ImportEngine` + `RepositoryStorageAdapter`). When experimental ER-PMAE flag is ON (`EXPERIMENTAL_ER_PMAE_KEY`), runs `runErImportAnalysis` and requires explicit per-row approval (`ConfirmedEntityMatcher`) before binding existing parents. Pauses financial realtime during commit (`pauseFinancialRealtime` / `resumeFinancialRealtime`).
- **Profile Drawers (`ParentDetailDrawer`, `StudentDetailDrawer`):**
  - `ParentDetailDrawer`: Info/portal activation, children list, and `FinancesTab` (uses `computeParentBillingBreakdown` + `classifyAdjustmentHistory` + `servicePricingProfiles` + `ParentYearHistorySection` + `AdjustAccountModal` + account statement PDF).
  - `StudentDetailDrawer`: `InfoTab` (includes pre-admission `origin`), `AcademicTab` (term grades, `computeOverallGpa`, bulletin PDF, expandable append-only history), `AttendanceTab`, `PaymentsTab` (`sumPaidPaymentsAsOf`, `sumFutureRecordedPaidPayments`, `PaymentBreakdownCard`), `DocumentsTab` (canonical `student_documents` + private `student-documents` vault).

### D. Financials (`features/financials/`)
- **Entry (`FinancialsPage`):** KPI header + tabs: `payments`, `installments`, `debt`, `debt-aging`, `expenses`, `receipts`, `diagnostic`. Shows `finance-seed-degraded-banner` if `observeSeedHealth()` reports degraded financial seeds.
- **Canonical Payment Collection (`UnifiedPaymentModal`, `PaymentSlider`, `DebtMeter`):**
  - Modes: `single_item` (no partial if `!allowPartial`), `installment_tranche`, `consolidated_debt` (`category: null` cross-category waterfall), `account_adjustment`.
  - Non-cash (`check`, `transfer`) requires structured fields + private `payment-proofs` vault upload (`proofRequiredFor`). Cash collects immediately (`paid`); non-cash starts `pending` until `markCleared` / `markBounced` (`PaymentDetailDrawer`). Supports LIFO `refund`.
  - Slider snaps to **remaining** balances (`installmentRemaining = max(0, amountDue - amountPaid - amountPending)`).
  - `DebtMeter` displays `unallocatedCredit` via `displayParentCredit(totalOutstanding, totalUnallocatedCredit)`.
- **Installment Schedule & Manual Debt (`InstallmentScheduleTab`, `TrancheAmountEditModal`, `ManualDebtModal`):**
  - Groups T1/T2/T3 waves via `trancheNumber` (`derivePooledTrancheWaves`).
  - Individual tranche amounts edited via `repos.installments.adjustAmountDue` (`TrancheAmountEditModal`), preserving payments on over-coverage.
  - Pre-existing debts created with explicit service, reason, student anchor, and academic year via `repos.installments.createManualDebt` (`ManualDebtModal`, mounted in `DebtTab` and `ParentYearHistorySection`).
- **Debt Aging (`DebtAgingTab`, `FamilyYearHistoryPanel`):**
  - Consumes `repos.debt.observeAging()` + `repos.debt.observeThresholds()` (`green | yellow | orange | red` by age + `classifyOutstandingAmount` by amount). Bulk reminders (`broadcastReminders`) and 90-day delinquency lock (`lockDelinquentAccounts`).
- **Expenses (`ExpenseSubmitModal`, `ExpenseDetailDrawer`, `ExpenseAttachmentsGallery`, `AnomalyExplainerModal`):**
  - Lifecycle: `submitted` → `approved`/`rejected` (no self-approval) → `disbursed` → `settled` (proof uploaded via `repos.expenses.addAttachment` into `expense-receipts` vault + `finalSpentAmount`). Anomaly signals via `deriveExpenseAnomalySignals` + AI explainer.
- **Financial Diagnostics (`FinancialsPage` `diagnostic` tab):**
  - `WebhookDiagnosticsCard` (read-only audit via `runWebhookDiagnostics` across payments/ledger/installments/allocations/pricing), `FinancialQueryConsole` (`evaluateFamilyFinancialDiagnoses`), `CrossServiceMatrix`, `CashFlowRadar`, and `PayrollFundingCard` (`computePayrollForecast`).

### E. Dashboard & Analytics (`features/dashboard/`)
- **Entry (`DashboardPage`):** Year/period selector (`AcademicYearSelector` backed by `repos.academicYears`), layout editor toggle, tabs: `overview`, `analytics`, `alerts`, `reports`.
- **OverviewTab:** Customizable `DashboardLayoutEditor` (`storageKey="overview"`) with `SparklineKpiCard`s, `WaveVelocityCard`, `RecoveryFunnelCard` (real family lists via `deriveRecoveryFunnelHouseholds` + `wa.me` WhatsApp handoff), `WeeklyOperatingRhythm` (Sun–Thu), `DashboardCalendar`, `InsightsRail`, and `SeeDetailsModal` (drill-down tabs: `revenue`, `departments`, `demographics`, `debt`).
- **AnalyticsTab:** 3 layout-customizable views (`statistics:pilotage`, `statistics:diagnostic`, `statistics:charts`) wrapped in `DataInspectorProvider`:
  - `pilotage`: `TripleRiskSummaryCard`, `WaveVelocityCard`, `DebtTriageCard`, `DiscountErosionCard`, `FamilyConcentrationCard`, `EnrollmentDynamicsCard`, `TransportYieldCard`, `ServiceYieldCard`.
  - `diagnostic`: `OperationalQueryConsole` (embedded `CrossRiskCard` + `PivotMatrixCard` + `Student360Modal`).
  - `charts`: `AnalyticsSlicers` (`methods`, `categories`), `StatStrip`, `MethodMixCard`, `CategoryMixCard`, `YoYComparisonCard`, `AgingCompositionCard`, `DebtorsParetoCard`, `PayrollCostTrendCard`.
  - `DataInspector`: Interactive lineage verification (`buildResolution`) comparing displayed vs. resolved values with top-10 color coding and selectable reference population (`whole-dataset` vs. `top10`).
  - `InfoTip`: Centralized glossary tooltips (`statsTips.*`) with KaTeX math (`Latex`).

### F. Personnel & Workforce (`features/personnel/`)
- **First-run Gate:** If `onboarding.completedAt === null` and role is `super_admin`, renders `OnboardingWizard` (11 steps including `WorkingDaysStep` monthly working-days calendar).
- **Role Dashboards (`RoleDashboardRouter`):** Dispatches `AdministratorDashboard` (`super_admin`, `financial_officer`, `support_staff`), `ManagerDashboard`, `BuyerDashboard`, `DriverDashboard`, `WarehouseWorkerDashboard`, `TeacherDashboard` (self-contained overlays for `RollCallScreen` + `GradeEntryScreen`, strictly scoped to `homeroomTeacherId === me.id`), `WorkerDashboard`.
- **Management Tabs (`PersonnelPage`):**
  - `AdministratorEmployeeDirectory` (`EmployeeFormModal`, `EmployeeProfileDrawer`).
  - `PayrollManagement`: `UpcomingPersonnelPayments` (`computePayrollForecast`) + salary ledger (`adjustSalary`, `recordSalaryPayment`, payslip PDFs).
  - `TaskManagement` (`TaskFormModal`, `TaskDetailDrawer`): assigns via `personnel.userId` (`user_profiles.id`).
  - `StaffAttendanceCenter`: clock-in/out (requires linked `personnelId`), record observed absences, 2-way absence justification loop.
  - `RequestsManagement`: mounts `ExpenseReviewSection` (`repos.expenses`) + `repos.leaveRequests`.
  - `ChatPanel` (`scope="internal"`): staff channels (`direct`, `group`, `department`, `announcement`), `chat-attachments` vault, per-channel unread counts.
  - `ReleveTab`: append-only activity hours log (admins record for staff; teachers read-only self view).

### G. Workflow DAG Engine (`features/workflow/`), Profile (`features/profile/`), AI Copilot (`features/ai/`), Settings (`features/settings/`)
- **Workflow (`WorkflowPage`):** `DagCanvas` (drag/snap/pan/zoom/minimap, `VRAI`/`FAUX` condition output handles, cycle check via `detectCycle`, topological `autoLayout`), `NodePalette` (hides `database_query` / `extract_field`), `NodeInspectorDrawer` (visual predicate builder + `route_switch` routes), `TestStudioDrawer` (real parent simulation + server dry-run/execute), `RunsTab`.
- **AI Copilot (`AICopilotDrawer`):** Streaming chat, tool execution indicator, `ArtifactRenderer` (`ChartSvg`, `DiagramSvg`, `DocumentCard`), human-in-the-loop action approvals, and clarification prompts.
- **Profile (`ProfilePage`):** Session metadata, linked `EmployeeDossierCard` (when `observeByUserId` resolves), permissions grid, user audit activity, `ChangePasswordModal`.
- **Settings (`SettingsPage`):**
  - `GeneralTab` (theme presets + `ThemeEditorModal`, locale FR/AR RTL, timezone, currency, `DangerZoneCard` domain purge).
  - `PricingTab` (`PricingYearConfigBar` + tuition/transport/fees/services/discounts cards).
  - `AuditLogTab` (live stream, multi-filter, red/green field diff table via `computeFieldDiff` + `flattenDiffRows`, XLSX/CSV export).
  - `RbacMatrixEditor`, `ApprovalsTab` (web registration approval + student enrollment/linking), `AccountsTab` + `CreateAccountModal` (creates user account & binds `personnel.userId` atomically; deletes via `deleteAccount`).
  - `ConfigurationTab` (`ConnectionCard`, `CATEGORY_CARDS`, `ExportDialog`), `SupabaseDiagnosticsTab` (read-only 18-check probe), `CrudTestTab` (27-check end-to-end probe with auto-cleanup), `SyncTab` + `ConflictResolverModal` (3-way merge), `AIConfigTab`, `BackupTab` (AES-256-GCM archives, scheduler toggle, passphrase, Excel checkpoint, restore-from-file safety backup + checksum validation), `LockedFeaturesTab`, `ExperimentalTab` (ER-PMAE duplicate review + merge/unmerge).

---

### Recommendations for Your Context-Export Tool

1. **Change what gets exported first:** Right now the tool exports `src/features/` (220 files, mostly JSX) and omits `src/domain/`, `src/core/`, `src/infrastructure/`, and `supabase/migrations/`. Flip the priority:
   * **Include full source:** `src/domain/model/*`, `src/domain/calc/*`, `src/domain/repository/*`, `src/core/rbac/*`, `src/core/ai/*`, `src/app/providers/*`, `src/infrastructure/supabase/repositories/*` (or their public signatures/RPC names).
   * **Compress `src/features/` into a compact index/manifest** (component name, props, repository calls, deep-links, and known edge cases) rather than dumping 220 raw `.tsx` files full of Tailwind classes and JSX layout.
2. **Exclude dead/noise files explicitly:**
   * `src/features/academics/elimtiyaz-desktop/**` (corrupted empty nested folder)
   * `src/features/dashboard/dashboard-tab-layout-editor.tsx` (replaced dead file)
   * `src/features/dashboard/components/analytics/yoy-mock.ts` (demo-only generator)
   * `src/features/settings/supabase-diagnostics/*` (test/probe utilities—keep only in diagnostic tasks)
3. **Strip historical changelog comments during compression:** Have your export tool remove comment blocks containing migration/ticket history (`T-XXX`, `Iteration N`, `Previously...`) and keep only active behavioral invariants and TODO/bug markers.
4. **Fix the identified contradictions directly in code** (especially hardcoded `"2025-2026"`/`"2026-2027"`/`"tenant-el-imtiyaz-oran-001"`/`"usr-current"`, `edit-student-modal.tsx`'s `"40/30/30"` & `"−10%"`, `step2-students.tsx` missing `prescolaire`, `node-inspector-drawer.tsx` role strings `"superadmin"`/`"supervisor"`, and `installment-schedule-tab.tsx` / `payments-tab.tsx` using `status === "paid"` instead of `isInstallmentSettled`), so the source code itself stops giving conflicting signals.