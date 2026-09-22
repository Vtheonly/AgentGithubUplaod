# ADR-021 — Timetable Generation Progress Contract: Solver-Agnostic Work Units + Shared Repository Emission Policy + Yielding Drain

**Date:** 2026-09-22
**Status:** Accepted (T-409 / SCHED-111)
**Context:** ADR-020 §3 defined the stable solver adapter as `solve(problem) → solution + violation report` — final-result-only. T-409 requires real-time generation observability without leaking greedy-solver internals into the UI and without faking progress behind a blocked renderer.

## Decision

1. **The progress contract lives in the CANONICAL MODEL** (`src/domain/model/timetable.ts`), not in a solver-specific type: `TimetableGenerationProgress { stage, processed, total, message }` + `TimetableProgressListener`. The six stages (`loading`, `preparing`, `placing`, `repairing`, `validating`, `saving`) span the WHOLE run — the repository owns loading/saving, the solver adapter owns the middle four. Stage labels are presentation constants in the model (same convention as `TIMETABLE_DAY_LABELS_FR`).
2. **Progress is REAL WORK, never time.** Work units are discrete algorithm steps: one requirement indexed (preparing), one block placed/retried (placing/repairing), one validation pass. The denominator (`requirements + blocks + 1`) is FIXED before the first event, counted via the same canonical `blockSplit`. `total === 0` means indeterminate (the loading stage) — consumers must render no percentage, never a fabricated one.
3. **The greedy core is a GENERATOR** (`solveGreedySteps`) that yields at work-unit boundaries. `solve` drains synchronously (backward compatible — existing callers unchanged); **`solveAsync`** drains the IDENTICAL step sequence behind a yielding boundary (one macrotask every 20 units) so the renderer repaints real progress. This is the "worker or yielding boundary" of T-409 §9, satisfied by the yielding variant: zero packaging risk (no Worker file in the Electron bundle), jsdom-testable, and byte-identical output (the determinism tests pin solution AND event sequence across both drains). A Web Worker remains possible later behind the same adapter signature without touching consumers.
4. **ONE emission policy for both repositories** (`src/domain/calc/timetable/generation-progress.ts`): solver events are re-based onto the run denominator (+1 completed loading unit, +1 pending saving unit) so the wrapped percentage NEVER reaches 100% while solving; `beginSaving()` holds the bar; `complete()` emits the terminal 100% ONLY after the version + entries are actually persisted. Failure paths return `Err` without emitting it — a failed run can never leave a false 100%.
5. **Coverage is a SEPARATE metric** (`timetableCoveragePercent`: `placedPeriods / requiredPeriods`), displayed independently of progress — a completed computation can legitimately produce an incomplete timetable (and vice versa: an impossible problem reaches 100% of WORK with honest unplaced blocks).

## Consequences

- Solvers that cannot emit progress simply omit `onProgress` handling — the repository falls back to `beginSaving`/`complete` on a 1-unit denominator; the UI degrades to stage labels without fake percentages.
- `solveAsync` is OPTIONAL on the `TimetableSolver` interface; the Supabase repository prefers it and falls back to `solve` — third-party adapters (e.g. a future FET bridge) require no change.
- The greedy solver's build stamp moved to `v1.1.0+20260922`: instrumentation only, output identical to v1.0.0 (pinned by the T-404 determinism tests + the new T-409 event-sequence tests).
- A UI may NEVER advance a progress bar with a timer while a T-409-conformant run is in flight — the regression suites treat timer-driven progress as a defect class (AGENTS.md §15.51).
