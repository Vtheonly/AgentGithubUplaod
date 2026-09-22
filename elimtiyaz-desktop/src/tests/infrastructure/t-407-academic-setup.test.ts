// ============================================================================
// FILE: src/tests/infrastructure/t-407-academic-setup.test.ts
// ============================================================================
/**
 * T-407 — the academic-setup unblock tests (ACAD-506/507/508 + SCHED-105):
 *
 *   1. SupabaseTeacherRepository (SCHED-105) — the legacy TeacherRepository
 *      contract bridged onto the canonical tables: createTeacher flips the
 *      personnel row to staff_category='teaching' (audited, idempotent),
 *      the notFound path fails honestly, deleteTeacher refuses while
 *      class-subject assignments exist, assignments derive from
 *      class_subjects, and the timetable observers read the PUBLISHED
 *      canonical entries with room names resolved.
 *   2. The academic-level resolution (ACAD-506) — the mock twin serves the
 *      canonical 14-row Algerian ladder; the class-creation dialog resolves
 *      the REAL level id through repos.academicLevels.getByGradeCode and
 *      NEVER constructs a mock-era `al-<code>` payload again (source pin).
 *   3. The subject form (ACAD-507) — the phantom required `level` field is
 *      gone: the schema parses WITHOUT a level (it is derived from the
 *      cycle on read).
 *   4. The Algerian curriculum catalog (ACAD-508) — 14 identity matières,
 *      the OFFICIAL BEM coefficients pinned at 4AM, configuration coverage
 *      for every level, and identity-only subjects carry no context rows.
 *   5. Wiring source guards — the academicLevels slot exists in both
 *      repository sets; the Supabase set overrides `teachers`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";

import { SupabaseTeacherRepository } from "../../infrastructure/supabase/repositories/supabase-teacher-repository";
import { MockAcademicLevelRepository } from "../../infrastructure/mock/repositories/academic-level-repository";
import {
  ALGERIAN_SUBJECTS,
  ALGERIAN_LEVEL_CONFIGURATIONS,
  OFFICIAL_BEM_COEFFICIENTS,
  IDENTITY_ONLY_SUBJECTS,
  configurationsForGrade,
} from "../../domain/calc/academics/algerian-curriculum";

const SRC = join(process.cwd(), "src");
const read = (p: string) => readFileSync(join(SRC, p), "utf-8");
const readRoot = (p: string) => readFileSync(join(process.cwd(), p), "utf-8");

const TENANT = "00000000-0000-0000-0000-000000000001";
const PERSONNEL_ID = "11111111-1111-1111-1111-111111111111";
const YEAR_ID = "22222222-2222-2222-2222-222222222222";
const CLASS_ID = "33333333-3333-3333-3333-333333333333";
const SUBJECT_ID = "44444444-4444-4444-4444-444444444444";
const VERSION_ID = "55555555-5555-5555-5555-555555555555";
const ROOM_ID = "66666666-6666-6666-6666-666666666666";

// ============================================================================
// Fake Supabase client — the T-093/T-080 minimal PostgREST builder surface,
// extended with is/not/in/maybeSingle/order-options/count-head (the shapes
// SupabaseTeacherRepository uses).
// ============================================================================
type Row = Record<string, unknown>;

class FakeQuery {
  private filters: ((row: Row) => boolean)[] = [];
  private mode: "select" | "insert" | "update" | "delete" = "select";
  private payload: Row | null = null;
  private wantSingle = false;
  private wantMaybeSingle = false;
  private orderCol = "";
  private orderAsc = true;
  private countHead = false;

  constructor(
    private readonly table: Row[],
    private readonly tableName: string,
  ) {}

  eq(col: string, val: unknown): this {
    this.filters.push((r) => r[col] === val);
    return this;
  }

  is(col: string, val: unknown): this {
    this.filters.push((r) => r[col] === val);
    return this;
  }

  not(col: string, _op: string, val?: unknown): this {
    this.filters.push((r) => r[col] !== val);
    return this;
  }

  in(col: string, vals: unknown[]): this {
    const set = new Set(vals);
    this.filters.push((r) => set.has(r[col]));
    return this;
  }

  order(col: string, opts?: { ascending?: boolean }): this {
    this.orderCol = col;
    this.orderAsc = opts?.ascending ?? true;
    return this;
  }

  select(_cols?: string, opts?: { count?: "exact"; head?: boolean }): this {
    if (opts?.head) this.countHead = true;
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
    this.wantMaybeSingle = true;
    return this;
  }

  private run(): { data: Row | Row[] | { count: number } | null; error: { message: string } | null } {
    if (this.countHead) {
      // supabase-js head+exact shape: { data: null, count, error } — `count`
      // is destructured directly by the repository.
      const n = this.table.filter((r) => this.filters.every((f) => f(r))).length;
      return { data: null, count: n, error: null } as never;
    }
    if (this.mode === "update") {
      const patched: Row[] = [];
      for (const row of this.table) {
        if (this.filters.every((f) => f(row))) {
          Object.assign(row, this.payload ?? {});
          patched.push(row);
        }
      }
      if (patched.length === 0) {
        return { data: null, error: { message: "no rows updated" } };
      }
      return { data: this.wantSingle || this.wantMaybeSingle ? patched[0] : patched, error: null };
    }
    let rows = this.table.filter((r) => this.filters.every((f) => f(r)));
    if (this.orderCol) {
      rows = [...rows].sort((a, b) => {
        const av = String(a[this.orderCol] ?? "");
        const bv = String(b[this.orderCol] ?? "");
        return this.orderAsc ? av.localeCompare(bv) : bv.localeCompare(av);
      });
    }
    if (this.wantSingle || this.wantMaybeSingle) {
      if (rows.length === 0) {
        return this.wantMaybeSingle
          ? { data: null, error: null }
          : { data: null, error: { message: "no rows (PGRST116)" } };
      }
      return { data: rows[0], error: null };
    }
    return { data: rows, error: null };
  }

  then<TResult1>(
    onFulfilled:
      | ((value: { data: Row | Row[] | { count: number } | null; error: { message: string } | null }) => TResult1 | PromiseLike<TResult1>)
      | null,
  ): Promise<TResult1> {
    return Promise.resolve(
      (onFulfilled as unknown as (v: unknown) => TResult1)(this.run()),
    );
  }
}

class FakeClient {
  tables: Record<string, Row[]> = {};
  rpcCalls: { name: string; args: Record<string, unknown> }[] = [];

  from(tableName: string): FakeQuery {
    if (!this.tables[tableName]) this.tables[tableName] = [];
    return new FakeQuery(this.tables[tableName], tableName);
  }

  async rpc(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    this.rpcCalls.push({ name, args });
    return { data: null, error: null };
  }
}

function seedTeacherTables(): FakeClient {
  const client = new FakeClient();
  client.tables["personnel"] = [
    {
      id: PERSONNEL_ID,
      tenant_id: TENANT,
      personnel_code: "PER-001",
      first_name: "Karim",
      last_name: "Haddad",
      staff_category: "support",
      is_active: true,
      position: null,
      created_at: "2026-09-01",
      updated_at: "2026-09-01",
    },
  ];
  client.tables["academic_years"] = [
    { id: YEAR_ID, tenant_id: TENANT, code: "2026-2027", label: "2026-2027", is_current: true },
  ];
  client.tables["class_subjects"] = [
    {
      id: "cs-1",
      tenant_id: TENANT,
      class_id: CLASS_ID,
      subject_id: SUBJECT_ID,
      teacher_id: PERSONNEL_ID,
      created_at: "2026-09-01",
      classes: { academic_year_id: YEAR_ID },
    },
  ];
  client.tables["timetable_versions"] = [
    { id: VERSION_ID, tenant_id: TENANT, academic_year_id: YEAR_ID, status: "published" },
  ];
  client.tables["timetable_entries"] = [
    {
      id: "te-1",
      tenant_id: TENANT,
      academic_year_id: YEAR_ID,
      version_id: VERSION_ID,
      class_id: CLASS_ID,
      subject_id: SUBJECT_ID,
      teacher_id: PERSONNEL_ID,
      room_id: ROOM_ID,
      day: "sunday",
      period_index: 1,
      start_minutes: 480,
      end_minutes: 540,
      lesson_group: 1,
      notes: null,
      created_at: "2026-09-01",
      updated_at: "2026-09-01",
    },
  ];
  client.tables["rooms"] = [{ id: ROOM_ID, tenant_id: TENANT, name: "Salle 12" }];
  return client;
}

beforeEach(() => {
  localStorage.setItem(
    "el-imtiyaz.session",
    JSON.stringify({ tenantId: TENANT, userId: "u-1", displayName: "Test" }),
  );
});

afterEach(() => {
  localStorage.removeItem("el-imtiyaz.session");
  vi.restoreAllMocks();
});

// ============================================================================
// 1. SupabaseTeacherRepository (SCHED-105)
// ============================================================================

describe("T-407 — SupabaseTeacherRepository (the personnel bridge)", () => {
  it("createTeacher flips the personnel row to teaching staff (audited, idempotent)", async () => {
    const client = seedTeacherTables();
    const repo = new SupabaseTeacherRepository(client as unknown as SupabaseClient);
    const result = await repo.createTeacher(
      {
        personnelId: PERSONNEL_ID,
        code: "ENS-2026-111",
        academicYearId: YEAR_ID,
        academicYearCode: "2026-2027",
        status: "active",
        maxWeeklyHours: 18,
      },
      "u-1",
      "Test",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.personnelId).toBe(PERSONNEL_ID);
    expect(result.value.firstName).toBe("Karim");
    expect(result.value.academicYearCode).toBe("2026-2027");
    // The canonical write landed on personnel.
    expect(client.tables["personnel"][0].staff_category).toBe("teaching");
    expect(client.tables["personnel"][0].position).toBe("Enseignant");
    // The audit entry went through the canonical RPC.
    const audit = client.rpcCalls.find((c) => c.name === "write_audit_log");
    expect(audit).toBeTruthy();
    expect(audit?.args.p_action).toBe("teacher.create");

    // Idempotent: re-registering an already-teaching member succeeds.
    const again = await repo.createTeacher(
      {
        personnelId: PERSONNEL_ID,
        code: "ENS-2026-111",
        academicYearId: YEAR_ID,
        academicYearCode: "2026-2027",
      },
      "u-1",
      "Test",
    );
    expect(again.ok).toBe(true);
  });

  it("createTeacher fails honestly for an unknown personnel id", async () => {
    const client = seedTeacherTables();
    const repo = new SupabaseTeacherRepository(client as unknown as SupabaseClient);
    const result = await repo.createTeacher(
      {
        personnelId: "99999999-9999-9999-9999-999999999999",
        code: "ENS-X",
        academicYearId: YEAR_ID,
        academicYearCode: "2026-2027",
      },
      "u-1",
      "Test",
    );
    expect(result.ok).toBe(false);
  });

  it("createTeacher rejects mock-era personnel ids (not uuids)", async () => {
    const client = seedTeacherTables();
    const repo = new SupabaseTeacherRepository(client as unknown as SupabaseClient);
    const result = await repo.createTeacher(
      {
        personnelId: "per-001",
        code: "ENS-X",
        academicYearId: YEAR_ID,
        academicYearCode: "2026-2027",
      },
      "u-1",
      "Test",
    );
    expect(result.ok).toBe(false);
  });

  it("deleteTeacher REFUSES while class-subject assignments exist", async () => {
    const client = seedTeacherTables();
    const repo = new SupabaseTeacherRepository(client as unknown as SupabaseClient);
    const result = await repo.deleteTeacher(PERSONNEL_ID, "u-1", "Test");
    expect(result.ok).toBe(false);
  });

  it("assignments derive from class_subjects (scoped by the class's year)", async () => {
    const client = seedTeacherTables();
    const repo = new SupabaseTeacherRepository(client as unknown as SupabaseClient);
    await vi.waitFor(() => {
      const assignments = repo
        .observeAssignmentsByAcademicYear(YEAR_ID)
        .get();
      expect(assignments.length).toBeGreaterThan(0);
    });
    const assignments = repo.observeAssignmentsByAcademicYear(YEAR_ID).get();
    expect(assignments[0].teacherId).toBe(PERSONNEL_ID);
    expect(assignments[0].subjectId).toBe(SUBJECT_ID);
  });

  it("timetable observers read the PUBLISHED canonical entries with the room name", async () => {
    const client = seedTeacherTables();
    const repo = new SupabaseTeacherRepository(client as unknown as SupabaseClient);
    await vi.waitFor(() => {
      expect(
        repo.observeTimetableByAcademicYear(YEAR_ID).get().length,
      ).toBeGreaterThan(0);
    });
    const entries = repo.observeTimetableForClass(CLASS_ID, YEAR_ID).get();
    expect(entries.length).toBe(1);
    expect(entries[0].room).toBe("Salle 12");
    expect(entries[0].day).toBe("sunday");
    // Draft versions never leak: entries of non-published versions are absent.
    const draftClient = seedTeacherTables();
    (draftClient.tables["timetable_versions"][0] as Row).status = "draft";
    const draftRepo = new SupabaseTeacherRepository(
      draftClient as unknown as SupabaseClient,
    );
    await vi.waitFor(() => {
      expect(draftRepo.observeTimetableByAcademicYear(YEAR_ID).get()).toEqual([]);
    });
  });

  it("the legacy timetable writers redirect to the canonical editor (honest errors)", async () => {
    const client = seedTeacherTables();
    const repo = new SupabaseTeacherRepository(client as unknown as SupabaseClient);
    const created = await repo.createTimetableEntry(
      {
        academicYearId: YEAR_ID,
        classId: CLASS_ID,
        teacherId: PERSONNEL_ID,
        subjectId: SUBJECT_ID,
        day: "monday",
        startMinutes: 480,
        endMinutes: 540,
        room: null,
        notes: null,
      },
      "u-1",
      "Test",
    );
    expect(created.ok).toBe(false);
    if (created.ok) return;
    expect(created.error.userMessage).toContain("Emploi du temps");
  });
});

// ============================================================================
// 2. The academic-level resolution (ACAD-506)
// ============================================================================

describe("T-407 — the academic-level catalog (ACAD-506)", () => {
  it("the mock twin serves the canonical 14-row Algerian ladder", () => {
    const repo = new MockAcademicLevelRepository();
    const levels = repo.observeAll().get();
    expect(levels.length).toBe(14);
    const codes = levels.map((l) => l.gradeCode);
    expect(codes).toContain("prescolaire_1");
    expect(codes).toContain("5ap");
    expect(codes).toContain("4am");
    expect(codes).toContain("3eme_annee");
  });

  it("getByGradeCode resolves the level for every canonical grade code", async () => {
    const repo = new MockAcademicLevelRepository();
    for (const code of [
      "prescolaire_1", "prescolaire_2",
      "1ap", "2ap", "3ap", "4ap", "5ap",
      "1am", "2am", "3am", "4am",
      "1ere_annee", "2eme_annee", "3eme_annee",
    ]) {
      const result = await repo.getByGradeCode(code as never);
      expect(result.ok, code).toBe(true);
      expect(result.ok && result.value?.gradeCode, code).toBe(code);
    }
  });

  it("the class-creation dialog NEVER constructs a mock-era `al-` payload (source pin)", () => {
    const dialog = read("features/academics/grade-levels-class-view.tsx");
    expect(dialog).not.toMatch(/academicLevelId:\s*`al-/);
    expect(dialog).toContain("repos.academicLevels.getByGradeCode");
  });

  it("the provider exposes the academicLevels slot on both repository sets", () => {
    const provider = read("app/providers/repository-provider.tsx");
    expect(provider).toMatch(/academicLevels:\s*AcademicLevelRepository/);
    expect(provider).toMatch(/academicLevels:\s*mockAcademicLevelRepository/);
    const supabaseSet = read("infrastructure/supabase/supabase-repositories.ts");
    expect(supabaseSet).toMatch(/academicLevels,\s*\/\/\s*T-407/);
    expect(supabaseSet).toMatch(/teachers,\s*\/\/\s*T-407/);
  });
});

// ============================================================================
// 3. The subject form fix (ACAD-507)
// ============================================================================

describe("T-407 — the subject form phantom field (ACAD-507)", () => {
  it("the SubjectSchema derives level from the cycle (no bare required level field)", () => {
    // The schema must NOT contain a bare required `level: z.enum([...])`
    // (the invisible validation that blocked every submit), and the payload
    // builder must derive level from the cycle.
    const source = read("features/academics/subjects-directory-tab.tsx");
    expect(source).not.toMatch(/^\s*level:\s*z\.enum\(\["prescolaire", "primaire", "cem", "lycee"\]\),$/m);
    expect(source).toMatch(/const level = data\.cycle as AcademicLevel/);
    // level is optional with a default — the phantom requirement is gone.
    expect(source).toMatch(/level: z[\s\S]{0,120}\.optional\(\)\n?[\s\S]{0,60}\.default\("primaire"\)/);
  });

  it("identity rows render \"Tous cycles\" instead of a misleading derived cycle", () => {
    const source = read("features/academics/subjects-directory-tab.tsx");
    expect(source).toContain("Tous cycles");
  });
});

// ============================================================================
// 4. The Algerian curriculum catalog (ACAD-508)
// ============================================================================

describe("T-407 — the Algerian curriculum catalog (ACAD-508)", () => {
  it("defines the 14 national matières as IDENTITY rows (unique codes)", () => {
    expect(ALGERIAN_SUBJECTS.length).toBe(14);
    const codes = new Set(ALGERIAN_SUBJECTS.map((s) => s.code));
    expect(codes.size).toBe(14);
    for (const mandatory of ["ARABE", "MATHS", "FRANCAIS", "ANGLAIS", "PHYSIQUE", "SVT", "HIST_GEO", "EDU_ISLAM", "PHILO", "EPS"]) {
      expect(codes.has(mandatory), mandatory).toBe(true);
    }
    // Every identity carries the Arabic name (the Algerian system mandate).
    for (const subject of ALGERIAN_SUBJECTS) {
      expect(subject.nameAr.length).toBeGreaterThan(0);
    }
  });

  it("pins the OFFICIAL BEM coefficients at 4AM", () => {
    const configs = configurationsForGrade("4am");
    const bySubject = new Map(configs.map((c) => [c.subjectCode, c.coefficient]));
    expect(Object.keys(OFFICIAL_BEM_COEFFICIENTS).length).toBe(8);
    for (const [code, coefficient] of Object.entries(OFFICIAL_BEM_COEFFICIENTS)) {
      expect(bySubject.get(code), `${code} at 4AM`).toBe(coefficient);
    }
    // The official BEM average divides by 22.
    const total = Object.values(OFFICIAL_BEM_COEFFICIENTS).reduce((a, b) => a + b, 0);
    expect(total).toBe(22);
  });

  it("configures every level of the 14-grade ladder", () => {
    const grades = new Set(ALGERIAN_LEVEL_CONFIGURATIONS.map((c) => c.gradeCode));
    for (const grade of [
      "prescolaire_1", "prescolaire_2",
      "1ap", "2ap", "3ap", "4ap", "5ap",
      "1am", "2am", "3am", "4am",
      "1ere_annee", "2eme_annee", "3eme_annee",
    ]) {
      expect(grades.has(grade), grade).toBe(true);
    }
    // The configuration count matches the migration's VALUES table (127).
    expect(ALGERIAN_LEVEL_CONFIGURATIONS.length).toBe(127);
  });

  it("identity-only subjects (Tamazight) carry no context rows", () => {
    expect(IDENTITY_ONLY_SUBJECTS).toEqual(["TAMAZIGHT"]);
    for (const config of ALGERIAN_LEVEL_CONFIGURATIONS) {
      expect(IDENTITY_ONLY_SUBJECTS).not.toContain(config.subjectCode);
    }
  });

  it("the migration SQL mirrors the TS catalog (parity spot checks)", () => {
    const migration = readRoot(
      "supabase/migrations/0113_algerian_curriculum_catalog.sql",
    );
    for (const subject of ALGERIAN_SUBJECTS) {
      expect(migration).toContain(`'${subject.code}'`);
      expect(migration).toContain(subject.nameFr.replace(/'/g, "''"));
    }
    // The BEM 4AM row is present in the SQL VALUES table.
    expect(migration).toMatch(/\('4am','ARABE',5\)/);
    expect(migration).toMatch(/\('4am','MATHS',4\)/);
    expect(migration).toMatch(/\('4am','FRANCAIS',3\)/);
  });
});
