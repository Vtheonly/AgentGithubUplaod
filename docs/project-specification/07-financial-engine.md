# 07 — Financial Engine

The money-flow module: three payment methods, the PAID / UNPAID / PENDING lifecycle, multi-service installment billing (Tranches), audited discretionary adjustments (replacing scholarships), two PDF receipt formats, the debt dashboard with aging tiers, and the embedded Parent Financial Profile.

**Currency throughout: DZD (Algerian Dinar).** All monetary math uses 0.01 DZD precision.

---

## Payment Methods (Three Only)

| Method | French | Required Fields | Proof Upload | Initial Status |
| :--- | :--- | :--- | :--- | :--- |
| Cash | Espèces | Amount, date | None | `PAID` |
| Bank Check | Chèque | Check #, Bank Name, Issue Date, Expiry / Clearance Date | Mandatory check scan | `PENDING` |
| Bank Transfer | Virement | Transaction Reference ID, Source Bank | Mandatory transfer receipt scan | `PENDING` |

Non-cash requires:
- A **proof upload** (file upload on Desktop / camera scan on Mobile).
- **Structured notes / remarks** (e.g. "Check pending bank clearance", "Transfer delayed by bank", "Check expired — reissuance requested").

> **Critical rule:** Never mark a Check or Bank Transfer as `PAID` on submission. Non-cash payments must start as `PENDING` until bank clearance is confirmed.

---

## Payment Status Lifecycle

```
                 ┌─────────┐
                 │ UNPAID  │ ← invoice issued
                 └────┬────┘
                      │
        ┌─────────────┼─────────────┐
        │ cash        │ check/      │
        │ collected   │ transfer    │
        ▼             │ submitted   ▼
  ┌─────────┐         │        ┌─────────┐
  │  PAID   │◄────────┘        │ PENDING │
  └─────────┘                  └────┬────┘
       ▲                            │
       │ bank clears                │ check bounces /
       │                            │ transfer fails
       └────────────────────────────┘
              PENDING → UNPAID
```

### Transitions

| From | To | Trigger |
| :--- | :--- | :--- |
| `UNPAID` | `PAID` | Cash collected |
| `UNPAID` | `PENDING` | Check / transfer submitted |
| `PENDING` | `PAID` | Bank clearance verified |
| `PENDING` | `UNPAID` | Check bounces / transfer fails |

> **Critical rule:** Every status transition must be audit-logged with actor + timestamp. Never manually edit a status without logging a reason.

---

## Installment Module (Tranches — Paiement par Tranche)

Tuition and transport are billed as multi-tranche installment schedules. Each service has its own tranche structure:

| Service | Installment Structure |
| :--- | :--- |
| Core Tuition Fees | 3 tranches (Sept / Dec / Mar) OR 1 full-annual payment |
| Transportation Fees | 3 tranches by destination tier |
| Extracurricular Clubs | Term-based or activity-based blocks |
| Training / Internship Programs (Stages) | Milestone-based schedules |

The schedule engine:

- Calculates milestones, due dates, paid portions, and remaining unpaid balance per tranche.
- Auto-alerts on upcoming and overdue installment dates.
- Tracks partial payments (a tranche can be partially paid).
- Supports immediate 100% upfront settlement that bypasses the installment logic entirely.

### Official tuition tranche split

Per `Prices.md`, tuition is split 40% / 30% / 30% across the three official due dates:

- **1st tranche (Sept–Oct–Nov–Dec):** 40% of annual fee, due at registration.
- **2nd tranche (Jan–Feb–Mar):** 30%, due Dec 1–15.
- **3rd tranche (Apr–May–Jun):** 30%, due Mar 1–15.

### Official tuition due dates

- September 15 (1st tranche)
- December 15 (2nd tranche)
- March 15 (3rd tranche)

### Payment plan

Each student carries a `paymentPlan` field:

- `full_annual` — one installment covering 100% of the annual fee (eligible for the 10% early-annual discount if paid before June 30).
- `tranches` — the standard 3-tranche schedule.

See [`pricing/fee-schedule-2026-2027.md`](../pricing/fee-schedule-2026-2027.md) for the exact tranche amounts per grade level.

---

## Discretionary Account Adjustments (Replaced Scholarships)

The legacy Scholarship system is **completely removed** (see note 16 — Deprecations). All financial relief flows through audited Discretionary Account Balance Adjustments.

### Workflow

1. Admin opens a student or parent billing record.
2. Admin applies a discount or balance adjustment.
3. Admin selects an approval **reason code** from a controlled list (no free-text).
4. Admin enters an **administrative note** explaining the decision.
5. System logs the adjustment under the admin's identity with a full audit trail.

> **Critical rules:**
> - Every adjustment requires a reason code — no exceptions.
> - Every adjustment is fully audited (before / after JSON delta, actor, timestamp).
> - No scholarship tables or scholarship UI screens may be re-created.

---

## PDF Receipt Generation (Two Formats)

Receipts are auto-generated on payment entry — there is no separate "Generate Receipt" button.

### 1. Recent Payment Receipt

- **Scope:** single transaction only.
- **Fields:** Amount Paid, Payment Method, Date, Receipt ID (format: `RCP-2026-00042`), Billed Services.
- **Audience:** anyone needing quick proof of payment.

### 2. Full Account Statement / Balance Sheet

- **Scope:** complete historical payment ledger, itemized active services, total historical billed, cumulative paid, current net balance due.
- **Audience:** parent / accountant / auditor.
- **Access-controlled:** never expose to third parties without parent consent.

> **Critical rule:** Never send the Full Account Statement to a third party without explicit parent consent.

---

## Debt Dashboard

The Debt Dashboard lives in Hub 2 (Financial Portal) and has 4 sections:

### 1. Total Outstanding

- Cumulative debt in DZD.
- Trend vs. last month (↑ or ↓ indicator).

### 2. Aging Tiers

Debt is bucketed by how long it has been overdue:

| Tier | Meaning | Action |
| :--- | :--- | :--- |
| 0–30 days | Recent debt | Normal collection cycle |
| 31–60 days | Aging | Active follow-up required |
| 61–90+ days | Severely overdue | May trigger account restrictions (`FINANCIALLY_RESTRICTED`) |

### 3. Debtor Rankings

- Top 20 family debtors.
- Per-grade breakdown (debt distribution across Primaire / CEM / Lycee).

### 4. Actions

- Trigger Reminder Workflow (automated email / push to all debtors above a threshold).
- Apply Financial Restriction (lock a delinquent account).

---

## Parent Financial Profile

All financial views are **embedded directly inside the Parent Profile drawer** — never opened in a separate top-level tab.

The embedded financial profile includes:

- Real-time total enrolled services.
- Historical payments (receipt number, method, amount, date, status).
- Current outstanding balance.
- Installment schedules with due dates and statuses.
- Upcoming due dates.
- One-click receipt generation (Recent Receipt + Full Statement).
- Discretionary adjustment history.

> **Critical rule:** Never open financial views in a separate top-level tab. Financials live inside the Parent drawer to preserve the parent-identity context. A balance number without the parent's name and children is meaningless.

---

## Waterfall Payment Allocation

When a payment is collected, it is allocated across the parent's outstanding tranches using a **chronological waterfall**:

1. The payment fills the oldest unpaid tranche first.
2. Any remainder flows to the next unpaid tranche.
3. This continues until the payment is fully allocated or all tranches are satisfied.
4. Any excess (overpayment) is recorded as a `parent_credit` adjustment on the parent-scoped account — it does not silently reduce a future tranche.

### LIFO Reversal

When a payment is refunded (e.g. check bounces), the allocation is reversed using **LIFO (Last-In-First-Out)**:

1. The most recently allocated tranche is reversed first.
2. The tranche's `amountPaid` is decremented and its status is re-evaluated.
3. This continues until the full refund amount is reversed.
4. The reversal writes a new ledger entry that exactly negates the original payment entry.

> **Critical rule:** Never reverse a payment without also reversing the tranche allocations. A refunded payment that leaves tranches marked "paid" produces an inconsistent ledger.
