# T-047 — Desktop Supabase repository migration — scoping inventory (25th session, 2026-09-04)

Agent-side scoping for T-047 (ARCH-001). The task was marked "Needs Investigation —
needs product scoping": this document delivers the code-level half of that scoping
(the agent-verifiable part) so the remaining product decisions are as small and
concrete as possible.

## 1. Fresh inventory (code-verified 2026-09-04)

`getSupabaseRepositories()` (`elimtiyaz-desktop/src/infrastructure/supabase/supabase-repositories.ts`)
spreads `mockRepositories` and overrides **24 slots** with Supabase-backed
implementations (auth, userAccounts, approvals, parents, students, payments,
ledger, installments, debt, dashboard, academicYears, classes, subjects, grades,
attendance, homework, promotion, audit, notifications, personnel, departments,
overdueAlerts (T-080), expenses (T-093), chat (T-099)).

Of the 45 slots in the `Repositories` interface, **23 remain mock-backed in
Supabase mode** (not 26 as the audit snapshot claimed — T-080/T-093/T-099 closed
three of them after the audit):

`clubs, psychology, orthophonie, teachers, releve, pricing, workflows,
workflowRuns, aiConfig, backups, shifts, schedules, tasks, workforceAttendance,
leaveRequests, performanceReviews, onboarding, suppliers, purchaseRequests,
deliveries, inventory, warehouseTasks, calendar`

Every one of the 23 has at least one live UI call site (verified via
`rg "repos.<slot>"` — zero dead slots; even the smallest have 1 screen).

## 2. KEY FINDING — the backend schema already exists for 19 of 23

The canonical migration chain (65 files, 0001–0068, zero drift) already declares
tables for 19 of the 23 mock-backed slots. The mock leak is NOT blocked on schema
work for most of the surface — it is blocked on adapter work only:

| Mock-backed slot | Existing canonical table(s) |
|---|---|
| releve | `releve_entries` |
| pricing | `pricing_configs`, `discounts`, `discount_applications`, `additional_services`, `complementary_services`, `grade_level_tuition`, `transport_destinations`, `service_enrollments` |
| workflows | `workflows` |
| workflowRuns | `workflow_runs`, `workflow_audit_links` |
| aiConfig | `ai_provider_configs`, `ai_request_logs` |
| backups | `backup_archives` |
| shifts | `shifts` |
| schedules | `schedules` |
| tasks | `tasks`, `task_attachments`, `task_comments` |
| workforceAttendance | `workforce_attendance_events` |
| leaveRequests | `leave_requests` |
| performanceReviews | `performance_reviews` |
| onboarding | `onboarding_states` |
| suppliers | `suppliers` |
| purchaseRequests | `purchase_requests` |
| deliveries | `deliveries` |
| inventory | `inventory_items`, `inventory_transactions` |
| warehouseTasks | `pending_receipts`, `pending_dispatches` |
| calendar | `calendar_events` |

## 3. Classification (per T-047's (a)/(b)/(c) scheme)

### (a) PORT — adapter over existing tables (19 slots, no schema work needed)
All of §2's table. Evidence-based port priority (write-paths users believe are
persistent, cross-platform consistency impact first):

1. **calendar** — WEBSITE reads `calendar_events` (`calendar-view.tsx`,
   `dashboard-view.tsx`, `portal-queries.ts`); desktop writes go to the mock
   store → desktop-created events never reach the parent/website calendar and
   website events never show on desktop. Only slot with a verified live
   cross-platform read today.
2. **workflows + workflowRuns** — ANDROID pulls `workflow_runs` in its
   pull-sync (`PullSyncRepository.kt`) while desktop's writer is mock-backed →
   desktop-authored workflow state cannot be what Android reads.
3. **tasks / workforceAttendance / leaveRequests** — the three dashboards
   (worker/manager/buyer/warehouse/driver) are built on them; highest daily-use
   workforce surface.
4. **pricing** — Settings → Pricing is the source of tuition/discount truth the
   rest of the financial modules reference; mock writes are silent financial
   drift.
5. Remaining Group A (releve, aiConfig, backups, shifts, schedules,
   performanceReviews, onboarding, suppliers, purchaseRequests, deliveries,
   inventory, warehouseTasks) — port module by module per the standing rule:
   persistence across restart + equivalence where financial.

### (b) MODELING DECISION needed — backend partially exists (1 slot)
- **teachers** — `personnel` (+`roles`, `role_assignments`) is canonical; the
  mock Teacher is a personnel specialization. Decide: view over `personnel`
  filtered by role vs dedicated `teachers` table. Small ADR before porting.

### (c) PRODUCT SCOPING needed — no backend table exists (3 slots)
- **clubs, psychology, orthophonie** (therapy follow-ups) — no chain table at
  all. Owner must say whether the school actually runs these modules in
  production: port requires new schema (migration + RLS + EF review), or the
  UI keeps a "demo data" badge, or the modules are removed. These are the ONLY
  three items where "which modules does the school actually use" is the real
  blocker — and it is now scoped to exactly three tabs in the academics page.

## 4. What this changes about T-047

- T-047's blocker ("needs product scoping per module") is now reduced to a
  **3-tab product decision** (clubs/psychology/orthophonie) + **1 modeling ADR**
  (teachers). The other 19 slots need no owner input to start — the tables,
  RLS posture and cross-platform consumers already exist.
- ARCH-001's problem entry should be re-based on this inventory (23 slots, not
  26; expenses/chat/overdueAlerts were closed by T-093/T-099/T-080).
- Recommended execution order for whoever ports: calendar → workflows(+runs) →
  tasks/attendance/leave → pricing → rest. Each port follows ADR-002
  boundaries + persistence-across-restart test + equivalence where financial.

— Generated by the 25th-session agent (T-160 scoping investigation, no code changed).
