// ============================================================================
// FILE: src/tests/features/academics/t-404-timetable-ui.test.tsx
// ============================================================================
/**
 * T-404 — the dedicated Emploi du temps UI: the canonical grid renders the
 * schedule with the class/teacher/room projections over the REAL solver
 * output (the same fixture as the domain suite — one canonical schedule,
 * three projections, no view-specific stores).
 */

import { describe, it, expect, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";

import "../../../i18n/i18n";

beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
});

import { TimetableGrid } from "../../../features/academics/timetable/timetable-grid";
import { buildFixtureProblem } from "../../../domain/calc/timetable/fixture";
import {
  getTimetableSolver,
  GREEDY_SOLVER_ID,
} from "../../../domain/calc/timetable/solver";
import "../../../domain/calc/timetable/solver";
import type {
  TimetableConfiguration,
  TimetableScheduleEntry,
} from "../../../domain/model/timetable";
import { algerianDefaultConfiguration } from "../../../domain/calc/timetable/algerian-profile";

const solver = getTimetableSolver(GREEDY_SOLVER_ID)!;
const problem = buildFixtureProblem();
const solution = solver.solve(problem);
const config: TimetableConfiguration = problem.configuration;

/** Map solver slots to schedule-entry shapes (the repository persistence form). */
const entries: TimetableScheduleEntry[] = solution.entries.map((slot, i) => {
  const period = config.periods.find((p) => p.index === slot.periodIndex);
  return {
    id: `ent-${i}`,
    tenantId: "t",
    academicYearId: "y",
    versionId: "v1",
    classId: slot.classId,
    subjectId: slot.subjectId,
    teacherId: slot.teacherId,
    roomId: slot.roomId,
    day: slot.day,
    periodIndex: slot.periodIndex,
    startMinutes: period?.startMinutes ?? 0,
    endMinutes: period?.endMinutes ?? 0,
    lessonGroup: slot.lessonGroup,
    isLocked: false,
    source: "generated",
    notes: null,
    createdAt: "",
    updatedAt: "",
  };
});

const names = {
  classes: new Map([
    ["cls-1as-a", "1ère AS — Section A"],
    ["cls-2as-a", "2ème AS — Section A"],
    ["cls-3as-a", "3ème AS — Section A"],
  ]),
  subjects: new Map([
    ["sub-math", "Mathématiques"],
    ["sub-phys", "Sciences physiques"],
    ["sub-arab", "Langue arabe"],
    ["sub-fr", "Langue française"],
    ["sub-hist", "Histoire-Géographie"],
  ]),
  teachers: new Map([
    ["tch-math", "M. Belkacem (Maths)"],
    ["tch-phys", "Mme Haddad (Sciences)"],
    ["tch-arab", "M. Ziani (Arabe)"],
    ["tch-fr", "Mme Saidi (Français)"],
  ]),
  rooms: new Map([
    ["room-c1", "SAL-01 — Salle 01"],
    ["room-c2", "SAL-02 — Salle 02"],
    ["room-c3", "SAL-03 — Salle 03"],
    ["room-lab", "LAB-SCI — Laboratoire de sciences"],
  ]),
};

describe("T-404 — TimetableGrid (the canonical presentation)", () => {
  it("renders the Algerian school week (Dimanche→Jeudi) as columns", () => {
    render(
      <TimetableGrid
        configuration={config}
        entries={entries}
        viewMode="class"
        viewEntityId="cls-1as-a"
        names={names}
        editable={false}
      />,
    );
    expect(screen.getByText("Dimanche")).toBeTruthy();
    expect(screen.getByText("Lundi")).toBeTruthy();
    expect(screen.getByText("Jeudi")).toBeTruthy();
    expect(screen.queryByText("Vendredi")).toBeNull();
    expect(screen.queryByText("Samedi")).toBeNull();
  });

  it("renders the 6 teaching periods S1..S6 as rows", () => {
    render(
      <TimetableGrid
        configuration={config}
        entries={entries}
        viewMode="class"
        viewEntityId="cls-1as-a"
        names={names}
        editable={false}
      />,
    );
    for (const label of ["S1", "S2", "S3", "S4", "S5", "S6"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it("projects the SAME canonical schedule by class (4h Math + 2p Sciences for 1AS-A)", () => {
    render(
      <TimetableGrid
        configuration={config}
        entries={entries}
        viewMode="class"
        viewEntityId="cls-1as-a"
        names={names}
        editable={false}
      />,
    );
    const mathCells = screen.getAllByText("Mathématiques");
    expect(mathCells.length).toBe(4);
    const scienceCells = screen.getAllByText("Sciences physiques");
    expect(scienceCells.length).toBe(2);
  });

  it("projects the SAME schedule by teacher (M. Ziani: Arabe 12 + HG 6 = 18)", () => {
    render(
      <TimetableGrid
        configuration={config}
        entries={entries}
        viewMode="teacher"
        viewEntityId="tch-arab"
        names={names}
        editable={false}
      />,
    );
    const arabe = screen.getAllByText(/Langue arabe ·/);
    const hist = screen.getAllByText(/Histoire-Géographie ·/);
    expect(arabe.length).toBe(12);
    expect(hist.length).toBe(6);
  });

  it("projects the SAME schedule by room (the lab hosts exactly the 6 Sciences periods)", () => {
    render(
      <TimetableGrid
        configuration={config}
        entries={entries}
        viewMode="room"
        viewEntityId="room-lab"
        names={names}
        editable={false}
      />,
    );
    const lab = screen.getAllByText(/Sciences physiques ·/);
    expect(lab.length).toBe(6);
  });

  it("shows the honest empty state when no configuration exists", () => {
    render(
      <TimetableGrid
        configuration={null}
        entries={[]}
        viewMode="class"
        viewEntityId={null}
        names={names}
        editable={false}
      />,
    );
    expect(screen.getByText("Aucune configuration active")).toBeTruthy();
  });
});

describe("T-404 — the Algerian profile data module", () => {
  it("is Sun–Thu with 6 periods and the two canonical breaks", () => {
    const profile = algerianDefaultConfiguration("t", "y");
    expect(profile.schoolDays).toEqual([
      "sunday",
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
    ]);
    expect(profile.periods.map((p) => p.index)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(profile.periods[0].startMinutes).toBe(8 * 60);
    expect(profile.periods[5].endMinutes).toBe(15 * 60);
    expect(profile.breaks.map((b) => b.label)).toEqual(["Pause", "Déjeuner"]);
  });
});
