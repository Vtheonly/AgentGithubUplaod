# Iteration 3 — Done

> Snapshot of what shipped in iteration 3 of the El-Imtiyaz desktop rebuild.
> See `ITERATION-1-DONE.md` for the foundation, `ITERATION-2-DONE.md` for
> the workflow modules, and `ITERATION-3-REMAINING.md` for the original plan.

## Headline

Iteration 3 completed **every remaining item** from the iteration-3 roadmap
(A through J), AND added two cross-cutting improvements requested by the
specification:

1. **Unified Modal System** — every modal in the application now shares
   the same layout, header, footer, spacing, typography, button placement,
   form styling, validation behavior, animations, close behavior, loading
   states, error presentation, and success handling.

2. **Improved Tab Navigation** — a single, reusable `PageTabs` component
   replaces the previous tab implementations across every page. Modern,
   polished, consistent appearance with clear active indication, icon
   support, count badges, and three variants (elevated / underline / rail).

The app now runs end-to-end with a fully unified design language: any
modal feels like it belongs to the same design system regardless of which
feature opened it.

## Cross-cutting: Unified Modal System

### New shared primitive

- `src/shared/components/unified-modal.tsx` — single source of truth for
  all modal-style interactions. Supports TWO visual variants that share
  the same skeleton:
  - `variant="dialog"` (default) — centered overlay, used for create/edit
  - `variant="drawer"` — right-side slide-over, used for detail exploration

  Both variants share identical:
  - Header (icon + title + description + close button)
  - Body (scrollable, consistent p-5 padding, optional inline alert)
  - Footer (auto-built cancel + submit, or custom)
  - Loading state (disable buttons + spinner)
  - Error state (inline alert at top of body)
  - Success state (replace body with success view)
  - Animations (fade + zoom for dialog; fade + slide for drawer)
  - Close behavior (ESC + backdrop click configurable)
  - Confirmation pattern (2-click for destructive actions)

### Convenience exports

- `ConfirmModal` — preset for 2-click confirmation pattern
- `UnifiedModalHeader` / `UnifiedModalBody` / `UnifiedModalFooter` —
  sub-components for advanced composition
- `UnifiedModalAlert` — inline alert with three tones (error/warning/info)

### Refactored existing modals (5)

All five existing modals were rewritten on top of `UnifiedModal`:

| File | Before | After |
|------|--------|-------|
| `batch-registration-modal.tsx` | Manual Dialog + custom footer + manual loading | `UnifiedModal` with custom footer (4-step wizard) |
| `counter-payment-modal.tsx` | Manual Dialog + 2 stages + manual loading | `UnifiedModal` with custom footer (form/success stages) |
| `expense-submit-modal.tsx` | Manual Dialog + manual loading + manual error | `UnifiedModal` with auto footer + inline alert |
| `homework-push-modal.tsx` | Manual Dialog + manual loading + manual error | `UnifiedModal` with auto footer + inline alert |
| `see-details-modal.tsx` | Manual Dialog + manual tabs | `UnifiedModal` (hideFooter) + new PageTabs |
| `confirm-dialog.tsx` | Manual Dialog | Thin wrapper around `ConfirmModal` |

### Drawer primitive aligned

`src/shared/ui/drawer.tsx` — updated to share the EXACT same visual
language as `UnifiedModal variant="drawer"`: same padding (p-5), same
header (border-b + pr-12 for close button), same body, same footer,
same animations. Every drawer in the application now looks identical
to every modal.

### New modals built on UnifiedModal

All new iteration-3 modals use `UnifiedModal` directly:

- `excel-import-modal.tsx` — 5-stage bulk import wizard
- `student-detail-drawer.tsx` — 4-tab slide-over (variant="drawer")
- `subjects-directory-tab.tsx` — create/edit subject modal
- `class-subjects-tab.tsx` — assign-subject-to-class modal

## Cross-cutting: Improved Tab Navigation

### New shared primitive

- `src/shared/components/page-tabs.tsx` — modern, polished, reusable
  page-level tab navigation. Three variants:

  - **`elevated`** (DEFAULT) — segmented control with filled pill
    background for the active tab. Modern, scannable. Good for
    page-level navigation where tabs are co-equal peers.

  - **`underline`** — minimal underline variant for dense layouts and
    sub-tabs inside modals/drawers.

  - **`rail`** — vertical variant for left-rail settings pages.

  Every tab accepts: `label`, `icon`, `count`, `dot`, `disabled`, and
  an optional `description` (elevated variant only).

### Refactored existing pages (7)

All seven pages that use tabs were migrated to `PageTabs`:

| Page | Tabs |
|------|------|
| `dashboard-page.tsx` | Overview / Alerts (count badge) / Reports / Analytics |
| `crm-page.tsx` | Parents / Élèves / Inscription groupée |
| `academics-page.tsx` | Classes / Matières / Devoirs |
| `class-detail-page.tsx` | Élèves / Matières / Présences / Notes (with icons) |
| `financials-page.tsx` | Paiements / Tranches / Créances / Dépenses / Reçus |
| `personnel-page.tsx` | Annuaire / Relevé / Audit / Workflows |
| `settings-page.tsx` | Général / Tarification / Audit / RBAC / IA / Backup / Verrouillées (7 tabs with icons) |

Plus `see-details-modal.tsx` uses `PageTabs variant="underline"` for its
4 sub-tabs (Revenue / Departments / Demographics / Debt).

### Convenience helpers

- `PageTabsBar` — compact helper for simple cases (pass an array of
  tab descriptors instead of children)

## Iteration 3 features — all completed

### A. CRM Student Detail Drawer — P1 ✅

Plan §04.05 / §04.07 — 4-tab slide-over:

- **Infos** — identity card + family links (parent drawer bidirectional nav)
- **Académique** — grade book per term (D1/D2/Examen/Moy) + academic history
- **Présences** — attendance summary with 3+ absence alert badge (plan §09.03)
- **Paiements** — individual share + family balance

New file: `src/features/crm/student-detail-drawer.tsx`
Built on `UnifiedModal variant="drawer"` + `PageTabs variant="underline"`.
Bidirectional navigation: from student → parent drawer, from parent → student drawer.

### B. Receipt PDF generation — P1 ✅

Plan §07.05 — two formats auto-generated on payment:

- **Recent Payment Receipt** (single transaction, `RCP-2026-XXXXX`)
- **Full Account Statement** (complete ledger per parent)

New files:
- `src/infrastructure/pdf/receipt-pdf.ts` — `generatePaymentReceiptPdf()` + `generateAccountStatementPdf()` + `downloadPdf()` helper
- `src/features/financials/receipts-tab.tsx` — replaces ComingSoonCard in Financials page

Uses `pdf-lib` (MIT, no native deps, runs in browser + Node).
No manual "Generate Receipt" button — PDFs are downloadable from the
Receipts tab and from the counter-payment success stage.

### C. Excel bulk import pipeline — P1 ✅

Plan §14 — 5-step desktop-only pipeline:

1. Select `.xlsx`
2. ExcelJS parse
3. Map headers (parent_first_name → parents.first_name, etc.)
4. Validate (required fields, dup codes, parent links, valid grade codes)
5. Atomic bulk insert — if any row fails, entire import rolls back

New files:
- `src/infrastructure/excel/import-pipeline.ts` — `parseAndPreview()` + `commitImport()` + types
- `src/features/crm/excel-import-modal.tsx` — 4-stage wizard (select / preview / committing / done)

Uses `exceljs` (restricted to infrastructure/excel/ per plan §14).
Drag-and-drop file selection, full preview with validation errors,
audit-logged atomic insert.

### D. Report export engine — P1 ✅

Plan §15 — three report types + audit log export:

- **Revenue Report** — multi-sheet XLSX (synthèse, par méthode, par catégorie, transactions)
- **Outstanding Debt Report** — XLSX or CSV (per-parent breakdown by aging bucket)
- **Student Roster Export** — XLSX (per-class + per-level)
- **Audit Log Export** — XLSX or CSV (used by Settings → Audit tab)

New files:
- `src/infrastructure/excel/export-engine.ts` — `exportToXlsx()` (multi-sheet) + `exportToCsv()` + `downloadBlob()`
- `src/infrastructure/excel/reports.ts` — domain-specific report generators

Wired into:
- Dashboard → Reports tab (3 working exports: revenu-mensuel, creances-agees, effectifs-niveau)
- Settings → Audit Log tab (XLSX + CSV export buttons)
- Financials → Receipts tab (PDF generation)

### E. Subjects directory + assignment — P2 ✅

Plan §05 — Subject CRUD + class-subject assignment:

- **Subject CRUD** (create / edit coefficient / archive) with audit logging
- **Class-subject assignment** (assign teacher + weeklyHours + coefficient per class)
- **Coefficient change** documented in audit log as GPA recompute trigger

New files:
- `src/features/academics/subjects-directory-tab.tsx` — replaces flat list with full CRUD
- `src/features/academics/class-subjects-tab.tsx` — replaces placeholder in Class Detail

New repository contract methods (added to `SubjectRepository`):
- `createSubject(input)`
- `updateSubject(id, updates)`
- `archiveSubject(id)`

All three implemented in `MockSubjectRepository` with audit logging.

New audit actions (added to `AuditActions`):
- `subject.create`, `subject.update`, `subject.archive`

### F. Homework history tab — P2 ✅

Plan §06 — replaces ComingSoonCard:

- List of past homework per class (or all classes)
- "Renvoyer" (re-push) button per item — fires new push notification
- Acknowledged count display
- Past-due badge when `dueDate < now`
- Class filter

New file: `src/features/academics/homework-history-tab.tsx`

### G. Class detail tabs deep — P2 ✅

Replaced all three placeholder tabs in Class Detail page:

- **Subjects tab**: `ClassSubjectsTab` — list of class_subjects with
  teacher, weeklyHours, coefficient + assign-subject modal
- **Attendance tab**: `ClassAttendanceTab` — 7-day summary with
  Present/Late/Absent counts, grouped by date
- **Grades tab**: `ClassGradesTab` — latest grade per subject with
  D1/D2/Examen breakdown + class average + passing/failing counts

New files:
- `src/features/academics/class-subjects-tab.tsx`
- `src/features/academics/class-attendance-tab.tsx`
- `src/features/academics/class-grades-tab.tsx`

### H. Audit log CSV/XLSX export — P2 ✅

The Settings → Audit Log "Export CSV/XLSX" button is now wired to a real
export using `exportAuditLog()` from the report engine. Dropdown menu
lets the user choose between XLSX (Excel) and CSV formats.

### I. RBAC Matrix editor — P2 ✅

Plan §02.07 — replaced the read-only matrix with an editable one:

- Clickable toggle chips for each role × permission cell
- Grouped by domain (CRM / Pédagogie / Finances / Dépenses / Personnel / Audit & Config)
- Live count of permissions per role
- Reset to defaults button
- Save button (writes audit log entry)
- Read-only for non-SuperAdmin users (with lock notice)

New file: `src/features/settings/rbac-matrix-editor.tsx`

### J. Profile screen — P2 ✅

New route: `/profile`

- Header card: avatar, displayName, email, role badge, tenant ID, user ID, session expiry
- Permissions grid: chip per granted permission (28 max)
- Recent activity: 10 most-recent audit entries by current user

New file: `src/features/profile/profile-page.tsx`
Wired into `app-shell.tsx` and `topbar.tsx` (profile menu now navigates
to /profile instead of /settings).

## New dependencies

- `pdf-lib@^1.17.1` — PDF generation (receipt + account statement)
- `exceljs@^4.4.0` — Excel import/export (restricted to infrastructure/excel/)

## New shared components

- `unified-modal.tsx` — UnifiedModal + ConfirmModal + sub-components
- `page-tabs.tsx` — PageTabs + PageTabList + PageTab + PageTabContent + PageTabsBar

## New infrastructure modules

- `infrastructure/pdf/receipt-pdf.ts` — PDF generation service
- `infrastructure/excel/export-engine.ts` — XLSX/CSV export engine
- `infrastructure/excel/import-pipeline.ts` — Excel bulk import pipeline
- `infrastructure/excel/reports.ts` — domain-specific report generators

## New feature modules

- `features/crm/student-detail-drawer.tsx`
- `features/crm/excel-import-modal.tsx`
- `features/financials/receipts-tab.tsx`
- `features/academics/subjects-directory-tab.tsx`
- `features/academics/homework-history-tab.tsx`
- `features/academics/class-subjects-tab.tsx`
- `features/academics/class-attendance-tab.tsx`
- `features/academics/class-grades-tab.tsx`
- `features/settings/rbac-matrix-editor.tsx`
- `features/profile/profile-page.tsx`

## Routes added

```
/profile                          User profile (permissions + recent activity)
```

(All other iteration-3 features are modals/drawers/tabs — no new routes.)

## Repository contract changes

`SubjectRepository` (in `domain/repository/repository.ts`):
- Added `createSubject(input): Promise<Result<Subject>>`
- Added `updateSubject(id, updates): Promise<Result<Subject>>`
- Added `archiveSubject(id): Promise<Result<void>>`

All three implemented in `MockSubjectRepository` with full audit logging.

## Audit actions added

In `core/audit/audit-actions.ts`:
- `SubjectCreate = "subject.create"`
- `SubjectUpdate = "subject.update"`
- `SubjectArchive = "subject.archive"`

## Build verification

```
✓ tsc --noEmit           (clean)
✓ vite build             (2.6 MB bundle, 799 KB gzipped, 11.00s)
✓ electron tsc            (clean)
```

Bundle grew from iteration 2 (1.12 MB) due to pdf-lib + exceljs
additions. This is expected and acceptable. Future iteration could
add `manualChunks` in Vite config to split vendor libraries
(`vendor-pdf`, `vendor-excel`, `vendor-react`, `vendor-radix`,
`vendor-charts`, `vendor-i18n`) and lazy-load feature hubs.

## Plan compliance highlights

- ✅ "All modals throughout the application must be completely unified" —
  UnifiedModal primitive + refactored 5 existing modals + aligned drawer.tsx
- ✅ "Redesign the tab navigation to look more modern, polished, and
  professional" — PageTabs primitive with 3 variants + refactored 7 pages
- ✅ Student detail drawer opens from CRM student list, shows all 4 tabs (§04.05)
- ✅ Receipt PDF generates automatically on payment creation (§07.05)
- ✅ Excel bulk import pipeline accepts .xlsx, validates, atomic-inserts (§14)
- ✅ Report export engine produces XLSX/CSV for revenue/debt/roster reports (§15)
- ✅ Subjects directory supports create/edit/archive with coefficient changes (§05)
- ✅ Class-subject assignment works (teacher + weeklyHours + coefficient) (§05)
- ✅ Homework history tab lists past assignments with re-push button (§06)
- ✅ Class detail Subjects/Attendance/Grades tabs render live data (§05)
- ✅ Audit log CSV/XLSX export button works (§12)
- ✅ RBAC matrix editor allows SuperAdmin to modify role → permission mapping (§02.07)
- ✅ Profile screen shows user info + permission grid + recent activity
- ✅ All new mutations write audit log entries
- ✅ `tsc --noEmit` clean
- ✅ `vite build` succeeds

## Demo accounts (unchanged)

| Role                 | Email                     | Password     |
|----------------------|---------------------------|--------------|
| Super Administrateur | `admin@elimtiyaz.dz`      | `admin123`   |
| Agent Financier      | `financial@elimtiyaz.dz`  | `fin123`     |
| Enseignant           | `teacher@elimtiyaz.dz`    | `teach123`   |
| Personnel de Soutien | `support@elimtiyaz.dz`    | `support123` |

## Try it

```bash
cd el-imtiyaz
npm install
npm run dev          # Vite dev server
# or
npm run electron:dev # full Electron app
```

### Suggested click-through (iteration 3 additions)

1. Log in as `admin@elimtiyaz.dz`
2. **CRM → Élèves** → click any student → 4-tab drawer (Infos / Académique / Présences / Paiements)
3. From the student drawer → click "Voir le parent" → bidirectional navigation works
4. **CRM → Import Excel** → drop a .xlsx file → preview → atomic insert
5. **Finances → Reçus** → click any payment row → PDF downloads
6. **Finances → Reçus** → select a parent → "Télécharger le relevé" → multi-transaction PDF
7. **Pédagogie → Matières** → "Nouvelle matière" → create subject → archive icon → confirm
8. **Pédagogie →** click any class → Matières tab → "Assigner une matière"
9. **Pédagogie → Devoirs** → homework history with re-push button
10. **Tableau de bord → Rapports** → click download on "Revenu mensuel" → multi-sheet XLSX
11. **Paramètres → Journal d'audit** → Export dropdown → XLSX or CSV
12. **Paramètres → Matrice RBAC** → toggle permission chips → Save
13. **Topbar → profile menu → Mon profil** → permissions grid + recent activity

## Iteration 4+ scope (future, unchanged from iteration 3 remaining doc)

- K. AI integration (P3, currently locked)
- L. Workflow DAG editor (P3, currently locked)
- M. AES-256 Backup system (P3, currently locked)
- N. Personnel Workflow monitor (P3)
- O. Arabic RTL polish (P3)
- P. E2E tests (P3)
- Q. Supabase adapter (P3)
- R. Search index improvements (P3)
- S. Performance: code-splitting (P3) — bundle is now 2.6 MB; manualChunks recommended
- T. Mobile parity verification (P3)
