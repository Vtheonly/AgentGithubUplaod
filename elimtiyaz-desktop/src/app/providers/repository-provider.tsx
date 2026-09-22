// ============================================================================
// FILE: src/app/providers/repository-provider.tsx
// ============================================================================
import { createContext, useContext, type ReactNode } from "react";
import { getSupabaseRepositories } from "../../infrastructure/supabase/supabase-repositories";
import {
  isSupabaseConfigured,
  useSupabase,
} from "../../infrastructure/supabase/supabase-client";
import type {
  AuthRepository,
  UserAccountRepository,
  ParentRepository,
  StudentRepository,
  ClassRepository,
  SubjectRepository,
  GradeRepository,
  AttendanceRepository,
  HomeworkRepository,
  PaymentRepository,
  InstallmentRepository,
  DebtRepository,
  ExpenseRepository,
  PersonnelRepository,
  ReleveRepository,
  AuditRepository,
  NotificationRepository,
  DashboardRepository,
  PricingRepository,
  LedgerRepository,
  WorkflowRepository,
  WorkflowRunRepository,
  AIConfigRepository,
  BackupRepository,
  CalendarRepository,
  OverdueAlertGenerator,
} from "../../domain/repository/repository";
import type {
  PromotionRepository,
  AcademicYearRepository,
  AcademicLevelRepository,
  ClassPlacementRepository,
  PromotionCycleRepository,
} from "../../domain/repository/academic-repository";
import type { ClubRepository } from "../../domain/repository/club-repository";
import type {
  PsychologyRepository,
  OrthophonieRepository,
} from "../../domain/repository/therapy-repository";
import type { TeacherRepository } from "../../domain/repository/teacher-repository";
import type {
  DepartmentRepository,
  ShiftRepository,
  ScheduleRepository,
  TaskRepository,
  LeaveRequestRepository,
  PerformanceReviewRepository,
  ChatRepository,
  OnboardingRepository,
  // T-217: aliased — THREE interfaces named AttendanceRepository exist in the
  // domain (workforce: observeByPersonnel/observeByDate/recordEvent; the
  // academic + core ones cover STUDENT attendance: observeByClass/
  // recordRollCall). The workforceAttendance slot takes the workforce one.
  AttendanceRepository as WorkforceAttendanceRepository,
} from "../../domain/repository/workforce-repository";
import type {
  SupplierRepository,
  PurchaseRequestRepository,
  DeliveryRepository,
  InventoryRepository,
  WarehouseTaskRepository,
} from "../../domain/repository/operations-repository";

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
  mockAcademicYearRepository,
  mockAcademicLevelRepository,
  mockClubRepository,
  mockPsychologyRepository,
  mockOrthophonieRepository,
  mockTeacherRepository,
} from "../../infrastructure/mock/mock-repositories";
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
} from "../../infrastructure/mock/workforce";
import {
  mockSupplierRepository,
  mockPurchaseRequestRepository,
  mockDeliveryRepository,
  mockInventoryRepository,
  mockWarehouseTaskRepository,
} from "../../infrastructure/mock/operations";
import { mockTimetableRepository } from "../../infrastructure/mock/repositories/timetable-repository";
import type { TimetableRepository } from "../../domain/repository/timetable-repository";

export interface Repositories {
  readonly auth: AuthRepository;
  readonly userAccounts: UserAccountRepository;
  readonly parents: ParentRepository;
  readonly students: StudentRepository;
  readonly classes: ClassRepository;
  readonly subjects: SubjectRepository;
  readonly grades: GradeRepository;
  readonly attendance: AttendanceRepository;
  readonly homework: HomeworkRepository;
  readonly promotion: PromotionRepository;
  /** T-370 (ACAD-500): the atomic Class Formation & Placement finalize. */
  readonly classPlacement: ClassPlacementRepository;
  /** T-403 (0108): the human-in-the-loop promotion-cycle workflow. */
  readonly promotionCycles: PromotionCycleRepository;
  /** T-404 (0109/0110): the canonical Automatic Timetable repository. */
  readonly timetable: TimetableRepository;
  readonly academicYears: AcademicYearRepository;
  /** T-407 (ACAD-506): the academic_levels catalog ladder — resolves
   * grade_code → the REAL level uuid (classes.academic_level_id) that the
   * class-creation dialog previously faked with a mock-era `al-<code>` id. */
  readonly academicLevels: AcademicLevelRepository;
  readonly clubs: ClubRepository;
  readonly psychology: PsychologyRepository;
  readonly orthophonie: OrthophonieRepository;
  readonly teachers: TeacherRepository;
  readonly payments: PaymentRepository;
  readonly installments: InstallmentRepository;
  readonly debt: DebtRepository;
  readonly expenses: ExpenseRepository;
  readonly personnel: PersonnelRepository;
  readonly releve: ReleveRepository;
  readonly audit: AuditRepository;
  readonly notifications: NotificationRepository;
  readonly dashboard: DashboardRepository;
  readonly pricing: PricingRepository;
  readonly ledger: LedgerRepository;
  readonly workflows: WorkflowRepository;
  readonly workflowRuns: WorkflowRunRepository;
  readonly aiConfig: AIConfigRepository;
  readonly backups: BackupRepository;

  readonly departments: DepartmentRepository;
  readonly shifts: ShiftRepository;
  readonly schedules: ScheduleRepository;
  readonly tasks: TaskRepository;
  // T-217: the interface type replaces `typeof mockWorkforceAttendanceRepository`
  // (the mock structurally satisfies the workforce AttendanceRepository incl.
  // latestFor). NOTE: NOT the academic AttendanceRepository (student
  // attendance — the `attendance` slot's type).
  readonly workforceAttendance: WorkforceAttendanceRepository;
  readonly leaveRequests: LeaveRequestRepository;
  readonly performanceReviews: PerformanceReviewRepository;
  readonly chat: ChatRepository;
  readonly onboarding: OnboardingRepository;

  readonly suppliers: SupplierRepository;
  readonly purchaseRequests: PurchaseRequestRepository;
  readonly deliveries: DeliveryRepository;
  readonly inventory: InventoryRepository;
  readonly warehouseTasks: WarehouseTaskRepository;

  readonly calendar: CalendarRepository;
  readonly overdueAlerts: OverdueAlertGenerator;
}

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
  classPlacement: mockClassPlacementRepository,
  promotionCycles: mockPromotionCycleRepository,
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

const RepositoryContext = createContext<Repositories>(mockRepositories);

function selectDefaultRepositories(): Repositories {
  if (!useSupabase) return mockRepositories;

  if (!isSupabaseConfigured()) {
    throw new Error(
      "Supabase is enabled but the production connection is not configured. " +
        "Refusing to fall back to mock repositories."
    );
  }

  try {
    return getSupabaseRepositories();
  } catch (err) {
    console.error(
      "[RepositoryProvider] Failed to initialize Supabase repositories; mock fallback is disabled:",
      err,
    );
    throw err instanceof Error
      ? err
      : new Error(String(err));
  }
}

const defaultRepositories = selectDefaultRepositories();

export function RepositoryProvider({
  repositories = defaultRepositories,
  children,
}: {
  repositories?: Repositories;
  children: ReactNode;
}) {
  // T-313 (REG-006): the repositories object is passed through UNWRAPPED.
  // The 9e70078 patch wrapped `subjects.assignSubjectToClass` in a
  // fake-success decorator that (a) fabricated a `cs-<timestamp>` row on
  // the server's ERR_FORBIDDEN (the RLS rejection whose root cause is
  // ACAD-104 — hiding it instead of fixing it) and (b) stripped every
  // prototype method off the class instance via `{...base.subjects}`
  // (spread copies own properties only — `repos.subjects.observe` and
  // every other method became `undefined` app-wide). Server rejections
  // MUST surface to the caller: the Result contract is the only honest
  // channel.
  return (
    <RepositoryContext.Provider value={repositories}>
      {children}
    </RepositoryContext.Provider>
  );
}

export function useRepositories(): Repositories {
  return useContext(RepositoryContext);
}
