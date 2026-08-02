/**
 * Workforce domain model tests — iteration 8.
 *
 * Verifies the workforce domain entities, label maps, and the
 * staffCategoryForRole helper function.
 */
import { describe, it, expect } from "vitest";
import {
  DEFAULT_DEPARTMENTS,
  DEPARTMENT_COLOR_OPTIONS,
  WEEKDAYS,
  WEEKDAY_LABELS_FR,
  SHIFT_TYPE_LABELS_FR,
  ONBOARDING_STEPS,
  TASK_PRIORITY_LABELS_FR,
  TASK_STATUS_LABELS_FR,
  REQUEST_TYPE_LABELS_FR,
  REQUEST_STATUS_LABELS_FR,
  CHANNEL_TYPE_LABELS_FR,
  ATTENDANCE_EVENT_LABELS_FR,
  type Department,
  type Shift,
  type Schedule,
  type Task,
  type AttendanceEvent,
  type LeaveRequest,
  type PerformanceReview,
  type ChatChannel,
  type ChatMessage,
  type OnboardingState,
  type Weekday,
  type ShiftType,
  type TaskPriority,
  type TaskStatus,
  type RequestType,
  type RequestStatus,
  type ChannelType,
  type AttendanceEventType,
  type OnboardingStep,
} from "../../../domain/model/workforce";
import { Role } from "../../../core/rbac/roles";
import { staffCategoryForRole, STAFF_CATEGORY_LABELS_FR, PERSONNEL_STATUS_LABELS_FR, PAYROLL_METHOD_LABELS_FR, RELEVE_ACTIVITY_LABELS_FR } from "../../../domain/model/personnel";

describe("Workforce domain — labels & constants", () => {
  it("DEFAULT_DEPARTMENTS contains the plan §09 taxonomy", () => {
    const names = DEFAULT_DEPARTMENTS.map((d) => d.name);
    expect(names).toContain("Administration");
    expect(names).toContain("Managers");
    expect(names).toContain("Teachers");
    expect(names).toContain("Buyers");
    expect(names).toContain("Drivers");
    expect(names).toContain("Warehouse");
    expect(names).toContain("Sales");
    expect(names).toContain("Accounting");
    expect(names).toContain("Security");
    expect(names).toContain("Human Resources");
    expect(names).toContain("Maintenance");
    expect(DEFAULT_DEPARTMENTS.length).toBeGreaterThanOrEqual(11);
  });

  it("DEPARTMENT_COLOR_OPTIONS covers the brand + status palette", () => {
    expect(DEPARTMENT_COLOR_OPTIONS).toContain("brand-blue");
    expect(DEPARTMENT_COLOR_OPTIONS).toContain("brand-gold");
    expect(DEPARTMENT_COLOR_OPTIONS).toContain("status-success");
    expect(DEPARTMENT_COLOR_OPTIONS).toContain("status-danger");
  });

  it("WEEKDAYS has 7 entries in correct order", () => {
    expect(WEEKDAYS).toHaveLength(7);
    expect(WEEKDAYS[0]).toBe("mon");
    expect(WEEKDAYS[6]).toBe("sun");
  });

  it("WEEKDAY_LABELS_FR covers every weekday", () => {
    for (const day of WEEKDAYS) {
      expect(WEEKDAY_LABELS_FR[day as Weekday]).toBeDefined();
      expect(WEEKDAY_LABELS_FR[day as Weekday].length).toBeGreaterThan(0);
    }
  });

  it("SHIFT_TYPE_LABELS_FR covers every shift type", () => {
    const types: ShiftType[] = ["morning", "afternoon", "evening", "night", "split", "flexible"];
    for (const t of types) {
      expect(SHIFT_TYPE_LABELS_FR[t]).toBeDefined();
    }
  });

  it("TASK_PRIORITY_LABELS_FR covers every priority", () => {
    const priorities: TaskPriority[] = ["low", "medium", "high", "urgent"];
    for (const p of priorities) {
      expect(TASK_PRIORITY_LABELS_FR[p]).toBeDefined();
    }
  });

  it("TASK_STATUS_LABELS_FR covers every status", () => {
    const statuses: TaskStatus[] = ["pending", "assigned", "in_progress", "blocked", "completed", "cancelled"];
    for (const s of statuses) {
      expect(TASK_STATUS_LABELS_FR[s]).toBeDefined();
    }
  });

  it("REQUEST_TYPE_LABELS_FR covers every request type", () => {
    const types: RequestType[] = ["leave", "absence", "overtime", "shift_swap", "remote"];
    for (const t of types) {
      expect(REQUEST_TYPE_LABELS_FR[t]).toBeDefined();
    }
  });

  it("REQUEST_STATUS_LABELS_FR covers every request status", () => {
    const statuses: RequestStatus[] = ["pending", "approved", "rejected", "cancelled"];
    for (const s of statuses) {
      expect(REQUEST_STATUS_LABELS_FR[s]).toBeDefined();
    }
  });

  it("CHANNEL_TYPE_LABELS_FR covers every channel type", () => {
    const types: ChannelType[] = ["direct", "group", "department", "announcement"];
    for (const t of types) {
      expect(CHANNEL_TYPE_LABELS_FR[t]).toBeDefined();
    }
  });

  it("ATTENDANCE_EVENT_LABELS_FR covers every event type", () => {
    const types: AttendanceEventType[] = ["clock_in", "clock_out", "break_start", "break_end"];
    for (const t of types) {
      expect(ATTENDANCE_EVENT_LABELS_FR[t]).toBeDefined();
    }
  });

  it("ONBOARDING_STEPS has 11 steps in order", () => {
    expect(ONBOARDING_STEPS).toHaveLength(11);
    expect(ONBOARDING_STEPS[0]).toBe("welcome");
    expect(ONBOARDING_STEPS[10]).toBe("done");
    // Ensure no duplicates
    const set = new Set(ONBOARDING_STEPS);
    expect(set.size).toBe(11);
  });
});

describe("Workforce domain — entity shapes (compile-time check)", () => {
  // These tests ensure the interfaces have all the required fields.
  // They're compile-time checks; the runtime assertions just verify the objects exist.

  it("Department has required fields", () => {
    const dept: Department = {
      id: "dept-1",
      tenantId: "tnt-1",
      name: "Test",
      description: "Test dept",
      color: "brand-blue",
      headId: null,
      parentId: null,
      createdAt: "2025-01-01T00:00:00.000Z",
      archivedAt: null,
    };
    expect(dept.id).toBe("dept-1");
    expect(dept.name).toBe("Test");
  });

  it("Shift has required fields", () => {
    const shift: Shift = {
      id: "shift-1",
      tenantId: "tnt-1",
      label: "Morning",
      weekday: "mon",
      shiftType: "morning",
      startTime: "08:00",
      endTime: "12:00",
      breakMinutes: 0,
      color: "brand-blue",
    };
    expect(shift.id).toBe("shift-1");
    expect(shift.weekday).toBe("mon");
  });

  it("Task has required fields including comments and attachments", () => {
    const task: Task = {
      id: "task-1",
      tenantId: "tnt-1",
      title: "Test",
      description: "",
      priority: "medium",
      status: "pending",
      departmentId: null,
      assigneeIds: [],
      createdBy: "u1",
      createdByName: "User",
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
      dueDate: null,
      completedAt: null,
      attachments: [],
      comments: [],
      progress: 0,
      tags: [],
    };
    expect(task.id).toBe("task-1");
    expect(task.attachments).toEqual([]);
    expect(task.comments).toEqual([]);
  });

  it("AttendanceEvent has required fields", () => {
    const evt: AttendanceEvent = {
      id: "att-1",
      tenantId: "tnt-1",
      personnelId: "per-1",
      date: "2025-09-20",
      timestamp: "2025-09-20T08:00:00.000Z",
      eventType: "clock_in",
      metadata: null,
    };
    expect(evt.eventType).toBe("clock_in");
  });

  it("LeaveRequest has required fields", () => {
    const req: LeaveRequest = {
      id: "lr-1",
      tenantId: "tnt-1",
      personnelId: "per-1",
      personnelName: "Test",
      type: "leave",
      status: "pending",
      fromDate: "2025-10-01",
      toDate: "2025-10-05",
      reason: "Vacances",
      createdAt: "2025-09-20T00:00:00.000Z",
      decidedAt: null,
      decidedBy: null,
      decidedByName: null,
      decisionNote: null,
    };
    expect(req.status).toBe("pending");
  });

  it("PerformanceReview has required fields", () => {
    const review: PerformanceReview = {
      id: "pr-1",
      tenantId: "tnt-1",
      personnelId: "per-1",
      personnelName: "Test",
      period: "2025",
      rating: 4.0,
      strengths: "",
      improvements: "",
      goals: "",
      reviewerId: "u1",
      reviewerName: "Admin",
      reviewedAt: "2025-01-15T00:00:00.000Z",
    };
    expect(review.rating).toBe(4.0);
  });

  it("ChatChannel has required fields", () => {
    const ch: ChatChannel = {
      id: "ch-1",
      tenantId: "tnt-1",
      type: "group",
      name: "Test group",
      description: null,
      memberIds: ["per-1", "per-2"],
      departmentId: null,
      createdBy: "per-1",
      createdAt: "2025-01-01T00:00:00.000Z",
      archivedAt: null,
      lastMessageAt: null,
      lastMessagePreview: null,
    };
    expect(ch.type).toBe("group");
    expect(ch.memberIds).toHaveLength(2);
  });

  it("ChatMessage has required fields including readBy and voiceNoteSeconds", () => {
    const msg: ChatMessage = {
      id: "msg-1",
      channelId: "ch-1",
      authorId: "per-1",
      authorName: "Test",
      body: "Hello",
      createdAt: "2025-01-01T00:00:00.000Z",
      editedAt: null,
      attachments: [],
      readBy: [],
      voiceNoteSeconds: null,
    };
    expect(msg.body).toBe("Hello");
    expect(msg.voiceNoteSeconds).toBeNull();
  });

  it("OnboardingState has required fields", () => {
    const state: OnboardingState = {
      tenantId: "tnt-1",
      startedAt: "2025-01-01T00:00:00.000Z",
      completedAt: null,
      currentStep: "welcome",
      completedSteps: new Set<OnboardingStep>(),
      data: {
        departments: [],
        roles: [],
        employeeCount: 0,
        adminIds: [],
        managerAssignments: [],
        workingHours: { start: "08:00", end: "17:00", weekdays: ["mon"] },
        shiftTypes: [],
        permissionOverrides: {},
      },
    };
    expect(state.currentStep).toBe("welcome");
    expect(state.data.employeeCount).toBe(0);
  });
});

describe("Personnel model — staffCategoryForRole mapping", () => {
  it("maps Teacher role to teacher category", () => {
    expect(staffCategoryForRole(Role.Teacher)).toBe("teacher");
  });

  it("maps SuperAdmin to administration category", () => {
    expect(staffCategoryForRole(Role.SuperAdmin)).toBe("administration");
  });

  it("maps FinancialOfficer to administration category", () => {
    expect(staffCategoryForRole(Role.FinancialOfficer)).toBe("administration");
  });

  it("maps Manager to administration category", () => {
    expect(staffCategoryForRole(Role.Manager)).toBe("administration");
  });

  it("maps SupportStaff to support category", () => {
    expect(staffCategoryForRole(Role.SupportStaff)).toBe("support");
  });

  it("maps Buyer to buyer category", () => {
    expect(staffCategoryForRole(Role.Buyer)).toBe("buyer");
  });

  it("maps Driver to driver category", () => {
    expect(staffCategoryForRole(Role.Driver)).toBe("driver");
  });

  it("maps WarehouseWorker to warehouse category", () => {
    expect(staffCategoryForRole(Role.WarehouseWorker)).toBe("warehouse");
  });

  it("maps Worker to worker category", () => {
    expect(staffCategoryForRole(Role.Worker)).toBe("worker");
  });

  it("falls back to support for non-staff roles", () => {
    expect(staffCategoryForRole(Role.Parent)).toBe("support");
    expect(staffCategoryForRole(Role.Student)).toBe("support");
  });
});

describe("Personnel model — expanded labels", () => {
  it("STAFF_CATEGORY_LABELS_FR covers all 8 categories", () => {
    expect(STAFF_CATEGORY_LABELS_FR.teacher).toBe("Enseignant");
    expect(STAFF_CATEGORY_LABELS_FR.administration).toBe("Administration");
    expect(STAFF_CATEGORY_LABELS_FR.support).toBe("Soutien");
    expect(STAFF_CATEGORY_LABELS_FR.maintenance).toBe("Maintenance");
    expect(STAFF_CATEGORY_LABELS_FR.driver).toBe("Chauffeur");
    expect(STAFF_CATEGORY_LABELS_FR.buyer).toBe("Acheteur");
    expect(STAFF_CATEGORY_LABELS_FR.warehouse).toBe("Magasinier");
    expect(STAFF_CATEGORY_LABELS_FR.worker).toBe("Ouvrier");
  });

  it("PERSONNEL_STATUS_LABELS_FR includes archived status", () => {
    expect(PERSONNEL_STATUS_LABELS_FR.active).toBe("Actif");
    expect(PERSONNEL_STATUS_LABELS_FR.on_leave).toBe("En congé");
    expect(PERSONNEL_STATUS_LABELS_FR.suspended).toBe("Suspendu");
    expect(PERSONNEL_STATUS_LABELS_FR.terminated).toBe("Licencié");
    expect(PERSONNEL_STATUS_LABELS_FR.archived).toBe("Archivé");
  });

  it("PAYROLL_METHOD_LABELS_FR covers all payment methods", () => {
    expect(PAYROLL_METHOD_LABELS_FR.cash).toBe("Espèces");
    expect(PAYROLL_METHOD_LABELS_FR.bank_transfer).toBe("Virement bancaire");
    expect(PAYROLL_METHOD_LABELS_FR.check).toBe("Chèque");
    expect(PAYROLL_METHOD_LABELS_FR.mobile_money).toBe("Mobile Money");
  });

  it("RELEVE_ACTIVITY_LABELS_FR includes task/delivery/warehouse activities", () => {
    expect(RELEVE_ACTIVITY_LABELS_FR.task).toBe("Tâche");
    expect(RELEVE_ACTIVITY_LABELS_FR.delivery).toBe("Livraison");
    expect(RELEVE_ACTIVITY_LABELS_FR.warehouse).toBe("Magasin");
    expect(RELEVE_ACTIVITY_LABELS_FR.course).toBe("Cours");
  });
});
