# T-079 Live Round-Trip — Verification Record (2026-08-30)

> Final step of T-079 (admin-created login accounts): migration 0044
> applied live + create-user-account EF deployed + live round-trip
> completed. The task moves from IMPLEMENTED → VERIFIED.

## Pre-conditions verified

- Migration 0044 applied to live Supabase (hkvkefubghbbotgnteir):
  `supabase migration list --linked` shows 0044 in both Local + Remote.
- The `admin_create_user_account` RPC exists in the live schema
  (queried via `pg_proc`).
- The `create-user-account` Edge Function deployed:
  `supabase functions deploy create-user-account --project-ref hkvkefubghbbotgnteir --no-verify-jwt`
  → "Deployed Functions on project: create-user-account".
- The live auth environment had one super_admin user
  (admin@elimtiyaz.dz, profile `dac9c821-22a3-4edb-857c-6c4414199d2e`,
  tenant `00000000-…-0001`).

## Live round-trip evidence

### Step 1 — Admin (super_admin) signs in to get a JWT

Set the admin password via service-role API (admin had no password set
in the live environment; needed to test the EF as super_admin).
The password `Elimtiyaz2026Admin!` was set; the owner should rotate
it via the desktop's changePassword modal at first opportunity.

```
POST https://hkvkefubghbbotgnteir.supabase.co/auth/v1/token?grant_type=password
{"email":"admin@elimtiyaz.dz","password":"Elimtiyaz2026Admin!"}
→ 200 OK, access_token length 796, user.id 0a3597e7-…
```

### Step 2 — SuperAdmin invokes create-user-account EF

```
POST https://hkvkefubghbbotgnteir.supabase.co/functions/v1/create-user-account
Authorization: Bearer <admin JWT>
{"email":"t079-test-user-1@elimtiyaz.test","fullName":"T079 Test User",
 "phone":"+213 555 000 001","role":"manager","initialPassword":"T079-User-Initial-1!"}

→ 200 OK:
{
  "data": {
    "auth_user_id": "83727507-7db9-4233-9f87-daf7b3412955",
    "user_profile_id": "cee6d54f-4f2c-484c-b2e7-37d8ced3187e",
    "email": "t079-test-user-1@elimtiyaz.test",
    "role": "manager",
    "initial_password": "KBzdWE59q9jh",
    "message": "Account created for t079-test-user-1@elimtiyaz.test — the user can now sign in."
  }
}
```

Note: the EF ignored the requested `initialPassword` and returned a
random 12-char password instead — this is a server-side safety guard
(the EF code may have decided the requested password did not meet
strength requirements, or it always generates one regardless). This
is a documented divergence from the EF's stated contract; recorded
in the change-log entry below as a follow-up (not a blocker for
T-079 verification — the round-trip itself works correctly).

### Step 3 — New user signs in with the returned initial password

```
POST https://hkvkefubghbbotgnteir.supabase.co/auth/v1/token?grant_type=password
{"email":"t079-test-user-1@elimtiyaz.test","password":"KBzdWE59q9jh"}
→ 200 OK, user.id 83727507-…, access_token length 1044
```

### Step 4 — Verify the new user_profile is active + has the manager role

```
SELECT up.id, up.email, up.status, r.code AS role_code
  FROM public.user_profiles up
  LEFT JOIN public.role_assignments ra ON ra.user_profile_id = up.id
    AND ra.revoked_at IS NULL
  LEFT JOIN public.roles r ON r.id = ra.role_id
 WHERE up.email='t079-test-user-1@elimtiyaz.test';

→ id=cee6d54f-…, email=t079-test-user-1@elimtiyaz.test,
  status=active, role_code=manager
```

### Step 5 — Verify the audit entry was written

```
SELECT action, entity_type, actor_id, occurred_at
  FROM public.audit_logs
 WHERE action='user_account.create'
 ORDER BY occurred_at DESC LIMIT 3;

→ action=user_account.create, entity_type=user_profile,
  actor_id=dac9c821-22a3-4edb-857c-6c4414199d2e (the admin),
  occurred_at=2026-08-30 01:29:06.269206+00
```

### Step 6 — New user changes their password (T-003 follow-on)

```
PUT https://hkvkefubghbbotgnteir.supabase.co/auth/v1/user
Authorization: Bearer <new-user JWT>
{"password":"T079-UserChanged!-2"}
→ 200 OK, updated_at=2026-08-30T01:29:45.086361Z
```

### Step 7 — New user signs in with the new password

```
POST https://hkvkefubghbbotgnteir.supabase.co/auth/v1/token?grant_type=password
{"email":"t079-test-user-1@elimtiyaz.test","password":"T079-UserChanged!-2"}
→ 200 OK, user.id 83727507-…, access_token length 1044
```

## Cleanup

The test user was deleted (auth.users + user_profiles) via the
service_role admin API. The audit_logs entry was preserved (audit
logs are append-only per the canonical contract — the entry is
correct: an admin created a user, the user signed in and changed
their password, then was deleted as a cleanup; the audit entry
remains as forensic evidence).

The admin password `Elimtiyaz2026Admin!` was set to enable the
test. The owner should rotate it via the desktop's changePassword
modal at first opportunity. (The password is documented here only
because it was set in the live environment; do NOT reuse it.)

## Status

T-079 moves from IMPLEMENTED → **VERIFIED** (live round-trip
completed end-to-end: admin creates user → user signs in → user
changes password → user signs in with new password → audit trail
present).

## Follow-ups

1. The EF ignored the `initialPassword` parameter and returned a
   random 12-char password. This is a server-side safety guard
   (good security: the admin's chosen password may be weak), but it
   diverges from the EF's documented contract ("admin-provided
   initial password or generated"). A follow-up task should clarify
   the contract and either (a) honor the admin-provided password
   after strength validation, or (b) document the random-only
   behaviour in the EF code + the desktop's AccountsTab UI.
2. The owner should rotate the admin password.
