// ============================================================================
// FILE: src/domain/calc/timetable/fixture.ts
// ============================================================================
/**
 * The known-good deterministic timetable fixture — T-404 packaging gate 5.
 *
 * A small but complete Algerian school whose generated timetable is
 * DETERMINISTIC (same input → same output, no randomness anywhere) and
 * FULLY PLACEABLE (status "valid", zero hard violations, zero unplaced).
 * It is the fixture used by:
 *  - the domain unit tests (solver happy path),
 *  - the packaged-app generation smoke test (production build, no dev
 *    runtime — T-404 packaging gate 3),
 *  - the failure-diagnostics test (an intentionally impossible variant).
 *
 * Shape: 3 classes (one per level), 5 subjects, 4 teachers, 2 rooms
 * (1 classroom + 1 science lab), the Algerian profile, a class free day
 * (hard), a teacher unavailability (hard), a soft preference, and one
 * lab subject with a required room type + double periods.
 */

import type {
  Room,
  TimetableConstraint,
  TimetableDay,
  TimetableProblem,
  TimetableRequirement,
} from "../../model/timetable";
import { algerianDefaultConfiguration } from "./algerian-profile";

const TENANT = "tenant-t404-fixture";
const YEAR = "year-t404-fixture";

// ── Classes ────────────────────────────────────────────────────────────────
const CLASSES = [
  { id: "cls-1as-a", code: "1AS-A", name: "1ère AS — Section A", capacity: 30 },
  { id: "cls-2as-a", code: "2AS-A", name: "2ème AS — Section A", capacity: 28 },
  { id: "cls-3as-a", code: "3AS-A", name: "3ème AS — Section A", capacity: 26 },
] as const;

// ── Teachers (personnel references) ────────────────────────────────────────
const TEACHERS = [
  { id: "tch-math", name: "M. Belkacem (Maths)" },
  { id: "tch-phys", name: "Mme Haddad (Sciences)" },
  { id: "tch-arab", name: "M. Ziani (Arabe)" },
  { id: "tch-fr", name: "Mme Saidi (Français)" },
] as const;

// ── Rooms ──────────────────────────────────────────────────────────────────
const ROOMS: Room[] = [
  room("room-c1", "SAL-01", "Salle 01", "classroom", 32, "A", "RDC"),
  room("room-c2", "SAL-02", "Salle 02", "classroom", 32, "A", "RDC"),
  room("room-c3", "SAL-03", "Salle 03", "classroom", 30, "A", "1er"),
  room("room-lab", "LAB-SCI", "Laboratoire de sciences", "science_lab", 32, "B", "1er"),
];

function room(
  id: string,
  code: string,
  name: string,
  roomType: Room["roomType"],
  capacity: number,
  building: string,
  floorLabel: string,
): Room {
  return {
    id,
    tenantId: TENANT,
    code,
    name,
    roomType,
    capacity,
    building,
    floorLabel,
    isActive: true,
    notes: null,
    createdAt: "2026-09-22T00:00:00.000Z",
    updatedAt: "2026-09-22T00:00:00.000Z",
  };
}

// ── Requirements (class_subjects shape) ────────────────────────────────────
const SUBJECTS: Record<string, string> = {
  "sub-math": "Mathématiques",
  "sub-phys": "Sciences physiques",
  "sub-arab": "Langue arabe",
  "sub-fr": "Langue française",
  "sub-hist": "Histoire-Géographie",
};

function requirement(
  classId: string,
  className: string,
  subjectId: string,
  teacherId: string,
  weeklyHours: number,
  opts?: { consecutivePeriods?: number; requiredRoomType?: Room["roomType"] },
): TimetableRequirement {
  return {
    classId,
    subjectId,
    teacherId,
    weeklyHours,
    consecutivePeriods: opts?.consecutivePeriods ?? 1,
    requiredRoomType: opts?.requiredRoomType ?? null,
    className,
    subjectName: SUBJECTS[subjectId],
    teacherName: TEACHERS.find((t) => t.id === teacherId)?.name ?? null,
    classSize: CLASSES.find((c) => c.id === classId)?.capacity ?? null,
  };
}

// Per class: 4h Math, 2h Sciences (TP ×2 in lab), 4h Arabe, 4h Français,
// 2h Histoire = 16 periods... plus keep under 30 slots/week. Actually:
// Math 4 + Phys 2 (1 double block) + Arabe 4 + FR 4 + HG 2 = 16 periods.
const requirementsFor = (classId: string, className: string): TimetableRequirement[] => [
  requirement(classId, className, "sub-math", "tch-math", 4),
  requirement(classId, className, "sub-phys", "tch-phys", 2, {
    consecutivePeriods: 2,
    requiredRoomType: "science_lab",
  }),
  requirement(classId, className, "sub-arab", "tch-arab", 4),
  requirement(classId, className, "sub-fr", "tch-fr", 4),
  requirement(classId, className, "sub-hist", "tch-arab", 2),
];

const REQUIREMENTS: TimetableRequirement[] = [
  ...requirementsFor("cls-1as-a", "1ère AS — Section A"),
  ...requirementsFor("cls-2as-a", "2ème AS — Section A"),
  ...requirementsFor("cls-3as-a", "3ème AS — Section A"),
];

// ── Constraints ────────────────────────────────────────────────────────────
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
    tenantId: TENANT,
    academicYearId: YEAR,
    scope,
    entityId,
    kind,
    severity,
    params,
    isActive: true,
    createdAt: "2026-09-22T00:00:00.000Z",
    updatedAt: "2026-09-22T00:00:00.000Z",
  };
}

export const FIXTURE_CONSTRAINTS: TimetableConstraint[] = [
  // 1AS-A: Wednesday off (hard — the class-specific free day).
  constraint("c-free-1as-wed", "class", "cls-1as-a", "free_day", "hard", {
    day: "wednesday",
  }),
  // The lab is maintained Thursday afternoon (hard room unavailability ×2).
  constraint("c-unavail-lab-thu5", "room", "room-lab", "unavailable_period", "hard", {
    day: "thursday",
    periodIndex: 5,
  }),
  constraint("c-unavail-lab-thu6", "room", "room-lab", "unavailable_period", "hard", {
    day: "thursday",
    periodIndex: 6,
  }),
  // M. Ziani is off Sunday (hard teacher free day).
  constraint("c-free-ziani-sun", "teacher", "tch-arab", "free_day", "hard", {
    day: "sunday",
  }),
  // 3AS-A prefers afternoons for its maths (soft).
  constraint("c-soft-3as-afternoon", "class", "cls-3as-a", "prefer_afternoon", "soft", {}),
  // Classes prefer avoiding the last period of the day (soft).
  constraint("c-soft-avoid-last", "school", null, "avoid_last_period", "soft", {}),
];

// ── The problem ────────────────────────────────────────────────────────────
export function buildFixtureProblem(): TimetableProblem {
  return {
    configuration: algerianDefaultConfiguration(TENANT, YEAR, "cfg-t404-fixture"),
    classes: CLASSES.map((c) => ({ ...c })),
    teachers: TEACHERS.map((t) => ({ ...t })),
    rooms: ROOMS,
    requirements: REQUIREMENTS,
    constraints: FIXTURE_CONSTRAINTS,
    lockedEntries: [],
  };
}

/**
 * The IMPOSSIBLE variant (packaging gate 6 — failure diagnostics): the
 * same school but with the lab available only ONE period in the whole
 * week, while Sciences requires a double block in the lab for 3 classes.
 * The solver must report an honest unplaced reason, never fabricate.
 */
export function buildImpossibleProblem(): TimetableProblem {
  const base = buildFixtureProblem();
  const onlySundayPeriod1: TimetableConstraint[] = [];
  const allDays: TimetableDay[] = ["sunday", "monday", "tuesday", "wednesday", "thursday"];
  const busy: TimetableConstraint[] = [];
  let n = 0;
  for (const day of allDays) {
    for (let p = 1; p <= 6; p++) {
      if (day === "sunday" && p === 1) continue; // the only open slot
      busy.push(
        constraint(`c-lab-block-${n++}`, "room", "room-lab", "unavailable_period", "hard", {
          day,
          periodIndex: p,
        }),
      );
    }
  }
  onlySundayPeriod1.push(...busy);
  return {
    ...base,
    constraints: [...base.constraints, ...onlySundayPeriod1],
  };
}
