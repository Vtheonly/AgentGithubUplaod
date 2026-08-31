/**
 * Mock workforce repository implementations — iteration 8 (plan §09 expansion).
 *
 * In-memory, reactive (via SubjectBehavior), seeded with realistic data so
 * the Personnel module runs end-to-end without a backend.
 *
 * Every mutating method writes an audit log entry (mirrors the Supabase
 * adapter's behavior). The audit log is appended to the in-memory store
 * so the Settings → Audit Log viewer works end-to-end out of the box.
 */
import type {
  DepartmentRepository,
  ShiftRepository,
  ScheduleRepository,
  TaskRepository,
  LeaveRequestRepository,
  PerformanceReviewRepository,
  ChatRepository,
  OnboardingRepository,
} from "../../../domain/repository/workforce-repository";
import type { Observable } from "../../../domain/repository/repository";
import type { Result } from "../../../core/result";
import { Ok, Err } from "../../../core/result";
import { Errors } from "../../../core/app-error";
import { logger } from "../../../core/logger";
import { SubjectBehavior } from "../subject-behavior";
import { TENANT_ID } from "../seed-data";
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
  Weekday,
} from "../../../domain/model/workforce";

const nowIso = () => new Date().toISOString();
const todayIso = () => new Date().toISOString().slice(0, 10);

function genId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

/* ------------------------------------------------------------------ */
/*  Audit hook (delegates to the in-memory audit log)                  */
/* ------------------------------------------------------------------ */

/**
 * The mock audit repository is defined in mock-repositories.ts. To avoid a
 * circular import, we expose a tiny appendAudit function via a mutable
 * binding that mock-repositories.ts sets on first load.
 */
let _auditSink: ((input: {
  action: string;
  entityType: string;
  entityId: string;
  actorId?: string;
  actorName?: string;
  diff?: { before?: unknown; after?: unknown } | null;
  note?: string | null;
}) => void) | null = null;

export function setWorkforceAuditSink(
  fn: typeof _auditSink,
): void {
  _auditSink = fn;
}

function audit(input: Parameters<NonNullable<typeof _auditSink>>[0]): void {
  if (_auditSink) _auditSink(input);
  logger.info("workforce.audit", { ...input, tenantId: TENANT_ID });
}

/* ------------------------------------------------------------------ */
/*  Departments                                                        */
/* ------------------------------------------------------------------ */

const SEED_DEPARTMENTS: Department[] = [
  { id: "dept-admin", tenantId: TENANT_ID, name: "Administration", description: "Direction et secrétariat", color: "brand-blue-deep", headId: null, parentId: null, createdAt: "2025-01-01T00:00:00.000Z", archivedAt: null },
  { id: "dept-managers", tenantId: TENANT_ID, name: "Managers", description: "Responsables d'équipe", color: "brand-blue", headId: null, parentId: "dept-admin", createdAt: "2025-01-01T00:00:00.000Z", archivedAt: null },
  { id: "dept-teachers", tenantId: TENANT_ID, name: "Teachers", description: "Corps enseignant", color: "brand-gold", headId: null, parentId: null, createdAt: "2025-01-01T00:00:00.000Z", archivedAt: null },
  { id: "dept-buyers", tenantId: TENANT_ID, name: "Buyers", description: "Service achats", color: "status-info", headId: null, parentId: null, createdAt: "2025-01-01T00:00:00.000Z", archivedAt: null },
  { id: "dept-drivers", tenantId: TENANT_ID, name: "Drivers", description: "Livraisons et transport", color: "brand-brown", headId: null, parentId: null, createdAt: "2025-01-01T00:00:00.000Z", archivedAt: null },
  { id: "dept-warehouse", tenantId: TENANT_ID, name: "Warehouse", description: "Magasin et inventaire", color: "status-success", headId: null, parentId: null, createdAt: "2025-01-01T00:00:00.000Z", archivedAt: null },
  { id: "dept-workers", tenantId: TENANT_ID, name: "Workers", description: "Ouvriers polyvalents", color: "brand-slate", headId: null, parentId: null, createdAt: "2025-01-01T00:00:00.000Z", archivedAt: null },
  { id: "dept-accounting", tenantId: TENANT_ID, name: "Accounting", description: "Comptabilité et finances", color: "status-warning", headId: null, parentId: "dept-admin", createdAt: "2025-01-01T00:00:00.000Z", archivedAt: null },
  { id: "dept-hr", tenantId: TENANT_ID, name: "Human Resources", description: "Ressources humaines", color: "brand-gold", headId: null, parentId: "dept-admin", createdAt: "2025-01-01T00:00:00.000Z", archivedAt: null },
];

class MockDepartmentRepository implements DepartmentRepository {
  private readonly subjects = new SubjectBehavior<Department[]>(SEED_DEPARTMENTS);
  private items: Department[] = SEED_DEPARTMENTS;

  observe(): Observable<Department[]> { return this.subjects; }
  observeById(id: string): Observable<Department | null> {
    return new SubjectBehavior<Department | null>(this.items.find((d) => d.id === id) ?? null);
  }

  async createDepartment(input: Omit<Department, "id" | "tenantId" | "createdAt" | "archivedAt">): Promise<Result<Department>> {
    const dept: Department = { ...input, id: genId("dept"), tenantId: TENANT_ID, createdAt: nowIso(), archivedAt: null };
    this.items = [...this.items, dept];
    this.subjects.set(this.items);
    audit({ action: "department.create", entityType: "department", entityId: dept.id, diff: { after: dept } });
    return Ok(dept);
  }

  async updateDepartment(id: string, updates: Partial<Department>): Promise<Result<Department>> {
    const idx = this.items.findIndex((d) => d.id === id);
    if (idx === -1) return Err(Errors.notFound("department", id));
    const before = this.items[idx];
    const after = { ...before, ...updates, id: before.id, tenantId: before.tenantId };
    this.items = [...this.items.slice(0, idx), after, ...this.items.slice(idx + 1)];
    this.subjects.set(this.items);
    audit({ action: "department.update", entityType: "department", entityId: id, diff: { before, after } });
    return Ok(after);
  }

  async archiveDepartment(id: string): Promise<Result<Department>> {
    return this.updateDepartment(id, { archivedAt: nowIso() });
  }

  async unarchiveDepartment(id: string): Promise<Result<Department>> {
    return this.updateDepartment(id, { archivedAt: null });
  }

  async deleteDepartment(id: string): Promise<Result<void>> {
    const before = this.items.find((d) => d.id === id);
    this.items = this.items.filter((d) => d.id !== id);
    this.subjects.set(this.items);
    audit({ action: "department.delete", entityType: "department", entityId: id, diff: { before, after: null } });
    return Ok(undefined);
  }
}

/* ------------------------------------------------------------------ */
/*  Shifts                                                             */
/* ------------------------------------------------------------------ */

const SEED_SHIFTS: Shift[] = [
  { id: "shift-m-m", tenantId: TENANT_ID, label: "Matin standard", weekday: "mon", shiftType: "morning", startTime: "08:00", endTime: "12:00", breakMinutes: 0, color: "brand-blue" },
  { id: "shift-m-a", tenantId: TENANT_ID, label: "Après-midi standard", weekday: "mon", shiftType: "afternoon", startTime: "13:00", endTime: "17:00", breakMinutes: 0, color: "brand-blue-deep" },
  { id: "shift-t-m", tenantId: TENANT_ID, label: "Matin standard", weekday: "tue", shiftType: "morning", startTime: "08:00", endTime: "12:00", breakMinutes: 0, color: "brand-blue" },
  { id: "shift-t-a", tenantId: TENANT_ID, label: "Après-midi standard", weekday: "tue", shiftType: "afternoon", startTime: "13:00", endTime: "17:00", breakMinutes: 0, color: "brand-blue-deep" },
  { id: "shift-w-m", tenantId: TENANT_ID, label: "Matin standard", weekday: "wed", shiftType: "morning", startTime: "08:00", endTime: "12:00", breakMinutes: 0, color: "brand-blue" },
  { id: "shift-w-a", tenantId: TENANT_ID, label: "Après-midi standard", weekday: "wed", shiftType: "afternoon", startTime: "13:00", endTime: "17:00", breakMinutes: 0, color: "brand-blue-deep" },
  { id: "shift-th-m", tenantId: TENANT_ID, label: "Matin standard", weekday: "thu", shiftType: "morning", startTime: "08:00", endTime: "12:00", breakMinutes: 0, color: "brand-blue" },
  { id: "shift-th-a", tenantId: TENANT_ID, label: "Après-midi standard", weekday: "thu", shiftType: "afternoon", startTime: "13:00", endTime: "17:00", breakMinutes: 0, color: "brand-blue-deep" },
  { id: "shift-f-m", tenantId: TENANT_ID, label: "Matin standard", weekday: "fri", shiftType: "morning", startTime: "08:00", endTime: "12:00", breakMinutes: 0, color: "brand-blue" },
  { id: "shift-f-a", tenantId: TENANT_ID, label: "Après-midi standard", weekday: "fri", shiftType: "afternoon", startTime: "13:00", endTime: "17:00", breakMinutes: 0, color: "brand-blue-deep" },
  { id: "shift-sat-m", tenantId: TENANT_ID, label: "Samedi matin", weekday: "sat", shiftType: "morning", startTime: "08:00", endTime: "12:00", breakMinutes: 0, color: "brand-gold" },
];

class MockShiftRepository implements ShiftRepository {
  private readonly subjects = new SubjectBehavior<Shift[]>(SEED_SHIFTS);
  private items: Shift[] = SEED_SHIFTS;

  observe(): Observable<Shift[]> { return this.subjects; }

  async createShift(input: Omit<Shift, "id" | "tenantId">): Promise<Result<Shift>> {
    const shift: Shift = { ...input, id: genId("shift"), tenantId: TENANT_ID };
    this.items = [...this.items, shift];
    this.subjects.set(this.items);
    audit({ action: "shift.create", entityType: "shift", entityId: shift.id, diff: { after: shift } });
    return Ok(shift);
  }

  async updateShift(id: string, updates: Partial<Shift>): Promise<Result<Shift>> {
    const idx = this.items.findIndex((s) => s.id === id);
    if (idx === -1) return Err(Errors.notFound("shift", id));
    const before = this.items[idx];
    const after = { ...before, ...updates, id: before.id, tenantId: before.tenantId };
    this.items = [...this.items.slice(0, idx), after, ...this.items.slice(idx + 1)];
    this.subjects.set(this.items);
    audit({ action: "shift.update", entityType: "shift", entityId: id, diff: { before, after } });
    return Ok(after);
  }

  async deleteShift(id: string): Promise<Result<void>> {
    this.items = this.items.filter((s) => s.id !== id);
    this.subjects.set(this.items);
    audit({ action: "shift.delete", entityType: "shift", entityId: id });
    return Ok(undefined);
  }
}

/* ------------------------------------------------------------------ */
/*  Schedules                                                          */
/* ------------------------------------------------------------------ */

class MockScheduleRepository implements ScheduleRepository {
  private readonly byPersonnel = new Map<string, SubjectBehavior<Schedule[]>>();
  private readonly byWeek = new Map<string, SubjectBehavior<Schedule[]>>();
  private items: Schedule[] = [];

  private ensurePersonnelSubject(id: string): SubjectBehavior<Schedule[]> {
    let s = this.byPersonnel.get(id);
    if (!s) {
      s = new SubjectBehavior<Schedule[]>(this.items.filter((x) => x.personnelId === id));
      this.byPersonnel.set(id, s);
    }
    return s;
  }
  private ensureWeekSubject(week: string): SubjectBehavior<Schedule[]> {
    let s = this.byWeek.get(week);
    if (!s) {
      s = new SubjectBehavior<Schedule[]>(this.items.filter((x) => x.weekStart === week));
      this.byWeek.set(week, s);
    }
    return s;
  }
  private notifyAll(): void {
    this.byPersonnel.forEach((s, id) => s.set(this.items.filter((x) => x.personnelId === id)));
    this.byWeek.forEach((s, w) => s.set(this.items.filter((x) => x.weekStart === w)));
  }

  observeByPersonnel(personnelId: string): Observable<Schedule[]> {
    return this.ensurePersonnelSubject(personnelId);
  }
  observeByWeek(weekStart: string): Observable<Schedule[]> {
    return this.ensureWeekSubject(weekStart);
  }

  async upsertSchedule(input: Omit<Schedule, "id" | "tenantId"> & { id?: string }): Promise<Result<Schedule>> {
    if (input.id) {
      const idx = this.items.findIndex((s) => s.id === input.id);
      if (idx !== -1) {
        const before = this.items[idx];
        const after: Schedule = { ...before, ...input, id: before.id, tenantId: TENANT_ID };
        this.items = [...this.items.slice(0, idx), after, ...this.items.slice(idx + 1)];
        this.notifyAll();
        audit({ action: "schedule.update", entityType: "schedule", entityId: after.id, diff: { before, after } });
        return Ok(after);
      }
    }
    const sched: Schedule = { ...input, id: input.id ?? genId("sched"), tenantId: TENANT_ID };
    this.items = [...this.items, sched];
    this.notifyAll();
    audit({ action: "schedule.create", entityType: "schedule", entityId: sched.id, diff: { after: sched } });
    return Ok(sched);
  }

  async deleteSchedule(id: string): Promise<Result<void>> {
    this.items = this.items.filter((s) => s.id !== id);
    this.notifyAll();
    audit({ action: "schedule.delete", entityType: "schedule", entityId: id });
    return Ok(undefined);
  }
}

/* ------------------------------------------------------------------ */
/*  Tasks                                                              */
/* ------------------------------------------------------------------ */

const SEED_TASKS: Task[] = [
  {
    id: "task-001",
    tenantId: TENANT_ID,
    title: "Préparer commandes fournitures rentrée",
    description: "Commander stylos, cahiers et ardoises pour la rentrée scolaire.",
    priority: "high",
    status: "in_progress",
    departmentId: "dept-buyers",
    assigneeIds: [],
    createdBy: "system",
    createdByName: "Système",
    createdAt: "2025-09-01T08:00:00.000Z",
    updatedAt: "2025-09-15T10:00:00.000Z",
    dueDate: "2025-09-30",
    completedAt: null,
    attachments: [],
    comments: [],
    progress: 35,
    tags: ["achat", "rentree"],
  },
  {
    id: "task-002",
    tenantId: TENANT_ID,
    title: "Livraison manuels CEM",
    description: "Livrer 200 manuels au CEM Bab Ezzouar.",
    priority: "urgent",
    status: "assigned",
    departmentId: "dept-drivers",
    assigneeIds: [],
    createdBy: "system",
    createdByName: "Système",
    createdAt: "2025-09-10T08:00:00.000Z",
    updatedAt: "2025-09-10T08:00:00.000Z",
    dueDate: "2025-09-20",
    completedAt: null,
    attachments: [],
    comments: [],
    progress: 0,
    tags: ["livraison", "manuels"],
  },
  {
    id: "task-003",
    tenantId: TENANT_ID,
    title: "Réceptionner mobilier scolaire",
    description: "Réceptionner 50 tables + 50 chaises livrées par le fournisseur.",
    priority: "medium",
    status: "pending",
    departmentId: "dept-warehouse",
    assigneeIds: [],
    createdBy: "system",
    createdByName: "Système",
    createdAt: "2025-09-12T08:00:00.000Z",
    updatedAt: "2025-09-12T08:00:00.000Z",
    dueDate: "2025-09-25",
    completedAt: null,
    attachments: [],
    comments: [],
    progress: 0,
    tags: ["mobilier", "reception"],
  },
  {
    id: "task-004",
    tenantId: TENANT_ID,
    title: "Préparer bulletins Q1",
    description: "Saisir et éditer les bulletins du premier trimestre.",
    priority: "high",
    status: "pending",
    departmentId: "dept-teachers",
    assigneeIds: [],
    createdBy: "system",
    createdByName: "Système",
    createdAt: "2025-09-15T08:00:00.000Z",
    updatedAt: "2025-09-15T08:00:00.000Z",
    dueDate: "2025-12-15",
    completedAt: null,
    attachments: [],
    comments: [],
    progress: 0,
    tags: ["bulletins"],
  },
  {
    id: "task-005",
    tenantId: TENANT_ID,
    title: "Maintenance chaudière",
    description: "Entretien annuel de la chaudière principale.",
    priority: "medium",
    status: "completed",
    departmentId: "dept-workers",
    assigneeIds: [],
    createdBy: "system",
    createdByName: "Système",
    createdAt: "2025-08-01T08:00:00.000Z",
    updatedAt: "2025-08-10T15:00:00.000Z",
    dueDate: "2025-08-15",
    completedAt: "2025-08-10T15:00:00.000Z",
    attachments: [],
    comments: [],
    progress: 100,
    tags: ["maintenance", "été"],
  },
];

class MockTaskRepository implements TaskRepository {
  private readonly subjects = new SubjectBehavior<Task[]>(SEED_TASKS);
  private items: Task[] = SEED_TASKS;
  private readonly byId = new Map<string, SubjectBehavior<Task | null>>();

  observe(): Observable<Task[]> { return this.subjects; }

  observeByAssignee(personnelId: string): Observable<Task[]> {
    return new SubjectBehavior<Task[]>(this.items.filter((t) => t.assigneeIds.includes(personnelId)));
  }

  observeByDepartment(departmentId: string): Observable<Task[]> {
    return new SubjectBehavior<Task[]>(this.items.filter((t) => t.departmentId === departmentId));
  }

  observeById(id: string): Observable<Task | null> {
    let s = this.byId.get(id);
    if (!s) {
      s = new SubjectBehavior<Task | null>(this.items.find((t) => t.id === id) ?? null);
      this.byId.set(id, s);
    }
    return s;
  }

  private notifyAll(): void {
    this.subjects.set(this.items);
    this.byId.forEach((s, id) => s.set(this.items.find((t) => t.id === id) ?? null));
  }

  async createTask(input: {
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
  }): Promise<Result<Task>> {
    const ts = nowIso();
    const task: Task = {
      id: genId("task"),
      tenantId: TENANT_ID,
      title: input.title,
      description: input.description,
      priority: input.priority,
      status: input.assigneeIds.length > 0 ? "assigned" : "pending",
      departmentId: input.departmentId,
      assigneeIds: input.assigneeIds,
      createdBy: input.createdBy,
      createdByName: input.createdByName,
      createdAt: ts,
      updatedAt: ts,
      dueDate: input.dueDate,
      completedAt: null,
      attachments: input.attachments ?? [],
      comments: [],
      progress: 0,
      tags: input.tags ?? [],
    };
    this.items = [task, ...this.items];
    this.notifyAll();
    audit({ action: "task.create", entityType: "task", entityId: task.id, actorId: input.createdBy, actorName: input.createdByName, diff: { after: task } });
    return Ok(task);
  }

  async updateTask(id: string, updates: Partial<Task>): Promise<Result<Task>> {
    const idx = this.items.findIndex((t) => t.id === id);
    if (idx === -1) return Err(Errors.notFound("task", id));
    const before = this.items[idx];
    const after: Task = { ...before, ...updates, id: before.id, tenantId: before.tenantId, updatedAt: nowIso() };
    this.items = [...this.items.slice(0, idx), after, ...this.items.slice(idx + 1)];
    this.notifyAll();
    audit({ action: "task.update", entityType: "task", entityId: id, diff: { before, after } });
    return Ok(after);
  }

  async updateTaskStatus(id: string, status: TaskStatus, actorId: string): Promise<Result<Task>> {
    let updates: Partial<Task> = { status, updatedAt: nowIso() };
    if (status === "completed") {
      updates = { ...updates, completedAt: nowIso(), progress: 100 };
    } else if (status === "in_progress") {
      const current = this.items.find((t) => t.id === id);
      if (current && current.progress === 0) {
        updates = { ...updates, progress: 10 };
      }
    }
    const result = await this.updateTask(id, updates);
    if (result.ok) {
      audit({ action: "task.status_change", entityType: "task", entityId: id, actorId, note: status });
    }
    return result;
  }

  async reassign(id: string, assigneeIds: readonly string[], actorId: string): Promise<Result<Task>> {
    const updates: Partial<Task> = {
      assigneeIds,
      status: assigneeIds.length > 0 ? "assigned" : "pending",
      updatedAt: nowIso(),
    };
    const result = await this.updateTask(id, updates);
    if (result.ok) {
      audit({ action: "task.reassign", entityType: "task", entityId: id, actorId, note: `${assigneeIds.length} assignee(s)` });
    }
    return result;
  }

  async addComment(id: string, comment: Omit<TaskComment, "id" | "taskId" | "createdAt">): Promise<Result<TaskComment>> {
    const idx = this.items.findIndex((t) => t.id === id);
    if (idx === -1) return Err(Errors.notFound("task", id));
    const full: TaskComment = { ...comment, id: genId("cmt"), taskId: id, createdAt: nowIso() };
    const before = this.items[idx];
    const after: Task = { ...before, comments: [...before.comments, full], updatedAt: nowIso() };
    this.items = [...this.items.slice(0, idx), after, ...this.items.slice(idx + 1)];
    this.notifyAll();
    audit({ action: "task.comment", entityType: "task", entityId: id, actorId: comment.authorId, actorName: comment.authorName });
    return Ok(full);
  }

  async addAttachment(id: string, attachment: TaskAttachment): Promise<Result<Task>> {
    return this.updateTask(id, {});
  }

  async deleteTask(id: string): Promise<Result<void>> {
    const before = this.items.find((t) => t.id === id);
    this.items = this.items.filter((t) => t.id !== id);
    this.notifyAll();
    audit({ action: "task.delete", entityType: "task", entityId: id, diff: { before, after: null } });
    return Ok(undefined);
  }
}

/* ------------------------------------------------------------------ */
/*  Workforce Attendance                                               */
/* ------------------------------------------------------------------ */

class MockWorkforceAttendanceRepository {
  private readonly byPersonnel = new Map<string, SubjectBehavior<AttendanceEvent[]>>();
  private readonly byDate = new Map<string, SubjectBehavior<AttendanceEvent[]>>();
  private items: AttendanceEvent[] = [];

  private ensurePersonnelSubject(id: string, from: string, to: string): SubjectBehavior<AttendanceEvent[]> {
    const key = `${id}|${from}|${to}`;
    let s = this.byPersonnel.get(key);
    if (!s) {
      s = new SubjectBehavior<AttendanceEvent[]>(
        this.items.filter((e) => e.personnelId === id && e.date >= from && e.date <= to),
      );
      this.byPersonnel.set(key, s);
    }
    return s;
  }
  private ensureDateSubject(date: string): SubjectBehavior<AttendanceEvent[]> {
    let s = this.byDate.get(date);
    if (!s) {
      s = new SubjectBehavior<AttendanceEvent[]>(this.items.filter((e) => e.date === date));
      this.byDate.set(date, s);
    }
    return s;
  }
  private notifyAll(): void {
    this.byPersonnel.forEach((s, key) => {
      const [id, from, to] = key.split("|");
      s.set(this.items.filter((e) => e.personnelId === id && e.date >= from && e.date <= to));
    });
    this.byDate.forEach((s, date) => s.set(this.items.filter((e) => e.date === date)));
  }

  observeByPersonnel(personnelId: string, fromDate: string, toDate: string): Observable<AttendanceEvent[]> {
    return this.ensurePersonnelSubject(personnelId, fromDate, toDate);
  }
  observeByDate(date: string): Observable<AttendanceEvent[]> {
    return this.ensureDateSubject(date);
  }

  async recordEvent(input: {
    personnelId: string;
    date: string;
    eventType: AttendanceEventType;
    metadata?: { lat?: number; lng?: number; ip?: string } | null;
  }): Promise<Result<AttendanceEvent>> {
    const evt: AttendanceEvent = {
      id: genId("att"),
      tenantId: TENANT_ID,
      personnelId: input.personnelId,
      date: input.date,
      timestamp: nowIso(),
      eventType: input.eventType,
      metadata: input.metadata ?? null,
    };
    this.items = [...this.items, evt];
    this.notifyAll();
    audit({ action: "attendance.record", entityType: "attendance", entityId: evt.id, actorId: input.personnelId, note: input.eventType });
    return Ok(evt);
  }

  /** Test helper: peek at the latest event for a personnel on a given date. */
  latestFor(personnelId: string, date: string): AttendanceEvent | null {
    const events = this.items.filter((e) => e.personnelId === personnelId && e.date === date);
    return events.length > 0 ? events[events.length - 1] : null;
  }
}

/* ------------------------------------------------------------------ */
/*  Leave requests                                                     */
/* ------------------------------------------------------------------ */

class MockLeaveRequestRepository implements LeaveRequestRepository {
  private readonly subjects = new SubjectBehavior<LeaveRequest[]>([]);
  private items: LeaveRequest[] = [
    {
      id: "lr-001",
      tenantId: TENANT_ID,
      personnelId: "EMP-2025-001",
      personnelName: "Karim Benali",
      type: "leave" as RequestType,
      status: "pending" as RequestStatus,
      fromDate: "2025-10-15",
      toDate: "2025-10-20",
      reason: "Congé annuel",
      createdAt: "2025-09-20T10:00:00.000Z",
      decidedAt: null,
      decidedBy: null,
      decidedByName: null,
      decisionNote: null,
    },
  ];

  observe(): Observable<LeaveRequest[]> { return this.subjects; }
  observeByPersonnel(personnelId: string): Observable<LeaveRequest[]> {
    return new SubjectBehavior<LeaveRequest[]>(this.items.filter((r) => r.personnelId === personnelId));
  }
  observePending(): Observable<LeaveRequest[]> {
    return new SubjectBehavior<LeaveRequest[]>(this.items.filter((r) => r.status === "pending"));
  }

  async submit(input: {
    personnelId: string;
    personnelName: string;
    type: RequestType;
    fromDate: string;
    toDate: string;
    reason: string;
  }): Promise<Result<LeaveRequest>> {
    const req: LeaveRequest = {
      id: genId("lr"),
      tenantId: TENANT_ID,
      personnelId: input.personnelId,
      personnelName: input.personnelName,
      type: input.type,
      status: "pending",
      fromDate: input.fromDate,
      toDate: input.toDate,
      reason: input.reason,
      createdAt: nowIso(),
      decidedAt: null,
      decidedBy: null,
      decidedByName: null,
      decisionNote: null,
    };
    this.items = [req, ...this.items];
    this.subjects.set(this.items);
    audit({ action: "leave.submit", entityType: "leave_request", entityId: req.id, actorId: input.personnelId, actorName: input.personnelName, diff: { after: req } });
    return Ok(req);
  }

  async decide(id: string, status: RequestStatus, decidedBy: string, decidedByName: string, note?: string): Promise<Result<LeaveRequest>> {
    const idx = this.items.findIndex((r) => r.id === id);
    if (idx === -1) return Err(Errors.notFound("leave_request", id));
    const before = this.items[idx];
    const after: LeaveRequest = {
      ...before,
      status,
      decidedAt: nowIso(),
      decidedBy,
      decidedByName,
      decisionNote: note ?? null,
    };
    this.items = [...this.items.slice(0, idx), after, ...this.items.slice(idx + 1)];
    this.subjects.set(this.items);
    audit({ action: "leave.decide", entityType: "leave_request", entityId: id, actorId: decidedBy, actorName: decidedByName, diff: { before, after } });
    return Ok(after);
  }

  async cancel(id: string): Promise<Result<LeaveRequest>> {
    return this.decide(id, "cancelled", "system", "Système", "Annulé par l'employé");
  }
}

/* ------------------------------------------------------------------ */
/*  Performance reviews                                                */
/* ------------------------------------------------------------------ */

class MockPerformanceReviewRepository implements PerformanceReviewRepository {
  private readonly byPersonnel = new Map<string, SubjectBehavior<PerformanceReview[]>>();
  private items: PerformanceReview[] = [
    {
      id: "pr-001",
      tenantId: TENANT_ID,
      personnelId: "EMP-2025-001",
      personnelName: "Karim Benali",
      period: "2024",
      rating: 4.2,
      strengths: "Ponctualité, maîtrise de la discipline, bonne relation avec les élèves.",
      improvements: "Pourrait varier les supports pédagogiques.",
      goals: "Intégrer plus d'activités interactives au CEM 2.",
      reviewerId: "system",
      reviewerName: "Direction",
      reviewedAt: "2025-01-15T10:00:00.000Z",
    },
  ];

  observeByPersonnel(personnelId: string): Observable<PerformanceReview[]> {
    let s = this.byPersonnel.get(personnelId);
    if (!s) {
      s = new SubjectBehavior<PerformanceReview[]>(this.items.filter((r) => r.personnelId === personnelId));
      this.byPersonnel.set(personnelId, s);
    }
    return s;
  }

  async createReview(input: Omit<PerformanceReview, "id" | "tenantId" | "reviewedAt">): Promise<Result<PerformanceReview>> {
    const review: PerformanceReview = { ...input, id: genId("pr"), tenantId: TENANT_ID, reviewedAt: nowIso() };
    this.items = [review, ...this.items];
    this.byPersonnel.forEach((s, id) => s.set(this.items.filter((r) => r.personnelId === id)));
    audit({ action: "performance.create", entityType: "performance_review", entityId: review.id, actorId: input.reviewerId, actorName: input.reviewerName, diff: { after: review } });
    return Ok(review);
  }

  async updateReview(id: string, updates: Partial<PerformanceReview>): Promise<Result<PerformanceReview>> {
    const idx = this.items.findIndex((r) => r.id === id);
    if (idx === -1) return Err(Errors.notFound("performance_review", id));
    const before = this.items[idx];
    const after = { ...before, ...updates, id: before.id, tenantId: before.tenantId };
    this.items = [...this.items.slice(0, idx), after, ...this.items.slice(idx + 1)];
    this.byPersonnel.forEach((s, pid) => s.set(this.items.filter((r) => r.personnelId === pid)));
    audit({ action: "performance.update", entityType: "performance_review", entityId: id, diff: { before, after } });
    return Ok(after);
  }

  async deleteReview(id: string): Promise<Result<void>> {
    this.items = this.items.filter((r) => r.id !== id);
    this.byPersonnel.forEach((s, pid) => s.set(this.items.filter((r) => r.personnelId === pid)));
    audit({ action: "performance.delete", entityType: "performance_review", entityId: id });
    return Ok(undefined);
  }
}

/* ------------------------------------------------------------------ */
/*  Chat                                                               */
/* ------------------------------------------------------------------ */

const SEED_CHANNELS: ChatChannel[] = [
  {
    id: "ch-announcements",
    tenantId: TENANT_ID,
    type: "announcement" as ChannelType,
    name: "Annonces générales",
    description: "Canal d'annonces de la direction",
    memberIds: [],
    departmentId: null,
    createdBy: "system",
    createdAt: "2025-01-01T00:00:00.000Z",
    archivedAt: null,
    lastMessageAt: "2025-09-15T10:00:00.000Z",
    lastMessagePreview: "Bienvenue à tous pour cette nouvelle année scolaire.",
  },
  {
    id: "ch-teachers",
    tenantId: TENANT_ID,
    type: "department" as ChannelType,
    name: "Salon des enseignants",
    description: "Canal du département Teachers",
    memberIds: [],
    departmentId: "dept-teachers",
    createdBy: "system",
    createdAt: "2025-01-01T00:00:00.000Z",
    archivedAt: null,
    lastMessageAt: "2025-09-14T16:30:00.000Z",
    lastMessagePreview: "Réunion demain à 14h en salle des profs.",
  },
  {
    id: "ch-drivers",
    tenantId: TENANT_ID,
    type: "department" as ChannelType,
    name: "Salon des chauffeurs",
    description: "Canal du département Drivers",
    memberIds: [],
    departmentId: "dept-drivers",
    createdBy: "system",
    createdAt: "2025-01-01T00:00:00.000Z",
    archivedAt: null,
    lastMessageAt: "2025-09-13T08:15:00.000Z",
    lastMessagePreview: "La tournée de Hydra démarre à 7h30 demain.",
  },
];

const SEED_MESSAGES: ChatMessage[] = [
  {
    id: "msg-001",
    channelId: "ch-announcements",
    authorId: "system",
    authorName: "Direction",
    body: "Bienvenue à tous pour cette nouvelle année scolaire.",
    createdAt: "2025-09-15T10:00:00.000Z",
    editedAt: null,
    attachments: [],
    readBy: [],
    voiceNoteSeconds: null,
  },
  {
    id: "msg-002",
    channelId: "ch-teachers",
    authorId: "EMP-2025-002",
    authorName: "Leïla Hadj",
    body: "Réunion demain à 14h en salle des profs.",
    createdAt: "2025-09-14T16:30:00.000Z",
    editedAt: null,
    attachments: [],
    readBy: [],
    voiceNoteSeconds: null,
  },
];

class MockChatRepository implements ChatRepository {
  private readonly channelsSubject = new SubjectBehavior<ChatChannel[]>(SEED_CHANNELS);
  private channels: ChatChannel[] = SEED_CHANNELS;
  private readonly channelSubjects = new Map<string, SubjectBehavior<ChatChannel | null>>();
  private readonly messageSubjects = new Map<string, SubjectBehavior<ChatMessage[]>>();
  private messages: ChatMessage[] = SEED_MESSAGES;

  private ensureChannelSubject(id: string): SubjectBehavior<ChatChannel | null> {
    let s = this.channelSubjects.get(id);
    if (!s) {
      s = new SubjectBehavior<ChatChannel | null>(this.channels.find((c) => c.id === id) ?? null);
      this.channelSubjects.set(id, s);
    }
    return s;
  }
  private ensureMessageSubject(id: string): SubjectBehavior<ChatMessage[]> {
    let s = this.messageSubjects.get(id);
    if (!s) {
      s = new SubjectBehavior<ChatMessage[]>(this.messages.filter((m) => m.channelId === id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
      this.messageSubjects.set(id, s);
    }
    return s;
  }
  private notifyChannels(): void {
    this.channelsSubject.set(this.channels);
    this.channelSubjects.forEach((s, id) => s.set(this.channels.find((c) => c.id === id) ?? null));
  }
  private notifyMessages(): void {
    this.messageSubjects.forEach((s, id) => {
      s.set(this.messages.filter((m) => m.channelId === id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
    });
  }

  observeChannels(personnelId: string): Observable<ChatChannel[]> {
    // Returns channels where the personnel is a member OR announcement/department channels (visible to all).
    return new SubjectBehavior<ChatChannel[]>(
      this.channels.filter((c) =>
        c.archivedAt === null && (
          c.type === "announcement" ||
          c.memberIds.includes(personnelId) ||
          c.memberIds.length === 0 // open channel — visible to everyone
        ),
      ),
    );
  }
  observeChannel(channelId: string): Observable<ChatChannel | null> {
    return this.ensureChannelSubject(channelId);
  }
  observeMessages(channelId: string): Observable<ChatMessage[]> {
    return this.ensureMessageSubject(channelId);
  }

  async createChannel(input: {
    type: ChannelType;
    name: string;
    description: string | null;
    memberIds: readonly string[];
    departmentId: string | null;
    createdBy: string;
  }): Promise<Result<ChatChannel>> {
    const ch: ChatChannel = {
      id: genId("ch"),
      tenantId: TENANT_ID,
      type: input.type,
      name: input.name,
      description: input.description,
      memberIds: input.memberIds,
      departmentId: input.departmentId,
      createdBy: input.createdBy,
      createdAt: nowIso(),
      archivedAt: null,
      lastMessageAt: null,
      lastMessagePreview: null,
    };
    this.channels = [...this.channels, ch];
    this.notifyChannels();
    audit({ action: "chat.channel_create", entityType: "chat_channel", entityId: ch.id, actorId: input.createdBy, diff: { after: ch } });
    return Ok(ch);
  }

  async updateChannel(id: string, updates: Partial<ChatChannel>): Promise<Result<ChatChannel>> {
    const idx = this.channels.findIndex((c) => c.id === id);
    if (idx === -1) return Err(Errors.notFound("chat_channel", id));
    const before = this.channels[idx];
    const after = { ...before, ...updates, id: before.id, tenantId: before.tenantId };
    this.channels = [...this.channels.slice(0, idx), after, ...this.channels.slice(idx + 1)];
    this.notifyChannels();
    audit({ action: "chat.channel_update", entityType: "chat_channel", entityId: id, diff: { before, after } });
    return Ok(after);
  }

  async archiveChannel(id: string): Promise<Result<ChatChannel>> {
    return this.updateChannel(id, { archivedAt: nowIso() });
  }

  async addMembers(id: string, memberIds: readonly string[]): Promise<Result<ChatChannel>> {
    const ch = this.channels.find((c) => c.id === id);
    if (!ch) return Err(Errors.notFound("chat_channel", id));
    const merged = Array.from(new Set([...ch.memberIds, ...memberIds]));
    return this.updateChannel(id, { memberIds: merged });
  }

  async removeMembers(id: string, memberIds: readonly string[]): Promise<Result<ChatChannel>> {
    const ch = this.channels.find((c) => c.id === id);
    if (!ch) return Err(Errors.notFound("chat_channel", id));
    const filtered = ch.memberIds.filter((m) => !memberIds.includes(m));
    return this.updateChannel(id, { memberIds: filtered });
  }

  async sendMessage(input: {
    channelId: string;
    authorId: string;
    authorName: string;
    body: string;
    attachments?: readonly TaskAttachment[];
    voiceNoteSeconds?: number | null;
  }): Promise<Result<ChatMessage>> {
    const msg: ChatMessage = {
      id: genId("msg"),
      channelId: input.channelId,
      authorId: input.authorId,
      authorName: input.authorName,
      body: input.body,
      createdAt: nowIso(),
      editedAt: null,
      attachments: input.attachments ?? [],
      readBy: [input.authorId],
      voiceNoteSeconds: input.voiceNoteSeconds ?? null,
    };
    this.messages = [...this.messages, msg];
    // Update channel preview
    const idx = this.channels.findIndex((c) => c.id === input.channelId);
    if (idx !== -1) {
      const before = this.channels[idx];
      const after: ChatChannel = {
        ...before,
        lastMessageAt: msg.createdAt,
        lastMessagePreview: msg.body.slice(0, 80),
      };
      this.channels = [...this.channels.slice(0, idx), after, ...this.channels.slice(idx + 1)];
    }
    this.notifyChannels();
    this.notifyMessages();
    audit({ action: "chat.message_send", entityType: "chat_message", entityId: msg.id, actorId: input.authorId, actorName: input.authorName });
    return Ok(msg);
  }

  async editMessage(id: string, body: string): Promise<Result<ChatMessage>> {
    const idx = this.messages.findIndex((m) => m.id === id);
    if (idx === -1) return Err(Errors.notFound("chat_message", id));
    const before = this.messages[idx];
    const after: ChatMessage = { ...before, body, editedAt: nowIso() };
    this.messages = [...this.messages.slice(0, idx), after, ...this.messages.slice(idx + 1)];
    this.notifyMessages();
    audit({ action: "chat.message_edit", entityType: "chat_message", entityId: id, diff: { before, after } });
    return Ok(after);
  }

  async deleteMessage(id: string): Promise<Result<void>> {
    this.messages = this.messages.filter((m) => m.id !== id);
    this.notifyMessages();
    audit({ action: "chat.message_delete", entityType: "chat_message", entityId: id });
    return Ok(undefined);
  }

  async markRead(channelId: string, personnelId: string): Promise<Result<void>> {
    this.messages = this.messages.map((m) =>
      m.channelId === channelId && !m.readBy.includes(personnelId)
        ? { ...m, readBy: [...m.readBy, personnelId] }
        : m,
    );
    this.notifyMessages();
    return Ok(undefined);
  }

  async openParentChannel(parentId: string, displayName: string): Promise<Result<ChatChannel>> {
    // T-100 mock parity: create (or return) an in-memory direct channel with
    // the parent. Mock parents have no real user_profiles link — the parentId
    // doubles as the "member" id so the demo flow stays shape-identical.
    const existing = this.channels.find(
      (c) => c.type === "direct" && c.memberIds.includes(parentId) && c.archivedAt === null,
    );
    if (existing) return Ok(existing);
    const ch: ChatChannel = {
      id: genId("ch"),
      tenantId: TENANT_ID,
      type: "direct",
      name: `Parent — ${displayName || parentId}`,
      description: null,
      memberIds: [parentId],
      departmentId: null,
      createdBy: parentId,
      createdAt: nowIso(),
      archivedAt: null,
      lastMessageAt: null,
      lastMessagePreview: null,
    };
    this.channels = [...this.channels, ch];
    this.notifyChannels();
    audit({ action: "chat.channel_create", entityType: "chat_channel", entityId: ch.id, diff: { after: ch } });
    return Ok(ch);
  }
}

/* ------------------------------------------------------------------ */
/*  Onboarding                                                         */
/* ------------------------------------------------------------------ */

const EMPTY_ONBOARDING_DATA: OnboardingData = {
  departments: [],
  roles: [],
  employeeCount: 0,
  adminIds: [],
  managerAssignments: [],
  workingHours: { start: "08:00", end: "17:00", weekdays: ["mon", "tue", "wed", "thu", "fri"] },
  shiftTypes: ["morning", "afternoon"],
  permissionOverrides: {},
};

class MockOnboardingRepository implements OnboardingRepository {
  private readonly subjects = new SubjectBehavior<OnboardingState | null>(null);
  private state: OnboardingState | null = null;

  observe(): Observable<OnboardingState | null> { return this.subjects; }

  async start(): Promise<Result<OnboardingState>> {
    this.state = {
      tenantId: TENANT_ID,
      startedAt: nowIso(),
      completedAt: null,
      currentStep: "welcome",
      completedSteps: new Set<OnboardingStep>(),
      data: EMPTY_ONBOARDING_DATA,
    };
    this.subjects.set(this.state);
    audit({ action: "onboarding.start", entityType: "onboarding", entityId: TENANT_ID });
    return Ok(this.state);
  }

  async advanceTo(step: OnboardingStep): Promise<Result<OnboardingState>> {
    if (!this.state) return Err(Errors.validation("onboarding", "L'onboarding n'a pas été démarré."));
    this.state = { ...this.state, currentStep: step };
    this.subjects.set(this.state);
    return Ok(this.state);
  }

  async completeStep(step: OnboardingStep): Promise<Result<OnboardingState>> {
    if (!this.state) return Err(Errors.validation("onboarding", "L'onboarding n'a pas été démarré."));
    const completed = new Set(this.state.completedSteps);
    completed.add(step);
    this.state = { ...this.state, completedSteps: completed };
    this.subjects.set(this.state);
    return Ok(this.state);
  }

  async updateData(updates: Partial<OnboardingData>): Promise<Result<OnboardingState>> {
    if (!this.state) return Err(Errors.validation("onboarding", "L'onboarding n'a pas été démarré."));
    this.state = {
      ...this.state,
      data: { ...this.state.data, ...updates },
    };
    this.subjects.set(this.state);
    return Ok(this.state);
  }

  async complete(): Promise<Result<OnboardingState>> {
    if (!this.state) return Err(Errors.validation("onboarding", "L'onboarding n'a pas été démarré."));
    this.state = {
      ...this.state,
      completedAt: nowIso(),
      currentStep: "done",
      completedSteps: new Set<OnboardingStep>([
        "welcome", "departments", "roles", "employees", "admins", "managers",
        "working_hours", "shift_types", "permissions", "review", "done",
      ]),
    };
    this.subjects.set(this.state);
    audit({ action: "onboarding.complete", entityType: "onboarding", entityId: TENANT_ID });
    return Ok(this.state);
  }

  async reset(): Promise<Result<OnboardingState>> {
    this.state = null;
    this.subjects.set(this.state);
    audit({ action: "onboarding.reset", entityType: "onboarding", entityId: TENANT_ID });
    return this.start();
  }

  async isComplete(): Promise<Result<boolean>> {
    return Ok(this.state?.completedAt != null);
  }
}

/* ------------------------------------------------------------------ */
/*  Exports                                                            */
/* ------------------------------------------------------------------ */

export const mockDepartmentRepository = new MockDepartmentRepository();
export const mockShiftRepository = new MockShiftRepository();
export const mockScheduleRepository = new MockScheduleRepository();
export const mockTaskRepository = new MockTaskRepository();
export const mockWorkforceAttendanceRepository = new MockWorkforceAttendanceRepository();
export const mockLeaveRequestRepository = new MockLeaveRequestRepository();
export const mockPerformanceReviewRepository = new MockPerformanceReviewRepository();
export const mockChatRepository = new MockChatRepository();
export const mockOnboardingRepository = new MockOnboardingRepository();
