/**
 * SupabaseWorkflowRepository — Supabase-backed implementation of the
 * `WorkflowRepository` domain contract (plan §10).
 *
 * Task: T-176 (28th session, 2026-09-05) — the T-047 `workflows` port
 * (priority #2 in the T-160 scoping: Android pull-syncs `workflow_runs`
 * while the desktop's writer was mock-backed — desktop-authored workflow
 * state could never reach the server, so Android read an empty set and
 * restarts wiped the desktop's own definitions).
 *
 * Tables (migration 0012 + 0071):
 *   `workflows` — code / name / description / dag_definition (jsonb) /
 *   status (draft|published|disabled) / max_daily_executions / trigger_type
 *   (free text) / created_by / last_executed_at / total_executions /
 *   last_deployed_at (0071) / created_at / updated_at.
 *   `workflow_runs` — written by the canonical `workflow-execute` EF (see
 *   execute() below).
 *
 * MAPPING NOTES (documented):
 *   1. `dag_definition` stores the EF-canonical object
 *      `{ nodes: [...], edges: [{ id, source, target }] }` — the
 *      workflow-execute EF parses exactly this shape (source/target edge
 *      fields; the domain uses from/to — mapped on write/read). Domain node
 *      objects keep their full shape (id, type, subtype, label, position,
 *      config); the EF tolerates extra fields.
 *   2. Status: domain `deployed` ↔ DB `published` (the 0012 enum). deploy()
 *      writes status + last_deployed_at (0071 column) in ONE update.
 *   3. `trigger_type` (free text per 0012): the domain's coarse union
 *      (manual|automatic|scheduled) is stored as-is — the EF does not read
 *      the column (it uses the caller's body trigger_type, default
 *      manual_run); the fine-grained runs enum is mapped on the run side
 *      (supabase-workflow-run-repository.ts).
 *   4. `code` (NOT NULL, unique per tenant): derived deterministically from
 *      the name (slug + stable hash — the departments pattern; ADR-003:
 *      no random, no sequences).
 *   5. `last_executed_at` / `total_executions`: owned by the EF (best
 *      effort) — the port reads but never writes them.
 *   6. delete(): workflow_runs.workflow_id is ON DELETE RESTRICT — a
 *      workflow with history is NOT deletable (server semantics surface as
 *      a Conflict error advising disable; the mock silently hard-deleted).
 *
 * execute() is the CANONICAL path: it invokes the `workflow-execute`
 * Edge Function (the same EF the cron/manual server path uses — cycle
 * detection, daily cap, node execution and the runs row all happen
 * server-side per ADR-002; the desktop never re-implements execution).
 *
 * Reactive reads follow the shared Supabase pattern: SubjectBehavior cache +
 * T-034/CROSS-104 freshness policy + refresh after every successful write.
 *
 * Wiring: `getSupabaseRepositories()` (supabase-repositories.ts) overrides
 * the mock `workflows` entry with this class.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  WorkflowRepository,
  Observable,
} from "../../../domain/repository/repository";
import type { Result } from "../../../core/result";
import { Ok, Err } from "../../../core/result";
import { Errors } from "../../../core/app-error";
import { supabaseErrorToAppError } from "../supabase-client";
import { SubjectBehavior, derived } from "../../mock/subject-behavior";
import type {
  Workflow,
  WorkflowNode,
  WorkflowEdge,
  WorkflowRun,
  WorkflowTriggerType,
} from "../../../domain/model/workflow";
import { detectCycle } from "../../../domain/kahn";
import { getTenantId, isUuid } from "./supabase-shared-repositories";
import { CacheFreshness } from "../cache-freshness";

// ============================================================================
// Row types (local — workflows is not in the shared types.ts yet)
// ============================================================================

/** Edge as stored in dag_definition (the EF-canonical source/target shape). */
interface StoredEdge {
  id: string;
  source: string;
  target: string;
}

interface StoredDefinition {
  nodes: WorkflowNode[];
  edges: StoredEdge[];
}

interface WorkflowTableRow {
  id: string;
  tenant_id: string;
  code: string;
  name: string;
  description: string | null;
  dag_definition: StoredDefinition | string;
  status: "draft" | "published" | "disabled";
  max_daily_executions: number;
  trigger_type: string | null;
  created_by: string | null;
  last_executed_at: string | null;
  last_deployed_at: string | null;
  total_executions: number;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Mappers
// ============================================================================

const STATUS_TO_DB: Record<Workflow["status"], WorkflowTableRow["status"]> = {
  draft: "draft",
  deployed: "published",
  disabled: "disabled",
};

const STATUS_TO_DOMAIN: Record<WorkflowTableRow["status"], Workflow["status"]> = {
  draft: "draft",
  published: "deployed",
  disabled: "disabled",
};

function parseDefinition(raw: StoredDefinition | string): StoredDefinition {
  const def = typeof raw === "string" ? (JSON.parse(raw) as StoredDefinition) : raw;
  return {
    nodes: Array.isArray(def.nodes) ? def.nodes : [],
    edges: Array.isArray(def.edges) ? def.edges : [],
  };
}

function mapRow(row: WorkflowTableRow): Workflow {
  const def = parseDefinition(row.dag_definition);
  const nodes: WorkflowNode[] = def.nodes.map((n) => ({
    id: String(n.id),
    type: n.type,
    subtype: n.subtype,
    label: n.label ?? "",
    position: n.position ?? { x: 0, y: 0 },
    config: n.config ?? {},
  }));
  const edges: WorkflowEdge[] = def.edges.map((e) => ({
    id: String(e.id ?? `${e.source}-${e.target}`),
    from: e.source,
    to: e.target,
  }));
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    description: row.description ?? "",
    nodes,
    edges,
    triggerType: (row.trigger_type ?? "manual") as WorkflowTriggerType,
    lastDeployedAt: row.last_deployed_at ?? null,
    status: STATUS_TO_DOMAIN[row.status] ?? "draft",
    maxDailyExecutions: row.max_daily_executions,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by ?? "system",
  };
}

/** Domain → dag_definition jsonb (the EF-canonical shape). */
function toDefinition(nodes: readonly WorkflowNode[], edges: readonly WorkflowEdge[]): StoredDefinition {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.type,
      subtype: n.subtype,
      label: n.label,
      position: n.position,
      config: n.config,
    })),
    edges: edges.map((e) => ({ id: e.id, source: e.from, target: e.to })),
  };
}

/** Deterministic code: slug + stable hash (departments pattern; ADR-003). */
function stableHash(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (Math.imul(31, h) + input.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36).toUpperCase().padStart(6, "0").slice(-4);
}

function codeFor(name: string): string {
  const base = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase()
    .slice(0, 8);
  return `WF-${base || "FLOW"}-${stableHash(name)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

// ============================================================================
// Repository
// ============================================================================

export class SupabaseWorkflowRepository implements WorkflowRepository {
  private readonly cache = new SubjectBehavior<Workflow[]>([]);
  private readonly freshness = new CacheFreshness();

  constructor(private readonly client: SupabaseClient) {}

  observe(): Observable<Workflow[]> {
    this.seed();
    return this.cache;
  }

  observeById(id: string): Observable<Workflow | null> {
    this.seed();
    return derived([this.cache], () => this.cache.get().find((w) => w.id === id) ?? null);
  }

  async createWorkflow(input: {
    name: string;
    description: string;
    triggerType: WorkflowTriggerType;
    createdBy: string;
  }): Promise<Result<Workflow>> {
    if (!input.name.trim()) {
      return Err(Errors.validation("Le nom du workflow est requis"));
    }
    let inserted: WorkflowTableRow | null = null;
    for (let attempt = 0; attempt < 2 && !inserted; attempt++) {
      const code = attempt === 0 ? codeFor(input.name) : `${codeFor(input.name)}-${Date.now().toString(36).toUpperCase().slice(-3)}`;
      const { data, error } = await this.client
        .from("workflows")
        .insert({
          tenant_id: getTenantId(),
          code,
          name: input.name.trim(),
          description: input.description.trim() || null,
          dag_definition: toDefinition([], []) as unknown as string,
          status: "draft",
          max_daily_executions: 100,
          trigger_type: input.triggerType,
          created_by: isUuid(input.createdBy) ? input.createdBy : null,
        })
        .select("*")
        .single();
      if (error) {
        // unique (tenant_id, code) collision — retry with a distinct suffix.
        if ((error as { code?: string }).code === "23505" && attempt === 0) continue;
        return Err(supabaseErrorToAppError(error));
      }
      inserted = data as unknown as WorkflowTableRow;
    }
    if (!inserted) {
      return Err(Errors.conflict("Could not derive a unique workflow code"));
    }
    await this.refresh();
    return Ok(mapRow(inserted));
  }

  async updateWorkflow(
    id: string,
    updates: Partial<Pick<Workflow, "name" | "description" | "nodes" | "edges" | "triggerType" | "status">>,
    _updatedBy: string,
  ): Promise<Result<Workflow>> {
    const existing = await this.fetchRow(id);
    if (!existing) return Err(Errors.notFound("Workflow", id));
    const before = mapRow(existing);
    const after: Workflow = {
      ...before,
      ...updates,
      id: before.id,
      tenantId: before.tenantId,
      createdAt: before.createdAt,
      createdBy: before.createdBy,
      updatedAt: nowIso(),
    };
    // VAULT §10.09 (best practice 1) — cycle check on EVERY canvas save
    // (mock parity; the EF re-checks on execute).
    const cycle = detectCycle(after.nodes, after.edges);
    if (cycle.hasCycle) {
      return Err(Errors.validation(
        `Workflow has a cycle (${cycle.cycleNodeIds.size} nodes)`,
        "Cycle détecté — sauvegarde impossible (algorithme de Kahn, plan §18.04).",
      ));
    }
    const patch: Record<string, unknown> = { updated_at: nowIso() };
    if (updates.name !== undefined) patch.name = updates.name;
    if (updates.description !== undefined) patch.description = updates.description || null;
    if (updates.nodes !== undefined || updates.edges !== undefined) {
      patch.dag_definition = toDefinition(after.nodes, after.edges) as unknown as string;
    }
    if (updates.triggerType !== undefined) patch.trigger_type = updates.triggerType;
    if (updates.status !== undefined) patch.status = STATUS_TO_DB[updates.status];

    const { data, error } = await this.client
      .from("workflows")
      .update(patch)
      .eq("id", id)
      .eq("tenant_id", getTenantId())
      .select("*")
      .single();
    if (error) return Err(supabaseErrorToAppError(error));
    await this.refresh();
    return Ok(mapRow(data as unknown as WorkflowTableRow));
  }

  async deleteWorkflow(id: string): Promise<Result<void>> {
    const { error } = await this.client
      .from("workflows")
      .delete()
      .eq("id", id)
      .eq("tenant_id", getTenantId());
    if (error) {
      const code = (error as { code?: string }).code;
      // workflow_runs.workflow_id is ON DELETE RESTRICT (0012): a workflow
      // with execution history cannot be deleted — disable it instead.
      if (code === "23503") {
        return Err(Errors.conflict(
          "Workflow has execution history (workflow_runs) and cannot be deleted — disable it instead",
          "Ce workflow a un historique d'exécutions — désactivez-le plutôt que de le supprimer.",
        ));
      }
      return Err(supabaseErrorToAppError(error));
    }
    await this.refresh();
    return Ok(undefined);
  }

  async deploy(id: string, _deployedBy: string): Promise<Result<Workflow>> {
    const existing = await this.fetchRow(id);
    if (!existing) return Err(Errors.notFound("Workflow", id));
    const wf = mapRow(existing);
    // Cycle check — refuse to deploy a cyclic graph (mock parity).
    const cycle = detectCycle(wf.nodes, wf.edges);
    if (cycle.hasCycle) {
      return Err(Errors.validation(
        `Workflow has a cycle (${cycle.cycleNodeIds.size} nodes)`,
        "Cycle détecté — déploiement impossible.",
      ));
    }
    const now = nowIso();
    const { data, error } = await this.client
      .from("workflows")
      .update({ status: "published", last_deployed_at: now, updated_at: now })
      .eq("id", id)
      .eq("tenant_id", getTenantId())
      .select("*")
      .single();
    if (error) return Err(supabaseErrorToAppError(error));
    await this.refresh();
    return Ok(mapRow(data as unknown as WorkflowTableRow));
  }

  /**
   * Execute a workflow manually — the CANONICAL server path (ADR-002):
   * invokes the `workflow-execute` EF which enforces the published-status
   * gate, the daily cap, cycle detection, node execution and writes the
   * `workflow_runs` row + audit entry. The desktop then reads the run back
   * from the table (full node_results) rather than trusting the summary.
   */
  async execute(id: string, actorId: string, actorName: string): Promise<Result<WorkflowRun>> {
    const { data, error } = await this.client.functions.invoke("workflow-execute", {
      body: { workflow_id: id, trigger_type: "manual_run", actor_note: `Desktop manual run by ${actorName}` },
    });
    const payload = (data ?? null) as
      | { run_id?: string; status?: string; duration_ms?: number; error_message?: string; code?: string; message?: string }
      | null;
    if (error || !payload || payload.error_message || !payload.run_id) {
      return Err(Errors.conflict(
        payload?.message ?? error?.message ?? "workflow-execute failed",
      ));
    }
    // Read the full run row back (node results live server-side).
    const { data: runRow, error: runError } = await this.client
      .from("workflow_runs")
      .select("*, workflows(name)")
      .eq("id", payload.run_id)
      .maybeSingle();
    if (!runError && runRow) {
      return Ok(mapRunRow(runRow as Record<string, unknown>, actorId, actorName));
    }
    // Fallback: build the minimal run from the EF summary.
    return Ok({
      id: payload.run_id,
      tenantId: getTenantId() ?? "",
      workflowId: id,
      workflowName: "",
      triggerType: "manual",
      status: (payload.status === "failed" ? "failed" : "succeeded") as WorkflowRun["status"],
      startedAt: nowIso(),
      completedAt: nowIso(),
      durationMs: payload.duration_ms ?? null,
      actorId,
      actorName,
      nodeResults: [],
    });
  }

  // --------------------------------------------------------------------------
  // Internals
  // --------------------------------------------------------------------------

  private seed(): void {
    if (!this.freshness.shouldReseed()) return;
    this.freshness.markSeeded();
    void this.refresh();
  }

  private async refresh(): Promise<void> {
    try {
      const { data, error } = await this.client
        .from("workflows")
        .select("*")
        .eq("tenant_id", getTenantId())
        .order("created_at", { ascending: true });
      if (error) throw error;
      this.cache.set((data ?? []).map((row: Record<string, unknown>) => mapRow(row as unknown as WorkflowTableRow)));
    } catch {
      // Silently degrade to the current cache.
    }
  }

  private async fetchRow(id: string): Promise<WorkflowTableRow | null> {
    const { data, error } = await this.client
      .from("workflows")
      .select("*")
      .eq("id", id)
      .eq("tenant_id", getTenantId())
      .maybeSingle();
    if (error) return null;
    return (data ?? null) as WorkflowTableRow | null;
  }
}

// ============================================================================
// workflow_runs row → domain (shared with SupabaseWorkflowRunRepository —
// exported from here so both repositories map identically)
// ============================================================================

/** DB run trigger enum → domain coarse union. */
export function mapRunTrigger(dbTrigger: string): WorkflowTriggerType {
  switch (dbTrigger) {
    case "manual_run":
      return "manual";
    case "schedule":
      return "scheduled";
    default:
      // payment_overdue / student_enrolled / payment_recorded /
      // absence_limit / debt_over_threshold — all automatic triggers.
      return "automatic";
  }
}

/** DB run status → domain union (pending folds to running; cancelled folds
 *  to failed — the domain model has no queued/cancelled states; documented
 *  lossy read-side fold, same class as the notification kind mapping). */
export function mapRunStatus(dbStatus: string): WorkflowRun["status"] {
  switch (dbStatus) {
    case "succeeded":
      return "succeeded";
    case "timeout":
      return "timeout";
    case "cancelled":
    case "failed":
      return "failed";
    case "pending":
    case "running":
    default:
      return "running";
  }
}

/** A workflow_runs row (optionally joined with workflows(name)) → domain run. */
export function mapRunRow(
  row: Record<string, unknown>,
  fallbackActorId: string,
  fallbackActorName: string,
): WorkflowRun {
  const workflowJoin = (row["workflows"] ?? null) as { name?: string } | null;
  const nodeResults = Array.isArray(row["node_results"])
    ? (row["node_results"] as Array<Record<string, unknown>>).map((nr) => ({
        nodeId: String(nr["node_id"] ?? ""),
        nodeLabel: String(nr["node_label"] ?? nr["node_id"] ?? ""),
        status: (nr["status"] ?? "skipped") as "skipped" | "running" | "succeeded" | "failed" | "timeout",
        startedAt: String(nr["started_at"] ?? row["started_at"] ?? row["triggered_at"] ?? nowIso()),
        completedAt: (nr["completed_at"] ?? null) as string | null,
        output: nr["output"] !== undefined ? JSON.stringify(nr["output"]) : undefined,
        error: (nr["error"] ?? undefined) as string | undefined,
      }))
    : [];
  return {
    id: String(row["id"]),
    tenantId: String(row["tenant_id"]),
    workflowId: String(row["workflow_id"]),
    workflowName: workflowJoin?.name ?? "",
    triggerType: mapRunTrigger(String(row["trigger_type"] ?? "manual_run")),
    status: mapRunStatus(String(row["status"] ?? "running")),
    startedAt: String(row["started_at"] ?? row["triggered_at"] ?? nowIso()),
    completedAt: (row["completed_at"] ?? null) as string | null,
    durationMs: (row["duration_ms"] ?? null) as number | null,
    actorId: String(row["actor_id"] ?? fallbackActorId),
    actorName: fallbackActorName,
    nodeResults,
    error: (row["error_message"] ?? undefined) as string | undefined,
  };
}
