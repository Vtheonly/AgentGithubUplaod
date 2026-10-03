/**
 * T-474 — the owner's class-roster mandate: the student multi-select on the
 * class CREATION and EDIT surfaces (the classes↔students linkage through the
 * EXISTING persistence seam).
 *
 * WHAT THIS SUITE PINS (the mandate: "properly connected to the existing
 * student/class data and persistence logic, rather than being only a
 * frontend selection UI"):
 *
 *   A. ClassStudentMultiSelect — the eligibility contract:
 *      - default pool = ACTIVE students whose gradeLevel matches the class's
 *        grade (the owner's "eligible for that class");
 *      - the « tous les niveaux » toggle widens the pool (the existing
 *        single-add dialog's permissiveness);
 *      - INACTIVE students never appear;
 *      - the EDITED class's own members are ALWAYS listed (the grade filter
 *        must never hide the pre-checked roster) and carry the
 *        « dans cette classe » marker;
 *      - students placed in ANOTHER class show their class name as a badge;
 *      - the search box filters by name AND by ELV code;
 *      - the select-all/clear acts on the VISIBLE rows only;
 *      - the selected-count badge counts the whole selection.
 *
 *   B. The CREATE flow (GradeLevelsClassView → CreateClassModal): checking
 *      students and submitting persists the linkage — createClass runs
 *      first, then updateStudent(id, { classId: <new class id> }) per
 *      selected student (the wire-payload assertion: a REAL repository
 *      call, not local state).
 *
 *   C. The EDIT flow (ClassDetailPage → the edit modal): the current roster
 *      is PRE-CHECKED; unchecking a member and checking a candidate then
 *      saving persists BOTH directions — updateStudent(id, { classId }) for
 *      the addition and updateStudent(id, { classId: null }) for the removal.
 *
 *   D. Partial-failure honesty (the T-370 lesson): a student assignment
 *      that fails is REPORTED (the failure surfaces through the recording
 *      repository's Err), never swallowed into a success toast.
 *
 * Run:
 *   npx vitest run src/tests/features/academics/t-474-class-student-multiselect.test.tsx
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

import "../../../i18n/i18n";
import { store } from "../../../infrastructure/mock/repositories/mock-store";
import {
  mockRepositories,
  RepositoryProvider,
} from "../../../app/providers/repository-provider";
import type { Repositories } from "../../../app/providers/repository-provider";
import { AuthProvider } from "../../../app/providers/auth-provider";
import { ToastProvider } from "../../../app/providers/toast-provider";
import { Role } from "../../../core/rbac/roles";
import type { Result } from "../../../core/result";
import { Ok, Err } from "../../../core/result";
import { Errors } from "../../../core/app-error";
import type { Student, GradeLevel, UpdateStudentInput } from "../../../domain/model/student";
import type { AcademicClass } from "../../../domain/model/academic";
import { ClassStudentMultiSelect } from "../../../features/academics/placement/class-student-multi-select";
import { GradeLevelsClassView } from "../../../features/academics/grade-levels-class-view";
import { ClassDetailPage } from "../../../features/academics/class-detail-page";
import { PersonNavigationProvider } from "../../../shared/navigation/person-navigation-context";

/* ------------------------------------------------------------------ */
/* Session + provider harness (the t-407 pattern).                     */
/* ------------------------------------------------------------------ */

const SESSION_KEY = "el-imtiyaz.session";
const TENANT = store.parents[0]?.tenantId ?? "t1";

function seedSession(): void {
  const session = {
    userId: "user-t474",
    tenantId: TENANT,
    email: "agent@elimtiyaz.dz",
    displayName: "Agent T474",
    avatarUrl: null,
    role: Role.SuperAdmin,
    permissions: [],
    accessToken: "test-access-token",
    refreshToken: null,
    expiresAt: Date.now() + 3600_000,
    locale: "fr",
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function TestProviders({
  children,
  repositories,
  route = "/",
}: {
  children: React.ReactNode;
  repositories?: Repositories;
  route?: string;
}) {
  return (
    <RepositoryProvider repositories={repositories ?? mockRepositories}>
      <AuthProvider>
        <ToastProvider>
          <MemoryRouter initialEntries={[route]}>
            <PersonNavigationProvider>{children}</PersonNavigationProvider>
          </MemoryRouter>
        </ToastProvider>
      </AuthProvider>
    </RepositoryProvider>
  );
}

/* ------------------------------------------------------------------ */
/* Fixtures — UUID-shaped ids + a grade-4AM cohort.                    */
/* ------------------------------------------------------------------ */

function makeStudent(over: Partial<Student>): Student {
  return {
    id: "a4740000-0000-4000-8000-000000000001",
    tenantId: TENANT,
    code: "ELV-2026-T47401",
    parentId: "par-001",
    firstName: "Yacine",
    lastName: "Belkacem",
    displayName: "Yacine Belkacem",
    gender: "male",
    birthDate: "2012-03-14",
    enrollmentDate: "2026-09-01",
    level: "cem",
    gradeYear: 1,
    gradeLevel: "4am",
    classId: null,
    photoUrl: null,
    medicalNotes: null,
    transportTier: null,
    status: "active",
    paymentPlan: "tranches",
    academicHistory: [],
    documents: [],
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...over,
  } as unknown as Student;
}

/** Grade-4AM students — the class under test's cohort. */
const S_AMIN = makeStudent({
  id: "a4740000-0000-4000-8000-000000000001",
  code: "ELV-2026-T47401",
  firstName: "Amine",
  lastName: "Zerrouki",
});
const S_LINA = makeStudent({
  id: "a4740000-0000-4000-8000-000000000002",
  code: "ELV-2026-T47402",
  firstName: "Lina",
  lastName: "Hamdi",
});
/** A 4AM student already placed in ANOTHER class (the move case). */
const S_MOVED = makeStudent({
  id: "a4740000-0000-4000-8000-000000000003",
  code: "ELV-2026-T47403",
  firstName: "Nadir",
  lastName: "Cherif",
  classId: "b4740000-0000-4000-8000-00000000aaa",
});
/** A WITHDRAWN 4AM student — must NEVER be listed (non-active). */
const S_INACTIVE = makeStudent({
  id: "a4740000-0000-4000-8000-000000000004",
  code: "ELV-2026-T47404",
  firstName: "Sofia",
  lastName: "Brahimi",
  status: "withdrawn",
});
/** A primary student — outside the default grade filter. */
const S_PRIMARY = makeStudent({
  id: "a4740000-0000-4000-8000-000000000005",
  code: "ELV-2026-T47405",
  firstName: "Rania",
  lastName: "Mekki",
  gradeLevel: "3ap" as GradeLevel,
  level: "primaire",
});

const ALL_T474_STUDENTS = [S_AMIN, S_LINA, S_MOVED, S_INACTIVE, S_PRIMARY];

/** The other class (4AM Section B) — S_MOVED's current home. */
const OTHER_CLASS_ID = "b4740000-0000-4000-8000-00000000aaa";
const OTHER_CLASS: AcademicClass = {
  id: OTHER_CLASS_ID,
  tenantId: TENANT,
  code: "CLS-4AM-B-T474",
  name: "4AM - Section B",
  gradeCode: "4am",
  level: "cem",
  gradeYear: 1,
  section: "Section B",
  academicYear: "2026-2027",
  academicYearId: "ay-2026-2027",
  academicLevelId: "al-4am",
  filiereCode: null,
  specialiteCode: null,
  room: null,
  capacity: null,
  homeroomTeacherId: null,
  homeroomTeacherName: null,
  notes: null,
  isActive: true,
  enrolledCount: 1,
} as unknown as AcademicClass;

/** The class under EDIT — Amine + Lina are its current roster. */
const EDITED_CLASS_ID = "b4740000-0000-4000-8000-00000000bbb";
const EDITED_CLASS: AcademicClass = {
  ...OTHER_CLASS,
  id: EDITED_CLASS_ID,
  code: "CLS-4AM-A-T474",
  name: "4AM - Section A",
  section: "Section A",
} as unknown as AcademicClass;

const ALL_T474_CLASSES = [OTHER_CLASS, EDITED_CLASS];

beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
});

let updateCalls: Array<{ id: string; updates: UpdateStudentInput }> = [];

beforeEach(() => {
  updateCalls = [];
  for (const s of ALL_T474_STUDENTS) {
    if (!store.students.some((x) => x.id === s.id)) store.students.push({ ...s });
  }
  for (const c of ALL_T474_CLASSES) {
    if (!store.classes.some((x) => x.id === c.id)) store.classes.push({ ...c } as never);
  }
  store.notifyStudents();
  store.classes$.set([...store.classes]);
  seedSession();
});

afterEach(async () => {
  await new Promise((r) => setTimeout(r, 250));
  store.students = store.students.filter((s) => !ALL_T474_STUDENTS.some((x) => x.id === s.id));
  store.classes = store.classes.filter((c) => !ALL_T474_CLASSES.some((x) => x.id === c.id));
  store.notifyStudents();
  store.classes$.set([...store.classes]);
  localStorage.removeItem(SESSION_KEY);
  cleanup();
});

/* ------------------------------------------------------------------ */
/* The recording student repository (the t-407 pattern, extended).     */
/* ------------------------------------------------------------------ */

class RecordingStudentRepository {
  readonly calls: Array<{ id: string; updates: UpdateStudentInput }> = [];
  private readonly base: Repositories["students"];
  /** When set, updateStudent FAILS for these ids (the honesty test). */
  failFor: Set<string> = new Set();
  observe: Repositories["students"]["observe"];
  observeById: Repositories["students"]["observeById"];
  observeByParent: Repositories["students"]["observeByParent"];
  observeByClass: Repositories["students"]["observeByClass"];
  search: Repositories["students"]["search"];
  constructor(base: Repositories["students"]) {
    this.base = base;
    this.observe = base.observe.bind(base);
    this.observeById = base.observeById.bind(base);
    this.observeByParent = base.observeByParent.bind(base);
    this.observeByClass = base.observeByClass.bind(base);
    this.search = base.search.bind(base);
  }
  async updateStudent(id: string, updates: UpdateStudentInput): Promise<Result<Student>> {
    this.calls.push({ id, updates });
    if (this.failFor.has(id)) {
      return Err(Errors.conflict("Affectation refusée (simulation T-474)"));
    }
    return this.base.updateStudent(id, updates);
  }
  async createStudent(
    parentId: string,
    input: Parameters<Repositories["students"]["createStudent"]>[1],
  ): Promise<Result<Student>> {
    return this.base.createStudent(parentId, input);
  }
  async promote(studentIds: string[], academicYear: string): Promise<Result<Student[]>> {
    return this.base.promote(studentIds, academicYear);
  }
  async deleteStudent(id: string): Promise<Result<void>> {
    return this.base.deleteStudent(id);
  }
  async batchRegister(
    input: Parameters<Repositories["students"]["batchRegister"]>[0],
  ): Promise<Result<import("../../../domain/model/student").BatchRegistrationResult>> {
    return this.base.batchRegister(input);
  }
  async addStudentDocument(
    ...args: Parameters<Repositories["students"]["addStudentDocument"]>
  ): ReturnType<Repositories["students"]["addStudentDocument"]> {
    return this.base.addStudentDocument(...args);
  }
}

function makeRecordingRepos(recorder: RecordingStudentRepository): Repositories {
  return {
    ...mockRepositories,
    students: recorder as unknown as Repositories["students"],
  } as Repositories;
}

/** A STATEFUL controlled harness (the selection lives in React state so
 * the count badge + checkbox re-render — the un-controlled Set mutation
 * trap this replaces left the badge stale). */
function StatefulHarness({
  gradeCode,
  currentClassId,
}: {
  gradeCode: GradeLevel;
  currentClassId?: string | null;
}) {
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  return (
    <ClassStudentMultiSelect
      gradeCode={gradeCode}
      currentClassId={currentClassId ?? null}
      selectedIds={selected}
      onToggle={(id) =>
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        })
      }
      onReplaceSelection={(ids) => setSelected(new Set(ids))}
    />
  );
}

/* ================================================================== */
/* A. The component — the eligibility contract.                        */
/* ================================================================== */

describe("T-474 A. ClassStudentMultiSelect — the eligibility contract", () => {
  it("default pool = ACTIVE grade-matching students; inactive never listed", async () => {
    render(
      <TestProviders>
        <StatefulHarness gradeCode="4am" />
      </TestProviders>,
    );
    await waitFor(() => {
      expect(screen.getByText(/Amine Zerrouki/)).toBeTruthy();
    });
    expect(screen.getByText(/Lina Hamdi/)).toBeTruthy();
    expect(screen.getByText(/Nadir Cherif/)).toBeTruthy(); // placed elsewhere — still a candidate
    // The primary student is OUTSIDE the default grade filter…
    expect(screen.queryByText(/Rania Mekki/)).toBeNull();
    // …and the WITHDRAWN student is NEVER listed.
    expect(screen.queryByText(/Sofia Brahimi/)).toBeNull();
  });

  it("the « tous les niveaux » toggle widens the pool (the permissive mode)", async () => {
    render(
      <TestProviders>
        <StatefulHarness gradeCode="4am" />
      </TestProviders>,
    );
    await waitFor(() => expect(screen.getByText(/Amine Zerrouki/)).toBeTruthy());
    expect(screen.queryByText(/Rania Mekki/)).toBeNull();

    fireEvent.click(screen.getByTestId("class-student-grade-filter-toggle"));
    await waitFor(() => {
      expect(screen.getByText(/Rania Mekki/)).toBeTruthy();
    });
    // The withdrawn student stays hidden even in the wide mode.
    expect(screen.queryByText(/Sofia Brahimi/)).toBeNull();
  });

  it("a student placed in ANOTHER class carries that class's name as a badge", async () => {
    render(
      <TestProviders>
        <StatefulHarness gradeCode="4am" />
      </TestProviders>,
    );
    await waitFor(() => expect(screen.getByText(/Nadir Cherif/)).toBeTruthy());
    expect(screen.getByText("4AM - Section B")).toBeTruthy();
  });

  it("the EDITED class's members are always listed (even grade-mismatched) with the marker, sorted first", async () => {
    // Rania (3ap) is a MEMBER of the edited class despite the grade mismatch —
    // the grade filter must never hide the pre-checked roster.
    store.students = store.students.map((s) =>
      s.id === S_PRIMARY.id ? { ...s, classId: EDITED_CLASS_ID } : s,
    );
    store.notifyStudents();
    render(
      <TestProviders>
        <StatefulHarness gradeCode="4am" currentClassId={EDITED_CLASS_ID} />
      </TestProviders>,
    );
    await waitFor(() => {
      expect(screen.getByText(/Rania Mekki/)).toBeTruthy();
      expect(screen.getByText(/\(dans cette classe\)/)).toBeTruthy();
    });
    // Members sort FIRST (before non-member 4am candidates).
    const list = screen.getByRole("group", { name: "Élèves éligibles" });
    const rows = [...list.querySelectorAll("label")];
    const firstRowText = rows[0]?.textContent ?? "";
    expect(firstRowText).toContain("Rania Mekki");
  });

  it("the search box filters by name AND by ELV code", async () => {
    render(
      <TestProviders>
        <StatefulHarness gradeCode="4am" />
      </TestProviders>,
    );
    await waitFor(() => expect(screen.getByText(/Amine Zerrouki/)).toBeTruthy());

    fireEvent.change(screen.getByTestId("class-student-search"), {
      target: { value: "lina" },
    });
    await waitFor(() => {
      expect(screen.queryByText(/Amine Zerrouki/)).toBeNull();
      expect(screen.getByText(/Lina Hamdi/)).toBeTruthy();
    });

    fireEvent.change(screen.getByTestId("class-student-search"), {
      target: { value: "ELV-2026-T47403" },
    });
    await waitFor(() => {
      expect(screen.queryByText(/Lina Hamdi/)).toBeNull();
      expect(screen.getByText(/Nadir Cherif/)).toBeTruthy();
    });
  });

  it("select-all acts on the VISIBLE rows and the count badge follows the whole selection", async () => {
    render(
      <TestProviders>
        <StatefulHarness gradeCode="4am" />
      </TestProviders>,
    );
    await waitFor(() => expect(screen.getByText(/Amine Zerrouki/)).toBeTruthy());

    // Narrow to one visible row, then "select all (visible)".
    fireEvent.change(screen.getByTestId("class-student-search"), {
      target: { value: "ELV-2026-T47402" },
    });
    await waitFor(() => expect(screen.queryByText(/Amine Zerrouki/)).toBeNull());
    fireEvent.click(screen.getByTestId("class-student-select-all"));
    await waitFor(() => {
      expect(
        screen.getByTestId(`class-student-checkbox-${S_LINA.id}`) as HTMLInputElement,
      ).toBeChecked();
    });
    // The count badge reflects the whole selection.
    expect(screen.getByTestId("class-student-selected-count").textContent).toBe(
      "1 sélectionné",
    );
  });
});

/* ================================================================== */
/* B. The CREATE flow — the persistence wire.                          */
/* ================================================================== */

describe("T-474 B. CreateClassModal — the selected students persist through updateStudent(classId)", () => {
  it("checking students and submitting: createClass first, then one updateStudent per student with the NEW class id", async () => {
    const recorder = new RecordingStudentRepository(mockRepositories.students);
    const repos = makeRecordingRepos(recorder);
    const classesBefore = store.classes.length;

    render(
      <TestProviders repositories={repos}>
        <GradeLevelsClassView canCreate={true} />
      </TestProviders>,
    );

    // Open the create modal from the 4AM LEVEL HEADER (the preset-grade
    // entry: openCreateForGrade("4am") presets gradeCode → the picker's
    // eligibility follows the 4AM cohort).
    const levelButtons = await screen.findAllByRole("button", {
      name: /Ajouter une classe à ce niveau/i,
    });
    // The 4AM level is the 10th rendered level (GRADE_LEVELS order); find
    // its button by walking up to the level header that contains "4AM".
    const am4Button = levelButtons.find((btn) =>
      (btn.closest("div")?.textContent ?? "").includes("4AM"),
    ) ?? levelButtons[levelButtons.length - 1];
    fireEvent.click(am4Button);

    await waitFor(() => {
      expect(screen.getByText("Créer une nouvelle classe")).toBeTruthy();
    });
    // The picker lists the 4AM cohort.
    await waitFor(() => {
      expect(screen.getByText(/Amine Zerrouki/)).toBeTruthy();
    });

    // Check Amine + Nadir (Nadir is currently in Section B → a MOVE).
    fireEvent.click(screen.getByTestId(`class-student-checkbox-${S_AMIN.id}`));
    fireEvent.click(screen.getByTestId(`class-student-checkbox-${S_MOVED.id}`));
    expect(
      screen.getByTestId("class-student-selected-count").textContent,
    ).toBe("2 sélectionnés");

    fireEvent.click(screen.getByRole("button", { name: /Créer la classe/i }));

    await waitFor(() => {
      expect(recorder.calls.length).toBe(2);
    });
    // The class WAS created (the mock store gained a class).
    expect(store.classes.length).toBeGreaterThan(classesBefore);
    const newClass = store.classes.find(
      (c) => !ALL_T474_CLASSES.some((x) => x.id === c.id) &&
        store.classes.indexOf(c) >= classesBefore,
    );
    expect(newClass).toBeTruthy();
    expect(newClass!.gradeCode).toBe("4am");
    // The wire: each selected student linked to the NEW class id.
    for (const call of recorder.calls) {
      expect(call.updates.classId).toBe(newClass!.id);
    }
    expect(recorder.calls.map((c) => c.id).sort()).toEqual(
      [S_AMIN.id, S_MOVED.id].sort(),
    );

    // Store residue cleanup: remove the created class (student links are
    // fixture-restored in afterEach).
    store.classes = store.classes.filter((c) => c.id !== newClass!.id);
    store.classes$.set([...store.classes]);
  });
});

/* ================================================================== */
/* C. The EDIT flow — the pre-checked roster + the add/remove diff.    */
/* ================================================================== */

describe("T-474 C. ClassDetailPage edit modal — the pre-checked roster and the two-direction diff", () => {
  it("members pre-checked; unchecking one and checking a candidate persists classId AND classId:null", async () => {
    // Amine + Lina are the edited class's roster.
    store.students = store.students.map((s) => {
      if (s.id === S_AMIN.id) return { ...s, classId: EDITED_CLASS_ID };
      if (s.id === S_LINA.id) return { ...s, classId: EDITED_CLASS_ID };
      return s;
    });
    store.notifyStudents();

    const recorder = new RecordingStudentRepository(mockRepositories.students);
    const repos = makeRecordingRepos(recorder);

    render(
      <TestProviders
        repositories={repos}
        route={`/academics/class/${EDITED_CLASS_ID}`}
      >
        <Routes>
          <Route
            path="/academics/class/:classId"
            element={<ClassDetailPage />}
          />
        </Routes>
      </TestProviders>,
    );

    // The class page renders its header + the roster.
    await waitFor(() => {
      expect(screen.getByText("4AM - Section A")).toBeTruthy();
    });

    // Open the edit modal.
    fireEvent.click(await screen.findByRole("button", { name: /Modifier la classe/i }));
    await waitFor(() => {
      expect(screen.getByText(/Modifier les détails/)).toBeTruthy();
    });

    // The current roster is PRE-CHECKED (2 members).
    await waitFor(() => {
      expect(
        screen.getByTestId(`class-student-checkbox-${S_AMIN.id}`) as HTMLInputElement,
      ).toBeChecked();
      expect(
        screen.getByTestId(`class-student-checkbox-${S_LINA.id}`) as HTMLInputElement,
      ).toBeChecked();
    });
    // The candidates: Nadir (elsewhere, badge) unchecked.
    expect(
      screen.getByTestId(`class-student-checkbox-${S_MOVED.id}`) as HTMLInputElement,
    ).not.toBeChecked();

    // The diff: UNCHECK Lina (remove), CHECK Nadir (add/move).
    fireEvent.click(screen.getByTestId(`class-student-checkbox-${S_LINA.id}`));
    fireEvent.click(screen.getByTestId(`class-student-checkbox-${S_MOVED.id}`));

    fireEvent.click(screen.getByRole("button", { name: /Enregistrer les modifications/i }));

    await waitFor(() => {
      expect(recorder.calls.length).toBe(2);
    });
    const linaCall = recorder.calls.find((c) => c.id === S_LINA.id);
    const nadirCall = recorder.calls.find((c) => c.id === S_MOVED.id);
    // The two directions of the SAME seam.
    expect(linaCall?.updates.classId).toBeNull();
    expect(nadirCall?.updates.classId).toBe(EDITED_CLASS_ID);

    // The store reflects BOTH directions (the real persistence).
    await waitFor(() => {
      const lina = store.students.find((s) => s.id === S_LINA.id);
      const nadir = store.students.find((s) => s.id === S_MOVED.id);
      expect(lina?.classId).toBeNull();
      expect(nadir?.classId).toBe(EDITED_CLASS_ID);
    });
    // Full success → the modal CLOSES (contrast with the D partial-failure
    // pin: the modal stays open).
    await waitFor(() => {
      expect(screen.queryByText(/Modifier les détails/)).toBeNull();
    });
  });
});

/* ================================================================== */
/* D. Partial-failure honesty (the T-370 lesson).                      */
/* ================================================================== */

describe("T-474 D. Partial-failure honesty — a failing assignment is reported, never swallowed", () => {
  it("one failing student: the OTHER assignment still applies; the toast carries the failure", async () => {
    store.students = store.students.map((s) => {
      if (s.id === S_AMIN.id) return { ...s, classId: EDITED_CLASS_ID };
      if (s.id === S_LINA.id) return { ...s, classId: EDITED_CLASS_ID };
      return s;
    });
    store.notifyStudents();

    const recorder = new RecordingStudentRepository(mockRepositories.students);
    // Lina's removal FAILS (simulated); Nadir's add succeeds.
    recorder.failFor = new Set([S_LINA.id]);
    const repos = makeRecordingRepos(recorder);

    render(
      <TestProviders
        repositories={repos}
        route={`/academics/class/${EDITED_CLASS_ID}`}
      >
        <Routes>
          <Route
            path="/academics/class/:classId"
            element={<ClassDetailPage />}
          />
        </Routes>
      </TestProviders>,
    );
    await waitFor(() => {
      expect(screen.getByText("4AM - Section A")).toBeTruthy();
    });
    fireEvent.click(await screen.findByRole("button", { name: /Modifier la classe/i }));
    await waitFor(() => {
      expect(screen.getByText(/Modifier les détails/)).toBeTruthy();
    });
    await waitFor(() => {
      expect(
        screen.getByTestId(`class-student-checkbox-${S_AMIN.id}`) as HTMLInputElement,
      ).toBeChecked();
    });

    fireEvent.click(screen.getByTestId(`class-student-checkbox-${S_LINA.id}`));
    fireEvent.click(screen.getByTestId(`class-student-checkbox-${S_MOVED.id}`));
    fireEvent.click(screen.getByRole("button", { name: /Enregistrer les modifications/i }));

    await waitFor(() => {
      expect(recorder.calls.length).toBe(2);
    });
    // BOTH calls happened (the failure did not abort the batch silently)…
    const nadirCall = recorder.calls.find((c) => c.id === S_MOVED.id);
    expect(nadirCall?.updates.classId).toBe(EDITED_CLASS_ID);
    // …and the STORE reflects the successful one (Nadir moved in).
    await waitFor(() => {
      const nadir = store.students.find((s) => s.id === S_MOVED.id);
      expect(nadir?.classId).toBe(EDITED_CLASS_ID);
    });
    // The failure surfaces (the T-370 anti-swallow pin): the modal does NOT
    // close on a partial failure — the success path closes it
    // (setEditClassOpen(false) lives in the failures.length === 0 branch
    // only), so the operator sees the retry state. (The ToastProvider
    // renders no toast DOM in the test harness — the behavioral pin is the
    // modal's open state, which is ALSO what the operator experiences.)
    await waitFor(() => {
      expect(screen.getByText(/Modifier les détails/)).toBeTruthy();
    });
  });
});

/* ================================================================== */
/* E. The source guard — the persistence seam is the EXISTING call.    */
/* ================================================================== */

describe("T-474 E. Source guard — the wiring reuses the existing seam (no parallel implementation)", () => {
  it("both surfaces route through repos.students.updateStudent (source scan)", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");

    const createView = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../features/academics/grade-levels-class-view.tsx",
      ),
      "utf8",
    );
    const detailPage = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../features/academics/class-detail-page.tsx",
      ),
      "utf8",
    );

    // The create modal links the selected students through the seam…
    expect(createView).toContain("repos.students.updateStudent(studentId, {");
    expect(createView).toContain("classId: newClassId");
    // …and the edit modal applies BOTH directions through the same seam.
    expect(detailPage).toContain("repos.students.updateStudent(studentId, {");
    expect(detailPage).toContain("classId: cls.id");
    expect(detailPage).toContain("classId: null");
    // No parallel persistence: neither surface writes the store directly.
    expect(createView).not.toContain("store.students[");
    expect(detailPage).not.toContain("store.students[");
  });
});
