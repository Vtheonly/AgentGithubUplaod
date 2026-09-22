# ADR-022 — Per-Class Timetable Reports: Independent Validation as a Derived Layer over the Canonical Architecture

**Status:** Accepted (implemented 2026-09-22, T-410 / SCHED-112)
**Context:** ADR-020 (the timetable solver architecture), ADR-021 (the generation progress channel), T-404, T-409

## Context

The owner's contract: *N classes → N completely separate timetables, each
internally complete and conflict-free (no teacher conflicts, no room
conflicts, no overlapping lessons, no unexplained gaps, all required
weekly hours, every subject scheduled, a teacher and a room for every
lesson, all applicable constraints satisfied), while still respecting
shared teachers and rooms across the school.* A school-wide aggregate
("112/118 periods, 97% coverage") cannot answer "is THIS class's
timetable complete?" — one broken class hides inside the average.

ADR-020 already defines the canonical storage: ONE versioned schedule;
class/teacher/room views are projections of the same
`timetable_entries`. T-409 made the class view honest. The remaining gap
was that **validation visibility was also only a projection-free
aggregate**: the canonical validator ran once over all entries, and no
per-class verdict existed anywhere.

## Decision

1. **Per-class validation is a DERIVED layer, never a second engine.**
   `buildClassTimetableReports(problem, { entries, violations, unplaced })`
   consumes the canonical validator's output plus the class's own entries
   and produces one `ClassTimetableReport` per class. No constraint rule
   is re-derived; completeness reuses the solver's own requirement math
   (`requiredPeriodsFor`). The report builder only ATTRIBUTES and
   AGGREGATES.

2. **Shared-resource clashes belong to every participating timetable.**
   A teacher/room clash is attributed to ALL classes occupying the slot
   with that resource, each side's message naming the other class. A
   teacher-scope aggregate (max weekly hours) is attributed to every
   class taught by that teacher. A class's own overlap
   (`class_double_booking`) is its own.

3. **Completeness is per-class and strict.** A class is `complete` only
   when ALL of the following hold: every required period placed, every
   subject scheduled, a teacher and a room on every lesson, and zero
   attributed hard violations. **Gaps** (free teaching periods strictly
   between the class's first and last lesson of a day) are counted and
   reported but do NOT flip completeness — a hole is a quality warning,
   not an inconsistency; hard clashes and missing hours are
   inconsistencies. This mirrors the canonical validator's semantics
   (hard vs soft) rather than inventing a third severity scale.

4. **The reports ride the existing persistence, computed at generation
   time.** Solver build v1.2.0 fills `statistics.perClass` inside the
   existing validation work unit (the T-409 progress contract — fixed
   denominator, event sequence — is unchanged). Both repositories
   persist it through the existing statistics JSONB: no migration, no
   new table, no per-class versions. Readback is absence-tolerant
   (`readClassTimetableReports`): pre-T-410 versions yield `[]`,
   rendered as "no per-class data" — never "all classes fine".

5. **Every projection surface is ONE entity's timetable.** A null entity
   renders the honest "select an entity" empty state in ALL three modes;
   the universal all-classes mixed grid (the teacher/room "Tout
afficher" fallback) is removed from the product. The LIST-cell stacking
   from T-409 remains as anomaly tolerance: a data defect shows both
   lessons, overwriting nothing.

## Consequences

- The staff can verify any class's timetable on its own: a status strip
  in class mode, and a per-class table (own coverage, own attributed
  conflicts, own gaps, own status, per-class "Examiner") in the trials
  panel with an "X/Y classes complètes" rollup.
- `perClass.placedPeriods` counts ALL the class's entries INCLUDING
  locked pins, while the global `statistics.placedPeriods` excludes
  them — consumers must not diff them naively (documented on the type).
- Per-class reports are a point-in-time snapshot persisted with the
  version; manual adjustments after generation do not recompute them
  until the next generation (the live validation of a manual move still
  runs the canonical engine — SCHED-108 covers its pre-existing-violation
  filtering).
- The solver's placement algorithm is untouched: its quality follow-ups
  (SCHED-107 nominal-capacity room fit, SCHED-110 no-backtracking corner
  case) remain the registered pass.

## Verification (evidence)

27 new tests green (domain 21 + UI 6, incl. the owner's exact 3×5AP +
2×2AM five-class shared-teacher fixture); the 41 T-404 and 32 T-409
timetable suites unchanged-green; full vitest 3809/21/5 with the
byte-identical documented baseline; tsc 0; eslint 0 on changed files.
Record: `docs/recovery/t-410-per-class-timetables.md` §7.
