// ============================================================================
// FILE: src/domain/repository/workforce-repository.ts
// ============================================================================
import type { Result } from "../../core/result";
import type { Observable } from "./repository";
import type {
  Department,
  Shift,
  Schedule,
  Task,
  TaskPriority,
  TaskStatus,
  TaskAttachment,
  TaskComment,
  AttendanceEvent,
  AttendanceEventType,
  StaffAbsenceRecord,
  StaffJustificationStatus,
  LeaveRequest,
  RequestType,
  RequestStatus,
  PerformanceReview,
  ChatChannel,
  ChatMessage,
  ChatChannelScope,
  ChannelType,
  OnboardingState,
  OnboardingStep,
  OnboardingData,
} from "../model/workforce";
import type {
  SalaryAdjustment,
  SalaryAdjustmentType,
  SalaryPaymentRecord,
  PayrollMethod,
} from "../model/personnel";

export interface DepartmentRepository {
  observe(): Observable<Department[]>;
  observeById(id: string): Observable<Department | null>;
  createDepartment(
    input: Omit<Department, "id" | "tenantId" | "createdAt" | "archivedAt">,
  ): Promise<Result<Department>>;
  updateDepartment(
    id: string,
    updates: Partial<Department>,
  ): Promise<Result<Department>>;
  archiveDepartment(id: string): Promise<Result<Department>>;
  unarchiveDepartment(id: string): Promise<Result<Department>>;
  deleteDepartment(id: string): Promise<Result<void>>;
}

/**
 * T-484 (140th session): the contracts' METHOD SET is unchanged; the input
 * types are re-based onto the canonical 0010 model (Shift = a reusable
 * work-time template; Schedule = a per-day assignment — see
 * domain/model/workforce.ts). observeByWeek keeps its weekStart (ISO
 * Monday) parameter and returns the schedule rows whose DATE falls inside
 * that week [weekStart, weekStart+6] — the per-day rows are the truth, the
 * week is a read-side window.
 */
export interface ShiftRepository {
  observe(): Observable<Shift[]>;
  createShift(input: Omit<Shift, "id" | "tenantId">): Promise<Result<Shift>>;
  updateShift(id: string, updates: Partial<Shift>): Promise<Result<Shift>>;
  deleteShift(id: string): Promise<Result<void>>;
}

export interface ScheduleRepository {
  observeByPersonnel(personnelId: string): Observable<Schedule[]>;
  observeByWeek(weekStart: string): Observable<Schedule[]>;
  upsertSchedule(
    input: Omit<Schedule, "id" | "tenantId"> & { id?: string },
  ): Promise<Result<Schedule>>;
  deleteSchedule(id: string): Promise<Result<void>>;
}

export interface TaskRepository {
  observe(): Observable<Task[]>;
  /**
   * T-371 (WORKFORCE-501) id-space note: the argument is the ACCOUNT id
   * (user_profiles.id) — the id space `tasks.assignee_ids` stores per the
   * 0010 schema + 0019 RLS (`assignee_ids @> current_user_profile_id`).
   * The legacy parameter NAME (`personnelId`) is kept to avoid a breaking
   * rename across every consumer; pass the signed-in user's profile id.
   */
  observeByAssignee(personnelId: string): Observable<Task[]>;
  observeByDepartment(departmentId: string): Observable<Task[]>;
  observeById(id: string): Observable<Task | null>;
  createTask(input: {
    title: string;
    description: string;
    priority: TaskPriority;
    departmentId: string | null;
    assigneeIds: readonly string[];
    dueDate: string | null;
    createdBy: string;
    createdByName: string;
    attachments?: readonly TaskAttachment[];
    tags?: readonly string[];
  }): Promise<Result<Task>>;
  updateTask(id: string, updates: Partial<Task>): Promise<Result<Task>>;
  updateTaskStatus(
    id: string,
    status: TaskStatus,
    actorId: string,
    completionNote?: string,
  ): Promise<Result<Task>>;
  reviewTask(
    id: string,
    approved: boolean,
    reviewerId: string,
    reviewerName: string,
    reviewNote?: string,
  ): Promise<Result<Task>>;
  reassign(
    id: string,
    assigneeIds: readonly string[],
    actorId: string,
  ): Promise<Result<Task>>;
  addComment(
    id: string,
    comment: Omit<TaskComment, "id" | "taskId" | "createdAt">,
  ): Promise<Result<TaskComment>>;
  addAttachment(id: string, attachment: TaskAttachment): Promise<Result<Task>>;
  deleteTask(id: string): Promise<Result<void>>;
}

export interface AttendanceRepository {
  observeByPersonnel(
    personnelId: string,
    fromDate: string,
    toDate: string,
  ): Observable<AttendanceEvent[]>;
  observeByDate(date: string): Observable<AttendanceEvent[]>;
  latestFor(personnelId: string, date: string): AttendanceEvent | null;
  recordEvent(input: {
    personnelId: string;
    date: string;
    eventType: AttendanceEventType;
    metadata?: { lat?: number; lng?: number; ip?: string } | null;
  }): Promise<Result<AttendanceEvent>>;

  // Absence & Justification Loop
  observeAbsences(personnelId?: string): Observable<StaffAbsenceRecord[]>;
  requestAbsenceJustification(input: {
    absenceId: string;
    adminNote: string;
    requestedBy: string;
  }): Promise<Result<StaffAbsenceRecord>>;
  submitAbsenceJustification(input: {
    absenceId: string;
    workerExplanation: string;
    documentRef?: string | null;
  }): Promise<Result<StaffAbsenceRecord>>;
  reviewAbsenceJustification(input: {
    absenceId: string;
    decision: "accepted" | "rejected";
    decisionNote: string;
    decidedBy: string;
  }): Promise<Result<StaffAbsenceRecord>>;
}

export interface LeaveRequestRepository {
  observe(): Observable<LeaveRequest[]>;
  observeByPersonnel(personnelId: string): Observable<LeaveRequest[]>;
  observePending(): Observable<LeaveRequest[]>;
  submit(input: {
    personnelId: string;
    personnelName: string;
    type: RequestType;
    fromDate: string;
    toDate: string;
    amountRequested?: number | null;
    reason: string;
  }): Promise<Result<LeaveRequest>>;
  decide(
    id: string,
    status: RequestStatus,
    decidedBy: string,
    decidedByName: string,
    note?: string,
  ): Promise<Result<LeaveRequest>>;
  requestClarification(
    id: string,
    question: string,
    requestedBy: string,
  ): Promise<Result<LeaveRequest>>;
  respondClarification(
    id: string,
    response: string,
  ): Promise<Result<LeaveRequest>>;
  cancel(id: string): Promise<Result<LeaveRequest>>;
}

export interface PerformanceReviewRepository {
  observeByPersonnel(personnelId: string): Observable<PerformanceReview[]>;
  createReview(
    input: Omit<PerformanceReview, "id" | "tenantId" | "reviewedAt">,
  ): Promise<Result<PerformanceReview>>;
  updateReview(
    id: string,
    updates: Partial<PerformanceReview>,
  ): Promise<Result<PerformanceReview>>;
  deleteReview(id: string): Promise<Result<void>>;
}

export interface ChatRepository {
  /**
   * T-463 / CHAT-300: the member's channels, optionally restricted to ONE
   * chat system ('internal' = the workplace messenger, 'portal' = the
   * ADR-012 parent/student conversations). No scope = all channels (the
   * cross-scope view is legitimate for internal tooling, never for the
   * chat UIs — the two surfaces must not mix).
   */
  observeChannels(
    personnelId: string,
    scope?: ChatChannelScope,
  ): Observable<ChatChannel[]>;
  observeChannel(channelId: string): Observable<ChatChannel | null>;
  observeMessages(channelId: string): Observable<ChatMessage[]>;
  createChannel(input: {
    type: ChannelType;
    name: string;
    description: string | null;
    memberIds: readonly string[];
    departmentId: string | null;
    createdBy: string;
  }): Promise<Result<ChatChannel>>;
  updateChannel(
    id: string,
    updates: Partial<ChatChannel>,
  ): Promise<Result<ChatChannel>>;
  archiveChannel(id: string): Promise<Result<ChatChannel>>;
  addMembers(
    id: string,
    memberIds: readonly string[],
  ): Promise<Result<ChatChannel>>;
  removeMembers(
    id: string,
    memberIds: readonly string[],
  ): Promise<Result<ChatChannel>>;
  sendMessage(input: {
    channelId: string;
    authorId: string;
    authorName: string;
    body: string;
    attachments?: readonly TaskAttachment[];
    voiceNoteSeconds?: number | null;
  }): Promise<Result<ChatMessage>>;
  editMessage(id: string, body: string): Promise<Result<ChatMessage>>;
  deleteMessage(id: string): Promise<Result<void>>;
  markRead(channelId: string, personnelId: string): Promise<Result<void>>;
  openParentChannel(
    parentId: string,
    displayName: string,
  ): Promise<Result<ChatChannel>>;
}

export interface OnboardingRepository {
  observe(): Observable<OnboardingState | null>;
  start(): Promise<Result<OnboardingState>>;
  advanceTo(step: OnboardingStep): Promise<Result<OnboardingState>>;
  completeStep(step: OnboardingStep): Promise<Result<OnboardingState>>;
  updateData(
    updates: Partial<OnboardingData>,
  ): Promise<Result<OnboardingState>>;
  complete(): Promise<Result<OnboardingState>>;
  reset(): Promise<Result<OnboardingState>>;
  isComplete(): Promise<Result<boolean>>;
}
