// ============================================================================
// FILE: src/domain/calc/timetable/constraints.ts
// ============================================================================
/**
 * The canonical timetable constraint engine — T-404 (ADR-020 §2).
 *
 * ONE validator serves BOTH:
 *  - post-generation evaluation (the solver's output must pass it), and
 *  - LIVE validation of manual adjustments (before any write).
 *
 * Hard violations invalidate the timetable; soft violations are reported
 * with explanations (academic-rules.md §8: "Missing curriculum hours or
 * impossible constraint combinations must never be silently converted into
 * zero hours, omitted lessons, or fabricated assignments").
 *
 * Resource clashes covered (SCHED-101 closed at the domain level): teacher,
 * class AND room double-booking.
 */

import type {
  Room,
  TimetableConfiguration,
  TimetableConstraint,
  TimetableDay,
  TimetableProblem,
  TimetableRequirement,
  TimetableSlotAssignment,
  TimetableViolation,
  TimetableViolationRefs,
} from "../../model/timetable";
import {
  constraintDayParam,
  constraintIntParam,
  constraintPeriodParam,
  teachingPeriods,
} from "../../model/timetable";

// ============================================================================
// Slot key helpers
// ============================================================================

function slotKeyString(day: TimetableDay, periodIndex: number): string {
  return `${day}#${periodIndex}`;
}

// ============================================================================
// Resource-clash detection (hard, always)
// ============================================================================

function resourceClashes(
  entries: readonly TimetableSlotAssignment[],
): TimetableViolation[] {
  const violations: TimetableViolation[] = [];

  const teacherMap = new Map<string, TimetableSlotAssignment>();
  const classMap = new Map<string, TimetableSlotAssignment>();
  const roomMap = new Map<string, TimetableSlotAssignment>();

  for (const e of entries) {
    const key = slotKeyString(e.day, e.periodIndex);

    if (e.teacherId) {
      const mapKey = `${e.teacherId}|${key}`;
      if (teacherMap.has(mapKey)) {
        violations.push({
          severity: "hard",
          kind: "teacher_double_booking",
          message: `L'enseignant est affecté à deux cours en même temps (${e.day}, période ${e.periodIndex}).`,
          refs: {
            teacherId: e.teacherId,
            classId: e.classId,
            subjectId: e.subjectId,
            day: e.day,
            periodIndex: e.periodIndex,
          },
        });
      } else {
        teacherMap.set(mapKey, e);
      }
    }

    const classMapKey = `${e.classId}|${key}`;
    if (classMap.has(classMapKey)) {
      violations.push({
        severity: "hard",
        kind: "class_double_booking",
        message: `La classe a deux cours en même temps (${e.day}, période ${e.periodIndex}).`,
        refs: {
          classId: e.classId,
          subjectId: e.subjectId,
          day: e.day,
          periodIndex: e.periodIndex,
        },
      });
    } else {
      classMap.set(classMapKey, e);
    }

    if (e.roomId) {
      const mapKey = `${e.roomId}|${key}`;
      if (roomMap.has(mapKey)) {
        violations.push({
          severity: "hard",
          kind: "room_double_booking",
          message: `Deux cours occupent la même salle en même temps (${e.day}, période ${e.periodIndex}).`,
          refs: {
            roomId: e.roomId,
            classId: e.classId,
            day: e.day,
            periodIndex: e.periodIndex,
          },
        });
      } else {
        roomMap.set(mapKey, e);
      }
    }
  }

  return violations;
}

// ============================================================================
// Active constraint index (scope-aware lookup)
// ============================================================================

interface ActiveConstraints {
  readonly school: readonly TimetableConstraint[];
  forClass(classId: string): readonly TimetableConstraint[];
  forTeacher(teacherId: string): readonly TimetableConstraint[];
  forRoom(roomId: string): readonly TimetableConstraint[];
}

function indexConstraints(
  constraints: readonly TimetableConstraint[],
): ActiveConstraints {
  const active = constraints.filter((c) => c.isActive);
  const school = active.filter((c) => c.scope === "school");
  const byClass = new Map<string, TimetableConstraint[]>();
  const byTeacher = new Map<string, TimetableConstraint[]>();
  const byRoom = new Map<string, TimetableConstraint[]>();
  for (const c of active) {
    if (!c.entityId) continue;
    if (c.scope === "class") {
      byClass.set(c.entityId, [...(byClass.get(c.entityId) ?? []), c]);
    } else if (c.scope === "teacher") {
      byTeacher.set(c.entityId, [...(byTeacher.get(c.entityId) ?? []), c]);
    } else if (c.scope === "room") {
      byRoom.set(c.entityId, [...(byRoom.get(c.entityId) ?? []), c]);
    }
  }
  return {
    school,
    forClass(classId) {
      return [...school, ...(byClass.get(classId) ?? [])];
    },
    forTeacher(teacherId) {
      return [...school, ...(byTeacher.get(teacherId) ?? [])];
    },
    forRoom(roomId) {
      return [...school, ...(byRoom.get(roomId) ?? [])];
    },
  };
}

// ============================================================================
// Per-entry hard checks: free days, unavailable periods, room fit
// ============================================================================

function subjectLabel(who: string): string {
  return who === "class"
    ? "La classe"
    : who === "teacher"
      ? "L'enseignant"
      : "La salle";
}

function entryConstraintViolations(
  entry: TimetableSlotAssignment,
  problem: TimetableProblem,
  indexed: ActiveConstraints,
  roomsById: Map<string, Room>,
  requirement: TimetableRequirement | undefined,
): TimetableViolation[] {
  const violations: TimetableViolation[] = [];
  const refs: TimetableViolationRefs = {
    classId: entry.classId,
    subjectId: entry.subjectId,
    teacherId: entry.teacherId ?? undefined,
    roomId: entry.roomId ?? undefined,
    day: entry.day,
    periodIndex: entry.periodIndex,
  };

  const relevant: Array<{ c: TimetableConstraint; who: string }> = [];
  for (const c of indexed.forClass(entry.classId)) {
    relevant.push({ c, who: "class" });
  }
  if (entry.teacherId) {
    for (const c of indexed.forTeacher(entry.teacherId)) {
      relevant.push({ c, who: "teacher" });
    }
  }
  if (entry.roomId) {
    for (const c of indexed.forRoom(entry.roomId)) {
      relevant.push({ c, who: "room" });
    }
  }

  for (const { c, who } of relevant) {
    switch (c.kind) {
      case "free_day": {
        const day = constraintDayParam(c);
        if (day === entry.day) {
          violations.push({
            severity: c.severity,
            kind: "free_day",
            message: `${subjectLabel(who)} est en jour libre le ${entry.day} (${c.severity === "hard" ? "contrainte stricte" : "préférence"}).`,
            refs,
          });
        }
        break;
      }
      case "unavailable_period": {
        const day = constraintDayParam(c);
        const period = constraintPeriodParam(c);
        if (day === entry.day && period === entry.periodIndex) {
          violations.push({
            severity: c.severity,
            kind: "unavailable_period",
            message: `${subjectLabel(who)} n'est pas disponible le ${entry.day} période ${entry.periodIndex}.`,
            refs,
          });
        }
        break;
      }
      default:
        break;
    }
  }

  // Room fit: type compatibility + capacity (hard by design, 0109 §3).
  if (entry.roomId) {
    const room = roomsById.get(entry.roomId);
    if (!room) {
      violations.push({
        severity: "hard",
        kind: "room_not_found",
        message: `Salle inconnue (${entry.roomId}).`,
        refs,
      });
    } else {
      if (
        requirement?.requiredRoomType &&
        room.roomType !== requirement.requiredRoomType
      ) {
        violations.push({
          severity: "hard",
          kind: "room_type_mismatch",
          message: `La matière exige une salle de type « ${requirement.requiredRoomType} » mais la salle affectée est de type « ${room.roomType} ».`,
          refs,
        });
      }
      if (
        requirement?.classSize != null &&
        room.capacity != null &&
        requirement.classSize > room.capacity
      ) {
        violations.push({
          severity: "hard",
          kind: "room_capacity_exceeded",
          message: `La classe (${requirement.classSize} élèves) dépasse la capacité de la salle (${room.capacity}).`,
          refs,
        });
      }
    }
  } else if (requirement?.requiredRoomType) {
    violations.push({
      severity: "hard",
      kind: "room_required",
      message: `La matière exige une salle de type « ${requirement.requiredRoomType} » mais aucune salle n'est affectée.`,
      refs,
    });
  }

  return violations;
}

// ============================================================================
// Day/week aggregate checks
// ============================================================================

function aggregateViolations(
  entries: readonly TimetableSlotAssignment[],
  problem: TimetableProblem,
  indexed: ActiveConstraints,
): TimetableViolation[] {
  const violations: TimetableViolation[] = [];
  const periods = teachingPeriods(problem.configuration);
  const firstPeriod = periods[0]?.index ?? 1;
  const lastPeriod = periods[periods.length - 1]?.index ?? 1;
  const lunchBreak =
    problem.configuration.breaks.find((b) =>
      b.label.toLowerCase().includes("déjeuner"),
    ) ??
    problem.configuration.breaks.find((b) => b.startMinutes >= 12 * 60);
  const midDayMinutes = lunchBreak?.startMinutes ?? 13 * 60;

  interface DayBucket {
    entity: string;
    isTeacher: boolean;
    day: TimetableDay;
    entries: TimetableSlotAssignment[];
  }
  const buckets = new Map<string, DayBucket>();
  for (const e of entries) {
    const ck = `class|${e.classId}|${e.day}`;
    const cb = buckets.get(ck) ?? {
      entity: e.classId,
      isTeacher: false,
      day: e.day,
      entries: [],
    };
    cb.entries.push(e);
    buckets.set(ck, cb);
    if (e.teacherId) {
      const tk = `teacher|${e.teacherId}|${e.day}`;
      const tb = buckets.get(tk) ?? {
        entity: e.teacherId,
        isTeacher: true,
        day: e.day,
        entries: [],
      };
      tb.entries.push(e);
      buckets.set(tk, tb);
    }
  }

  for (const bucket of buckets.values()) {
    const who = bucket.isTeacher ? "L'enseignant" : "La classe";
    const constraintsFor = bucket.isTeacher
      ? indexed.forTeacher(bucket.entity)
      : indexed.forClass(bucket.entity);
    const sorted = [...bucket.entries].sort((a, b) => a.periodIndex - b.periodIndex);
    const baseRefs: TimetableViolationRefs = {
      classId: bucket.isTeacher ? undefined : bucket.entity,
      teacherId: bucket.isTeacher ? bucket.entity : undefined,
      day: bucket.day,
    };

    for (const c of constraintsFor) {
      switch (c.kind) {
        case "max_daily_lessons": {
          const max = constraintIntParam(c, "max");
          if (max != null && sorted.length > max) {
            violations.push({
              severity: c.severity,
              kind: "max_daily_lessons",
              message: `${who} a ${sorted.length} périodes le ${bucket.day} (maximum ${max}).`,
              refs: baseRefs,
            });
          }
          break;
        }
        case "max_consecutive": {
          const max = constraintIntParam(c, "max");
          if (max != null) {
            let run = 1;
            let worst = 1;
            for (let i = 1; i < sorted.length; i++) {
              run =
                sorted[i].periodIndex === sorted[i - 1].periodIndex + 1
                  ? run + 1
                  : 1;
              worst = Math.max(worst, run);
            }
            if (worst > max) {
              violations.push({
                severity: c.severity,
                kind: "max_consecutive",
                message: `${who} a ${worst} périodes consécutives le ${bucket.day} (maximum ${max}).`,
                refs: baseRefs,
              });
            }
          }
          break;
        }
        case "minimize_gaps": {
          if (sorted.length >= 2) {
            let gaps = 0;
            for (let i = 1; i < sorted.length; i++) {
              if (sorted[i].periodIndex > sorted[i - 1].periodIndex + 1) gaps++;
            }
            if (gaps > 0) {
              violations.push({
                severity: c.severity,
                kind: "minimize_gaps",
                message: `${who} a ${gaps} trou(s) dans la journée du ${bucket.day}.`,
                refs: baseRefs,
              });
            }
          }
          break;
        }
        default:
          break;
      }
    }
  }

  // Teacher weekly hours (max_weekly_hours, teacher scope).
  const teacherPeriods = new Map<string, number>();
  for (const e of entries) {
    if (e.teacherId) {
      teacherPeriods.set(e.teacherId, (teacherPeriods.get(e.teacherId) ?? 0) + 1);
    }
  }
  const teacherNames = new Map(problem.teachers.map((t) => [t.id, t.name]));
  for (const [teacherId, count] of teacherPeriods) {
    for (const c of indexed.forTeacher(teacherId)) {
      if (c.kind === "max_weekly_hours") {
        const max = constraintIntParam(c, "max");
        if (max != null && count > max) {
          violations.push({
            severity: c.severity,
            kind: "max_weekly_hours",
            message: `L'enseignant ${teacherNames.get(teacherId) ?? teacherId} a ${count} périodes hebdomadaires (maximum ${max}).`,
            refs: { teacherId },
          });
        }
      }
    }
  }

  // Per-class placement preferences (soft kinds).
  const classEntries = new Map<string, TimetableSlotAssignment[]>();
  for (const e of entries) {
    classEntries.set(e.classId, [...(classEntries.get(e.classId) ?? []), e]);
  }
  const periodsByIndex = new Map(periods.map((p) => [p.index, p]));
  for (const [classId, list] of classEntries) {
    for (const c of indexed.forClass(classId)) {
      const refs: TimetableViolationRefs = { classId };
      switch (c.kind) {
        case "avoid_first_period": {
          const hit = list.find((e) => e.periodIndex === firstPeriod);
          if (hit) {
            violations.push({
              severity: c.severity,
              kind: "avoid_first_period",
              message: `La classe a un cours en première période alors qu'elle préfère éviter.`,
              refs: { ...refs, day: hit.day, periodIndex: hit.periodIndex },
            });
          }
          break;
        }
        case "avoid_last_period": {
          const hit = list.find((e) => e.periodIndex === lastPeriod);
          if (hit) {
            violations.push({
              severity: c.severity,
              kind: "avoid_last_period",
              message: `La classe a un cours en dernière période alors qu'elle préfère éviter.`,
              refs: { ...refs, day: hit.day, periodIndex: hit.periodIndex },
            });
          }
          break;
        }
        case "prefer_morning": {
          const hit = list.find((e) => {
            const p = periodsByIndex.get(e.periodIndex);
            return p != null && p.startMinutes >= midDayMinutes;
          });
          if (hit) {
            violations.push({
              severity: c.severity,
              kind: "prefer_morning",
              message: `La classe a des cours l'après-midi alors qu'elle préfère le matin.`,
              refs: { ...refs, day: hit.day, periodIndex: hit.periodIndex },
            });
          }
          break;
        }
        case "prefer_afternoon": {
          const hit = list.find((e) => {
            const p = periodsByIndex.get(e.periodIndex);
            return p != null && p.startMinutes < midDayMinutes;
          });
          if (hit) {
            violations.push({
              severity: c.severity,
              kind: "prefer_afternoon",
              message: `La classe a des cours le matin alors qu'elle préfère l'après-midi.`,
              refs: { ...refs, day: hit.day, periodIndex: hit.periodIndex },
            });
          }
          break;
        }
        case "preferred_period": {
          const wanted = constraintPeriodParam(c);
          if (wanted != null && !list.some((e) => e.periodIndex === wanted)) {
            violations.push({
              severity: c.severity,
              kind: "preferred_period",
              message: `La classe n'a aucun cours à la période préférée ${wanted}.`,
              refs,
            });
          }
          break;
        }
        default:
          break;
      }
    }
  }

  return violations;
}

// ============================================================================
// Configuration validity of the grid itself
// ============================================================================

function gridViolations(
  entries: readonly TimetableSlotAssignment[],
  problem: TimetableProblem,
): TimetableViolation[] {
  const violations: TimetableViolation[] = [];
  const schoolDays = new Set(problem.configuration.schoolDays);
  const validPeriods = new Set(
    teachingPeriods(problem.configuration).map((p) => p.index),
  );
  for (const e of entries) {
    if (!schoolDays.has(e.day)) {
      violations.push({
        severity: "hard",
        kind: "day_outside_school_week",
        message: `Cours placé un ${e.day} qui n'est pas un jour d'école dans la configuration.`,
        refs: { classId: e.classId, day: e.day, periodIndex: e.periodIndex },
      });
    }
    if (!validPeriods.has(e.periodIndex)) {
      violations.push({
        severity: "hard",
        kind: "period_out_of_range",
        message: `Période ${e.periodIndex} invalide pour la configuration.`,
        refs: { classId: e.classId, day: e.day, periodIndex: e.periodIndex },
      });
    }
  }
  return violations;
}

// ============================================================================
// Weekly-hours coverage (the honest-unplacement contract)
// ============================================================================

export interface CoverageGap {
  readonly requirement: TimetableRequirement;
  readonly requiredPeriods: number;
  readonly placedPeriods: number;
}

function periodMinutesSafe(config: TimetableConfiguration): number {
  const first = teachingPeriods(config)[0];
  if (!first) return config.defaultLessonMinutes;
  const minutes = first.endMinutes - first.startMinutes;
  return minutes > 0 ? minutes : config.defaultLessonMinutes;
}

/** Required teaching periods for a requirement (≥ 1). */
export function requiredPeriodsFor(
  req: TimetableRequirement,
  periodMinutesValue: number,
): number {
  const hours = req.weeklyHours > 0 ? req.weeklyHours : 1;
  const periods = Math.round((hours * 60) / Math.max(1, periodMinutesValue));
  return Math.max(1, periods);
}

/** Split required periods into consecutive blocks (full blocks + remainder). */
export function blockSplit(
  requiredPeriods: number,
  consecutivePeriods: number,
): number[] {
  const n = Math.max(1, Math.min(4, consecutivePeriods));
  if (n <= 1) return Array.from({ length: requiredPeriods }, () => 1);
  const blocks: number[] = [];
  let left = requiredPeriods;
  while (left > n) {
    blocks.push(n);
    left -= n;
  }
  if (left > 0) blocks.push(left);
  return blocks.length > 0 ? blocks : [1];
}

/**
 * Compute required vs placed periods per requirement. Any shortfall is a
 * coverage gap (never silently zero).
 */
export function coverageGaps(
  problem: TimetableProblem,
  entries: readonly TimetableSlotAssignment[],
): CoverageGap[] {
  const pm = periodMinutesSafe(problem.configuration);
  const gaps: CoverageGap[] = [];
  for (const req of problem.requirements) {
    const requiredPeriods = requiredPeriodsFor(req, pm);
    const placed = entries.filter(
      (e) => e.classId === req.classId && e.subjectId === req.subjectId,
    ).length;
    if (placed < requiredPeriods) {
      gaps.push({ requirement: req, requiredPeriods, placedPeriods: placed });
    }
  }
  return gaps;
}

// ============================================================================
// THE canonical validator
// ============================================================================

/**
 * Validate a candidate timetable against the problem. Returns ALL
 * violations (hard + soft). Zero hard violations + zero coverage gaps =
 * a valid, complete timetable.
 */
export function validateTimetable(
  problem: TimetableProblem,
  entries: readonly TimetableSlotAssignment[],
): TimetableViolation[] {
  const indexed = indexConstraints(problem.constraints);
  const roomsById = new Map(problem.rooms.map((r) => [r.id, r]));
  const reqKey = (c: string, s: string) => `${c}|${s}`;
  const requirementsByKey = new Map(
    problem.requirements.map((r) => [reqKey(r.classId, r.subjectId), r]),
  );

  const violations: TimetableViolation[] = [];
  violations.push(...gridViolations(entries, problem));
  violations.push(...resourceClashes(entries));
  for (const e of entries) {
    const req = requirementsByKey.get(reqKey(e.classId, e.subjectId));
    violations.push(...entryConstraintViolations(e, problem, indexed, roomsById, req));
  }
  violations.push(...aggregateViolations(entries, problem, indexed));

  for (const gap of coverageGaps(problem, entries)) {
    violations.push({
      severity: "hard",
      kind: "unmet_weekly_hours",
      message: `${gap.requirement.subjectName} pour ${gap.requirement.className} : ${gap.placedPeriods}/${gap.requiredPeriods} périodes placées (heures hebdomadaires non couvertes).`,
      refs: {
        classId: gap.requirement.classId,
        subjectId: gap.requirement.subjectId,
      },
    });
  }

  return violations;
}

/** True when the violation list has NO hard violation (soft may remain). */
export function hasOnlySoftViolations(
  violations: readonly TimetableViolation[],
): boolean {
  return !violations.some((v) => v.severity === "hard");
}

// ============================================================================
// Live single-move check (manual adjustment path)
// ============================================================================

/**
 * Validate a candidate manual adjustment: `candidateEntries` is the FULL
 * schedule WITH the move already applied. Returns the violations the moved
 * entry participates in (resource clashes at its slot, its constraint
 * hits, and its subject's coverage). This is the LIVE validation used
 * before persisting a manual adjustment (T-404: "manual adjustment after
 * generation with live validation").
 */
export function validateTimetableMove(
  problem: TimetableProblem,
  candidateEntries: readonly TimetableSlotAssignment[],
  moved: TimetableSlotAssignment,
): TimetableViolation[] {
  const all = validateTimetable(problem, candidateEntries);
  const touches = (v: TimetableViolation): boolean => {
    const r = v.refs;
    const sameSlot = r.day === moved.day && r.periodIndex === moved.periodIndex;
    if (sameSlot && (r.classId === moved.classId || r.roomId === moved.roomId)) {
      return true;
    }
    if (
      sameSlot &&
      moved.teacherId != null &&
      r.teacherId === moved.teacherId
    ) {
      return true;
    }
    if (
      v.kind === "unmet_weekly_hours" &&
      r.classId === moved.classId &&
      r.subjectId === moved.subjectId
    ) {
      return true;
    }
    return false;
  };
  return all.filter(touches);
}
