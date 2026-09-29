/**
 * T-440 — the re-enrollment candidates' parent display name must go through
 * the CANONICAL parentDisplayName helper (DATA-005 — the final-verification
 * finding of the 119th session).
 *
 * What this suite pins:
 *
 *   A. THE RED CASE (found by the final verification): the mock repository's
 *      listCandidates composed the parent name INLINE
 *      (`parent.displayName ?? \`${parent.firstName} ${parent.lastName}\``)
 *      — a DUPLICATE of the canonical helper with DIFFERENT semantics: the
 *      nullish-coalescing copy returns "" for an EMPTY-STRING displayName,
 *      while the canonical helper (and the 0128 SQL write path, which
 *      normalizes '' → NULL via COALESCE(NULLIF(TRIM(...), ''))) falls back
 *      to the composed name. The inline copy also silently joined the red
 *      t-134 tree guard (its offender list grew from the documented 1 to 2
 *      with no signal — the guard asserted `[]` and the baseline tracks only
 *      counts/files).
 *   B. null displayName → the composed first+last (parity with the 0128 SQL
 *      read path's COALESCE and the canonical helper).
 *   C. a set displayName → used verbatim (the Parent contract: "UI MUST show
 *      this verbatim").
 *
 * Run:
 *   npx vitest run src/tests/infrastructure/t-440-re-enroll-parent-display-name.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  MockReEnrollmentRepository,
  resetMockReEnrollments,
} from "../../infrastructure/mock/repositories/re-enrollment-repository";
import { store } from "../../infrastructure/mock/repositories/mock-store";
import { parentDisplayName } from "../../domain/model/parent";
import type { Parent } from "../../domain/model/parent";
import type { Student } from "../../domain/model/student";

const PROBE_SOURCE = { id: "ay-t440-source", code: "2096-2097", label: "2096-2097" };
const PROBE_TARGET = { id: "ay-t440-target", code: "2097-2098", label: "2097-2098" };

function seedSandbox(): void {
  resetMockReEnrollments();
  store.academicYears = [
    ...store.academicYears.filter((y) => y.id !== PROBE_SOURCE.id && y.id !== PROBE_TARGET.id),
    { ...PROBE_SOURCE, startDate: "2096-09-01", endDate: "2097-06-30", termStructure: "trimester", isCurrent: false, isArchived: false, createdAt: "2096-01-01", updatedAt: "2096-01-01" },
    { ...PROBE_TARGET, startDate: "2097-09-01", endDate: "2098-06-30", termStructure: "trimester", isCurrent: false, isArchived: false, createdAt: "2097-01-01", updatedAt: "2097-01-01" },
  ] as typeof store.academicYears;
}

/** A probe parent cloned from a real store parent, with the displayName under test. */
function probeParent(id: string, displayName: string | null): Parent {
  const base = store.parents[0];
  return {
    ...base,
    id,
    code: `PAR-2097-T440-${id.slice(-3).toUpperCase()}`,
    firstName: "Amine",
    lastName: "Belkacem",
    displayName,
    phone: "0555 00 00 00",
  };
}

/** A probe student (active, finalized REPEATED history in the source year) bound to the probe parent. */
function probeStudent(id: string, parentId: string): Student {
  const base = store.students[0];
  return {
    ...base,
    id,
    parentId,
    status: "active" as const,
    academicHistory: ([{
        studentId: id,
        academicYear: PROBE_SOURCE.code,
        cycle: "primaire",
        level: "primaire",
        gradeCode: "4ap",
        gradeYear: 4,
        classId: null,
        className: "Classe A",
        gpa: 10.5,
        rank: null,
        decision: "repeated" as const,
        narrative: null,
      }] as unknown as typeof base.academicHistory),
  };
}

async function candidateParentName(parentId: string): Promise<string | undefined> {
  const repo = new MockReEnrollmentRepository();
  const gen = await repo.generateCandidates({
    sourceAcademicYearId: PROBE_SOURCE.id,
    targetAcademicYearId: PROBE_TARGET.id,
    performedBy: "staff-1",
    performedByName: "T-440",
  });
  expect(gen.ok).toBe(true);
  const list = await repo.listCandidates(PROBE_TARGET.id);
  expect(list.ok).toBe(true);
  if (!list.ok) return undefined;
  const c = list.value.candidates.find((x) => x.parentId === parentId);
  return c?.parentDisplayName;
}

beforeAll(() => {
  localStorage.setItem(
    "el-imtiyaz.session",
    JSON.stringify({ tenantId: "00000000-0000-0000-0000-000000000001", userId: "staff-1" }),
  );
});
afterAll(() => {
  localStorage.removeItem("el-imtiyaz.session");
});

describe("T-440 — the re-enrollment parent display name (DATA-005 canonical path)", () => {
  it("A: an EMPTY-STRING displayName falls back to the composed name (never renders blank)", async () => {
    seedSandbox();
    const parent = probeParent("par-t440-empty", "");
    const student = probeStudent("stu-t440-empty", parent.id);
    store.parents = [...store.parents, parent];
    store.students = [...store.students, student];

    // The canonical helper's contract (the pinned expected value):
    expect(parentDisplayName(parent)).toBe("Amine Belkacem");

    const rendered = await candidateParentName(parent.id);
    // RED against the inline `??` copy: it rendered "" (empty) here.
    expect(rendered).toBe("Amine Belkacem");
  });

  it("B: a NULL displayName composes first + last (the 0128 COALESCE parity)", async () => {
    seedSandbox();
    const parent = probeParent("par-t440-null", null);
    const student = probeStudent("stu-t440-null", parent.id);
    store.parents = [...store.parents, parent];
    store.students = [...store.students, student];

    expect(parentDisplayName(parent)).toBe("Amine Belkacem");
    const rendered = await candidateParentName(parent.id);
    expect(rendered).toBe("Amine Belkacem");
  });

  it("C: a SET displayName renders verbatim (the Parent contract)", async () => {
    seedSandbox();
    const parent = probeParent("par-t440-set", "BELKACEM Amine (Tuteur)");
    const student = probeStudent("stu-t440-set", parent.id);
    store.parents = [...store.parents, parent];
    store.students = [...store.students, student];

    const rendered = await candidateParentName(parent.id);
    expect(rendered).toBe("BELKACEM Amine (Tuteur)");
  });
});
