import { getSupabaseRepositories } from './supabase/supabase-repositories';
/**
 * RepositoryProvider — dependency injection seam.
 *
 * All UI components read repositories from this context. The default
 * implementation wires the MOCK repositories; a future Supabase adapter
 * can replace them by passing a different `repositories` prop.
 *
 * Pattern: React context + factory function. No DI framework — keeps the
 * footprint minimal and the wiring explicit.
 */
import { createContext, useContext, type ReactNode } from "react";
import type {
  AuthRepository,
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
} from "../domain/repository/repository";
import type {
  DepartmentRepository,
  ShiftRepository,
  ScheduleRepository,
  TaskRepository,
  LeaveRequestRepository,
  PerformanceReviewRepository,
  ChatRepository,
  OnboardingRepository,
} from "../domain/repository/workforce-repository";
import type {
  SupplierRepository,
  PurchaseRequestRepository,
  DeliveryRepository,
  InventoryRepository,
  WarehouseTaskRepository,
} from "../domain/repository/operations-repository";
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
} from "./mock/mock-repositories";
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
} from "./mock/workforce-mock-repositories";
import {
  mockSupplierRepository,
  mockPurchaseRequestRepository,
  mockDeliveryRepository,
  mockInventoryRepository,
  mockWarehouseTaskRepository,
  setOperationsAuditSink,
} from "./mock/operations-mock-repositories";

export interface Repositories {
  readonly auth: AuthRepository;
  readonly parents: ParentRepository;
  readonly students: StudentRepository;
  readonly classes: ClassRepository;
  readonly subjects: SubjectRepository;
  readonly grades: GradeRepository;
  /** Academic attendance (roll-call per class — plan §09.02). */
  readonly attendance: AttendanceRepository;
  readonly homework: HomeworkRepository;
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
  /** Iteration 5: ledger is the single source of truth for all financial data. */
  readonly ledger: LedgerRepository;
  /** Iteration 7 — Workflow DAG editor + execution monitor (plan §10). */
  readonly workflows: WorkflowRepository;
  readonly workflowRuns: WorkflowRunRepository;
  /** Iteration 7 — BYOK AI provider config (plan §11). */
  readonly aiConfig: AIConfigRepository;
  /** Iteration 7 — AES-256-GCM encrypted backups in IndexedDB vault (plan §13). */
  readonly backups: BackupRepository;

  /* Iteration 8 — Workforce management (plan §09 expansion) */
  readonly departments: DepartmentRepository;
  readonly shifts: ShiftRepository;
  readonly schedules: ScheduleRepository;
  readonly tasks: TaskRepository;
  /** Workforce attendance (clock in/out — distinct from academic roll-call). */
  readonly workforceAttendance: typeof mockWorkforceAttendanceRepository;
  readonly leaveRequests: LeaveRequestRepository;
  readonly performanceReviews: PerformanceReviewRepository;
  readonly chat: ChatRepository;
  readonly onboarding: OnboardingRepository;

  /* Iteration 9 — Operations (promoted from inline dashboard mock data) */
  readonly suppliers: SupplierRepository;
  readonly purchaseRequests: PurchaseRequestRepository;
  readonly deliveries: DeliveryRepository;
  readonly inventory: InventoryRepository;
  readonly warehouseTasks: WarehouseTaskRepository;

  /* Iteration 9 — Calendar + automated overdue alerts (plan §15 + §07.05) */
  readonly calendar: CalendarRepository;
  readonly overdueAlerts: OverdueAlertGenerator;
}

export const mockRepositories: Repositories = {
  auth: mockAuthRepository,
  parents: mockParentRepository,
  students: mockStudentRepository,
  classes: mockClassRepository,
  subjects: mockSubjectRepository,
  grades: mockGradeRepository,
  attendance: mockAttendanceRepository,
  homework: mockHomeworkRepository,
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

/**
 * Auto-select repositories based on the Supabase configuration.
 * - If Supabase URL + anon key are configured (via Settings → Configuration
 *   tab or env vars) AND the use_supabase flag is true: use Supabase-backed
 *   repositories.
 * - Otherwise: use mockRepositories (in-memory, resets on reload).
 *
 * The Supabase adapter is loaded lazily so the mock layer works without
 * Supabase env vars being configured.
 */
function selectDefaultRepositories(): Repositories {
  // Check both the local config flag AND that env vars are present
  // (so the app doesn't crash if the flag is true but env vars are missing)
  try {
    // Dynamic import to avoid circular dependency
      return getSupabaseRepositories();
    if (supabaseClientModule.useSupabase && supabaseClientModule.isSupabaseConfigured()) {
      // Using top-level ESM import
      const supabaseRepos = getSupabaseRepositories();
      console.info("[RepositoryProvider] Using Supabase-backed repositories");
      return supabaseRepos;
    }
  } catch (err) {
    console.error("[RepositoryProvider] Failed to initialize Supabase repositories, falling back to mock:", err);
  }
  console.info("[RepositoryProvider] Using mock repositories (configure Supabase in Settings → Configuration)");
  return mockRepositories;
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
