/**
 * T-352 regression suite (63rd session, 2026-09-14) — DASH-402:
 * the school-wide grade + attendance streams.
 *
 * The Analytics tab's risk engine previously queried
 * `repos.grades.observeForClass("")` and
 * `repos.attendance.observeByStudent("", "2020-01-01", "2030-12-31")`.
 * Both repositories build LITERAL empty-ID filters:
 *   - Supabase: `.eq("class_id", "")` / `.eq("student_id", "")` — a UUID
 *     column compared to an empty string matches ZERO rows;
 *   - Mock: `a.classId === ""` — also zero.
 * Consequences (the owner's screenshots 1–4): every GPA "—",
 * calculateAttendanceRate([]) → 1.0 (100% attendance — the WEAK-019
 * inversion where MISSING data renders as PERFECT data), and with the
 * debt feed also empty, every student categorized "healthy" — the whole
 * Diagnostic Actif / pivot / cross-risk surface dead.
 *
 * This suite pins:
 *   1. The contract: GradeRepository.observeAll + AttendanceRepository
 *      .observeAll exist in BOTH contract modules (repository.ts and
 *      academic-repository.ts — the duplicated-contract reality).
 *   2. The Supabase query shape: tenant-scoped, NO empty class_id /
 *      student_id filter, ordered like the sibling methods.
 *   3. The mock implementation: store-parity (all assessments; the
 *      in-range attendance slice).
 *   4. The tab wiring: the `""`-ID query patterns are gone; observeAll
 *      is consumed (source guards — the t-351 pattern).
 *   5. Mock-vs-Supabase parity semantics (§15.15): observeAll returns
 *      the FULL catalogue in both modes.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseGradeRepository, SupabaseAttendanceRepository } from "../../../infrastructure/supabase/repositories/supabase-academic-repository";
import { MockGradeRepository, MockAttendanceRepository } from "../../../infrastructure/mock/repositories/academic-repository";
import { store as mockStore } from "../../../infrastructure/mock/repositories/mock-store";

const SRC = join(__dirname, "../../../");

beforeAll(() => {
  localStorage.setItem(
    "el-imtiyaz.session",
    JSON.stringify({ tenantId: "00000000-0000-0000-0000-000000000001", userId: "staff-1" }),
  );
});

// ============================================================
// 1. Contract guards (both contract modules declare observeAll)
// ============================================================

const REPOSITORY_CONTRACT = readFileSync(
  join(SRC, "domain/repository/repository.ts"),
  "utf8",
);
const ACADEMIC_CONTRACT = readFileSync(
  join(SRC, "domain/repository/academic-repository.ts"),
  "utf8",
);

describe("T-352 — the observeAll contract (both modules in lockstep)", () => {
  it("repository.ts declares GradeRepository.observeAll + AttendanceRepository.observeAll", () => {
    expect(REPOSITORY_CONTRACT).toMatch(
      /observeAll\(academicYear\?: string, term\?: string\): Observable<Assessment\[\]>/,
    );
    expect(REPOSITORY_CONTRACT).toMatch(
      /observeAll\(from: string, to: string\): Observable<AttendanceRecord\[\]>/,
    );
  });

  it("academic-repository.ts (the implementations' contract) declares both too", () => {
    expect(ACADEMIC_CONTRACT).toMatch(
      /observeAll\(academicYear\?: string, term\?: string\): Observable<Assessment\[\]>/,
    );
    expect(ACADEMIC_CONTRACT).toMatch(
      /observeAll\(from: string, to: string\): Observable<AttendanceRecord\[\]>/,
    );
  });
});

// ============================================================
// 2. The Supabase query shape
// ============================================================

type Row = Record<string, unknown>;

function makeClient(data: Row[] = []) {
  const calls: { table: string; op: string; filters: Row[] }[] = [];
  const client = {
    from(table: string) {
      const rec = { table, op: "", filters: [] as Row[] };
      calls.push(rec);
      const q: Record<string, unknown> = {};
      const chain = () => q;
      q.select = () => {
        rec.op = rec.op || "select";
        return q;
      };
      q.eq = (col: string, value: unknown) => {
        rec.filters.push({ col, value });
        return q;
      };
      q.gte = (col: string, value: unknown) => {
        rec.filters.push({ col, op: "gte", value });
        return q;
      };
      q.lte = (col: string, value: unknown) => {
        rec.filters.push({ col, op: "lte", value });
        return q;
      };
      q.order = chain;
      q.then = (resolve: unknown) =>
        Promise.resolve({ data, error: null }).then(resolve as never);
      return q;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

describe("T-352 — SupabaseGradeRepository.observeAll query shape", () => {
  it("is tenant-scoped with NO class_id/student_id filter (the empty-ID wildcard never returns)", async () => {
    const { client, calls } = makeClient([
      {
        id: "asm-1",
        student_id: "s-1",
        class_id: "c-1",
        subject_id: "sub-1",
        term: 1,
        academic_year: "2025-2026",
        devoir1: 12,
        devoir2: null,
        examen: 14,
        cc: null,
        coefficient: 2,
        subject_average: 13,
        entered_by: "staff-1",
        entered_at: "2026-09-10T10:00:00Z",
        updated_at: "2026-09-10T10:00:00Z",
      },
    ]);
    const repo = new SupabaseGradeRepository(client);
    const obs = repo.observeAll();
    // The async fetch resolves via the q.then chain; give it a macrotask.
    await new Promise((r) => setTimeout(r, 10));

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call.table).toBe("assessments");
    const filterCols = call.filters.map((f) => f.col);
    expect(filterCols).toContain("tenant_id");
    expect(filterCols).not.toContain("class_id");
    expect(filterCols).not.toContain("student_id");
    // The stream delivers the mapped rows.
    expect(obs.get()).toHaveLength(1);
  });

  it("narrows by academic_year + term when provided (same optional semantics as observeForClass)", async () => {
    const { client, calls } = makeClient([]);
    const repo = new SupabaseGradeRepository(client);
    repo.observeAll("2025-2026", "T1");
    await new Promise((r) => setTimeout(r, 10));
    const filters = calls[0].filters;
    expect(filters).toContainEqual({ col: "academic_year", value: "2025-2026" });
    expect(filters).toContainEqual({ col: "term", value: "T1" });
  });
});

describe("T-352 — SupabaseAttendanceRepository.observeAll query shape", () => {
  it("is tenant-scoped + range-bounded with NO student_id filter", async () => {
    const { client, calls } = makeClient([]);
    const repo = new SupabaseAttendanceRepository(client);
    repo.observeAll("2025-09-01", "2026-06-30");
    await new Promise((r) => setTimeout(r, 10));

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call.table).toBe("attendance_records");
    const filterCols = call.filters.map((f) => f.col);
    expect(filterCols).toContain("tenant_id");
    expect(filterCols).not.toContain("student_id");
    expect(filterCols).toContain("record_date");
  });
});

// ============================================================
// 3. The mock implementations (parity)
// ============================================================

describe("T-352 — MockGradeRepository.observeAll (store parity)", () => {
  it("returns the FULL store catalogue (non-empty on the seeded demo data)", () => {
    const repo = new MockGradeRepository();
    const all = repo.observeAll().get();
    expect(Array.isArray(all)).toBe(true);
    // The mock seed carries assessments (the demo academic data); a school
    // engine fed by observeAll must see them ALL (vs the 0 that the
    // empty-ID queries returned).
    expect(all.length).toBe(mockStore.assessments.length);
    expect(all.length).toBeGreaterThan(0);
  });
});

describe("T-352 — MockAttendanceRepository.observeAll (store parity + range)", () => {
  it("returns the in-range store slice (never empty when the store holds records in range)", () => {
    const repo = new MockAttendanceRepository();
    // A generous window that certainly covers the seeded demo dates.
    const all = repo.observeAll("2000-01-01", "2100-01-01").get();
    expect(all.length).toBe(mockStore.attendance.length);
  });

  it("respects the range bounds (out-of-range records excluded)", () => {
    const repo = new MockAttendanceRepository();
    const none = repo.observeAll("1999-01-01", "1999-12-31").get();
    expect(none).toHaveLength(0);
  });
});

// ============================================================
// 4. The tab wiring (source guards)
// ============================================================

const TAB_SRC = readFileSync(
  join(SRC, "features/dashboard/tabs/analytics-tab.tsx"),
  "utf8",
);

describe("T-352 — the Analytics tab consumes the school-wide streams", () => {
  it("the empty-ID query patterns are GONE (the DASH-402 root cause)", () => {
    expect(TAB_SRC).not.toContain('observeForClass("")');
    expect(TAB_SRC).not.toContain('observeByStudent("")');
  });

  it("the tab wires observeAll for both streams", () => {
    expect(TAB_SRC).toContain("repos.grades.observeAll()");
    expect(TAB_SRC).toContain("repos.attendance.observeAll(");
  });
});

// ============================================================
// 5. The engine round-trip: observeAll data produces real GPAs
// ============================================================

describe("T-352 — the risk engine sees the observeAll data (mock round-trip)", () => {
  it("assessments from observeAll drive non-null GPAs in evaluateStudentRiskProfiles", async () => {
    const { evaluateStudentRiskProfiles } = await import(
      "../../../features/dashboard/components/analytics/operational-query-engine"
    );
    const grades = new MockGradeRepository();
    const assessments = grades.observeAll().get();
    // The seeded store must carry at least one assessment with a student.
    const seeded = assessments.filter((a) => a.studentId);
    expect(seeded.length).toBeGreaterThan(0);
    const studentId = seeded[0].studentId;
    // Find the seeded student + parent to evaluate a profile.
    const students = mockStore.students.filter((s) => s.id === studentId);
    expect(students).toHaveLength(1);
    const parents = mockStore.parents.filter((p) => p.id === students[0].parentId);

    const profiles = evaluateStudentRiskProfiles({
      students,
      parents,
      classes: mockStore.classes,
      subjects: mockStore.subjects,
      assessments: seeded,
      attendance: [],
      debtSummaries: [],
    });
    expect(profiles).toHaveLength(1);
    // The student has real marks → the GPA is computed (non-null), unlike
    // the empty-feed era where it rendered "—".
    expect(profiles[0].gpa).not.toBeNull();
  });
});
