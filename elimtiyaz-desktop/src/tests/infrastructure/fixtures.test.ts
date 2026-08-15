/**
 * Smoke test for the new parametric fixture factories.
 */
import { describe, it, expect } from "vitest";
import {
  buildParents, buildStudents, buildPaymentsAndInstallments, buildAcademic, buildAttendance,
} from "../../infrastructure/mock/fixtures";

const TENANT_ID = "tenant-test-001";
const ACADEMIC_YEAR_ID = "ay-2025-2026";
const ACADEMIC_YEAR_CODE = "2025-2026";

describe("Fixture factories — determinism + invariants", () => {
  it("buildParents: same seed → identical output", () => {
    const a = buildParents({ tenantId: TENANT_ID, count: 5, seed: 42 });
    const b = buildParents({ tenantId: TENANT_ID, count: 5, seed: 42 });
    expect(a).toEqual(b);
    expect(a).toHaveLength(5);
    expect(a[0].id).toBe("par-001");
  });

  it("buildParents: different seeds → different output", () => {
    const a = buildParents({ tenantId: TENANT_ID, count: 5, seed: 1 });
    const b = buildParents({ tenantId: TENANT_ID, count: 5, seed: 2 });
    expect(a).not.toEqual(b);
  });

  it("buildStudents: parent-first invariant", () => {
    const parents = buildParents({ tenantId: TENANT_ID, count: 4, seed: 7 });
    const students = buildStudents({
      tenantId: TENANT_ID, parents, countPerParent: 2,
      classIds: ["cls-001", "cls-002"], seed: 11,
    });
    expect(students.length).toBeGreaterThanOrEqual(parents.length * 2);
    for (const s of students) {
      expect(parents.some((p) => p.id === s.parentId)).toBe(true);
    }
  });

  it("buildPaymentsAndInstallments: every PAID installment is backed", () => {
    const parents = buildParents({ tenantId: TENANT_ID, count: 6, seed: 3 });
    const students = buildStudents({ tenantId: TENANT_ID, parents, countPerParent: 1, seed: 9 });
    const { payments, installments } = buildPaymentsAndInstallments({
      tenantId: TENANT_ID, parents, students, paymentsPerParent: 2, seed: 21,
    });
    expect(payments.length).toBeGreaterThan(0);
    expect(installments.length).toBeGreaterThan(0);
    for (const inst of installments) {
      if (inst.amountPaid <= 0) continue;
      const key = `${inst.parentId}|${inst.category}|${inst.studentId ?? ""}`;
      const clearedTotal = payments
        .filter((p) => p.status === "paid" && `${p.parentId}|${p.category}|${p.studentId ?? ""}` === key)
        .reduce((acc, p) => acc + p.amount, 0);
      expect(clearedTotal).toBeGreaterThanOrEqual(inst.amountPaid);
    }
  });

  it("buildAcademic: produces classes, subjects, class-subjects, homework", () => {
    const { classes, subjects, classSubjects, homework } = buildAcademic({
      tenantId: TENANT_ID, academicYearId: ACADEMIC_YEAR_ID, academicYearCode: ACADEMIC_YEAR_CODE,
      teacherPersonnelIds: [
        { id: "per-001", name: "Mme Aïcha Bouhenni" },
        { id: "per-002", name: "M. Sofiane Larbi" },
      ],
      seed: 333,
    });
    expect(classes.length).toBeGreaterThan(0);
    expect(subjects.length).toBeGreaterThan(0);
    expect(classSubjects.length).toBeGreaterThan(0);
    expect(homework.length).toBeGreaterThan(0);
  });

  it("buildAttendance: deterministic stream", () => {
    const a = buildAttendance(["cls-001"], { "cls-001": ["stu-001", "stu-002"] }, 555);
    const b = buildAttendance(["cls-001"], { "cls-001": ["stu-001", "stu-002"] }, 555);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });
});
