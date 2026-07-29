/**
 * Workforce repository interfaces — iteration 8 (plan §09 expansion).
 *
 * Pure abstract contracts for the new workforce entities: departments,
 * shifts/schedules, tasks, attendance, leave requests, performance reviews,
 * chat channels/messages, and onboarding state.
 *
 * Methods return Promises of Result<T> so failure modes are explicit in the
 * type system. Live data exposes an Observable<T> so React re-renders on
 * backend changes.
 */
import type { Result } from "../../core/result/result";
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
  LeaveRequest,
  RequestType,
  RequestStatus,
  PerformanceReview,
  ChatChannel,
  ChatMessage,
  ChannelType,
  OnboardingState,
  OnboardingStep,
  OnboardingData,
} from "../model/workforce";
import type { Role } from "../../core/rbac/roles";

/* ------------------------------------------------------------------ */
/*  Departments                                                        */
/* ------------------------------------------------------------------ */

export interface DepartmentRepository {
  observe(): Observable<Department[]>;
  observeById(id: string): Observable<Department | null>;
  createDepartment(input: Omit<Department, "id" | "tenantId" | "createdAt" | "archivedAt">): Promise<Result<Department>>;
  updateDepartment(id: string, updates: Partial<Department>): Promise<Result<Department>>;
  archiveDepartment(id: string): Promise<Result<Department>>;
  unarchiveDepartment(id: string): Promise<Result<Department>>;
  deleteDepartment(id: string): Promise<Result<void>>;
}

/* ------------------------------------------------------------------ */
/*  Shifts & schedules                                                 */
/* ------------------------------------------------------------------ */

export interface ShiftRepository {
  observe(): Observable<Shift[]>;
  createShift(input: Omit<Shift, "id" | "tenantId">): Promise<Result<Shift>>;
  updateShift(id: string, updates: Partial<Shift>): Promise<Result<Shift>>;
  deleteShift(id: string): Promise<Result<void>>;
}

export interface ScheduleRepository {
  observeByPersonnel(personnelId: string): Observable<Schedule[]>;
  observeByWeek(weekStart: string): Observable<Schedule[]>;
  upsertSchedule(input: Omit<Schedule, "id" | "tenantId"> & { id?: string }): Promise<Result<Schedule>>;
  deleteSchedule(id: string): Promise<Result<void>>;
}

/* ------------------------------------------------------------------ */
/*  Tasks                                                              */
/* ------------------------------------------------------------------ */

export interface TaskRepository {
  observe(): Observable<Task[]>;
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
  updateTaskStatus(id: string, status: TaskStatus, actorId: string): Promise<Result<Task>>;
  reassign(id: string, assigneeIds: readonly string[], actorId: string): Promise<Result<Task>>;
  addComment(id: string, comment: Omit<TaskComment, "id" | "taskId" | "createdAt">): Promise<Result<TaskComment>>;
  addAttachment(id: string, attachment: TaskAttachment): Promise<Result<Task>>;
  deleteTask(id: string): Promise<Result<void>>;
}

/* ------------------------------------------------------------------ */
/*  Attendance                                                         */
/* ------------------------------------------------------------------ */

export interface AttendanceRepository {
  observeByPersonnel(personnelId: string, fromDate: string, toDate: string): Observable<AttendanceEvent[]>;
  observeByDate(date: string): Observable<AttendanceEvent[]>;
  recordEvent(input: {
    personnelId: string;
    date: string;
    eventType: AttendanceEventType;
    metadata?: { lat?: number; lng?: number; ip?: string } | null;
  }): Promise<Result<AttendanceEvent>>;
}

/* ------------------------------------------------------------------ */
/*  Leave / absence / overtime requests                                */
/* ------------------------------------------------------------------ */

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
    reason: string;
  }): Promise<Result<LeaveRequest>>;
  decide(id: string, status: RequestStatus, decidedBy: string, decidedByName: string, note?: string): Promise<Result<LeaveRequest>>;
  cancel(id: string): Promise<Result<LeaveRequest>>;
}

/* ------------------------------------------------------------------ */
/*  Performance reviews                                                */
/* ------------------------------------------------------------------ */

export interface PerformanceReviewRepository {
  observeByPersonnel(personnelId: string): Observable<PerformanceReview[]>;
  createReview(input: Omit<PerformanceReview, "id" | "tenantId" | "reviewedAt">): Promise<Result<PerformanceReview>>;
  updateReview(id: string, updates: Partial<PerformanceReview>): Promise<Result<PerformanceReview>>;
  deleteReview(id: string): Promise<Result<void>>;
}

/* ------------------------------------------------------------------ */
/*  Chat                                                               */
/* ------------------------------------------------------------------ */

export interface ChatRepository {
  observeChannels(personnelId: string): Observable<ChatChannel[]>;
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
  updateChannel(id: string, updates: Partial<ChatChannel>): Promise<Result<ChatChannel>>;
  archiveChannel(id: string): Promise<Result<ChatChannel>>;
  addMembers(id: string, memberIds: readonly string[]): Promise<Result<ChatChannel>>;
  removeMembers(id: string, memberIds: readonly string[]): Promise<Result<ChatChannel>>;
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
}

/* ------------------------------------------------------------------ */
/*  Onboarding                                                         */
/* ------------------------------------------------------------------ */

export interface OnboardingRepository {
  observe(): Observable<OnboardingState | null>;
  start(): Promise<Result<OnboardingState>>;
  advanceTo(step: OnboardingStep): Promise<Result<OnboardingState>>;
  completeStep(step: OnboardingStep): Promise<Result<OnboardingState>>;
  updateData(updates: Partial<OnboardingData>): Promise<Result<OnboardingState>>;
  complete(): Promise<Result<OnboardingState>>;
  reset(): Promise<Result<OnboardingState>>;
  /** Whether onboarding has been completed (used to gate the Personnel page). */
  isComplete(): Promise<Result<boolean>>;
}
