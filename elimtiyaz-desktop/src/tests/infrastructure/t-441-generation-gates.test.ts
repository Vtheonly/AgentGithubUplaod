// ============================================================================
// FILE: src/tests/infrastructure/t-441-generation-gates.test.ts
// ============================================================================
/**
 * T-441 — the generation gates at the repository level (the mock twin,
 * which consumes the REAL solver registry + REAL canonical validator —
 * only persistence differs from production):
 *
 *   GATE 1 — feasibility pre-analysis: mathematically impossible
 *            constraints fail with PRECISE numbered reasons, and NOTHING
 *            is persisted (no version, no entries).
 *   GATE 2 — fail-closed persistence: a feasible problem the solver cannot
 *            complete NEVER produces a partial draft version.
 *   GATE 3 — the independent post-persist validation layer.
 *   MODES  — whole-school generation AND single-class regeneration (the
 *            carried reference is immovable; the regenerated classes can
 *            never conflict with it).
 *   HYGIENE — repeated regeneration never accumulates versions/entries
 *            behind failed runs; one generation = one complete version.
 */

import { describe, expect, it } from "vitest";
import { MockTimetableRepository } from "../../infrastructure/mock/repositories/timetable-repository";
import { buildFixtureProblem } from "../../domain/calc/timetable/fixture";
import { validateTimetable, coverageGaps } from "../../domain/calc/timetable/constraints";
import { slotAssignmentFromEntry } from "../../domain/model/timetable";
import type { TimetableProblem } from "../../domain/model/timetable";

const ACTOR = { actorId: "actor-t441", actorName: "T-441 Actor" };
const YEAR = "year-t441-gates";

function fixture(): TimetableProblem {
  return buildFixtureProblem();
}

async function versionsOf(repo: MockTimetableRepository): Promise<
  import("../../domain/model/timetable").TimetableVersion[]
> {
  return new Promise((resolve) => {
    repo.observeVersions(YEAR).subscribe((v) => resolve(v));
  });
}

async function entriesOf(
  repo: MockTimetableRepository,
  versionId: string,
): Promise<import("../../domain/model/timetable").TimetableScheduleEntry[]> {
  return new Promise((resolve) => {
    repo.observeEntries(versionId).subscribe((e) => resolve(e));
  });
}

// ============================================================================
// GATE 1 — the feasibility pre-analysis (explicit, precise, fail-closed)
// ============================================================================

describe("T-441 Gate 1 — feasibility pre-analysis (repository level)", () => {
  it("REFUSES an impossible teacher load with numbered precise reasons", async () => {
    const repo = new MockTimetableRepository();
    const problem = fixture();
    const impossible: TimetableProblem = {
      ...problem,
      requirements: [
        {
          ...problem.requirements[0],
          classId: "cls-1as-a",
          teacherId: "tch-math",
          weeklyHours: 28,
        },
        {
          ...problem.requirements[0],
          classId: "cls-2as-a",
          teacherId: "tch-math",
          weeklyHours: 28,
        },
      ],
    };
    const result = await repo.generateTimetable(
      { academicYearId: YEAR },
      ACTOR,
      impossible,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain(
      "Génération impossible — les contraintes sont mathématiquement irréalisables",
    );
    expect(result.error.message).toContain("1. ");
    expect(result.error.message).toContain("56 périodes/semaine");
    // FAIL-CLOSED: nothing persisted.
    expect(await versionsOf(repo)).toHaveLength(0);
  });

  it("REFUSES a missing room type before any solving", async () => {
    const repo = new MockTimetableRepository();
    const problem: TimetableProblem = {
      ...fixture(),
      rooms: fixture().rooms.filter((r) => r.roomType !== "science_lab"),
    };
    const result = await repo.generateTimetable(
      { academicYearId: YEAR },
      ACTOR,
      problem,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain(
      "aucune salle active de ce type n'est configurée",
    );
    expect(await versionsOf(repo)).toHaveLength(0);
  });

  it("REFUSES an all-free school week with the precise reason", async () => {
    const repo = new MockTimetableRepository();
    const problem = fixture();
    const allFree = [
      "sunday",
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
    ].map((day) => ({
      id: `c-${day}`,
      tenantId: "t",
      academicYearId: YEAR,
      scope: "school" as const,
      entityId: null,
      kind: "free_day" as const,
      severity: "hard" as const,
      params: { day },
      isActive: true,
      createdAt: "",
      updatedAt: "",
    }));
    const result = await repo.generateTimetable(
      { academicYearId: YEAR },
      ACTOR,
      { ...problem, constraints: [...problem.constraints, ...allFree] },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain(
      "jours libres au niveau de l'établissement",
    );
    expect(await versionsOf(repo)).toHaveLength(0);
  });
});

// ============================================================================
// GATE 2 — fail-closed persistence (never a partial/invalid version)
// ============================================================================

describe("T-441 Gate 2 — fail-closed persistence", () => {
  it("REFUSES to persist a draft when the solver cannot complete the schedule", async () => {
    const repo = new MockTimetableRepository();
    const problem = fixture();
    // Feasible per the necessary conditions, but tight enough that the
    // greedy+eviction still cannot place everything: cls-1as-a at 29/30
    // with its own dedicated teacher fully booked around it.
    const hard: TimetableProblem = {
      ...problem,
      requirements: [
        {
          ...problem.requirements[0],
          classId: "cls-1as-a",
          teacherId: "tch-math",
          weeklyHours: 29,
        },
        {
          ...problem.requirements[0],
          classId: "cls-1as-a",
          subjectId: "sub-phys",
          teacherId: "tch-phys",
          weeklyHours: 2,
          requiredRoomType: "science_lab",
          consecutivePeriods: 2,
        },
      ],
      constraints: problem.constraints.filter((c) => c.id !== "c-free-1as-wed"),
    };
    // Make the teacher unavailable at 2 of the class's 30 slots → 28 slots
    // for 29 periods → infeasible.
    const blockers = [
      { day: "sunday", periodIndex: 5 },
      { day: "sunday", periodIndex: 6 },
    ].map(({ day, periodIndex }, i) => ({
      id: `c-blk-${i}`,
      tenantId: "t",
      academicYearId: YEAR,
      scope: "teacher" as const,
      entityId: "tch-math",
      kind: "unavailable_period" as const,
      severity: "hard" as const,
      params: { day, periodIndex },
      isActive: true,
      createdAt: "",
      updatedAt: "",
    }));
    const result = await repo.generateTimetable(
      { academicYearId: YEAR },
      ACTOR,
      { ...hard, constraints: [...hard.constraints, ...blockers] },
    );
    if (result.ok) {
      // If the solver DID find a complete schedule, it must be valid.
      expect(result.value.unplacedCount).toBe(0);
    } else {
      expect(result.error.message).toContain("Génération impossible");
      expect(result.error.message).toMatch(/\d+\.\s/);
    }
    // FAIL-CLOSED either way: only complete versions exist.
    const versions = await versionsOf(repo);
    for (const v of versions) {
      expect(v.unplacedCount).toBe(0);
      expect(v.hardViolationCount).toBe(0);
    }
  });

  it("the known-good problem persists a COMPLETE draft (Gate 2 opens)", async () => {
    const repo = new MockTimetableRepository();
    const result = await repo.generateTimetable(
      { academicYearId: YEAR },
      ACTOR,
      fixture(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.unplacedCount).toBe(0);
    expect(result.value.hardViolationCount).toBe(0);
    const entries = await entriesOf(repo, result.value.id);
    expect(entries.length).toBe(48);
    // Every persisted row passes the canonical validator + coverage.
    const slots = entries.map(slotAssignmentFromEntry);
    expect(
      validateTimetable(fixture(), slots).filter((v) => v.severity === "hard"),
    ).toHaveLength(0);
    expect(coverageGaps(fixture(), slots)).toHaveLength(0);
  });
});

// ============================================================================
// MODES — whole-school generation + single-class regeneration
// ============================================================================

describe("T-441 — single-class regeneration (repository level)", () => {
  it("generates the whole school, then ONE class, with ZERO cross-class conflicts", async () => {
    const repo = new MockTimetableRepository();
    const problem = fixture();

    // Round 1: the whole school.
    const v1 = await repo.generateTimetable(
      { academicYearId: YEAR, label: "school" },
      ACTOR,
      problem,
    );
    expect(v1.ok).toBe(true);
    if (!v1.ok) return;
    await repo.submitForReview(v1.value.id, ACTOR);
    await repo.approveVersion(v1.value.id, ACTOR);
    const pub = await repo.publishVersion(v1.value.id, ACTOR);
    expect(pub.ok).toBe(true);
    if (!pub.ok) return;

    // Round 2: regenerate ONLY cls-1as-a (no fromVersionId → the published
    // version is the immovable reference).
    const v2 = await repo.generateTimetable(
      { academicYearId: YEAR, label: "1AS-A only", classIds: ["cls-1as-a"] },
      ACTOR,
      problem,
    );
    expect(v2.ok).toBe(true);
    if (!v2.ok) return;

    const v2Entries = await entriesOf(repo, v2.value.id);
    const v1Entries = await entriesOf(repo, v1.value.id);

    // The new version is a COMPLETE school snapshot: the other classes'
    // entries are carried over byte-identical…
    const key = (e: import("../../domain/model/timetable").TimetableScheduleEntry) =>
      `${e.classId}|${e.subjectId}|${e.day}|${e.periodIndex}|${e.teacherId}|${e.roomId}|${e.lessonGroup}`;
    const othersV1 = v1Entries
      .filter((e) => e.classId !== "cls-1as-a")
      .map(key)
      .sort();
    const othersV2 = v2Entries
      .filter((e) => e.classId !== "cls-1as-a")
      .map(key)
      .sort();
    expect(othersV2).toEqual(othersV1);

    // …and the regenerated class is fully re-placed.
    const own = v2Entries.filter((e) => e.classId === "cls-1as-a");
    expect(own.length).toBe(16);
    expect(coverageGaps(problem, v2Entries.map(slotAssignmentFromEntry))).toHaveLength(0);

    // ZERO hard violations across the WHOLE new version (the canonical
    // validator over the full problem: teacher AND room AND class clashes,
    // free days, unavailability, room fit, weekly hours).
    const slots2 = v2Entries.map(slotAssignmentFromEntry);
    expect(
      validateTimetable(problem, slots2).filter((v) => v.severity === "hard"),
    ).toHaveLength(0);

    // The generation params record the scope.
    expect(v2.value.generationParams).toMatchObject({
      classIds: ["cls-1as-a"],
      carriedEntries: othersV1.length,
      feasibilityChecked: true,
    });
  });

  it("single-class regen never double-books the shared teacher against the reference", async () => {
    const repo = new MockTimetableRepository();
    const problem = fixture();
    const v1 = await repo.generateTimetable(
      { academicYearId: YEAR },
      ACTOR,
      problem,
    );
    expect(v1.ok).toBe(true);
    if (!v1.ok) return;
    await repo.submitForReview(v1.value.id, ACTOR);
    await repo.approveVersion(v1.value.id, ACTOR);
    await repo.publishVersion(v1.value.id, ACTOR);

    // Regenerate EVERY class one after the other (each against the
    // published reference).
    for (const classId of ["cls-1as-a", "cls-2as-a", "cls-3as-a"]) {
      const vk = await repo.generateTimetable(
        { academicYearId: YEAR, classIds: [classId] },
        ACTOR,
        problem,
      );
      expect(vk.ok).toBe(true);
      if (!vk.ok) return;
      const entries = (await entriesOf(repo, vk.value.id)).map(
        slotAssignmentFromEntry,
      );
      expect(
        validateTimetable(problem, entries).filter((v) => v.severity === "hard"),
      ).toHaveLength(0);
      expect(coverageGaps(problem, entries)).toHaveLength(0);
    }
  });

  it("REFUSES an unknown class id in the scope", async () => {
    const repo = new MockTimetableRepository();
    const result = await repo.generateTimetable(
      { academicYearId: YEAR, classIds: ["cls-does-not-exist"] },
      ACTOR,
      fixture(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("Classes inconnues");
  });

  it("locked pins of the SELECTED class survive single-class regeneration", async () => {
    const repo = new MockTimetableRepository();
    const problem = fixture();
    const v1 = await repo.generateTimetable(
      { academicYearId: YEAR },
      ACTOR,
      problem,
    );
    expect(v1.ok).toBe(true);
    if (!v1.ok) return;
    const v1Entries = await entriesOf(repo, v1.value.id);
    const pin = v1Entries.find((e) => e.classId === "cls-2as-a");
    expect(pin).toBeDefined();
    if (!pin) return;
    await repo.setEntryLocked(pin.id, true, ACTOR);

    const v2 = await repo.generateTimetable(
      { academicYearId: YEAR, classIds: ["cls-2as-a"], fromVersionId: v1.value.id },
      ACTOR,
      problem,
    );
    expect(v2.ok).toBe(true);
    if (!v2.ok) return;
    const v2Entries = await entriesOf(repo, v2.value.id);
    const kept = v2Entries.find(
      (e) =>
        e.classId === pin.classId &&
        e.subjectId === pin.subjectId &&
        e.day === pin.day &&
        e.periodIndex === pin.periodIndex,
    );
    expect(kept).toBeDefined();
    expect(kept?.isLocked).toBe(true);
    expect(kept?.source).toBe("manual");
  });
});

// ============================================================================
// HYGIENE — repeated regeneration never accumulates broken state
// ============================================================================

describe("T-441 — regeneration hygiene (no accumulation)", () => {
  it("regenerating x3 leaves exactly the labeled versions, every one complete", async () => {
    const repo = new MockTimetableRepository();
    const problem = fixture();
    // (The mock store is a module-level singleton shared across repository
    // instances — scope the count by THIS test's unique label.)
    const LABEL = "regen-x3";
    for (let i = 0; i < 3; i++) {
      const v = await repo.generateTimetable(
        { academicYearId: YEAR, label: LABEL },
        ACTOR,
        problem,
      );
      expect(v.ok).toBe(true);
      if (!v.ok) return;
      expect(v.value.unplacedCount).toBe(0);
      expect(v.value.hardViolationCount).toBe(0);
    }
    const versions = (await versionsOf(repo)).filter((v) => v.label === LABEL);
    expect(versions).toHaveLength(3);
    // No duplicate lesson groups within any version; no cross-version leaks.
    for (const v of versions) {
      const entries = await entriesOf(repo, v.id);
      const owners = new Map<number, string>();
      for (const e of entries) {
        const owner = `${e.classId}|${e.subjectId}`;
        expect(owners.get(e.lessonGroup) ?? owner).toBe(owner);
        owners.set(e.lessonGroup, owner);
      }
    }
    // THE GLOBAL FAIL-CLOSED INVARIANT: every version the store has EVER
    // persisted (including other tests') is complete and conflict-free.
    for (const v of await versionsOf(repo)) {
      expect(v.unplacedCount).toBe(0);
      expect(v.hardViolationCount).toBe(0);
    }
  });

  it("a failed generation persists NOTHING (the fail-closed audit)", async () => {
    const repo = new MockTimetableRepository();
    const problem = fixture();
    // 1. A successful generation.
    const ok1 = await repo.generateTimetable({ academicYearId: YEAR }, ACTOR, problem);
    expect(ok1.ok).toBe(true);
    const before = (await versionsOf(repo)).length;

    // 2. A FAILED generation (infeasible).
    const bad: TimetableProblem = {
      ...problem,
      requirements: [
        {
          ...problem.requirements[0],
          classId: "cls-1as-a",
          teacherId: "tch-math",
          weeklyHours: 28,
        },
        {
          ...problem.requirements[0],
          classId: "cls-2as-a",
          teacherId: "tch-math",
          weeklyHours: 28,
        },
      ],
    };
    const failed = await repo.generateTimetable({ academicYearId: YEAR }, ACTOR, bad);
    expect(failed.ok).toBe(false);

    // 3. The failed run left no version behind.
    expect(await versionsOf(repo)).toHaveLength(before);
  });
});
