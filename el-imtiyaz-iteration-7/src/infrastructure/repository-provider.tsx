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
} from "../domain/repository/repository";
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
} from "./mock/mock-repositories";

export interface Repositories {
  readonly auth: AuthRepository;
  readonly parents: ParentRepository;
  readonly students: StudentRepository;
  readonly classes: ClassRepository;
  readonly subjects: SubjectRepository;
  readonly grades: GradeRepository;
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
};

const RepositoryContext = createContext<Repositories>(mockRepositories);

export function RepositoryProvider({
  repositories = mockRepositories,
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
