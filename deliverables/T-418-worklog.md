# T-418 Session Worklog — the 102nd session (2026-09-27)

## The mandate

GitHub issue #21: merge or remove all 37+ branches safely, preserving every feature/fix/change, ending with one active main branch, no unresolved conflicts or regressions. Plus the standing requests: read AGENTS.md + the audit docs first; push and merge after each commit; another agent may be working concurrently; zip the systems and hand them over.

## The opening forensics (per AGENTS.md §5 order)

1. Fresh clones of both repositories (hub 383 MB, website 7.2 MB).
2. AGENTS.md read in full (§14 commit rule, §15 forbidden list — the §15.1 tension with issue #21 identified at open), `docs/agents/git-workflow.md` (the five mandatory commit answers), `docs/recovery/next-task.md` (the 101st-session state), the task/problem registries' formats.
3. The branch census: **36 hub + 3 website non-main refs; ALL ancestors of main; ALL zero unique commits** (`scripts/verify-branch-containment.sh`). The 101st session's delivery README independently recorded the same census.
4. The merge-commit map recovered for every branch (`scripts/merge-commit-map.sh`): 29 explicit merge commits + 8 direct/fast-forward integrations.
5. Feature-presence spot-checks: every branch family's marquee artifact found in main's tree (T-401 filière/spécialité surfaces, migration 0111 debt aging, purge migrations 0119–0121, T-409/T-410 timetable surfaces + suites, T-411 finance unification [all 18 registry entries RESOLVED/TESTED], T-414 import-config registry + migration 0117, dashboard layout editor, particle engine, i18n, windows build, realtime créances).

## The gates (before AND after — all green, evidence in t-418-branch-consolidation-verification.md §3)

Desktop: tsc 0 · eslint 0 errors · FULL vitest 4 145/25/5 (count-identical to the documented baseline; failing set = the documented pre-existing families) · append-only guard OK. Website: 657/657 · lint clean · tsc 0 · build green. Live Supabase smoke: chain 0121 · auth 200 · RLS enforcing · 15 EFs ACTIVE.

## The execution

- **Phase 0 (`7cc28ed`)**: OPS-322 + ADR-028 + T-418 + the evidence table + the scripts registered and pushed. **The first push was rejected by GitHub push protection** (the smoke script carried the `sbp_` token inline — §15.12's class, machine-enforced): rewritten to env-var injection, amended while local-only, re-verified live, pushed clean. Discovery → §15.59d.
- **Phase 1**: the 39 guarded deletions (fresh fetch + per-ref re-verification immediately before each): hub 36/36, website 3/3, 0 skipped. Invariance proofs: both mains' SHAs byte-identical before/after; `git status` 0 changes throughout; `git ls-remote --heads` = exactly `refs/heads/main` on both.
- **Phase 2 (`05ff205`)**: the closeout — verification doc filled with executed results, post-deletion gate re-runs (desktop FULL suite re-run to completion: identical counts; website re-run 657/657), task registry execution record, change-log (102nd session), next-task, current-state, §15.59 (a–d).
- **The delivery (this commit)**: the three zips (hub 7.8 MB / website 724 KB / combined 8.7 MB, spot-checked: no .git, no nested zips, ADR-028 + verification doc + migration 0121 present) + this README + this worklog.

## New discoveries documented (AGENTS.md §15.59)

(a) "Merge the branches" mandates begin with the containment census, not merges. (b) The commit-graph rule + the invariance proof (main's SHA unchanged ⇒ pre-deletion gates remain valid post-deletion). (c) The branch list is NOT a work inventory — task-registry.md is. (d) GitHub push protection is an ACTIVE push-blocking layer — any inline secret literal blocks the entire push, even in read-only tooling; env-var injection at the script boundary is the pattern.

## Honest boundaries

- The 25 pre-existing vitest failures remain open under their own entries (unrelated).
- Live core-table censuses evolved past the 101st-session snapshot (owner activity — imports/approvals); infrastructure axes all match.
- T-418's VERIFIED gate: the owner's GitHub branch-page confirmation.
