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
  StudentNarrativeRepository,
  AcademicYearRepository,
  AcademicLevelRepository,
  ClassPlacementRepository,
  PromotionCycleRepository,
  ReEnrollmentRepository,
} from "../../domain/repository/academic-repository";
import type { ClubRepository } from "../../domain/repository/club-repository";
// T-448 (UI-326): the dedicated dashboard-layout store (load/save/clear —
// one clear responsibility, deliberately separate from DashboardRepository).
import type { DashboardLayoutRepository } from "../../domain/repository/dashboard-layout-repository";
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

// T-470 (TEST-502 class b) — the composite now lives in infrastructure
// (`infrastructure/mock/mock-composite.ts`) so `supabase-repositories.ts`
// can spread it WITHOUT value-importing this app-layer module (the runtime
// cycle that detonated the t-390 suite at import time). Re-exported here so
// every existing importer of `repository-provider`'s `mockRepositories`
// keeps working unchanged.
import { mockRepositories } from "../../infrastructure/mock/mock-composite";
export { mockRepositories } from "../../infrastructure/mock/mock-composite";
import type { TimetableRepository } from "../../domain/repository/timetable-repository";
import type { IdentityResolutionRepository } from "../../domain/identity/repository";

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
  /** GRADE-103 (T-502): the year-keyed report-card narrative store
   * (migration 0148) — the persistence target behind the narrative
   * generator's « Approuver » button. */
  readonly studentNarratives: StudentNarrativeRepository;
  /** T-370 (ACAD-500): the atomic Class Formation & Placement finalize. */
  readonly classPlacement: ClassPlacementRepository;
  /** T-403 (0108): the human-in-the-loop promotion-cycle workflow. */
  readonly promotionCycles: PromotionCycleRepository;
  /** T-437 (ADR-031): the re-enrollment year-transition workflow (migration 0128). */
  readonly reEnrollment: ReEnrollmentRepository;
  /** T-438 (ADR-032): the EXPERIMENTAL identity-resolution store (migration 0130).
   * Inert until the per-desktop experimental flag is enabled (INV-40). */
  readonly identityResolution: IdentityResolutionRepository;
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
  /** T-448 (UI-326): the dedicated dashboard-layout-configuration store —
   * persists and restores the user's saved layout (migration 0134 behind
   * the Supabase twin; localStorage behind the mock twin). */
  readonly dashboardLayouts: DashboardLayoutRepository;
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
