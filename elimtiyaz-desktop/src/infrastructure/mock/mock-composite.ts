/**
 * The mock-mode composite `Repositories` instance — the full in-memory
 * repository set, extracted here from `app/providers/repository-provider.tsx`
 * by T-470 (TEST-502 class b) to break a RUNTIME circular import.
 *
 * WHY THIS MODULE EXISTS:
 *   `infrastructure/supabase/supabase-repositories.ts` spreads this composite
 *   as the base it overrides with Supabase-backed slots. Before T-470 it
 *   value-imported the composite FROM THE APP-LAYER PROVIDER, creating the
 *   cycle
 *       supabase-repositories → repository-provider → supabase-repositories
 *   and the provider runs `selectDefaultRepositories()` at MODULE SCOPE —
 *   so any import chain that reached `supabase-repositories` first (e.g.
 *   `financial-realtime`, loaded by the t-390 suite) initialized the provider
 *   while `getSupabaseRepositories` was still unbound in the vite-node SSR
 *   module graph: `TypeError: getSupabaseRepositories is not a function`,
 *   at IMPORT time, with zero tests run.
 *
 *   Infrastructure must not depend on the app layer at runtime (the
 *   boundaries rule); the composite is mock-infrastructure, so it lives HERE.
 *   The `Repositories` TYPE still lives in the provider (the app-layer
 *   contract); this module imports it TYPE-ONLY — erased at runtime, so no
 *   cycle — and the provider re-exports the composite so every existing
 *   importer keeps working unchanged.
 */
import type { Repositories } from "../../app/providers/repository-provider";
import {
  mockAuthRepository,
  mockUserAccountRepository,
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
  mockDashboardLayoutRepository,
  mockPricingRepository,
  mockLedgerRepository,
  mockWorkflowRepository,
  mockWorkflowRunRepository,
  mockAIConfigRepository,
  mockBackupRepository,
  mockCalendarRepository,
  mockOverdueAlertGenerator,
  mockPromotionRepository,
  mockClassPlacementRepository,
  mockPromotionCycleRepository,
  mockReEnrollmentRepository,
  mockIdentityResolutionRepository,
  mockAcademicYearRepository,
  mockAcademicLevelRepository,
  mockStudentNarrativeRepository,
  mockClubRepository,
  mockPsychologyRepository,
  mockOrthophonieRepository,
  mockTeacherRepository,
} from "./mock-repositories";
import {
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
import {
  mockSupplierRepository,
  mockPurchaseRequestRepository,
  mockDeliveryRepository,
  mockInventoryRepository,
  mockWarehouseTaskRepository,
} from "./operations";
import { mockTimetableRepository } from "./repositories/timetable-repository";

export const mockRepositories: Repositories = {
  auth: mockAuthRepository,
  userAccounts: mockUserAccountRepository,
  parents: mockParentRepository,
  students: mockStudentRepository,
  classes: mockClassRepository,
  subjects: mockSubjectRepository,
  grades: mockGradeRepository,
  attendance: mockAttendanceRepository,
  homework: mockHomeworkRepository,
  promotion: mockPromotionRepository,
  // GRADE-103 (T-502): the year-keyed narrative store — the mock twin of
  // SupabaseStudentNarrativeRepository (migration 0148).
  studentNarratives: mockStudentNarrativeRepository,
  classPlacement: mockClassPlacementRepository,
  promotionCycles: mockPromotionCycleRepository,
  reEnrollment: mockReEnrollmentRepository,
  identityResolution: mockIdentityResolutionRepository,
  timetable: mockTimetableRepository,
  academicYears: mockAcademicYearRepository,
  academicLevels: mockAcademicLevelRepository,
  clubs: mockClubRepository,
  psychology: mockPsychologyRepository,
  orthophonie: mockOrthophonieRepository,
  teachers: mockTeacherRepository,
  payments: mockPaymentRepository,
  installments: mockInstallmentRepository,
  debt: mockDebtRepository,
  expenses: mockExpenseRepository,
  personnel: mockPersonnelRepository,
  releve: mockReleveRepository,
  audit: mockAuditRepository,
  notifications: mockNotificationRepository,
  dashboard: mockDashboardRepository,
  dashboardLayouts: mockDashboardLayoutRepository,
  pricing: mockPricingRepository,
  ledger: mockLedgerRepository,
  workflows: mockWorkflowRepository,
  workflowRuns: mockWorkflowRunRepository,
  aiConfig: mockAIConfigRepository,
  backups: mockBackupRepository,

  departments: mockDepartmentRepository,
  shifts: mockShiftRepository,
  schedules: mockScheduleRepository,
  tasks: mockTaskRepository,
  workforceAttendance: mockWorkforceAttendanceRepository,
  leaveRequests: mockLeaveRequestRepository,
  performanceReviews: mockPerformanceReviewRepository,
  chat: mockChatRepository,
  onboarding: mockOnboardingRepository,

  suppliers: mockSupplierRepository,
  purchaseRequests: mockPurchaseRequestRepository,
  deliveries: mockDeliveryRepository,
  inventory: mockInventoryRepository,
  warehouseTasks: mockWarehouseTaskRepository,

  calendar: mockCalendarRepository,
  overdueAlerts: mockOverdueAlertGenerator,
};
