/**
 * Mock workflow repository + workflow run repository.
 *
 * Extracted from `mock-repositories.ts` in iteration 2 of the platform-wide
 * refactor. Behavior preserved verbatim — including DAG cycle detection
 * (refuses to deploy/execute cyclic graphs) and the 90% mock success rate
 * for action nodes.
 */
import type {
  WorkflowRepository,
  WorkflowRunRepository,
  Observable,
} from "../../../domain/repository/repository";
import type { Result } from "../../../core/result";
import { Ok, Err } from "../../../core/result";
import { Errors } from "../../../core/app-error";
import { AuditActions } from "../../../core/audit-actions";
import { SubjectBehavior } from "../subject-behavior";
import { detectCycle } from "../../../domain/kahn";
import type {
  Workflow,
  WorkflowRun,
  WorkflowNodeResult,
  WorkflowRunStatus,
  WorkflowTriggerType,
} from "../../../domain/model/workflow";
import { store, TENANT_ID, appendAudit, nowIso, delay } from "./mock-store";
import {
  defaultConditionContext,
} from "../../../domain/calc/workflow/condition-evaluator";
import { dryRunWorkflow } from "../../../domain/calc/workflow/dry-run";
import type { WorkflowServerDryRun } from "../../../domain/model/workflow";

export class MockWorkflowRepository implements WorkflowRepository {
  observe(): Observable<Workflow[]> {
    return store.workflows$;
  }

  observeById(id: string): Observable<Workflow | null> {
    return new SubjectBehavior(store.workflows.find((w) => w.id === id) ?? null);
  }

  async createWorkflow(input: {
    name: string;
    description: string;
    triggerType: WorkflowTriggerType;
    createdBy: string;
  }): Promise<Result<Workflow>> {
    await delay(200);
    if (!input.name.trim()) {
      return Err(Errors.validation("Le nom du workflow est requis"));
    }
    const id = `wf-${String(store.workflows.length + 1).padStart(3, "0")}-${Date.now().toString(36)}`;
    const now = nowIso();
    const workflow: Workflow = {
      id,
      tenantId: TENANT_ID,
      name: input.name.trim(),
      description: input.description.trim(),
      nodes: [],
      edges: [],
      triggerType: input.triggerType,
      lastDeployedAt: null,
      status: "draft",
      createdAt: now,
      updatedAt: now,
      createdBy: input.createdBy,
    };
    store.workflows = [...store.workflows, workflow];
    store.notifyWorkflows();
    appendAudit({
      action: "workflow.create",
      entityType: "workflow",
      entityId: id,
      actorId: input.createdBy,
      actorName: "Session courante",
      diff: { before: null, after: { name: workflow.name, triggerType: workflow.triggerType } },
      note: "Création d'un workflow",
    });
    return Ok(workflow);
  }

  async updateWorkflow(id: string, updates: Partial<Workflow>, updatedBy: string): Promise<Result<Workflow>> {
    await delay(180);
    const idx = store.workflows.findIndex((w) => w.id === id);
    if (idx === -1) return Err(Errors.notFound("Workflow", id));
    const before = store.workflows[idx];
    // Only mutable fields are updateable; never overwrite id/tenantId/createdAt/createdBy.
    const after: Workflow = {
      ...before,
      ...updates,
      id: before.id,
      tenantId: before.tenantId,
      createdAt: before.createdAt,
      createdBy: before.createdBy,
      updatedAt: nowIso(),
    };
    // VAULT §10.09 (best practice 1) — run Kahn's algorithm on EVERY canvas
    // save, not just on publish: a cyclic graph cannot even be saved.
    const cycle = detectCycle(after.nodes, after.edges);
    if (cycle.hasCycle) {
      return Err(Errors.validation(
        `Workflow has a cycle (${cycle.cycleNodeIds.size} nodes)`,
        "Cycle détecté — sauvegarde impossible (algorithme de Kahn, plan §18.04).",
      ));
    }
    // VAULT §10.09 (best practice 5) — validate the daily execution cap.
    if (after.maxDailyExecutions !== undefined && after.maxDailyExecutions < 1) {
      return Err(Errors.validation(
        "maxDailyExecutions must be >= 1",
        "Le plafond d'exécutions quotidiennes doit être au moins 1.",
      ));
    }
    store.workflows = store.workflows.map((w, i) => (i === idx ? after : w));
    store.notifyWorkflows();
    appendAudit({
      action: "workflow.update",
      entityType: "workflow",
      entityId: id,
      actorId: updatedBy,
      actorName: "Session courante",
      diff: {
        before: { name: before.name, status: before.status, nodes: before.nodes.length, edges: before.edges.length },
        after: { name: after.name, status: after.status, nodes: after.nodes.length, edges: after.edges.length },
      },
      note: "Mise à jour d'un workflow",
    });
    return Ok(after);
  }

  async deleteWorkflow(id: string): Promise<Result<void>> {
    await delay(160);
    const before = store.workflows.find((w) => w.id === id);
    if (!before) return Err(Errors.notFound("Workflow", id));
    store.workflows = store.workflows.filter((w) => w.id !== id);
    store.notifyWorkflows();
    appendAudit({
      action: "workflow.delete",
      entityType: "workflow",
      entityId: id,
      actorId: "system",
      actorName: "Session courante",
      diff: { before: { name: before.name }, after: null },
      note: "Suppression d'un workflow",
    });
    return Ok(undefined);
  }

  async deploy(id: string, deployedBy: string): Promise<Result<Workflow>> {
    await delay(220);
    const wf = store.workflows.find((w) => w.id === id);
    if (!wf) return Err(Errors.notFound("Workflow", id));
    // Cycle check — refuse to deploy a cyclic graph.
    const cycle = detectCycle(wf.nodes, wf.edges);
    if (cycle.hasCycle) {
      return Err(Errors.validation(
        `Workflow has a cycle (${cycle.cycleNodeIds.size} nodes)`,
        "Cycle détecté — déploiement impossible.",
      ));
    }
    const now = nowIso();
    const after: Workflow = {
      ...wf,
      status: "deployed",
      lastDeployedAt: now,
      updatedAt: now,
    };
    store.workflows = store.workflows.map((w) => (w.id === id ? after : w));
    store.notifyWorkflows();
    appendAudit({
      action: AuditActions.WorkflowPublished,
      entityType: "workflow",
      entityId: id,
      actorId: deployedBy,
      actorName: "Session courante",
      diff: { before: { status: wf.status }, after: { status: "deployed", lastDeployedAt: now } },
      note: "Déploiement d'un workflow",
    });
    return Ok(after);
  }

  async execute(id: string, actorId: string, actorName: string): Promise<Result<WorkflowRun>> {
    await delay(120);
    const wf = store.workflows.find((w) => w.id === id);
    if (!wf) return Err(Errors.notFound("Workflow", id));
    // Plan §10.02: validate DAG before running.
    const cycle = detectCycle(wf.nodes, wf.edges);
    if (cycle.hasCycle) {
      appendAudit({
        action: AuditActions.WorkflowTriggered,
        entityType: "workflow",
        entityId: id,
        actorId,
        actorName,
        diff: { before: null, after: null },
        note: `Échec: cycle détecté (${cycle.cycleNodeIds.size} nœuds)`,
      });
      return Err(Errors.validation(
        `Workflow has a cycle (${cycle.cycleNodeIds.size} nodes)`,
        "Cycle détecté — exécution impossible.",
      ));
    }
    // Plan §10.04: disabled workflows cannot be executed.
    if (wf.status === "disabled") {
      return Err(Errors.conflict("Workflow is disabled", "Ce workflow est désactivé."));
    }
    // VAULT §10.09 (best practice 5) — daily execution cap prevents runaway
    // loops. Mirrors the backend `workflows.max_daily_executions` (default 100).
    const cap = wf.maxDailyExecutions ?? 100;
    const todayPrefix = new Date().toISOString().slice(0, 10);
    const todayRuns = store.workflowRuns.filter(
      (r) => r.workflowId === id && r.startedAt.slice(0, 10) === todayPrefix,
    ).length;
    if (todayRuns >= cap) {
      appendAudit({
        action: AuditActions.WorkflowTriggered,
        entityType: "workflow",
        entityId: id,
        actorId,
        actorName,
        diff: { before: null, after: null },
        note: `Échec: plafond quotidien atteint (${todayRuns}/${cap} exécutions aujourd'hui)`,
      });
      return Err(Errors.conflict(
        `Daily execution limit reached (${todayRuns}/${cap})`,
        `Plafond quotidien atteint — ${todayRuns}/${cap} exécutions aujourd'hui. Le workflow redeviendra exécutable demain.`,
      ));
    }
    // T-221: the executor now walks the DAG in TOPOLOGICAL order with the
    // SAME branch semantics as the canvas's dry-run simulator (the pure
    // engine in domain/calc/workflow/dry-run is the single source of
    // truth): a failing condition closes its branch, a route_switch opens
    // only its first passing route, and nodes not fed by an active path are
    // skipped. Previously the executor iterated the nodes array linearly
    // with a single global `conditionFailed` flag, which diverged from the
    // visual model (parallel branches could not diverge).
    const simulation = dryRunWorkflow(wf.nodes, wf.edges, defaultConditionContext());
    if (!simulation.ok) {
      appendAudit({
        action: AuditActions.WorkflowTriggered,
        entityType: "workflow",
        entityId: id,
        actorId,
        actorName,
        diff: { before: null, after: null },
        note: `Échec: ${simulation.error ?? "graphe invalide"}`,
      });
      return Err(Errors.validation(
        "Workflow graph is invalid",
        simulation.error ?? "Graphe invalide — exécution impossible.",
      ));
    }
    const startedAtMs = Date.now();
    const startedAt = nowIso();
    const results: WorkflowNodeResult[] = [];
    let cursor = startedAtMs;
    let failed = false;
    let failedNodeId: string | null = null;
    for (const sim of simulation.results) {
      const nodeStart = new Date(cursor).toISOString();
      // charCodeAt may return NaN for short ids; coerce to 0 via Number.isNaN.
      const charAt2 = sim.nodeId.charCodeAt(2);
      const charAt0 = sim.nodeId.charCodeAt(0);
      const dur = sim.type === "delay" ? 50 : 50 + ((Number.isNaN(charAt2) ? 0 : charAt2) % 150);
      cursor += dur;
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

      let nodeStatus: WorkflowNodeResult["status"] = "succeeded";
      let output: string | undefined = sim.output;
      let error: string | undefined;
      const warnings = sim.warnings.length > 0 ? ` ${sim.warnings.join(" ")}`.trim() : "";
      if (warnings) output = `${output} ${warnings}`.trim();

      if (sim.type === "action" && !failed) {
        // 90% success rate (deterministic by node id hash so tests are stable).
        const hash = (Number.isNaN(charAt0) ? 0 : charAt0) + (Number.isNaN(charAt2) ? 0 : charAt2);
        if (hash % 10 === 0) {
          nodeStatus = "failed";
          failed = true;
          failedNodeId = sim.nodeId;
          output = undefined;
          error = "Échec de l'action (mock 90%)";
        }
      }

      results.push({
        nodeId: sim.nodeId,
        nodeLabel: sim.nodeLabel,
        status: nodeStatus,
        startedAt: nodeStart,
        completedAt: nodeEnd,
        output,
        error,
      });
      if (failed) break;
    }
    const overallStatus: WorkflowRunStatus = failed ? "failed" : "succeeded";
    const completedAt = new Date(cursor).toISOString();
    const durationMs = cursor - startedAtMs;
    const run: WorkflowRun = {
      id: `wfr-${String(store.workflowRuns.length + 1).padStart(3, "0")}-${Date.now().toString(36)}`,
      tenantId: wf.tenantId,
      workflowId: wf.id,
      workflowName: wf.name,
      triggerType: wf.triggerType,
      status: overallStatus,
      startedAt,
      completedAt,
      durationMs,
      actorId,
      actorName,
      nodeResults: results,
      error: failed && failedNodeId
        ? `Échec au nœud ${failedNodeId}`
        : undefined,
    };
    store.workflowRuns = [run, ...store.workflowRuns];
    store.notifyWorkflowRuns();
    appendAudit({
      action: AuditActions.WorkflowTriggered,
      entityType: "workflow_run",
      entityId: run.id,
      actorId,
      actorName,
      diff: { before: null, after: { status: run.status, durationMs: run.durationMs } },
      note: `Exécution manuelle du workflow ${wf.name}`,
    });
    return Ok(run);
  }

  /** T-230: local dry-run engine mapped to the server-dry-run contract. */
  async dryRun(
    id: string,
    _entity?: { parentId?: string; studentId?: string },
  ): Promise<Result<WorkflowServerDryRun>> {
    await delay(80);
    const wf = store.workflows.find((w) => w.id === id);
    if (!wf) return Err(Errors.notFound("Workflow", id));
    const simulation = dryRunWorkflow(wf.nodes, wf.edges, defaultConditionContext());
    if (!simulation.ok) {
      return Err(Errors.validation("Workflow graph is invalid", simulation.error ?? "Graphe invalide."));
    }
    return Ok({
      workflowId: id,
      status: "succeeded",
      nodeOutcomes: simulation.results.map((r) => ({
        nodeId: r.nodeId,
        nodeLabel: r.nodeLabel,
        status: r.status,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        output: [r.output, ...r.warnings].join(" ").trim() || undefined,
      })),
      takenEdgeKeys: simulation.takenEdgeKeys,
      warnings: simulation.results.flatMap((r) => [...r.warnings]),
    });
  }
}

/**
 * WorkflowRun repository — append-only log of executions.
 * `retryRun` creates a new run by re-executing the underlying workflow.
 */
export class MockWorkflowRunRepository implements WorkflowRunRepository {
  observe(): Observable<WorkflowRun[]> {
    return store.workflowRuns$;
  }

  observeByWorkflow(workflowId: string): Observable<WorkflowRun[]> {
    return new SubjectBehavior(store.workflowRuns.filter((r) => r.workflowId === workflowId));
  }

  observeById(id: string): Observable<WorkflowRun | null> {
    return new SubjectBehavior(store.workflowRuns.find((r) => r.id === id) ?? null);
  }

  async retryRun(id: string, actorId: string, actorName: string): Promise<Result<WorkflowRun>> {
    await delay(120);
    const original = store.workflowRuns.find((r) => r.id === id);
    if (!original) return Err(Errors.notFound("WorkflowRun", id));
    // Re-execute via the workflow repository so cycle detection + audit log
    // are applied identically.
    const result = await mockWorkflowRepository.execute(original.workflowId, actorId, actorName);
    if (!result.ok) return Err(result.error);
    return Ok(result.value);
  }
}

// ============================================================================
// Singletons — exported for the barrel re-export in `mock-repositories.ts`.
// ============================================================================

export const mockWorkflowRepository: WorkflowRepository = new MockWorkflowRepository();
export const mockWorkflowRunRepository: WorkflowRunRepository = new MockWorkflowRunRepository();

// Re-export Observable so consumers of this file don't need a second import.
export type { Observable };
