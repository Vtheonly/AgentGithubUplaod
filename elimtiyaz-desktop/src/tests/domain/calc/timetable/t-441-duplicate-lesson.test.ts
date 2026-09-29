// ============================================================================
// FILE: src/tests/domain/calc/timetable/t-441-duplicate-lesson.test.ts
// ============================================================================
/**
 * T-441 — the DUPLICATE-LESSON protections (the owner's contract: "jamais
 * de cours en double"). Three layers, each tested RED-first here:
 *
 *  1. VALIDATOR — excess weekly hours (a class+subject placed MORE periods
 *     than its weeklyHours require) is a HARD violation
 *     (`excess_weekly_hours`), not silently accepted coverage.
 *  2. SOLVER — locked pins already covering part of a requirement never
 *     produce duplicated blocks: the pinned coverage is SUBTRACTED, so a
 *     regenerated version holds exactly the required periods per
 *     class+subject.
 *  3. PREFERRED SLOTS — a regeneration offered the source version's
 *     schedule as preferences converges on it even at extreme pin
 *     densities (50% pinned → 0 unplaced, 0 hard violations): the owner's
 *     "N échecs on regeneration" symptom closed at the root.
 */

import { describe, expect, it } from "vitest";
import {
  buildFixtureProblem,
} from "../../../../domain/calc/timetable/fixture";
import {
  coverageExcesses,
  coverageGaps,
  validateTimetable,
} from "../../../../domain/calc/timetable/constraints";
import {
  analyzeTimetableFeasibility,
} from "../../../../domain/calc/timetable/feasibility";
import {
  getTimetableSolver,
  GREEDY_SOLVER_ID,
} from "../../../../domain/calc/timetable/solver";
import "../../../../domain/calc/timetable/solver";
import type {
  TimetableProblem,
  TimetableRequirement,
  TimetableSlotAssignment,
} from "../../../../domain/model/timetable";
import { teachingPeriods } from "../../../../domain/model/timetable";

const solver = getTimetableSolver(GREEDY_SOLVER_ID)!;

function countPer(
  entries: readonly TimetableSlotAssignment[],
): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of entries) {
    const k = `${e.classId}|${e.subjectId}`;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

function entryOf(
  classId: string,
  subjectId: string,
  teacherId: string | null,
  day: TimetableSlotAssignment["day"],
  periodIndex: number,
): TimetableSlotAssignment {
  return {
    classId,
    subjectId,
    teacherId,
    roomId: null,
    day,
    periodIndex,
    lessonGroup: 900 + periodIndex,
  };
}

// ============================================================================
// 1. THE VALIDATOR — excess weekly hours is a HARD violation
// ============================================================================

describe("T-441 — duplicate lessons: the canonical validator", () => {
  it("flags a class+subject placed BEYOND its weekly hours as a hard excess_weekly_hours violation", () => {
    const problem = buildFixtureProblem();
    // The fixture's own first requirement, duplicated once beyond its hours.
    const req = problem.requirements[0];
    const pm =
      teachingPeriods(problem.configuration)[0]?.endMinutes -
      teachingPeriods(problem.configuration)[0]?.startMinutes;
    const requiredPeriods = Math.max(1, Math.round((req.weeklyHours * 60) / Math.max(1, pm)));

    // Build an entry set with ONE period too many for this requirement
    // (place the same period twice on distinct lesson groups).
    const entries: TimetableSlotAssignment[] = [];
    const days = problem.configuration.schoolDays;
    for (let i = 0; i < requiredPeriods + 1; i++) {
      const day = days[i % days.length];
      const periodIndex = 1 + Math.floor(i / days.length);
      entries.push(
        entryOf(req.classId, req.subjectId, req.teacherId, day, periodIndex),
      );
    }

    const excesses = coverageExcesses(problem, entries);
    expect(excesses.length).toBeGreaterThanOrEqual(1);
    expect(excesses[0].placedPeriods).toBe(requiredPeriods + 1);
    expect(excesses[0].requiredPeriods).toBe(requiredPeriods);

    const violations = validateTimetable(problem, entries);
    const excess = violations.filter(
      (v) => v.kind === "excess_weekly_hours",
    );
    expect(excess.length).toBeGreaterThanOrEqual(1);
    expect(excess[0].severity).toBe("hard");
    expect(excess[0].message).toContain(req.className);
    expect(excess[0].message).toContain(req.subjectName);
    // The message names the counts (the owner's "bring what it is").
    expect(excess[0].message).toContain(`${requiredPeriods + 1} périodes`);
  });

  it("accepts the exact required periods (no false positive)", () => {
    const problem = buildFixtureProblem();
    const solution = solver.solve(problem);
    expect(solution.unplaced).toHaveLength(0);
    const excesses = coverageExcesses(problem, solution.entries);
    expect(excesses).toHaveLength(0);
    const hard = validateTimetable(problem, solution.entries).filter(
      (v) => v.severity === "hard",
    );
    expect(hard).toHaveLength(0);
  });
});

// ============================================================================
// 2. THE SOLVER — pinned coverage is subtracted, never duplicated
// ============================================================================

describe("T-441 — duplicate lessons: pinned-coverage subtraction", () => {
  it("a fully solved problem with HALF its entries locked regenerates with EXACTLY the required periods per class+subject", () => {
    const base = buildFixtureProblem();
    const first = solver.solve(base);
    expect(first.unplaced).toHaveLength(0);

    // Lock 50% of the schedule (every 2nd entry) — the extreme manual
    // adjustment density.
    const locked = first.entries.filter((_, i) => i % 2 === 0);
    const problem: TimetableProblem = {
      ...base,
      lockedEntries: locked,
      preferredEntries: first.entries,
    };

    const solution = solver.solve(problem);
    expect(solution.unplaced).toHaveLength(0);

    // EXACT coverage: no class+subject above its requirement.
    const per = countPer(solution.entries);
    for (const req of problem.requirements) {
      const k = `${req.classId}|${req.subjectId}`;
      const pm =
        teachingPeriods(problem.configuration)[0]?.endMinutes -
        teachingPeriods(problem.configuration)[0]?.startMinutes;
      const required = Math.max(1, Math.round((req.weeklyHours * 60) / Math.max(1, pm)));
      expect(per.get(k) ?? 0).toBe(required);
    }

    // The canonical validator agrees: no hard violations, no gaps, no
    // excesses — a genuinely complete, conflict-free version.
    const hard = validateTimetable(problem, solution.entries).filter(
      (v) => v.severity === "hard",
    );
    expect(hard).toHaveLength(0);
    expect(coverageGaps(problem, solution.entries)).toHaveLength(0);
    expect(coverageExcesses(problem, solution.entries)).toHaveLength(0);

    // Every locked pin survived verbatim.
    for (const pin of locked) {
      expect(
        solution.entries.some(
          (e) =>
            e.classId === pin.classId &&
            e.subjectId === pin.subjectId &&
            e.day === pin.day &&
            e.periodIndex === pin.periodIndex,
        ),
      ).toBe(true);
    }
  });

  it("a requirement fully covered by locks contributes NO new blocks (blockSplit(0) never yields [1])", () => {
    const base = buildFixtureProblem();
    const first = solver.solve(base);
    // Lock ALL entries of the first requirement's class+subject.
    const target = problem0Key(first.entries);
    const locked = first.entries.filter(
      (e) => `${e.classId}|${e.subjectId}` === target,
    );
    expect(locked.length).toBeGreaterThanOrEqual(1);

    const problem: TimetableProblem = { ...base, lockedEntries: locked };
    const solution = solver.solve(problem);

    // The regenerated schedule holds EXACTLY the locked periods for that
    // class+subject — not one duplicated period beyond them.
    const per = countPer(solution.entries);
    expect(per.get(target)).toBe(locked.length);
    const excesses = coverageExcesses(problem, solution.entries);
    expect(
      excesses.filter((x) => `${x.requirement.classId}|${x.requirement.subjectId}` === target),
    ).toHaveLength(0);
  });
});

function problem0Key(entries: readonly TimetableSlotAssignment[]): string {
  const e = entries[0];
  return `${e.classId}|${e.subjectId}`;
}

// ============================================================================
// 3. THE FEASIBILITY PRE-ANALYSIS — over-pinned requirements fail BEFORE
//    generation with the precise reason
// ============================================================================

describe("T-441 — duplicate lessons: the feasibility pre-analysis", () => {
  it("rejects a requirement whose locked pins ALREADY exceed its weekly hours, naming class/subject/counts", () => {
    const base = buildFixtureProblem();
    const req: TimetableRequirement = base.requirements[0];
    const pm =
      teachingPeriods(base.configuration)[0]?.endMinutes -
      teachingPeriods(base.configuration)[0]?.startMinutes;
    const required = Math.max(1, Math.round((req.weeklyHours * 60) / Math.max(1, pm)));

    // Pin required + 1 periods of this class+subject on legal distinct
    // slots (different days/periods, no self-clash).
    const days = base.configuration.schoolDays;
    const pins: TimetableSlotAssignment[] = [];
    for (let i = 0; i < required + 1; i++) {
      pins.push(
        entryOf(
          req.classId,
          req.subjectId,
          req.teacherId,
          days[i % days.length],
          1 + Math.floor(i / days.length),
        ),
      );
    }

    const issues = analyzeTimetableFeasibility({
      ...base,
      lockedEntries: pins,
    });
    const excess = issues.filter((i) => i.kind === "pinned_entry_excess");
    expect(excess.length).toBe(1);
    expect(excess[0].message).toContain(req.subjectName);
    expect(excess[0].message).toContain(req.className);
    expect(excess[0].message).toContain(`${required + 1} périodes épinglées`);
    expect(excess[0].refs.classId).toBe(req.classId);
    expect(excess[0].refs.subjectId).toBe(req.subjectId);
  });

  it("passes pins that exactly meet a requirement (no false positive)", () => {
    const base = buildFixtureProblem();
    const first = solver.solve(base);
    const locked = first.entries.filter((_, i) => i % 3 === 0);
    const issues = analyzeTimetableFeasibility({
      ...base,
      lockedEntries: locked,
    });
    expect(
      issues.filter((i) => i.kind === "pinned_entry_excess"),
    ).toHaveLength(0);
  });
});

// ============================================================================
// 4. THE PREFERRED-SLOT CONTINUITY — the regeneration sweep
// ============================================================================

describe("T-441 — preferred slots: regeneration continuity at every pin density", () => {
  for (const pct of [10, 25, 50]) {
    it(`regenerates COMPLETELY with ${pct}% of the schedule locked as pins`, () => {
      const base = buildFixtureProblem();
      const first = solver.solve(base);
      expect(first.unplaced).toHaveLength(0);

      const locked = first.entries.filter(
        (_, i) => (i * pct) % 100 < pct,
      );
      const solution = solver.solve({
        ...base,
        lockedEntries: locked,
        preferredEntries: first.entries,
      });

      expect(solution.unplaced).toHaveLength(0);
      expect(solution.statistics.hardViolationCount).toBe(0);
      expect(solution.statistics.placedPeriods).toBe(
        solution.statistics.requiredPeriods,
      );
    });
  }
});
