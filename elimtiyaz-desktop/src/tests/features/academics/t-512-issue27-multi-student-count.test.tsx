/**
 * T-512 (GitHub issue #27) — [Pedagogy] Student Registration Count Is Always
 * One Less Than Expected.
 *
 * THE REPORTED SYMPTOM: "When adding multiple students to a class in the
 * Pedagogy section, the application consistently registers one fewer student
 * than selected. For example, selecting 4 students results in only 3 being
 * registered."
 *
 * WHAT THIS SUITE PINS (the acceptance criteria of the issue):
 *
 *   A. The EDIT flow (ClassDetailPage → the edit modal multi-select):
 *      selecting 4 students (an empty-roster class) and saving registers
 *      EXACTLY 4 — four updateStudent(id, {classId}) calls, four rows in the
 *      store, and the roster read-back shows all four.
 *
 *   B. The EDIT flow with a larger group (8 students) — the "and larger
 *      groups" acceptance criterion.
 *
 *   C. The EDIT flow with pre-existing members (2 members + 4 additions):
 *      the additions do not re-write existing members (the diff excludes
 *      them) and the final roster is 6.
 *
 *   D. The CREATE flow (GradeLevelsClassView → CreateClassModal): selecting
 *      4 students at creation time links all 4 to the new class.
 *
 *   E. The count-vs-records invariant: after each save, the persisted store
 *      membership count EQUALS the number of selected students (the issue's
 *      "the roster and class count must match the records actually saved").
 *
 * Run:
 *   npx vitest run src/tests/features/academics/t-512-issue27-multi-student-count.test.tsx
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
import { GradeLevelsClassView } from "../../../features/academics/grade-levels-class-view";
import { ClassDetailPage } from "../../../features/academics/class-detail-page";
import { PersonNavigationProvider } from "../../../shared/navigation/person-navigation-context";

/* ------------------------------------------------------------------ */
/* Session + provider harness (the t-474 pattern).                     */
/* ------------------------------------------------------------------ */

const SESSION_KEY = "el-imtiyaz.session";
const TENANT = store.parents[0]?.tenantId ?? "t1";

function seedSession(): void {
  const session = {
    userId: "user-t512",
    tenantId: TENANT,
    email: "agent@elimtiyaz.dz",
    displayName: "Agent T510",
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
/* Fixtures — UUID-shaped ids + a grade-4AM cohort of EIGHT students.  */
/* ------------------------------------------------------------------ */

function makeStudent(over: Partial<Student>): Student {
  return {
    id: "a5100000-0000-4000-8000-000000000001",
    tenantId: TENANT,
    code: "ELV-2026-T51001",
    parentId: "par-001",
    firstName: "Amine",
    lastName: "Zerrouki",
    displayName: "Amine Zerrouki",
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

/** Eight 4AM students — the issue's "selecting 4 … and larger groups". */
const NAMES: Array<[string, string]> = [
  ["Amine", "Zerrouki"],
  ["Lina", "Hamdi"],
  ["Nadir", "Cherif"],
  ["Sofia", "Brahimi"],
  ["Karim", "Meziane"],
  ["Yasmine", "Ould-Ali"],
  ["Rania", "Mekki"],
  ["Walid", "Benali"],
];

const COHORT: Student[] = NAMES.map(([firstName, lastName], i) =>
  makeStudent({
    id: `a5100000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    code: `ELV-2026-T510${String(i + 1).padStart(2, "0")}`,
    firstName,
    lastName,
    displayName: `${firstName} ${lastName}`,
    gender: i % 2 === 0 ? "male" : "female",
  }),
);

/** The class under EDIT (starts EMPTY — the pure addition case). */
const EDITED_CLASS_ID = "b5100000-0000-4000-8000-00000000bbb";
const EDITED_CLASS: AcademicClass = {
  id: EDITED_CLASS_ID,
  tenantId: TENANT,
  code: "CLS-4AM-A-T510",
  name: "4AM - Section A",
  gradeCode: "4am",
  level: "cem",
  gradeYear: 1,
  section: "Section A",
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
  enrolledCount: 0,
} as unknown as AcademicClass;

const ALL_T510_CLASSES = [EDITED_CLASS];

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
  for (const s of COHORT) {
    if (!store.students.some((x) => x.id === s.id)) store.students.push({ ...s });
  }
  for (const c of ALL_T510_CLASSES) {
    if (!store.classes.some((x) => x.id === c.id)) store.classes.push({ ...c } as never);
  }
  store.notifyStudents();
  store.classes$.set([...store.classes]);
  seedSession();
});

/** Snapshot of the pre-test class ids — afterEach removes anything NEW. */
let classesBefore: string[];

afterEach(async () => {
  // T-512 test-isolation guard: the modal save loops are SEQUENTIAL async
  // writes over the SHARED mock store — a test that ends when the LAST wire
  // call merely STARTED leaks the remaining in-flight writes into the next
  // test (they mutate the re-added students mid-selection — the observed
  // cross-test failures). Poll for store quiescence, THEN clean up both the
  // cohort AND any class this test created.
  for (let i = 0; i < 40; i++) {
    const snapshot = JSON.stringify(
      store.students.filter((s) => COHORT.some((x) => x.id === s.id)).map((s) => [s.id, s.classId]),
    );
    await new Promise((r) => setTimeout(r, 100));
    const again = JSON.stringify(
      store.students.filter((s) => COHORT.some((x) => x.id === s.id)).map((s) => [s.id, s.classId]),
    );
    if (snapshot === again) break;
  }
  store.students = store.students.filter((s) => !COHORT.some((x) => x.id === s.id));
  store.classes = store.classes.filter((c) => classesBefore.includes(c.id));
  store.notifyStudents();
  store.classes$.set([...store.classes]);
  localStorage.removeItem(SESSION_KEY);
  cleanup();
});

/* ------------------------------------------------------------------ */
/* The recording student repository (the t-474 pattern).               */
/* ------------------------------------------------------------------ */

class RecordingStudentRepository {
  readonly calls: Array<{ id: string; updates: UpdateStudentInput }> = [];
  private readonly base: Repositories["students"];
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
      return Err(Errors.conflict("Affectation refusée (simulation T-512)"));
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

/** Renders the class detail page for the edited class with the recorder. */
function renderClassDetail(recorder: RecordingStudentRepository) {
  return render(
    <TestProviders
      repositories={makeRecordingRepos(recorder)}
      route={`/academics/class/${EDITED_CLASS_ID}`}
    >
      <Routes>
        <Route path="/academics/class/:classId" element={<ClassDetailPage />} />
      </Routes>
    </TestProviders>,
  );
}

/** Opens the edit modal and waits for the multi-select to appear. */
async function openEditModal() {
  fireEvent.click(await screen.findByRole("button", { name: /Modifier la classe/i }));
  await waitFor(() => {
    expect(screen.getByText(/Modifier les détails/)).toBeTruthy();
  });
}

/** Checks the first N cohort students in the modal's multi-select. */
function checkFirstN(n: number) {
  for (let i = 0; i < n; i++) {
    fireEvent.click(screen.getByTestId(`class-student-checkbox-${COHORT[i].id}`));
  }
}

async function saveModal() {
  fireEvent.click(
    screen.getByRole("button", { name: /Enregistrer les modifications/i }),
  );
}

/** The count of store rows whose classId is the edited class. */
function rosterCount(): number {
  return store.students.filter((s) => s.classId === EDITED_CLASS_ID).length;
}

/* ================================================================== */
/* A. The EDIT flow — 4 selected ⇒ exactly 4 registered.               */
/* ================================================================== */

describe("T-512 A. ClassDetailPage edit modal — selecting 4 registers exactly 4 (issue #27)", () => {
  beforeEach(() => {
    classesBefore = store.classes.map((c) => c.id);
  });

  it("an EMPTY-roster class + 4 checked students ⇒ 4 updateStudent calls, 4 store rows, roster read-back shows 4", async () => {
    const recorder = new RecordingStudentRepository(mockRepositories.students);
    renderClassDetail(recorder);

    await waitFor(() => {
      expect(screen.getByText("4AM - Section A")).toBeTruthy();
    });
    await openEditModal();

    // Nothing pre-checked (empty roster).
    await waitFor(() => {
      expect(
        screen.getByTestId(`class-student-checkbox-${COHORT[0].id}`) as HTMLInputElement,
      ).not.toBeChecked();
    });

    // THE ISSUE #27 SCENARIO: select 4 students.
    checkFirstN(4);
    expect(screen.getByTestId("class-student-selected-count").textContent).toBe(
      "4 sélectionnés",
    );

    await saveModal();

    // Exactly 4 wire calls — NOT 3 (the reported defect).
    await waitFor(() => {
      expect(recorder.calls.length).toBe(4);
    });
    for (const call of recorder.calls) {
      expect(call.updates.classId).toBe(EDITED_CLASS_ID);
    }
    expect(recorder.calls.map((c) => c.id).sort()).toEqual(
      COHORT.slice(0, 4).map((s) => s.id).sort(),
    );

    // The persisted store holds EXACTLY 4 members of the class.
    await waitFor(() => {
      expect(rosterCount()).toBe(4);
    });

    // The count-vs-records invariant (the issue's core acceptance criterion).
    expect(rosterCount()).toBe(4);
    expect(rosterCount()).toBe(recorder.calls.length);

    // Wait for the batch to fully complete (modal closes after the loop).
    await waitFor(() => {
      expect(screen.queryByText(/Modifier les détails/)).toBeNull();
    }, { timeout: 12000 });
  });

  it("selecting 1 student registers exactly 1 (the small-group criterion)", async () => {
    const recorder = new RecordingStudentRepository(mockRepositories.students);
    renderClassDetail(recorder);
    await waitFor(() => {
      expect(screen.getByText("4AM - Section A")).toBeTruthy();
    });
    await openEditModal();
    checkFirstN(1);
    await saveModal();
    await waitFor(() => {
      expect(recorder.calls.length).toBe(1);
    }, { timeout: 12000 });
    await waitFor(() => {
      expect(rosterCount()).toBe(1);
    }, { timeout: 12000 });
    await waitFor(() => {
      expect(screen.queryByText(/Modifier les détails/)).toBeNull();
    }, { timeout: 12000 });
  });

  it("selecting 2 students registers exactly 2 (the small-group criterion)", async () => {
    const recorder = new RecordingStudentRepository(mockRepositories.students);
    renderClassDetail(recorder);
    await waitFor(() => {
      expect(screen.getByText("4AM - Section A")).toBeTruthy();
    });
    await openEditModal();
    checkFirstN(2);
    await saveModal();
    await waitFor(() => {
      expect(recorder.calls.length).toBe(2);
    }, { timeout: 12000 });
    await waitFor(() => {
      expect(rosterCount()).toBe(2);
    }, { timeout: 12000 });
    await waitFor(() => {
      expect(screen.queryByText(/Modifier les détails/)).toBeNull();
    }, { timeout: 12000 });
  });
});

/* ================================================================== */
/* B. The EDIT flow — a larger group (8) registers exactly 8.          */
/* ================================================================== */

describe("T-512 B. ClassDetailPage edit modal — a larger group (8 students)", () => {
  beforeEach(() => {
    classesBefore = store.classes.map((c) => c.id);
  });

  it("8 checked students ⇒ 8 updateStudent calls and 8 store rows", async () => {
    const recorder = new RecordingStudentRepository(mockRepositories.students);
    renderClassDetail(recorder);

    await waitFor(() => {
      expect(screen.getByText("4AM - Section A")).toBeTruthy();
    });
    await openEditModal();
    checkFirstN(8);
    expect(screen.getByTestId("class-student-selected-count").textContent).toBe(
      "8 sélectionnés",
    );
    await saveModal();

    // The mock writes are SEQUENTIAL (~180ms each): 8 × 180 = ~1.5s — the
    // generous timeout is load-bearing (the default 1s waitFor would flake).
    await waitFor(() => {
      expect(recorder.calls.length).toBe(8);
    }, { timeout: 8000 });
    await waitFor(() => {
      expect(rosterCount()).toBe(8);
    }, { timeout: 8000 });
    await waitFor(() => {
      expect(screen.queryByText(/Modifier les détails/)).toBeNull();
    }, { timeout: 12000 });
  });
});

/* ================================================================== */
/* C. The EDIT flow — pre-existing members + additions (the diff).     */
/* ================================================================== */

describe("T-512 C. ClassDetailPage edit modal — 2 existing members + 4 additions", () => {
  beforeEach(() => {
    classesBefore = store.classes.map((c) => c.id);
  });

  it("the 4 additions register; existing members are not re-written; final roster is 6", async () => {
    // Two pre-existing members.
    store.students = store.students.map((s) => {
      if (s.id === COHORT[0].id || s.id === COHORT[1].id) {
        return { ...s, classId: EDITED_CLASS_ID };
      }
      return s;
    });
    store.notifyStudents();

    const recorder = new RecordingStudentRepository(mockRepositories.students);
    renderClassDetail(recorder);

    await waitFor(() => {
      expect(screen.getByText("4AM - Section A")).toBeTruthy();
    });
    await openEditModal();

    // The current roster is pre-checked (2 members).
    await waitFor(() => {
      expect(
        screen.getByTestId(`class-student-checkbox-${COHORT[0].id}`) as HTMLInputElement,
      ).toBeChecked();
      expect(
        screen.getByTestId(`class-student-checkbox-${COHORT[1].id}`) as HTMLInputElement,
      ).toBeChecked();
    });

    // Add 4 MORE students (total selection = 6).
    checkFirstNShifted(2, 4);
    expect(screen.getByTestId("class-student-selected-count").textContent).toBe(
      "6 sélectionnés",
    );

    await saveModal();

    // The DIFF writes ONLY the 4 additions — the 2 existing members are
    // already members (no redundant writes).
    await waitFor(() => {
      expect(recorder.calls.length).toBe(4);
    }, { timeout: 12000 });
    for (const call of recorder.calls) {
      expect(call.updates.classId).toBe(EDITED_CLASS_ID);
    }
    await waitFor(() => {
      expect(rosterCount()).toBe(6);
    }, { timeout: 12000 });
    await waitFor(() => {
      expect(screen.queryByText(/Modifier les détails/)).toBeNull();
    }, { timeout: 12000 });
  });
});

/** Checks students[start..start+n) in the modal's multi-select. */
function checkFirstNShifted(start: number, n: number) {
  for (let i = start; i < start + n; i++) {
    fireEvent.click(screen.getByTestId(`class-student-checkbox-${COHORT[i].id}`));
  }
}

/* ================================================================== */
/* D. The CREATE flow — 4 selected at creation ⇒ 4 linked.             */
/* ================================================================== */

describe("T-512 D. CreateClassModal — selecting 4 students at creation links all 4", () => {
  beforeEach(() => {
    classesBefore = store.classes.map((c) => c.id);
  });

  it("create class with 4 checked students ⇒ createClass then 4 updateStudent(classId=<new id>)", async () => {
    const recorder = new RecordingStudentRepository(mockRepositories.students);
    const repos = makeRecordingRepos(recorder);
    const classesBefore = store.classes.length;

    render(
      <TestProviders repositories={repos}>
        <GradeLevelsClassView canCreate={true} />
      </TestProviders>,
    );

    const levelButtons = await screen.findAllByRole("button", {
      name: /Ajouter une classe à ce niveau/i,
    });
    const am4Button = levelButtons.find((btn) =>
      (btn.closest("div")?.textContent ?? "").includes("4AM"),
    ) ?? levelButtons[levelButtons.length - 1];
    fireEvent.click(am4Button);

    await waitFor(() => {
      expect(screen.getByText("Créer une nouvelle classe")).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.getByText(/Amine Zerrouki/)).toBeTruthy();
    });

    // THE ISSUE #27 SCENARIO: select 4 students at creation time.
    checkFirstN(4);
    expect(screen.getByTestId("class-student-selected-count").textContent).toBe(
      "4 sélectionnés",
    );

    fireEvent.click(screen.getByRole("button", { name: /Créer la classe/i }));

    await waitFor(() => {
      expect(recorder.calls.length).toBe(4);
    }, { timeout: 12000 });
    expect(store.classes.length).toBeGreaterThan(classesBefore);
    const newClass = store.classes.find(
      (c) =>
        !ALL_T510_CLASSES.some((x) => x.id === c.id) &&
        store.classes.indexOf(c) >= classesBefore,
    );
    expect(newClass).toBeTruthy();

    for (const call of recorder.calls) {
      expect(call.updates.classId).toBe(newClass!.id);
    }
    expect(recorder.calls.map((c) => c.id).sort()).toEqual(
      COHORT.slice(0, 4).map((s) => s.id).sort(),
    );

    // Wait for the batch to complete (the modal closes after the loop).
    await waitFor(() => {
      expect(screen.queryByText("Créer une nouvelle classe")).toBeNull();
    }, { timeout: 12000 });
  });
});

/* ================================================================== */
/* E. The count-vs-records invariant — the displayed count after save. */
/* ================================================================== */

describe("T-512 E. The count-vs-records invariant (the roster list and the count agree)", () => {
  beforeEach(() => {
    classesBefore = store.classes.map((c) => c.id);
  });

  it("after saving 4 additions, the class page's roster header shows 4 élève(s) inscrit(s) and 4 rows", async () => {
    const recorder = new RecordingStudentRepository(mockRepositories.students);
    renderClassDetail(recorder);

    await waitFor(() => {
      expect(screen.getByText("4AM - Section A")).toBeTruthy();
    });
    await openEditModal();
    checkFirstN(4);
    await saveModal();

    // The modal closes on full success.
    await waitFor(() => {
      expect(screen.queryByText(/Modifier les détails/)).toBeNull();
    });

    // The roster header count matches the 4 persisted rows.
    await waitFor(() => {
      const header = screen.getByText(/élève\(s\) inscrit\(s\) dans cette classe/);
      expect(header.textContent).toContain("4");
    });
    // And every one of the four students is listed on the roster.
    for (let i = 0; i < 4; i++) {
      await waitFor(() => {
        expect(screen.getByText(new RegExp(`${COHORT[i].firstName} ${COHORT[i].lastName}`))).toBeTruthy();
      });
    }
    expect(rosterCount()).toBe(4);
  });
});
