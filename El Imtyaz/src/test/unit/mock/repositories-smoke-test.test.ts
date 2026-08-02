/**
 * Smoke tests for the iteration 2 mock repository split.
 *
 * Verifies that every singleton exported from `mock-repositories.ts` is
 * defined and has the expected shape. This catches any wiring issue from
 * the per-entity file split (missing re-exports, circular imports, etc.).
 */
import { describe, it, expect } from "vitest";
import {
  mockAuthRepository,
  mockParentRepository,
  mockStudentRepository,
  mockClassRepository,
  mockSubjectRepository,
  mockGradeRepository,
  mockAttendanceRepository,
  mockHomeworkRepository,
  mockPaymentRepository,
  mockInstallmentRepository,
  mockDebtRepository,
  mockExpenseRepository,
  mockPersonnelRepository,
  mockReleveRepository,
  mockAuditRepository,
  mockNotificationRepository,
  mockDashboardRepository,
  mockPricingRepository,
  mockLedgerRepository,
  mockWorkflowRepository,
  mockWorkflowRunRepository,
  mockAIConfigRepository,
  mockBackupRepository,
  mockCalendarRepository,
  mockOverdueAlertGenerator,
  mockDepartmentRepository,
  mockShiftRepository,
  mockScheduleRepository,
  mockTaskRepository,
  mockWorkforceAttendanceRepository,
  mockLeaveRequestRepository,
  mockPerformanceReviewRepository,
  mockChatRepository,
  mockOnboardingRepository,
  mockSupplierRepository,
  mockPurchaseRequestRepository,
  mockDeliveryRepository,
  mockInventoryRepository,
  mockWarehouseTaskRepository,
} from "@/infrastructure/mock/mock-repositories";

describe("iteration 2 — mock repository split smoke test", () => {
  it("exports all 25 core mock singletons as defined objects", () => {
    const core = {
      mockAuthRepository,
      mockParentRepository,
      mockStudentRepository,
      mockClassRepository,
      mockSubjectRepository,
      mockGradeRepository,
      mockAttendanceRepository,
      mockHomeworkRepository,
      mockPaymentRepository,
      mockInstallmentRepository,
      mockDebtRepository,
      mockExpenseRepository,
      mockPersonnelRepository,
      mockReleveRepository,
      mockAuditRepository,
      mockNotificationRepository,
      mockDashboardRepository,
      mockPricingRepository,
      mockLedgerRepository,
      mockWorkflowRepository,
      mockWorkflowRunRepository,
      mockAIConfigRepository,
      mockBackupRepository,
      mockCalendarRepository,
      mockOverdueAlertGenerator,
    };
    for (const [name, value] of Object.entries(core)) {
      expect(value, `${name} should be defined`).toBeDefined();
      expect(typeof value, `${name} should be an object`).toBe("object");
    }
  });

  it("exports all 9 workforce mock singletons as defined objects", () => {
    const workforce = {
      mockDepartmentRepository,
      mockShiftRepository,
      mockScheduleRepository,
      mockTaskRepository,
      mockWorkforceAttendanceRepository,
      mockLeaveRequestRepository,
      mockPerformanceReviewRepository,
      mockChatRepository,
      mockOnboardingRepository,
    };
    for (const [name, value] of Object.entries(workforce)) {
      expect(value, `${name} should be defined`).toBeDefined();
      expect(typeof value, `${name} should be an object`).toBe("object");
    }
  });

  it("exports all 5 operations mock singletons as defined objects", () => {
    const operations = {
      mockSupplierRepository,
      mockPurchaseRequestRepository,
      mockDeliveryRepository,
      mockInventoryRepository,
      mockWarehouseTaskRepository,
    };
    for (const [name, value] of Object.entries(operations)) {
      expect(value, `${name} should be defined`).toBeDefined();
      expect(typeof value, `${name} should be an object`).toBe("object");
    }
  });

  it("core repositories expose the expected methods (sanity check)", () => {
    // Spot-check a few methods to confirm the singletons are correctly
    // wired instances (not undefined or wrong-shaped objects).
    expect(typeof mockAuthRepository.signIn).toBe("function");
    expect(typeof mockParentRepository.search).toBe("function");
    expect(typeof mockPaymentRepository.collect).toBe("function");
    expect(typeof mockLedgerRepository.reconcile).toBe("function");
    expect(typeof mockDashboardRepository.kpis).toBe("function");
    expect(typeof mockBackupRepository.runBackup).toBe("function");
    expect(typeof mockOverdueAlertGenerator.run).toBe("function");
  });

  it("workforce repositories expose the expected methods", () => {
    expect(typeof mockDepartmentRepository.observe).toBe("function");
    expect(typeof mockTaskRepository.observe).toBe("function");
    expect(typeof mockChatRepository.observeChannels).toBe("function");
  });

  it("operations repositories expose the expected methods", () => {
    expect(typeof mockSupplierRepository.observe).toBe("function");
    expect(typeof mockInventoryRepository.observeItems).toBe("function");
    expect(typeof mockWarehouseTaskRepository.observeReceipts).toBe("function");
  });

  it("the shared mock store is initialized with seed data", async () => {
    // Verify the store has seed data by checking that observable streams
    // return non-empty arrays.
    const parentsResult = await mockParentRepository.search("");
    expect(parentsResult.ok).toBe(true);
    if (parentsResult.ok) {
      expect(parentsResult.value.length).toBeGreaterThan(0);
    }
    const dashboardResult = await mockDashboardRepository.kpis();
    expect(dashboardResult.ok).toBe(true);
    if (dashboardResult.ok) {
      expect(dashboardResult.value.totalStudents).toBeGreaterThan(0);
      expect(dashboardResult.value.totalParents).toBeGreaterThan(0);
    }
  });
});
