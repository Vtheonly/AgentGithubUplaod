// ============================================================================
// FILE: src/domain/model/timetable.ts
// ============================================================================
/**
 * The CANONICAL Automatic Timetable (Emploi du temps) domain model — T-404.
 *
 * This is the ONE timetable representation for the whole system (ADR-020):
 * the solver adapter translates it to/from solver-specific shapes, the
 * repository persists it to/from `timetable_configurations` /
 * `timetable_constraints` / `timetable_versions` / `timetable_entries` /
 * `rooms` (migrations 0109/0110), the desktop UI renders it, and future
 * Android/Website consumers read the same published schedule.
 *
 * It SUPERSEDES the legacy mock-only `TimetableEntry` in `teacher.ts`
 * (the SCHED-100 façade — never extended; see ADR-020 §1).
 *
 * DESIGN RULES (T-404 / ADR-020):
 * - The day/period structure is DATA (a configuration), never constants:
 *   the Algerian school week (Sunday–Thursday) is one seeded profile
 *   (see calc/timetable/algerian-profile.ts), any subset of the 7 days is
 *   valid. The legacy `SchoolDay` type's Mon–Fri "Algerian school week"
 *   comment was wrong (SCHED-102).
 * - Constraints are DATA rows with a canonical kind list that mirrors the
 *   DB CHECK on `timetable_constraints.kind` (migration 0109 §3).
 * - Hard constraints invalidate a timetable; soft constraints may be
 *   violated only with explicit reporting (academic-rules.md §8).
 */

// ============================================================================
// Days — the full week; the configuration selects the school days
// ============================================================================

export type TimetableDay =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

export const TIMETABLE_DAYS: readonly TimetableDay[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

export const TIMETABLE_DAY_LABELS_FR: Record<TimetableDay, string> = {
  monday: "Lundi",
  tuesday: "Mardi",
  wednesday: "Mercredi",
  thursday: "Jeudi",
  friday: "Vendredi",
  saturday: "Samedi",
  sunday: "Dimanche",
};

/** Parse/validate a DB `day` text value; null when invalid. */
export function parseTimetableDay(value: string): TimetableDay | null {
  return (TIMETABLE_DAYS as readonly string[]).includes(value)
    ? (value as TimetableDay)
    : null;
}

// ============================================================================
// School configuration — periods, breaks, school days (mirrors 0109 §2)
// ============================================================================

/** A TEACHING period (breaks are not slots). Index is 1-based. */
export interface TimetablePeriod {
  readonly index: number;
  readonly label: string;
  readonly startMinutes: number;
  readonly endMinutes: number;
}

/** A labeled break between periods (display + no-span rule). */
export interface TimetableBreak {
  readonly afterPeriodIndex: number;
  readonly label: string;
  readonly startMinutes: number;
  readonly endMinutes: number;
}

export interface TimetableConfiguration {
  readonly id: string;
  readonly tenantId: string;
  readonly academicYearId: string;
  readonly label: string;
  readonly schoolDays: readonly TimetableDay[];
  readonly periods: readonly TimetablePeriod[];
  readonly breaks: readonly TimetableBreak[];
  readonly defaultLessonMinutes: number;
  readonly maxPeriodsPerDay: number;
  readonly isActive: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Ordered teaching periods by index (defensive copy, index-sorted). */
export function teachingPeriods(config: TimetableConfiguration): TimetablePeriod[] {
  return [...config.periods].sort((a, b) => a.index - b.index);
}

/** The minutes a period lasts (first period's length; configs are uniform). */
export function periodMinutes(config: TimetableConfiguration): number {
  const first = teachingPeriods(config)[0];
  if (!first) return config.defaultLessonMinutes;
  return first.endMinutes - first.startMinutes;
}

/** True when periods p and p+1 are back-to-back teaching periods with no labeled break between them. */
export function periodsAreAdjacent(
  config: TimetableConfiguration,
  periodIndex: number,
): boolean {
  const periods = teachingPeriods(config);
  const hasP = periods.some((p) => p.index === periodIndex);
  const hasNext = periods.some((p) => p.index === periodIndex + 1);
  if (!hasP || !hasNext) return false;
  const crossesBreak = config.breaks.some((b) => b.afterPeriodIndex === periodIndex);
  return !crossesBreak;
}

// ============================================================================
// Rooms — bookable resources (mirrors 0109 §1)
// ============================================================================

export type RoomType =
  | "classroom"
  | "science_lab"
  | "computer_lab"
  | "language_lab"
  | "sports"
  | "library"
  | "workshop"
  | "other";

export const ROOM_TYPES: readonly RoomType[] = [
  "classroom",
  "science_lab",
  "computer_lab",
  "language_lab",
  "sports",
  "library",
  "workshop",
  "other",
];

export const ROOM_TYPE_LABELS_FR: Record<RoomType, string> = {
  classroom: "Salle de classe",
  science_lab: "Laboratoire de sciences",
  computer_lab: "Salle informatique",
  language_lab: "Laboratoire de langues",
  sports: "Terrain / Salle de sport",
  library: "Bibliothèque",
  workshop: "Atelier",
  other: "Autre",
};

export interface Room {
  readonly id: string;
  readonly tenantId: string;
  readonly code: string;
  readonly name: string;
  readonly roomType: RoomType;
  readonly capacity: number | null;
  readonly building: string | null;
  readonly floorLabel: string | null;
  readonly isActive: boolean;
  readonly notes: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ============================================================================
// Constraints — hard/soft rules as data (mirrors 0109 §3)
// ============================================================================

export type TimetableConstraintScope = "school" | "class" | "teacher" | "room";

export const TIMETABLE_CONSTRAINT_SCOPES: readonly TimetableConstraintScope[] = [
  "school",
  "class",
  "teacher",
  "room",
];

export type TimetableConstraintKind =
  | "free_day"
  | "unavailable_period"
  | "max_daily_lessons"
  | "max_weekly_hours"
  | "max_consecutive"
  | "preferred_period"
  | "avoid_first_period"
  | "avoid_last_period"
  | "prefer_morning"
  | "prefer_afternoon"
  | "minimize_gaps";

/** The canonical v1 kind list — MUST mirror the DB CHECK (0109 §3). */
export const TIMETABLE_CONSTRAINT_KINDS: readonly TimetableConstraintKind[] = [
  "free_day",
  "unavailable_period",
  "max_daily_lessons",
  "max_weekly_hours",
  "max_consecutive",
  "preferred_period",
  "avoid_first_period",
  "avoid_last_period",
  "prefer_morning",
  "prefer_afternoon",
  "minimize_gaps",
];

export type TimetableConstraintSeverity = "hard" | "soft";

export interface TimetableConstraint {
  readonly id: string;
  readonly tenantId: string;
  readonly academicYearId: string;
  readonly scope: TimetableConstraintScope;
  /** class / personnel / room id — null for scope "school". */
  readonly entityId: string | null;
  readonly kind: TimetableConstraintKind;
  readonly severity: TimetableConstraintSeverity;
  readonly params: Readonly<Record<string, unknown>>;
  readonly isActive: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Read a required non-negative integer param. */
export function constraintIntParam(
  constraint: TimetableConstraint,
  key: string,
): number | null {
  const raw = constraint.params[key];
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) return raw;
  if (typeof raw === "string" && raw.trim() !== "" && Number.isFinite(Number(raw))) {
    const n = Number(raw);
    if (n >= 0) return n;
  }
  return null;
}

/** Read a required day param. */
export function constraintDayParam(
  constraint: TimetableConstraint,
): TimetableDay | null {
  const raw = constraint.params["day"];
  return typeof raw === "string" ? parseTimetableDay(raw) : null;
}

/** Read a required periodIndex param. */
export function constraintPeriodParam(
  constraint: TimetableConstraint,
): number | null {
  return constraintIntParam(constraint, "periodIndex");
}

// ============================================================================
// Curriculum requirements — derived from class_subjects (0004/0029/0109 §6)
// ============================================================================

/**
 * One scheduling requirement: subject X for class C, taught (when assigned)
 * by teacher T, weeklyHours hours per week, optionally in blocks of
 * consecutivePeriods, optionally requiring a room type.
 */
export interface TimetableRequirement {
  readonly classId: string;
  readonly subjectId: string;
  readonly teacherId: string | null;
  readonly weeklyHours: number;
  readonly consecutivePeriods: number;
  readonly requiredRoomType: RoomType | null;
  /** Display helpers (denormalized by the repository for the UI). */
  readonly className: string;
  readonly subjectName: string;
  readonly teacherName: string | null;
  /** Class size for capacity checks (enrolled/headcount). */
  readonly classSize: number | null;
}

// ============================================================================
// The solver problem and solution (ADR-020 §3 — the adapter contract)
// ============================================================================

export interface TimetableClassInfo {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly capacity: number | null;
}

export interface TimetableTeacherInfo {
  readonly id: string;
  readonly name: string;
}

/** A placed lesson slot — the atomic assignment unit. */
export interface TimetableSlotAssignment {
  readonly classId: string;
  readonly subjectId: string;
  readonly teacherId: string | null;
  readonly roomId: string | null;
  readonly day: TimetableDay;
  readonly periodIndex: number;
  /** Ordinal linking the N rows of one consecutive-lesson block. */
  readonly lessonGroup: number;
}

/** The complete, solver-agnostic input. */
export interface TimetableProblem {
  readonly configuration: TimetableConfiguration;
  readonly classes: readonly TimetableClassInfo[];
  readonly teachers: readonly TimetableTeacherInfo[];
  readonly rooms: readonly Room[];
  readonly requirements: readonly TimetableRequirement[];
  readonly constraints: readonly TimetableConstraint[];
  /** Manually pinned slots preserved on regeneration (is_locked entries). */
  readonly lockedEntries: readonly TimetableSlotAssignment[];
}

export type TimetableSolutionStatus = "valid" | "invalid" | "partial";

export interface TimetableUnplacedBlock {
  readonly requirement: TimetableRequirement;
  readonly blockPeriods: number;
  readonly reason: string;
}

export interface TimetableSolutionStatistics {
  readonly placedPeriods: number;
  readonly requiredPeriods: number;
  readonly classesScheduled: number;
  readonly totalClasses: number;
  readonly teachersUsed: number;
  readonly roomsUsed: number;
  readonly hardViolationCount: number;
  readonly softViolationCount: number;
  readonly unplacedCount: number;
}

export interface TimetableSolution {
  readonly status: TimetableSolutionStatus;
  readonly entries: readonly TimetableSlotAssignment[];
  readonly unplaced: readonly TimetableUnplacedBlock[];
  readonly violations: readonly TimetableViolation[];
  readonly statistics: TimetableSolutionStatistics;
}

// ============================================================================
// Violations — the conflict-explanation contract (academic-rules.md §8)
// ============================================================================

export type TimetableViolationSeverity = "hard" | "soft";

export interface TimetableViolationRefs {
  readonly classId?: string;
  readonly teacherId?: string;
  readonly roomId?: string;
  readonly subjectId?: string;
  readonly day?: TimetableDay;
  readonly periodIndex?: number;
}

export interface TimetableViolation {
  readonly severity: TimetableViolationSeverity;
  /** Constraint kind or a resource-clash code (teacher_double_booking, …). */
  readonly kind: string;
  /** Human explanation in French (staff-facing). */
  readonly message: string;
  readonly refs: TimetableViolationRefs;
}

// ============================================================================
// Versioned schedule (mirrors 0109 §4/§5) — repository-level
// ============================================================================

export type TimetableVersionStatus =
  | "draft"
  | "in_review"
  | "approved"
  | "rejected"
  | "published"
  | "archived";

export const TIMETABLE_VERSION_STATUS_LABELS_FR: Record<TimetableVersionStatus, string> = {
  draft: "Brouillon",
  in_review: "En révision",
  approved: "Approuvée",
  rejected: "Rejetée",
  published: "Publiée",
  archived: "Archivée",
};

/** The allowed workflow transitions (0109 §4; enforced domain-side). */
export const TIMETABLE_VERSION_TRANSITIONS: Readonly<
  Record<TimetableVersionStatus, readonly TimetableVersionStatus[]>
> = {
  draft: ["in_review", "rejected"],
  in_review: ["approved", "rejected"],
  approved: ["published", "rejected"],
  rejected: [],
  published: ["archived"],
  archived: [],
};

export function canTransitionTimetableVersion(
  from: TimetableVersionStatus,
  to: TimetableVersionStatus,
): boolean {
  return TIMETABLE_VERSION_TRANSITIONS[from].includes(to);
}

export interface TimetableVersion {
  readonly id: string;
  readonly tenantId: string;
  readonly academicYearId: string;
  readonly versionNumber: number;
  readonly status: TimetableVersionStatus;
  readonly label: string | null;
  readonly solverId: string;
  readonly solverBuild: string | null;
  readonly generationParams: Readonly<Record<string, unknown>>;
  readonly statistics: Readonly<Record<string, unknown>>;
  readonly hardViolationCount: number;
  readonly softViolationCount: number;
  readonly unplacedCount: number;
  readonly createdBy: string | null;
  readonly createdByName: string | null;
  readonly reviewedBy: string | null;
  readonly reviewedAt: string | null;
  readonly reviewNote: string | null;
  readonly approvedBy: string | null;
  readonly approvedAt: string | null;
  readonly publishedBy: string | null;
  readonly publishedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * A persisted schedule slot (mirrors `timetable_entries` 0109 §5).
 * One row per (version, class, day, period).
 */
export interface TimetableScheduleEntry {
  readonly id: string;
  readonly tenantId: string;
  readonly academicYearId: string;
  readonly versionId: string;
  readonly classId: string;
  readonly subjectId: string;
  readonly teacherId: string | null;
  readonly roomId: string | null;
  readonly day: TimetableDay;
  readonly periodIndex: number;
  readonly startMinutes: number;
  readonly endMinutes: number;
  readonly lessonGroup: number;
  readonly isLocked: boolean;
  readonly source: "generated" | "manual";
  readonly notes: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function slotAssignmentFromEntry(
  entry: TimetableScheduleEntry,
): TimetableSlotAssignment {
  return {
    classId: entry.classId,
    subjectId: entry.subjectId,
    teacherId: entry.teacherId,
    roomId: entry.roomId,
    day: entry.day,
    periodIndex: entry.periodIndex,
    lessonGroup: entry.lessonGroup,
  };
}

// ============================================================================
// Generation progress — the runtime-observability contract (T-409 / SCHED-111)
// ============================================================================

/**
 * The REAL stages of a timetable generation run (T-409). The repository owns
 * "loading" and "saving"; the solver adapter owns "preparing", "placing",
 * "repairing" and "validating". Stage labels are presentation — the progress
 * itself must always come from actual work performed (never a timer).
 */
export type TimetableGenerationStage =
  | "loading" // Chargement des données (repository: problem load)
  | "preparing" // Préparation des besoins (solver: requirement/block indexing)
  | "placing" // Placement des cours (solver: block placement loop)
  | "repairing" // Réparation / optimisation (solver: repair pass)
  | "validating" // Validation finale (solver: canonical validator)
  | "saving"; // Enregistrement de l'essai (repository: version + entries)

export const TIMETABLE_GENERATION_STAGE_LABELS_FR: Record<
  TimetableGenerationStage,
  string
> = {
  loading: "Chargement des données",
  preparing: "Préparation des besoins",
  placing: "Placement des cours",
  repairing: "Réparation / optimisation",
  validating: "Validation finale",
  saving: "Enregistrement de l'essai",
};

/**
 * ONE progress event of a generation run.
 *
 * `processed` / `total` are CUMULATIVE REAL work units across the whole run
 * (requirements indexed + placement blocks processed + validation), NOT
 * timer ticks. `total` is FIXED once known; `total === 0` means "not yet
 * known" (e.g. during the initial data load) — consumers MUST treat that as
 * indeterminate, never as 0% of a fake denominator.
 *
 * The terminal 100% event is emitted by the repository ONLY after the
 * generated version and its entries have actually been persisted.
 */
export interface TimetableGenerationProgress {
  readonly stage: TimetableGenerationStage;
  readonly processed: number;
  readonly total: number;
  /** Stage-local detail, e.g. "63 / 118 blocs de placement traités". */
  readonly message: string;
}

export type TimetableProgressListener = (
  progress: TimetableGenerationProgress,
) => void;

/**
 * progressPercent = round(processedWorkUnits / totalWorkUnits * 100).
 * `total <= 0` → 0 (indeterminate — the caller renders no fake percentage).
 */
export function timetableGenerationProgressPercent(
  progress: TimetableGenerationProgress,
): number {
  if (progress.total <= 0) return 0;
  return Math.min(
    100,
    Math.round((progress.processed / progress.total) * 100),
  );
}

/**
 * Final timetable COVERAGE — a SEPARATE metric from generation progress
 * (T-409 §7): how complete the resulting timetable actually is.
 * coveragePercent = round(placedPeriods / requiredPeriods * 100).
 * `required <= 0` → 0 (nothing required — the UI renders "—", never a
 * fabricated 100%).
 */
export function timetableCoveragePercent(
  placedPeriods: number,
  requiredPeriods: number,
): number {
  if (requiredPeriods <= 0) return 0;
  return Math.min(100, Math.round((placedPeriods / requiredPeriods) * 100));
}
