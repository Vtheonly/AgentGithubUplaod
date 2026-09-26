/**
 * T-420 / IMPORT-114 — the partial-rollback surfacing (104th session,
 * 2026-09-27 — the issue-#20 fix).
 *
 * THE DEFECT (live evidence): under pool exhaustion the compensating
 * rollback died partway — 384 of 847 created students were soft-deleted,
 * 463 survived from a "failed" import — and the engine swallowed the
 * rollback failure. The user was shown "l'import a été annulé" while the
 * database kept a corrupted half-state (the exact state the issue-#20
 * forensics reconstructed: 753 alive students with no financial data).
 *
 * What this suite pins:
 *
 *   1. A FULLY-SUCCESSFUL rollback keeps the ORIGINAL error message (no
 *      noise on the happy failure path).
 *   2. A PARTIAL rollback (some deleteStudent calls throw) surfaces the
 *      PARTIAL_ROLLBACK_STATE warning: the thrown error names the counts
 *      (N élèves non annulés) and warns the database is in a partial state.
 *   3. A rollback that itself THROWS entirely still propagates the ORIGINAL
 *      error (the original failure is never masked).
 *
 * Run:
 *   npx vitest run src/tests/infrastructure/t-420-partial-rollback-surfacing.test.ts
 */
import { describe, expect, it } from "vitest";
import { ImportEngine } from "../../infrastructure/excel/import-engine";
import {
  RepositoryStorageAdapter,
} from "../../infrastructure/excel/import-engine/storage/repository-adapter";
import type { ParentRepository, StudentRepository, LedgerRepository, PaymentRepository, InstallmentRepository, Observable } from "../../domain/repository/repository";
import type { Result } from "../../core/result";
import { Ok, Err } from "../../core/result";
import { Errors } from "../../core/app-error";
import type { Parent, CreateParentInput, UpdateParentInput } from "../../domain/model/parent";
import type { Student, CreateStudentInput } from "../../domain/model/student";
import type { LedgerEntry } from "../../domain/model/ledger";
import { SubjectBehavior } from "../../infrastructure/mock/subject-behavior";

/* ── Stubs (the t-105 convention) ─────────────────────────────────────────── */

class StubParentRepo implements ParentRepository {
  readonly rows = new Map<string, Parent>();
  private readonly cache = new SubjectBehavior<Parent[]>([]);
  observe(): Observable<Parent[]> { return this.cache; }
  observeById(id: string): Observable<Parent | null> {
    return new SubjectBehavior<Parent | null>(this.rows.get(id) ?? null);
  }
  async search(q: string): Promise<Result<Parent[]>> {
    if (!q.trim()) return Ok([...this.rows.values()]);
    return Ok([]);
  }
  async createParent(input: CreateParentInput): Promise<Result<Parent>> {
    const id = `par-${this.rows.size + 1}`;
    const now = new Date().toISOString();
    const parent: Parent = {
      id, tenantId: "t", code: `PAR-${id}`,
      firstName: input.firstName, lastName: input.lastName,
      displayName: input.displayName ?? null, gender: input.gender,
      phone: input.phone, whatsapp: null, email: null, occupation: null,
      address: null, cityTier: null, transportDestination: null,
      preferredLanguage: "fr", avatarUrl: null, createdAt: now, updatedAt: now,
    };
    this.rows.set(id, parent);
    return Ok(parent);
  }
  async updateParent(id: string, u: UpdateParentInput): Promise<Result<Parent>> {
    const e = this.rows.get(id);
    if (!e) return Err(Errors.notFound("Parent", id));
    const u2 = { ...e, ...u } as Parent;
    this.rows.set(id, u2);
    return Ok(u2);
  }
  async deleteParent(id: string): Promise<Result<void>> {
    this.rows.delete(id);
    return Ok(undefined);
  }
}

class StubStudentRepo implements StudentRepository {
  readonly rows = new Map<string, Student>();
  private readonly cache = new SubjectBehavior<Student[]>([]);
  /** When set, deleteStudent(id) THROWS for the first `failCount` calls. */
  failDeletesFrom = Number.POSITIVE_INFINITY;
  failDeletesCount = 0;
  private deleteCalls = 0;
  observe(): Observable<Student[]> { return this.cache; }
  observeByParent(): Observable<Student[]> { return new SubjectBehavior<Student[]>([]); }
  observeByClass(): Observable<Student[]> { return new SubjectBehavior<Student[]>([]); }
  observeById(): Observable<Student | null> { return new SubjectBehavior<Student | null>(null); }
  async search(q: string): Promise<Result<Student[]>> {
    if (!q.trim()) return Ok([...this.rows.values()]);
    return Ok([]);
  }
  async createStudent(parentId: string, input: CreateStudentInput): Promise<Result<Student>> {
    const id = `stu-${this.rows.size + 1}`;
    const now = new Date().toISOString();
    const student: Student = {
      id, tenantId: "t", parentId,
      code: `ELV-${id}`,
      firstName: input.firstName, lastName: input.lastName,
      displayName: input.displayName ?? null, birthDate: null,
      gender: input.gender, level: input.level, gradeYear: 1,
      gradeLevel: input.gradeLevel ?? "1ap", transportTier: null,
      classId: null, photoUrl: null, medicalNotes: null,
      status: "active", paymentPlan: "tranches",
      enrollmentDate: now.slice(0, 10), createdAt: now, updatedAt: now,
    } as unknown as Student;
    this.rows.set(id, student);
    return Ok(student);
  }
  async updateStudent(id: string, u: Partial<CreateStudentInput>): Promise<Result<Student>> {
    const e = this.rows.get(id);
    if (!e) return Err(Errors.notFound("Student", id));
    const u2 = { ...e, ...u } as Student;
    this.rows.set(id, u2);
    return Ok(u2);
  }
  async deleteStudent(id: string): Promise<Result<void>> {
    this.deleteCalls += 1;
    if (this.deleteCalls > this.failDeletesFrom && this.deleteCalls <= this.failDeletesFrom + this.failDeletesCount) {
      throw new Error("Timed out acquiring connection from connection pool");
    }
    this.rows.delete(id);
    return Ok(undefined);
  }
  async batchRegister() { return Err(Errors.server("stub")); }
  async promote() { return Err(Errors.server("stub")); }
  async addStudentDocument() { return Err(Errors.server("stub")); }
  async removeStudentDocument() { return Err(Errors.server("stub")); }
}

/** A ledger repo whose bulkAppend ALWAYS throws — the flush-failure trigger. */
class ThrowingLedgerRepo {
  readonly rows: LedgerEntry[] = [];
  observe(): Observable<LedgerEntry[]> { return new SubjectBehavior<LedgerEntry[]>(this.rows); }
  observeByParent(): Observable<LedgerEntry[]> { return new SubjectBehavior<LedgerEntry[]>(this.rows); }
  observeByAccount(): Observable<LedgerEntry[]> { return new SubjectBehavior<LedgerEntry[]>(this.rows); }
  async append(): Promise<Result<LedgerEntry>> { return Err(Errors.server("stub")); }
  async appendMany(e: readonly LedgerEntry[]): Promise<Result<readonly LedgerEntry[]>> {
    return Err(Errors.server(`appendMany: ${e.length} échecs (stub)`));
  }
  async bulkAppend(): Promise<Result<readonly LedgerEntry[]>> {
    throw new Error("simulated pool-exhausted ledger flush");
  }
  async reverse(): Promise<Result<LedgerEntry>> { return Err(Errors.server("stub")); }
  async summary() { return Err(Errors.server("stub")); }
  async reconcile() { return Err(Errors.server("stub")); }
}

const stubPayments = {
  observe: () => new SubjectBehavior<unknown[]>([]),
  observeByParent: () => new SubjectBehavior<unknown[]>([]),
  observeByStudent: () => new SubjectBehavior<unknown[]>([]),
  observeById: () => new SubjectBehavior<unknown>(null),
  collect: async () => Err(Errors.server("stub")),
  refund: async () => Err(Errors.server("stub")),
  markCleared: async () => Err(Errors.server("stub")),
  markBounced: async () => Err(Errors.server("stub")),
  adjust: async () => Err(Errors.server("stub")),
  generateReceipt: async () => Err(Errors.server("stub")),
  appendManualCharge: async () => Err(Errors.server("stub")),
  seed: async () => undefined,
} as unknown as PaymentRepository;

const stubInstallments = {
  observe: () => new SubjectBehavior<unknown[]>([]),
  observeByParent: () => new SubjectBehavior<unknown[]>([]),
  observeByStudent: () => new SubjectBehavior<unknown[]>([]),
  observeById: () => new SubjectBehavior<unknown>(null),
  markPaid: async () => Err(Errors.server("stub")),
  allocatePayment: async () => Err(Errors.server("stub")),
  updateDueDate: async () => Err(Errors.server("stub")),
  regenerateForCycle: async () => Err(Errors.server("stub")),
  findOverdue: async () => Err(Errors.server("stub")),
  importInstallment: async () => Err(Errors.server("stub")),
  bulkImportInstallments: async () => Err(Errors.server("stub")),
} as unknown as InstallmentRepository;

function makeEngine(students: StubStudentRepo): ImportEngine {
  const parents = new StubParentRepo();
  const adapter = new RepositoryStorageAdapter({
    parents, students,
    ledger: new ThrowingLedgerRepo() as unknown as LedgerRepository,
    payments: stubPayments,
    installments: stubInstallments,
    tenantId: "t", actorId: "test", actorName: "Test",
  });
  return new ImportEngine({
    storage: adapter,
    auditSink: { async logAction() { /* no-op */ } },
  });
}

/** A one-row ETAT workbook (the real config drives detection). */
async function oneRowWorkbook(): Promise<Uint8Array> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("ETAT 20262027");
  ws.addRow([
    "", "INFOS", "E-MAIL", "NEM", "TUTEUR", "", "niveau", "CLASSE", "OPTION",
    "REMISE", "JUSTIFICATION", "DEVIS ANNUEL", "REMBOURCEMENT", "DETTES",
    "REGLEMENTS DETTES", "TOTAL VERSEMENTS", "TOTAL*CREANCE", "FI", "V1", "2V",
    "v3", "DISTINATION", "1T", "T2", "t3",
    "PSY1", "PSY2", "PSY3", "PSY4", "PSY5", "PSY6", "PSY7", "PSY8", "PSY9",
    "PSY10", "PSY11", "PSY12", "PSY13", "PSY14",
    "CREANCE SEPT", "CREANCE SEPT", "CREANCE SEPT", "TT CREANCE",
    "COURS SUP", "LIVRES", "CLUB", "SORTIES",
  ]);
  ws.addRow([null, null, null, "0550000111", null, "ROLLBACK TEST ENFANT", "PRIM", "CE1", null,
    null, null, 240000, null, 0, null, null, null,
    25000, 100000, null, null, null, null, null, null]);
  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}

/* ── The pins ─────────────────────────────────────────────────────────────── */

describe("T-420 / IMPORT-114 — partial-rollback surfacing", () => {
  it("1 — a fully-successful rollback keeps the ORIGINAL error (no noise)", async () => {
    const students = new StubStudentRepo();
    const engine = makeEngine(students);
    const bytes = await oneRowWorkbook();
    // The ledger flush throws → the import fails → the rollback deletes the
    // 1 created student successfully → the ORIGINAL error propagates as-is.
    await expect(
      engine.importFile(bytes, "rollback-test.xlsx", { dryRun: false }),
    ).rejects.toThrow(/simulated pool-exhausted ledger flush/);
    // The rollback fully compensated.
    expect(students.rows.size).toBe(0);
  });

  it("2 — a PARTIAL rollback surfaces the PARTIAL_ROLLBACK_STATE warning with the counts", async () => {
    const students = new StubStudentRepo();
    // The FIRST deleteStudent call throws (the pool died mid-rollback) —
    // the live issue-#20 shape: some deletes land, some don't.
    students.failDeletesFrom = 0;
    students.failDeletesCount = 1;
    const engine = makeEngine(students);
    const bytes = await oneRowWorkbook();
    await expect(
      engine.importFile(bytes, "rollback-test.xlsx", { dryRun: false }),
    ).rejects.toThrow(/ATTENTION : le rollback n'a PAS pu annuler 1 élève\(s\) et 0 parent\(s\)/);
    // The student SURVIVED (the compensation could not reach it) — the DB
    // is partial, exactly like the live evidence (463 survivors).
    expect(students.rows.size).toBe(1);
  });

  it("3 — the outcome is queryable on the adapter (getRollbackOutcome)", async () => {
    const students = new StubStudentRepo();
    students.failDeletesFrom = 0;
    students.failDeletesCount = 1;
    const engine = makeEngine(students);
    const bytes = await oneRowWorkbook();
    await expect(
      engine.importFile(bytes, "rollback-test.xlsx", { dryRun: false }),
    ).rejects.toThrow();
    const storage = engine.getStorage() as RepositoryStorageAdapter;
    const outcome = storage.getRollbackOutcome();
    expect(outcome).not.toBeNull();
    expect(outcome!.failedStudents).toBe(1);
    expect(outcome!.studentsDeleted).toBe(0);
  });
});
