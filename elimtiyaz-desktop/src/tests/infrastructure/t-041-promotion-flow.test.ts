/**
 * T-041 — canonical year-end promotion flow regression suite
 * (ACAD-100 + ACAD-101 + BUSINESS-004).
 *
 * Problems covered:
 *  - ACAD-101: `SupabaseAcademicYearRepository.setCurrentYear()` /
 *    `createAcademicYear()` used a non-atomic two-step client UPDATE — the
 *    first call unset `is_current` for EVERY year of the tenant and the
 *    second could fail (network / RLS / timeout), leaving the tenant with
 *    NO current academic year (homework push, bulletins and dashboards all
 *    derive from `is_current=true`). The audit entry was never written
 *    (`_actorId` / `_actorName` were discarded, silenced by underscore
 *    prefixes).
 *  - BUSINESS-004 / ACAD-100: `SupabaseStudentRepository.promote()` returned
 *    a hard "not implemented" error in production; the batch flow
 *    (`SupabasePromotionRepository.executeBatchPromotion`) advanced students
 *    one-by-one with direct table UPDATEs — student N+1 could fail after
 *    students 1..N were already advanced (partial state), and the whole
 *    write path ran outside any server-side validation.
 *
 * Fix under test (migration 0059 + repository rewire):
 *  - setCurrentYear / createAcademicYear → ONE `set_current_academic_year`
 *    RPC call (atomic single-statement flip server-side).
 *  - executeBatchPromotion → ONE `execute_batch_promotion` RPC call with
 *    the full decisions array (history upsert + grade advance + graduation
 *    + audit, all in one transaction).
 *  - promote() → same RPC, progression derived from the canonical TS
 *    engine (getNextGradeProgression), 3eme_annee → graduated.
 *
 * The fake clients capture every PostgREST/RPC call so the tests assert
 * the exact wire contract.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  SupabaseAcademicYearRepository,
  SupabasePromotionRepository,
} from "../../infrastructure/supabase/repositories/supabase-academic-repository";
import { SupabaseStudentRepository } from "../../infrastructure/supabase/repositories/supabase-shared-repositories";
import type { PromotionCandidate } from "../../domain/calc/academics/promotion";
import type { Student, AcademicLevel, GradeLevel } from "../../domain/model/student";
import { GRADE_LEVELS } from "../../domain/model/student";

// T-053 (TENANT-103): tests that exercise tenant-scoped repositories set an
// explicit working tenant (the value the old fallback used to inject).
beforeAll(() => {
  localStorage.setItem(
    "el-imtiyaz.session",
    JSON.stringify({ tenantId: "00000000-0000-0000-0000-000000000001", userId: "staff-1" }),
  );
});
afterAll(() => {
  localStorage.removeItem("el-imtiyaz.session");
});

const TENANT = "00000000-0000-0000-0000-000000000001";

interface RpcCall {
  fn: string;
  args: Record<string, unknown>;
}
interface UpdateCall {
  table: string;
  values: Record<string, unknown>;
}
interface InsertCall {
  table: string;
  values: Record<string, unknown>;
}

function makeYearClient(rpcs: RpcCall[], updates: UpdateCall[], inserts: InsertCall[]) {
  const yearRow = {
    id: "11111111-1111-1111-1111-111111111111",
    tenant_id: TENANT,
    label: "2026-2027",
    code: "2026-2027",
    start_date: "2026-09-01",
    end_date: "2027-06-30",
    term_structure: "trimester",
    is_current: true,
    is_archived: false,
  };
  const rpcResult = { ...yearRow };
  const q: any = {
    select() { return q; },
    eq() { return q; },
    neq() { return q; },
    filter() { return q; },
    order() { return q; },
    in(_col: string, _vals: unknown[]) {
      return Promise.resolve({ data: [], error: null });
    },
    single() { return Promise.resolve({ data: rpcResult, error: null }); },
    maybeSingle() { return Promise.resolve({ data: rpcResult, error: null }); },
    insert(values: Record<string, unknown>) {
      inserts.push({ table: "academic_years", values });
      return q;
    },
    update(values: Record<string, unknown>) {
      updates.push({ table: "academic_years", values });
      return q;
    },
  };
  return {
    from(table: string) {
      return {
        ...q,
        update(values: Record<string, unknown>) {
          updates.push({ table, values });
          return q;
        },
        insert(values: Record<string, unknown>) {
          inserts.push({ table, values });
          return q;
        },
      };
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      rpcs.push({ fn, args });
      if (fn === "set_current_academic_year") {
        return { data: rpcResult, error: null };
      }
      return { data: { processed_count: 1, updated_student_ids: [] }, error: null };
    },
  } as unknown as SupabaseClient;
}

function makeStudentClient(rpcs: RpcCall[]) {
  const studentRow = (id: string, grade: string): Record<string, unknown> => ({
    id,
    tenant_id: TENANT,
    parent_id: "22222222-2222-2222-2222-222222222222",
    first_name: "Élève",
    last_name: "Test",
    grade_level_code: grade,
    class_id: null,
    enrollment_status: "active",
    is_active: true,
    created_at: "2026-09-01",
    updated_at: "2026-09-01",
  });
  const rows = [
    studentRow("33333333-3333-3333-3333-333333333333", "2am"),
    studentRow("44444444-4444-4444-4444-444444444444", "3eme_annee"),
  ];
  let callCount = 0;
  const q: any = {
    select() { return q; },
    eq() { return q; },
    in(_col: string, _vals: unknown[]) {
      callCount += 1;
      // First .in() call = initial fetch, second = refetch after RPC.
      const data = callCount === 1 ? rows : rows;
      return Promise.resolve({ data, error: null });
    },
  };
  return {
    from(_table: string) {
      return { ...q };
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      rpcs.push({ fn, args });
      return { data: { processed_count: 2, updated_student_ids: [] }, error: null };
    },
  } as unknown as SupabaseClient;
}

function fakeCandidate(grade: GradeLevel, nextGrade: GradeLevel | null, id: string): PromotionCandidate {
  const student = {
    id,
    parentId: "22222222-2222-2222-2222-222222222222",
    firstName: "Élève",
    lastName: "Test",
    birthDate: "2012-01-01",
    gender: "male" as const,
    gradeLevel: grade,
    level: "cem" as AcademicLevel,
    gradeYear: 2,
    classId: null,
    enrollmentStatus: "active" as const,
    updatedAt: "2026-09-01",
  } as unknown as Student;
  return {
    student,
    yearlyGpa: 12.5,
    suggestedDecision: "promoted",
    isPassing: true,
    nextGradeLevel: nextGrade,
    nextAcademicLevel: null,
    nextGradeYear: null,
  };
}

describe("T-041 — ACAD-101: atomic set-current-year", () => {
  it("setCurrentYear issues ONE set_current_academic_year RPC and NO direct table UPDATEs", async () => {
    const rpcs: RpcCall[] = [];
    const updates: UpdateCall[] = [];
    const inserts: InsertCall[] = [];
    const repo = new SupabaseAcademicYearRepository(makeYearClient(rpcs, updates, inserts));

    const result = await repo.setCurrentYear(
      "11111111-1111-1111-1111-111111111111",
      "staff-uuid-1",
      "Admin Test",
    );

    expect(result.ok).toBe(true);
    // The regression: the OLD implementation performed TWO sequential
    // .update() calls (unset-all, then set-one) and NO rpc call.
    expect(updates).toHaveLength(0);
    const rpc = rpcs.find((r) => r.fn === "set_current_academic_year");
    expect(rpc).toBeDefined();
    expect(rpc?.args.p_academic_year_id).toBe("11111111-1111-1111-1111-111111111111");
    expect(rpc?.args.p_actor_name).toBe("Admin Test");
    expect(rpc?.args.p_tenant_id).toBe(TENANT);
  });

  it("createAcademicYear inserts with is_current=false then flips via the atomic RPC (no unset-first UPDATE)", async () => {
    const rpcs: RpcCall[] = [];
    const updates: UpdateCall[] = [];
    const inserts: InsertCall[] = [];
    const repo = new SupabaseAcademicYearRepository(makeYearClient(rpcs, updates, inserts));

    const result = await repo.createAcademicYear(
      {
        code: "2027-2028",
        label: "2027-2028",
        startDate: "2027-09-01",
        endDate: "2028-06-30",
        termStructure: "trimester",
        isCurrent: true,
      } as any,
      "staff-uuid-1",
      "Admin Test",
    );

    expect(result.ok).toBe(true);
    // The regression: the OLD implementation unset is_current for the whole
    // tenant BEFORE inserting (a failed INSERT left the tenant with no
    // current year). The new contract inserts is_current=false…
    expect(inserts).toHaveLength(1);
    expect(inserts[0].values.is_current).toBe(false);
    // …and there is NO unset-first update at all.
    expect(updates).toHaveLength(0);
    // The flip happens through the atomic RPC instead.
    expect(rpcs.some((r) => r.fn === "set_current_academic_year")).toBe(true);
  });

  it("createAcademicYear with isCurrent=false does NOT call the flip RPC", async () => {
    const rpcs: RpcCall[] = [];
    const updates: UpdateCall[] = [];
    const inserts: InsertCall[] = [];
    const repo = new SupabaseAcademicYearRepository(makeYearClient(rpcs, updates, inserts));

    await repo.createAcademicYear(
      {
        code: "2028-2029",
        label: "2028-2029",
        startDate: "2028-09-01",
        endDate: "2029-06-30",
        termStructure: "trimester",
        isCurrent: false,
      } as any,
      "staff-uuid-1",
      "Admin Test",
    );

    expect(rpcs.filter((r) => r.fn === "set_current_academic_year")).toHaveLength(0);
    expect(inserts).toHaveLength(1);
  });
});

describe("T-041 — ACAD-100/BUSINESS-004: atomic batch promotion via RPC", () => {
  it("executeBatchPromotion sends ONE execute_batch_promotion RPC with the full decisions array and performs NO direct student/history writes", async () => {
    const rpcs: RpcCall[] = [];
    const updates: UpdateCall[] = [];
    const inserts: InsertCall[] = [];
    const repo = new SupabasePromotionRepository(makeYearClient(rpcs, updates, inserts));

    const result = await repo.executeBatchPromotion({
      candidates: [
        { candidate: fakeCandidate("2am", "3am", "33333333-3333-3333-3333-333333333333"), finalDecision: "promoted" },
        { candidate: fakeCandidate("3eme_annee", null, "44444444-4444-4444-4444-444444444444"), finalDecision: "graduated" },
      ],
      targetAcademicYear: "2026-2027",
      performedBy: "staff-uuid-1",
      performedByName: "Admin Test",
    });

    expect(result.ok).toBe(true);
    // The regression: the OLD implementation wrote each student one-by-one
    // (.from("students").update() + .from("student_academic_histories")
    // .upsert()) with no transaction.
    expect(updates).toHaveLength(0);
    expect(inserts).toHaveLength(0);
    expect(result.value.updatedCount).toBe(2);

    const rpc = rpcs.find((r) => r.fn === "execute_batch_promotion");
    expect(rpc).toBeDefined();
    const decisions = rpc!.args.p_decisions as Record<string, unknown>[];
    expect(decisions).toHaveLength(2);

    const promoted = decisions[0];
    expect(promoted.decision).toBe("promoted");
    expect(promoted.next_grade_code).toBe("3am");
    // The completed year (target 2026-2027 → history 2025-2026) is archived.
    expect(promoted.academic_year).toBe("2025-2026");
    expect(promoted.cycle).toBe("cem");
    expect(promoted.grade_code).toBe("2am");

    const graduated = decisions[1];
    expect(graduated.decision).toBe("graduated");
    expect(graduated.next_grade_code).toBeNull();
  });

  it("mock-era (non-UUID) student ids are filtered out of the RPC payload — the server would reject the whole batch on them", async () => {
    const rpcs: RpcCall[] = [];
    const updates: UpdateCall[] = [];
    const inserts: InsertCall[] = [];
    const repo = new SupabasePromotionRepository(makeYearClient(rpcs, updates, inserts));

    const result = await repo.executeBatchPromotion({
      candidates: [
        { candidate: fakeCandidate("2am", "3am", "stu-001"), finalDecision: "promoted" },
      ],
      targetAcademicYear: "2026-2027",
      performedBy: "staff-uuid-1",
      performedByName: "Admin Test",
    });

    expect(result.ok).toBe(true);
    expect(result.value.updatedCount).toBe(0);
    expect(rpcs.filter((r) => r.fn === "execute_batch_promotion")).toHaveLength(0);
  });
});

describe("T-041 — BUSINESS-004: SupabaseStudentRepository.promote() is implemented", () => {
  it("promote() routes through execute_batch_promotion with progression-derived decisions (2am→3am promoted, 3eme_annee→graduated)", async () => {
    const rpcs: RpcCall[] = [];
    const client = makeStudentClient(rpcs);
    const repo = new SupabaseStudentRepository(client);

    const result = await repo.promote(
      ["33333333-3333-3333-3333-333333333333", "44444444-4444-4444-4444-444444444444"],
      "2025-2026",
    );

    // The regression: the OLD implementation returned
    // Err(Errors.server("promote not implemented for Supabase repository")).
    expect(result.ok).toBe(true);
    const rpc = rpcs.find((r) => r.fn === "execute_batch_promotion");
    expect(rpc).toBeDefined();

    const decisions = rpc!.args.p_decisions as Record<string, unknown>[];
    expect(decisions).toHaveLength(2);
    expect(decisions[0].next_grade_code).toBe("3am");
    expect(decisions[0].decision).toBe("promoted");
    expect(decisions[1].decision).toBe("graduated");
    // The completed year is the history label.
    expect(decisions[0].academic_year).toBe("2025-2026");
  });

  it("promote() with no UUID ids short-circuits to an empty result without calling the RPC", async () => {
    const rpcs: RpcCall[] = [];
    const client = makeStudentClient(rpcs);
    const repo = new SupabaseStudentRepository(client);

    const result = await repo.promote(["stu-001", "stu-002"], "2025-2026");

    expect(result.ok).toBe(true);
    expect(result.value).toHaveLength(0);
    expect(rpcs).toHaveLength(0);
  });
});

describe("T-041 — canonical progression sanity (guards the RPC payload derivation)", () => {
  it("GRADE_LEVELS contains the full Algerian progression incl. the graduation terminal", () => {
    expect(GRADE_LEVELS).toContain("3eme_annee");
    expect(GRADE_LEVELS).toContain("1ap");
    expect(GRADE_LEVELS).toContain("prescolaire_1");
  });
});
