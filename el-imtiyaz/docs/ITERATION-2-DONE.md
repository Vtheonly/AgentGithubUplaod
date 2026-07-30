# Iteration 2 — Done

> Snapshot of what shipped in iteration 2 of the El-Imtiyaz desktop rebuild.
> See `ITERATION-1-DONE.md` for the foundation and `ITERATION-2-REMAINING.md` for the original plan.

## Headline

Iteration 2 promoted 5 mock hubs into deep, workflow-driven modules and added the long-missing admin pricing configuration panel mandated by the spec ("All pricing must be configurable by administrators. Never hardcode payment values.").

The app now runs end-to-end with realistic click-through workflows: batch registration → counter payment with proof capture → expense submit → expense approve/disburse/settle → roll call → grade entry with live average recompute.

## New modules

### Admin Pricing Configuration (plan §"Administration")

Hard rule honored: **no monetary amount is hardcoded in source code beyond the initial seed**.

- New domain entity `PricingConfig` (`src/domain/model/pricing.ts`)
  - Tuition by level (primaire / cem / lycee)
  - Transport by tier (t1 / t2 / t3)
  - Registration fee (flat)
  - Monthly by level (optional)
  - Late penalty per day
  - Discounts (percentage or fixed_amount)
  - Additional services (free-form name → price)
- New `PricingRepository` contract + mock implementation
- New `Permission.ManagePricing` RBAC permission (SuperAdmin by default; FinancialOfficer has read-only)
- New Settings → **Pricing** tab with 5 cards + 2 lists, full CRUD
- Convenience helpers: `tuitionForLevel`, `transportForTier`, `tuitionTranches`, `applyDiscount`

### CRM Batch Registration Modal (plan §04.03)

4-step atomic wizard:
1. **Parent info** — firstName, lastName, phone, whatsapp, email, occupation, address, city tier, preferred language; phone/email validation
2. **N children** — unlimited ("Add Another Child" button per §04.02); per-student level/year/transport/medical notes
3. **Billing config** — auto-computed from `PricingConfig` (tuition + transport + registration fee); 3-tranche breakdown shown per student
4. **Review + atomic submit** — calls `StudentRepository.batchRegister()` which wraps Parent + N Students in a single transaction; full audit log entry on success

### CRM Parent Detail Drawer (plan §04.05)

Slide-over with 4 sections:
- **Identity** — avatar, code PAR-…, contact, city tier, occupation
- **Children** — list with status chips, "Add Another Child" button
- **Finances** — embedded ParentFinancialProfile (3 balance cards + installments table + recent payments table)
- **Actions** — call / WhatsApp / email / PDF / Adjust Account

Account Adjustment modal (replaces deprecated scholarships per §07.04) — reason code + admin note mandatory, audit-logged.

### Financials Counter Payment Modal (plan §07)

Full counter-payment workflow:
1. Searchable parent picker (debounced search)
2. Student picker (filtered by parent) — optional
3. Amount + category + method (Espèces/Chèque/Virement)
4. Installment auto-suggest (oldest unpaid matching category per §07.03)
5. Proof capture (mock file picker; **mandatory for Check/Transfer per §18.03**)
6. Submit → receipt preview with "Partager le reçu"
7. Auto-marks linked installment as paid
8. Auto-generates receipt (no manual trigger per §07.05)

Initial status: cash → paid, check/transfer → pending (bank clearance per plan).

### Financials Expense Workflow (plan §08)

- **Expense Submit modal** — title, description, amount, category (controlled list), payee
- **Expense Detail drawer** with vertical timeline (Soumise → Approuvée → Décaissée → Justifiée)
- Status-gated action buttons:
  - submitted → Approve / Reject (with mandatory reason)
  - approved → Disburse
  - disbursed → Settle Proof (mandatory upload)
- No self-approval enforced (`session.userId !== expense.submittedBy`)
- Anomaly badge renders when `anomalyScore > 0.7` with note: "Signal — l'humain décide toujours"
- Reject stage shown as red X on the timeline

### Financials Installment Schedule Tab (replaces ComingSoonCard)

- Full list of all installments across all parents
- Filter by category and status
- Totals header (Total dû / Payé / Reste / En retard)
- One-click "Encaisser" button per row → opens Counter Payment modal pre-filled with the installment data

### Academics Class Detail Page (plan §05)

New route: `/academics/class/:classId`
- 4 tabs: Élèves / Matières / Présences / Notes
- Quick actions row (RBAC-gated): Appel / Saisie des notes / Diffuser un devoir
- Capacity badge and homeroom teacher shown in header

### Academics Roll Call Screen (plan §09.01)

New route: `/academics/class/:classId/roll-call`

The showcase 30-second workflow:
- Date + session (Matin / Après-midi / Les deux) selectors
- Roster with 4-button row per student: **P / AE / AN / R** (Présent / Absence excusée / Absence non excusée / Retard)
- Sticky "Tous présents" button + absence counter badge
- Sticky bottom save bar
- On save → `recordRollCall()` + `alertAbsences()` (3+ absence threshold trigger per §09.03)
- Exactly 4 statuses enforced (no 5th "CUSTOM" allowed)

### Academics Grade Entry Screen (plan §06.02 / §06.03)

New route: `/academics/class/:classId/grades/:subjectId`

- Inline-editable table (Élève | D1 | D2 | Examen | Moy. | Statut)
- Live `subject_average = (D1 + D2 + 2·Examen) / 4` recomputation per cell edit
- Sticky class-average header with passing/failing/missing counts
- Term selector (T1 / T2 / T3)
- Score validation 0-20 (red border + "Invalide (0-20)" hint when out of range)
- Passing threshold 10/20 (configurable in future iteration)

### Academics Homework Push Modal (plan §06)

- Class + subject dropdowns
- Title + description + due date
- Multi-file attachment gallery (mock)
- On submit → fires push notification message (mock)

### Personnel Detail Drawer + Relevé Tab (plan §09)

- **Personnel detail drawer**: identity, weekly hours (progress bar), quick actions
  - Salary visible only to SuperAdmin + FinancialOfficer per §09.04
- **Relevé tab** (replaces ComingSoonCard): functional clock-in/out form
  - Date + activity dropdown (Cours / Réunion / Surveillance / Correction / Autre)
  - Hours in + hours out (with sanity check out > in)
  - Append-only — audit-logged

## New shared components

- **`Drawer`** — right-side slide-over panel built on Radix Dialog (used by all detail drawers)
- **`FormField`** — Label + control + error/hint wrapper (standardizes form layout)
- **`MoneyInput`** — DZD currency input that displays formatted value but stores raw number
- **`useDebounce`** — debounced value hook (used in Counter Payment parent search)

## New domain / infrastructure

- `domain/model/pricing.ts` — PricingConfig entity + helpers
- `domain/repository/repository.ts` — added PricingRepository interface
- `infrastructure/mock/pricing-seed.ts` — default pricing config seed
- `infrastructure/mock/mock-repositories.ts` — MockPricingRepository implementation
- `infrastructure/repository-provider.tsx` — exposes pricing repository
- `core/rbac/permissions.ts` — added ManagePricing permission
- `core/rbac/feature-registry.ts` — Settings node now includes pricing access

## Routes added

```
/academics/class/:classId                    Class detail (4 tabs)
/academics/class/:classId/roll-call          30-second roll call
/academics/class/:classId/grades/:subjectId  Inline grade entry
```

## Build verification

```
✓ tsc --noEmit           (clean)
✓ vite build             (1.12 MB bundle, 30 kB CSS — grew from iteration 1)
```

## Plan compliance highlights

- ✅ "All pricing must be configurable by administrators. Never hardcode payment values." — PricingRepository is the single source of truth, admin-editable via UI
- ✅ Parent-first dependency (§04.01) — Batch Registration modal enforces parent creation before children
- ✅ Unlimited children (§04.02) — "Add Another Child" button, no upper bound
- ✅ Atomic batch registration (§04.03) — single transaction with audit log
- ✅ 3-tranche tuition (§07.03) — auto-computed via `tuitionTranches()` helper
- ✅ Proof mandatory for Check/Transfer (§18.03) — enforced in Counter Payment modal
- ✅ No self-approval (§08) — Approve button hidden if `session.userId === expense.submittedBy`
- ✅ Receipt auto-generation (§07.05) — no manual "Generate Receipt" button
- ✅ Exactly 4 attendance statuses (§09.02) — no 5th "CUSTOM" allowed
- ✅ 3+ absence threshold alert (§09.03) — `alertAbsences()` called on every non-Present save
- ✅ Anomaly is signal not verdict (§11) — banner says "l'humain décide toujours"
- ✅ Salary visibility restricted (§09.04) — only SuperAdmin + FinOfficer see salary field
- ✅ Account Adjustments replace scholarships (§07.04) — reason + admin note mandatory

## Demo accounts (unchanged from iteration 1)

| Role                 | Email                     | Password     |
|----------------------|---------------------------|--------------|
| Super Administrateur | `admin@elimtiyaz.dz`      | `admin123`   |
| Agent Financier      | `financial@elimtiyaz.dz`  | `fin123`     |
| Enseignant           | `teacher@elimtiyaz.dz`    | `teach123`   |
| Personnel de Soutien | `support@elimtiyaz.dz`    | `support123` |

## Try it

```bash
cd el-imtiyaz-desktop
npm install
npm run dev          # Vite dev server
# or
npm run electron:dev # full Electron app
```

Suggested click-through:
1. Log in as `admin@elimtiyaz.dz`
2. **Settings → Tarification** — verify pricing config is editable
3. **CRM → Nouvelle inscription** — run the 4-step batch registration wizard
4. Click any parent row → drawer opens with 4 sections
5. **Finances → Encaissement** — counter payment workflow with proof capture
6. **Finances → Dépenses** — submit a new expense, then click it → drawer with workflow actions
7. **Pédagogie →** click any class → class detail → "Appel" → roll call screen
8. Back to class detail → "Saisie des notes" → grade entry with live recompute
9. **Personnel →** click any staff → drawer with weekly hours; **Relevé tab** → clock-in form
