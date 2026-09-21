# REPORT — What we are actually dealing with here (read this first)

## 1. The mission
Clone the production Supabase database (`hkvkefubghbbotgnteir`) into a **brand-new, completely EMPTY** project (`vebfehrpzajhstyhinnw`) that is **exactly identical in structure and functionality** — same 83 tables, schemas, constraints, indexes, functions, RPCs, triggers, RLS policies, grants — with **ZERO business data**. The old project stays untouched. Repo: `AgentGithubUplaod/` (Elimtiyaz desktop app).

## 2. The exact problem we hit (this is the thing)
The fresh clone looked perfect on paper — **95/95 migrations applied, 83/83 tables, 226/226 policies** — yet every authenticated REST read failed:

```
500  { code: 54001, message: "stack depth limit exceeded" }
```

Owner saw a blank app + a wall of `401`s. **Root cause — two transcription losses in the hand-written migration chain:**
1. `0003_rbac.sql` created the five RLS helper functions (`current_user_profile_id`, `current_tenant_id`, `has_role`, `has_any_role`, `has_permission`) **without `SECURITY DEFINER`** and **without `SET search_path = public`**.
2. `0019_rls_policies.sql` created `user_profiles_select_own` **without** the leading `auth_user_id = auth.uid()` fast-path disjunct.

Because RLS is **FORCEd** on `user_profiles`, `role_assignments`, `roles`, `permissions`, `role_permissions`, `tenants`, and only `postgres`/`service_role` have `BYPASSRLS`, a policy calling a non-SECURITY DEFINER helper **re-enters its own policy forever** → unbounded recursion → 54001.

## 3. The exact solution (ALREADY DONE ✅)
Migration **`0099_rls_helper_security_definer_parity.sql`** (in `elimtiyaz-desktop/supabase/migrations/`):
- Restores `SECURITY DEFINER + SET search_path = public` on the five helpers (live-production shape).
- Restores the `auth_user_id = auth.uid()` branch of `user_profiles_select_own`.
- This is the *sanctioned inverse* case of "never add SECURITY DEFINER to make it work": the attribute IS the production source of truth; its absence was the defect.

**Status: FIXED + VERIFIED.** Migration 0099 applied to the NEW project, `pg_proc` helpers `MATCH_OLD: True`, policy `POLICY_MATCH: True`, **30/30 authenticated REST paths return 200**, anon still sees `[]` (RLS intact, security *restored*, not weakened). Committed as **`865343d`** and pushed to `origin/main`.

## 4. How to verify it yourself (do NOT re-diagnose from the client console)
```bash
bash /home/mersel/Documents/Projects/export/run376.sh
# runs elimtiyaz-desktop/scripts/verify_t-376.sql against the linked NEW project
# (BEGIN/ROLLBACK, SET LOCAL ROLE authenticated + jwt claims) — expect 12/12 PASS
```
Note: the earlier `v376.out` failure ("No such file or directory") was just a stale CWD — the script exists at the repo root of this workspace now. Triage rule (AGENTS.md §15.35): `500 54001` = evaluate the policy chain against `pg_proc`; `401` = credential/session problem. Prove the server side FIRST.

## 5. What actually remains (the real next tasks)
1. **Re-run `run376.sh` / `verify_t-376.sql`** → confirm 12/12 PASS on the NEW project (evidence for the change-log).
2. **OPS-313 (OPEN):** `0096` line 302 `$function$` has no terminating `;` — a future `supabase db push --include-all` or re-provision from the chain will parse-fail there. Fix the chain file; do NOT re-apply 0096 to the NEW project (already registered).
3. **Edge Functions are NOT yet deployed/verified on NEW** — deploy + verify them before handing the app over.
4. Point the desktop app at the new project (`vebfehrpzajhstyhinnw`, key `sb_publishable_IPUtQMYQzr1wNnfGTcl5MA_wuz3RUdg`) — full credentials map in `file.md`; bootstrap admin already created (`admin@elimtiyaz.dz`), auth trigger auto-created its profile → needs role approval via SQL.
5. Keep everything pushed/merged after each commit (owner rule in `file.md`).

## 6. Rules that came out of this (never violate)
- Any attribute affecting policy evaluation (`prosecdef`, `proconfig`/search_path, `relforcerowsecurity`, `rolbypassrls`, policy `qual`/`with_check`/`roles`/`cmd`) is **structure** — byte-diff against live, never assume.
- "N/N migrations applied / N/N policies" is **NOT** functional parity — only a live authenticated request proves it.
- Never widen a grant to match a permissive live default-ACL artefact — keep the narrower side and register the divergence.
- Never diagnose a fresh clone from the client console alone.

Full detail: `AgentGithubUplaod/AGENTS.md` (§15.33–35), `docs/recovery/task-registry.md` (T-376), `docs/recovery/problem-registry.md` (OPS-314), `docs/recovery/change-log.md`.
