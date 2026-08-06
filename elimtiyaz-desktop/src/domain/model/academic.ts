import type { AcademicLevel, GradeLevel } from "./student";

export type AcademicCycle = "prescolaire" | "primaire" | "cem" | "lycee";
export type AcademicTerm = "T1" | "T2" | "T3";
export type TermStructure = "semester" | "trimester" | "quarter";

export interface AcademicYear {
  readonly id: string;
  readonly tenantId: string;
  readonly code: string; // e.g. "2025-2026"
  readonly label: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly termStructure: TermStructure;
  readonly isCurrent: boolean;
  readonly isArchived: boolean;
}

export interface AcademicLevelModel {
  readonly id: string;
  readonly tenantId: string;
  readonly cycle: AcademicCycle;
  readonly gradeCode: GradeLevel;
  readonly labelFr: string;
  readonly labelAr: string | null;
  readonly yearNumber: number;
  readonly sortOrder: number;
  readonly isActive: boolean;
}

export interface AcademicClass {
  readonly id: string;
  readonly tenantId: string;
  readonly academicYearId: string;
  readonly academicLevelId: string;
  readonly code: string; // e.g. "CLS-3AP-B"
  readonly name: string; // e.g. "3ème AP - Section B"
  readonly gradeCode: GradeLevel;
  readonly level: AcademicLevel;
  readonly gradeYear: number;
  readonly section: string; // e.g. "Section B"
  readonly room: string | null;
  /** Maximum student capacity. `null` = unlimited. */
  readonly capacity: number | null;
  readonly enrolledCount: number;
  readonly homeroomTeacherId: string | null;
  readonly homeroomTeacherName: string | null;
  readonly notes: string | null; // Custom notes/observations per class
  readonly academicYear: string;
  readonly isActive: boolean;
}

export interface Subject {
  readonly id: string;
  readonly tenantId: string;
  readonly code: string;
  readonly name: string;
  readonly nameAr: string | null;
  readonly cycle: AcademicCycle;
  readonly level: AcademicLevel;
  readonly coefficient: number;
  readonly passingGrade: number;
  readonly isExtracurricular: boolean;
  readonly isActive: boolean;
  /**
   * FK → Teacher (the primary teacher for this subject).
   *
   * Per user spec: "Every subject (matière) must be assigned to a teacher."
   * This is the PRIMARY teacher; additional qualified teachers are linked
   * via TeacherSubjectAssignment.
   *
   * NOTE: This references the Teacher entity (which references Person/Account),
   * NOT the account directly. Nullable during creation but must be assigned
   * before the subject can be activated.
   */
  readonly teacherId: string | null;
  /** Denormalized teacher display name (read from Teacher→Personnel at assignment). */
  readonly teacherName: string | null;
  /**
   * FK → AcademicYear. Root context.
   * Subjects are scoped per academic year so the catalog can evolve
   * (new subjects added, old ones retired) without affecting historical data.
   */
  readonly academicYearId: string;
  readonly academicYearCode: string;
}

export interface ClassSubject {
  readonly id: string;
  readonly classId: string;
  readonly subjectId: string;
  readonly teacherId: string | null;
  readonly teacherName: string | null;
  readonly weeklyHours: number;
  readonly coefficient: number;
}

export interface Assessment {
  readonly id: string;
  readonly studentId: string;
  readonly classId: string;
  readonly subjectId: string;
  readonly term: AcademicTerm;
  readonly academicYear: string;
  readonly devoir1: number | null;
  readonly devoir2: number | null;
  readonly examen: number | null;
  readonly subjectAverage: number | null;
  readonly coefficient: number;
  readonly enteredBy: string;
  readonly enteredAt: string;
}

export type AttendanceStatus =
  | "present"
  | "absent_excused"
  | "absent_unexcused"
  | "late";
export type AttendanceSession = "morning" | "afternoon" | "both";

export interface AttendanceRecord {
  readonly id: string;
  readonly studentId: string;
  readonly classId: string;
  readonly date: string;
  readonly session: AttendanceSession;
  readonly status: AttendanceStatus;
  readonly note: string | null;
  readonly recordedBy: string;
  readonly recordedAt: string;
  readonly syncedAt: string | null;
}

export interface Homework {
  readonly id: string;
  readonly classId: string;
  readonly subjectId: string;
  readonly subjectName: string;
  readonly teacherId: string;
  readonly teacherName: string;
  readonly title: string;
  readonly description: string;
  readonly dueDate: string;
  readonly attachments: readonly string[];
  readonly academicYear: string;
  readonly createdAt: string;
  readonly pushedAt: string | null;
  readonly acknowledgedCount: number;
}

export type PromotionDecision =
  | "promoted"
  | "repeated"
  | "graduated"
  | "transferred";

export interface AcademicHistoryEntry {
  readonly id?: string;
  readonly studentId: string;
  readonly academicYear: string;
  readonly cycle: AcademicCycle;
  readonly level: AcademicLevel;
  readonly gradeCode: GradeLevel;
  readonly gradeYear: number;
  readonly classId: string | null;
  readonly className: string | null;
  readonly gpa: number;
  readonly rank: number | null;
  readonly decision: PromotionDecision;
  readonly narrative: string | null;
  readonly recordedAt?: string;
}

export const ATTENDANCE_STATUS_LABELS_FR: Record<AttendanceStatus, string> = {
  present: "Présent",
  absent_excused: "Absence excusée",
  absent_unexcused: "Absence non excusée",
  late: "Retard",
};

export const ATTENDANCE_STATUS_SHORT: Record<AttendanceStatus, string> = {
  present: "P",
  absent_excused: "AE",
  absent_unexcused: "AN",
  late: "R",
};

export const SESSION_LABELS_FR: Record<AttendanceSession, string> = {
  morning: "Matin",
  afternoon: "Après-midi",
  both: "Les deux",
};

export const PROMOTION_DECISION_LABELS_FR: Record<PromotionDecision, string> = {
  promoted: "Promu(e)",
  repeated: "Redouble",
  graduated: "Diplômé(e)",
  transferred: "Transféré(e)",
};

export const DEFAULT_PASSING_GRADE = 10.0;

export function computeSubjectAverage(
  devoir1: number | null,
  devoir2: number | null,
  examen: number | null,
): number | null {
  if (devoir1 == null && devoir2 == null && examen == null) return null;
  const d1 = devoir1 ?? 0;
  const d2 = devoir2 ?? 0;
  const ex = examen ?? 0;
  return Number(((d1 + d2 + ex * 2) / 4).toFixed(2));
}

export function computeOverallGpa(
  assessments: ReadonlyArray<{
    subjectAverage: number | null;
    coefficient: number;
    isExtracurricular?: boolean;
  }>,
): number | null {
  let weightedSum = 0;
  let totalCoef = 0;

  for (const a of assessments) {
    if (a.subjectAverage == null || a.isExtracurricular) continue;
    weightedSum += a.subjectAverage * a.coefficient;
    totalCoef += a.coefficient;
  }

  if (totalCoef === 0) return null;
  return Number((weightedSum / totalCoef).toFixed(2));
}

export function isPassing(
  gpa: number,
  passingGrade = DEFAULT_PASSING_GRADE,
): boolean {
  return gpa >= passingGrade;
}

export function validateScore(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 20;
}

export function calculateAttendanceRate(
  records: readonly AttendanceRecord[],
): number {
  if (records.length === 0) return 1.0;
  const presentCount = records.filter(
    (r) => r.status === "present" || r.status === "late",
  ).length;
  return Number((presentCount / records.length).toFixed(2));
}
