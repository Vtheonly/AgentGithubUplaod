// ============================================================================
// FILE: src/domain/calc/timetable/solver/solver-types.ts
// ============================================================================
/**
 * The TimetableSolver adapter contract — T-404 (ADR-020 §3/§4).
 *
 * A STABLE, solver-agnostic interface. The application (repository, UI,
 * packaging) depends ONLY on this contract — never on solver-specific
 * types, file paths, or runtimes. The default implementation is the native
 * TypeScript solver (`ts-greedy-v1`, bundled into the app bundle); an
 * external solver (e.g. FET as a packaged Electron resource) can be added
 * later as another registry entry WITHOUT rewriting the application.
 *
 * Solvers MUST be deterministic: the same problem produces the same
 * solution (fixture reproducibility / packaging gate 8).
 */

import type {
  TimetableProblem,
  TimetableSolution,
  TimetableProgressListener,
} from "../../../model/timetable";

/** Optional per-solve behaviour — T-409 (the progress channel). */
export interface TimetableSolveOptions {
  /**
   * REAL incremental progress from the solver's actual work units
   * (requirement indexing, block placement, repair, validation).
   * The event sequence is DETERMINISTIC for a deterministic solver: the
   * same problem emits the same sequence. Never timer-based.
   */
  readonly onProgress?: TimetableProgressListener;
}

export interface TimetableSolver {
  /** Stable solver identifier (persisted on every version for reproducibility). */
  readonly id: string;
  /** Build/version stamp (persisted; e.g. "v1.0.0+20260922"). */
  readonly build: string;
  /** Human-readable description (FR, staff-facing diagnostics). */
  readonly description: string;
  /**
   * Solve the problem. NEVER throws for constraint-level impossibility —
   * an impossible schedule is REPORTED (status "invalid"/"partial" +
   * unplaced reasons + violations), not silently truncated. Only
   * programming errors throw.
   *
   * T-409: `options.onProgress` (optional) receives real work-unit
   * progress. Backward compatible — existing `solve(problem)` callers
   * are unaffected.
   */
  solve(problem: TimetableProblem, options?: TimetableSolveOptions): TimetableSolution;
  /**
   * OPTIONAL non-blocking variant (T-409): the SAME deterministic
   * algorithm as `solve`, executed behind a yielding boundary so the
   * renderer can repaint between work units. Implementations that cannot
   * yield simply omit it — callers fall back to `solve`.
   */
  solveAsync?(
    problem: TimetableProblem,
    options?: TimetableSolveOptions,
  ): Promise<TimetableSolution>;
}

// ============================================================================
// Registry — solver selection is data, not imports scattered in the app
// ============================================================================

const registry = new Map<string, TimetableSolver>();

export function registerTimetableSolver(solver: TimetableSolver): void {
  registry.set(solver.id, solver);
}

export function getTimetableSolver(id: string): TimetableSolver | undefined {
  return registry.get(id);
}

export function listTimetableSolvers(): TimetableSolver[] {
  return [...registry.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function clearTimetableSolverRegistry(): void {
  registry.clear();
}
