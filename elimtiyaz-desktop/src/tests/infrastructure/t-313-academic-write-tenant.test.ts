/**
 * T-313 (ACAD-104) — academic-structure writes carry the tenant context.
 *
 * Root cause (live-verified 2026-09-12): `classes`, `subjects`,
 * `academic_years` and `class_subjects` all have `tenant_id NOT NULL` with
 * NO column default and NO set-tenant trigger (unlike `assessments`, which
 * got `assessments_set_tenant` in 0041/0057). Their 0019 admin policies
 * use `WITH CHECK (tenant_id = current_tenant_id() AND has_any_role(...))`
 * — a tenant-less INSERT evaluates `NULL = current_tenant_id()` → NULL →
 * the row is rejected → PostgREST 42501 → `supabaseErrorToAppError` →
 * ERR_FORBIDDEN. This is the ACTUAL root cause of the owner's SuperAdmin
 * "Vous n'avez pas la permission d'effectuer cette action" report that the
 * 9e70078 patch covered up client-side (REG-006 fake-success wrapper)
 * instead of fixing.
 *
 * Live corroboration at registration: `class_subjects` held ZERO rows (the
 * assignment flow never once persisted); classes/subjects/academic_years
 * rows all came from server-side seeding, never the desktop write path.
 *
 * Fix under test (the T-023 ATT-100/HOMEWORK-100 in-file precedent):
 * `createAcademicYear` / `createClass` / `createSubject` /
 * `assignSubjectToClass` now stamp `tenant_id: getTenantId()` on every
 * INSERT and fail loud (ERR_VALIDATION Result) when the session has no
 * working tenant — a global admin who has not picked a tenant cannot
 * write academic structure silently.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  SupabaseAcademicYearRepository,
  SupabaseClassRepository,
  SupabaseSubjectRepository,
} from "../../infrastructure/supabase/repositories/supabase-academic-repository";

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const UUID_A = "aaaaaaaa-1111-1111-1111-111111111111";
const UUID_B = "bbbbbbbb-2222-2222-2222-222222222222";

beforeAll(() => {
  localStorage.setItem(
    "el-imtiyaz.session",
    JSON.stringify({ tenantId: TENANT_ID, userId: "staff-1" }),
  );
});
afterAll(() => {
  localStorage.removeItem("el-imtiyaz.session");
});

type Row = Record<string, any>;

interface InsertCapture {
  table: string;
  payload: Row;
}

/**
 * Fake PostgREST client — captures INSERT payloads (the wire contract
 * PostgREST would receive) and returns the inserted row back with an id,
 * the same pattern as t-023-academic-persistence.test.ts.
 */
function makeCapturingClient(captures: InsertCapture[]): SupabaseClient {
  const q: any = {
    select() {
      return q;
    },
    eq() {
      return q;
    },
    order() {
      return q;
    },
    maybeSingle() {
      return Promise.resolve({ data: null, error: null });
    },
    single() {
      return Promise.resolve({ data: q.__row, error: null });
    },
    insert(payload: Row) {
      captures.push({ table: q.__table, payload });
      q.__row = { id: `row-${captures.length}`, ...payload };
      return q;
    },
  };
  const client = {
    from(table: string) {
      q.__table = table;
      return q;
    },
  };
  return client as unknown as SupabaseClient;
}

function makeNoTenantClient(violations: string[]): SupabaseClient {
  // Any INSERT attempted on this client is a contract violation — the
  // repositories must fail loud BEFORE touching the wire. Violations are
  // RECORDED (not thrown: the constructors fire a background refresh()
  // whose SELECT path must stay harmless) and asserted empty by the tests.
  const q: any = {
    select() {
      return q;
    },
    eq() {
      return q;
    },
    order() {
      return q;
    },
    single() {
      return Promise.resolve({ data: null, error: null });
    },
    maybeSingle() {
      return Promise.resolve({ data: null, error: null });
    },
    insert() {
      violations.push(`INSERT attempted without a tenant context`);
      return q;
    },
  };
  const client = {
    from() {
      return q;
    },
  };
  return client as unknown as SupabaseClient;
}

describe("T-313 — createAcademicYear carries tenant_id (ACAD-104)", () => {
  it("stamps the working tenant on the INSERT payload", async () => {
    const captures: InsertCapture[] = [];
    const repo = new SupabaseAcademicYearRepository(makeCapturingClient(captures));
    const res = await repo.createAcademicYear(
      {
        code: "2026-2027",
        label: "Année 2026-2027",
        startDate: "2026-09-01",
        endDate: "2027-06-30",
        termStructure: { terms: 3 },
        isCurrent: false,
      },
      "staff-1",
      "Staff",
    );
    expect(res.ok).toBe(true);
    const ins = captures.find((c) => c.table === "academic_years");
    expect(ins).toBeDefined();
    expect(ins!.payload.tenant_id).toBe(TENANT_ID);
  });

  it("fails loud (ERR_VALIDATION) when the session has no working tenant", async () => {
    localStorage.removeItem("el-imtiyaz.session");
    const violations: string[] = [];
    try {
      const repo = new SupabaseAcademicYearRepository(makeNoTenantClient(violations));
      const res = await repo.createAcademicYear(
        {
          code: "2026-2027",
          label: "Année 2026-2027",
          startDate: "2026-09-01",
          endDate: "2027-06-30",
          termStructure: { terms: 3 },
          isCurrent: false,
        },
        "staff-1",
        "Staff",
      );
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe("ERR_VALIDATION");
        expect(res.error.userMessage).toContain("établissement");
      }
      expect(violations).toEqual([]);
    } finally {
      localStorage.setItem(
        "el-imtiyaz.session",
        JSON.stringify({ tenantId: TENANT_ID, userId: "staff-1" }),
      );
    }
  });
});

describe("T-313 — createClass carries tenant_id (ACAD-104)", () => {
  it("stamps the working tenant on the INSERT payload", async () => {
    const captures: InsertCapture[] = [];
    const repo = new SupabaseClassRepository(makeCapturingClient(captures));
    const res = await repo.createClass({
      academicYearId: UUID_A,
      academicLevelId: UUID_B,
      code: "CL-1",
      name: "1AP A",
      gradeCode: "1ap",
      section: "A",
      room: "S1",
      capacity: 30,
      homeroomTeacherId: null,
      homeroomTeacherName: null,
      academicYear: "2026-2027",
    });
    expect(res.ok).toBe(true);
    const ins = captures.find((c) => c.table === "classes");
    expect(ins).toBeDefined();
    expect(ins!.payload.tenant_id).toBe(TENANT_ID);
  });

  it("fails loud (ERR_VALIDATION) when the session has no working tenant", async () => {
    localStorage.removeItem("el-imtiyaz.session");
    const violations: string[] = [];
    try {
      const repo = new SupabaseClassRepository(makeNoTenantClient(violations));
      const res = await repo.createClass({
        academicYearId: UUID_A,
        academicLevelId: UUID_B,
        code: "CL-1",
        name: "1AP A",
        gradeCode: "1ap",
        section: "A",
        room: "S1",
        capacity: 30,
        homeroomTeacherId: null,
        homeroomTeacherName: null,
        academicYear: "2026-2027",
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe("ERR_VALIDATION");
        expect(res.error.userMessage).toContain("établissement");
      }
      expect(violations).toEqual([]);
    } finally {
      localStorage.setItem(
        "el-imtiyaz.session",
        JSON.stringify({ tenantId: TENANT_ID, userId: "staff-1" }),
      );
    }
  });
});

describe("T-313 — assignSubjectToClass carries tenant_id (ACAD-104 — the owner's reported denial)", () => {
  it("stamps the working tenant on the INSERT payload", async () => {
    const captures: InsertCapture[] = [];
    const repo = new SupabaseSubjectRepository(makeCapturingClient(captures));
    const res = await repo.assignSubjectToClass({
      classId: UUID_A,
      subjectId: UUID_B,
      teacherId: null,
      teacherName: "Enseignant",
      weeklyHours: 2,
      coefficient: 1,
    });
    expect(res.ok).toBe(true);
    const ins = captures.find((c) => c.table === "class_subjects");
    expect(ins).toBeDefined();
    expect(ins!.payload.tenant_id).toBe(TENANT_ID);
  });

  it("fails loud (ERR_VALIDATION) when the session has no working tenant", async () => {
    localStorage.removeItem("el-imtiyaz.session");
    const violations: string[] = [];
    try {
      const repo = new SupabaseSubjectRepository(makeNoTenantClient(violations));
      const res = await repo.assignSubjectToClass({
        classId: UUID_A,
        subjectId: UUID_B,
        teacherId: null,
        teacherName: "Enseignant",
        weeklyHours: 2,
        coefficient: 1,
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe("ERR_VALIDATION");
        expect(res.error.userMessage).toContain("établissement");
      }
      expect(violations).toEqual([]);
    } finally {
      localStorage.setItem(
        "el-imtiyaz.session",
        JSON.stringify({ tenantId: TENANT_ID, userId: "staff-1" }),
      );
    }
  });
});

describe("T-313 — createSubject carries tenant_id (ACAD-104)", () => {
  it("stamps the working tenant on the INSERT payload", async () => {
    const captures: InsertCapture[] = [];
    const repo = new SupabaseSubjectRepository(makeCapturingClient(captures));
    const res = await repo.createSubject({
      code: "MATH",
      name: "Mathématiques",
      nameAr: "الرياضيات",
      cycle: "primaire",
      coefficient: 2,
      passingGrade: 10,
      isExtracurricular: false,
    });
    expect(res.ok).toBe(true);
    const ins = captures.find((c) => c.table === "subjects");
    expect(ins).toBeDefined();
    expect(ins!.payload.tenant_id).toBe(TENANT_ID);
  });

  it("fails loud (ERR_VALIDATION) when the session has no working tenant", async () => {
    localStorage.removeItem("el-imtiyaz.session");
    const violations: string[] = [];
    try {
      const repo = new SupabaseSubjectRepository(makeNoTenantClient(violations));
      const res = await repo.createSubject({
        code: "MATH",
        name: "Mathématiques",
        nameAr: "الرياضيات",
        cycle: "primaire",
        coefficient: 2,
        passingGrade: 10,
        isExtracurricular: false,
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe("ERR_VALIDATION");
        expect(res.error.userMessage).toContain("établissement");
      }
      expect(violations).toEqual([]);
    } finally {
      localStorage.setItem(
        "el-imtiyaz.session",
        JSON.stringify({ tenantId: TENANT_ID, userId: "staff-1" }),
      );
    }
  });
});

describe("T-313 — source guard: every academic-structure INSERT is tenant-stamped", () => {
  it("the four write methods pin tenant_id in the repository source", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../infrastructure/supabase/repositories/supabase-academic-repository.ts",
      ),
      "utf8",
    );
    // Whitespace-normalized pins: the four INSERTs must carry tenant_id.
    const norm = src.replace(/\s+/g, " ");
    for (const table of ["academic_years", "classes", "subjects", "class_subjects"]) {
      expect(norm).toContain(`.from("${table}")`);
    }
    // Four occurrences of the guarded tenant stamp (one per insert).
    const stampCount = (src.match(/tenant_id: tenantId/g) ?? []).length;
    expect(stampCount).toBeGreaterThanOrEqual(4);
    // The no-tenant guard exists at each site (fail loud, Result contract).
    const guardCount = (src.match(/no active tenant context/g) ?? []).length;
    expect(guardCount).toBeGreaterThanOrEqual(4);
  });
});
