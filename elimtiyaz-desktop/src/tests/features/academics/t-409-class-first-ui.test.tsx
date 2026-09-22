// ============================================================================
// FILE: src/tests/features/academics/t-409-class-first-ui.test.tsx
// ============================================================================
/**
 * T-409 — the CLASS-FIRST presentation regression (SCHED-111).
 *
 * WHAT THIS SUITE PINS:
 *   A. Three classes with lessons in the SAME (day, period) render as
 *      INDEPENDENT class timetables — selecting class A shows only class
 *      A's lesson at that position, class B only class B's, class C only
 *      class C's. (class A, day, period) != (class B, day, period) as
 *      VISUAL positions — the old grid keyed cells by day+period only and
 *      the LAST entry silently overwrote every other class.
 *   B. The class projection with NO selected class renders the honest
 *      empty state — NEVER the flattened multi-class grid (the old
 *      `!viewEntityId → return entries` fallback).
 *   C. Every class-mode lesson cell shows Subject + Teacher + Room.
 *   D. Empty periods remain visible.
 *   E. (SUPERSEDED by T-410 / SCHED-112) The teacher projection with NO
 *      selected teacher now renders the SAME honest empty state — the
 *      universal all-classes mixed grid ("Tout afficher") was removed
 *      from the product by the owner's explicit instruction ("I do NOT
 *      want one universal timetable for the entire school"). The stacking
 *      LIST-cells remain as anomaly tolerance, verified by E2: a teacher
 *      projection that legitimately contains TWO concurrent entries
 *      (manual-adjustment defect) SHOWS both, overwriting nothing.
 *   F. The real solver output (the T-404 fixture, 3 classes × 16 periods)
 *      renders one class's complete weekly grid with zero foreign entries.
 */

import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

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

// ── The targeted 3-class SAME-SLOT fixture ─────────────────────────────────
// Three classes, each with lessons at the SAME (day, period) positions —
// the exact collision shape SCHED-111 describes. Under the old renderer
// these competed for one visual cell and only the LAST survived.

const CLASSES = ["cls-a", "cls-b", "cls-c"] as const;
type FixtureClass = (typeof CLASSES)[number];
const CLASS_NAMES: Record<FixtureClass, string> = {
  "cls-a": "2AS-SC-A",
  "cls-b": "2AS-SC-B",
  "cls-c": "2AS-SC-C",
};
// Each class studies a DIFFERENT subject in the SAME slots.
const SUBJECT_BY_CLASS: Record<FixtureClass, string> = {
  "cls-a": "Mathématiques",
  "cls-b": "Sciences physiques",
  "cls-c": "Histoire-Géographie",
};
const SUBJECT_ID_BY_CLASS: Record<FixtureClass, string> = {
  "cls-a": "sub-math",
  "cls-b": "sub-phys",
  "cls-c": "sub-hist",
};
const TEACHER_BY_CLASS: Record<FixtureClass, string> = {
  "cls-a": "M. Belkacem (Maths)",
  "cls-b": "Mme Haddad (Sciences)",
  "cls-c": "M. Ziani (Arabe)",
};
const TEACHER_ID_BY_CLASS: Record<FixtureClass, string> = {
  "cls-a": "tch-math",
  "cls-b": "tch-phys",
  "cls-c": "tch-arab",
};
const ROOM_BY_CLASS: Record<FixtureClass, string> = {
  "cls-a": "SAL-01 — Salle 01",
  "cls-b": "LAB-SCI — Laboratoire de sciences",
  "cls-c": "SAL-03 — Salle 03",
};
const ROOM_ID_BY_CLASS: Record<FixtureClass, string> = {
  "cls-a": "room-c1",
  "cls-b": "room-lab",
  "cls-c": "room-c3",
};
// The SHARED collision positions (day, period) — all three classes have a
// lesson at each of these, plus one class-A-only slot.
const SHARED_SLOTS: Array<{ day: "monday" | "tuesday" | "wednesday"; period: number }> = [
  { day: "monday", period: 3 },
  { day: "tuesday", period: 4 },
  { day: "wednesday", period: 2 },
];

const overlapConfig: TimetableConfiguration = algerianDefaultConfiguration(
  "tenant-t409",
  "year-t409",
  "cfg-t409-overlap",
);

function overlapEntry(
  cls: FixtureClass,
  slot: { day: string; period: number },
  i: number,
): TimetableScheduleEntry {
  return {
    id: `ent-${cls}-${i}`,
    tenantId: "tenant-t409",
    academicYearId: "year-t409",
    versionId: "ver-t409",
    classId: cls,
    subjectId: SUBJECT_ID_BY_CLASS[cls],
    teacherId: TEACHER_ID_BY_CLASS[cls],
    roomId: ROOM_ID_BY_CLASS[cls],
    day: slot.day as TimetableScheduleEntry["day"],
    periodIndex: slot.period,
    startMinutes: 480 + (slot.period - 1) * 60,
    endMinutes: 480 + slot.period * 60,
    lessonGroup: i + 1,
    isLocked: false,
    source: "generated",
    notes: null,
    createdAt: "",
    updatedAt: "",
  };
}

const overlapEntries: TimetableScheduleEntry[] = [];
{
  let i = 0;
  for (const slot of SHARED_SLOTS) {
    for (const cls of CLASSES) {
      overlapEntries.push(overlapEntry(cls, slot, i++));
    }
  }
  // One class-A-only slot (empty-period visibility for B and C).
  overlapEntries.push(overlapEntry("cls-a", { day: "thursday", period: 1 }, i++));
}

const overlapNames = {
  classes: new Map(
    CLASSES.map((c) => [c as string, CLASS_NAMES[c]] as [string, string]),
  ),
  subjects: new Map([
    ["sub-math", "Mathématiques"],
    ["sub-phys", "Sciences physiques"],
    ["sub-hist", "Histoire-Géographie"],
  ]),
  teachers: new Map([
    ["tch-math", "M. Belkacem (Maths)"],
    ["tch-phys", "Mme Haddad (Sciences)"],
    ["tch-arab", "M. Ziani (Arabe)"],
  ]),
  rooms: new Map([
    ["room-c1", "SAL-01 — Salle 01"],
    ["room-lab", "LAB-SCI — Laboratoire de sciences"],
    ["room-c3", "SAL-03 — Salle 03"],
  ]),
};

// ── The real solver fixture (3 classes × 16 periods, fully placed) ─────────

const realProblem = buildFixtureProblem();
const realSolution = solver.solve(realProblem);
const realConfig: TimetableConfiguration = realProblem.configuration;
const realEntries: TimetableScheduleEntry[] = realSolution.entries.map(
  (slot, i) => {
    const period = realConfig.periods.find((p) => p.index === slot.periodIndex);
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
  },
);

const realNames = {
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

afterEach(() => cleanup());

// ============================================================================
// A. Three classes, SAME (day, period) — independent visual positions
// ============================================================================

describe("T-409 — three classes with overlapping periods never overwrite (SCHED-111)", () => {
  for (const cls of CLASSES) {
    it(`the ${CLASS_NAMES[cls]} grid renders ONLY ${CLASS_NAMES[cls]}'s lesson at every shared slot`, () => {
      render(
        <TimetableGrid
          configuration={overlapConfig}
          entries={overlapEntries}
          viewMode="class"
          viewEntityId={cls}
          names={overlapNames}
          editable={false}
        />,
      );
      // The class's OWN subject appears once per shared slot (3) + the
      // class-A-only slot when applicable.
      const own = screen.getAllByText(SUBJECT_BY_CLASS[cls]);
      expect(own.length).toBe(
        cls === "cls-a" ? SHARED_SLOTS.length + 1 : SHARED_SLOTS.length,
      );
      // The OTHER classes' subjects appear NOWHERE in this grid.
      for (const other of CLASSES) {
        if (other === cls) continue;
        expect(screen.queryByText(SUBJECT_BY_CLASS[other])).toBeNull();
      }
    });
  }

  it("the SAME visual coordinates render DIFFERENT lessons per class (position != position)", () => {
    // (cls-a, monday, S3) shows Mathématiques; (cls-b, monday, S3) shows
    // Sciences physiques; (cls-c, monday, S3) shows Histoire-Géographie.
    // Three renders, three different lessons at the same coordinates —
    // the class dimension is part of the visual position.
    const cellText = (cls: FixtureClass): string[] => {
      cleanup();
      const { container } = render(
        <TimetableGrid
          configuration={overlapConfig}
          entries={overlapEntries}
          viewMode="class"
          viewEntityId={cls}
          names={overlapNames}
          editable={false}
        />,
      );
      // The monday row, S3 cell: periods S1..S6 are tbody rows 0..5;
      // td[0] = the period label, td[1] = Dimanche, td[2] = Lundi.
      const rows = container.querySelectorAll("tbody tr");
      const s3row = rows[2]; // S1, S2, S3 → index 2
      const mondayCell = s3row.querySelectorAll("td")[2];
      return Array.from(mondayCell.querySelectorAll("button")).map(
        (b) => b.textContent ?? "",
      );
    };
    expect(cellText("cls-a")[0]).toContain("Mathématiques");
    expect(cellText("cls-b")[0]).toContain("Sciences physiques");
    expect(cellText("cls-c")[0]).toContain("Histoire-Géographie");
  });
});

// ============================================================================
// B. No selected class → the honest empty state, NEVER the mixed grid
// ============================================================================

describe("T-409 — class mode without a selection renders the honest empty state", () => {
  it("shows the selection prompt and ZERO lesson cells (the old bug returned ALL classes)", () => {
    render(
      <TimetableGrid
        configuration={overlapConfig}
        entries={overlapEntries}
        viewMode="class"
        viewEntityId={null}
        names={overlapNames}
        editable={false}
      />,
    );
    expect(screen.getByText("Sélectionnez une classe")).toBeTruthy();
    // NOT ONE lesson from ANY class is rendered.
    for (const cls of CLASSES) {
      expect(screen.queryByText(SUBJECT_BY_CLASS[cls])).toBeNull();
    }
    expect(screen.queryByText("Dimanche")).toBeNull(); // no grid at all
  });
});

// ============================================================================
// C. Subject + Teacher + Room in every class-mode lesson cell
// ============================================================================

describe("T-409 — class cells identify subject, teacher and room", () => {
  it("renders the teacher and the room under the subject (class A, monday S3)", () => {
    render(
      <TimetableGrid
        configuration={overlapConfig}
        entries={overlapEntries}
        viewMode="class"
        viewEntityId="cls-a"
        names={overlapNames}
        editable={false}
      />,
    );
    expect(screen.getAllByText("Mathématiques").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(
        `${TEACHER_BY_CLASS["cls-a"]} · ${ROOM_BY_CLASS["cls-a"]}`,
      ).length,
    ).toBe(SHARED_SLOTS.length + 1);
  });
});

// ============================================================================
// D. Empty periods remain visible
// ============================================================================

describe("T-409 — empty periods remain visible", () => {
  it("class B's thursday S1 (class-A-only slot) renders the — placeholder", () => {
    render(
      <TimetableGrid
        configuration={overlapConfig}
        entries={overlapEntries}
        viewMode="class"
        viewEntityId="cls-b"
        names={overlapNames}
        editable={false}
      />,
    );
    // 30 grid slots − 3 occupied = 27 empty placeholders for class B.
    expect(screen.getAllByText("—").length).toBe(30 - SHARED_SLOTS.length);
  });
});

// ============================================================================
// E. (T-410 revision) Teacher projection with NO entity — the honest empty
//    state; the universal mixed grid is gone. E2: a teacher projection that
//    contains two concurrent entries SHOWS both (stacking = no overwrite).
// ============================================================================

describe("T-410 — the teacher projection without a selected teacher renders the honest empty state", () => {
  it("shows 'Sélectionnez un enseignant' — NEVER the all-classes mixed grid", () => {
    render(
      <TimetableGrid
        configuration={overlapConfig}
        entries={overlapEntries}
        viewMode="teacher"
        viewEntityId={null}
        names={overlapNames}
        editable={false}
      />,
    );
    expect(screen.getByText("Sélectionnez un enseignant")).toBeTruthy();
    // The universal mixed grid rendered every class's lesson — the empty
    // state renders NONE of them.
    expect(screen.queryAllByText(/^Mathématiques ·/)).toHaveLength(0);
    expect(screen.queryAllByText(/^Sciences physiques ·/)).toHaveLength(0);
    expect(screen.queryAllByText(/^Histoire-Géographie ·/)).toHaveLength(0);
  });
});

describe("T-410 — a teacher projection with concurrent entries stacks them (no overwrite)", () => {
  it("shows BOTH lessons when one teacher's cell holds two entries (anomaly tolerance)", () => {
    // A data-anomaly shape (a real solve never produces this; a manual
    // adjustment could): at monday P3, tch-math is attached to cls-b's
    // Sciences lesson IN ADDITION to cls-a's Maths lesson. The rendering
    // contract is SHOW BOTH, never overwrite.
    const anomalyEntries = overlapEntries.map((e) =>
      e.classId === "cls-b" && e.day === "monday" && e.periodIndex === 3
        ? { ...e, teacherId: "tch-math" }
        : e,
    );
    render(
      <TimetableGrid
        configuration={overlapConfig}
        entries={anomalyEntries}
        viewMode="teacher"
        viewEntityId="tch-math"
        names={overlapNames}
        editable={false}
      />,
    );
    // tch-math's week: his own 4 Maths lessons (3 shared slots + the
    // class-A-only thursday) PLUS the anomalous concurrent Sciences lesson
    // at monday P3 — the old single-entry cell map would have dropped one.
    expect(screen.getAllByText(/^Mathématiques ·/)).toHaveLength(4);
    expect(screen.getAllByText(/^Sciences physiques ·/)).toHaveLength(1);
  });
});

// ============================================================================
// F. The real solver output — a class's COMPLETE weekly grid, zero foreign entries
// ============================================================================

describe("T-409 — the real solver output renders per-class weekly grids", () => {
  it("2AS-A renders exactly its 16 placed periods (4 Math + 2 Sci + 4 Ar + 4 Fr + 2 HG)", () => {
    render(
      <TimetableGrid
        configuration={realConfig}
        entries={realEntries}
        viewMode="class"
        viewEntityId="cls-2as-a"
        names={realNames}
        editable={false}
      />,
    );
    expect(screen.getAllByText("Mathématiques")).toHaveLength(4);
    expect(screen.getAllByText("Sciences physiques")).toHaveLength(2);
    expect(screen.getAllByText("Langue arabe")).toHaveLength(4);
    expect(screen.getAllByText("Langue française")).toHaveLength(4);
    expect(screen.getAllByText("Histoire-Géographie")).toHaveLength(2);
    // Total lesson cells = 16; empty placeholders = 30 − 16.
    expect(screen.getAllByText("—")).toHaveLength(30 - 16);
  });

  it("1AS-A renders its own 16 periods (its Wednesday free day stays empty)", () => {
    render(
      <TimetableGrid
        configuration={realConfig}
        entries={realEntries}
        viewMode="class"
        viewEntityId="cls-1as-a"
        names={realNames}
        editable={false}
      />,
    );
    expect(screen.getAllByText("Mathématiques")).toHaveLength(4);
    // The Wednesday free-day constraint (hard) keeps 1AS-A's Wednesday
    // empty — 6 visible empty slots on that day alone.
    expect(screen.getAllByText("—")).toHaveLength(30 - 16);
  });

  it("every fixture class is represented in the canonical solution (school-wide generation)", () => {
    // The school-wide generation requirement: the generated version
    // contains entries for ALL THREE fixture classes — the class selector
    // can therefore inspect any of them.
    const classIds = new Set(realSolution.entries.map((e) => e.classId));
    expect(classIds).toEqual(
      new Set(["cls-1as-a", "cls-2as-a", "cls-3as-a"]),
    );
    expect(realSolution.statistics.classesScheduled).toBe(3);
  });
});
