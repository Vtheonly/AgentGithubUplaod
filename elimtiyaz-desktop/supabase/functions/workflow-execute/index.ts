// ============================================================================
// workflow-execute/index.ts
// ============================================================================
// Edge Function: Execute a published workflow DAG — T-225 REWRITE (34th
// session, 2026-09-07) on the PURE branch-aware engine (./engine.ts).
// ----------------------------------------------------------------------------
// WHAT CHANGED vs the v21 deployment (DAG-101):
//   - reads the REAL columns: workflows.dag_definition (+ .version from
//     0081) — the old build selected nonexistent `definition`/`version`
//     columns and 404'd on EVERY call;
//   - inserts the REAL workflow_runs columns (actor_id / actor_note /
//     request_id / workflow_version — 0081) instead of four nonexistent
//     ones;
//   - dispatches nodes by type+subtype through the 29-subtype registry
//     (engine.ts) — the old flat-type sets made every action node throw
//     "Unknown node type";
//   - branch semantics == the desktop dry-run (single source of truth):
//     failing gates close their branch, route_switch opens only the first
//     passing route, convergence runs once, a failed action closes only
//     its downstream (parallel branches continue — the old build skipped
//     EVERYTHING after any failure);
//   - per-branch skip reasons recorded per node; §10.05 warnings surfaced;
//   - execution deadline → run status 'timeout'; unknown subtypes → failed
//     nodes with diagnosable errors (never silent);
//   - wait_duration > 10s PARKS the run (workflow_pending_resumes row +
//     serialized engine state — survives process death; the
//     workflow-resume-scheduler EF (T-228) claims due rows);
//   - run finalization updates workflows.last_executed_at and
//     total_executions (the EF owns both — 0012 contract, never done
//     before);
//   - dry_run mode (T-229): simulated actions, no workflow_runs row, one
//     audit entry, does NOT consume the daily cap.
//
// FLOW:
//   1. Auth (JWT + execute_workflow permission — unchanged)
//   2. Fetch the workflow (status='published', tenant-scoped)
//   3. Daily execution limit (429 when reached)
//   4. Parse + validate the definition (TS engine validation == the 0081
//      SQL publish gate; a cyclic/invalid DAG never reaches a run row)
//   5. Insert workflow_runs (status='running')
//   6. Execute through the engine with the real action executors
//      (actions.ts); node_results persist progressively
//   7. Park on long delays OR finalize: status/duration/error/node_results
//   8. Update last_executed_at/total_executions (completed runs only)
//   9. Audit log entry (workflow.run) + structured response
//
// SECURITY:
//   - Requires JWT; caller needs execute_workflow (super_admin per 0023)
//   - service_role performs DB writes (bypasses RLS)
//   - The client-provided definition is NEVER trusted raw: validated by
//     the 0081 SQL gate at publish + by the TS engine here at execution
// ============================================================================

import { corsHeaders, handleOptions, jsonError, jsonOk } from "../_shared/cors.ts";
import {
  createServiceRoleClient,
  extractAuthContext,
  requirePermission,
  withAuditSurfacing,
  writeAuditLog,
} from "../_shared/supabase.ts";
import {
  executeWorkflowDefinition,
  parseDefinition,
  validateWorkflowDefinition,
  type EngineContext,
} from "./engine.ts";
import { executeNodeAction } from "./actions.ts";

// ---------------------------------------------------------------------------
// Request contract
// ---------------------------------------------------------------------------

interface ExecuteWorkflowBody {
  workflow_id: string;
  trigger_type?: string;
  actor_note?: string;
  /** T-227: entity ids for the real execution context. */
  parent_id?: string;
  student_id?: string;
  installment_id?: string;
  /** Test payloads for manual/dry runs — merged UNDER the real context. */
  context?: Record<string, unknown>;
  /** T-229: simulate the whole DAG without side effects (no run row). */
  dry_run?: boolean;
}

/** DB trigger_type enum (0012 + 0081) — desktop spellings map onto it. */
const RUN_TRIGGERS: readonly string[] = [
  "payment_overdue", "student_enrolled", "payment_recorded", "schedule",
  "absence_limit", "manual_run", "debt_over_threshold",
  "grade_below_threshold", "payment_cleared_or_bounced",
  "document_expiration", "calendar_cron_event", "stock_level_critical",
];

/** Desktop subtype → DB spelling (the one legacy mismatch). */
function mapTriggerType(raw: string | undefined): string | null {
  const t = (raw ?? "manual_run").trim();
  const mapped = t === "absence_limit_exceeded" ? "absence_limit" : t;
  return RUN_TRIGGERS.includes(mapped) ? mapped : null;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(withAuditSurfacing(async (req: Request) => {
  if (req.method === "OPTIONS") return handleOptions(req);
  if (req.method !== "POST") {
    return jsonError(req, 405, "method_not_allowed", "Use POST");
  }

  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();

  // 1. Auth context
  const ctx = await extractAuthContext(req);
  if (!ctx) {
    return jsonError(req, 401, "unauthorized", "Authentication required");
  }
  if (!requirePermission(ctx, "execute_workflow")) {
    return jsonError(req, 403, "forbidden", "execute_workflow permission required");
  }

  // 2. Body
  let body: ExecuteWorkflowBody;
  try {
    body = await req.json();
  } catch {
    return jsonError(req, 400, "invalid_body", "Request body must be valid JSON");
  }
  if (!body.workflow_id) {
    return jsonError(req, 400, "missing_fields", "workflow_id is required");
  }

  const triggerType = mapTriggerType(body.trigger_type);
  if (triggerType === null) {
    return jsonError(req, 400, "invalid_trigger_type", `trigger_type '${body.trigger_type}' is not a registered run trigger`);
  }
  const actorNote = body.actor_note?.trim() || null;
  const dryRun = body.dry_run === true;

  const supabase = createServiceRoleClient();

  // 3. Fetch the workflow — the REAL columns (DAG-101 fix).
  const { data: workflow, error: wfError } = await supabase
    .from("workflows")
    .select("id, tenant_id, name, code, status, dag_definition, max_daily_executions, version, last_executed_at, total_executions")
    .eq("id", body.workflow_id)
    .eq("tenant_id", ctx.tenantId)
    .single();

  if (wfError || !workflow) {
    return jsonError(req, 404, "workflow_not_found", "Workflow not found in this tenant");
  }
  if (workflow.status !== "published") {
    return jsonError(req, 409, "workflow_not_published", `Workflow status is '${workflow.status}', must be 'published'`);
  }

  // 4. Parse + validate the definition (execution-time gate — the 0081 SQL
  //    gate already protected publishing; this protects direct DB edits).
  const definition = parseDefinition(workflow.dag_definition);
  const validation = validateWorkflowDefinition(definition, { strict: false });
  if (!definition || !validation.valid) {
    return jsonError(
      req,
      400,
      "invalid_dag",
      "Workflow definition is invalid",
      validation.errors.join(" | "),
    );
  }
  if (definition.nodes.length === 0) {
    return jsonError(req, 400, "empty_workflow", "Workflow has no nodes");
  }

  // 5. Daily execution limit (dry runs do NOT consume the cap).
  const maxDaily = Number(workflow.max_daily_executions ?? 0);
  if (!dryRun && maxDaily > 0) {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const { count, error: countError } = await supabase
      .from("workflow_runs")
      .select("id", { count: "exact", head: true })
      .eq("workflow_id", workflow.id)
      .eq("tenant_id", ctx.tenantId)
      .gte("started_at", todayStart.toISOString());
    if (countError) {
      return jsonError(req, 500, "limit_check_failed", "Failed to verify daily execution limit");
    }
    if ((count ?? 0) >= maxDaily) {
      return jsonError(
        req,
        429,
        "daily_limit_reached",
        `Workflow has reached its daily execution limit (${maxDaily}). Try again tomorrow.`,
      );
    }
  }

  // 6. Build the execution context (T-227 real loaders; test payload merged
  //    UNDER the real values — the client cannot fake entity data).
  const entityContext = await buildExecutionContext(supabase, ctx.tenantId, {
    parentId: body.parent_id ?? null,
    studentId: body.student_id ?? null,
    installmentId: body.installment_id ?? null,
  });
  const context: EngineContext = {
    ...(body.context ?? {}),
    ...entityContext,
    workflow: {
      ...((body.context?.workflow as Record<string, unknown>) ?? {}),
      id: workflow.id,
      code: workflow.code,
      name: workflow.name,
      version: workflow.version ?? 1,
    },
  };

  const runCtx = {
    tenantId: ctx.tenantId,
    actorProfileId: ctx.userProfileId,
    actorEmail: ctx.email,
    requestId,
    parentId: body.parent_id ?? (entityContext.parent as { id?: string } | undefined)?.id ?? null,
    studentId: body.student_id ?? null,
    installmentId: body.installment_id ?? null,
    dryRun,
    callerJwt: req.headers.get("authorization")?.slice(7) ?? "",
  };

  const actionHandler = (node, engineContext) =>
    executeNodeAction(node, engineContext, runCtx);

  // -------------------------------------------------------------------------
  // DRY RUN (T-229): full simulation, no run row, one audit entry.
  // -------------------------------------------------------------------------
  if (dryRun) {
    const dry = await executeWorkflowDefinition(definition, {
      context,
      actions: actionHandler,
      deadlineMs: 25_000,
    });
    await writeAuditLog(
      ctx.tenantId,
      "workflow.dry_run",
      "workflow",
      workflow.id,
      ctx.userProfileId,
      ctx.email,
      null,
      {
        workflow_id: workflow.id, workflow_code: workflow.code,
        status: dry.status, node_count: definition.nodes.length,
        succeeded: dry.node_results.filter((r) => r.status === "succeeded").length,
        skipped: dry.node_results.filter((r) => r.status === "skipped").length,
        failed: dry.node_results.filter((r) => r.status === "failed").length,
        warnings: dry.warnings,
        entity: { parent_id: runCtx.parentId, student_id: runCtx.studentId },
      },
      `Dry-run of workflow '${workflow.name}' (${dry.status}).`,
      requestId,
    );
    return jsonOk(req, {
      dry_run: true,
      workflow_id: workflow.id,
      workflow_code: workflow.code,
      workflow_version: workflow.version ?? 1,
      status: dry.status,
      error: dry.error_message,
      node_count: definition.nodes.length,
      succeeded_nodes: dry.node_results.filter((r) => r.status === "succeeded").length,
      failed_nodes: dry.node_results.filter((r) => r.status === "failed").length,
      skipped_nodes: dry.node_results.filter((r) => r.status === "skipped").length,
      taken_edge_keys: dry.taken_edge_keys,
      warnings: dry.warnings,
      node_results: dry.node_results,
    });
  }

  // -------------------------------------------------------------------------
  // REAL RUN: insert the run row (the 0081 contract columns).
  // -------------------------------------------------------------------------
  const runStartedAt = new Date().toISOString();
  const runStartPerf = performance.now();

  const { data: runRow, error: insertError } = await supabase
    .from("workflow_runs")
    .insert({
      tenant_id: ctx.tenantId,
      workflow_id: workflow.id,
      workflow_version: workflow.version ?? 1,
      trigger_type: triggerType,
      actor_id: ctx.userProfileId,
      status: "running",
      started_at: runStartedAt,
      node_results: [],
      actor_note: actorNote,
      request_id: requestId,
    })
    .select("id")
    .single();

  if (insertError || !runRow) {
    console.error("[workflow-execute] Failed to insert workflow_runs row:", insertError);
    return jsonError(req, 500, "run_insert_failed", "Failed to start workflow run", insertError?.message);
  }
  const runId = runRow.id;

  // Progressive persistence: every node result lands on the run row as it
  // is produced (a worker death mid-run leaves the partial trail visible).
  const persistProgress = (nodeResult): Promise<void> => {
    return supabase
      .from("workflow_runs")
      .update({ node_results: accumulated })
      .eq("id", runId)
      .then(({ error }) => {
        if (error) {
          console.error(`[workflow-execute] progressive node_results persist failed for run ${runId}:`, error);
        }
      });
  };

  // The engine pushes results through onNodeResult; accumulate + persist.
  const accumulated: unknown[] = [];
  const onNodeResult = (result): void => {
    accumulated.push(result);
    void persistProgress(result);
  };

  const outcome = await executeWorkflowDefinition(definition, {
    context,
    actions: actionHandler,
    deadlineMs: 25_000,
    onNodeResult,
  });

  // -------------------------------------------------------------------------
  // Park (T-228 scheduler will resume) or finalize.
  // -------------------------------------------------------------------------
  if (outcome.status === "paused" && outcome.resume_state) {
    const { error: parkError } = await supabase
      .from("workflow_pending_resumes")
      .insert({
        tenant_id: ctx.tenantId,
        run_id: runId,
        workflow_id: workflow.id,
        node_id: outcome.resume_state.parked_node_id,
        state: outcome.resume_state as unknown as Record<string, unknown>,
        resume_after: outcome.pause?.resume_after ?? new Date().toISOString(),
        status: "pending",
      });
    if (parkError) {
      // The pause row is the run's only lifeline — its failure is fatal
      // (honestly): the run is marked failed so an operator sees it.
      console.error(`[workflow-execute] park insert failed for run ${runId}:`, parkError);
      await finalizeRun(supabase, runId, {
        status: "failed",
        completedAt: new Date().toISOString(),
        durationMs: Math.round(performance.now() - runStartPerf),
        nodeResults: outcome.node_results,
        errorMessage: `park failed: ${parkError.message}`,
      });
      return jsonError(req, 500, "park_failed", "Workflow parked but the resume row could not be written", parkError.message);
    }
    // Run stays 'running' (the DB enum has no paused state; node_results
    // carries the park note; the scheduler finalizes after resuming).
    return jsonOk(req, {
      run_id: runId,
      workflow_id: workflow.id,
      workflow_code: workflow.code,
      status: "paused",
      paused_at: new Date().toISOString(),
      resume_after: outcome.pause?.resume_after,
      parked_node_id: outcome.resume_state.parked_node_id,
      duration_ms: Math.round(performance.now() - runStartPerf),
      node_count: definition.nodes.length,
      node_results: outcome.node_results,
    });
  }

  // Finalize: the run row + the workflow counters.
  const runCompletedAt = new Date().toISOString();
  const durationMs = Math.round(performance.now() - runStartPerf);
  await finalizeRun(supabase, runId, {
    status: outcome.status,
    completedAt: runCompletedAt,
    durationMs,
    nodeResults: outcome.node_results,
    errorMessage: outcome.error_message,
  });

  // The EF owns last_executed_at / total_executions (0012) — on COMPLETED
  // runs only (parked runs update when the scheduler finishes them).
  const { error: counterError } = await supabase
    .from("workflows")
    .update({
      last_executed_at: runCompletedAt,
      total_executions: (workflow.total_executions ?? 0) + 1,
    })
    .eq("id", workflow.id);
  if (counterError) {
    console.error(`[workflow-execute] counter update failed for workflow ${workflow.id}:`, counterError);
    // Not fatal: the run is complete + audited; the counters are
    // best-effort by contract (0012 comment) — logged, surfaced in logs.
  }

  // Audit entry (canonical).
  await writeAuditLog(
    ctx.tenantId,
    "workflow.run",
    "workflow_run",
    runId,
    ctx.userProfileId,
    ctx.email,
    { workflow_id: workflow.id, workflow_code: workflow.code, status: "running" },
    {
      workflow_id: workflow.id,
      workflow_code: workflow.code,
      workflow_version: workflow.version ?? 1,
      run_id: runId,
      status: outcome.status,
      trigger_type: triggerType,
      duration_ms: durationMs,
      node_count: definition.nodes.length,
      succeeded_nodes: outcome.node_results.filter((r) => r.status === "succeeded").length,
      failed_nodes: outcome.node_results.filter((r) => r.status === "failed").length,
      skipped_nodes: outcome.node_results.filter((r) => r.status === "skipped").length,
      warnings: outcome.warnings,
      error: outcome.error_message,
      entity: { parent_id: runCtx.parentId, student_id: runCtx.studentId },
    },
    actorNote
      ? `Workflow '${workflow.name}' executed (${outcome.status}). Note: ${actorNote}`
      : `Workflow '${workflow.name}' executed (${outcome.status}).`,
    requestId,
  );

  return jsonOk(req, {
    run_id: runId,
    workflow_id: workflow.id,
    workflow_code: workflow.code,
    workflow_version: workflow.version ?? 1,
    status: outcome.status,
    duration_ms: durationMs,
    node_count: definition.nodes.length,
    succeeded_nodes: outcome.node_results.filter((r) => r.status === "succeeded").length,
    failed_nodes: outcome.node_results.filter((r) => r.status === "failed").length,
    skipped_nodes: outcome.node_results.filter((r) => r.status === "skipped").length,
    taken_edge_keys: outcome.taken_edge_keys,
    warnings: outcome.warnings,
    error: outcome.error_message,
    node_results: outcome.node_results,
  });
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function finalizeRun(
  supabase: ReturnType<typeof createServiceRoleClient>,
  runId: string,
  final: {
    status: string;
    completedAt: string;
    durationMs: number;
    nodeResults: unknown[];
    errorMessage: string | null;
  },
): Promise<void> {
  const { error } = await supabase
    .from("workflow_runs")
    .update({
      status: final.status,
      completed_at: final.completedAt,
      duration_ms: final.durationMs,
      node_results: final.nodeResults,
      error_message: final.errorMessage,
    })
    .eq("id", runId);
  if (error) {
    console.error(`[workflow-execute] final update failed for run ${runId}:`, error);
  }
}

// ---------------------------------------------------------------------------
// Execution context builder — T-227's real loaders land in the next commits;
// this slice seeds the workflow metadata + entity ids (ids the actions use).
// The client-provided test payload is merged UNDER the server-built values.
// ---------------------------------------------------------------------------

/**
 * T-227: the REAL execution context — conditions evaluate against live
 * business data, never client-supplied numbers (the body's test payload
 * merges UNDER these values: index.ts spreads entityContext AFTER
 * body.context).
 *
 * Field names mirror the desktop dry-run's defaultConditionContext
 * (domain/calc/workflow/condition-evaluator.ts) so conditions authored
 * in the builder resolve identically in simulation and execution:
 *   parent.outstanding_balance / days_overdue / is_financially_restricted
 *   student.absence_count / status
 *   payment.method / status / category / amount
 *   debt.amount (= total_outstanding)
 * Sources: the CANONICAL compute_parent_summary RPC (0034 — the single
 * source of truth for parent totals), attendance_records (0004),
 * payments (0007), installments (0007).
 */
async function buildExecutionContext(
  supabase: ReturnType<typeof createServiceRoleClient>,
  tenantId: string,
  entity: { parentId: string | null; studentId: string | null; installmentId: string | null },
): Promise<EngineContext> {
  const context: Record<string, unknown> = {};
  const now = new Date();
  const nowIso = now.toISOString();

  if (entity.parentId) {
    const { data: parent } = await supabase
      .from("parents")
      .select("id, display_name, first_name, last_name, primary_phone, secondary_phone, email, is_financially_restricted")
      .eq("id", entity.parentId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (parent) {
      // Canonical financial totals — the compute_parent_summary RPC (the
      // same single source of truth the desktop/Android engines mirror;
      // ADR-002). Returns TABLE: one row.
      const { data: summaryRows, error: summaryError } = await supabase
        .rpc("compute_parent_summary", { p_parent_id: entity.parentId });
      const summary = Array.isArray(summaryRows) ? summaryRows[0] : null;
      if (summaryError) {
        console.error("[workflow-execute] compute_parent_summary failed:", summaryError);
      }

      // Oldest unpaid installment → parent.days_overdue.
      const { data: oldest } = await supabase
        .from("installments")
        .select("due_date")
        .eq("parent_id", entity.parentId)
        .eq("tenant_id", tenantId)
        .neq("status", "paid")
        .neq("status", "cancelled")
        .order("due_date", { ascending: true })
        .limit(1);
      let daysOverdue = 0;
      if (oldest && oldest.length > 0 && oldest[0].due_date) {
        const due = new Date(oldest[0].due_date).getTime();
        daysOverdue = Math.max(0, Math.floor((now.getTime() - due) / 86_400_000));
      }

      const outstanding = Number(summary?.total_outstanding ?? 0);
      context.parent = {
        id: parent.id,
        display_name: parent.display_name ?? parent.last_name ?? parent.id,
        // Normalized alias: the parents table column is primary_phone; the
        // condition/action layer (send_whatsapp, template payloads) reads
        // parent.phone.
        phone: parent.primary_phone ?? parent.secondary_phone ?? null,
        email: parent.email,
        is_financially_restricted: parent.is_financially_restricted,
        outstanding_balance: outstanding,
        total_overdue: Number(summary?.total_overdue ?? 0),
        days_overdue: daysOverdue,
      };
      context.debt = {
        amount: outstanding,
        days_overdue: daysOverdue,
      };
    }

    // Latest payment for the parent (payment.method/status/category…).
    const { data: payment } = await supabase
      .from("payments")
      .select("amount, method, status, collected_at, category, installment_id, student_id")
      .eq("parent_id", entity.parentId)
      .eq("tenant_id", tenantId)
      .order("collected_at", { ascending: false })
      .limit(1);
    if (payment && payment.length > 0) {
      const p = payment[0];
      context.payment = {
        amount: Number(p.amount ?? 0),
        method: p.method,
        status: p.status,
        category: p.category ?? null,
        collected_at: p.collected_at,
        days_overdue: 0,
      };
    }
  }

  if (entity.studentId) {
    const { data: student } = await supabase
      .from("students")
      .select("id, first_name, last_name, enrollment_status, parent_id")
      .eq("id", entity.studentId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (student) {
      // Unexcused absence count (the absence-escalation condition input).
      const { count: absences, error: absErr } = await supabase
        .from("attendance_records")
        .select("id", { count: "exact", head: true })
        .eq("student_id", entity.studentId)
        .eq("tenant_id", tenantId)
        .eq("status", "absent_unexcused");
      if (absErr) {
        console.error("[workflow-execute] absence count failed:", absErr);
      }
      context.student = {
        id: student.id,
        status: student.enrollment_status,
        parent_id: student.parent_id,
        absence_count: absences ?? 0,
      };
    }
  }

  if (entity.installmentId) {
    const { data: installment } = await supabase
      .from("installments")
      .select("id, parent_id, student_id, category, label, tranche_number, amount_due, amount_paid, due_date, status")
      .eq("id", entity.installmentId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (installment) {
      const due = new Date(installment.due_date).getTime();
      context.installment = {
        id: installment.id,
        parent_id: installment.parent_id,
        student_id: installment.student_id,
        category: installment.category,
        label: installment.label,
        amount_due: Number(installment.amount_due ?? 0),
        amount_paid: Number(installment.amount_paid ?? 0),
        remaining: Number(installment.amount_due ?? 0) - Number(installment.amount_paid ?? 0),
        due_date: installment.due_date,
        days_overdue: Math.max(0, Math.floor((now.getTime() - due) / 86_400_000)),
        status: installment.status,
      };
    }
  }

  context.workflow = { now: nowIso, nowMs: now.getTime() };
  return context;
}

// Exported for the scheduler EF's reuse (T-228) via the module system.
export { buildExecutionContext };
