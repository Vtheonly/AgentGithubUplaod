/**
 * Role boundary matrix tests (T-234 / RBAC-300 — 35th session).
 *
 * Pins the owner-mandated workspace boundaries:
 *
 *   ADMINISTRATIVE (SuperAdmin, FinancialOfficer, SupportStaff, Manager):
 *     main Dashboard + Finances + Pédagogie + CRM (Élèves & Parents).
 *     Clerks (SupportStaff) additionally manage classes + promotions
 *     (front-office duties: enrollment, class assignment, year-end).
 *
 *   OPERATIONAL (Teacher, Buyer, Driver, WarehouseWorker, Worker):
 *     locked OUT of the main Dashboard, Finances, Pédagogie, CRM in the
 *     sidebar (padlock via the missing ViewRoster/ViewAcademics/
 *     ViewFinancials permissions) and redirected away from their routes.
 *     They work strictly from their role dashboard INSIDE Personnel.
 *
 *   TEACHER SCOPE: retains EnterGrades + RollCall + AssignHomework (exercised
 *     ONLY inside the Personnel workspace, T-235) — but never the module
 *     entry permissions.
 */
import { describe, it, expect } from "vitest";
import { Permission, DEFAULT_ROLE_PERMISSIONS } from "../../core/rbac/permissions";
import { Role } from "../../core/rbac/roles";

/** The three module-entry permissions a sidebar section unlocks. */
const CRM_ENTRY = Permission.ViewRoster;
const ACADEMICS_ENTRY = Permission.ViewAcademics;
const FINANCIALS_ENTRY = Permission.ViewFinancials;
const DASHBOARD_ENTRY_ROLES: ReadonlySet<Role> = new Set([
  Role.SuperAdmin,
  Role.FinancialOfficer,
  Role.SupportStaff,
  Role.Manager,
]);

const OPERATIONAL_ROLES: readonly Role[] = [
  Role.Teacher,
  Role.Buyer,
  Role.Driver,
  Role.WarehouseWorker,
  Role.Worker,
];

const ADMINISTRATIVE_ROLES: readonly Role[] = [
  Role.SuperAdmin,
  Role.FinancialOfficer,
  Role.SupportStaff,
  Role.Manager,
];

describe("RBAC-300 — role boundary matrix (owner mandate, 35th session)", () => {
  describe("Operational staff are locked out of every administrative module entry", () => {
    for (const role of OPERATIONAL_ROLES) {
      it(`${role}: no CRM / Pédagogie / Finances entry permission`, () => {
        const perms = DEFAULT_ROLE_PERMISSIONS[role];
        expect(perms.has(CRM_ENTRY)).toBe(false);
        expect(perms.has(ACADEMICS_ENTRY)).toBe(false);
        expect(perms.has(FINANCIALS_ENTRY)).toBe(false);
      });

      it(`${role}: not in the dashboard-role set`, () => {
        expect(DASHBOARD_ENTRY_ROLES.has(role)).toBe(false);
      });

      it(`${role}: retains the Personnel entry permission (their workspace)`, () => {
        const perms = DEFAULT_ROLE_PERMISSIONS[role];
        expect(perms.has(Permission.ViewPersonnel)).toBe(true);
      });
    }
  });

  describe("Administrative staff retain full module access", () => {
    for (const role of ADMINISTRATIVE_ROLES) {
      it(`${role}: CRM + Pédagogie entry permissions`, () => {
        const perms = DEFAULT_ROLE_PERMISSIONS[role];
        expect(perms.has(CRM_ENTRY)).toBe(true);
        expect(perms.has(ACADEMICS_ENTRY)).toBe(true);
      });

      it(`${role}: in the dashboard-role set`, () => {
        expect(DASHBOARD_ENTRY_ROLES.has(role)).toBe(true);
      });
    }

    it("financial-data roles are exactly the server contract (super_admin / financial_officer / support_staff)", () => {
      // Mirrors the 0019 payments_select RLS: managers do NOT read
      // financial rows server-side (Android's VIEW_FINANCIALS grant for
      // manager is a registered cross-platform divergence — T-237).
      expect(DEFAULT_ROLE_PERMISSIONS[Role.SuperAdmin].has(FINANCIALS_ENTRY)).toBe(true);
      expect(DEFAULT_ROLE_PERMISSIONS[Role.FinancialOfficer].has(FINANCIALS_ENTRY)).toBe(true);
      expect(DEFAULT_ROLE_PERMISSIONS[Role.SupportStaff].has(FINANCIALS_ENTRY)).toBe(true);
      expect(DEFAULT_ROLE_PERMISSIONS[Role.Manager].has(FINANCIALS_ENTRY)).toBe(false);
    });
  });

  describe("Teacher scope — pedagogical actions live INSIDE Personnel only", () => {
    it("teacher keeps the action permissions (grades, roll-call, homework)", () => {
      const perms = DEFAULT_ROLE_PERMISSIONS[Role.Teacher];
      expect(perms.has(Permission.EnterGrades)).toBe(true);
      expect(perms.has(Permission.RollCall)).toBe(true);
      expect(perms.has(Permission.AssignHomework)).toBe(true);
    });

    it("teacher CANNOT edit students, manage classes, or promote (registry duties)", () => {
      const perms = DEFAULT_ROLE_PERMISSIONS[Role.Teacher];
      expect(perms.has(Permission.EditStudent)).toBe(false);
      expect(perms.has(Permission.CreateStudent)).toBe(false);
      expect(perms.has(Permission.ManageClasses)).toBe(false);
      expect(perms.has(Permission.PromoteStudent)).toBe(false);
      expect(perms.has(Permission.ManageSubjects)).toBe(false);
      expect(perms.has(Permission.ManageSchoolYears)).toBe(false);
    });

    it("teacher CANNOT see financial data of any kind", () => {
      const perms = DEFAULT_ROLE_PERMISSIONS[Role.Teacher];
      expect(perms.has(Permission.ViewFinancials)).toBe(false);
      expect(perms.has(Permission.ViewDebt)).toBe(false);
      expect(perms.has(Permission.CollectPayment)).toBe(false);
      expect(perms.has(Permission.GenerateReceipt)).toBe(false);
    });
  });

  describe("Clerk (SupportStaff) authority — front-office duties", () => {
    it("clerk can open the financial dashboard and see payment logs", () => {
      expect(DEFAULT_ROLE_PERMISSIONS[Role.SupportStaff].has(Permission.ViewFinancials)).toBe(true);
    });

    it("clerk can manage classes (assign students) and run promotions", () => {
      const perms = DEFAULT_ROLE_PERMISSIONS[Role.SupportStaff];
      expect(perms.has(Permission.ManageClasses)).toBe(true);
      expect(perms.has(Permission.PromoteStudent)).toBe(true);
    });

    it("clerk keeps the CRM creation duties (parents + students)", () => {
      const perms = DEFAULT_ROLE_PERMISSIONS[Role.SupportStaff];
      expect(perms.has(Permission.CreateParent)).toBe(true);
      expect(perms.has(Permission.EditParent)).toBe(true);
      expect(perms.has(Permission.CreateStudent)).toBe(true);
      expect(perms.has(Permission.EditStudent)).toBe(true);
    });
  });

  describe("Regression — other roles unchanged by the boundary flip", () => {
    it("FinancialOfficer keeps financial + expense authority", () => {
      const perms = DEFAULT_ROLE_PERMISSIONS[Role.FinancialOfficer];
      expect(perms.has(Permission.CollectPayment)).toBe(true);
      expect(perms.has(Permission.RefundPayment)).toBe(true);
      expect(perms.has(Permission.ApproveExpense)).toBe(true);
    });

    it("Manager keeps supervisory authority (tasks, schedules, approvals)", () => {
      const perms = DEFAULT_ROLE_PERMISSIONS[Role.Manager];
      expect(perms.has(Permission.ManageTasks)).toBe(true);
      expect(perms.has(Permission.ManageSchedules)).toBe(true);
      expect(perms.has(Permission.ApproveRequests)).toBe(true);
    });

    it("Buyer keeps procurement scope (purchase requests + suppliers)", () => {
      const perms = DEFAULT_ROLE_PERMISSIONS[Role.Buyer];
      expect(perms.has(Permission.ManagePurchaseRequests)).toBe(true);
      expect(perms.has(Permission.ManageSuppliers)).toBe(true);
    });

    it("Driver keeps delivery scope", () => {
      expect(DEFAULT_ROLE_PERMISSIONS[Role.Driver].has(Permission.ManageDeliveries)).toBe(true);
    });

    it("WarehouseWorker keeps inventory scope", () => {
      expect(DEFAULT_ROLE_PERMISSIONS[Role.WarehouseWorker].has(Permission.ManageInventory)).toBe(true);
    });

    it("Parent and Student remain empty (portal-only roles)", () => {
      expect(DEFAULT_ROLE_PERMISSIONS[Role.Parent].size).toBe(0);
      expect(DEFAULT_ROLE_PERMISSIONS[Role.Student].size).toBe(0);
    });
  });
});
