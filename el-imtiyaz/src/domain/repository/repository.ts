/**
 * Repository interfaces — pure abstract contracts that any data layer
 * implementation (mock, Supabase, SQLite) must satisfy.
 *
 * Methods return Promises of Result<T> so failure modes are explicit in the
 * type system. Methods that return live data expose an Observable<T> via a
 * subscribe callback so React can re-render on backend changes.
 */
import type { Result } from "../../core/result/result";
import type { Session } from "../../core/rbac/session";
import type {
  Parent,
  CreateParentInput,
  UpdateParentInput,
} from "../model/parent";
import type { Student, CreateStudentInput, BatchRegistrationInput, BatchRegistrationResult } from "../model/student";
import type {
  AcademicClass,
  Subject,
  ClassSubject,
  Assessment,
  AttendanceRecord,
  AttendanceSession,
  AttendanceStatus,
  Homework,
  AcademicTerm,
} from "../model/academic";
import type {
  Payment,
  Installment,
  AccountAdjustment,
  ParentFinancialProfile,
  DebtSummary,
  Receipt,
  CollectPaymentInput,
  UpdateInstallmentDueDateInput,
  AcademicCycle,
} from "../model/payment";
import type {
  AppNotification,
  DashboardKpi,
  RevenuePoint,
  DebtByAgingBucket,
  DemographicSlice,
  CreateAlertInput,
} from "../model/operations";
import type {
  CalendarEvent,
  CreateCalendarEventInput,
} from "../model/calendar";
import type { Expense, SubmitExpenseInput } from "../model/expense";
import type { Personnel, ReleveEntry, ReleveActivity } from "../model/personnel";
import type { AuditEntry, AuditLogFilter, AuditLogQueryResult } from "../model/audit";
import type { PricingConfig, PricingEntry, PricingCategory, DiscountType, DiscountCode } from "../model/pricing";
import type { LedgerEntry, ParentLedgerSummary } from "../model/ledger";
import type { GradeLevel } from "../model/student";
import type { TransportDestination } from "../model/parent";
import type { Workflow, WorkflowRun, WorkflowTriggerType } from "../model/workflow";
import type { BackupArchive, BackupRestoreResult } from "../model/backup";
import type { AIProviderConfig, AIProvider, AIRequest, AIResponse } from "../model/ai";

/** Minimal Observable<T> contract — glues mock/supabase reactive reads to React. */
export type Subscriber<T> = (value: T) => void;
export interface Observable<T> {
  subscribe(fn: Subscriber<T>): () => void;
  get(): T;
}

export interface AuthRepository {
  signIn(email: string, password: string): Promise<Result<Session>>;
  signOut(): Promise<Result<void>>;
  refreshSession(): Promise<Result<Session | null>>;
}

export interface ParentRepository {
  observe(): Observable<Parent[]>;
  observeById(id: string): Observable<Parent | null>;
  search(query: string): Promise<Result<Parent[]>>;
  createParent(input: CreateParentInput): Promise<Result<Parent>>;
  updateParent(id: string, input: UpdateParentInput): Promise<Result<Parent>>;
  deleteParent(id: string): Promise<Result<void>>;
}

export interface StudentRepository {
  observe(): Observable<Student[]>;
  observeByParent(parentId: string): Observable<Student[]>;
  observeByClass(classId: string): Observable<Student[]>;
  observeById(id: string): Observable<Student | null>;
  search(query: string): Promise<Result<Student[]>>;
  createStudent(parentId: string, input: CreateStudentInput): Promise<Result<Student>>;
  updateStudent(id: string, updates: Partial<CreateStudentInput>): Promise<Result<Student>>;
  deleteStudent(id: string): Promise<Result<void>>;
  batchRegister(input: BatchRegistrationInput): Promise<Result<BatchRegistrationResult>>;
  promote(studentIds: string[], academicYear: string): Promise<Result<Student[]>>;
}

export interface ClassRepository {
  observe(): Observable<AcademicClass[]>;
  observeByLevel(level: string): Observable<AcademicClass[]>;
  observeById(id: string): Observable<AcademicClass | null>;
  createClass(input: Omit<AcademicClass, "id" | "tenantId" | "enrolledCount">): Promise<Result<AcademicClass>>;
  updateClass(id: string, updates: Partial<AcademicClass>): Promise<Result<AcademicClass>>;
  deleteClass(id: string): Promise<Result<void>>;
}

export interface SubjectRepository {
  observe(): Observable<Subject[]>;
  observeByLevel(level: string): Observable<Subject[]>;
  observeByClass(classId: string): Observable<ClassSubject[]>;
  assignSubjectToClass(input: Omit<ClassSubject, "id">): Promise<Result<ClassSubject>>;
  removeSubjectFromClass(id: string): Promise<Result<void>>;
  /**
   * Iteration 3-E (plan §05): Subject CRUD for admin management.
   * Coefficient change should trigger GPA recompute for affected students
   * (handled at the repository implementation level).
   */
  createSubject(input: Omit<Subject, "id" | "tenantId">): Promise<Result<Subject>>;
  updateSubject(id: string, updates: Partial<Omit<Subject, "id" | "tenantId">>): Promise<Result<Subject>>;
  archiveSubject(id: string): Promise<Result<void>>;
}

export interface GradeRepository {
  observeForStudent(studentId: string): Observable<Assessment[]>;
  observeForClass(classId: string): Observable<Assessment[]>;
  enterGrade(input: Omit<Assessment, "id" | "subjectAverage" | "enteredAt">): Promise<Result<Assessment>>;
}

export interface AttendanceRepository {
  observeByClass(classId: string, date: string): Observable<AttendanceRecord[]>;
  observeByStudent(studentId: string, from: string, to: string): Observable<AttendanceRecord[]>;
  recordRollCall(input: {
    classId: string;
    date: string;
    session: AttendanceSession;
    statuses: ReadonlyMap<string, AttendanceStatus>;
    recordedBy: string;
  }): Promise<Result<AttendanceRecord[]>>;
  alertAbsences(studentIds: string[]): Promise<Result<void>>;
}

export interface HomeworkRepository {
  observeForClass(classId: string): Observable<Homework[]>;
  observeByTeacher(teacherId: string): Observable<Homework[]>;
  push(input: {
    classId: string;
    subjectId: string;
    teacherId: string;
    teacherName: string;
    title: string;
    description: string;
    dueDate: string;
    attachments: string[];
  }): Promise<Result<Homework>>;
}

export interface PaymentRepository {
  observe(): Observable<Payment[]>;
  observeByParent(parentId: string): Observable<Payment[]>;
  observeByStudent(studentId: string): Observable<Payment[]>;
  observeById(id: string): Observable<Payment | null>;
  collect(input: CollectPaymentInput, collectedBy: string): Promise<Result<Payment>>;
  refund(id: string): Promise<Result<Payment>>;
  adjust(parentId: string, amount: number, reason: string, approvedBy: string): Promise<Result<AccountAdjustment>>;
  generateReceipt(paymentId: string, generatedBy: string): Promise<Result<Receipt>>;
}

export interface InstallmentRepository {
  observeByParent(parentId: string): Observable<Installment[]>;
  observeByStudent(studentId: string): Observable<Installment[]>;
  observeById(id: string): Observable<Installment | null>;
  markPaid(id: string, paymentId: string): Promise<Result<Installment>>;
  /**
   * Iteration 9 — flexible installment schedules (plan §07.03 expansion).
   *
   * Override an installment's due date per parent to accommodate custom
   * payment agreements. The installment is marked `customSchedule: true`
   * and the optional note is recorded for audit visibility.
   */
  updateDueDate(input: UpdateInstallmentDueDateInput): Promise<Result<Installment>>;
  /**
   * Iteration 9 — cycle-based installment customization.
   *
   * Regenerate installments for a parent based on the given cycle's
   * default tranche template. Existing paid installments are preserved;
   * only pending / partial installments are re-templated.
   */
  regenerateForCycle(parentId: string, cycle: AcademicCycle, actorId: string, actorName: string): Promise<Result<readonly Installment[]>>;
  /** Find installments whose due date has passed but are not fully paid. Used by the automated overdue alert generator. */
  findOverdue(now?: Date): Promise<Result<readonly Installment[]>>;
}

export interface DebtRepository {
  observeSummary(): Observable<DebtSummary[]>;
  observeParentProfile(parentId: string): Observable<ParentFinancialProfile | null>;
  sendReminder(parentId: string): Promise<Result<void>>;
}

export interface ExpenseRepository {
  observe(): Observable<Expense[]>;
  observeByStatus(status: string): Observable<Expense[]>;
  observeById(id: string): Observable<Expense | null>;
  submit(input: SubmitExpenseInput, submittedBy: string): Promise<Result<Expense>>;
  approve(id: string, approver: string, note?: string): Promise<Result<Expense>>;
  reject(id: string, approver: string, note: string): Promise<Result<Expense>>;
  disburse(id: string, disbursedBy: string): Promise<Result<Expense>>;
  settleProof(id: string, proofUrl: string, uploadedBy: string): Promise<Result<Expense>>;
}

export interface PersonnelRepository {
  observe(): Observable<Personnel[]>;
  observeByCategory(category: string): Observable<Personnel[]>;
  observeById(id: string): Observable<Personnel | null>;
  /** Iteration 9: lookup by auth userId (replaces the displayName bridge hack). */
  observeByUserId(userId: string): Observable<Personnel | null>;
  createPersonnel(input: Omit<Personnel, "id" | "tenantId" | "weeklyHoursLogged">): Promise<Result<Personnel>>;
  updatePersonnel(id: string, updates: Partial<Personnel>): Promise<Result<Personnel>>;
  deletePersonnel(id: string): Promise<Result<void>>;
}

export interface ReleveRepository {
  observeByPersonnel(personnelId: string, from: string, to: string): Observable<ReleveEntry[]>;
  logEntry(input: {
    personnelId: string;
    personnelName: string;
    date: string;
    hoursIn: number;
    hoursOut: number | null;
    activity: ReleveActivity;
    classId: string | null;
    subjectId: string | null;
  }): Promise<Result<ReleveEntry>>;
}

export interface AuditRepository {
  query(filter: AuditLogFilter): Promise<Result<AuditLogQueryResult>>;
  byEntity(entityType: string, entityId: string): Promise<Result<AuditEntry[]>>;
  recent(limit?: number): Promise<Result<AuditEntry[]>>;
  log(input: {
    action: string;
    entityType: string;
    entityId: string;
    actorId: string;
    actorName: string;
    tenantId: string;
    diff?: { before?: unknown; after?: unknown } | null;
    note?: string | null;
  }): Promise<Result<AuditEntry>>;
}

export interface NotificationRepository {
  observe(): Observable<AppNotification[]>;
  /** Reactive stream filtered to alerts visible to the given session (broadcast + user/role targeted). */
  observeForSession(session: { userId: string; role: import("../../core/rbac/roles").Role }): Observable<AppNotification[]>;
  markRead(id: string): Promise<Result<void>>;
  markAllRead(): Promise<Result<void>>;
  clear(): Promise<Result<void>>;
  /** Dismiss / delete a single alert by id. */
  dismiss(id: string): Promise<Result<void>>;
  /**
   * Iteration 9 — manually create a custom alert.
   *
   * Used by the Alert Creator modal (accessible from the main Alerts tab
   * AND from the Personnel workspace so non-admin staff can also create
   * alerts). The new alert is appended to the reactive stream.
   */
  create(input: CreateAlertInput): Promise<Result<AppNotification>>;
  /** Update an existing alert (e.g. reschedule a reminder, change priority). */
  update(id: string, updates: Partial<Omit<AppNotification, "id" | "createdAt">>): Promise<Result<AppNotification>>;
}

export interface DashboardRepository {
  kpis(): Promise<Result<DashboardKpi>>;
  revenueLast12Months(): Promise<Result<RevenuePoint[]>>;
  debtByAging(): Promise<Result<DebtByAgingBucket[]>>;
  /**
   * Demographic visualizations (plan §15.03).
   *
   * Returns 4 slices:
   *   - `grade`: student count per academic level (Primaire / CEM / Lycée)
   *   - `gender`: student count per gender
   *   - `age`: student count per age bucket (< 6, 6-8, 9-11, 12-14, 15-17, 18+)
   *   - `capacity`: per-level enrollment vs capacity — `count` is enrolled,
   *     `percent` is the fill rate (enrolled / capacity * 100)
   */
  demographics(): Promise<Result<{ grade: DemographicSlice[]; gender: DemographicSlice[]; age: DemographicSlice[]; capacity: DemographicSlice[] }>>;
  /**
   * Iteration 9 — academic year + date range filtering.
   *
   * All KPI / chart calls can be scoped to a specific academic year and
   * (optionally) a finer-grained month/quarter/custom range. The default
   * call (no args) returns the current academic year's data.
   */
  kpisForRange(academicYear: string, range?: DateRange): Promise<Result<DashboardKpi>>;
  revenueForRange(academicYear: string, range?: DateRange): Promise<Result<RevenuePoint[]>>;
  debtByAgingForRange(academicYear: string, range?: DateRange): Promise<Result<DebtByAgingBucket[]>>;
}

/** Date range filter — used by the dashboard academic-year selector. */
export interface DateRange {
  readonly from: string; // ISO date
  readonly to: string;   // ISO date
}

/** Predefined range kinds surfaced in the dashboard selector UI. */
export type DateRangePreset = "ytd" | "month" | "quarter" | "custom";

/** Available academic years — populated by the mock from payment history. */
export interface AcademicYearInfo {
  readonly code: string; // "2025-2026"
  readonly startMonth: number; // 9 (September)
  readonly endMonth: number;   // 6 (June of following year)
}

export interface PricingRepository {
  observe(): Observable<PricingConfig>;

  // ---- Legacy update methods (kept for backward-compat; delegate to new ones) ----
  /** @deprecated Use `updateTuitionForGradeLevel` instead. Updates the first grade level within `level`. */
  updateTuition(level: import("../model/student").AcademicLevel, amount: number, updatedBy: string): Promise<Result<PricingConfig>>;
  /** @deprecated Use `updateTransportForDestination` instead. Maps tier → destination. */
  updateTransport(tier: "t1" | "t2" | "t3", amount: number, updatedBy: string): Promise<Result<PricingConfig>>;

  updateRegistration(amount: number, updatedBy: string): Promise<Result<PricingConfig>>;
  updateMonthly(level: import("../model/student").AcademicLevel, amount: number, updatedBy: string): Promise<Result<PricingConfig>>;
  updateLatePenalty(amountPerDay: number, updatedBy: string): Promise<Result<PricingConfig>>;
  addDiscount(input: { label: string; amount: number; discountType: DiscountType; discountCode?: DiscountCode }, updatedBy: string): Promise<Result<PricingConfig>>;
  removeDiscount(id: string, updatedBy: string): Promise<Result<PricingConfig>>;
  addAdditionalService(input: { label: string; amount: number }, updatedBy: string): Promise<Result<PricingConfig>>;
  removeAdditionalService(id: string, updatedBy: string): Promise<Result<PricingConfig>>;

  // ---- Iteration 6: granular pricing methods ----
  /** Update tuition for a specific grade level (annual + 3 installments). */
  updateTuitionForGradeLevel(
    gradeLevel: GradeLevel,
    annualAmount: number,
    installments: readonly [number, number, number],
    updatedBy: string,
  ): Promise<Result<PricingConfig>>;

  /** Update transport for a specific destination (annual + 3 installments). */
  updateTransportForDestination(
    destination: TransportDestination,
    annualAmount: number,
    installments: readonly [number, number, number],
    updatedBy: string,
  ): Promise<Result<PricingConfig>>;

  /** Update the 2nd apron surcharge. */
  updateSecondApronFee(amount: number, updatedBy: string): Promise<Result<PricingConfig>>;

  /** Add a complementary service (psychology, speech therapy, etc.) with semester & annual pricing. */
  addComplementaryService(input: {
    label: string;
    qualifier: string;
    semesterAmount: number;
    annualAmount: number;
  }, updatedBy: string): Promise<Result<PricingConfig>>;

  /** Remove a complementary service. */
  removeComplementaryService(id: string, updatedBy: string): Promise<Result<PricingConfig>>;
}

/**
 * Ledger repository — iteration 5.
 *
 * Single source of truth for all financial transactions. Every charge,
 * payment, adjustment, refund, and reversal is recorded here as an
 * immutable `LedgerEntry`. Balances are NEVER stored — they are always
 * computed by replaying the ledger via `computeParentSummary()`.
 */
export interface LedgerRepository {
  observe(): Observable<LedgerEntry[]>;
  observeByParent(parentId: string): Observable<LedgerEntry[]>;
  observeByAccount(accountId: string): Observable<LedgerEntry[]>;
  append(entry: LedgerEntry): Promise<Result<LedgerEntry>>;
  appendMany(entries: readonly LedgerEntry[]): Promise<Result<readonly LedgerEntry[]>>;
  /** Reverse a prior entry by ID. Returns the new reversal entry. */
  reverse(originalId: string, reason: string, actorId: string, actorName: string): Promise<Result<LedgerEntry>>;
  /** Compute the full parent ledger summary (computed via replay — never stored). */
  summary(parentId: string): Promise<Result<ParentLedgerSummary>>;
  /** Run reconciliation against the entire ledger. */
  reconcile(): Promise<Result<import("../reconciliation/reconcile").ReconciliationReport>>;
}

/* ------------------------------------------------------------------ */
/*  Iteration 7 — Workflow automation (plan §10)                       */
/* ------------------------------------------------------------------ */

/**
 * Workflow repository — plan §10.
 *
 * Visual DAG editor + execution monitor. Workflows are versioned: deploy
 * snapshots the current nodes/edges and marks the workflow as `deployed`.
 * Execute is manual-trigger only on desktop (plan §10.02).
 */
export interface WorkflowRepository {
  observe(): Observable<Workflow[]>;
  observeById(id: string): Observable<Workflow | null>;
  createWorkflow(input: {
    name: string;
    description: string;
    triggerType: WorkflowTriggerType;
    createdBy: string;
  }): Promise<Result<Workflow>>;
  updateWorkflow(
    id: string,
    updates: Partial<Pick<Workflow, "name" | "description" | "nodes" | "edges" | "triggerType" | "status">>,
    updatedBy: string,
  ): Promise<Result<Workflow>>;
  deleteWorkflow(id: string): Promise<Result<void>>;
  deploy(id: string, deployedBy: string): Promise<Result<Workflow>>;
  /** Execute a workflow manually (plan §10.06 — manual triggers). Returns the run record. */
  execute(id: string, actorId: string, actorName: string): Promise<Result<WorkflowRun>>;
}

/**
 * Workflow run repository — plan §10.04.
 *
 * Append-only log of workflow executions. Each run tracks per-node results
 * so the Exécutions tab can render a timeline.
 */
export interface WorkflowRunRepository {
  observe(): Observable<WorkflowRun[]>;
  observeByWorkflow(workflowId: string): Observable<WorkflowRun[]>;
  observeById(id: string): Observable<WorkflowRun | null>;
  retryRun(id: string, actorId: string, actorName: string): Promise<Result<WorkflowRun>>;
}

/* ------------------------------------------------------------------ */
/*  Iteration 7 — Backup & recovery (plan §13)                         */
/* ------------------------------------------------------------------ */

/**
 * Backup repository — iteration 7 (plan §13).
 *
 * AES-256-GCM encrypted archives written to a local IndexedDB vault with
 * 365-day rolling retention. The repository exposes metadata-only reads via
 * `observe()` — the ciphertext itself lives in the IndexedDB vault and is
 * fetched on demand by the service layer during restore.
 *
 * The repository also owns the encryption key derivation: a passphrase is
 * stored in `localStorage["el-imtiyaz:backup-passphrase"]` for the mock
 * implementation. Production (per plan §13.02) will swap this for a separate
 * secrets manager (HSM or Supabase secrets) — the `getEncryptionKey` contract
 * stays identical.
 */
export interface BackupRepository {
  /** Reactive metadata list (ciphertext is NOT exposed here — fetch by id on demand). */
  observe(): Observable<BackupArchive[]>;
  observeById(id: string): Observable<BackupArchive | null>;
  /** Run a new backup: serialize → gzip → AES-256-GCM → store → audit log. */
  runBackup(actorId: string, actorName: string): Promise<Result<BackupArchive>>;
  /** Restore an archive by id: fetch → decrypt → verify checksum → audit log. */
  restore(archiveId: string, actorId: string, actorName: string): Promise<Result<BackupRestoreResult>>;
  /** Delete a single archive (manual). Writes an audit entry. */
  deleteArchive(archiveId: string, actorId: string, actorName: string): Promise<Result<void>>;
  /** Purge all archives whose retentionExpiresAt has passed. Returns the purged archives. */
  purgeExpired(actorId: string, actorName: string): Promise<Result<BackupArchive[]>>;
  /** Derive the AES-256-GCM CryptoKey from the configured passphrase via PBKDF2. */
  getEncryptionKey(): Promise<Result<CryptoKey>>;
}

/* ------------------------------------------------------------------ */
/*  Iteration 7 — AI integration (plan §11)                            */
/* ------------------------------------------------------------------ */

/**
 * AI configuration repository — iteration 7 (plan §11).
 *
 * Owns the BYOK (Bring Your Own Key) provider config: Groq primary + OpenRouter
 * fallback. API keys are AES-256-GCM encrypted at rest in localStorage
 * (see `ai-config-storage.ts`) — the repository never exposes plaintext keys
 * via `observe()`; UI components display only a "Configuré / Non configuré"
 * badge based on whether the key is non-null.
 */
export interface AIConfigRepository {
  /** Reactive config stream — always emits the latest persisted config. */
  observe(): Observable<AIProviderConfig>;
  /** Update the persisted config. Writes an audit entry. */
  updateConfig(
    input: Partial<Omit<AIProviderConfig, "updatedAt" | "updatedBy">>,
    updatedBy: string,
  ): Promise<Result<AIProviderConfig>>;
  /** Ping the configured endpoint. Mock returns ok=true after 500ms. */
  testProvider(provider: AIProvider): Promise<Result<{ ok: boolean; latencyMs: number; error?: string }>>;
}

export interface LLMAdapter {
  generate(request: AIRequest): Promise<Result<AIResponse>>;
}

/* ------------------------------------------------------------------ */
/*  Iteration 9 — Calendar (plan §15 expansion)                        */
/* ------------------------------------------------------------------ */

/**
 * Calendar repository — iteration 9.
 *
 * Provides the daily activity log used by the Dashboard calendar:
 * payments received, audit log entries, expense events, plus any
 * manually scheduled follow-up calls / reminders / meetings / custom
 * events. Auto-generated events are derived from existing repositories;
 * manually scheduled events are persisted.
 */
export interface CalendarRepository {
  /** Reactive stream of all events for a date (YYYY-MM-DD). */
  observeForDate(date: string): Observable<CalendarEvent[]>;
  /** Reactive stream of all events in a month (YYYY-MM). */
  observeForMonth(yearMonth: string): Observable<CalendarEvent[]>;
  /** Manually schedule a new event. */
  create(input: CreateCalendarEventInput): Promise<Result<CalendarEvent>>;
  /** Update a manually scheduled event. */
  update(id: string, updates: Partial<CreateCalendarEventInput>): Promise<Result<CalendarEvent>>;
  /** Delete a manually scheduled event. Only manual events can be deleted. */
  delete(id: string): Promise<Result<void>>;
}

/* ------------------------------------------------------------------ */
/*  Iteration 9 — Automated overdue alert generator (plan §07.05)      */
/* ------------------------------------------------------------------ */

/**
 * Overdue alert generator — iteration 9.
 *
 * Scans installments whose due date has passed without payment
 * confirmation and produces `payment_overdue` alerts of priority
 * `high` or `urgent` (depending on days overdue). Idempotent: re-running
 * the generator for the same installment does NOT create duplicate
 * alerts — the generator keys dedup on `entityType=installment` +
 * `entityId=<installmentId>`.
 */
export interface OverdueAlertGenerator {
  /**
   * Scan installments and emit overdue alerts. Returns the list of newly
   * created alerts (empty if all overdue installments already had alerts).
   */
  run(now?: Date): Promise<Result<readonly AppNotification[]>>;
}

