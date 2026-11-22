/**
 * E2.6 / BUG-016 — the AcademicTab GPA memo: the missing
 * subjectConfigurations dep + the class-context resolution + the derived
 * formula caption.
 *
 * WHAT THIS SUITE PINS (the Session-45 fix):
 *
 *   1. THE DEP (the stale render): the gpa useMemo read
 *      subjectConfigurations inside resolveSubjectConfiguration but never
 *      listed it — a configuration landing after mount never re-ran the
 *      memo, so the GPA rendered stale until some other dep changed.
 *   2. THE CONTEXT (the BUG-002 lesson, applied here): the memo called the
 *      resolver WITHOUT academicLevelId/academicYearId, so NO configuration
 *      row could ever match and every coefficient silently fell to the
 *      legacy subject columns — the dep was dead weight. With the class
 *      context passed, the configuration layer is live AND the dep matters.
 *   3. THE CAPTION (the hardcoded copy): the "Notes" card hardcoded
 *      "Moyenne = (D1 + D2 + 2·Examen) / 4" — a lie for any subject
 *      configured with custom weights (T-345: the DB trigger is
 *      recipe-aware, migration 0094). The caption now DERIVES from the
 *      recipes in play.
 *
 * The regression math: two assessments (averages 12 and 16, snapshot
 * coefficients NULL so the configuration layer decides). Coefficients 1/1
 * → GPA (12+16)/2 = 14.00; patch the second subject's configuration
 * coefficient to 3 → (12×1 + 16×3)/4 = 15.00. Under the OLD code the GPA
 * stays 14.00 either way (no dep → no re-run; no context → no match).
 *
 * Run:
 *   npx vitest run src/tests/features/academics/t-e26-bug016-gpa-context.test.tsx
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import "../../../i18n/i18n";
import { store } from "../../../infrastructure/mock/repositories/mock-store";
import {
  mockRepositories,
  RepositoryProvider,
} from "../../../app/providers/repository-provider";
import { AuthProvider } from "../../../app/providers/auth-provider";
import { ToastProvider } from "../../../app/providers/toast-provider";
import { Role } from "../../../core/rbac/roles";
import type { Student } from "../../../domain/model/student";
import type {
  AcademicClass,
  Assessment,
  GradingRecipe,
  SubjectConfiguration,
} from "../../../domain/model/academic";
import { DEFAULT_GRADING_RECIPE } from "../../../domain/model/academic";
import { AcademicTab } from "../../../features/crm/student-detail/academic-tab";

/* ------------------------------------------------------------------ */
/* Fixtures.                                                           */
/* ------------------------------------------------------------------ */

const TENANT = store.parents[0]?.tenantId ?? "t1";
const STUDENT_ID = "stu-bug016";
const CLASS_ID = "cls-bug016";
const LEVEL = "al-4ap"; // a seeded configuration level (primaire)
const YEAR = "ay-2025-2026";
const SUBJECTS = ["sub-001", "sub-002"] as const; // Arabe + the 2nd core subject

/** A class carrying the REAL context the resolver must match. */
const TEST_CLASS = {
  ...(store.classes[0] as object),
  id: CLASS_ID,
  academicYearId: YEAR,
  academicLevelId: LEVEL,
  name: "4ème AP - BUG-016",
  code: "CLS-BUG016",
} as unknown as AcademicClass;

const STUDENT: Student = {
  id: STUDENT_ID,
  tenantId: TENANT,
  code: "ELV-2025-BUG016",
  parentId: "par-001",
  firstName: "Amel",
  lastName: "Boudiaf",
  displayName: "Amel Boudiaf",
  gender: "female",
  birthDate: "2015-05-02",
  enrollmentDate: "2025-09-01",
  level: "primaire",
  gradeYear: 4,
  gradeLevel: "4ap",
  classId: CLASS_ID,
  photoUrl: null,
  medicalNotes: null,
  transportTier: null,
  status: "active",
  paymentPlan: "tranches",
  academicHistory: [],
  documents: [],
  notes: [],
  createdAt: "2025-09-01T00:00:00.000Z",
  updatedAt: "2025-09-01T00:00:00.000Z",
} as unknown as Student;

/** subjectAverage preset; coefficient NULL so the configuration layer decides. */
function makeAssessment(id: string, subjectId: string, average: number): Assessment {
  return {
    id,
    studentId: STUDENT_ID,
    classId: CLASS_ID,
    subjectId,
    term: "T1",
    academicYear: "2025-2026",
    devoir1: average,
    devoir2: average,
    examen: average,
    cc: null,
    subjectAverage: average,
    coefficient: null,
    coefficientDevoir1: null,
    coefficientDevoir2: null,
    coefficientExamen: null,
    coefficientCc: null,
    enteredBy: "user-bug016",
    enteredAt: "2025-12-01T00:00:00.000Z",
  } as unknown as Assessment;
}

const ASSESSMENTS = [
  makeAssessment("asm-bug016-1", SUBJECTS[0], 12),
  makeAssessment("asm-bug016-2", SUBJECTS[1], 16),
];

/** Controlled configuration rows for the two subjects in the test context. */
function configRow(
  subjectId: string,
  coefficient: number,
  gradingRecipe: GradingRecipe,
): SubjectConfiguration {
  return {
    id: `subcfg-bug016-${subjectId}`,
    tenantId: TENANT,
    subjectId,
    academicYearId: YEAR,
    academicLevelId: LEVEL,
    direction: "general",
    coefficient,
    subjectCode: null,
    passingGrade: 10,
    isExtracurricular: false,
    gradingRecipe,
    weeklyHours: null,
    isActive: true,
  } as SubjectConfiguration;
}

let seededConfigs: SubjectConfiguration[] = [];

/** Swap the seeded (sub-001|sub-002, LEVEL, YEAR) rows for controlled ones. */
function installConfigs(rows: SubjectConfiguration[]): void {
  store.subjectConfigurations = store.subjectConfigurations.filter(
    (c) =>
      !(
        (c.subjectId === SUBJECTS[0] || c.subjectId === SUBJECTS[1]) &&
        c.academicLevelId === LEVEL &&
        c.academicYearId === YEAR
      ),
  );
  store.subjectConfigurations.push(...rows);
  store.notifySubjectConfigurations();
}

/* ------------------------------------------------------------------ */
/* Harness + lifecycle.                                                */
/* ------------------------------------------------------------------ */

beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
});

function renderAcademicTab(): void {
  render(
    <RepositoryProvider repositories={mockRepositories}>
      <AuthProvider>
        <ToastProvider>
          <MemoryRouter>
            <AcademicTab studentId={STUDENT_ID} />
          </MemoryRouter>
        </ToastProvider>
      </AuthProvider>
    </RepositoryProvider>,
  );
}

beforeEach(() => {
  // Snapshot the seeded configuration rows we are about to replace.
  seededConfigs = store.subjectConfigurations.filter(
    (c) =>
      (c.subjectId === SUBJECTS[0] || c.subjectId === SUBJECTS[1]) &&
      c.academicLevelId === LEVEL &&
      c.academicYearId === YEAR,
  );
  if (!store.classes.some((c) => c.id === CLASS_ID)) store.classes.push(TEST_CLASS);
  store.notifyClasses();
  if (!store.students.some((s) => s.id === STUDENT_ID)) store.students.push(STUDENT);
  store.notifyStudents();
  store.assessments.push(...ASSESSMENTS);
  store.notifyAssessments();
  installConfigs([
    configRow(SUBJECTS[0], 1, DEFAULT_GRADING_RECIPE),
    configRow(SUBJECTS[1], 1, DEFAULT_GRADING_RECIPE),
  ]);
  localStorage.setItem(
    "el-imtiyaz.session",
    JSON.stringify({
      userId: "u1", tenantId: TENANT, email: "a@b.c", displayName: "A",
      avatarUrl: null, role: Role.SuperAdmin, permissions: [],
      accessToken: "t", refreshToken: null, expiresAt: Date.now() + 3600000, locale: "fr",
    }),
  );
});

afterEach(async () => {
  await new Promise((r) => setTimeout(r, 220));
  store.assessments = store.assessments.filter((a) => !a.id.startsWith("asm-bug016"));
  store.notifyAssessments();
  store.students = store.students.filter((s) => s.id !== STUDENT_ID);
  store.notifyStudents();
  store.classes = store.classes.filter((c) => c.id !== CLASS_ID);
  store.notifyClasses();
  store.subjectConfigurations = store.subjectConfigurations.filter(
    (c) => !c.id.startsWith("subcfg-bug016-"),
  );
  store.subjectConfigurations.push(...seededConfigs);
  store.notifySubjectConfigurations();
  localStorage.removeItem("el-imtiyaz.session");
  cleanup();
});

/* ================================================================== */
/* The pins.                                                           */
/* ================================================================== */

describe("E2.6 / BUG-016 — the AcademicTab GPA memo + the derived formula caption", () => {
  it("renders the STANDARD formula caption when every recipe in play is the default", async () => {
    renderAcademicTab();
    await waitFor(() => {
      expect(screen.getByText(/Notes — T1/)).toBeTruthy();
    });
    expect(
      screen.getByText(
        "Moyenne = (D1 + D2 + 2·Examen) / 4 — chaque note sur 20 (plan §06.02)",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/Moyenne pondérée/)).toBeNull();
  });

  it("flips the caption to the WEIGHTED form when a subject's configuration carries a custom recipe", async () => {
    installConfigs([
      configRow(SUBJECTS[0], 1, DEFAULT_GRADING_RECIPE),
      // sub-002 with a non-default examen weight — the stored averages
      // follow the recipe (migration 0094), so the caption must not claim
      // the standard formula.
      configRow(SUBJECTS[1], 1, { devoir1: 1, devoir2: 1, examen: 3, cc: 0 }),
    ]);
    renderAcademicTab();
    await waitFor(() => {
      expect(screen.getByText(/Moyenne pondérée = Σ\(note × poids\)/)).toBeTruthy();
    });
    expect(screen.queryByText(/^Moyenne = \(D1 \+ D2/)).toBeNull();
  });

  it("the GPA resolves through the class-context configuration AND recomputes when it changes (the missing dep)", async () => {
    renderAcademicTab();
    // Coefficients 1/1 from the configuration layer (snapshot coefficients
    // are NULL): (12×1 + 16×1) / 2 = 14.00 — itself proof the context now
    // matches (the legacy subject columns would give a different pair).
    // (The GPA renders twice — the header cell + the status chip — hence
    // the AllBy variants.)
    await waitFor(() => {
      expect(screen.getAllByText("14.00 / 20").length).toBeGreaterThanOrEqual(1);
    });

    // Patch the second subject's configuration coefficient 1 → 3 and
    // notify: the memo MUST re-run — (12×1 + 16×3) / 4 = 15.00. Under the
    // old code the GPA stays 14.00 (missing dep → no re-run).
    installConfigs([
      configRow(SUBJECTS[0], 1, DEFAULT_GRADING_RECIPE),
      configRow(SUBJECTS[1], 3, DEFAULT_GRADING_RECIPE),
    ]);
    await waitFor(() => {
      expect(screen.getAllByText("15.00 / 20").length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.queryAllByText("14.00 / 20").length).toBe(0);
  });
});
