/**
 * Workforce domain — iteration 8 (plan §09 expansion).
 *
 * Entities that turn Personnel from a directory into a full workforce
 * management system: departments, schedules/shifts, tasks, attendance,
 * leave requests, performance reviews, chat channels & messages,
 * onboarding state.
 *
 * All entities are immutable records. Mutations return new instances.
 */

/* ------------------------------------------------------------------ */
/*  Departments                                                        */
/* ------------------------------------------------------------------ */

/**
 * A logical grouping of employees. Plan §09 mentions a default taxonomy:
 * Administration, Managers, Supervisors, Buyers, Drivers, Warehouse, Sales,
 * Accounting, Teachers, Security, Human Resources, Maintenance, Other.
 *
 * Departments are tenant-scoped and can be added/edited/archived by admins.
 */
export interface Department {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly description: string;
  /** Color token used for avatars / chips. Must be a tailwind class suffix (e.g. "brand-blue"). */
  readonly color: string;
  /** Head of department (personnelId). */
  readonly headId: string | null;
  /** Parent department for nested org charts (null = top-level). */
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

/** Default department taxonomy (plan §09) — used by the onboarding wizard. */
export const DEFAULT_DEPARTMENTS: readonly { name: string; color: DepartmentColor }[] = [
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

export const WEEKDAYS: readonly Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export const WEEKDAY_LABELS_FR: Record<Weekday, string> = {
  mon: "Lundi",
  tue: "Mardi",
  wed: "Mercredi",
  thu: "Jeudi",
  fri: "Vendredi",
  sat: "Samedi",
  sun: "Dimanche",
};

export type ShiftType = "morning" | "afternoon" | "evening" | "night" | "split" | "flexible";

export const SHIFT_TYPE_LABELS_FR: Record<ShiftType, string> = {
  morning: "Matin",
  afternoon: "Après-midi",
  evening: "Soir",
  night: "Nuit",
  split: "Coupe",
  flexible: "Flexible",
};

/**
 * A shift template — defines the working hours for a given weekday + shift type.
 * Multiple shifts can apply to the same weekday (e.g. morning + evening).
 */
export interface Shift {
  readonly id: string;
  readonly tenantId: string;
  readonly label: string;
  readonly weekday: Weekday;
  readonly shiftType: ShiftType;
  /** Local time "HH:mm". */
  readonly startTime: string;
  /** Local time "HH:mm". */
  readonly endTime: string;
  /** Break duration in minutes. */
  readonly breakMinutes: number;
  readonly color: string;
}

/**
 * A schedule assigns one or more shifts to an employee for a given week.
 * Schedules are immutable; weekly revisions create new schedule records.
 */
export interface Schedule {
  readonly id: string;
  readonly tenantId: string;
  readonly personnelId: string;
  /** ISO date of the Monday that starts the schedule's week. */
  readonly weekStart: string;
  readonly shiftIds: readonly string[];
  /** Target hours for the week (override of personnel.weeklyHoursTarget). */
  readonly weeklyHoursTarget: number;
}

/* ------------------------------------------------------------------ */
/*  Tasks                                                              */
/* ------------------------------------------------------------------ */

export type TaskPriority = "low" | "medium" | "high" | "urgent";
export type TaskStatus = "pending" | "assigned" | "in_progress" | "blocked" | "completed" | "cancelled";

export const TASK_PRIORITY_LABELS_FR: Record<TaskPriority, string> = {
  low: "Basse",
  medium: "Moyenne",
  high: "Haute",
  urgent: "Urgente",
};

export const TASK_STATUS_LABELS_FR: Record<TaskStatus, string> = {
  pending: "En attente",
  assigned: "Affectée",
  in_progress: "En cours",
  blocked: "Bloquée",
  completed: "Terminée",
  cancelled: "Annulée",
};

export interface TaskAttachment {
  readonly id: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  /** Mock: data URL or relative path. Real impl: object-storage URL. */
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
  /** Employee(s) assigned to the task. Empty = unassigned. */
  readonly assigneeIds: readonly string[];
  /** Who created the task. */
  readonly createdBy: string;
  readonly createdByName: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly dueDate: string | null;
  readonly completedAt: string | null;
  readonly attachments: readonly TaskAttachment[];
  readonly comments: readonly TaskComment[];
  /** Optional progress percentage 0–100. */
  readonly progress: number;
  /** Tags for filtering (free-form). */
  readonly tags: readonly string[];
}

/* ------------------------------------------------------------------ */
/*  Attendance                                                         */
/* ------------------------------------------------------------------ */

export type AttendanceEventType = "clock_in" | "clock_out" | "break_start" | "break_end";

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
  readonly date: string;
  readonly timestamp: string;
  readonly eventType: AttendanceEventType;
  /** Optional geo or IP metadata (mock leaves null). */
  readonly metadata: { lat?: number; lng?: number; ip?: string } | null;
}

/* ------------------------------------------------------------------ */
/*  Leave / absence / overtime requests                                */
/* ------------------------------------------------------------------ */

export type RequestType = "leave" | "absence" | "overtime" | "shift_swap" | "remote";
export type RequestStatus = "pending" | "approved" | "rejected" | "cancelled";

export const REQUEST_TYPE_LABELS_FR: Record<RequestType, string> = {
  leave: "Congé",
  absence: "Absence",
  overtime: "Heures supplémentaires",
  shift_swap: "Échange de poste",
  remote: "Télétravail",
};

export const REQUEST_STATUS_LABELS_FR: Record<RequestStatus, string> = {
  pending: "En attente",
  approved: "Approuvée",
  rejected: "Refusée",
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
  readonly reason: string;
  readonly createdAt: string;
  readonly decidedAt: string | null;
  readonly decidedBy: string | null;
  readonly decidedByName: string | null;
  readonly decisionNote: string | null;
}

/* ------------------------------------------------------------------ */
/*  Performance reviews                                                */
/* ------------------------------------------------------------------ */

export interface PerformanceReview {
  readonly id: string;
  readonly tenantId: string;
  readonly personnelId: string;
  readonly personnelName: string;
  readonly period: string; // e.g. "2025-Q4" or "2025"
  readonly rating: number; // 0–5
  readonly strengths: string;
  readonly improvements: string;
  readonly goals: string;
  readonly reviewerId: string;
  readonly reviewerName: string;
  readonly reviewedAt: string;
}

/* ------------------------------------------------------------------ */
/*  Chat                                                               */
/* ------------------------------------------------------------------ */

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
  /** Member personnel IDs. For direct channels, exactly 2. */
  readonly memberIds: readonly string[];
  /** Department ID for department-type channels. */
  readonly departmentId: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly archivedAt: string | null;
  /** Last message preview (denormalized for list rendering). */
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
  /** IDs of personnel who have read the message. */
  readonly readBy: readonly string[];
  /** Optional voice note duration in seconds (mock only — no audio storage). */
  readonly voiceNoteSeconds: number | null;
}

/* ------------------------------------------------------------------ */
/*  Onboarding                                                         */
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
  /** Wizard-collected data (added to as the user advances). */
  readonly data: OnboardingData;
}

export interface OnboardingData {
  readonly departments: readonly { name: string; color: string; headId: string | null }[];
  readonly roles: readonly { role: string; count: number }[];
  readonly employeeCount: number;
  readonly adminIds: readonly string[];
  readonly managerAssignments: readonly { departmentName: string; managerId: string }[];
  readonly workingHours: { start: string; end: string; weekdays: readonly string[] };
  readonly shiftTypes: readonly string[];
  readonly permissionOverrides: Record<string, readonly string[]>;
}
