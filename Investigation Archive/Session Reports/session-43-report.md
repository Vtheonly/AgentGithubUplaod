# Session 43 Report — T-616: The Live Cutover Completion
**Date:** 2026-11-22 · **Repo state at start:** main @ 8a0967fd (single-branch, clean) · **State at end:** main @ the T-616 docs commit (all work pushed)

## The mandate
The owner (verbatim intent): "I do not have the new password and the new email… I want you to create three new accounts with three new admin passwords and the admin accounts, but throughout the entire renovation do not change them at all" — plus the standing session protocol (sync main, ingest context, execute with verification, persist knowledge, push every commit) and the supplied credential inventory (the NEW project's secret key + the Vercel PAT).

## What was executed

### 1. The three PERMANENT admin accounts (the §15.23 resolution)
- **Accounts:** `admin1@elimtiyaz.dz`, `admin2@elimtiyaz.dz`, `admin3@elimtiyaz.dz` — each a confirmed auth user + `user_profiles` row (tenant `…0001`, El-Imtiyaz Boumerdès) + a live `role_assignments` row with **super_admin** (role `…0101`).
- **The path (canonical, §15.111b):** the auth admin API with `app_metadata {created_by_admin: "true", tenant_id}` + `user_metadata {full_name, requested_role: "staff"}` → the `handle_new_user` trigger (pending profile + approval request) → the `admin_create_user_account` RPC (atomic activate + role assign + approval resolve; reviewer-of-record: the owner's own `admin@elimtiyaz.dz` profile `55b66d7a-…`). NO hand-written RBAC rows.
- **Verified:** all three profiles `status='active'`; password-grant sign-in **HTTP 200** with a real JWT (admin1 tested); the staff-gated `calendar_events` RLS read **HTTP 200** as admin1's JWT (the role chain resolves through `current_user_roles()`).
- **FROZEN per AGENTS.md §15.111a:** never modify, delete, re-password, demote, deactivate, or re-create — for the entire renovation. The original `admin@elimtiyaz.dz` (the T-614-apply account of record) carries the same protection. The credentials artifact was delivered to the owner OUTSIDE the repo (never committed).

### 2. The WB2 data load (the cutover runbook Step 6 — DONE)
- `elimtiyaz-desktop/scripts/t-433-live-reimport.ts` against `https://gvuvibcsfjhwcjikgxql.supabase.co` (actor: admin1's profile `664b5981-…` — the `collected_by`/audit attribution), env: `SUPABASE_URL` (overridden — the script defaults to the OLD dead project!), `SUPABASE_SERVICE_KEY`, `ACTOR_PROFILE_ID`.
- Preflight: 0 `imp-` installments; all five domain tables empty.
- **The run (137s):** imported=1,137 · updated=2 · skipped=2 · rejected=0 · warnings=73 — the exact local-corpora pattern (the 1,139 ETAT NOM rows = 1,137 students + 2 duplicate-NOM merges).

### 3. The live wire-level verification — ALL CHECKS PASS
`scripts/t-616-live-verify.py` (read-only, paginated per §15.60c, outside the repo):
- **C1 census EXACT:** 741 parents / 1,137 students / 5,956 installments / 2,198 payments / 3,342 ledger entries — the t-615 harness's verified corpora, reproduced on the wire.
- **C2 payments↔ledger:** 2,198 payments, **0 unmatched** (2,199 negative entries — the harness's own shape).
- **C3 per-family:** **741/741 families reconcile** — 738 exact + 3 FI-fee-class deltas, **0 broken** (identical to the local O5).
- **C4:** all 5,956 installments carry due dates + amounts.

### 4. The Vercel lane — blocked by token scope (documented, §15.111c)
- The PAT authenticates (`/v2/user` 200, `merselfares2-9361`) but `/v9/projects` returns **403 "resource under scope merselfares2-9361s-projects"** — the token was minted WITHOUT the projects scope. No project list, no env inspection, no deploy trigger.
- The production `.dz` domains do not resolve from the agent sandbox — the live-bundle check is impossible from here.
- The website source IS ready: `elimtiyaz-website` origin/main = **f93d764** (the cutover commit; committed defaults = gvuvibcsfjhwcjikgxql), verified on the remote.
- **The owner's action:** re-mint the Vercel token with the full-account scope (Settings → Tokens) — or dashboard-redeploy the latest main deployment — AND check the project's `NEXT_PUBLIC_SUPABASE_*` env vars are not stale-OLD.

## Files modified (all committed and pushed)
- `AGENTS.md` — §15.111 (the permanent-admin-set rule + the canonical creation path + the Vercel-scope trap) [commit b85c90de, pushed BEFORE the long runs per §15.110].
- `docs/recovery/problem-registry.md` — CROSS-202 status → RESOLVED-TESTED (the live half landed).
- `docs/recovery/task-registry.md` — T-616 registered (RESOLVED-VERIFIED, with the full evidence).
- `docs/recovery/change-log.md` — the T-616 entry (prepended).
- `docs/recovery/next-task.md` — the Session-43 closeout.
- `Investigation Archive/SESSION_LOG.md` — row 43.
- This report + `Investigation Archive/Handoffs/handoff-session-43.md`.

## Tests and verification executed
| Gate | Result |
| --- | --- |
| Auth admin API user creation ×3 | 200/200/200, all confirmed |
| `admin_create_user_account` RPC ×3 | 200/200/200 (atomic activate+assign) |
| Password-grant sign-in (admin1) | HTTP 200 + JWT |
| Staff-gated RLS read as admin1's JWT | HTTP 200 |
| t-433 driver preflight | 0 imp- installments, tables empty |
| t-433 live import | 1,137+2+2+0, 137s, census clean (transport T1-T3 + tuition T0-T3 with real DZD sums) |
| Live verify C1-C4 | ALL PASS (counts exact, 0 unmatched, 741/741 families, 5,956/5,956 dated) |

## Discoveries persisted
- **§15.111(a)** the permanent-admin-set rule; **(b)** the canonical admin-creation path (never hand-write the RBAC rows — the trigger + RPC own the transactional work); **(c)** the Vercel-token scope trap (probe `/v9/projects` before promising a redeploy) + the sandbox's unresolvable `.dz` domains.

## Remaining (owner-gated)
1. **The Vercel redeploy** (re-minted token or dashboard) + the NEXT_PUBLIC env check — the last live step of CROSS-202.
2. The installed-desktop re-point (the P3 profile tool, runbook Step 7 — or the next packaged build, which already defaults correctly).
3. The queue head: T-596 + E6.7/E6.8/E6.10.
