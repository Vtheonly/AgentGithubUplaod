# Iteration 9 — Comprehensive Requirements Overhaul

This iteration addresses the final comprehensive list of system requirements
and demands from the user. It builds on the iteration-8 baseline (723 tests
passing, typecheck clean) and ships 84 new tests for a final count of 807
passing tests with zero typecheck errors.

## Spec items addressed

### 1. Dashboard Access Control & Role Restricting (spec §1.1)

- **Requirement:** Teachers and non-administrative staff must be completely
  restricted from accessing the main administrative/financial dashboard.
- **Implementation:**
  - `src/core/rbac/feature-registry.ts` — `Dashboard` requirement changed
    from `empty` (everyone) to `requiresRole([SuperAdmin, FinancialOfficer,
    SupportStaff, Manager])`.
  - `src/app/app-shell.tsx` — route guard redirects non-admin users from
    `/` to `/personnel` (defense in depth against direct URL access).
  - Sidebar's existing `GatedContent` now hides the dashboard nav entry
    for restricted roles.
- **Tests:** `src/test/unit/iteration-9-rbac-dashboard.test.ts` (11 tests)
  verify every role.

### 2. Dashboard Layout, Header Controls & Overview Integration (spec §2.1, §2.2, §2.3)

- **§2.1 Header cleanup:**
  - Removed `<DraftingAssistantButton />` from the dashboard header (file
    deleted: `src/features/dashboard/drafting-assistant-modal.tsx`).
  - Removed static "Export" button from the dashboard header.
  - Replaced static "Année 2025-2026" button with a new interactive
    `<AcademicYearSelector />` (`src/shared/components/academic-year-selector.tsx`).
    Supports switching between academic years (2023-2024, 2024-2025,
    2025-2026, 2026-2027) and filtering by YTD / current month / current
    quarter / custom date range. All dashboard metrics re-fetch when the
    selection changes (via the new `kpisForRange` / `revenueForRange` /
    `debtByAgingForRange` repository methods).
- **§2.2 Tab merge:**
  - Removed the separate "Analytique" tab entirely.
  - Demographics pie charts (grade + gender) are now embedded directly in
    the Overview tab.
  - The "Taux de recouvrement" stat (formerly in Analytics) is now a
    clickable stat card in the Overview.
  - All KPI cards and charts are now clickable to drill down into the
    SeeDetailsModal with the relevant sub-tab pre-selected (revenue →
    revenue tab, demographics → demographics tab, debt → debt tab).
- **§2.3 Department streamlining:**
  - Removed department-level financial breakdown from the main Overview.
  - Department financials are still available inside the SeeDetailsModal →
    "Departments" sub-tab for users who want that breakdown.

### 3. Integrated Calendar View (spec §3.1, §3.2, §3.3)

- **§3.1 Calendar embedded in Overview:**
  - New `src/shared/components/dashboard-calendar.tsx` component is
    rendered directly inside the Overview tab.
  - Month grid on the left with event-count dots per day; daily activity
    panel on the right with timed events sorted chronologically.
- **§3.2 Daily activity tracking:**
  - Selecting any date shows what happened on that date: payments received
    (auto-derived from `Payment.collectedAt`), audit log entries
    (auto-derived from `AuditEntry.at`), expense events (auto-derived from
    `Expense.submittedAt/approvedAt/disbursedAt`), and manually scheduled
    events.
  - Does NOT list unpaid/overdue debt balances — those live in the
    Financials → Debt tab.
- **§3.3 Interactive event management:**
  - New `src/shared/components/calendar-event-creator-modal.tsx` modal
    supports 4 event kinds: follow-up call, reminder, meeting, custom.
    Each kind has its own specific fields (target name + phone for calls,
    location + attendee count for meetings, linked entity for reminders).
  - Manual events can be deleted in-place via the trash icon on the daily
    activity panel (with a confirmation modal).
  - Auto-generated events (payments, audit, expenses) are immutable.

### 4. Alert & Notification System Overhaul (spec §4.1–§4.5)

- **§4.1 Removed alerts from Overview:**
  - The Overview tab no longer shows alerts widget / badges / notification
    list. The dedicated Alerts tab is retained on the Dashboard, plus the
    Topbar bell.
- **§4.2 Click-to-detail modal:**
  - New `src/shared/components/alert-detail-modal.tsx` drawer.
  - Clicking any alert in the Topbar bell dropdown OR the Alerts tab opens
    this drawer with the full context: title, body, type, priority,
    source, source label, target, schedule, audit info, linked entity
    deep-link, mark-as-read + dismiss actions.
  - The Topbar bell previously only marked the alert as read on click;
    now it opens the detail drawer.
- **§4.3 Manual custom alert creation (multi-access):**
  - New `src/shared/components/alert-creator-modal.tsx` form modal.
  - Supports: title, description, type, priority (low/medium/high/urgent),
    trigger date/time + timers, target (broadcast / role / user), source
    label.
  - Accessible in TWO locations: the main Dashboard → Alerts tab AND the
    Personnel workspace → Alertes tab (so non-admin staff like workers,
    drivers, teachers who can't access the main Dashboard's Alerts tab
    can still create custom alerts).
- **§4.4 Priority ordering & sorting:**
  - Alerts tab has a priority filter (urgent/high/medium/low) + a sort
    dropdown (by priority / newest / unread-first).
  - The `sortAlertsByPriority()` helper sorts urgent first, then by
    recency within the same priority.
  - Topbar bell uses the same priority sort for the top-8 preview.
- **§4.5 Source & origin tracking:**
  - Every alert now carries `source` (system/manual/workflow/schedule/audit)
    + `sourceLabel` (human-readable module name like "Module Finances —
    Retards auto") + `createdBy` (userId).
  - The Alerts tab + Topbar bell display these prominently.
  - Auto-generated overdue alerts come from source="system",
    sourceLabel="Module Finances — Retards auto".

### 5. Reports Restructuring (spec §5.1, §5.2, §5.3)

- **§5.1 Strict separation:**
  - The global Reports tab now contains ONLY macro/organization-level
    reports: revenu-mensuel, creances-agees, effectifs-niveau,
    journal-audit, depenses-categorie, annuaire-personnel.
  - Removed entity-specific reports from the global tab: releve-enseignant,
    releve-notes, bulletins-trimestriels, paiements-jour.
- **§5.2 Entity-specific reports relocated to drawers:**
  - **Student Report Cards (Bulletins trimestriels):** Generated exclusively
    inside the StudentDetailDrawer via the new "Bulletin PDF" button next
    to the term selector. Uses `generateBulletinPdf()` (new in
    `src/infrastructure/pdf/receipt-pdf.ts`).
  - **Parent Account Statements (Relevé de compte):** Already existed in
    the ParentDetailDrawer — verified intact.
  - **Employee Salary Slips (Fiche de paie):** Generated exclusively inside
    the PersonnelDetailDrawer via the new "Fiche de paie" button (visible
    only to SuperAdmin + FinancialOfficer per salary visibility rule).
    Uses `generatePayslipPdf()` (new in receipt-pdf.ts).
- **§5.3 Export formats:**
  - Global reports display their supported formats as badges (XLSX, PDF).
  - The revenu-mensuel report supports both XLSX and PDF export buttons.

### 6. Financials, Installment Schedules & Overdue Alert Logic (spec §6.1, §6.2, §6.3)

- **§6.1 Flexible parent installment schedules:**
  - `InstallmentRepository.updateDueDate()` lets admins override any
    installment's due date per parent. Marks the installment
    `customSchedule: true` and stores an optional note.
  - The Installment Schedule tab (`src/features/financials/installment-schedule-tab.tsx`)
    shows a calendar-cog icon next to every non-paid installment that
    opens the `EditDueDateModal`.
  - Custom-scheduled installments are badged "Personnalisé" in the list.
- **§6.2 Cycle-based installment customization:**
  - `InstallmentRepository.regenerateForCycle()` re-templates pending
    installments for a parent using the cycle's default tranche months:
    - Primaire: September / December / March
    - CEM: September / December / April
    - Lycée: September / January / May
  - Paid installments are preserved. Clears the `customSchedule` flag.
  - The `RegenerateForCycleModal` (accessible from the EditDueDateModal)
    lets admins re-template by selecting a cycle.
- **§6.3 Automated overdue alert generation:**
  - New `OverdueAlertGenerator` interface + `MockOverdueAlertGenerator`
    implementation.
  - Scans installments whose due date has passed without payment
    confirmation. Idempotent: dedups on `entityType=installment` +
    `entityId=<installmentId>` so re-running doesn't create duplicates.
  - Priority rules: >90 days overdue → urgent, 31–90 days → high, 0–30
    days → medium. Targets the FinancialOfficer role.
  - Auto-runs on Dashboard mount so alerts are always current.
  - Manual trigger via the "Scan retards" button in the Installment
    Schedule tab toolbar.

### Unified Modal System (preserved)

- All new modals (`AlertCreatorModal`, `AlertDetailModal`,
  `CalendarEventCreatorModal`, `EditDueDateModal`,
  `RegenerateForCycleModal`) use the existing `UnifiedModal` component.
- Zero raw `<Dialog>` call sites remain — the iteration-7 unification is
  preserved.

## Test summary

- **Baseline:** 723 tests passing (29 test files).
- **Iteration 9 final:** 807 tests passing (36 test files) — 84 new tests added.
- **Typecheck:** clean.
- **New test files:**
  - `src/test/unit/iteration-9-alerts.test.ts` (25 tests)
  - `src/test/unit/iteration-9-installments.test.ts` (12 tests)
  - `src/test/unit/iteration-9-rbac-dashboard.test.ts` (11 tests)
  - `src/test/unit/iteration-9-pdf.test.ts` (4 tests)
  - `src/test/integration/iteration-9-repositories.test.ts` (23 tests)
  - `src/test/component/iteration-9-modals.test.tsx` (14 tests)
  - `src/test/component/iteration-9-dashboard.test.tsx` (7 tests)

## Files changed

### New files (10)

- `src/domain/model/calendar.ts`
- `src/shared/components/academic-year-selector.tsx`
- `src/shared/components/alert-creator-modal.tsx`
- `src/shared/components/alert-detail-modal.tsx`
- `src/shared/components/calendar-event-creator-modal.tsx`
- `src/shared/components/dashboard-calendar.tsx`
- `src/test/unit/iteration-9-alerts.test.ts`
- `src/test/unit/iteration-9-installments.test.ts`
- `src/test/unit/iteration-9-rbac-dashboard.test.ts`
- `src/test/unit/iteration-9-pdf.test.ts`
- `src/test/integration/iteration-9-repositories.test.ts`
- `src/test/component/iteration-9-modals.test.tsx`
- `src/test/component/iteration-9-dashboard.test.tsx`
- `docs/ITERATION-9-DONE.md` (this file)
- `worklog.md`

### Modified files (12)

- `src/domain/model/operations.ts` — added priority/source/targeting/triggeredAt/createdBy
- `src/domain/model/payment.ts` — added academicCycle/customSchedule/customScheduleNote + AcademicCycle type + cycle templates
- `src/domain/repository/repository.ts` — extended NotificationRepository, InstallmentRepository, DashboardRepository; added CalendarRepository + OverdueAlertGenerator
- `src/infrastructure/repository-provider.tsx` — wired new repositories
- `src/infrastructure/mock/mock-repositories.ts` — implemented all new methods + calendar store
- `src/infrastructure/mock/seed-data.ts` — updated seed data with new fields + new calendar events
- `src/infrastructure/pdf/receipt-pdf.ts` — added generateBulletinPdf + generatePayslipPdf + sanitizePdfText + new color constants
- `src/core/rbac/feature-registry.ts` — Dashboard access restricted to admin roles
- `src/app/app-shell.tsx` — route guard for dashboard
- `src/shared/components/topbar.tsx` — alerts now open detail drawer + priority sort + source display
- `src/features/dashboard/dashboard-page.tsx` — full rewrite per spec §2/§3/§4/§5
- `src/features/dashboard/see-details-modal.tsx` — added initialTab prop
- `src/features/personnel/personnel-page.tsx` — added Alertes tab + PersonnelAlertsTab
- `src/features/personnel/personnel-detail-drawer.tsx` — added Fiche de paie button
- `src/features/crm/student-detail-drawer.tsx` — added Bulletin PDF button
- `src/features/financials/installment-schedule-tab.tsx` — added edit-due-date + regenerate-for-cycle + scan-overdue actions

### Removed files (1)

- `src/features/dashboard/drafting-assistant-modal.tsx` — unused after dashboard rewrite

## Demo accounts (unchanged)

| Role                 | Email                     | Password     |
|----------------------|---------------------------|--------------|
| Super Administrateur | `admin@elimtiyaz.dz`      | `admin123`   |
| Agent Financier      | `financial@elimtiyaz.dz`  | `fin123`     |
| Enseignant           | `teacher@elimtiyaz.dz`    | `teach123`   |
| Personnel de Soutien | `support@elimtiyaz.dz`    | `support123` |
| Responsable          | `manager@elimtiyaz.dz`    | `manager123` |
| Acheteur             | `buyer@elimtiyaz.dz`      | `buyer123`   |
| Chauffeur            | `driver@elimtiyaz.dz`     | `driver123`  |
| Magasinier           | `warehouse@elimtiyaz.dz`  | `warehouse123` |
| Ouvrier              | `worker@elimtiyaz.dz`     | `worker123`  |

## Verification commands

```bash
# Type-check the entire codebase
npm run typecheck

# Run the full test suite
npm test

# Start the Vite dev server (renderer only)
npm run dev

# Start the full Electron app in dev mode
npm run electron:dev
```

All three verification commands pass with zero errors as of this iteration.
