// ============================================================================
// FILE: src/domain/calc/timetable/solver/greedy-solver.ts
// ============================================================================
/**
 * ts-greedy-v1 — the DEFAULT native TypeScript timetable solver (T-404,
 * ADR-020 §4). Pure, deterministic, zero external runtime: it compiles
 * into the application bundle, so the packaged Electron app NEVER depends
 * on the user's PATH or an installed runtime.
 *
 * ALGORITHM (deterministic constructive + repair):
 *  1. Index the constraint data (free days, unavailability, room pools).
 *  2. Split every requirement into lesson blocks (consecutive periods,
 *     remainder blocks kept honest — never dropped).
 *  3. Reinsert locked entries first (manual pins survive regeneration),
 *     then T-441 carried entries (the OTHER classes' reference schedule —
 *     single-class regeneration can never conflict with them), blocking
 *     their slots.
 *  4. Order blocks most-constrained-first (required room type, block size,
 *     teacher load, then stable id tiebreaks — a total order, no
 *     randomness).
 *  5. Greedy placement: scan day/period starts in a round-robin across
 *     days (spread), find a run of consecutive free teaching periods with
 *     no labeled break inside, with a compatible free room and a free
 *     teacher, respecting hard constraints.
 *  6. T-441 / SCHED-110 — EVICTION REPAIR: for each unplaced block, try
 *     DISPLACING already-placed (never locked, never carried) blocks into
 *     alternative slots to free the class/teacher/room resources the
 *     block needs. Every displaced block must itself find a new legal
 *     placement (plain placement, no recursion) or the whole candidate is
 *     rolled back — the schedule is never left inconsistent. Bounded and
 *     deterministic. This closes the no-backtracking corner case where a
 *     single-period block ended with NO legal placement at high class
 *     occupancy because the teacher's busy slots collided with the class's
 *     few remaining free slots.
 *  7. Evaluate the FULL result with the canonical validator
 *     (constraints.ts) — the solution's violation report is authoritative.
 *
 * Impossibility is HONEST: unplaced blocks carry a French reason
 * (conflict explanation contract); the status is partial/invalid. The
 * T-441 repository gate fails CLOSED on any unplaced block or hard
 * violation (no partial version is persisted).
 *
 * T-409 — REAL-TIME PROGRESS + YIELDING BOUNDARY:
 *  The algorithm core is a GENERATOR (`solveGreedySteps`) that yields at
 *  every genuine work-unit boundary (one requirement indexed, one block
 *  placed/retried, the validation pass). `solve` drains it synchronously
 *  (backward compatible); `solveAsync` drains it behind a yielding
 *  boundary (setTimeout macrotasks) so the renderer can repaint between
 *  work units. Both drains execute the IDENTICAL step sequence — the
 *  solution and the progress-event sequence are byte-for-byte the same
 *  (deterministic, never timer-driven). Work units = requirements indexed
 *  + placement blocks processed + 1 validation pass; the repair pass
 *  re-processes existing blocks and advances the stage-local message
 *  without inflating the fixed denominator.
 *
 * T-441 — SINGLE-CLASS / PARTIAL REGENERATION: `problem.regenerateClassIds`
 * restricts which classes' requirements become placement blocks; the
 * problem's OTHER classes arrive as `problem.carriedEntries` (pre-occupied,
 * returned unchanged). The final validation + per-class reports always
 * cover the FULL problem (every class, every requirement) so a partial
 * run can never hide a hole in a carried class.
 */

import type {
  Room,
  TimetableDay,
  TimetableGenerationStage,
  TimetableProblem,
  TimetableProgressListener,
  TimetableRequirement,
  TimetableSlotAssignment,
  TimetableSolution,
  TimetableSolutionStatus,
  TimetableUnplacedBlock,
  TimetableViolation,
} from "../../../model/timetable";
import { teachingPeriods } from "../../../model/timetable";
import {
  blockSplit,
  requiredPeriodsFor,
  validateTimetable,
} from "../constraints";
import { buildClassTimetableReports } from "../class-reports";
import type { TimetableSolver, TimetableSolveOptions } from "./solver-types";

// ============================================================================
// Busy grids — O(1) slot lookups (with the occupying entry, for eviction)
// ============================================================================

class BusyGrid {
  private readonly classBusy = new Map<string, TimetableSlotAssignment>();
  private readonly teacherBusy = new Map<string, TimetableSlotAssignment>();
  private readonly roomBusy = new Map<string, TimetableSlotAssignment>();

  private static k(day: TimetableDay, period: number): string {
    return `${day}#${period}`;
  }

  classFree(day: TimetableDay, period: number, classId: string): boolean {
    return !this.classBusy.has(`${classId}|${BusyGrid.k(day, period)}`);
  }
  teacherFree(day: TimetableDay, period: number, teacherId: string | null): boolean {
    if (!teacherId) return true;
    return !this.teacherBusy.has(`${teacherId}|${BusyGrid.k(day, period)}`);
  }
  roomFree(day: TimetableDay, period: number, roomId: string | null): boolean {
    if (!roomId) return true;
    return !this.roomBusy.has(`${roomId}|${BusyGrid.k(day, period)}`);
  }

  /** The entry occupying (classId, day, period) — for eviction candidates. */
  classAt(
    day: TimetableDay,
    period: number,
    classId: string,
  ): TimetableSlotAssignment | undefined {
    return this.classBusy.get(`${classId}|${BusyGrid.k(day, period)}`);
  }
  teacherAt(
    day: TimetableDay,
    period: number,
    teacherId: string,
  ): TimetableSlotAssignment | undefined {
    return this.teacherBusy.get(`${teacherId}|${BusyGrid.k(day, period)}`);
  }
  roomAt(
    day: TimetableDay,
    period: number,
    roomId: string,
  ): TimetableSlotAssignment | undefined {
    return this.roomBusy.get(`${roomId}|${BusyGrid.k(day, period)}`);
  }

  occupy(entry: TimetableSlotAssignment): void {
    const k = BusyGrid.k(entry.day, entry.periodIndex);
    this.classBusy.set(`${entry.classId}|${k}`, entry);
    if (entry.teacherId) this.teacherBusy.set(`${entry.teacherId}|${k}`, entry);
    if (entry.roomId) this.roomBusy.set(`${entry.roomId}|${k}`, entry);
  }

  release(entry: TimetableSlotAssignment): void {
    const k = BusyGrid.k(entry.day, entry.periodIndex);
    this.classBusy.delete(`${entry.classId}|${k}`);
    if (entry.teacherId) this.teacherBusy.delete(`${entry.teacherId}|${k}`);
    if (entry.roomId) this.roomBusy.delete(`${entry.roomId}|${k}`);
  }

  /** Clear everything (the eviction rollback path). */
  clear(): void {
    this.classBusy.clear();
    this.teacherBusy.clear();
    this.roomBusy.clear();
  }
}

// ============================================================================
// Constraint index (hard checks used during placement)
// ============================================================================

interface PlacementConstraints {
  freeDays: {
    classes: Map<string, Set<TimetableDay>>;
    teachers: Map<string, Set<TimetableDay>>;
    rooms: Map<string, Set<TimetableDay>>;
    school: Set<TimetableDay>;
  };
  unavailable: {
    classes: Map<string, Set<string>>;
    teachers: Map<string, Set<string>>;
    rooms: Map<string, Set<string>>;
  };
}

function buildConstraintIndex(problem: TimetableProblem): PlacementConstraints {
  const idx: PlacementConstraints = {
    freeDays: {
      classes: new Map(),
      teachers: new Map(),
      rooms: new Map(),
      school: new Set(),
    },
    unavailable: {
      classes: new Map(),
      teachers: new Map(),
      rooms: new Map(),
    },
  };

  const addFreeDay = (
    map: Map<string, Set<TimetableDay>>,
    id: string,
    day: TimetableDay,
  ) => {
    map.set(id, new Set([...(map.get(id) ?? []), day]));
  };
  const addUnavailable = (
    map: Map<string, Set<string>>,
    id: string,
    day: TimetableDay,
    period: number,
  ) => {
    map.set(id, new Set([...(map.get(id) ?? []), `${day}#${period}`]));
  };

  for (const c of problem.constraints) {
    if (!c.isActive) continue;
    if (c.kind === "free_day") {
      const raw = c.params["day"];
      if (typeof raw !== "string") continue;
      const day = raw as TimetableDay;
      if (c.scope === "school") {
        idx.freeDays.school.add(day);
      } else if (c.entityId) {
        if (c.scope === "class") addFreeDay(idx.freeDays.classes, c.entityId, day);
        if (c.scope === "teacher") addFreeDay(idx.freeDays.teachers, c.entityId, day);
        if (c.scope === "room") addFreeDay(idx.freeDays.rooms, c.entityId, day);
      }
    } else if (c.kind === "unavailable_period") {
      const rawDay = c.params["day"];
      const rawPeriod = c.params["periodIndex"];
      if (typeof rawDay !== "string" || typeof rawPeriod !== "number") continue;
      if (c.entityId) {
        if (c.scope === "class") {
          addUnavailable(idx.unavailable.classes, c.entityId, rawDay as TimetableDay, rawPeriod);
        }
        if (c.scope === "teacher") {
          addUnavailable(idx.unavailable.teachers, c.entityId, rawDay as TimetableDay, rawPeriod);
        }
        if (c.scope === "room") {
          addUnavailable(idx.unavailable.rooms, c.entityId, rawDay as TimetableDay, rawPeriod);
        }
      }
    }
  }
  return idx;
}

// ============================================================================
// The solver
// ============================================================================

interface LessonBlock {
  requirement: TimetableRequirement;
  periods: number;
  /** Deterministic difficulty (higher = placed earlier). */
  priority: number;
}

export const GREEDY_SOLVER_ID = "ts-greedy-v1";
// v1.3.0 — T-441: the SCHED-110 no-backtracking corner case is closed (the
// repair pass EVICTS and re-places movable blocks instead of retrying the
// identical failing placement), and single-class regeneration is supported
// (carriedEntries + regenerateClassIds). The greedy placement order for
// problems that previously solved fully is UNCHANGED (deterministic pins
// hold); problems that previously ended partial can now solve — that is
// the point of the repair.
export const GREEDY_SOLVER_BUILD = "v1.3.0+20260929";

/** Drain cadence for solveAsync: yield to the renderer every N work units. */
const ASYNC_YIELD_EVERY = 20;

/** T-441 eviction bounds (deterministic, no pathological search). */
const EVICTION_MAX_CANDIDATES = 60;
const EVICTION_MAX_GROUPS_PER_CANDIDATE = 4;

/** One macrotask — lets the renderer paint between solver work units. */
function yieldToRenderer(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export function createGreedySolver(): TimetableSolver {
  return {
    id: GREEDY_SOLVER_ID,
    build: GREEDY_SOLVER_BUILD,
    description:
      "Solveur natif TypeScript (constructif déterministe + réparation par éviction) — aucune dépendance externe.",

    solve(problem: TimetableProblem, options?: TimetableSolveOptions): TimetableSolution {
      const steps = solveGreedySteps(problem, options?.onProgress);
      for (;;) {
        const r = steps.next();
        if (r.done) return r.value;
      }
    },

    async solveAsync(
      problem: TimetableProblem,
      options?: TimetableSolveOptions,
    ): Promise<TimetableSolution> {
      const steps = solveGreedySteps(problem, options?.onProgress);
      let sinceYield = 0;
      for (;;) {
        const r = steps.next();
        if (r.done) return r.value;
        // Yielding boundary (T-409 §9): the SAME deterministic step
        // sequence as solve(), interleaved with macrotasks so React can
        // repaint the real progress between chunks. Never a fake timer.
        if (++sinceYield >= ASYNC_YIELD_EVERY) {
          sinceYield = 0;
          await yieldToRenderer();
        }
      }
    },
  };
}

type TimetableSolutionProblem = TimetableProblem;

function* solveGreedySteps(
  problem: TimetableSolutionProblem,
  onProgress?: TimetableProgressListener,
): Generator<void, TimetableSolution> {
  const config = problem.configuration;
  const periods = teachingPeriods(config);
  const days = [...config.schoolDays];
  const entries: TimetableSlotAssignment[] = [];
  const unplaced: TimetableUnplacedBlock[] = [];
  const grid = new BusyGrid();
  const cidx = buildConstraintIndex(problem);

  // T-441: the classes to (re)generate — undefined/empty = whole school.
  const regenerate = problem.regenerateClassIds?.length
    ? new Set(problem.regenerateClassIds)
    : null;
  const carried = problem.carriedEntries ?? [];

  // T-441 — PREFERRED SLOTS (the regeneration-continuity hint): the source
  // version's historical placements as class|subject|day|period keys. A
  // candidate run whose EVERY period matches a preferred key is tried
  // FIRST (stable partition) — a regeneration keeps the previous schedule
  // wherever it still fits around the locked pins, instead of
  // re-fragmenting the week and failing on solvable problems (the owner's
  // "N échecs on regeneration" symptom). Pure preference: blocked
  // preferred slots are skipped exactly like any other candidate, and a
  // problem without preferredEntries behaves bit-identically to before.
  const preferredSlots = new Set(
    (problem.preferredEntries ?? []).map(
      (e) => `${e.classId}|${e.subjectId}|${e.day}|${e.periodIndex}`,
    ),
  );

  // T-441 — PINNED COVERAGE: locked + carried entries already cover part
  // of each requirement — only the REMAINDER becomes placement blocks (a
  // pinned lesson is NEVER duplicated: the owner's contract forbids cours
  // en double). blockSplit(0) would return [1] (its empty-guard), so a
  // remainder <= 0 skips the requirement's blocks entirely.
  const pinnedCoverage = new Map<string, number>();
  for (const e of [...problem.lockedEntries, ...carried]) {
    const k = `${e.classId}|${e.subjectId}`;
    pinnedCoverage.set(k, (pinnedCoverage.get(k) ?? 0) + 1);
  }

  const periodMinutesValue =
    periods.length > 0 ? periods[0].endMinutes - periods[0].startMinutes : config.defaultLessonMinutes;

  // Valid period indexes with adjacency information.
  const validPeriods = periods.map((p) => p.index);
  const maxPeriodsPerDay = Math.min(
    config.maxPeriodsPerDay,
    periods.length,
  );

  // Rooms by type (active only), deterministic order.
  const roomsByType = new Map<string, Room[]>();
  for (const room of [...problem.rooms].filter((r) => r.isActive)) {
    const list = roomsByType.get(room.roomType) ?? [];
    list.push(room);
    roomsByType.set(room.roomType, list);
  }
  for (const list of roomsByType.values()) {
    list.sort((a, b) => a.code.localeCompare(b.code));
  }

  const classById = new Map(problem.classes.map((c) => [c.id, c]));

  const isFreeDay = (
    day: TimetableDay,
    classId: string,
    teacherId: string | null,
    roomId: string | null,
  ): boolean => {
    if (cidx.freeDays.school.has(day)) return true;
    if (cidx.freeDays.classes.get(classId)?.has(day)) return true;
    if (teacherId && cidx.freeDays.teachers.get(teacherId)?.has(day)) return true;
    if (roomId && cidx.freeDays.rooms.get(roomId)?.has(day)) return true;
    return false;
  };

  const isUnavailable = (
    day: TimetableDay,
    period: number,
    classId: string,
    teacherId: string | null,
    roomId: string | null,
  ): boolean => {
    const key = `${day}#${period}`;
    if (cidx.unavailable.classes.get(classId)?.has(key)) return true;
    if (teacherId && cidx.unavailable.teachers.get(teacherId)?.has(key)) return true;
    if (roomId && cidx.unavailable.rooms.get(roomId)?.has(key)) return true;
    return false;
  };

  // Class→room affinity: classes prefer staying in the room they already
  // use (the homeroom pattern) — deterministic, updated on every placement.
  const classRoomAffinity = new Map<string, Map<string, number>>();
  function bumpAffinity(classId: string, roomId: string): void {
    const per = classRoomAffinity.get(classId) ?? new Map<string, number>();
    per.set(roomId, (per.get(roomId) ?? 0) + 1);
    classRoomAffinity.set(classId, per);
  }
  function affinityOf(classId: string, roomId: string): number {
    return classRoomAffinity.get(classId)?.get(roomId) ?? 0;
  }

  // ── Step 1: locked entries occupy the grid first (manual pins), then
  //    T-441 carried entries (the other classes' reference schedule). ────
  for (const locked of problem.lockedEntries) {
    grid.occupy(locked);
    entries.push(locked);
    if (locked.roomId) {
      bumpAffinity(locked.classId, locked.roomId);
    }
  }
  for (const carry of carried) {
    grid.occupy(carry);
    entries.push(carry);
    if (carry.roomId) {
      bumpAffinity(carry.classId, carry.roomId);
    }
  }

  // Lesson groups already used by pins/carried rows — the generator's
  // ordinals must never collide with them.
  let nextLessonGroup =
    Math.max(
      0,
      ...problem.lockedEntries.map((e) => e.lessonGroup),
      ...carried.map((e) => e.lessonGroup),
    ) + 1;

  // ── Step 2: build the block list (T-441: only the regenerated classes
  //    when regenerateClassIds is set). ───────────────────────────────────
  // T-409: the progress denominator is FIXED before the first event — a
  // counting pass over the SAME canonical blockSplit (no second
  // implementation). Work units: requirements indexed + blocks processed
  // + 1 validation pass.
  const scopedRequirements = regenerate
    ? problem.requirements.filter((r) => regenerate.has(r.classId))
    : problem.requirements;
  const requirementsTotal = scopedRequirements.length;
  let totalBlocks = 0;
  for (const req of scopedRequirements) {
    const required = requiredPeriodsFor(req, periodMinutesValue);
    const remainder = Math.max(
      0,
      required - (pinnedCoverage.get(`${req.classId}|${req.subjectId}`) ?? 0),
    );
    totalBlocks += blockSplit(remainder, req.consecutivePeriods).length;
  }
  const totalUnits = requirementsTotal + totalBlocks + 1;
  const emitProgress = (
    stage: TimetableGenerationStage,
    processed: number,
    message: string,
  ): void => {
    onProgress?.({ stage, processed, total: totalUnits, message });
  };

  const blocks: LessonBlock[] = [];
  let requirementsProcessed = 0;
  for (const req of scopedRequirements) {
    const requiredPeriods = requiredPeriodsFor(req, periodMinutesValue);
    // T-441 — only the uncovered REMAINDER is placed (never duplicate a
    // pinned lesson). A fully pinned requirement contributes no blocks.
    const remainder = Math.max(
      0,
      requiredPeriods -
        (pinnedCoverage.get(`${req.classId}|${req.subjectId}`) ?? 0),
    );
    if (remainder > 0) {
      for (const blockPeriods of blockSplit(remainder, req.consecutivePeriods)) {
        blocks.push({
          requirement: req,
          periods: blockPeriods,
          priority: blockPriority(req, blockPeriods),
        });
      }
    }
    requirementsProcessed++;
    emitProgress(
      "preparing",
      requirementsProcessed,
      `Préparation des besoins — ${requirementsProcessed} / ${requirementsTotal} exigences traitées`,
    );
    yield; // work-unit boundary (T-409)
  }
  // Deterministic total order: priority desc, then classId/subjectId.
  blocks.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    const ca = `${a.requirement.classId}|${a.requirement.subjectId}`;
    const cb = `${b.requirement.classId}|${b.requirement.subjectId}`;
    return ca.localeCompare(cb);
  });

  // ── Step 3: greedy placement. ───────────────────────────────────────────
  // Round-robin day cursor spreads each class across the week.
  const classDayCursor = new Map<string, number>();

  // Placed blocks indexed by lessonGroup — the eviction repair's units.
  const placedBlockByGroup = new Map<
    number,
    { requirement: TimetableRequirement; periods: number }
  >();
  const pinnedGroups = new Set<number>([
    ...problem.lockedEntries.map((e) => e.lessonGroup),
    ...carried.map((e) => e.lessonGroup),
  ]);

  interface PlacementCandidate {
    day: TimetableDay;
    runPeriods: number[];
    room: Room | null;
  }

  /**
   * Deterministic enumeration of (day, run, room) placements where the
   * only thing that can block is an ALREADY-PLACED entry (the eviction
   * scan). Hard rules stay hard: school/class free days, unavailability,
   * break adjacency, valid periods, room type + capacity, teacher free
   * days. When `ignoreBusy` is false, the resource-free checks apply too
   * (the plain greedy placement enumeration).
   */
  const enumerateCandidates = (
    block: LessonBlock,
    ignoreBusy: boolean,
  ): PlacementCandidate[] => {
    const req = block.requirement;
    const out: PlacementCandidate[] = [];
    const startDay =
      (classDayCursor.get(req.classId) ?? 0) % Math.max(1, days.length);
    for (let dayOffset = 0; dayOffset < days.length; dayOffset++) {
      const day = days[(startDay + dayOffset) % days.length];
      if (cidx.freeDays.school.has(day)) continue;
      if (cidx.freeDays.classes.get(req.classId)?.has(day)) continue;
      const usedToday = entries.filter(
        (e) => e.classId === req.classId && e.day === day,
      ).length;
      if (!ignoreBusy && usedToday + block.periods > maxPeriodsPerDay) continue;
      for (const startPeriod of validPeriods) {
        const runPeriods: number[] = [startPeriod];
        let runOk = validPeriods.includes(startPeriod);
        if (runOk) {
          for (let k = 1; k < block.periods; k++) {
            const next = startPeriod + k;
            if (!validPeriods.includes(next)) {
              runOk = false;
              break;
            }
            if (
              config.breaks.some((b) => b.afterPeriodIndex === startPeriod + k - 1)
            ) {
              runOk = false;
              break;
            }
            runPeriods.push(next);
          }
        }
        if (!runOk) continue;
        if (
          runPeriods.some(
            (p) =>
              isUnavailable(day, p, req.classId, req.teacherId, null) ||
              (req.teacherId &&
                cidx.freeDays.teachers.get(req.teacherId)?.has(day)),
          )
        ) {
          continue;
        }
        if (!ignoreBusy) {
          // Class availability across the run.
          if (
            runPeriods.some((p) => !grid.classFree(day, p, req.classId))
          ) {
            continue;
          }
          // Teacher availability across the run.
          if (
            req.teacherId &&
            runPeriods.some((p) => !grid.teacherFree(day, p, req.teacherId))
          ) {
            continue;
          }
        }
        // Room candidates (affinity-ordered, null as the LAST resort for
        // subjects with no required room type).
        let orderedCandidates: Array<Room | null>;
        if (req.requiredRoomType) {
          orderedCandidates = [...(roomsByType.get(req.requiredRoomType) ?? [])]
            .filter((room) => {
              if (
                req.classSize != null &&
                room.capacity != null &&
                req.classSize > room.capacity
              )
                return false;
              return true;
            })
            .sort(
              (a, b) =>
                affinityOf(req.classId, b.id) - affinityOf(req.classId, a.id) ||
                a.code.localeCompare(b.code),
            );
        } else {
          const preferred: Room[] = [
            ...(roomsByType.get("classroom") ?? []),
            ...(roomsByType.get("other") ?? []),
          ].sort(
            (a, b) =>
              affinityOf(req.classId, b.id) - affinityOf(req.classId, a.id) ||
              a.code.localeCompare(b.code),
          );
          orderedCandidates = [...preferred, null];
        }
        for (const room of orderedCandidates) {
          if (room != null) {
            if (isFreeDay(day, req.classId, req.teacherId, room.id)) continue;
            if (
              runPeriods.some(
                (p) => isUnavailable(day, p, req.classId, req.teacherId, room.id),
              )
            ) {
              continue;
            }
            if (
              !ignoreBusy &&
              runPeriods.some((p) => !grid.roomFree(day, p, room.id))
            ) {
              continue;
            }
          }
          out.push({ day, runPeriods, room });
        }
      }
    }
    // T-441 — preferred-first ordering (STABLE partition: the source
    // version's historical slots first, the deterministic enumeration
    // order preserved within each partition).
    if (preferredSlots.size > 0) {
      const preferred: PlacementCandidate[] = [];
      const rest: PlacementCandidate[] = [];
      for (const cand of out) {
        const isPreferred = cand.runPeriods.every((p) =>
          preferredSlots.has(
            `${req.classId}|${req.subjectId}|${cand.day}|${p}`,
          ),
        );
        (isPreferred ? preferred : rest).push(cand);
      }
      return [...preferred, ...rest];
    }
    return out;
  };

  /** Place a block at an exact candidate (checks are the caller's job). */
  const placeAt = (block: LessonBlock, cand: PlacementCandidate): void => {
    const req = block.requirement;
    const lessonGroup = nextLessonGroup++;
    for (const p of cand.runPeriods) {
      const entry: TimetableSlotAssignment = {
        classId: req.classId,
        subjectId: req.subjectId,
        teacherId: req.teacherId,
        roomId: cand.room ? cand.room.id : null,
        day: cand.day,
        periodIndex: p,
        lessonGroup,
      };
      entries.push(entry);
      grid.occupy(entry);
    }
    if (cand.room) {
      for (let k = 0; k < block.periods; k++) {
        bumpAffinity(req.classId, cand.room.id);
      }
    }
    placedBlockByGroup.set(lessonGroup, {
      requirement: req,
      periods: block.periods,
    });
    classDayCursor.set(
      req.classId,
      (days.indexOf(cand.day) + 1) % Math.max(1, days.length),
    );
  };

  /** Remove every entry of one lesson group (the eviction unit). */
  const detachGroup = (group: number): TimetableSlotAssignment[] => {
    const groupEntries = entries.filter((e) => e.lessonGroup === group);
    for (const e of groupEntries) {
      const idx = entries.indexOf(e);
      if (idx >= 0) entries.splice(idx, 1);
      grid.release(e);
    }
    return groupEntries;
  };

  /**
   * T-441 / SCHED-110 — try to place `block` by EVICTING movable blocks.
   * Deterministic + bounded: ≤ EVICTION_MAX_CANDIDATES placements, ≤
   * EVICTION_MAX_GROUPS_PER_CANDIDATE evicted groups per candidate,
   * evicted blocks re-placed with PLAIN placement only, full rollback on
   * any failure. Returns null on success, or the honest French reason.
   */
  const tryEvictingPlace = (block: LessonBlock): string | null => {
    const req = block.requirement;
    let tried = 0;
    for (const cand of enumerateCandidates(block, true)) {
      if (tried >= EVICTION_MAX_CANDIDATES) break;
      tried++;

      // Collect the obstacle lesson groups (dedup, deterministic order).
      // A slot occupied by a LOCKED/CARRIED entry is NOT evictable — the
      // candidate is simply invalid (pins are immovable by contract).
      const obstacleGroups: number[] = [];
      const seenGroups = new Set<number>();
      let blockedByPin = false;
      const consider = (e: TimetableSlotAssignment | undefined): void => {
        if (!e) return;
        if (ctxPinnedGroups().has(e.lessonGroup)) {
          blockedByPin = true; // locked/carried: never evicted, never overlaid
          return;
        }
        if (seenGroups.has(e.lessonGroup)) return;
        seenGroups.add(e.lessonGroup);
        obstacleGroups.push(e.lessonGroup);
      };
      for (const p of cand.runPeriods) {
        consider(grid.classAt(cand.day, p, req.classId));
        if (req.teacherId) consider(grid.teacherAt(cand.day, p, req.teacherId));
        if (cand.room) consider(grid.roomAt(cand.day, p, cand.room.id));
      }
      if (blockedByPin) continue;
      if (obstacleGroups.length === 0) {
        // A completely free candidate after all — place directly.
        placeAt(block, cand);
        return null;
      }
      if (obstacleGroups.length > EVICTION_MAX_GROUPS_PER_CANDIDATE) continue;

      // Day-cap check for THIS class after the eviction: the obstacles of
      // this class leave the day, making room for the incoming block.
      const classObstaclesOnDay = entries.filter(
        (e) =>
          e.classId === req.classId &&
          e.day === cand.day &&
          obstacleGroups.includes(e.lessonGroup),
      ).length;
      const usedToday = entries.filter(
        (e) => e.classId === req.classId && e.day === cand.day,
      ).length;
      if (
        usedToday - classObstaclesOnDay + block.periods >
        maxPeriodsPerDay
      ) {
        continue;
      }

      // Snapshot → evict → place → re-place evicted → rollback on failure.
      const snap = [...entries];
      const detached: LessonBlock[] = [];
      let abortCandidate = false;
      for (const group of obstacleGroups) {
        const info = placedBlockByGroup.get(group);
        const groupEntries = detachGroup(group);
        if (!info || groupEntries.length === 0) {
          abortCandidate = true; // unknown group — restore, next candidate
          break;
        }
        detached.push({
          requirement: info.requirement,
          periods: groupEntries.length,
          priority: blockPriority(info.requirement, groupEntries.length),
        });
      }
      if (abortCandidate) {
        restoreSnapshot(snap);
        continue;
      }

      placeAt(block, cand);

      let allReplaced = true;
      for (const d of detached) {
        const reCandidates = enumerateCandidates(d, false);
        if (reCandidates.length === 0) {
          allReplaced = false;
          break;
        }
        placeAt(d, reCandidates[0]);
      }
      if (allReplaced) {
        return null; // success — block placed, evicted blocks relocated
      }
      // Roll back the whole candidate.
      restoreSnapshot(snap);
    }
    return `Aucun créneau libre compatible (jours/périodes, enseignant, salle) pour ${req.subjectName} — ${req.className} (${block.periods} période(s)), même après réparation par éviction.`;
  };

  /** Restore entries + busy grid + placed-block index from a snapshot. */
  const restoreSnapshot = (snap: readonly TimetableSlotAssignment[]): void => {
    entries.length = 0;
    entries.push(...snap);
    grid.clear();
    for (const e of snap) grid.occupy(e);
    // Rebuild the placed-block index: drop groups absent from the snapshot.
    const groupsInSnap = new Set(snap.map((e) => e.lessonGroup));
    for (const group of [...placedBlockByGroup.keys()]) {
      if (!groupsInSnap.has(group)) placedBlockByGroup.delete(group);
    }
  };

  const ctxPinnedGroups = (): ReadonlySet<number> => pinnedGroups;

  const tryPlaceBlock = (block: LessonBlock): string | null => {
    const req = block.requirement;
    const cls = classById.get(req.classId);

    const candidates = enumerateCandidates(block, false);
    if (candidates.length > 0) {
      placeAt(block, candidates[0]);
      return null;
    }

    // Failure explanation (the conflict-explanation contract).
    if (req.requiredRoomType && (roomsByType.get(req.requiredRoomType) ?? []).length === 0) {
      return `Aucune salle active de type « ${req.requiredRoomType} » n'est configurée.`;
    }
    if (cls && days.every((d) => cidx.freeDays.classes.get(cls.id)?.has(d))) {
      return `Tous les jours d'école sont des jours libres pour la classe ${req.className}.`;
    }
    return `Aucun créneau libre compatible (jours/périodes, enseignant, salle) pour ${req.subjectName} — ${req.className} (${block.periods} période(s)).`;
  };

  let blocksProcessed = 0;
  for (const block of blocks) {
    const reason = tryPlaceBlock(block);
    if (reason) {
      unplaced.push({ requirement: block.requirement, blockPeriods: block.periods, reason });
    }
    blocksProcessed++;
    emitProgress(
      "placing",
      requirementsTotal + blocksProcessed,
      `${blocksProcessed} / ${blocks.length} blocs de placement traités`,
    );
    yield; // work-unit boundary (T-409)
  }

  // ── Step 4: T-441 / SCHED-110 — EVICTION REPAIR for unplaced blocks. ──
  // For each unplaced block: enumerate placements where the ONLY obstacles
  // are already-placed (never locked, never carried) blocks; evict those
  // blocks, place the failing block, then re-place every evicted block
  // (plain placement). Any failure rolls the whole candidate back — the
  // schedule is never left worse than before.
  if (unplaced.length > 0) {
    emitProgress(
      "repairing",
      requirementsTotal + blocks.length,
      `Réparation / optimisation — ${unplaced.length} bloc(s) à replacer`,
    );
    yield;
    const stillUnplaced: TimetableUnplacedBlock[] = [];
    let repairedCount = 0;
    for (const u of unplaced) {
      const block: LessonBlock = {
        requirement: u.requirement,
        periods: u.blockPeriods,
        priority: blockPriority(u.requirement, u.blockPeriods),
      };
      const reason = tryEvictingPlace(block);
      if (reason) {
        stillUnplaced.push({
          requirement: u.requirement,
          blockPeriods: u.blockPeriods,
          reason,
        });
      }
      repairedCount++;
      emitProgress(
        "repairing",
        requirementsTotal + blocks.length,
        `Réparation — ${repairedCount} / ${unplaced.length} blocs réessayés`,
      );
      yield;
    }
    unplaced.length = 0;
    unplaced.push(...stillUnplaced);
  }

  // ── Step 5: canonical validation (authoritative violation report). ─────
  emitProgress(
    "validating",
    requirementsTotal + blocks.length,
    "Validation finale du résultat…",
  );
  yield;
  // T-441: validate the FULL problem (every class's requirements, carried
  // entries included) — a partial run can never hide a hole.
  const violations: TimetableViolation[] = validateTimetable(problem, entries);
  const hardCount = violations.filter((v) => v.severity === "hard").length;
  const softCount = violations.length - hardCount;

  // T-410 / SCHED-112: EACH class's timetable validated INDEPENDENTLY — the
  // per-class reports are derived from the canonical validator's output +
  // the class's own entries (a thin attribution layer, never a second
  // engine). Computed inside the SAME validation work unit: the T-409
  // progress contract (fixed denominator, event sequence) is unchanged.
  const perClass = buildClassTimetableReports(problem, {
    entries,
    violations,
    unplaced,
  });

  // T-441 — HONEST TOTALS: requiredPeriods = the school's true weekly
  // requirement (every requirement of the FULL problem — the version is a
  // complete school snapshot, carried classes included); placedPeriods =
  // EVERY row of the produced version (locked + carried + newly placed) —
  // the coverage the owner actually gets, never a solver-internal count.
  const requiredTotal = problem.requirements.reduce(
    (sum, r) => sum + requiredPeriodsFor(r, periodMinutesValue),
    0,
  );
  const placedTotal = entries.length;
  const classesScheduled = new Set(
    entries.map((e) => e.classId),
  ).size;

  let status: TimetableSolutionStatus;
  if (unplaced.length === 0 && hardCount === 0) {
    status = "valid";
  } else if (placedTotal > 0) {
    status = "partial";
  } else {
    status = "invalid";
  }

  emitProgress("validating", totalUnits, "Validation finale terminée");
  yield;

  return {
    status,
    entries,
    unplaced,
    violations,
    statistics: {
      placedPeriods: placedTotal,
      requiredPeriods: requiredTotal,
      classesScheduled,
      totalClasses: problem.classes.length,
      teachersUsed: new Set(entries.map((e) => e.teacherId).filter(Boolean)).size,
      roomsUsed: new Set(entries.map((e) => e.roomId).filter(Boolean)).size,
      hardViolationCount: hardCount,
      softViolationCount: softCount,
      unplacedCount: unplaced.length,
      perClass,
    },
  };
}

function blockPriority(req: TimetableRequirement, periods: number): number {
  // Most-constrained first: room type requirement (heaviest), block size,
  // assigned teacher (teacher-bound blocks contend for one person's grid).
  let p = 0;
  if (req.requiredRoomType) p += 100;
  p += periods * 10;
  if (req.teacherId) p += 5;
  return p;
}
