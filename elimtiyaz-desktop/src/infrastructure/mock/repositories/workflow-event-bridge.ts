/**
 * T-314 — the school-domain → workflow TRIGGER bridge (mock mode).
 *
 * Bridges REAL app actions to deployed workflows (end-to-end execution):
 *
 *   - `recordRollCall`      → when a student hits 3 unexcused absences in
 *                             the current term → fires every DEPLOYED
 *                             workflow whose trigger subtype is
 *                             `absence_limit_exceeded`;
 *   - `collectPayment`      → fires `payment_recorded` workflows;
 *   - `markPaymentCleared`  → fires `payment_cleared_or_bounced` (cleared);
 *   - `markPaymentBounced`  → fires `payment_cleared_or_bounced` (bounced);
 *   - `batchRegister`       → fires `student_enrolled` workflows;
 *   - the overdue scan      → fires `payment_overdue` workflows.
 *
 * Dispatch semantics (single source of truth): the bridge executes the
 * workflow through the SAME dry-run engine the canvas uses (branch-aware,
 * topological, condition trees), then applies the REAL side effects
 * (workflow-side-effects.ts) for succeeded action nodes, then records a
 * WorkflowRun in the shared store. The EF path (Supabase mode) mirrors this
 * exact contract server-side.
 *
 * Every dispatcher is fail-safe: a workflow error NEVER breaks the user
 * action that triggered it (errors are audit-logged, not thrown).
 */
import { store, appendAudit, nowIso } from "./mock-store";
import { dryRunWorkflow } from "../../../domain/calc/workflow/dry-run";
import {
  defaultConditionContext,
  type ConditionContext,
} from "../../../domain/calc/workflow/condition-evaluator";
import { applyActionEffect, type SideEffectsInput } from "./workflow-side-effects";
import type {
  Workflow,
  WorkflowRun,
  WorkflowNodeResult,
  WorkflowTriggerType,
  WorkflowNodeSubtype,
} from "../../../domain/model/workflow";
import type { Student } from "../../../domain/model/student";
import { parentDisplayName } from "../../../domain/model/parent";

/* ------------------------------------------------------------------ */
/*  Entity-context builder (REAL data from the shared store)          */
/* ------------------------------------------------------------------ */

/** Term window label helper — the current term (T1/T2/T3) of the school year. */
function currentTermWindow(now: Date): { label: string; from: string; to: string } {
  const year = now.getFullYear();
  // Algerian school year: T1 Sep–Dec, T2 Jan–Mar, T3 Apr–Jun.
  const m = now.getMonth() + 1;
  if (m >= 9) return { label: "T1", from: new Date(year, 8, 1).toISOString(), to: new Date(year, 11, 31, 23, 59).toISOString() };
  if (m <= 3) return { label: "T2", from: new Date(year, 0, 1).toISOString(), to: new Date(year, 2, 31, 23, 59).toISOString() };
  return { label: "T3", from: new Date(year, 3, 1).toISOString(), to: new Date(year, 5, 30, 23, 59).toISOString() };
}

/** Ledger-replayed outstanding balance for a parent (mirrors debt-ops). */
function outstandingFromLedger(parentId: string): number {
  const entries = store.ledger.filter((e) => e.parentId === parentId);
  // Signed-amount replay: positive = owed (charges), negative = paid/credited.
  const outstanding = entries.reduce((sum, e) => sum + (typeof e.amount === "number" ? e.amount : 0), 0);
  return Math.max(0, Math.round(outstanding * 100) / 100);
}

/** Max days overdue across the parent's unpaid/partial installments. */
function daysOverdueFromLedger(parentId: string): number {
  let maxDays = 0;
  const now = Date.now();
  for (const ins of store.installments) {
    if (ins.parentId !== parentId) continue;
    if (ins.status === "paid") continue;
    const due = new Date(ins.dueDate).getTime();
    if (Number.isFinite(due) && due < now) {
      maxDays = Math.max(maxDays, Math.floor((now - due) / 86_400_000));
    }
  }
  return maxDays;
}

/** Unexcused absences of a student in the current term (both absence flavors count, mirroring alertAbsences; accepted justifications excluded). */
function unexcusedAbsenceCount(studentId: string, now: Date): number {
  const term = currentTermWindow(now);
  return store.attendance.filter(
    (r) =>
      r.studentId === studentId &&
      (r.status === "absent_unexcused" || r.status === "absent_excused") &&
      r.date >= term.from.slice(0, 10) &&
      r.date <= term.to.slice(0, 10) &&
      (r.justificationStatus ?? "none") !== "accepted",
  ).length;
}

export interface EntityContextInput {
  readonly parentId?: string | null;
  readonly studentId?: string | null;
  readonly student?: Pick<Student, "id" | "parentId" | "firstName" | "lastName" | "status"> | null;
}

/**
 * Build the REAL entity execution context (T-227 mock parity): parent
 * identity + ledger-derived debt + the parent's students + each student's
 * real term absence count. Falls back to the seeded defaults for whatever
 * entity is missing so conditions always have values to evaluate.
 */
export function buildEntityContext(input: EntityContextInput, now: Date = new Date()): ConditionContext {
  const base = defaultConditionContext(now) as Record<string, unknown>;
  const parentId = input.parentId ?? input.student?.parentId ?? null;
  const parent = parentId ? store.parents.find((p) => p.id === parentId) ?? null : null;
  const student =
    input.studentId
      ? store.students.find((s) => s.id === input.studentId) ?? null
      : (input.student ?? null);

  const context: Record<string, unknown> = { ...base };

  if (parent) {
    const outstanding = outstandingFromLedger(parent.id);
    context.parent = {
      id: parent.id,
      name: parentDisplayName(parent),
      outstanding_balance: outstanding,
      days_overdue: daysOverdueFromLedger(parent.id),
      is_financially_restricted: parent.financiallyRestricted ?? false,
    };
    context.debt = {
      amount: outstanding,
      threshold: 50_000,
      days_overdue: daysOverdueFromLedger(parent.id),
    };
  }

  if (student) {
    context.student = {
      id: student.id,
      name: `${student.firstName} ${student.lastName}`.trim(),
      absence_count: unexcusedAbsenceCount(student.id, now),
      status: (student as { status?: string }).status ?? "active",
      gpa: (base.student as Record<string, unknown>)?.gpa ?? 12.5,
      has_medical_certificate:
        (base.student as Record<string, unknown>)?.has_medical_certificate ?? false,
    };
  }

  (context.workflow as Record<string, unknown>) = {
    ...((base.workflow as Record<string, unknown>) ?? {}),
    now: now.toISOString(),
    nowMs: now.getTime(),
    ...(parentId ? { parentId } : {}),
    ...(student?.id ? { studentId: student.id } : {}),
  };

  return context;
}

/* ------------------------------------------------------------------ */
/*  The dispatcher                                                     */
/* ------------------------------------------------------------------ */

export interface DispatchTriggerInput {
  /** The TRIGGER subtype that fired (e.g. "absence_limit_exceeded"). */
  readonly triggerSubtype: WorkflowNodeSubtype;
  /** Real entity context for the event. */
  readonly context: ConditionContext;
  readonly actorId: string;
  readonly actorName: string;
  /** The parent the event targets (side-effect recipient). */
  readonly targetParentId?: string | null;
  /** Coarse run trigger (records how the run was started). */
  readonly triggerType?: WorkflowTriggerType;
}

/**
 * Fire every DEPLOYED workflow whose trigger nodes include `triggerSubtype`.
 * Fail-safe: never throws (each workflow's failure is audit-logged).
 */
export async function dispatchWorkflowTrigger(input: DispatchTriggerInput): Promise<readonly WorkflowRun[]> {
  const runs: WorkflowRun[] = [];
  const candidates = store.workflows.filter((wf) => wf.status === "deployed");
  for (const wf of candidates) {
    const hasTrigger = wf.nodes.some(
      (n) => n.type === "trigger" && n.subtype === input.triggerSubtype,
    );
    if (!hasTrigger) continue;
    try {
      const run = executeWorkflowWithSideEffects({
        workflow: wf,
        context: input.context,
        actorId: input.actorId,
        actorName: input.actorName,
        targetParentId: input.targetParentId ?? null,
        triggerType: input.triggerType ?? "automatic",
        triggerSubtype: input.triggerSubtype,
      });
      if (run) runs.push(run);
    } catch (err) {
      appendAudit({
        action: "workflow.dispatch.error",
        entityType: "workflow",
        entityId: wf.id,
        actorId: input.actorId,
        actorName: input.actorName,
        diff: { before: null, after: { trigger: input.triggerSubtype, error: String(err) } },
        note: `Pont d'événement — échec du workflow « ${wf.name} » : ${String(err)}`,
      });
    }
  }
  return runs;
}

/* ------------------------------------------------------------------ */
/*  The shared executor (repository + bridge both call this)          */
/* ------------------------------------------------------------------ */

export interface ExecuteWithEffectsInput {
  readonly workflow: Workflow;
  readonly context: ConditionContext;
  readonly actorId: string;
  readonly actorName: string;
  readonly targetParentId: string | null;
  readonly triggerType: WorkflowTriggerType;
  readonly triggerSubtype?: WorkflowNodeSubtype;
}

/**
 * Execute a workflow with the dry-run engine as the path decider, apply the
 * REAL side effects for succeeded action nodes, persist the run record and
 * the audit trail. Synchronous (mock store writes) — returns the run.
 */
export function executeWorkflowWithSideEffects(input: ExecuteWithEffectsInput): WorkflowRun | null {
  const wf = input.workflow;
  const simulation = dryRunWorkflow(wf.nodes, wf.edges, input.context);
  if (!simulation.ok) {
    appendAudit({
      action: "workflow.dispatch.invalid",
      entityType: "workflow",
      entityId: wf.id,
      actorId: input.actorId,
      actorName: input.actorName,
      diff: { before: null, after: null },
      note: `Échec: ${simulation.error ?? "graphe invalide"}`,
    });
    return null;
  }

  const runId = `wfr-${String(store.workflowRuns.length + 1).padStart(3, "0")}-${Date.now().toString(36)}`;
  const startedAtMs = Date.now();
  const startedAt = nowIso();
  const nodeById = new Map(wf.nodes.map((n) => [n.id, n]));

  const sideInput: SideEffectsInput = {
    workflowId: wf.id,
    workflowName: wf.name,
    runId,
    results: simulation.results,
    context: simulation.context,
    targetParentId: input.targetParentId,
    actorId: input.actorId,
    actorName: input.actorName,
  };

  const results: WorkflowNodeResult[] = [];
  let cursor = startedAtMs;
  for (const sim of simulation.results) {
    const node = nodeById.get(sim.nodeId);
    const dur = sim.type === "delay" ? 50 : 50 + (sim.nodeId.length % 7) * 20;
    cursor += dur;
    const nodeStart = new Date(cursor - dur).toISOString();
    const nodeEnd = new Date(cursor).toISOString();

    if (sim.status === "skipped") {
      results.push({
        nodeId: sim.nodeId,
        nodeLabel: sim.nodeLabel,
        status: "skipped",
        startedAt: nodeStart,
        completedAt: nodeEnd,
        output: sim.output,
      });
      continue;
    }

    let output: string | undefined = sim.output;
    // REAL side effects for executed action nodes (T-314).
    if (node && sim.type === "action" && sim.status === "succeeded") {
      const applied = applyActionEffect(sideInput, node, simulation.context);
      output = [sim.output, applied].filter(Boolean).join(" · ");
    } else if (sim.resolvedTemplate) {
      output = `${sim.output} · message résolu : « ${sim.resolvedTemplate} »`;
    }

    results.push({
      nodeId: sim.nodeId,
      nodeLabel: sim.nodeLabel,
      status: "succeeded",
      startedAt: nodeStart,
      completedAt: nodeEnd,
      output,
    });
  }

  const completedAt = new Date(cursor).toISOString();
  const run: WorkflowRun = {
    id: runId,
    tenantId: wf.tenantId,
    workflowId: wf.id,
    workflowName: wf.name,
    triggerType: input.triggerType,
    status: "succeeded",
    startedAt,
    completedAt,
    durationMs: cursor - startedAtMs,
    actorId: input.actorId,
    actorName: input.actorName,
    nodeResults: results,
  };
  store.workflowRuns = [run, ...store.workflowRuns];
  store.notifyWorkflowRuns();
  appendAudit({
    action: "workflow.triggered",
    entityType: "workflow_run",
    entityId: run.id,
    actorId: input.actorId,
    actorName: input.actorName,
    diff: {
      before: null,
      after: {
        workflow: wf.name,
        trigger: input.triggerSubtype ?? input.triggerType,
        status: run.status,
        target: input.targetParentId,
      },
    },
    note: `Exécution ${input.triggerType} du workflow « ${wf.name} » via le pont d'événements (${simulation.takenEdgeKeys.length} lien(s) emprunté(s)).`,
  });
  return run;
}

/* ------------------------------------------------------------------ */
/*  Convenience dispatchers (called by the domain repositories)        */
/* ------------------------------------------------------------------ */

/** RollCall: fire absence_limit_exceeded for a student that JUST crossed the threshold. */
export function dispatchAbsenceLimitExceeded(
  student: Pick<Student, "id" | "parentId" | "firstName" | "lastName" | "status">,
  absenceCount: number,
  recordedBy: string,
): Promise<readonly WorkflowRun[]> {
  const context = buildEntityContext({ student }, new Date());
  // Enrich with the exact count the event carries.
  (context as Record<string, unknown>).student = {
    ...((context.student as Record<string, unknown>) ?? {}),
    absence_count: absenceCount,
    name: `${student.firstName} ${student.lastName}`.trim(),
  };
  return dispatchWorkflowTrigger({
    triggerSubtype: "absence_limit_exceeded",
    context,
    actorId: "system",
    actorName: `Système (appel — seuil absences${recordedBy ? `, saisie ${recordedBy}` : ""})`,
    targetParentId: student.parentId,
    triggerType: "automatic",
  });
}

/** Payments: fire payment_recorded after a successful collection. */
export function dispatchPaymentRecorded(
  parentId: string,
  payment: { id: string; amount: number; method: string; category?: string },
  actorId: string,
): Promise<readonly WorkflowRun[]> {
  const context = buildEntityContext({ parentId }, new Date());
  (context as Record<string, unknown>).payment = {
    id: payment.id,
    amount: payment.amount,
    method: payment.method,
    status: "paid",
    category: payment.category ?? "tuition",
    days_overdue: 0,
  };
  return dispatchWorkflowTrigger({
    triggerSubtype: "payment_recorded",
    context,
    actorId: actorId || "system",
    actorName: "Système (encaissement)",
    targetParentId: parentId,
    triggerType: "automatic",
  });
}

/** Payments: fire payment_cleared_or_bounced on a check/transfer outcome. */
export function dispatchPaymentClearedOrBounced(
  parentId: string,
  payment: { id: string; amount: number; method: string; outcome: "cleared" | "bounced"; reason?: string },
  actorId: string,
): Promise<readonly WorkflowRun[]> {
  const context = buildEntityContext({ parentId }, new Date());
  (context as Record<string, unknown>).payment = {
    id: payment.id,
    amount: payment.amount,
    method: payment.method,
    status: payment.outcome === "cleared" ? "cleared" : "bounced",
    category: "tuition",
    days_overdue: 0,
    outcome: payment.outcome,
    ...(payment.reason ? { reason: payment.reason } : {}),
  };
  return dispatchWorkflowTrigger({
    triggerSubtype: "payment_cleared_or_bounced",
    context,
    actorId: actorId || "system",
    actorName: `Système (chèque ${payment.outcome === "cleared" ? "compensé" : "rejeté"})`,
    targetParentId: parentId,
    triggerType: "automatic",
  });
}

/** Enrollment: fire student_enrolled after a (batch) registration. */
export function dispatchStudentEnrolled(
  student: Pick<Student, "id" | "parentId" | "firstName" | "lastName" | "status">,
  actorId: string,
): Promise<readonly WorkflowRun[]> {
  const context = buildEntityContext({ student }, new Date());
  return dispatchWorkflowTrigger({
    triggerSubtype: "student_enrolled",
    context,
    actorId: actorId || "system",
    actorName: "Système (inscription)",
    targetParentId: student.parentId,
    triggerType: "automatic",
  });
}

/** Overdue scan: fire payment_overdue for a parent's overdue installment. */
export function dispatchPaymentOverdue(
  parentId: string,
  installment: { id: string; amountDue: number; amountPaid: number; daysOverdue: number },
): Promise<readonly WorkflowRun[]> {
  const context = buildEntityContext({ parentId }, new Date());
  (context as Record<string, unknown>).payment = {
    installment_id: installment.id,
    amount: Math.max(0, installment.amountDue - installment.amountPaid),
    method: "any",
    status: "unpaid",
    category: "tuition",
    days_overdue: installment.daysOverdue,
  };
  return dispatchWorkflowTrigger({
    triggerSubtype: "payment_overdue",
    context,
    actorId: "system",
    actorName: "Système (scan retards)",
    targetParentId: parentId,
    triggerType: "automatic",
  });
}
