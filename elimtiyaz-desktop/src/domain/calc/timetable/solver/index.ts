// ============================================================================
// FILE: src/domain/calc/timetable/solver/index.ts
// ============================================================================
/**
 * Solver registry bootstrap — T-404 (ADR-020).
 *
 * Importing this module registers the DEFAULT native TypeScript solver
 * (ts-greedy-v1). Registration is idempotent (the registry is keyed by
 * solver id), so repeated imports are safe.
 *
 * A future external solver (e.g. FET bundled as an Electron resource)
 * joins the system HERE — as another registry entry — without touching the
 * repository, UI, or domain model.
 */

export * from "./solver-types";
export {
  createGreedySolver,
  GREEDY_SOLVER_ID,
  GREEDY_SOLVER_BUILD,
} from "./greedy-solver";

import { registerTimetableSolver, getTimetableSolver } from "./solver-types";
import { createGreedySolver, GREEDY_SOLVER_ID } from "./greedy-solver";

if (!getTimetableSolver(GREEDY_SOLVER_ID)) {
  registerTimetableSolver(createGreedySolver());
}
