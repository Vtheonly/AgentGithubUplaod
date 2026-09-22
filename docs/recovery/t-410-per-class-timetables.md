# T-410 — Per-Class Timetables: Each Class an Independently Validated Timetable

**Registered:** 2026-09-22
**Problem:** SCHED-112 (RESOLVED — this task)
**Related:** T-404 (the canonical timetable architecture), T-409 / SCHED-111 (the class-first presentation), ADR-020, ADR-021, ADR-022
**Status:** TESTED (see §7 — the implementation record)

---

## 1. The owner's report (verbatim intent)

> "You're still doing it the wrong way. What I want is for there to be an
> **actual separate timetable for each class**, not one universal timetable
> that combines every room and every teacher. For example, if there are
> **3 classes of 5AP and 2 classes of 2AM**, that is **5 classes total**, so
> there must be **5 completely separate timetables** — one timetable for
> each individual class. I do **not** want one universal timetable for the
> entire school where all classes, teachers, and rooms are mixed together.
> Each class must have its own independent weekly timetable. […] The
> important requirement is that **each class's timetable must be internally
> complete and conflict-free**. When generating the timetable, the system
> must verify for every individual class that:
> - there are no teacher conflicts;
> - there are no room conflicts;
> - there are no overlapping lessons;
> - there are no unnecessary or unexplained gaps;
> - the class gets all of its required weekly hours;
> - every required subject/session is actually scheduled;
> - every lesson has a valid teacher;
> - every lesson has an appropriate room;
> - the class's timetable satisfies all applicable constraints.
> I want the result to be **5 separate class timetables**, not one global
> timetable that happens to contain all five classes. The generation
> process should therefore build and validate each class timetable
> independently while still respecting shared resources such as teachers
> and rooms across the school."

## 2. What was actually wrong (verified against the code — not assumed)

T-409 made the class **view** correctly scoped (mandatory class selector,
strict `classId` filter, stacking cells). Verified state of `main`
(85840e5) at the 93rd session's open:

1. **Validation was ONE school-wide aggregate.** The solver ran the
   canonical `validateTimetable(problem, entries)` once over ALL entries
   and the version statistics carried only school-wide totals
   (`placedPeriods` 112/118, coverage 97%). Nothing verified EACH class's
   timetable independently — an individual class could be incomplete
   (missing hours, an unscheduled subject, no teacher, no room, holes in
   its days, even an attributed clash) with **no per-class status
   anywhere in the product**.
2. **The trials panel showed only global numbers.** "Essais &
   publication" rendered `{placed}/{required} périodes placées` + one
   flat conflict list. The owner could not answer "is 5AP-B's timetable
   complete?" without hand-filtering.
3. **The teacher/room selectors still offered "Tout afficher"** —
   rendering the universal all-classes-mixed grid (every class, every
   teacher, every room stacked into one school-wide view): exactly what
   the owner rejects.
4. The website portal view was already per-student-class (T-408 /
   SCHED-106) — verified, no change needed there.

## 3. The architectural stance (ADR-020 / T-404 boundaries — respected)

The canonical architecture stores ONE versioned schedule whose class /
teacher / room views are projections (ADR-020 §8). T-410 does NOT create
a second store, a second engine, or per-class versions — the owner's
"N separate timetables" is delivered as an **independent VALIDATION and
PRESENTATION layer over the same canonical data**:

- constraint verdicts still come from the ONE canonical validator
  (`constraints.ts`) — the report builder only ATTRIBUTES them;
- completeness still comes from the SAME canonical requirement math
  (`requiredPeriodsFor` — the solver's own denominator);
- per-class reports are computed at generation time (solver build v1.2.0)
  and persisted in the version's existing `statistics` JSONB — no schema
  change, no migration, backward-compatible readback for pre-T-410
  versions (`readClassTimetableReports` — absence yields `[]`, never
  "all classes fine").

Shared resources stay shared: the solver's busy grids keep teacher/room
exclusivity school-wide (unchanged), and each clash is attributed to
**every participating class** — both sides see the conflict with the
other class named.

## 4. The delivered contract

### 4.1 Domain (`model/timetable.ts` + `calc/timetable/class-reports.ts`)

`ClassTimetableReport` — one per class (every class of the problem, even
one with no requirements):

- `status`: `"complete"` (full coverage + zero hard issues + a teacher and
  a room on every lesson) or `"incomplete"`;
- `placedPeriods` / `requiredPeriods` / `coveragePercent` — the class's OWN
  numbers (placed counts all its entries including locked pins);
- `hardIssueCount` / `softIssueCount` — attributed conflicts (incl.
  unplaced blocks with the solver's French reason);
- `gapPeriods` — free teaching periods strictly between the class's first
  and last lesson of a day (honest hole count; reported, non-blocking);
- `issues[]` — the attributed violations, shared-resource clashes
  rewritten to name the other class ("L'enseignant M. Belkacem (Maths)
  est affecté en même temps à 5AP — A et à 5AP — B (lundi, période 3).");
- `checklist[]` — the owner's nine verification items, each `ok`/`count`/
  `message` (FR): `teacher_conflicts`, `room_conflicts`, `overlaps`,
  `gaps`, `weekly_hours`, `subjects_scheduled`, `teacher_assigned`,
  `room_assigned`, `constraints`.

`buildClassTimetableReports(problem, { entries, violations, unplaced })` —
a pure, deterministic aggregation; `statistics.perClass` on every solution
from solver build **v1.2.0** (placement output and the T-409 progress
event sequence unchanged — the reports are computed inside the existing
validation work unit).

### 4.2 UI (`timetable-grid.tsx`, `timetable-tab.tsx`)

- **Every projection is ONE entity's timetable.** A null entity renders
  the honest « Sélectionnez … » empty state in ALL three modes; the
  universal mixed-grid code path (`: entries`) is GONE from the product
  surface. LIST-cell stacking is kept as anomaly tolerance (a defect
  SHOWS both lessons, overwrites nothing).
- **Teacher/room selectors are entity-mandatory** (no « Tout afficher »,
  first-entity default — the same contract as class mode).
- **Class mode status strip**: the selected class's own validation —
  status badge, `14/14 périodes requises`, own coverage, own issue list.
- **Trials panel « Emplois du temps par classe »**: one row per class
  (name, own periods, own coverage, own strict/preference problems, own
  gaps, own status) + per-class « Examiner » (opens that class's own
  weekly grid) + the `X/Y classes complètes` rollup.

## 5. What this task deliberately did NOT do

- No new timetable store, no per-class versions, no canonical-repository
  change (T-409 scope boundaries hold).
- No solver placement-algorithm change — SCHED-107 (nominal-capacity
  room-fit) and SCHED-110 (no-backtracking corner case) remain the
  registered solver-quality pass; SCHED-108 (moveEntry filtering) and
  SCHED-109 (unpublish path) unchanged.
- No constraint-semantics change: gaps are REPORTED per class (a quality
  warning), they do not flip `complete` — only the canonical validator's
  hard verdicts, missing hours/subjects, and missing teacher/room do.

## 6. Regression coverage (27 new tests, all green)

`t-410-class-reports.test.ts` (21): the owner's exact 3×5AP + 2×2AM
shared-teacher school → 5 reports, no cross-class leakage, partition
invariant (Σ per-class placed = all entries), concurrent different-class
lessons coexist; both-side clash attribution (teacher + room); own
overlap isolation; missing hours / unscheduled subject / missing teacher
/ missing room / unplaced block each flip ONLY the concerned class; gap
counting (P1+P4 → 2 holes, status stays complete); solve/solveAsync
byte-identical reports; no-requirement class honest report;
`readClassTimetableReports` absence/malformed tolerance.

`t-410-per-class-timetables.test.tsx` (6, REAL tab + REAL mock
repositories): the status strip (14/14 then 16/16 following the
selection); the per-class table (5 rows, 5/5 rollup); each row's own
coverage; the per-class Examiner re-scoping to that class's own 16
lessons with zero foreign entries; the teacher selector entity-mandatory
(no « Tout afficher », first-teacher default).

`t-409-class-first-ui.test.tsx` E revised (superseded by this task, per
the owner's instruction): teacher projection + null → honest empty state;
new E2 pins the anomaly-tolerance stacking (one teacher's cell with two
concurrent entries SHOWS both).

## 7. Implementation record (the 93rd session, 2026-09-22)

- **Verified the report against the code first** (per the standing rule:
  a handed-over complaint is a claim): grid class-scoping was correct;
  the real gaps were the aggregate-only validation/presentation and the
  « Tout afficher » mixed projections (§2).
- **Commits** (branch `feature/t410-per-class-timetables`, each pushed
  immediately, then merged `--no-ff` to main):
  - `0c57065` fix(timetable): the domain contract + report builder +
    solver integration (v1.2.0) + grid/tab UI (932 insertions);
  - `d758331` test(timetable): the two suites + the T-409 E revision
    (1073 insertions);
  - docs commit: this record + the registry/ADR/AGENTS.md updates.
- **Gates:** `tsc --noEmit` 0 errors; FULL vitest **3809 passed / 21
  failed / 5 skipped** — the failing set byte-identical to the documented
  pre-existing baseline (analytics-visuals, dashboard-3zone,
  vault-compliance, ai-review-screens, t-390-realtime, t-134,
  Tier4/ScenarioRunner, t-355/356 — none timetable-related); eslint 0
  errors on all changed files; all 41 pre-existing T-404 timetable tests
  + the 32 T-409 tests still green.
- **Merge-safety:** additive changes only — the model gained optional
  fields, the solver's changes are confined to the validation stage, the
  tab's selector block was rewritten in place (the concurrent agent's
  zones: finance/analytics/dashboard — untouched).

## 8. Left (honest)

- Owner UI testing of the per-class surfaces on the live FAKE dataset
  (the T-409/T-408 standing gate — the packaged app must be rebuilt to
  carry T-410), then `purge --execute`.
- The published LIVE version (v2) predates T-410 → its trials card shows
  no per-class table until a new trial is generated (honest absence, by
  design).
- The standing solver-quality pass (SCHED-107 + SCHED-110), SCHED-108,
  SCHED-109, ACAD-510 — unchanged.
