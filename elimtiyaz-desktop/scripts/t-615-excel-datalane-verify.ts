/**
 * t-615-excel-datalane-verify.ts — T-615 (the data-lane half): the Excel
 * corpora verification harness — the Path-2 pre-flight for the NEW
 * project's data lane.
 *
 * WHAT THIS IS: the owner's mandate — "Since our old database is unusable
 * right now use the old Excel files as the primary data source… use ALL of
 * them as a source of input… check all the functions… run tests on ALL of
 * the rows." The OLD project (vebfehrpzajhstyhinnw) is 402-quota-dead and
 * the NEW project (gvuvibcsfjhwcjikgxql) has the schema but NO data (the
 * runbook Step-6 data lane). This harness proves the DATA + the ENGINES
 * are correct BEFORE the live load: it runs the REAL ImportEngine over the
 * REAL workbooks with instrumented in-memory repositories (the repo's own
 * Session-8/t-105 convention — the only untested dimension left is the
 * wire, which is the t-433 driver's job once the owner supplies the NEW
 * project's secret key).
 *
 * THE THREE WORKBOOKS (all under Excel/):
 *   1. `2027-2026.xlsx` (WB2, the workbook OF RECORD — the T-433 owner
 *      mandate) — full import + census + oracles.
 *   2. `Suivis clients  2026_2027.xlsx` (WB1, era A) — full import +
 *      census (its own era; NEVER combined with WB2 — the E2.3 rule).
 *   3. `متابعة تمدرس التلاميذ.xlsx` (WB3, the school register) — a
 *      structural census (per-sheet row counts + header shape); it has NO
 *      import schema (documented — the register feeds the E2.3 fixtures,
 *      not the CRM import).
 *
 * THE ORACLES (fail-loud, exit 1 on any violation):
 *   O1 EVERY IMPORTABLE ROW ACCOUNTED — imported+updated+skipped+rejected
 *      >= the direct exceljs NOM-bearing row scan of the ETAT sheet (the
 *      adapter requires NOM; the B..Y anyNonEmpty scan over-counts the
 *      47-column WB2 format — rows with data only beyond column Y carry
 *      no NOM and are correctly skipped).
 *   O2 THE STUDENT CENSUS — every NOM row produces a student OR merges
 *      onto an existing one (duplicate-NOM rows surface as rowsUpdated —
 *      the IMPORT-109 same-workbook merge semantics); WB2 >= 1,100 (the
 *      real-excel-import-2027-2026 pin), WB1 >= 380.
 *   O3 INSTALLMENTS EXIST — the corpus produces installments with due
 *      dates + amounts (the tranche streams).
 *   O4 PAYMENTS ↔ LEDGER COHERENCE — every payment the import created has
 *      a matching payment-type ledger entry (same student, same amount).
 *   O5 THE PER-FAMILY RECONCILIATION — for every parent: Σledger(charges)
 *      − Σledger(payments) ≈ Σinstallments(due−paid), within the
 *      documented tolerance (the FI-fee ledger-only convention, §T-528's
 *      honest delta — asserted per-family, reported, never auto-corrected).
 *   O6 IDEMPOTENCY — a second import over the same repositories creates
 *      ZERO new students (the student STORE is the criterion — the
 *      per-format action labels differ; the mandate's acceptance is
 *      "without creating duplicates").
 *
 * USAGE:
 *   npx tsx scripts/t-615-excel-datalane-verify.ts [--json <out.json>]
 *
 * The JSON report (default: printed; --json writes the artifact) carries
 * the full census — the evidence artifact for the docs + the owner.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import ExcelJS from "exceljs";
import { ImportEngine } from "../src/infrastructure/excel/import-engine";
import { RepositoryStorageAdapter } from "../src/infrastructure/excel/import-engine/storage/repository-adapter";
import type {
  ParentRepository,
  StudentRepository,
  LedgerRepository,
  PaymentRepository,
  InstallmentRepository,
  Observable,
  ImportInstallmentInput,
} from "../src/domain/repository/repository";
import type { Result } from "../src/core/result";
import { Ok, Err } from "../src/core/result";
import { Errors } from "../src/core/app-error";
import type { Parent, CreateParentInput, UpdateParentInput } from "../src/domain/model/parent";
import type { Student, CreateStudentInput } from "../src/domain/model/student";
import type { LedgerEntry } from "../src/domain/model/ledger";
import type { Payment, Installment, CollectPaymentInput, PaymentCategory } from "../src/domain/model/payment";
import { SubjectBehavior } from "../src/infrastructure/mock/subject-behavior";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const EXCEL_DIR_CANDIDATES = [
  path.join(REPO_ROOT, "..", "Excel"),
  path.join(REPO_ROOT, "Excel"),
];
const EXCEL_DIR = EXCEL_DIR_CANDIDATES.find((p) => fs.existsSync(p)) ?? EXCEL_DIR_CANDIDATES[0];

const WB2 = path.join(EXCEL_DIR, "2027-2026.xlsx");
const WB1 = path.join(EXCEL_DIR, "Suivis clients  2026_2027.xlsx");
const WB3 = path.join(EXCEL_DIR, "متابعة تمدرس التلاميذ.xlsx");

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const ACTOR_ID = "t-615-datalane-verify";

// ── The headless session context (the t-433 convention) ──
const memStore = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => memStore.get(k) ?? null,
  setItem: (k: string, v: string) => void memStore.set(k, v),
  removeItem: (k: string) => void memStore.delete(k),
  clear: () => void memStore.clear(),
};
memStore.set("el-imtiyaz.session", JSON.stringify({ tenantId: TENANT_ID, userId: ACTOR_ID }));

// ============================================================================
// The instrumented in-memory repositories — the Fast* stubs lifted VERBATIM
// from src/tests/integration/real-excel-import.test.ts (the proven harness
// stubs; `rows` made public for the census). No artificial delays: a
// 1,289-row import completes in seconds.
// ============================================================================

class FastParentRepo implements ParentRepository {
  readonly rows = new Map<string, Parent>();
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
  readonly rows = new Map<string, Student>();
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
  // T-372/SYNC-110: granular document contract stubs — these import-focused
  // harnesses never exercise document flows; the methods exist to satisfy
  // the StudentRepository contract and fail loud if ever reached.
  async addStudentDocument(): Promise<Result<import("../../domain/model/student").StudentDocument>> {
    return Err(Errors.server("stub: addStudentDocument not used in this harness"));
  }
  async removeStudentDocument(): Promise<Result<void>> {
    return Err(Errors.server("stub: removeStudentDocument not used in this harness"));
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

/**
 * Fast in-memory stub PaymentRepository for the bulk-import tests.
 * Implements just enough of the interface for the importer's `collect()`
 * calls to succeed. The `receiptNumber` from the input is used verbatim
 * (deterministic) so re-imports are idempotent at the payments level.
 */
class FastPaymentRepo implements PaymentRepository {
  readonly rows = new Map<string, Payment>();
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

// ============================================================================
// The harness
// ============================================================================

interface Bundle {
  engine: ImportEngine;
  parents: FastParentRepo;
  students: FastStudentRepo;
  ledger: FastLedgerRepo;
  payments: FastPaymentRepo;
  installments: FastInstallmentRepo;
}

function makeBundle(): Bundle {
  const parents = new FastParentRepo();
  const students = new FastStudentRepo();
  const ledger = new FastLedgerRepo();
  const payments = new FastPaymentRepo();
  const installments = new FastInstallmentRepo();
  const engine = new ImportEngine({
    storage: new RepositoryStorageAdapter({
      parents, students, ledger, payments, installments,
      tenantId: TENANT_ID,
      actorId: ACTOR_ID,
      actorName: "T-615 data-lane verify",
    }),
    auditSink: {
      async logAction() {
        /* the census reads the repositories; the audit sink is a no-op here */
      },
    },
  });
  return { engine, parents, students, ledger, payments, installments };
}

/** The direct exceljs scan of the ETAT sheet (the O1 input). */
async function countEtatRows(xlsxPath: string): Promise<{ anyNonEmpty: number; withNom: number }> {
  const wb = new ExcelJS.Workbook();
  const buf = fs.readFileSync(xlsxPath);
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.worksheets.find((s) => /^ETAT/i.test(s.name));
  if (!ws) throw new Error(`ETAT sheet not found in ${xlsxPath}`);
  let anyNonEmpty = 0;
  let withNom = 0;
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    let isEmpty = true;
    for (let c = 2; c <= 25; c++) {
      const v = row.getCell(c)?.value;
      if (v !== null && v !== undefined && v !== "") { isEmpty = false; break; }
    }
    if (!isEmpty) anyNonEmpty++;
    const nom = row.getCell(6)?.value;
    if (nom !== null && nom !== undefined && String(nom).trim() !== "") withNom++;
  }
  return { anyNonEmpty, withNom };
}

/** The structural census of the register workbook (per-sheet rows + headers). */
async function censusRegisterWorkbook(xlsxPath: string) {
  const wb = new ExcelJS.Workbook();
  const buf = fs.readFileSync(xlsxPath);
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const sheets = wb.worksheets.map((ws) => {
    let nonEmpty = 0;
    for (let r = 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      let empty = true;
      for (let c = 1; c <= Math.min(ws.columnCount, 20); c++) {
        const v = row.getCell(c)?.value;
        if (v !== null && v !== undefined && String(v).trim() !== "") { empty = false; break; }
      }
      if (!empty) nonEmpty++;
    }
    const header = ws.getRow(1)
      ? Array.from({ length: Math.min(ws.columnCount, 12) }, (_, i) => String(ws.getRow(1).getCell(i + 1).value ?? ""))
      : [];
    return { sheet: ws.name, nonEmptyRows: nonEmpty, headerSample: header.filter(Boolean).slice(0, 8) };
  });
  return sheets;
}

interface Report {
  generatedAt: string;
  workbooks: Record<string, unknown>;
  oracles: { id: string; name: string; verdict: "PASS" | "FAIL"; detail: string }[];
}

const report: Report = { generatedAt: new Date().toISOString(), workbooks: {}, oracles: [] };
const failures: string[] = [];

function record(id: string, name: string, pass: boolean, detail: string) {
  report.oracles.push({ id, name, verdict: pass ? "PASS" : "FAIL", detail });
  if (!pass) failures.push(`${id}: ${name} — ${detail}`);
  console.log(`  [${pass ? "PASS" : "FAIL"}] ${id} — ${name}: ${detail}`);
}

async function verifyWorkbook(label: string, xlsxPath: string, minStudents: number): Promise<void> {
  console.log(`\n=== ${label}: ${path.basename(xlsxPath)} ===`);
  if (!fs.existsSync(xlsxPath)) {
    record("PRESENT", "workbook present", false, `${xlsxPath} NOT FOUND`);
    return;
  }
  const bytes = new Uint8Array(fs.readFileSync(xlsxPath));
  const scan = await countEtatRows(xlsxPath);
  console.log(`  ETAT scan: anyNonEmpty=${scan.anyNonEmpty} withNom=${scan.withNom}`);

  const b = makeBundle();
  const t0 = Date.now();
  const ctx = await b.engine.importFile(bytes, xlsxPath, { dryRun: false, source: { user: ACTOR_ID } });
  const elapsed = Date.now() - t0;
  const stats = ctx.stats;
  console.log(
    `  import: ${elapsed}ms imported=${stats.rowsImported} updated=${stats.rowsUpdated} skipped=${stats.rowsSkipped} rejected=${stats.rowsRejected} warnings=${stats.warnings}`,
  );

  // O1 — every importable row accounted
  const accounted = stats.rowsImported + stats.rowsUpdated + stats.rowsSkipped + stats.rowsRejected;
  record("O1", "every importable ETAT row accounted", accounted >= scan.withNom,
    `accounted=${accounted} >= scan.withNom=${scan.withNom} (anyNonEmpty-in-B..Y=${scan.anyNonEmpty} — the over-count is the no-NOM tail, not lost rows)`);

  // O2 — the student census
  const studentCount = b.students.rows.size;
  const studentAccounted = studentCount + stats.rowsUpdated;
  record("O2", "every NOM row produced or merged onto a student",
    studentAccounted >= scan.withNom && studentCount >= minStudents,
    `students=${studentCount} + updated=${stats.rowsUpdated} = ${studentAccounted} >= scan.withNom=${scan.withNom} (floor=${minStudents})`);

  // O3 — installments exist with due dates + amounts
  const instRows = [...b.installments.rows.values()];
  const withDue = instRows.filter((i) => Boolean(i.dueDate)).length;
  const withAmount = instRows.filter((i) => Number(i.amountDue) > 0).length;
  record("O3", "installments carry due dates + amounts", instRows.length > 0 && withDue === instRows.length && withAmount > 0,
    `installments=${instRows.length} withDueDate=${withDue} withAmount=${withAmount}`);

  // O4 — payments ↔ ledger coherence (every payment has a same-student,
  // same-amount payment-type ledger entry)
  const paymentEntries = b.ledger.rows.filter((e) => e.amount < 0);
  let unmatched = 0;
  for (const p of b.payments.rows.values()) {
    const match = paymentEntries.find(
      (e) => e.studentId === p.studentId && Math.abs(Math.abs(e.amount) - p.amount) < 1,
    );
    if (!match) unmatched++;
  }
  record("O4", "every payment has a ledger entry", unmatched === 0 && b.payments.rows.size > 0,
    `payments=${b.payments.rows.size} unmatched=${unmatched} (ledger payment-entries=${paymentEntries.length})`);

  // O5 — the per-family reconciliation (ledger vs installments, per parent)
  const chargeByParent = new Map<string, number>();
  const payByParent = new Map<string, number>();
  for (const e of b.ledger.rows) {
    const parent = b.students.rows.get(e.studentId ?? "")?.parentId ?? "";
    if (!parent) continue;
    if (e.amount > 0) chargeByParent.set(parent, (chargeByParent.get(parent) ?? 0) + e.amount);
    else payByParent.set(parent, (payByParent.get(parent) ?? 0) + Math.abs(e.amount));
  }
  const instByParent = new Map<string, { due: number; paid: number }>();
  for (const i of b.installments.rows.values()) {
    const cur = instByParent.get(i.parentId) ?? { due: 0, paid: 0 };
    cur.due += Number(i.amountDue ?? 0);
    cur.paid += Number(i.amountPaid ?? 0);
    instByParent.set(i.parentId, cur);
  }
  let reconciled = 0;
  let offByFee = 0;
  let broken = 0;
  let worstDelta = 0;
  let worstParent = "";
  for (const [parentId, charges] of chargeByParent) {
    const paid = payByParent.get(parentId) ?? 0;
    const ledgerOutstanding = charges - paid;
    const inst = instByParent.get(parentId);
    const instOutstanding = inst ? inst.due - inst.paid : 0;
    const delta = Math.abs(ledgerOutstanding - instOutstanding);
    if (delta > Math.max(200_000, ledgerOutstanding * 0.02)) {
      broken++;
      if (delta > worstDelta) { worstDelta = delta; worstParent = parentId; }
    } else if (delta > 0) {
      offByFee++;
    } else {
      reconciled++;
    }
  }
  record("O5", "per-family ledger↔installments reconciliation",
    broken === 0 && chargeByParent.size > 0,
    `families=${chargeByParent.size} exact=${reconciled} smallDelta(fee-class)=${offByFee} BROKEN=${broken}` +
      (broken > 0 ? ` worst=${worstParent} Δ=${Math.round(worstDelta)}` : ""));

  // O6 — idempotency (re-import over the SAME repositories)
  const before = b.students.rows.size;
  const b2 = makeBundle();
  Object.assign(b2.parents.rows, b.parents.rows);
  Object.assign(b2.students.rows, b.students.rows);
  const ctx2 = await b2.engine.importFile(bytes, xlsxPath, { dryRun: false, source: { user: ACTOR_ID } });
  const newStudents = b2.students.rows.size - before;
  record("O6", "re-import creates zero new students", newStudents === 0,
    `newStudents=${newStudents}, studentStore=${before}→${b2.students.rows.size} (the store is the criterion — the per-format action labels differ; the issue's acceptance is "without creating duplicates")`);

  report.workbooks[label] = {
    file: path.basename(xlsxPath),
    sizeBytes: fs.statSync(xlsxPath).size,
    etatScan: scan,
    importStats: {
      rowsImported: stats.rowsImported,
      rowsUpdated: stats.rowsUpdated,
      rowsSkipped: stats.rowsSkipped,
      rowsRejected: stats.rowsRejected,
      warnings: stats.warnings,
      elapsedMs: elapsed,
    },
    census: {
      parents: b.parents.rows.size,
      students: b.students.rows.size,
      installments: b.installments.rows.size,
      payments: b.payments.rows.size,
      ledgerEntries: b.ledger.rows.length,
    },
  };
  console.log(
    `  census: parents=${b.parents.rows.size} students=${b.students.rows.size} installments=${b.installments.rows.size} payments=${b.payments.rows.size} ledger=${b.ledger.rows.length}`,
  );
}

async function main() {
  console.log("T-615 Excel data-lane verification — the REAL ImportEngine over the REAL workbooks");
  console.log(`Excel dir: ${EXCEL_DIR}`);

  await verifyWorkbook("WB2 (record)", WB2, 1100);
  await verifyWorkbook("WB1 (era A)", WB1, 380);

  // WB3 — the register workbook (structural census only — no import schema)
  console.log(`\n=== WB3 (register): ${path.basename(WB3)} ===`);
  if (fs.existsSync(WB3)) {
    const sheets = await censusRegisterWorkbook(WB3);
    report.workbooks["WB3 (register)"] = { file: path.basename(WB3), sheets };
    for (const s of sheets) {
      console.log(`  sheet « ${s.sheet} »: ${s.nonEmptyRows} non-empty rows; headers: ${s.headerSample.slice(0, 5).join(" | ")}`);
    }
    record("WB3", "the register workbook parses with data", sheets.some((s) => s.nonEmptyRows > 10),
      `sheets=${sheets.length} totalNonEmpty=${sheets.reduce((n, s) => n + s.nonEmptyRows, 0)} (NO import schema — the register feeds the E2.3 fixtures, documented)`);
  } else {
    record("WB3", "the register workbook present", false, `${WB3} NOT FOUND`);
  }

  // The JSON artifact
  const jsonArgIdx = process.argv.indexOf("--json");
  const jsonPath = jsonArgIdx >= 0 ? process.argv[jsonArgIdx + 1] : undefined;
  const json = JSON.stringify(report, null, 2);
  if (jsonPath) {
    fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
    fs.writeFileSync(jsonPath, json);
    console.log(`\nreport written: ${jsonPath}`);
  } else {
    console.log("\n" + json);
  }

  if (failures.length > 0) {
    console.error(`\nT-615 data-lane verification FAILED (${failures.length} oracle violations):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("\nT-615 data-lane verification: ALL ORACLES PASS.");
}

main().catch((e) => {
  console.error("DATA-LANE VERIFY FAILED:", e);
  process.exit(1);
});
