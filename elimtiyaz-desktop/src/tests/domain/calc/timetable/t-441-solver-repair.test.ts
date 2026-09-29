// ============================================================================
// FILE: src/tests/domain/calc/timetable/t-441-solver-repair.test.ts
// ============================================================================
/**
 * T-441 — the solver correctness tests: the eviction repair (SCHED-110),
 * the first/last-period boundaries, the one-slot-left corner, and the
 * single-class regeneration semantics (carried entries + regenerateClassIds).
 */

import { describe, expect, it } from "vitest";
import {
  buildFixtureProblem,
} from "../../../../domain/calc/timetable/fixture";
import {
  validateTimetable,
  coverageGaps,
} from "../../../../domain/calc/timetable/constraints";
import {
  getTimetableSolver,
  GREEDY_SOLVER_ID,
} from "../../../../domain/calc/timetable/solver";
import "../../../../domain/calc/timetable/solver";
import type {
  TimetableConstraint,
  TimetableDay,
  TimetableProblem,
  TimetableRequirement,
  TimetableSlotAssignment,
} from "../../../../domain/model/timetable";
import { teachingPeriods } from "../../../../domain/model/timetable";

const solver = getTimetableSolver(GREEDY_SOLVER_ID)!;

// ── Builders ────────────────────────────────────────────────────────────────

function constraint(
  id: string,
  scope: TimetableConstraint["scope"],
  entityId: string | null,
  kind: TimetableConstraint["kind"],
  severity: TimetableConstraint["severity"],
  params: Record<string, unknown>,
): TimetableConstraint {
  return {
    id,
    tenantId: "tenant-t441",
    academicYearId: "year-t441",
    scope,
    entityId,
    kind,
    severity,
    params,
    isActive: true,
    createdAt: "2026-09-29T00:00:00.000Z",
    updatedAt: "2026-09-29T00:00:00.000Z",
  };
}

/** The hard resource-clash helper: (teacher|class|room) × slot. */
function slotKey(e: TimetableSlotAssignment): string {
  return `${e.day}#${e.periodIndex}`;
}

function noResourceClashes(entries: readonly TimetableSlotAssignment[]): boolean {
  const t = new Set<string>();
  const c = new Set<string>();
  const r = new Set<string>();
  for (const e of entries) {
    if (e.teacherId && t.has(`${e.teacherId}|${slotKey(e)}`)) return false;
    if (e.teacherId) t.add(`${e.teacherId}|${slotKey(e)}`);
    if (c.has(`${e.classId}|${slotKey(e)}`)) return false;
    c.add(`${e.classId}|${slotKey(e)}`);
    if (e.roomId && r.has(`${e.roomId}|${slotKey(e)}`)) return false;
    if (e.roomId) r.add(`${e.roomId}|${slotKey(e)}`);
  }
  return true;
}

// ============================================================================
// SCHED-110 — the no-backtracking corner case (eviction repair)
// ============================================================================

describe("T-441 — SCHED-110: high-occupancy no-free-slot corners", () => {
  /**
   * THE CORNER (verified by search): cls-a 29/30 + cls-b 23/24 (Monday
   * free) + cls-z 30/30 — the shared teacher T (tch-math) teaches 3 + 21 + 2
   * = 26 periods. The greedy fill leaves X@cls-z (T) with NO plain slot
   * (every cls-z free slot is T-busy at that point), and the v1.2.0 solver
   * left it unplaced; the v1.3.0 EVICTION REPAIR rescues it by displacing
   * movable blocks. The run's progress events PROVE the repair pass ran
   * with ≥ 1 unplaced block (the plain pass failed) and the final status
   * is valid (only the eviction could have placed it).
   */
  function buildSched110Problem(): TimetableProblem {
    const base = buildFixtureProblem();
    const req = (
      classId: string,
      subjectId: string,
      teacherId: string,
      hours: number,
    ): TimetableRequirement => ({
      classId,
      subjectId,
      teacherId,
      weeklyHours: hours,
      consecutivePeriods: 1,
      requiredRoomType: null,
      className: classId,
      subjectName: subjectId,
      teacherName: null,
      classSize: 30,
    });
    return {
      ...base,
      classes: [
        ...base.classes,
        { id: "cls-a", code: "A", name: "Classe A", capacity: 30 },
        { id: "cls-b", code: "B", name: "Classe B", capacity: 30 },
        { id: "cls-z", code: "Z", name: "Classe Z", capacity: 30 },
      ],
      requirements: [
        req("cls-a", "sub-a", "tch-math", 3),
        req("cls-a", "sub-y", "tch-fr", 26),
        req("cls-b", "sub-w", "tch-math", 21),
        req("cls-b", "sub-z", "tch-arab", 2),
        req("cls-z", "sub-v", "tch-phys", 28),
        req("cls-z", "sub-x", "tch-math", 2),
      ],
      constraints: [
        ...base.constraints.filter((c) => c.id !== "c-free-1as-wed"),
        constraint("c-free-b-monday", "class", "cls-b", "free_day", "hard", {
          day: "monday",
        }),
      ],
    };
  }

  it("the eviction repair rescues the no-free-slot corner (SCHED-110)", () => {
    const events: string[] = [];
    const solution = solver.solve(buildSched110Problem(), {
      onProgress: (p) => events.push(p.message),
    });
    // The repair pass RAN with ≥ 1 unplaced block (the greedy pass failed)…
    expect(
      events.some((m) => /Réparation \/ optimisation — [1-9]/.test(m)),
    ).toBe(true);
    // …and the eviction still produced a COMPLETE, conflict-free schedule.
    expect(solution.status).toBe("valid");
    expect(solution.unplaced).toHaveLength(0);
    // Total demand: 3+26+21+2+28+2 = 82 periods across the three classes.
    expect(solution.statistics.placedPeriods).toBe(82);
    expect(noResourceClashes(solution.entries)).toBe(true);
  });

  it("the same corner with the teacher's Monday gone: honest partial, never a conflict", () => {
    const problem = buildSched110Problem();
    // cls-a needs 29 slots with the teacher losing Monday entirely
    // (24 slots) → provably impossible for the shared subjects — the
    // solver reports honestly (unplaced + reasons) and NEVER conflicts.
    const constrained: TimetableProblem = {
      ...problem,
      requirements: problem.requirements.map((r) =>
        r.classId === "cls-a" ? { ...r, weeklyHours: 28 } : r,
      ),
      constraints: [
        ...problem.constraints,
        constraint("c-math-monday", "teacher", "tch-math", "free_day", "hard", {
          day: "monday",
        }),
      ],
    };
    const solution = solver.solve(constrained);
    if (solution.unplaced.length > 0) {
      expect(solution.status).not.toBe("valid");
      for (const u of solution.unplaced) {
        expect(u.reason.length).toBeGreaterThan(10);
      }
      expect(noResourceClashes(solution.entries)).toBe(true);
      // The solution NEVER fabricates: no hard violation except the honest
      // unmet hours of the unplaced blocks themselves.
      const hard = validateTimetable(constrained, solution.entries).filter(
        (v) => v.severity === "hard" && v.kind !== "unmet_weekly_hours",
      );
      expect(hard).toHaveLength(0);
    } else {
      expect(solution.status).toBe("valid");
    }
  });

  it("deterministically identical across runs at the corner (x3)", () => {
    const key = (e: TimetableSlotAssignment) =>
      `${e.classId}|${e.day}|${e.periodIndex}|${e.teacherId}|${e.roomId}|${e.lessonGroup}`;
    const a = solver.solve(buildSched110Problem()).entries.map(key).sort().join(";");
    const b = solver.solve(buildSched110Problem()).entries.map(key).sort().join(";");
    const c = solver.solve(buildSched110Problem()).entries.map(key).sort().join(";");
    expect(b).toBe(a);
    expect(c).toBe(a);
  });
});

// ============================================================================
// First / last period boundaries
// ============================================================================

describe("T-441 — first/last period boundaries", () => {
  it("places a lesson in the FIRST period when it is the only open slot", () => {
    const base = buildFixtureProblem();
    const periods = teachingPeriods(base.configuration);
    const first = periods[0].index;
    const last = periods[periods.length - 1].index;
    // Block every teaching slot of cls-2as-a EXCEPT (sunday, first period)
    // via hard class unavailability — the single remaining slot.
    const blockers: TimetableConstraint[] = [];
    let n = 0;
    for (const day of base.configuration.schoolDays) {
      for (const p of periods) {
        if (day === "sunday" && p.index === first) continue;
        blockers.push(
          constraint(
            `c-block-${n++}`,
            "class",
            "cls-2as-a",
            "unavailable_period",
            "hard",
            { day, periodIndex: p.index },
          ),
        );
      }
    }
    const problem: TimetableProblem = {
      ...base,
      requirements: [
        {
          ...base.requirements[0],
          classId: "cls-2as-a",
          className: "2ème AS — Section A",
          weeklyHours: 1,
        },
      ],
      constraints: [...base.constraints, ...blockers],
    };
    const solution = solver.solve(problem);
    expect(solution.status).toBe("valid");
    expect(solution.unplaced).toHaveLength(0);
    expect(solution.entries).toHaveLength(1);
    expect(solution.entries[0].day).toBe("sunday");
    expect(solution.entries[0].periodIndex).toBe(first);
    void last;
  });

  it("places a lesson in the LAST period when it is the only open slot", () => {
    const base = buildFixtureProblem();
    const periods = teachingPeriods(base.configuration);
    const first = periods[0].index;
    const last = periods[periods.length - 1].index;
    const blockers: TimetableConstraint[] = [];
    let n = 0;
    for (const day of base.configuration.schoolDays) {
      for (const p of periods) {
        if (day === "thursday" && p.index === last) continue;
        blockers.push(
          constraint(
            `c-block-${n++}`,
            "class",
            "cls-2as-a",
            "unavailable_period",
            "hard",
            { day, periodIndex: p.index },
          ),
        );
      }
    }
    const problem: TimetableProblem = {
      ...base,
      requirements: [
        {
          ...base.requirements[0],
          classId: "cls-2as-a",
          className: "2ème AS — Section A",
          weeklyHours: 1,
        },
      ],
      constraints: [...base.constraints, ...blockers],
    };
    const solution = solver.solve(problem);
    expect(solution.status).toBe("valid");
    expect(solution.entries).toHaveLength(1);
    expect(solution.entries[0].day).toBe("thursday");
    expect(solution.entries[0].periodIndex).toBe(last);
  });

  it("never places outside the configured periods on any boundary stress", () => {
    const base = buildFixtureProblem();
    const validPeriods = new Set(
      teachingPeriods(base.configuration).map((p) => p.index),
    );
    const schoolDays = new Set(base.configuration.schoolDays);
    const solution = solver.solve(buildFixtureProblem());
    for (const e of solution.entries) {
      expect(validPeriods.has(e.periodIndex)).toBe(true);
      expect(schoolDays.has(e.day)).toBe(true);
    }
  });
});

// ============================================================================
// Only one slot left (the whole week blocked except one period)
// ============================================================================

describe("T-441 — only one slot left", () => {
  it("succeeds when exactly one legal slot exists for the entire problem", () => {
    const base = buildFixtureProblem();
    const periods = teachingPeriods(base.configuration);
    // Teacher tch-fr may ONLY work (tuesday, period 4) — one subject,
    // one hour, one class (cls-2as-a — no free day in the fixture).
    const blockers: TimetableConstraint[] = [];
    let n = 0;
    for (const day of base.configuration.schoolDays) {
      for (const p of periods) {
        if (day === "tuesday" && p.index === 4) continue;
        blockers.push(
          constraint(
            `c-fr-${n++}`,
            "teacher",
            "tch-fr",
            "unavailable_period",
            "hard",
            { day, periodIndex: p.index },
          ),
        );
      }
    }
    const problem: TimetableProblem = {
      ...base,
      requirements: [
        {
          ...base.requirements[0],
          classId: "cls-2as-a",
          subjectId: "sub-fr",
          className: "2ème AS — Section A",
          subjectName: "Langue française",
          teacherId: "tch-fr",
          weeklyHours: 1,
        },
      ],
      constraints: [...base.constraints, ...blockers],
    };
    const solution = solver.solve(problem);
    expect(solution.status).toBe("valid");
    expect(solution.entries).toHaveLength(1);
    expect(solution.entries[0].day).toBe("tuesday");
    expect(solution.entries[0].periodIndex).toBe(4);
    expect(solution.entries[0].teacherId).toBe("tch-fr");
  });
});

// ============================================================================
// Single-class regeneration (the solver contract)
// ============================================================================

describe("T-441 — single-class regeneration (carried entries)", () => {
  it("regenerates ONE class without ever conflicting with the carried school", () => {
    const base = buildFixtureProblem();
    // Round 1: the whole school.
    const school = solver.solve(base);
    expect(school.status).toBe("valid");

    // Round 2: regenerate ONLY cls-1as-a, carrying 2AS-A + 3AS-A.
    const carried = school.entries.filter((e) => e.classId !== "cls-1as-a");
    const partial = solver.solve({
      ...base,
      carriedEntries: carried,
      regenerateClassIds: ["cls-1as-a"],
    });

    expect(partial.status).toBe("valid");
    expect(partial.unplaced).toHaveLength(0);
    // The carried entries are returned UNCHANGED.
    const carriedBack = partial.entries.filter((e) => e.classId !== "cls-1as-a");
    expect(carriedBack.length).toBe(carried.length);
    const key = (e: TimetableSlotAssignment) =>
      `${e.classId}|${e.subjectId}|${e.day}|${e.periodIndex}|${e.teacherId}|${e.roomId}|${e.lessonGroup}`;
    expect(carriedBack.map(key).sort()).toEqual(carried.map(key).sort());
    // No resource clash across the WHOLE new version.
    expect(noResourceClashes(partial.entries)).toBe(true);
    // The regenerated class is fully covered (its own entries, fresh slots).
    const own = partial.entries.filter((e) => e.classId === "cls-1as-a");
    const gaps = coverageGaps(
      { ...base, requirements: base.requirements.filter((r) => r.classId === "cls-1as-a") },
      own,
    );
    expect(gaps).toHaveLength(0);
    // Lesson-group ordinals: fresh groups never REUSE a carried group (a
    // multi-period block legitimately shares ONE group across its rows).
    const carriedGroups = new Set(carried.map((e) => e.lessonGroup));
    for (const e of partial.entries.filter((x) => x.classId === "cls-1as-a")) {
      expect(carriedGroups.has(e.lessonGroup)).toBe(false);
    }
    // Each lesson group is ONE coherent block (single class + subject).
    const groupOwner = new Map<number, string>();
    for (const e of partial.entries) {
      const owner = `${e.classId}|${e.subjectId}`;
      expect(groupOwner.get(e.lessonGroup) ?? owner).toBe(owner);
      groupOwner.set(e.lessonGroup, owner);
    }
  });

  it("lesson-group ordinals never collide with LOCKED pins either", () => {
    const base = buildFixtureProblem();
    const school = solver.solve(base);
    const pinnedEntry = school.entries[0];
    const partial = solver.solve({
      ...base,
      lockedEntries: [
      {
          classId: pinnedEntry.classId,
          subjectId: pinnedEntry.subjectId,
          teacherId: pinnedEntry.teacherId,
          roomId: pinnedEntry.roomId,
          day: pinnedEntry.day,
          periodIndex: pinnedEntry.periodIndex,
          lessonGroup: 999_999,
        },
      ],
    });
    // No fresh group reuses the pin's ordinal, and every group is coherent.
    const groupOwner = new Map<number, string>();
    for (const e of partial.entries) {
      const owner = `${e.classId}|${e.subjectId}`;
      expect(groupOwner.get(e.lessonGroup) ?? owner).toBe(owner);
      groupOwner.set(e.lessonGroup, owner);
    }
    // The pin is present, unchanged.
    const pin = partial.entries.find((e) => e.lessonGroup === 999_999);
    expect(pin).toBeDefined();
    expect(pin?.day).toBe(pinnedEntry.day);
    expect(pin?.periodIndex).toBe(pinnedEntry.periodIndex);
  });

  it("full-problem validation covers the carried classes too (no hiding holes)", () => {
    const base = buildFixtureProblem();
    const school = solver.solve(base);
    // Sabotage: carry only HALF of cls-2as-a's entries — the full-problem
    // validation MUST flag the coverage gap (unmet weekly hours), because
    // validateTimetable sees EVERY requirement of the problem.
    const carried = school.entries.filter(
      (e) => e.classId === "cls-2as-a",
    );
    expect(carried.length).toBeGreaterThan(0);
    const partial = solver.solve({
      ...base,
      requirements: base.requirements.filter((r) => r.classId === "cls-1as-a"),
      carriedEntries: carried.slice(0, Math.floor(carried.length / 2)),
      regenerateClassIds: ["cls-1as-a"],
    });
    // The regenerated class is fine…
    expect(partial.unplaced).toHaveLength(0);
    // …but validating against the FULL requirement set exposes the hole.
    const hardAgainstFull = validateTimetable(
      {
        ...base,
        requirements: base.requirements.filter(
          (r) => r.classId !== "cls-1as-a",
        ),
      },
      partial.entries,
    ).filter((v) => v.kind === "unmet_weekly_hours");
    expect(hardAgainstFull.length).toBeGreaterThan(0);
  });

  it("the pinned corner: locked pins survive regeneration and the school still fully places", () => {
    const base = buildFixtureProblem();
    const school = solver.solve(base);
    // Pin a FEW of cls-1as-a's entries (the documented semantics: manual
    // pins keep their slots; requirements re-place around them).
    const pins = school.entries
      .filter((e) => e.classId === "cls-1as-a")
      .slice(0, 3)
      .map((e) => ({ ...e, lessonGroup: 1000 + e.lessonGroup }));
    const regen = solver.solve({ ...base, lockedEntries: pins });
    expect(regen.status).toBe("valid");
    expect(regen.unplaced).toHaveLength(0);
    // All pins survive exactly.
    for (const pin of pins) {
      const kept = regen.entries.find(
        (e) =>
          e.classId === pin.classId &&
          e.subjectId === pin.subjectId &&
          e.day === pin.day &&
          e.periodIndex === pin.periodIndex,
      );
      expect(kept).toBeDefined();
    }
    expect(noResourceClashes(regen.entries)).toBe(true);
  });
});

// ============================================================================
// The eviction never overlays pins (the immovable contract)
// ============================================================================

describe("T-441 — eviction respects pins", () => {
  it("never moves a LOCKED or CARRIED entry to make room", () => {
    const base = buildFixtureProblem();
    const school = solver.solve(base);
    // The carried entries of cls-2as-a at their exact slots.
    const carried = school.entries.filter((e) => e.classId === "cls-2as-a");
    const carriedKey = (e: TimetableSlotAssignment) =>
      `${e.day}|${e.periodIndex}|${e.teacherId}|${e.roomId}`;
    const before = new Map(
      carried.map((e) => [`${e.subjectId}|${e.day}|${e.periodIndex}`, carriedKey(e)]),
    );
    const partial = solver.solve({
      ...base,
      carriedEntries: carried,
      regenerateClassIds: ["cls-1as-a"],
    });
    const after = partial.entries.filter((e) => e.classId === "cls-2as-a");
    expect(after.length).toBe(carried.length);
    for (const e of after) {
      const original = before.get(`${e.subjectId}|${e.day}|${e.periodIndex}`);
      expect(original).toBeDefined();
      expect(`${e.day}|${e.periodIndex}|${e.teacherId}|${e.roomId}`).toBe(original);
    }
  });
});
