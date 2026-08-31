// ============================================================================
// workflow-execute/index.ts
// ============================================================================
// Edge Function: Execute a published workflow DAG
// ----------------------------------------------------------------------------
// USE CASE:
//   The Desktop app's "Workflow Builder" lets admins define automation DAGs
//   (e.g. "When an installment is >30 days overdue, send email + apply 5%
//   discount + log audit"). This function executes one such DAG on demand.
//
// FLOW:
//   1. Caller POSTs { workflow_id, trigger_type?, actor_note? }
//   2. Auth: requires JWT + `execute_workflow` permission
//   3. Fetch the workflow definition (must be status='published')
//   4. Check the daily execution limit (max_daily_executions)
//   5. Insert a `workflow_runs` row with status='running'
//   6. Parse the DAG definition (JSON: { nodes: [...], edges: [...] })
//   7. Topologically sort nodes; detect cycles
//   8. Walk nodes in topo order:
//      - Trigger nodes    → mark as 'succeeded' (no work; entry points)
//      - Condition nodes  → evaluate condition; activate 'true' or 'false'
//                           downstream branch; prune the other
//      - Action nodes     → execute via stub; TODO: wire real integrations
//                           (Resend, FCM, Postgres, etc.)
//      - Unreachable nodes (pruned by condition branches) → mark 'skipped'
//   9. If any executed node fails → mark the run 'failed'; capture the error
//      in node_results. Other nodes downstream of the failure are 'skipped'.
//  10. Update `workflow_runs` with final status, duration_ms, node_results
//  11. Write audit log entry with action='workflow.run'
//  12. Return { run_id, status, duration_ms, node_count }
//
// SECURITY:
//   - Requires JWT (caller must be authenticated)
//   - Caller must have `execute_workflow` permission
//   - service_role key performs DB writes (bypasses RLS)
//   - Workflow must be in 'published' status and belong to caller's tenant
//
// NODE TYPES SUPPORTED:
//   - Trigger:  payment_overdue, schedule, manual_run, invoice_created,
//               student_enrolled, grade_published
//   - Condition: debt_over_threshold, payment_method_match, student_status_match
//   - Action:   send_email, apply_discount, create_invoice, push_notification,
//               log_audit, wait_duration, database_query, extract_field
//
// NOTE: Action node implementations here are STUBS. Each one logs the intent
// and writes to the audit log. Real integrations are marked as TODO comments
// and should be implemented incrementally per Plan §14.
// ============================================================================

import { corsHeaders, handleOptions, jsonError, jsonOk } from "../_shared/cors.ts";
import { createServiceRoleClient, extractAuthContext, requirePermission, withAuditSurfacing, writeAuditLog } from "../_shared/supabase.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ExecuteWorkflowBody {
  workflow_id: string;
  trigger_type?: string;
  actor_note?: string;
}

interface WorkflowNode {
  id: string;
  type: string;
  label?: string;
  config?: Record<string, unknown>;
}

interface WorkflowEdge {
  id?: string;
  source: string;
  target: string;
  branch?: "true" | "false" | null;
  label?: string;
}

interface WorkflowDefinition {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

interface NodeResult {
  node_id: string;
  node_type: string;
  node_label?: string;
  status: "succeeded" | "failed" | "skipped";
  started_at: string;
  completed_at: string;
  duration_ms: number;
  output?: Record<string, unknown>;
  error?: string;
}

const TRIGGER_TYPES = new Set([
  "payment_overdue",
  "schedule",
  "manual_run",
  "invoice_created",
  "student_enrolled",
  "grade_published",
  "trigger", // generic fallback
]);

const CONDITION_TYPES = new Set([
  "debt_over_threshold",
  "payment_method_match",
  "student_status_match",
  "condition", // generic
]);

const ACTION_TYPES = new Set([
  "send_email",
  "apply_discount",
  "create_invoice",
  "push_notification",
  "log_audit",
  "wait_duration",
  "database_query",
  "extract_field",
]);

// ---------------------------------------------------------------------------
// DAG helpers
// ---------------------------------------------------------------------------

/**
 * Topological sort using Kahn's algorithm. Returns nodes in execution order.
 * Throws if a cycle is detected.
 */
function topologicalSort(nodes: WorkflowNode[], edges: WorkflowEdge[]): WorkflowNode[] {
  const nodeIds = new Set(nodes.map((n) => n.id));
  const adj = new Map<string, string[]>(); // source → [targets]
  const inDegree = new Map<string, number>();

  for (const n of nodes) {
    adj.set(n.id, []);
    inDegree.set(n.id, 0);
  }

  for (const e of edges) {
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) {
      throw new Error(`Edge references unknown node: ${e.source} → ${e.target}`);
    }
    adj.get(e.source)!.push(e.target);
    inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree.entries()) {
    if (deg === 0) queue.push(id);
  }

  const orderedIds: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    orderedIds.push(id);
    for (const next of adj.get(id) ?? []) {
      inDegree.set(next, (inDegree.get(next) ?? 0) - 1);
      if (inDegree.get(next) === 0) queue.push(next);
    }
  }

  if (orderedIds.length !== nodes.length) {
    const remaining = [...inDegree.entries()].filter(([, d]) => d > 0).map(([id]) => id);
    throw new Error(`Cycle detected in workflow DAG (nodes involved: ${remaining.join(", ")})`);
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  return orderedIds.map((id) => byId.get(id)!);
}

/**
 * Returns true if nodeType is a trigger entry point.
 */
function isTrigger(type: string): boolean {
  return TRIGGER_TYPES.has(type);
}

function isCondition(type: string): boolean {
  return CONDITION_TYPES.has(type);
}

function isAction(type: string): boolean {
  return ACTION_TYPES.has(type);
}

// ---------------------------------------------------------------------------
// Condition evaluation (STUB — TODO: real DB lookups per Plan §14)
// ---------------------------------------------------------------------------

interface ConditionEvaluation {
  result: boolean;
  reason: string;
  output?: Record<string, unknown>;
}

async function evaluateCondition(
  _supabase: SupabaseClient,
  _tenantId: string,
  node: WorkflowNode,
  _context: { runId: string; triggerType: string }
): Promise<ConditionEvaluation> {
  // TODO: For each condition type, perform a real DB query to evaluate
  // the predicate against the trigger payload. The trigger payload (e.g.
  // overdue installment id, student id) should be passed in via node.config
  // or a runtime context. For now we evaluate using static config defaults.
  const config = node.config ?? {};
  switch (node.type) {
    case "debt_over_threshold": {
      // TODO: SELECT outstanding_debt FROM mv_debt_aging WHERE parent_id = $1
      const threshold = Number(config.threshold ?? 0);
      const currentDebt = Number(config._stub_current_debt ?? 0);
      const result = currentDebt >= threshold;
      return {
        result,
        reason: `debt ${currentDebt} ${result ? ">=" : "<"} threshold ${threshold}`,
        output: { current_debt: currentDebt, threshold, evaluated: result },
      };
    }
    case "payment_method_match": {
      // TODO: lookup payment.method from payments table
      const expected = String(config.method ?? "cash");
      const actual = String(config._stub_actual_method ?? "cash");
      const result = expected === actual;
      return {
        result,
        reason: `actual '${actual}' ${result ? "==" : "!="} expected '${expected}'`,
        output: { expected, actual, evaluated: result },
      };
    }
    case "student_status_match": {
      // TODO: lookup student.status from students table
      const expected = String(config.status ?? "active");
      const actual = String(config._stub_actual_status ?? "active");
      const result = expected === actual;
      return {
        result,
        reason: `actual '${actual}' ${result ? "==" : "!="} expected '${expected}'`,
        output: { expected, actual, evaluated: result },
      };
    }
    case "condition":
    default: {
      // Generic condition: use config.default_result if provided, else true.
      const result = config.default_result !== false;
      return {
        result,
        reason: `generic condition evaluated to ${result} (stub)`,
        output: { evaluated: result },
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Action execution (STUBS — TODO: wire real integrations per Plan §14)
// ---------------------------------------------------------------------------

async function executeActionNode(
  supabase: SupabaseClient,
  tenantId: string,
  node: WorkflowNode,
  context: { runId: string; triggerType: string; actorProfileId: string; actorEmail: string; requestId: string }
): Promise<{ output: Record<string, unknown>; auditNote: string }> {
  const config = node.config ?? {};

  switch (node.type) {
    case "send_email": {
      // TODO: Integrate Resend API.
      // const resendKey = Deno.env.get("RESEND_API_KEY");
      // await fetch("https://api.resend.com/emails", { ... })
      const to = String(config.to ?? "(unspecified)");
      const subject = String(config.subject ?? "(no subject)");
      return {
        output: { stub: true, to, subject, provider: "resend" },
        auditNote: `STUB send_email to=${to} subject="${subject}"`,
      };
    }

    case "apply_discount": {
      // TODO: call public.apply_discount RPC (creates a discount row + ledger entry)
      const percent = Number(config.percent ?? 0);
      const targetType = String(config.target_type ?? "installment");
      return {
        output: { stub: true, percent, target_type: targetType },
        auditNote: `STUB apply_discount percent=${percent}% target=${targetType}`,
      };
    }

    case "create_invoice": {
      // TODO: call public.create_invoice RPC
      const parentId = String(config.parent_id ?? "(unspecified)");
      const amount = Number(config.amount ?? 0);
      return {
        output: { stub: true, parent_id: parentId, amount },
        auditNote: `STUB create_invoice parent=${parentId} amount=${amount}`,
      };
    }

    case "push_notification": {
      // TODO: Integrate FCM (Firebase Cloud Messaging) via service account.
      // const fcmToken = ...; await fetch("https://fcm.googleapis.com/fcm/send", { ... })
      const targetRole = String(config.target_role ?? "financial_officer");
      const title = String(config.title ?? "Notification");
      return {
        output: { stub: true, target_role: targetRole, title, provider: "fcm" },
        auditNote: `STUB push_notification role=${targetRole} title="${title}"`,
      };
    }

    case "log_audit": {
      // This one is NOT a stub — we write an audit log entry directly.
      const action = String(config.action ?? "workflow.audit_log");
      const note = String(config.note ?? "");
      await writeAuditLog(
        tenantId,
        action,
        String(config.entity_type ?? "workflow"),
        (config.entity_id as string) ?? null,
        context.actorProfileId,
        context.actorEmail,
        null,
        config.payload ?? null,
        note,
        context.requestId
      );
      return {
        output: { action, note },
        auditNote: `log_audit action=${action}`,
      };
    }

    case "wait_duration": {
      // TODO: For real async waiting, enqueue a delayed job. For now we
      // optionally sleep if duration_ms <= 5000 (5s safety cap) — longer
      // waits must be implemented as a scheduler callback.
      const waitMs = Math.min(Number(config.duration_ms ?? 0), 5000);
      if (waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
      return {
        output: { waited_ms: waitMs, capped: Number(config.duration_ms ?? 0) > 5000 },
        auditNote: `wait_duration ${waitMs}ms`,
      };
    }

    case "database_query": {
      // TODO: Execute a tenant-scoped SELECT against a whitelist of views.
      // SECURITY: must NEVER run arbitrary user-supplied SQL. Use a stored
      // function or parameterized query against a pre-approved view list.
      const viewName = String(config.view ?? "(unspecified)");
      return {
        output: { stub: true, view: viewName },
        auditNote: `STUB database_query view=${viewName}`,
      };
    }

    case "extract_field": {
      // TODO: extract a field from the trigger payload or upstream node output.
      const source = String(config.source ?? "trigger");
      const field = String(config.field ?? "");
      return {
        output: { stub: true, source, field, extracted_value: null },
        auditNote: `STUB extract_field source=${source} field=${field}`,
      };
    }

    default: {
      throw new Error(`Unknown action node type: ${node.type}`);
    }
  }
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

  // 2. Permission check
  if (!requirePermission(ctx, "execute_workflow")) {
    return jsonError(req, 403, "forbidden", "execute_workflow permission required");
  }

  // 3. Parse body
  let body: ExecuteWorkflowBody;
  try {
    body = await req.json();
  } catch {
    return jsonError(req, 400, "invalid_body", "Request body must be valid JSON");
  }

  if (!body.workflow_id) {
    return jsonError(req, 400, "missing_fields", "workflow_id is required");
  }

  const triggerType = body.trigger_type ?? "manual_run";
  const actorNote = body.actor_note?.trim() || null;

  const supabase = createServiceRoleClient();

  // 4. Fetch the workflow definition
  const { data: workflow, error: wfError } = await supabase
    .from("workflows")
    .select("id, tenant_id, name, code, status, definition, max_daily_executions, version")
    .eq("id", body.workflow_id)
    .eq("tenant_id", ctx.tenantId)
    .single();

  if (wfError || !workflow) {
    return jsonError(req, 404, "workflow_not_found", "Workflow not found in this tenant");
  }

  if (workflow.status !== "published") {
    return jsonError(req, 409, "workflow_not_published", `Workflow status is '${workflow.status}', must be 'published'`);
  }

  // 5. Daily execution limit check
  const maxDaily = Number(workflow.max_daily_executions ?? 0);
  if (maxDaily > 0) {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const { count, error: countError } = await supabase
      .from("workflow_runs")
      .select("id", { count: "exact", head: true })
      .eq("workflow_id", workflow.id)
      .eq("tenant_id", ctx.tenantId)
      .gte("started_at", todayStart.toISOString());

    if (countError) {
      console.error("[workflow-execute] Failed to count today's runs:", countError);
      return jsonError(req, 500, "limit_check_failed", "Failed to verify daily execution limit");
    }

    if ((count ?? 0) >= maxDaily) {
      return jsonError(
        req,
        429,
        "daily_limit_reached",
        `Workflow has reached its daily execution limit (${maxDaily}). Try again tomorrow.`
      );
    }
  }

  // 6. Parse the DAG definition
  let definition: WorkflowDefinition;
  try {
    const raw = typeof workflow.definition === "string"
      ? JSON.parse(workflow.definition)
      : workflow.definition;
    if (!raw || !Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) {
      throw new Error("definition must be an object with nodes[] and edges[]");
    }
    definition = raw as WorkflowDefinition;
  } catch (e) {
    console.error("[workflow-execute] Invalid workflow definition:", e);
    return jsonError(req, 500, "invalid_definition", "Workflow definition is malformed", String(e));
  }

  if (definition.nodes.length === 0) {
    return jsonError(req, 400, "empty_workflow", "Workflow has no nodes");
  }

  // 7. Topological sort (with cycle detection)
  let orderedNodes: WorkflowNode[];
  try {
    orderedNodes = topologicalSort(definition.nodes, definition.edges);
  } catch (e) {
    console.error("[workflow-execute] Topo sort failed:", e);
    return jsonError(req, 400, "invalid_dag", "Workflow DAG is invalid", String(e));
  }

  // 8. Insert workflow_runs row (status='running')
  const runStartedAt = new Date().toISOString();
  const runStartPerf = performance.now();

  const { data: runRow, error: insertError } = await supabase
    .from("workflow_runs")
    .insert({
      tenant_id: ctx.tenantId,
      workflow_id: workflow.id,
      workflow_version: workflow.version ?? 1,
      triggered_by_profile_id: ctx.userProfileId,
      trigger_type: triggerType,
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

  // 9. Execute nodes
  const nodeResults: NodeResult[] = [];
  const activeNodes = new Set<string>();
  const failedNodes = new Set<string>();

  // Seed: trigger nodes are active entry points. If none, activate the first node.
  const triggers = orderedNodes.filter((n) => isTrigger(n.type));
  if (triggers.length > 0) {
    for (const t of triggers) activeNodes.add(t.id);
  } else {
    activeNodes.add(orderedNodes[0].id);
  }

  // Index outgoing edges by source for quick lookup
  const outgoingBySource = new Map<string, WorkflowEdge[]>();
  for (const e of definition.edges) {
    const list = outgoingBySource.get(e.source) ?? [];
    list.push(e);
    outgoingBySource.set(e.source, list);
  }

  let runFailed = false;
  let failureMessage: string | null = null;

  for (const node of orderedNodes) {
    const nodeStart = performance.now();
    const nodeStartedAt = new Date().toISOString();
    const isActive = activeNodes.has(node.id);

    // Node was pruned by a prior condition branch OR by a prior failure
    if (!isActive || failedNodes.size > 0) {
      const skipped: NodeResult = {
        node_id: node.id,
        node_type: node.type,
        node_label: node.label,
        status: "skipped",
        started_at: nodeStartedAt,
        completed_at: nodeStartedAt,
        duration_ms: 0,
        output: failedNodes.size > 0
          ? { reason: "skipped_due_to_upstream_failure", failed_nodes: [...failedNodes] }
          : { reason: "pruned_by_condition_branch" },
      };
      nodeResults.push(skipped);
      continue;
    }

    try {
      if (isTrigger(node.type)) {
        // Trigger nodes are entry points — no execution work, just mark succeeded
        nodeResults.push({
          node_id: node.id,
          node_type: node.type,
          node_label: node.label,
          status: "succeeded",
          started_at: nodeStartedAt,
          completed_at: new Date().toISOString(),
          duration_ms: Math.round(performance.now() - nodeStart),
          output: { trigger_type: node.type, note: "trigger entry point — no execution" },
        });
        // Activate all downstream nodes (triggers have unconditional edges)
        for (const e of outgoingBySource.get(node.id) ?? []) {
          activeNodes.add(e.target);
        }
        continue;
      }

      if (isCondition(node.type)) {
        const evalResult = await evaluateCondition(supabase, ctx.tenantId, node, {
          runId,
          triggerType,
        });

        nodeResults.push({
          node_id: node.id,
          node_type: node.type,
          node_label: node.label,
          status: "succeeded",
          started_at: nodeStartedAt,
          completed_at: new Date().toISOString(),
          duration_ms: Math.round(performance.now() - nodeStart),
          output: { condition_result: evalResult.result, reason: evalResult.reason, ...evalResult.output },
        });

        // Activate only the matching branch
        for (const e of outgoingBySource.get(node.id) ?? []) {
          // An edge with branch==='true' is taken when result is true;
          // branch==='false' when false; null/undefined = always taken
          if (e.branch == null) {
            activeNodes.add(e.target);
          } else if (e.branch === "true" && evalResult.result) {
            activeNodes.add(e.target);
          } else if (e.branch === "false" && !evalResult.result) {
            activeNodes.add(e.target);
          }
        }
        continue;
      }

      if (isAction(node.type)) {
        try {
          const exec = await executeActionNode(supabase, ctx.tenantId, node, {
            runId,
            triggerType,
            actorProfileId: ctx.userProfileId,
            actorEmail: ctx.email,
            requestId,
          });

          nodeResults.push({
            node_id: node.id,
            node_type: node.type,
            node_label: node.label,
            status: "succeeded",
            started_at: nodeStartedAt,
            completed_at: new Date().toISOString(),
            duration_ms: Math.round(performance.now() - nodeStart),
            output: { ...exec.output, audit_note: exec.auditNote },
          });

          // Activate all downstream nodes (actions have unconditional edges)
          for (const e of outgoingBySource.get(node.id) ?? []) {
            activeNodes.add(e.target);
          }
        } catch (actionError) {
          // Action failed — capture the error, mark run as failed
          failedNodes.add(node.id);
          runFailed = true;
          failureMessage = `Node '${node.id}' (${node.type}) failed: ${String(actionError)}`;
          console.error(`[workflow-execute] Node ${node.id} failed:`, actionError);

          nodeResults.push({
            node_id: node.id,
            node_type: node.type,
            node_label: node.label,
            status: "failed",
            started_at: nodeStartedAt,
            completed_at: new Date().toISOString(),
            duration_ms: Math.round(performance.now() - nodeStart),
            error: String(actionError),
          });
          // Don't activate downstream — they'll be skipped via failedNodes check
        }
        continue;
      }

      // Unknown node type — treat as failure so admins notice the misconfiguration
      throw new Error(`Unknown node type '${node.type}' on node '${node.id}'`);
    } catch (nodeError) {
      failedNodes.add(node.id);
      runFailed = true;
      failureMessage = failureMessage ?? `Node '${node.id}' failed: ${String(nodeError)}`;
      console.error(`[workflow-execute] Node ${node.id} failed:`, nodeError);

      nodeResults.push({
        node_id: node.id,
        node_type: node.type,
        node_label: node.label,
        status: "failed",
        started_at: nodeStartedAt,
        completed_at: new Date().toISOString(),
        duration_ms: Math.round(performance.now() - nodeStart),
        error: String(nodeError),
      });
    }
  }

  // 10. Finalize the run
  const runCompletedAt = new Date().toISOString();
  const durationMs = Math.round(performance.now() - runStartPerf);
  const finalStatus = runFailed ? "failed" : "succeeded";

  const { error: updateError } = await supabase
    .from("workflow_runs")
    .update({
      status: finalStatus,
      completed_at: runCompletedAt,
      duration_ms: durationMs,
      node_results: nodeResults,
      error_message: runFailed ? failureMessage : null,
    })
    .eq("id", runId);

  if (updateError) {
    console.error("[workflow-execute] Failed to finalize workflow_runs row:", updateError);
    // Don't return error here — the run executed, just couldn't persist final state.
    // Audit log + response still reflect the actual outcome.
  }

  // 11. Audit log
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
      run_id: runId,
      status: finalStatus,
      trigger_type: triggerType,
      duration_ms: durationMs,
      node_count: definition.nodes.length,
      succeeded_nodes: nodeResults.filter((r) => r.status === "succeeded").length,
      failed_nodes: nodeResults.filter((r) => r.status === "failed").length,
      skipped_nodes: nodeResults.filter((r) => r.status === "skipped").length,
      error: runFailed ? failureMessage : null,
    },
    actorNote
      ? `Workflow '${workflow.name}' executed (${finalStatus}). Note: ${actorNote}`
      : `Workflow '${workflow.name}' executed (${finalStatus}).`,
    requestId
  );

  // 12. Return result
  return jsonOk(req, {
    run_id: runId,
    workflow_id: workflow.id,
    workflow_code: workflow.code,
    status: finalStatus,
    duration_ms: durationMs,
    node_count: definition.nodes.length,
    succeeded_nodes: nodeResults.filter((r) => r.status === "succeeded").length,
    failed_nodes: nodeResults.filter((r) => r.status === "failed").length,
    skipped_nodes: nodeResults.filter((r) => r.status === "skipped").length,
    error: runFailed ? failureMessage : null,
    node_results: nodeResults,
  });
}));
