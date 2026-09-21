# T-400 — Personnel workforce live parity — LIVE verification (84th session, 2026-09-21)

> **Task:** connect/verify the Personnel UI/workflows (branch
> `fix/personnel-workforce-ui-parity`, PR #9) to the REAL Supabase backend
> (`vebfehrpzajhstyhinnw`) and prove the owner's full test matrix —
> authentication, role capabilities, persistence, RLS authorization, and
> realtime — end-to-end. No redesign, no parallel logic: everything reuses
> the existing repository/RPC/architecture paths.

## 1. Session-opening census (§15.11) — the handed-over report vs the live truth

The handed-over session report claimed *"The migration was already applied
to the live Supabase project during the session. So do not manually run
migration 0104 again against production."* — **this was FALSE**, and it
nearly prevented the work from happening:

| Claim in the handed-over report | Live census (Management API SQL endpoint, 2026-09-21) |
|---|---|
| 0104 applied to the live project | `schema_migrations` head = **0103**; no `0104` row |
| `respond_leave_clarification` RPC live | `pg_proc` → **does not exist** |
| — | `clarification_request`/`clarification_response` columns present (0095 ✅) |
| "workforce salary/absence realtime" implied live | publication = `audit_logs`, `salary_payments`, `staff_absences` only — **chat_channels / chat_messages / leave_requests / tasks NOT members** |
| (test claims) | 3 Personnel tests red on the pristine branch tip (see §5) |

**Lesson (also codified in AGENTS.md §15.41a):** a handed-over report is a
claim, not evidence — the §15.11 session-opening chain diff is the gate.

## 2. What was applied live (all atomic: BEGIN…COMMIT + registration, T-091 pattern)

| Migration | Content | Dry-run | Live apply | Post-verify |
|---|---|---|---|---|
| **0104** (branch draft completed: registration insert + `search_path = public`) | leave_requests select policy (+`financial_officer`, +`support_staff`, own-rows with tenant/`deleted_at` guards) · update policy (+`financial_officer`) · `respond_leave_clarification(uuid, text)` SECURITY DEFINER, ownership- and state-checked, `clarification_requested → pending`, grants = authenticated + service_role (anon + PUBLIC revoked) | HTTP 201, 0 errors | HTTP 201 | policies + RPC def + grants + registration row all verified via `pg_policy`/`pg_proc`/`routine_privileges` |
| **0105** | `create_direct_channel` gate widened to the full STAFF role set (0023 census minus parent/student): + `worker`, `buyer`, `driver`, `warehouse_worker` | HTTP 201 | HTTP 201 | gate contains `worker`; parents still excluded |
| **0106** | `supabase_realtime` membership: `chat_channels`, `chat_messages`, `leave_requests` (0085/0095 guarded pattern) | HTTP 201 | HTTP 201 | publication census: 6 members |

## 3. The two live defects found and fixed

### 3.1 The worker-side direct chat was dead live (403)

The Personnel worker dashboard's "message the supervisor" action calls the
canonical `create_direct_channel` RPC (0061) as the WORKER. 0061's staff
gate listed only `super_admin/manager/support_staff/financial_officer/
teacher` — every workforce-role employee got **HTTP 403 "only staff may
create chat channels"**. The gate's documented intent is to keep EXTERNAL
users (parents — read+reply by design via 0067) from initiating channels;
`worker/buyer/driver/warehouse_worker` are EMPLOYEE roles, so their
exclusion was an oversight of the 0061 role list. **0105** widens the gate
to the full staff set; parents/students remain excluded. No client change
was needed (the desktop already calls this exact RPC).

### 3.2 The Personnel realtime subscriptions were dead (REALTIME-105 class)

`SupabaseChatRepository` already subscribed to `postgres_changes` on
`chat_channels` + `chat_messages` — tables that were **not** publication
members: the subscription connects and never fires. **0106** adds
`chat_channels`, `chat_messages`, `leave_requests` to the publication
(guarded, idempotent) and `SupabaseLeaveRequestRepository` gains
`startRealtime()` following the exact chat-repository pattern (channel
`desktop-leave-requests-realtime`, refresh the shared cache, degrade
gracefully — the T-034 refresh-after-own-write still covers the writer's
own session). RLS unchanged: postgres_changes events are filtered by each
subscriber's own SELECT policies.

## 4. LIVE evidence — the owner's test matrix (63/63 + 20/20)

### 4.1 `scripts/t-400-personnel-e2e.py` — 63/63 GREEN (final run)

Through the SAME REST/RPC shapes the desktop repositories use, with three
probe accounts (worker / manager / financial_officer) created through the
app's own path (probe personnel via REST → `create-user-account` EF with
`personnel_id` → the 0097 `admin_create_user_account` binding):

- **Auth + identity chain (S1–S4):** all three roles sign in;
  `personnel.user_id` = the account's `user_profiles.id` (the T-371
  linkage); the EF path works live.
- **Request flow (R1–R12):** worker creates + reads own request; worker
  direct UPDATE → **RLS-filtered: HTTP 200, 0 rows, status unchanged**
  (§15.30b — the honest assertion shape); manager AND financial_officer
  see it (the 0104 widening); manager requests clarification; worker
  responds via the RPC → `pending` + response persisted; **fresh-session
  re-read proves persistence**; the RPC's state guard and ownership guard
  both reject correctly; manager approves; financial_officer decides own
  request (0104 update path).
- **Tasks (T1–T6):** created with `assignee_ids = [worker PROFILE id]`
  (the T-371 id-space rule); worker sees it, progresses
  `assigned → in_progress → needs_review` with the completion trail
  (`completed_by` = the profile uuid); persistence across fresh manager
  session; the non-assignee worker sees NOTHING and UPDATEs 0 rows while
  the row stays unchanged.
- **Attendance (A1–A3):** clock_in/break_start/break_end/clock_out all
  persist; **`recorded_by` = the PROFILE uuid, not a display name** (the
  identity-chain requirement); manager reads the worker's events.
- **Payroll (P1–P5):** `adjust_personnel_salary` + `record_salary_disbursement`
  RPCs as financial_officer; history persisted + finance-readable; worker
  sees OWN payments only; worker direct `salary_payments` insert → **403**.
- **Chat (C1–C5):** worker opens the DM (0105) → sends → manager replies →
  both read the full thread; worker posting AS the manager → **403** (0048
  author-membership check).
- **Cleanup (X1–X3):** zero-residue — see §6 for the convention.

### 4.2 `scripts/t-400-realtime-probe.mjs` — 20/20 GREEN (final run)

Two SEPARATE authenticated sessions (the matrix's two-window test,
automated): the MANAGER client's `postgres_changes` subscriptions received
- the worker's **chat message** event (1 event, zero reloads),
- the worker's **leave request** event (1 event, zero reloads),
- and the **dead control** (`tasks` — deliberately NOT a publication
  member) received **0 events** while REST still read the updated row —
  proving the probe can distinguish live from dead subscriptions.

### 4.3 Ctrl+O (OPS-321 / T-399) on this branch

`t-399-test-data-autofill.test.tsx` **23/23 GREEN** on the branch (the
generators pinned against the REAL validators); the 83rd session's live
e2e (the same generators through the real one-round-trip `batchRegister`,
447 ms, zero residue) remains the live evidence — re-runnable as
`scripts/t-399-autofill-data-live-e2e.ts`.

## 5. Local gates (on the committed tree)

- `tsc --noEmit`: **6 errors — the documented pre-existing baseline**
  (the concurrent layout-editor `editing`-prop fixtures, identical file
  set; zero new).
- `eslint`: **0 errors** (642 pre-existing warnings).
- FULL `vitest run`: **21 failed / 3572 passed / 5 skipped — byte-identical
  to the documented 83rd-session baseline.** At session open the branch
  carried 3 ADDITIONAL Personnel failures (proven pre-existing on the
  pristine tip 36d423d by a stash-run, i.e. the previous session's
  contract rewires shipped without updating the pinning suites):
  - `t-369-workforce-backend C2a` — pinned the OLD direct-UPDATE
    `respondClarification`; now pins the secured-RPC contract (exact
    `rpcCalls` assertion + a FakeClient `rpcSideEffects` hook modeling the
    server-side transition).
  - `t-369-payroll-ui` ×2 — pinned the hard-coded `2026-03` period; now
    derive `CURRENT_PERIOD` with the component's exact Africa/Algiers
    expression.
- `vite build`: **GREEN** (22.6 s; chunk-size warnings pre-existing).
  `npm run build` (= `tsc -b && vite build`) remains blocked by the SAME
  6 baseline errors in the concurrent agent's test fixtures — pre-existing
  on main, deliberately left in their scope (§15.14).
- `t-058` append-only guard: passes on the committed tree (ADD-only vs
  the chain; 0104's pre-application convention completion is documented in
  its commit — the draft was never on main nor applied before the fix).

## 6. New conventions / discoveries (persisted)

1. **NO DELETE policies exist** on `leave_requests`, `tasks`,
   `chat_messages`, `chat_channels`, `workforce_attendance_events`,
   `user_profiles`, `salary_payments`, `personnel` beyond the append-only
   triggers — RLS default-deny for EVERY authenticated role including
   `super_admin`, and PostgREST answers **HTTP 200 with an empty array**
   (§15.30b). A live probe's cleanup therefore goes through the SERVICE
   ROLE **and asserts the returned row COUNTS**, never the HTTP status
   alone. Codified in AGENTS.md §15.41b.
2. **GoTrue admin user-delete requires the service key in BOTH headers**
   (`apikey` + `Authorization`) — the publishable key in `apikey` gets 403
   even with a valid service bearer (§15.41c).
3. **The create-user-account EF wraps its success payload in a `data`
   envelope** — probe scripts must read `body.data.auth_user_id` (§15.41d).
4. Probe personnel with salary history stay ARCHIVED (the t-369
   convention — the append-only `salary_adjustments` trigger blocks the
   cascade delete); 5 archived T-400 probe personnel + their audit rows
   are the honest record. Everything else: zero residue (final census:
   leave_requests/tasks/chat/attendance/salary = 0 rows; profiles = admin
   only).

## 7. Residual / follow-ups

- **REALTIME-105 remains OPEN for the portal set** (notifications,
  installments, payments, homework, assessments) — T-337 keeps that scope;
  the desktop Personnel surfaces (chat + leave requests) are now live.
  `tasks` + `workforce_attendance_events` publication membership left for
  when a subscriber exists (adding members without consumers is dead
  weight).
- The migration-numbering note: the branch consumed 0104–0106; T-337's
  "next free 0104" note is stale — the next free number is **0107**.
- `workforce_attendance_events` INSERT checks tenant membership only (any
  authenticated member can punch for any personnel id) — observed,
  registered as a hardening follow-up (WORKFORCE-503), NOT changed here
  (no weakening, no unrequested behaviour change).
