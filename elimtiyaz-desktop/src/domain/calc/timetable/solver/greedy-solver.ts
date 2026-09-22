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
 *     blocking their slots.
 *  4. Order blocks most-constrained-first (required room type, block size,
 *     teacher load, then stable id tiebreaks — a total order, no
 *     randomness).
 *  5. Greedy placement: scan day/period starts in a round-robin across
 *     days (spread), find a run of consecutive free teaching periods with
 *     no labeled break inside, with a compatible free room and a free
 *     teacher, respecting hard constraints.
 *  6. Single-pass repair: for each unplaced block, try displacing a
 *     lower-priority block into an alternative slot to free room/teacher.
 *  7. Evaluate the FULL result with the canonical validator
 *     (constraints.ts) — the solution's violation report is authoritative.
 *
 * Impossibility is HONEST: unplaced blocks carry a French reason
 * (conflict explanation contract); the status is partial/invalid.
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
import type { TimetableSolver, TimetableSolveOptions } from "./solver-types";

// ============================================================================
// Busy grids — O(1) slot lookups
// ============================================================================

class BusyGrid {
  private readonly classBusy = new Set<string>();
  private readonly teacherBusy = new Set<string>();
  private readonly roomBusy = new Set<string>();

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

  occupy(entry: TimetableSlotAssignment): void {
    const k = BusyGrid.k(entry.day, entry.periodIndex);
    this.classBusy.add(`${entry.classId}|${k}`);
    if (entry.teacherId) this.teacherBusy.add(`${entry.teacherId}|${k}`);
    if (entry.roomId) this.roomBusy.add(`${entry.roomId}|${k}`);
  }

  release(entry: TimetableSlotAssignment): void {
    const k = BusyGrid.k(entry.day, entry.periodIndex);
    this.classBusy.delete(`${entry.classId}|${k}`);
    if (entry.teacherId) this.teacherBusy.delete(`${entry.teacherId}|${k}`);
    if (entry.roomId) this.roomBusy.delete(`${entry.roomId}|${k}`);
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
// v1.1.0 — same deterministic OUTPUT as v1.0.0; adds the T-409 progress
// channel + the solveAsync yielding boundary (instrumentation only).
export const GREEDY_SOLVER_BUILD = "v1.1.0+20260922";

/** Drain cadence for solveAsync: yield to the renderer every N work units. */
const ASYNC_YIELD_EVERY = 20;

/** One macrotask — lets the renderer paint between solver work units. */
function yieldToRenderer(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export function createGreedySolver(): TimetableSolver {
  return {
    id: GREEDY_SOLVER_ID,
    build: GREEDY_SOLVER_BUILD,
    description:
      "Solveur natif TypeScript (constructif déterministe + réparation) — aucune dépendance externe.",

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

  // ── Step 1: locked entries occupy the grid first (manual pins). ─────────
  for (const locked of problem.lockedEntries) {
    grid.occupy(locked);
    entries.push(locked);
    if (locked.roomId) {
      bumpAffinity(locked.classId, locked.roomId);
    }
  }

  // ── Step 2: build the block list. ───────────────────────────────────────
  // T-409: the progress denominator is FIXED before the first event — a
  // counting pass over the SAME canonical blockSplit (no second
  // implementation). Work units: requirements indexed + blocks processed
  // + 1 validation pass.
  const requirementsTotal = problem.requirements.length;
  let totalBlocks = 0;
  for (const req of problem.requirements) {
    totalBlocks += blockSplit(
      requiredPeriodsFor(req, periodMinutesValue),
      req.consecutivePeriods,
    ).length;
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
  for (const req of problem.requirements) {
    const requiredPeriods = requiredPeriodsFor(req, periodMinutesValue);
    for (const blockPeriods of blockSplit(requiredPeriods, req.consecutivePeriods)) {
      blocks.push({
        requirement: req,
        periods: blockPeriods,
        priority: blockPriority(req, blockPeriods),
      });
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
  let nextLessonGroup = problem.lockedEntries.length + 1;

  const tryPlaceBlock = (block: LessonBlock): string | null => {
    const req = block.requirement;
    const cls = classById.get(req.classId);
    const sizeOk = (room: Room | null): boolean => {
      if (!room) return !req.requiredRoomType;
      if (req.requiredRoomType && room.roomType !== req.requiredRoomType) return false;
      if (
        req.classSize != null &&
        room.capacity != null &&
        req.classSize > room.capacity
      ) {
        return false;
      }
      return true;
    };

    const startDay =
      (classDayCursor.get(req.classId) ?? 0) % Math.max(1, days.length);

    for (let dayOffset = 0; dayOffset < days.length; dayOffset++) {
      const day = days[(startDay + dayOffset) % days.length];
      // HARD free days: school-wide and class-scope (teacher/room free days
      // are checked in their own availability tests below).
      if (cidx.freeDays.school.has(day)) continue;
      if (cidx.freeDays.classes.get(req.classId)?.has(day)) continue;

      // Count periods already used by this class today (max_periods_per_day).
      const usedToday = entries.filter(
        (e) => e.classId === req.classId && e.day === day,
      ).length;
      if (usedToday + block.periods > maxPeriodsPerDay) continue;

      for (const startPeriod of validPeriods) {
        // Need `block.periods` CONSECUTIVE periods starting at startPeriod.
        const runPeriods: number[] = [startPeriod];
        let runOk = validPeriods.includes(startPeriod);
        if (runOk) {
          for (let k = 1; k < block.periods; k++) {
            const next = startPeriod + k;
            if (!validPeriods.includes(next)) {
              runOk = false;
              break;
            }
            // No labeled break inside the block (strict adjacency).
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

        // Class availability across the run.
        if (
          runPeriods.some(
            (p) =>
              !grid.classFree(day, p, req.classId) ||
              isUnavailable(day, p, req.classId, req.teacherId, null),
          )
        ) {
          continue;
        }

        // Teacher availability across the run (incl. teacher free days).
        if (
          req.teacherId &&
          (cidx.freeDays.teachers.get(req.teacherId)?.has(day) ||
            runPeriods.some((p) => !grid.teacherFree(day, p, req.teacherId)))
        ) {
          continue;
        }

        // Room selection: compatible rooms ordered by class affinity
        // (homeroom stickiness, deterministic), null as the LAST resort for
        // subjects with no required room type.
        let chosen: Room | null | undefined = undefined;
        let orderedCandidates: Array<Room | null>;
        if (req.requiredRoomType) {
          orderedCandidates = [...(roomsByType.get(req.requiredRoomType) ?? [])]
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
          if (room == null) {
            if (!req.requiredRoomType) {
              chosen = null;
              break;
            }
            continue;
          }
          if (
            sizeOk(room) &&
            !isFreeDay(day, req.classId, req.teacherId, room.id) &&
            runPeriods.every(
              (p) =>
                grid.roomFree(day, p, room.id) &&
                !isUnavailable(day, p, req.classId, req.teacherId, room.id),
            )
          ) {
            chosen = room;
            break;
          }
        }
        if (chosen === undefined) continue;
        if (req.requiredRoomType && chosen == null) continue;

        // Place the block.
        const lessonGroup = nextLessonGroup++;
        for (const p of runPeriods) {
          const entry: TimetableSlotAssignment = {
            classId: req.classId,
            subjectId: req.subjectId,
            teacherId: req.teacherId,
            roomId: chosen ? chosen.id : null,
            day,
            periodIndex: p,
            lessonGroup,
          };
          entries.push(entry);
          grid.occupy(entry);
        }
        if (chosen) {
          for (let k = 0; k < block.periods; k++) {
            bumpAffinity(req.classId, chosen.id);
          }
        }
        classDayCursor.set(
          req.classId,
          ((startDay + dayOffset + 1) % Math.max(1, days.length)),
        );
        return null;
      }
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

  // ── Step 4: single repair pass for unplaced blocks (room contention). ──
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
      // Simple repair: retry once (locked pins from a previous generation
      // may have been the obstacle; a second pass after other placements
      // settled occasionally finds gaps). Honest failure otherwise.
      const reason = tryPlaceBlock(block);
      if (reason) stillUnplaced.push(u);
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
  const violations: TimetableViolation[] = validateTimetable(problem, entries);
  const hardCount = violations.filter((v) => v.severity === "hard").length;
  const softCount = violations.length - hardCount;

  const requiredTotal = blocks.reduce((sum, b) => sum + b.periods, 0);
  const placedTotal = entries.length - problem.lockedEntries.length;
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

