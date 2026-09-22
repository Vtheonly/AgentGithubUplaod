// ============================================================================
// FILE: src/domain/calc/timetable/generation-progress.ts
// ============================================================================
/**
 * The ONE generation-progress emission policy shared by BOTH Timetable
 * repository implementations (Supabase + mock) — T-409 / SCHED-111.
 *
 * The protocol (see ADR-021):
 *  1. The repository emits `loading` (denominator not yet known → total 0,
 *     the UI renders an indeterminate state — never a fake percentage).
 *  2. The solver's own events are RE-BASED onto the run denominator:
 *     solver units + 1 (the completed loading unit) + 1 (the pending
 *     saving unit). The denominator is therefore FIXED for the whole run
 *     and the wrapped progress NEVER reaches 100% while the solver runs.
 *  3. `beginSaving` holds the bar at the last value.
 *  4. `complete` emits the terminal 100% — ONLY after the version and its
 *     entries have actually been persisted. Failure paths never call it,
 *     so a failed run can never leave a false 100% state.
 *
 * This module contains NO scheduling logic — it only translates the
 * solver-agnostic progress channel (model/timetable.ts) into the
 * repository-level run counters.
 */

import type {
  TimetableGenerationProgress,
  TimetableProgressListener,
} from "../../model/timetable";
import type { TimetableSolveOptions } from "./solver/solver-types";

export interface GenerationProgressForwarder {
  /** Solver options forwarding re-based progress (pass to solve/solveAsync). */
  readonly solverOptions: TimetableSolveOptions;
  /** Emit AFTER the solve finished, BEFORE the version insert. */
  beginSaving(): void;
  /**
   * Emit the terminal 100% AFTER the version + entries are persisted.
   * @param versionNumber the generated trial's number.
   * @param placed placed periods (solution statistics).
   * @param required required periods (solution statistics).
   */
  complete(versionNumber: number, placed: number, required: number): void;
}

export function createGenerationProgressForwarder(
  emit: TimetableProgressListener,
): GenerationProgressForwarder {
  let last: TimetableGenerationProgress = {
    stage: "loading",
    processed: 0,
    total: 0,
    message: "",
  };
  return {
    solverOptions: {
      onProgress: (p) => {
        // Re-base: +1 completed loading unit, +1 pending saving unit.
        last = {
          ...p,
          processed: p.processed + 1,
          total: p.total + 2,
        };
        emit(last);
      },
    },
    beginSaving(): void {
      // Hold the bar. When the solver emitted nothing (an adapter without
      // progress support), the saving unit itself is the only known work.
      const total = last.total > 0 ? last.total : 1;
      last = {
        stage: "saving",
        processed: Math.min(last.processed, total),
        total,
        message: "Enregistrement de l'essai…",
      };
      emit(last);
    },
    complete(versionNumber: number, placed: number, required: number): void {
      const total = last.total > 0 ? last.total : 1;
      emit({
        stage: "saving",
        processed: total,
        total,
        message: `Essai ${versionNumber} enregistré — ${placed} / ${required} périodes placées (couverture ${
          required > 0 ? Math.round((placed / required) * 100) : 0
        }%).`,
      });
    },
  };
}
