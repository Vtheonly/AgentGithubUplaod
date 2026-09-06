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
import type { PromotionRepository, AcademicYearRepository } from "../../domain/repository/academic-repository";
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
  mockAcademicYearRepository,
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
  readonly academicYears: AcademicYearRepository;
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
  academicYears: mockAcademicYearRepository,
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
  const wantSupabase = useSupabase && isSupabaseConfigured();
  if (!wantSupabase) return mockRepositories;

  try {
    return getSupabaseRepositories();
  } catch (err) {
    console.error(
      "[RepositoryProvider] Failed to initialize Supabase repositories, falling back to mock:",
      err,
    );
    return mockRepositories;
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
  return (
    <RepositoryContext.Provider value={repositories}>
      {children}
    </RepositoryContext.Provider>
  );
}

export function useRepositories(): Repositories {
  return useContext(RepositoryContext);
}
