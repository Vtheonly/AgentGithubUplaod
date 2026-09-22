// ============================================================================
// FILE: src/tests/features/academics/t-410-per-class-timetables.test.tsx
// ============================================================================
/**
 * T-410 — PER-CLASS TIMETABLES IN THE STAFF UI (SCHED-112).
 *
 * THE OWNER CONTRACT: "3 classes of 5AP and 2 classes of 2AM = 5 classes
 * total → 5 completely separate timetables, each internally complete and
 * conflict-free — NOT one universal timetable where all classes, teachers
 * and rooms are mixed together."
 *
 * WHAT THIS SUITE PINS (against the REAL TimetableTab with the REAL mock
 * repositories — the canonical paths, §15.50b):
 *   1. The class-mode status strip: the SELECTED class's own validation
 *      (Complet badge + its own placed/required periods).
 *   2. The trials panel renders the per-class table — "Emplois du temps
 *      par classe (5)" with one row per class and the "5/5 classes
 *      complètes" rollup.
 *   3. Each class row's "Examiner" opens THAT class's own weekly grid
 *      (re-scoped strictly by classId).
 *   4. The teacher selector offers NO "Tout afficher" — every projection
 *      is ONE entity's timetable (entity-mandatory, first-teacher default).
 *
 * FIXTURE STRATEGY: the T-410 five-class domain fixture (3×5AP + 2×2AM,
 * shared teachers across the school) remapped onto the mock store's REAL
 * classes/subjects, generated through the SAME repository the tab wires.
 */

import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import * as React from "react";

import "../../../i18n/i18n";

beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
});

import {
  mockRepositories,
  RepositoryProvider,
} from "../../../app/providers/repository-provider";
import { AuthProvider } from "../../../app/providers/auth-provider";
import { ToastProvider } from "../../../app/providers/toast-provider";
import { Role } from "../../../core/rbac/roles";
import { TimetableTab } from "../../../features/academics/timetable/timetable-tab";
import { mockTimetableRepository } from "../../../infrastructure/mock/repositories/timetable-repository";
import { mockAcademicYearRepository } from "../../../infrastructure/mock/repositories/academic-year-repository";
import type { Subject } from "../../../domain/model/academic";
import type {
  Room,
  TimetableProblem,
  TimetableRequirement,
} from "../../../domain/model/timetable";
import { algerianDefaultConfiguration } from "../../../domain/calc/timetable/algerian-profile";
import { pickRadixOption, radixOptionTexts } from "../../_helpers/radix-mouse";

const SESSION_KEY = "el-imtiyaz.session";

function seedSuperAdminSession(): void {
  const session = {
    userId: "user-t410",
    tenantId: "tenant-1",
    email: "agent@elimtiyaz.dz",
    displayName: "Agent T410",
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

function TestProviders({ children }: { children: React.ReactNode }) {
  return (
    <RepositoryProvider repositories={mockRepositories}>
      <AuthProvider>
        <ToastProvider>{children}</ToastProvider>
      </AuthProvider>
    </RepositoryProvider>
  );
}

// ── The five-class fixture remapped onto the mock store's REAL rows ────────

const seedClasses = mockRepositories.classes.observe().get();
// 3×5AP + 2×2AM: the first five REAL classes stand in for the owner's
// five classes (the report's className comes from the problem, so the
// remap keeps display names from the real rows).
const FIVE_REAL_CLASS_IDS = seedClasses.slice(0, 5).map((c) => c.id);
const FIRST_CLASS = seedClasses[0];
const FIFTH_CLASS = seedClasses[4];
const FIRST_CLASS_NAME = FIRST_CLASS?.name ?? FIRST_CLASS?.code ?? "";
const FIFTH_CLASS_NAME = FIFTH_CLASS?.name ?? FIFTH_CLASS?.code ?? "";

const seedSubjects: Subject[] = mockRepositories.subjects.observe().get();
const SUBJECT_REMAP = new Map(
  ["sub-ar", "sub-math", "sub-fr", "sub-isis", "sub-svt"].map((fixtureId, i) => [
    fixtureId,
    seedSubjects[i]?.id ?? fixtureId,
  ]),
);
const AR_NAME = seedSubjects[0]?.name ?? "Matière";
const MATH_NAME = seedSubjects[1]?.name ?? "Matière";

const seedTeachers = mockRepositories.personnel
  .observe()
  .get()
  .filter((p) => p.staffCategory === "teacher");
const FIRST_TEACHER_NAME = seedTeachers[0]
  ? `${seedTeachers[0].firstName} ${seedTeachers[0].lastName}`
  : "";

function buildRemappedFiveClassProblem(): TimetableProblem {
  const base = buildFiveClassProblem();
  const idOf = (fixtureId: string, i: number) =>
    FIVE_REAL_CLASS_IDS[i] ?? fixtureId;
  const nameOf = new Map(seedClasses.map((c) => [c.id, c.name ?? c.code]));
  const classIdMap = new Map(
    base.classes.map((c, i) => [c.id, idOf(c.id, i)] as [string, string]),
  );
  return {
    ...base,
    classes: base.classes.map((c, i) => ({
      ...c,
      id: idOf(c.id, i),
      name: nameOf.get(idOf(c.id, i)) ?? c.name,
    })),
    requirements: base.requirements.map((r) => ({
      ...r,
      classId: classIdMap.get(r.classId) ?? r.classId,
      className: nameOf.get(classIdMap.get(r.classId) ?? r.classId) ?? r.className,
      subjectId: SUBJECT_REMAP.get(r.subjectId) ?? r.subjectId,
    })),
    constraints: [], // clean five-class solve — no free days
  };
}

/** The owner's five classes: 3×5AP (14 periods each) + 2×2AM (16 each,
 *  SVT double block in the lab) — shared teachers across the school. */
function buildFiveClassProblem(): TimetableProblem {
  const tenant = "tenant-t410";
  const year = "year-t410";
  const classes = [
    { id: "cls-5ap-a", code: "5AP-A", name: "5AP — A", capacity: 30 },
    { id: "cls-5ap-b", code: "5AP-B", name: "5AP — B", capacity: 30 },
    { id: "cls-5ap-c", code: "5AP-C", name: "5AP — C", capacity: 28 },
    { id: "cls-2am-a", code: "2AM-A", name: "2AM — A", capacity: 32 },
    { id: "cls-2am-b", code: "2AM-B", name: "2AM — B", capacity: 32 },
  ];
  const teachers = [
    { id: "tch-ar", name: "M. Ziani (Arabe)" },
    { id: "tch-math", name: "M. Belkacem (Maths)" },
    { id: "tch-fr", name: "Mme Saidi (Français)" },
    { id: "tch-isis", name: "M. Cherif (Éducation islamique)" },
    { id: "tch-svt", name: "Mme Haddad (Sciences)" },
  ];
  const roomSpecs: Array<{
    id: string;
    code: string;
    roomType: Room["roomType"];
    capacity: number;
  }> = [
    { id: "room-s1", code: "SAL-01", roomType: "classroom", capacity: 32 },
    { id: "room-s2", code: "SAL-02", roomType: "classroom", capacity: 32 },
    { id: "room-s3", code: "SAL-03", roomType: "classroom", capacity: 32 },
    { id: "room-s4", code: "SAL-04", roomType: "classroom", capacity: 32 },
    { id: "room-s5", code: "SAL-05", roomType: "classroom", capacity: 32 },
    { id: "room-lab", code: "LAB-SCI", roomType: "science_lab", capacity: 32 },
  ];
  const rooms: Room[] = roomSpecs.map((r) => ({
    id: r.id,
    tenantId: tenant,
    code: r.code,
    name: r.code,
    roomType: r.roomType,
    capacity: r.capacity,
    building: "A",
    floorLabel: "RDC",
    isActive: true,
    notes: null,
    createdAt: "2026-09-22T00:00:00.000Z",
    updatedAt: "2026-09-22T00:00:00.000Z",
  }));
  const requirements: TimetableRequirement[] = [];
  for (const cls of classes) {
    const base: Array<readonly [string, string, string, number]> = [
      ["sub-ar", "Langue arabe", "tch-ar", 4],
      ["sub-math", "Mathématiques", "tch-math", 4],
      ["sub-fr", "Langue française", "tch-fr", 4],
      ["sub-isis", "Éducation islamique", "tch-isis", 2],
    ];
    for (const [subjectId, subjectName, teacherId, weeklyHours] of base) {
      requirements.push({
        classId: cls.id,
        subjectId,
        teacherId,
        weeklyHours,
        consecutivePeriods: 1,
        requiredRoomType: null,
        className: cls.name,
        subjectName,
        teacherName: teachers.find((t) => t.id === teacherId)?.name ?? null,
        classSize: cls.capacity,
      });
    }
    if (cls.id.startsWith("cls-2am")) {
      requirements.push({
        classId: cls.id,
        subjectId: "sub-svt",
        teacherId: "tch-svt",
        weeklyHours: 2,
        consecutivePeriods: 2,
        requiredRoomType: "science_lab" as const,
        className: cls.name,
        subjectName: "Sciences de la vie et de la terre",
        teacherName: "Mme Haddad (Sciences)",
        classSize: cls.capacity,
      });
    }
  }
  return {
    configuration: algerianDefaultConfiguration(tenant, year),
    classes,
    teachers,
    rooms,
    requirements,
    constraints: [],
    lockedEntries: [],
  };
}

beforeAll(async () => {
  seedSuperAdminSession();
  const yearResult = await mockAcademicYearRepository.getCurrentYear();
  if (!yearResult.ok) throw new Error("T-410 fixture: no current academic year");
  // Canonical-path generation: the same repository the tab wires — the
  // version's statistics carry the per-class reports (solver v1.2.0).
  const result = await mockTimetableRepository.generateTimetable(
    { academicYearId: yearResult.value.id },
    { actorId: "user-t410", actorName: "Agent T410" },
    buildRemappedFiveClassProblem(),
  );
  if (!result.ok) {
    throw new Error(`T-410 fixture generation failed: ${result.error.message}`);
  }
});

afterEach(() => cleanup());

// ============================================================================
// 1. The class-mode status strip — the selected class's OWN validation
// ============================================================================

describe("T-410 — the class-mode status strip (the selected class's own report)", () => {
  it("shows the default class's Complet status and its own placed/required periods", async () => {
    render(
      <TestProviders>
        <TimetableTab />
      </TestProviders>,
    );
    await waitFor(() => {
      expect(screen.getByText(`Classe : ${FIRST_CLASS_NAME}`)).toBeTruthy();
    });
    // The strip: the FIRST class (a 5AP class — 14 required periods) is
    // complete with all 14 placed.
    await waitFor(() => {
      expect(screen.getAllByText("Complet").length).toBeGreaterThan(0);
    });
    expect(screen.getByText("14/14 périodes requises")).toBeTruthy();
    expect(screen.getByText(/couverture\s*100%/)).toBeTruthy();
  });

  it("follows the class selection (the fifth class — 2AM, 16 periods)", async () => {
    render(
      <TestProviders>
        <TimetableTab />
      </TestProviders>,
    );
    await waitFor(() => {
      expect(screen.getByText(`Classe : ${FIRST_CLASS_NAME}`)).toBeTruthy();
    });
    const trigger = screen.getAllByRole("combobox").find((t) =>
      (t.textContent ?? "").includes(FIRST_CLASS_NAME),
    );
    await pickRadixOption(trigger!, FIFTH_CLASS_NAME);
    await waitFor(() => {
      expect(screen.getByText(`Classe : ${FIFTH_CLASS_NAME}`)).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.getByText("16/16 périodes requises")).toBeTruthy();
    });
  });
});

// ============================================================================
// 2. The trials panel — N separate class timetables, one row per class
// ============================================================================

describe("T-410 — the per-class timetables table in the trials panel", () => {
  it("renders one row per class (5) with the completeness rollup", async () => {
    render(
      <TestProviders>
        <TimetableTab />
      </TestProviders>,
    );
    // Navigate to the trials sub-tab.
    const trialsTab = screen.getByRole("button", { name: /Essais & publication/ });
    trialsTab.click();
    await waitFor(() => {
      expect(screen.getByText(/Emplois du temps par classe \(5\)/)).toBeTruthy();
    });
    // All five class timetables are complete on the clean fixture.
    expect(screen.getByText("5/5 classes complètes")).toBeTruthy();
    // Each class has its own row — the rollup AND the five names render.
    for (const cls of seedClasses.slice(0, 5)) {
      expect(screen.getByText(cls.name ?? cls.code)).toBeTruthy();
    }
  });

  it("each class row carries its own coverage and its own Examiner button", async () => {
    render(
      <TestProviders>
        <TimetableTab />
      </TestProviders>,
    );
    screen.getByRole("button", { name: /Essais & publication/ }).click();
    await waitFor(() => {
      expect(screen.getByText(/Emplois du temps par classe \(5\)/)).toBeTruthy();
    });
    // The fifth class's row: 16/16 periods + its own Examiner.
    const row = screen
      .getByText(FIFTH_CLASS_NAME)
      .closest("tr")!;
    expect(within(row).getByText("16/16")).toBeTruthy();
    expect(within(row).getByText("100%")).toBeTruthy();
    expect(within(row).getByText("Examiner")).toBeTruthy();
  });

  it("the per-class Examiner opens THAT class's own weekly grid", async () => {
    render(
      <TestProviders>
        <TimetableTab />
      </TestProviders>,
    );
    screen.getByRole("button", { name: /Essais & publication/ }).click();
    await waitFor(() => {
      expect(screen.getByText(/Emplois du temps par classe \(5\)/)).toBeTruthy();
    });
    const row = screen.getByText(FIFTH_CLASS_NAME).closest("tr")!;
    within(row).getByText("Examiner").click();
    // Back on the schedule sub-tab, scoped to the fifth class.
    await waitFor(() => {
      expect(screen.getByText(`Classe : ${FIFTH_CLASS_NAME}`)).toBeTruthy();
    });
    // The fifth class is a 2AM class: 16 periods of its own curriculum
    // (4 Ar + 4 Math + 4 Fr + 2 ISI + 2 SVT) — zero foreign entries.
    await waitFor(() => {
      expect(screen.getAllByText(AR_NAME)).toHaveLength(4);
    });
    expect(screen.getAllByText(MATH_NAME)).toHaveLength(4);
    expect(screen.getAllByText("—")).toHaveLength(30 - 16);
  });
});

// ============================================================================
// 3. Entity-mandatory teacher projection — no universal mixed grid
// ============================================================================

describe("T-410 — the teacher selector is entity-mandatory (no 'Tout afficher')", () => {
  it("defaults to the FIRST teacher and offers no 'Tout afficher' option", async () => {
    render(
      <TestProviders>
        <TimetableTab />
      </TestProviders>,
    );
    await waitFor(() => {
      expect(screen.getByText(`Classe : ${FIRST_CLASS_NAME}`)).toBeTruthy();
    });
    // Switch the projection mode to "Par enseignant".
    const modeTrigger = screen
      .getAllByRole("combobox")
      .find((t) => (t.textContent ?? "").includes("Par classe"));
    expect(modeTrigger).toBeTruthy();
    await pickRadixOption(modeTrigger!, "Par enseignant");
    // The entity selector defaults to the FIRST teacher (never "all").
    await waitFor(() => {
      const teacherTrigger = screen
        .getAllByRole("combobox")
        .find((t) => (t.textContent ?? "").includes(FIRST_TEACHER_NAME));
      expect(teacherTrigger).toBeTruthy();
    });
    const teacherTrigger = screen
      .getAllByRole("combobox")
      .find((t) => (t.textContent ?? "").includes(FIRST_TEACHER_NAME))!;
    const options = await radixOptionTexts(teacherTrigger);
    expect(options).not.toContain("Tout afficher");
    expect(options).toContain(FIRST_TEACHER_NAME);
  });
});
