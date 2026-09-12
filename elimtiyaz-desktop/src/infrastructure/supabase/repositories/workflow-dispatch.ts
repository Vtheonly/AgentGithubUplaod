/**
 * T-314 — the Supabase event-bridge injection point.
 *
 * The academic/payment/student Supabase repositories need to fire workflow
 * triggers, but they are constructed BEFORE the workflow repository in the
 * composition root (`supabase-repositories.ts`) and must not import it
 * directly (layering + test isolation). This tiny module holds a LATE-BOUND
 * dispatcher that the composition root injects once the
 * SupabaseWorkflowRepository exists.
 *
 * Fail-safe by contract: when no dispatcher is injected (unit tests), calls
 * resolve to an empty result — the domain action never breaks.
 */
import type { Result } from "../../../core/result";
import type { WorkflowRun, WorkflowNodeSubtype } from "../../../domain/model/workflow";

export interface WorkflowDispatchRequest {
  /** The TRIGGER subtype that fired (e.g. "absence_limit_exceeded"). */
  readonly triggerSubtype: WorkflowNodeSubtype;
  /** The parent / student the event targets (EF real-entity loaders). */
  readonly parentId?: string | null;
  readonly studentId?: string | null;
  /** Extra context (merged UNDER the EF's real entity loaders server-side). */
  readonly context?: Record<string, unknown>;
  readonly actorId: string;
  readonly actorName: string;
}

export type WorkflowDispatcher = (
  request: WorkflowDispatchRequest,
) => Promise<Result<readonly WorkflowRun[]>>;

let dispatcher: WorkflowDispatcher | null = null;

/** Composition-root wiring (idempotent — last write wins). */
export function setWorkflowDispatcher(fn: WorkflowDispatcher | null): void {
  dispatcher = fn;
}

/** Whether a live dispatcher is wired (diagnostics / tests). */
export function hasWorkflowDispatcher(): boolean {
  return dispatcher !== null;
}

/**
 * Fire the trigger — NEVER throws. Unwired → empty success; a dispatcher
 * error → the error is swallowed here after the dispatcher has already
 * audit-logged it (the EF path logs server-side; the mock bridge logs via
 * appendAudit). The user action that triggered the event stays green.
 */
export async function dispatchWorkflowTriggerSafe(
  request: WorkflowDispatchRequest,
): Promise<readonly WorkflowRun[]> {
  if (!dispatcher) return [];
  try {
    const result = await dispatcher(request);
    return result.ok ? result.value : [];
  } catch {
    return [];
  }
}

/** Test helper — reset to the unwired state. */
export function resetWorkflowDispatcher(): void {
  dispatcher = null;
}
