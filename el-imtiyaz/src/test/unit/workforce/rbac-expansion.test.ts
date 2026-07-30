/**
 * RBAC expansion tests — iteration 8.
 *
 * Verifies the 5 new workforce roles (Manager, Buyer, Driver,
 * WarehouseWorker, Worker) and their default permission sets behave
 * according to the spec.
 */
import { describe, it, expect } from "vitest";
import { Role, ROLE_LABELS_FR, ROLE_LABELS_AR, ROLE_DESCRIPTIONS_FR, STAFF_ROLES, isStaff, ADMINISTRATIVE_ROLES, SUPERVISORY_ROLES, OPERATIONAL_ROLES } from "../../../core/rbac/roles";
import { Permission, PERMISSION_LABELS_FR, DEFAULT_ROLE_PERMISSIONS } from "../../../core/rbac/permissions";

describe("Iteration 8 — RBAC role expansion", () => {
  it("defines the 5 new workforce roles", () => {
    expect(Role.Manager).toBe("manager");
    expect(Role.Buyer).toBe("buyer");
    expect(Role.Driver).toBe("driver");
    expect(Role.WarehouseWorker).toBe("warehouse_worker");
    expect(Role.Worker).toBe("worker");
  });

  it("preserves the original 6 roles", () => {
    expect(Role.SuperAdmin).toBe("super_admin");
    expect(Role.FinancialOfficer).toBe("financial_officer");
    expect(Role.Teacher).toBe("teacher");
    expect(Role.SupportStaff).toBe("support_staff");
    expect(Role.Parent).toBe("parent");
    expect(Role.Student).toBe("student");
  });

  it("provides French labels for every role", () => {
    const allRoles = Object.values(Role);
    for (const r of allRoles) {
      expect(ROLE_LABELS_FR[r]).toBeDefined();
      expect(typeof ROLE_LABELS_FR[r]).toBe("string");
      expect(ROLE_LABELS_FR[r].length).toBeGreaterThan(0);
    }
  });

  it("provides Arabic labels for every role", () => {
    const allRoles = Object.values(Role);
    for (const r of allRoles) {
      expect(ROLE_LABELS_AR[r]).toBeDefined();
    }
  });

  it("provides French descriptions for every role", () => {
    const allRoles = Object.values(Role);
    for (const r of allRoles) {
      expect(ROLE_DESCRIPTIONS_FR[r]).toBeDefined();
      expect(ROLE_DESCRIPTIONS_FR[r].length).toBeGreaterThan(20);
    }
  });

  it("classifies staff vs non-staff roles correctly", () => {
    expect(isStaff(Role.SuperAdmin)).toBe(true);
    expect(isStaff(Role.Manager)).toBe(true);
    expect(isStaff(Role.Buyer)).toBe(true);
    expect(isStaff(Role.Driver)).toBe(true);
    expect(isStaff(Role.WarehouseWorker)).toBe(true);
    expect(isStaff(Role.Worker)).toBe(true);
    expect(isStaff(Role.Teacher)).toBe(true);
    expect(isStaff(Role.Parent)).toBe(false);
    expect(isStaff(Role.Student)).toBe(false);
  });

  it("STAFF_ROLES contains exactly 9 staff roles", () => {
    expect(STAFF_ROLES.size).toBe(9);
  });

  it("ADMINISTRATIVE_ROLES includes SuperAdmin and Manager only", () => {
    expect(ADMINISTRATIVE_ROLES.has(Role.SuperAdmin)).toBe(true);
    expect(ADMINISTRATIVE_ROLES.has(Role.Manager)).toBe(true);
    expect(ADMINISTRATIVE_ROLES.has(Role.Teacher)).toBe(false);
    expect(ADMINISTRATIVE_ROLES.size).toBe(2);
  });

  it("SUPERVISORY_ROLES includes SuperAdmin and Manager", () => {
    expect(SUPERVISORY_ROLES.has(Role.SuperAdmin)).toBe(true);
    expect(SUPERVISORY_ROLES.has(Role.Manager)).toBe(true);
  });

  it("OPERATIONAL_ROLES includes the 5 workforce roles + Teacher + SupportStaff", () => {
    expect(OPERATIONAL_ROLES.has(Role.Teacher)).toBe(true);
    expect(OPERATIONAL_ROLES.has(Role.Buyer)).toBe(true);
    expect(OPERATIONAL_ROLES.has(Role.Driver)).toBe(true);
    expect(OPERATIONAL_ROLES.has(Role.WarehouseWorker)).toBe(true);
    expect(OPERATIONAL_ROLES.has(Role.Worker)).toBe(true);
    expect(OPERATIONAL_ROLES.has(Role.SupportStaff)).toBe(true);
    expect(OPERATIONAL_ROLES.has(Role.SuperAdmin)).toBe(false);
  });
});

describe("Iteration 8 — RBAC permission expansion", () => {
  it("defines the new workforce permissions", () => {
    expect(Permission.ViewDepartments).toBe("view_departments");
    expect(Permission.ManageDepartments).toBe("manage_departments");
    expect(Permission.ManageEmployeeProfiles).toBe("manage_employee_profiles");
    expect(Permission.ViewSalary).toBe("view_salary");
    expect(Permission.ManageSchedules).toBe("manage_schedules");
    expect(Permission.ViewAttendance).toBe("view_attendance");
    expect(Permission.ClockInOut).toBe("clock_in_out");
    expect(Permission.ApproveRequests).toBe("approve_requests");
    expect(Permission.SubmitRequests).toBe("submit_requests");
    expect(Permission.ManageTasks).toBe("manage_tasks");
    expect(Permission.ViewTasks).toBe("view_tasks");
    expect(Permission.UpdateTaskStatus).toBe("update_task_status");
    expect(Permission.ViewPerformance).toBe("view_performance");
    expect(Permission.ManagePerformance).toBe("manage_performance");
    expect(Permission.UseChat).toBe("use_chat");
    expect(Permission.ManageChatChannels).toBe("manage_chat_channels");
    expect(Permission.ManagePurchaseRequests).toBe("manage_purchase_requests");
    expect(Permission.ManageSuppliers).toBe("manage_suppliers");
    expect(Permission.ManageDeliveries).toBe("manage_deliveries");
    expect(Permission.ManageInventory).toBe("manage_inventory");
    expect(Permission.ManageOnboarding).toBe("manage_onboarding");
    expect(Permission.ViewWorkforceReports).toBe("view_workforce_reports");
  });

  it("provides French labels for every permission", () => {
    const allPerms = Object.values(Permission);
    for (const p of allPerms) {
      expect(PERMISSION_LABELS_FR[p]).toBeDefined();
      expect(typeof PERMISSION_LABELS_FR[p]).toBe("string");
    }
  });

  it("SuperAdmin has every permission (unrestricted)", () => {
    const allPerms = new Set(Object.values(Permission));
    const adminPerms = DEFAULT_ROLE_PERMISSIONS[Role.SuperAdmin];
    expect(adminPerms.size).toBe(allPerms.size);
    for (const p of allPerms) {
      expect(adminPerms.has(p)).toBe(true);
    }
  });

  it("Manager has task management + approval permissions", () => {
    const perms = DEFAULT_ROLE_PERMISSIONS[Role.Manager];
    expect(perms.has(Permission.ManageTasks)).toBe(true);
    expect(perms.has(Permission.ViewTasks)).toBe(true);
    expect(perms.has(Permission.ApproveRequests)).toBe(true);
    expect(perms.has(Permission.ViewAttendance)).toBe(true);
    expect(perms.has(Permission.ViewPerformance)).toBe(true);
    expect(perms.has(Permission.ManageSchedules)).toBe(true);
    expect(perms.has(Permission.UseChat)).toBe(true);
    expect(perms.has(Permission.ManageChatChannels)).toBe(true);
    expect(perms.has(Permission.ViewWorkforceReports)).toBe(true);
    expect(perms.has(Permission.ClockInOut)).toBe(true);
  });

  it("Manager does NOT have unrestricted admin permissions", () => {
    const perms = DEFAULT_ROLE_PERMISSIONS[Role.Manager];
    expect(perms.has(Permission.ManageEmployeeProfiles)).toBe(false);
    expect(perms.has(Permission.ManageOnboarding)).toBe(false);
    expect(perms.has(Permission.ManageBackups)).toBe(false);
    expect(perms.has(Permission.ManagePricing)).toBe(false);
  });

  it("Buyer has purchase + supplier permissions", () => {
    const perms = DEFAULT_ROLE_PERMISSIONS[Role.Buyer];
    expect(perms.has(Permission.ManagePurchaseRequests)).toBe(true);
    expect(perms.has(Permission.ManageSuppliers)).toBe(true);
    expect(perms.has(Permission.UseChat)).toBe(true);
    expect(perms.has(Permission.ClockInOut)).toBe(true);
    expect(perms.has(Permission.SubmitRequests)).toBe(true);
    expect(perms.has(Permission.SubmitExpense)).toBe(true);
  });

  it("Driver has delivery + driver-mode permissions", () => {
    const perms = DEFAULT_ROLE_PERMISSIONS[Role.Driver];
    expect(perms.has(Permission.ManageDeliveries)).toBe(true);
    expect(perms.has(Permission.AccessDriverMode)).toBe(true);
    expect(perms.has(Permission.UseChat)).toBe(true);
    expect(perms.has(Permission.ClockInOut)).toBe(true);
    expect(perms.has(Permission.SubmitRequests)).toBe(true);
  });

  it("WarehouseWorker has inventory permissions", () => {
    const perms = DEFAULT_ROLE_PERMISSIONS[Role.WarehouseWorker];
    expect(perms.has(Permission.ManageInventory)).toBe(true);
    expect(perms.has(Permission.UseChat)).toBe(true);
    expect(perms.has(Permission.ClockInOut)).toBe(true);
    expect(perms.has(Permission.SubmitRequests)).toBe(true);
  });

  it("Worker has task + clock-in + chat permissions", () => {
    const perms = DEFAULT_ROLE_PERMISSIONS[Role.Worker];
    expect(perms.has(Permission.ViewTasks)).toBe(true);
    expect(perms.has(Permission.UpdateTaskStatus)).toBe(true);
    expect(perms.has(Permission.UseChat)).toBe(true);
    expect(perms.has(Permission.ClockInOut)).toBe(true);
    expect(perms.has(Permission.SubmitRequests)).toBe(true);
  });

  it("Worker does NOT have management permissions", () => {
    const perms = DEFAULT_ROLE_PERMISSIONS[Role.Worker];
    expect(perms.has(Permission.ManageTasks)).toBe(false);
    expect(perms.has(Permission.ManagePersonnel)).toBe(false);
    expect(perms.has(Permission.ManageInventory)).toBe(false);
    expect(perms.has(Permission.ManageDeliveries)).toBe(false);
  });

  it("Teacher has the new workforce permissions for teaching from Personnel", () => {
    const perms = DEFAULT_ROLE_PERMISSIONS[Role.Teacher];
    expect(perms.has(Permission.ViewTasks)).toBe(true);
    expect(perms.has(Permission.UpdateTaskStatus)).toBe(true);
    expect(perms.has(Permission.ViewAttendance)).toBe(true);
    expect(perms.has(Permission.ClockInOut)).toBe(true);
    expect(perms.has(Permission.SubmitRequests)).toBe(true);
    expect(perms.has(Permission.UseChat)).toBe(true);
  });

  it("Parent and Student have no permissions (web portal only)", () => {
    expect(DEFAULT_ROLE_PERMISSIONS[Role.Parent].size).toBe(0);
    expect(DEFAULT_ROLE_PERMISSIONS[Role.Student].size).toBe(0);
  });

  it("DEFAULT_ROLE_PERMISSIONS covers every role", () => {
    const allRoles = Object.values(Role);
    for (const r of allRoles) {
      expect(DEFAULT_ROLE_PERMISSIONS[r]).toBeDefined();
      expect(DEFAULT_ROLE_PERMISSIONS[r] instanceof Set).toBe(true);
    }
  });
});
