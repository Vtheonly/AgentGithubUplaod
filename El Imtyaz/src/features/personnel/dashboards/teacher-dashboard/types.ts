/**
 * Shared types + constants for the teacher-dashboard subfolder.
 *
 * Extracted from `teacher-dashboard.tsx` in task 6-b. Behavior preserved
 * verbatim — only file location changed.
 */
import type { AttendanceStatus } from "../../../../domain/model/academic";

/** Today's date as an ISO `YYYY-MM-DD` string. */
export const todayIso = (): string => new Date().toISOString().slice(0, 10);

/** Current academic year label used by the enter-grades modal. */
export const ACADEMIC_YEAR = "2025-2026";

/** A row in the "Communications parents" seed list on the dashboard. */
export interface ParentComm {
  id: string;
  parent: string;
  student: string;
  subject: string;
  at: string;
}

/** Seed communications shown on the dashboard (mock 3 entries). */
export const SEED_PARENT_COMMS: ParentComm[] = [
  { id: "pc-001", parent: "Mme Benali", student: "Yacine Benali", subject: "Devoir non rendu", at: "Hier · 16:42" },
  { id: "pc-002", parent: "M. Hadj Ali", student: "Lina Hadj Ali", subject: "Question sur le programme", at: "Lun · 09:15" },
  { id: "pc-003", parent: "Mme Cherif", student: "Sami Cherif", subject: "Absence prévue vendredi", at: "Mar · 11:08" },
];

/** Assessment kind selector in the enter-grades modal. */
export type AssessmentType = "devoir1" | "devoir2" | "examen";

/** Per-student attendance select options in the take-attendance modal. */
export const ATTENDANCE_OPTIONS: { value: AttendanceStatus; label: string; tone: "success" | "warning" | "danger" | "info" }[] = [
  { value: "present", label: "Présent", tone: "success" },
  { value: "late", label: "Retard", tone: "warning" },
  { value: "absent_excused", label: "Abs. excusée", tone: "info" },
  { value: "absent_unexcused", label: "Abs. non excusée", tone: "danger" },
];
