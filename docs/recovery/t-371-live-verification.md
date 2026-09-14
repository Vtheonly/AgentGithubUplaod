# T-371 — Live Verification Evidence (WORKFORCE-501)

**Task:** T-371 — the admin account ↔ employee linkage + the employee self-service view.
**Date:** 2026-09-14 (70th session). **Actor:** session agent. **Live project:** `hkvkefubghbbotgnteir` (eu-west-1).

## 1. Scope of the live legs

The desktop-side verification (tsc / eslint / full vitest / build — all green, 3373 passed +23 new) is recorded in the task registry; this document records the LIVE backend legs:

1. Migration **0097** applied to the live DB atomically with its `schema_migrations` registration (the T-091/MIG-TOKENS pattern).
2. The **create-user-account** Edge Function redeployed with `personnel_id` support.
3. `verify_t-371.sql` — 8/8 invariants GREEN through the Management API SQL endpoint.
4. `scripts/t-371-linkage-e2e.py` — the full owner-mandate round-trip through the REAL stack (GoTrue + PostgREST + RLS + the RPC + the EF): **22/22 GREEN**, zero residue.

## 2. Migration 0097 — atomic live apply

Executed by `scripts/apply_0097_live.py` (repo: `elimtiyaz-desktop/scripts/`), which wraps the migration file + the `schema_migrations` INSERT in ONE transaction and runs pre/post-checks:

```
P2 OK: current overload = (p_auth_user_id uuid, p_role_code text, p_tenant_id uuid, p_reviewer_profile_id uuid, p_decision_note text)
P1/P2/P3 OK — applying 0097 atomically.
APPLIED (transaction committed).
C1 registration: OK (1)
C2 single 7-param overload: OK (... , p_decision_note text, p_personnel_id uuid, p_email text)
C3 unique index: OK (CREATE UNIQUE INDEX personnel_active_account_uq ON public.personnel USING btree (user_id) WHERE ((user_id IS NOT NULL) AND (deleted_at IS NULL)))
C4 execute lockdown: OK (authenticated=False, service_role=True)
RESULT: ALL GREEN
```

Pre-checks P1 (0097 unregistered), P2 (exactly one 5-param overload before), P3 (zero duplicate `user_id` bindings among active rows) all held — the unique index applied cleanly on the live data.

**Chain coordination (the concurrent agent):** the live chain moved between the session-open census (top 0096) and the apply — the concurrent agent registered **0098** (`student_documents_unification`, task T-372) and deliberately left **0097** free for this task (registered in the WORKFORCE-501 coordination note). The apply re-verified 0097 absent immediately before applying. The live chain is now …0095, 0096, **0097 (this task)**, 0098.

## 3. The EF redeploy

```
supabase functions deploy create-user-account --project-ref hkvkefubghbbotgnteir --no-verify-jwt
Deployed Functions on project hkvkefubghbbotgnteir: create-user-account
```

CLI v2.116.0 (re-provisioned at `/home/z/my-project/bin/supabase` — the container resets wipe it, per AGENTS.md §11.1).

## 4. verify_t-371.sql — 8/8 GREEN (BEGIN…ROLLBACK, zero residue)

Run through the Management API SQL endpoint (multi-statement, one session — quirk #3). Per-check output:

```
[PASS] C1_single_overload_7param — p_auth_user_id uuid, p_role_code text, p_tenant_id uuid, p_reviewer_profile_id uuid, p_decision_note text, p_personnel_id uuid, p_email text
[PASS] C2_old_5param_gone — 0 old-signature overloads remain
[PASS] C3_unique_index_valid — CREATE UNIQUE INDEX personnel_active_account_uq ON public.personnel USING btree (user_id) WHERE ((user_id IS NOT NULL) AND (deleted_at IS NULL))
[PASS] C4_rpc_binds_employee — profile=5166a42a-… (the fabricated probe row bound: personnel.user_id set + email backfilled, all inside the transaction)
[PASS] C5_cross_binding_rejected — "profile 5166a42a-… is already linked to another personnel (e2f54b2d-…)"
[PASS] C6_unknown_personnel_rejected — "personnel 9a858338-… not found in tenant 00000000-…-0001 (or deleted)"
[PASS] C7_unique_index_rejects_double_bind — duplicate key value violates unique constraint "personnel_active_account_uq"
[PASS] C8_rls_self_read_sees_exactly_own_row — seen=1
```

C8 uses the §15.27 RLS-impersonation convention (`SET LOCAL ROLE authenticated` + `request.jwt.claims` + the temp-table GRANT): a session whose profile is bound sees **exactly its own** personnel row through `personnel_self`.

## 5. The E2E round-trip — 22/22 GREEN

`scripts/t-371-linkage-e2e.py` (run `1789370051`). The flow IS the owner mandate: *"the account is properly associated with the selected employee from the moment it is created… when the employee logs in, they should see their own profile, tasks, responsibilities."*

| Leg | Check | Result |
|---|---|---|
| A1 | owner admin sign-in (the pinned credential) | PASS |
| A2 | admin profile + tenant resolved | PASS |
| B1 | probe employee created **unlinked** (run-unique `PER-PROBE-T371-*`) | PASS |
| C1 | `create-user-account` EF with `personnel_id` → **200** | PASS |
| C2 | response echoes `personnel_code` + `personnel_id` + name | PASS |
| D1 | **`personnel.user_id` = the new profile** (the binding, in-transaction) | PASS |
| D2 | `personnel.email` backfilled from the account email | PASS |
| D3 | profile `active` | PASS |
| D4 | role assignment exists (`worker`) | PASS |
| D5 | auto-created approval request resolved (`approved`) | PASS |
| D6 | audit `user_account.create` carries `personnel_id` (never the password) | PASS |
| E1 | **second account on the same employee → 409 `personnel_already_linked`** | PASS |
| F1 | probe task assigned to the ACCOUNT id exists | PASS |
| G1 | **the employee signs in with the initial password** | PASS |
| H1 | dossier query under RLS: `personnel?user_id=eq.me` → exactly the bound row | PASS |
| H2 | own task visible: `tasks?assignee_ids=cs.[me]` | PASS |
| H3 | **negative control**: the admin-only task stays INVISIBLE | PASS |
| H4 | own `user_profiles` row readable | PASS |
| I1–I4 | cleanup: tasks, profile+assignments+approval, auth user (id-in-path), probe personnel — zero residue | PASS |

Raw transcript (abridged):

```
C. create-user-account EF (with personnel_id)
  [PASS] C1 EF 200 — 200 {'data': {'auth_user_id': '9f122f63-…', 'user_profile_id': '5b2716be-…',
        'email': 't371-probe-1789370051@el-…
  [PASS] C2 employee echo in response — code=PER-PROBE-T371-1789370051 name=Probe T371 E2E
E. Duplicate-binding rejection
  [PASS] E1 second account on the same employee → 409 — 409 {'error': {'code': 'personnel_already_linked',
        'message': 'Cet employé est déjà lié à un autre compte (PER-PROBE-T371-1789370051)'}}
H. Employee self-reads under RLS (PostgREST)
  [PASS] H1 dossier query: personnel where user_id = me → exactly this row — 200 n=1
  [PASS] H2 own task visible (assignee_ids @> me) — 200 n=1
  [PASS] H3 negative control: the admin-only task stays INVISIBLE — 200 visible=1 leak=False
RESULT: 22 passed, 0 failed
```

## 6. Documented quirks re-confirmed

- The SQL endpoint's last-statement-only result surface (the details capture ran the script with the verdict select trimmed — noted in the run command).
- `to_jsonb('…')` needs an explicit `::text` cast in a comparison context (42804 polymorphic-type error otherwise) — the E2E script's F1 hit it and fixed it in place.
- `audit_logs` carries the EF payload in `after_json` (not `payload`) — the E2E's D6.
- GoTrue admin user-delete: ID in the PATH (200), the audit rows stay by design (§15.26 — append-only).
- Two aborted E2E runs left probe residue (the F1 42804 failure); both were fully cleaned by the documented cleanup path BEFORE the successful run, and the successful run verified zero residue itself (I4: `{'personnel': 0, 'profiles': 0}`).

## 7. Residuals (honest)

- The live `personnel` census at session open showed 1 active row (`mathfrance`) — **no real employee is linked yet**; the owner should link real accounts through the redesigned Settings → Comptes flow.
- The archived T-369 probe personnel rows (2, `is_active = false`) remain as the §15.26-class honest record; none carries a `user_id`.
- Linking an EXISTING account to an employee (post-creation binding, e.g. from the employee directory drawer) is NOT implemented — the mandate covers creation-time binding; the directory-side surface is a natural follow-up task.
