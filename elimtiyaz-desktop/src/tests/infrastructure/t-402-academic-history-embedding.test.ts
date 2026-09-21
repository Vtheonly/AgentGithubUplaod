/**
 * T-402 — the canonical promotion model read-side integration.
 *
 * The gap this suite pins: in Supabase mode the desktop NEVER read
 * `student_academic_histories` — `Student.academicHistory` was always
 * undefined, so the student drawer's "Historique académique" card rendered
 * empty and the placement studio's provenance detection
 * (`determineStudentProvenance`) degraded to the grade-adjacency fallback.
 * The promotion WRITE path was already canonical (0059's atomic
 * `execute_batch_promotion` RPC — verified live by verify_t-041.sql and,
 * since 0107, stamping the filière into history); what was missing was the
 * READ side. This suite pins:
 *
 *   1. MAPPERS — mapAcademicHistoryRow (the DB row → domain entry, incl.
 *      0107's classification columns) and embedAcademicHistories (grouping,
 *      chronological ordering, no-history students untouched).
 *   2. WIRE — seed() queries `student_academic_histories` tenant-scoped and
 *      the entries land on the cached students (the embedStudentDocuments
 *      pattern); a history-fetch failure degrades to the pre-T-402 state
 *      (empty history), never a blanked student list.
 *   3. WRITE-PATH UNIFICATION — the promote() quick path and the batch
 *      review flow BOTH go through the same `execute_batch_promotion` RPC
 *      (pinned here by construction: the repository has exactly ONE
 *      promotion entry point per surface, both calling that RPC).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  SupabaseStudentRepository,
  mapAcademicHistoryRow,
  embedAcademicHistories,
  type StudentAcademicHistoryRecordRow,
} from "../../infrastructure/supabase/repositories/supabase-shared-repositories";
import type { StudentRow } from "../../infrastructure/supabase/types";

const TENANT = "00000000-0000-0000-0000-000000000001";

beforeAll(() => {
  localStorage.setItem(
    "el-imtiyaz.session",
    JSON.stringify({ tenantId: TENANT, userId: "staff-1" }),
  );
});
afterAll(() => {
  localStorage.removeItem("el-imtiyaz.session");
});

// ============================================================================
// Minimal fake client (the T-372 read-path shape: select/eq/is/in/order)
// ============================================================================

type Row = Record<string, any>;
interface FakeTable { rows: Row[]; error?: unknown }

class FakeQuery {
  private filters: ((row: Row) => boolean)[] = [];
  private orders: { col: string; asc: boolean }[] = [];
  private forceError = false;
  private payload: Row | null = null;
  private isUpdate = false;
  constructor(private readonly table: FakeTable) {}
  select(_cols: string) { return this; }
  insert(payload: Row) { this.payload = payload; return this; }
  update(payload: Row) { this.payload = payload; this.isUpdate = true; return this; }
  eq(col: string, value: unknown) { this.filters.push((r) => r[col] === value); return this; }
  is(col: string, value: null) { this.filters.push((r) => (value === null ? r[col] == null : r[col] === value)); return this; }
  in(col: string, values: readonly unknown[]) { this.filters.push((r) => values.includes(r[col])); return this; }
  order(col: string, opts?: { ascending?: boolean }) { this.orders.push({ col, asc: opts?.ascending !== false }); return this; }
  failWith(e: unknown) { this.forceError = true; return this; }
  private matches(): Row[] {
    return this.table.rows.filter((r) => this.filters.every((f) => f(r)));
  }
  private async exec(): Promise<{ data: any; error: any }> {
    if (this.forceError || this.table.error) {
      return { data: null, error: this.table.error ?? { code: "XX000", message: "forced" } };
    }
    if (this.isUpdate && this.payload) {
      const matched = this.matches();
      for (const row of matched) Object.assign(row, this.payload);
      return { data: matched, error: null };
    }
    let rows = this.matches();
    for (const { col, asc } of [...this.orders].reverse()) {
      rows = [...rows].sort((a, b) => {
        const av = String(a[col] ?? ""); const bv = String(b[col] ?? "");
        return asc ? (av < bv ? -1 : av > bv ? 1 : 0) : (av > bv ? -1 : av < bv ? 1 : 0);
      });
    }
    return { data: rows, error: null };
  }
  then(onFulfilled: any, onRejected?: any) { return this.exec().then(onFulfilled, onRejected); }
}

function createFakeClient(tables: Record<string, Row[] | FakeTable>) {
  const fakeTables: Record<string, FakeTable> = {};
  for (const [name, t] of Object.entries(tables)) {
    fakeTables[name] = Array.isArray(t) ? { rows: [...t] } : t;
  }
  return {
    from(tableName: string) {
      if (!fakeTables[tableName]) fakeTables[tableName] = { rows: [] };
      return new FakeQuery(fakeTables[tableName]);
    },
    __tables: fakeTables,
  } as unknown as SupabaseClient & { __tables: Record<string, FakeTable> };
}

function makeStudentRow(overrides: Partial<StudentRow> = {}): StudentRow {
  return {
    id: "stu-1",
    tenant_id: TENANT,
    parent_id: "par-1",
    student_code: "ELV-2026-000001",
    first_name: "Sara",
    middle_name: null,
    last_name: "BENALI",
    display_name: null,
    date_of_birth: "2010-05-01",
    gender: "female",
    grade_level_id: null,
    class_id: null,
    filiere_code: null,
    specialite_code: null,
    enrollment_date: "2025-09-01",
    enrollment_status: "active",
    medical_notes: null,
    is_active: true,
    auth_user_id: null,
    created_at: "2025-09-01T00:00:00Z",
    updated_at: "2025-09-01T00:00:00Z",
    deleted_at: null,
    ...overrides,
  } as StudentRow;
}

function makeHistoryRow(overrides: Partial<StudentAcademicHistoryRecordRow> = {}): StudentAcademicHistoryRecordRow {
  return {
    id: "hist-1",
    tenant_id: TENANT,
    student_id: "stu-1",
    academic_year: "2025-2026",
    cycle: "lycee",
    grade_code: "2eme_annee",
    grade_year: 2,
    class_id: "cls-1",
    class_name: "2ème Année - Section A",
    gpa: 14.25,
    rank: 3,
    decision: "promoted",
    narrative: "Excellent travail",
    filiere_code: "mathematiques",
    specialite_code: null,
    recorded_at: "2026-06-30T10:00:00Z",
    ...overrides,
  };
}

async function waitFor(cond: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timeout");
    await new Promise((r) => setTimeout(r, 10));
  }
}

// ============================================================================
// 1. Mappers
// ============================================================================

describe("T-402 §1 — mapAcademicHistoryRow / embedAcademicHistories", () => {
  it("maps the canonical row onto the domain entry (incl. 0107 classification)", () => {
    const entry = mapAcademicHistoryRow(makeHistoryRow());
    expect(entry.studentId).toBe("stu-1");
    expect(entry.academicYear).toBe("2025-2026");
    expect(entry.cycle).toBe("lycee");
    expect(entry.gradeCode).toBe("2eme_annee");
    expect(entry.gradeYear).toBe(2);
    expect(entry.level).toBe("lycee");
    expect(entry.decision).toBe("promoted");
    expect(entry.gpa).toBe(14.25);
    expect(entry.rank).toBe(3);
    expect(entry.filiereCode).toBe("mathematiques");
    expect(entry.specialiteCode).toBeNull();
    expect(entry.recordedAt).toBe("2026-06-30T10:00:00Z");
  });

  it("derives prescolaire grades into the primaire AcademicLevel bucket (the mapClassRow convention)", () => {
    const entry = mapAcademicHistoryRow(makeHistoryRow({ cycle: "prescolaire", grade_code: "prescolaire_1", grade_year: 0 }));
    expect(entry.level).toBe("primaire");
  });

  it("embeds history per student, chronologically ordered", () => {
    const students = [
      { ...makeStudentRowToDomain(), id: "stu-1" },
      { ...makeStudentRowToDomain(), id: "stu-2" },
    ];
    const rows = [
      makeHistoryRow({ academic_year: "2026-2027", id: "hist-2" }),
      makeHistoryRow({ academic_year: "2025-2026", id: "hist-1" }),
      makeHistoryRow({ student_id: "stu-2", academic_year: "2025-2026", decision: "repeated", id: "hist-3" }),
    ];
    const embedded = embedAcademicHistories(students as any, rows);
    expect(embedded[0].academicHistory).toHaveLength(2);
    expect(embedded[0].academicHistory!.map((h) => h.academicYear)).toEqual(["2025-2026", "2026-2027"]);
    expect(embedded[1].academicHistory).toHaveLength(1);
    expect(embedded[1].academicHistory![0].decision).toBe("repeated");
  });

  it("students without history keep academicHistory undefined (the honest pre-T-402 shape)", () => {
    const embedded = embedAcademicHistories([{ ...makeStudentRowToDomain() } as any], []);
    expect(embedded[0].academicHistory).toBeUndefined();
  });

  function makeStudentRowToDomain() {
    return {
      id: "stu-1",
      tenantId: TENANT,
      code: "ELV-2026-000001",
      parentId: "par-1",
      firstName: "Sara",
      middleName: null,
      lastName: "BENALI",
      displayName: null,
      gender: "female",
      birthDate: "2010-05-01",
      enrollmentDate: "2025-09-01",
      level: "lycee",
      gradeYear: 2,
      gradeLevel: "2eme_annee",
      filiereCode: null,
      specialiteCode: null,
      classId: null,
      photoUrl: null,
      medicalNotes: null,
      transportTier: null,
      status: "active",
      paymentPlan: "tranches",
      createdAt: "2025-09-01T00:00:00Z",
      updatedAt: "2025-09-01T00:00:00Z",
    };
  }
});

// ============================================================================
// 2. Wire — seed() embeds the histories onto the cached students
// ============================================================================

describe("T-402 §2 — SupabaseStudentRepository.seed() embeds academic histories", () => {
  it("queries student_academic_histories tenant-scoped and lands entries on the students", async () => {
    const client = createFakeClient({
      students: [makeStudentRow()],
      student_documents: [],
      student_academic_histories: [
        makeHistoryRow(),
        makeHistoryRow({ academic_year: "2024-2025", grade_code: "1ere_annee", grade_year: 1, decision: "promoted", id: "hist-0" }),
      ],
    });
    const repo = new SupabaseStudentRepository(client);
    repo.observe();
    await waitFor(() => repo.observe().get().length === 1);
    const students = repo.observe().get();
    expect(students).toHaveLength(1);
    expect(students[0].academicHistory).toHaveLength(2);
    // Chronological — the oldest year first.
    expect(students[0].academicHistory![0].academicYear).toBe("2024-2025");
    expect(students[0].academicHistory![0].decision).toBe("promoted");
    expect(students[0].academicHistory![1].filiereCode).toBe("mathematiques");
  });

  it("a history-fetch failure degrades to empty history, never a blanked list", async () => {
    const client = createFakeClient({
      students: [makeStudentRow()],
      student_documents: [],
      student_academic_histories: { rows: [makeHistoryRow()], error: { code: "42501", message: "RLS denied" } },
    });
    const repo = new SupabaseStudentRepository(client);
    repo.observe();
    await waitFor(() => repo.observe().get().length === 1);
    const students = repo.observe().get();
    // The student list SURVIVES the history failure (the degradation rule).
    expect(students).toHaveLength(1);
    expect(students[0].academicHistory).toBeUndefined();
  });

  it("updateStudent preserves the embedded history (the documents-survival pattern)", async () => {
    const client = createFakeClient({
      students: [makeStudentRow()],
      student_documents: [],
      student_academic_histories: [makeHistoryRow()],
    });
    const repo = new SupabaseStudentRepository(client);
    repo.observe();
    await waitFor(() => repo.observe().get().length === 1);
    await repo.updateStudent("stu-1", { firstName: "Sarah" });
    const updated = repo.observe().get()[0];
    expect(updated.firstName).toBe("Sarah");
    expect(updated.academicHistory).toHaveLength(1);
    expect(updated.academicHistory![0].academicYear).toBe("2025-2026");
  });
});

// ============================================================================
// 3. Write-path unification — ONE promotion RPC surface
// ============================================================================

describe("T-402 §3 — the promotion write path stays ONE canonical RPC", () => {
  it("the desktop repository source calls execute_batch_promotion and reads student_academic_histories (source guard)", async () => {
    const { readFileSync } = await import("node:fs");
    const { join, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../infrastructure/supabase/repositories/supabase-shared-repositories.ts"),
      "utf-8",
    );
    const academicRepo = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../infrastructure/supabase/repositories/supabase-academic-repository.ts"),
      "utf-8",
    );
    // The student quick-promote path and the batch review repository both
    // call the SAME atomic RPC — no second promotion engine may appear.
    const promoteCalls = (src.match(/rpc\("execute_batch_promotion"/g) ?? []).length;
    const batchCalls = (academicRepo.match(/rpc\("execute_batch_promotion"/g) ?? []).length;
    expect(promoteCalls).toBe(1);
    expect(batchCalls).toBe(1);
    // The read side is now wired (this is the T-402 fix itself).
    expect(src).toContain('from("student_academic_histories")');
    // The dead legacy path stays dead (AGENTS.md ACAD-100 rule).
    expect(academicRepo).not.toContain("promote_students");
    expect(academicRepo).not.toContain('from("academic_history")');
  });
});
