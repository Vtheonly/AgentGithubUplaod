/**
 * Personnel / HR domain — plan §09.
 *
 * 4 staff categories drive default permission templates and reporting breakdowns.
 * ReleveEntry = append-only teacher activity ledger (grades entered, homework,
 * attendance submitted, hours taught). Audit basis for payroll.
 */
export type StaffCategory = "teacher" | "administration" | "support" | "maintenance" | "driver";
export type PersonnelStatus = "active" | "on_leave" | "suspended" | "terminated";
export type ReleveActivity = "course" | "meeting" | "supervision" | "correction" | "other";

export interface Personnel {
  readonly id: string;
  readonly tenantId: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly staffCategory: StaffCategory;
  readonly phone: string;
  readonly email: string | null;
  readonly hireDate: string;
  readonly salary: number | null;
  readonly weeklyHoursTarget: number;
  readonly weeklyHoursLogged: number;
  readonly avatarUrl: string | null;
  readonly status: PersonnelStatus;
}

export interface ReleveEntry {
  readonly id: string;
  readonly personnelId: string;
  readonly personnelName: string;
  readonly date: string;
  readonly hoursIn: number;
  readonly hoursOut: number | null;
  readonly activity: ReleveActivity;
  readonly classId: string | null;
  readonly subjectId: string | null;
  readonly recordedAt: string;
}

export const STAFF_CATEGORY_LABELS_FR: Record<StaffCategory, string> = {
  teacher: "Enseignant",
  administration: "Administration",
  support: "Soutien",
  maintenance: "Maintenance",
  driver: "Chauffeur",
};

export const PERSONNEL_STATUS_LABELS_FR: Record<PersonnelStatus, string> = {
  active: "Actif",
  on_leave: "En congé",
  suspended: "Suspendu",
  terminated: "Licencié",
};

export const RELEVE_ACTIVITY_LABELS_FR: Record<ReleveActivity, string> = {
  course: "Cours",
  meeting: "Réunion",
  supervision: "Surveillance",
  correction: "Correction",
  other: "Autre",
};
