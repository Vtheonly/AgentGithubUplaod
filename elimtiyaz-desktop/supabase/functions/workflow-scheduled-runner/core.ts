// ============================================================================
// workflow-scheduled-runner/core.ts — the due-workflow selection core
// ============================================================================
// T-584. Deno-free (the cron.ts + _shared/cron-auth.ts precedent): the
// DESKTOP's vitest suite imports this module directly, so the EF's
// candidate-selection contract is PINNED by real tests — the EF index is
// the thin Deno.serve wrapper around this core (auth + DB I/O only).
//
// The contract:
//   1. A workflow is SCHEDULABLE iff its published DAG carries a root
//      trigger node of subtype `calendar_cron_event` or `schedule` (both
//      inspector flavours carry { cron, description }) with a PARSEABLE
//      5-field cron expression.
//   2. It is DUE iff that cron fires inside the tick window.
//   3. Draft/disabled workflows, non-scheduled triggers, malformed cron —
//      skipped with an explicit reason (never silently, never fatally).
// ============================================================================

import {
  parseCronExpression,
  cronFiresInWindow,
  type CronWindow,
} from "./cron.ts";

/** The minimal workflow row shape the core needs (the EF selects these). */
export interface ScheduledWorkflowCandidate {
  readonly id: string;
  readonly tenant_id: string;
  readonly name: string;
  readonly code: string;
  readonly status: string;
  readonly trigger_type: string | null;
  /** The stored dag_definition — JSON string or already-parsed object. */
  readonly dag_definition: unknown;
}

/** The trigger subtypes that own a cron expression. */
export const SCHEDULED_TRIGGER_SUBTYPES: readonly string[] = [
  "calendar_cron_event",
  "schedule",
];

interface DagShape {
  nodes?: Array<{ type?: string; subtype?: string; config?: Record<string, unknown> }>;
}

export interface DueSelection {
  readonly workflow: ScheduledWorkflowCandidate;
  readonly cron: string;
  /** The trigger node id that owns the cron (audit trail). */
  readonly triggerNodeId: string;
}

export interface SelectionResult {
  /** Workflows that must fire in this tick. */
  readonly due: DueSelection[];
  /** Skipped candidates with honest reasons (surfaced in the EF response). */
  readonly skipped: Array<{ id: string; name: string; reason: string }>;
}

function parseDag(raw: unknown): DagShape | null {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as DagShape).nodes)) {
      return parsed as DagShape;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Select the workflows that must fire in `window`.
 * `TICK_MS` is the runner's cadence (10 minutes) — exported for the tests.
 */
export const RUNNER_TICK_MS = 10 * 60 * 1000;

export function selectDueScheduledWorkflows(
  workflows: readonly ScheduledWorkflowCandidate[],
  window: CronWindow,
): SelectionResult {
  const due: DueSelection[] = [];
  const skipped: Array<{ id: string; name: string; reason: string }> = [];

  for (const wf of workflows) {
    if (wf.status !== "published") {
      // Drafts and disabled workflows never fire — expected, not an error:
      // recorded only when the caller pre-filtered nothing (the EF selects
      // status='published' server-side, so this branch is the desktop-side
      // guard).
      continue;
    }
    const dag = parseDag(wf.dag_definition);
    if (!dag) {
      skipped.push({ id: wf.id, name: wf.name, reason: "dag_definition is not a parseable DAG" });
      continue;
    }
    const triggerNode = (dag.nodes ?? []).find(
      (n) => n.type === "trigger" && SCHEDULED_TRIGGER_SUBTYPES.includes(String(n.subtype)),
    );
    if (!triggerNode) {
      // Not a scheduled workflow (event/manual triggers live on other
      // bridges) — expected, not an error.
      continue;
    }
    const cronExpr = String(triggerNode.config?.cron ?? "").trim();
    if (!cronExpr) {
      skipped.push({
        id: wf.id,
        name: wf.name,
        reason: `trigger node '${triggerNode.subtype}' carries no cron expression`,
      });
      continue;
    }
    const parsed = parseCronExpression(cronExpr);
    if (!parsed.ok) {
      skipped.push({ id: wf.id, name: wf.name, reason: `invalid cron '${cronExpr}': ${parsed.error}` });
      continue;
    }
    if (cronFiresInWindow(parsed.cron, window)) {
      due.push({
        workflow: wf,
        cron: cronExpr,
        triggerNodeId: String((triggerNode as { id?: string }).id ?? triggerNode.subtype),
      });
    }
  }

  return { due, skipped };
}

/**
 * The tick window for an invocation at `nowMs`: (now - 10 min, now].
 * Adjacent ticks produce DISJOINT windows (see cron.ts) — the same cron
 * instant can never fire twice across consecutive ticks.
 */
export function windowForTick(nowMs: number): CronWindow {
  return { startMs: nowMs - RUNNER_TICK_MS, endMs: nowMs };
}
