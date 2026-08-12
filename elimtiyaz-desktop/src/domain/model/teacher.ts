/**
 * Teacher domain model — normalized pedagogical teacher entity.
 *
 * DESIGN (per user spec):
 *
 *   Account  →  Person  →  Teacher  →  Subject(s)
 *   (auth)     (HR)       (pedagogy)  (matières)
 *
 * Relationships:
 *   - An **Account** represents a single person (auth identity).
 *   - A **Person** (Personnel record) may or may not be a teacher.
 *   - If a person IS a teacher, a **Teacher** record is created that
 *     references the Personnel record (NOT the account directly).
 *   - A Teacher can teach one or more **Subjects** (matières).
 *   - Every **Subject** must be assigned to at least one Teacher.
 *   - The **Work Schedule (Emploi du Temps / Timetable)** references the
 *     Teacher entity, which in turn references the underlying Person/Account.
 *     Schedules NEVER reference accounts directly.
 *
 * WHY A SEPARATE Teacher ENTITY?
 *   - The Personnel record carries HR data (salary, contract, department,
 *     emergency contact, etc.) that is irrelevant to pedagogy.
 *   - The Teacher record carries pedagogy-specific data (teacher code,
 *     subjects taught, max weekly hours, academic year scoping).
 *   - This normalization avoids duplicating personal information and
 *     keeps referential integrity clean: a schedule references a Teacher,
 *     a Teacher references a Person, a Person references an Account.
 *
 * ACADEMIC YEAR SCOPING:
 *   Teacher records are scoped per academic year. This allows a teacher
 *   to be active in 2025-2026 but on sabbatical in 2026-2027, with
 *   different subject assignments per year. The underlying Personnel
 *   record is shared across all years.
 *
 * Source: user spec (this conversation) + plan §05.07 + §08.
 */
import type { GradeLevel } from "./student";
import type { AcademicCycle, AcademicTerm } from "./academic";

/** Status of a teacher within an academic year. */
export type TeacherStatus = "active" | "on_leave" | "inactive";

export const TEACHER_STATUS_LABELS_FR: Record<TeacherStatus, string> = {
  active: "Actif",
  on_leave: "En congé",
  inactive: "Inactif",
};

/**
 * Teacher — the pedagogical teacher entity.
 *
 * References:
 *   - `personnelId` → Personnel record (the person/account). NOT NULL.
 *   - `academicYearId` → the academic year this teacher record is scoped to.
 *
 * A teacher can exist in multiple academic years (one Teacher record per
 * year per person). This allows year-specific subject assignments and
 * status changes without losing historical data.
 */
export interface Teacher {
  readonly id: string;
  readonly tenantId: string;
  /** FK → Personnel (the person/account). NEVER null. */
  readonly personnelId: string;
  /** Denormalized personnel display info (read from Personnel at creation). */
  readonly firstName: string;
  readonly lastName: string;
  /** Teacher-specific code, e.g. "ENS-2026-001". Unique within tenant. */
  readonly code: string;
  /** FK → AcademicYear. Root context for this teacher record. */
  readonly academicYearId: string;
  readonly academicYearCode: string;
  readonly status: TeacherStatus;
  /** Max teaching hours per week (pedagogy contract). */
  readonly maxWeeklyHours: number;
  /** Subject IDs this teacher is qualified to teach (catalog). */
  readonly qualifiedSubjectIds: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateTeacherInput {
  readonly personnelId: string;
  readonly code: string;
  readonly academicYearId: string;
  readonly academicYearCode: string;
  readonly status?: TeacherStatus;
  readonly maxWeeklyHours?: number;
  readonly qualifiedSubjectIds?: readonly string[];
}

export interface UpdateTeacherInput {
  readonly status?: TeacherStatus;
  readonly maxWeeklyHours?: number;
  readonly qualifiedSubjectIds?: readonly string[];
}

// ============================================================================
// Teacher ↔ Subject assignment (many-to-many within an academic year)
// ============================================================================

/**
 * TeacherSubjectAssignment — links a Teacher to a Subject for a given
 * academic year.
 *
 * A teacher can teach multiple subjects, and a subject can be taught by
 * multiple teachers (e.g., Math taught by Teacher A for 1AP and Teacher B
 * for 5AP). This assignment is the normalized link table.
 *
 * The `Subject.teacherId` field (on the Subject model) is the PRIMARY
 * teacher for that subject; this assignment table captures ALL teachers
 * qualified to teach it.
 */
export interface TeacherSubjectAssignment {
  readonly id: string;
  readonly tenantId: string;
  readonly teacherId: string;
  readonly subjectId: string;
  readonly academicYearId: string;
  readonly isPrimary: boolean;
  readonly createdAt: string;
}

export interface AssignTeacherSubjectInput {
  readonly teacherId: string;
  readonly subjectId: string;
  readonly academicYearId: string;
  readonly isPrimary?: boolean;
}

// ============================================================================
// Timetable (Emploi du Temps) — references Teacher, NOT Account
// ============================================================================

/** Day of the school week. Saturday and Sunday are excluded (Algerian school week). */
export type SchoolDay = "monday" | "tuesday" | "wednesday" | "thursday" | "friday";

export const SCHOOL_DAYS: readonly SchoolDay[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
];

export const SCHOOL_DAY_LABELS_FR: Record<SchoolDay, string> = {
  monday: "Lundi",
  tuesday: "Mardi",
  wednesday: "Mercredi",
  thursday: "Jeudi",
  friday: "Vendredi",
};

/** Time slot for a timetable entry. Stored as minutes-from-midnight for easy math. */
export interface TimeSlot {
  /** Minutes from midnight (0 = 00:00, 480 = 08:00, 1020 = 17:00). */
  readonly startMinutes: number;
  readonly endMinutes: number;
}

export function formatTimeSlot(slot: TimeSlot): string {
  const h = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  return `${h(slot.startMinutes)}–${h(slot.endMinutes)}`;
}

/**
 * TimetableEntry — a single slot in the Emploi du Temps.
 *
 * References:
 *   - `teacherId` → Teacher entity (which references Person/Account).
 *     NEVER references the account directly.
 *   - `classId` → the class being taught.
 *   - `subjectId` → the subject being taught.
 *   - `academicYearId` → the academic year this schedule belongs to.
 *
 * This is distinct from the workforce `Schedule` entity (which is for
 * HR shift management and references `personnelId`). The pedagogy
 * timetable always goes through the Teacher entity.
 */
export interface TimetableEntry {
  readonly id: string;
  readonly tenantId: string;
  readonly academicYearId: string;
  readonly classId: string;
  /** FK → Teacher (which references Person/Account). NEVER null. */
  readonly teacherId: string;
  readonly subjectId: string;
  readonly day: SchoolDay;
  readonly startMinutes: number;
  readonly endMinutes: number;
  readonly room: string | null;
  readonly notes: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateTimetableEntryInput {
  readonly academicYearId: string;
  readonly classId: string;
  readonly teacherId: string;
  readonly subjectId: string;
  readonly day: SchoolDay;
  readonly startMinutes: number;
  readonly endMinutes: number;
  readonly room?: string | null;
  readonly notes?: string | null;
}

export interface UpdateTimetableEntryInput {
  readonly startMinutes?: number;
  readonly endMinutes?: number;
  readonly room?: string | null;
  readonly notes?: string | null;
}

/**
 * Timetable — the full Emploi du Temps for a class in an academic year.
 * This is a read-model assembled from TimetableEntry records.
 */
export interface Timetable {
  readonly classId: string;
  readonly academicYearId: string;
  readonly entries: readonly TimetableEntry[];
}
