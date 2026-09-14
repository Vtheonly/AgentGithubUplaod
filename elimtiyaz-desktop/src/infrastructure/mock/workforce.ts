// ============================================================================
// FILE: src/infrastructure/mock/workforce.ts
// ============================================================================
import { Ok, Err } from "../../core/result";
import { Errors } from "../../core/app-error";
import { mockObservable } from "./mock-observable";
import type {
  Department,
  Shift,
  Schedule,
  Task,
  TaskPriority,
  TaskStatus,
  AttendanceEvent,
  StaffAbsenceRecord,
  LeaveRequest,
  RequestStatus,
  PerformanceReview,
  ChatChannel,
  ChatMessage,
  OnboardingState,
  OnboardingStep,
  OnboardingData,
} from "../../domain/model/workforce";
import type {
  DepartmentRepository,
  ShiftRepository,
  ScheduleRepository,
  TaskRepository,
  AttendanceRepository,
  LeaveRequestRepository,
  PerformanceReviewRepository,
  ChatRepository,
  OnboardingRepository,
} from "../../domain/repository/workforce-repository";

// In-memory persistent stores
let mockDepartments: Department[] = [
  {
    id: "dept-admin",
    tenantId: "tenant-default",
    name: "Direction & Administration",
    description: "Gestion globale et finances",
    color: "brand-blue-deep",
    headId: "pers-001",
    parentId: null,
    createdAt: "2025-09-01T08:00:00Z",
    archivedAt: null,
  },
  {
    id: "dept-teaching",
    tenantId: "tenant-default",
    name: "Corps Enseignant",
    description: "Pédagogie et scolarité",
    color: "brand-gold",
    headId: "pers-002",
    parentId: null,
    createdAt: "2025-09-01T08:00:00Z",
    archivedAt: null,
  },
  {
    id: "dept-support",
    tenantId: "tenant-default",
    name: "Accueil & Support",
    description: "Inscriptions et relations parents",
    color: "status-info",
    headId: "pers-003",
    parentId: null,
    createdAt: "2025-09-01T08:00:00Z",
    archivedAt: null,
  },
  {
    id: "dept-maintenance",
    tenantId: "tenant-default",
    name: "Maintenance & Logistique",
    description: "Entretien et transport",
    color: "brand-brown",
    headId: "pers-004",
    parentId: null,
    createdAt: "2025-09-01T08:00:00Z",
    archivedAt: null,
  },
];

let mockShifts: Shift[] = [
  {
    id: "shift-morning",
    tenantId: "tenant-default",
    label: "Matin standard",
    weekday: "mon",
    shiftType: "morning",
    startTime: "08:00",
    endTime: "12:00",
    breakMinutes: 15,
    color: "brand-blue",
  },
  {
    id: "shift-afternoon",
    tenantId: "tenant-default",
    label: "Après-midi standard",
    weekday: "mon",
    shiftType: "afternoon",
    startTime: "13:00",
    endTime: "17:00",
    breakMinutes: 15,
    color: "brand-gold",
  },
];

let mockSchedules: Schedule[] = [];

let mockTasks: Task[] = [
  {
    id: "task-001",
    tenantId: "tenant-default",
    title: "Préparer les fiches d'évaluation du Trimestre 2",
    description:
      "Vérifier la conformité des coefficients pour chaque niveau avant la clôture.",
    priority: "high",
    status: "in_progress",
    departmentId: "dept-teaching",
    assigneeIds: ["pers-002"],
    createdBy: "usr-admin",
    createdByName: "Super Admin",
    createdAt: "2026-03-01T10:00:00Z",
    updatedAt: "2026-03-02T14:30:00Z",
    dueDate: "2026-03-20",
    completedAt: null,
    completedBy: null,
    completionNote: null,
    reviewedBy: null,
    reviewNote: null,
    attachments: [],
    comments: [],
    progress: 40,
    tags: ["Pédagogie", "Bulletins"],
  },
  {
    id: "task-002",
    tenantId: "tenant-default",
    title: "Inventaire matériel informatique et projecteurs",
    description:
      "Recenser les équipements défectueux dans les salles du bloc B.",
    priority: "medium",
    status: "needs_review",
    departmentId: "dept-maintenance",
    assigneeIds: ["pers-004"],
    createdBy: "usr-admin",
    createdByName: "Super Admin",
    createdAt: "2026-03-05T09:00:00Z",
    updatedAt: "2026-03-12T16:00:00Z",
    dueDate: "2026-03-15",
    completedAt: "2026-03-12T16:00:00Z",
    completedBy: "pers-004",
    completionNote:
      "Inventaire complet réalisé. 2 projecteurs nécessitent un changement de lampe.",
    reviewedBy: null,
    reviewNote: null,
    attachments: [],
    comments: [],
    progress: 100,
    tags: ["Logistique", "Inventaire"],
  },
];

let mockAttendanceEvents: AttendanceEvent[] = [
  {
    id: "att-001",
    tenantId: "tenant-default",
    personnelId: "pers-001",
    date: new Date().toISOString().slice(0, 10),
    timestamp: new Date().toISOString(),
    eventType: "clock_in",
    metadata: null,
  },
];

let mockStaffAbsences: StaffAbsenceRecord[] = [
  {
    id: "abs-001",
    tenantId: "tenant-default",
    personnelId: "pers-002",
    personnelName: "Amina Meziane",
    date: "2026-03-10",
    durationHours: 4,
    isExcused: false,
    justificationStatus: "requested",
    adminRequestNote:
      "Absence constatée le 10 Mars matin. Merci de fournir un justificatif médical.",
    requestedAt: "2026-03-10T14:00:00Z",
    requestedBy: "Super Admin",
    workerExplanation: null,
    workerSubmittedAt: null,
    documentRef: null,
    decisionNote: null,
    decidedAt: null,
    decidedBy: null,
  },
];

let mockLeaveRequests: LeaveRequest[] = [
  {
    id: "lr-001",
    tenantId: "tenant-default",
    personnelId: "pers-003",
    personnelName: "Karim Brahimi",
    type: "leave",
    status: "pending",
    fromDate: "2026-04-01",
    toDate: "2026-04-05",
    amountRequested: null,
    reason: "Congé annuel pour obligations familiales.",
    createdAt: "2026-03-12T08:30:00Z",
    decidedAt: null,
    decidedBy: null,
    decidedByName: null,
    decisionNote: null,
  },
  {
    id: "lr-002",
    tenantId: "tenant-default",
    personnelId: "pers-004",
    personnelName: "Youcef Mansouri",
    type: "spending_reimbursement",
    status: "pending",
    fromDate: "2026-03-11",
    toDate: "2026-03-11",
    amountRequested: 4500,
    reason:
      "Achat urgent de câbles HDMI et rallonges électriques pour la salle polyvalente.",
    createdAt: "2026-03-11T16:00:00Z",
    decidedAt: null,
    decidedBy: null,
    decidedByName: null,
    decisionNote: null,
  },
];

let mockPerformanceReviews: PerformanceReview[] = [];

let mockChatChannels: ChatChannel[] = [
  {
    id: "chan-general",
    tenantId: "tenant-default",
    type: "announcement",
    name: "Annonces Générales",
    description: "Communications officielles de la direction",
    memberIds: [],
    departmentId: null,
    createdBy: "usr-admin",
    createdAt: "2025-09-01T08:00:00Z",
    archivedAt: null,
    lastMessageAt: "2026-03-10T09:00:00Z",
    lastMessagePreview: "Réunion générale de coordination fixée à jeudi 16h.",
  },
];

let mockChatMessages: ChatMessage[] = [
  {
    id: "msg-001",
    channelId: "chan-general",
    authorId: "usr-admin",
    authorName: "Direction Générale",
    body: "Bienvenue sur le canal des annonces officielles pour l'année 2025-2026.",
    createdAt: "2025-09-01T08:00:00Z",
    editedAt: null,
    attachments: [],
    readBy: ["pers-001", "pers-002"],
    voiceNoteSeconds: null,
  },
];

let mockOnboardingState: OnboardingState | null = {
  tenantId: "tenant-default",
  startedAt: "2025-09-01T08:00:00Z",
  completedAt: "2025-09-01T08:30:00Z",
  currentStep: "done",
  completedSteps: new Set([
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
  ]),
  data: {
    departments: mockDepartments.map((d) => ({
      name: d.name,
      color: d.color,
      headId: d.headId,
    })),
    roles: [
      { role: "teacher", count: 18 },
      { role: "worker", count: 8 },
      { role: "support_staff", count: 4 },
    ],
    employeeCount: 30,
    adminIds: ["pers-001"],
    managerAssignments: [],
    workingHours: {
      start: "08:00",
      end: "16:30",
      weekdays: ["mon", "tue", "wed", "thu", "fri"],
    },
    shiftTypes: ["morning", "afternoon"],
    permissionOverrides: {},
  },
};

// ============================================================================
// Repositories Implementations
// ============================================================================

export const mockDepartmentRepository: DepartmentRepository = {
  observe: () => mockObservable(mockDepartments),
  observeById: (id) =>
    mockObservable(mockDepartments.find((d) => d.id === id) ?? null),
  async createDepartment(input) {
    const next: Department = {
      id: `dept-${Date.now()}`,
      tenantId: "tenant-default",
      ...input,
      createdAt: new Date().toISOString(),
      archivedAt: null,
    };
    mockDepartments = [...mockDepartments, next];
    return Ok(next);
  },
  async updateDepartment(id, updates) {
    const idx = mockDepartments.findIndex((d) => d.id === id);
    if (idx === -1) return Err(Errors.notFound("Department", id));
    mockDepartments[idx] = { ...mockDepartments[idx], ...updates };
    return Ok(mockDepartments[idx]);
  },
  async archiveDepartment(id) {
    const idx = mockDepartments.findIndex((d) => d.id === id);
    if (idx === -1) return Err(Errors.notFound("Department", id));
    mockDepartments[idx] = {
      ...mockDepartments[idx],
      archivedAt: new Date().toISOString(),
    };
    return Ok(mockDepartments[idx]);
  },
  async unarchiveDepartment(id) {
    const idx = mockDepartments.findIndex((d) => d.id === id);
    if (idx === -1) return Err(Errors.notFound("Department", id));
    mockDepartments[idx] = { ...mockDepartments[idx], archivedAt: null };
    return Ok(mockDepartments[idx]);
  },
  async deleteDepartment(id) {
    mockDepartments = mockDepartments.filter((d) => d.id !== id);
    return Ok(undefined);
  },
};

export const mockShiftRepository: ShiftRepository = {
  observe: () => mockObservable(mockShifts),
  async createShift(input) {
    const s: Shift = {
      id: `shift-${Date.now()}`,
      tenantId: "tenant-default",
      ...input,
    };
    mockShifts = [...mockShifts, s];
    return Ok(s);
  },
  async updateShift(id, updates) {
    const idx = mockShifts.findIndex((s) => s.id === id);
    if (idx === -1) return Err(Errors.notFound("Shift", id));
    mockShifts[idx] = { ...mockShifts[idx], ...updates };
    return Ok(mockShifts[idx]);
  },
  async deleteShift(id) {
    mockShifts = mockShifts.filter((s) => s.id !== id);
    return Ok(undefined);
  },
};

export const mockScheduleRepository: ScheduleRepository = {
  observeByPersonnel: (pId) =>
    mockObservable(mockSchedules.filter((s) => s.personnelId === pId)),
  observeByWeek: (weekStart) =>
    mockObservable(mockSchedules.filter((s) => s.weekStart === weekStart)),
  async upsertSchedule(input) {
    const id = input.id ?? `sch-${Date.now()}`;
    const next: Schedule = { id, tenantId: "tenant-default", ...input };
    mockSchedules = [...mockSchedules.filter((s) => s.id !== id), next];
    return Ok(next);
  },
  async deleteSchedule(id) {
    mockSchedules = mockSchedules.filter((s) => s.id !== id);
    return Ok(undefined);
  },
};

export const mockTaskRepository: TaskRepository = {
  observe: () => mockObservable(mockTasks),
  observeByAssignee: (pId) =>
    mockObservable(mockTasks.filter((t) => t.assigneeIds.includes(pId))),
  observeByDepartment: (dId) =>
    mockObservable(mockTasks.filter((t) => t.departmentId === dId)),
  observeById: (id) =>
    mockObservable(mockTasks.find((t) => t.id === id) ?? null),
  async createTask(input) {
    const next: Task = {
      id: `task-${Date.now()}`,
      tenantId: "tenant-default",
      title: input.title,
      description: input.description,
      priority: input.priority,
      status: input.assigneeIds.length > 0 ? "assigned" : "pending",
      departmentId: input.departmentId,
      assigneeIds: input.assigneeIds,
      createdBy: input.createdBy,
      createdByName: input.createdByName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      dueDate: input.dueDate,
      completedAt: null,
      completedBy: null,
      completionNote: null,
      reviewedBy: null,
      reviewNote: null,
      attachments: input.attachments ?? [],
      comments: [],
      progress: 0,
      tags: input.tags ?? [],
    };
    mockTasks = [next, ...mockTasks];
    return Ok(next);
  },
  async updateTask(id, updates) {
    const idx = mockTasks.findIndex((t) => t.id === id);
    if (idx === -1) return Err(Errors.notFound("Task", id));
    mockTasks[idx] = {
      ...mockTasks[idx],
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    return Ok(mockTasks[idx]);
  },
  async updateTaskStatus(id, status, actorId, completionNote) {
    const idx = mockTasks.findIndex((t) => t.id === id);
    if (idx === -1) return Err(Errors.notFound("Task", id));
    const isDone = status === "completed" || status === "needs_review";
    mockTasks[idx] = {
      ...mockTasks[idx],
      status,
      completedAt: isDone ? new Date().toISOString() : null,
      completedBy: isDone ? actorId : null,
      completionNote: completionNote ?? mockTasks[idx].completionNote,
      progress: status === "completed" ? 100 : mockTasks[idx].progress,
      updatedAt: new Date().toISOString(),
    };
    return Ok(mockTasks[idx]);
  },
  async reviewTask(id, approved, reviewerId, _reviewerName, reviewNote) {
    const idx = mockTasks.findIndex((t) => t.id === id);
    if (idx === -1) return Err(Errors.notFound("Task", id));
    const nextStatus: TaskStatus = approved ? "completed" : "in_progress";
    mockTasks[idx] = {
      ...mockTasks[idx],
      status: nextStatus,
      reviewedBy: reviewerId,
      reviewNote: reviewNote ?? null,
      progress: approved ? 100 : 50,
      updatedAt: new Date().toISOString(),
    };
    return Ok(mockTasks[idx]);
  },
  async reassign(id, assigneeIds, _actorId) {
    const idx = mockTasks.findIndex((t) => t.id === id);
    if (idx === -1) return Err(Errors.notFound("Task", id));
    mockTasks[idx] = {
      ...mockTasks[idx],
      assigneeIds,
      updatedAt: new Date().toISOString(),
    };
    return Ok(mockTasks[idx]);
  },
  async addComment(id, comment) {
    const idx = mockTasks.findIndex((t) => t.id === id);
    if (idx === -1) return Err(Errors.notFound("Task", id));
    const c = {
      id: `tc-${Date.now()}`,
      taskId: id,
      createdAt: new Date().toISOString(),
      ...comment,
    };
    mockTasks[idx] = {
      ...mockTasks[idx],
      comments: [...mockTasks[idx].comments, c],
    };
    return Ok(c);
  },
  async addAttachment(id, attachment) {
    const idx = mockTasks.findIndex((t) => t.id === id);
    if (idx === -1) return Err(Errors.notFound("Task", id));
    mockTasks[idx] = {
      ...mockTasks[idx],
      attachments: [...mockTasks[idx].attachments, attachment],
    };
    return Ok(mockTasks[idx]);
  },
  async deleteTask(id) {
    mockTasks = mockTasks.filter((t) => t.id !== id);
    return Ok(undefined);
  },
};

export const mockWorkforceAttendanceRepository: AttendanceRepository = {
  observeByPersonnel: (pId, from, to) =>
    mockObservable(
      mockAttendanceEvents.filter(
        (e) => e.personnelId === pId && e.date >= from && e.date <= to,
      ),
    ),
  observeByDate: (date) =>
    mockObservable(mockAttendanceEvents.filter((e) => e.date === date)),
  latestFor: (personnelId, date) => {
    const matches = mockAttendanceEvents.filter(
      (e) => e.personnelId === personnelId && e.date === date,
    );
    return matches.length > 0 ? matches[matches.length - 1] : null;
  },
  async recordEvent(input) {
    const evt: AttendanceEvent = {
      id: `att-${Date.now()}`,
      tenantId: "tenant-default",
      ...input,
      timestamp: new Date().toISOString(),
      metadata: input.metadata ?? null,
    };
    mockAttendanceEvents = [...mockAttendanceEvents, evt];
    return Ok(evt);
  },
  observeAbsences: (pId) =>
    mockObservable(
      pId
        ? mockStaffAbsences.filter((a) => a.personnelId === pId)
        : mockStaffAbsences,
    ),
  async requestAbsenceJustification(input) {
    const idx = mockStaffAbsences.findIndex((a) => a.id === input.absenceId);
    if (idx === -1) return Err(Errors.notFound("Absence", input.absenceId));
    mockStaffAbsences[idx] = {
      ...mockStaffAbsences[idx],
      justificationStatus: "requested",
      adminRequestNote: input.adminNote,
      requestedAt: new Date().toISOString(),
      requestedBy: input.requestedBy,
    };
    return Ok(mockStaffAbsences[idx]);
  },
  async submitAbsenceJustification(input) {
    const idx = mockStaffAbsences.findIndex((a) => a.id === input.absenceId);
    if (idx === -1) return Err(Errors.notFound("Absence", input.absenceId));
    mockStaffAbsences[idx] = {
      ...mockStaffAbsences[idx],
      justificationStatus: "submitted",
      workerExplanation: input.workerExplanation,
      workerSubmittedAt: new Date().toISOString(),
      documentRef: input.documentRef ?? null,
    };
    return Ok(mockStaffAbsences[idx]);
  },
  async reviewAbsenceJustification(input) {
    const idx = mockStaffAbsences.findIndex((a) => a.id === input.absenceId);
    if (idx === -1) return Err(Errors.notFound("Absence", input.absenceId));
    mockStaffAbsences[idx] = {
      ...mockStaffAbsences[idx],
      justificationStatus:
        input.decision === "accepted" ? "accepted" : "rejected",
      isExcused: input.decision === "accepted",
      decisionNote: input.decisionNote,
      decidedAt: new Date().toISOString(),
      decidedBy: input.decidedBy,
    };
    return Ok(mockStaffAbsences[idx]);
  },
};

export const mockLeaveRequestRepository: LeaveRequestRepository = {
  observe: () => mockObservable(mockLeaveRequests),
  observeByPersonnel: (pId) =>
    mockObservable(mockLeaveRequests.filter((r) => r.personnelId === pId)),
  observePending: () =>
    mockObservable(mockLeaveRequests.filter((r) => r.status === "pending")),
  async submit(input) {
    const req: LeaveRequest = {
      id: `lr-${Date.now()}`,
      tenantId: "tenant-default",
      status: "pending",
      createdAt: new Date().toISOString(),
      decidedAt: null,
      decidedBy: null,
      decidedByName: null,
      decisionNote: null,
      clarificationRequest: null,
      clarificationResponse: null,
      ...input,
    };
    mockLeaveRequests = [req, ...mockLeaveRequests];
    return Ok(req);
  },
  async decide(id, status, decidedBy, decidedByName, note) {
    const idx = mockLeaveRequests.findIndex((r) => r.id === id);
    if (idx === -1) return Err(Errors.notFound("LeaveRequest", id));
    mockLeaveRequests[idx] = {
      ...mockLeaveRequests[idx],
      status,
      decidedBy,
      decidedByName,
      decisionNote: note ?? null,
      decidedAt: new Date().toISOString(),
    };
    return Ok(mockLeaveRequests[idx]);
  },
  async requestClarification(id, question, _requestedBy) {
    const idx = mockLeaveRequests.findIndex((r) => r.id === id);
    if (idx === -1) return Err(Errors.notFound("LeaveRequest", id));
    mockLeaveRequests[idx] = {
      ...mockLeaveRequests[idx],
      status: "clarification_requested",
      clarificationRequest: question,
    };
    return Ok(mockLeaveRequests[idx]);
  },
  async respondClarification(id, response) {
    const idx = mockLeaveRequests.findIndex((r) => r.id === id);
    if (idx === -1) return Err(Errors.notFound("LeaveRequest", id));
    mockLeaveRequests[idx] = {
      ...mockLeaveRequests[idx],
      status: "pending",
      clarificationResponse: response,
    };
    return Ok(mockLeaveRequests[idx]);
  },
  async cancel(id) {
    const idx = mockLeaveRequests.findIndex((r) => r.id === id);
    if (idx === -1) return Err(Errors.notFound("LeaveRequest", id));
    mockLeaveRequests[idx] = { ...mockLeaveRequests[idx], status: "cancelled" };
    return Ok(mockLeaveRequests[idx]);
  },
};

export const mockPerformanceReviewRepository: PerformanceReviewRepository = {
  observeByPersonnel: (pId) =>
    mockObservable(mockPerformanceReviews.filter((r) => r.personnelId === pId)),
  async createReview(input) {
    const rev: PerformanceReview = {
      id: `pr-${Date.now()}`,
      tenantId: "tenant-default",
      reviewedAt: new Date().toISOString(),
      ...input,
    };
    mockPerformanceReviews = [...mockPerformanceReviews, rev];
    return Ok(rev);
  },
  async updateReview(id, updates) {
    const idx = mockPerformanceReviews.findIndex((r) => r.id === id);
    if (idx === -1) return Err(Errors.notFound("PerformanceReview", id));
    mockPerformanceReviews[idx] = {
      ...mockPerformanceReviews[idx],
      ...updates,
    };
    return Ok(mockPerformanceReviews[idx]);
  },
  async deleteReview(id) {
    mockPerformanceReviews = mockPerformanceReviews.filter((r) => r.id !== id);
    return Ok(undefined);
  },
};

export const mockChatRepository: ChatRepository = {
  observeChannels: (pId) =>
    mockObservable(
      mockChatChannels.filter(
        (c) => c.memberIds.length === 0 || c.memberIds.includes(pId),
      ),
    ),
  observeChannel: (cId) =>
    mockObservable(mockChatChannels.find((c) => c.id === cId) ?? null),
  observeMessages: (cId) =>
    mockObservable(mockChatMessages.filter((m) => m.channelId === cId)),
  async createChannel(input) {
    const c: ChatChannel = {
      id: `chan-${Date.now()}`,
      tenantId: "tenant-default",
      createdAt: new Date().toISOString(),
      archivedAt: null,
      lastMessageAt: null,
      lastMessagePreview: null,
      ...input,
    };
    mockChatChannels = [...mockChatChannels, c];
    return Ok(c);
  },
  async updateChannel(id, updates) {
    const idx = mockChatChannels.findIndex((c) => c.id === id);
    if (idx === -1) return Err(Errors.notFound("ChatChannel", id));
    mockChatChannels[idx] = { ...mockChatChannels[idx], ...updates };
    return Ok(mockChatChannels[idx]);
  },
  async archiveChannel(id) {
    const idx = mockChatChannels.findIndex((c) => c.id === id);
    if (idx === -1) return Err(Errors.notFound("ChatChannel", id));
    mockChatChannels[idx] = {
      ...mockChatChannels[idx],
      archivedAt: new Date().toISOString(),
    };
    return Ok(mockChatChannels[idx]);
  },
  async addMembers(id, memberIds) {
    const idx = mockChatChannels.findIndex((c) => c.id === id);
    if (idx === -1) return Err(Errors.notFound("ChatChannel", id));
    const merged = Array.from(
      new Set([...mockChatChannels[idx].memberIds, ...memberIds]),
    );
    mockChatChannels[idx] = { ...mockChatChannels[idx], memberIds: merged };
    return Ok(mockChatChannels[idx]);
  },
  async removeMembers(id, memberIds) {
    const idx = mockChatChannels.findIndex((c) => c.id === id);
    if (idx === -1) return Err(Errors.notFound("ChatChannel", id));
    const filtered = mockChatChannels[idx].memberIds.filter(
      (m) => !memberIds.includes(m),
    );
    mockChatChannels[idx] = { ...mockChatChannels[idx], memberIds: filtered };
    return Ok(mockChatChannels[idx]);
  },
  async sendMessage(input) {
    const msg: ChatMessage = {
      id: `msg-${Date.now()}`,
      createdAt: new Date().toISOString(),
      editedAt: null,
      readBy: [input.authorId],
      voiceNoteSeconds: input.voiceNoteSeconds ?? null,
      ...input,
    };
    mockChatMessages = [...mockChatMessages, msg];
    const cIdx = mockChatChannels.findIndex((c) => c.id === input.channelId);
    if (cIdx !== -1) {
      mockChatChannels[cIdx] = {
        ...mockChatChannels[cIdx],
        lastMessageAt: msg.createdAt,
        lastMessagePreview: msg.body.slice(0, 60),
      };
    }
    return Ok(msg);
  },
  async editMessage(id, body) {
    const idx = mockChatMessages.findIndex((m) => m.id === id);
    if (idx === -1) return Err(Errors.notFound("ChatMessage", id));
    mockChatMessages[idx] = {
      ...mockChatMessages[idx],
      body,
      editedAt: new Date().toISOString(),
    };
    return Ok(mockChatMessages[idx]);
  },
  async deleteMessage(id) {
    mockChatMessages = mockChatMessages.filter((m) => m.id !== id);
    return Ok(undefined);
  },
  async markRead(channelId, personnelId) {
    mockChatMessages = mockChatMessages.map((m) => {
      if (m.channelId === channelId && !m.readBy.includes(personnelId)) {
        return { ...m, readBy: [...m.readBy, personnelId] };
      }
      return m;
    });
    return Ok(undefined);
  },
  async openParentChannel(parentId, displayName) {
    const existing = mockChatChannels.find(
      (c) => c.type === "direct" && c.name.includes(displayName),
    );
    if (existing) return Ok(existing);
    const next: ChatChannel = {
      id: `chan-parent-${parentId}`,
      tenantId: "tenant-default",
      type: "direct",
      name: `Parent · ${displayName}`,
      description: "Canal direct avec le parent",
      memberIds: [parentId],
      departmentId: null,
      createdBy: "usr-staff",
      createdAt: new Date().toISOString(),
      archivedAt: null,
      lastMessageAt: null,
      lastMessagePreview: null,
    };
    mockChatChannels = [...mockChatChannels, next];
    return Ok(next);
  },
};

export const mockOnboardingRepository: OnboardingRepository = {
  observe: () => mockObservable(mockOnboardingState),
  async start() {
    mockOnboardingState = {
      tenantId: "tenant-default",
      startedAt: new Date().toISOString(),
      completedAt: null,
      currentStep: "welcome",
      completedSteps: new Set(),
      data: {
        departments: [],
        roles: [],
        employeeCount: 0,
        adminIds: [],
        managerAssignments: [],
        workingHours: {
          start: "08:00",
          end: "16:30",
          weekdays: ["mon", "tue", "wed", "thu", "fri"],
        },
        shiftTypes: [],
        permissionOverrides: {},
      },
    };
    return Ok(mockOnboardingState);
  },
  async advanceTo(step: OnboardingStep) {
    if (!mockOnboardingState)
      return Err(Errors.notFound("OnboardingState", "current"));
    mockOnboardingState = { ...mockOnboardingState, currentStep: step };
    return Ok(mockOnboardingState);
  },
  async completeStep(step: OnboardingStep) {
    if (!mockOnboardingState)
      return Err(Errors.notFound("OnboardingState", "current"));
    const set = new Set(mockOnboardingState.completedSteps);
    set.add(step);
    mockOnboardingState = { ...mockOnboardingState, completedSteps: set };
    return Ok(mockOnboardingState);
  },
  async updateData(updates: Partial<OnboardingData>) {
    if (!mockOnboardingState)
      return Err(Errors.notFound("OnboardingState", "current"));
    mockOnboardingState = {
      ...mockOnboardingState,
      data: { ...mockOnboardingState.data, ...updates },
    };
    return Ok(mockOnboardingState);
  },
  async complete() {
    if (!mockOnboardingState)
      return Err(Errors.notFound("OnboardingState", "current"));
    mockOnboardingState = {
      ...mockOnboardingState,
      completedAt: new Date().toISOString(),
      currentStep: "done",
    };
    return Ok(mockOnboardingState);
  },
  async reset() {
    mockOnboardingState = null;
    return Ok(null as unknown as OnboardingState);
  },
  async isComplete() {
    return Ok(
      mockOnboardingState?.completedAt !== null && mockOnboardingState !== null,
    );
  },
};
