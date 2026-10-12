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

/**
 * T-484 (140th session, 2026-10-04): the WEEKLY-template vocabulary below
 * (Weekday / ShiftType) stays — it is the ONBOARDING WIZARD's data model
 * (data.shiftTypes: string[] etc.), not the Shift entity's. The Shift /
 * Schedule ENTITIES are aligned to the canonical 0010 schema (the DB is the
 * source of truth — the pre-T-484 desktop shapes were a parallel
 * imagination: weekday/shiftType templates + weekStart+shiftIds[] chunks,
 * none of which the 0010 tables can store).
 */

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

/**
 * Shift — a REUSABLE work-time template (canonical 0010 §2):
 *   code (tenant-unique, e.g. 'MORNING'), name, start/end times
 *   (HH:mm local, no timezone — interpreted in tenant.timezone), the
 *   grace period before a clock-in is flagged late, the color token, the
 *   active flag. NO weekday — a template is assigned per-DAY through
 *   `Schedule`.
 */
export interface Shift {
  readonly id: string;
  readonly tenantId: string;
  readonly code: string; // tenant-unique ('MORNING', 'AFTERNOON', …)
  readonly name: string; // display label ('Matin standard', …)
  readonly startTime: string; // HH:mm
  readonly endTime: string; // HH:mm (must be later than startTime)
  readonly gracePeriodMinutes: number; // ≥ 0
  readonly colorHex: string | null; // '#RRGGBB' or null
  readonly isActive: boolean;
}

/**
 * Schedule — a per-DAY shift assignment for one personnel member
 * (canonical 0010 §3): exactly one row per (tenant, personnel, date)
 * (the 0010 unique), pointing at a Shift template with OPTIONAL start/end
 * overrides for that specific day and a free-form note.
 */
export interface Schedule {
  readonly id: string;
  readonly tenantId: string;
  readonly personnelId: string;
  readonly shiftId: string | null;
  readonly date: string; // YYYY-MM-DD
  readonly startTime: string | null; // day override of shift.startTime
  readonly endTime: string | null; // day override of shift.endTime
  readonly note: string | null;
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

// T-463 / CHAT-300 (0135): which chat system a channel belongs to.
// 'portal' = contains at least one parent/student member (the ADR-012
// portal↔staff communication); 'internal' = all members are staff/workers
// (the ADR-008 workplace messenger). Derived SERVER-SIDE by the
// chat_channels_derive_scope trigger — clients can never mislabel it.
export type ChatChannelScope = "internal" | "portal";

export const CHAT_CHANNEL_SCOPE_LABELS_FR: Record<ChatChannelScope, string> = {
  internal: "Messagerie interne",
  portal: "Messagerie portail",
};

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
  /** T-463 / CHAT-300: the chat system this channel belongs to (0135 column, server-derived). */
  readonly scope: ChatChannelScope;
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
  /**
   * T-515 (WORKFORCE-516, the owner's issue 3): the working-HOURS
   * configuration (start/end clock times + a weekday abstraction) is
   * REPLACED by the working DAYS of a selected month — a calendar of
   * per-day toggles with the auto-computed total. `year` is the Gregorian
   * year, `month` is 1–12, `days` are the selected day-of-month numbers
   * (ascending, unique, valid for the month).
   */
  readonly workingDays: {
    readonly year: number;
    readonly month: number;
    readonly days: readonly number[];
  };
  readonly shiftTypes: readonly string[];
  readonly permissionOverrides: Record<string, readonly string[]>;
}

// ============================================================================
// T-515 (WORKFORCE-516) — the working-days calendar vocabulary
// ============================================================================

/** The working-days configuration shape (see OnboardingData.workingDays). */
export interface WorkingDaysConfig {
  readonly year: number;
  readonly month: number;
  readonly days: readonly number[];
}

/** The days of a Gregorian month (month 1–12) — 28/29/30/31 per leap year. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Is `month` a valid 1–12 month number? */
function isValidMonth(month: unknown): month is number {
  return typeof month === "number" && Number.isInteger(month) && month >= 1 && month <= 12;
}

/** Is `year` a plausible Gregorian year (the wizard's navigator bound)? */
function isValidYear(year: unknown): year is number {
  return typeof year === "number" && Number.isInteger(year) && year >= 1900 && year <= 2200;
}

/**
 * The DEFAULT selection for a month: the Algerian school week, Dimanche à
 * Jeudi (the T-243 convention — the repo's documented school week; every
 * day remains individually toggleable, this is only the starting lens).
 */
export function schoolWeekDaysOfMonth(year: number, month: number): number[] {
  const out: number[] = [];
  const total = daysInMonth(year, month);
  for (let day = 1; day <= total; day++) {
    const jsDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    // 0 = Sunday (Dimanche), 1–4 = Monday–Thursday (Lundi–Jeudi).
    if (jsDay === 0 || (jsDay >= 1 && jsDay <= 4)) out.push(day);
  }
  return out;
}

/**
 * T-515 (WORKFORCE-516): the default working-days configuration — the
 * CURRENT month (the wizard asks "which days of THIS month are worked")
 * preselected with the school week (Dim–Jeu), every day toggleable.
 */
export function defaultWorkingDays(now: Date = new Date()): WorkingDaysConfig {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  return { year, month, days: schoolWeekDaysOfMonth(year, month) };
}

/**
 * T-515 (WORKFORCE-516): validate/repair a raw workingDays payload (the
 * JSONB round-trip or a legacy row): the month/year fall back to the
 * current month; the days are de-duplicated, clamped to the month's
 * length, and sorted ascending. NEVER throws — a corrupt row degrades to
 * the documented default (the wizard stays usable; the §15.24 no-crash-
 * on-corrupt-rows discipline).
 */
export function normalizeWorkingDays(raw: unknown): WorkingDaysConfig {
  const r = (raw ?? {}) as Partial<WorkingDaysConfig>;
  const fallback = defaultWorkingDays();
  const year = isValidYear(r.year) ? r.year : fallback.year;
  const month = isValidMonth(r.month) ? r.month : fallback.month;
  const total = daysInMonth(year, month);
  const days = Array.isArray(r.days)
    ? [...new Set(r.days)]
        .filter((d): d is number => typeof d === "number" && Number.isInteger(d) && d >= 1 && d <= total)
        .sort((a, b) => a - b)
    : schoolWeekDaysOfMonth(year, month);
  return { year, month, days };
}

/**
 * T-515 (WORKFORCE-516): the read-time normalizer for the WHOLE
 * OnboardingData payload — the LIVE singleton row (censused this session:
 * scripts/t515-onboarding-census.json) carries the LEGACY
 * `workingHours: {start, end, weekdays}` shape; on the new contract the
 * legacy key is simply ignored (data_json is schemaless JSONB — no
 * migration, the old keys linger harmlessly) and `workingDays` degrades
 * to the documented default. Every repository mapping seam routes through
 * this ONE implementation (§6/§9 — never a per-repo twin).
 */
export function normalizeOnboardingData(raw: unknown): OnboardingData {
  const r = (raw ?? {}) as Partial<OnboardingData> & Record<string, unknown>;
  return {
    departments: Array.isArray(r.departments) ? r.departments : [],
    roles: Array.isArray(r.roles) ? r.roles : [],
    employeeCount: typeof r.employeeCount === "number" ? r.employeeCount : 0,
    adminIds: Array.isArray(r.adminIds) ? r.adminIds : [],
    managerAssignments: Array.isArray(r.managerAssignments) ? r.managerAssignments : [],
    workingDays: normalizeWorkingDays(r.workingDays),
    shiftTypes: Array.isArray(r.shiftTypes) ? r.shiftTypes : [],
    permissionOverrides:
      r.permissionOverrides && typeof r.permissionOverrides === "object" && !Array.isArray(r.permissionOverrides)
        ? (r.permissionOverrides as Record<string, readonly string[]>)
        : {},
  };
}
