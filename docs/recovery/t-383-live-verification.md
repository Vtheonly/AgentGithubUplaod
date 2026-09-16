# T-383 — Live Verification: the users-removal round-trip on BOTH Supabase projects (USER-500's live leg)

> 73rd session, 2026-09-16. The owner's mandate: "here are all the tokens you need FROM THE OLD
> infrastructure to test if it works, make sure it works" + "also ensure this works with new db
> too — the new one". Evidence below: **28/28 PASS on production `hkvkefubghbbotgnteir` AND
> 28/28 PASS on the fresh clone `vebfehrpzajhstyhinnw`**, plus the role-gate probe (a
> non-super_admin caller → 403) on both, plus the 15-EF anonymous-deny fleet sweep on both.

## The verified surface (T-381's Edge Function + the desktop wiring's server contract)

`supabase/functions/delete-user-account/index.ts` — deployed to BOTH projects
(`supabase functions deploy delete-user-account --project-ref <ref> --no-verify-jwt`, the
§11.1 documented pattern; the EFs enforce their own auth).

## The harness

`elimtiyaz-desktop/scripts/t-383-remove-users-e2e.py` (committed; the t-371-linkage-e2e.py
conventions: run-unique probe codes, honest error surfaces, zero-residue cleanup that KEEPS
the append-only audit rows §15.26, the Cloudflare User-Agent quirk, SQL-via-Management-API).

Run shape:

```
# OLD (production)
SUPABASE_ACCESS_TOKEN=sbp_… python3 scripts/t-383-remove-users-e2e.py
# NEW (the fresh clone — the owner's "ensure this works with new db too")
T383_REF=vebfehrpzajhstyhinnw SUPABASE_ACCESS_TOKEN=sbp_… python3 scripts/t-383-remove-users-e2e.py
```

## The matrix (identical 28 checks on each project)

| Leg | What | OLD | NEW |
|---|---|---|---|
| A1–A3 | Anonymous-deny on delete-user-account (no auth / garbage bearer / publishable-as-bearer → 401) | PASS ×3 | PASS ×3 |
| B1–B2 | Owner admin sign-in 200 (the pinned credential, §15.23 — no reset, no rotation) + tenant resolved | PASS | PASS |
| C1 | Self-deletion → **409 cannot_delete_self** | PASS | PASS |
| C2–C3 | A second super_admin probe account created via create-user-account + signs in | PASS | PASS |
| C4 | That super_admin tries to delete `admin@elimtiyaz.dz` → **403 owner_account_protected** (the OPS-310 lesson, live) | PASS | PASS |
| C5 | The owner admin survives | PASS | PASS |
| D1 | Probe account created via create-user-account WITH a probe personnel binding (the T-371 flow) | PASS | PASS |
| D2a–D2c | Pre-delete server state: personnel bound, probe parent bound to the auth id, role assigned | PASS ×3 | PASS ×3 |
| D3 | The probe user CAN sign in (the account is real) | PASS | PASS |
| D4 | `delete-user-account` EF → 200 with the profile echo | PASS | PASS |
| D5a | `user_profiles` gone | PASS | PASS |
| D5b | `role_assignments` cascaded away (0002 ON DELETE CASCADE) | PASS | PASS |
| D5c | `personnel.user_id` SET NULL (the 0009 FK) | PASS | PASS |
| D5d | The probe parent unbound (plain column, no FK — the EF's manual leg) | PASS | PASS |
| D5e | The pending approval request expired (the Inscriptions queue does not keep a ghost) | PASS | PASS |
| D5f | The `auth.users` identity deleted | PASS | PASS |
| D6 | The probe user can NO LONGER sign in (400) | PASS | PASS |
| D7 | `user_account.delete` audit written WITHOUT the password (SEC-100) | PASS | PASS |
| E1 | probe2 removed via the EF itself (the deleter flow works for the admin too) | PASS | PASS |
| E2 | `auth.users` back to the baseline (OLD 8, NEW 1) | PASS | PASS |
| E3–E4 | Zero probe profiles / personnel | PASS ×2 | PASS ×2 |

**Totals: 28/28 on OLD, 28/28 on NEW.**

## The extra role-gate probe (both projects)

A `worker`-role probe account tried to delete the admin → **403 forbidden, "Only super_admin
can delete user accounts"** (the SEC-107-class gate), then the admin removed the worker probe
via the EF (200) with zero residue. PASS on both projects.

## The fleet sweep (both projects, after the 15th EF landed)

All 15 EFs (the 14 of the 72nd session + delete-user-account) deny anonymous access →
**15/15 × HTTP 401 on OLD, 15/15 on NEW**. The full 61-probe `t-379-ef-fleet-matrix.sh`
re-run stays owner-gated on NEW (the fresh CRON_SECRET + the NEW project's service key are
dashboard-reveal-only, §11.1 #13) — the matrix script itself was updated to the 15-EF fleet
(ALL_EFS + STAFF_EFS) so the next full run covers the new EF.

## Live quirks discovered (persisted for the next agent)

1. **`account_approval_requests.auth_user_id` is UNIQUE and the 0002 trigger ALWAYS creates
   the row for every new auth user** — a probe script that INSERTs a second request for an
   existing auth id gets `23505 duplicate key`. The t-383 script's first run hit exactly this
   (fixed by UPDATEing the trigger-created row back to 'pending' instead of INSERTing). The
   EF itself is unaffected (it UPDATEs). Any future harness that wants a pending request must
   UPDATE, never INSERT.
2. **The Management API has NO user-delete route** (`DELETE /v1/projects/<ref>/auth/users/<id>`
   → 404) — auth-user deletion goes through the **GoTrue admin API**
   (`DELETE {BASE}/auth/v1/admin/users/{id}` with the service key, id in the PATH — the
   documented §15.28/t-359 convention). The aborted-run cleanup initially used the wrong
   path; the sandbox-side cleanup script now models the right one.
3. **GoTrue rate-limit breathing** (the known §11.1 #8): the harness sleeps 2 s before each
   user creation; two back-to-back runs minutes apart worked fine on both projects.

## Zero-residue statement

Both projects ended at their baseline auth.user counts (OLD 8, NEW 1), zero probe rows in
`user_profiles` / `personnel` / `parents`. The `audit_logs` rows from the runs REMAIN by
design (append-only, §15.26) — they are the honest record of the verification.

## What this closes

- USER-500 → **VERIFIED** (the live leg was the last open item of T-381; the desktop gates
  were already TESTED with 16/16).
- The EF-fleet census on BOTH projects is now **15 EFs** (the credentials doc §9.5 and the
  72nd-session census say 14 — updated by this session's change-log entry).
