/**
 * SupabaseWorkflowRunRepository — Supabase-backed implementation of the
 * `WorkflowRunRepository` domain contract (plan §10.04).
 *
 * Task: T-177 (28th session, 2026-09-05) — the T-047 `workflowRuns` port
 * (priority #2 in the T-160 scoping, together with the workflows port:
 * ANDROID pull-syncs `workflow_runs` in `PullSyncRepository.kt` while the
 * desktop's writer was mock-backed — desktop-executed runs never reached
 * the server, so the Android execution feed and the desktop feed showed
 * DIFFERENT histories).
 *
 * Table (migration 0012):
 *   `workflow_runs` — append-only execution log written by the canonical
 *   `workflow-execute` EF. This repository is READ-ONLY (the domain contract
 *   has no run writers) + `retryRun`, which re-executes the underlying
 *   workflow through the WorkflowRepository's canonical EF path (mock
 *   parity: the mock re-executed via the workflow repository too).
 *
 * MAPPING NOTES (documented, shared with supabase-workflow-repository.ts):
 *   1. `trigger_type` enum → coarse domain union (manual_run→manual,
 *      schedule→scheduled, everything else→automatic).
 *   2. status: pending→running, cancelled→failed (the domain union has no
 *      queued/cancelled states — a documented lossy read-side fold).
 *   3. `workflowName` is not a column — resolved via the PostgREST embed
 *      `workflows(name)` on every read.
 *   4. `actor_name` is not a column (actor_id only, no-FK convention) — the
 *      caller's session name is passed through by the consumers; retryRun
 *      stamps the retrying actor.
 *
 * Reactive reads follow the shared Supabase pattern: SubjectBehavior cache +
 * T-034/CROSS-104 freshness policy.
 *
 * Wiring: `getSupabaseRepositories()` (supabase-repositories.ts) overrides
 * the mock `workflowRuns` entry with this class.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  WorkflowRunRepository,
  Observable,
} from "../../../domain/repository/repository";
import type { Result } from "../../../core/result";
import { Ok, Err } from "../../../core/result";
import { Errors } from "../../../core/app-error";
import { SubjectBehavior, derived } from "../../mock/subject-behavior";
import type { WorkflowRun } from "../../../domain/model/workflow";
import { getTenantId } from "./supabase-shared-repositories";
import { CacheFreshness } from "../cache-freshness";
import { mapRunRow } from "./supabase-workflow-repository";

type Row = Record<string, unknown>;

export class SupabaseWorkflowRunRepository implements WorkflowRunRepository {
  private readonly cache = new SubjectBehavior<WorkflowRun[]>([]);
  private readonly freshness = new CacheFreshness();

  constructor(
    private readonly client: SupabaseClient,
    /** The workflow repository — retryRun re-executes through its canonical
     *  EF path (mock parity: the mock re-executed via the workflow repo). */
    private readonly workflows: { execute(id: string, actorId: string, actorName: string): Promise<Result<WorkflowRun>> },
  ) {}

  observe(): Observable<WorkflowRun[]> {
    this.seed();
    return this.cache;
  }

  observeByWorkflow(workflowId: string): Observable<WorkflowRun[]> {
    this.seed();
    return derived([this.cache], () =>
      this.cache.get().filter((r) => r.workflowId === workflowId),
    );
  }

  observeById(id: string): Observable<WorkflowRun | null> {
    this.seed();
    return derived([this.cache], () => this.cache.get().find((r) => r.id === id) ?? null);
  }

  async retryRun(id: string, actorId: string, actorName: string): Promise<Result<WorkflowRun>> {
    const original = this.cache.get().find((r) => r.id === id)
      ?? (await this.fetchRunById(id));
    if (!original) return Err(Errors.notFound("WorkflowRun", id));
    // Re-execute via the canonical path so the published gate, daily cap,
    // cycle detection and audit logging apply identically.
    const result = await this.workflows.execute(original.workflowId, actorId, actorName);
    if (!result.ok) return Err(result.error);
    await this.refresh();
    return Ok(result.value);
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
        .from("workflow_runs")
        .select("*, workflows(name)")
        .eq("tenant_id", getTenantId())
        .order("triggered_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      this.cache.set(
        (data ?? []).map((row: Row) => mapRunRow(row, "system", "Système")),
      );
    } catch {
      // Silently degrade to the current cache.
    }
  }

  private async fetchRunById(id: string): Promise<WorkflowRun | null> {
    const { data, error } = await this.client
      .from("workflow_runs")
      .select("*, workflows(name)")
      .eq("id", id)
      .eq("tenant_id", getTenantId())
      .maybeSingle();
    if (error) return null;
    return data ? mapRunRow(data as Row, "system", "Système") : null;
  }
}
