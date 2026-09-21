# ADR-020 — Timetable Solver Architecture: Canonical TS Domain + Adapter + Native Solver + Versioned Publication

**Date:** 2026-09-22
**Status:** Accepted (T-404)
**Context:** T-404 — Automatic Timetable Generation & Constraint Scheduling; resolves UNKNOWN-011 (build-or-remove) in favor of BUILD.

## Decision

1. **One canonical timetable domain model** (`src/domain/model/timetable.ts`), TypeScript-owned, solver-agnostic. The legacy mock-only `TimetableEntry` in `teacher.ts` (SCHED-100 façade) is superseded — it stays untouched for the mock layer but must not be extended.
2. **One constraint contract** (`src/domain/calc/timetable/constraints.ts`): hard constraints invalidate a timetable; soft constraints may be violated only with explicit reporting. The canonical validator covers teacher, class AND room double-booking (closing SCHED-101 at the domain level) plus availability, free days, weekly hours, capacity and room-type compatibility.
3. **A stable solver adapter** (`TimetableSolver` interface): `solve(problem) → solution + violation report`. No UI or repository code may depend on solver-specific types or paths.
4. **The default solver is native TypeScript** (deterministic constructive heuristic + repair passes), bundled INTO the application bundle. Rationale: T-404 requires "no dependency on the user's PATH or installed runtimes"; a TS solver compiled into the renderer bundle has zero external runtime by construction. The adapter keeps the door open for an external solver (e.g. FET as a packaged Electron resource invoked through a future adapter) WITHOUT rewriting the application.
5. **Versioned generation with a strict review workflow**: draft → in_review → approved → published → archived (rejected terminal). ONE published version per academic year (DB partial unique index, migration 0109). Published/archived versions are immutable (trigger guard) — adjustments happen on a duplicated draft.
6. **The Algerian school profile is DATA** (migration 0109 §10 seeds `timetable_configurations`): school week Sunday→Thursday, 6 teaching periods 08:00–15:00, labeled breaks. The solver never hardcodes days or periods. (The legacy mock `SchoolDay` type's Mon–Fri "Algerian school week" comment is wrong — SCHED-102.)
7. **Backend ownership** (boundaries §8): the DB owns the persisted contract (tables, status machine, publication invariant, audit); the solver layer owns translation; the desktop owns configuration/review UX. Class, teacher and room views are projections of the SAME `timetable_entries` rows — no per-view stores.

## Consequences

- Any future solver swap (FET or other) is a new adapter + registry entry; the domain model, repository, UI and DB are unchanged.
- Cross-platform consumers (Android/Website) read the published version through the same tables/RLS (parents already see published entries — migration 0110).
- The constraint-kind list is a versioned contract (DB CHECK on `timetable_constraints.kind`); extending it requires a migration + domain update.
- Regeneration respects `is_locked` manual pins; manual moves are validated live against the same canonical validator before write, with the DB unique indexes as the final backstop.
