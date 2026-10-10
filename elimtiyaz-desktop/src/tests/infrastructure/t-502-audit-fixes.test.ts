/**
 * T-502 — the four audit-fix regression pins (153rd session, 2026-10-11).
 *
 * Covers the T-500→T-502 remediation round's client-side fixes:
 *
 *   AUDIT-505 — the personnel-family audit mirror: the mock layer's action
 *   vocabulary now routes through the 0014 write_audit_log RPC after every
 *   successful family mutation (task.create / task.status_change /
 *   task.comment / task.delete pinned BEHAVIORALLY here; the other repos'
 *   wiring pinned by source scans — the t-345 convention).
 *
 *   GRADE-103 — the narrative persistence: SupabaseStudentNarrativeRepository
 *   round-trip (the 0148 upsert shape + read-back) + the mock twin + the
 *   modal wiring source-scan (approve PERSISTS before the audit row).
 *
 *   ACAD-514 — the subject-config byKey is YEAR-SCOPED (source-scan pin:
 *   the key carries academicYearId and the map skips non-active years).
 *
 *   ACAD-510 — the classes.notes column (0149): createClass sends notes,
 *   updateClass maps it (payload-capture pins).
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as fs from "node:fs";
import * as path from "node:path";
import { SupabaseTaskRepository } from "../../infrastructure/supabase/repositories/supabase-task-repository";
import { SupabaseStudentNarrativeRepository } from "../../infrastructure/supabase/repositories/supabase-student-narrative-repository";
import { mockStudentNarrativeRepository } from "../../infrastructure/mock/repositories/student-narrative-repository";

// ============================================================================
// Fake Supabase client — PostgREST builder + the RPC recorder
// ============================================================================

type Row = Record<string, any>;
interface RpcCall {
  fn: string;
  args: Row;
}

class FakeQuery {
  private filters: ((row: Row) => boolean)[] = [];
  private mode: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  private payload: Row | null = null;
  private rows: Row[] = [];

  constructor(
    private readonly client: FakeClient,
    private readonly table: string,
  ) {
    this.rows = client.tables[table] ?? (client.tables[table] = []);
  }

  eq(col: string, val: unknown): this {
    this.filters.push((r) => r[col] === val);
    return this;
  }
  is(col: string, val: unknown): this {
    this.filters.push((r) => r[col] === val);
    return this;
  }
  order(): this {
    return this;
  }
  limit(): this {
    return this;
  }
  select(): this {
    return this;
  }
  upsert(payload: Row, _opts?: { onConflict?: string }): this {
    this.mode = "upsert";
    this.payload = payload;
    // capture semantics: the upserted row lands in the table immediately
    this.rows.push({ id: "row-uuid-1", ...payload });
    return this;
  }
  insert(payload: Row): this {
    this.mode = "insert";
    this.payload = payload;
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
  maybeSingle(): Promise<{ data: Row | null; error: null }> {
    return this.single();
  }
  single(): Promise<{ data: Row | null; error: null }> {
    const matched = this.rows.filter((r) => this.filters.every((f) => f(r)));
    let data: Row | null = null;
    if (this.mode === "insert" || this.mode === "update" || this.mode === "upsert") {
      data = { id: "row-uuid-1", ...(this.payload ?? {}) };
      if (this.mode === "update" && matched[0]) {
        Object.assign(matched[0], this.payload);
        data = matched[0];
      }
    } else if (this.mode === "select") {
      data = matched[0] ?? null;
    } else if (this.mode === "delete") {
      if (matched.length > 0) {
        this.rows.splice(this.rows.indexOf(matched[0]), 1);
      }
      data = matched[0] ?? null;
    }
    return Promise.resolve({ data, error: null });
  }
  then(
    resolve: (v: { data: Row[] | null; error: null }) => void,
    reject?: (e: unknown) => void,
  ): Promise<void> {
    const matched = this.rows.filter((r) => this.filters.every((f) => f(r)));
    if (this.mode === "insert" && this.payload) {
      const row = { id: "row-uuid-1", ...this.payload };
      this.rows.push(row);
      return Promise.resolve(resolve({ data: [row], error: null })).catch(reject as never);
    }
    if (this.mode === "update" && this.payload) {
      for (const r of matched) Object.assign(r, this.payload);
      return Promise.resolve(resolve({ data: matched, error: null })).catch(reject as never);
    }
    if (this.mode === "delete") {
      for (const r of matched) this.rows.splice(this.rows.indexOf(r), 1);
      return Promise.resolve(resolve({ data: matched, error: null })).catch(reject as never);
    }
    return Promise.resolve(resolve({ data: matched, error: null })).catch(reject as never);
  }
}

class FakeClient {
  tables: Record<string, Row[]> = {};
  rpcCalls: RpcCall[] = [];

  from(table: string): FakeQuery {
    return new FakeQuery(this, table);
  }

  rpc(fn: string, args: Row): Promise<{ data: unknown; error: null }> {
    this.rpcCalls.push({ fn, args });
    return Promise.resolve({ data: "audit-row-uuid", error: null });
  }
}

// ============================================================================
// Fixtures
// ============================================================================

const TENANT = "00000000-0000-0000-0000-000000000001";
const MANAGER = "cccccccc-0000-0000-0000-0000000000c1";
const STUDENT = "dddddddd-0000-0000-0000-0000000000d1";

let fakeClient: FakeClient;

function seedSession(): void {
  localStorage.setItem(
    "el-imtiyaz.session",
    JSON.stringify({ tenantId: TENANT, userId: MANAGER, displayName: "Amina Cherif" }),
  );
}

beforeEach(() => {
  fakeClient = new FakeClient();
  seedSession();
  return () => localStorage.removeItem("el-imtiyaz.session");
});

function auditCalls(action: string): RpcCall[] {
  return fakeClient.rpcCalls.filter(
    (c) => c.fn === "write_audit_log" && c.args.p_action === action,
  );
}

// ============================================================================
// AUDIT-505 — the audit mirror (behavioral pins on the task surface)
// ============================================================================

describe("T-502 / AUDIT-505 — the personnel-family audit mirror", () => {
  it("1. createTask writes a task.create audit row through the 0014 RPC", async () => {
    const repo = new SupabaseTaskRepository(fakeClient as unknown as SupabaseClient);
    const result = await repo.createTask({
      title: "Inventaire stock",
      description: "Compter les manuels",
      priority: "high",
      departmentId: null,
      assigneeIds: [],
      dueDate: null,
      createdBy: MANAGER,
      createdByName: "Amina Cherif",
    });
    expect(result.ok).toBe(true);
    const calls = auditCalls("task.create");
    expect(calls).toHaveLength(1);
    expect(calls[0].args.p_tenant_id).toBe(TENANT);
    expect(calls[0].args.p_entity_type).toBe("task");
    expect(calls[0].args.p_actor_id).toBe(MANAGER);
    expect(calls[0].args.p_actor_name).toBe("Amina Cherif");
  });

  it("2. updateTaskStatus writes task.status_change (NOT the generic task.update)", async () => {
    fakeClient.tables["tasks"] = [
      {
        id: "task-uuid-1",
        tenant_id: TENANT,
        title: "Préparer la rentrée",
        description: null,
        status: "in_progress",
        priority: "high",
        department_id: null,
        assignee_ids: [],
        due_date: null,
        completed_at: null,
        progress: 10,
        tags: [],
        created_by: MANAGER,
        created_by_name: "Amina Cherif",
        created_at: "2026-09-01T10:00:00Z",
        updated_at: "2026-09-02T10:00:00Z",
      },
    ];
    fakeClient.tables["task_comments"] = [];
    fakeClient.tables["task_attachments"] = [];
    const repo = new SupabaseTaskRepository(fakeClient as unknown as SupabaseClient);
    const result = await repo.updateTaskStatus("task-uuid-1", "completed", MANAGER);
    expect(result.ok).toBe(true);
    expect(auditCalls("task.status_change")).toHaveLength(1);
    expect(auditCalls("task.status_change")[0].args.p_note).toBe("completed");
    // the generic task.update must NOT also fire for the semantic wrapper
    expect(auditCalls("task.update")).toHaveLength(0);
  });

  it("3. addComment writes task.comment with the author identity", async () => {
    fakeClient.tables["tasks"] = [];
    const repo = new SupabaseTaskRepository(fakeClient as unknown as SupabaseClient);
    const result = await repo.addComment("task-uuid-9", {
      authorId: MANAGER,
      authorName: "Amina Cherif",
      body: "Bien vu",
    });
    expect(result.ok).toBe(true);
    const calls = auditCalls("task.comment");
    expect(calls).toHaveLength(1);
    expect(calls[0].args.p_actor_id).toBe(MANAGER);
    expect(calls[0].args.p_note ?? null).toBeNull();
  });

  it("4. a FAILED mutation writes NO audit row (a 0-row delete is an Err)", async () => {
    fakeClient.tables["tasks"] = [];
    const repo = new SupabaseTaskRepository(fakeClient as unknown as SupabaseClient);
    // RLS default-deny shape: the table has no matching row → zero deleted
    const result = await repo.deleteTask("task-uuid-nonexistent");
    expect(result.ok).toBe(false);
    expect(auditCalls("task.delete")).toHaveLength(0);
  });

  it("5. source scans: every family repo wires the mirror (the t-345 convention)", () => {
    const root = path.resolve(__dirname, "../../infrastructure/supabase/repositories");
    const expectations: Array<[string, RegExp]> = [
      ["supabase-personnel-repository.ts", /action: "personnel\.create"/],
      ["supabase-personnel-repository.ts", /action: "personnel\.update"/],
      ["supabase-personnel-repository.ts", /action: "personnel\.deactivate"/],
      ["supabase-personnel-repository.ts", /action: "department\.create"/],
      ["supabase-personnel-repository.ts", /action: "department\.update"/],
      ["supabase-personnel-repository.ts", /action: "department\.delete"/],
      ["supabase-task-repository.ts", /action: "task\.create"/],
      ["supabase-task-repository.ts", /action: "task\.status_change"/],
      ["supabase-task-repository.ts", /task\.review_approved/],
      ["supabase-task-repository.ts", /action: "task\.reassign"/],
      ["supabase-task-repository.ts", /action: "task\.comment"/],
      ["supabase-task-repository.ts", /action: "task\.delete"/],
      ["supabase-leave-request-repository.ts", /action: "leave\.submit"/],
      ["supabase-leave-request-repository.ts", /action: "leave\.decide"/],
      ["supabase-leave-request-repository.ts", /action: "leave\.clarification_requested"/],
      ["supabase-leave-request-repository.ts", /action: "leave\.clarification_responded"/],
      ["supabase-workforce-attendance-repository.ts", /action: "attendance\.record"/],
      ["supabase-workforce-attendance-repository.ts", /action: "absence\.justification_requested"/],
      ["supabase-workforce-attendance-repository.ts", /action: "absence\.justification_submitted"/],
      ["supabase-workforce-attendance-repository.ts", /action: "absence\.justification_reviewed"/],
      ["supabase-onboarding-repository.ts", /action: "onboarding\.start"/],
      ["supabase-onboarding-repository.ts", /action: "onboarding\.complete"/],
      ["supabase-onboarding-repository.ts", /action: "onboarding\.reset"/],
      ["supabase-shift-schedule-repositories.ts", /action: "shift\.create"/],
      ["supabase-shift-schedule-repositories.ts", /action: "schedule\.delete"/],
    ];
    for (const [file, pattern] of expectations) {
      const src = fs.readFileSync(path.join(root, file), "utf8");
      expect(src, `${file} must match ${pattern}`).toMatch(pattern);
    }
  });
});

// ============================================================================
// GRADE-103 — the narrative persistence (0148)
// ============================================================================

describe("T-502 / GRADE-103 — the student narrative store", () => {
  it("1. saveNarrative upserts on the 0148 unique with the year key", async () => {
    const repo = new SupabaseStudentNarrativeRepository(fakeClient as unknown as SupabaseClient);
    const result = await repo.saveNarrative({
      studentId: STUDENT,
      academicYear: "2026-2027",
      narrative: "Un élève engagé…",
      approvedBy: MANAGER,
      approvedByName: "Amina Cherif",
    });
    expect(result.ok).toBe(true);
    // the upsert table + the year-keyed payload
    const rows = fakeClient.tables["student_narratives"];
    expect(rows).toBeDefined();
    expect(rows![0]).toMatchObject({
      tenant_id: TENANT,
      student_id: STUDENT,
      academic_year: "2026-2027",
      narrative: "Un élève engagé…",
      approved_by: MANAGER,
      approved_by_name: "Amina Cherif",
    });
  });

  it("2. saveNarrative rejects a mock-era student id BEFORE the round-trip", async () => {
    const repo = new SupabaseStudentNarrativeRepository(fakeClient as unknown as SupabaseClient);
    const result = await repo.saveNarrative({
      studentId: "elv-000123",
      academicYear: "2026-2027",
      narrative: "x",
      approvedBy: MANAGER,
      approvedByName: "Amina Cherif",
    });
    expect(result.ok).toBe(false);
    expect(fakeClient.tables["student_narratives"]).toBeUndefined();
  });

  it("3. the mock twin round-trips (the parity target)", async () => {
    const saved = await mockStudentNarrativeRepository.saveNarrative({
      studentId: STUDENT,
      academicYear: "2026-2027",
      narrative: "Mock narrative",
      approvedBy: MANAGER,
      approvedByName: "Amina Cherif",
    });
    expect(saved.ok).toBe(true);
    const read = await mockStudentNarrativeRepository.getNarrative(STUDENT, "2026-2027");
    expect(read.ok).toBe(true);
    expect(read.ok ? read.value : null).toBe("Mock narrative");
    const otherYear = await mockStudentNarrativeRepository.getNarrative(STUDENT, "2027-2028");
    expect(otherYear.ok).toBe(true);
    expect(otherYear.ok ? otherYear.value : null).toBeNull();
  });

  it("4. source scan: the modal's approve PERSISTS before the audit row + toast", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../features/academics/narrative-generator-modal.tsx"),
      "utf8",
    );
    expect(src).toMatch(/studentNarratives\.saveNarrative/);
    const saveIdx = src.indexOf("studentNarratives.saveNarrative");
    const auditIdx = src.indexOf("AuditActions.AiNarrativeApproved");
    expect(saveIdx).toBeGreaterThan(-1);
    expect(auditIdx).toBeGreaterThan(-1);
    expect(saveIdx).toBeLessThan(auditIdx);
    // the failure branch RETURNS EARLY (the modal stays open — no fake success)
    expect(src).toMatch(/if \(!saved\.ok\) \{[\s\S]{0,400}?return;/);
  });
});

// ============================================================================
// ACAD-514 — the year-scoped byKey (source-scan pin)
// ============================================================================

describe("T-502 / ACAD-514 — the subject-config year scoping", () => {
  it("1. source scan: byKey carries academicYearId AND skips non-active years", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../features/academics/subject-configurations-panel.tsx"),
      "utf8",
    );
    expect(src).toMatch(
      /if \(c\.academicYearId !== currentYear\.id\) continue;/,
    );
    expect(src).toMatch(
      /m\.set\(`\$\{c\.subjectId\}\|\$\{c\.academicLevelId\}\|\$\{c\.academicYearId\}`/,
    );
    expect(src).toMatch(/byKey\.get\(`\$\{s\.id\}\|\$\{l\.id\}\|\$\{currentYear\.id\}`\)/);
  });
});

// ============================================================================
// ACAD-510 — the classes.notes wiring (0149)
// ============================================================================

describe("T-502 / ACAD-510 — the classes.notes column wiring", () => {
  it("1. source scan: createClass sends notes + updateClass maps it", () => {
    const src = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../infrastructure/supabase/repositories/supabase-academic-repository.ts",
      ),
      "utf8",
    );
    expect(src).toMatch(/notes: input\.notes \?\? null,/);
    expect(src).toMatch(/if \(updates\.notes !== undefined\) patch\.notes = updates\.notes;/);
  });

  it("2. migration 0149 exists and adds the column", () => {
    const mig = fs.readFileSync(
      path.resolve(__dirname, "../../../supabase/migrations/0149_classes_notes.sql"),
      "utf8",
    );
    expect(mig).toMatch(/alter table public\.classes add column if not exists notes text/);
  });

  it("3. migration 0148 exists with the narrative table + unique + policies", () => {
    const mig = fs.readFileSync(
      path.resolve(__dirname, "../../../supabase/migrations/0148_student_narratives.sql"),
      "utf8",
    );
    expect(mig).toMatch(/create table if not exists public\.student_narratives/);
    expect(mig).toMatch(/constraint uq_student_narrative unique \(tenant_id, student_id, academic_year\)/);
    expect(mig).toMatch(/student_narratives_insert/);
  });
});
