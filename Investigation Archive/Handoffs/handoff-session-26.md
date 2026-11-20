# Handoff — Session 26 → the next session

**Date:** 2026-11-21 · **HEAD at close:** the S26 commits on `main` (clean, pushed) · **G0:** still ACTIVE (Issue #32: 0 comments — the 21st consecutive silent run).

## The state of record (what changed this session)

1. **The readiness audit is COMPLETE and the verdict is GO — pending only the owner actions** (session-26-report §6): lift G0; D-21 (the Google-side redirect URI + consent screen); the OPS-012 full-set rotation after OAuth; the ⏵ defaults confirm-or-override; the OPS-015 non-action (no live builds / cap lifts until T-559+T-560+T-594 are green).
2. **The post-consolidation baseline is now EMPIRICAL** (the first runs on the consolidated tree): `tsc --noEmit` exit 0; the guard exit 0 (1 baseline + 152 archived); t-058 6/6; the full ladder = **33 failed files (25 OPS-018 test-failing + 7 collection-error) + the ONE pre-existing t-502 red** — every OPS-018 failure is catalogued to the exact line in `OPS-018-COMMIT-1-BLUEPRINT.md` (39 sites: 35 literal + 4 constructed-path; the copy-paste sed + the five gates).
3. **`0001_initial_consolidated_schema.sql` is re-proven from scratch** on a clean PGlite instance (2,348 statements, ZERO failures, census-equal on every axis) — and its egress gaps are audited and homed (the `mv_grade_summary` unique index + the refresh whitelist → T-590; `sync_apply_batch` → T-593; the NOW()-anchored matviews → T-590). **The Permanent Charter (OPS-020) is the standing rule** (`MIGRATION-CONSOLIDATION-AND-EGRESS-CHARTER.md` + the G0-gated AGENTS amendment draft).
4. **The new workbook is byte-identical to the S14 blank template** (SHA-256 `15174e1b…99958`; 0 formulas; dumps identical) — no pedagogy/Excel lane change; `ETAT 2024-205.xlsx` stays external-only.
5. **The triad is v2.2 — self-contained and contradiction-free:** every S24 §14 delta inline at its card; S25 folded (OPS-019/D-21); 197 IDs / 0 orphans; the relocation docs re-based on the consolidated baseline; the OPS-015 no-live-builds lock explicit everywhere.

## The next session's bootstrap (in order)

1. `git fetch origin && git status` (clean; sync `main`); check the env file's mode (enforce 600 if the sandbox recycle loosened it).
2. Read: `Investigation Archive/README.md` (the S26 rows) → `SESSION_LOG.md` row 26 → this handoff → `session-26-report.md` §6 (the Go/No-Go) → `Refactoring Unified/EXECUTION-PLAN.md` v2.2 §0/§3 (the queue) → `OPS-018-COMMIT-1-BLUEPRINT.md` (the Commit-1 spec).
3. Check Issue #32 (GET-only). **If G0 is lifted:** execute §3 — **Commit 1 = the OPS-018 blueprint** (the sed pass + the 4 constructed-path edits + the five gates; then re-pin the baseline), then T-549 → T-559/T-560/T-594 → T-550/T-573 → T-552, carrying the inline v2.2 cards. **If not lifted:** the standing GET-only probe set + any documentation/verification work the owner mandates.
4. **The OAuth lane (D-21), independent of G0:** unchanged from S25 — if the owner supplies the Google client credentials in chat (Option B), apply them via the Management API's update-auth-config and verify with the masked GET; if the owner reports the existing client edited (Option A), verify nothing changed Supabase-side and close OPS-019. Then remind: the OPS-012 full-set rotation.
5. **Charter enforcement (OPS-020) starts now:** any future consolidation/baseline/relocation-seed work follows `MIGRATION-CONSOLIDATION-AND-EGRESS-CHARTER.md` (never concatenate; egress-first; 100% local validation; zero prod writes during consolidation; guard+census whole) — and the AGENTS.md/AGENTS_supabase.md amendment lands as its own commit at G0-lift.

## The corrections the executor must carry (now INLINE in v2.2 — the addendum-hunting is over)

- T-594 narrows (C-23): ~120/h configured-mode only; mock mode silent by design. T-569's DB-side scope is EMPTY (C-24); `class_subjects` stays. T-588's inventory is 13+ (C-25); T-592's radius is 30 instances/18 files (ARCH-049); T-591 gains BUG-069; E2.4 owns DUP-037.
- BUG-046's fix surface is 7 synthetic sites (root: `unified-payment-modal.tsx:283-285`); REAL_TUITION_BY_GRADE is flat/not-year-keyed (+ `REAL_FI_AUTISTE`); the stats-tips glossary is 96×3=288 blocks.
- **The t-215/t-416/t-weak030/t-372 constructed-path sites** are part of Commit 1 (§1d of the blueprint) — a literal grep alone misses them.

## Standing constraints (unchanged)

Read-only until G0 lifts; one T-task per commit with the five-question body; push immediately; never force-push; SQL/EF changes under the §11.1 ceremony; RLS never weakened; the archive never touched again; the web portal and Android keep consuming Supabase unchanged (D-17); OPS-015's cap-lift ordering is absolute — **and no live build points at either project until T-559/T-560/T-594 are green**; NO key material in any file, output, or commit — keys live only in the outside-repo chmod-600 env file; the Charter (OPS-020) governs every consolidation/baseline/relocation-seed action.
