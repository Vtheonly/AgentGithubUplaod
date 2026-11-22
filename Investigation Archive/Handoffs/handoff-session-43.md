# Handoff — Session 44 (from Session 43, 2026-11-22)
**Repo:** Vtheonly/AgentGithubUplaod · **Branch:** main ONLY (single-branch consolidation complete — do not create branches) · **Start here:** `docs/recovery/next-task.md` (the Session-43 closeout at the top) + this file.

## Where the system stands (the one-paragraph truth)
The NEW Supabase project (`gvuvibcsfjhwcjikgxql`) is now the **live system of record**: the schema (0001..0005, applied + validated in T-614), the **data** (the WB2 load: 741 parents / 1,137 students / 5,956 installments / 2,198 payments / 3,342 ledger entries — the exact verified corpora, wire-verified ALL CHECKS PASS incl. 741/741 family reconciliation), and **three working super_admin accounts** (admin1/2/3@elimtiyaz.dz — sign-in verified). The desktop defaults (T-615) and the website source (f93d764, pushed to its main) both point at it. **The ONLY remaining live step is the Vercel production rebuild of the portal** — blocked on the owner's token scope, not on code.

## THE HARD RULE (read before touching anything auth-related)
**AGENTS.md §15.111(a):** the accounts `admin1@elimtiyaz.dz`, `admin2@elimtiyaz.dz`, `admin3@elimtiyaz.dz` (profiles `664b5981-…`, `8552e09e-…`, `7c1d340d-…`) and the original `admin@elimtiyaz.dz` (`55b66d7a-…`) are **FROZEN for the entire renovation** — no modify, delete, re-password, demote, deactivate, or re-create. If a task seems to require it: STOP, record the need in `docs/recovery/unknowns.md`. Their credentials live ONLY in the owner's download/ artifact — never in the repo.

## Exact next tasks, in priority order
1. **If the owner supplies a re-scoped Vercel token** (full-account scope — probe `/v9/projects` FIRST, §15.111c): (a) list projects, find the portal; (b) check `NEXT_PUBLIC_SUPABASE_URL`/`_ANON_KEY` env vars — if they still carry `vebfehrpzajhstyhinnw`, update them to `https://gvuvibcsfjhwcjikgxql.supabase.co` / `sb_publishable_d-0XZQsTuzr3r2-kFxw-rA__BuQAvAa`; (c) trigger a deployment from the website main (f93d764 or later); (d) verify the deployed bundle references gvuvibcs… (the .dz domains may not resolve from the sandbox — verify via the Vercel deployment inspection or ask the owner to check in a browser); (e) register the completion against CROSS-202 (the final live step).
2. **Else the queue head (unchanged):** T-596 + E6.7/E6.8/E6.10 — see `Refactoring Unified/EXECUTION-PLAN.md` + the named T-cards. Read `docs/recovery/next-task.md` for the full queue.
3. **The desktop installed-client re-point** stays owner-side (the P3 profile tool, `scripts/prepare-cutover-profile.mjs`, runbook Step 7) — nothing to do in-repo; the next packaged build already defaults correctly.

## What to verify before ANY code change (the session-opening gates, §15.14)
- `cd elimtiyaz-desktop && npx tsc --noEmit` (0 errors) and the full vitest battery against the CURRENT baseline: **345 test files (344+1 skipped) / 5,719 passed / 5 skipped** (`scripts/test-baseline.json`, moved in T-615 citing the lane).
- `git status` clean; `git pull` — every session's commits are already on main.

## Files this session touched (for diff review)
`AGENTS.md` (§15.111) · `docs/recovery/{problem-registry,task-registry,change-log,next-task}.md` · `Investigation Archive/SESSION_LOG.md` (row 43) · `Investigation Archive/Session Reports/session-43-report.md` · this file. **No application source changed** (the lane was live-operations + documentation).

## Key operational facts the next agent needs
- **The t-433 driver's `SUPABASE_URL` env var MUST be set** — the script's default is the OLD dead project (`vebfehrpzajhstyhinnw`). The successful invocation: `SUPABASE_URL=https://gvuvibcsfjhwcjikgxql.supabase.co SUPABASE_SERVICE_KEY=<the owner's key> ACTOR_PROFILE_ID=664b5981-1df2-4981-98b5-dcabf01bddbd npx tsx scripts/t-433-live-reimport.ts` (idempotent — safe to re-run; existing identities preflight-skip).
- **PostgREST pages at 1,000 rows** (§15.60c): any live census must walk `?limit=1000&offset=<n>` (the pattern is in the t-616 live-verify script, delivered outside the repo).
- **Admin account creation is the §15.111(b) three-step path** — never hand-write `user_profiles`/`role_assignments` rows (the trigger + RPC own the transactional work; a hand-inserted profile skips the approval-request resolution and the audit trail).
- The OLD project (`vebfehrpzajhstyhinnw`) is 402-quota-dead — do not build against it; the new project's keys are per-project (the OLD sb_secret is rejected 401 by the new one).
- The Vercel token scope trap and the sandbox's unresolvable `.dz` domains: §15.111(c).
