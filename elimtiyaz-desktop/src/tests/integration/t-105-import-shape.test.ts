/**
 * T-105 — Excel import shape invariants (regression for DATA-010 + the
 * C3 schedule-vs-ledger alignment).
 *
 * Imports the REAL `Suivis clients  2026_2027.xlsx` through the full
 * import pipeline (ImportEngine → RepositoryStorageAdapter → fast
 * in-memory stubs, mirroring real-excel-import.test.ts) and asserts the
 * shapes that migration 0062/0063 had to repair live NEVER come back:
 *
 *   1. DATA-010 — NO "Remise sur devis" adjustment may be written: the
 *      workbook's DEVIS ANNUEL (column L) is already net of the remise
 *      (its formula is "components − J", e.g. row 2: '=25000+205000+35000-J2').
 *      The pre-T-105 import wrote the devis charge AND a −remise adjustment,
 *      double-discounting 223 parents (Σ −9,709,700 DZD, fixed live by
 *      migration 0063).
 *
 *   2. C3 on fresh import — Σ installments amountDue == Σ(devis + dettes −
 *      remboursement) across the corpus, so the tranche schedule explains
 *      the ledger without a reconciliation migration.
 *
 *   3. The ledger net obligation == Σ(devis + dettes) (charges only — no
 *      phantom discount entries).
 */
import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import ExcelJS from "exceljs";
import { ImportEngine } from "../../infrastructure/excel/import-engine";
import { RepositoryStorageAdapter } from "../../infrastructure/excel/import-engine/storage/repository-adapter";
import type {
  ParentRepository, StudentRepository, LedgerRepository, PaymentRepository,
  InstallmentRepository, Observable, ImportInstallmentInput,
} from "../../domain/repository/repository";
import type { Result } from "../../core/result";
import { Ok, Err } from "../../core/result";
import { Errors } from "../../core/app-error";
import type { Parent, CreateParentInput, UpdateParentInput } from "../../domain/model/parent";
import type { Student, CreateStudentInput } from "../../domain/model/student";
import type { LedgerEntry } from "../../domain/model/ledger";
import type { Payment, Installment, CollectPaymentInput, PaymentCategory } from "../../domain/model/payment";
import { SubjectBehavior } from "../../infrastructure/mock/subject-behavior";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const XLSX_CANDIDATES = [
  path.join(REPO_ROOT, "Suivis clients  2026_2027.xlsx"),
  path.join(REPO_ROOT, "..", "Suivis clients  2026_2027.xlsx"),
];
const XLSX_PATH = XLSX_CANDIDATES.find((p) => fs.existsSync(p));
const describeOrSkip = XLSX_PATH ? describe : describe.skip;
const TEST_TIMEOUT_MS = 120_000;

// ── Fast in-memory stub repositories (same shape as real-excel-import) ──────

class FastParentRepo implements ParentRepository {
  private readonly rows = new Map<string, Parent>();
  private readonly cache = new SubjectBehavior<Parent[]>([]);

  observe(): Observable<Parent[]> { return this.cache; }
  observeById(id: string): Observable<Parent | null> {
    return new SubjectBehavior<Parent | null>(this.rows.get(id) ?? null);
  }
  async search(query: string): Promise<Result<Parent[]>> {
    const q = query.toLowerCase().trim();
    if (!q) return Ok([...this.rows.values()]);
    return Ok([...this.rows.values()].filter((p) =>
      `${p.firstName} ${p.lastName} ${p.displayName ?? ""} ${p.phone} ${p.code}`.toLowerCase().includes(q),
    ));
  }
  async createParent(input: CreateParentInput): Promise<Result<Parent>> {
    const id = `par-${String(this.rows.size + 1).padStart(3, "0")}`;
    const now = new Date().toISOString();
    const parent: Parent = {
      id, tenantId: "test-tenant",
      code: `PAR-2026-${id.slice(-4)}`,
      firstName: input.firstName, lastName: input.lastName,
      displayName: input.displayName ?? null,
      gender: input.gender, phone: input.phone,
      whatsapp: input.whatsapp ?? null, email: input.email ?? null,
      occupation: input.occupation ?? null, address: input.address ?? null,
      cityTier: input.cityTier ?? null,
      transportDestination: input.transportDestination ?? null,
      preferredLanguage: input.preferredLanguage ?? "fr",
      avatarUrl: null, createdAt: now, updatedAt: now,
    };
    this.rows.set(id, parent);
    this.cache.set([...this.rows.values()]);
    return Ok(parent);
  }
  async updateParent(id: string, updates: UpdateParentInput): Promise<Result<Parent>> {
    const existing = this.rows.get(id);
    if (!existing) return Err(Errors.notFound("Parent", id));
    const updated = { ...existing, ...updates } as Parent;
    this.rows.set(id, updated);
    this.cache.set([...this.rows.values()]);
    return Ok(updated);
  }
  async deleteParent(id: string): Promise<Result<void>> {
    this.rows.delete(id);
    this.cache.set([...this.rows.values()]);
    return Ok(undefined);
  }
}

class FastStudentRepo implements StudentRepository {
  private readonly rows = new Map<string, Student>();
  private readonly cache = new SubjectBehavior<Student[]>([]);

  observe(): Observable<Student[]> { return this.cache; }
  observeByParent(parentId: string): Observable<Student[]> {
    return new SubjectBehavior<Student[]>([...this.rows.values()].filter((s) => s.parentId === parentId));
  }
  observeByClass(classId: string): Observable<Student[]> {
    return new SubjectBehavior<Student[]>([...this.rows.values()].filter((s) => s.classId === classId));
  }
  observeById(id: string): Observable<Student | null> {
    return new SubjectBehavior<Student | null>(this.rows.get(id) ?? null);
  }
  async search(query: string): Promise<Result<Student[]>> {
    const q = query.toLowerCase().trim();
    if (!q) return Ok([...this.rows.values()]);
    return Ok([...this.rows.values()].filter((s) =>
      `${s.firstName} ${s.lastName} ${s.displayName ?? ""} ${s.code}`.toLowerCase().includes(q),
    ));
  }
  async createStudent(parentId: string, input: CreateStudentInput): Promise<Result<Student>> {
    const id = `stu-${String(this.rows.size + 1).padStart(3, "0")}`;
    const now = new Date().toISOString();
    const student: Student = {
      id, tenantId: "test-tenant",
      code: `ELV-2026-${id.slice(-4)}`,
      parentId,
      firstName: input.firstName, lastName: input.lastName,
      displayName: input.displayName ?? null,
      gender: input.gender, birthDate: input.birthDate,
      enrollmentDate: now.slice(0, 10),
      level: input.level, gradeYear: input.gradeYear,
      gradeLevel: input.gradeLevel ?? "1ap",
      classId: input.classId ?? null, photoUrl: null,
      medicalNotes: input.medicalNotes ?? null,
      transportTier: input.transportTier ?? null,
      status: "active", paymentPlan: input.paymentPlan ?? "tranches",
      createdAt: now, updatedAt: now,
    };
    this.rows.set(id, student);
    this.cache.set([...this.rows.values()]);
    return Ok(student);
  }
  async updateStudent(id: string, updates: Partial<CreateStudentInput>): Promise<Result<Student>> {
    const existing = this.rows.get(id);
    if (!existing) return Err(Errors.notFound("Student", id));
    const updated = { ...existing, ...updates } as Student;
    this.rows.set(id, updated);
    this.cache.set([...this.rows.values()]);
    return Ok(updated);
  }
  async deleteStudent(id: string): Promise<Result<void>> {
    this.rows.delete(id);
    this.cache.set([...this.rows.values()]);
    return Ok(undefined);
  }
  async batchRegister(): Promise<Result<{ parent: Parent; students: readonly Student[] }>> {
    return Err(Errors.server("not implemented in stub"));
  }
  async promote(): Promise<Result<Student[]>> {
    return Err(Errors.server("not implemented in stub"));
  }
}

class FastLedgerRepo implements LedgerRepository {
  readonly rows: LedgerEntry[] = [];
  private readonly cache = new SubjectBehavior<LedgerEntry[]>([]);

  observe(): Observable<LedgerEntry[]> { return this.cache; }
  observeByParent(parentId: string): Observable<LedgerEntry[]> {
    return new SubjectBehavior<LedgerEntry[]>(this.rows.filter((e) => e.parentId === parentId));
  }
  observeByAccount(accountId: string): Observable<LedgerEntry[]> {
    return new SubjectBehavior<LedgerEntry[]>(this.rows.filter((e) => e.accountId === accountId));
  }
  observeByStudent(studentId: string): Observable<LedgerEntry[]> {
    return new SubjectBehavior<LedgerEntry[]>(this.rows.filter((e) => e.studentId === studentId));
  }
  async append(entry: LedgerEntry): Promise<Result<LedgerEntry>> {
    this.rows.push(entry);
    this.cache.set([...this.rows]);
    return Ok(entry);
  }
  async appendMany(entries: readonly LedgerEntry[]): Promise<Result<readonly LedgerEntry[]>> {
    const copy = [...entries];
    this.rows.push(...copy);
    this.cache.set([...this.rows]);
    return Ok(copy);
  }
  async reverse(_originalId: string, _reason: string, _actorId: string, _actorName: string): Promise<Result<LedgerEntry>> {
    return Err(Errors.server("not implemented in stub"));
  }
  async summary(_parentId: string): Promise<Result<import("../../domain/model/ledger").ParentLedgerSummary>> {
    return Err(Errors.server("not implemented in stub"));
  }
  async reconcile(): Promise<Result<import("../../domain/calc/reconcile").ReconciliationReport>> {
    return Err(Errors.server("not implemented in stub"));
  }
}

class FastPaymentRepo implements PaymentRepository {
  private readonly rows = new Map<string, Payment>();
  private readonly cache = new SubjectBehavior<Payment[]>([]);

  observe(): Observable<Payment[]> { return this.cache; }
  observeByParent(parentId: string): Observable<Payment[]> {
    return new SubjectBehavior<Payment[]>([...this.rows.values()].filter((p) => p.parentId === parentId));
  }
  observeByStudent(studentId: string): Observable<Payment[]> {
    return new SubjectBehavior<Payment[]>([...this.rows.values()].filter((p) => p.studentId === studentId));
  }
  observeById(id: string): Observable<Payment | null> {
    return new SubjectBehavior<Payment | null>(this.rows.get(id) ?? null);
  }
  async collect(input: CollectPaymentInput, collectedBy: string): Promise<Result<Payment>> {
    const receiptNumber = input.receiptNumber ?? `REC-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const now = input.collectedAt ?? new Date().toISOString();
    // Idempotent: if a payment with the same receiptNumber exists, return it.
    const existing = [...this.rows.values()].find((p) => p.receiptNumber === receiptNumber);
    if (existing) return Ok(existing);
    const id = `pay-${String(this.rows.size + 1).padStart(3, "0")}`;
    const payment: Payment = {
      id,
      tenantId: "test-tenant",
      receiptNumber,
      parentId: input.parentId,
      studentId: input.studentId,
      amount: input.amount,
      method: input.method,
      status: "paid",
      category: input.category,
      installmentId: input.installmentId,
      proofUrl: input.proofUrl ?? null,
      notes: input.notes ?? null,
      collectedBy,
      collectedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(id, payment);
    this.cache.set([...this.rows.values()]);
    return Ok(payment);
  }
  async refund(): Promise<Result<Payment>> {
    return Err(Errors.server("not implemented in stub"));
  }
  async markCleared(): Promise<Result<Payment>> {
    return Err(Errors.server("not implemented in stub"));
  }
  async markBounced(): Promise<Result<Payment>> {
    return Err(Errors.server("not implemented in stub"));
  }
  async adjust(): Promise<Result<import("../../domain/model/payment").AccountAdjustment>> {
    return Err(Errors.server("not implemented in stub"));
  }
  async generateReceipt(): Promise<Result<import("../../domain/model/payment").Receipt>> {
    return Err(Errors.server("not implemented in stub"));
  }
  async appendManualCharge(): Promise<Result<LedgerEntry>> {
    return Err(Errors.server("not implemented in stub"));
  }
}

/**
 * Fast in-memory stub InstallmentRepository for the bulk-import tests.
 * Implements `importInstallment` (the new bulk-import method) with
 * idempotent upsert by (parentId, studentId, category, trancheNumber).
 */
class FastInstallmentRepo implements InstallmentRepository {
  readonly rows = new Map<string, Installment>();

  private key(parentId: string, studentId: string, category: PaymentCategory, trancheNumber: number): string {
    return `${parentId}:${studentId}:${category}:${trancheNumber}`;
  }

  observeByParent(parentId: string): Observable<Installment[]> {
    return new SubjectBehavior<Installment[]>([...this.rows.values()].filter((i) => i.parentId === parentId));
  }
  observe(): Observable<Installment[]> {
    return new SubjectBehavior<Installment[]>([...this.rows.values()]);
  }
  observeByStudent(studentId: string): Observable<Installment[]> {
    return new SubjectBehavior<Installment[]>([...this.rows.values()].filter((i) => i.studentId === studentId));
  }
  observeById(id: string): Observable<Installment | null> {
    return new SubjectBehavior<Installment | null>(this.rows.get(id) ?? null);
  }
  async markPaid(): Promise<Result<Installment>> {
    return Err(Errors.server("not implemented in stub"));
  }
  async allocatePayment(): Promise<Result<import("../../domain/calc/payment/waterfall-allocator").AllocationResult>> {
    return Err(Errors.server("not implemented in stub"));
  }
  async updateDueDate(): Promise<Result<Installment>> {
    return Err(Errors.server("not implemented in stub"));
  }
  async regenerateForCycle(): Promise<Result<readonly Installment[]>> {
    return Err(Errors.server("not implemented in stub"));
  }
  async findOverdue(): Promise<Result<readonly Installment[]>> {
    return Ok([]);
  }
  async importInstallment(input: ImportInstallmentInput): Promise<Result<Installment>> {
    const k = this.key(input.parentId, input.studentId, input.category, input.trancheNumber);
    const installment: Installment = {
      id: `imp-${k}`,
      parentId: input.parentId,
      studentId: input.studentId,
      category: input.category,
      label: input.label,
      amountDue: input.amountDue,
      amountPaid: input.amountPaid,
      amountPending: 0,
      dueDate: input.dueDate,
      paidDate: input.paidDate,
      status: input.status,
      academicCycle: input.academicCycle,
      paymentPlan: input.paymentPlan ?? "tranches",
      isCustomSchedule: false,
      customScheduleNote: null,
    };
    this.rows.set(k, installment);
    return Ok(installment);
  }
}


// ── The suite ────────────────────────────────────────────────────────────────

describeOrSkip("T-105 — import shape invariants (real workbook)", () => {
  let engine: ImportEngine;
  let ledger: FastLedgerRepo;
  let installments: FastInstallmentRepo;
  /** student name → { devis, dettes, remboursement } read directly via exceljs. */
  let corpusByStudentName: Map<string, { devis: number; dettes: number; remboursement: number }>;

  beforeAll(async () => {
    if (!XLSX_PATH) throw new Error("Workbook not found");
    ledger = new FastLedgerRepo();
    installments = new FastInstallmentRepo();
    engine = new ImportEngine({
      storage: new RepositoryStorageAdapter({
        parents: new FastParentRepo(),
        students: new FastStudentRepo(),
        ledger,
        payments: new FastPaymentRepo(),
        installments,
        tenantId: "test-tenant",
        actorId: "test-actor",
        actorName: "Test Actor",
      }),
      auditSink: { async logAction() { /* no-op */ } },
    });
    const buf = fs.readFileSync(XLSX_PATH);
    await engine.importFile(new Uint8Array(buf), XLSX_PATH, { dryRun: false });

    // Read the workbook's L/M/N columns per student name.
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.worksheets.find((s) => /^ETAT/i.test(s.name));
    if (!ws) throw new Error("ETAT sheet not found");
    corpusByStudentName = new Map();
    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const nom = String(row.getCell(6).value ?? "").trim().toUpperCase().replace(/\s+/g, " ");
      if (!nom) continue;
      const num = (c: number): number => {
        const v = row.getCell(c).value;
        if (v === null || v === undefined) return 0;
        if (typeof v === "number") return v;
        if (typeof v === "object" && "result" in (v as object)) {
          const res = (v as { result?: unknown }).result;
          return typeof res === "number" ? res : 0;
        }
        const n = Number(String(v).replace(",", ".").trim());
        return Number.isFinite(n) ? n : 0;
      };
      const prev = corpusByStudentName.get(nom) ?? { devis: 0, dettes: 0, remboursement: 0 };
      corpusByStudentName.set(nom, {
        devis: prev.devis + num(12),
        dettes: prev.dettes + num(14),
        remboursement: prev.remboursement + num(13),
      });
    }
  }, TEST_TIMEOUT_MS);

  it("DATA-010 — writes NO 'Remise sur devis' adjustment (the devis is already net)", () => {
    const remiseEntries = ledger.rows.filter(
      (e) => e.type === "adjustment" && /remise sur devis/i.test(e.description ?? ""),
    );
    expect(
      remiseEntries,
      `expected zero 'Remise sur devis' adjustments, got ${remiseEntries.length} (double-remise regression)`,
    ).toHaveLength(0);
  });

  it("DATA-010 — no REMISE-sourced ledger entries exist (no −J writes)", () => {
    const remiseSourced = ledger.rows.filter((e) => /:REMISE$/.test(e.sourceId ?? ""));
    expect(remiseSourced, "REMISE-sourced ledger entries must not exist").toHaveLength(0);
  });

  it("C3 — Σ installments amountDue == Σ(devis + dettes − remboursement) across the corpus", () => {
    const totalDue = [...installments.rows.values()].reduce((s, i) => s + i.amountDue, 0);
    let corpusTotal = 0;
    for (const v of corpusByStudentName.values()) {
      corpusTotal += v.devis + v.dettes - v.remboursement;
    }
    expect(Math.round(totalDue)).toBe(Math.round(corpusTotal));
  });

  it("ledger net obligation == Σ(devis + dettes) (charges + adjustments, no phantom discounts)", () => {
    const net = ledger.rows
      .filter((e) => e.type === "charge" || e.type === "adjustment")
      .reduce((s, e) => s + e.amount, 0);
    let corpusTotal = 0;
    for (const v of corpusByStudentName.values()) corpusTotal += v.devis + v.dettes;
    expect(Math.round(net)).toBe(Math.round(corpusTotal));
  });

  it("tranche absorption — no tranche carries a negative amountDue", () => {
    const negative = [...installments.rows.values()].filter((i) => i.amountDue < 0);
    expect(negative, "negative amountDue tranches must not exist").toHaveLength(0);
  });
});
