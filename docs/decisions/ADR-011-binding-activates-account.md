# ADR-011 — Binding an activation code activates the account

- **Status:** Accepted (2026-09-03, 24th session)
- **Deciders:** Owner (explicit issue report: "When entering/copying an activation code for a new account on the website, the system rejects it … preventing users from activating and accessing their accounts")
- **Resolves:** UNKNOWN-001 (activation-bind contract) · closes CROSS-009 (the website's drifted EF duplicate), BUSINESS-008 (divergent post-bind semantics), SEC-104 (unsafe activation transitions) via task T-146
- **Amends:** none (supersedes the de-facto divergence between the two `bind-activation-code` Edge Functions)

## Context

The account-activation protocol (plan §02.08) has two server-side implementations with **contradictory post-bind behaviour**, documented since the audits as CROSS-009 / BUSINESS-008 and blocked on UNKNOWN-001:

- The **hub's canonical EF** (`elimtiyaz-desktop/supabase/functions/bind-activation-code/`) called the `bind_activation_code` RPC (parents.auth_user_id + single-use marking) and wrote an audit entry — but left `user_profiles.status = 'pending'`. The freshly-bound parent refreshed and landed back on the "enter your activation code" screen; entering the same (now consumed) code produced *"Invalid or already-used activation code"*.
- The **website's drifted EF copy** (`elimtiyaz-website/supabase/functions/bind-activation-code/`, deleted by T-146) additionally granted the `parent` role and flipped status to `'active'` — but with no audit entry, self-assigned role rows, and an unsafe transition: it activated **suspended and deleted** users too (SEC-104).

Layered on top (found during the 24th-session live diagnosis): the hub EF authenticated callers through `extractAuthContext()`, which **rejects every profile whose status ≠ 'active'** — i.e. it returned 401 to the very 'pending' users the endpoint exists for. Combined with the desktop's broken code issuance (ACT-200 — codes never persisted), the live portal showed every parent the same generic French error: *"Code d'activation invalide ou déjà utilisé."*

## Decision

1. **Binding an activation code ACTIVATES the account.** One successful bind = the parent's `user_profiles.status` flips `'pending' → 'active'`, the `parent` role is granted, and `approval_request_id` is cleared. This is the product semantics the owner's report requires: entering the code is *the* activation step for Path A (self-service), just as admin approval is for Path B.
2. **Exactly one EF implementation**: the hub's canonical `bind-activation-code` (shared helpers, dual body-key contract per CROSS-004, audit entries). The website's copy is deleted (the T-126 pattern — Edge Functions are hub-owned).
3. **Hardened status gates** (absorbing SEC-104): `active` → idempotent 409 `account_already_active` (the portal treats it as success and refreshes); `pending` → proceed; `suspended` → 403 `account_suspended`; `deleted` → 403 `account_rejected`. A bind can never resurrect a suspended/deleted account.
4. **Caller authentication happens in the EF itself** (verify the JWT, then fetch the profile): `extractAuthContext`'s active-only gate is deliberately NOT used on this endpoint because its callers are by definition not yet active.
5. **Audit trail**: two entries per successful bind — `activation_code.bind` (the canonical action name, entity = parent) and `account.activated` (entity = user_profile, records the status transition + role grant). Failures surface via `withAuditSurfacing` (SEC-001).

## Consequences

- Path A (code) and Path B (admin approval, `approve_account_request` 0044/0047) now converge on the same end state: active parent with the `parent` role and a bound family profile. `approve_account_request` remains the staff-side flow with its own guards (PARENT-101/102); the two paths do not overlap.
- The activation-code issuance side must persist the code server-side (T-145 / ACT-200) — a code that is not in `activation_codes` can never validate, and the desktop must never hand out an un-persisted fallback code in Supabase mode.
- The portal's activation screen maps the EF's structured error codes to precise localized messages (T-153) instead of regex-testing the error object.
- Path B signups created through the desktop's approve-signup-request EF still produce 'pending' users whose codes bind here — the two-step "approve + code" onboarding works unchanged.

## Evidence

- Live: `docs/recovery/t-147-live-verification.md` (deployed-EF round-trip: pending user → code bind → active + parent role + audit rows; already-used re-entry → 404 `code_not_found`; anonymous → 401).
- Code: hub `supabase/functions/bind-activation-code/index.ts` (the consolidated canonical version); website `supabase/functions/` contains no local EF anymore (guard: website `src/test/t-126-hub-owned-edge-functions.test.ts`, extended by T-146).
