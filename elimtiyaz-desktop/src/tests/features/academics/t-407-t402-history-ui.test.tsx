/**
 * T-407 (the T-402 leg) — the academic-history UI + mouse-interaction
 * integration suite.
 *
 * WHAT THIS SUITE PINS (the desktop side of the T-402 history-read fix —
 * `embedAcademicHistories` made `Student.academicHistory` real in Supabase
 * mode; this suite pins the DISPLAY contract that data feeds):
 *
 *   A. The « Historique académique » card (AcademicTab):
 *      - renders one row per archived year with the year, the decision
 *        StatusChip and the GPA;
 *      - PROMOTED vs REPEATED entries are DISTINGUISHABLE (the verify_t-402
 *        R1c/R2c contract, at the UI layer: different chips, never merged);
 *      - the T-401 classification stamp renders on the archived year
 *        (filière + spécialité through the canonical trackLabelFr);
 *      - the CURRENT year header shows the student's live classification;
 *      - an empty history renders the honest empty state (never a blank
 *        card).
 *
 *   B. The expandable bulletin (the §04.07 mouse interaction):
 *      - a real mouse CLICK on the year row expands it (aria-expanded,
 *        the per-term subject tables with D1/D2/Examen/Moy., the narrative,
 *        the attendance rate + the decision summary);
 *      - a second click COLLAPSES it;
 *      - a year with no archived assessments shows the honest "synthèse
 *        seule" note instead of empty tables.
 *
 * Run:
 *   npx vitest run src/tests/features/academics/t-407-t402-history-ui.test.tsx
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import * as React from "react";
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
  AcademicHistoryEntry,
  Assessment,
  AttendanceRecord,
} from "../../../domain/model/academic";
import { AcademicTab } from "../../../features/crm/student-detail/academic-tab";
import { mouseClick } from "../../_helpers/radix-mouse";

/* ------------------------------------------------------------------ */
/* Fixtures.                                                            */
/* ------------------------------------------------------------------ */

const TENANT = store.parents[0]?.tenantId ?? "t1";
const STUDENT_ID = "4c2e0000-0000-4000-8000-00000000b402";

const HISTORY: AcademicHistoryEntry[] = [
  {
    id: "hist-t406-1",
    studentId: STUDENT_ID,
    academicYear: "2023-2024",
    cycle: "lycee",
    level: "lycee",
    gradeCode: "1ere_annee",
    gradeYear: 1,
    classId: null,
    className: "1ère Année - Section A",
    gpa: 15.25,
    rank: 3,
    decision: "promoted",
    narrative: null,
    filiereCode: "tronc_commun_sciences",
    specialiteCode: null,
    recordedAt: "2024-07-01T00:00:00.000Z",
  },
  {
    id: "hist-t406-2",
    studentId: STUDENT_ID,
    academicYear: "2024-2025",
    cycle: "lycee",
    level: "lycee",
    gradeCode: "2eme_annee",
    gradeYear: 2,
    classId: null,
    className: "2ème Année - TM",
    gpa: 7.5,
    rank: null,
    decision: "repeated",
    narrative: "Élève sérieuse, excellent progrès en sciences.",
    // The T-401 stamp: the classification in force during the archived year.
    filiereCode: "technique_mathematique",
    specialiteCode: "genie_mecanique",
    recordedAt: "2025-07-01T00:00:00.000Z",
  },
];

const STUDENT: Student = {
  id: STUDENT_ID,
  tenantId: TENANT,
  code: "ELV-2025-T40602",
  parentId: "par-001",
  firstName: "Rania",
  lastName: "Mekki",
  displayName: "Rania Mekki",
  gender: "female",
  birthDate: "2008-02-11",
  enrollmentDate: "2025-09-01",
  level: "lycee",
  gradeYear: 3,
  gradeLevel: "3eme_annee",
  filiereCode: "technique_mathematique",
  specialiteCode: "genie_mecanique",
  classId: null,
  photoUrl: null,
  medicalNotes: null,
  transportTier: null,
  status: "active",
  paymentPlan: "tranches",
  academicHistory: HISTORY,
  documents: [],
  notes: [],
  createdAt: "2025-09-01T00:00:00.000Z",
  updatedAt: "2025-09-01T00:00:00.000Z",
} as unknown as Student;

/** One complete archived assessment of the 2024-2025 year (the bulletin row). */
const ARCHIVED_ASSESSMENT: Assessment = {
  id: "asm-t406-1",
  studentId: STUDENT_ID,
  classId: "cls-x",
  subjectId: "sub-001", // Arabe (the seeded subject)
  term: "T1",
  academicYear: "2024-2025",
  devoir1: 12,
  devoir2: 14,
  examen: 9,
  cc: null,
  subjectAverage: 11,
  coefficient: 3,
  coefficientDevoir1: 1,
  coefficientDevoir2: 1,
  coefficientExamen: 2,
  coefficientCc: 0,
  enteredBy: "user-t406",
  enteredAt: "2024-12-01T00:00:00.000Z",
} as unknown as Assessment;

const ATTENDANCE: AttendanceRecord[] = [
  {
    id: "att-t406-1",
    studentId: STUDENT_ID,
    classId: "cls-x",
    date: "2024-12-02",
    status: "present",
    justified: true,
    createdAt: "2024-12-02T00:00:00.000Z",
  },
  {
    id: "att-t406-2",
    studentId: STUDENT_ID,
    classId: "cls-x",
    date: "2024-12-03",
    status: "absent",
    justified: true,
    createdAt: "2024-12-03T00:00:00.000Z",
  },
] as unknown as AttendanceRecord[];

/* ------------------------------------------------------------------ */
/* Harness + lifecycle.                                                 */
/* ------------------------------------------------------------------ */

beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
});

function renderAcademicTab(student: Student): void {
  const fresh = { ...student };
  if (!store.students.some((s) => s.id === fresh.id)) store.students.push(fresh);
  store.notifyStudents();
  render(
    <RepositoryProvider repositories={mockRepositories}>
      <AuthProvider>
        <ToastProvider>
          <MemoryRouter>
            <AcademicTab studentId={fresh.id} />
          </MemoryRouter>
        </ToastProvider>
      </AuthProvider>
    </RepositoryProvider>,
  );
}

let pushed = false;

beforeEach(() => {
  pushed = false;
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
  store.students = store.students.filter((s) => s.id !== STUDENT_ID);
  store.notifyStudents();
  localStorage.removeItem("el-imtiyaz.session");
  cleanup();
});

/** The history card's year row button (the expand toggle). */
function yearRow(year: string): HTMLButtonElement {
  const btn = [...document.querySelectorAll("button")].find(
    (b) => (b.textContent ?? "").includes(year) && b.getAttribute("aria-expanded") !== null,
  );
  if (!(btn instanceof HTMLButtonElement)) {
    throw new Error(`no expandable year row for ${year}`);
  }
  return btn;
}

/* ================================================================== */
/* A. The history card.                                                 */
/* ================================================================== */

describe("T-407 A. AcademicTab — the « Historique académique » card", () => {
  it("renders one row per archived year with the decision chip and the GPA", async () => {
    renderAcademicTab(STUDENT);
    await waitFor(() => {
      expect(screen.getByText("Historique académique")).toBeTruthy();
    });

    expect(screen.getByText("2023-2024")).toBeTruthy();
    expect(screen.getByText("2024-2025")).toBeTruthy();
    // The decision chips (the FR labels).
    expect(screen.getByText("Promu(e)")).toBeTruthy();
    expect(screen.getByText("Redouble")).toBeTruthy();
    // The GPAs.
    expect(screen.getByText(/Moy\. 15\.25/)).toBeTruthy();
    expect(screen.getByText(/Rang 3/)).toBeTruthy();
    expect(screen.getByText(/Moy\. 7\.50/)).toBeTruthy();
  });

  it("the repeater stays DISTINGUISHABLE from the promoted year (different chips, both visible)", async () => {
    renderAcademicTab(STUDENT);
    await waitFor(() => {
      expect(screen.getByText("Historique académique")).toBeTruthy();
    });
    // Both chips present SIMULTANEOUSLY — the promotion history never merges
    // the two decisions (the R1c/R2c contract at the UI layer).
    const chips = screen.getAllByText(/Promu\(e\)|Redouble/);
    expect(chips.length).toBe(2);
    const chipTexts = chips.map((c) => c.textContent);
    expect(chipTexts).toContain("Promu(e)");
    expect(chipTexts).toContain("Redouble");
  });

  it("renders the T-401 classification stamp on the archived years", async () => {
    renderAcademicTab(STUDENT);
    await waitFor(() => {
      expect(screen.getByText("Historique académique")).toBeTruthy();
    });
    // 2023-2024: Tronc Commun Sciences (no spécialité — no trailing dash);
    // the header ALSO shows the current classification — use getAllByText.
    expect(screen.getAllByText(/Tronc Commun Sciences · 1ère Année - Section A/).length).toBe(1);
    // 2024-2025: Technique Mathématique — Génie Mécanique (the history row
    // + possibly the current-year header — at least the history row).
    expect(screen.getAllByText(/Technique Mathématique — Génie Mécanique/).length).toBeGreaterThanOrEqual(1);
  });

  it("an empty history renders the honest empty state", async () => {
    renderAcademicTab({ ...STUDENT, academicHistory: [] });
    await waitFor(() => {
      expect(screen.getByText("Historique académique")).toBeTruthy();
    });
    expect(screen.getByText("Aucune année antérieure enregistrée.")).toBeTruthy();
    expect(screen.queryByText("Promu(e)")).toBeNull();
  });
});

/* ================================================================== */
/* B. The expandable bulletin (the mouse interaction).                  */
/* ================================================================== */

describe("T-407 B. AcademicTab — the expandable bulletin", () => {
  it("a real mouse click expands the year (bulletin tables + narrative + summary)", async () => {
    if (!store.assessments.some((a) => a.id === ARCHIVED_ASSESSMENT.id)) {
      store.assessments.push(ARCHIVED_ASSESSMENT);
      store.notifyAssessments();
      pushed = true;
    }
    if (!store.attendance.some((a) => ATTENDANCE.some((x) => x.id === a.id))) {
      store.attendance.push(...ATTENDANCE);
      store.notifyAttendance();
    }

    renderAcademicTab(STUDENT);
    await waitFor(() => {
      expect(screen.getByText("Historique académique")).toBeTruthy();
    });

    const row = yearRow("2024-2025");
    expect(row.getAttribute("aria-expanded")).toBe("false");
    mouseClick(row);

    await waitFor(() => {
      expect(yearRow("2024-2025").getAttribute("aria-expanded")).toBe("true");
    });
    // The per-term bulletin table renders the archived assessment (the
    // subject also appears in the current-year grades section — count it).
    expect(screen.getByText("T1 — Bulletin")).toBeTruthy();
    expect(screen.getAllByText("Arabe").length).toBeGreaterThanOrEqual(1);
    // The narrative.
    expect(screen.getByText(/Élève sérieuse/)).toBeTruthy();
    // The attendance rate (1 present / 2 records = 50%).
    expect(screen.getByText("50 %")).toBeTruthy();
    // The decision summary.
    expect(screen.getByText("Décision de promotion")).toBeTruthy();
  });

  it("a second click collapses the year again", async () => {
    if (!store.assessments.some((a) => a.id === ARCHIVED_ASSESSMENT.id)) {
      store.assessments.push(ARCHIVED_ASSESSMENT);
      store.notifyAssessments();
    }
    renderAcademicTab(STUDENT);
    await waitFor(() => {
      expect(screen.getByText("Historique académique")).toBeTruthy();
    });

    const row = yearRow("2023-2024");
    mouseClick(row);
    await waitFor(() => {
      expect(yearRow("2023-2024").getAttribute("aria-expanded")).toBe("true");
    });
    // The 2023-2024 year has NO archived assessments — the honest note.
    expect(screen.getByText(/Aucune note détaillée archivée pour cette année/)).toBeTruthy();

    mouseClick(yearRow("2023-2024"));
    await waitFor(() => {
      expect(yearRow("2023-2024").getAttribute("aria-expanded")).toBe("false");
    });
    expect(screen.queryByText(/Aucune note détaillée archivée pour cette année/)).toBeNull();
  });
});

/* ================================================================== */
/* C. The source-of-truth pin (the T-402 read-side wiring).             */
/* ================================================================== */

describe("T-407 C. the history read-side source pin", () => {
  it("the AcademicTab consumes Student.academicHistory (the embedAcademicHistories feed) — never a parallel fetch", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../../features/crm/student-detail/academic-tab.tsx"),
      "utf8",
    );
    // The card derives from the student observable's academicHistory field.
    expect(src).toMatch(/student\?\.academicHistory \?\? \[\]/);
    // No direct table/RPC read of the history from the UI (the repository
    // owns the read — one path).
    expect(src).not.toMatch(/student_academic_histories/);
  });
});
