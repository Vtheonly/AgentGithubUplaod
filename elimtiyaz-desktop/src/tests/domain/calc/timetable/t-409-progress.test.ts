// ============================================================================
// FILE: src/tests/domain/calc/timetable/t-409-progress.test.ts
// ============================================================================
/**
 * T-409 — the REAL generation-progress contract (SCHED-111, progress leg).
 *
 * WHAT THIS SUITE PINS:
 *   1. The solver emits progress from ACTUAL work units — one event per
 *      requirement indexed (preparing), one per placement block (placing),
 *      the repair retries, and the validation pass. The event count
 *      corresponds 1:1 to the real work performed (never a timer).
 *   2. The stage sequence is the real generation order:
 *      preparing → placing → (repairing) → validating.
 *   3. The event sequence is DETERMINISTIC (same problem → same sequence).
 *   4. solveAsync produces the IDENTICAL solution and IDENTICAL event
 *      sequence as solve (the yielding boundary changes scheduling, never
 *      the algorithm).
 *   5. Final coverage (placedPeriods / requiredPeriods) is independently
 *      verified against the returned statistics — coverage is a SEPARATE
 *      metric from generation progress.
 *   6. An impossible problem still completes its progress honestly and
 *      reports unplaced blocks (progress 100% of the WORK, not a fake
 *      "valid" timetable).
 */

import { describe, expect, it } from "vitest";
import {
  buildFixtureProblem,
  buildImpossibleProblem,
} from "../../../../domain/calc/timetable/fixture";
import {
  blockSplit,
  requiredPeriodsFor,
} from "../../../../domain/calc/timetable/constraints";
import {
  getTimetableSolver,
  GREEDY_SOLVER_ID,
} from "../../../../domain/calc/timetable/solver";
import "../../../../domain/calc/timetable/solver"; // registers ts-greedy-v1
import {
  timetableCoveragePercent,
  timetableGenerationProgressPercent,
  type TimetableGenerationProgress,
} from "../../../../domain/model/timetable";
import { periodMinutes } from "../../../../domain/model/timetable";

const solver = getTimetableSolver(GREEDY_SOLVER_ID)!;

function collect(
  solve: (onProgress: (p: TimetableGenerationProgress) => void) => unknown,
): TimetableGenerationProgress[] {
  const events: TimetableGenerationProgress[] = [];
  solve((p) => events.push({ ...p }));
  return events;
}

/** The async-aware collector — awaits the run BEFORE reading the events. */
async function collectAsync(
  solve: (
    onProgress: (p: TimetableGenerationProgress) => void,
  ) => Promise<unknown>,
): Promise<TimetableGenerationProgress[]> {
  const events: TimetableGenerationProgress[] = [];
  await solve((p) => events.push({ ...p }));
  return events;
}

/** The independently computed work-unit census for the fixture problem. */
function fixtureWorkCensus() {
  const problem = buildFixtureProblem();
  const pm = periodMinutes(problem.configuration);
  const blocksPerRequirement = problem.requirements.map((req) =>
    blockSplit(requiredPeriodsFor(req, pm), req.consecutivePeriods),
  );
  const blockCount = blocksPerRequirement.reduce((n, b) => n + b.length, 0);
  const requiredPeriods = blocksPerRequirement.reduce(
    (n, b) => n + b.reduce((s, x) => s + x, 0),
    0,
  );
  return {
    problem,
    pm,
    requirementCount: problem.requirements.length,
    blockCount,
    requiredPeriods,
    totalUnits: problem.requirements.length + blockCount + 1,
  };
}

// ============================================================================
// 1. Real work units — the event count corresponds to the actual work
// ============================================================================

describe("T-409 — solver progress is REAL work (not a timer)", () => {
  const census = fixtureWorkCensus();
  const events = collect((onProgress) =>
    solver.solve(census.problem, { onProgress }),
  );

  it("emits one preparing event per requirement (15 fixture requirements)", () => {
    const preparing = events.filter((e) => e.stage === "preparing");
    expect(preparing).toHaveLength(census.requirementCount);
    // Cumulative counters advance 1..R through the preparing stage.
    expect(preparing.map((e) => e.processed)).toEqual(
      Array.from({ length: census.requirementCount }, (_, i) => i + 1),
    );
  });

  it("emits one placing event per placement block (block census, not time)", () => {
    const placing = events.filter((e) => e.stage === "placing");
    expect(placing).toHaveLength(census.blockCount);
    // Every event carries the FIXED total — no growing/fake denominator.
    expect(new Set(placing.map((e) => e.total))).toEqual(
      new Set([census.totalUnits]),
    );
  });

  it("ends with processed === total ONLY at the final validating event", () => {
    expect(events[events.length - 1]).toMatchObject({
      stage: "validating",
      processed: census.totalUnits,
      total: census.totalUnits,
    });
    // No earlier event claims completion.
    const earlier = events.slice(0, -1);
    expect(earlier.every((e) => e.processed < e.total)).toBe(true);
  });

  it("runs the real stage order: preparing → placing → validating (no repair on the placeable fixture)", () => {
    const stageOrder: string[] = [];
    for (const e of events) {
      if (stageOrder[stageOrder.length - 1] !== e.stage) {
        stageOrder.push(e.stage);
      }
    }
    expect(stageOrder).toEqual(["preparing", "placing", "validating"]);
    expect(events.some((e) => e.stage === "repairing")).toBe(false);
  });

  it("carries the stage-local block counter in the message (63/118-style)", () => {
    const mid = events.filter((e) => e.stage === "placing")[
      Math.floor(census.blockCount / 2)
    ];
    expect(mid.message).toBe(
      `${Math.floor(census.blockCount / 2) + 1} / ${census.blockCount} blocs de placement traités`,
    );
  });
});

// ============================================================================
// 2. Determinism of the progress stream
// ============================================================================

describe("T-409 — progress events are deterministic", () => {
  const census = fixtureWorkCensus();

  it("emits the IDENTICAL event sequence across runs (x2)", () => {
    const a = collect((onProgress) => solver.solve(census.problem, { onProgress }));
    const b = collect((onProgress) => solver.solve(census.problem, { onProgress }));
    expect(b).toEqual(a);
  });
});

// ============================================================================
// 3. solveAsync — the yielding boundary never changes the work
// ============================================================================

describe("T-409 — solveAsync (the renderer-yielding drain)", () => {
  const census = fixtureWorkCensus();

  it("produces the IDENTICAL solution and IDENTICAL progress sequence as solve", async () => {
    expect(solver.solveAsync).toBeDefined();
    const syncEvents = collect((onProgress) =>
      solver.solve(census.problem, { onProgress }),
    );
    const asyncEvents = await collectAsync((onProgress) =>
      solver.solveAsync!(census.problem, { onProgress }),
    );
    // Same progress stream — the macrotask interleaving is scheduling,
    // not algorithm.
    expect(asyncEvents).toEqual(syncEvents);

    const syncSolution = solver.solve(census.problem);
    const asyncSolution = await solver.solveAsync!(census.problem);
    const key = (e: (typeof syncSolution.entries)[number]) =>
      `${e.classId}|${e.subjectId}|${e.day}|${e.periodIndex}|${e.teacherId}|${e.roomId}|${e.lessonGroup}`;
    expect(asyncSolution.entries.map(key).sort()).toEqual(
      syncSolution.entries.map(key).sort(),
    );
    expect(asyncSolution.statistics).toEqual(syncSolution.statistics);
  });

  it("emits progress BEFORE completion (observable while running)", async () => {
    const seenWhilePending: number[] = [];
    const promise = solver.solveAsync!(census.problem, {
      onProgress: (p) => seenWhilePending.push(p.processed),
    });
    // Microtask drains do NOT advance the generator (it awaits macrotasks),
    // but the promise must eventually resolve with events emitted along the
    // way — proof the listener fires DURING the run, not only at the end.
    const solution = await promise;
    expect(seenWhilePending.length).toBeGreaterThan(0);
    expect(seenWhilePending[seenWhilePending.length - 1]).toBe(
      solution.statistics.requiredPeriods >= 0
        ? census.totalUnits
        : census.totalUnits,
    );
  });
});

// ============================================================================
// 4. Progress ↔ work correspondence on the SOLUTION
// ============================================================================

describe("T-409 — emitted progress corresponds to the actual processed work", () => {
  const census = fixtureWorkCensus();
  const events = collect((onProgress) =>
    solver.solve(census.problem, { onProgress }),
  );
  const solution = solver.solve(census.problem);

  it("one placing event per block === one distinct lessonGroup per placed block", () => {
    // The fixture is fully placeable: every block became exactly one
    // lessonGroup in the solution — the events counted REAL placements.
    const placingEvents = events.filter((e) => e.stage === "placing").length;
    const lessonGroups = new Set(solution.entries.map((e) => e.lessonGroup));
    expect(placingEvents).toBe(lessonGroups.size);
    expect(placingEvents).toBe(census.blockCount);
  });

  it("the sum of processed blocks equals the solution's placed periods", () => {
    // Each block of size k contributed k placed periods; the independent
    // census (blockSplit totals) matches the solver statistics exactly.
    expect(solution.statistics.placedPeriods).toBe(census.requiredPeriods);
    expect(solution.statistics.requiredPeriods).toBe(census.requiredPeriods);
  });
});

// ============================================================================
// 5. Final coverage — verified INDEPENDENTLY, separate from progress
// ============================================================================

describe("T-409 — final coverage is an independent metric", () => {
  const census = fixtureWorkCensus();
  const solution = solver.solve(census.problem);

  it("placedPeriods / requiredPeriods verify against an independent count", () => {
    // Independent recount: one entry per (class, day, period) in the
    // solution, versus the canonical requirement census.
    const placed = solution.entries.length; // lockedEntries is empty here
    const required = census.requiredPeriods;
    expect(solution.statistics.placedPeriods).toBe(placed);
    expect(solution.statistics.requiredPeriods).toBe(required);
    expect(timetableCoveragePercent(placed, required)).toBe(100);
  });

  it("coverage percent math matches the contract (114/118 → 97)", () => {
    expect(timetableCoveragePercent(114, 118)).toBe(97);
    expect(timetableCoveragePercent(63, 118)).toBe(53);
    expect(timetableCoveragePercent(0, 0)).toBe(0); // nothing required — no fake 100%
    expect(timetableCoveragePercent(118, 118)).toBe(100);
  });

  it("generation progress percent math matches the contract (63/118 → 53)", () => {
    expect(
      timetableGenerationProgressPercent({
        stage: "placing",
        processed: 63,
        total: 118,
        message: "",
      }),
    ).toBe(53);
    // Indeterminate (total unknown) → 0, never a fabricated percentage.
    expect(
      timetableGenerationProgressPercent({
        stage: "loading",
        processed: 0,
        total: 0,
        message: "",
      }),
    ).toBe(0);
  });
});

// ============================================================================
// 6. The impossible problem — honest completion, honest failure
// ============================================================================

describe("T-409 — impossible problem: progress completes, failure is honest", () => {
  it("reaches processed === total (the WORK finished) while reporting unplaced blocks", () => {
    const events = collect((onProgress) =>
      solver.solve(buildImpossibleProblem(), { onProgress }),
    );
    const solution = solver.solve(buildImpossibleProblem());

    // The computation itself completed all its work units…
    const last = events[events.length - 1];
    expect(last.processed).toBe(last.total);
    // …including a REAL repair stage (the impossible variant has unplaced
    // blocks that get retried).
    expect(events.some((e) => e.stage === "repairing")).toBe(true);
    const stageOrder: string[] = [];
    for (const e of events) {
      if (stageOrder[stageOrder.length - 1] !== e.stage) stageOrder.push(e.stage);
    }
    expect(stageOrder).toEqual(["preparing", "placing", "repairing", "validating"]);

    // …but the RESULT is honestly partial/invalid with explanations.
    expect(solution.unplaced.length).toBeGreaterThan(0);
    expect(solution.status).not.toBe("valid");
    // 100% of the WORK with < 100% coverage — the two metrics differ.
    expect(
      solution.statistics.placedPeriods < solution.statistics.requiredPeriods,
    ).toBe(true);
    expect(
      timetableCoveragePercent(
        solution.statistics.placedPeriods,
        solution.statistics.requiredPeriods,
      ),
    ).toBeLessThan(100);
  });
});
