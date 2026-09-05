/**
 * SupabaseTaskRepository unit tests (T-180 — T-047 port #5).
 *
 * Verifies the canonical contract of the tasks port:
 *   1. createTask() inserts with status assigned/pending (mock parity),
 *      tags, the jsonb assignee array and the 0074 created_by_name.
 *   2. createTask() validation: empty title and mock-era non-UUID assignee
 *      ids are rejected BEFORE the round-trip.
 *   3. updateTaskStatus(): completed stamps completed_at + progress 100;
 *      in_progress bumps a 0 progress to 10 (mock parity).
 *   4. reassign() writes assignee_ids + the assigned/pending status fold.
 *   5. addComment() inserts into task_comments with the 0074 author_name
 *      and returns the mapped comment.
 *   6. addAttachment() inserts the metadata row (storage_path = the
 *      contract's url) and the aggregate re-reads it.
 *   7. deleteTask() hard-deletes (mock parity).
 *   8. Read mapping: status/priority verbatim, assignee_ids jsonb,
 *      comments ordered by created_at, attachments by uploaded_at,
 *      null-folding to the domain defaults.
 *   9. observeByAssignee / observeByDepartment / observeById derive from the
 *      shared reactive cache.
 *  10. Persistence-across-restart: a second instance sees the same rows.
 *  11. Source scans: the wiring overrides the tasks slot; migration 0074
 *      exists with both display-name columns.
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseTaskRepository } from "../../infrastructure/supabase/repositories/supabase-task-repository";
import * as fs from "node:fs";
import * as path from "node:path";

// ============================================================================
// Fake Supabase client — minimal PostgREST builder (t-099/t-145 convention)
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

  constructor(private readonly table: Row[]) {}

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
      const row = {
        id: `${this.tableName()}-uuid-new`,
        created_at: "2026-09-05T10:00:00Z",
        updated_at: "2026-09-05T10:00:00Z",
        ...this.payload,
      };
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
    // PostgREST embed simulation: selecting tasks joins its comments +
    // attachments (the repository's SELECT "*, task_comments(*), task_attachments(*)").
    if (this.table === fakeClient.tables["tasks"] && this.mode === "select") {
      rows = rows.map((r) => ({
        ...r,
        task_comments: (fakeClient.tables["task_comments"] ?? []).filter((c) => c["task_id"] === r["id"]),
        task_attachments: (fakeClient.tables["task_attachments"] ?? []).filter((a) => a["task_id"] === r["id"]),
      }));
    }
    if (this.wantSingle) {
      if (rows.length === 0) {
        return this.maybeMode ? { data: null, error: null } : { data: null, error: { message: "no rows (PGRST116)" } };
      }
      return { data: rows[0], error: null };
    }
    return { data: rows, error: null };
  }

  private tableName(): string {
    // Derive a per-table id prefix so inserted ids stay unique per table.
    for (const t of ["tasks", "task_comments", "task_attachments"]) {
      if (this.table === (fakeClient.tables[t] ?? [])) return t;
    }
    return "row";
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

  from(tableName: string): FakeQuery {
    if (!this.tables[tableName]) this.tables[tableName] = [];
    return new FakeQuery(this.tables[tableName]);
  }
}

const fakeClient = new FakeClient();

// ============================================================================
// Fixtures
// ============================================================================

const TENANT = "00000000-0000-0000-0000-000000000001";
const WORKER = "bbbbbbbb-0000-0000-0000-0000000000b1";
const WORKER2 = "bbbbbbbb-0000-0000-0000-0000000000b2";
const MANAGER = "cccccccc-0000-0000-0000-0000000000c1";

function taskRow(overrides: Partial<Row> = {}): Row {
  return {
    id: "task-uuid-1",
    tenant_id: TENANT,
    title: "Préparer la rentrée",
    description: "Commander les fournitures",
    status: "in_progress",
    priority: "high",
    department_id: null,
    assignee_ids: [WORKER],
    due_date: "2026-09-15",
    completed_at: null,
    progress: 10,
    tags: ["rentrée"],
    created_by: MANAGER,
    created_by_name: "Amina Cherif",
    created_at: "2026-09-01T10:00:00Z",
    updated_at: "2026-09-02T10:00:00Z",
    ...overrides,
  };
}

/** Seed the fake comment/attachment tables for task-uuid-1 (the PostgREST
 *  embed simulation joins them on read). */
function seedTaskChildren(): void {
  fakeClient.tables["task_comments"] = [
    { id: "cmt-uuid-1", tenant_id: TENANT, task_id: "task-uuid-1", author_id: WORKER, author_name: "Karim Benali", body: "En cours", created_at: "2026-09-02T09:00:00Z", updated_at: "2026-09-02T09:00:00Z" },
    { id: "cmt-uuid-0", tenant_id: TENANT, task_id: "task-uuid-1", author_id: MANAGER, author_name: "Amina Cherif", body: "Priorité haute", created_at: "2026-09-01T11:00:00Z", updated_at: "2026-09-01T11:00:00Z" },
  ];
  fakeClient.tables["task_attachments"] = [
    { id: "att-uuid-1", tenant_id: TENANT, task_id: "task-uuid-1", file_name: "liste.pdf", storage_path: "task-attachments/task-1/liste.pdf", mime_type: "application/pdf", size_bytes: 2048, uploaded_by: MANAGER, uploaded_at: "2026-09-01T10:05:00Z", created_at: "2026-09-01T10:05:00Z" },
  ];
}

function makeRepo(): SupabaseTaskRepository {
  return new SupabaseTaskRepository(fakeClient as unknown as SupabaseClient);
}

beforeEach(() => {
  fakeClient.tables = {};
  localStorage.setItem(
    "el-imtiyaz.session",
    JSON.stringify({ tenantId: TENANT, userId: MANAGER }),
  );
  return () => localStorage.removeItem("el-imtiyaz.session");
});

// ============================================================================
// Tests
// ============================================================================

describe("SupabaseTaskRepository (T-180)", () => {
  it("1. createTask() inserts with assigned/pending fold, tags, jsonb assignees + 0074 name", async () => {
    const repo = makeRepo();
    const result = await repo.createTask({
      title: "Inventaire stock",
      description: "Compter les manuels",
      priority: "medium",
      departmentId: null,
      assigneeIds: [WORKER, WORKER2],
      dueDate: "2026-09-20",
      createdBy: MANAGER,
      createdByName: "Amina Cherif",
      tags: ["stock"],
    });
    expect(result.ok).toBe(true);
    const row = fakeClient.tables["tasks"][0];
    expect(row["status"]).toBe("assigned");
    expect(row["priority"]).toBe("medium");
    expect(row["assignee_ids"]).toEqual([WORKER, WORKER2]);
    expect(row["tags"]).toEqual(["stock"]);
    expect(row["created_by"]).toBe(MANAGER);
    expect(row["created_by_name"]).toBe("Amina Cherif");
    expect(row["due_date"]).toBe("2026-09-20");
    expect(row["progress"]).toBe(0);

    const unassigned = await repo.createTask({
      title: "Sans assigné",
      description: "",
      priority: "low",
      departmentId: null,
      assigneeIds: [],
      dueDate: null,
      createdBy: MANAGER,
      createdByName: "Amina Cherif",
    });
    expect(unassigned.ok).toBe(true);
    expect(fakeClient.tables["tasks"][1]["status"]).toBe("pending");
  });

  it("2. createTask() validation: empty title + mock-era assignee ids rejected pre-round-trip", async () => {
    const repo = makeRepo();
    const noTitle = await repo.createTask({
      title: "   ",
      description: "",
      priority: "low",
      departmentId: null,
      assigneeIds: [],
      dueDate: null,
      createdBy: MANAGER,
      createdByName: "A",
    });
    expect(noTitle.ok).toBe(false);
    if (!noTitle.ok) expect(noTitle.error.code).toBe("ERR_VALIDATION");

    const badId = await repo.createTask({
      title: "Ok",
      description: "",
      priority: "low",
      departmentId: null,
      assigneeIds: ["per-001"],
      dueDate: null,
      createdBy: MANAGER,
      createdByName: "A",
    });
    expect(badId.ok).toBe(false);
    if (!badId.ok) expect(badId.error.code).toBe("ERR_VALIDATION");
    expect(fakeClient.tables["tasks"] ?? []).toHaveLength(0);
  });

  it("3. updateTaskStatus(): completed stamps completed_at + progress 100; in_progress bumps 0→10", async () => {
    fakeClient.tables["tasks"] = [taskRow({ status: "in_progress", progress: 10, completed_at: null })];
    const repo = makeRepo();
    const done = await repo.updateTaskStatus("task-uuid-1", "completed", WORKER);
    expect(done.ok).toBe(true);
    const row = fakeClient.tables["tasks"][0];
    expect(row["status"]).toBe("completed");
    expect(row["completed_at"]).toBeTruthy();
    expect(row["progress"]).toBe(100);
    if (done.ok) {
      expect(done.value.completedAt).toBeTruthy();
      expect(done.value.progress).toBe(100);
    }

    // in_progress from progress 0 → 10.
    fakeClient.tables["tasks"] = [taskRow({ status: "pending", progress: 0 })];
    const started = await repo.updateTaskStatus("task-uuid-1", "in_progress", WORKER);
    expect(started.ok).toBe(true);
    expect(fakeClient.tables["tasks"][0]["progress"]).toBe(10);
  });

  it("4. reassign() writes assignee_ids + the assigned/pending fold", async () => {
    fakeClient.tables["tasks"] = [taskRow({ status: "pending", assignee_ids: [] })];
    const repo = makeRepo();
    const res = await repo.reassign("task-uuid-1", [WORKER], MANAGER);
    expect(res.ok).toBe(true);
    const row = fakeClient.tables["tasks"][0];
    expect(row["assignee_ids"]).toEqual([WORKER]);
    expect(row["status"]).toBe("assigned");

    const cleared = await repo.reassign("task-uuid-1", [], MANAGER);
    expect(cleared.ok).toBe(true);
    expect(fakeClient.tables["tasks"][0]["status"]).toBe("pending");
    expect(fakeClient.tables["tasks"][0]["assignee_ids"]).toEqual([]);
  });

  it("5. addComment() inserts into task_comments with the 0074 author_name", async () => {
    fakeClient.tables["tasks"] = [taskRow()];
    fakeClient.tables["task_comments"] = [];
    const repo = makeRepo();
    const res = await repo.addComment("task-uuid-1", {
      authorId: WORKER,
      authorName: "Karim Benali",
      body: "  Terminé ce matin  ",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.body).toBe("Terminé ce matin");
    expect(res.value.authorName).toBe("Karim Benali");
    expect(res.value.taskId).toBe("task-uuid-1");
    const row = fakeClient.tables["task_comments"][0];
    expect(row["author_id"]).toBe(WORKER);
    expect(row["author_name"]).toBe("Karim Benali");
    expect(row["task_id"]).toBe("task-uuid-1");

    // Empty body rejected.
    const empty = await repo.addComment("task-uuid-1", { authorId: WORKER, authorName: "K", body: "   " });
    expect(empty.ok).toBe(false);
  });

  it("6. addAttachment() inserts the metadata row and the aggregate re-reads it", async () => {
    fakeClient.tables["tasks"] = [taskRow()];
    fakeClient.tables["task_attachments"] = [];
    const repo = makeRepo();
    const res = await repo.addAttachment("task-uuid-1", {
      id: "att-local-1",
      filename: "bon_commande.pdf",
      mimeType: "application/pdf",
      sizeBytes: 4096,
      url: "task-attachments/task-1/bon.pdf",
    });
    expect(res.ok).toBe(true);
    const row = fakeClient.tables["task_attachments"][0];
    expect(row["file_name"]).toBe("bon_commande.pdf");
    expect(row["storage_path"]).toBe("task-attachments/task-1/bon.pdf");
    expect(row["size_bytes"]).toBe(4096);
    if (res.ok) {
      expect(res.value.attachments).toHaveLength(1);
      expect(res.value.attachments[0].filename).toBe("bon_commande.pdf");
    }
  });

  it("7. deleteTask() hard-deletes (comments/attachments cascade server-side)", async () => {
    fakeClient.tables["tasks"] = [taskRow()];
    const repo = makeRepo();
    const res = await repo.deleteTask("task-uuid-1");
    expect(res.ok).toBe(true);
    expect(fakeClient.tables["tasks"]).toHaveLength(0);
  });

  it("8. read mapping: verbatim enums, jsonb assignees, comment/attachment order, null folds", async () => {
    fakeClient.tables["tasks"] = [
      taskRow({ description: null, tags: null, assignee_ids: null, due_date: null, created_by: null, created_by_name: null }),
    ];
    // No children tables seeded → embeds resolve empty.
    const repo = makeRepo();
    const obs = repo.observe();
    await new Promise((r) => setTimeout(r, 20));
    const t = obs.get()[0];
    expect(t.status).toBe("in_progress");
    expect(t.priority).toBe("high");
    expect(t.description).toBe("");
    expect(t.tags).toEqual([]);
    expect(t.assigneeIds).toEqual([]);
    expect(t.dueDate).toBeNull();
    expect(t.createdBy).toBe("system");
    expect(t.createdByName).toBe("");
    expect(t.comments).toEqual([]);
    expect(t.attachments).toEqual([]);

    // Ordered case (children seeded — the embed joins them).
    fakeClient.tables["tasks"] = [taskRow()];
    seedTaskChildren();
    const repo2 = makeRepo();
    const obs2 = repo2.observe();
    await new Promise((r) => setTimeout(r, 20));
    const t2 = obs2.get()[0];
    expect(t2.comments.map((c) => c.id)).toEqual(["cmt-uuid-0", "cmt-uuid-1"]); // created_at asc
    expect(t2.attachments.map((a) => a.filename)).toEqual(["liste.pdf"]);
    expect(t2.assigneeIds).toEqual([WORKER]);
    expect(t2.createdByName).toBe("Amina Cherif");
  });

  it("9. observeByAssignee / observeByDepartment / observeById derive from the cache", async () => {
    fakeClient.tables["tasks"] = [
      taskRow(),
      taskRow({ id: "task-uuid-2", assignee_ids: [WORKER2], department_id: "dept-uuid-1", status: "pending" }),
    ];
    const repo = makeRepo();
    const obs = repo.observe();
    await new Promise((r) => setTimeout(r, 20));
    const mine = repo.observeByAssignee(WORKER);
    const dept = repo.observeByDepartment("dept-uuid-1");
    const one = repo.observeById("task-uuid-2");
    expect(mine.get().map((t) => t.id)).toEqual(["task-uuid-1"]);
    expect(dept.get().map((t) => t.id)).toEqual(["task-uuid-2"]);
    expect(one.get()?.id).toBe("task-uuid-2");
    expect(obs.get()).toHaveLength(2);
  });

  it("10. persistence-across-restart: a second instance sees the same rows", async () => {
    fakeClient.tables["tasks"] = [taskRow()];
    seedTaskChildren();
    const repo1 = makeRepo();
    const obs1 = repo1.observe();
    await new Promise((r) => setTimeout(r, 20));
    const repo2 = makeRepo();
    const obs2 = repo2.observe();
    await new Promise((r) => setTimeout(r, 20));
    expect(obs1.get()).toHaveLength(1);
    expect(obs2.get()[0].id).toBe("task-uuid-1");
    expect(obs2.get()[0].comments).toHaveLength(2);
  });

  it("11a. source scan: the wiring overrides the tasks slot", () => {
    const wiring = fs.readFileSync(
      path.resolve(__dirname, "../../infrastructure/supabase/supabase-repositories.ts"),
      "utf8",
    );
    expect(wiring).toContain("SupabaseTaskRepository");
    expect(wiring).toMatch(/tasks,\s*\/\/ T-180/);
  });

  it("11b. source scan: migration 0074 adds BOTH display-name columns + registration", () => {
    const mig = fs.readFileSync(
      path.resolve(__dirname, "../../../supabase/migrations/0074_tasks_display_names.sql"),
      "utf8",
    );
    expect(mig).toContain("add column if not exists created_by_name text");
    expect(mig).toContain("add column if not exists author_name text");
    expect(mig).toContain("on conflict (version) do nothing");
  });
});
