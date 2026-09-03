# T-147 — Live round-trip verification: bind-activation-code EF (ADR-011)

- **Date:** 2026-09-03, 24th repair session
- **Task:** T-147 (deploys + verifies the T-146 consolidated EF end-to-end)
- **Verifier:** live Supabase project `hkvkefubghbbotgnteir` (eu-west-1), fresh access token
- **Script:** `/home/z/my-project/scripts/t147_live_roundtrip.sh` (persisted OUTSIDE the repos — it carries the service-role key + access token, per the T-140 convention)

## What was deployed

The consolidated canonical `bind-activation-code` Edge Function (hub source
`elimtiyaz-desktop/supabase/functions/bind-activation-code/index.ts`, T-146 / ADR-011),
deployed with `supabase functions deploy bind-activation-code --project-ref
hkvkefubghbbotgnteir --no-verify-jwt` (CLI v2.116.0) — **two deploy rounds**: the first
exposed a live bug in the EF (see Discovery 1), the second is the verified one.

## Result: 19/19 checks GREEN

| # | Check | Result |
|---|---|---|
| 1 | tenant resolved (tenants table) | PASS |
| 2 | test auth user created via admin API (`email_confirm: true`) | PASS |
| 3 | **pending user signs in (password grant) and receives a JWT** — the exact user class the pre-T-146 EF 401'd via `extractAuthContext` | PASS |
| 4 | POST `/functions/v1/bind-activation-code {code}` with the pending user's JWT → **HTTP 200**, payload carries `parent_id`, `parent_full_name`, `student_count` | PASS |
| 5 | `activation_codes.bound_to_auth_user_id` set + `bound_at` stamped (single-use marking) | PASS |
| 6 | `parents.auth_user_id` bound to the caller | PASS |
| 7 | `user_profiles.status` flipped `pending → active` (ADR-011) | PASS |
| 8 | `parent` role granted via `role_assignments` (active, not revoked) | PASS |
| 9 | `activation_code.bind` audit row written (note carries the code) | PASS |
| 10 | `account.activated` audit row written (ADR-011 activation trail) | PASS |
| 11 | A **second pending user** submits the same (consumed) code → **HTTP 404 `code_not_found`** ("Invalid or already-used activation code") — single-use enforced | PASS |
| 12 | The second user did **not** get bound to the parent | PASS |
| 13 | Anonymous call (no Authorization header) → **HTTP 401** | PASS |
| 14 | Now-active user's JWT + any code → **HTTP 409 `account_already_active`** (idempotent gate; the portal's success-refresh path) | PASS |
| 15 | Malformed code (`12ab`, second pending user) → **HTTP 400** `invalid_code_format` | PASS |
| 16 | Test rows cleaned (role assignments, approval request, profiles, activation code, parent, both auth users) | PASS |

The two audit rows (`activation_code.bind` + `account.activated`) are deliberately left in
`audit_logs` (append-only per plan §12) as live forensic evidence of this verification.

## Discoveries (persisted so the next agent does not rediscover them)

1. **PostgREST upserts cannot target the `role_assignments` partial unique index.** The
   arbiter is `role_assignments_active_uidx (user_profile_id, tenant_id, role_id) WHERE
   revoked_at IS NULL` — a PARTIAL index. PostgREST's `.upsert(..., {onConflict: "..."})`
   emits a plain `ON CONFLICT (cols)` with no predicate, which Postgres refuses:
   *"no unique or exclusion constraint matching the ON CONFLICT specification"* (live,
   first deploy round: HTTP 500 `role_grant_failed`). The EF now resolves existence
   explicitly (SELECT active grant → INSERT only if absent), matching the semantics the
   0047 RPC achieves with its predicate-qualified ON CONFLICT. **Rule: any client-side
   upsert against `role_assignments` must use select-then-insert, never `onConflict`.**
   (The website's pre-T-146 drifted EF carried this same latent bug — its activation
   path would have 500'd on the role grant the same way.)
2. **The pre-T-146 hub EF could never have served a pending user**: `extractAuthContext`
   (in `_shared/supabase.ts`) returns `null` for any profile whose `status !== 'active'`.
   Any future EF that must serve pre-activation users must verify the JWT and fetch the
   profile directly (as this EF now does), NOT use `extractAuthContext`.
3. **`handle_new_auth_user`** (the auth-users trigger) creates the profile as `pending`
   and files a pending `account_approval_requests` row — so admin-API-created test users
   exercise exactly the same path as real Google signups (verified: the round-trip's
   status gate saw `pending`).
4. **`audit_logs` is append-only even for service-role SQL** (plan §12 trigger): test
   cleanup must never DELETE from it — keep verification audit rows as evidence.

## Gaps / follow-ups

- The desktop issuance half (T-145) is code-fixed + unit-tested; the next REAL issuance
  from the desktop app (a staff click on "Code d'activation") is the only remaining
  end-of-chain confirmation — it requires the owner to run the desktop app once.
- The website's activation screen error mapping (T-153) is what turns these structured
  codes (`code_not_found`, `account_already_active`, …) into precise localized messages.
