// ============================================================================
// FILE: src/tests/infrastructure/t-409-generation-progress.test.ts
// ============================================================================
/**
 * T-409 — the repository-level generation progress lifecycle (SCHED-111,
 * progress leg). The mock repository consumes the REAL solver registry +
 * the REAL canonical validator (only persistence differs from production),
 * and shares the ONE progress emission policy with the Supabase
 * repository (domain/calc/timetable/generation-progress.ts).
 *
 * WHAT THIS SUITE PINS:
 *   1. The full stage lifecycle: loading → preparing → placing →
 *      validating → saving, in order, from the ACTUAL run.
 *   2. The terminal 100% is emitted ONLY after the trial is persisted
 *      (the last event; every earlier event has processed < total).
 *   3. A FAILED generation NEVER emits a false 100% (no terminal event,
 *      no saving stage).
 *   4. Final coverage (placedPeriods / requiredPeriods) is carried in the
 *      version statistics and verifiable independently — separate from
 *      the generation progress metric.
 */

import { describe, expect, it } from "vitest";
import { MockTimetableRepository } from "../../infrastructure/mock/repositories/timetable-repository";
import { buildFixtureProblem } from "../../domain/calc/timetable/fixture";
import {
  timetableCoveragePercent,
  timetableGenerationProgressPercent,
  type TimetableGenerationProgress,
} from "../../domain/model/timetable";
import { blockSplit, requiredPeriodsFor } from "../../domain/calc/timetable/constraints";
import { periodMinutes } from "../../domain/model/timetable";

const ACTOR = { actorId: "actor-t409", actorName: "T-409 Progress Actor" };
const YEAR = "year-t409-progress";

/** The independent work/coverage census (canonical helpers, no solver). */
function census() {
  const problem = buildFixtureProblem();
  const pm = periodMinutes(problem.configuration);
  let blocks = 0;
  let requiredPeriods = 0;
  for (const req of problem.requirements) {
    const parts = blockSplit(requiredPeriodsFor(req, pm), req.consecutivePeriods);
    blocks += parts.length;
    requiredPeriods += parts.reduce((s, x) => s + x, 0);
  }
  return {
    problem,
    blocks,
    requiredPeriods,
    totalUnits: problem.requirements.length + blocks + 1,
  };
}

describe("T-409 — repository generation progress lifecycle (mock)", () => {
  it("emits the full stage sequence with a terminal 100% ONLY after persistence", async () => {
    const repo = new MockTimetableRepository();
    const c = census();
    const events: TimetableGenerationProgress[] = [];

    const result = await repo.generateTimetable(
      { academicYearId: YEAR, onProgress: (p) => events.push({ ...p }) },
      ACTOR,
      c.problem,
    );

    expect(result.ok).toBe(true);

    // 1. The run starts with the honest indeterminate loading stage.
    expect(events[0]).toMatchObject({
      stage: "loading",
      processed: 0,
      total: 0,
    });

    // 2. The real stage order (no repair on the placeable fixture).
    const stageOrder: string[] = [];
    for (const e of events) {
      if (stageOrder[stageOrder.length - 1] !== e.stage) stageOrder.push(e.stage);
    }
    expect(stageOrder).toEqual([
      "loading",
      "preparing",
      "placing",
      "validating",
      "saving",
    ]);

    // 3. The denominator is FIXED from the first solver event and equals
    //    the real work census (+1 loading unit +1 saving unit).
    const solverTotals = new Set(
      events.filter((e) => e.total > 0).map((e) => e.total),
    );
    expect(solverTotals).toEqual(new Set([c.totalUnits + 2]));

    // 4. processed is monotonically non-decreasing.
    for (let i = 1; i < events.length; i++) {
      expect(events[i].processed).toBeGreaterThanOrEqual(events[i - 1].processed);
    }

    // 5. THE TERMINAL CONTRACT: only the LAST event reaches 100%, it is
    //    the saving stage, and it lands AFTER the version was persisted
    //    (the result is already Ok — the entries are in the store).
    const last = events[events.length - 1];
    expect(last.processed).toBe(last.total);
    expect(last.stage).toBe("saving");
    expect(last.message).toMatch(/Essai \d+ enregistré — 48 \/ 48 périodes placées \(couverture 100%\)/);
    const before = events.slice(0, -1);
    expect(
      before.every(
        (e) => e.total === 0 || timetableGenerationProgressPercent(e) < 100,
      ),
    ).toBe(true);

    // 6. The persisted version's entries back the claimed coverage.
    if (result.ok) {
      const stats = result.value.statistics as Record<string, unknown>;
      expect(Number(stats.placedPeriods)).toBe(c.requiredPeriods);
      expect(Number(stats.requiredPeriods)).toBe(c.requiredPeriods);
      expect(
        timetableCoveragePercent(
          Number(stats.placedPeriods),
          Number(stats.requiredPeriods),
        ),
      ).toBe(100);
    }
  });

  it("NEVER emits a false 100% when the generation fails (no problem)", async () => {
    const repo = new MockTimetableRepository();
    const events: TimetableGenerationProgress[] = [];

    const result = await repo.generateTimetable(
      { academicYearId: YEAR, onProgress: (p) => events.push({ ...p }) },
      ACTOR,
      undefined, // the mock's documented failure path
    );

    expect(result.ok).toBe(false);
    // The honest loading event may fire, but NOTHING reaches a terminal
    // state: no saving stage, no processed === total with total > 0.
    expect(events.some((e) => e.stage === "saving")).toBe(false);
    expect(
      events.some((e) => e.total > 0 && e.processed >= e.total),
    ).toBe(false);
  });

  it("keeps generation deterministic with progress attached (same trial twice → same statistics)", async () => {
    const repo = new MockTimetableRepository();
    const c = census();
    const eventsA: TimetableGenerationProgress[] = [];
    const eventsB: TimetableGenerationProgress[] = [];

    const a = await repo.generateTimetable(
      { academicYearId: YEAR, onProgress: (p) => eventsA.push({ ...p }) },
      ACTOR,
      c.problem,
    );
    const b = await repo.generateTimetable(
      { academicYearId: YEAR, onProgress: (p) => eventsB.push({ ...p }) },
      ACTOR,
      c.problem,
    );

    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    // The solver stage events are identical (deterministic work); the
    // terminal saving message differs only by the trial number.
    expect(eventsB.slice(0, -1)).toEqual(eventsA.slice(0, -1));
    expect(a.value.statistics.placedPeriods).toBe(b.value.statistics.placedPeriods);
  });
});
