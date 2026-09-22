// ============================================================================
// FILE: src/domain/calc/timetable/class-reports.ts
// ============================================================================
/**
 * The per-class timetable report builder — T-410 / SCHED-112.
 *
 * THE OWNER CONTRACT: "N classes → N completely separate timetables — one
 * per class — each internally complete and conflict-free (no teacher
 * conflicts, no room conflicts, no overlapping lessons, no unexplained
 * gaps, all required weekly hours, every subject scheduled, a teacher and
 * a room for every lesson, all applicable constraints satisfied), while
 * still respecting shared teachers and rooms across the school."
 *
 * ARCHITECTURE (ADR-020 / T-404 boundaries — respected verbatim):
 * this module is a THIN AGGREGATION LAYER, never a second engine:
 *  - constraint verdicts come from the ONE canonical validator's output
 *    (`violations` — computed by constraints.ts; no rule is re-derived);
 *  - completeness comes from the SAME canonical requirement math
 *    (`requiredPeriodsFor` — the solver's own denominator);
 *  - this layer only ATTRIBUTES violations to classes (a shared-resource
 *    clash belongs to EVERY participating class's timetable) and computes
 *    class-local aggregates (own entries, own holes, own missing teacher /
 *    room periods).
 *
 * A report exists for EVERY class of the problem — a class with no entries
 * and no requirements gets its honest report (nothing required, nothing
 * placed), never silence.
 */

import type {
  ClassTimetableChecklistItem,
  ClassTimetableChecklistKey,
  ClassTimetableIssue,
  ClassTimetableReport,
  ClassTimetableStatus,
  TimetableClassInfo,
  TimetableDay,
  TimetableProblem,
  TimetableRequirement,
  TimetableSlotAssignment,
  TimetableSolution,
  TimetableViolation,
} from "../../model/timetable";
import {
  CLASS_TIMETABLE_CHECKLIST_KEYS,
  TIMETABLE_DAY_LABELS_FR,
  teachingPeriods,
  timetableCoveragePercent,
} from "../../model/timetable";
import { requiredPeriodsFor } from "./constraints";

// ============================================================================
// Inputs / helpers
// ============================================================================

/** The solve result the reports are derived from (entries + the canonical
 *  validator's output + the solver's honest unplacement reasons). */
export type ClassReportsSource = Pick<
  TimetableSolution,
  "entries" | "violations" | "unplaced"
>;

interface SlotIndex {
  /** day#period → the entries occupying that slot (ALL classes). */
  readonly bySlot: ReadonlyMap<string, readonly TimetableSlotAssignment[]>;
  /** teacherId → the set of classes taught by that teacher. */
  readonly classesOfTeacher: ReadonlyMap<string, ReadonlySet<string>>;
  key(day: TimetableDay, period: number): string;
}

function buildSlotIndex(entries: readonly TimetableSlotAssignment[]): SlotIndex {
  const bySlot = new Map<string, TimetableSlotAssignment[]>();
  const classesOfTeacher = new Map<string, Set<string>>();
  const key = (day: TimetableDay, period: number) => `${day}#${period}`;
  for (const e of entries) {
    const k = key(e.day, e.periodIndex);
    const list = bySlot.get(k) ?? [];
    list.push(e);
    bySlot.set(k, list);
    if (e.teacherId) {
      const set = classesOfTeacher.get(e.teacherId) ?? new Set<string>();
      set.add(e.classId);
      classesOfTeacher.set(e.teacherId, set);
    }
  }
  return { bySlot, classesOfTeacher, key };
}

/** Free teaching periods strictly between the class's first and last lesson
 *  of each school day (the honest "unexplained holes" count). */
function classGapPeriods(
  problem: TimetableProblem,
  classEntries: readonly TimetableSlotAssignment[],
): number {
  const validPeriods = new Set(
    teachingPeriods(problem.configuration).map((p) => p.index),
  );
  const byDay = new Map<TimetableDay, number[]>();
  for (const e of classEntries) {
    if (!validPeriods.has(e.periodIndex)) continue;
    const list = byDay.get(e.day) ?? [];
    list.push(e.periodIndex);
    byDay.set(e.day, list);
  }
  let gaps = 0;
  for (const periods of byDay.values()) {
    if (periods.length < 2) continue;
    const min = Math.min(...periods);
    const max = Math.max(...periods);
    // Distinct valid periods strictly between min and max that the class
    // does NOT occupy. (A double-booked period counts once — the overlap is
    // reported as a conflict, not as a gap.)
    const occupied = new Set(periods);
    for (let p = min + 1; p < max; p++) {
      if (validPeriods.has(p) && !occupied.has(p)) gaps++;
    }
  }
  return gaps;
}

// ============================================================================
// Violation attribution (both sides of every shared-resource clash)
// ============================================================================

/**
 * Attribute ONE canonical violation to the set of classes whose timetables
 * it concerns. Rules:
 *  - refs.classId → that class;
 *  - a teacher / room clash concerns EVERY class occupying the slot with
 *    that teacher / room (both sides must see the conflict);
 *  - a teacher-scope aggregate (max_weekly_hours) concerns every class
 *    taught by that teacher.
 */
function classesConcernedBy(
  violation: TimetableViolation,
  index: SlotIndex,
): ReadonlySet<string> {
  const concerned = new Set<string>();
  if (violation.refs.classId) concerned.add(violation.refs.classId);
  const { day, periodIndex } = violation.refs;
  if (
    (violation.kind === "teacher_double_booking" ||
      violation.kind === "room_double_booking") &&
    day != null &&
    periodIndex != null
  ) {
    const resourceKey =
      violation.kind === "teacher_double_booking"
        ? violation.refs.teacherId
        : violation.refs.roomId;
    if (resourceKey) {
      for (const e of index.bySlot.get(index.key(day, periodIndex)) ?? []) {
        const matches =
          violation.kind === "teacher_double_booking"
            ? e.teacherId === resourceKey
            : e.roomId === resourceKey;
        if (matches) concerned.add(e.classId);
      }
    }
  }
  if (violation.kind === "max_weekly_hours" && violation.refs.teacherId) {
    for (const classId of index.classesOfTeacher.get(
      violation.refs.teacherId,
    ) ?? []) {
      concerned.add(classId);
    }
  }
  return concerned;
}

/** Rewrite a shared-resource clash message so EACH participating class sees
 *  the OTHER classes involved (the canonical message names neither side). */
function attributedMessage(
  violation: TimetableViolation,
  classId: string,
  problem: TimetableProblem,
  index: SlotIndex,
): string {
  const { day, periodIndex } = violation.refs;
  const classLabel = (id: string): string => {
    const cls = problem.classes.find((c) => c.id === id);
    return cls ? cls.name : id;
  };
  if (
    (violation.kind === "teacher_double_booking" ||
      violation.kind === "room_double_booking") &&
    day != null &&
    periodIndex != null
  ) {
    const resourceKey =
      violation.kind === "teacher_double_booking"
        ? violation.refs.teacherId
        : violation.refs.roomId;
    const involved = new Set<string>();
    if (resourceKey) {
      for (const e of index.bySlot.get(index.key(day, periodIndex)) ?? []) {
        const matches =
          violation.kind === "teacher_double_booking"
            ? e.teacherId === resourceKey
            : e.roomId === resourceKey;
        if (matches) involved.add(e.classId);
      }
    }
    const others = [...involved].filter((id) => id !== classId);
    const where = `${TIMETABLE_DAY_LABELS_FR[day]}, période ${periodIndex}`;
    if (violation.kind === "teacher_double_booking") {
      const teacher =
        problem.teachers.find((t) => t.id === resourceKey)?.name ?? "enseignant";
      return others.length > 0
        ? `L'enseignant ${teacher} est affecté en même temps à ${classLabel(classId)} et à ${others
            .map(classLabel)
            .join(", ")} (${where}).`
        : `L'enseignant ${teacher} est affecté à deux cours de ${classLabel(classId)} en même temps (${where}).`;
    }
    const room = problem.rooms.find((r) => r.id === resourceKey);
    const roomLabel = room ? `${room.code} — ${room.name}` : "la salle";
    return others.length > 0
      ? `La salle ${roomLabel} accueille en même temps ${classLabel(classId)} et ${others
          .map(classLabel)
          .join(", ")} (${where}).`
      : `La salle ${roomLabel} accueille deux cours de ${classLabel(classId)} en même temps (${where}).`;
  }
  return violation.message;
}

// ============================================================================
// The report builder
// ============================================================================

/**
 * Build ONE independent report per class of the problem, in the problem's
 * deterministic class order. Reuses the canonical validator's output —
 * never re-derives a constraint verdict.
 */
export function buildClassTimetableReports(
  problem: TimetableProblem,
  source: ClassReportsSource,
): ClassTimetableReport[] {
  const index = buildSlotIndex(source.entries);
  const pm = (() => {
    const first = teachingPeriods(problem.configuration)[0];
    if (!first) return problem.configuration.defaultLessonMinutes;
    const minutes = first.endMinutes - first.startMinutes;
    return minutes > 0 ? minutes : problem.configuration.defaultLessonMinutes;
  })();

  // Class-sliced views (deterministic).
  const entriesByClass = new Map<string, TimetableSlotAssignment[]>();
  for (const e of source.entries) {
    const list = entriesByClass.get(e.classId) ?? [];
    list.push(e);
    entriesByClass.set(e.classId, list);
  }
  const requirementsByClass = new Map<string, TimetableRequirement[]>();
  for (const req of problem.requirements) {
    const list = requirementsByClass.get(req.classId) ?? [];
    list.push(req);
    requirementsByClass.set(req.classId, list);
  }

  // Attribute every canonical violation (and every honest unplacement
  // reason) to the classes whose timetables they concern.
  const issuesByClass = new Map<string, ClassTimetableIssue[]>();
  const pushIssue = (classId: string, issue: ClassTimetableIssue): void => {
    const list = issuesByClass.get(classId) ?? [];
    list.push(issue);
    issuesByClass.set(classId, list);
  };
  for (const violation of source.violations) {
    for (const classId of classesConcernedBy(violation, index)) {
      pushIssue(classId, {
        severity: violation.severity,
        kind: violation.kind,
        message: attributedMessage(violation, classId, problem, index),
      });
    }
  }
  for (const unplaced of source.unplaced) {
    pushIssue(unplaced.requirement.classId, {
      severity: "hard",
      kind: "unplaced_block",
      message: `${unplaced.requirement.subjectName} — ${unplaced.requirement.className} : ${unplaced.reason}`,
    });
  }

  const reports: ClassTimetableReport[] = [];
  for (const cls of problem.classes) {
    reports.push(
      buildOneReport(cls, {
        pm,
        classEntries: entriesByClass.get(cls.id) ?? [],
        classRequirements: requirementsByClass.get(cls.id) ?? [],
        issues: issuesByClass.get(cls.id) ?? [],
        gapPeriods: classGapPeriods(problem, entriesByClass.get(cls.id) ?? []),
      }),
    );
  }
  return reports;
}

function buildOneReport(
  cls: TimetableClassInfo,
  ctx: {
    pm: number;
    classEntries: readonly TimetableSlotAssignment[];
    classRequirements: readonly TimetableRequirement[];
    issues: readonly ClassTimetableIssue[];
    gapPeriods: number;
  },
): ClassTimetableReport {
  const { pm, classEntries, classRequirements, issues, gapPeriods } = ctx;

  // ── Completeness from the canonical requirement math ───────────────────
  let requiredPeriods = 0;
  let missingPeriods = 0;
  const unscheduledSubjects: string[] = [];
  for (const req of classRequirements) {
    const required = requiredPeriodsFor(req, pm);
    requiredPeriods += required;
    const placed = classEntries.filter(
      (e) => e.classId === req.classId && e.subjectId === req.subjectId,
    ).length;
    if (placed < required) missingPeriods += required - placed;
    if (placed === 0) unscheduledSubjects.push(req.subjectName);
  }
  const placedPeriods = classEntries.length;
  const coveragePercent = timetableCoveragePercent(placedPeriods, requiredPeriods);

  // ── Class-local data quality (the owner's per-class checklist) ─────────
  const missingTeacherPeriods = classEntries.filter(
    (e) => e.teacherId == null,
  ).length;
  const missingRoomPeriods = classEntries.filter(
    (e) => e.roomId == null,
  ).length;

  // ── Attributed conflicts ────────────────────────────────────────────────
  const teacherConflicts = issues.filter(
    (i) => i.kind === "teacher_double_booking",
  );
  const roomConflicts = issues.filter((i) => i.kind === "room_double_booking");
  const overlaps = issues.filter((i) => i.kind === "class_double_booking");
  const otherIssues = issues.filter(
    (i) =>
      i.kind !== "teacher_double_booking" &&
      i.kind !== "room_double_booking" &&
      i.kind !== "class_double_booking" &&
      i.kind !== "unmet_weekly_hours" &&
      i.kind !== "unplaced_block",
  );
  const hardIssues = issues.filter((i) => i.severity === "hard");
  const softIssues = issues.filter((i) => i.severity === "soft");
  const hardOtherIssues = otherIssues.filter((i) => i.severity === "hard");
  const softOtherIssues = otherIssues.filter((i) => i.severity === "soft");

  // ── The checklist (the owner's verification list, item by item) ────────
  const checklist: ClassTimetableChecklistItem[] =
    CLASS_TIMETABLE_CHECKLIST_KEYS.map(
      (key: ClassTimetableChecklistKey): ClassTimetableChecklistItem => {
        switch (key) {
          case "teacher_conflicts":
            return {
              key,
              ok: teacherConflicts.length === 0,
              count: teacherConflicts.length,
              message:
                teacherConflicts.length === 0
                  ? "Aucun conflit d'enseignant"
                  : `${teacherConflicts.length} conflit(s) d'enseignant`,
            };
          case "room_conflicts":
            return {
              key,
              ok: roomConflicts.length === 0,
              count: roomConflicts.length,
              message:
                roomConflicts.length === 0
                  ? "Aucun conflit de salle"
                  : `${roomConflicts.length} conflit(s) de salle`,
            };
          case "overlaps":
            return {
              key,
              ok: overlaps.length === 0,
              count: overlaps.length,
              message:
                overlaps.length === 0
                  ? "Aucun chevauchement de cours"
                  : `${overlaps.length} chevauchement(s) de cours`,
            };
          case "gaps":
            return {
              key,
              ok: gapPeriods === 0,
              count: gapPeriods,
              message:
                gapPeriods === 0
                  ? "Aucun trou dans les journées"
                  : `${gapPeriods} période(s) libre(s) entre deux cours (trous)`,
            };
          case "weekly_hours":
            return {
              key,
              ok: missingPeriods === 0,
              count: missingPeriods,
              message:
                requiredPeriods === 0
                  ? "Aucune exigence curriculaire définie pour cette classe"
                  : missingPeriods === 0
                    ? `${placedPeriods}/${requiredPeriods} périodes requises placées`
                    : `${placedPeriods}/${requiredPeriods} périodes requises placées (${missingPeriods} manquante(s))`,
            };
          case "subjects_scheduled":
            return {
              key,
              ok: unscheduledSubjects.length === 0,
              count: unscheduledSubjects.length,
              message:
                unscheduledSubjects.length === 0
                  ? requiredPeriods === 0
                    ? "Aucune matière requise"
                    : "Toutes les matières sont programmées"
                  : `${unscheduledSubjects.length} matière(s) non programmée(s) : ${unscheduledSubjects.join(", ")}`,
            };
          case "teacher_assigned":
            return {
              key,
              ok: missingTeacherPeriods === 0,
              count: missingTeacherPeriods,
              message:
                missingTeacherPeriods === 0
                  ? "Un enseignant est affecté à chaque cours"
                  : `${missingTeacherPeriods} cours sans enseignant affecté`,
            };
          case "room_assigned":
            return {
              key,
              ok: missingRoomPeriods === 0,
              count: missingRoomPeriods,
              message:
                missingRoomPeriods === 0
                  ? "Une salle est affectée à chaque cours"
                  : `${missingRoomPeriods} cours sans salle affectée`,
            };
          case "constraints":
            return {
              key,
              ok: hardOtherIssues.length === 0,
              count: otherIssues.length,
              message:
                otherIssues.length === 0
                  ? "Toutes les contraintes applicables sont respectées"
                  : `${hardOtherIssues.length} violation(s) stricte(s), ${softOtherIssues.length} préférence(s) non respectée(s)`,
            };
        }
      },
    );

  // ── Status: complete = internally complete AND conflict-free ───────────
  // (gaps are REPORTED — a hole is a quality warning, not an inconsistency;
  //  hard clashes, missing hours, unscheduled subjects and missing
  //  teacher/room assignments make the class timetable incomplete.)
  const complete =
    missingPeriods === 0 &&
    unscheduledSubjects.length === 0 &&
    missingTeacherPeriods === 0 &&
    missingRoomPeriods === 0 &&
    hardIssues.length === 0;
  const status: ClassTimetableStatus = complete ? "complete" : "incomplete";

  return {
    classId: cls.id,
    classCode: cls.code,
    className: cls.name,
    status,
    placedPeriods,
    requiredPeriods,
    coveragePercent,
    hardIssueCount: hardIssues.length,
    softIssueCount: softIssues.length,
    gapPeriods,
    issues,
    checklist,
  };
}
