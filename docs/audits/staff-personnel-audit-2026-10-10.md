# Staff & Personnel Management — Comprehensive Section Audit (T-500, the 151st session)

> **Audit date:** 2026-10-10 · **Task:** T-500 (Area C of the owner's Messages/Pedagogy/Staff audit mandate, per the uploaded task specification — `§6` Staff and Personnel Management)
> **Application:** `elimtiyaz-desktop` (Electron + React + TypeScript) against the **live production Supabase** (`vebfehrpzajhstyhinnw`, eu-west-1)
> **Method:** full code-path tracing (UI → hook → repository → PostgREST/RPC → trigger → persisted row → read-back) **plus** a LIVE REST audit executed through the app's own repository shapes (`scripts/t500-staff-live-audit.py`): **67 PASS / 0 FAIL**, FAKE-marked run-unique probes, service-role cleanup with row-count assertions; the append-only `salary_adjustments` and `audit_logs` rows are kept (§15.26).
> **Evidence levels:** `[LIVE]` real backend write through the real stack · `[READ]` read-only live probe · `[CODE]` source-traced, not executed · `[TEST]` pinned by the vitest suite · `[MOCK]` mock-mode only.

---

## A. Executive assessment

The Staff section's **server-side backbone is genuinely functional**: personnel create/update, the 0095 payroll RPCs (salary adjustment + disbursement with server-computed amounts, idempotency, and **proper audit logging**), the leave-request lifecycle (submit → decide → the 0104 clarification loop with its ownership guard), the workforce punch, and the staff-absences justification state machine all worked through the app's exact repository shapes against the live backend `[LIVE]`.

The section's problems are concentrated in **four places**: (1) **task deletion is a silent no-op for everyone** — no `tasks_delete` policy exists, so even the super_admin's DELETE affects 0 rows with a 204 and the UI's success path is false (`WORKFORCE-512`, live-proven); (2) **the client-side personnel mutations write no audit rows** — the T-498 registered gap, now live-proven for create/update/tasks/leave/punches (`AUDIT-505`), in sharp contrast with the RPC paths which audit correctly; (3) **two dashboard id-space bugs make worker-facing task and leave surfaces structurally invisible** (`WORKFORCE-513/514`, code-proven); and (4) **`staff_absences` has no creation path in any UI** — the entire 0095 justification loop is unreachable in production (`WORKFORCE-515`). The live data state is essentially **unused**: 20 personnel rows (1 active, 0 account bindings), 0 tasks, 0 leave requests, 0 punches, 0 absences, 0 salary payments — every self-service surface (dashboards, punch, leave, payslips) stays empty until the owner binds accounts (Settings → Comptes).

What can be trusted: the `[LIVE]`-tagged workflows in §D. What remains broken or empty: the registered findings in §G.

---

## B. Audit coverage

**Code surfaces traced (read):** `src/features/personnel/**` (personnel-page + tabs, management/ — employee-directory, employee-form-modal, employee-profile-drawer, department-management, task-management, task-form-modal, task-detail-drawer, requests-management, staff-attendance-center, payroll-management, upcoming-payroll-payments, chat-panel, workflow-monitor, releve-tab; onboarding/ — wizard + 10 steps; dashboards/ — the role router + 7 role dashboards), `src/infrastructure/supabase/repositories/` — supabase-personnel-repository.ts (887 lines), supabase-task-repository, supabase-leave-request-repository, supabase-workforce-attendance-repository, supabase-audit-log-repository, supabase-onboarding-repository, supabase-shift-schedule-repositories, supabase-releve-repository, supabase-user-account-repository (0097 binding), `src/domain/repository/workforce-repository.ts`, `src/domain/calc/payroll/payroll-forecast.ts` (ADR-024), `src/features/settings/accounts-tab.tsx` + `create-account-modal.tsx` (the binding surface), and the governing migrations (0009, 0010, 0014, 0072, 0095, 0097, 0104, 0105, 0106 + 0019/0126 RLS).

**Live probes executed** (`scripts/t500-staff-live-audit.py`): sections A–L = 67 checks. **Not covered:** an actual Electron UI session (source-traced `[CODE]`); the 0097 `admin_create_user_account` RPC execution (EXECUTE is service-role-only — verified by the T-371/T-381 evidence and the EF contract; a live bind test would create a real account); the onboarding wizard mutations (the singleton gates the app — read-only census only, no mutation of the owner's real onboarding state).

---

## C. Feature inventory (REAL / MOCK / DEAD)

| Feature | Repo path | Backend objects | Status |
|---|---|---|---|
| Personnel hub + tabs + role gating + chat deep link | `onboarding.observe` | `onboarding_states` | **REAL** `[LIVE B7]` |
| Employee CRUD (create/update/deactivate) | `personnel.createPersonnel/updatePersonnel` | `personnel` INSERT/UPDATE (soft-delete via status) | **REAL** `[LIVE D6/E1/E3]` — **no delete UI** (T-498 residual); failures swallowed by AutoFormModal (no error banner) |
| Employee profile drawer | personnel/tasks/attendance/schedules reads + local payslip PDF | reads | **REAL** `[CODE]` — weekly-hours pair renders constants 40/0 in live mode (no columns) |
| Departments CRUD | `departments.*` | `departments` (0010) | **REAL repo, DEAD UI** — `DepartmentManagement` is imported by nothing; no mounted surface writes departments; onboarding doesn't either |
| Task management CRUD | `tasks.*` | `tasks` (0010+0074+0095), `task_comments` | **REAL** create/status/review/comment `[LIVE G1/G2]` — **delete is a silent no-op (WORKFORCE-512)**; manager-dashboard create uses the wrong id space (WORKFORCE-513) |
| Requests / leave management | `leaveRequests.submit/decide/requestClarification/respondClarification` | `leave_requests` + `respond_leave_clarification` (0104) | **REAL** `[LIVE H1–H4]` |
| Staff attendance center (punch + justification loop) | `workforceAttendance.recordEvent` + justification UPDATEs | `workforce_attendance_events` (0010), `staff_absences` (0095) | **REAL punch** `[LIVE I1]` — **staff_absences has no INSERT producer (WORKFORCE-515)** |
| Payroll management (adjust/pay/history) | `personnel.adjustSalary/recordSalaryPayment` | RPCs `adjust_personnel_salary`, `record_salary_disbursement` (0095) | **REAL** `[LIVE F1–F7]` — the RPC paths audit properly |
| Upcoming payroll payments (forecast) | `computePayrollForecast` (ADR-024) | read-side (personnel + salary_payments) | **REAL** `[TEST]` (T-412 parity) |
| Chat panel (internal messenger) | `chat.*` | 0061/0105 + T-499-verified | **REAL** (T-499: 45/0 live) |
| Workflow monitor | `workflowRuns.observe` | `workflow_runs` | **REAL** (read-only, capped 50) |
| Relevé d'activité tab | `releve.logEntry/observeByPersonnel` | `releve_entries` (0009, 0140) | **REAL** `[TEST]` (T-481) — `prevent_self_releve_entry` trigger backstop |
| Onboarding wizard (11 steps) | `onboarding.updateData/complete/reset` | `onboarding_states` (0010, 0142 singleton) | **REAL state only** — the collected departments/roles/shifts NEVER materialize into real tables; `reset()` is fire-and-forget from the admin dashboard |
| Role dashboards (7) | per-domain writes | per-domain tables | **REAL** with two id-space bugs: manager createTask (WORKFORCE-513), worker myLeave (WORKFORCE-514); driver dashboard has a latent wrong-key fallback |
| Account binding (personnel ↔ auth user) | `userAccounts.createAccount` → EF → RPC `admin_create_user_account` (0097) | service-role-gated | **REAL** `[TEST]` (T-371) — creation-time binding only; live bindings = 0 (owner-gated) |
| Performance reviews | `performanceReviews.*` | `performance_reviews` table exists, **mock repo, zero consumers** | **MOCK + DEAD** (ARCH-001) |

---

## D. Live verification results (the 67 checks, grouped)

### D.1 Census — the live data-state posture `[READ]`

| Table | Live count | Notes |
|---|---|---|
| personnel | 20 rows, **1 active**, **0 account bindings** | categories: administration 1, support 9 (incl. 2 FAKE soft-deleted probes, documented), teaching 10 |
| departments | 4 | the 0023 seed (ADM/MED/SUP/TCH) — **no mounted UI can add more** |
| tasks / task_comments | 0 / 0 | unused |
| leave_requests | 0 | unused |
| workforce_attendance_events | 0 | unused |
| staff_absences | **0** | **no producer exists (WORKFORCE-515)** — the justification queue is structurally empty |
| salary_adjustments / salary_payments | 7 / 0 | 5 real (T-369 era) + 2 FAKE probes (append-only, kept) |
| releve_entries | 0 | — |
| onboarding_states | 1 singleton | step 10, `completed_at` set — the wizard gate is open |
| performance_reviews | 0 | table exists; repo is mock; zero consumers |
| audit_logs (personnel.*) | 19 rows | **exclusively the RPC paths** (`personnel.salary_adjusted/disbursed`) + probe rows — the client-side gap quantified (AUDIT-505) |

### D.2 Personnel CRUD `[LIVE]`

- **D6** the exact `createPersonnel` insert shape (with `emergency_contact` as jsonb `{}` — the repo's null-safe mapping verified against the NOT NULL column) → 201.
- **E1** read-back: the created row queryable by code.
- **E2/E4 — AUDIT-505 live proof:** ZERO `audit_logs` rows for personnel CREATE and for UPDATE — the T-498 registered gap, now live-quantified.
- **E3** the `updatePersonnel` patch shape (position + salary) → persisted (200, values read back).

### D.3 Payroll — the 0095 RPCs `[LIVE]`

- **F1/F2** `adjust_personnel_salary` (type=raise, delta=5000) → 200; the **immutable `salary_adjustments` row** written with server-computed before/after (32000→37000).
- **F3** the **`personnel.salary_adjusted` audit row written server-side** — the RPC paths audit correctly (the contrast with E2/E4).
- **F4/F5** `record_salary_disbursement` (period 2026-10, cash) → 200; the `salary_payments` row with `net_paid=37000` (base + the period's adjustments netted server-side), `status='paid'`.
- **F6** idempotent re-record of the same period → still exactly ONE payment row (the 0095 upsert key).
- **F7** the **`personnel.salary_disbursed` audit row written**.

### D.4 Tasks `[LIVE]`

- **G1** the exact `createTask` insert shape (assignee_ids = user_profiles ids, `created_by_name` denormalized) → 201.
- **G2** ZERO audit rows for the task create (AUDIT-505).
- **G3/G4 — WORKFORCE-512 live proof:** the super_admin's DELETE → **204 with 0 rows affected** (PostgREST semantics: no `tasks_delete` policy → default deny, silently) — and the task row SURVIVES. The UI (task-detail-drawer) closes the confirm modal, toasts success, and the task is still there.

### D.5 Leave requests `[LIVE]`

- **H1** the exact `submit` insert shape → 201 persisted (`status='pending'`).
- **H2** the manager decide UPDATE (status/reviewed_by/reviewed_by_name/reviewed_at/decision_note — the 0104 policy shape) → approved.
- **H3** the clarification request UPDATE (the repo's exact shape: `status='clarification_requested'` + `clarification_request` + `updated_at`) → persisted.
- **H4** the 0104 `respond_leave_clarification` RPC **ownership guard works** (the admin is not the worker-owner → honest P0001 refusal; the RPC exists and is guarded).
- **H5** ZERO audit rows for the whole leave lifecycle (AUDIT-505).

### D.6 Workforce attendance `[LIVE]`

- **I1** the exact `recordEvent` punch shape → 201 persisted.
- **I2 — WORKFORCE-503 posture (live):** a PARENT-role tenant member's punch for the personnel → **403 RLS** — with the tenant resolver proven working for that caller (`current_tenant_id()` = the singleton tenant, `current_user_roles()` = ['parent']). **The live policy is TIGHTER than 0019's committed text** (drift — DRIFT-012): the committed policy (tenant-membership-only) is NOT what the live DB enforces. Net security effect: the open door is closed live, but the repo of record misdescribes the database.
- **I3** ZERO audit rows for the punches (AUDIT-505).

### D.7 Staff absences — the orphaned 0095 loop `[LIVE]`

- **J1** the INSERT works (the admin records an observed absence — the 0095 policy allows it) → 201.
- **J2–J4** the full justification state machine lands: admin request (`requested` + note) → worker submission (`submitted` + explanation) → decision (`accepted` + `is_excused=true`) — all trigger-guarded.
- **J5** the 0095 trigger **blocks the illegal `none→accepted` jump** (400) — the state machine is enforced server-side.
- **B5 census:** 0 rows exist — **no UI produces them** (WORKFORCE-515): the whole loop is unreachable from the app.

### D.8 Negative controls `[LIVE]`

- **K1** anon cannot read personnel (401/empty). **K2** a parent-role member sees ZERO personnel rows (RLS). **K3** a parent-role member cannot create personnel (403). **K4** a parent's task DELETE is the same silent no-op as the admin's.

### D.9 Cleanup `[LIVE]`

- **L1–L17** every probe row deleted with count assertions (staff_absence 1, punches 1, leave 1, task 1, salary payments 1, parent/role/profile/GoTrue user), with two **documented keeps**: the `salary_adjustments` row is **append-only by trigger** (P0001 even for the service role — the live enforcement of the 0095 invariant, pinned as check L6) and the personnel row is therefore SOFT-deleted (hard delete blocked by the cascade → the adjustment trigger; the row is FAKE-marked and vanishes from every active view — L12 proves 0 active residue). All audit rows kept (§15.26).

---

## E. Payroll data flows (source-traced `[CODE/TEST]`)

- **Write side:** the payroll surfaces write ONLY through the two 0095 RPCs (adjust + disburse) — both live-proven with correct amounts, idempotency, and audit rows `[LIVE F]`.
- **Read side:** `payroll-management` + `upcoming-payroll-payments` (personnel tab) + `financials/payroll-funding-card` + the Statistics tab all consume the SAME ADR-024 engine `computePayrollForecast({personnel, salaryPayments, now})` (`domain/calc/payroll/payroll-forecast.ts:262`) — eligibility = active + salary>0 + hired ≤ period end − terminated < period start (no proration); secured = paid+pending; remaining = max(0, expected−secured). Three-surface parity pinned by the T-412 suites `[TEST]`.
- **`salary_payments` stays OUT of `ledger_entries`** (the "hors masse salariale" historical basis — source-of-truth.md) — respected by the payroll code.

---

## F. Audit logging posture (the 0014 contract vs reality)

| Mutation family | Audit row? | Evidence |
|---|---|---|
| `adjust_personnel_salary` / `record_salary_disbursement` | **YES** (`personnel.salary_adjusted` / `.salary_disbursed`) | server-side, 0095 `[LIVE F3/F7]` |
| `create_direct_channel` (chat) | YES (`chat.channel_create`) | 0105 (T-499-verified) |
| Teacher registration (create/update/delete) | YES (`teacher.*`) | explicit `write_audit_log` calls `[TEST]` |
| Account creation/binding | YES (EF-side) | T-371/T-381 `[TEST]` |
| **personnel create/update/deactivate** | **NO** | `[LIVE E2/E4]` — AUDIT-505 |
| **tasks create/status/review/comment/delete** | **NO** (misleading "audit trail is server-side" comments in the repo) | `[LIVE G2]` |
| **leave lifecycle** | **NO** | `[LIVE H5]` |
| **workforce punches** | **NO** | `[LIVE I3]` |
| onboarding writes | **NO** | `[CODE]` |
| releve (Supabase mode) | **NO** (mock mode audits) | `[CODE]` |

The mock layer audits every workforce mutation (`setWorkforceAuditSink`) — a stark mock↔live divergence: mock mode shows audit entries for actions that produce none in live mode.

---

## G. Defect registry (new + updated this audit)

| ID | Severity | Status | Finding (one line) |
|---|---|---|---|
| **WORKFORCE-512** | High | REGISTERED (live-verified) | Task deletion is a SILENT no-op for everyone (no `tasks_delete` policy → DELETE affects 0 rows with 204 even for super_admin; the UI's confirm-success path is false) — decide: a role-scoped delete policy, or remove the delete affordance + use a status model |
| **WORKFORCE-513** | High | REGISTERED (code) | The manager dashboard's create-task form passes **personnel ids** into `assignee_ids` (the user_profiles id space) — tasks created there are invisible to their assignees everywhere (write-side sibling of T-371/WORKFORCE-509) |
| **WORKFORCE-514** | Medium | REGISTERED (code) | The worker dashboard's "my leave" feed + pending-KPI are keyed by the **account id** (`leave_requests.personnel_id` is a personnel FK) — always empty for real linked workers |
| **WORKFORCE-515** | Medium | REGISTERED (live+code) | `staff_absences` has NO creation path in any UI — the entire 0095 justification loop (live-proven working) is structurally unreachable; the Absences queue and the admin dashboard's "Absences non justifiées" KPI are permanently zero |
| **AUDIT-505** | Medium | REGISTERED (live-verified) | The personnel-family client mutations write NO audit rows (create/update, tasks, leave, punches, onboarding) — the T-498 standing residual, now live-proven; only the 0095 RPCs/teacher flows/account EF audit |
| **DRIFT-012** (shared) | Medium | REGISTERED (live-verified) | The live `workforce_attendance_insert` policy is TIGHTER than 0019's committed text (parent punch refused live) — same drift family as NOTIF-106 |
| **WORKFORCE-503** (update) | Low | MITIGATED LIVE (drift) | The open door ("any member can punch for any personnel id") is CLOSED by the live policy — but the committed text still describes the open door; capture the live policy SQL |
| **T-498 residual** (update) | — | live-proven | The "personnel audit-log + delete-UI gaps" quantified: E2/E4/G2/H5/I3 + the no-delete-UI posture (deactivate via the form status only) |

**Also observed (code-level, below the registration bar or already covered):** employee create/update failures are swallowed by AutoFormModal (throw with no catch — modal stays open, zero feedback) on 6 surfaces; task surfaces render `if (res.ok)` with no else branch (silent no-ops on RLS refusals); every workforce repo's `refresh()` catches silently (stale caches look current — mitigated by the T-034 TTL); `weeklyHoursTarget/Logged/avatarUrl` are fabricated constants in live mode (no columns; the form saves values that are silently dropped); the (dead) department form's `parentId` never persists; `task_attachments.storage_path` receives mock-era data URLs; the onboarding wizard's organizational choices never materialize into real tables; `deletePersonnel` has no UI caller (soft-delete via the status select only — consistent with the retention model, but undocumented in-app); `mobile_money` omitted from the payroll method select (DB allows it — harmless).

---

## H. Verification battery

| Gate | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | **0 errors** |
| Full suite (unified runner) | `npm test` | **4,828 / 0 / 5 — BASELINE-MATCHED**; Layer 2 GREEN; audit-only session, no code edits |
| Live audit | `SUPABASE_SERVICE_ROLE_KEY=… python3 scripts/t500-staff-live-audit.py` | **67 PASS / 0 FAIL** (result JSON: `t500-staff-result.json`) |

---

## I. Git / release status

Audit-only session — same delivery as the pedagogy audit (branch `t-500-section-audits` → no-ff merge to `main`; the T-499 push completed at session start).

---

## J. Outstanding issues and next priorities

1. **WORKFORCE-512** — add `tasks_delete` (scoped: super_admin/manager/creator) or replace the delete affordance with a status transition; surface the silent-failure branch in `task-detail-drawer.handleDelete` either way.
2. **WORKFORCE-513/514** — two one-line id-space fixes (manager form uses `p.userId`; worker feed keyed by the personnel id resolved via `personnel.observeByUserId`) + regression tests (the t-480 suite pins reads only).
3. **AUDIT-505** — add `write_audit_log` calls (or DB triggers) for personnel create/update, tasks, leave, punches — mirror the mock layer's audit sink contract; the 0014 RPC is live-proven and cheap to call.
4. **WORKFORCE-515** — add the "record an observed absence" producer (admin action in the staff-attendance center) that INSERTs the 0095 row; the justification loop is otherwise complete.
5. **WORKFORCE-503/DRIFT-012** — capture the live policy SQL for `workforce_attendance_insert` (+ `notifications_insert`) into a committed migration.
6. **The owner's activation step** — 0 account bindings: every self-service surface (7 role dashboards, punch, leave, payslips, tasks) stays empty until accounts are bound (Settings → Comptes, the 0097 flow — live-proven by T-371 tests, owner-gated).
7. Departments: either mount `DepartmentManagement` somewhere or route department creation through the onboarding wizard's completion (today the wizard's choices are inert).

**Statuses used:** PASS · FAIL (none open) · PARTIAL (account binding — RPC verified by tests, not executed live this session) · BLOCKED (policy-SQL capture — no DDL/inspection channel) · NOT TESTED (Electron UI interaction).
