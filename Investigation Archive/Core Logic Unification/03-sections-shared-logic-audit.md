# Pedagogical / Élèves / Parents — Shared-Logic Audit — Session 2 (2026-11-19)

Scope: logic shared or duplicated between the pedagogical section (`features/academics`), the élèves (student) surfaces (`features/crm` student side + academics directories), and the parents surfaces (`features/crm` parent side + portal chat + financials family views). Read-only sweep.

## 1. What is already unified (the good baseline — do not rebuild)

1. **Global person navigation** (`shared/navigation/person-navigation-context.tsx`): `openStudent`/`openParent` + cross-section deep links (`/crm?studentId=`, `/financials?familyId=`, `/academics?studentId=&tab=grades`, `/financials?tab=debt-aging&parentId=`). Mounts the two global drawers once. Used by dashboard (Pareto), financials, academics, personnel, CRM. **This is the reference unification pattern of the whole app.**
2. **Standardized person actions menus** (`ParentActionsMenu`, `StudentActionsMenu`) — one 3-dot dialect everywhere (see UI audit `03`).
3. **Student/parent profile drawers** on `EntityDetailDrawer` (student-detail 5 sub-tabs: info/academic/attendance/documents/payments; parent-detail with year-history + children).
4. **Hub navigation**: all sections use `PageTabs` (crm 12, academics 16, financials 16, personnel 20, workflow 6 PageTab nodes — verified).

## 2. Duplicated logic between the three families (verified)

### 2.1 Person full-name derivation — 3+ dialects (extends S1 BUG-022)

- `shared/ui/parent-actions-menu.tsx:48-52`: `displayName || first+last.trim() || code || "Famille"`
- `core/ai/insights.ts:184-185`: `displayName ?? first+last` (misses empty-string displayName; S1 BUG-022)
- `core/ai/tools/visualization-tools.ts:262`: hand-composed teacher names
- Fix: one `shared/person-display.ts` (or `domain/model/person`) `personDisplayName()` + `personInitials()`; migrate the three sites + student-actions-menu equivalent.

### 2.2 Payment/installment views per family (the BUG-012 family)

Student payments view (`features/crm/student-detail/payments-tab.tsx`), parent year history (`features/crm/parent-year-history-section.tsx`), financials tabs (`installments-tab`, `payments-tab` via receipts), debt-aging drill-ins — each re-derives settled/overdue status with local predicates (`i.status === "paid"` at installment-schedule-tab:681; `status !== "paid"` payments-tab:85; payment-detail-drawer:310 `"unpaid"` alert) instead of the canonical INV-4 predicates. Runtime-reproduced divergence (t-502). **Unification = roadmap 1.2 (INV-4 predicates everywhere) + one shared `PaymentStatusChip`/`InstallmentRow` presentation pair** so the three families render identical verdicts AND identical visuals.

### 2.3 Attendance logic split (S1 BUG-014, re-verified)

Student attendance (roll-call-screen, class-attendance-tab, attendance-tab: UTC `toISOString().slice(0,10)` keys) vs workforce attendance (staff-attendance-center:162, worker-dashboard:40, payroll-management:66,84: `Africa/Algiers` local keys). Two date-key systems for the same "day" concept across the families. Unify on one local-date helper (§15.104 rule).

### 2.4 Follow-up/therapy drawers vs CRM drawers (UI-level, cross-ref UI audit `01`)

Psychology/orthophonie follow-up detail drawers (`features/academics/therapy/*-detail-drawer.tsx`) use `UnifiedModal variant="drawer"` while person drawers use `EntityDetailDrawer` — the pedagogical family's drawer dialect differs from the CRM family's for the same "open a record's detail panel" interaction. Consolidation per UI audit `01` §3 (both on ModalShell).

### 2.5 Student-directory duplication between CRM and academics

`features/academics/students-directory-tab.tsx` (Annuaire élèves) and the CRM students tab both list/filter students with their own table markup (part of S1 DUP-015's 39 hand-rolled tables). The academics directory consumes `/academics?studentId=` deep links (academics-page.tsx:100-115). Unification: one `StudentDirectoryTable` (DataTable-based) with a `variant: "crm" | "pedagogy"` prop; both hubs render it.

### 2.6 Contact/communication actions

`shared/utils/whatsapp.ts` (canonical) vs ParentActionsMenu hand-roll (DUP-022, roadmap 1.8) vs phone/email `window.open` in student menus. One `personContactActions(person)` helper feeding both menus.

### 2.7 Grade/notes surfaces

`class-grades-tab`, `grade-entry-screen`, `grade-levels-class-view`, student-detail academic-tab each present grade computations with local formatting (BUG-016 formula-string hardcode; gpa memo dep bug). Domain engines are canonical (S1 §4.2) — the duplication is presentational: one `GradeTable`/`SubjectAverage` pair would cover the four surfaces.

## 3. Unification plan (sections-specific)

1. **S-U1 (S):** `personDisplayName`/`personInitials` shared helper; migrate 4 sites.
2. **S-U2 (M, = roadmap 1.2 + new):** INV-4 predicates + shared payment presentation pair across the three families.
3. **S-U3 (S):** `StudentDirectoryTable` shared between CRM + academics directory (progresses DUP-015).
4. **S-U4 (S):** attendance date-key unification (BUG-014 fix, §15.104).
5. **S-U5 (S):** contact-actions helper (fold into roadmap 1.8).
6. **S-U6 (M, later):** `GradeTable`/`SubjectAverage` presentation pair.
7. **Keep unchanged:** person-navigation-context, actions menus, EntityDrawer-based person drawers, hub PageTabs.

## 4. Migration impact

All changes are feature-layer + one shared/helper module each; no repository contract changes; per-family T-tasks with the existing tab suites as verification (t-405 debt-aging UI, t-384/t-381 crm suites, academics suites). Android cross-check needed only for anything that changes persisted shapes — none of S-U1..U6 does (presentation + client-side helpers only), except S-U2 which is already flagged in roadmap 1.2 with Android verification.
