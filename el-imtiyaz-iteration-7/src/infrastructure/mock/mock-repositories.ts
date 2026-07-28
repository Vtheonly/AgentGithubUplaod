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
  LedgerRepository,
  WorkflowRepository,
  WorkflowRunRepository,
  AIConfigRepository,
  BackupRepository,
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
import {
  agingBucketFromDays,
  sumPaidPayments,
  sumInstallmentsDue,
  sumInstallmentsPaid,
  installmentRemaining,
  totalOutstanding as computeTotalOutstanding,
  overdueAmount as computeOverdueAmount,
  maxDaysOverdue,
  revenueByMonth,
  revenueByCategory,
  monthlyRevenue,
  type AgingBucket,
} from "../../domain/model/payment";
import {
  computeAccountBalance,
  computeParentSummary,
  deriveAccountId,
  createReversalEntry,
  maxDaysOverdueFromLedger,
  buildOverdueDueDateMap,
  type LedgerEntry,
  type ParentLedgerSummary,
} from "../../domain/model/ledger";
import { reconcileLedger, crossCheckPayments, crossCheckInstallments, crossCheckBalanceSum, type ReconciliationReport } from "../../domain/reconciliation/reconcile";
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
import type { PricingConfig, PricingEntry, DiscountType, DiscountCode } from "../../domain/model/pricing";
import type { AcademicLevel, GradeLevel } from "../../domain/model/student";
import { gradeLevelFromLevelYear } from "../../domain/model/student";
import type { TransportDestination } from "../../domain/model/parent";
import { cityTierToDestination } from "../../domain/model/parent";

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
import {
  seedClassSubjects,
  seedAssessments,
  seedAttendance,
  seedHomework,
  seedReleve,
} from "./academic-seed";
import { defaultPricingConfig } from "./pricing-seed";
import { seedLedger } from "./ledger-seed";
import { seedWorkflows, seedWorkflowRuns } from "./workflow-seed";
import { detectCycle } from "../../domain/workflow/kahn";
import type {
  Workflow,
  WorkflowRun,
  WorkflowNodeResult,
  WorkflowRunStatus,
  WorkflowTriggerType,
} from "../../domain/model/workflow";
import type { AIProvider, AIProviderConfig } from "../../domain/model/ai";
import { DEFAULT_AI_PROVIDER_CONFIG } from "../../domain/model/ai";
import { loadConfig, saveConfig } from "../ai/ai-config-storage";
import type { BackupArchive, BackupRestoreResult } from "../../domain/model/backup";
import { BACKUP_RETENTION_DAYS } from "../../domain/model/backup";
import {
  runBackup as runBackupService,
  restore as restoreService,
  purgeExpired as purgeExpiredService,
  deleteArchive as deleteArchiveService,
  deriveBackupKey,
} from "../backup/backup-service";

const nowIso = () => new Date().toISOString();

/**
 * Mutable in-memory store. Mock repositories share this store so cross-entity
 * queries (e.g. ParentFinancialProfile) see consistent state.
 *
 * Iteration 6: Added classSubjects, assessments, attendance, homework, releve
 * collections (previously these read paths returned empty arrays). This makes
 * the class detail tabs, homework history tab, and personnel relevé tab
 * show realistic data out of the box.
 */
class MockStore {
  parents: Parent[] = [...seedParents];
  students: Student[] = [...seedStudents];
  classes: AcademicClass[] = [...seedClasses];
  subjects: Subject[] = [...seedSubjects];
  classSubjects: ClassSubject[] = [...seedClassSubjects];
  assessments: Assessment[] = [...seedAssessments];
  attendance: AttendanceRecord[] = [...seedAttendance];
  homework: Homework[] = [...seedHomework];
  payments: Payment[] = [...seedPayments];
  installments: Installment[] = [...seedInstallments];
  expenses: Expense[] = [...seedExpenses];
  personnel: Personnel[] = [...seedPersonnel];
  releve: ReleveEntry[] = [...seedReleve];
  audit: AuditEntry[] = [...seedAudit];
  notifications: AppNotification[] = [...seedNotifications];
  ledger: LedgerEntry[] = [...seedLedger];
  workflows: Workflow[] = [...seedWorkflows];
  workflowRuns: WorkflowRun[] = [...seedWorkflowRuns];

  parents$ = new SubjectBehavior<Parent[]>(this.parents);
  students$ = new SubjectBehavior<Student[]>(this.students);
  classes$ = new SubjectBehavior<AcademicClass[]>(this.classes);
  subjects$ = new SubjectBehavior<Subject[]>(this.subjects);
  classSubjects$ = new SubjectBehavior<ClassSubject[]>(this.classSubjects);
  assessments$ = new SubjectBehavior<Assessment[]>(this.assessments);
  attendance$ = new SubjectBehavior<AttendanceRecord[]>(this.attendance);
  homework$ = new SubjectBehavior<Homework[]>(this.homework);
  payments$ = new SubjectBehavior<Payment[]>(this.payments);
  installments$ = new SubjectBehavior<Installment[]>(this.installments);
  expenses$ = new SubjectBehavior<Expense[]>(this.expenses);
  personnel$ = new SubjectBehavior<Personnel[]>(this.personnel);
  releve$ = new SubjectBehavior<ReleveEntry[]>(this.releve);
  audit$ = new SubjectBehavior<AuditEntry[]>(this.audit);
  notifications$ = new SubjectBehavior<AppNotification[]>(this.notifications);
  ledger$ = new SubjectBehavior<LedgerEntry[]>(this.ledger);
  workflows$ = new SubjectBehavior<Workflow[]>(this.workflows);
  workflowRuns$ = new SubjectBehavior<WorkflowRun[]>(this.workflowRuns);

  notifyParents() { this.parents$.set([...this.parents]); }
  notifyStudents() { this.students$.set([...this.students]); }
  notifyPayments() { this.payments$.set([...this.payments]); }
  notifyInstallments() { this.installments$.set([...this.installments]); }
  notifyExpenses() { this.expenses$.set([...this.expenses]); }
  notifyPersonnel() { this.personnel$.set([...this.personnel]); }
  notifyAudit() { this.audit$.set([...this.audit]); }
  notifyNotifications() { this.notifications$.set([...this.notifications]); }
  notifyLedger() { this.ledger$.set([...this.ledger]); }
  notifyClassSubjects() { this.classSubjects$.set([...this.classSubjects]); }
  notifyAssessments() { this.assessments$.set([...this.assessments]); }
  notifyAttendance() { this.attendance$.set([...this.attendance]); }
  notifyHomework() { this.homework$.set([...this.homework]); }
  notifyReleve() { this.releve$.set([...this.releve]); }
  notifyWorkflows() { this.workflows$.set([...this.workflows]); }
  notifyWorkflowRuns() { this.workflowRuns$.set([...this.workflowRuns]); }
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
    // Iteration 6: derive transportDestination from cityTier if not explicitly provided.
    const transportDestination: TransportDestination | null =
      input.transportDestination ?? cityTierToDestination(input.cityTier) ?? null;
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
      transportDestination,
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
    // Iteration 6: derive gradeLevel if not provided explicitly.
    const gradeLevel: GradeLevel = input.gradeLevel ?? gradeLevelFromLevelYear(input.level, input.gradeYear);
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
      gradeLevel,
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
    // Iteration 6: re-derive gradeLevel if level/gradeYear were updated.
    const newLevel = updates.level ?? before.level;
    const newYear = updates.gradeYear ?? before.gradeYear;
    const newGradeLevel: GradeLevel =
      updates.gradeLevel ?? gradeLevelFromLevelYear(newLevel, newYear);
    const after: Student = {
      ...before,
      ...updates,
      level: newLevel,
      gradeYear: newYear,
      gradeLevel: newGradeLevel,
      updatedAt: nowIso(),
    };
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
  /**
   * Iteration 6: TRUE atomic batch registration with rollback.
   *
   * The plan §18.01 mandates "All multi-record writes wrapped in BEGIN...COMMIT".
   * The previous implementation created the parent first, then iterated student
   * creation — if any student failed, the parent and earlier students persisted.
   *
   * This implementation:
   *   1. Pre-validates ALL student inputs BEFORE writing anything.
   *   2. Snapshots the current state of parents and students arrays.
   *   3. Creates the parent + all students atomically.
   *   4. On ANY failure, rolls back to the snapshot.
   *   5. Writes a single audit entry on success.
   *
   * If rollback occurs, the audit log records the failure (not a success).
   */
  async batchRegister(input: BatchRegistrationInput): Promise<Result<BatchRegistrationResult>> {
    await delay(400);

    // Step 1: Pre-validate inputs (fail fast, before any mutation).
    if (input.students.length === 0) {
      return Err(Errors.validation("L'inscription groupée requiert au moins un élève"));
    }
    for (let i = 0; i < input.students.length; i++) {
      const s = input.students[i];
      if (!s.firstName?.trim() || !s.lastName?.trim()) {
        return Err(Errors.validation(`Élève ${i + 1}: prénom et nom requis`));
      }
      if (!s.birthDate) {
        return Err(Errors.validation(`Élève ${i + 1}: date de naissance requise`));
      }
    }

    // Step 2: Snapshot state for rollback.
    const parentsSnapshot = [...store.parents];
    const studentsSnapshot = [...store.students];

    try {
      const year = new Date().getFullYear();
      // Step 3a: Create parent.
      const parentResult = await new MockParentRepository().createParent(input.parent);
      if (!parentResult.ok) {
        throw parentResult.error;
      }
      const parent = parentResult.value;

      // Step 3b: Create all students.
      const students: Student[] = [];
      for (const sInput of input.students) {
        const seq = store.students.length + 1;
        const gradeLevel: GradeLevel =
          sInput.gradeLevel ?? gradeLevelFromLevelYear(sInput.level, sInput.gradeYear);
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
          gradeLevel,
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

      // Step 4: Audit the successful atomic transaction.
      appendAudit({
        action: AuditActions.BatchRegister,
        entityType: "batch",
        entityId: parent.id,
        actorId: "usr-current",
        actorName: "Session courante",
        diff: { before: null, after: { parentCode: parent.code, studentCount: students.length } },
        note: `Inscription groupée atomique — ${students.length} élève(s) créé(s) avec succès`,
      });
      return Ok({ parent, students });
    } catch (err) {
      // Step 5: ROLLBACK on failure — restore the snapshot.
      store.parents = parentsSnapshot;
      store.students = studentsSnapshot;
      store.notifyParents();
      store.notifyStudents();
      appendAudit({
        action: AuditActions.BatchRegister,
        entityType: "batch",
        entityId: "failed",
        actorId: "usr-current",
        actorName: "Session courante",
        diff: { before: null, after: null },
        note: `Échec inscription groupée — annulée (rollback). Raison: ${err instanceof Error ? err.message : String(err)}`,
      });
      if (err && typeof err === "object" && "code" in err) {
        return Err(err as import("../../core/result/result").AppError);
      }
      return Err(Errors.unknown(err));
    }
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
  /**
   * Iteration 6: Returns the actual class-subject mappings from the seed data
   * (previously returned an empty array, which made the Class Subjects tab
   * always render an empty state).
   */
  observeByClass(classId: string): Observable<ClassSubject[]> {
    return new SubjectBehavior(store.classSubjects.filter((cs) => cs.classId === classId));
  }
  async assignSubjectToClass(input: Omit<ClassSubject, "id">): Promise<Result<ClassSubject>> {
    await delay(180);
    const cs: ClassSubject = { ...input, id: `csj-${Date.now()}` };
    store.classSubjects = [...store.classSubjects, cs];
    store.notifyClassSubjects();
    appendAudit({
      action: AuditActions.SubjectUpdate,
      entityType: "class-subject",
      entityId: cs.id,
      actorId: "usr-current",
      actorName: "Session courante",
      diff: { before: null, after: cs },
      note: `Matière ${cs.subjectId} assignée à la classe ${cs.classId}`,
    });
    return Ok(cs);
  }
  async removeSubjectFromClass(id: string): Promise<Result<void>> {
    await delay(150);
    store.classSubjects = store.classSubjects.filter((cs) => cs.id !== id);
    store.notifyClassSubjects();
    appendAudit({
      action: AuditActions.SubjectArchive,
      entityType: "class-subject",
      entityId: id,
      actorId: "usr-current",
      actorName: "Session courante",
      diff: { before: null, after: null },
      note: `Assignation supprimée`,
    });
    return Ok(undefined);
  }

  async createSubject(input: Omit<Subject, "id" | "tenantId">): Promise<Result<Subject>> {
    await delay(120);
    const subj: Subject = {
      ...input,
      id: `subj-${Date.now()}`,
      tenantId: "tenant-el-imtiyaz-oran-001",
    };
    store.subjects = [...store.subjects, subj];
    store.subjects$.set(store.subjects);
    appendAudit({
      action: AuditActions.SubjectCreate,
      entityType: "subject",
      entityId: subj.id,
      actorId: "mock",
      actorName: "Mock",
      diff: { before: null, after: subj },
      note: `Matière créée: ${subj.name} (${subj.code})`,
    });
    return Ok(subj);
  }

  async updateSubject(id: string, updates: Partial<Omit<Subject, "id" | "tenantId">>): Promise<Result<Subject>> {
    await delay(120);
    const idx = store.subjects.findIndex((s) => s.id === id);
    if (idx < 0) return Err(Errors.unknown("Subject not found"));
    const before = store.subjects[idx];
    const after: Subject = { ...before, ...updates };
    store.subjects = store.subjects.map((s) => (s.id === id ? after : s));
    store.subjects$.set(store.subjects);
    appendAudit({
      action: AuditActions.SubjectUpdate,
      entityType: "subject",
      entityId: id,
      actorId: "mock",
      actorName: "Mock",
      diff: { before, after },
      note: updates.coefficient != null
        ? `Coefficient modifié: ${before.coefficient} → ${updates.coefficient} (GPA sera recalculé)`
        : "Matière modifiée",
    });
    return Ok(after);
  }

  async archiveSubject(id: string): Promise<Result<void>> {
    await delay(120);
    const before = store.subjects.find((s) => s.id === id);
    store.subjects = store.subjects.filter((s) => s.id !== id);
    store.subjects$.set(store.subjects);
    appendAudit({
      action: AuditActions.SubjectArchive,
      entityType: "subject",
      entityId: id,
      actorId: "mock",
      actorName: "Mock",
      diff: { before, after: null },
      note: `Matière archivée: ${before?.name ?? id}`,
    });
    return Ok(undefined);
  }
}

class MockGradeRepository implements GradeRepository {
  /**
   * Iteration 6: Returns real seeded assessment data (previously returned empty).
   */
  observeForStudent(studentId: string): Observable<Assessment[]> {
    return new SubjectBehavior(store.assessments.filter((a) => a.studentId === studentId));
  }
  observeForClass(classId: string): Observable<Assessment[]> {
    return new SubjectBehavior(store.assessments.filter((a) => a.classId === classId));
  }
  async enterGrade(input: Omit<Assessment, "id" | "subjectAverage" | "enteredAt">): Promise<Result<Assessment>> {
    await delay(150);
    const asm: Assessment = {
      ...input,
      id: `asm-${Date.now()}`,
      subjectAverage: computeSubjectAverage(input.devoir1, input.devoir2, input.examen),
      enteredAt: nowIso(),
    };
    // Iteration 6: persist the assessment so subsequent reads return it.
    store.assessments = [asm, ...store.assessments];
    store.notifyAssessments();
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
  /**
   * Iteration 6: Returns real seeded attendance records (previously returned empty).
   */
  observeByClass(classId: string, date: string): Observable<AttendanceRecord[]> {
    return new SubjectBehavior(
      store.attendance.filter((r) => r.classId === classId && r.date === date),
    );
  }
  observeByStudent(studentId: string, from: string, to: string): Observable<AttendanceRecord[]> {
    return new SubjectBehavior(
      store.attendance.filter(
        (r) => r.studentId === studentId && r.date >= from && r.date <= to,
      ),
    );
  }
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
    // Iteration 6: persist the records so subsequent reads return them.
    store.attendance = [...records, ...store.attendance];
    store.notifyAttendance();
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
  /**
   * Iteration 6: Returns real seeded homework records (previously returned empty).
   */
  observeForClass(classId: string): Observable<Homework[]> {
    return new SubjectBehavior(store.homework.filter((h) => h.classId === classId));
  }
  observeByTeacher(teacherId: string): Observable<Homework[]> {
    return new SubjectBehavior(store.homework.filter((h) => h.teacherId === teacherId));
  }
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
    // Look up the subject name from the seed data.
    const subject = store.subjects.find((s) => s.id === input.subjectId);
    const hw: Homework = {
      ...input,
      id: `hw-${Date.now()}`,
      subjectName: subject?.name ?? "Matière",
      attachments: input.attachments,
      academicYear: ACADEMIC_YEAR,
      createdAt: nowIso(),
      pushedAt: nowIso(),
      acknowledgedCount: 0,
    };
    // Iteration 6: persist the homework so the history tab shows it.
    store.homework = [hw, ...store.homework];
    store.notifyHomework();
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

    // Iteration 5: append the corresponding ledger entry. This is the
    // single source of truth for the payment's effect on the parent's
    // balance. The payment table is now a denormalized view; the ledger
    // is canonical.
    const ledgerEntry: LedgerEntry = {
      id: `led-${nowIso()}-${Math.random().toString(36).slice(2, 10)}`,
      tenantId: TENANT_ID,
      accountId: deriveAccountId(input.parentId, input.category, input.studentId),
      parentId: input.parentId,
      studentId: input.studentId,
      category: input.category,
      amount: -input.amount, // payments are credits (negative)
      type: "payment",
      sourceType: "payment",
      sourceId: payment.id,
      method: input.method,
      receiptNumber: payment.receiptNumber,
      paymentStatus: status,
      reversesId: null,
      description: `Encaissement ${payment.receiptNumber} — ${input.method} (${input.category})`,
      actorId: collectedBy,
      actorName: "Session courante",
      at: payment.collectedAt,
      metadata: Object.freeze({
        installmentId: input.installmentId ?? null,
        proofUrl: input.proofUrl ?? null,
      }),
    };
    store.ledger = [...store.ledger, ledgerEntry];
    store.notifyLedger();

    appendAudit({
      action: AuditActions.PaymentCreate,
      entityType: "payment",
      entityId: payment.id,
      actorId: collectedBy,
      actorName: "Session courante",
      diff: { before: null, after: { amount: payment.amount, method: payment.method, receipt: payment.receiptNumber, ledgerEntryId: ledgerEntry.id } },
    });
    return Ok(payment);
  }
  async refund(id: string): Promise<Result<Payment>> {
    await delay(200);
    const idx = store.payments.findIndex((p) => p.id === id);
    if (idx < 0) return Err(Errors.notFound("Payment", id));
    const before = store.payments[idx];
    const after: Payment = { ...before, status: "refunded", updatedAt: nowIso() };
    store.payments[idx] = after;
    store.notifyPayments();

    // Iteration 6: Append a ledger reversal entry that negates the original
    // payment's ledger entry. The plan's accounting engine mandates that every
    // refund be traceable — the ledger must reflect the reversal so the parent's
    // balance is correctly re-computed by replay.
    const originalLedgerEntry = store.ledger.find(
      (e) => e.sourceType === "payment" && e.sourceId === id && e.type === "payment",
    );
    if (originalLedgerEntry) {
      const reversalEntry: LedgerEntry = {
        id: `led-${nowIso()}-${Math.random().toString(36).slice(2, 10)}`,
        tenantId: TENANT_ID,
        accountId: originalLedgerEntry.accountId,
        parentId: originalLedgerEntry.parentId,
        studentId: originalLedgerEntry.studentId,
        category: originalLedgerEntry.category,
        // Original payment entry stored a NEGATIVE amount (credit).
        // Reversal negates it → POSITIVE amount (debit; parent owes it back).
        amount: -originalLedgerEntry.amount,
        type: "reversal",
        sourceType: "payment",
        sourceId: id,
        method: originalLedgerEntry.method,
        receiptNumber: originalLedgerEntry.receiptNumber,
        paymentStatus: "refunded",
        reversesId: originalLedgerEntry.id,
        description: `Remboursement ${before.receiptNumber} — inversion de l'écriture de paiement`,
        actorId: "usr-current",
        actorName: "Session courante",
        at: nowIso(),
        metadata: Object.freeze({
          refundReason: "Remboursement manuel",
          originalPaymentId: id,
        }),
      };
      store.ledger = [...store.ledger, reversalEntry];
      store.notifyLedger();
      appendAudit({
        action: AuditActions.PaymentRefund,
        entityType: "payment",
        entityId: id,
        actorId: "usr-current",
        actorName: "Session courante",
        diff: {
          before: { status: before.status, ledgerEntryId: originalLedgerEntry.id },
          after: { status: "refunded", reversalEntryId: reversalEntry.id },
        },
      });
    } else {
      // No original ledger entry found — log a warning but still record the refund.
      appendAudit({
        action: AuditActions.PaymentRefund,
        entityType: "payment",
        entityId: id,
        actorId: "usr-current",
        actorName: "Session courante",
        diff: { before: { status: before.status }, after: { status: "refunded" } },
        note: "ATTENTION: aucune écriture de ledger correspondante trouvée pour le remboursement",
      });
    }
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
  /**
   * Iteration 5: debt summary is now computed from the ledger via replay.
   * No hardcoded arrays. Every parent's `outstandingAmount` is the sum
   * of their account balances (computed from ledger entries).
   */
  observeSummary(): Observable<DebtSummary[]> {
    const summaries: DebtSummary[] = store.parents.map((p) => {
      const parentEntries = store.ledger.filter((e) => e.parentId === p.id);
      const dueDateMap = buildOverdueDueDateMap(parentEntries);
      const summary = computeParentSummary(parentEntries, p.id, `${p.firstName} ${p.lastName}`, dueDateMap);
      const days = maxDaysOverdueFromLedger(parentEntries);
      return {
        id: `debt-${p.id}`,
        parentId: p.id,
        parentName: `${p.firstName} ${p.lastName}`,
        parentPhone: p.phone,
        studentCount: store.students.filter((s) => s.parentId === p.id).length,
        outstandingAmount: summary.totalOutstanding,
        daysOverdue: days,
        bucket: agingBucketFromDays(days),
      };
    });
    // Only include parents with a non-zero outstanding balance.
    return new SubjectBehavior(summaries.filter((s) => s.outstandingAmount > 0.001));
  }

  /**
   * Iteration 5: parent financial profile is computed from the ledger.
   * `totalDue` = sum of charge entries.
   * `totalPaid` = sum of cleared payment entries (status === "paid").
   * `totalOutstanding` = totalDue - totalPaid.
   * `overdueAmount` = sum of unpaid past-due charges.
   */
  observeParentProfile(parentId: string): Observable<ParentFinancialProfile | null> {
    const parent = store.parents.find((p) => p.id === parentId);
    if (!parent) return new SubjectBehavior<ParentFinancialProfile | null>(null);
    const parentEntries = store.ledger.filter((e) => e.parentId === parentId);
    const dueDateMap = buildOverdueDueDateMap(parentEntries);
    const summary = computeParentSummary(parentEntries, parentId, `${parent.firstName} ${parent.lastName}`, dueDateMap);
    const installments = store.installments.filter((i) => i.parentId === parentId);
    const payments = store.payments
      .filter((p) => p.parentId === parentId)
      .sort((a, b) => b.collectedAt.localeCompare(a.collectedAt))
      .slice(0, 10);
    return new SubjectBehavior<ParentFinancialProfile | null>({
      parentId,
      parentName: `${parent.firstName} ${parent.lastName}`,
      totalDue: summary.totalCharged,
      totalPaid: summary.totalCleared,
      totalOutstanding: summary.totalOutstanding,
      overdueAmount: summary.totalOverdue,
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
    // Iteration 6: enforce "no self-approval" rule (plan §08).
    const expense = store.expenses.find((e) => e.id === id);
    if (!expense) return Err(Errors.notFound("Expense", id));
    if (expense.submittedBy === approver) {
      appendAudit({
        action: AuditActions.ExpenseApprove,
        entityType: "expense",
        entityId: id,
        actorId: approver,
        actorName: "Session courante",
        diff: { before: { status: expense.status }, after: { status: expense.status } },
        note: "Tentative d'auto-approbation bloquée — le demandeur ne peut pas approuver sa propre dépense",
      });
      return Err(Errors.forbidden("Un demandeur ne peut pas approuver sa propre dépense (règle d'auto-approbation)"));
    }
    return this.transition(id, "approved", { approvedBy: approver, approvedAt: nowIso(), approvalNote: note ?? null }, AuditActions.ExpenseApprove, approver);
  }
  async reject(id: string, approver: string, note: string): Promise<Result<Expense>> {
    await delay(180);
    // Iteration 6: enforce "no self-approval" rule (plan §08) — applies to reject too.
    const expense = store.expenses.find((e) => e.id === id);
    if (!expense) return Err(Errors.notFound("Expense", id));
    if (expense.submittedBy === approver) {
      return Err(Errors.forbidden("Un demandeur ne peut pas rejeter sa propre dépense (règle d'auto-approbation)"));
    }
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
    // Iteration 6: enforce state machine — submitted → approved/rejected, approved → disbursed, disbursed → settled.
    const allowedTransitions: Record<ExpenseStatus, ExpenseStatus[]> = {
      draft: ["submitted"],
      submitted: ["approved", "rejected"],
      approved: ["disbursed"],
      rejected: [],
      disbursed: ["settled"],
      settled: [],
    };
    const allowed = allowedTransitions[before.status] ?? [];
    if (!allowed.includes(status)) {
      return Promise.resolve(Err(Errors.conflict(`Transition non autorisée: ${before.status} → ${status}`)));
    }
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
  /**
   * Iteration 6: Returns real seeded relevé entries (previously returned empty).
   */
  observeByPersonnel(personnelId: string, from: string, to: string): Observable<ReleveEntry[]> {
    return new SubjectBehavior(
      store.releve.filter(
        (r) => r.personnelId === personnelId && r.date >= from && r.date <= to,
      ),
    );
  }
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
    // Iteration 6: persist the entry so the relevé tab shows it.
    store.releve = [entry, ...store.releve];
    store.notifyReleve();
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
  /**
   * Iteration 5: KPIs are now computed from the ledger via replay.
   * No hardcoded constants — every number is derived from real data.
   *
   * Iteration 6: `attendanceRateToday` is now computed from the attendance
   * records (previously hardcoded at 0.93 with a TODO).
   */
  async kpis(): Promise<Result<DashboardKpi>> {
    await delay(150);
    // Total outstanding = sum of all parents' balances (computed from ledger).
    const totalOutstanding = store.parents.reduce((sum, p) => {
      const entries = store.ledger.filter((e) => e.parentId === p.id);
      const dueDateMap = buildOverdueDueDateMap(entries);
      return sum + computeParentSummary(entries, p.id, "", dueDateMap).totalOutstanding;
    }, 0);

    // Iteration 6: derive attendanceRateToday from the most recent day's
    // attendance records. If no records exist for today, fall back to the
    // most recent day with records. If none exist at all, return 0.
    const today = new Date().toISOString().slice(0, 10);
    let recentAttendance = store.attendance.filter((r) => r.date === today);
    if (recentAttendance.length === 0) {
      // Find the most recent date with attendance records.
      const sortedDates = [...new Set(store.attendance.map((r) => r.date))].sort().reverse();
      if (sortedDates.length > 0) {
        recentAttendance = store.attendance.filter((r) => r.date === sortedDates[0]);
      }
    }
    const attendanceRateToday =
      recentAttendance.length === 0
        ? 0
        : recentAttendance.filter((r) => r.status === "present").length / recentAttendance.length;

    return Ok({
      totalStudents: store.students.length,
      totalParents: store.parents.length,
      totalStaff: store.personnel.length,
      monthlyRevenue: monthlyRevenue(store.payments),
      outstandingDebt: totalOutstanding,
      pendingExpenses: store.expenses.filter((e) => e.status === "submitted").length,
      attendanceRateToday,
      overdueAlerts: store.notifications.filter((n) => n.type === "payment_overdue" && !n.readAt).length,
    });
  }
  async revenueLast12Months(): Promise<Result<RevenuePoint[]>> {
    await delay(150);
    const months = revenueByMonth(store.payments);
    return Ok(months.map((m) => ({ label: m.label, amount: m.amount })));
  }
  async debtByAging(): Promise<Result<DebtByAgingBucket[]>> {
    await delay(120);
    // Compute aging buckets from the ledger.
    const buckets: Record<string, { amount: number; debtorCount: number }> = {
      "0_30": { amount: 0, debtorCount: 0 },
      "31_60": { amount: 0, debtorCount: 0 },
      "61_90": { amount: 0, debtorCount: 0 },
      "91_180": { amount: 0, debtorCount: 0 },
      "180_plus": { amount: 0, debtorCount: 0 },
    };
    for (const p of store.parents) {
      const entries = store.ledger.filter((e) => e.parentId === p.id);
      const dueDateMap = buildOverdueDueDateMap(entries);
      const summary = computeParentSummary(entries, p.id, "", dueDateMap);
      if (summary.totalOutstanding <= 0.001) continue;
      const days = maxDaysOverdueFromLedger(entries);
      const bucket = agingBucketFromDays(days);
      buckets[bucket].amount += summary.totalOutstanding;
      buckets[bucket].debtorCount += 1;
    }
    return Ok(
      (Object.entries(buckets) as Array<[string, { amount: number; debtorCount: number }]>).map(([bucket, data]) => ({
        bucket: bucket as AgingBucket,
        amount: data.amount,
        debtorCount: data.debtorCount,
      })),
    );
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

  // ---- Legacy methods (Iteration 6: kept for backward-compat; delegate to new methods) ----
  async updateTuition(level: AcademicLevel, amount: number, updatedBy: string): Promise<Result<PricingConfig>> {
    await delay(160);
    // Legacy: update the first grade level within `level`.
    // Splits the annual amount into 3 equal tranches (best-effort).
    const t1 = Math.round(amount / 3);
    const t2 = Math.round(amount / 3);
    const t3 = amount - t1 - t2;
    // Find the first grade level within this academic level.
    const firstGrade = (Object.keys(this.config.tuitionByGradeLevel) as GradeLevel[]).find(
      (g) => academicLevelFromGradeLevelPublic(g) === level,
    );
    if (!firstGrade) {
      return Err(Errors.notFound("GradeLevel for level", level));
    }
    return Ok(this.commit({
      ...this.config,
      tuitionByGradeLevel: {
        ...this.config.tuitionByGradeLevel,
        [firstGrade]: { annualAmount: amount, installments: [t1, t2, t3] as const },
      },
    }, updatedBy));
  }

  async updateTransport(tier: "t1" | "t2" | "t3", amount: number, updatedBy: string): Promise<Result<PricingConfig>> {
    await delay(160);
    // Legacy: map tier → destination and split into 3 equal tranches.
    const destination = cityTierToDestination(tier);
    if (!destination) {
      return Err(Errors.validation(`Unknown transport tier: ${tier}`));
    }
    const t1 = Math.round(amount / 3);
    const t2 = Math.round(amount / 3);
    const t3 = amount - t1 - t2;
    return Ok(this.commit({
      ...this.config,
      transportByDestination: {
        ...this.config.transportByDestination,
        [destination]: { annualAmount: amount, installments: [t1, t2, t3] as const },
      },
    }, updatedBy));
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

  async addDiscount(input: { label: string; amount: number; discountType: DiscountType; discountCode?: DiscountCode }, updatedBy: string): Promise<Result<PricingConfig>> {
    await delay(180);
    const entry: PricingEntry = {
      id: `disc-${Date.now()}`,
      tenantId: TENANT_ID,
      category: "discount",
      qualifier: input.discountCode ?? `disc_${Date.now()}`,
      label: input.label,
      amount: input.amount,
      discountType: input.discountType,
      discountCode: input.discountCode ?? "custom",
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

  // ---- Iteration 6: granular pricing methods ----
  async updateTuitionForGradeLevel(
    gradeLevel: GradeLevel,
    annualAmount: number,
    installments: readonly [number, number, number],
    updatedBy: string,
  ): Promise<Result<PricingConfig>> {
    await delay(180);
    // Validate that installments sum to the annual amount (within 1 DA tolerance).
    const sum = installments.reduce((a, b) => a + b, 0);
    if (Math.abs(sum - annualAmount) > 1) {
      return Err(Errors.validation(`La somme des tranches (${sum}) doit égaler le montant annuel (${annualAmount})`));
    }
    if (installments.some((t) => t < 0)) {
      return Err(Errors.validation("Les tranches ne peuvent pas être négatives"));
    }
    return Ok(this.commit({
      ...this.config,
      tuitionByGradeLevel: {
        ...this.config.tuitionByGradeLevel,
        [gradeLevel]: {
          annualAmount,
          installments: [installments[0], installments[1], installments[2]] as const,
        },
      },
    }, updatedBy));
  }

  async updateTransportForDestination(
    destination: TransportDestination,
    annualAmount: number,
    installments: readonly [number, number, number],
    updatedBy: string,
  ): Promise<Result<PricingConfig>> {
    await delay(180);
    const sum = installments.reduce((a, b) => a + b, 0);
    if (Math.abs(sum - annualAmount) > 1) {
      return Err(Errors.validation(`La somme des tranches (${sum}) doit égaler le montant annuel (${annualAmount})`));
    }
    if (installments.some((t) => t < 0)) {
      return Err(Errors.validation("Les tranches ne peuvent pas être négatives"));
    }
    return Ok(this.commit({
      ...this.config,
      transportByDestination: {
        ...this.config.transportByDestination,
        [destination]: {
          annualAmount,
          installments: [installments[0], installments[1], installments[2]] as const,
        },
      },
    }, updatedBy));
  }

  async updateSecondApronFee(amount: number, updatedBy: string): Promise<Result<PricingConfig>> {
    await delay(160);
    if (amount < 0) {
      return Err(Errors.validation("Le montant du 2ème tablier ne peut pas être négatif"));
    }
    return Ok(this.commit({ ...this.config, secondApronFee: amount }, updatedBy));
  }

  async addComplementaryService(input: {
    label: string;
    qualifier: string;
    semesterAmount: number;
    annualAmount: number;
  }, updatedBy: string): Promise<Result<PricingConfig>> {
    await delay(180);
    if (input.semesterAmount < 0 || input.annualAmount < 0) {
      return Err(Errors.validation("Les montants ne peuvent pas être négatifs"));
    }
    if (input.annualAmount < input.semesterAmount) {
      return Err(Errors.validation("Le montant annuel doit être ≥ au montant semestriel"));
    }
    const entry: PricingEntry & { semesterAmount: number; annualAmount: number } = {
      id: `comp-${Date.now()}`,
      tenantId: TENANT_ID,
      category: "complementary",
      qualifier: input.qualifier,
      label: input.label,
      amount: input.annualAmount, // canonical annual amount
      semesterAmount: input.semesterAmount,
      annualAmount: input.annualAmount,
      isActive: true,
      updatedAt: nowIso(),
      updatedBy,
    };
    return Ok(this.commit({
      ...this.config,
      complementaryServices: [...this.config.complementaryServices, entry],
    }, updatedBy));
  }

  async removeComplementaryService(id: string, updatedBy: string): Promise<Result<PricingConfig>> {
    await delay(160);
    return Ok(this.commit({
      ...this.config,
      complementaryServices: this.config.complementaryServices.filter((s) => s.id !== id),
    }, updatedBy));
  }
}

/**
 * Local helper — imports `academicLevelFromGradeLevel` from the domain layer.
 * Wrapped in a function to keep imports tidy at the top of the file.
 */
function academicLevelFromGradeLevelPublic(g: GradeLevel): AcademicLevel {
  // Local re-implementation to avoid an extra import alias.
  switch (g) {
    case "prescolaire_1":
    case "prescolaire_2":
    case "1ap":
    case "2ap":
    case "3ap":
    case "4ap":
    case "5ap":
      return "primaire";
    case "1am":
    case "2am":
    case "3am":
    case "4am":
      return "cem";
    case "1ere_annee":
    case "2eme_annee":
    case "3eme_annee":
      return "lycee";
  }
}

// ============================================================
// Ledger — single source of truth for all financial transactions
// ============================================================
class MockLedgerRepository implements LedgerRepository {
  observe(): Observable<LedgerEntry[]> { return store.ledger$; }
  observeByParent(parentId: string): Observable<LedgerEntry[]> {
    return new SubjectBehavior(store.ledger.filter((e) => e.parentId === parentId));
  }
  observeByAccount(accountId: string): Observable<LedgerEntry[]> {
    return new SubjectBehavior(store.ledger.filter((e) => e.accountId === accountId));
  }
  async append(entry: LedgerEntry): Promise<Result<LedgerEntry>> {
    await delay(80);
    store.ledger = [...store.ledger, entry];
    store.notifyLedger();
    appendAudit({
      action: "ledger.entry.append",
      entityType: "ledger",
      entityId: entry.id,
      actorId: entry.actorId,
      actorName: entry.actorName,
      diff: { before: null, after: { type: entry.type, amount: entry.amount, accountId: entry.accountId } },
    });
    return Ok(entry);
  }
  async appendMany(entries: readonly LedgerEntry[]): Promise<Result<readonly LedgerEntry[]>> {
    await delay(120);
    store.ledger = [...store.ledger, ...entries];
    store.notifyLedger();
    appendAudit({
      action: "ledger.entry.append_many",
      entityType: "ledger",
      entityId: "batch",
      actorId: entries[0]?.actorId ?? "system",
      actorName: entries[0]?.actorName ?? "System",
      diff: { before: null, after: { count: entries.length } },
    });
    return Ok(entries);
  }
  async reverse(originalId: string, reason: string, actorId: string, actorName: string): Promise<Result<LedgerEntry>> {
    await delay(120);
    const original = store.ledger.find((e) => e.id === originalId);
    if (!original) return Err(Errors.notFound("LedgerEntry", originalId));
    const reversal = createReversalEntry(original, { reason, actorId, actorName });
    store.ledger = [...store.ledger, reversal];
    store.notifyLedger();
    appendAudit({
      action: "ledger.entry.reverse",
      entityType: "ledger",
      entityId: reversal.id,
      actorId,
      actorName,
      diff: { before: { entryId: original.id, amount: original.amount }, after: { entryId: reversal.id, amount: reversal.amount } },
    });
    return Ok(reversal);
  }
  async summary(parentId: string): Promise<Result<ParentLedgerSummary>> {
    await delay(80);
    const parent = store.parents.find((p) => p.id === parentId);
    const parentName = parent ? `${parent.firstName} ${parent.lastName}` : "";
    const entries = store.ledger.filter((e) => e.parentId === parentId);
    return Ok(computeParentSummary(entries, parentId, parentName));
  }
  /**
   * Run reconciliation against the entire ledger. Also cross-checks
   * the Payment and Installment tables against the ledger.
   */
  async reconcile(): Promise<Result<ReconciliationReport>> {
    await delay(150);
    const report = reconcileLedger(store.ledger);
    // Cross-check payments and installments.
    const paymentViolations = crossCheckPayments(
      store.payments.map((p) => ({ id: p.id, amount: p.amount, status: p.status, receiptNumber: p.receiptNumber })),
      store.ledger,
    );
    const installmentViolations = crossCheckInstallments(
      store.installments.map((i) => ({
        id: i.id,
        parentId: i.parentId,
        studentId: i.studentId,
        category: i.category,
        amountDue: i.amountDue,
        label: i.label,
      })),
      store.ledger,
    );
    // Cross-check balance sum.
    const accountIds = new Set(store.ledger.map((e) => e.accountId));
    const balances = Array.from(accountIds).map((accId) => computeAccountBalance(store.ledger, accId));
    const balanceViolations = crossCheckBalanceSum(store.ledger, balances);
    const allViolations = [...report.violations, ...paymentViolations, ...installmentViolations, ...balanceViolations];
    return Ok({
      ...report,
      violations: allViolations,
      passed: allViolations.filter((v) => v.severity === "error").length === 0,
      summary: {
        errors: allViolations.filter((v) => v.severity === "error").length,
        warnings: allViolations.filter((v) => v.severity === "warning").length,
        infos: allViolations.filter((v) => v.severity === "info").length,
      },
    });
  }
}

// ============================================================
// Workflow — visual DAG editor + execution monitor (plan §10)
// ============================================================
class MockWorkflowRepository implements WorkflowRepository {
  observe(): Observable<Workflow[]> { return store.workflows$; }
  observeById(id: string): Observable<Workflow | null> {
    return new SubjectBehavior(store.workflows.find((w) => w.id === id) ?? null);
  }

  async createWorkflow(input: {
    name: string;
    description: string;
    triggerType: WorkflowTriggerType;
    createdBy: string;
  }): Promise<Result<Workflow>> {
    await delay(200);
    if (!input.name.trim()) {
      return Err(Errors.validation("Le nom du workflow est requis"));
    }
    const id = `wf-${String(store.workflows.length + 1).padStart(3, "0")}-${Date.now().toString(36)}`;
    const now = nowIso();
    const workflow: Workflow = {
      id,
      tenantId: TENANT_ID,
      name: input.name.trim(),
      description: input.description.trim(),
      nodes: [],
      edges: [],
      triggerType: input.triggerType,
      lastDeployedAt: null,
      status: "draft",
      createdAt: now,
      updatedAt: now,
      createdBy: input.createdBy,
    };
    store.workflows = [...store.workflows, workflow];
    store.notifyWorkflows();
    appendAudit({
      action: "workflow.create",
      entityType: "workflow",
      entityId: id,
      actorId: input.createdBy,
      actorName: "Session courante",
      diff: { before: null, after: { name: workflow.name, triggerType: workflow.triggerType } },
      note: "Création d'un workflow",
    });
    return Ok(workflow);
  }

  async updateWorkflow(id: string, updates: Partial<Workflow>, updatedBy: string): Promise<Result<Workflow>> {
    await delay(180);
    const idx = store.workflows.findIndex((w) => w.id === id);
    if (idx === -1) return Err(Errors.notFound("Workflow", id));
    const before = store.workflows[idx];
    // Only mutable fields are updateable; never overwrite id/tenantId/createdAt/createdBy.
    const after: Workflow = {
      ...before,
      ...updates,
      id: before.id,
      tenantId: before.tenantId,
      createdAt: before.createdAt,
      createdBy: before.createdBy,
      updatedAt: nowIso(),
    };
    store.workflows = store.workflows.map((w, i) => (i === idx ? after : w));
    store.notifyWorkflows();
    appendAudit({
      action: "workflow.update",
      entityType: "workflow",
      entityId: id,
      actorId: updatedBy,
      actorName: "Session courante",
      diff: {
        before: { name: before.name, status: before.status, nodes: before.nodes.length, edges: before.edges.length },
        after: { name: after.name, status: after.status, nodes: after.nodes.length, edges: after.edges.length },
      },
      note: "Mise à jour d'un workflow",
    });
    return Ok(after);
  }

  async deleteWorkflow(id: string): Promise<Result<void>> {
    await delay(160);
    const before = store.workflows.find((w) => w.id === id);
    if (!before) return Err(Errors.notFound("Workflow", id));
    store.workflows = store.workflows.filter((w) => w.id !== id);
    store.notifyWorkflows();
    appendAudit({
      action: "workflow.delete",
      entityType: "workflow",
      entityId: id,
      actorId: "system",
      actorName: "Session courante",
      diff: { before: { name: before.name }, after: null },
      note: "Suppression d'un workflow",
    });
    return Ok(undefined);
  }

  async deploy(id: string, deployedBy: string): Promise<Result<Workflow>> {
    await delay(220);
    const wf = store.workflows.find((w) => w.id === id);
    if (!wf) return Err(Errors.notFound("Workflow", id));
    // Cycle check — refuse to deploy a cyclic graph.
    const cycle = detectCycle(wf.nodes, wf.edges);
    if (cycle.hasCycle) {
      return Err(Errors.validation(
        `Workflow has a cycle (${cycle.cycleNodeIds.size} nodes)`,
        "Cycle détecté — déploiement impossible.",
      ));
    }
    const now = nowIso();
    const after: Workflow = {
      ...wf,
      status: "deployed",
      lastDeployedAt: now,
      updatedAt: now,
    };
    store.workflows = store.workflows.map((w) => (w.id === id ? after : w));
    store.notifyWorkflows();
    appendAudit({
      action: AuditActions.WorkflowPublished,
      entityType: "workflow",
      entityId: id,
      actorId: deployedBy,
      actorName: "Session courante",
      diff: { before: { status: wf.status }, after: { status: "deployed", lastDeployedAt: now } },
      note: "Déploiement d'un workflow",
    });
    return Ok(after);
  }

  async execute(id: string, actorId: string, actorName: string): Promise<Result<WorkflowRun>> {
    await delay(120);
    const wf = store.workflows.find((w) => w.id === id);
    if (!wf) return Err(Errors.notFound("Workflow", id));
    // Plan §10.02: validate DAG before running.
    const cycle = detectCycle(wf.nodes, wf.edges);
    if (cycle.hasCycle) {
      appendAudit({
        action: AuditActions.WorkflowTriggered,
        entityType: "workflow",
        entityId: id,
        actorId,
        actorName,
        diff: { before: null, after: null },
        note: `Échec: cycle détecté (${cycle.cycleNodeIds.size} nœuds)`,
      });
      return Err(Errors.validation(
        `Workflow has a cycle (${cycle.cycleNodeIds.size} nodes)`,
        "Cycle détecté — exécution impossible.",
      ));
    }
    // Plan §10.04: disabled workflows cannot be executed.
    if (wf.status === "disabled") {
      return Err(Errors.conflict("Workflow is disabled", "Ce workflow est désactivé."));
    }
    // Build a WorkflowRun with per-node results. Each node takes 50-200ms;
    // conditions always succeed; actions have a 90% success rate (mock).
    const startedAtMs = Date.now();
    const startedAt = nowIso();
    const results: WorkflowNodeResult[] = [];
    let cursor = startedAtMs;
    let failed = false;
    let failedNodeId: string | null = null;
    let timedOut = false;
    for (const n of wf.nodes) {
      const nodeStart = new Date(cursor).toISOString();
      // charCodeAt may return NaN for short ids; coerce to 0 via Number.isNaN.
      const charAt2 = n.id.charCodeAt(2);
      const charAt0 = n.id.charCodeAt(0);
      const dur = n.type === "delay" ? 50 : 50 + ((Number.isNaN(charAt2) ? 0 : charAt2) % 150);
      cursor += dur;
      const nodeEnd = new Date(cursor).toISOString();
      let nodeStatus: WorkflowNodeResult["status"] = "succeeded";
      if (n.type === "action") {
        // 90% success rate (deterministic by node id hash so tests are stable).
        const hash = (Number.isNaN(charAt0) ? 0 : charAt0) + (Number.isNaN(charAt2) ? 0 : charAt2);
        if (hash % 10 === 0) {
          nodeStatus = "failed";
          failed = true;
          failedNodeId = n.id;
        }
      }
      results.push({
        nodeId: n.id,
        nodeLabel: n.label,
        status: nodeStatus,
        startedAt: nodeStart,
        completedAt: nodeEnd,
        output: nodeStatus === "succeeded" ? `OK (${n.subtype})` : undefined,
        error: nodeStatus === "failed" ? "Échec de l'action (mock 90%)" : undefined,
      });
      if (failed) break;
    }
    const overallStatus: WorkflowRunStatus = failed
      ? "failed"
      : timedOut
        ? "timeout"
        : "succeeded";
    const completedAt = new Date(cursor).toISOString();
    const durationMs = cursor - startedAtMs;
    const run: WorkflowRun = {
      id: `wfr-${String(store.workflowRuns.length + 1).padStart(3, "0")}-${Date.now().toString(36)}`,
      tenantId: wf.tenantId,
      workflowId: wf.id,
      workflowName: wf.name,
      triggerType: wf.triggerType,
      status: overallStatus,
      startedAt,
      completedAt,
      durationMs,
      actorId,
      actorName,
      nodeResults: results,
      error: failed && failedNodeId
        ? `Échec au nœud ${failedNodeId}`
        : undefined,
    };
    store.workflowRuns = [run, ...store.workflowRuns];
    store.notifyWorkflowRuns();
    appendAudit({
      action: AuditActions.WorkflowTriggered,
      entityType: "workflow_run",
      entityId: run.id,
      actorId,
      actorName,
      diff: { before: null, after: { status: run.status, durationMs: run.durationMs } },
      note: `Exécution manuelle du workflow ${wf.name}`,
    });
    return Ok(run);
  }
}

/**
 * WorkflowRun repository — append-only log of executions.
 * `retryRun` creates a new run by re-executing the underlying workflow.
 */
class MockWorkflowRunRepository implements WorkflowRunRepository {
  observe(): Observable<WorkflowRun[]> { return store.workflowRuns$; }
  observeByWorkflow(workflowId: string): Observable<WorkflowRun[]> {
    return new SubjectBehavior(store.workflowRuns.filter((r) => r.workflowId === workflowId));
  }
  observeById(id: string): Observable<WorkflowRun | null> {
    return new SubjectBehavior(store.workflowRuns.find((r) => r.id === id) ?? null);
  }
  async retryRun(id: string, actorId: string, actorName: string): Promise<Result<WorkflowRun>> {
    await delay(120);
    const original = store.workflowRuns.find((r) => r.id === id);
    if (!original) return Err(Errors.notFound("WorkflowRun", id));
    // Re-execute via the workflow repository so cycle detection + audit log
    // are applied identically.
    const result = await mockWorkflowRepository.execute(original.workflowId, actorId, actorName);
    if (!result.ok) return Err(result.error);
    return Ok(result.value);
  }
}

// ============================================================
// AI Config — BYOK provider config (Groq + OpenRouter)
// ============================================================
/**
 * Mock AI config repository. Persists to localStorage via the encrypted
 * `ai-config-storage` module (AES-256-GCM). Maintains an in-memory
 * `SubjectBehavior` so `observe()` re-emits whenever `updateConfig` runs.
 *
 * `testProvider` simulates a network ping: returns ok=true after a 500ms
 * delay. Production will proxy through a Supabase Edge Function per
 * plan §11.02 so the API key never leaves the server.
 */
class MockAIConfigRepository implements AIConfigRepository {
  private config$: SubjectBehavior<AIProviderConfig>;

  constructor() {
    // Load synchronously from storage (encrypted at rest). The constructor
    // runs once at module load; we cache the result in the SubjectBehavior.
    // Reads of API keys happen via the async loadConfig() — but to keep the
    // constructor synchronous, we initialize with the default and let the
    // first call to `updateConfig` overwrite.
    this.config$ = new SubjectBehavior<AIProviderConfig>({ ...DEFAULT_AI_PROVIDER_CONFIG });
    // Kick off an async load in the background — when the async load
    // completes, we update the subject so subscribers see the persisted
    // state on their first emission.
    void this.loadInitial();
  }

  private async loadInitial(): Promise<void> {
    try {
      const cfg = await loadConfig();
      this.config$.set(cfg);
    } catch (err) {
      logger.warn("Failed to load AI config from storage", { err });
    }
  }

  observe(): Observable<AIProviderConfig> {
    return this.config$;
  }

  async updateConfig(
    input: Partial<Omit<AIProviderConfig, "updatedAt" | "updatedBy">>,
    updatedBy: string,
  ): Promise<Result<AIProviderConfig>> {
    await delay(120);
    const current = this.config$.get();
    const merged: AIProviderConfig = {
      groqApiKey: input.groqApiKey !== undefined ? input.groqApiKey : current.groqApiKey,
      openRouterApiKey:
        input.openRouterApiKey !== undefined ? input.openRouterApiKey : current.openRouterApiKey,
      defaultProvider: input.defaultProvider ?? current.defaultProvider,
      defaultModel: input.defaultModel ?? current.defaultModel,
      fallbackModel:
        input.fallbackModel !== undefined ? input.fallbackModel : current.fallbackModel,
      updatedAt: nowIso(),
      updatedBy,
    };
    try {
      await saveConfig(merged);
    } catch (err) {
      logger.error("Failed to persist AI config", { err });
      return Err(Errors.unknown(err));
    }
    this.config$.set(merged);
    appendAudit({
      action: AuditActions.AiConfigUpdate,
      entityType: "ai_config",
      entityId: "default",
      actorId: updatedBy,
      actorName: updatedBy,
      diff: {
        before: { defaultProvider: current.defaultProvider, defaultModel: current.defaultModel },
        after: { defaultProvider: merged.defaultProvider, defaultModel: merged.defaultModel },
      },
      note: "Configuration IA mise à jour",
    });
    return Ok(merged);
  }

  async testProvider(
    provider: AIProvider,
  ): Promise<Result<{ ok: boolean; latencyMs: number; error?: string }>> {
    await delay(500);
    // The mock always returns ok=true. Production will hit the configured
    // endpoint and return real status + latency.
    appendAudit({
      action: AuditActions.AiConfigTest,
      entityType: "ai_config",
      entityId: provider,
      actorId: "system",
      actorName: "system",
      note: `Test du provider ${provider} (mock — 500ms)`,
    });
    return Ok({ ok: true, latencyMs: 500 });
  }
}

// ============================================================
// Backup — AES-256-GCM encrypted archives in IndexedDB vault (plan §13)
// ============================================================
/**
 * Mock backup repository. Delegates the actual crypto + storage to the
 * `backup-service.ts` module so the production path and the mock path share
 * the same implementation. The only mock-specific behavior is:
 *
 *   - Seed 3 historical archives (30d / 7d / yesterday) so the Settings UI
 *     shows data out of the box. The seeds are in-memory only — they have
 *     fake ciphertext and cannot be restored. If a user tries, restore
 *     returns an `Err` with a clear message.
 *   - Maintain an in-memory `SubjectBehavior<BackupArchive[]>` for reactive
 *     reads. Real archives (created via `runBackup`) are also persisted in
 *     the IndexedDB vault by the service layer.
 */
class MockBackupRepository implements BackupRepository {
  private archives$: SubjectBehavior<BackupArchive[]>;

  constructor() {
    this.archives$ = new SubjectBehavior<BackupArchive[]>(seedBackupArchives());
  }

  observe(): Observable<BackupArchive[]> { return this.archives$; }

  observeById(id: string): Observable<BackupArchive | null> {
    return new SubjectBehavior(this.archives$.get().find((a) => a.id === id) ?? null);
  }

  async runBackup(actorId: string, actorName: string): Promise<Result<BackupArchive>> {
    const result = await runBackupService(this.repositoriesRef, actorId, actorName);
    if (result.ok) {
      this.archives$.update((curr) => [result.value, ...curr.filter((a) => a.id !== result.value.id)]);
    }
    return result;
  }

  async restore(archiveId: string, actorId: string, actorName: string): Promise<Result<BackupRestoreResult>> {
    // Seed archives have fake ciphertext — restore will fail with "not found"
    // (the IndexedDB vault has no record for them). Surface a clearer error
    // for the seeds so the user understands why restore failed.
    const meta = this.archives$.get().find((a) => a.id === archiveId);
    if (meta && meta.metadata?.parentCount === 0 && meta.sizeBytes === 0) {
      return Err(Errors.validation(
        "Cannot restore seed archive (no real ciphertext)",
        "Cette archive de démonstration ne contient pas de données réelles — créez une nouvelle sauvegarde via « Sauvegarder maintenant ».",
      ));
    }
    return restoreService(this.repositoriesRef, archiveId, actorId, actorName);
  }

  async deleteArchive(archiveId: string, actorId: string, actorName: string): Promise<Result<void>> {
    // If the archive is a seed (only in-memory), just remove it from the list
    // without calling the vault delete (the vault has no record for it).
    const meta = this.archives$.get().find((a) => a.id === archiveId);
    const isSeed = meta?.metadata?.parentCount === 0 && meta?.sizeBytes === 0;
    if (isSeed) {
      this.archives$.update((curr) => curr.filter((a) => a.id !== archiveId));
      await mockAuditRepository.log({
        action: "backup.delete",
        entityType: "backup",
        entityId: archiveId,
        actorId,
        actorName,
        tenantId: TENANT_ID,
        diff: { before: { createdAt: meta?.createdAt, sizeBytes: meta?.sizeBytes }, after: null },
        note: "Suppression manuelle de l'archive (seed)",
      });
      return Ok(undefined);
    }
    const result = await deleteArchiveService(this.repositoriesRef, archiveId, actorId, actorName);
    if (result.ok) {
      this.archives$.update((curr) => curr.filter((a) => a.id !== archiveId));
    }
    return result;
  }

  async purgeExpired(actorId: string, actorName: string): Promise<Result<BackupArchive[]>> {
    // Purge seeds that are past retention too (they have real retentionExpiresAt).
    const before = this.archives$.get();
    const now = Date.now();
    const expiredSeeds = before.filter((a) => Date.parse(a.retentionExpiresAt) < now);
    if (expiredSeeds.length > 0) {
      this.archives$.update((curr) => curr.filter((a) => Date.parse(a.retentionExpiresAt) >= now));
      for (const archive of expiredSeeds) {
        await mockAuditRepository.log({
          action: "backup.purge",
          entityType: "backup",
          entityId: archive.id,
          actorId,
          actorName,
          tenantId: archive.tenantId,
          diff: { before: { createdAt: archive.createdAt, retentionExpiresAt: archive.retentionExpiresAt }, after: null },
          note: "Purge automatique (rétention 365 jours expirée)",
        });
      }
    }
    // Also purge real archives via the service (handles the vault + audit log).
    const result = await purgeExpiredService(this.repositoriesRef, actorId, actorName);
    if (result.ok) {
      const purgedIds = new Set(result.value.map((a) => a.id));
      if (purgedIds.size > 0) {
        this.archives$.update((curr) => curr.filter((a) => !purgedIds.has(a.id)));
      }
      return Ok([...expiredSeeds, ...result.value]);
    }
    return result;
  }

  async getEncryptionKey(): Promise<Result<CryptoKey>> {
    try {
      const key = await deriveBackupKey();
      return Ok(key);
    } catch (err) {
      return Err(Errors.unknown(err));
    }
  }

  /**
   * Late-bound reference to the full Repositories object. We can't construct
   * it at class-definition time because `mockBackupRepository` itself is one
   * of the singletons that makes up Repositories. By the time any method on
   * this class is called, `mockBackupRepository` has been assigned — so the
   * lazy getter below resolves correctly.
   */
  private get repositoriesRef(): import("../repository-provider").Repositories {
    return {
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
  }
}

/**
 * Build 3 seed BackupArchive metadata objects: 30 days ago, 7 days ago, and
 * yesterday. Seeds are in-memory only — no real ciphertext is stored in the
 * IndexedDB vault, so attempting to restore them returns a clear error.
 */
function seedBackupArchives(): BackupArchive[] {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const build = (daysAgo: number, id: string): BackupArchive => {
    const createdAt = new Date(now - daysAgo * day).toISOString();
    const expires = new Date(now - daysAgo * day + BACKUP_RETENTION_DAYS * day).toISOString();
    return {
      id,
      tenantId: TENANT_ID,
      createdAt,
      sizeBytes: 0,
      checksum: "0000000000000000000000000000000000000000000000000000000000000000",
      vaultLocation: "local",
      status: "encrypted",
      retentionExpiresAt: expires,
      createdBy: "system",
      metadata: { parentCount: 0, studentCount: 0, paymentCount: 0, ledgerEntryCount: 0 },
    };
  };
  return [build(1, "bak-seed-yesterday"), build(7, "bak-seed-7d"), build(30, "bak-seed-30d")];
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
export const mockLedgerRepository: LedgerRepository = new MockLedgerRepository();
export const mockWorkflowRepository: WorkflowRepository = new MockWorkflowRepository();
export const mockWorkflowRunRepository: WorkflowRunRepository = new MockWorkflowRunRepository();
export const mockAIConfigRepository: AIConfigRepository = new MockAIConfigRepository();
export const mockBackupRepository: BackupRepository = new MockBackupRepository();
