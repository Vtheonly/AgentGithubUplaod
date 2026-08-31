/**
 * Repository interfaces — pure abstract contracts that any data layer
 * implementation (mock, Supabase, SQLite) must satisfy.
 *
 * Methods return Promises of Result<T> so failure modes are explicit in the
 * type system. Methods that return live data expose an Observable<T> via a
 * subscribe callback so React can re-render on backend changes.
 */
import type { Result } from "../../core/result";
import type { Session } from "../../core/rbac/session";
import type { Role } from "../../core/rbac/roles";
import type {
  Parent,
  CreateParentInput,
  UpdateParentInput,
} from "../model/parent";
import type { Student, CreateStudentInput, UpdateStudentInput, BatchRegistrationInput, BatchRegistrationResult } from "../model/student";
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
  PaymentCategory,
  PaymentPlan,
} from "../model/payment";
import type { AllocationResult } from "../calc/payment/waterfall-allocator";
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
import type { PromotionRepository } from "./academic-repository";

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
  /**
   * Change the signed-in user's password. Contract (SEC-103, task T-003):
   * the implementation MUST re-authenticate with the current password,
   * persist the new one via the backend (Supabase: auth.updateUser) and
   * revoke the user's sessions. Returning Ok means the password REALLY
   * changed — callers may write an audit entry on that basis.
   */
  changePassword(currentPassword: string, newPassword: string): Promise<Result<void>>;
}

/** Input for an admin provisioning a login account for another user (T-079). */
export interface CreateAccountInput {
  /** Login email — must be unique across existing accounts. */
  email: string;
  /** Display name shown in the UI (stored as user_profiles.display_name). */
  fullName?: string;
  /** Optional contact phone. */
  phone?: string;
  /** Role assigned at creation — one of the 11 wire codes. */
  role: Role;
  /**
   * Initial password. When omitted/empty, the IMPLEMENTATION generates a
   * policy-compliant one (plan §12.04). The admin conveys it to the user
   * out-of-band; the user changes it at first sign-in (SEC-103 fixed the
   * changePassword path, so this loop is closed).
   */
  initialPassword?: string;
}

/** Result of a successful account creation. */
export interface CreatedAccount {
  email: string;
  role: Role;
  /**
   * The initial password — returned EXACTLY ONCE so the admin can hand it
   * over. It is never persisted client-side and never written to the audit
   * log (SEC-100 lesson).
   */
  initialPassword: string;
}

/**
 * Admin-side account administration (T-079). Kept SEPARATE from
 * AuthRepository: AuthRepository is the *self* authentication surface
 * (sign in/out, own password); this interface is the *admin* surface
 * (provisioning accounts for OTHER users). Supabase implementation goes
 * through the create-user-account Edge Function (super_admin only);
 * mock implementation mints into seedAccounts so created users can sign
 * in during dev/demo without a backend.
 */
export interface UserAccountRepository {
  createAccount(input: CreateAccountInput): Promise<Result<CreatedAccount>>;
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
  updateStudent(id: string, updates: UpdateStudentInput): Promise<Result<Student>>;
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
  observeForClass(classId: string, academicYear?: string, term?: string): Observable<Assessment[]>;
  enterGrade(input: Omit<Assessment, "id" | "subjectAverage" | "enteredAt">): Promise<Result<Assessment>>;
  enterGradesBatch(inputs: ReadonlyArray<Omit<Assessment, "id" | "subjectAverage" | "enteredAt">>): Promise<Result<Assessment[]>>;
}

export interface AttendanceRepository {
  observeByClass(classId: string, date: string): Observable<AttendanceRecord[]>;
  /**
   * Observe attendance for a class over a date range [from, to] (inclusive).
   * FIX: the class attendance tab claimed "7 derniers jours" but only ever
   * queried a single day.
   */
  observeByClassRange(classId: string, from: string, to: string): Observable<AttendanceRecord[]>;
  observeByStudent(studentId: string, from: string, to: string): Observable<AttendanceRecord[]>;
  recordRollCall(input: {
    classId: string;
    date: string;
    session: AttendanceSession;
    statuses: ReadonlyMap<string, AttendanceStatus>;
    /**
     * VAULT §09.01 — arrival times (HH:MM) for students marked LATE.
     * Keyed by studentId; ignored for other statuses.
     */
    arrivalTimes?: ReadonlyMap<string, string>;
    recordedBy: string;
  }): Promise<Result<AttendanceRecord[]>>;
  /**
   * VAULT §09.04 — automated absence alerts. The implementation MUST:
   *   1. Count each student's absences for the CURRENT TERM (not a rolling
   *      window).
   *   2. Only act on students whose count reaches the threshold of 3 —
   *      "never send the alert before the threshold is hit".
   *   3. Flag the student (audit) and dispatch a parent notification.
   *
   * The input is the set of students that JUST became non-present in the
   * submitted roll call; the repository re-checks the threshold before
   * alerting.
   */
  alertAbsences(studentIds: string[]): Promise<Result<void>>;
  /**
   * T-040 (ATT-101): observe records whose justification is in the given
   * workflow state (default 'submitted' — the staff review queue).
   */
  observeJustifications(status?: "submitted" | "accepted" | "rejected"): Observable<AttendanceRecord[]>;
  /**
   * T-040 (ATT-101): staff decision on a submitted justification — writes
   * justification_status + reviewer + timestamp. 'none' records cannot be
   * reviewed; a previous decision may be overturned.
   */
  reviewJustification(input: {
    recordId: string;
    decision: "accepted" | "rejected";
    reviewedBy: string;
  }): Promise<Result<AttendanceRecord>>;
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
  /**
   * BULK IMPORT FIX: Batch-collect many payments in a SINGLE Supabase
   * INSERT call instead of one RPC per payment. ~100x faster for the
   * Excel importer.
   *
   * Falls back to looping `collect()` when the repository doesn't support
   * bulk collect.
   */
  bulkCollect?(inputs: ReadonlyArray<{ input: CollectPaymentInput; collectedBy: string }>): Promise<Result<readonly Payment[]>>;
  /**
   * Refund a payment (T-014 / BUSINESS-003 — canonical §7.2 contract).
   *
   * `reason` is MANDATORY (≥3 chars, user-provided — mirrored from the
   * refund-payment Edge Function contract) and `actorId`/`actorName` carry
   * the signed-in user's real identity so the audit trail attributes the
   * refund correctly. Implementations delegate to the canonical
   * `revert_payment_allocation` RPC (Supabase) or its TS mirror (mock) and
   * MUST reject a second refund of an already-refunded payment.
   */
  refund(id: string, reason: string, actorId: string, actorName?: string): Promise<Result<Payment>>;
  /**
   * PENDING → PAID transition (vault §07.02 — "bank clearance verified").
   *
   * Marks an uncleared check / bank transfer as cleared by the bank:
   *   1. `payments.status` moves `"pending"` → `"paid"`.
   *   2. Every installment holding uncleared funds from this payment has
   *      `amountPending` moved into `amountPaid` (oldest tranche first,
   *      mirroring the waterfall order), and its status is re-evaluated
   *      (Invariant 4: Cleared Funds Only — a tranche becomes `"paid"`
   *      only once cleared funds cover it).
   *   3. An audit entry records the transition (actor + timestamp).
   *
   * Cash payments are already `"paid"` — calling this on them returns a
   * conflict error.
   */
  markCleared(id: string, actorId: string, actorName?: string): Promise<Result<Payment>>;
  /**
   * PENDING → UNPAID transition (vault §07.02 — "check bounces / transfer
   * fails").
   *
   * Marks an uncleared non-cash payment as failed:
   *   1. `payments.status` moves `"pending"` → `"unpaid"`.
   *   2. The uncleared allocation is reversed LIFO (`amountPending`
   *      decremented, statuses re-evaluated — tranches reopen).
   *   3. A reversal ledger entry exactly negates the original payment entry
   *      (Invariant 5).
   *   4. The mandatory `reason` is audit-logged with the actor + timestamp.
   */
  markBounced(id: string, reason: string, actorId: string, actorName?: string): Promise<Result<Payment>>;
  /**
   * Apply a signed adjustment (debit or credit) to a parent's ledger.
   *
   * CANONICAL RULES (Tier 3 unification, R1.5):
   *   - If `amount < 0` (credit): the adjustment is written to the
   *     `parent_credit` account with `studentId = null` (parent-scoped).
   *     This preserves INV-3 ("negative balance on non-parent_credit
   *     account is a reconciler violation").
   *   - If `amount > 0` (debit, e.g. late fee / penalty): the adjustment
   *     is written to the caller-specified `category` (default `tuition`)
   *     and `studentId` (default `null`). When `studentId` is provided,
   *     the accountId is student-scoped; otherwise it is parent-scoped.
   *
   * The optional `category` and `studentId` parameters let callers apply
   * a positive adjustment to a non-tuition category (e.g. a canteen
   * surcharge) or to a specific student's account. When omitted, the
   * canonical defaults apply.
   *
   * @returns the created AccountAdjustment record (with `id` for audit trail)
   */
  adjust(
    parentId: string,
    amount: number,
    reason: string,
    approvedBy: string,
    options?: {
      category?: PaymentCategory;
      studentId?: string | null;
    },
  ): Promise<Result<AccountAdjustment>>;
  generateReceipt(paymentId: string, generatedBy: string): Promise<Result<Receipt>>;
  /**
   * Append an à-la-carte charge for an additional service (canteen, uniform,
   * books, 2nd apron). Used by the UnifiedPaymentModal `single_item` mode and
   * the parent drawer's "Sell service" action.
   *
   * UNIFIED ARCHITECTURE (Epic 4.3): ensures every billable service — not
   * just tuition + transport — writes a `charge` entry to `ledger_entries`.
   */
  appendManualCharge(input: {
    parentId: string;
    studentId: string;
    serviceQualifier:
      | "canteen_term"
      | "uniform"
      | "books"
      | "second_apron";
    description?: string;
  }, actorId: string): Promise<Result<LedgerEntry>>;
}

export interface InstallmentRepository {
  /**
   * All installments (tenant-wide). Used by the backup snapshot
   * (vault §13.01) and analytics surfaces.
   */
  observe(): Observable<Installment[]>;
  observeByParent(parentId: string): Observable<Installment[]>;
  observeByStudent(studentId: string): Observable<Installment[]>;
  observeById(id: string): Observable<Installment | null>;
  markPaid(id: string, paymentId: string): Promise<Result<Installment>>;
  /**
   * Waterfall Allocation Engine — distribute a payment across all
   * eligible unpaid/partial installments for a parent (oldest first).
   *
   * Returns the per-installment breakdown plus any leftover amount
   * (overpayment / parent credit). Guarantees Ledger ↔ Installment
   * mathematical consistency.
   *
   * @param parentId        Parent whose installments should be satisfied.
   * @param paymentAmount   Total amount being paid.
   * @param paymentId       The Payment ID (for audit trail linkage).
   * @param categoryFilter  Optional — restrict allocation to a single
   *                        category (e.g. "tuition" or "transport").
   * @param actorId         Audit actor ID.
   * @param actorName       Audit actor display name.
   */
  allocatePayment(
    parentId: string,
    paymentAmount: number,
    paymentId: string,
    categoryFilter?: PaymentCategory,
    actorId?: string,
    actorName?: string,
  ): Promise<Result<AllocationResult>>;
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
  /**
   * Bulk-import an installment row idempotently.
   *
   * Used by the Excel importer to create one installment per tuition tranche
   * (Sept 15 / Dec 15 / Mar 15) and per transport tranche, marking them
   * paid/partial/unpaid according to the imported amounts. Re-importing the
   * same Excel row updates the same installment in place rather than
   * creating duplicates — identity is `(tenant, parentId, studentId, category, trancheNumber)`.
   *
   * Implementations:
   *   - Mock: appends to `store.installments` with the deterministic id
   *     `imp-${parentId}-${studentId}-${category}-${trancheNumber}`.
   *   - Supabase: calls the `upsert_installment_from_import` RPC.
   *
   * Implementations that don't support bulk import (none in this codebase,
   * but kept as a safety net) should return `Err(server("not implemented"))`.
   */
  importInstallment(input: ImportInstallmentInput): Promise<Result<Installment>>;
  /**
   * BULK IMPORT FIX: Batch-import many installments in a SINGLE Supabase
   * upsert call instead of one per installment. ~100x faster for the
   * Excel importer.
   *
   * Falls back to looping `importInstallment()` when the repository doesn't
   * support bulk import.
   */
  bulkImportInstallments?(inputs: readonly ImportInstallmentInput[]): Promise<Result<readonly Installment[]>>;
}

/**
 * Input for `InstallmentRepository.importInstallment` — the bulk-import
 * path that creates or updates an installment row idempotently.
 *
 * The `trancheNumber` (1, 2, or 3) plus `category`, `parentId`, `studentId`
 * form the identity key. Re-importing the same Excel row produces the same
 * identity key → the existing installment is updated rather than duplicated.
 */
export interface ImportInstallmentInput {
  readonly parentId: string;
  readonly studentId: string;
  readonly category: PaymentCategory;
  readonly trancheNumber: 1 | 2 | 3;
  readonly label: string;
  readonly amountDue: number;
  readonly amountPaid: number;
  readonly dueDate: string;
  readonly paidDate: string | null;
  readonly status: "unpaid" | "partial" | "paid" | "overdue" | "pending_clearance";
  readonly academicCycle?: AcademicCycle;
  readonly paymentPlan?: PaymentPlan;
  readonly sourceType?: string;
  readonly sourceId?: string;
  readonly actorId?: string;
  readonly actorName?: string;
}

export interface DebtRepository {
  observeSummary(): Observable<DebtSummary[]>;
  observeParentProfile(parentId: string): Observable<ParentFinancialProfile | null>;
  sendReminder(parentId: string): Promise<Result<void>>;
  /**
   * VAULT §07.06 (Debt Dashboard — Actions) + §10.07 — "Broadcast Overdue
   * Payment Reminders": sends a reminder (notification + audit entry) to
   * EVERY debtor above `minDaysOverdue` (default 0 = all overdue debtors).
   * One-click admin bulk trigger — must be confirmation-gated in the UI.
   *
   * @returns the number of reminders dispatched.
   */
  broadcastReminders(minDaysOverdue?: number, actorId?: string): Promise<Result<number>>;
  /**
   * VAULT §07.06 (Actions) + §10.07 — "Lock Delinquent Accounts": applies
   * `FINANCIALLY_RESTRICTED` to every debtor overdue by more than
   * `minDaysOverdue` days (vault default: > 90 days). Each restriction is
   * audit-logged; already-restricted parents are skipped.
   *
   * @returns the number of accounts newly restricted.
   */
  lockDelinquentAccounts(minDaysOverdue?: number, actorId?: string): Promise<Result<number>>;
}

export interface ExpenseRepository {
  observe(): Observable<Expense[]>;
  observeByStatus(status: string): Observable<Expense[]>;
  observeById(id: string): Observable<Expense | null>;
  submit(input: SubmitExpenseInput, submittedBy: string): Promise<Result<Expense>>;
  approve(id: string, approver: string, note?: string): Promise<Result<Expense>>;
  reject(id: string, approver: string, note: string): Promise<Result<Expense>>;
  disburse(id: string, disbursedBy: string): Promise<Result<Expense>>;
  /**
   * VAULT §08.05 (Tier 3) — settle with the receipt proof AND the actual
   * final spent amount entered by staff. The financial officer verifies
   * the receipt against the disbursed amount before the ticket closes.
   */
  settleProof(id: string, proofUrl: string, uploadedBy: string, finalSpentAmount?: number): Promise<Result<Expense>>;
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
    /** T-053: null = resolve the working tenant (throws for a global admin with no tenant picked). */
    tenantId: string | null;
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
  /**
   * BULK IMPORT FIX: Batch-insert many ledger entries in a SINGLE Supabase
   * INSERT call instead of one RPC per entry. This is ~100x faster for the
   * Excel importer (390 rows × ~22 entries = ~8,580 entries → 1 INSERT
   * instead of 8,580 RPCs).
   *
   * Falls back to `appendMany` (loop) when the repository doesn't support
   * bulk insert (e.g. mock repository).
   */
  bulkAppend?(entries: readonly LedgerEntry[]): Promise<Result<readonly LedgerEntry[]>>;
  /** Reverse a prior entry by ID. Returns the new reversal entry. */
  reverse(originalId: string, reason: string, actorId: string, actorName: string): Promise<Result<LedgerEntry>>;
  /** Compute the full parent ledger summary (computed via replay — never stored). */
  summary(parentId: string): Promise<Result<ParentLedgerSummary>>;
  /** Run reconciliation against the entire ledger. */
  reconcile(): Promise<Result<import("../calc/reconcile").ReconciliationReport>>;
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

