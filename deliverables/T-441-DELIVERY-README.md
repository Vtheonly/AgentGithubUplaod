# T-441 DELIVERY — The Timetable Generation Correctness Mandate

**Date:** 2026-09-30 (the 120th session) · **Hub merge commit:** 5269cc4 ·
**Task:** T-441 (DONE — TESTED) · **Full evidence:**
`docs/recovery/t-441-live-verification.md`

## What is in this delivery

The complete fix of the owner's timetable mandate — « correct constraints must
never yield a faulty timetable; impossible constraints must fail explicitly
naming exactly WHAT is insufficient; never a partial/invalid timetable » —
including the live "17 échecs" symptom:

1. **Gate 1 — the feasibility pre-analysis** (the new
   `elimtiyaz-desktop/src/domain/calc/timetable/feasibility.ts`): 11
   impossible-input kinds, each message in French naming the class / subject
   / teacher / room / day / period / constraint AND the missing amount in
   periods. Mathematically impossible constraints are rejected BEFORE any
   version exists.
2. **Gate 2 — fail-closed persistence** (both repositories): unplaced blocks
   or ANY hard violation → the numbered French report, NOTHING persisted. A
   partial or conflicting timetable can no longer exist as a draft.
3. **Gate 3 — the independent post-persist validation:** the persisted rows
   are RE-READ and re-validated (row count, duplicates, canonical hard
   violations, coverage gaps AND excesses) with automatic rollback. The
   generator is never trusted.
4. **The solver v1.3.0:** the bounded deterministic eviction repair (the
   SCHED-110 no-backtracking corner), the pinned-coverage subtraction (the
   SCHED-113 duplicate-lessons fix — regenerations no longer duplicate pinned
   lessons; excess coverage is now the hard violation
   `excess_weekly_hours`), and the preferred-slot continuity hint (the source
   schedule tried first as a deterministic preference — 0 unplaced at every
   tested locked-pin density 0–50% on the live problem shape, where the old
   solver persisted 5/29-block partial drafts).
5. **The single-class + whole-school generation modes:** the new scope
   selector (« École entière » / one class) — the other classes' entries are
   carried as immovable busy-grid occupants, so a regenerated class can never
   conflict with them.
6. **The clean slate** (Task 1, committed f11236e): all 8 old fake/test
   timetable versions + 827 entries purged live, all academic input data
   preserved.

## The "17 échecs" — what it was and what changed

The old pipeline was failure-OPEN: when the solver could not place blocks
(the SCHED-110 corner, triggered at high occupancy and by the accumulated
locked pins of the old versions), the repository PERSISTED the partial
result anyway and the UI showed « N bloc(s) non placé(s) » — the "échecs" —
on a faulty timetable. Reproduced deterministically
(`scripts/t-441-reproduce-17.ts`): 30%/50% of the schedule locked → the old
solver left 5/29 blocks unplaced; the new solver: **COMPLETE at every
density**. Anything genuinely impossible now fails with the numbered report
instead of a faulty timetable.

## The verification

- t-441-feasibility 23/23 · t-441-solver-repair 12/12 ·
  t-441-generation-gates 11/11 · t-441-duplicate-lesson 9/9 (RED-first)
- The T-404/T-409/T-410 families re-run green — 115/115 across the seven
  timetable files; the concurrent T-442 suite green on the merged tree
  (132/132 together)
- FULL vitest 4,506 total / 4,484 passed / 17 failed — the failing set
  BYTE-IDENTICAL to the documented baseline (the 17 are pre-existing,
  non-timetable, every one re-characterized at T-440); tsc 0; eslint 0
- The offline live-problem run (the owner's real data shape): 118/118
  periods, 0 unplaced, 0 hard violations, 0 gaps, 0 excess
- The full DB verification ladder in ONE command (live legs need the key —
  see below): `scripts/t-441-live-e2e.ts`

## The one owner-gated step

The live legs of the E2E (the purge-state check, the repository-contract
insert, the re-read validation) need the project's default `sb_secret_…`
service key (dashboard → Settings → API Keys — the sbp_ Management token is
dead 401, re-verified). One command:

```
SUPABASE_SERVICE_KEY=sb_secret_... npx tsx scripts/t-441-live-e2e.ts
```

…OR simply run the app's first generation (Académique → Emploi du temps →
« École entière » → Générer) — the identical repository path, now
fail-closed end to end.

## The archives

- `AgentGithubUplaod-T441.zip` — the hub repo (this delivery)
- `elimtiyaz-website-T441.zip` — the website, carried forward byte-identical
  from T-442 (no website file changed by T-441)
- `elimtiyaz-all-systems-T441.zip` — both trees combined

## Registry

+SCHED-113 / +SCHED-114 RESOLVED-TESTED (the 444 recount with the
concurrent T-442's UI-323) · SCHED-110 CLOSED · AGENTS.md §15.74 ·
`docs/recovery/t-441-live-verification.md` (the full evidence record).
