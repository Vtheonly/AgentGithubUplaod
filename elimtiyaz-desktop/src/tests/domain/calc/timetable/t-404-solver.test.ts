// ============================================================================
// FILE: src/tests/domain/calc/timetable/t-404-solver.test.ts
// ============================================================================
/**
 * T-404 — the canonical timetable domain tests: solver determinism,
 * known-good fixture generation, hard-constraint enforcement (teacher /
 * class / ROOM double-booking — SCHED-101), free days, unavailability,
 * room types + capacities, weekly-hours honesty, soft-constraint
 * reporting, and the live single-move validation.
 */

import { describe, expect, it } from "vitest";
import {
  buildFixtureProblem,
  buildImpossibleProblem,
} from "../../../../domain/calc/timetable/fixture";
import {
  blockSplit,
  coverageGaps,
  requiredPeriodsFor,
  validateTimetable,
  validateTimetableMove,
} from "../../../../domain/calc/timetable/constraints";
import {
  getTimetableSolver,
  GREEDY_SOLVER_ID,
  listTimetableSolvers,
} from "../../../../domain/calc/timetable/solver";
import "../../../../domain/calc/timetable/solver"; // registers ts-greedy-v1
import type {
  TimetableProblem,
  TimetableSlotAssignment,
} from "../../../../domain/model/timetable";
import { canTransitionTimetableVersion } from "../../../../domain/model/timetable";

const solver = getTimetableSolver(GREEDY_SOLVER_ID)!;

// ============================================================================
// Registry + determinism
// ============================================================================

describe("T-404 — solver registry", () => {
  it("registers the native ts-greedy-v1 solver with a build stamp", () => {
    expect(solver).toBeDefined();
    expect(solver.id).toBe("ts-greedy-v1");
    expect(solver.build).toMatch(/^v\d+\.\d+\.\d+/);
    expect(listTimetableSolvers().length).toBeGreaterThanOrEqual(1);
  });
});

describe("T-404 — solver determinism (packaging gate 5)", () => {
  it("produces the IDENTICAL solution for the same problem (x3 runs)", () => {
    const a = solver.solve(buildFixtureProblem());
    const b = solver.solve(buildFixtureProblem());
    const c = solver.solve(buildFixtureProblem());
    const key = (e: TimetableSlotAssignment) =>
      `${e.classId}|${e.subjectId}|${e.day}|${e.periodIndex}|${e.teacherId}|${e.roomId}|${e.lessonGroup}`;
    const ka = a.entries.map(key).sort().join(";");
    const kb = b.entries.map(key).sort().join(";");
    const kc = c.entries.map(key).sort().join(";");
    expect(kb).toBe(ka);
    expect(kc).toBe(ka);
  });
});

// ============================================================================
// The known-good fixture
// ============================================================================

describe("T-404 — known-good fixture generation", () => {
  const problem = buildFixtureProblem();
  const solution = solver.solve(problem);

  it("places EVERY requirement (status valid, zero unplaced)", () => {
    expect(solution.status).toBe("valid");
    expect(solution.unplaced).toHaveLength(0);
    expect(solution.statistics.placedPeriods).toBe(
      solution.statistics.requiredPeriods,
    );
    expect(solution.statistics.hardViolationCount).toBe(0);
  });

  it("covers every class (3/3) with exact weekly hours", () => {
    expect(solution.statistics.classesScheduled).toBe(3);
    expect(solution.statistics.totalClasses).toBe(3);
    expect(coverageGaps(problem, solution.entries)).toHaveLength(0);
  });

  it("respects the Algerian week: no entry on Friday or Saturday", () => {
    const weekend = solution.entries.filter(
      (e) => e.day === "friday" || e.day === "saturday",
    );
    expect(weekend).toHaveLength(0);
  });

  it("respects the 1AS-A Wednesday free day (hard)", () => {
    const hits = solution.entries.filter(
      (e) => e.classId === "cls-1as-a" && e.day === "wednesday",
    );
    expect(hits).toHaveLength(0);
  });

  it("respects the teacher Sunday free day (M. Ziani)", () => {
    const hits = solution.entries.filter(
      (e) => e.teacherId === "tch-arab" && e.day === "sunday",
    );
    expect(hits).toHaveLength(0);
  });

  it("places every Sciences lesson in the lab as a 2-period block", () => {
    const phys = solution.entries.filter((e) => e.subjectId === "sub-phys");
    // 3 classes x 1 block of 2 periods = 6 entries.
    expect(phys).toHaveLength(6);
    for (const e of phys) {
      expect(e.roomId).toBe("room-lab");
    }
    // Blocks are consecutive same-day pairs sharing a lessonGroup.
    const groups = new Map<number, TimetableSlotAssignment[]>();
    for (const e of phys) {
      groups.set(e.lessonGroup, [...(groups.get(e.lessonGroup) ?? []), e]);
    }
    expect(groups.size).toBe(3);
    for (const block of groups.values()) {
      expect(block).toHaveLength(2);
      expect(block[0].day).toBe(block[1].day);
      expect(block[1].periodIndex).toBe(block[0].periodIndex + 1);
    }
  });

  it("never double-books the lab across classes", () => {
    const lab = solution.entries.filter((e) => e.roomId === "room-lab");
    const seen = new Set<string>();
    for (const e of lab) {
      const k = `${e.day}#${e.periodIndex}`;
      expect(seen.has(k)).toBe(false);
      seen.add(k);
    }
  });

  it("never double-books a teacher", () => {
    const seen = new Set<string>();
    for (const e of solution.entries) {
      if (!e.teacherId) continue;
      const k = `${e.teacherId}|${e.day}|${e.periodIndex}`;
      expect(seen.has(k)).toBe(false);
      seen.add(k);
    }
  });

  it("never exceeds max periods per day per class (6)", () => {
    const perDay = new Map<string, number>();
    for (const e of solution.entries) {
      const k = `${e.classId}|${e.day}`;
      perDay.set(k, (perDay.get(k) ?? 0) + 1);
    }
    for (const count of perDay.values()) {
      expect(count).toBeLessThanOrEqual(6);
    }
  });

  it("reports soft violations honestly (avoid_last_period is expected)", () => {
    expect(solution.statistics.softViolationCount).toBeGreaterThanOrEqual(0);
    const softKinds = solution.violations
      .filter((v) => v.severity === "soft")
      .map((v) => v.kind);
    expect(Array.from(new Set(softKinds))).toEqual(
      expect.arrayContaining(["avoid_last_period"]),
    );
  });
});

// ============================================================================
// Honest impossibility (failure diagnostics)
// ============================================================================

describe("T-404 — impossible schedule reports honestly (gate 6)", () => {
  it("never fabricates: unplaced lab blocks carry a French reason", () => {
    const problem = buildImpossibleProblem();
    const solution = solver.solve(problem);
    expect(solution.status).not.toBe("valid");
    expect(solution.unplaced.length).toBeGreaterThan(0);
    for (const u of solution.unplaced) {
      expect(u.reason.length).toBeGreaterThan(10);
      expect(u.reason).toMatch(/[À-ÿ]/); // French text
    }
  });

  it("validates the unplaced result as hard unmet-weekly-hours", () => {
    const problem = buildImpossibleProblem();
    const solution = solver.solve(problem);
    const hard = solution.violations.filter(
      (v) => v.severity === "hard" && v.kind === "unmet_weekly_hours",
    );
    expect(hard.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// The canonical validator (SCHED-101: room conflicts detected)
// ============================================================================

describe("T-404 — canonical validator catches every resource clash", () => {
  const base = buildFixtureProblem();
  const solution = solver.solve(base);

  it("detects TEACHER double-booking (2 classes, same teacher, same slot)", () => {
    const entries: TimetableSlotAssignment[] = [
      ...solution.entries,
      {
        classId: "cls-3as-a",
        subjectId: "sub-hist",
        teacherId: "tch-math",
        roomId: null,
        day: "sunday",
        periodIndex: 1,
        lessonGroup: 999,
      },
      {
        classId: "cls-2as-a",
        subjectId: "sub-hist",
        teacherId: "tch-math",
        roomId: null,
        day: "sunday",
        periodIndex: 1,
        lessonGroup: 998,
      },
    ];
    const violations = validateTimetable(base, entries);
    expect(
      violations.some((v) => v.kind === "teacher_double_booking" && v.severity === "hard"),
    ).toBe(true);
  });

  it("detects ROOM double-booking (different teachers, different classes, same room+slot — the SCHED-101 case)", () => {
    const entries: TimetableSlotAssignment[] = [
      ...solution.entries,
      {
        classId: "cls-1as-a",
        subjectId: "sub-math",
        teacherId: "tch-math",
        roomId: "room-c1",
        day: "sunday",
        periodIndex: 3,
        lessonGroup: 1001,
      },
      {
        classId: "cls-2as-a",
        subjectId: "sub-arab",
        teacherId: "tch-arab",
        roomId: "room-c1",
        day: "sunday",
        periodIndex: 3,
        lessonGroup: 1002,
      },
    ];
    const violations = validateTimetable(base, entries);
    expect(
      violations.some((v) => v.kind === "room_double_booking" && v.severity === "hard"),
    ).toBe(true);
  });

  it("detects CLASS double-booking", () => {
    const entries: TimetableSlotAssignment[] = [
      ...solution.entries,
      {
        classId: "cls-1as-a",
        subjectId: "sub-math",
        teacherId: "tch-math",
        roomId: null,
        day: "sunday",
        periodIndex: 4,
        lessonGroup: 1003,
      },
      {
        classId: "cls-1as-a",
        subjectId: "sub-arab",
        teacherId: "tch-arab",
        roomId: null,
        day: "sunday",
        periodIndex: 4,
        lessonGroup: 1004,
      },
    ];
    const violations = validateTimetable(base, entries);
    expect(
      violations.some((v) => v.kind === "class_double_booking" && v.severity === "hard"),
    ).toBe(true);
  });

  it("detects room-type mismatches (Sciences forced into a classroom)", () => {
    const forced: TimetableSlotAssignment[] = solution.entries.map((e) =>
      e.subjectId === "sub-phys" ? { ...e, roomId: "room-c1" } : e,
    );
    const v2 = validateTimetable(base, forced);
    expect(
      v2.some((v) => v.kind === "room_type_mismatch" && v.severity === "hard"),
    ).toBe(true);
  });

  it("flags a hard free-day violation when one is broken", () => {
    const forced: TimetableSlotAssignment[] = solution.entries.map((e) =>
      e.classId === "cls-1as-a" ? { ...e, day: "wednesday" } : e,
    );
    const violations = validateTimetable(base, forced);
    expect(violations.some((v) => v.kind === "free_day" && v.severity === "hard")).toBe(
      true,
    );
  });
});

// ============================================================================
// Live move validation (manual adjustment path)
// ============================================================================

describe("T-404 — live single-move validation", () => {
  const base = buildFixtureProblem();
  const solution = solver.solve(base);

  it("accepts a valid move with zero hard violations", () => {
    // Find a genuinely FREE slot for cls-1as-a (day, period) first.
    const days = base.configuration.schoolDays;
    const periods = base.configuration.periods.map((p) => p.index);
    let freeDay = days[0];
    let freePeriod = periods[0];
    outer: for (const day of days) {
      for (const p of periods) {
        const busy = solution.entries.some(
          (e) => e.classId === "cls-1as-a" && e.day === day && e.periodIndex === p,
        );
        if (!busy) {
          freeDay = day;
          freePeriod = p;
          break outer;
        }
      }
    }
    const moved: TimetableSlotAssignment = {
      classId: "cls-1as-a",
      subjectId: "sub-math",
      teacherId: "tch-math",
      roomId: "room-c1",
      day: freeDay,
      periodIndex: freePeriod,
      lessonGroup: 1,
    };
    const candidate = [...solution.entries, moved];
    const moveViolations = validateTimetableMove(base, candidate, moved);
    const hard = moveViolations.filter((v) => v.severity === "hard");
    expect(hard).toHaveLength(0);
  });

  it("rejects a move that double-books a teacher (live conflict)", () => {
    const moved: TimetableSlotAssignment = {
      classId: "cls-1as-a",
      subjectId: "sub-math",
      teacherId: "tch-math",
      roomId: "room-c1",
      day: "sunday",
      periodIndex: 3,
      lessonGroup: 1,
    };
    const conflict: TimetableSlotAssignment = {
      classId: "cls-3as-a",
      subjectId: "sub-math",
      teacherId: "tch-math",
      roomId: null,
      day: "sunday",
      periodIndex: 3,
      lessonGroup: 2,
    };
    const candidate = [...solution.entries, moved, conflict];
    const moveViolations = validateTimetableMove(base, candidate, moved);
    expect(moveViolations.some((v) => v.kind === "teacher_double_booking")).toBe(
      true,
    );
  });
});

// ============================================================================
// Requirement math + version workflow
// ============================================================================

describe("T-404 — requirement/block math", () => {
  it("converts weekly hours to periods (60-min periods)", () => {
    expect(requiredPeriodsFor({ weeklyHours: 4 } as never, 60)).toBe(4);
    expect(requiredPeriodsFor({ weeklyHours: 1.5 } as never, 60)).toBe(2);
    expect(requiredPeriodsFor({ weeklyHours: 0 } as never, 60)).toBe(1);
  });

  it("splits periods into consecutive blocks with honest remainders", () => {
    expect(blockSplit(4, 1)).toEqual([1, 1, 1, 1]);
    expect(blockSplit(3, 2)).toEqual([2, 1]);
    expect(blockSplit(4, 2)).toEqual([2, 2]);
    expect(blockSplit(2, 2)).toEqual([2]);
    expect(blockSplit(5, 2)).toEqual([2, 2, 1]);
  });
});

describe("T-404 — version workflow transitions (0109 §4)", () => {
  it("allows only the review → approve → publish chain", () => {
    expect(canTransitionTimetableVersion("draft", "in_review")).toBe(true);
    expect(canTransitionTimetableVersion("in_review", "approved")).toBe(true);
    expect(canTransitionTimetableVersion("approved", "published")).toBe(true);
    expect(canTransitionTimetableVersion("published", "archived")).toBe(true);
    expect(canTransitionTimetableVersion("draft", "published")).toBe(false);
    expect(canTransitionTimetableVersion("draft", "approved")).toBe(false);
    expect(canTransitionTimetableVersion("in_review", "published")).toBe(false);
    expect(canTransitionTimetableVersion("rejected", "draft")).toBe(false);
    expect(canTransitionTimetableVersion("archived", "draft")).toBe(false);
  });
});

// ============================================================================
// Locked-entry preservation (manual pins survive regeneration)
// ============================================================================

describe("T-404 — locked manual pins survive regeneration", () => {
  it("keeps the locked slot and blocks others from it", () => {
    const problem: TimetableProblem = {
      ...buildFixtureProblem(),
      lockedEntries: [
        {
          classId: "cls-2as-a",
          subjectId: "sub-math",
          teacherId: "tch-math",
          roomId: "room-c1",
          day: "sunday",
          periodIndex: 1,
          lessonGroup: 1,
        },
      ],
    };
    const solution = solver.solve(problem);
    const kept = solution.entries.find(
      (e) =>
        e.classId === "cls-2as-a" &&
        e.subjectId === "sub-math" &&
        e.day === "sunday" &&
        e.periodIndex === 1,
    );
    expect(kept).toBeDefined();
    expect(solution.status).toBe("valid");
  });
});
