# Supabase Backend Health Check Report — El-Imtiyaz
**Date:** 2026-08-30 · **Project:** hkvkefubghbbotgnteir (eu-west-1) · **Checked via:** REST API (service_role) + Auth Admin API + Edge Function probes

---

## 1. Infrastructure — LIVE & HEALTHY ✅

| Check | Result |
|---|---|
| Auth service (GoTrue v2.195.0) | healthy |
| REST API (PostgREST) | healthy, 98 tables/views/RPCs exposed |
| RLS protection (anon probe on 9 core tables) | **all protected** — 0 rows leak |
| Canonical financial RPCs deployed | `collect_and_allocate_payment`, `revert_payment_allocation`, `mark_payment_cleared`, `mark_payment_bounced` ✅ |
| Identity/RBAC RPCs | `current_user_roles`, `current_user_permissions`, `has_role`, `has_any_role` ✅ |
| Edge Function auth gate | `expire-pending-approvals` returns 401 "Cron secret required" without secret ✅ (SEC-105 fix confirmed live) |
| Total RPCs exposed | 58 |

## 2. Data Inventory — REAL production data

| Domain | Rows | Notes |
|---|---|---|
| tenants | 1 | El-Imtiyaz Boumerdès (`00000000-…-0001`), DZD, fr, Africa/Algiers |
| parents | 258 | all active, all have phone, only 1 has email |
| students | 389 | all active, 14 grade levels (1ap–5ap, 1am–4am, prescolaire, lycee) |
| classes | 24 | 12 subjects defined, class_subjects EMPTY |
| installments | 1273 | 105,639,600 DZD due / 54,960,350 paid (tuition 1167 + transport 106) |
| payments | 888 | 54,962,100 DZD, all `cash`, all `paid`, all have payment_number |
| ledger_entries | 1597 | charges 113,263,800 (391) · payments −54,972,100 (888) · adjustments −9,709,700 (318) |
| payment_allocations | **0** | ⚠ canonical waterfall NEVER executed |
| sync_queue | 3544 | all `synced`, 0 failed, 0 pending |
| notifications | 269 | all `alert`/`system`, ALL target_role=financial_officer, all unread |
| device_tokens | 3 | all android, 1 distinct user |
| auth users | 2 | admin@elimtiyaz.dz (confirmed, last login 2026-08-30) + test residue |
| activation_codes / parent_student_links / attendance / grades / homework / invoices / receipts / discounts_applications | **0** | academics & portal-activation world empty |

## 3. Findings (ordered by severity)

### 🔴 F-01 CRITICAL — payment_allocations empty (canonical waterfall never run)
All 888 payments were written through legacy `upsert_*_from_import` RPCs (Excel import path). `payments.installment_id` is NULL on every row. Consequences: no payment→installment traceability; `revert_payment_allocation` / `mark_payment_cleared` inoperable on existing data; the canonical engine (ADR-002) has never actually executed in production.

### 🔴 F-02 CRITICAL — three-way payment total disagreement (parent e3e90f1f)
- installments.amount_paid Σ = **54,960,350 DZD**
- payments.amount Σ = **54,962,100 DZD** (Δ +1,750 → parent e3e90f1f paid 1,750 DZD never applied to any installment)
- ledger payment entries Σ = **54,972,100 DZD** (Δ +10,000 → same parent: ledger holds 10,000 DZD of payment entries that do not exist in the payments table — likely orphaned ledger rows)

### 🔴 F-03 HIGH — ledger charges ≠ installment dues for 197/258 parents
Ledger charges total 113.26M vs installment dues 105.64M (Δ 7.62M DZD). Charges were imported into the ledger without corresponding installment rows, so any balance computed from installments disagrees with the ledger for 76% of parents. The canonical engine computes from the ledger (authoritative) — UI must do the same.

### 🔴 F-04 HIGH — mv_dashboard_kpis returns impossible numbers
`monthly_revenue = 21,380,256,900 DZD` (21.4 billion — ~390× the real 54.96M; a cumulative-sum bug). `overdue_debt = 55,089,700` **exceeds** `outstanding_debt = 48,582,000` (mathematically impossible). Do NOT consume this MV in any UI until fixed; compute KPIs from ledger_entries/payments directly.

### 🟠 F-05 MEDIUM — 59 overpaying parents (credit balances up to 244,000 DZD)
Parents paid more than total dues (top: 244,000 DZD excess). The schema has `payments.expected_amount`/`excess_amount` but both are NULL everywhere. Portal should surface "credit" from the canonical ledger balance.

### 🟠 F-06 MEDIUM — parents.first_name is an EMPTY STRING on all 258 rows
Import artifact: real names live in `display_name` (+`last_name`). Any UI/ordering that uses first_name shows blank. Use display_name.

### 🟠 F-07 MEDIUM — parent portal has zero eligible real users
0 activation_codes, 0 parents.auth_user_id bindings, 1/258 parents with an email. Google-OAuth portal access is currently theoretical. (Also `account_approval_requests` holds one expired test request.)

### 🟠 F-08 MEDIUM — academic world empty
attendance_records, grades, assessments, homework, class_subjects, parent_student_links all 0 rows. Portal academic views must render honest empty states, not fake data.

### 🟡 F-09 LOW — test residue
RPCs `_eq_test_fn`, `_eq_test_fn2` exposed; unconfirmed auth user `test.connection.supabase@gmail.com`; expired approval request. Cleanup recommended.

### 🟡 F-10 LOW — notifications all staff-targeted
All 269 target financial_officer; none target parents. Portal notifications view will be empty until staff send parent-targeted notifications.

### ℹ️ F-11 INFO — sync_queue is a 3,544-row all-synced audit trail; consider retention. device_tokens: 2 stale android tokens active for the same user (SYNC-104/105 concern: never unregistered on sign-out).

## 4. What this means for the portal UI redesign
1. Financial views MUST derive balances from `ledger_entries` (canonical) — not from installments, not from MVs (F-03/F-04).
2. Payment history joins payments ↔ ledger_entries; allocation detail (waterfall) is unavailable for existing data — the UI should show payment-level facts, not per-installment allocation fiction.
3. Parent name display: `display_name` everywhere (F-06).
4. Academic views: honest empty states with explanatory copy (F-08).
5. Notifications: read `target_user_id` + `target_role` (parents currently get none — empty state with explanation) (F-10).
6. Overpayment/credit: derive from ledger balance per student/parent (F-05).
