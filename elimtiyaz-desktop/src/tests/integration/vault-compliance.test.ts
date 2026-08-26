/**
 * Vault-compliance regression tests (requirements vault sections 04/05/06 —
 * "Make sure all the instructions in this vault are implemented").
 *
 * Locks in the behaviors added to close the audit gaps:
 *   §04.03 — batch registration persists middleName + classId per child.
 *   §04.06 — student documents round-trip through updateStudent.
 *   §04.07 / §06.05 — append-only history: grade entry is REJECTED for
 *                     archived academic years (all-or-nothing for batches).
 *   §05.06 — coefficient edits re-weight stored assessment snapshots for
 *             NON-archived years only (automatic GPA recompute); archived
 *             years are left untouched.
 *
 * These tests intentionally reuse the shared mock store like the other
 * integration suites (see pedagogy-repositories.test.ts) and restore any
 * mutated seed rows in `afterEach` so sibling suites stay deterministic.
 */
import { describe, it, expect, afterEach } from "vitest";
import { store } from "../../infrastructure/mock/repositories/mock-store";
import {
  MockSubjectRepository,
  MockGradeRepository,
} from "../../infrastructure/mock/repositories/academic-repository";
import { MockStudentRepository } from "../../infrastructure/mock/repositories/student-repository";
import type { Assessment } from "../../domain/model/academic";
import type { Student } from "../../domain/model/student";
import { TEST_ACTOR } from "../_helpers/finance-isolation";

const ACTOR = TEST_ACTOR;
const CURRENT_YEAR = "2025-2026"; // seeded current year
const ARCHIVED_YEAR = "2024-2025"; // seeded archived year

/** Rows this suite appends to the store — cleaned up in afterEach. */
const appendedAssessmentIds = new Set<string>();
const appendedStudentIds = new Set<string>();

afterEach(() => {
  // Remove synthetic assessments.
  if (appendedAssessmentIds.size > 0) {
    store.assessments = store.assessments.filter(
      (a) => !appendedAssessmentIds.has(a.id),
    );
    appendedAssessmentIds.clear();
    store.notifyAssessments();
  }
  // Remove synthetic students (batch registration tests).
  if (appendedStudentIds.size > 0) {
    store.students = store.students.filter((s) => !appendedStudentIds.has(s.id));
    appendedStudentIds.clear();
    store.notifyStudents();
  }
  // Restore the seeded Math coefficient (sub-003 = 4) in case a test changed it.
  const math = store.subjects.find((s) => s.id === "sub-003");
  if (math && math.coefficient !== 4) {
    store.subjects = store.subjects.map((s) =>
      s.id === "sub-003" ? { ...s, coefficient: 4 } : s,
    );
    store.subjects$.set(store.subjects);
    // Restore assessment snapshots for the seeded coefficient.
    store.assessments = store.assessments.map((a) =>
      a.subjectId === "sub-003" && !appendedAssessmentIds.has(a.id)
        ? { ...a, coefficient: 4 }
        : a,
    );
    store.notifyAssessments();
  }
});

function makeAssessment(partial: Partial<Assessment> & { id: string }): Assessment {
  const base: Assessment = {
    id: partial.id,
    studentId: partial.studentId ?? "stu-001",
    classId: partial.classId ?? "cls-001",
    subjectId: partial.subjectId ?? "sub-003",
    term: partial.term ?? "T1",
    academicYear: partial.academicYear ?? CURRENT_YEAR,
    devoir1: partial.devoir1 ?? 14,
    devoir2: partial.devoir2 ?? 16,
    examen: partial.examen ?? 18,
    subjectAverage: partial.subjectAverage ?? 16.5,
    coefficient: partial.coefficient ?? 4,
    enteredBy: ACTOR.actorId,
    enteredAt: new Date().toISOString(),
  };
  return base;
}

describe("§04.07 / §06.05 — append-only history: archived-year grade entry is rejected", () => {
  const grades = new MockGradeRepository();

  it("enterGrade rejects a write targeting an archived academic year", async () => {
    const before = store.assessments.length;
    const res = await grades.enterGrade({
      studentId: "stu-001",
      classId: "cls-001",
      subjectId: "sub-003",
      term: "T1",
      academicYear: ARCHIVED_YEAR,
      devoir1: 12,
      devoir2: 12,
      examen: 12,
      coefficient: 4,
      enteredBy: ACTOR.actorId,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.userMessage).toMatch(/archiv/i);
    expect(store.assessments.length).toBe(before);
  });

  it("enterGradesBatch rejects the WHOLE batch when any row targets an archived year", async () => {
    const before = store.assessments.length;
    const res = await grades.enterGradesBatch([
      {
        studentId: "stu-001",
        classId: "cls-001",
        subjectId: "sub-003",
        term: "T2",
        academicYear: CURRENT_YEAR,
        devoir1: 10,
        devoir2: 11,
        examen: 12,
        coefficient: 4,
        enteredBy: ACTOR.actorId,
      },
      {
        studentId: "stu-002",
        classId: "cls-001",
        subjectId: "sub-003",
        term: "T2",
        academicYear: ARCHIVED_YEAR,
        devoir1: 10,
        devoir2: 11,
        examen: 12,
        coefficient: 4,
        enteredBy: ACTOR.actorId,
      },
    ]);
    expect(res.ok).toBe(false);
    expect(store.assessments.length).toBe(before);
  });

  it("enterGrade still succeeds for the current (non-archived) year", async () => {
    const before = store.assessments.length;
    const res = await grades.enterGrade({
      studentId: "stu-001",
      classId: "cls-001",
      subjectId: "sub-003",
      term: "T3",
      academicYear: CURRENT_YEAR,
      devoir1: 15,
      devoir2: 15,
      examen: 15,
      coefficient: 4,
      enteredBy: ACTOR.actorId,
    });
    expect(res.ok).toBe(true);
    expect(store.assessments.length).toBe(before + 1);
    if (res.ok) appendedAssessmentIds.add(res.value.id);
  });
});

describe("§05.06 — coefficient edits trigger GPA recompute (assessment re-weighting)", () => {
  const subjects = new MockSubjectRepository();

  it("re-weights stored assessment snapshots for the CURRENT year only", async () => {
    // Synthetic archived-year assessment for the same subject — must survive.
    const archivedAsm = makeAssessment({
      id: "asm-vault-archived",
      academicYear: ARCHIVED_YEAR,
      coefficient: 4,
    });
    const currentYearMathBefore = store.assessments.filter(
      (a) => a.subjectId === "sub-003" && a.academicYear === CURRENT_YEAR,
    );
    store.assessments = [archivedAsm, ...store.assessments];
    appendedAssessmentIds.add(archivedAsm.id);
    store.notifyAssessments();

    const res = await subjects.updateSubject("sub-003", { coefficient: 5 });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.coefficient).toBe(5);

    // Current-year snapshots re-weighted → GPAs recompute automatically.
    const currentYearMathAfter = store.assessments.filter(
      (a) => a.subjectId === "sub-003" && a.academicYear === CURRENT_YEAR,
    );
    expect(currentYearMathAfter.length).toBe(currentYearMathBefore.length);
    for (const a of currentYearMathAfter) {
      expect(a.coefficient).toBe(5);
    }

    // Archived-year snapshot is APPEND-ONLY — untouched.
    const stillArchived = store.assessments.find((a) => a.id === archivedAsm.id);
    expect(stillArchived?.coefficient).toBe(4);
  });

  it("does not touch assessments when the coefficient is unchanged", async () => {
    const before = store.assessments.map((a) => ({ ...a }));
    const res = await subjects.updateSubject("sub-003", { name: "Mathématiques" });
    expect(res.ok).toBe(true);
    expect(store.assessments).toEqual(before);
  });
});

describe("§04.06 — student documents round-trip", () => {
  const students = new MockStudentRepository();

  it("persists documents via updateStudent and observes them back", async () => {
    const target = store.students[0];
    const original = target.documents ?? [];

    const docs = [
      {
        id: "doc-test-1",
        fileName: "certificat-medical-2026.pdf",
        category: "medical" as const,
        note: "Asthme léger",
        uploadedBy: ACTOR.actorName,
        uploadedAt: new Date().toISOString(),
      },
      {
        id: "doc-test-2",
        fileName: "contrat-inscription.pdf",
        category: "contract" as const,
        note: null,
        uploadedBy: ACTOR.actorName,
        uploadedAt: new Date().toISOString(),
      },
    ];
    const res = await students.updateStudent(target.id, { documents: docs });
    expect(res.ok).toBe(true);

    const observed = store.students.find((s) => s.id === target.id);
    expect(observed?.documents).toHaveLength(2);
    expect(observed?.documents?.[0].category).toBe("medical");

    // Restore the original documents so sibling suites are unaffected.
    const restore = await students.updateStudent(target.id, {
      documents: original,
    });
    expect(restore.ok).toBe(true);
  });
});

describe("§04.03 — batch registration persists middleName + classId", () => {
  it("creates students carrying the optional middle name and class assignment", async () => {
    const students = new MockStudentRepository();
    const before = store.students.length;
    const res = await students.batchRegister({
      parent: {
        firstName: "Vault",
        lastName: "Testeur",
        gender: "unspecified",
        phone: "0555112233",
        whatsapp: null,
        email: null,
        occupation: null,
        address: null,
        transportDestination: null,
        preferredLanguage: "fr",
      },
      students: [
        {
          firstName: "Amine",
          middleName: "Mohamed",
          lastName: "Vault",
          gender: "male",
          birthDate: "2015-04-12",
          level: "primaire",
          gradeYear: 4,
          classId: "cls-001",
          medicalNotes: null,
          transportTier: null,
          paymentPlan: "tranches",
        },
      ],
      includeRegistration: false,
      includeTransport: false,
    });
    expect(res.ok).toBe(true);
    expect(store.students.length).toBe(before + 1);
    if (res.ok) {
      const [created] = res.value.students as Student[];
      appendedStudentIds.add(created.id);
      expect(created.middleName).toBe("Mohamed");
      expect(created.classId).toBe("cls-001");
      // Parent-first dependency (§04.01): the student links to the new parent.
      expect(created.parentId).toBe(res.value.parent.id);
      // Cleanup the parent too so counts stay stable for sibling suites.
      store.parents = store.parents.filter((p) => p.id !== res.value.parent.id);
      store.notifyParents();
    }
  });
});
