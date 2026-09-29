# T-441 — The Timetable Generation Correctness Mandate: Verification Record (120th session, 2026-09-29/30)

> **Mode:** the owner's direct mandate — the timetable generation must NEVER
> produce a faulty/conflicting timetable; when constraints are insufficient
> the generation must fail EXPLICITLY naming exactly what is insufficient
> (class / subject / teacher / room / day / period / constraint); single-class
> and whole-school generation modes; every old fake/test timetable record
> deleted first (Task 1, live-verified); extensive tests including impossible
> scenarios; an independent post-generation validation layer that never
> trusts the generator's own output.
>
> **The owner's live symptom (this session's trigger):** « sometimes when it
> runs it said 17 echecs … if something is insufficient it should bring what
> it is — i dont want it to bring up faulty time table. »

## Task 1 (committed f11236e, previous session) — the live purge

8 versions + 827 entries (the T-408/T-409/T-410 FAKE-dataset artifacts,
solver builds v1.0.0–v1.2.0) deleted through the documented clean-slate
script with the SCHED-109 immutability routing; all academic INPUT data
(classes / subjects / teachers / rooms / curriculum / constraints)
preserved. Evidence: `elimtiyaz-desktop/scripts/t-441-timetable-clean-slate.py`.

## The "17 échecs" — root cause (reproduced deterministically)

The OLD pipeline (solver v1.2.0 + the OLD repository) had **no
failure-closed gate**: when the solver could not place blocks (the
SCHED-110 no-backtracking corner, triggered at high class occupancy and by
locked pins from prior versions), the repository **persisted the partial
version anyway** and the UI displayed « N bloc(s) non placé(s) » — the
owner's "échecs". Reproduction (this session, deterministic, on the LIVE
exported problem — 5 classes, 52 requirements, 118 weekly periods):

| locked pins | old v1.2.0 | new v1.3.0 (before the continuity fix) | new v1.3.0 (final) |
|---|---|---|---|
| 30% of grid | 5 unplaced, 2 hard | 5 unplaced | **0 unplaced, 0 hard — COMPLETE** |
| 50% of grid | 29 unplaced, 11 hard | 27 unplaced | **0 unplaced, 0 hard — COMPLETE** |

The reproduction script (`scripts/t-441-reproduce-17.ts`, kept for the
record) locks a deterministic subset of a first-pass solution and
regenerates — exactly what the owner's 8 accumulated versions did.

## What was implemented (Task 2 — the core correctness work)

### 1. Gate 1 — the feasibility pre-analysis (`src/domain/calc/timetable/feasibility.ts`, NEW)

A PURE analysis over the same canonical model + param helpers (ADR-020: no
second engine) that derives NECESSARY conditions — if any fires, the
problem is provably unsatisfiable and the repository refuses to generate
(fail-closed) BEFORE any version is created. Eleven issue kinds, each with
the precise French reason naming the entities and the missing amounts:
school/class week all free, class capacity exceeded (the exact deficit in
periods), teacher overloaded (per-class/subject breakdown), room type
missing, room capacity insufficient (the largest fitting room named), room
pool exhausted (demand vs pool capacity), a consecutive block that fits no
day, pinned-entry clashes (teacher/class/room on the same slot), pinned
entries outside the grid / on free days / on unavailable periods, and
**over-pinned requirements (cours en double impossible à éviter)**.

### 2. Solver v1.3.0 — eviction repair + pinned-coverage subtraction + preferred-slot continuity

- **SCHED-110 closed** (`greedy-solver.ts`): the repair pass now EVICTS
  movable (never locked, never carried) blocks blocking a failing
  placement, re-places each evicted block by plain placement, and rolls
  back the whole candidate on any failure — bounded (≤ 60 candidates, ≤ 4
  evicted groups per candidate) and deterministic.
- **SCHED-113 closed (found this session, RED-first)**: the solver built
  placement blocks from the FULL weekly requirement even when locked pins
  already covered part of it — a regenerated version contained DUPLICATED
  lessons (e.g., Math 4 h/week with 2 pinned → 6 periods in the new
  version), and the canonical validator accepted the excess silently (it
  only flagged SHORTFALLS). The fix is three-layered:
  1. the solver subtracts the locked+carried coverage per (class, subject)
     — only the REMAINDER becomes blocks (`blockSplit(0)`'s `[1]` trap
     guarded);
  2. the canonical validator now reports excess coverage as the HARD
     violation `excess_weekly_hours` (« cours en double — heures
     hebdomadaires dépassées », naming class / subject / placed-vs-required);
  3. the feasibility pre-analysis rejects over-pinned requirements BEFORE
     generation (« déverrouillez N cours épinglé(s) ou augmentez les
     heures »).
- **The regeneration-continuity hint** (the owner's symptom closed at the
  root): when regenerating from a source version, the repository passes the
  source's entries as `preferredEntries`; the solver tries the historical
  slots FIRST (stable partition, deterministic — a pure preference, never
  an obligation). A regeneration now CONVERGES on the previous schedule
  wherever it still fits around the pins instead of re-fragmenting the
  week: the sweep above shows 0 unplaced even at 50% pinned.

### 3. Gate 2 — fail-closed persistence (both repositories)

If the solver could not produce a COMPLETE, conflict-free schedule
(unplaced blocks OR hard violations), the generation FAILS with the
numbered report (each line: subject — class — the precise reason) and NO
version is persisted. The UI surfaces the report verbatim. A partial or
invalid timetable can no longer exist as a draft.

### 4. Gate 3 — the independent post-persist validation

Never trust the generator: after persisting, the repository RELOADS the
rows and re-runs the canonical validator + the coverage gap AND excess
checks on the re-read rows; row count and duplicate keys verified; any
discrepancy ROLLS BACK the version (entries then version row) and fails
the generation. The audit log records `persistedRevalidated: true` only
after this passes.

### 5. Single-class and whole-school modes

`GenerateTimetableOptions.classIds` (undefined/empty = whole school): the
other classes' entries are carried from the reference version
(`fromVersionId` else the published version) as immovable
`carriedEntries` that pre-occupy the class/teacher/room busy grids — a
regenerated class can NEVER conflict with them — and the new version stays
a complete school snapshot (carried rows re-inserted with their original
is_locked/source flags). The final validation always covers the FULL
problem. The UI (timetable-tab.tsx) offers the scope selector (« École
entière » / one class) next to « Générer ».

### 6. Honest statistics

`placedPeriods` now counts EVERY row of the produced version (locked +
carried + newly placed) against `requiredPeriods` = the school's true
weekly requirement — the coverage the owner actually gets, never a
solver-internal remainder count.

## The verification evidence

- **Unit / integration (new, this task):** `t-441-feasibility.test.ts` 23
  tests (every issue kind, every insufficiency message naming its
  entities) · `t-441-solver-repair.test.ts` 12 tests (the SCHED-110
  corners, boundary periods, one-slot-left, carried-entry semantics) ·
  `t-441-generation-gates.test.ts` 11 tests (the mock-repository E2E:
  feasibility rejection, fail-closed no-persist, rollback on a corrupted
  persist, single-class non-conflict) · `t-441-duplicate-lesson.test.ts` 9
  tests (excess = hard violation; pinned-coverage subtraction at 50%
  pins — EXACT per-requirement counts; the blockSplit(0) trap; the
  over-pinned feasibility rejection; the continuity sweep at 10/25/50%).
- **The existing timetable families stay green:** T-404 25 · T-409 14 ·
  T-410 21 — 115/115 across the seven timetable test files.
- **Full suite:** tsc 0 · eslint 0 errors on every changed file · FULL
  vitest **4,506 total / 4,484 passed / 17 failed** — the failing set
  BYTE-IDENTICAL to the documented baseline (8 files, every one
  pre-existing and re-characterized at T-440; none timetable-related).
  BASELINE-MATCHED — zero new regressions, zero vanished failures.
- **The LIVE problem, offline (the owner's real data shape):**
  `scripts/t-441-live-problem-run.ts` — the exported live problem (5
  classes / 52 requirements / 14 teachers / 10 rooms / 3 constraints)
  solves COMPLETELY: 118/118 periods, 0 unplaced, 0 hard violations, 0
  coverage gaps, 0 excesses; every per-class report complete.
- **The regeneration sweep on the live problem:** 0/5/10/15/20/30/50%
  pinned → ALL COMPLETE (118/118, 0 unplaced, 0 hard) with the continuity
  hint; without it, 30%+ densities failed closed.
- **The one-command live E2E** (`scripts/t-441-live-e2e.ts`): the full
  DB-1..DB-9 ladder (purge-state check → live export → Gate 1 → solve →
  in-memory validation → the repository's exact insert contract → re-read
  → Gate 3 on the re-read rows → the final conflict census + rollback on
  any failure). The OFFLINE legs verified this session (DB-2..DB-5 +
  verdict); the LIVE legs (DB-1, DB-6..DB-9) require the service key
  (see below).

## The one blocked residual (owner-gated)

The live legs of the E2E and any live generation need the project's
default `sb_secret_…` service key — the `sbp_` Management token is dead
(401, re-verified this session), the legacy anon JWT is RLS-denied, and
the key value from the earlier session was consumed from ENV and never
persisted (the convention). One command, once the key is revealed in the
dashboard (Settings → API Keys):

```
SUPABASE_SERVICE_KEY=sb_secret_... npx tsx scripts/t-441-live-e2e.ts
```

The script creates a clearly-labeled draft version
(« T-441 vérification E2E … »), re-reads and independently validates it,
and ROLLS BACK automatically if anything is off. The owner's first
in-app generation (Académique → Emploi du temps → Générer) exercises the
identical repository path.
