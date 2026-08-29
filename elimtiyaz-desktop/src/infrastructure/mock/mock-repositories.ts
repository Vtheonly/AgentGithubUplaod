/**
 * Mock repository implementations — in-memory, reactive (via SubjectBehavior),
 * seeded with the data from seed-data.ts.
 */
import { appendAudit } from "./repositories/mock-store";
import { setWorkforceAuditSink } from "./workforce";
import { setOperationsAuditSink } from "./operations";

// Re-export all singleton repository instances.
export { mockAuthRepository } from "./repositories/auth-repository";
export { mockUserAccountRepository } from "./repositories/user-account-repository";
export { mockParentRepository } from "./repositories/parent-repository";
export { mockStudentRepository } from "./repositories/student-repository";
export {
  mockClassRepository,
  mockSubjectRepository,
  mockGradeRepository,
  mockAttendanceRepository,
  mockHomeworkRepository,
  mockPromotionRepository,
} from "./repositories/academic-repository";
export { mockAcademicYearRepository } from "./repositories/academic-year-repository";
export { mockClubRepository } from "./repositories/club-repository";
export {
  mockPsychologyRepository,
  mockOrthophonieRepository,
} from "./repositories/therapy-repository";
export { mockTeacherRepository } from "./repositories/teacher-repository";
export {
  mockPaymentRepository,
  mockInstallmentRepository,
  mockDebtRepository,
  mockExpenseRepository,
} from "./repositories/financial-repository";
export {
  mockPersonnelRepository,
  mockReleveRepository,
  mockAuditRepository,
} from "./repositories/personnel-audit-repository";
export {
  mockNotificationRepository,
  mockOverdueAlertGenerator,
} from "./repositories/notification-alerts-repository";
export { mockDashboardRepository } from "./repositories/dashboard-repository";
export { mockPricingRepository } from "./repositories/pricing-repository";
export { mockLedgerRepository } from "./repositories/ledger-repository";
export {
  mockWorkflowRepository,
  mockWorkflowRunRepository,
} from "./repositories/workflow-repository";
export { mockAIConfigRepository } from "./repositories/ai-config-repository";
export { mockBackupRepository } from "./repositories/backup-repository";
export { mockCalendarRepository } from "./repositories/calendar-repository";

// Re-export workforce singletons
export {
  mockDepartmentRepository,
  mockShiftRepository,
  mockScheduleRepository,
  mockTaskRepository,
  mockWorkforceAttendanceRepository,
  mockLeaveRequestRepository,
  mockPerformanceReviewRepository,
  mockChatRepository,
  mockOnboardingRepository,
} from "./workforce";

// Re-export operations singletons
export {
  mockSupplierRepository,
  mockPurchaseRequestRepository,
  mockDeliveryRepository,
  mockInventoryRepository,
  mockWarehouseTaskRepository,
} from "./operations";

// ---------------------------------------------------------------------------
// Audit sink wiring
// ---------------------------------------------------------------------------
setWorkforceAuditSink((input) => {
  appendAudit({
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    actorId: input.actorId ?? "system",
    actorName: input.actorName ?? "Système",
    diff: input.diff ?? null,
    note: input.note ?? null,
  });
});

setOperationsAuditSink((input) => {
  appendAudit({
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    actorId: input.actorId ?? "system",
    actorName: input.actorName ?? "Système",
    diff: input.diff ?? null,
    note: input.note ?? null,
  });
});
