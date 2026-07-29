# Iteration 3+ — What's Left

> Updated roadmap after iteration 2. Items completed in iteration 2 are marked; remaining work is prioritized below.

## Priority legend

- **P0** — Critical, blocks production use or violates a hard plan rule
- **P1** — High, completes a major user workflow end-to-end
- **P2** — Medium, deepens an existing module
- **P3** — Low, future enhancement

---

## Iteration 2 — COMPLETED ✅

- ✅ Admin Pricing Configuration panel (P0) — `PricingConfig` entity, repository, Settings tab, full CRUD
- ✅ CRM Batch Registration modal (P1) — 4-step atomic wizard
- ✅ CRM Parent Detail Drawer (P1) — 4 sections, account adjustment modal
- ✅ Financials Counter Payment Modal (P1) — proof capture, receipt preview
- ✅ Financials Expense submit + detail with workflow (P1) — full Approve/Reject/Disburse/Settle
- ✅ Financials Installment Schedule tab (P2) — replaces ComingSoonCard
- ✅ Academics Class Detail page (P1) — 4 tabs
- ✅ Academics Roll Call screen (P1) — 30-second workflow with P/AE/AN/R
- ✅ Academics Grade Entry screen (P1) — inline-editable with live average recompute
- ✅ Academics Homework Push modal (P2)
- ✅ Personnel Detail Drawer (P2) — identity + weekly hours
- ✅ Personnel Releve tab (P2) — clock-in/out form

---

## Iteration 3 scope (next focus)

### A. CRM Student Detail Drawer — **P1**
Plan §04.05 — student slide-over with 4 tabs:
- Infos (identity, family links to parent drawer)
- Académique (Devoir 1/2/Examen grade book per term, history append-only)
- Présences (per-student attendance summary, 3+ absence alert badge)
- Paiements (individual vs family share balance)

### B. Receipt PDF generation — **P1**
Plan §07.05 — two formats auto-generated on payment:
- Recent Payment Receipt (single transaction, `RCP-2026-XXXXX`)
- Full Account Statement (complete ledger)
Use `pdf-lib` or `@react-pdf/renderer`. No manual "Generate Receipt" button — fires automatically on payment entry.

### C. Excel bulk import pipeline — **P1** (currently locked)
Plan §14 — 5-step desktop-only pipeline:
1. Select `.xlsx`
2. ExcelJS parse
3. Map headers (Student Name → `students.full_name`, Parent Contact → `parents.primary_phone`, etc.)
4. Validate (required fields, dup codes, parent links, valid grade codes)
5. Atomic bulk insert — if any row fails, entire import rolls back

Library restricted to import/export service modules only (no formula parsing in runtime code).

### D. Report export engine — **P1** (currently locked)
Plan §15 — three report types:
- Revenue Reports (multi-sheet XLSX)
- Outstanding Debt Reports (XLSX/CSV)
- Student Roster Exports (XLSX)
Apply RLS filters on export.

### E. Subjects directory + assignment to classes — **P2**
Plan §05 — currently the Subjects tab shows a flat list. Add:
- Subject CRUD (create / edit coefficient / archive)
- Class-subject assignment (assign teacher + weeklyHours + coefficient per class)
- Coefficient change triggers GPA recompute for affected students

### F. Homework history tab — **P2**
Plan §06 — currently shows ComingSoonCard. Build:
- List of past homework per class
- "Renvoyer" (re-push) button per item
- Acknowledged count display

### G. Class detail — Subjects/Attendance/Grades tabs deep — **P2**
Currently the 3 non-Élèves tabs show placeholders. Implement:
- **Subjects tab**: list of class_subjects with teacher, weeklyHours, coefficient
- **Attendance tab**: this-week summary (Present/Late/Absent counts), grouped by date
- **Grades tab**: latest grade per subject with D1/D2/Examen breakdown

### H. Audit log CSV/XLSX export — **P2**
Currently the Settings → Audit Log "Export CSV/XLSX" button is disabled. Wire it to a real export using a library like `xlsx` or `papaparse`.

### I. RBAC Matrix editor — **P2** (currently read-only)
Plan §02.07 — let SuperAdmin edit role → permission mapping from the UI. Updates write to a config table and trigger audit log.

### J. Profile screen — **P2**
Currently the profile menu in topbar navigates to Settings. Add a dedicated `/profile` route with:
- Header (avatar, displayName, email, role badge, tenant ID, session expiry)
- Permission grid (chip per granted permission)
- Recent activity (10 most-recent audit entries by current user)

---

## Iteration 4+ scope (future)

### K. AI integration — **P3** (currently locked)
Plan §11 — Groq (primary) + OpenRouter (fallback) + BYOK:
- Report Card Narrative Generator (teacher review mandatory before publish)
- Administrative Drafting Assistant
- Expense Anomaly Detector (signal, not verdict — already partially mocked)
- PII masking before API calls

### L. Workflow DAG editor — **P3** (currently locked)
Plan §10 — visual drag-and-drop canvas:
- Node library (Triggers / Conditions / Actions / Delays & Transforms)
- Kahn's algorithm cycle detection on every save
- Deploy to Supabase Edge Functions
- 2-click confirmation for one-click triggers

### M. AES-256 Backup system — **P3** (currently locked)
Plan §13:
- 24h backup cycle (cron 02:00 AM local)
- AES-256 encryption (key in separate secrets manager)
- Local + offsite vault (different physical locations)
- 365-day rolling retention
- Point-in-time restore UI

### N. Personnel Workflow monitor — **P3**
Plan §10 — read-only list of Edge Function / DAG runs with detail dialog.

### O. Arabic RTL polish — **P3**
- Verify all screens render correctly in RTL
- Add language switcher in Settings
- Test Arabic font loading
- Mirror sidebar / drawer / modal layouts

### P. E2E tests — **P3**
Plan §"Testing":
- Vitest unit tests for domain logic (grade formulas, aging buckets, RBAC evaluator, pricing computations)
- Playwright E2E for critical workflows (login, batch register, counter payment, roll call, grade entry, expense workflow)
- Validation tests for form schemas

### Q. Supabase adapter — **P3**
- Implement all 18 repository contracts (17 existing + PricingRepository) against `@supabase/supabase-js`
- Realtime subscriptions for `Observable<T>` reads
- RLS policy enforcement (server-side)
- Edge Functions for AI / DAG / audit insertion
- Storage signed-URL bucket for proofs/receipts

### R. Search index improvements — **P3**
The current Cmd+K search covers parents + students. Extend to:
- Payments (by receipt number)
- Expenses (by requestCode)
- Audit entries (by entity ID)
- Personnel (by name)
Recent searches persisted to localStorage (max 8 items).

### S. Performance: code-splitting — **P3**
Current bundle is 1.12 MB (321 KB gzipped). Add `manualChunks` in Vite config to split:
- `vendor-react` (React, ReactDOM, Router)
- `vendor-radix` (all Radix primitives)
- `vendor-charts` (Recharts)
- `vendor-i18n` (i18next + react-i18next)
Lazy-load feature hubs via `React.lazy()` so the initial dashboard load is faster.

### T. Mobile parity verification — **P3**
The plan mandates 100% read parity between desktop and mobile (Android). Verify every profile, ledger, debt metric, and student record visible on Desktop is also visible on Mobile. (Out of scope for the desktop rebuild itself, but worth tracking.)

---

## File-by-file impact preview for iteration 3

### New files

```
src/features/crm/student-detail-drawer.tsx          # 4-tab slide-over
src/features/financials/receipt-pdf.ts              # PDF generation service
src/features/financials/receipt-preview-modal.tsx   # Receipt viewer
src/features/academics/subjects-directory-tab.tsx   # Replace flat list with CRUD
src/features/academics/subject-assign-modal.tsx     # Assign subject to class
src/features/academics/homework-history-tab.tsx     # Replace ComingSoonCard
src/features/academics/class-attendance-tab.tsx     # Replace placeholder
src/features/academics/class-grades-tab.tsx         # Replace placeholder
src/features/academics/class-subjects-tab.tsx       # Replace placeholder
src/features/settings/rbac-matrix-editor.tsx        # Editable matrix
src/features/profile/profile-page.tsx               # Dedicated profile route
src/infrastructure/excel/import-pipeline.ts         # ExcelJS-based import
src/infrastructure/excel/export-engine.ts           # XLSX/CSV export
src/shared/components/data-table.tsx                # Standardized table primitive
src/shared/hooks/use-paginated-list.ts              # Pagination + filter hook
```

### Files modified

```
src/app/app-shell.tsx                                # Add /profile route
src/features/academics/academics-page.tsx            # Wire Subjects CRUD
src/features/academics/class-detail-page.tsx         # Replace placeholder tabs
src/features/settings/settings-page.tsx              # Wire RBAC editor
src/features/settings/audit-log-tab.tsx              # Wire CSV/XLSX export button
src/core/rbac/feature-registry.ts                    # Add new feature nodes
src/i18n/fr.ts + ar.ts                               # New strings
```

---

## Iteration 3 acceptance criteria

- [ ] Student detail drawer opens from CRM student list, shows all 4 tabs
- [ ] Receipt PDF generates automatically on payment creation (no manual button)
- [ ] Excel bulk import pipeline accepts .xlsx, validates, atomic-inserts students
- [ ] Report export engine produces XLSX/CSV for revenue/debt/roster reports
- [ ] Subjects directory supports create/edit/archive with coefficient changes
- [ ] Class-subject assignment works (teacher + weeklyHours + coefficient)
- [ ] Homework history tab lists past assignments with re-push button
- [ ] Class detail Subjects/Attendance/Grades tabs render live data
- [ ] Audit log CSV/XLSX export button works
- [ ] RBAC matrix editor allows SuperAdmin to modify role → permission mapping
- [ ] Profile screen shows user info + permission grid + recent activity
- [ ] All new mutations write audit log entries
- [ ] `tsc --noEmit` clean
- [ ] `vite build` succeeds
