/**
 * Mock repository implementations — in-memory, reactive (via SubjectBehavior),
 * seeded with the data from seed-data.ts.
 *
 * ---------------------------------------------------------------------------
 * REFACTOR NOTE (iteration 2):
 * The implementation has been split into per-entity / per-domain modules
 * under `./repositories/`. This file is now a thin barrel that:
 *   1. Re-exports all the singleton repository instances.
 *   2. Wires the workforce + operations audit sinks so they append to the
 *      same in-memory audit log used by the rest of the app.
 *
 * The shared `MockStore`, `appendAudit`, `delay`, and `nowIso` helpers live
 * in `./repositories/mock-store.ts`. Each repository file imports what it
 * needs from there.
 *
 * Backwards compatibility: all existing imports from
 * `@/infrastructure/mock/mock-repositories` continue to work unchanged.
 * ---------------------------------------------------------------------------
 */
import { appendAudit } from "./repositories/mock-store";
import { setWorkforceAuditSink } from "./workforce";
import { setOperationsAuditSink } from "./operations";

// Re-export all singleton repository instances.
export { mockAuthRepository } from "./repositories/auth-repository";
export { mockParentRepository } from "./repositories/parent-repository";
export { mockStudentRepository } from "./repositories/student-repository";
export {
  mockClassRepository,
  mockSubjectRepository,
  mockGradeRepository,
  mockAttendanceRepository,
  mockHomeworkRepository,
} from "./repositories/academic-repository";
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

// Re-export workforce singletons (kept in their own subdirectory).
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

// Re-export operations singletons (kept in their own subdirectory).
export {
  mockSupplierRepository,
  mockPurchaseRequestRepository,
  mockDeliveryRepository,
  mockInventoryRepository,
  mockWarehouseTaskRepository,
} from "./operations";

// ---------------------------------------------------------------------------
// Audit sink wiring — connects the workforce + operations audit emitters to
// the main in-memory audit log. This MUST run at module load time so the
// sinks are registered before any workforce/operations mutation occurs.
// ---------------------------------------------------------------------------

// Iteration 8 — wire the workforce audit sink so workforce repositories can
// append to the same in-memory audit log used by the rest of the app.
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

// Iteration 9 — wire the operations audit sink so the new operations
// repositories (suppliers, purchase requests, deliveries, inventory) share
// the same audit trail as the rest of the app.
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
