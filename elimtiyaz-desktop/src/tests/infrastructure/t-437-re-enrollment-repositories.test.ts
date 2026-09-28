/**
 * T-437 — the re-enrollment + student-origin repository/domain suite
 * (GitHub issue #18; migrations 0128+0129; ADR-031; academic-rules §10;
 * financial-rules §18).
 *
 * What this suite pins:
 *
 *   A. THE MOCK WORKFLOW (INV-21/22/23) — candidate generation from the
 *      active roster + the FINALIZED at-school histories (never recomputed),
 *      the idempotent regeneration (waiting rows refresh, decided rows are
 *      frozen facts), the decision state machine + guards, the composite
 *      re-enrollment (the EXISTING student is updated — never a duplicate
 *      person; the placement changes; the prior installments untouched), and
 *      the freeze semantics (refuses while waiting; blocks post-freeze).
 *   B. THE SHARED BILLING-WIRE BUILDER (INV-25a) — the batch shape (the
 *      historical `reg-`/bare source ids — the T-397/T-398 suites' exact
 *      tokens) vs the re-enrollment shape (year-scoped `re-<year>-` tokens);
 *      the SAME wire keys on both paths (one builder, never a second).
 *   C. THE SUPABASE WIRE SHAPES — fn_generate/fn_get/fn_set_decision/
 *      fn_re_enroll_student/fn_freeze called with the 0128 parameter names;
 *      the re-enroll payload's billing legs built by the shared builder.
 *   D. THE existingParentCode SEAM (STUDENT-501 / ADR-031 §7) — an EXISTING
 *      parent binds by its ACTUAL code (no duplicate parent; the billing
 *      legs written on the same family — the BUSINESS-109 repair).
 *   E. THE ORIGIN THREADING (STUDENT-502 / INV-24a) — createStudent carries
 *      the origin; batchRegister wires it (mock + the Supabase payload);
 *      mapStudentRow maps it; updateStudent patches it.
 *
 * Run:
 *   npx vitest run src/tests/infrastructure/t-437-re-enrollment-repositories.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  MockReEnrollmentRepository,
  resetMockReEnrollments,
} from "../../infrastructure/mock/repositories/re-enrollment-repository";
import { store } from "../../infrastructure/mock/repositories/mock-store";
import { MockStudentRepository } from "../../infrastructure/mock/repositories/student-repository";
import { MockParentRepository } from "../../infrastructure/mock/repositories/parent-repository";
import { SupabaseReEnrollmentRepository } from "../../infrastructure/supabase/repositories/supabase-academic-repository";
import { SupabaseStudentRepository } from "../../infrastructure/supabase/repositories/supabase-shared-repositories";
import { buildRegistrationBillingWires } from "../../infrastructure/supabase/repositories/registration-billing-wires";
import { mapStudentRow } from "../../infrastructure/supabase/repositories/supabase-shared-repositories";
import type { StudentRow } from "../../infrastructure/supabase/types";
import { defaultPricingConfig } from "../../infrastructure/mock/pricing-seed";
import type { CreateStudentInput } from "../../domain/model/student";
import { getNextGradeProgression } from "../../domain/calc/academics/promotion";

beforeAll(() => {
  localStorage.setItem(
    "el-imtiyaz.session",
    JSON.stringify({ tenantId: "00000000-0000-0000-0000-000000000001", userId: "staff-1" }),
  );
});
afterAll(() => {
  localStorage.removeItem("el-imtiyaz.session");
});

// ---------------------------------------------------------------------------
// The sandbox: a probe year pair + probe students on the mock store.
// ---------------------------------------------------------------------------

const PROBE_SOURCE = {
  id: "ay-t437-source",
  code: "2096-2097",
  label: "2096-2097",
};
const PROBE_TARGET = {
  id: "ay-t437-target",
  code: "2097-2098",
  label: "2097-2098",
};

function seedSandbox(): void {
  resetMockReEnrollments();
  // The probe years (isCurrent stays on whatever the store had).
  store.academicYears = [
    ...store.academicYears.filter((y) => y.id !== PROBE_SOURCE.id && y.id !== PROBE_TARGET.id),
    { ...PROBE_SOURCE, startDate: "2096-09-01", endDate: "2097-06-30", termStructure: "trimester", isCurrent: false, isArchived: false, createdAt: "2096-01-01", updatedAt: "2096-01-01" },
    { ...PROBE_TARGET, startDate: "2097-09-01", endDate: "2098-06-30", termStructure: "trimester", isCurrent: false, isArchived: false, createdAt: "2097-01-01", updatedAt: "2097-01-01" },
  ] as typeof store.academicYears;
}

const STUDENT_INPUT: CreateStudentInput = {
  firstName: "Sofiane",
  lastName: "T437",
  gender: "male",
  birthDate: "2012-03-03",
  level: "primaire",
  gradeYear: 5,
  gradeLevel: "5ap",
  origin: {
    originType: "transfer",
    previousSchoolName: "École Ibn Badis",
    previousSchoolLevel: "4AP",
    previousAcademicYear: "2095-2096",
    originNotes: "Transfert en cours d'année",
  },
};

// ===========================================================================
// A. THE MOCK WORKFLOW
// ===========================================================================
describe("T-437 A — the mock re-enrollment workflow (INV-21/22/23)", () => {
  it("A1: generates candidates from the ACTIVE roster (graduated/withdrawn excluded)", async () => {
    seedSandbox();
    const repo = new MockReEnrollmentRepository();
    const studentsBefore = [...store.students];
    // A graduated + a withdrawn probe student must NOT become candidates.
    const graduated = { ...studentsBefore[0], id: "stu-t437-grad", status: "graduated" as const };
    const withdrawn = { ...studentsBefore[1], id: "stu-t437-wd", status: "withdrawn" as const };
    store.students = [graduated, withdrawn, ...studentsBefore];

    const res = await repo.generateCandidates({
      sourceAcademicYearId: PROBE_SOURCE.id,
      targetAcademicYearId: PROBE_TARGET.id,
      performedBy: "staff-1",
      performedByName: "Test",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const list = await repo.listCandidates(PROBE_TARGET.id);
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.value.totalCount).toBeGreaterThan(0);
    expect(list.value.candidates.find((c) => c.studentId === "stu-t437-grad")).toBeUndefined();
    expect(list.value.candidates.find((c) => c.studentId === "stu-t437-wd")).toBeUndefined();
    // The counts + the red-badge aggregate.
    expect(list.value.waitingCount).toBe(list.value.totalCount);
    expect(list.value.frozen).toBe(false);
  });

  it("A2: enriches the finalized snapshot from the at-school history (repeated → expected = the source grade; promoted → the current grade)", async () => {
    seedSandbox();
    const repo = new MockReEnrollmentRepository();
    const base = store.students[0];
    // A finalized 2096-2097 history: REPEATED in 4ap.
    const repeatedStudent = {
      ...base,
      id: "stu-t437-repeated",
      gradeLevel: "4ap" as const,
      status: "active" as const,
      academicHistory: [
        {
          studentId: "stu-t437-repeated",
          academicYear: PROBE_SOURCE.code,
          cycle: "primaire",
          level: "primaire",
          gradeCode: "4ap",
          gradeYear: 4,
          classId: null,
          className: "Classe A",
          gpa: 9.25,
          rank: null,
          decision: "repeated" as const,
          narrative: null,
        },
      ],
    };
    const promotedStudent = {
      ...base,
      id: "stu-t437-promoted",
      gradeLevel: "5ap" as const, // 0059 advanced it on promotion
      status: "active" as const,
      academicHistory: [
        {
          studentId: "stu-t437-promoted",
          academicYear: PROBE_SOURCE.code,
          cycle: "primaire",
          level: "primaire",
          gradeCode: "4ap",
          gradeYear: 4,
          classId: null,
          className: "Classe A",
          gpa: 14.5,
          rank: 3,
          decision: "promoted" as const,
          narrative: null,
        },
      ],
    };
    store.students = [repeatedStudent, promotedStudent];

    await repo.generateCandidates({
      sourceAcademicYearId: PROBE_SOURCE.id,
      targetAcademicYearId: PROBE_TARGET.id,
      performedBy: "staff-1",
      performedByName: "Test",
    });
    const list = await repo.listCandidates(PROBE_TARGET.id);
    expect(list.ok).toBe(true);
    if (!list.ok) return;

    const repeated = list.value.candidates.find((c) => c.studentId === "stu-t437-repeated")!;
    expect(repeated.finalDecision).toBe("repeated");
    expect(repeated.finalAverage).toBe(9.25);
    expect(repeated.sourceGradeLevelCode).toBe("4ap");
    expect(repeated.expectedGradeLevelCode).toBe("4ap"); // INV-22c: repeated → the source grade

    const promoted = list.value.candidates.find((c) => c.studentId === "stu-t437-promoted")!;
    expect(promoted.finalDecision).toBe("promoted");
    expect(promoted.expectedGradeLevelCode).toBe("5ap"); // INV-22c: promoted → the CURRENT (advanced) grade
  });

  it("A3: the history-less candidate carries the honest non-finalized state + the derived progression", async () => {
    seedSandbox();
    const repo = new MockReEnrollmentRepository();
    const base = store.students[0];
    store.students = [{ ...base, id: "stu-t437-nofinal", gradeLevel: "3ap" as const, status: "active" as const, academicHistory: [] }];

    await repo.generateCandidates({
      sourceAcademicYearId: PROBE_SOURCE.id,
      targetAcademicYearId: PROBE_TARGET.id,
      performedBy: "staff-1",
      performedByName: "Test",
    });
    const list = await repo.listCandidates(PROBE_TARGET.id);
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    const c = list.value.candidates.find((x) => x.studentId === "stu-t437-nofinal")!;
    expect(c.finalDecision).toBeNull(); // INV-22b: « non finalisé »
    expect(c.finalAverage).toBeNull();
    expect(c.expectedGradeLevelCode).toBe(
      getNextGradeProgression("3ap").nextGradeCode,
    ); // INV-22c: the canonical derivation
  });

  it("A4: the idempotent regeneration refreshes ONLY waiting rows (decided rows are frozen facts)", async () => {
    seedSandbox();
    const repo = new MockReEnrollmentRepository();
    const base = store.students[0];
    store.students = [{ ...base, id: "stu-t437-idem", gradeLevel: "4ap" as const, status: "active" as const, academicHistory: [] }];

    const first = await repo.generateCandidates({
      sourceAcademicYearId: PROBE_SOURCE.id,
      targetAcademicYearId: PROBE_TARGET.id,
      performedBy: "staff-1",
      performedByName: "Test",
    });
    expect(first.ok && first.value.totalRows).toBe(1);

    // Decide the candidate, then regenerate — the row count stays 1 and the
    // decision survives.
    await repo.setDecision({
      reEnrollmentId: `re-stu-t437-idem-${PROBE_TARGET.id}`,
      decision: "not_continuing",
      notes: null,
      performedBy: "staff-1",
      performedByName: "Test",
    });
    const second = await repo.generateCandidates({
      sourceAcademicYearId: PROBE_SOURCE.id,
      targetAcademicYearId: PROBE_TARGET.id,
      performedBy: "staff-1",
      performedByName: "Test",
    });
    expect(second.ok && second.value.totalRows).toBe(1);
    const list = await repo.listCandidates(PROBE_TARGET.id);
    expect(list.ok && list.value.candidates[0]?.status).toBe("not_continuing");
  });

  it("A5: the decision state machine + the guards (terminal re_enrolled, freeze blocks)", async () => {
    seedSandbox();
    const repo = new MockReEnrollmentRepository();
    const base = store.students[0];
    store.students = [{ ...base, id: "stu-t437-machine", gradeLevel: "4ap" as const, status: "active" as const, academicHistory: [] }];
    const reId = `re-stu-t437-machine-${PROBE_TARGET.id}`;
    await repo.generateCandidates({
      sourceAcademicYearId: PROBE_SOURCE.id,
      targetAcademicYearId: PROBE_TARGET.id,
      performedBy: "staff-1",
      performedByName: "Test",
    });

    // waiting → started → waiting (reversible pre-freeze).
    await repo.setDecision({ reEnrollmentId: reId, decision: "started", notes: null, performedBy: "s", performedByName: "T" });
    let list = await repo.listCandidates(PROBE_TARGET.id);
    expect(list.ok && list.value.candidates[0]?.status).toBe("started");
    await repo.setDecision({ reEnrollmentId: reId, decision: "waiting", notes: null, performedBy: "s", performedByName: "T" });
    list = await repo.listCandidates(PROBE_TARGET.id);
    expect(list.ok && list.value.candidates[0]?.status).toBe("waiting");

    // The composite re-enrollment (minimal billing legs).
    const reRes = await repo.reEnroll({
      reEnrollmentId: reId,
      gradeLevelCode: "5ap",
      classId: null,
      paymentPlan: "tranches",
      transportTier: null,
      installments: [
        {
          id: "ins-t437-1",
          parentId: store.parents[0].id,
          studentId: "stu-t437-machine",
          category: "tuition",
          trancheNumber: 1,
          label: "Tranche 1",
          amountDue: 40000,
          amountPaid: 0,
          amountPending: 0,
          dueDate: "2097-09-15",
          paidDate: null,
          status: "unpaid",
          paymentPlan: "tranches",
        },
      ] as never,
      ledgerEntries: [] as never,
      notes: null,
    });
    expect(reRes.ok).toBe(true);
    if (!reRes.ok) return;

    // INV-21a: the SAME student row — updated placement, no duplicate person.
    const student = store.students.find((s) => s.id === "stu-t437-machine")!;
    expect(student.gradeLevel).toBe("5ap");
    expect(store.students.filter((s) => s.id === "stu-t437-machine").length).toBe(1);
    // INV-25c: the installment stamped with the TARGET year id.
    const stamped = store.installments.find((i) => i.id === "ins-t437-1");
    expect(stamped?.academicYearId).toBe(PROBE_TARGET.id);

    // re_enrolled is terminal pre-freeze.
    const after = await repo.setDecision({ reEnrollmentId: reId, decision: "not_continuing", notes: null, performedBy: "s", performedByName: "T" });
    expect(after.ok).toBe(false);

    // The freeze refuses while a waiting candidate remains (add one more).
    const extra = { ...base, id: "stu-t437-wait2", gradeLevel: "4ap" as const, status: "active" as const, academicHistory: [] };
    store.students = [...store.students, extra];
    await repo.generateCandidates({
      sourceAcademicYearId: PROBE_SOURCE.id,
      targetAcademicYearId: PROBE_TARGET.id,
      performedBy: "staff-1",
      performedByName: "Test",
    });
    const refused = await repo.freeze(PROBE_TARGET.id, "staff-1", "Test");
    expect(refused.ok).toBe(false);

    await repo.setDecision({ reEnrollmentId: `re-stu-t437-wait2-${PROBE_TARGET.id}`, decision: "not_continuing", notes: null, performedBy: "s", performedByName: "T" });
    const frozen = await repo.freeze(PROBE_TARGET.id, "staff-1", "Test");
    expect(frozen.ok && frozen.value.frozenCount).toBe(2);
    list = await repo.listCandidates(PROBE_TARGET.id);
    expect(list.ok && list.value.frozen).toBe(true);
    // Post-freeze: the generation + the decisions are refused.
    const genAfter = await repo.generateCandidates({
      sourceAcademicYearId: PROBE_SOURCE.id,
      targetAcademicYearId: PROBE_TARGET.id,
      performedBy: "staff-1",
      performedByName: "Test",
    });
    expect(genAfter.ok).toBe(false);
  });
});

// ===========================================================================
// B. THE SHARED BILLING-WIRE BUILDER
// ===========================================================================
describe("T-437 B — the shared billing-wire builder (INV-25a)", () => {
  const sharedInput = {
    tenantId: "00000000-0000-0000-0000-000000000001",
    parentCode: "PAR-2097-T437",
    students: [
      {
        studentCode: "ELV-2097-T437",
        studentRef: 0,
        gradeLevel: "4ap" as const,
        paymentPlan: "tranches" as const,
        transportTier: null,
        remise: 0,
        chargeStickerPrice: false,
      },
    ],
    pricingConfig: defaultPricingConfig,
    includeRegistration: true,
    includeTransport: false,
    year: 2097,
    at: "2097-09-01T10:00:00.000Z",
    parentTransportDestination: null,
  };

  it("B1: the batch shape keeps the historical tokens (reg-/bare — the T-397/T-398 pins)", () => {
    const { ledgerWire, installmentWire } = buildRegistrationBillingWires(sharedInput);
    expect(installmentWire.length).toBe(3);
    for (const inst of installmentWire) {
      expect(inst.source_id).toBe(`ELV-2097-T437:tuition:T${inst.tranche_number}`);
      expect(inst.student_ref).toBe(0);
    }
    const fee = ledgerWire.find((l) => l.category === "other");
    expect(fee?.source_id).toBe("reg-PAR-2097-T437-fee");
    const tuitionLedger = ledgerWire.filter((l) => l.category === "tuition");
    for (const l of tuitionLedger) {
      expect(String(l.source_id).startsWith("reg-ELV-2097-T437-t")).toBe(true);
    }
  });

  it("B2: the re-enrollment shape scopes every token by the target year", () => {
    const { ledgerWire, installmentWire } = buildRegistrationBillingWires({
      ...sharedInput,
      sourceIdScope: { prefix: "re-2097-2098", yearCode: "2097-2098" },
      feeDescription: "Frais d'inscription 2097-2098 (réinscription)",
    });
    for (const inst of installmentWire) {
      expect(inst.source_id).toBe(`re-2097-2098-ELV-2097-T437:tuition:T${inst.tranche_number}`);
    }
    const fee = ledgerWire.find((l) => l.category === "other");
    expect(fee?.source_id).toBe("re-2097-2098-PAR-2097-T437-fee");
    expect(fee?.description).toBe("Frais d'inscription 2097-2098 (réinscription)");
    // The year-scoped tokens can never collide with the batch tokens nor
    // with a LATER year's re-enrollment (the DATA-054 lesson).
    expect(fee?.source_id).not.toContain("reg-");
  });

  it("B3: one builder — the SAME wire keys on both paths (never a second shape)", () => {
    const batch = buildRegistrationBillingWires(sharedInput);
    const reEnroll = buildRegistrationBillingWires({
      ...sharedInput,
      sourceIdScope: { prefix: "re-2097-2098", yearCode: "2097-2098" },
    });
    const batchKeys = Object.keys(batch.installmentWire[0]).sort().join(",");
    const reKeys = Object.keys(reEnroll.installmentWire[0]).sort().join(",");
    expect(reKeys).toBe(batchKeys);
    const batchLedgerKeys = Object.keys(batch.ledgerWire[0]).sort().join(",");
    const reLedgerKeys = Object.keys(reEnroll.ledgerWire[0]).sort().join(",");
    expect(reLedgerKeys).toBe(batchLedgerKeys);
  });
});

// ===========================================================================
// C. THE SUPABASE WIRE SHAPES (the counting-client pattern)
// ===========================================================================
describe("T-437 C — the Supabase repository mirrors the 0128 RPCs 1:1", () => {
  function makeClient() {
    const calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
    const client = {
      rpc: (name: string, args?: Record<string, unknown>) => {
        calls.push({ name, args });
        if (name === "fn_generate_re_enrollment_candidates") {
          return Promise.resolve({
            data: {
              ok: true,
              source_academic_year: "2096-2097",
              target_academic_year: "2097-2098",
              candidates_written: 12,
              total_rows: 12,
            },
            error: null,
          });
        }
        if (name === "fn_get_re_enrollment_candidates") {
          return Promise.resolve({
            data: [
              {
                re_enrollment_id: "11111111-1111-1111-1111-111111111111",
                student_id: "22222222-2222-2222-2222-222222222222",
                student_code: "ELV-2097-T437",
                student_first_name: "Sofiane",
                student_last_name: "T437",
                student_grade_level: "4ap",
                student_class_id: null,
                parent_id: "33333333-3333-3333-3333-333333333333",
                parent_code: "PAR-2097-T437",
                parent_display_name: "Parent T437",
                parent_phone: "0550000000",
                source_academic_year: "2096-2097",
                target_academic_year: "2097-2098",
                source_grade_level_code: "4ap",
                source_class_name: "Classe A",
                final_decision: "repeated",
                final_average: 9.25,
                expected_grade_level_code: "4ap",
                status: "waiting",
                target_class_id: null,
                target_class_name: null,
                decided_at: null,
                decided_by_name: null,
                re_enrolled_at: null,
                installments_written: null,
                notes: null,
                frozen_at: null,
                created_at: "2097-08-01T00:00:00Z",
              },
            ],
            error: null,
          });
        }
        if (name === "fn_set_re_enrollment_decision" || name === "fn_freeze_re_enrollments") {
          return Promise.resolve({ data: { ok: true }, error: null });
        }
        if (name === "fn_re_enroll_student") {
          return Promise.resolve({
            data: {
              ok: true,
              re_enrollment_id: "11111111-1111-1111-1111-111111111111",
              student_id: "22222222-2222-2222-2222-222222222222",
              student_code: "ELV-2097-T437",
              target_academic_year: "2097-2098",
              installments_written: 3,
              ledger_written: 3,
            },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: { message: `unexpected rpc ${name}` } });
      },
    };
    return { client: client as unknown as SupabaseClient, calls };
  }

  it("C1: generateCandidates → fn_generate with the 0128 parameter names", async () => {
    const { client, calls } = makeClient();
    const repo = new SupabaseReEnrollmentRepository(client);
    const res = await repo.generateCandidates({
      sourceAcademicYearId: "aaaaaaaa-0000-0000-0000-000000000001",
      targetAcademicYearId: "aaaaaaaa-0000-0000-0000-000000000002",
      performedBy: "staff-1",
      performedByName: "Test",
    });
    expect(res.ok).toBe(true);
    expect(calls[0].name).toBe("fn_generate_re_enrollment_candidates");
    expect(calls[0].args).toMatchObject({
      p_source_academic_year_id: "aaaaaaaa-0000-0000-0000-000000000001",
      p_target_academic_year_id: "aaaaaaaa-0000-0000-0000-000000000002",
      p_actor_name: "Test",
    });
    if (res.ok) {
      expect(res.value.candidatesWritten).toBe(12);
      expect(res.value.targetAcademicYear).toBe("2097-2098");
    }
  });

  it("C2: listCandidates maps the wire rows + the counts", async () => {
    const { client } = makeClient();
    const repo = new SupabaseReEnrollmentRepository(client);
    const res = await repo.listCandidates("aaaaaaaa-0000-0000-0000-000000000002");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.totalCount).toBe(1);
    expect(res.value.waitingCount).toBe(1);
    const c = res.value.candidates[0];
    expect(c.reEnrollmentId).toBe("11111111-1111-1111-1111-111111111111");
    expect(c.finalDecision).toBe("repeated");
    expect(c.finalAverage).toBe(9.25);
    expect(c.parentDisplayName).toBe("Parent T437");
  });

  it("C3: reEnroll → fn_re_enroll_student with the billing legs built by the SHARED builder (year-scoped tokens)", async () => {
    const { client, calls } = makeClient();
    const repo = new SupabaseReEnrollmentRepository(client);
    const { ledgerWire, installmentWire } = buildRegistrationBillingWires({
      tenantId: "00000000-0000-0000-0000-000000000001",
      parentCode: "PAR-2097-T437",
      students: [
        {
          studentCode: "ELV-2097-T437",
          studentRef: 0,
          gradeLevel: "4ap",
          paymentPlan: "tranches",
          transportTier: null,
          remise: 0,
          chargeStickerPrice: false,
        },
      ],
      pricingConfig: defaultPricingConfig,
      includeRegistration: false,
      includeTransport: false,
      year: 2097,
      at: "2097-09-01T10:00:00.000Z",
      parentTransportDestination: null,
      sourceIdScope: { prefix: "re-2097-2098", yearCode: "2097-2098" },
    });
    const res = await repo.reEnroll({
      reEnrollmentId: "11111111-1111-1111-1111-111111111111",
      gradeLevelCode: "5ap",
      classId: null,
      paymentPlan: "tranches",
      transportTier: null,
      installments: installmentWire,
      ledgerEntries: ledgerWire,
      notes: null,
    });
    expect(res.ok).toBe(true);
    const call = calls.find((c) => c.name === "fn_re_enroll_student");
    expect(call).toBeDefined();
    expect(call?.args).toMatchObject({
      p_re_enrollment_id: "11111111-1111-1111-1111-111111111111",
      p_grade_level_code: "5ap",
      p_payment_plan: "tranches",
    });
    const installments = call?.args?.p_installments as Record<string, unknown>[];
    expect(installments.length).toBe(3);
    // The wire shape the 0128 jsonb_to_recordset expects (no student_ref —
    // the single-student composite derives the uuid server-side).
    for (const i of installments) {
      expect(i.source_id).toBe(`re-2097-2098-ELV-2097-T437:tuition:T${i.tranche_number}`);
    }
  });
});

// ===========================================================================
// D. THE existingParentCode SEAM (STUDENT-501 / BUSINESS-109)
// ===========================================================================
describe("T-437 D — the existingParentCode seam (ADR-031 §7)", () => {
  it("D1: the mock batchRegister reuses the EXISTING parent (no duplicate) and writes the billing on the same family", async () => {
    seedSandbox();
    const parentsBefore = store.parents.length;
    const studentsRepo = new MockStudentRepository();
    const parentsRepo = new MockParentRepository();
    const created = await parentsRepo.createParent({
      firstName: "Karim",
      lastName: "T437Parent",
      gender: "male",
      phone: "0551234567",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const existing = created.value;

    const res = await studentsRepo.batchRegister({
      parent: {
        firstName: existing.firstName,
        lastName: existing.lastName,
        gender: "male",
        phone: existing.phone,
      },
      existingParentCode: existing.code,
      students: [{ ...STUDENT_INPUT, firstName: "Fils", lastName: "T437Parent" }],
      includeRegistration: true,
      includeTransport: false,
    });
    expect(res.ok).toBe(true);
    // NO duplicate parent.
    expect(store.parents.filter((p) => p.phone === existing.phone).length).toBe(1);
    expect(store.parents.length).toBe(parentsBefore + 1); // only the createParent probe
    // The billing WAS written (the BUSINESS-109 repair — the shown devis is persisted).
    const newStudent = store.students.find((s) => s.firstName === "Fils");
    expect(newStudent).toBeDefined();
    expect(
      store.installments.filter((i) => i.studentId === newStudent!.id).length,
    ).toBeGreaterThan(0);
    // The origin was captured (INV-24a).
    expect(newStudent?.origin?.previousSchoolName).toBe("École Ibn Badis");
  });

  it("D2: the Supabase batchRegister passes the ACTUAL code in the parent wire (the identity match binds)", async () => {
    const calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
    const client = {
      rpc: (name: string, args?: Record<string, unknown>) => {
        calls.push({ name, args });
        if (name === "register_family_batch") {
          const p = (args?.p_parent ?? {}) as Record<string, unknown>;
          const parentRow = {
            id: "44444444-4444-4444-4444-444444444444",
            tenant_id: args?.p_tenant_id,
            parent_code: p.parent_code,
            first_name: p.first_name,
            last_name: p.last_name,
            primary_phone: p.primary_phone,
            display_name: p.display_name,
            is_active: true,
            deleted_at: null,
            created_at: "2097-01-01",
            updated_at: "2097-01-01",
          };
          const students = ((args?.p_students ?? []) as Record<string, unknown>[]).map((s) => ({
            id: "55555555-5555-5555-5555-555555555555",
            tenant_id: args?.p_tenant_id,
            student_code: s.student_code,
            parent_id: parentRow.id,
            first_name: s.first_name,
            last_name: s.last_name,
            display_name: s.display_name,
            date_of_birth: s.date_of_birth,
            gender: s.gender,
            class_id: s.class_id,
            medical_notes: s.medical_notes,
            grade_level_code: s.grade_level_code,
            transport_tier: s.transport_tier,
            payment_plan: s.payment_plan,
            enrollment_status: s.enrollment_status,
            is_active: true,
            deleted_at: null,
            created_at: "2097-01-01",
            updated_at: "2097-01-01",
            enrollment_date: "2097-09-01",
          }));
          return Promise.resolve({
            data: [
              {
                out_parent: parentRow,
                out_students: students,
                out_ledger_written: 0,
                out_installments_written: 0,
              },
            ],
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: { message: `unexpected rpc ${name}` } });
      },
    };
    const repo = new SupabaseStudentRepository(client as unknown as SupabaseClient);
    const res = await repo.batchRegister({
      parent: { firstName: "Karim", lastName: "T437", gender: "male", phone: "0551234567" },
      existingParentCode: "PAR-2026-EXISTING",
      students: [STUDENT_INPUT],
      includeRegistration: false,
      includeTransport: false,
      pricingConfig: defaultPricingConfig,
    });
    expect(res.ok).toBe(true);
    const call = calls.find((c) => c.name === "register_family_batch");
    const parentWire = call?.args?.p_parent as Record<string, unknown>;
    expect(parentWire.parent_code).toBe("PAR-2026-EXISTING");
    // The origin rides the jsonb wire (INV-24a).
    const studentWire = (call?.args?.p_students as Record<string, unknown>[])[0];
    expect(studentWire.origin_type).toBe("transfer");
    expect(studentWire.previous_school_name).toBe("École Ibn Badis");
  });
});

// ===========================================================================
// E. THE ORIGIN THREADING (STUDENT-502 / INV-24a)
// ===========================================================================
describe("T-437 E — the origin threading", () => {
  it("E1: mapStudentRow maps the origin block (and stays undefined for the pre-0128 rows)", () => {
    const rowWithOrigin: StudentRow = {
      id: "66666666-6666-6666-6666-666666666666",
      tenant_id: "t",
      parent_id: "p",
      student_code: "ELV-1",
      first_name: "A",
      middle_name: null,
      last_name: "B",
      display_name: null,
      date_of_birth: "2012-01-01",
      gender: "male",
      grade_level_id: null,
      class_id: null,
      filiere_code: null,
      specialite_code: null,
      enrollment_date: "2097-09-01",
      enrollment_status: "active",
      medical_notes: null,
      is_active: true,
      auth_user_id: null,
      origin_type: "transfer",
      previous_school_name: "École X",
      previous_school_level: "4AP",
      previous_academic_year: "2096-2097",
      origin_notes: "note",
      created_at: "2097-01-01",
      updated_at: "2097-01-01",
      deleted_at: null,
    };
    const mapped = mapStudentRow(rowWithOrigin);
    expect(mapped.origin?.originType).toBe("transfer");
    expect(mapped.origin?.previousSchoolName).toBe("École X");
    expect(mapped.origin?.previousAcademicYear).toBe("2096-2097");

    const legacyRow = { ...rowWithOrigin } as StudentRow;
    for (const k of ["origin_type", "previous_school_name", "previous_school_level", "previous_academic_year", "origin_notes"]) {
      delete (legacyRow as Record<string, unknown>)[k];
    }
    const legacyMapped = mapStudentRow(legacyRow);
    expect(legacyMapped.origin).toBeUndefined();
  });

  it("E2: the mock createStudent persists the origin and updateStudent patches it", async () => {
    seedSandbox();
    const parentsRepo = new MockParentRepository();
    const studentsRepo = new MockStudentRepository();
    const parent = await parentsRepo.createParent({
      firstName: "Origin",
      lastName: "T437",
      gender: "female",
      phone: "0559876543",
    });
    expect(parent.ok).toBe(true);
    if (!parent.ok) return;
    const created = await studentsRepo.createStudent(parent.value.id, STUDENT_INPUT);
    expect(created.ok).toBe(true);
    expect(created.value.origin?.originType).toBe("transfer");

    const updated = await studentsRepo.updateStudent(created.value.id, {
      origin: {
        originType: "new_admission",
        previousSchoolName: "École Y",
        previousSchoolLevel: null,
        previousAcademicYear: null,
        originNotes: null,
      },
    });
    expect(updated.ok).toBe(true);
    expect(updated.value.origin?.originType).toBe("new_admission");
    expect(updated.value.origin?.previousSchoolName).toBe("École Y");
  });
});
