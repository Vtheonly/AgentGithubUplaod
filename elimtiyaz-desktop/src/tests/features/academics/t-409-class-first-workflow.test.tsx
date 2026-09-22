// ============================================================================
// FILE: src/tests/features/academics/t-409-class-first-workflow.test.tsx
// ============================================================================
/**
 * T-409 — the CLASS-FIRST tab workflow (SCHED-111, selector leg).
 *
 * WHAT THIS SUITE PINS (against the REAL TimetableTab with the REAL mock
 * repositories — the canonical paths, §15.50b):
 *   1. "Par classe" (the default) ALWAYS exposes an explicit class
 *      selector — the old UI hid the selector in class mode.
 *   2. The selector offers NO "Tout afficher" option in class mode (a
 *      class timetable is ONE class at a time).
 *   3. The selected class is explicit: the "Classe : X" badge + the
 *      selector default to the first class.
 *   4. Switching the class re-scopes the grid strictly by classId (the
 *      lesson set changes with the selection — zero foreign entries).
 *
 * FIXTURE STRATEGY: the canonical T-404 fixture problem is REMAPPED onto
 * the mock store's REAL seed classes and subjects (same ids the tab's
 * selectors read), then generated through the SAME repository the tab
 * wires (mockTimetableRepository.generateTimetable). Class 2 gets one
 * fewer requirement so switching the selection observably changes the
 * grid (15 vs 16 lessons).
 */

import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
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
import { buildFixtureProblem } from "../../../domain/calc/timetable/fixture";
import { mockTimetableRepository } from "../../../infrastructure/mock/repositories/timetable-repository";
import { mockAcademicYearRepository } from "../../../infrastructure/mock/repositories/academic-year-repository";
import type { Subject } from "../../../domain/model/academic";
import type { TimetableProblem } from "../../../domain/model/timetable";
import { pickRadixOption, radixOptionTexts } from "../../_helpers/radix-mouse";

const SESSION_KEY = "el-imtiyaz.session";

function seedSuperAdminSession(): void {
  const session = {
    userId: "user-t409",
    tenantId: "tenant-1",
    email: "agent@elimtiyaz.dz",
    displayName: "Agent T409",
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

// ── The remap: fixture ids → the mock store's REAL rows ────────────────────

const CLASS_REMAP = new Map([
  ["cls-1as-a", "cls-001"],
  ["cls-2as-a", "cls-007"],
  ["cls-3as-a", "cls-002"],
]);

const seedClasses = mockRepositories.classes.observe().get();
const FIRST_CLASS_NAME = seedClasses[0]?.name ?? seedClasses[0]?.code ?? "";
const SECOND_CLASS_NAME = seedClasses[1]?.name ?? seedClasses[1]?.code ?? "";

const seedSubjects: Subject[] = mockRepositories.subjects.observe().get();
// Five real subjects stand in for the fixture's five (Math, Phys, Arabe,
// FR, HG) — the DISPLAYED names come from these rows.
const SUBJECT_REMAP = new Map(
  ["sub-math", "sub-phys", "sub-arab", "sub-fr", "sub-hist"].map((fixtureId, i) => [
    fixtureId,
    seedSubjects[i]?.id ?? fixtureId,
  ]),
);
const MATH_NAME = seedSubjects[0]?.name ?? "Matière";
const PHYS_NAME = seedSubjects[1]?.name ?? "Matière";
const HG_NAME = seedSubjects[4]?.name ?? "Matière";

function buildRemappedProblem(): TimetableProblem {
  const base = buildFixtureProblem();
  const nameOf = new Map(seedClasses.map((c) => [c.id, c.name ?? c.code]));
  return {
    ...base,
    classes: base.classes.map((c) => ({
      ...c,
      id: CLASS_REMAP.get(c.id) ?? c.id,
      name: nameOf.get(CLASS_REMAP.get(c.id) ?? c.id) ?? c.name,
    })),
    // Drop the 5th subject (HG) for class 2 only — 15 vs 16 periods, the
    // observable re-scoping proof.
    requirements: base.requirements
      .filter(
        (r) => !(r.classId === "cls-2as-a" && r.subjectId === "sub-hist"),
      )
      .map((r) => ({
        ...r,
        classId: CLASS_REMAP.get(r.classId) ?? r.classId,
        className: nameOf.get(CLASS_REMAP.get(r.classId) ?? r.classId) ?? r.className,
        subjectId: SUBJECT_REMAP.get(r.subjectId) ?? r.subjectId,
      })),
    constraints: base.constraints.map((c) => ({
      ...c,
      entityId: c.entityId ? (CLASS_REMAP.get(c.entityId) ?? c.entityId) : c.entityId,
    })),
  };
}

beforeAll(async () => {
  seedSuperAdminSession();
  const yearResult = await mockAcademicYearRepository.getCurrentYear();
  if (!yearResult.ok) throw new Error("T-409 fixture: no current academic year");
  // Canonical-path generation: the same repository the tab wires.
  const result = await mockTimetableRepository.generateTimetable(
    { academicYearId: yearResult.value.id },
    { actorId: "user-t409", actorName: "Agent T409" },
    buildRemappedProblem(),
  );
  if (!result.ok) {
    throw new Error(`T-409 fixture generation failed: ${result.error.message}`);
  }
});

afterEach(() => cleanup());

describe("T-409 — the class-first tab workflow (Par classe)", () => {
  it("always exposes an explicit class selector in class mode (the default view)", async () => {
    render(
      <TestProviders>
        <TimetableTab />
      </TestProviders>,
    );
    // The selected class is explicit and visible: the badge + the
    // selector's trigger both name the FIRST class (the default).
    await waitFor(() => {
      expect(screen.getByText(`Classe : ${FIRST_CLASS_NAME}`)).toBeTruthy();
    });
    const trigger = screen.getAllByRole("combobox").find((t) =>
      (t.textContent ?? "").includes(FIRST_CLASS_NAME),
    );
    expect(trigger).toBeTruthy();
  });

  it("offers NO 'Tout afficher' option in the class selector", async () => {
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
    // The class list contains real classes and NOTHING else.
    const options = await radixOptionTexts(trigger!);
    expect(options).not.toContain("Tout afficher");
    expect(options.length).toBeGreaterThanOrEqual(3);
    expect(options).toContain(FIRST_CLASS_NAME);
    expect(options).toContain(SECOND_CLASS_NAME);
  });

  it("renders the selected class's complete weekly grid (16 lessons, zero foreign)", async () => {
    render(
      <TestProviders>
        <TimetableTab />
      </TestProviders>,
    );
    await waitFor(() => {
      expect(screen.getByText(`Classe : ${FIRST_CLASS_NAME}`)).toBeTruthy();
    });
    // Class 1's full curriculum is visible in its own grid (4 + 2 + 4 + 4
    // + 2 = 16 lessons — the same curriculum the solver placed).
    await waitFor(() => {
      expect(screen.getAllByText(MATH_NAME)).toHaveLength(4);
    });
    expect(screen.getAllByText(PHYS_NAME)).toHaveLength(2);
    // 30 weekly slots − 16 occupied = 14 visible empty periods.
    expect(screen.getAllByText("—")).toHaveLength(30 - 16);
  });

  it("switching the class re-scopes the grid strictly by classId", async () => {
    render(
      <TestProviders>
        <TimetableTab />
      </TestProviders>,
    );
    await waitFor(() => {
      expect(screen.getByText(`Classe : ${FIRST_CLASS_NAME}`)).toBeTruthy();
    });

    // The REAL mouse dance on the class selector (§15.40).
    const trigger = screen.getAllByRole("combobox").find((t) =>
      (t.textContent ?? "").includes(FIRST_CLASS_NAME),
    );
    await pickRadixOption(trigger!, SECOND_CLASS_NAME);

    // The badge + the grid follow the selection. Class 2's curriculum has
    // NO 5th subject (the remapped problem) — 14 lessons, and the
    // re-scoping is observable, not cosmetic.
    await waitFor(() => {
      expect(screen.getByText(`Classe : ${SECOND_CLASS_NAME}`)).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.getAllByText(MATH_NAME)).toHaveLength(4);
    });
    expect(screen.getAllByText(PHYS_NAME)).toHaveLength(2);
    expect(screen.queryAllByText(HG_NAME)).toHaveLength(0);
    // 30 weekly slots − 14 occupied = 16 visible empty periods.
    expect(screen.getAllByText("—")).toHaveLength(30 - 14);
  });
});
