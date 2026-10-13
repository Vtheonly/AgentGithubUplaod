# T-527 — Live Verification Evidence (the owner's accounts/permissions/messaging mandate)

**Task:** T-527 · **Session:** 171st (2026-10-13) · **Status:** VERIFIED-LIVE
**Problems closed:** SEC-118 · WORKFORCE-521 · CHAT-306 · CHAT-307 (SEC-119 registered OPEN for a dedicated follow-up)
**Commits:** 4ccbb6a5 (registration) · 7a4d43ed (accounts) · 15701299 (channel) · dc9e402d (migration 0155) · 3092cea0 (E2E + migration 0156) · + the closeout commit

---

## 1. The branch precondition (the owner's "merge all branches into one main")

Verified at session open (2026-10-13): the remote carries **only `main`**; all 8 tags (`63rd-session-dashboard-statistics`, `T-372-sync110`, `session-72-fresh-infrastructure`, `supabase-remediation-2026-09-18`, `t-389-inspection-repair`, `t-400-personnel-live-parity-20260921-1709`, `t369-68th-session`, `v2026.09-CALC-final`) are ancestors of main (`git merge-base --is-ancestor` × 8, all true). The precondition was **already satisfied** — nothing to merge, nothing to delete. Per ADR-028's deletion rule this was re-verified with a `--prune` fetch before concluding.

## 2. The administrator (conditions #1–#2)

- Sign-in with the owner-pinned credential `admin@elimtiyaz.dz` / `elimtiyaz@admin2026`: **HTTP 200**, token issued (GoTrue password grant, re-verified in every probe round — the credential was NEVER rotated, §15.23).
- Profile `42e369e9-9f88-40a0-8434-ffd3b2c3ba8b`, status `active`, role `super_admin`, tenant `00000000-0000-0000-0000-000000000001`.
- `current_user_roles()` = `['super_admin']`; `current_user_permissions()` = **56 permissions** (the full matrix — every module, dashboards, financials, reports, settings, account management, expense approval, payroll, audit).

## 3. The three staff accounts (conditions #3–#5) — `scripts/t527-staff-accounts.py`

Created through the **canonical** `create-user-account` Edge Function (super_admin caller) with `personnel_id` — never bare SQL users (§15.86c), never pre-seeded profiles (§15.39b):

| Employee | Personnel code | Account | Profile id | Role |
|---|---|---|---|---|
| Adam Cherif | PER-2026-82FB27 | `adam.cherif@elimtiyaz.dz` | `0bd51bf0-b8b4-4324-93b8-1b198bfc887e` | worker |
| Mohamed Haddad | PER-2026-C74E11 | `mohamed.haddad@elimtiyaz.dz` | `5c8f4267-24e4-44d5-8b66-011d698b957b` | worker |
| Samir Khelifi | PER-2026-0EE9BF | `samir.khelifi@elimtiyaz.dz` | `2212cacc-7995-4b84-adf7-4ea62683895a` | worker |

- **22/22 checks GREEN** (first run): EF 200 ×3, `personnel.user_id` bound ×3, profiles `active`, `role_assignments` = worker ×3, personnel fields UNCHANGED (salaries 10 000/27 300/35 700 DA, positions, cash method, phones), the October `salary_payments` census unchanged (Adam `paid` 10 000 DA cash 2026-10-12; the other two no rows = pending).
- **Idempotency proven** (re-run): all three EF calls refused with **409 `personnel_already_linked`** — no duplicate accounts, profiles, or employee records on repeated setup.
- The **worker** role is the most restricted staff role carrying `submit_expense` (the 0023 matrix: `view_tasks` + `view_notifications` + `submit_expense` ONLY — verified live: `current_user_permissions()` returns exactly those 3). `support_staff` was rejected: its `view_financials`/`collect_payment` would violate the mandate's "cannot access confidential financial information".
- **Final credentials** (after the E2E D-section rotation through the users' own JWTs — the exact desktop changePassword path, sign-in-verified per account): delivered to the owner out-of-band (SEC-100: never in the repo, logs, or docs). Employees change them at first sign-in (Profile → Changer le mot de passe).

## 4. The expense-approval backend hardening (conditions #6–#10) — migration **0155** (SEC-118)

The three-layer bypass, live-probed BEFORE the fix:

1. `approve_expense`/`settle_expense` (0022, SECURITY DEFINER): **no caller verification**, EXECUTE granted to `anon` + `authenticated` + PUBLIC, caller-supplied actor ids — any caller could approve/settle any ticket in any profile's name.
2. The 0064 trigger's no-self-approval clause never bound `approved_by` to the ACTING user + the 0019 UPDATE policy lets submitters update own rows → a submitter could forge the admin as approver via plain PostgREST.
3. No reviewer gate on terminal transitions → submitters could self-reject/self-disburse.

The fix (0155, applied LIVE HTTP 201 with the T-091 atomic registration; census `registered:1, trigger_gate:true, rpc_gate:true, anon_revoked:true`):
- Both RPCs recreated with the **0055 caller verification** (service_role OR authenticated `super_admin`/`financial_officer`/`manager`) **+ actor binding** (the `p_*_profile_id` must equal `current_user_profile_id()` — even a super_admin cannot approve in another profile's name).
- The trigger recreated with **(d)** the reviewer gate on `approved_funds_released`/`rejected`/`disbursed` and **(e)** the anti-forgery clause (`approved_by` = the acting user). `settled_and_closed` deliberately NOT gated — the T-521 Android submitter-proof-settle flow (live-green the same day) is the proof-upload step ordered AFTER approval by the state machine with the 0008 receipt+amount invariants.
- `revoke execute … from anon, public` (the first apply's `anon_revoked:false` exposed the PUBLIC-grant inheritance — live-learned, completed to the 0137/0152 convention before the first push).

**EXECUTE-mode matrix (`scripts/verify_t-527.sql`, BEGIN→ROLLBACK zero-residue, §15.39 impersonation with the REAL account auth ids): ALL 24 CHECKS GREEN** —
- The worker: submit PASS · field-edit PASS · draft→submit PASS · forged-approver DENY (the reviewer gate fires first — defense in depth) · self-approval DENY · self-reject DENY · self-disburse DENY · RPC-approve DENY · RPC-settle DENY · cross-employee UPDATE 0-rows · cross-employee SELECT invisible (4/5) · own-proof settle PASS.
- The admin: approve PASS · reject-with-reason PASS · RPC-approve-as-self PASS · RPC-settle-as-self PASS · forging-a-third-party DENY · own-ticket self-approval DENY (the ddd case preserved).
- anon: EXECUTE `permission denied`.
- Re-run POST-0156: still ALL 24 GREEN (coexistence).

## 5. The Staff General channel (conditions #11–#17) — `scripts/t527-staff-channel.py`

- Channel `59b5d09b-1bbb-40ae-99aa-2202d04238f9`: code `STAFF-GENERAL`, name **Staff General**, type `group`, created by the admin through the exact ChatPanel insert path; **scope derived `internal` by the 0135 trigger** (every member holds an employee role — verified, not client-declared); exactly the 4 mandated members; not archived.
- Idempotent: deterministic code + insert-if-absent + membership reconciliation — the re-run took the already-exists path with zero duplicates.
- **22/22 checks GREEN**: the admin welcome message (the canonical `sendMessage` shape, `tenant_id` explicit — UPLOAD-104) persisted with author + timestamp; per-member reads through the RLS member gate (admin REST + ×3 staff impersonation probes = 1 channel + ≥1 message each); the parent non-member denial (0 channels).
- The **CHAT-307 discovery** (found during the E2E C2 probes, registered BEFORE the fix per §13): `chat_messages_insert`'s staff-author branch still carried the 0067 five-role office list — workers could be MEMBERS of every internal channel but could never SPEAK in a group channel (all three worker accounts 403'd). **Migration 0156** widened the branch to the 0105 nine-role employee set (applied LIVE HTTP 201, census `widened:true, author_binding_preserved:true`); every sibling policy audited and left as-is (channel insert's 9-role fallback, channel update's worker lockout, the 0075 SECURITY DEFINER notification fan-out, member-based message select).

## 6. The end-to-end acceptance round — `scripts/t527-e2e.py` — **40/40 GREEN**

Through the REAL stack (GoTrue + PostgREST + RLS + triggers) with the EXACT repository request shapes:

- **A (accounts/permissions):** the admin sign-in + super_admin/56-permission set; ×3 staff sign-ins; `current_user_roles() = ['worker']` and permissions = exactly `{view_tasks, view_notifications, submit_expense}` ×3; 3/3 personnel bindings; salaries + October statuses unchanged.
- **B (expenses):** each staff submits (born `pending_approval`, 201) and sees own status; Adam's approve-attempt **400** + reject-attempt **400** (direct API — the SEC-118 gates); the admin approves Adam's + rejects Mohamed's WITH a reason; Mohamed reads back the rejection reason; Samir's remains pending; Adam cannot see Samir's ticket (0 rows).
- **C (messaging):** the channel with 4/4 members; ALL FOUR participants send (201 ×4 — the three workers post proves 0156); a FRESH session reads the full 14-message history with all four authors + timestamps (persistence across logout/login); Adam reads Samir's staff-to-staff message; the admin↔Adam DM through `create_direct_channel` + delivery through Adam's own session; Adam cannot mutate the shared channel; the parent cannot see the staff channel (0); Adam cannot send as Samir (403, author binding).
- **D (password changes):** each account's password rotated through the user's OWN JWT (PUT `/auth/v1/user` — the desktop changePassword path) with each new credential sign-in-verified; finals delivered out-of-band.
- **E (data integrity):** personnel/salary census unchanged (24/24 personnel, 1/1 salary rows, Adam's 10 000.00 untouched); the only new rows are this round's clearly-marked evidence (+3 `T-527`-titled expense tickets — Adam's approved, Mohamed's rejected-with-reason, Samir's pending — left in place as the owner's visible evidence, purgeable; the DM idempotent +0/+1).

## 7. Residue inventory (what this task left in the live tenant, all clearly marked + purgeable §15.50)

- 3 auth users + 3 user_profiles + 3 role_assignments (worker) + 3 personnel.user_id bindings — **the deliverable**.
- 1 group channel (`STAFF-GENERAL`) + its messages — **the deliverable**.
- 1 internal DM channel (admin↔Adam) + its messages — the mandate's §5.2 DM evidence.
- 3 `T-527`-titled expense tickets (approved / rejected-with-reason / pending) — the acceptance evidence.
- 3 `user_account.create` audit rows + the transition-audit rows (append-only, §15.26 — the honest record).
- The initial-password values are DEAD (rotated in the D-section); no password exists in any repo file, log, or doc.

## 8. Verification ladder (desktop — on the final tree, 2026-10-13)

- `tsc --noEmit` (Layer 0): **clean, 0 errors** (run twice — standalone and inside the unified runner).
- `eslint`: **0 errors** (980 pre-existing warnings, none new).
- `check:migrations` append-only guard: **OK** (150 → 152 files, +0155/+0156 only).
- **Layer 1 — the full Vitest suite: 314 files passed / 0 failed, 5,182 tests passed / 0 failed** (the tree at HEAD incl. the concurrent T-521/T-523/T-525 sessions' suites — this task added NO vitest tests, so the baseline FILE stays at T-517's move; the concurrent sessions' additions are recorded in their own commits). METHOD NOTE: the 4-GiB container kills any SINGLE vitest process holding the whole suite (three full-run attempts died mid-suite — the kata-agent reaps the process group when cumulative jsdom memory crosses the cgroup ceiling), so the suite ran as 16 fresh-process chunks of ~20 files with the counts aggregated (`--maxWorkers=1` per chunk; every chunk exit 0). The chunked harness is /home/z/my-project/scripts/chunked-vitest.py (session-local, not a repo artifact — the constraint is environmental, not a repo defect; a beefier machine runs the unified `npm test` in one process, as the 170th session's recorded 313-file/5,167-test run proves).
- **Layer 2 — the financial-equivalence pipeline: GREEN, identical to the registered state** (desktop runner 810/0/10-errored of 820 [the zero-payment error-equivalence family], mirror 774/0/10/36-skipped, tier-4 784/820 equivalent 0 discrepancies, sanity 820/820 + canonical 319/319) — this task touched no financial engine.
- Layer 3 (environment-gated census: real Kotlin / backend / live-E2E): reported with reasons by the runner, as designed.

## 9. What remains

- **SEC-119** (OPEN, registered): `batch_register_family` + `purge_expired_backups` carry the same 0022 no-caller-verification shape — a dedicated follow-up task applies the 0055 recipe + anon/public revoke with live probes.
- The owner's eyeball pass: sign in as each staff member in the desktop app (Personnel → « Mes Demandes » for the expenses, « Messagerie Interne » for the channel, « Ma Rémunération » for the payslips), and as the admin (the pending queue in « Demandes & Dépenses » + the Finance expense drawer).
- The employees' first-sign-in password changes (the delivered finals are the working credentials until then).
