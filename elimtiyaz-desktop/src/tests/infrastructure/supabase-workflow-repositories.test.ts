/**
 * SupabaseWorkflowRepository + SupabaseWorkflowRunRepository unit tests
 * (T-176 / T-177 — T-047 ports #2a/#2b).
 *
 * Verifies the canonical contract of the workflows ports:
 *   1. createWorkflow() inserts with the deterministic WF- code derivation,
 *      the EF-canonical dag_definition object and status='draft'.
 *   2. updateWorkflow() serializes nodes/edges into dag_definition with the
 *      edge source/target mapping (domain from/to ↔ EF shape) and status
 *      deployed↔published; Kahn cycle detection still rejects cyclic graphs
 *      (mock parity, VAULT §10.09).
 *   3. deleteWorkflow() surfaces the workflow_runs ON DELETE RESTRICT as a
 *      Conflict error advising disable (server semantics, not a silent
 *      hard-delete like the mock).
 *   4. deploy() writes status='published' + last_deployed_at (0071 column)
 *      in ONE update; cyclic graphs are refused.
 *   5. execute() invokes the canonical workflow-execute EF (manual_run
 *      trigger) and maps the run row back (node_results, workflowName via
 *      the PostgREST embed).
 *   6. Read mapping: dag_definition round-trips (string JSON + object),
 *      trigger_type coarse union, last_deployed_at.
 *   7. The run repository: status/trigger folds (manual_run→manual,
 *      schedule→scheduled, pending→running, cancelled→failed), the
 *      workflows(name) join, retryRun delegation to the canonical EF path.
 *   8. Persistence-across-restart: a second repository instance over the
 *      same table data sees the same workflows.
 *   9. Source scans: the wiring overrides both slots.
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseWorkflowRepository } from "../../infrastructure/supabase/repositories/supabase-workflow-repository";
import { SupabaseWorkflowRunRepository } from "../../infrastructure/supabase/repositories/supabase-workflow-run-repository";
import * as fs from "node:fs";
import * as path from "node:path";

// ============================================================================
// Fake Supabase client — minimal PostgREST builder + functions.invoke
// ============================================================================

type Row = Record<string, any>;

class FakeQuery {
  private filters: ((row: Row) => boolean)[] = [];
  private mode: "select" | "insert" | "update" | "delete" = "select";
  private payload: Row | null = null;
  private wantSingle = false;
  private maybeMode = false;
  private orderCol = "";
  private orderAsc = true;
  private limitN: number | null = null;

  constructor(
    private readonly table: Row[],
    /** When set, DELETE fails once with this code (FK restrict simulation). */
    private readonly deleteErrorOnce?: { code: string; message: string },
    private readonly deleteErrorConsumed = { v: false },
  ) {}

  eq(col: string, val: unknown): this {
    this.filters.push((r) => r[col] === val);
    return this;
  }

  is(col: string, val: unknown): this {
    this.filters.push((r) => r[col] === val);
    return this;
  }

  order(col: string, opts?: { ascending?: boolean }): this {
    this.orderCol = col;
    this.orderAsc = opts?.ascending !== false;
    return this;
  }

  limit(n: number): this {
    this.limitN = n;
    return this;
  }

  select(_cols?: string): this {
    return this;
  }

  insert(row: Row): this {
    this.mode = "insert";
    this.payload = row;
    return this;
  }

  update(patch: Row): this {
    this.mode = "update";
    this.payload = patch;
    return this;
  }

  delete(): this {
    this.mode = "delete";
    return this;
  }

  single(): this {
    this.wantSingle = true;
    return this;
  }

  maybeSingle(): this {
    this.wantSingle = true;
    this.maybeMode = true;
    return this;
  }

  private run(): { data: Row | Row[] | null; error: { code?: string; message: string } | null } {
    if (this.mode === "insert") {
      const row = { id: "wf-uuid-new", created_at: "2026-09-05T10:00:00Z", updated_at: "2026-09-05T10:00:00Z", ...this.payload };
      this.table.push(row);
      return { data: row, error: null };
    }
    if (this.mode === "update") {
      const patched: Row[] = [];
      for (const row of this.table) {
        if (this.filters.every((f) => f(row))) {
          Object.assign(row, this.payload ?? {});
          patched.push(row);
        }
      }
      if (this.wantSingle) {
        if (patched.length === 0) return { data: null, error: { message: "no rows (PGRST116)" } };
        return { data: patched[0], error: null };
      }
      return { data: patched, error: null };
    }
    if (this.mode === "delete") {
      if (this.deleteErrorOnce && !this.deleteErrorConsumed.v) {
        this.deleteErrorConsumed.v = true;
        return { data: null, error: this.deleteErrorOnce };
      }
      const remaining = this.table.filter((r) => !this.filters.every((f) => f(r)));
      this.table.length = 0;
      this.table.push(...remaining);
      return { data: null, error: null };
    }
    let rows = this.table.filter((r) => this.filters.every((f) => f(r)));
    if (this.orderCol) {
      rows = [...rows].sort((a, b) => {
        const cmp = String(a[this.orderCol] ?? "").localeCompare(String(b[this.orderCol] ?? ""));
        return this.orderAsc ? cmp : -cmp;
      });
    }
    if (this.limitN !== null) rows = rows.slice(0, this.limitN);
    if (this.wantSingle) {
      if (rows.length === 0) {
        return this.maybeMode ? { data: null, error: null } : { data: null, error: { message: "no rows (PGRST116)" } };
      }
      return { data: rows[0], error: null };
    }
    return { data: rows, error: null };
  }

  then<TResult1>(
    onFulfilled:
      | ((value: { data: Row | Row[] | null; error: { code?: string; message: string } | null }) => TResult1 | PromiseLike<TResult1>)
      | null,
  ): Promise<TResult1> {
    return Promise.resolve(onFulfilled!(this.run() as never));
  }
}

class FakeClient {
  tables: Record<string, Row[]> = {};
  invoked: { name: string; body: Record<string, unknown> }[] = [];
  invokeMocks: Record<string, (body: Record<string, unknown>) => Row> = {};
  deleteRestrictOnce = false;

  from(tableName: string): FakeQuery {
    if (!this.tables[tableName]) this.tables[tableName] = [];
    const restrict = this.deleteRestrictOnce
      ? { code: "23503", message: "update or delete on table violates foreign key constraint" }
      : undefined;
    const consumed = { v: false };
    return new FakeQuery(this.tables[tableName], restrict, consumed);
  }

  functions = {
    invoke: async (name: string, opts: { body: Record<string, unknown> }) => {
      this.invoked.push({ name, body: opts.body });
      const mock = this.invokeMocks[name];
      if (mock) return { data: mock(opts.body), error: null };
      return { data: null, error: { message: `no mock for ${name}` } };
    },
  };
}

const fakeClient = new FakeClient();

// ============================================================================
// Fixtures
// ============================================================================

const TENANT = "00000000-0000-0000-0000-000000000001";
const STAFF = "bbbbbbbb-0000-0000-0000-0000000000b1";

function wfRow(overrides: Partial<Row> = {}): Row {
  return {
    id: "wf-uuid-1",
    tenant_id: TENANT,
    code: "WF-RELANCE-A1B2",
    name: "Relance impayés",
    description: "Relance automatique",
    dag_definition: {
      nodes: [
        { id: "n1", type: "trigger", subtype: "payment_overdue", label: "Déclencheur", position: { x: 0, y: 0 }, config: {} },
        { id: "n2", type: "action", subtype: "send_email", label: "Envoyer email", position: { x: 100, y: 0 }, config: {} },
      ],
      edges: [{ id: "e1", source: "n1", target: "n2" }],
    },
    status: "draft",
    max_daily_executions: 100,
    trigger_type: "automatic",
    created_by: STAFF,
    last_executed_at: null,
    last_deployed_at: null,
    total_executions: 0,
    created_at: "2026-09-01T10:00:00Z",
    updated_at: "2026-09-01T10:00:00Z",
    ...overrides,
  };
}

function runRow(overrides: Partial<Row> = {}): Row {
  return {
    id: "wfr-uuid-1",
    tenant_id: TENANT,
    workflow_id: "wf-uuid-1",
    trigger_type: "manual_run",
    triggered_at: "2026-09-05T12:00:00Z",
    started_at: "2026-09-05T12:00:01Z",
    completed_at: "2026-09-05T12:00:03Z",
    status: "succeeded",
    actor_id: STAFF,
    error_message: null,
    duration_ms: 2000,
    node_results: [
      { node_id: "n1", status: "succeeded", started_at: "2026-09-05T12:00:01Z", completed_at: "2026-09-05T12:00:02Z" },
      { node_id: "n2", status: "succeeded", started_at: "2026-09-05T12:00:02Z", completed_at: "2026-09-05T12:00:03Z" },
    ],
    created_at: "2026-09-05T12:00:03Z",
    workflows: { name: "Relance impayés" },
    ...overrides,
  };
}

async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 10));
}

function makeRepo(): SupabaseWorkflowRepository {
  return new SupabaseWorkflowRepository(fakeClient as unknown as SupabaseClient);
}

function makeRunRepo(workflows: SupabaseWorkflowRepository): SupabaseWorkflowRunRepository {
  return new SupabaseWorkflowRunRepository(fakeClient as unknown as SupabaseClient, workflows);
}

// ============================================================================
// SupabaseWorkflowRepository (T-176)
// ============================================================================

describe("SupabaseWorkflowRepository (T-176)", () => {
  beforeEach(() => {
    fakeClient.tables = {};
    fakeClient.invoked = [];
    fakeClient.invokeMocks = {};
    fakeClient.deleteRestrictOnce = false;
    localStorage.setItem(
      "el-imtiyaz.session",
      JSON.stringify({ tenantId: TENANT, userId: STAFF }),
    );
    return () => localStorage.removeItem("el-imtiyaz.session");
  });

  it("1. createWorkflow() inserts with the EF-canonical dag_definition + derived code", async () => {
    const repo = makeRepo();
    const result = await repo.createWorkflow({
      name: "Relance impayés",
      description: "Relance automatique",
      triggerType: "automatic",
      createdBy: STAFF,
    });
    expect(result.ok).toBe(true);
    const row = fakeClient.tables["workflows"][0];
    expect(row.tenant_id).toBe(TENANT);
    expect(row.code).toMatch(/^WF-RELANCEI-[0-9A-Z]{4}$/);
    expect(row.status).toBe("draft");
    expect(row.max_daily_executions).toBe(100);
    expect(row.trigger_type).toBe("automatic");
    expect(row.created_by).toBe(STAFF);
    expect(row.dag_definition).toEqual({ nodes: [], edges: [] });
  });

  it("2. createWorkflow() rejects an empty name (mock parity)", async () => {
    const repo = makeRepo();
    const result = await repo.createWorkflow({
      name: "   ",
      description: "",
      triggerType: "manual",
      createdBy: STAFF,
    });
    expect(result.ok).toBe(false);
    expect(fakeClient.tables["workflows"] ?? []).toHaveLength(0);
  });

  it("3. updateWorkflow() serializes nodes/edges with the source/target mapping; cycles rejected", async () => {
    fakeClient.tables["workflows"] = [wfRow()];
    const repo = makeRepo();
    const nodes = [
      { id: "a", type: "trigger" as const, subtype: "manual_run" as const, label: "T", position: { x: 0, y: 0 }, config: {} },
      { id: "b", type: "action" as const, subtype: "send_email" as const, label: "A", position: { x: 1, y: 0 }, config: {} },
    ];
    const ok = await repo.updateWorkflow(
      "wf-uuid-1",
      {
        nodes,
        edges: [
          { id: "e1", from: "a", to: "b" },
          { id: "e2", from: "b", to: "a" }, // cycle!
        ],
      },
      STAFF,
    );
    expect(ok.ok).toBe(false); // Kahn cycle detection (VAULT §10.09)

    const saved = await repo.updateWorkflow(
      "wf-uuid-1",
      { nodes, edges: [{ id: "e1", from: "a", to: "b" }] },
      STAFF,
    );
    expect(saved.ok).toBe(true);
    const row = fakeClient.tables["workflows"][0];
    expect(row.dag_definition).toEqual({
      nodes,
      edges: [{ id: "e1", source: "a", target: "b" }], // the EF-canonical shape
    });
    // The mapped result round-trips the domain edge shape.
    expect(saved.ok).toBe(true);
    if (saved.ok) {
      expect([...saved.value.edges]).toEqual([{ id: "e1", from: "a", to: "b" }]);
    }
  });

  it("4. updateWorkflow() maps domain status deployed → DB published", async () => {
    fakeClient.tables["workflows"] = [wfRow()];
    const repo = makeRepo();
    const result = await repo.updateWorkflow("wf-uuid-1", { status: "deployed" }, STAFF);
    expect(result.ok).toBe(true);
    expect(fakeClient.tables["workflows"][0].status).toBe("published");
  });

  it("5. deleteWorkflow() surfaces the runs RESTRICT as a conflict; plain delete works", async () => {
    fakeClient.tables["workflows"] = [wfRow()];
    fakeClient.deleteRestrictOnce = true;
    const repo = makeRepo();
    const restricted = await repo.deleteWorkflow("wf-uuid-1");
    expect(restricted.ok).toBe(false);
    expect(fakeClient.tables["workflows"]).toHaveLength(1); // NOT deleted
    fakeClient.deleteRestrictOnce = false;
    const ok = await repo.deleteWorkflow("wf-uuid-1");
    expect(ok.ok).toBe(true);
    expect(fakeClient.tables["workflows"]).toHaveLength(0);
  });

  it("6. deploy() writes status + last_deployed_at in ONE update; cycle refused", async () => {
    fakeClient.tables["workflows"] = [wfRow()];
    const repo = makeRepo();
    const result = await repo.deploy("wf-uuid-1", STAFF);
    expect(result.ok).toBe(true);
    const row = fakeClient.tables["workflows"][0];
    expect(row.status).toBe("published");
    expect(row.last_deployed_at).toBeTruthy();

    // A cyclic graph cannot be deployed.
    const cyclic = wfRow({
      id: "wf-uuid-2",
      dag_definition: {
        nodes: [
          { id: "a", type: "action", subtype: "send_email", label: "A", position: { x: 0, y: 0 }, config: {} },
          { id: "b", type: "action", subtype: "send_email", label: "B", position: { x: 1, y: 0 }, config: {} },
        ],
        edges: [
          { id: "e1", source: "a", target: "b" },
          { id: "e2", source: "b", target: "a" },
        ],
      },
    });
    fakeClient.tables["workflows"] = [cyclic];
    const refused = await repo.deploy("wf-uuid-2", STAFF);
    expect(refused.ok).toBe(false);
    expect(fakeClient.tables["workflows"][0].status).toBe("draft");
  });

  it("7. execute() invokes the canonical workflow-execute EF and maps the run row back", async () => {
    fakeClient.tables["workflows"] = [wfRow()];
    fakeClient.tables["workflow_runs"] = [];
    fakeClient.invokeMocks["workflow-execute"] = (body) => {
      // The EF writes the run row server-side; simulate it landing.
      fakeClient.tables["workflow_runs"].push(runRow({ workflow_id: String(body.workflow_id) }));
      return { run_id: "wfr-uuid-1", status: "succeeded", duration_ms: 2000, node_count: 2 };
    };
    const repo = makeRepo();
    const result = await repo.execute("wf-uuid-1", STAFF, "Admin");
    expect(result.ok).toBe(true);
    // The EF was called with the canonical body.
    expect(fakeClient.invoked).toHaveLength(1);
    expect(fakeClient.invoked[0].name).toBe("workflow-execute");
    expect(fakeClient.invoked[0].body.workflow_id).toBe("wf-uuid-1");
    expect(fakeClient.invoked[0].body.trigger_type).toBe("manual_run");
    // The run was read back with node results + the workflow name join.
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.nodeResults).toHaveLength(2);
      expect(result.value.workflowName).toBe("Relance impayés");
      expect(result.value.status).toBe("succeeded");
    }
  });

  it("8. read mapping: dag_definition string JSON round-trips; published→deployed; last_deployed_at", async () => {
    fakeClient.tables["workflows"] = [
      wfRow({
        status: "published",
        last_deployed_at: "2026-09-04T09:00:00Z",
        dag_definition: JSON.stringify({
          nodes: [{ id: "n1", type: "trigger", subtype: "schedule", label: "T", position: { x: 0, y: 0 }, config: {} }],
          edges: [],
        }),
      }),
    ];
    const repo = makeRepo();
    const obs = repo.observe();
    await settle();
    const workflows = obs.get();
    expect(workflows).toHaveLength(1);
    expect(workflows[0].status).toBe("deployed");
    expect(workflows[0].lastDeployedAt).toBe("2026-09-04T09:00:00Z");
    expect(workflows[0].nodes).toHaveLength(1);
    expect(workflows[0].nodes[0].subtype).toBe("schedule");
    expect(workflows[0].edges).toEqual([]);
  });

  it("9. persistence-across-restart: a second instance reads the same table", async () => {
    fakeClient.tables["workflows"] = [wfRow()];
    const first = makeRepo();
    const created = await first.createWorkflow({
      name: "Workflow persisté",
      description: "",
      triggerType: "manual",
      createdBy: STAFF,
    });
    expect(created.ok).toBe(true);
    const second = makeRepo();
    const obs = second.observe();
    await settle();
    expect(obs.get()).toHaveLength(2);
    expect(obs.get().some((w) => w.name === "Workflow persisté")).toBe(true);
  });
});

// ============================================================================
// SupabaseWorkflowRunRepository (T-177)
// ============================================================================

describe("SupabaseWorkflowRunRepository (T-177)", () => {
  beforeEach(() => {
    fakeClient.tables = {};
    fakeClient.invoked = [];
    fakeClient.invokeMocks = {};
    fakeClient.deleteRestrictOnce = false;
    localStorage.setItem(
      "el-imtiyaz.session",
      JSON.stringify({ tenantId: TENANT, userId: STAFF }),
    );
    return () => localStorage.removeItem("el-imtiyaz.session");
  });

  it("10. observe() maps trigger + status folds and the workflowName join", async () => {
    fakeClient.tables["workflow_runs"] = [
      runRow(),
      runRow({ id: "wfr-uuid-2", trigger_type: "schedule", status: "pending", started_at: null, completed_at: null }),
      runRow({ id: "wfr-uuid-3", trigger_type: "payment_overdue", status: "cancelled", error_message: null }),
    ];
    const repo = makeRunRepo(makeRepo());
    const obs = repo.observe();
    await settle();
    const runs = obs.get();
    expect(runs).toHaveLength(3);
    const byId = new Map(runs.map((r) => [r.id, r]));
    expect(byId.get("wfr-uuid-1")!.triggerType).toBe("manual");
    expect(byId.get("wfr-uuid-1")!.status).toBe("succeeded");
    expect(byId.get("wfr-uuid-1")!.workflowName).toBe("Relance impayés");
    expect(byId.get("wfr-uuid-1")!.nodeResults[0].nodeId).toBe("n1");
    expect(byId.get("wfr-uuid-2")!.triggerType).toBe("scheduled");
    expect(byId.get("wfr-uuid-2")!.status).toBe("running"); // pending folds to running
    expect(byId.get("wfr-uuid-3")!.triggerType).toBe("automatic");
    expect(byId.get("wfr-uuid-3")!.status).toBe("failed"); // cancelled folds to failed
  });

  it("11. observeByWorkflow() filters by workflow id", async () => {
    fakeClient.tables["workflow_runs"] = [
      runRow(),
      runRow({ id: "wfr-uuid-2", workflow_id: "wf-uuid-2" }),
    ];
    const repo = makeRunRepo(makeRepo());
    const obs = repo.observeByWorkflow("wf-uuid-2");
    await settle();
    expect(obs.get()).toHaveLength(1);
    expect(obs.get()[0].id).toBe("wfr-uuid-2");
  });

  it("12. retryRun() 404s on an unknown run; delegates to the canonical EF path", async () => {
    fakeClient.tables["workflow_runs"] = [runRow()];
    const workflows = makeRepo();
    let executeCalls = 0;
    const runRepo = new SupabaseWorkflowRunRepository(
      fakeClient as unknown as SupabaseClient,
      {
        execute: async (id: string, actorId: string) => {
          executeCalls += 1;
          return {
            ok: true as const,
            value: {
              id: "wfr-uuid-new",
              tenantId: TENANT,
              workflowId: id,
              workflowName: "Relance impayés",
              triggerType: "manual",
              status: "succeeded",
              startedAt: "2026-09-05T13:00:00Z",
              completedAt: "2026-09-05T13:00:02Z",
              durationMs: 2000,
              actorId,
              actorName: "Admin",
              nodeResults: [],
            },
          };
        },
      },
    );
    const missing = await runRepo.retryRun("nope", STAFF, "Admin");
    expect(missing.ok).toBe(false);

    const retried = await runRepo.retryRun("wfr-uuid-1", STAFF, "Admin");
    expect(retried.ok).toBe(true);
    expect(executeCalls).toBe(1);
    if (retried.ok) {
      expect(retried.value.id).toBe("wfr-uuid-new");
    }
  });

  it("13. source scan: supabase-repositories.ts wires BOTH slots (T-047 #2a/#2b)", () => {
    const wiring = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../infrastructure/supabase/supabase-repositories.ts",
      ),
      "utf-8",
    );
    expect(wiring).toContain("import { SupabaseWorkflowRepository }");
    expect(wiring).toContain("import { SupabaseWorkflowRunRepository }");
    expect(wiring).toMatch(/const workflows = new SupabaseWorkflowRepository\(client\)/);
    expect(wiring).toMatch(/const workflowRuns = new SupabaseWorkflowRunRepository\(client, workflows\)/);
    expect(wiring).toMatch(/^ {4}workflows,/m);
    expect(wiring).toMatch(/^ {4}workflowRuns,/m);
  });
});
