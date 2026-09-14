// ============================================================================
// FILE: src/domain/model/workforce.ts
// ============================================================================
/**
 * Workforce Domain Model.
 *
 * Defines:
 *   - Department org units
 *   - Work shifts and weekly schedules
 *   - Tasks and Review lifecycle
 *   - Worker Attendance, Absence Logs & Bidirectional Justification Loop
 *   - Leave and Overtime Requests
 *   - Internal Communication Channels
 */

/* ------------------------------------------------------------------ */
/*  Departments                                                        */
/* ------------------------------------------------------------------ */

export interface Department {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly description: string;
  readonly color: string;
  readonly headId: string | null;
  readonly parentId: string | null;
  readonly createdAt: string;
  readonly archivedAt: string | null;
}

export type DepartmentColor =
  | "brand-blue"
  | "brand-blue-deep"
  | "brand-gold"
  | "brand-brown"
  | "brand-slate"
  | "status-success"
  | "status-warning"
  | "status-danger"
  | "status-info";

export const DEPARTMENT_COLOR_OPTIONS: readonly DepartmentColor[] = [
  "brand-blue",
  "brand-blue-deep",
  "brand-gold",
  "brand-brown",
  "brand-slate",
  "status-success",
  "status-warning",
  "status-danger",
  "status-info",
];

export const DEFAULT_DEPARTMENTS: readonly {
  name: string;
  color: DepartmentColor;
}[] = [
  { name: "Administration", color: "brand-blue-deep" },
  { name: "Managers", color: "brand-blue" },
  { name: "Teachers", color: "brand-gold" },
  { name: "Buyers", color: "status-info" },
  { name: "Drivers", color: "brand-brown" },
  { name: "Warehouse", color: "status-success" },
  { name: "Sales", color: "brand-slate" },
  { name: "Accounting", color: "status-warning" },
  { name: "Security", color: "status-danger" },
  { name: "Human Resources", color: "brand-gold" },
  { name: "Maintenance", color: "brand-brown" },
];

/* ------------------------------------------------------------------ */
/*  Schedules & shifts                                                 */
/* ------------------------------------------------------------------ */

export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export const WEEKDAYS: readonly Weekday[] = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
];

export const WEEKDAY_LABELS_FR: Record<Weekday, string> = {
  mon: "Lundi",
  tue: "Mardi",
  wed: "Mercredi",
  thu: "Jeudi",
  fri: "Vendredi",
  sat: "Samedi",
  sun: "Dimanche",
};

export type ShiftType =
  | "morning"
  | "afternoon"
  | "evening"
  | "night"
  | "split"
  | "flexible";

export const SHIFT_TYPE_LABELS_FR: Record<ShiftType, string> = {
  morning: "Matin",
  afternoon: "Après-midi",
  evening: "Soir",
  night: "Nuit",
  split: "Coupe",
  flexible: "Flexible",
};

export interface Shift {
  readonly id: string;
  readonly tenantId: string;
  readonly label: string;
  readonly weekday: Weekday;
  readonly shiftType: ShiftType;
  readonly startTime: string; // HH:mm
  readonly endTime: string; // HH:mm
  readonly breakMinutes: number;
  readonly color: string;
}

export interface Schedule {
  readonly id: string;
  readonly tenantId: string;
  readonly personnelId: string;
  readonly weekStart: string; // ISO date of Monday
  readonly shiftIds: readonly string[];
  readonly weeklyHoursTarget: number;
}

/* ------------------------------------------------------------------ */
/*  Tasks & Review Lifecycle                                           */
/* ------------------------------------------------------------------ */

export type TaskPriority = "low" | "medium" | "high" | "urgent";

/**
 * Task Status Lifecycle:
 *   pending -> assigned -> in_progress -> needs_review -> completed
 *   (or cancelled at any point)
 */
export type TaskStatus =
  | "pending"
  | "assigned"
  | "in_progress"
  | "needs_review"
  | "completed"
  | "cancelled";

export const TASK_PRIORITY_LABELS_FR: Record<TaskPriority, string> = {
  low: "Basse",
  medium: "Moyenne",
  high: "Haute",
  urgent: "Urgente",
};

export const TASK_STATUS_LABELS_FR: Record<TaskStatus, string> = {
  pending: "En attente",
  assigned: "Assignée",
  in_progress: "En cours",
  needs_review: "À valider (par l'Admin)",
  completed: "Terminée & Validée",
  cancelled: "Annulée",
};

export interface TaskAttachment {
  readonly id: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly url: string;
}

export interface TaskComment {
  readonly id: string;
  readonly taskId: string;
  readonly authorId: string;
  readonly authorName: string;
  readonly body: string;
  readonly createdAt: string;
}

export interface Task {
  readonly id: string;
  readonly tenantId: string;
  readonly title: string;
  readonly description: string;
  readonly priority: TaskPriority;
  readonly status: TaskStatus;
  readonly departmentId: string | null;
  readonly assigneeIds: readonly string[];
  readonly createdBy: string;
  readonly createdByName: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly dueDate: string | null;
  readonly completedAt: string | null;
  readonly completedBy: string | null;
  readonly completionNote?: string | null;
  readonly reviewedBy?: string | null;
  readonly reviewNote?: string | null;
  readonly attachments: readonly TaskAttachment[];
  readonly comments: readonly TaskComment[];
  readonly progress: number; // 0..100
  readonly tags: readonly string[];
}

/* ------------------------------------------------------------------ */
/*  Attendance, Absences & Justifications                              */
/* ------------------------------------------------------------------ */

export type AttendanceEventType =
  | "clock_in"
  | "clock_out"
  | "break_start"
  | "break_end";

export const ATTENDANCE_EVENT_LABELS_FR: Record<AttendanceEventType, string> = {
  clock_in: "Pointage d'arrivée",
  clock_out: "Pointage de départ",
  break_start: "Début de pause",
  break_end: "Fin de pause",
};

export interface AttendanceEvent {
  readonly id: string;
  readonly tenantId: string;
  readonly personnelId: string;
  readonly date: string; // YYYY-MM-DD
  readonly timestamp: string; // ISO datetime
  readonly eventType: AttendanceEventType;
  readonly metadata: { lat?: number; lng?: number; ip?: string } | null;
}

/**
 * Absence Justification Workflow Status for Personnel:
 *   - `none`: No justification request issued
 *   - `requested`: Super Admin issued a request for justification to worker
 *   - `submitted`: Worker submitted explanation / medical certificate
 *   - `accepted`: Super Admin approved the justification (absence marked excused)
 *   - `rejected`: Super Admin rejected the justification (unexcused / deduction applied)
 */
export type StaffJustificationStatus =
  | "none"
  | "requested"
  | "submitted"
  | "accepted"
  | "rejected";

export const STAFF_JUSTIFICATION_STATUS_LABELS_FR: Record<
  StaffJustificationStatus,
  string
> = {
  none: "Non requise",
  requested: "Justification demandée par l'admin",
  submitted: "Justification soumise (à examiner)",
  accepted: "Justification acceptée",
  rejected: "Justification rejetée",
};

export interface StaffAbsenceRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly personnelId: string;
  readonly personnelName: string;
  readonly date: string; // YYYY-MM-DD
  readonly durationHours: number;
  readonly isExcused: boolean;
  readonly justificationStatus: StaffJustificationStatus;
  readonly adminRequestNote?: string | null; // What the admin asked
  readonly requestedAt?: string | null;
  readonly requestedBy?: string | null;
  readonly workerExplanation?: string | null; // What the worker explained
  readonly workerSubmittedAt?: string | null;
  readonly documentRef?: string | null;
  readonly decisionNote?: string | null; // Admin approval/rejection note
  readonly decidedAt?: string | null;
  readonly decidedBy?: string | null;
}

/* ------------------------------------------------------------------ */
/*  Leave & Spending Requests                                          */
/* ------------------------------------------------------------------ */

export type RequestType =
  | "leave"
  | "absence"
  | "overtime"
  | "shift_swap"
  | "remote"
  | "spending_reimbursement";
export type RequestStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "clarification_requested"
  | "cancelled";

export const REQUEST_TYPE_LABELS_FR: Record<RequestType, string> = {
  leave: "Congé",
  absence: "Absence autorisée",
  overtime: "Heures supplémentaires",
  shift_swap: "Échange de poste",
  remote: "Télétravail",
  spending_reimbursement: "Remboursement / Frais",
};

export const REQUEST_STATUS_LABELS_FR: Record<RequestStatus, string> = {
  pending: "En attente",
  approved: "Approuvée",
  rejected: "Refusée",
  clarification_requested: "Justification demandée",
  cancelled: "Annulée",
};

export interface LeaveRequest {
  readonly id: string;
  readonly tenantId: string;
  readonly personnelId: string;
  readonly personnelName: string;
  readonly type: RequestType;
  readonly status: RequestStatus;
  readonly fromDate: string;
  readonly toDate: string;
  readonly amountRequested?: number | null; // For spending/reimbursement
  readonly reason: string;
  readonly createdAt: string;
  readonly decidedAt: string | null;
  readonly decidedBy: string | null;
  readonly decidedByName: string | null;
  readonly decisionNote: string | null;
  readonly clarificationRequest?: string | null;
  readonly clarificationResponse?: string | null;
}

/* ------------------------------------------------------------------ */
/*  Performance & Communication                                        */
/* ------------------------------------------------------------------ */

export interface PerformanceReview {
  readonly id: string;
  readonly tenantId: string;
  readonly personnelId: string;
  readonly personnelName: string;
  readonly period: string;
  readonly rating: number;
  readonly strengths: string;
  readonly improvements: string;
  readonly goals: string;
  readonly reviewerId: string;
  readonly reviewerName: string;
  readonly reviewedAt: string;
}

export type ChannelType = "direct" | "group" | "department" | "announcement";

export const CHANNEL_TYPE_LABELS_FR: Record<ChannelType, string> = {
  direct: "Message direct",
  group: "Groupe",
  department: "Département",
  announcement: "Annonce",
};

export interface ChatChannel {
  readonly id: string;
  readonly tenantId: string;
  readonly type: ChannelType;
  readonly name: string;
  readonly description: string | null;
  readonly memberIds: readonly string[];
  readonly departmentId: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly archivedAt: string | null;
  readonly lastMessageAt: string | null;
  readonly lastMessagePreview: string | null;
}

export interface ChatMessage {
  readonly id: string;
  readonly channelId: string;
  readonly authorId: string;
  readonly authorName: string;
  readonly body: string;
  readonly createdAt: string;
  readonly editedAt: string | null;
  readonly attachments: readonly TaskAttachment[];
  readonly readBy: readonly string[];
  readonly voiceNoteSeconds: number | null;
}

/* ------------------------------------------------------------------ */
/*  Onboarding Wizard State                                            */
/* ------------------------------------------------------------------ */

export type OnboardingStep =
  | "welcome"
  | "departments"
  | "roles"
  | "employees"
  | "admins"
  | "managers"
  | "working_hours"
  | "shift_types"
  | "permissions"
  | "review"
  | "done";

export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  "welcome",
  "departments",
  "roles",
  "employees",
  "admins",
  "managers",
  "working_hours",
  "shift_types",
  "permissions",
  "review",
  "done",
];

export interface OnboardingState {
  readonly tenantId: string;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly currentStep: OnboardingStep;
  readonly completedSteps: ReadonlySet<OnboardingStep>;
  readonly data: OnboardingData;
}

export interface OnboardingData {
  readonly departments: readonly {
    name: string;
    color: string;
    headId: string | null;
  }[];
  readonly roles: readonly { role: string; count: number }[];
  readonly employeeCount: number;
  readonly adminIds: readonly string[];
  readonly managerAssignments: readonly {
    departmentName: string;
    managerId: string;
  }[];
  readonly workingHours: {
    start: string;
    end: string;
    weekdays: readonly string[];
  };
  readonly shiftTypes: readonly string[];
  readonly permissionOverrides: Record<string, readonly string[]>;
}
