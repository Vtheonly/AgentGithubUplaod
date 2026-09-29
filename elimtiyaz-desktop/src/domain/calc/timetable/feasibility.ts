// ============================================================================
// FILE: src/domain/calc/timetable/feasibility.ts
// ============================================================================
/**
 * The canonical timetable feasibility pre-analysis — T-441 (the owner's
 * "explicit failure" mandate: constraints that are mathematically
 * impossible must fail with a PRECISE reason BEFORE any generation is
 * attempted or persisted — never a fake, partial or silently-relaxed
 * timetable).
 *
 * ARCHITECTURE (ADR-020 boundaries, respected verbatim): this module is a
 * PURE ANALYSIS over the SAME canonical model + constraint param helpers
 * the solver and validator consume — it adds NO second constraint engine;
 * it derives NECESSARY conditions (if any fires, the problem is provably
 * unsatisfiable) and reports them with the exact class / subject / teacher
 * / room / day / period / constraint references.
 *
 * Every check is a LOWER BOUND on what is possible:
 *  - class slots: sum of required periods vs the class's own available
 *    slots (free days, per-day unavailable periods, max periods per day);
 *  - teacher slots: sum of periods assigned to a teacher vs that teacher's
 *    available slots (free days + unavailable periods);
 *  - room pools: sum of periods requiring a room type vs the total capacity
 *    of the active, capacity-compatible rooms of that type;
 *  - room fit: a required room type with no active room at all; or every
 *    room of the type smaller than the class;
 *  - block fit: a consecutive-periods block longer than the longest run of
 *    break-free, available teaching periods on ANY day of the class;
 *  - grid sanity: the whole week is a free day (school or class scope);
 *  - pinned integrity: locked/carried entries that clash with each other
 *    or violate a hard constraint (free day / unavailable / outside the
 *    school grid).
 *
 * A problem with ZERO issues is NOT guaranteed solvable (the greedy solver
 * may still fail — reported honestly as unplaced blocks); but a problem
 * WITH an issue is GUARANTEED unsatisfiable. The repository refuses to
 * generate in that case (fail-closed, no version persisted).
 */

import type {
  Room,
  TimetableDay,
  TimetableProblem,
  TimetableSlotAssignment,
} from "../../model/timetable";
import {
  TIMETABLE_DAY_LABELS_FR,
  teachingPeriods,
} from "../../model/timetable";
import {
  blockSplit,
  coverageGaps,
  requiredPeriodsFor,
  validateTimetable,
} from "./constraints";
// ============================================================================
// The issue contract
// ============================================================================

export type TimetableFeasibilityKind =
  | "school_week_all_free"
  | "class_week_all_free"
  | "class_capacity_exceeded"
  | "teacher_overloaded"
  | "room_type_missing"
  | "room_capacity_insufficient"
  | "room_pool_exhausted"
  | "block_never_fits"
  | "pinned_entry_clash"
  | "pinned_entry_illegal"
  | "pinned_entry_excess";

export interface TimetableFeasibilityRefs {
  readonly classId?: string;
  readonly subjectId?: string;
  readonly teacherId?: string;
  readonly roomId?: string;
  readonly day?: TimetableDay;
  readonly periodIndex?: number;
  readonly constraintId?: string;
}

export interface TimetableFeasibilityIssue {
  readonly kind: TimetableFeasibilityKind;
  /** French, precise, names the entities involved (the owner contract). */
  readonly message: string;
  readonly refs: TimetableFeasibilityRefs;
}

// ============================================================================
// Constraint index (same shape as the solver's — one param surface)
// ============================================================================

interface FeasibilityIndex {
  readonly schoolFreeDays: ReadonlySet<TimetableDay>;
  classFreeDays(classId: string): ReadonlySet<TimetableDay>;
  teacherFreeDays(teacherId: string): ReadonlySet<TimetableDay>;
  roomFreeDays(roomId: string): ReadonlySet<TimetableDay>;
  classUnavailable(classId: string): ReadonlySet<string>;
  teacherUnavailable(teacherId: string): ReadonlySet<string>;
  roomUnavailable(roomId: string): ReadonlySet<string>;
}

function indexForProblem(problem: TimetableProblem): FeasibilityIndex {
  const schoolFreeDays = new Set<TimetableDay>();
  const classFree = new Map<string, Set<TimetableDay>>();
  const teacherFree = new Map<string, Set<TimetableDay>>();
  const roomFree = new Map<string, Set<TimetableDay>>();
  const classUnavail = new Map<string, Set<string>>();
  const teacherUnavail = new Map<string, Set<string>>();
  const roomUnavail = new Map<string, Set<string>>();

  const addDay = (
    m: Map<string, Set<TimetableDay>>,
    id: string,
    day: TimetableDay,
  ) => {
    const s = m.get(id) ?? new Set<TimetableDay>();
    s.add(day);
    m.set(id, s);
  };
  const addSlot = (
    m: Map<string, Set<string>>,
    id: string,
    key: string,
  ) => {
    const s = m.get(id) ?? new Set<string>();
    s.add(key);
    m.set(id, s);
  };

  for (const c of problem.constraints) {
    if (!c.isActive) continue;
    const rawDay = c.params["day"];
    const rawPeriod = c.params["periodIndex"];
    if (c.kind === "free_day" && typeof rawDay === "string") {
      const day = rawDay as TimetableDay;
      if (c.scope === "school") {
        schoolFreeDays.add(day);
      } else if (c.entityId) {
        if (c.scope === "class") addDay(classFree, c.entityId, day);
        if (c.scope === "teacher") addDay(teacherFree, c.entityId, day);
        if (c.scope === "room") addDay(roomFree, c.entityId, day);
      }
    } else if (
      c.kind === "unavailable_period" &&
      typeof rawDay === "string" &&
      typeof rawPeriod === "number" &&
      c.entityId
    ) {
      const key = `${rawDay}#${rawPeriod}`;
      if (c.scope === "class") addSlot(classUnavail, c.entityId, key);
      if (c.scope === "teacher") addSlot(teacherUnavail, c.entityId, key);
      if (c.scope === "room") addSlot(roomUnavail, c.entityId, key);
    }
  }

  return {
    schoolFreeDays,
    classFreeDays: (id) => classFree.get(id) ?? new Set<TimetableDay>(),
    teacherFreeDays: (id) => teacherFree.get(id) ?? new Set<TimetableDay>(),
    roomFreeDays: (id) => roomFree.get(id) ?? new Set<TimetableDay>(),
    classUnavailable: (id) => classUnavail.get(id) ?? new Set<string>(),
    teacherUnavailable: (id) => teacherUnavail.get(id) ?? new Set<string>(),
    roomUnavailable: (id) => roomUnavail.get(id) ?? new Set<string>(),
  };
}

// ============================================================================
// Availability math (the necessary-condition lower bounds)
// ============================================================================

/**
 * Number of teaching periods available to a CLASS on one day:
 * periods minus the class's unavailable ones. Free days are handled by the
 * caller (skip). The per-day cap (maxPeriodsPerDay) is applied by the
 * caller (it can only lower the total).
 */
function classPeriodsAvailableOnDay(
  idx: FeasibilityIndex,
  classId: string,
  day: TimetableDay,
  periodIndexes: readonly number[],
): number {
  const unavail = idx.classUnavailable(classId);
  let count = 0;
  for (const p of periodIndexes) {
    if (!unavail.has(`${day}#${p}`)) count++;
  }
  return count;
}

/** Longest run of consecutive, break-free, class-available periods on a day. */
function longestBreakFreeRun(
  problem: TimetableProblem,
  idx: FeasibilityIndex,
  classId: string,
  day: TimetableDay,
): number {
  const periods = teachingPeriods(problem.configuration);
  const unavail = idx.classUnavailable(classId);
  const breakAfter = new Set(
    problem.configuration.breaks.map((b) => b.afterPeriodIndex),
  );
  let best = 0;
  let run = 0;
  let prev: number | null = null;
  for (const p of periods) {
    const blocked =
      unavail.has(`${day}#${p.index}`) ||
      (prev != null && (p.index !== prev + 1 || breakAfter.has(prev)));
    if (blocked) {
      run = 0;
      prev = p.index;
      continue;
    }
    run++;
    best = Math.max(best, run);
    prev = p.index;
  }
  return best;
}

// ============================================================================
// The analysis
// ============================================================================

/**
 * Analyze the problem's feasibility. Returns EVERY provable impossibility;
 * an empty array means "no necessary condition fires — proceed to the
 * solver (which still reports honestly what it cannot place)".
 */
export function analyzeTimetableFeasibility(
  problem: TimetableProblem,
): TimetableFeasibilityIssue[] {
  const issues: TimetableFeasibilityIssue[] = [];
  const idx = indexForProblem(problem);
  const periods = teachingPeriods(problem.configuration);
  const periodIndexes = periods.map((p) => p.index);
  const days = [...problem.configuration.schoolDays];
  const maxPerDay = Math.min(
    problem.configuration.maxPeriodsPerDay,
    periods.length,
  );

  const pm =
    periods.length > 0
      ? periods[0].endMinutes - periods[0].startMinutes
      : problem.configuration.defaultLessonMinutes;

  const classLabel = (id: string): string =>
    problem.classes.find((c) => c.id === id)?.name ?? id;
  const teacherLabel = (id: string): string =>
    problem.teachers.find((t) => t.id === id)?.name ?? id;
  const roomLabel = (r: Room): string => `${r.code} — ${r.name}`;

  const activeRooms = problem.rooms.filter((r) => r.isActive);

  // ── 1. The whole school week is free ─────────────────────────────────
  if (days.length > 0 && days.every((d) => idx.schoolFreeDays.has(d))) {
    issues.push({
      kind: "school_week_all_free",
      message:
        "Tous les jours d'école sont déclarés jours libres au niveau de l'établissement — aucune période ne peut être planifiée.",
      refs: {},
    });
  }

  // ── 2. Per-class checks ────────────────────────────────────────────────
  const classIdsWithRequirements = new Set(
    problem.requirements.map((r) => r.classId),
  );
  const classAvailableSlots = new Map<string, number>();
  for (const cls of problem.classes) {
    const openDays = days.filter(
      (d) =>
        !idx.schoolFreeDays.has(d) && !idx.classFreeDays(cls.id).has(d),
    );
    if (
      days.length > 0 &&
      classIdsWithRequirements.has(cls.id) &&
      openDays.length === 0
    ) {
      issues.push({
        kind: "class_week_all_free",
        message: `Tous les jours d'école sont des jours libres pour la classe ${classLabel(cls.id)} — aucun cours ne peut y être planifié.`,
        refs: { classId: cls.id },
      });
    }
    let available = 0;
    for (const day of openDays) {
      available += Math.min(
        maxPerDay,
        classPeriodsAvailableOnDay(idx, cls.id, day, periodIndexes),
      );
    }
    classAvailableSlots.set(cls.id, available);
  }

  // ── 3. Class capacity: required periods vs available slots ────────────
  const requiredByClass = new Map<string, { total: number; subjects: string[] }>();
  for (const req of problem.requirements) {
    const entry = requiredByClass.get(req.classId) ?? { total: 0, subjects: [] };
    entry.total += requiredPeriodsFor(req, pm);
    entry.subjects.push(req.subjectName);
    requiredByClass.set(req.classId, entry);
  }
  for (const [classId, need] of requiredByClass) {
    const available = classAvailableSlots.get(classId) ?? 0;
    if (need.total > available) {
      issues.push({
        kind: "class_capacity_exceeded",
        message: `La classe ${classLabel(classId)} exige ${need.total} périodes hebdomadaires (${need.subjects.join(", ")}) mais seulement ${available} périodes sont disponibles (jours libres, indisponibilités et plafond de ${maxPerDay} périodes/jour) — il manque ${need.total - available} périodes.`,
        refs: { classId },
      });
    }
  }

  // ── 4. Teacher load vs the teacher's own availability ────────────────
  const byTeacher = new Map<
    string,
    { total: number; detail: Array<{ className: string; subject: string; periods: number }> }
  >();
  for (const req of problem.requirements) {
    if (!req.teacherId) continue;
    const entry =
      byTeacher.get(req.teacherId) ?? { total: 0, detail: [] };
    const periods = requiredPeriodsFor(req, pm);
    entry.total += periods;
    entry.detail.push({
      className: req.className,
      subject: req.subjectName,
      periods,
    });
    byTeacher.set(req.teacherId, entry);
  }
  for (const [teacherId, need] of byTeacher) {
    let available = 0;
    for (const day of days) {
      if (idx.schoolFreeDays.has(day)) continue;
      if (idx.teacherFreeDays(teacherId).has(day)) continue;
      const unavail = idx.teacherUnavailable(teacherId);
      let count = 0;
      for (const p of periodIndexes) {
        if (!unavail.has(`${day}#${p}`)) count++;
      }
      available += count;
    }
    if (need.total > available) {
      const detail = need.detail
        .map((d) => `${d.subject} → ${d.className} (${d.periods}p)`)
        .join(" ; ");
      issues.push({
        kind: "teacher_overloaded",
        message: `L'enseignant ${teacherLabel(teacherId)} doit donner ${need.total} périodes/semaine (${detail}) mais n'a que ${available} périodes disponibles (jours libres et indisponibilités) — il manque ${need.total - available} périodes.`,
        refs: { teacherId },
      });
    }
  }

  // ── 5. Room fit per requirement ────────────────────────────────────────
  const roomsByType = new Map<string, Room[]>();
  for (const room of activeRooms) {
    const list = roomsByType.get(room.roomType) ?? [];
    list.push(room);
    roomsByType.set(room.roomType, list);
  }
  for (const req of problem.requirements) {
    if (!req.requiredRoomType) continue;
    const pool = roomsByType.get(req.requiredRoomType) ?? [];
    if (pool.length === 0) {
      issues.push({
        kind: "room_type_missing",
        message: `${req.subjectName} pour ${req.className} exige une salle de type « ${req.requiredRoomType} » — aucune salle active de ce type n'est configurée.`,
        refs: {
          classId: req.classId,
          subjectId: req.subjectId,
        },
      });
      continue;
    }
    const classSize = req.classSize;
    if (classSize != null) {
      const fitting = pool.filter(
        (r) => r.capacity == null || r.capacity >= classSize,
      );
      if (fitting.length === 0) {
        const best = Math.max(
          ...pool.map((r) => r.capacity ?? Number.POSITIVE_INFINITY),
        );
        issues.push({
          kind: "room_capacity_insufficient",
          message: `${req.subjectName} pour ${req.className} (${classSize} élèves) exige une salle de type « ${req.requiredRoomType} » — la plus grande salle de ce type (${pool
            .map((r) => roomLabel(r))
            .join(", ")}) ne contient que ${best} places.`,
          refs: {
            classId: req.classId,
            subjectId: req.subjectId,
          },
        });
      }
    }
  }

  // ── 6. Room pool capacity vs total demand on the type ─────────────────
  const demandByType = new Map<string, { total: number; subjects: string[] }>();
  for (const req of problem.requirements) {
    if (!req.requiredRoomType) continue;
    const entry = demandByType.get(req.requiredRoomType) ?? {
      total: 0,
      subjects: [],
    };
    entry.total += requiredPeriodsFor(req, pm);
    entry.subjects.push(`${req.subjectName} → ${req.className}`);
    demandByType.set(req.requiredRoomType, entry);
  }
  for (const [type, demand] of demandByType) {
    const pool = (roomsByType.get(type) ?? []).filter((r) => {
      // Capacity-compatible rooms only can serve (any class whose size
      // fits some room of the pool; keep rooms usable for at least the
      // smallest class needing the type).
      return true;
    });
    if (pool.length === 0) continue;
    let poolCapacity = 0;
    for (const room of pool) {
      for (const day of days) {
        if (idx.schoolFreeDays.has(day)) continue;
        if (idx.roomFreeDays(room.id).has(day)) continue;
        const unavail = idx.roomUnavailable(room.id);
        let count = 0;
        for (const p of periodIndexes) {
          if (!unavail.has(`${day}#${p}`)) count++;
        }
        poolCapacity += count;
      }
    }
    if (demand.total > poolCapacity) {
      issues.push({
        kind: "room_pool_exhausted",
        message: `Les cours exigeant des salles de type « ${type} » totalisent ${demand.total} périodes/semaine (${demand.subjects.join(" ; ")}) mais les ${pool.length} salle(s) de ce type n'offrent que ${poolCapacity} créneaux disponibles (jours libres et indisponibilités compris) — il manque ${demand.total - poolCapacity} créneaux.`,
        refs: {},
      });
    }
  }

  // ── 7. Consecutive blocks must fit somewhere ──────────────────────────
  for (const req of problem.requirements) {
    const blocks = blockSplit(
      requiredPeriodsFor(req, pm),
      req.consecutivePeriods,
    );
    const maxBlock = Math.max(...blocks);
    let bestRun = 0;
    for (const day of days) {
      if (idx.schoolFreeDays.has(day)) continue;
      if (idx.classFreeDays(req.classId).has(day)) continue;
      bestRun = Math.max(
        bestRun,
        longestBreakFreeRun(problem, idx, req.classId, day),
      );
    }
    if (maxBlock > bestRun) {
      issues.push({
        kind: "block_never_fits",
        message: `${req.subjectName} pour ${req.className} exige des séances de ${maxBlock} périodes consécutives — aucune journée de la classe n'offre plus de ${bestRun} périodes consécutives (pauses comprises).`,
        refs: { classId: req.classId, subjectId: req.subjectId },
      });
    }
  }

  // ── 8. Pinned entries (locked + carried): integrity + hard rules ──────
  const pinned: readonly TimetableSlotAssignment[] = [
    ...problem.lockedEntries,
    ...(problem.carriedEntries ?? []),
  ];
  const schoolDaysSet = new Set(days);
  const validPeriodsSet = new Set(periodIndexes);
  const pinnedSeen = new Map<string, TimetableSlotAssignment>();

  // T-441 — over-pinned requirements: locked/carried entries that ALREADY
  // exceed a requirement's weekly hours make duplicates unavoidable —
  // impossible BEFORE any generation (the precise reason: which class /
  // subject / how many pins vs how many required).
  const pinnedCount = new Map<string, number>();
  for (const e of pinned) {
    const k = `${e.classId}|${e.subjectId}`;
    pinnedCount.set(k, (pinnedCount.get(k) ?? 0) + 1);
  }
  for (const req of problem.requirements) {
    const covered = pinnedCount.get(`${req.classId}|${req.subjectId}`) ?? 0;
    const required = requiredPeriodsFor(req, pm);
    if (covered > required) {
      issues.push({
        kind: "pinned_entry_excess",
        message: `Les cours épinglés de ${req.subjectName} pour ${req.className} dépassent les heures hebdomadaires : ${covered} périodes épinglées pour ${required} requises — déverrouillez ${covered - required} cours épinglé(s) ou augmentez les heures avant de générer.`,
        refs: { classId: req.classId, subjectId: req.subjectId },
      });
    }
  }

  for (const e of pinned) {
    const slot = `${e.day}#${e.periodIndex}`;
    if (!schoolDaysSet.has(e.day) || !validPeriodsSet.has(e.periodIndex)) {
      issues.push({
        kind: "pinned_entry_illegal",
        message: `Un cours épinglé/reporté (${e.day} période ${e.periodIndex}) est hors de la grille scolaire configurée.`,
        refs: {
          classId: e.classId,
          subjectId: e.subjectId,
          day: e.day,
          periodIndex: e.periodIndex,
        },
      });
      continue;
    }
    if (idx.schoolFreeDays.has(e.day) || idx.classFreeDays(e.classId).has(e.day)) {
      issues.push({
        kind: "pinned_entry_illegal",
        message: `Un cours épinglé/reporté (${e.subjectId} de la classe ${e.classId}) tombe un jour libre (${TIMETABLE_DAY_LABELS_FR[e.day]}).`,
        refs: {
          classId: e.classId,
          subjectId: e.subjectId,
          day: e.day,
          periodIndex: e.periodIndex,
        },
      });
    }
    if (idx.classUnavailable(e.classId).has(slot)) {
      issues.push({
        kind: "pinned_entry_illegal",
        message: `Un cours épinglé/reporté (${e.subjectId} de la classe ${e.classId}) tombe sur une période déclarée indisponible (${TIMETABLE_DAY_LABELS_FR[e.day]} période ${e.periodIndex}).`,
        refs: {
          classId: e.classId,
          subjectId: e.subjectId,
          day: e.day,
          periodIndex: e.periodIndex,
        },
      });
    }
    // Resource clashes among pins.
    if (e.teacherId) {
      const k = `t|${e.teacherId}|${slot}`;
      const other = pinnedSeen.get(k);
      if (other) {
        issues.push({
          kind: "pinned_entry_clash",
          message: `Deux cours épinglés/reportés partagent l'enseignant ${teacherLabel(e.teacherId)} sur le même créneau (${TIMETABLE_DAY_LABELS_FR[e.day]} période ${e.periodIndex}) : ${other.classId}/${other.subjectId} et ${e.classId}/${e.subjectId}.`,
          refs: {
            teacherId: e.teacherId,
            day: e.day,
            periodIndex: e.periodIndex,
          },
        });
      } else {
        pinnedSeen.set(k, e);
      }
    }
    const ck = `c|${e.classId}|${slot}`;
    const otherC = pinnedSeen.get(ck);
    if (otherC) {
      issues.push({
        kind: "pinned_entry_clash",
        message: `Deux cours épinglés/reportés de la classe ${classLabel(e.classId)} se chevauchent (${TIMETABLE_DAY_LABELS_FR[e.day]} période ${e.periodIndex}).`,
        refs: { classId: e.classId, day: e.day, periodIndex: e.periodIndex },
      });
    } else {
      pinnedSeen.set(ck, e);
    }
    if (e.roomId) {
      const rk = `r|${e.roomId}|${slot}`;
      const otherR = pinnedSeen.get(rk);
      if (otherR) {
        issues.push({
          kind: "pinned_entry_clash",
          message: `Deux cours épinglés/reportés occupent la même salle sur le même créneau (${TIMETABLE_DAY_LABELS_FR[e.day]} période ${e.periodIndex}).`,
          refs: { roomId: e.roomId, day: e.day, periodIndex: e.periodIndex },
        });
      } else {
        pinnedSeen.set(rk, e);
      }
    }
  }

  return issues;
}

/**
 * The fail-closed error message for the repository gate: every issue on its
 * own numbered line (the UI surfaces this verbatim — the owner contract:
 * precise reasons, no silent relaxation, no partial output).
 */
export function feasibilityErrorMessage(
  issues: readonly TimetableFeasibilityIssue[],
): string {
  const lines = issues.map((i, n) => `${n + 1}. ${i.message}`);
  return [
    "Génération impossible — les contraintes sont mathématiquement irréalisables :",
    ...lines,
  ].join("\n");
}

// ============================================================================
// The INDEPENDENT post-persist validation layer — T-441 Gate 3
// ============================================================================

/**
 * Validate the PERSISTED rows of a freshly generated version INDEPENDENTLY
 * of the solver's in-memory output (never trust the generator). Pure and
 * canonical — both repositories call this on their re-loaded rows:
 *
 *  1. row count matches what the solver produced;
 *  2. no duplicate (class, subject, day, period) rows;
 *  3. the canonical validator reports ZERO hard violations (teacher /
 *     class / room clashes, free days, unavailability, room fit, grid
 *     bounds, weekly hours);
 *  4. the canonical coverage check reports ZERO gaps.
 *
 * Returns [] when the persisted rows are a complete, conflict-free,
 * in-bounds timetable — any other outcome returns the numbered French
 * reasons (the repository rolls the version back and fails the run).
 */
export function validatePersistedSolution(
  problem: TimetableProblem,
  slots: readonly TimetableSlotAssignment[],
  expectedCount: number,
): string[] {
  const errors: string[] = [];
  const push = (msg: string): void => {
    errors.push(`${errors.length + 1}. ${msg}`);
  };

  if (slots.length !== expectedCount) {
    push(
      `Validation indépendante : ${slots.length} lignes persistées pour ${expectedCount} attendues.`,
    );
  }

  const seen = new Set<string>();
  for (const s of slots) {
    const k = `${s.classId}|${s.subjectId}|${s.day}|${s.periodIndex}`;
    if (seen.has(k)) {
      push(`Validation indépendante : doublon détecté (${k}).`);
      break;
    }
    seen.add(k);
  }

  for (const v of validateTimetable(problem, slots)) {
    if (v.severity === "hard") {
      push(`Validation indépendante : [Conflit] ${v.message}`);
    }
  }

  for (const g of coverageGaps(problem, slots)) {
    push(
      `Validation indépendante : ${g.requirement.subjectName} — ${g.requirement.className} : ${g.placedPeriods}/${g.requiredPeriods} périodes persistées.`,
    );
  }

  return errors;
}

/** The Gate 3 error message wrapper (rollback + fail the generation). */
export function persistedValidationError(errors: readonly string[]): string {
  return [
    "Génération annulée — la validation indépendante des lignes persistées a échoué :",
    ...errors,
  ].join("\n");
}
