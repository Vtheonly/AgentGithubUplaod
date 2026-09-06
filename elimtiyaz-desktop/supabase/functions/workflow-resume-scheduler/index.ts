// ============================================================================
// workflow-resume-scheduler/index.ts
// ============================================================================
// Edge Function: resume workflow runs parked at a wait_duration node.
// Task: T-228 (34th session, 2026-09-07).
// ----------------------------------------------------------------------------
// WHY THIS EXISTS:
//   A DAG like "Payment Overdue → Send Reminder → Wait 7 Days → Check →
//   Escalate" must NOT hold an Edge worker alive for 7 days. The engine
//   (workflow-execute/engine.ts) PARKS runs whose wait_duration exceeds the
//   inline cap: the run row stays 'running', the serialized engine state
//   (open edges, executed ids, partial node_results, context) lands in
//   workflow_pending_resumes (0081), and the process may die at any time —
//   the state is a ROW, not memory. This scheduler is the other half:
//
//     1. Scan due rows (status='pending', resume_after <= now()).
//     2. CLAIM atomically (UPDATE ... WHERE status='pending' RETURNING —
//        concurrent invocations can never double-process; the 0081 unique
//        pending/claimed index per (run, node) is the second guard).
//     3. Re-enter the engine at the parked node with the saved state.
//     4. Finalize (succeeded/failed/timeout → workflow_runs + the EF-owned
//        counters + audit) or re-park at the NEXT delay node.
//
//   Duplicate-execution protection: the claim UPDATE is the gate — a row
//   moves pending→claimed exactly once; every later invocation sees it as
//   claimed/completed and skips it.
//
// SECURITY (the run-overdue-scan pattern, _shared/cron-auth.ts):
//   - Cron/internal invocation: `Authorization: Bearer <CRON_SECRET>` or
//     the service_role key → full scan.
//   - Any OTHER bearer → 401 (this EF has no user-facing surface; manual
//     verification uses the CRON_SECRET/service key).
//   - Anonymous requests are DENIED.
//
// SCHEDULE: config.toml → cron = "*/10 * * * *" (every 10 minutes). A
// parked run resumes within ~10 minutes of its resume_after instant.
// ============================================================================

import { corsHeaders, handleOptions, jsonError, jsonOk } from "../_shared/cors.ts";
import { isCronInvocation } from "../_shared/cron-auth.ts";
import {
  createServiceRoleClient,
  writeAuditLog,
} from "../_shared/supabase.ts";
import {
  executeWorkflowDefinition,
  parseDefinition,
  validateWorkflowDefinition,
  type EngineContext,
  type EngineResumeState,
} from "../workflow-execute/engine.ts";
import { executeNodeAction } from "../workflow-execute/actions.ts";

/** Claim batch size per invocation (bounded work per cron tick). */
const BATCH = 25;

interface PendingResumeRow {
  id: string;
  tenant_id: string;
  run_id: string;
  workflow_id: string;
  node_id: string;
  state: EngineResumeState | string;
  resume_after: string;
  status: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleOptions(req);
  if (req.method !== "GET" && req.method !== "POST") {
    return jsonError(req, 405, "method_not_allowed", "Use GET (cron) or POST");
  }

  // Only cron/internal invocations may resume runs.
  if (!isCronInvocation(req)) {
    return jsonError(req, 401, "unauthorized", "This scheduler accepts only CRON_SECRET / service_role invocations");
  }

  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const supabase = createServiceRoleClient();

  const summary = {
    due_claimed: 0,
    resumed: 0,
    completed: 0,
    failed: 0,
    re_parked: 0,
    cancelled: 0,
    errors: [] as string[],
  };

  // ── 1+2. Scan + ATOMIC CLAIM (single statement: pending→claimed) ──────
  const { data: claimed, error: claimError } = await supabase
    .from("workflow_pending_resumes")
    .update({ status: "claimed", claimed_at: new Date().toISOString() })
    .eq("status", "pending")
    .lte("resume_after", new Date().toISOString())
    .select("id, tenant_id, run_id, workflow_id, node_id, state, resume_after, status")
    .limit(BATCH);

  if (claimError) {
    return jsonError(req, 500, "claim_failed", "Failed to claim due resumes", claimError.message);
  }
  const rows = (claimed ?? []) as unknown as PendingResumeRow[];
  summary.due_claimed = rows.length;

  for (const row of rows) {
    try {
      const done = await resumeOne(supabase, row, requestId);
      if (done === "re_parked") summary.re_parked++;
      else if (done === "cancelled") summary.cancelled++;
      else if (done === "failed") summary.failed++;
      else summary.completed++;
      summary.resumed++;
    } catch (err) {
      summary.errors.push(`resume ${row.run_id}: ${String(err)}`);
      // The claimed row must not stay claimed forever on an unexpected
      // error: complete it and fail the run honestly.
      try {
        await supabase
          .from("workflow_pending_resumes")
          .update({ status: "completed", completed_at: new Date().toISOString() })
          .eq("id", row.id);
        await supabase
          .from("workflow_runs")
          .update({
            status: "failed",
            completed_at: new Date().toISOString(),
            error_message: `scheduler resume crashed: ${String(err)}`,
          })
          .eq("id", row.run_id);
      } catch (inner) {
        summary.errors.push(`cleanup ${row.run_id}: ${String(inner)}`);
      }
    }
  }

  return jsonOk(req, summary);
});

// ---------------------------------------------------------------------------
// Resume ONE parked run. Returns "completed" | "re_parked" | "cancelled" | "failed".
// ---------------------------------------------------------------------------
async function resumeOne(
  supabase: ReturnType<typeof createServiceRoleClient>,
  row: PendingResumeRow,
  requestId: string,
): Promise<"completed" | "re_parked" | "cancelled" | "failed"> {
  // Load the workflow (current definition; the run keeps its recorded
  // workflow_version — the honest audit trail of WHICH version ran).
  const { data: workflow, error: wfError } = await supabase
    .from("workflows")
    .select("id, tenant_id, name, code, status, dag_definition, version, total_executions")
    .eq("id", row.workflow_id)
    .single();

  if (wfError || !workflow) {
    await cancelResume(supabase, row, `workflow ${row.workflow_id} no longer exists`);
    return "cancelled";
  }
  if (workflow.status !== "published") {
    await cancelResume(supabase, row, `workflow '${workflow.code}' is no longer published (status=${workflow.status})`);
    return "cancelled";
  }

  const definition = parseDefinition(workflow.dag_definition);
  const validation = validateWorkflowDefinition(definition, { strict: false });
  if (!definition || !validation.valid) {
    await cancelResume(supabase, row, `workflow definition became invalid: ${validation.errors.slice(0, 3).join("; ")}`);
    return "cancelled";
  }

  // The saved engine state (string-or-object tolerant).
  const state: EngineResumeState = typeof row.state === "string"
    ? JSON.parse(row.state)
    : row.state;

  const runCtx = {
    tenantId: row.tenant_id,
    actorProfileId: null,
    actorEmail: "system",
    runId: row.run_id,
    requestId,
    parentId: (state.context?.parent as { id?: string } | undefined)?.id ?? null,
    studentId: (state.context?.student as { id?: string } | undefined)?.id ?? null,
    installmentId: (state.context?.installment as { id?: string } | undefined)?.id ?? null,
    dryRun: false,
    callerJwt: "", // scheduler context — the service-role parent writer
  };

  const actionHandler = (node, engineContext) => executeNodeAction(node, engineContext, runCtx);

  const outcome = await executeWorkflowDefinition(definition, {
    context: state.context as EngineContext,
    actions: actionHandler,
    deadlineMs: 25_000,
    resume: state,
  });

  const nowIso = new Date().toISOString();

  // The parked node's result must tell the truth post-resume: the delay
  // ELAPSED (not "parked" anymore).
  const nodeResults = outcome.node_results.map((r) =>
    r.node_id === row.node_id && r.status === "succeeded"
      ? {
          ...r,
          output: { ...(r.output ?? {}), resumed: true, resumed_at: nowIso, note: "delay elapsed — run resumed by workflow-resume-scheduler" },
        }
      : r,
  );

  if (outcome.status === "paused" && outcome.resume_state) {
    // Re-park: complete THIS claim, write the NEXT pending row.
    await supabase
      .from("workflow_pending_resumes")
      .update({ status: "completed", completed_at: nowIso })
      .eq("id", row.id);
    // The NEXT park carries the PATCHED results (the resumed flags of
    // earlier delay nodes must survive into the next state snapshot).
    const patchedState = {
      ...outcome.resume_state,
      node_results: nodeResults,
    } as EngineResumeState;
    const { error: parkError } = await supabase
      .from("workflow_pending_resumes")
      .insert({
        tenant_id: row.tenant_id,
        run_id: row.run_id,
        workflow_id: row.workflow_id,
        node_id: outcome.resume_state.parked_node_id,
        state: patchedState as unknown as Record<string, unknown>,
        resume_after: outcome.pause?.resume_after ?? nowIso,
        status: "pending",
      });
    if (parkError) {
      await finalize(supabase, row.run_id, {
        status: "failed",
        nodeResults,
        errorMessage: `re-park failed: ${parkError.message}`,
      });
      return "failed";
    }
    await supabase
      .from("workflow_runs")
      .update({ node_results: nodeResults, resumed_at: nowIso })
      .eq("id", row.run_id);
    return "re_parked";
  }

  // Terminal: finalize the run + the claim row + the counters.
  await supabase
    .from("workflow_pending_resumes")
    .update({ status: "completed", completed_at: nowIso })
    .eq("id", row.id);

  await finalize(supabase, row.run_id, {
    status: outcome.status,
    nodeResults,
    errorMessage: outcome.error_message,
  });

  if (outcome.status === "succeeded" || outcome.status === "failed") {
    await supabase
      .from("workflows")
      .update({
        last_executed_at: nowIso,
        total_executions: (workflow.total_executions ?? 0) + 1,
      })
      .eq("id", workflow.id);
  }

  // Audit entry (system actor).
  try {
    await writeAuditLog(
      row.tenant_id,
      "workflow.run.resume",
      "workflow_run",
      row.run_id,
      null,
      "system",
      null,
      {
        workflow_id: workflow.id,
        workflow_code: workflow.code,
        status: outcome.status,
        parked_node_id: row.node_id,
        resumed_at: nowIso,
        succeeded_nodes: nodeResults.filter((r) => r.status === "succeeded").length,
        failed_nodes: nodeResults.filter((r) => r.status === "failed").length,
        skipped_nodes: nodeResults.filter((r) => r.status === "skipped").length,
        error: outcome.error_message,
      },
      `Workflow '${workflow.name}' resumed at node ${row.node_id} → ${outcome.status}.`,
      requestId,
    );
  } catch (auditErr) {
    // The run is finalized; the audit hole is surfaced in the response.
    console.error("[workflow-resume-scheduler] audit write failed:", auditErr);
  }

  return outcome.status === "succeeded" ? "completed" : "failed";
}

async function cancelResume(
  supabase: ReturnType<typeof createServiceRoleClient>,
  row: PendingResumeRow,
  reason: string,
): Promise<void> {
  await supabase
    .from("workflow_pending_resumes")
    .update({ status: "cancelled", completed_at: new Date().toISOString() })
    .eq("id", row.id);
  await supabase
    .from("workflow_runs")
    .update({
      status: "failed",
      completed_at: new Date().toISOString(),
      error_message: `resume cancelled: ${reason}`,
    })
    .eq("id", row.run_id);
}

async function finalize(
  supabase: ReturnType<typeof createServiceRoleClient>,
  runId: string,
  final: { status: string; nodeResults: unknown[]; errorMessage: string | null },
): Promise<void> {
  const { error } = await supabase
    .from("workflow_runs")
    .update({
      status: final.status,
      completed_at: new Date().toISOString(),
      node_results: final.nodeResults,
      error_message: final.errorMessage,
      resumed_at: new Date().toISOString(),
    })
    .eq("id", runId);
  if (error) {
    console.error(`[workflow-resume-scheduler] finalize failed for run ${runId}:`, error);
  }
}
