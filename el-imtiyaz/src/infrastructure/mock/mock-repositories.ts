/**
 * Mock repository implementations — in-memory, reactive (via SubjectBehavior),
 * seeded with the data from seed-data.ts.
 *
 * Every mutating method writes an audit log entry (mirrors the Supabase
 * adapter's behavior). The audit log is appended to the in-memory store
 * so the Settings → Audit Log viewer works end-to-end out of the box.
 */
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
  Observable,
} from "../../domain/repository/repository";
import type { Result } from "../../core/result/result";
import { Ok, Err } from "../../core/result/result";
import { Errors } from "../../core/errors/app-error";
import type { Session } from "../../core/rbac/session";
import { Role } from "../../core/rbac/roles";
import { DEFAULT_ROLE_PERMISSIONS } from "../../core/rbac/permissions";
import { AuditActions } from "../../core/audit/audit-actions";
import { logger } from "../../core/logging/logger";
import { randomParentSuffix, studentCode } from "../../core/format/id";
import { computeSubjectAverage } from "../../domain/model/academic";
import { agingBucketFromDays } from "../../domain/model/payment";
import type { Parent, CreateParentInput, UpdateParentInput } from "../../domain/model/parent";
import type {
  Student,
  CreateStudentInput,
  BatchRegistrationInput,
  BatchRegistrationResult,
} from "../../domain/model/student";
import type { AcademicClass, Subject, ClassSubject, Assessment, AttendanceRecord, Homework } from "../../domain/model/academic";
import type {
  Payment,
  Installment,
  AccountAdjustment,
  Receipt,
  CollectPaymentInput,
  ParentFinancialProfile,
  DebtSummary,
  PaymentStatus,
} from "../../domain/model/payment";
import type { Expense, SubmitExpenseInput, ExpenseStatus } from "../../domain/model/expense";
import type { Personnel, ReleveEntry } from "../../domain/model/personnel";
import type { AuditEntry, AuditLogFilter, AuditLogQueryResult } from "../../domain/model/audit";
import type { AppNotification, DashboardKpi, RevenuePoint, DebtByAgingBucket, DemographicSlice } from "../../domain/model/operations";
import type { PricingConfig, PricingEntry, DiscountType } from "../../domain/model/pricing";
import type { AcademicLevel } from "../../domain/model/student";

import { SubjectBehavior } from "./subject-behavior";
import {
  TENANT_ID,
  ACADEMIC_YEAR,
  seedParents,
  seedStudents,
  seedClasses,
  seedSubjects,
  seedPayments,
  seedInstallments,
  seedExpenses,
  seedPersonnel,
  seedAudit,
  seedNotifications,
  seedAccounts,
} from "./seed-data";
import { defaultPricingConfig } from "./pricing-seed";

const nowIso = () => new Date().toISOString();

/**
 * Mutable in-memory store. Mock repositories share this store so cross-entity
 * queries (e.g. ParentFinancialProfile) see consistent state.
 */
class MockStore {
  parents: Parent[] = [...seedParents];
  students: Student[] = [...seedStudents];
  classes: AcademicClass[] = [...seedClasses];
  subjects: Subject[] = [...seedSubjects];
  payments: Payment[] = [...seedPayments];
  installments: Installment[] = [...seedInstallments];
  expenses: Expense[] = [...seedExpenses];
  personnel: Personnel[] = [...seedPersonnel];
  audit: AuditEntry[] = [...seedAudit];
  notifications: AppNotification[] = [...seedNotifications];

  parents$ = new SubjectBehavior<Parent[]>(this.parents);
  students$ = new SubjectBehavior<Student[]>(this.students);
  classes$ = new SubjectBehavior<AcademicClass[]>(this.classes);
  subjects$ = new SubjectBehavior<Subject[]>(this.subjects);
  payments$ = new SubjectBehavior<Payment[]>(this.payments);
  installments$ = new SubjectBehavior<Installment[]>(this.installments);
  expenses$ = new SubjectBehavior<Expense[]>(this.expenses);
  personnel$ = new SubjectBehavior<Personnel[]>(this.personnel);
  audit$ = new SubjectBehavior<AuditEntry[]>(this.audit);
  notifications$ = new SubjectBehavior<AppNotification[]>(this.notifications);

  notifyParents() { this.parents$.set([...this.parents]); }
  notifyStudents() { this.students$.set([...this.students]); }
  notifyPayments() { this.payments$.set([...this.payments]); }
  notifyInstallments() { this.installments$.set([...this.installments]); }
  notifyExpenses() { this.expenses$.set([...this.expenses]); }
  notifyPersonnel() { this.personnel$.set([...this.personnel]); }
  notifyAudit() { this.audit$.set([...this.audit]); }
  notifyNotifications() { this.notifications$.set([...this.notifications]); }
}

const store = new MockStore();

interface AppendAuditInput {
  action: string;
  entityType: string;
  entityId: string;
  actorId: string;
  actorName: string;
  diff?: { before?: unknown; after?: unknown } | null;
  note?: string | null;
}

function appendAudit(input: AppendAuditInput): void {
  const entry: AuditEntry = {
    id: `aud-${String(store.audit.length + 1).padStart(3, "0")}-${Date.now()}`,
    tenantId: TENANT_ID,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    actorId: input.actorId,
    actorName: input.actorName,
    diff: input.diff ? JSON.stringify(input.diff) : null,
    note: input.note ?? null,
    ipAddress: "10.0.1.42",
    userAgent: "El-Imtiyaz-Desktop/0.1.0",
    at: nowIso(),
  };
  store.audit.unshift(entry);
  store.notifyAudit();
  logger.info("audit.log", { action: entry.action, entity: entry.entityType, id: entry.entityId });
}

// ============================================================
// Auth
// ============================================================
class MockAuthRepository implements AuthRepository {
  async signIn(email: string, password: string): Promise<Result<Session>> {
    await delay(220);
    const account = seedAccounts.find((a) => a.email === email && a.password === password);
    if (!account) {
      return Err(Errors.unauthorized("Invalid credentials"));
    }
    const role = account.role as Role;
    const session: Session = {
      userId: account.userId,
      tenantId: TENANT_ID,
      email: account.email,
      displayName: account.displayName,
      avatarUrl: null,
      role,
      permissions: DEFAULT_ROLE_PERMISSIONS[role] ?? new Set(),
      accessToken: `mock-jwt-${account.userId}-${Date.now()}`,
      refreshToken: `mock-refresh-${account.userId}`,
      expiresAt: Date.now() + 8 * 3600_000,
      locale: "fr",
    };
    appendAudit({
      action: AuditActions.AuthLogin,
      entityType: "session",
      entityId: session.userId,
      actorId: session.userId,
      actorName: session.displayName,
      note: "Connexion réussie",
    });
    return Ok(session);
  }

  async signOut(): Promise<Result<void>> {
    return Ok(undefined);
  }

  async refreshSession(): Promise<Result<Session | null>> {
    return Ok(null);
  }
}

// ============================================================
// Parents
// ============================================================
class MockParentRepository implements ParentRepository {
  observe(): Observable<Parent[]> { return store.parents$; }
  observeById(id: string): Observable<Parent | null> {
    return new SubjectBehavior(store.parents.find((p) => p.id === id) ?? null);
  }
  async search(query: string): Promise<Result<Parent[]>> {
    await delay(120);
    const q = query.toLowerCase().trim();
    if (!q) return Ok([...store.parents]);
    return Ok(
      store.parents.filter((p) =>
        `${p.firstName} ${p.lastName} ${p.phone} ${p.code}`.toLowerCase().includes(q),
      ),
    );
  }
  async createParent(input: CreateParentInput): Promise<Result<Parent>> {
    await delay(200);
    const year = new Date().getFullYear();
    const parent: Parent = {
      id: `par-${String(store.parents.length + 1).padStart(3, "0")}`,
      tenantId: TENANT_ID,
      code: `PAR-${year}-${randomParentSuffix()}`,
      firstName: input.firstName,
      lastName: input.lastName,
      gender: input.gender,
      phone: input.phone,
      whatsapp: input.whatsapp ?? null,
      email: input.email ?? null,
      occupation: input.occupation ?? null,
      address: input.address ?? null,
      cityTier: input.cityTier ?? null,
      preferredLanguage: input.preferredLanguage ?? "fr",
      avatarUrl: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    store.parents.unshift(parent);
    store.notifyParents();
    appendAudit({
      action: AuditActions.ParentCreate,
      entityType: "parent",
      entityId: parent.id,
      actorId: "usr-current",
      actorName: "Session courante",
      diff: { before: null, after: { code: parent.code, name: `${parent.firstName} ${parent.lastName}` } },
    });
    return Ok(parent);
  }
  async updateParent(id: string, updates: UpdateParentInput): Promise<Result<Parent>> {
    await delay(180);
    const idx = store.parents.findIndex((p) => p.id === id);
    if (idx < 0) return Err(Errors.notFound("Parent", id));
    const before = store.parents[idx];
    const after: Parent = { ...before, ...updates, updatedAt: nowIso() };
    store.parents[idx] = after;
    store.notifyParents();
    appendAudit({
      action: AuditActions.ParentUpdate,
      entityType: "parent",
      entityId: id,
      actorId: "usr-current",
      actorName: "Session courante",
      diff: { before, after },
    });
    return Ok(after);
  }
  async deleteParent(id: string): Promise<Result<void>> {
    await delay(180);
    if (store.students.some((s) => s.parentId === id)) {
      return Err(Errors.conflict("Cannot delete parent with linked students"));
    }
    const before = store.parents.find((p) => p.id === id);
    store.parents = store.parents.filter((p) => p.id !== id);
    store.notifyParents();
    appendAudit({
      action: AuditActions.ParentDelete,
      entityType: "parent",
      entityId: id,
      actorId: "usr-current",
      actorName: "Session courante",
      diff: { before, after: null },
    });
    return Ok(undefined);
  }
}

// ============================================================
// Students
// ============================================================
class MockStudentRepository implements StudentRepository {
  observe(): Observable<Student[]> { return store.students$; }
  observeByParent(parentId: string): Observable<Student[]> {
    return new SubjectBehavior(store.students.filter((s) => s.parentId === parentId));
  }
  observeByClass(classId: string): Observable<Student[]> {
    return new SubjectBehavior(store.students.filter((s) => s.classId === classId));
  }
  observeById(id: string): Observable<Student | null> {
    return new SubjectBehavior(store.students.find((s) => s.id === id) ?? null);
  }
  async search(query: string): Promise<Result<Student[]>> {
    await delay(120);
    const q = query.toLowerCase().trim();
    if (!q) return Ok([...store.students]);
    return Ok(
      store.students.filter((s) =>
        `${s.firstName} ${s.lastName} ${s.code}`.toLowerCase().includes(q),
      ),
    );
  }
  async createStudent(parentId: string, input: CreateStudentInput): Promise<Result<Student>> {
    await delay(200);
    const year = new Date().getFullYear();
    const seq = store.students.length + 1;
    const student: Student = {
      id: `stu-${String(seq).padStart(3, "0")}`,
      tenantId: TENANT_ID,
      code: studentCode(year, seq),
      parentId,
      firstName: input.firstName,
      lastName: input.lastName,
      gender: input.gender,
      birthDate: input.birthDate,
      enrollmentDate: nowIso(),
      level: input.level,
      gradeYear: input.gradeYear,
      classId: input.classId ?? null,
      photoUrl: null,
      medicalNotes: input.medicalNotes ?? null,
      transportTier: input.transportTier ?? null,
      status: "active",
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    store.students.unshift(student);
    store.notifyStudents();
    appendAudit({
      action: AuditActions.StudentCreate,
      entityType: "student",
      entityId: student.id,
      actorId: "usr-current",
      actorName: "Session courante",
      diff: { before: null, after: { code: student.code } },
    });
    return Ok(student);
  }
  async updateStudent(id: string, updates: Partial<CreateStudentInput>): Promise<Result<Student>> {
    await delay(180);
    const idx = store.students.findIndex((s) => s.id === id);
    if (idx < 0) return Err(Errors.notFound("Student", id));
    const before = store.students[idx];
    const after: Student = { ...before, ...updates, updatedAt: nowIso() };
    store.students[idx] = after;
    store.notifyStudents();
    appendAudit({
      action: AuditActions.StudentUpdate,
      entityType: "student",
      entityId: id,
      actorId: "usr-current",
      actorName: "Session courante",
      diff: { before, after },
    });
    return Ok(after);
  }
  async deleteStudent(id: string): Promise<Result<void>> {
    await delay(180);
    store.students = store.students.filter((s) => s.id !== id);
    store.notifyStudents();
    appendAudit({
      action: "student.delete",
      entityType: "student",
      entityId: id,
      actorId: "usr-current",
      actorName: "Session courante",
    });
    return Ok(undefined);
  }
  async batchRegister(input: BatchRegistrationInput): Promise<Result<BatchRegistrationResult>> {
    await delay(400);
    const year = new Date().getFullYear();
    const parentResult = await new MockParentRepository().createParent(input.parent);
    if (!parentResult.ok) return Err(parentResult.error);
    const parent = parentResult.value;
    const students: Student[] = [];
    for (const sInput of input.students) {
      const seq = store.students.length + 1;
      const student: Student = {
        id: `stu-${String(seq).padStart(3, "0")}`,
        tenantId: TENANT_ID,
        code: studentCode(year, seq),
        parentId: parent.id,
        firstName: sInput.firstName,
        lastName: sInput.lastName,
        gender: sInput.gender,
        birthDate: sInput.birthDate,
        enrollmentDate: nowIso(),
        level: sInput.level,
        gradeYear: sInput.gradeYear,
        classId: sInput.classId ?? null,
        photoUrl: null,
        medicalNotes: sInput.medicalNotes ?? null,
        transportTier: sInput.transportTier ?? null,
        status: "active",
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      store.students.unshift(student);
      students.push(student);
    }
    store.notifyStudents();
    appendAudit({
      action: AuditActions.BatchRegister,
      entityType: "batch",
      entityId: parent.id,
      actorId: "usr-current",
      actorName: "Session courante",
      diff: { before: null, after: { parentCode: parent.code, studentCount: students.length } },
      note: "Inscription groupée atomique",
    });
    return Ok({ parent, students });
  }
  async promote(studentIds: string[], _academicYear: string): Promise<Result<Student[]>> {
    await delay(300);
    const promoted = store.students
      .filter((s) => studentIds.includes(s.id))
      .map((s) => ({ ...s, updatedAt: nowIso() }));
    appendAudit({
      action: AuditActions.StudentPromote,
      entityType: "student",
      entityId: studentIds.join(","),
      actorId: "usr-current",
      actorName: "Session courante",
      diff: { before: null, after: { count: promoted.length } },
    });
    return Ok(promoted);
  }
}

// ============================================================
// Classes & Subjects
// ============================================================
class MockClassRepository implements ClassRepository {
  observe(): Observable<AcademicClass[]> { return store.classes$; }
  observeByLevel(level: string): Observable<AcademicClass[]> {
    return new SubjectBehavior(store.classes.filter((c) => c.level === level));
  }
  observeById(id: string): Observable<AcademicClass | null> {
    return new SubjectBehavior(store.classes.find((c) => c.id === id) ?? null);
  }
  async createClass(input: Omit<AcademicClass, "id" | "tenantId" | "enrolledCount">): Promise<Result<AcademicClass>> {
    await delay(200);
    const cls: AcademicClass = { ...input, id: `cls-${String(store.classes.length + 1).padStart(3, "0")}`, tenantId: TENANT_ID, enrolledCount: 0 };
    store.classes.push(cls);
    store.classes$.set([...store.classes]);
    appendAudit({ action: AuditActions.ClassCreate, entityType: "class", entityId: cls.id, actorId: "usr-current", actorName: "Session courante" });
    return Ok(cls);
  }
  async updateClass(id: string, updates: Partial<AcademicClass>): Promise<Result<AcademicClass>> {
    await delay(180);
    const idx = store.classes.findIndex((c) => c.id === id);
    if (idx < 0) return Err(Errors.notFound("Class", id));
    const after = { ...store.classes[idx], ...updates };
    store.classes[idx] = after;
    store.classes$.set([...store.classes]);
    return Ok(after);
  }
  async deleteClass(id: string): Promise<Result<void>> {
    await delay(180);
    store.classes = store.classes.filter((c) => c.id !== id);
    store.classes$.set([...store.classes]);
    return Ok(undefined);
  }
}

class MockSubjectRepository implements SubjectRepository {
  observe(): Observable<Subject[]> { return store.subjects$; }
  observeByLevel(level: string): Observable<Subject[]> {
    return new SubjectBehavior(store.subjects.filter((s) => s.level === level));
  }
  observeByClass(_classId: string): Observable<ClassSubject[]> { return new SubjectBehavior([]); }
  async assignSubjectToClass(_input: Omit<ClassSubject, "id">): Promise<Result<ClassSubject>> {
    return Err(Errors.unknown("not implemented in mock"));
  }
  async removeSubjectFromClass(_id: string): Promise<Result<void>> { return Ok(undefined); }
}

class MockGradeRepository implements GradeRepository {
  observeForStudent(_studentId: string): Observable<Assessment[]> { return new SubjectBehavior([]); }
  observeForClass(_classId: string): Observable<Assessment[]> { return new SubjectBehavior([]); }
  async enterGrade(input: Omit<Assessment, "id" | "subjectAverage" | "enteredAt">): Promise<Result<Assessment>> {
    await delay(150);
    const asm: Assessment = {
      ...input,
      id: `asm-${Date.now()}`,
      subjectAverage: computeSubjectAverage(input.devoir1, input.devoir2, input.examen),
      enteredAt: nowIso(),
    };
    appendAudit({
      action: AuditActions.GradeEnter,
      entityType: "assessment",
      entityId: asm.id,
      actorId: input.enteredBy,
      actorName: "Session courante",
    });
    return Ok(asm);
  }
}

class MockAttendanceRepository implements AttendanceRepository {
  observeByClass(_classId: string, _date: string): Observable<AttendanceRecord[]> { return new SubjectBehavior([]); }
  observeByStudent(_studentId: string, _from: string, _to: string): Observable<AttendanceRecord[]> { return new SubjectBehavior([]); }
  async recordRollCall(input: {
    classId: string;
    date: string;
    session: import("../../domain/model/academic").AttendanceSession;
    statuses: ReadonlyMap<string, import("../../domain/model/academic").AttendanceStatus>;
    recordedBy: string;
  }): Promise<Result<AttendanceRecord[]>> {
    await delay(220);
    const records: AttendanceRecord[] = [...input.statuses.entries()].map(([studentId, status]) => ({
      id: `att-${Date.now()}-${studentId}`,
      studentId,
      classId: input.classId,
      date: input.date,
      session: input.session,
      status,
      note: null,
      recordedBy: input.recordedBy,
      recordedAt: nowIso(),
      syncedAt: nowIso(),
    }));
    const present = records.filter((r) => r.status === "present").length;
    appendAudit({
      action: AuditActions.AttendanceSubmit,
      entityType: "attendance",
      entityId: input.classId,
      actorId: input.recordedBy,
      actorName: "Session courante",
      diff: { before: null, after: { total: records.length, present, absent: records.length - present } },
    });
    return Ok(records);
  }
  async alertAbsences(studentIds: string[]): Promise<Result<void>> {
    appendAudit({
      action: "attendance.alert_absences",
      entityType: "student",
      entityId: studentIds.join(","),
      actorId: "system",
      actorName: "Système",
      note: `Seuil 3+ absences atteint pour ${studentIds.length} élève(s)`,
    });
    return Ok(undefined);
  }
}

class MockHomeworkRepository implements HomeworkRepository {
  observeForClass(_classId: string): Observable<Homework[]> { return new SubjectBehavior([]); }
  observeByTeacher(_teacherId: string): Observable<Homework[]> { return new SubjectBehavior([]); }
  async push(input: {
    classId: string;
    subjectId: string;
    teacherId: string;
    teacherName: string;
    title: string;
    description: string;
    dueDate: string;
    attachments: string[];
  }): Promise<Result<Homework>> {
    await delay(200);
    const hw: Homework = {
      ...input,
      id: `hw-${Date.now()}`,
      subjectName: "Français",
      attachments: input.attachments,
      academicYear: ACADEMIC_YEAR,
      createdAt: nowIso(),
      pushedAt: nowIso(),
      acknowledgedCount: 0,
    };
    appendAudit({
      action: AuditActions.HomeworkPush,
      entityType: "homework",
      entityId: hw.id,
      actorId: input.teacherId,
      actorName: input.teacherName,
    });
    return Ok(hw);
  }
}

// ============================================================
// Financials
// ============================================================
class MockPaymentRepository implements PaymentRepository {
  observe(): Observable<Payment[]> { return store.payments$; }
  observeByParent(parentId: string): Observable<Payment[]> {
    return new SubjectBehavior(store.payments.filter((p) => p.parentId === parentId));
  }
  observeByStudent(studentId: string): Observable<Payment[]> {
    return new SubjectBehavior(store.payments.filter((p) => p.studentId === studentId));
  }
  observeById(id: string): Observable<Payment | null> {
    return new SubjectBehavior(store.payments.find((p) => p.id === id) ?? null);
  }
  async collect(input: CollectPaymentInput, collectedBy: string): Promise<Result<Payment>> {
    await delay(250);
    const year = new Date().getFullYear();
    const seq = store.payments.length + 1;
    const status: PaymentStatus = input.method === "cash" ? "paid" : "pending";
    const payment: Payment = {
      id: `pay-${String(seq).padStart(3, "0")}`,
      tenantId: TENANT_ID,
      receiptNumber: `REC-${year}-${String(seq).padStart(6, "0")}`,
      parentId: input.parentId,
      studentId: input.studentId,
      amount: input.amount,
      method: input.method,
      status,
      category: input.category,
      installmentId: input.installmentId,
      proofUrl: input.proofUrl ?? null,
      notes: input.notes ?? null,
      collectedBy,
      collectedAt: nowIso(),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    store.payments.unshift(payment);
    store.notifyPayments();
    appendAudit({
      action: AuditActions.PaymentCreate,
      entityType: "payment",
      entityId: payment.id,
      actorId: collectedBy,
      actorName: "Session courante",
      diff: { before: null, after: { amount: payment.amount, method: payment.method, receipt: payment.receiptNumber } },
    });
    return Ok(payment);
  }
  async refund(id: string): Promise<Result<Payment>> {
    await delay(200);
    const idx = store.payments.findIndex((p) => p.id === id);
    if (idx < 0) return Err(Errors.notFound("Payment", id));
    const after: Payment = { ...store.payments[idx], status: "refunded", updatedAt: nowIso() };
    store.payments[idx] = after;
    store.notifyPayments();
    appendAudit({
      action: AuditActions.PaymentRefund,
      entityType: "payment",
      entityId: id,
      actorId: "usr-current",
      actorName: "Session courante",
      diff: { before: { status: "paid" }, after: { status: "refunded" } },
    });
    return Ok(after);
  }
  async adjust(parentId: string, amount: number, reason: string, approvedBy: string): Promise<Result<AccountAdjustment>> {
    await delay(200);
    const adj: AccountAdjustment = {
      id: `adj-${Date.now()}`,
      parentId,
      amount,
      reason,
      approvedBy,
      approvedAt: nowIso(),
      receiptRef: null,
    };
    appendAudit({
      action: AuditActions.PaymentAdjust,
      entityType: "adjustment",
      entityId: adj.id,
      actorId: approvedBy,
      actorName: "Session courante",
      diff: { before: null, after: { amount, reason } },
    });
    return Ok(adj);
  }
  async generateReceipt(paymentId: string, generatedBy: string): Promise<Result<Receipt>> {
    await delay(180);
    const p = store.payments.find((x) => x.id === paymentId);
    if (!p) return Err(Errors.notFound("Payment", paymentId));
    const receipt: Receipt = {
      id: `rcp-${Date.now()}`,
      paymentId,
      receiptNumber: p.receiptNumber,
      pdfUrl: `mock://receipts/${p.receiptNumber}.pdf`,
      generatedAt: nowIso(),
      generatedBy,
    };
    appendAudit({
      action: AuditActions.ReceiptGenerate,
      entityType: "receipt",
      entityId: receipt.id,
      actorId: generatedBy,
      actorName: "Session courante",
    });
    return Ok(receipt);
  }
}

class MockInstallmentRepository implements InstallmentRepository {
  observeByParent(parentId: string): Observable<Installment[]> {
    return new SubjectBehavior(store.installments.filter((i) => i.parentId === parentId));
  }
  observeByStudent(studentId: string): Observable<Installment[]> {
    return new SubjectBehavior(store.installments.filter((i) => i.studentId === studentId));
  }
  async markPaid(id: string, paymentId: string): Promise<Result<Installment>> {
    await delay(180);
    const idx = store.installments.findIndex((i) => i.id === id);
    if (idx < 0) return Err(Errors.notFound("Installment", id));
    const after: Installment = { ...store.installments[idx], amountPaid: store.installments[idx].amountDue, paidDate: nowIso(), status: "paid" };
    store.installments[idx] = after;
    store.notifyInstallments();
    appendAudit({
      action: AuditActions.InstallmentMarkPaid,
      entityType: "installment",
      entityId: id,
      actorId: "usr-current",
      actorName: "Session courante",
      note: `Payment ${paymentId}`,
    });
    return Ok(after);
  }
}

class MockDebtRepository implements DebtRepository {
  observeSummary(): Observable<DebtSummary[]> {
    return new SubjectBehavior(
      seedParents.slice(0, 6).map((p, idx) => {
        const outstanding = [0, 18000, 0, 9000, 0, 27000][idx] ?? 0;
        const daysOverdue = [0, 75, 0, 45, 0, 110][idx] ?? 0;
        const studentCount = store.students.filter((s) => s.parentId === p.id).length;
        return {
          id: `debt-${p.id}`,
          parentId: p.id,
          parentName: `${p.firstName} ${p.lastName}`,
          parentPhone: p.phone,
          studentCount,
          outstandingAmount: outstanding,
          daysOverdue,
          bucket: agingBucketFromDays(daysOverdue),
        };
      }),
    );
  }
  observeParentProfile(parentId: string): Observable<ParentFinancialProfile | null> {
    const parent = store.parents.find((p) => p.id === parentId);
    if (!parent) return new SubjectBehavior<ParentFinancialProfile | null>(null);
    const installments = store.installments.filter((i) => i.parentId === parentId);
    const payments = store.payments.filter((p) => p.parentId === parentId).slice(0, 10);
    const totalDue = installments.reduce((s, i) => s + i.amountDue, 0);
    const totalPaid = installments.reduce((s, i) => s + i.amountPaid, 0);
    return new SubjectBehavior<ParentFinancialProfile | null>({
      parentId,
      parentName: `${parent.firstName} ${parent.lastName}`,
      totalDue,
      totalPaid,
      totalOutstanding: totalDue - totalPaid,
      overdueAmount: Math.max(0, totalDue - totalPaid),
      installments,
      recentPayments: payments,
      adjustments: [],
    });
  }
  async sendReminder(parentId: string): Promise<Result<void>> {
    await delay(150);
    appendAudit({
      action: AuditActions.DebtReminderSent,
      entityType: "parent",
      entityId: parentId,
      actorId: "usr-current",
      actorName: "Session courante",
      note: "Rappel envoyé",
    });
    return Ok(undefined);
  }
}

class MockExpenseRepository implements ExpenseRepository {
  observe(): Observable<Expense[]> { return store.expenses$; }
  observeByStatus(status: string): Observable<Expense[]> {
    return new SubjectBehavior(store.expenses.filter((e) => e.status === status));
  }
  observeById(id: string): Observable<Expense | null> {
    return new SubjectBehavior(store.expenses.find((e) => e.id === id) ?? null);
  }
  async submit(input: SubmitExpenseInput, submittedBy: string): Promise<Result<Expense>> {
    await delay(220);
    const seq = store.expenses.length + 1;
    const exp: Expense = {
      ...input,
      id: `exp-${String(seq).padStart(3, "0")}`,
      tenantId: TENANT_ID,
      requestCode: `EXP-2025-${String(seq).padStart(3, "0")}`,
      status: "submitted",
      submittedBy,
      submittedAt: nowIso(),
      approvedBy: null, approvedAt: null, approvalNote: null,
      disbursedBy: null, disbursedAt: null,
      proofUrl: null, proofUploadedBy: null, proofUploadedAt: null,
      anomalyScore: null, anomalyNote: null,
    };
    store.expenses.unshift(exp);
    store.notifyExpenses();
    appendAudit({
      action: AuditActions.ExpenseSubmit,
      entityType: "expense",
      entityId: exp.id,
      actorId: submittedBy,
      actorName: "Session courante",
    });
    return Ok(exp);
  }
  async approve(id: string, approver: string, note?: string): Promise<Result<Expense>> {
    await delay(180);
    return this.transition(id, "approved", { approvedBy: approver, approvedAt: nowIso(), approvalNote: note ?? null }, AuditActions.ExpenseApprove, approver);
  }
  async reject(id: string, approver: string, note: string): Promise<Result<Expense>> {
    await delay(180);
    return this.transition(id, "rejected", { approvedBy: approver, approvedAt: nowIso(), approvalNote: note }, AuditActions.ExpenseReject, approver);
  }
  async disburse(id: string, disbursedBy: string): Promise<Result<Expense>> {
    await delay(180);
    return this.transition(id, "disbursed", { disbursedBy, disbursedAt: nowIso() }, AuditActions.ExpenseDisburse, disbursedBy);
  }
  async settleProof(id: string, proofUrl: string, uploadedBy: string): Promise<Result<Expense>> {
    await delay(200);
    return this.transition(id, "settled", { proofUrl, proofUploadedBy: uploadedBy, proofUploadedAt: nowIso() }, AuditActions.ExpenseSettle, uploadedBy);
  }
  private transition(id: string, status: ExpenseStatus, patches: Partial<Expense>, action: string, actorId: string): Promise<Result<Expense>> {
    const idx = store.expenses.findIndex((e) => e.id === id);
    if (idx < 0) return Promise.resolve(Err(Errors.notFound("Expense", id)));
    const before = store.expenses[idx];
    const after: Expense = { ...before, ...patches, status };
    store.expenses[idx] = after;
    store.notifyExpenses();
    appendAudit({
      action,
      entityType: "expense",
      entityId: id,
      actorId,
      actorName: "Session courante",
      diff: { before: { status: before.status }, after: { status } },
    });
    return Promise.resolve(Ok(after));
  }
}

// ============================================================
// Personnel & Relevé
// ============================================================
class MockPersonnelRepository implements PersonnelRepository {
  observe(): Observable<Personnel[]> { return store.personnel$; }
  observeByCategory(category: string): Observable<Personnel[]> {
    return new SubjectBehavior(store.personnel.filter((p) => p.staffCategory === category));
  }
  observeById(id: string): Observable<Personnel | null> {
    return new SubjectBehavior(store.personnel.find((p) => p.id === id) ?? null);
  }
  async createPersonnel(input: Omit<Personnel, "id" | "tenantId" | "weeklyHoursLogged">): Promise<Result<Personnel>> {
    await delay(200);
    const p: Personnel = { ...input, id: `per-${String(store.personnel.length + 1).padStart(3, "0")}`, tenantId: TENANT_ID, weeklyHoursLogged: 0 };
    store.personnel.push(p);
    store.notifyPersonnel();
    appendAudit({ action: AuditActions.PersonnelCreate, entityType: "personnel", entityId: p.id, actorId: "usr-current", actorName: "Session courante" });
    return Ok(p);
  }
  async updatePersonnel(id: string, updates: Partial<Personnel>): Promise<Result<Personnel>> {
    await delay(180);
    const idx = store.personnel.findIndex((p) => p.id === id);
    if (idx < 0) return Err(Errors.notFound("Personnel", id));
    const after = { ...store.personnel[idx], ...updates };
    store.personnel[idx] = after;
    store.notifyPersonnel();
    return Ok(after);
  }
  async deletePersonnel(id: string): Promise<Result<void>> {
    await delay(180);
    store.personnel = store.personnel.filter((p) => p.id !== id);
    store.notifyPersonnel();
    return Ok(undefined);
  }
}

class MockReleveRepository implements ReleveRepository {
  observeByPersonnel(_personnelId: string, _from: string, _to: string): Observable<ReleveEntry[]> { return new SubjectBehavior([]); }
  async logEntry(input: {
    personnelId: string;
    personnelName: string;
    date: string;
    hoursIn: number;
    hoursOut: number | null;
    activity: import("../../domain/model/personnel").ReleveActivity;
    classId: string | null;
    subjectId: string | null;
  }): Promise<Result<ReleveEntry>> {
    await delay(180);
    const entry: ReleveEntry = { ...input, id: `rel-${Date.now()}`, recordedAt: nowIso() };
    appendAudit({
      action: AuditActions.ReleveCreate,
      entityType: "releve",
      entityId: entry.id,
      actorId: "usr-current",
      actorName: "Session courante",
    });
    return Ok(entry);
  }
}

// ============================================================
// Audit
// ============================================================
class MockAuditRepository implements AuditRepository {
  async query(filter: AuditLogFilter): Promise<Result<AuditLogQueryResult>> {
    await delay(120);
    let rows = [...store.audit];
    if (filter.action) rows = rows.filter((r) => r.action === filter.action);
    if (filter.entityType) rows = rows.filter((r) => r.entityType === filter.entityType);
    if (filter.entityId) rows = rows.filter((r) => r.entityId === filter.entityId);
    if (filter.actorId) rows = rows.filter((r) => r.actorId === filter.actorId);
    if (filter.actorNameContains) {
      const q = filter.actorNameContains.toLowerCase();
      rows = rows.filter((r) => r.actorName.toLowerCase().includes(q));
    }
    if (filter.from) rows = rows.filter((r) => r.at >= filter.from!);
    if (filter.to) rows = rows.filter((r) => r.at <= filter.to!);
    const total = rows.length;
    const offset = filter.offset ?? 0;
    const limit = filter.limit ?? 50;
    const entries = rows.slice(offset, offset + limit);
    return Ok({ entries, total, hasMore: offset + limit < total });
  }
  async byEntity(entityType: string, entityId: string): Promise<Result<AuditEntry[]>> {
    await delay(80);
    return Ok(store.audit.filter((r) => r.entityType === entityType && r.entityId === entityId));
  }
  async recent(limit = 50): Promise<Result<AuditEntry[]>> {
    await delay(80);
    return Ok(store.audit.slice(0, limit));
  }
  async log(input: {
    action: string;
    entityType: string;
    entityId: string;
    actorId: string;
    actorName: string;
    tenantId: string;
    diff?: { before?: unknown; after?: unknown } | null;
    note?: string | null;
  }): Promise<Result<AuditEntry>> {
    const entry: AuditEntry = {
      id: `aud-${Date.now()}`,
      tenantId: TENANT_ID,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      actorId: input.actorId,
      actorName: input.actorName,
      diff: input.diff ? JSON.stringify(input.diff) : null,
      note: input.note ?? null,
      ipAddress: "10.0.1.42",
      userAgent: "El-Imtiyaz-Desktop/0.1.0",
      at: nowIso(),
    };
    store.audit.unshift(entry);
    store.notifyAudit();
    return Ok(entry);
  }
}

// ============================================================
// Notifications & Dashboard
// ============================================================
class MockNotificationRepository implements NotificationRepository {
  observe(): Observable<AppNotification[]> { return store.notifications$; }
  async markRead(id: string): Promise<Result<void>> {
    store.notifications = store.notifications.map((n) => n.id === id ? { ...n, readAt: nowIso() } : n);
    store.notifyNotifications();
    return Ok(undefined);
  }
  async markAllRead(): Promise<Result<void>> {
    store.notifications = store.notifications.map((n) => ({ ...n, readAt: nowIso() }));
    store.notifyNotifications();
    return Ok(undefined);
  }
  async clear(): Promise<Result<void>> {
    store.notifications = [];
    store.notifyNotifications();
    return Ok(undefined);
  }
}

class MockDashboardRepository implements DashboardRepository {
  async kpis(): Promise<Result<DashboardKpi>> {
    await delay(150);
    return Ok({
      totalStudents: store.students.length,
      totalParents: store.parents.length,
      totalStaff: store.personnel.length,
      monthlyRevenue: 285_000,
      outstandingDebt: 67_500,
      pendingExpenses: store.expenses.filter((e) => e.status === "submitted").length,
      attendanceRateToday: 0.93,
      overdueAlerts: store.notifications.filter((n) => n.type === "payment_overdue" && !n.readAt).length,
    });
  }
  async revenueLast12Months(): Promise<Result<RevenuePoint[]>> {
    await delay(150);
    const months = ["Oct", "Nov", "Déc", "Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Août", "Sep"];
    return Ok(months.map((label, i) => ({ label, amount: 180_000 + Math.round(Math.sin(i / 2) * 60_000) + i * 5_000 })));
  }
  async debtByAging(): Promise<Result<DebtByAgingBucket[]>> {
    await delay(120);
    return Ok([
      { bucket: "0_30", amount: 18_000, debtorCount: 1 },
      { bucket: "31_60", amount: 9_000, debtorCount: 1 },
      { bucket: "61_90", amount: 18_000, debtorCount: 1 },
      { bucket: "91_180", amount: 27_000, debtorCount: 1 },
      { bucket: "180_plus", amount: 0, debtorCount: 0 },
    ]);
  }
  async demographics(): Promise<Result<{ grade: DemographicSlice[]; gender: DemographicSlice[] }>> {
    await delay(120);
    const total = store.students.length;
    const byLevel = [
      { label: "Primaire", count: store.students.filter((s) => s.level === "primaire").length },
      { label: "CEM", count: store.students.filter((s) => s.level === "cem").length },
      { label: "Lycée", count: store.students.filter((s) => s.level === "lycee").length },
    ];
    const byGender = [
      { label: "Garçons", count: store.students.filter((s) => s.gender === "male").length },
      { label: "Filles", count: store.students.filter((s) => s.gender === "female").length },
    ];
    return Ok({
      grade: byLevel.map((s) => ({ ...s, percent: total === 0 ? 0 : Math.round((s.count / total) * 100) })),
      gender: byGender.map((s) => ({ ...s, percent: total === 0 ? 0 : Math.round((s.count / total) * 100) })),
    });
  }
}

// ============================================================
// Helpers
// ============================================================
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================
// Pricing
// ============================================================
class MockPricingRepository implements PricingRepository {
  private config: PricingConfig = defaultPricingConfig;
  private config$ = new SubjectBehavior<PricingConfig>(this.config);

  observe(): Observable<PricingConfig> { return this.config$; }

  private commit(next: PricingConfig, updatedBy: string): PricingConfig {
    this.config = next;
    this.config$.set(next);
    appendAudit({
      action: AuditActions.SettingsUpdate,
      entityType: "pricing",
      entityId: "config",
      actorId: updatedBy,
      actorName: "Session courante",
      diff: { before: null, after: { summary: "pricing config updated" } },
    });
    return next;
  }

  async updateTuition(level: AcademicLevel, amount: number, updatedBy: string): Promise<Result<PricingConfig>> {
    await delay(160);
    return Ok(this.commit({ ...this.config, tuitionByLevel: { ...this.config.tuitionByLevel, [level]: amount } }, updatedBy));
  }

  async updateTransport(tier: "t1" | "t2" | "t3", amount: number, updatedBy: string): Promise<Result<PricingConfig>> {
    await delay(160);
    return Ok(this.commit({ ...this.config, transportByTier: { ...this.config.transportByTier, [tier]: amount } }, updatedBy));
  }

  async updateRegistration(amount: number, updatedBy: string): Promise<Result<PricingConfig>> {
    await delay(160);
    return Ok(this.commit({ ...this.config, registrationFee: amount }, updatedBy));
  }

  async updateMonthly(level: AcademicLevel, amount: number, updatedBy: string): Promise<Result<PricingConfig>> {
    await delay(160);
    return Ok(this.commit({ ...this.config, monthlyByLevel: { ...this.config.monthlyByLevel, [level]: amount } }, updatedBy));
  }

  async updateLatePenalty(amountPerDay: number, updatedBy: string): Promise<Result<PricingConfig>> {
    await delay(160);
    return Ok(this.commit({ ...this.config, latePenaltyPerDay: amountPerDay }, updatedBy));
  }

  async addDiscount(input: { label: string; amount: number; discountType: DiscountType }, updatedBy: string): Promise<Result<PricingConfig>> {
    await delay(180);
    const entry: PricingEntry = {
      id: `disc-${Date.now()}`,
      tenantId: TENANT_ID,
      category: "discount",
      qualifier: `disc_${Date.now()}`,
      label: input.label,
      amount: input.amount,
      discountType: input.discountType,
      isActive: true,
      updatedAt: nowIso(),
      updatedBy,
    };
    return Ok(this.commit({ ...this.config, discounts: [...this.config.discounts, entry] }, updatedBy));
  }

  async removeDiscount(id: string, updatedBy: string): Promise<Result<PricingConfig>> {
    await delay(160);
    return Ok(this.commit({ ...this.config, discounts: this.config.discounts.filter((d) => d.id !== id) }, updatedBy));
  }

  async addAdditionalService(input: { label: string; amount: number }, updatedBy: string): Promise<Result<PricingConfig>> {
    await delay(180);
    const entry: PricingEntry = {
      id: `svc-${Date.now()}`,
      tenantId: TENANT_ID,
      category: "additional",
      qualifier: `svc_${Date.now()}`,
      label: input.label,
      amount: input.amount,
      isActive: true,
      updatedAt: nowIso(),
      updatedBy,
    };
    return Ok(this.commit({ ...this.config, additionalServices: [...this.config.additionalServices, entry] }, updatedBy));
  }

  async removeAdditionalService(id: string, updatedBy: string): Promise<Result<PricingConfig>> {
    await delay(160);
    return Ok(this.commit({ ...this.config, additionalServices: this.config.additionalServices.filter((s) => s.id !== id) }, updatedBy));
  }
}

// ============================================================
// Exported singletons
// ============================================================
export const mockAuthRepository: AuthRepository = new MockAuthRepository();
export const mockParentRepository: ParentRepository = new MockParentRepository();
export const mockStudentRepository: StudentRepository = new MockStudentRepository();
export const mockClassRepository: ClassRepository = new MockClassRepository();
export const mockSubjectRepository: SubjectRepository = new MockSubjectRepository();
export const mockGradeRepository: GradeRepository = new MockGradeRepository();
export const mockAttendanceRepository: AttendanceRepository = new MockAttendanceRepository();
export const mockHomeworkRepository: HomeworkRepository = new MockHomeworkRepository();
export const mockPaymentRepository: PaymentRepository = new MockPaymentRepository();
export const mockInstallmentRepository: InstallmentRepository = new MockInstallmentRepository();
export const mockDebtRepository: DebtRepository = new MockDebtRepository();
export const mockExpenseRepository: ExpenseRepository = new MockExpenseRepository();
export const mockPersonnelRepository: PersonnelRepository = new MockPersonnelRepository();
export const mockReleveRepository: ReleveRepository = new MockReleveRepository();
export const mockAuditRepository: AuditRepository = new MockAuditRepository();
export const mockNotificationRepository: NotificationRepository = new MockNotificationRepository();
export const mockDashboardRepository: DashboardRepository = new MockDashboardRepository();
export const mockPricingRepository: PricingRepository = new MockPricingRepository();
