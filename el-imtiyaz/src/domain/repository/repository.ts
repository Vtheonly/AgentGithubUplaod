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
} from "../model/payment";
import type { Expense, SubmitExpenseInput } from "../model/expense";
import type { Personnel, ReleveEntry, ReleveActivity } from "../model/personnel";
import type { AppNotification, DashboardKpi, RevenuePoint, DebtByAgingBucket, DemographicSlice } from "../model/operations";
import type { AuditEntry, AuditLogFilter, AuditLogQueryResult } from "../model/audit";
import type { PricingConfig, PricingEntry, PricingCategory } from "../model/pricing";

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
  markPaid(id: string, paymentId: string): Promise<Result<Installment>>;
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
  markRead(id: string): Promise<Result<void>>;
  markAllRead(): Promise<Result<void>>;
  clear(): Promise<Result<void>>;
}

export interface DashboardRepository {
  kpis(): Promise<Result<DashboardKpi>>;
  revenueLast12Months(): Promise<Result<RevenuePoint[]>>;
  debtByAging(): Promise<Result<DebtByAgingBucket[]>>;
  demographics(): Promise<Result<{ grade: DemographicSlice[]; gender: DemographicSlice[] }>>;
}

export interface PricingRepository {
  observe(): Observable<PricingConfig>;
  updateTuition(level: import("../model/student").AcademicLevel, amount: number, updatedBy: string): Promise<Result<PricingConfig>>;
  updateTransport(tier: "t1" | "t2" | "t3", amount: number, updatedBy: string): Promise<Result<PricingConfig>>;
  updateRegistration(amount: number, updatedBy: string): Promise<Result<PricingConfig>>;
  updateMonthly(level: import("../model/student").AcademicLevel, amount: number, updatedBy: string): Promise<Result<PricingConfig>>;
  updateLatePenalty(amountPerDay: number, updatedBy: string): Promise<Result<PricingConfig>>;
  addDiscount(input: { label: string; amount: number; discountType: import("../model/pricing").DiscountType }, updatedBy: string): Promise<Result<PricingConfig>>;
  removeDiscount(id: string, updatedBy: string): Promise<Result<PricingConfig>>;
  addAdditionalService(input: { label: string; amount: number }, updatedBy: string): Promise<Result<PricingConfig>>;
  removeAdditionalService(id: string, updatedBy: string): Promise<Result<PricingConfig>>;
}
