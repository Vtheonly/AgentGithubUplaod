// ============================================================================
// FILE: src/tests/infrastructure/t-404-timetable-repository.test.ts
// ============================================================================
/**
 * T-404 — the TimetableRepository workflow tests (mock implementation,
 * which consumes the REAL solver registry + the REAL canonical validator —
 * only persistence differs from production):
 *   generation → review → approve → publish (with the atomic archive of the
 *   previously published version), duplicate-to-draft for adjustments,
 *   manual moves accepted/rejected by LIVE validation, and the immutability
 *   of published versions.
 */

import { describe, expect, it } from "vitest";
import {
  mockTimetableRepository,
  MockTimetableRepository,
} from "../../infrastructure/mock/repositories/timetable-repository";
import { buildFixtureProblem } from "../../domain/calc/timetable/fixture";
import type { TimetableProblem } from "../../domain/model/timetable";

const ACTOR = { actorId: "actor-1", actorName: "Test Actor" };
const YEAR = "year-t404-fixture";

function fixtureProblemForRepository(): TimetableProblem {
  // The repository's mock store needs the fixture's classes/teachers/
  // requirements registered per academic year (the Supabase side loads the
  // same shape from the canonical tables).
  const problem = buildFixtureProblem();
  return problem;
}

describe("T-404 — TimetableRepository generation + workflow (mock)", () => {
  it("generates a draft version with solver stamps and full statistics", async () => {
    const repo = new MockTimetableRepository();
    const problem = fixtureProblemForRepository();
    const result = await repo.generateTimetable(
      { academicYearId: YEAR },
      ACTOR,
      problem,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const version = result.value;
    expect(version.status).toBe("draft");
    expect(version.solverId).toBe("ts-greedy-v1");
    expect(version.solverBuild).toMatch(/^v/);
    expect(version.unplacedCount).toBe(0);
    expect(version.hardViolationCount).toBe(0);
    expect(version.createdByName).toBe(ACTOR.actorName);
  });

  it("walks draft → in_review → approved → published with stamps", async () => {
    const repo = new MockTimetableRepository();
    const problem = fixtureProblemForRepository();
    const gen = await repo.generateTimetable({ academicYearId: YEAR }, ACTOR, problem);
    expect(gen.ok).toBe(true);
    if (!gen.ok) return;
    const id = gen.value.id;

    const reviewed = await repo.submitForReview(id, ACTOR, "prêt pour révision");
    expect(reviewed.ok && reviewed.value.status).toBe("in_review");

    const approved = await repo.approveVersion(id, ACTOR);
    expect(approved.ok && approved.value.status).toBe("approved");

    const published = await repo.publishVersion(id, ACTOR);
    expect(published.ok && published.value.status).toBe("published");
    if (!published.ok) return;
    expect(published.value.publishedAt).toBeTruthy();
  });

  it("REJECTS publishing a draft (review → approve → publish order)", async () => {
    const repo = new MockTimetableRepository();
    const problem = fixtureProblemForRepository();
    const gen = await repo.generateTimetable({ academicYearId: YEAR }, ACTOR, problem);
    expect(gen.ok).toBe(true);
    if (!gen.ok) return;
    const result = await repo.publishVersion(gen.value.id, ACTOR);
    expect(result.ok).toBe(false);
  });

  it("archives the previously published version when publishing a new one", async () => {
    const repo = new MockTimetableRepository();
    const problem = fixtureProblemForRepository();
    const v1 = await repo.generateTimetable(
      { academicYearId: YEAR, label: "v1" },
      ACTOR,
      problem,
    );
    expect(v1.ok).toBe(true);
    if (!v1.ok) return;
    await repo.submitForReview(v1.value.id, ACTOR);
    await repo.approveVersion(v1.value.id, ACTOR);
    await repo.publishVersion(v1.value.id, ACTOR);

    const v2 = await repo.generateTimetable(
      { academicYearId: YEAR, label: "v2" },
      ACTOR,
      problem,
    );
    expect(v2.ok).toBe(true);
    if (!v2.ok) return;
    await repo.submitForReview(v2.value.id, ACTOR);
    await repo.approveVersion(v2.value.id, ACTOR);
    const published = await repo.publishVersion(v2.value.id, ACTOR);
    expect(published.ok).toBe(true);

    // v1 must now be archived (the one-published invariant).
    const versions = await new Promise<
      Awaited<ReturnType<typeof collectVersions>>
    >((resolve) => resolve(collectVersions(repo)));
    expect(versions.find((v) => v.label === "v1")?.status).toBe("archived");
    expect(versions.find((v) => v.label === "v2")?.status).toBe("published");
  });

  it("duplicates a published version to an editable draft and allows a manual move", async () => {
    const repo = new MockTimetableRepository();
    const problem = fixtureProblemForRepository();
    const gen = await repo.generateTimetable({ academicYearId: YEAR }, ACTOR, problem);
    expect(gen.ok).toBe(true);
    if (!gen.ok) return;
    await repo.submitForReview(gen.value.id, ACTOR);
    await repo.approveVersion(gen.value.id, ACTOR);
    await repo.publishVersion(gen.value.id, ACTOR);

    const copy = await repo.duplicateVersionToDraft(gen.value.id, ACTOR);
    expect(copy.ok).toBe(true);
    if (!copy.ok) return;
    expect(copy.value.status).toBe("draft");

    const entries = await collectEntries(repo, copy.value.id);
    expect(entries.length).toBeGreaterThan(0);
    const first = entries[0];

    // LIVE VALIDATION: moving a published-version entry must be REFUSED…
    const publishedEntries = await collectEntries(repo, gen.value.id);
    const blockedMove = await repo.moveEntry(
      publishedEntries[0].id,
      { day: "monday", periodIndex: 1 },
      ACTOR,
      problem,
    );
    expect(blockedMove.ok).toBe(false);

    // …but the same move on the DRAFT copy must pass (find a slot free for
    // the class AND the teacher AND the room — the live validation checks
    // every resource).
    const days = problem.configuration.schoolDays;
    const periods = problem.configuration.periods.map((p) => p.index);
    const slotBusy = (day: string, p: number): boolean =>
      entries.some(
        (e) =>
          e.id !== first.id &&
          e.day === day &&
          e.periodIndex === p &&
          (e.classId === first.classId ||
            (first.teacherId != null && e.teacherId === first.teacherId) ||
            (first.roomId != null && e.roomId === first.roomId)),
      );
    let freeDay = days[0];
    let freePeriod = periods[0];
    outer: for (const day of days) {
      for (const p of periods) {
        if (!slotBusy(day, p)) {
          freeDay = day;
          freePeriod = p;
          break outer;
        }
      }
    }
    const moved = await repo.moveEntry(
      first.id,
      { day: freeDay, periodIndex: freePeriod },
      ACTOR,
      problem,
    );
    expect(moved.ok).toBe(true);
    if (moved.ok) {
      expect(moved.value.day).toBe(freeDay);
      expect(moved.value.isLocked).toBe(true);
      expect(moved.value.source).toBe("manual");
    }
  });

  it("REFUSES a manual move that creates a hard conflict (live validation)", async () => {
    const repo = new MockTimetableRepository();
    const problem = fixtureProblemForRepository();
    const gen = await repo.generateTimetable({ academicYearId: YEAR }, ACTOR, problem);
    expect(gen.ok).toBe(true);
    if (!gen.ok) return;
    const entries = await collectEntries(repo, gen.value.id);
    const a = entries[0];
    // Move a onto b's slot → class double-booking → must be refused.
    const b = entries.find(
      (e) => e.classId === a.classId && e.id !== a.id,
    );
    expect(b).toBeDefined();
    if (!b) return;
    const refused = await repo.moveEntry(
      a.id,
      { day: b.day, periodIndex: b.periodIndex },
      ACTOR,
      problem,
    );
    expect(refused.ok).toBe(false);
  });

  it("regenerates from a version keeping its locked pins", async () => {
    const repo = new MockTimetableRepository();
    const problem = fixtureProblemForRepository();
    const gen = await repo.generateTimetable({ academicYearId: YEAR }, ACTOR, problem);
    expect(gen.ok).toBe(true);
    if (!gen.ok) return;
    const entries = await collectEntries(repo, gen.value.id);
    const pinned = entries[0];
    await repo.setEntryLocked(pinned.id, true, ACTOR);

    const regen = await repo.generateTimetable(
      { academicYearId: YEAR, fromVersionId: gen.value.id },
      ACTOR,
      problem,
    );
    expect(regen.ok).toBe(true);
    if (!regen.ok) return;
    const newEntries = await collectEntries(repo, regen.value.id);
    const kept = newEntries.find(
      (e) =>
        e.classId === pinned.classId &&
        e.subjectId === pinned.subjectId &&
        e.day === pinned.day &&
        e.periodIndex === pinned.periodIndex,
    );
    expect(kept).toBeDefined();
    if (kept) {
      expect(kept.isLocked).toBe(true);
      expect(kept.source).toBe("manual");
    }
  });

  it("seeds the Algerian default configuration per academic year", async () => {
    const repo = new MockTimetableRepository();
    const config = await new Promise<
      import("../../domain/model/timetable").TimetableConfiguration | null
    >((resolve) => {
      const obs = repo.observeConfiguration(YEAR);
      obs.subscribe((c) => resolve(c));
    });
    expect(config).not.toBeNull();
    if (!config) return;
    expect(config.schoolDays).toEqual([
      "sunday",
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
    ]);
    expect(config.periods.length).toBe(6);
    expect(config.breaks.map((b) => b.label)).toEqual(["Pause", "Déjeuner"]);
  });
});

// ── Helpers: collect observable snapshots ─────────────────────────────────

async function collectVersions(
  repo: MockTimetableRepository,
): Promise<import("../../domain/model/timetable").TimetableVersion[]> {
  return new Promise((resolve) => {
    repo.observeVersions(YEAR).subscribe((v) => resolve(v));
  });
}

async function collectEntries(
  repo: MockTimetableRepository,
  versionId: string,
): Promise<import("../../domain/model/timetable").TimetableScheduleEntry[]> {
  return new Promise((resolve) => {
    repo.observeEntries(versionId).subscribe((e) => resolve(e));
  });
}

// Referenced for side-effect: the singleton must be constructible and is
// used by the provider wiring (mockRepositories.timetable).
describe("T-404 — mock singleton", () => {
  it("exports the repository singleton", () => {
    expect(mockTimetableRepository).toBeDefined();
    expect(typeof mockTimetableRepository.generateTimetable).toBe("function");
  });
});
