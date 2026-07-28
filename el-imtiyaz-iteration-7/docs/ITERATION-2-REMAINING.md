# Iteration 2+ — What's Left

> Roadmap of remaining work, prioritized by plan criticality and dependency order.

## Priority legend

- **P0** — Critical, blocks production use or violates a hard plan rule
- **P1** — High, completes a major user workflow end-to-end
- **P2** — Medium, deepens an existing module
- **P3** — Low, future enhancement

---

## Iteration 2 scope (current focus)

### A. Admin Pricing Configuration panel — **P0**
Plan §"Administration" hard rule: _"All pricing must be configurable by administrators. Never hardcode payment values."_

The current mock layer hardcodes amounts. To comply:
- New domain entity `PricingConfig` (tuition by level, transport by tier T1/T2/T3, registration, monthly, discounts, penalties, additional services)
- `PricingConfigRepository` contract + mock implementation
- Admin UI in Settings → new "Pricing" tab
- Wire Financials flows to read from `PricingConfig` instead of constants

### B. CRM Batch Registration modal — **P1**
Plan §04.03 — 4-step atomic flow:
1. Parent info
2. N children (unlimited, "Add Another Child" button)
3. Billing config (reads from `PricingConfig`)
4. Review + atomic submit (`BEGIN…COMMIT` semantics)

Reusable modal pattern: `<BatchRegistrationModal open onOpenChange onSubmitted />`

### C. CRM Parent detail drawer — **P1**
Plan §04.05 — slide-over with sections:
- Identity (avatar, code PAR-…, contact, city tier)
- Children (horizontal scroll list, click → student detail)
- Finances (embedded ParentFinancialProfile — services, payments, balance, tranches, due dates)
- Actions (call / WhatsApp / email / PDF receipt / add another child / adjust account)

### D. Financials Counter Payment modal — **P1**
Plan §07 — counter payment workflow:
1. Searchable parent picker
2. Student picker (filtered by parent)
3. Amount + category + method (Espèces/Chèque/Virement)
4. Installment auto-suggest (oldest unpaid matching category)
5. Proof capture (mock file picker; mandatory for Check/Transfer)
6. Submit → receipt preview with "Partager le reçu"

### E. Financials Expense submit + detail — **P1**
Plan §08 — two-tier workflow:
- Submit Expense modal (title, description, amount, category, payee)
- Expense detail drawer with vertical timeline (Soumise → Approuvée → Décaissée → Justifiée)
- Status-gated action buttons (Approve/Reject/Disburse/Settle Proof)
- Anomaly badge rendering when `anomalyScore > 0.7`

### F. Academics Roll Call screen — **P1**
Plan §09.01 — 30-second workflow:
- Select class + date + session (Matin/Après-midi)
- Roster with 4-button row per student: P / AE / AN / R
- Sticky "Tous présents" button + absence counter
- Inline time selector when LATE
- Sticky bottom save bar → `recordRollCall()` + `alertAbsences()` if any non-Present

### G. Academics Grade Entry screen — **P1**
Plan §06.02 / §06.03:
- Inline-editable table (Élève | D1 | D2 | Examen | Moy.)
- Live `subject_average = (D1 + D2 + 2·Examen) / 4` recomputation per cell edit
- Sticky class-average header (passing/failing/missing counts)
- Term selector (T1/T2/T3)
- Score validation 0-20

### H. Academics Class detail view — **P1**
Plan §05 — 4 tabs:
- Élèves (roster with status chips)
- Matières (class_subjects with teacher, weeklyHours, coefficient)
- Présences (this-week attendance summary)
- Notes (latest grade per subject)

### I. Academics Homework Push form — **P2**
Plan §06 — teacher creates assignment:
- Subject dropdown (from class_subjects)
- Title + description + due date
- Attachment gallery (mock)
- Push history with "Renvoyer" re-push

### J. Personnel detail + Releve form — **P2**
Plan §09 — personnel detail with:
- Header card (avatar, status chips, contact)
- Weekly hours card with LinearProgressIndicator
- Releve log form (date, hoursIn, hoursOut, activity dropdown)
- Recent Releve section (append-only)

---

## Iteration 3 scope (future)

### K. Receipt PDF generation — **P2**
Plan §07.05 — two formats auto-generated on payment:
- Recent Payment Receipt (single transaction, `RCP-2026-XXXXX`)
- Full Account Statement (complete ledger)
Use `pdf-lib` or `@react-pdf/renderer`. No manual "Generate Receipt" button.

### L. Excel bulk import — **P2** (currently locked)
Plan §14 — 5-step pipeline:
1. Select `.xlsx`
2. ExcelJS parse
3. Map headers
4. Validate (required fields, dup codes, parent links, valid grade codes)
5. Atomic bulk insert

Library restricted to import/export service modules only.

### M. Report export engine — **P2**
Plan §15 — Revenue Reports (multi-sheet XLSX), Outstanding Debt Reports (XLSX/CSV), Student Roster Exports. Apply RLS filters on export.

### N. AI integration — **P3** (currently locked)
Plan §11 — Groq (primary) + OpenRouter (fallback) + BYOK:
- Report Card Narrative Generator (teacher review mandatory before publish)
- Administrative Drafting Assistant
- Expense Anomaly Detector (signal, not verdict)
- PII masking before API calls

### O. Workflow DAG editor — **P3** (currently locked)
Plan §10 — visual drag-and-drop canvas:
- Node library (Triggers / Conditions / Actions / Delays & Transforms)
- Kahn's algorithm cycle detection on every save
- Deploy to Supabase Edge Functions
- 2-click confirmation for one-click triggers

### P. AES-256 Backup system — **P3** (currently locked)
Plan §13:
- 24h backup cycle (cron 02:00 AM local)
- AES-256 encryption (key in separate secrets manager)
- Local + offsite vault (different physical locations)
- 365-day rolling retention
- Point-in-time restore UI

### Q. Personnel Workflow monitor — **P3**
Plan §10 — read-only list of Edge Function / DAG runs with detail dialog.

### R. Arabic RTL polish — **P3**
- Verify all screens render correctly in RTL
- Add language switcher in Settings
- Test Arabic font loading

### S. E2E tests — **P3**
Plan §"Testing":
- Vitest unit tests for domain logic (grade formulas, aging buckets, RBAC)
- Playwright E2E for critical workflows (login, batch register, counter payment, roll call)
- Validation tests for form schemas

### T. Supabase adapter — **P3**
- Implement all 17 repository contracts against `@supabase/supabase-js`
- Realtime subscriptions for `Observable<T>` reads
- RLS policy enforcement (server-side)
- Edge Functions for AI / DAG / audit insertion

---

## File-by-file impact preview for iteration 2

### New files

```
src/domain/model/pricing.ts                          # PricingConfig entity
src/domain/repository/pricing-repository.ts          # (added to repository.ts)
src/infrastructure/mock/pricing-seed.ts              # Default pricing config
src/features/settings/pricing-tab.tsx                # Admin pricing config UI
src/features/crm/batch-registration-modal.tsx        # 4-step wizard
src/features/crm/parent-detail-drawer.tsx            # Slide-over with 4 sections
src/features/crm/student-detail-drawer.tsx           # Slide-over with 4 tabs
src/features/financials/counter-payment-modal.tsx    # Counter payment workflow
src/features/financials/expense-submit-modal.tsx     # Submit new expense
src/features/financials/expense-detail-drawer.tsx    # Detail with workflow actions
src/features/financials/installment-schedule-tab.tsx # Replace ComingSoonCard
src/features/academics/class-detail-page.tsx         # 4-tab detail view
src/features/academics/roll-call-screen.tsx          # 30-second workflow
src/features/academics/grade-entry-screen.tsx        # Inline-editable table
src/features/academics/homework-push-modal.tsx       # Push assignment form
src/features/personnel/personnel-detail-drawer.tsx   # Detail with weekly hours
src/features/personnel/releve-tab.tsx                # Clock-in/out form
src/shared/components/drawer.tsx                     # Slide-over component (right-side panel)
src/shared/components/form-field.tsx                 # Label + error wrapper
src/shared/components/empty-state.tsx                # Already exists, may extend
src/shared/components/data-table.tsx                 # Standardized table primitive
src/shared/hooks/use-form-validation.ts              # Zod-based form validation hook
src/shared/hooks/use-debounce.ts                     # Debounce hook for search inputs
```

### Files modified

```
src/domain/repository/repository.ts                  # Add PricingConfigRepository
src/infrastructure/mock/mock-repositories.ts         # Add mock pricing repo
src/infrastructure/mock/seed-data.ts                 # Add default pricing config
src/infrastructure/repository-provider.tsx           # Expose pricing repository
src/features/crm/crm-page.tsx                        # Wire modals + drawer
src/features/financials/financials-page.tsx         # Wire modals + drawer
src/features/academics/academics-page.tsx           # Navigate to detail screens
src/features/personnel/personnel-page.tsx           # Wire drawer + releve tab
src/features/settings/settings-page.tsx             # Add Pricing tab
src/core/rbac/feature-registry.ts                    # Add pricing permission node
src/core/rbac/permissions.ts                         # Add ManagePricing permission
src/i18n/fr.ts                                       # Add new strings
src/i18n/ar.ts                                       # Add new strings
```

### Files deleted

None — iteration 2 only adds and modifies.

---

## Iteration 2 acceptance criteria

- [ ] Admin can configure tuition / transport / registration / monthly / discounts / penalties from Settings UI
- [ ] Adding a price does NOT require source code changes
- [ ] Batch Registration modal creates a Parent + N Students in one atomic operation
- [ ] Parent detail drawer opens from CRM list, shows all 4 sections
- [ ] Counter Payment modal collects payment, auto-suggests installment, generates receipt
- [ ] Check/Transfer methods enforce proof upload before submit
- [ ] Expense submit + 4-state workflow (submit → approve/reject → disburse → settle) works end-to-end
- [ ] Roll Call screen records 4 statuses, fires absence alert when any non-Present
- [ ] Grade Entry screen recomputes subject_average live as cells change
- [ ] Class detail view shows 4 tabs with live data
- [ ] All new modals validate before submission (Zod schemas)
- [ ] All mutations write audit log entries
- [ ] `tsc --noEmit` clean
- [ ] `vite build` succeeds
