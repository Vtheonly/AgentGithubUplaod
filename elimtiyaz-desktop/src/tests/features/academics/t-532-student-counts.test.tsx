/**
 * T-532 / DATA-064 (GitHub issue #32 §6) — Correct Student Count and
 * Display Errors: the two divergent count channels unified.
 *
 * THE REPORTED SYMPTOMS: "The Pedagogy section currently displays
 * incorrect student counts in some situations. Counts may appear as zero
 * or be short by one student… Student counts must remain accurate after
 * class creation, splitting, merging, reassignment, academic year
 * changes, batch promotion, and re-enrollment."
 *
 * THE ROOT CAUSE (DATA-064): two channels computed "students in this
 * class" — Channel A (the class repo's enrolledCount histogram) and
 * Channel B (the student-cache roster) — and every roster-changing write
 * refreshed only ONE of them (or neither): the create-class link loop
 * refreshed neither (the new card showed 0 next to its "N élève(s)
 * affecté(s)" toast), roster edits refreshed the roster only (stale card
 * counts), the mock NEVER recomputed outside finalizePlacements (and with
 * an active-only status filter the Supabase histogram never had).
 *
 * WHAT THIS SUITE PINS (the fix's acceptance criteria):
 *
 *   A. The ONE counting rule — enrolledCount ≡ the roster (observeByClass)
 *      for EVERY write path, including non-active students holding a
 *      class_id (no status filter on either side, both repository modes
 *      agree by construction).
 *
 *   B. The create-class link loop: after createClass + N updateStudent
 *      links, the class's enrolledCount IS N (the "appears as zero"
 *      symptom closed) and the classes$ observable pushed the new value.
 *
 *   C. Moves and removals recompute BOTH ends (A→B drops A, raises B;
 *      null clears).
 *
 *   D. deleteStudent recomputes the departed class.
 *
 *   E. The UI refresh seam: the create-class modal and the class-detail
 *      roster-edit call classes.refresh() after their roster writes (the
 *      Supabase histogram re-capture — the mock recomputes internally).
 *
 *   F. finalizePlacements' recompute uses the SAME one rule (a non-active
 *      member counts — the dropped active-only filter).
 *
 * Run:
 *   npx vitest run src/tests/features/academics/t-532-student-counts.test.tsx
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll } from "vitest";
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
import type { Student, GradeLevel } from "../../../domain/model/student";
import type { AcademicClass } from "../../../domain/model/academic";
import { GradeLevelsClassView } from "../../../features/academics/grade-levels-class-view";
import { ClassDetailPage } from "../../../features/academics/class-detail-page";
import { PersonNavigationProvider } from "../../../shared/navigation/person-navigation-context";

/* ------------------------------------------------------------------ */
/* Session + provider harness (the t-512 pattern).                     */
/* ------------------------------------------------------------------ */

const SESSION_KEY = "el-imtiyaz.session";
const TENANT = store.parents[0]?.tenantId ?? "t1";

function seedSession(): void {
  const session = {
    userId: "user-t532",
    tenantId: TENANT,
    email: "agent@elimtiyaz.dz",
    displayName: "Agent T532",
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
/* Fixtures — a 4AM cohort + two classes.                              */
/* ------------------------------------------------------------------ */

function makeStudent(over: Partial<Student>): Student {
  return {
    id: "a5320000-0000-4000-8000-000000000001",
    tenantId: TENANT,
    code: "ELV-2026-T53201",
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

const NAMES: Array<[string, string]> = [
  ["Amine", "Zerrouki"],
  ["Lina", "Hamdi"],
  ["Nadir", "Cherif"],
  ["Sofia", "Brahimi"],
];

const COHORT: Student[] = NAMES.map(([firstName, lastName], i) =>
  makeStudent({
    id: `a5320000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    code: `ELV-2026-T532${String(i + 1).padStart(2, "0")}`,
    firstName,
    lastName,
    displayName: `${firstName} ${lastName}`,
    gender: i % 2 === 0 ? "male" : "female",
  }),
);

const CLASS_A_ID = "b5320000-0000-4000-8000-00000000aaa";
const CLASS_B_ID = "b5320000-0000-4000-8000-00000000bbb";

function makeClass(id: string, code: string, name: string): AcademicClass {
  return {
    id,
    tenantId: TENANT,
    code,
    name,
    gradeCode: "4am",
    level: "cem",
    gradeYear: 1,
    section: name,
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
}

const CLASS_A = makeClass(CLASS_A_ID, "CLS-4AM-A-T532", "4AM - Section A");
const CLASS_B = makeClass(CLASS_B_ID, "CLS-4AM-B-T532", "4AM - Section B");
const ALL_T532_CLASSES = [CLASS_A, CLASS_B];

beforeAll(() => {
  class ResizeObserverStub {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    observe() {}
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    unobserve() {}
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    disconnect() {}
  }
  (globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
});

/** Tracks the classes$ pushes (Channel A's re-derivation). */
let classesPushes: AcademicClass[][] = [];
let pushUnsubscribe: (() => void) | null = null;

beforeEach(() => {
  classesPushes = [];
  pushUnsubscribe = store.classes$.subscribe((next) => {
    classesPushes.push(next);
  }) as unknown as () => void;
  for (const s of COHORT) {
    if (!store.students.some((x) => x.id === s.id)) store.students.push({ ...s });
  }
  for (const c of ALL_T532_CLASSES) {
    if (!store.classes.some((x) => x.id === c.id)) store.classes.push({ ...c } as never);
  }
  store.notifyStudents();
  store.classes$.set([...store.classes]);
  seedSession();
});

let classesBefore: string[];

afterEach(async () => {
  // The t-512 isolation guard: poll for store quiescence before cleanup.
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
  pushUnsubscribe?.();
  pushUnsubscribe = null;
  store.notifyStudents();
  store.classes$.set([...store.classes]);
  localStorage.removeItem(SESSION_KEY);
  cleanup();
});

/** The class's CURRENT enrolledCount through the store (Channel A). */
function cardCount(classId: string): number {
  return store.classes.find((c) => c.id === classId)?.enrolledCount ?? -1;
}

/** The roster length through the live store (Channel B's dataset — the
 * same rows observeByClass derives from, asserted synchronously). */
function rosterCount(classId: string): number {
  return store.students.filter((s) => s.classId === classId).length;
}

/* ================================================================== */
/* A-B. The ONE counting rule + the create-class link loop (was zero). */
/* ================================================================== */

describe("T-532/DATA-064 A+B. The one counting rule and the create-class link loop", () => {
  beforeEach(() => {
    classesBefore = store.classes.map((c) => c.id);
  });

  it("after createClass + 3 updateStudent links, the class card count IS 3 (the zero symptom closed) and classes$ pushed", async () => {
    // The create-class modal's exact persistence seam (T-474): createClass
    // then per-student updateStudent({classId: new id}).
    const created = await mockRepositories.classes.createClass({
      academicYearId: "ay-2026-2027",
      academicLevelId: "al-4am",
      code: "CLS-4AM-T532-NEW",
      name: "4AM - Section T532",
      gradeCode: "4am" as GradeLevel,
      level: "cem",
      gradeYear: 1,
      section: "Section T532",
      filiereCode: null,
      specialiteCode: null,
      room: null,
      capacity: null,
      homeroomTeacherId: null,
      homeroomTeacherName: null,
      notes: null,
      academicYear: "2026-2027",
      isActive: true,
    } as Omit<AcademicClass, "id" | "tenantId" | "enrolledCount">);
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // BEFORE the fix this was the exact "appears as zero" symptom: the
    // class card stayed at 0 while the loop linked N students.
    expect(cardCount(created.value.id)).toBe(0);

    for (let i = 0; i < 3; i++) {
      const r = await mockRepositories.students.updateStudent(COHORT[i].id, {
        classId: created.value.id,
      });
      expect(r.ok).toBe(true);
    }

    // The card count followed the loop — same cycle, no refresh needed.
    expect(cardCount(created.value.id)).toBe(3);
    // The roster channel agrees (the one rule).
    expect(rosterCount(created.value.id)).toBe(3);
    // And the classes observable PUSHED the new value (the cards re-render).
    const lastPush = classesPushes[classesPushes.length - 1] ?? [];
    const pushed = lastPush.find((c) => c.id === created.value.id);
    expect(pushed?.enrolledCount).toBe(3);
  });

  it("the ONE RULE: a non-active (graduated) student holding class_id counts in BOTH channels identically (no status filter)", async () => {
    // A graduated student still pointing at CLASS_A (the promotion flow
    // NULLs class_id for graduated, but legacy/imported rows can hold it).
    store.students = store.students.map((s) =>
      s.id === COHORT[0].id ? { ...s, classId: CLASS_A_ID, status: "graduated" as never } : s,
    );
    store.notifyStudents();
    // An active student too — linked through the REPOSITORY seam (the
    // updateStudent path that recomputes the affected classes).
    const r = await mockRepositories.students.updateStudent(COHORT[1].id, {
      classId: CLASS_A_ID,
    });
    expect(r.ok).toBe(true);

    // The recompute (triggered by the repository write) counted BOTH rows —
    // the OLD active-only filter would have returned 1 here, diverging from
    // the roster and from the Supabase histogram (which never filtered).
    expect(cardCount(CLASS_A_ID)).toBe(2);
    expect(rosterCount(CLASS_A_ID)).toBe(2);
  });
});

/* ================================================================== */
/* C-D. Moves, removals, deletes recompute BOTH ends.                  */
/* ================================================================== */

describe("T-532/DATA-064 C+D. Moves, removals and deletes recompute both channels", () => {
  beforeEach(() => {
    classesBefore = store.classes.map((c) => c.id);
  });

  it("a MOVE A→B drops A and raises B in the same cycle", async () => {
    await mockRepositories.students.updateStudent(COHORT[0].id, { classId: CLASS_A_ID });
    await mockRepositories.students.updateStudent(COHORT[1].id, { classId: CLASS_A_ID });
    expect(cardCount(CLASS_A_ID)).toBe(2);

    await mockRepositories.students.updateStudent(COHORT[0].id, { classId: CLASS_B_ID });
    expect(cardCount(CLASS_A_ID)).toBe(1);
    expect(cardCount(CLASS_B_ID)).toBe(1);
    expect(rosterCount(CLASS_A_ID)).toBe(1);
    expect(rosterCount(CLASS_B_ID)).toBe(1);
  });

  it("a REMOVAL (classId: null) drops the count (the roster-edit diff's remove leg)", async () => {
    await mockRepositories.students.updateStudent(COHORT[2].id, { classId: CLASS_A_ID });
    expect(cardCount(CLASS_A_ID)).toBe(1);
    await mockRepositories.students.updateStudent(COHORT[2].id, { classId: null });
    expect(cardCount(CLASS_A_ID)).toBe(0);
    expect(rosterCount(CLASS_A_ID)).toBe(0);
  });

  it("deleteStudent recomputes the departed class", async () => {
    await mockRepositories.students.updateStudent(COHORT[3].id, { classId: CLASS_B_ID });
    expect(cardCount(CLASS_B_ID)).toBe(1);
    await mockRepositories.students.deleteStudent(COHORT[3].id);
    expect(cardCount(CLASS_B_ID)).toBe(0);
  });
});

/* ================================================================== */
/* E. The UI refresh seam — the write surfaces call classes.refresh().  */
/* ================================================================== */

/** Wraps the mock classes repo with a refresh spy (the UI's optional-call cast). */
class RefreshSpyClassesRepository {
  readonly refreshCalls: number[] = [];
  private readonly base: Repositories["classes"];
  readonly observe: Repositories["classes"]["observe"];
  readonly observeByLevel: Repositories["classes"]["observeByLevel"];
  readonly observeById: Repositories["classes"]["observeById"];
  readonly createClass: Repositories["classes"]["createClass"];
  readonly updateClass: Repositories["classes"]["updateClass"];
  constructor(base: Repositories["classes"]) {
    this.base = base;
    this.observe = base.observe.bind(base);
    this.observeByLevel = base.observeByLevel.bind(base);
    this.observeById = base.observeById.bind(base);
    this.createClass = base.createClass.bind(base);
    this.updateClass = base.updateClass.bind(base);
  }
  async refresh(): Promise<void> {
    this.refreshCalls.push(Date.now());
  }
}

function makeSpyRepos(spy: RefreshSpyClassesRepository): Repositories {
  return {
    ...mockRepositories,
    classes: spy as unknown as Repositories["classes"],
  } as Repositories;
}

describe("T-532/DATA-064 E. The UI write surfaces refresh the classes cache (the Supabase seam)", () => {
  beforeEach(() => {
    classesBefore = store.classes.map((c) => c.id);
  });

  it("the create-class modal calls classes.refresh() after the link batch", async () => {
    const spy = new RefreshSpyClassesRepository(mockRepositories.classes);
    const repos = makeSpyRepos(spy);
    const classesBeforeCount = store.classes.length;

    render(
      <TestProviders repositories={repos}>
        <GradeLevelsClassView canCreate={true} />
      </TestProviders>,
    );

    const levelButtons = await screen.findAllByRole("button", {
      name: /Ajouter une classe à ce niveau/i,
    });
    const am4Button =
      levelButtons.find((btn) =>
        (btn.closest("div")?.textContent ?? "").includes("4AM"),
      ) ?? levelButtons[levelButtons.length - 1];
    fireEvent.click(am4Button);

    await waitFor(() => {
      expect(screen.getByText("Créer une nouvelle classe")).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.getByText(/Amine Zerrouki/)).toBeTruthy();
    });

    // Select 3 students at creation time.
    for (let i = 0; i < 3; i++) {
      fireEvent.click(screen.getByTestId(`class-student-checkbox-${COHORT[i].id}`));
    }
    expect(screen.getByTestId("class-student-selected-count").textContent).toBe(
      "3 sélectionnés",
    );

    fireEvent.click(screen.getByRole("button", { name: /Créer la classe/i }));

    // The batch completes (the modal closes after the loop).
    await waitFor(() => {
      expect(screen.queryByText("Créer une nouvelle classe")).toBeNull();
    }, { timeout: 12000 });

    expect(store.classes.length).toBeGreaterThan(classesBeforeCount);
    // THE SEAM: the classes cache refresh fired after the roster writes.
    expect(spy.refreshCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("the class-detail roster edit calls classes.refresh() when the diff is non-empty", async () => {
    const spy = new RefreshSpyClassesRepository(mockRepositories.classes);
    const repos = makeSpyRepos(spy);

    render(
      <TestProviders repositories={repos} route={`/academics/class/${CLASS_A_ID}`}>
        <Routes>
          <Route path="/academics/class/:classId" element={<ClassDetailPage />} />
        </Routes>
      </TestProviders>,
    );

    await waitFor(() => {
      expect(screen.getByText("4AM - Section A")).toBeTruthy();
    });

    // Open the edit modal.
    fireEvent.click(await screen.findByRole("button", { name: /Modifier la classe/i }));
    await waitFor(() => {
      expect(screen.getByText(/Modifier les détails/)).toBeTruthy();
    });

    // Add 2 students to the roster.
    for (let i = 0; i < 2; i++) {
      fireEvent.click(screen.getByTestId(`class-student-checkbox-${COHORT[i].id}`));
    }
    expect(screen.getByTestId("class-student-selected-count").textContent).toBe(
      "2 sélectionnés",
    );

    fireEvent.click(screen.getByRole("button", { name: /Enregistrer les modifications/i }));

    await waitFor(() => {
      expect(screen.queryByText(/Modifier les détails/)).toBeNull();
    }, { timeout: 12000 });

    expect(rosterCount(CLASS_A_ID)).toBe(2);
    // THE SEAM: the roster diff triggered the classes refresh.
    expect(spy.refreshCalls.length).toBeGreaterThanOrEqual(1);
  });
});

/* ================================================================== */
/* F. finalizePlacements recomputes through the SAME one rule.          */
/* ================================================================== */

describe("T-532/DATA-064 F. finalizePlacements' recompute uses the one rule (the dropped active-only filter)", () => {
  beforeEach(() => {
    classesBefore = store.classes.map((c) => c.id);
  });

  it("a non-active member counts in the finalize recompute (mock ≡ Supabase histogram semantics)", async () => {
    // One active + one graduated student pointing at CLASS_A.
    store.students = store.students.map((s) => {
      if (s.id === COHORT[0].id) return { ...s, classId: CLASS_A_ID };
      if (s.id === COHORT[1].id)
        return { ...s, classId: CLASS_A_ID, status: "graduated" as never };
      return s;
    });
    store.notifyStudents();

    // finalizePlacements with an empty batch over the target year still
    // runs the full recompute loop (the mutation pass unconditionally
    // recomputes every class's enrolledCount).
    const result = await mockRepositories.classPlacement.finalizePlacements({
      targetAcademicYearId: "ay-2026-2027",
      targetAcademicYearCode: "2026-2027",
      newClasses: [],
      classesToUpdate: [],
      studentAssignments: [],
      performedBy: "user-t532",
      performedByName: "Agent T532",
    });
    expect(result.ok).toBe(true);

    // The OLD active-only filter would have counted 1; the ONE rule counts
    // both — identical to the roster and to the Supabase histogram.
    expect(cardCount(CLASS_A_ID)).toBe(2);
    expect(rosterCount(CLASS_A_ID)).toBe(2);
  });
});
