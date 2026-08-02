/**
 * Academic domain — classes, subjects, assessments, attendance, homework.
 *
 * Plan §05 enforces a hard boundary between Scolarité (formal academics)
 * and Extracurricular (clubs & therapy). Club grades NEVER bleed into
 * Scolarité GPA. The `isExtracurricular` flag on Subject enforces this.
 *
 * Grading formula (plan §06):
 *   subject_average = (D1 + D2 + 2·Examen) / 4   (each 0..20)
 *   overall_gpa     = Σ(subject_avg × coef) / Σ(coef)
 *   passing grade   = 10.0 (admin-configurable)
 */
import type { AcademicLevel } from "./student";

export interface AcademicClass {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string; // "5ème A"
  readonly level: AcademicLevel;
  readonly gradeYear: number;
  readonly homeroomTeacherId: string | null;
  readonly homeroomTeacherName: string | null;
  readonly room: string | null;
  readonly capacity: number;
  readonly enrolledCount: number;
  readonly academicYear: string;
}

export interface Subject {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly nameAr: string | null;
  readonly code: string; // MATH, PHY, AR, FR, EN, ISL...
  readonly level: AcademicLevel;
  readonly coefficient: number;
  readonly isExtracurricular: boolean; // §05.07 — clubs & therapy
  readonly passingGrade: number;
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

export type AcademicTerm = "T1" | "T2" | "T3";

export interface Assessment {
  readonly id: string;
  readonly studentId: string;
  readonly subjectId: string;
  readonly classId: string;
  readonly term: AcademicTerm;
  readonly academicYear: string;
  readonly devoir1: number | null; // 0..20
  readonly devoir2: number | null; // 0..20
  readonly examen: number | null; // 0..20, weighted 2×
  readonly subjectAverage: number | null;
  readonly coefficient: number;
  readonly enteredBy: string;
  readonly enteredAt: string;
}

export type AttendanceStatus = "present" | "absent_excused" | "absent_unexcused" | "late";
export type AttendanceSession = "morning" | "afternoon" | "both";

export interface AttendanceRecord {
  readonly id: string;
  readonly studentId: string;
  readonly classId: string;
  readonly date: string; // ISO date (yyyy-MM-dd)
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

/**
 * Pure grade computation — exposed for both UI and use-case layers.
 * Source: plan §06.02.
 */
export function computeSubjectAverage(
  devoir1: number | null,
  devoir2: number | null,
  examen: number | null,
): number | null {
  if (devoir1 == null && devoir2 == null && examen == null) return null;
  const d1 = devoir1 ?? 0;
  const d2 = devoir2 ?? 0;
  const ex = examen ?? 0;
  return (d1 + d2 + 2 * ex) / 4;
}

export function computeOverallGpa(
  assessments: ReadonlyArray<{ subjectAverage: number | null; coefficient: number }>,
): number | null {
  let weightedSum = 0;
  let coefSum = 0;
  for (const a of assessments) {
    if (a.subjectAverage == null) continue;
    weightedSum += a.subjectAverage * a.coefficient;
    coefSum += a.coefficient;
  }
  return coefSum === 0 ? null : weightedSum / coefSum;
}

export function isPassing(gpa: number, passingGrade = 10.0): boolean {
  return gpa >= passingGrade;
}

export function validateScore(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 20;
}
