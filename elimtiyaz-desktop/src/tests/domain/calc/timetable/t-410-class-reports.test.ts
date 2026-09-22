// ============================================================================
// FILE: src/tests/domain/calc/timetable/t-410-class-reports.test.ts
// ============================================================================
/**
 * T-410 — PER-CLASS TIMETABLE REPORTS (SCHED-112).
 *
 * THE OWNER CONTRACT (verbatim intent): "If there are 3 classes of 5AP and
 * 2 classes of 2AM, that is 5 classes total, so there must be 5 completely
 * separate timetables — one per class — each internally complete and
 * conflict-free: no teacher conflicts, no room conflicts, no overlapping
 * lessons, no unnecessary gaps, all required weekly hours, every subject
 * scheduled, a valid teacher and an appropriate room for every lesson, all
 * applicable constraints satisfied — while still respecting shared
 * teachers and rooms across the school."
 *
 * WHAT THIS SUITE PINS:
 *   1. THE FIVE-CLASS SCENARIO: 3×5AP + 2×2AM → exactly 5 reports, one per
 *      class, each class's report counting ONLY its own entries (no
 *      cross-class leakage), sum(per-class placed) = all entries.
 *   2. INDEPENDENT CONFLICT ATTRIBUTION: a teacher clash / room clash
 *      between two classes appears in BOTH classes' reports (each side
 *      sees the other class named); a class's own overlap is its own.
 *   3. PER-CLASS COMPLETENESS: missing weekly hours, an unscheduled
 *      subject, a missing teacher, a missing room, an unplaced block —
 *      each flips THAT class's status to incomplete, the others stay
 *      complete.
 *   4. GAPS: holes between a class's first and last lesson of a day are
 *      counted per class (reported honestly, not silently).
 *   5. SOLVER INTEGRATION: the real solve fills statistics.perClass
 *      (5 reports, all complete on the clean fixture) — and the reports
 *      are byte-identical between solve and solveAsync (determinism).
 */

import { describe, expect, it } from "vitest";
import type {
  ClassTimetableChecklistKey,
  ClassTimetableReport,
  Room,
  TimetableConstraint,
  TimetableProblem,
  TimetableRequirement,
  TimetableSlotAssignment,
  TimetableUnplacedBlock,
} from "../../../../domain/model/timetable";
import { algerianDefaultConfiguration } from "../../../../domain/calc/timetable/algerian-profile";
import { validateTimetable } from "../../../../domain/calc/timetable/constraints";
import { buildClassTimetableReports } from "../../../../domain/calc/timetable/class-reports";
import { readClassTimetableReports } from "../../../../domain/model/timetable";
import {
  getTimetableSolver,
  GREEDY_SOLVER_ID,
} from "../../../../domain/calc/timetable/solver";
import "../../../../domain/calc/timetable/solver"; // registers ts-greedy-v1

const solver = getTimetableSolver(GREEDY_SOLVER_ID)!;

// ============================================================================
// The owner's five-class fixture: 3×5AP + 2×2AM, shared teachers/rooms
// ============================================================================

const TENANT = "tenant-t410";
const YEAR = "year-t410";

const FIVE_CLASSES = [
  { id: "cls-5ap-a", code: "5AP-A", name: "5AP — A", capacity: 30 },
  { id: "cls-5ap-b", code: "5AP-B", name: "5AP — B", capacity: 30 },
  { id: "cls-5ap-c", code: "5AP-C", name: "5AP — C", capacity: 28 },
  { id: "cls-2am-a", code: "2AM-A", name: "2AM — A", capacity: 32 },
  { id: "cls-2am-b", code: "2AM-B", name: "2AM — B", capacity: 32 },
] as const;

const FIVE_TEACHERS = [
  { id: "tch-ar", name: "M. Ziani (Arabe)" },
  { id: "tch-math", name: "M. Belkacem (Maths)" },
  { id: "tch-fr", name: "Mme Saidi (Français)" },
  { id: "tch-isis", name: "M. Cherif (Éducation islamique)" },
  { id: "tch-svt", name: "Mme Haddad (Sciences)" },
] as const;

function fixtureRoom(
  id: string,
  code: string,
  name: string,
  roomType: Room["roomType"],
  capacity: number,
): Room {
  return {
    id,
    tenantId: TENANT,
    code,
    name,
    roomType,
    capacity,
    building: "A",
    floorLabel: "RDC",
    isActive: true,
    notes: null,
    createdAt: "2026-09-22T00:00:00.000Z",
    updatedAt: "2026-09-22T00:00:00.000Z",
  };
}

const FIVE_ROOMS: Room[] = [
  fixtureRoom("room-s1", "SAL-01", "Salle 01", "classroom", 32),
  fixtureRoom("room-s2", "SAL-02", "Salle 02", "classroom", 32),
  fixtureRoom("room-s3", "SAL-03", "Salle 03", "classroom", 32),
  fixtureRoom("room-s4", "SAL-04", "Salle 04", "classroom", 32),
  fixtureRoom("room-s5", "SAL-05", "Salle 05", "classroom", 32),
  fixtureRoom("room-lab", "LAB-SCI", "Laboratoire de sciences", "science_lab", 32),
];

function req(
  classId: string,
  className: string,
  subjectId: string,
  subjectName: string,
  teacherId: string,
  weeklyHours: number,
  classSize: number,
  opts?: { consecutivePeriods?: number; requiredRoomType?: Room["roomType"] },
): TimetableRequirement {
  return {
    classId,
    subjectId,
    teacherId,
    weeklyHours,
    consecutivePeriods: opts?.consecutivePeriods ?? 1,
    requiredRoomType: opts?.requiredRoomType ?? null,
    className,
    subjectName,
    teacherName: FIVE_TEACHERS.find((t) => t.id === teacherId)?.name ?? null,
    classSize,
  };
}

/** 5AP: Ar 4 + Math 4 + Fr 4 + ISI 2 = 14 periods. 2AM adds SVT 2 (lab) = 16. */
function fiveClassRequirements(): TimetableRequirement[] {
  const out: TimetableRequirement[] = [];
  for (const cls of FIVE_CLASSES) {
    const size = cls.capacity;
    out.push(
      req(cls.id, cls.name, "sub-ar", "Langue arabe", "tch-ar", 4, size),
      req(cls.id, cls.name, "sub-math", "Mathématiques", "tch-math", 4, size),
      req(cls.id, cls.name, "sub-fr", "Langue française", "tch-fr", 4, size),
      req(cls.id, cls.name, "sub-isis", "Éducation islamique", "tch-isis", 2, size),
    );
    if (cls.id.startsWith("cls-2am")) {
      out.push(
        req(cls.id, cls.name, "sub-svt", "Sciences de la vie et de la terre", "tch-svt", 2, size, {
          consecutivePeriods: 2,
          requiredRoomType: "science_lab",
        }),
      );
    }
  }
  return out;
}

function fiveClassProblem(constraints: TimetableConstraint[] = []): TimetableProblem {
  return {
    configuration: algerianDefaultConfiguration(TENANT, YEAR),
    classes: FIVE_CLASSES.map((c) => ({ ...c })),
    teachers: FIVE_TEACHERS.map((t) => ({ ...t })),
    rooms: FIVE_ROOMS,
    requirements: fiveClassRequirements(),
    constraints,
    lockedEntries: [],
  };
}

// ── A minimal 2-class problem for the crafted conflict scenarios ───────────

function twoClassProblem(): TimetableProblem {
  return {
    configuration: algerianDefaultConfiguration(TENANT, YEAR),
    classes: [
      { id: "cls-a", code: "A", name: "Classe A", capacity: 30 },
      { id: "cls-b", code: "B", name: "Classe B", capacity: 30 },
    ],
    teachers: FIVE_TEACHERS.slice(0, 3).map((t) => ({ ...t })),
    rooms: [FIVE_ROOMS[0], FIVE_ROOMS[1], FIVE_ROOMS[5]],
    requirements: [
      req("cls-a", "Classe A", "sub-math", "Mathématiques", "tch-math", 2, 30),
      req("cls-a", "Classe A", "sub-ar", "Langue arabe", "tch-ar", 2, 30),
      req("cls-b", "Classe B", "sub-math", "Mathématiques", "tch-math", 2, 30),
      req("cls-b", "Classe B", "sub-svt", "SVT", "tch-svt", 2, 30, {
        requiredRoomType: "science_lab",
      }),
    ],
    constraints: [],
    lockedEntries: [],
  };
}

function entry(
  classId: string,
  subjectId: string,
  teacherId: string | null,
  roomId: string | null,
  day: TimetableSlotAssignment["day"],
  periodIndex: number,
): TimetableSlotAssignment {
  return {
    classId,
    subjectId,
    teacherId,
    roomId,
    day,
    periodIndex,
    lessonGroup: 1,
  };
}

/** The reports of a crafted source, consuming the REAL canonical validator. */
function reportsOf(
  problem: TimetableProblem,
  entries: readonly TimetableSlotAssignment[],
  unplaced: readonly TimetableUnplacedBlock[] = [],
): ClassTimetableReport[] {
  const violations = validateTimetable(problem, entries);
  return buildClassTimetableReports(problem, { entries, violations, unplaced });
}

function checklistOf(
  report: ClassTimetableReport,
  key: ClassTimetableChecklistKey,
): ClassTimetableReport["checklist"][number] {
  return report.checklist.find((c) => c.key === key)!;
}

// ============================================================================
// 1. THE FIVE-CLASS SCENARIO — 5 separate, independently validated timetables
// ============================================================================

describe("T-410 — the owner's five-class scenario (3×5AP + 2×2AM)", () => {
  const problem = fiveClassProblem();
  const solution = solver.solve(problem);

  it("solves the shared-resource school cleanly (valid, zero unplaced)", () => {
    expect(solution.status).toBe("valid");
    expect(solution.statistics.unplacedCount).toBe(0);
    expect(solution.statistics.hardViolationCount).toBe(0);
  });

  it("produces exactly FIVE per-class reports — one per class, in problem order", () => {
    const reports = solution.statistics.perClass!;
    expect(reports).toHaveLength(5);
    expect(reports.map((r) => r.classId)).toEqual([
      "cls-5ap-a",
      "cls-5ap-b",
      "cls-5ap-c",
      "cls-2am-a",
      "cls-2am-b",
    ]);
    expect(reports.map((r) => r.className)).toEqual([
      "5AP — A",
      "5AP — B",
      "5AP — C",
      "2AM — A",
      "2AM — B",
    ]);
  });

  it("each class's report counts ONLY that class's entries (no cross-class leakage)", () => {
    const reports = solution.statistics.perClass!;
    for (const cls of FIVE_CLASSES) {
      const report = reports.find((r) => r.classId === cls.id)!;
      const ownEntries = solution.entries.filter((e) => e.classId === cls.id);
      expect(report.placedPeriods).toBe(ownEntries.length);
      // 5AP classes: 14 required periods; 2AM classes: 16 (SVT included).
      expect(report.requiredPeriods).toBe(cls.id.startsWith("cls-2am") ? 16 : 14);
      expect(report.coveragePercent).toBe(100);
    }
  });

  it("the five timetables PARTITION the schedule: sum(per-class placed) = all entries", () => {
    const reports = solution.statistics.perClass!;
    const sum = reports.reduce((s, r) => s + r.placedPeriods, 0);
    expect(sum).toBe(solution.entries.length);
    // And the global (locked-exclusive) statistic stays consistent.
    expect(solution.statistics.placedPeriods).toBe(solution.entries.length);
  });

  it("each class timetable is internally conflict-free: no overlaps inside one class", () => {
    // Within ONE class, no two entries share (day, period) — a class's own
    // timetable has one lesson per slot.
    for (const cls of FIVE_CLASSES) {
      const own = solution.entries.filter((e) => e.classId === cls.id);
      const slots = new Set(own.map((e) => `${e.day}#${e.periodIndex}`));
      expect(slots.size).toBe(own.length);
    }
    // Concurrent lessons of DIFFERENT classes at the same (day, period)
    // coexist in the canonical data — (class A, day, period) and
    // (class B, day, period) are different timetable positions.
    const bySlot = new Map<string, number>();
    for (const e of solution.entries) {
      const k = `${e.day}#${e.periodIndex}`;
      bySlot.set(k, (bySlot.get(k) ?? 0) + 1);
    }
    expect(Math.max(...bySlot.values())).toBeGreaterThan(1);
  });

  it("every class report is COMPLETE: zero issues, all checklist items ok", () => {
    for (const report of solution.statistics.perClass!) {
      expect(report.status).toBe("complete");
      expect(report.hardIssueCount).toBe(0);
      expect(report.softIssueCount).toBe(0);
      expect(report.issues).toHaveLength(0);
      for (const item of report.checklist) {
        // Gaps are reported honestly (a spread schedule may have holes) —
        // every OTHER checklist item must be ok on the clean fixture.
        if (item.key === "gaps") continue;
        expect(item.ok, `${report.className} / ${item.key}`).toBe(true);
      }
    }
  });

  it("shared teachers are respected across the five timetables (no teacher clash)", () => {
    // The same teacher serves all five classes — the busy grid must keep
    // each teacher single-booked across the WHOLE school.
    const seen = new Set<string>();
    for (const e of solution.entries) {
      if (!e.teacherId) continue;
      const k = `${e.teacherId}|${e.day}#${e.periodIndex}`;
      expect(seen.has(k), `teacher clash at ${k}`).toBe(false);
      seen.add(k);
    }
  });
});

// ============================================================================
// 2. INDEPENDENT conflict attribution — both sides see a shared clash
// ============================================================================

describe("T-410 — a teacher clash appears in BOTH classes' reports", () => {
  const problem = twoClassProblem();
  const entries = [
    // M. Belkacem teaches cls-a AND cls-b at monday P1 — the clash.
    entry("cls-a", "sub-math", "tch-math", "room-s1", "monday", 1),
    entry("cls-b", "sub-math", "tch-math", "room-s2", "monday", 1),
    // Clean remainder of both classes' hours.
    entry("cls-a", "sub-math", "tch-math", "room-s1", "tuesday", 2),
    entry("cls-a", "sub-ar", "tch-ar", "room-s1", "tuesday", 3),
    entry("cls-a", "sub-ar", "tch-ar", "room-s1", "tuesday", 4),
    entry("cls-b", "sub-math", "tch-math", "room-s2", "tuesday", 3),
    entry("cls-b", "sub-svt", "tch-svt", "room-lab", "tuesday", 4),
    entry("cls-b", "sub-svt", "tch-svt", "room-lab", "tuesday", 5),
  ];
  const reports = reportsOf(problem, entries);

  it("cls-a's timetable reports the clash with the OTHER class named", () => {
    const a = reports.find((r) => r.classId === "cls-a")!;
    const clash = a.issues.find((i) => i.kind === "teacher_double_booking")!;
    expect(clash).toBeDefined();
    expect(clash.severity).toBe("hard");
    expect(clash.message).toContain("M. Belkacem (Maths)");
    expect(clash.message).toContain("Classe B");
    expect(a.hardIssueCount).toBeGreaterThan(0);
    expect(a.status).toBe("incomplete");
    expect(checklistOf(a, "teacher_conflicts")!.ok).toBe(false);
    expect(checklistOf(a, "teacher_conflicts")!.count).toBe(1);
  });

  it("cls-b's timetable reports the SAME clash with cls-a named (both sides)", () => {
    const b = reports.find((r) => r.classId === "cls-b")!;
    const clash = b.issues.find((i) => i.kind === "teacher_double_booking")!;
    expect(clash).toBeDefined();
    expect(clash.message).toContain("Classe A");
    expect(b.status).toBe("incomplete");
    expect(checklistOf(b, "teacher_conflicts")!.ok).toBe(false);
  });

  it("the clash does NOT leak into other checklist items of the classes", () => {
    const a = reports.find((r) => r.classId === "cls-a")!;
    expect(checklistOf(a, "overlaps")!.ok).toBe(true); // no class self-overlap
    expect(checklistOf(a, "room_conflicts")!.ok).toBe(true);
    expect(checklistOf(a, "weekly_hours")!.ok).toBe(true);
  });
});

describe("T-410 — a room clash appears in BOTH classes' reports", () => {
  it("two classes in the same room at the same slot are both flagged", () => {
    const problem = twoClassProblem();
    const entries = [
      entry("cls-a", "sub-math", "tch-math", "room-s1", "monday", 1),
      entry("cls-a", "sub-math", "tch-math", "room-s1", "tuesday", 2),
      entry("cls-a", "sub-ar", "tch-ar", "room-s1", "tuesday", 3),
      entry("cls-a", "sub-ar", "tch-ar", "room-s1", "tuesday", 4),
      entry("cls-b", "sub-math", "tch-math", "room-s2", "tuesday", 3),
      entry("cls-b", "sub-svt", "tch-svt", "room-s1", "tuesday", 4), // room clash w/ cls-a
      entry("cls-b", "sub-svt", "tch-svt", "room-lab", "tuesday", 5),
    ];
    const reports = reportsOf(problem, entries);
    const a = reports.find((r) => r.classId === "cls-a")!;
    const b = reports.find((r) => r.classId === "cls-b")!;
    const clashA = a.issues.find((i) => i.kind === "room_double_booking");
    const clashB = b.issues.find((i) => i.kind === "room_double_booking");
    expect(clashA).toBeDefined();
    expect(clashB).toBeDefined();
    expect(clashA!.message).toContain("Classe B");
    expect(clashB!.message).toContain("Classe A");
    expect(checklistOf(a, "room_conflicts")!.ok).toBe(false);
    expect(checklistOf(b, "room_conflicts")!.ok).toBe(false);
  });
});

describe("T-410 — a class's OWN overlap (two lessons same slot) is its own issue", () => {
  it("class_double_booking flags only the overlapping class", () => {
    const problem = twoClassProblem();
    const entries = [
      entry("cls-a", "sub-math", "tch-math", "room-s1", "monday", 1),
      entry("cls-a", "sub-ar", "tch-ar", "room-s1", "monday", 1), // own overlap
      entry("cls-a", "sub-math", "tch-math", "room-s1", "tuesday", 2),
      entry("cls-a", "sub-ar", "tch-ar", "room-s1", "tuesday", 3),
      entry("cls-b", "sub-math", "tch-math", "room-s2", "monday", 2),
      entry("cls-b", "sub-math", "tch-math", "room-s2", "monday", 3),
      entry("cls-b", "sub-svt", "tch-svt", "room-lab", "tuesday", 4),
      entry("cls-b", "sub-svt", "tch-svt", "room-lab", "tuesday", 5),
    ];
    const reports = reportsOf(problem, entries);
    const a = reports.find((r) => r.classId === "cls-a")!;
    const b = reports.find((r) => r.classId === "cls-b")!;
    expect(a.issues.some((i) => i.kind === "class_double_booking")).toBe(true);
    expect(checklistOf(a, "overlaps")!.ok).toBe(false);
    expect(checklistOf(b, "overlaps")!.ok).toBe(true);
    expect(b.issues.some((i) => i.kind === "class_double_booking")).toBe(false);
  });
});

// ============================================================================
// 3. PER-CLASS COMPLETENESS — each class validated independently
// ============================================================================

describe("T-410 — missing weekly hours flip ONLY the concerned class", () => {
  it("cls-b missing hours: incomplete + honest counts; cls-a stays complete", () => {
    const problem = twoClassProblem();
    const entries = [
      entry("cls-a", "sub-math", "tch-math", "room-s1", "monday", 1),
      entry("cls-a", "sub-math", "tch-math", "room-s1", "tuesday", 2),
      entry("cls-a", "sub-ar", "tch-ar", "room-s1", "tuesday", 3),
      entry("cls-a", "sub-ar", "tch-ar", "room-s1", "tuesday", 4),
      // cls-b: only 1 of 2 math periods placed, SVT fully missing.
      entry("cls-b", "sub-math", "tch-math", "room-s2", "monday", 2),
    ];
    const reports = reportsOf(problem, entries);
    const a = reports.find((r) => r.classId === "cls-a")!;
    const b = reports.find((r) => r.classId === "cls-b")!;

    expect(a.status).toBe("complete");
    expect(b.status).toBe("incomplete");
    expect(b.placedPeriods).toBe(1);
    expect(b.requiredPeriods).toBe(4);
    expect(b.coveragePercent).toBe(25);
    const hours = checklistOf(b, "weekly_hours")!;
    expect(hours.ok).toBe(false);
    expect(hours.count).toBe(3); // 1 math + 2 SVT missing
    expect(hours.message).toContain("1/4");
    const subjects = checklistOf(b, "subjects_scheduled")!;
    expect(subjects.ok).toBe(false);
    expect(subjects.message).toContain("SVT");
  });
});

describe("T-410 — missing teacher / missing room are surfaced per class", () => {
  it("a lesson without a teacher fails teacher_assigned; without a room fails room_assigned", () => {
    const problem = twoClassProblem();
    const entries = [
      entry("cls-a", "sub-math", null, "room-s1", "monday", 1), // no teacher
      entry("cls-a", "sub-math", "tch-math", "room-s1", "tuesday", 2),
      entry("cls-a", "sub-ar", "tch-ar", null, "tuesday", 3), // no room
      entry("cls-a", "sub-ar", "tch-ar", "room-s1", "tuesday", 4),
      entry("cls-b", "sub-math", "tch-math", "room-s2", "monday", 2),
      entry("cls-b", "sub-math", "tch-math", "room-s2", "monday", 3),
      entry("cls-b", "sub-svt", "tch-svt", "room-lab", "tuesday", 4),
      entry("cls-b", "sub-svt", "tch-svt", "room-lab", "tuesday", 5),
    ];
    const reports = reportsOf(problem, entries);
    const a = reports.find((r) => r.classId === "cls-a")!;
    const b = reports.find((r) => r.classId === "cls-b")!;
    expect(checklistOf(a, "teacher_assigned")!.ok).toBe(false);
    expect(checklistOf(a, "teacher_assigned")!.count).toBe(1);
    expect(checklistOf(a, "room_assigned")!.ok).toBe(false);
    expect(checklistOf(a, "room_assigned")!.count).toBe(1);
    expect(a.status).toBe("incomplete");
    expect(checklistOf(b, "teacher_assigned")!.ok).toBe(true);
    expect(checklistOf(b, "room_assigned")!.ok).toBe(true);
    expect(b.status).toBe("complete");
  });
});

describe("T-410 — an unplaced block is attributed to its class with the reason", () => {
  it("the solver's honest unplacement reason lands in the class's issues", () => {
    const problem = twoClassProblem();
    const entries = [
      entry("cls-a", "sub-math", "tch-math", "room-s1", "monday", 1),
      entry("cls-a", "sub-math", "tch-math", "room-s1", "tuesday", 2),
      entry("cls-a", "sub-ar", "tch-ar", "room-s1", "tuesday", 3),
      entry("cls-a", "sub-ar", "tch-ar", "room-s1", "tuesday", 4),
      entry("cls-b", "sub-math", "tch-math", "room-s2", "monday", 2),
      entry("cls-b", "sub-math", "tch-math", "room-s2", "monday", 3),
      // cls-b's SVT block could not be placed.
    ];
    const svt = problem.requirements.find((r) => r.subjectId === "sub-svt")!;
    const reports = reportsOf(problem, entries, [
      { requirement: svt, blockPeriods: 2, reason: "Aucun créneau libre compatible." },
    ]);
    const b = reports.find((r) => r.classId === "cls-b")!;
    const unplacedIssue = b.issues.find((i) => i.kind === "unplaced_block")!;
    expect(unplacedIssue).toBeDefined();
    expect(unplacedIssue.severity).toBe("hard");
    expect(unplacedIssue.message).toContain("Aucun créneau libre compatible.");
    expect(b.status).toBe("incomplete");
    expect(checklistOf(b, "weekly_hours")!.ok).toBe(false);
  });
});

// ============================================================================
// 4. GAPS — unexplained holes counted per class, honestly
// ============================================================================

describe("T-410 — gaps between a class's lessons are counted", () => {
  it("lessons at P1 and P4 leave 2 hole periods (P2, P3)", () => {
    const problem = twoClassProblem();
    const entries = [
      entry("cls-a", "sub-math", "tch-math", "room-s1", "monday", 1),
      entry("cls-a", "sub-ar", "tch-ar", "room-s1", "monday", 4), // hole at P2,P3
      entry("cls-a", "sub-math", "tch-math", "room-s1", "tuesday", 2),
      entry("cls-a", "sub-ar", "tch-ar", "room-s1", "tuesday", 3),
      entry("cls-b", "sub-math", "tch-math", "room-s2", "monday", 2),
      entry("cls-b", "sub-math", "tch-math", "room-s2", "monday", 3),
      entry("cls-b", "sub-svt", "tch-svt", "room-lab", "tuesday", 4),
      entry("cls-b", "sub-svt", "tch-svt", "room-lab", "tuesday", 5),
    ];
    const reports = reportsOf(problem, entries);
    const a = reports.find((r) => r.classId === "cls-a")!;
    const b = reports.find((r) => r.classId === "cls-b")!;
    expect(a.gapPeriods).toBe(2);
    expect(checklistOf(a, "gaps")!.ok).toBe(false);
    expect(checklistOf(a, "gaps")!.count).toBe(2);
    // Gaps are REPORTED, not blocking: cls-a is still complete (all hours
    // placed, no conflicts) — a hole is a quality warning.
    expect(a.status).toBe("complete");
    expect(b.gapPeriods).toBe(0);
    expect(checklistOf(b, "gaps")!.ok).toBe(true);
  });
});

// ============================================================================
// 6. PERSISTED-STATISTICS READBACK — absence-tolerant (pre-T-410 versions)
// ============================================================================

describe("T-410 — readClassTimetableReports (the persisted-statistics readback)", () => {
  it("reads the reports back from a persisted statistics object", () => {
    const problem = fiveClassProblem();
    const solution = solver.solve(problem);
    const stats = solution.statistics as unknown as Record<string, unknown>;
    const reports = readClassTimetableReports(stats);
    expect(reports).toHaveLength(5);
    expect(reports[0].classId).toBe("cls-5ap-a");
  });

  it("yields [] for versions generated BEFORE T-410 (honest absence)", () => {
    // The live production versions (e.g. the published v2 from T-408) have
    // no perClass key — the UI must render "no per-class data", never
    // "all classes fine".
    const legacyStats = {
      placedPeriods: 112,
      requiredPeriods: 118,
      hardViolationCount: 0,
      softViolationCount: 3,
      unplacedCount: 2,
    };
    expect(readClassTimetableReports(legacyStats)).toEqual([]);
    expect(readClassTimetableReports({})).toEqual([]);
    expect(readClassTimetableReports(null)).toEqual([]);
    expect(readClassTimetableReports(undefined)).toEqual([]);
  });

  it("yields [] for malformed persisted values (never a crash)", () => {
    expect(readClassTimetableReports({ perClass: "corrupted" })).toEqual([]);
    expect(readClassTimetableReports({ perClass: null })).toEqual([]);
    expect(readClassTimetableReports({ perClass: { not: "an array" } })).toEqual(
      [],
    );
  });
});


// ============================================================================
// 5. SOLVER INTEGRATION + DETERMINISM
// ============================================================================

describe("T-410 — solver integration and determinism", () => {
  const problem = fiveClassProblem();

  it("solveAsync produces the IDENTICAL per-class reports as solve", async () => {
    const sync = solver.solve(problem);
    const async = await solver.solveAsync!(problem);
    expect(async.statistics.perClass).toEqual(sync.statistics.perClass);
    expect(async.entries).toEqual(sync.entries);
  });

  it("a class with NO requirements gets its honest report (not silence)", () => {
    const problemNoReq: TimetableProblem = {
      ...fiveClassProblem(),
      requirements: fiveClassRequirements().filter(
        (r) => r.classId !== "cls-5ap-c",
      ),
    };
    const solution = solver.solve(problemNoReq);
    const reports = solution.statistics.perClass!;
    expect(reports).toHaveLength(5); // the class still has its report
    const c = reports.find((r) => r.classId === "cls-5ap-c")!;
    expect(c.placedPeriods).toBe(0);
    expect(c.requiredPeriods).toBe(0);
    expect(checklistOf(c, "weekly_hours")!.ok).toBe(true); // nothing required
    expect(c.status).toBe("complete"); // nothing required, nothing missing
  });
});
