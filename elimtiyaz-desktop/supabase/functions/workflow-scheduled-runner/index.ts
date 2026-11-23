// ============================================================================
// workflow-scheduled-runner/index.ts
// ============================================================================
// Edge Function: fire DEPLOYED scheduled workflows whose cron is due.
// Task: T-584 (scheduled automation runner — EXECUTION-PLAN §4 5.16,
// ROADMAP 5.16; the S11 §F15 design).
// ----------------------------------------------------------------------------
// WHY THIS EXISTS:
//   The workflow fleet had TWO run paths — manual/event executions through
//   workflow-execute, and parked-delay resumes through
//   workflow-resume-scheduler — but the `scheduled`/`calendar_cron_event`
//   trigger family had NO runner: a published "Clôture Trimestrielle"
//   (cron 0 18 * * 12) deployed once and then never fired. This EF is the
//   missing third path.
//
//   Every 10 minutes (config.toml cron = "*/10 * * * *"):
//     1. Enumerate published workflows (all tenants — service role).
//     2. selectDueScheduledWorkflows (./core.ts — the SAME pure core the
//        desktop's mock tick + tests use): a workflow is schedulable iff
//        its DAG has a calendar_cron_event/schedule trigger root with a
//        parseable 5-field cron; it is DUE iff the cron fires in the
//        (now-10min, now] window. Adjacent windows are disjoint — the
//        same cron instant can never fire twice.
//     3. For each DUE workflow: daily-cap check (max_daily_executions,
//        the workflow-execute contract) → insert workflow_runs
//        (trigger_type='calendar_cron_event' | 'schedule' per the 0001
//        enum) → execute through the SAME engine
//        (workflow-execute/engine.ts + actions.ts) → park long delays
//        (workflow-resume-scheduler picks them up) or finalize →
//        last_executed_at/total_executions (0012, completed runs only) →
//        audit (workflow.run.scheduled, system actor).
//
//   A scheduled run carries NO entity context (no parent/student — the
//   cron fired, not an event): the engine context is { workflow, now,
//   window } and conditions resolve against default values, exactly like
//   a manual run without entity ids.
//
// SECURITY (the workflow-resume-scheduler pattern, _shared/cron-auth.ts):
//   - Cron/internal invocation: `Authorization: Bearer <CRON_SECRET>` or
//     the service_role key (the platform's managed scheduler injects the
//     latter; pg_cron + pg_net operators must pass CRON_SECRET).
//   - EVERYTHING else → 401 (no user-facing surface).
//   - Anonymous requests are DENIED (fail closed).
//
// DRY RUN (the card's verification half): POST {"dry_run": true} (still
//   cron-auth-gated) enumerates + selects + simulates due workflows
//   through the engine with simulated actions — NO workflow_runs row, NO
//   counter consumption, one audit entry per dry-fired workflow
//   (the workflow-execute T-229 contract).
//
// SCHEDULE: config.toml → cron = "*/10 * * * *". A cron instant fires
//   within ~10 minutes of its due time; sub-10-minute granularities are
//   delayed to the next tick (the documented runner cadence).
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
} from "../workflow-execute/engine.ts";
import { executeNodeAction } from "../workflow-execute/actions.ts";
import {
  selectDueScheduledWorkflows,
  windowForTick,
  type ScheduledWorkflowCandidate,
} from "./core.ts";

/** Bounded work per tick (the resume-scheduler's BATCH discipline). */
const MAX_FIRES_PER_TICK = 10;

interface WorkflowRow extends ScheduledWorkflowCandidate {
  readonly dag_definition: unknown;
  readonly max_daily_executions: number | null;
  readonly version: number | null;
  readonly total_executions: number | null;
  readonly tenant_id: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleOptions(req);
  if (req.method !== "GET" && req.method !== "POST") {
    return jsonError(req, 405, "method_not_allowed", "Use GET (cron) or POST (cron / dry-run)");
  }

  // Only cron/internal invocations may fire scheduled workflows.
  if (!isCronInvocation(req)) {
    return jsonError(req, 401, "unauthorized", "This runner accepts only CRON_SECRET / service_role invocations");
  }

  let dryRun = false;
  if (req.method === "POST") {
    try {
      const body = await req.json();
      dryRun = body?.dry_run === true;
    } catch {
      // Empty/invalid body on POST → the plain cron path (GET-equivalent).
    }
  }

  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const supabase = createServiceRoleClient();
  const nowMs = Date.now();
  const window = windowForTick(nowMs);

  // ── 1. Enumerate published workflows (all tenants). ────────────────────
  const { data: rows, error: selectError } = await supabase
    .from("workflows")
    .select("id, tenant_id, name, code, status, trigger_type, dag_definition, max_daily_executions, version, total_executions")
    .eq("status", "published")
    .limit(500);

  if (selectError) {
    return jsonError(req, 500, "enumerate_failed", "Failed to enumerate published workflows", selectError.message);
  }

  // ── 2. Select due workflows (the shared core). ──────────────────────────
  const selection = selectDueScheduledWorkflows((rows ?? []) as unknown as WorkflowRow[], window);

  const summary = {
    tick: new Date(nowMs).toISOString(),
    window_start: new Date(window.startMs).toISOString(),
    published_candidates: (rows ?? []).length,
    due: selection.due.length,
    fired: 0,
    dry_fired: 0,
    skipped_by_daily_cap: 0,
    failed: 0,
    skipped: selection.skipped,
    errors: [] as string[],
  };

  for (const due of selection.due.slice(0, MAX_FIRES_PER_TICK)) {
    const wf = due.workflow as WorkflowRow;
    try {
      const fired = await fireOne(supabase, wf, due.cron, due.triggerNodeId, {
        dryRun,
        requestId,
        window,
      });
      if (fired === "dry_fired") summary.dry_fired++;
      else summary.fired++;
    } catch (err) {
      summary.failed++;
      summary.errors.push(`fire ${wf.code ?? wf.id}: ${String(err)}`);
    }
  }
  if (selection.due.length > MAX_FIRES_PER_TICK) {
    summary.errors.push(
      `due list truncated: ${selection.due.length - MAX_FIRES_PER_TICK} workflow(s) deferred to the next tick`,
    );
  }

  return jsonOk(req, { ...summary, dry_run: dryRun });
});

// ---------------------------------------------------------------------------
// Fire ONE due workflow. Returns "fired" | "dry_fired" | "capped" | "skipped".
// ---------------------------------------------------------------------------
async function fireOne(
  supabase: ReturnType<typeof createServiceRoleClient>,
  wf: WorkflowRow,
  cron: string,
  triggerNodeId: string,
  opts: { dryRun: boolean; requestId: string; window: { startMs: number; endMs: number } },
): Promise<"fired" | "dry_fired" | "capped" | "skipped"> {
  // Parse + validate (the execution-time gate — mirrors workflow-execute).
  const definition = parseDefinition(wf.dag_definition);
  const validation = validateWorkflowDefinition(definition, { strict: false });
  if (!definition || !validation.valid) {
    await writeAuditLog(
      wf.tenant_id,
      "workflow.scheduled.invalid",
      "workflow",
      wf.id,
      null,
      "system",
      null,
      { workflow_id: wf.id, workflow_code: wf.code, cron, errors: validation.errors.slice(0, 3) },
      `Scheduled workflow '${wf.name}' skipped — definition invalid.`,
      opts.requestId,
    );
    return "skipped";
  }

  // Daily cap (the workflow-execute contract; dry runs never consume it).
  const maxDaily = Number(wf.max_daily_executions ?? 0);
  if (!opts.dryRun && maxDaily > 0) {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const { count, error: countError } = await supabase
      .from("workflow_runs")
      .select("id", { count: "exact", head: true })
      .eq("workflow_id", wf.id)
      .eq("tenant_id", wf.tenant_id)
      .gte("started_at", todayStart.toISOString());
    if (countError) {
      throw new Error(`daily-cap check failed: ${countError.message}`);
    }
    if ((count ?? 0) >= maxDaily) {
      return "capped";
    }
  }

  // A scheduled run carries NO entity context — the cron fired, not an
  // event. The engine context is the schedule itself.
  const context: EngineContext = {
    workflow: {
      id: wf.id,
      code: wf.code,
      name: wf.name,
      version: wf.version ?? 1,
      now: new Date().toISOString(),
      window_start: new Date(opts.window.startMs).toISOString(),
      window_end: new Date(opts.window.endMs).toISOString(),
      cron,
    },
  };

  const runCtx = {
    tenantId: wf.tenant_id,
    actorProfileId: null,
    actorEmail: "system",
    runId: null as string | null,
    requestId: opts.requestId,
    parentId: null,
    studentId: null,
    installmentId: null,
    dryRun: opts.dryRun,
    callerJwt: "", // scheduler context — the service-role parent writer
  };

  const actionHandler = (node, engineContext) => executeNodeAction(node, engineContext, runCtx);

  // ── DRY RUN: simulate, audit, done (no run row, no counters). ───────────
  if (opts.dryRun) {
    const dry = await executeWorkflowDefinition(definition, {
      context,
      actions: actionHandler,
      deadlineMs: 25_000,
    });
    await writeAuditLog(
      wf.tenant_id,
      "workflow.scheduled.dry_run",
      "workflow",
      wf.id,
      null,
      "system",
      null,
      {
        workflow_id: wf.id,
        workflow_code: wf.code,
        cron,
        status: dry.status,
        succeeded: dry.node_results.filter((r) => r.status === "succeeded").length,
        failed: dry.node_results.filter((r) => r.status === "failed").length,
        skipped: dry.node_results.filter((r) => r.status === "skipped").length,
      },
      `Dry-run of scheduled workflow '${wf.name}' (cron ${cron}) → ${dry.status}.`,
      opts.requestId,
    );
    return "dry_fired";
  }

  // ── REAL RUN: the 0081 contract columns. ────────────────────────────────
  const triggerType = wf.trigger_type === "schedule" ? "schedule" : "calendar_cron_event";
  const runStartedAt = new Date().toISOString();
  const runStartPerf = performance.now();

  const { data: runRow, error: insertError } = await supabase
    .from("workflow_runs")
    .insert({
      tenant_id: wf.tenant_id,
      workflow_id: wf.id,
      workflow_version: wf.version ?? 1,
      trigger_type: triggerType,
      actor_id: null,
      status: "running",
      started_at: runStartedAt,
      node_results: [],
      actor_note: `scheduled tick ${new Date(opts.window.endMs).toISOString()} — cron '${cron}'`,
      request_id: opts.requestId,
    })
    .select("id")
    .single();

  if (insertError || !runRow) {
    throw new Error(`workflow_runs insert failed: ${insertError?.message ?? "no row"}`);
  }
  const runId = runRow.id;
  runCtx.runId = runId;

  const accumulated: unknown[] = [];
  const onNodeResult = (result): void => {
    accumulated.push(result);
    void supabase
      .from("workflow_runs")
      .update({ node_results: accumulated })
      .eq("id", runId)
      .then(({ error }) => {
        if (error) {
          console.error(`[workflow-scheduled-runner] progressive persist failed for run ${runId}:`, error);
        }
      });
  };

  const outcome = await executeWorkflowDefinition(definition, {
    context,
    actions: actionHandler,
    deadlineMs: 25_000,
    onNodeResult,
  });

  // Park long delays (workflow-resume-scheduler resumes them — the SAME
  // contract as workflow-execute's park).
  if (outcome.status === "paused" && outcome.resume_state) {
    const { error: parkError } = await supabase
      .from("workflow_pending_resumes")
      .insert({
        tenant_id: wf.tenant_id,
        run_id: runId,
        workflow_id: wf.id,
        node_id: outcome.resume_state.parked_node_id,
        state: outcome.resume_state as unknown as Record<string, unknown>,
        resume_after: outcome.pause?.resume_after ?? new Date().toISOString(),
        status: "pending",
      });
    if (parkError) {
      await supabase
        .from("workflow_runs")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          duration_ms: Math.round(performance.now() - runStartPerf),
          node_results: outcome.node_results,
          error_message: `park failed: ${parkError.message}`,
        })
        .eq("id", runId);
      throw new Error(`park failed: ${parkError.message}`);
    }
    await writeAuditLog(
      wf.tenant_id,
      "workflow.run.scheduled",
      "workflow_run",
      runId,
      null,
      "system",
      { workflow_id: wf.id, workflow_code: wf.code, status: "running" },
      {
        workflow_id: wf.id,
        workflow_code: wf.code,
        run_id: runId,
        cron,
        trigger_node_id: triggerNodeId,
        status: "paused",
        parked_node_id: outcome.resume_state.parked_node_id,
        resume_after: outcome.pause?.resume_after,
      },
      `Scheduled workflow '${wf.name}' fired (cron ${cron}) and parked at a delay node.`,
      opts.requestId,
    );
    return "fired";
  }

  // Finalize: the run row + the counters (0012 — completed runs only).
  const runCompletedAt = new Date().toISOString();
  const durationMs = Math.round(performance.now() - runStartPerf);
  const { error: finalizeError } = await supabase
    .from("workflow_runs")
    .update({
      status: outcome.status,
      completed_at: runCompletedAt,
      duration_ms: durationMs,
      node_results: outcome.node_results,
      error_message: outcome.error_message,
    })
    .eq("id", runId);
  if (finalizeError) {
    console.error(`[workflow-scheduled-runner] finalize failed for run ${runId}:`, finalizeError);
  }

  if (outcome.status === "succeeded" || outcome.status === "failed") {
    const { error: counterError } = await supabase
      .from("workflows")
      .update({
        last_executed_at: runCompletedAt,
        total_executions: (wf.total_executions ?? 0) + 1,
      })
      .eq("id", wf.id);
    if (counterError) {
      console.error(`[workflow-scheduled-runner] counter update failed for ${wf.id}:`, counterError);
    }
  }

  await writeAuditLog(
    wf.tenant_id,
    "workflow.run.scheduled",
    "workflow_run",
    runId,
    null,
    "system",
    { workflow_id: wf.id, workflow_code: wf.code, status: "running" },
    {
      workflow_id: wf.id,
      workflow_code: wf.code,
      run_id: runId,
      cron,
      trigger_node_id: triggerNodeId,
      status: outcome.status,
      duration_ms: durationMs,
      succeeded_nodes: outcome.node_results.filter((r) => r.status === "succeeded").length,
      failed_nodes: outcome.node_results.filter((r) => r.status === "failed").length,
      skipped_nodes: outcome.node_results.filter((r) => r.status === "skipped").length,
      error: outcome.error_message,
    },
    `Scheduled workflow '${wf.name}' fired (cron ${cron}) → ${outcome.status}.`,
    opts.requestId,
  );

  return "fired";
}
