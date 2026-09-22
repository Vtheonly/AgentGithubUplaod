# T-409 / SCHED-111 — Timetable Must Be Class-First + Real-Time Generation Progress

**Date:** 2026-09-22  
**Status:** OPEN — P0  
**Task:** T-409 — Class-First Timetable Presentation & Real-Time Generation Progress  
**Problem:** SCHED-111  
**Related:** T-404, ADR-020, `src/features/academics/timetable/timetable-tab.tsx`, `timetable-grid.tsx`, `src/domain/calc/timetable/solver/solver-types.ts`

## 1. Executive summary

The Automatic Timetable feature is generating and storing a canonical schedule, but the primary staff presentation is currently wrong.

The main **Emploi du temps** view is supposed to answer a class-level question:

> **“For this class, what do the students study at each period, who teaches it, and where does it happen?”**

Instead, the current UI starts in **“Par classe”** but does not let the user select a class. It sends the grid the complete set of timetable entries and then collapses those entries into a single cell for each `day + period`. When several classes have lessons at the same time, they compete for the same grid cell and the later entry overwrites the earlier one.

The result is not a timetable for a class. It is a lossy mixed schedule assembled from multiple classes.

A second usability defect is that timetable generation only exposes a boolean `busy` state and a spinner. The user cannot see what the generator is doing, how far it has progressed, or how the percentage is calculated. The current solver adapter also exposes only a final synchronous `solve(problem)` result and has no progress event/callback contract.

T-409 must correct both problems without creating a second timetable model or changing the canonical scheduling rules.

## 2. Exact source-level root cause

### 2.1 “Par classe” has no class selector

In `TimetableTab`:

`viewMode = "class"`

But the entity selector is rendered only for:

`viewMode !== "class"`

So the primary class view does not select a class.

### 2.2 The class view receives all classes

The grid receives:

`viewEntityId={viewEntityId === "__all__" ? null : viewEntityId}`

and `TimetableGrid` treats a null entity as:

`if (!viewEntityId) return entries;`

Therefore the class view renders entries for every class.

### 2.3 Multiple classes overwrite the same cell

The grid builds its cell map with a key equivalent to:

`day + periodIndex`

The key is effectively:

`"\u0024{day}#\u0024{period.index}"`

That means these two valid records:

- Classe A — Monday — S3 — Mathematics
- Classe B — Monday — S3 — French

are treated as the same visual cell.

Because a JavaScript `Map` stores only one value per key, one entry overwrites the other.

This is the central rendering defect.

## 3. Why this is a real product bug, not merely a UI preference

The canonical timetable architecture explicitly treats class, teacher, and room views as projections of the **same canonical timetable entries**.

That does **not** mean the primary grid should flatten all entities into one schedule.

A timetable is contextual. The same period can legitimately contain different lessons for different classes:

`(class A, Monday, S3)`

and

`(class B, Monday, S3)`

are different schedule positions.

The current renderer removes `classId` from the visual key and therefore loses information that is present in the canonical data.

The consequence is that a staff member cannot reliably use the primary timetable screen to answer:

- What does 2AS-SC-A study on Tuesday S4?
- Which teacher teaches that lesson?
- Which room is assigned?
- Does this class have a free period?
- Is the class's complete weekly timetable coherent?

The generated data may be correct while the primary presentation is incorrect.

## 4. Expected product behavior

The primary timetable workflow must be:

**Emploi du temps → Select a class → Display the complete weekly timetable for that class**

The screen should clearly show:

**Classe: 2AS-SC-A**

| Period | Sunday | Monday | Tuesday | Wednesday | Thursday |
|---|---|---|---|---|---|
| S1 | Mathematics<br>Teacher X<br>Room 01 | Physics<br>Teacher Y<br>Lab SCI | ... | ... | ... |
| S2 | Arabic<br>Teacher Z<br>Room 02 | ... | ... | ... | ... |

Every occupied lesson cell must show at least:

`Subject + Teacher + Room`

The class itself is established by the page-level selected-class context.

## 5. Required view model

### Primary: class timetable

- Mandatory class selector.
- One selected class at a time.
- Grid filtered strictly by `classId`.
- No “Tout afficher” class timetable.
- No cross-class overwrite.
- Empty periods remain empty.
- Subject, teacher and room are visible.

### Secondary: teacher and room projections

Teacher and room views may remain because they are useful operational projections.

They must use the exact same canonical timetable entries and must not modify the class-first contract.

## 6. Real-time generation progress

The current generation flow shows only a spinner through the `busy` state.

That is insufficient. The operator must be able to observe the generation.

The UI should show, for example:

**Génération de l'emploi du temps**  
**63 / 118 blocs de placement traités**  
[███████████........] **53%**

The progress must be based on actual solver/runtime work.

### Required calculation

`progressPercent = round(processedWorkUnits / totalWorkUnits * 100)`

No fake timer-based progress is allowed.

Do not make a bar move from 0% to 100% merely to give the appearance of activity.

The numerator and denominator must correspond to real work.

## 7. Progress versus final coverage

These are different metrics.

### Generation progress

How far the computation has progressed:

`processedWorkUnits / totalWorkUnits`

### Final schedule coverage

How complete the resulting timetable actually is:

`coveragePercent = round(placedPeriods / requiredPeriods * 100)`

Example:

**Generation progress:** 100%  
**Final coverage:** 114 / 118 periods — 97%

A completed calculation can therefore legitimately produce a schedule whose coverage is below 100%.

The UI must not hide that distinction.

## 8. Visible generation stages

Expose the real stages where possible:

1. Chargement des données
2. Préparation des besoins
3. Placement des cours
4. Réparation / optimisation
5. Validation finale
6. Enregistrement de l'essai

The labels are UI presentation. The underlying progress events must come from the real generation process.

## 9. Solver architecture requirement

The current stable solver adapter is:

`solve(problem): TimetableSolution`

It exposes no incremental progress mechanism.

T-409 should add a solver-agnostic progress channel without leaking greedy-solver-specific structures into the UI.

The UI should consume something like a stable progress event containing:

`stage`  
`processed`  
`total`  
`message`

The exact API should be designed around the existing adapter architecture.

If the solver blocks the renderer long enough that React cannot paint progress updates, move the computation behind a worker/yielding boundary as necessary. Do not fake progress to compensate for a blocked UI thread.

## 10. Acceptance criteria

### Class view

- [ ] “Par classe” always has an explicit class selector.
- [ ] Selecting class A renders only class A entries.
- [ ] Selecting class B renders only class B entries.
- [ ] Three classes with lessons in the same period never overwrite one another in the class workflow.
- [ ] Every lesson identifies the subject, teacher and room where available.
- [ ] Empty periods remain visible.
- [ ] Teacher and room projections still use the same canonical entries.

### Progress

- [ ] Starting generation opens a visible progress state.
- [ ] Progress updates while the real solve is running.
- [ ] Percentage is calculated from actual processed work.
- [ ] No timer-based fake progress exists.
- [ ] The work counter has a meaningful denominator.
- [ ] Final coverage is displayed separately.
- [ ] Failure/cancellation does not falsely report 100%.
- [ ] Completion reaches 100% only after actual generation work completes.

### Regression tests

Use at least three classes with overlapping periods.

Prove that:

`(class A, day, period) != (class B, day, period)`

as visual schedule positions.

Also test the progress calculation and emitted progress events against known work counts.

## 11. Scope boundaries

Do not:

- create another timetable store;
- create another scheduling engine;
- change hard/soft constraint semantics;
- change timetable versioning;
- replace the canonical timetable repository;
- remove teacher/room projections.

This is a presentation/runtime-observability correction on top of T-404's existing canonical architecture.

## 12. Priority

**P0.**

The current primary timetable can display a mixed and lossy schedule, which makes the operator-facing result unreliable for class-level use.

The generation process is also opaque because the UI exposes only a busy indicator instead of real progress.
