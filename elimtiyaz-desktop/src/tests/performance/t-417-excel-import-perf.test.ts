/**
 * T-417 / PERF-503 — Excel import pipeline PERFORMANCE suite (issue #19).
 *
 * "The Excel import process is currently extremely slow, especially when
 * importing larger Excel files." This suite pins the performance contract
 * the T-417 optimization established, WITHOUT weakening a single
 * correctness gate:
 *
 *   1. CENSUS — the real workbook restores the exact pinned census
 *      (390 students / 253 parents / 1283 ledger / 891 payments /
 *      1968 installments / 0 rejected) — the same anchors as the
 *      IMPORT-106 empty-state suite.
 *   2. CALL-COUNT BUDGET — the repository round-trip COUNT is the
 *      invariant (the PERF-501/502 convention: network wall clock is
 *      route-dependent, the call count is not):
 *        - identity searches COLLAPSE to the 2 snapshot reads
 *          (baseline: 636 parent searches + 390 student searches);
 *        - the CANONICAL WRITES ARE PRESERVED EXACTLY — createParent
 *          253, createStudent 390, updateStudent 0 (first import) —
 *          the optimization may not skip or merge domain writes.
 *   3. WALL-CLOCK BUDGET — under a scaled latency profile
 *      (25 ms search / 50 ms create / 45 ms update / 100 ms bulk —
 *      1/12th of the real Algeria-to-eu-west-1 RTT) the import must
 *      finish under a fixed budget. Baseline (sequential, measured
 *      2026-09-27, pre-optimization): 149,090 ms. Post-optimization
 *      measured: 5,642 ms — the budget is 15,000 ms (2.7x headroom
 *      for CI variance; a regression to the sequential shape trips it
 *      by an order of magnitude).
 *   4. RE-IMPORT — the second import is a no-op census-wise (all
 *      students take the update path; nothing duplicates).
 *   5. ATOMICITY — a mid-import write failure still rolls the store
 *      back to EMPTY (the VAULT §14.02 compensating-rollback contract).
 *   6. ERROR REPORTING — a per-row createStudent failure still skips
 *      exactly that row with its rowIndex + identity recorded (the
 *      modal's "why rows were skipped" contract).
 *   7. CONCURRENCY — the pool NEVER exceeds the configured limit
 *      (bounded-concurrency proof, not a timing guess).
 *
 * Instrumented stubs: same shape as the empty-state suite's Layer-A
 * Fast*Repo stubs, plus per-method call counters + a configurable
 * latency profile (0 ms = instant; the scaled profile simulates the
 * network). They implement the SAME repository contracts the mock and
 * Supabase layers do, so the call counts mirror the real round trips.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
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
import type { Student, CreateStudentInput, BatchRegistrationResult } from "../../domain/model/student";
import type { LedgerEntry } from "../../domain/model/ledger";
import type { Payment, Installment, CollectPaymentInput, PaymentCategory } from "../../domain/model/payment";
import { SubjectBehavior } from "../../infrastructure/mock/subject-behavior";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const XLSX_PATH = [
  path.join(REPO_ROOT, "Suivis clients  2026_2027.xlsx"), // double space — real file
  path.join(REPO_ROOT, "..", "Suivis clients  2026_2027.xlsx"),
  path.join(REPO_ROOT, "Suivis clients 2026_2027.xlsx"), // single space — fallback
  path.join(REPO_ROOT, "..", "Suivis clients 2026_2027.xlsx"),
  path.join(REPO_ROOT, "Excel", "Suivis clients  2026_2027.xlsx"),
  path.join(REPO_ROOT, "..", "Excel", "Suivis clients  2026_2027.xlsx"),
].find((p) => fs.existsSync(p));

type Counts = Record<string, number>;
function newCounts(): Counts {
  return {};
}

/** Latency profile in ms (0 = instant; scaled network simulation). */
interface Latency {
  search: number;
  create: number;
  update: number;
  bulk: number;
}

const INSTANT: Latency = { search: 0, create: 0, update: 0, bulk: 0 };
// Scaled-down network: 1 real RTT (~300ms) -> 25ms sim (12x scale).
const SCALED: Latency = { search: 25, create: 50, update: 45, bulk: 100 };

class InstrumentedParentRepo implements ParentRepository {
  readonly rows = new Map<string, Parent>();
  private readonly cache = new SubjectBehavior<Parent[]>([]);
  readonly calls: Counts = newCounts();
  constructor(private readonly latency: Latency) {}
  private async tick(kind: keyof Latency): Promise<void> {
    this.calls[kind] = (this.calls[kind] ?? 0) + 1;
    if (this.latency[kind] > 0) await new Promise((r) => setTimeout(r, this.latency[kind]));
  }
  observe(): Observable<Parent[]> { return this.cache; }
  observeById(id: string): Observable<Parent | null> {
    return new SubjectBehavior<Parent | null>(this.rows.get(id) ?? null);
  }
  async search(query: string): Promise<Result<Parent[]>> {
    await this.tick("search");
    const q = query.toLowerCase().trim();
    if (!q) return Ok([...this.rows.values()]);
    return Ok([...this.rows.values()].filter((p) =>
      `${p.firstName} ${p.lastName} ${p.displayName ?? ""} ${p.phone} ${p.code}`.toLowerCase().includes(q)));
  }
  async createParent(input: CreateParentInput): Promise<Result<Parent>> {
    await this.tick("create");
    const id = `par-${String(this.rows.size + 1).padStart(3, "0")}`;
    const now = new Date().toISOString();
    const parent: Parent = {
      id, tenantId: "test-tenant", code: `PAR-2026-${id.slice(-4)}`,
      firstName: input.firstName, lastName: input.lastName,
      displayName: input.displayName ?? null, gender: input.gender,
      phone: input.phone, whatsapp: input.whatsapp ?? null, email: input.email ?? null,
      occupation: input.occupation ?? null, address: input.address ?? null,
      cityTier: input.cityTier ?? null, transportDestination: input.transportDestination ?? null,
      preferredLanguage: input.preferredLanguage ?? "fr", avatarUrl: null,
      createdAt: now, updatedAt: now,
    };
    this.rows.set(id, parent);
    this.cache.set([...this.rows.values()]);
    return Ok(parent);
  }
  async updateParent(id: string, updates: UpdateParentInput): Promise<Result<Parent>> {
    await this.tick("update");
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

class InstrumentedStudentRepo implements StudentRepository {
  readonly rows = new Map<string, Student>();
  private readonly cache = new SubjectBehavior<Student[]>([]);
  readonly calls: Counts = newCounts();
  constructor(private readonly latency: Latency) {}
  private async tick(kind: keyof Latency): Promise<void> {
    this.calls[kind] = (this.calls[kind] ?? 0) + 1;
    if (this.latency[kind] > 0) await new Promise((r) => setTimeout(r, this.latency[kind]));
  }
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
    await this.tick("search");
    const q = query.toLowerCase().trim();
    if (!q) return Ok([...this.rows.values()]);
    return Ok([...this.rows.values()].filter((s) =>
      `${s.firstName} ${s.lastName} ${s.displayName ?? ""} ${s.code}`.toLowerCase().includes(q)));
  }
  async createStudent(parentId: string, input: CreateStudentInput): Promise<Result<Student>> {
    await this.tick("create");
    const id = `stu-${String(this.rows.size + 1).padStart(3, "0")}`;
    const now = new Date().toISOString();
    const student: Student = {
      id, tenantId: "test-tenant", code: `ELV-2026-${id.slice(-4)}`, parentId,
      firstName: input.firstName, lastName: input.lastName,
      displayName: input.displayName ?? null, gender: input.gender, birthDate: input.birthDate,
      enrollmentDate: now.slice(0, 10), level: input.level, gradeYear: input.gradeYear,
      gradeLevel: input.gradeLevel ?? "1ap", classId: input.classId ?? null, photoUrl: null,
      medicalNotes: input.medicalNotes ?? null, transportTier: input.transportTier ?? null,
      status: "active", paymentPlan: input.paymentPlan ?? "tranches",
      createdAt: now, updatedAt: now,
    };
    this.rows.set(id, student);
    this.cache.set([...this.rows.values()]);
    return Ok(student);
  }
  async updateStudent(id: string, updates: Partial<CreateStudentInput>): Promise<Result<Student>> {
    await this.tick("update");
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
  async batchRegister(): Promise<Result<BatchRegistrationResult>> {
    return Err(Errors.server("not implemented in stub"));
  }
  async promote(): Promise<Result<Student[]>> {
    return Err(Errors.server("not implemented in stub"));
  }
  async addStudentDocument(): Promise<Result<import("../../domain/model/student").StudentDocument>> {
    return Err(Errors.server("stub"));
  }
  async removeStudentDocument(): Promise<Result<void>> {
    return Err(Errors.server("stub"));
  }
}

class InstrumentedLedgerRepo implements LedgerRepository {
  readonly rows: LedgerEntry[] = [];
  private readonly cache = new SubjectBehavior<LedgerEntry[]>([]);
  readonly calls: Counts = newCounts();
  constructor(private readonly latency: Latency) {}
  private async tick(kind: keyof Latency): Promise<void> {
    this.calls[kind] = (this.calls[kind] ?? 0) + 1;
    if (this.latency[kind] > 0) await new Promise((r) => setTimeout(r, this.latency[kind]));
  }
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
    await this.tick("update");
    this.rows.push(entry);
    this.cache.set([...this.rows]);
    return Ok(entry);
  }
  async appendMany(entries: readonly LedgerEntry[]): Promise<Result<readonly LedgerEntry[]>> {
    await this.tick("bulk");
    const copy = [...entries];
    this.rows.push(...copy);
    this.cache.set([...this.rows]);
    return Ok(copy);
  }
  async bulkAppend(entries: readonly LedgerEntry[]): Promise<Result<readonly LedgerEntry[]>> {
    await this.tick("bulk");
    const copy = [...entries];
    this.rows.push(...copy);
    this.cache.set([...this.rows]);
    return Ok(copy);
  }
  async reverse(): Promise<Result<LedgerEntry>> { return Err(Errors.server("stub")); }
  async summary(): Promise<Result<import("../../domain/model/ledger").ParentLedgerSummary>> {
    return Err(Errors.server("stub"));
  }
  async reconcile(): Promise<Result<import("../../domain/calc/reconcile").ReconciliationReport>> {
    return Err(Errors.server("stub"));
  }
}

class InstrumentedPaymentRepo implements PaymentRepository {
  readonly rows = new Map<string, Payment>();
  private readonly cache = new SubjectBehavior<Payment[]>([]);
  readonly calls: Counts = newCounts();
  constructor(private readonly latency: Latency) {}
  private async tick(kind: keyof Latency): Promise<void> {
    this.calls[kind] = (this.calls[kind] ?? 0) + 1;
    if (this.latency[kind] > 0) await new Promise((r) => setTimeout(r, this.latency[kind]));
  }
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
    await this.tick("update");
    const receiptNumber = input.receiptNumber ?? `REC-${Date.now()}`;
    const existing = [...this.rows.values()].find((p) => p.receiptNumber === receiptNumber);
    if (existing) return Ok(existing);
    const now = input.collectedAt ?? new Date().toISOString();
    const id = `pay-${String(this.rows.size + 1).padStart(3, "0")}`;
    const payment: Payment = {
      id, tenantId: "test-tenant", receiptNumber,
      parentId: input.parentId, studentId: input.studentId,
      amount: input.amount, method: input.method,
      status: "paid", category: input.category, installmentId: input.installmentId,
      proofUrl: input.proofUrl ?? null, notes: input.notes ?? null,
      collectedBy, collectedAt: now, createdAt: now, updatedAt: now,
    };
    this.rows.set(id, payment);
    this.cache.set([...this.rows.values()]);
    return Ok(payment);
  }
  async bulkCollect(inputs: ReadonlyArray<{ input: CollectPaymentInput; collectedBy: string }>): Promise<Result<readonly Payment[]>> {
    await this.tick("bulk");
    const out: Payment[] = [];
    for (const { input, collectedBy } of inputs) {
      const receiptNumber = input.receiptNumber ?? `REC-${Date.now()}-${out.length}`;
      const existing = [...this.rows.values()].find((p) => p.receiptNumber === receiptNumber);
      if (existing) { out.push(existing); continue; }
      const now = input.collectedAt ?? new Date().toISOString();
      const id = `pay-${String(this.rows.size + 1).padStart(3, "0")}`;
      const payment: Payment = {
        id, tenantId: "test-tenant", receiptNumber,
        parentId: input.parentId, studentId: input.studentId,
        amount: input.amount, method: input.method,
        status: "paid", category: input.category, installmentId: input.installmentId,
        proofUrl: null, notes: input.notes ?? null,
        collectedBy, collectedAt: now, createdAt: now, updatedAt: now,
      };
      this.rows.set(id, payment);
      out.push(payment);
    }
    this.cache.set([...this.rows.values()]);
    return Ok(out);
  }
  async refund(): Promise<Result<Payment>> { return Err(Errors.server("stub")); }
  async markCleared(): Promise<Result<Payment>> { return Err(Errors.server("stub")); }
  async markBounced(): Promise<Result<Payment>> { return Err(Errors.server("stub")); }
  async adjust(): Promise<Result<import("../../domain/model/payment").AccountAdjustment>> { return Err(Errors.server("stub")); }
  async generateReceipt(): Promise<Result<import("../../domain/model/payment").Receipt>> { return Err(Errors.server("stub")); }
  async appendManualCharge(): Promise<Result<LedgerEntry>> { return Err(Errors.server("stub")); }
}

class InstrumentedInstallmentRepo implements InstallmentRepository {
  readonly rows = new Map<string, Installment>();
  private readonly cache = new SubjectBehavior<Installment[]>([]);
  readonly calls: Counts = newCounts();
  constructor(private readonly latency: Latency) {}
  private async tick(kind: keyof Latency): Promise<void> {
    this.calls[kind] = (this.calls[kind] ?? 0) + 1;
    if (this.latency[kind] > 0) await new Promise((r) => setTimeout(r, this.latency[kind]));
  }
  private key(parentId: string, studentId: string, category: PaymentCategory, trancheNumber: number): string {
    return `${parentId}:${studentId}:${category}:${trancheNumber}`;
  }
  observe(): Observable<Installment[]> { return this.cache; }
  observeByParent(parentId: string): Observable<Installment[]> {
    return new SubjectBehavior<Installment[]>([...this.rows.values()].filter((i) => i.parentId === parentId));
  }
  observeByStudent(studentId: string): Observable<Installment[]> {
    return new SubjectBehavior<Installment[]>([...this.rows.values()].filter((i) => i.studentId === studentId));
  }
  observeById(id: string): Observable<Installment | null> {
    return new SubjectBehavior<Installment | null>(this.rows.get(id) ?? null);
  }
  async importInstallment(input: ImportInstallmentInput): Promise<Result<Installment>> {
    await this.tick("update");
    const k = this.key(input.parentId, input.studentId ?? "", input.category, input.trancheNumber);
    const existing = this.rows.get(k);
    if (existing) {
      const updated: Installment = { ...existing, amountPaid: input.amountPaid, status: input.status };
      this.rows.set(k, updated);
      this.cache.set([...this.rows.values()]);
      return Ok(updated);
    }
    const inst: Installment = {
      id: `imp-${k}`,
      parentId: input.parentId, studentId: input.studentId ?? null,
      category: input.category, label: input.label,
      amountDue: input.amountDue, amountPaid: input.amountPaid,
      amountPending: Math.max(0, input.amountDue - input.amountPaid),
      dueDate: input.dueDate, paidDate: input.paidDate ?? null,
      status: input.status, academicCycle: input.academicCycle ?? undefined,
      paymentPlan: input.paymentPlan ?? "tranches",
      isCustomSchedule: false, customScheduleNote: null,
    };
    this.rows.set(k, inst);
    this.cache.set([...this.rows.values()]);
    return Ok(inst);
  }
  async bulkImportInstallments(inputs: readonly ImportInstallmentInput[]): Promise<Result<readonly Installment[]>> {
    // ONE round trip for the whole batch (mirrors the real Supabase/mock
    // bulk implementations — chunked single inserts, never per-row calls).
    await this.tick("bulk");
    const out: Installment[] = [];
    for (const input of inputs) {
      const k = this.key(input.parentId, input.studentId ?? "", input.category, input.trancheNumber);
      const existing = this.rows.get(k);
      if (existing) {
        const updated: Installment = { ...existing, amountPaid: input.amountPaid, status: input.status };
        this.rows.set(k, updated);
        out.push(updated);
        continue;
      }
      const inst: Installment = {
        id: `imp-${k}`,
        parentId: input.parentId, studentId: input.studentId ?? null,
        category: input.category, label: input.label,
        amountDue: input.amountDue, amountPaid: input.amountPaid,
        amountPending: Math.max(0, input.amountDue - input.amountPaid),
        dueDate: input.dueDate, paidDate: input.paidDate ?? null,
        status: input.status, academicCycle: input.academicCycle ?? undefined,
        paymentPlan: input.paymentPlan ?? "tranches",
        isCustomSchedule: false, customScheduleNote: null,
      };
      this.rows.set(k, inst);
      out.push(inst);
    }
    this.cache.set([...this.rows.values()]);
    return Ok(out);
  }
  async markPaid(): Promise<Result<Installment>> { return Err(Errors.server("stub")); }
  async allocatePayment(): Promise<Result<import("../../domain/calc/payment/waterfall-allocator").AllocationResult>> { return Err(Errors.server("stub")); }
  async updateDueDate(): Promise<Result<Installment>> { return Err(Errors.server("stub")); }
  async regenerateForCycle(): Promise<Result<Installment[]>> { return Err(Errors.server("stub")); }
  async bulkRegenerateForCycle(): Promise<Result<Installment[]>> { return Err(Errors.server("stub")); }
  async findOverdue(): Promise<Result<readonly Installment[]>> { return Err(Errors.server("stub")); }
}

describe("T-417 / PERF-503 — Excel import performance (issue #19)", () => {
  function buildRepos(latency: Latency): {
    parents: InstrumentedParentRepo;
    students: InstrumentedStudentRepo;
    ledger: InstrumentedLedgerRepo;
    payments: InstrumentedPaymentRepo;
    installments: InstrumentedInstallmentRepo;
  } {
    return {
      parents: new InstrumentedParentRepo(latency),
      students: new InstrumentedStudentRepo(latency),
      ledger: new InstrumentedLedgerRepo(latency),
      payments: new InstrumentedPaymentRepo(latency),
      installments: new InstrumentedInstallmentRepo(latency),
    };
  }

  function buildEngine(
    repos: ReturnType<typeof buildRepos>,
    concurrency?: number,
  ): ImportEngine {
    return new ImportEngine({
      storage: new RepositoryStorageAdapter({
        parents: repos.parents,
        students: repos.students,
        ledger: repos.ledger,
        payments: repos.payments,
        installments: repos.installments,
        tenantId: "test-tenant",
        actorId: "test-actor",
        actorName: "Perf Verifier",
        ...(concurrency !== undefined ? { importConcurrency: concurrency } : {}),
      }),
      auditSink: { async logAction() { /* no-op */ } },
      generateReports: false,
    });
  }

  function readWorkbookBytes(): Uint8Array {
    if (!XLSX_PATH) throw new Error("Workbook not found");
    return new Uint8Array(fs.readFileSync(XLSX_PATH));
  }

  it("1+2 — restores the pinned census AND the call-count budget (instant profile)", async () => {
    const repos = buildRepos(INSTANT);
    const engine = buildEngine(repos);
    const bytes = readWorkbookBytes();
    const ctx = await engine.importFile(bytes, XLSX_PATH!, { dryRun: false });

    // Census — identical anchors to the IMPORT-106 suite.
    expect(repos.students.rows.size).toBe(390);
    expect(repos.parents.rows.size).toBe(253);
    expect(repos.ledger.rows.length).toBe(1283);
    expect(repos.payments.rows.size).toBe(891);
    expect(repos.installments.rows.size).toBe(1968);
    expect(ctx.stats.rowsRejected).toBe(0);
    expect(ctx.stats.rowsImported).toBe(418);

    // Call-count budget — the PERF-503 invariant.
    // Identity searches: the 2 snapshot reads (was 636 + 390 per-row).
    expect(repos.parents.calls.search ?? 0).toBeLessThanOrEqual(3);
    expect(repos.students.calls.search ?? 0).toBeLessThanOrEqual(3);
    // Canonical domain writes: PRESERVED EXACTLY (no skipped processing).
    expect(repos.parents.calls.create ?? 0).toBe(253);
    expect(repos.students.calls.create ?? 0).toBe(390);
    expect(repos.students.calls.update ?? 0).toBe(0);
    // Bulk financial flushes: unchanged (one call per stream).
    expect(repos.ledger.calls.bulk ?? 0).toBe(1);
    expect(repos.payments.calls.bulk ?? 0).toBe(1);
    expect(repos.installments.calls.bulk ?? 0).toBe(1);
  }, 240_000);

  it("3 — wall-clock budget under the scaled network profile", async () => {
    const repos = buildRepos(SCALED);
    const engine = buildEngine(repos);
    const bytes = readWorkbookBytes();
    const t0 = Date.now();
    const ctx = await engine.importFile(bytes, XLSX_PATH!, { dryRun: false });
    const wallMs = Date.now() - t0;
    // Baseline (sequential, pre-optimization, measured 2026-09-27):
    //   149,090 ms under this exact profile. Budget: 15,000 ms.
    expect(wallMs).toBeLessThanOrEqual(15_000);
    // Correctness survives the concurrent write path unchanged.
    expect(repos.students.rows.size).toBe(390);
    expect(repos.parents.rows.size).toBe(253);
    expect(ctx.stats.rowsRejected).toBe(0);
  }, 240_000);

  it("4 — re-import is a no-op: every student takes the update path", async () => {
    const repos = buildRepos(INSTANT);
    const engine = buildEngine(repos);
    const bytes = readWorkbookBytes();
    await engine.importFile(bytes, XLSX_PATH!, { dryRun: false });
    const census = {
      students: repos.students.rows.size,
      parents: repos.parents.rows.size,
      ledger: repos.ledger.rows.length,
      payments: repos.payments.rows.size,
      installments: repos.installments.rows.size,
    };
    // The second run: no new parents, every existing student UPDATED.
    // (The 28 tracked REF/BON rows still report as "imported" — the legacy
    // tracked-upsert contract returns insert per row; only the 390 ETAT
    // domain rows flip to the update path.)
    const ctx2 = await engine.importFile(bytes, XLSX_PATH!, { dryRun: false });
    expect(repos.parents.calls.create ?? 0).toBe(253); // unchanged
    expect(repos.students.calls.create ?? 0).toBe(390); // unchanged
    expect(repos.students.calls.update ?? 0).toBe(390); // all rows matched
    expect(ctx2.stats.rowsImported).toBe(28); // the tracked rows only
    expect(ctx2.stats.rowsUpdated).toBe(390);
    // Census stable — nothing duplicated.
    expect(repos.students.rows.size).toBe(census.students);
    expect(repos.parents.rows.size).toBe(census.parents);
    expect(repos.ledger.rows.length).toBe(census.ledger);
    expect(repos.payments.rows.size).toBe(census.payments);
    expect(repos.installments.rows.size).toBe(census.installments);
  }, 240_000);

  it("5 — atomicity: a mid-import FLUSH failure rolls the store back to EMPTY", async () => {
    if (!XLSX_PATH) throw new Error("Workbook not found");
    const repos = buildRepos(INSTANT);
    // A ledger that THROWS at flush time (commitTransaction) — the exact
    // VAULT §14.02 probe the IMPORT-106 suite uses: the per-row writes
    // already landed, so ONLY the compensating rollback can restore the
    // pre-import state. (Per-row parent/student create ERRORS are the
    // legacy skip-and-continue path — they do NOT abort the import; the
    // abort path is a thrown error, which is what this probes.)
    const originalBulk = repos.ledger.bulkAppend.bind(repos.ledger);
    repos.ledger.bulkAppend = async (): Promise<Result<readonly LedgerEntry[]>> => {
      void originalBulk;
      throw new Error("simulated mid-import ledger flush failure");
    };
    const engine = buildEngine(repos);
    const bytes = readWorkbookBytes();
    await expect(
      engine.importFile(bytes, XLSX_PATH!, { dryRun: false }),
    ).rejects.toThrow();

    // The compensating rollback deleted every created parent + student
    // (students BEFORE parents — the FK order) — the store is EMPTY again.
    expect(repos.students.rows.size).toBe(0);
    expect(repos.parents.rows.size).toBe(0);
  }, 240_000);

  it("6 — per-row error reporting: a createStudent failure skips exactly that row with its rowIndex", async () => {
    if (!XLSX_PATH) throw new Error("Workbook not found");
    const repos = buildRepos(INSTANT);
    // Fail createStudent on exactly ONE call (the 101st) WITHOUT writing
    // the row — a surgical per-row failure. (The 101st call is a stable
    // target: family tasks process rows in order, so exactly one call
    // receives the failure; its identity varies with pool scheduling,
    // which the rowIndex>0 assertion accommodates.)
    const originalCreate = repos.students.createStudent.bind(repos.students);
    let created = 0;
    repos.students.createStudent = async (
      parentId: string,
      input: CreateStudentInput,
    ): Promise<Result<Student>> => {
      created += 1;
      if (created === 101) {
        return Err(Errors.server("simulated single-row student failure"));
      }
      return originalCreate(parentId, input);
    };
    const engine = buildEngine(repos);
    const storage = engine.getStorage() as RepositoryStorageAdapter;
    const bytes = readWorkbookBytes();
    const ctx = await engine.importFile(bytes, XLSX_PATH!, { dryRun: false });
    // 389 students landed (390 - the one failed row).
    expect(repos.students.rows.size).toBe(389);
    // The row was SKIPPED with its error recorded (rowIndex + identity).
    const errors = storage.getErrorsForRun(ctx.runId);
    expect(errors.length).toBe(1);
    expect(errors[0].error).toContain("Student creation failed");
    expect(errors[0].rowIndex).toBeGreaterThan(0);
    // The run itself did not abort — other rows imported fine.
    expect(ctx.stats.rowsRejected).toBe(0);
  }, 240_000);

  it("7 — bounded concurrency: the pool never exceeds the configured limit", async () => {
    if (!XLSX_PATH) throw new Error("Workbook not found");
    const repos = buildRepos(INSTANT);
    const engine = buildEngine(repos, 4);
    // Track concurrent createStudent calls.
    let active = 0;
    let maxActive = 0;
    const originalCreate = repos.students.createStudent.bind(repos.students);
    repos.students.createStudent = async (
      parentId: string,
      input: CreateStudentInput,
    ): Promise<Result<Student>> => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      try {
        // Yield so the pool can schedule the next worker while this call
        // is in flight — without this, a 0ms-latency stub completes
        // synchronously and the concurrency proof is vacuous.
        await new Promise((r) => setTimeout(r, 1));
        return await originalCreate(parentId, input);
      } finally {
        active -= 1;
      }
    };
    const bytes = readWorkbookBytes();
    const ctx = await engine.importFile(bytes, XLSX_PATH!, { dryRun: false });
    expect(ctx.stats.rowsRejected).toBe(0);
    expect(repos.students.rows.size).toBe(390);
    expect(maxActive).toBeLessThanOrEqual(4);
    expect(maxActive).toBeGreaterThan(1); // the pool really parallelized
  }, 240_000);
});
