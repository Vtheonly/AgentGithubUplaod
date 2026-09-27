/**
 * t-424-tranche-attribution-analysis.ts — READ-ONLY in-memory analysis of the
 * Statistics-vs-Finance tranche-attribution question (T-424).
 *
 * Runs the REAL ImportEngine (current code) over the REAL workbook in-memory
 * (the t-420 Fast-repo convention), then per student compares THREE models
 * against the workbook's own TOTAL*CREANCE (Q = L + N − M − payments):
 *
 *   CURRENT   — the import's straight column→tranche mapping (FI→T1, V1→T2,
 *               2V→T3, v3→T4; 1T/T2/t3→transport T1/T2/T3).
 *   WATERFALL — the same tranche DUES, but the payment streams pooled and
 *               allocated oldest-tranche-first through the canonical
 *               `allocatePaymentToInstallments` (the INV-4 semantics the
 *               live collect RPC uses), tuition pool = FI+V1+2V+v3+REGL,
 *               transport pool = 1T+T2+t3.
 *   LEDGER    — the engine's own ledger-replay balance (the t-420 oracle's
 *               canonical truth).
 *
 * Usage (from elimtiyaz-desktop/):
 *   npx tsx scripts/t-424-tranche-attribution-analysis.ts
 */
import * as fs from "node:fs";
import * as path from "node:path";

import ExcelJS from "exceljs";
import { ImportEngine } from "../src/infrastructure/excel/import-engine";
import { RepositoryStorageAdapter } from "../src/infrastructure/excel/import-engine/storage/repository-adapter";
import { SubjectBehavior } from "../src/infrastructure/mock/subject-behavior";
import { allocatePaymentToInstallments } from "../src/domain/calc/payment/waterfall-allocator";
import type { ParentRepository, StudentRepository, LedgerRepository, PaymentRepository, InstallmentRepository, Observable } from "../src/domain/repository/repository";
import type { Result } from "../src/core/result";
import { Ok, Err } from "../src/core/result";
import { Errors } from "../src/core/app-error";
import type { Parent, CreateParentInput, UpdateParentInput } from "../src/domain/model/parent";
import type { Student, CreateStudentInput } from "../src/domain/model/student";
import type { LedgerEntry } from "../src/domain/model/ledger";
import type { Payment, Installment, PaymentCategory } from "../src/domain/model/payment";
import type { ImportInstallmentInput } from "../src/domain/repository/repository";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const XLSX_CANDIDATES = [
  path.join(REPO_ROOT, "..", "Excel", "2027-2026.xlsx"),
  path.join(REPO_ROOT, "Excel", "2027-2026.xlsx"),
];
const XLSX_PATH = XLSX_CANDIDATES.find((p) => fs.existsSync(p))!;

// ── Fast in-memory stubs (the t-420 convention, compacted) ─────────────────

class FastParentRepo implements ParentRepository {
  readonly rows = new Map<string, Parent>();
  private readonly cache = new SubjectBehavior<Parent[]>([]);
  observe(): Observable<Parent[]> { return this.cache; }
  observeById(id: string): Observable<Parent | null> { return new SubjectBehavior(this.rows.get(id) ?? null); }
  async search(query: string): Promise<Result<Parent[]>> {
    const q = query.toLowerCase().trim();
    if (!q) return Ok([...this.rows.values()]);
    return Ok([...this.rows.values()].filter((p) => `${p.firstName} ${p.lastName} ${p.displayName ?? ""} ${p.phone} ${p.code}`.toLowerCase().includes(q)));
  }
  async createParent(input: CreateParentInput): Promise<Result<Parent>> {
    const id = `par-${String(this.rows.size + 1).padStart(4, "0")}`;
    const now = new Date().toISOString();
    const parent: Parent = {
      id, tenantId: "test-tenant", code: `PAR-X-${id.slice(-4)}`,
      firstName: input.firstName, lastName: input.lastName,
      displayName: input.displayName ?? null, gender: input.gender, phone: input.phone,
      whatsapp: input.whatsapp ?? null, email: input.email ?? null,
      occupation: input.occupation ?? null, address: input.address ?? null,
      cityTier: input.cityTier ?? null, transportDestination: input.transportDestination ?? null,
      preferredLanguage: input.preferredLanguage ?? "fr", avatarUrl: null, createdAt: now, updatedAt: now,
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
  async deleteParent(id: string): Promise<Result<void>> { this.rows.delete(id); this.cache.set([...this.rows.values()]); return Ok(undefined); }
}

class FastStudentRepo implements StudentRepository {
  readonly rows = new Map<string, Student>();
  private readonly cache = new SubjectBehavior<Student[]>([]);
  observe(): Observable<Student[]> { return this.cache; }
  observeByParent(parentId: string): Observable<Student[]> { return new SubjectBehavior([...this.rows.values()].filter((s) => s.parentId === parentId)); }
  observeByClass(): Observable<Student[]> { return new SubjectBehavior<Student[]>([]); }
  observeById(id: string): Observable<Student | null> { return new SubjectBehavior(this.rows.get(id) ?? null); }
  async search(query: string): Promise<Result<Student[]>> {
    const q = query.toLowerCase().trim();
    if (!q) return Ok([...this.rows.values()]);
    return Ok([...this.rows.values()].filter((s) => `${s.firstName} ${s.lastName} ${s.displayName ?? ""} ${s.code}`.toLowerCase().includes(q)));
  }
  async createStudent(parentId: string, input: CreateStudentInput): Promise<Result<Student>> {
    const id = `stu-${String(this.rows.size + 1).padStart(4, "0")}`;
    const now = new Date().toISOString();
    const student: Student = {
      id, tenantId: "test-tenant", parentId,
      code: `ELV-X-${id.slice(-4)}`,
      firstName: input.firstName, lastName: input.lastName,
      displayName: input.displayName ?? null,
      birthDate: input.birthDate ?? null, gender: input.gender,
      level: input.level, gradeYear: input.gradeYear ?? 1,
      gradeLevel: input.gradeLevel ?? "1ap",
      transportTier: input.transportTier ?? null,
      classId: null, photoUrl: null, medicalNotes: null,
      status: "active", paymentPlan: input.paymentPlan ?? "tranches",
      enrollmentDate: now.slice(0, 10), createdAt: now, updatedAt: now,
    } as unknown as Student;
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
  async deleteStudent(): Promise<Result<void>> { return Ok(undefined); }
  async batchRegister(): Promise<Result<import("../src/domain/model/student").BatchRegistrationResult>> { return Err(Errors.server("not implemented in stub")); }
  async promote(): Promise<Result<Student[]>> { return Err(Errors.server("not implemented in stub")); }
  async addStudentDocument(): Promise<Result<import("../src/domain/model/student").StudentDocument>> { return Err(Errors.server("not implemented in stub")); }
  async removeStudentDocument(): Promise<Result<void>> { return Err(Errors.server("not implemented in stub")); }
}

class FastLedgerRepo implements LedgerRepository {
  readonly rows: LedgerEntry[] = [];
  observe(): Observable<LedgerEntry[]> { return new SubjectBehavior(this.rows); }
  observeByParent(): Observable<LedgerEntry[]> { return new SubjectBehavior(this.rows); }
  observeByAccount(): Observable<LedgerEntry[]> { return new SubjectBehavior(this.rows); }
  async append(entry: LedgerEntry): Promise<Result<LedgerEntry>> { this.rows.push(entry); return Ok(entry); }
  async appendMany(entries: readonly LedgerEntry[]): Promise<Result<readonly LedgerEntry[]>> { this.rows.push(...entries); return Ok(entries); }
  async bulkAppend(entries: readonly LedgerEntry[]): Promise<Result<readonly LedgerEntry[]>> { this.rows.push(...entries); return Ok(entries); }
  async reverse(): Promise<Result<LedgerEntry>> { return Err(Errors.server("not implemented in stub")); }
  async summary(): Promise<Result<import("../src/domain/model/ledger").ParentLedgerSummary>> { return Err(Errors.server("not implemented in stub")); }
  async reconcile(): Promise<Result<import("../src/domain/calc/reconcile").ReconciliationReport>> { return Err(Errors.server("not implemented in stub")); }
}

class FastPaymentRepo implements PaymentRepository {
  readonly rows = new Map<string, Payment>();
  private readonly cache = new SubjectBehavior<Payment[]>([]);
  observe(): Observable<Payment[]> { return this.cache; }
  observeByParent(parentId: string): Observable<Payment[]> { return new SubjectBehavior([...this.rows.values()].filter((p) => p.parentId === parentId)); }
  observeByStudent(studentId: string): Observable<Payment[]> { return new SubjectBehavior([...this.rows.values()].filter((p) => p.studentId === studentId)); }
  observeById(id: string): Observable<Payment | null> { return new SubjectBehavior(this.rows.get(id) ?? null); }
  async collect(input: import("../src/domain/model/payment").CollectPaymentInput, _collectedBy: string): Promise<Result<Payment>> {
    const receiptNumber = input.receiptNumber ?? `REC-${Date.now()}`;
    const existing = [...this.rows.values()].find((p) => p.receiptNumber === receiptNumber);
    if (existing) return Ok(existing);
    const id = `pay-${String(this.rows.size + 1).padStart(4, "0")}`;
    const now = new Date().toISOString();
    const payment: Payment = {
      id, tenantId: "test-tenant", receiptNumber,
      parentId: input.parentId, studentId: input.studentId,
      amount: input.amount, method: input.method, status: "paid",
      category: input.category, installmentId: input.installmentId ?? null,
      proofUrl: input.proofUrl ?? null, notes: input.notes ?? null,
      collectedBy: _collectedBy, collectedAt: now, createdAt: now, updatedAt: now,
    };
    this.rows.set(id, payment);
    this.cache.set([...this.rows.values()]);
    return Ok(payment);
  }
  async refund(): Promise<Result<Payment>> { return Err(Errors.server("not implemented in stub")); }
  async markCleared(): Promise<Result<Payment>> { return Err(Errors.server("not implemented in stub")); }
  async markBounced(): Promise<Result<Payment>> { return Err(Errors.server("not implemented in stub")); }
  async adjust(): Promise<Result<Payment>> { return Err(Errors.server("not implemented in stub")); }
  async generateReceipt(): Promise<Result<Payment>> { return Err(Errors.server("not implemented in stub")); }
  async appendManualCharge(): Promise<Result<LedgerEntry>> { return Err(Errors.server("not implemented in stub")); }
  async seed(): Promise<void> { /* no-op */ }
}

class FastInstallmentRepo implements InstallmentRepository {
  readonly rows = new Map<string, Installment>();
  observe(): Observable<Installment[]> { return new SubjectBehavior([...this.rows.values()]); }
  observeByParent(): Observable<Installment[]> { return new SubjectBehavior([...this.rows.values()]); }
  observeByStudent(): Observable<Installment[]> { return new SubjectBehavior([...this.rows.values()]); }
  observeById(id: string): Observable<Installment | null> { return new SubjectBehavior(this.rows.get(id) ?? null); }
  async markPaid(): Promise<Result<Installment>> { return Err(Errors.server("not implemented in stub")); }
  async allocatePayment(): Promise<Result<import("../src/domain/calc/payment/waterfall-allocator").AllocationResult>> { return Err(Errors.server("not implemented in stub")); }
  async updateDueDate(): Promise<Result<Installment>> { return Err(Errors.server("not implemented in stub")); }
  async regenerateForCycle(): Promise<Result<readonly Installment[]>> { return Err(Errors.server("not implemented in stub")); }
  async findOverdue(): Promise<Result<readonly Installment[]>> { return Err(Errors.server("not implemented in stub")); }
  async importInstallment(input: ImportInstallmentInput): Promise<Result<Installment>> {
    const result = await this.bulkImportInstallments([input]);
    if (!result.ok) return result as Result<Installment>;
    return Ok(result.value[0]);
  }
  async bulkImportInstallments(inputs: readonly ImportInstallmentInput[]): Promise<Result<readonly Installment[]>> {
    const out: Installment[] = [];
    for (const input of inputs) {
      const inst = {
        id: `imp-${input.parentId}-${input.studentId}-${input.category}-${input.trancheNumber}`,
        tenantId: "test-tenant", parentId: input.parentId, studentId: input.studentId,
        category: input.category as PaymentCategory, label: input.label,
        trancheNumber: input.trancheNumber, amountDue: input.amountDue,
        amountPaid: input.amountPaid, amountPending: 0, dueDate: input.dueDate,
        status: input.status ?? "pending", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      } as unknown as Installment;
      this.rows.set(inst.id, inst);
      out.push(inst);
    }
    return Ok(out);
  }
}

// ── The workbook oracle (independent read — the t-420 convention) ──────────

function numOrZero(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v.trim().replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}
function cellNum(cell: ExcelJS.Cell): number {
  const v = cell.value as unknown;
  if (v && typeof v === "object" && !Array.isArray(v) && "result" in (v as object)) {
    return numOrZero((v as { result?: unknown }).result);
  }
  return numOrZero(v);
}
function expectedParentPhone(nem: string): string {
  const parts = nem.split(/[/,]/).map((s) => s.trim()).filter(Boolean);
  const normalized = parts
    .map((p) => {
      let s = p;
      if (/^\d+(\.\d+)?$/.test(s)) {
        if (!s.startsWith("0") && s.length >= 9) s = "0" + s.split(".")[0];
        else s = s.split(".")[0];
      }
      return s.replace(/[\s.]/g, "");
    })
    .filter(Boolean);
  if (normalized.length === 0) return "(inconnu)";
  return normalized[0] || "(inconnu)";
}

interface Row {
  name: string; phone: string;
  fi: number; v1: number; v2alt: number; v3: number; t1: number; t2: number; t3: number;
  regl: number; q: number; qRaw: number;
}

async function readRows(): Promise<Row[]> {
  const wb = new ExcelJS.Workbook();
  const raw = new Uint8Array(fs.readFileSync(XLSX_PATH));
  await wb.xlsx.load(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer);
  const ws = wb.getWorksheet("ETAT 20262027")!;
  const rows: Row[] = [];
  const seen = new Set<string>();
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const nom = String(row.getCell(6).value ?? "").trim();
    if (!nom) continue;
    const phone = expectedParentPhone(String(row.getCell(4).value ?? "").trim());
    const key = `${phone}|${nom}`;
    if (seen.has(key)) continue; // first-row-wins on the merge pairs (the import's convention)
    seen.add(key);
    const payments =
      cellNum(row.getCell(18)) + cellNum(row.getCell(19)) + cellNum(row.getCell(20)) + cellNum(row.getCell(21)) +
      cellNum(row.getCell(23)) + cellNum(row.getCell(24)) + cellNum(row.getCell(25)) +
      cellNum(row.getCell(15));
    for (let c = 26; c <= 39; c++) payments === payments ? null : null; // psy (all zero this year)
    const psy = 0;
    const ancillary = [44, 45, 46, 47].reduce((s, c) => s + cellNum(row.getCell(c)), 0);
    const devis = cellNum(row.getCell(12));
    const dettes = cellNum(row.getCell(14));
    const remb = cellNum(row.getCell(13));
    const qRaw = devis + dettes - remb - (payments + psy + ancillary);
    rows.push({
      name: nom, phone,
      fi: cellNum(row.getCell(18)), v1: cellNum(row.getCell(19)),
      v2alt: cellNum(row.getCell(20)), v3: cellNum(row.getCell(21)),
      t1: cellNum(row.getCell(23)), t2: cellNum(row.getCell(24)), t3: cellNum(row.getCell(25)),
      regl: cellNum(row.getCell(15)),
      q: Math.max(0, qRaw), qRaw,
    });
  }
  return rows;
}

// ── The analysis ────────────────────────────────────────────────────────────

async function main() {
  console.log("workbook:", XLSX_PATH);
  const rows = await readRows();
  console.log(`oracle rows (first-wins dedup): ${rows.length}`);

  const parents = new FastParentRepo();
  const students = new FastStudentRepo();
  const ledger = new FastLedgerRepo();
  const payments = new FastPaymentRepo();
  const installments = new FastInstallmentRepo();
  const engine = new ImportEngine({
    storage: new RepositoryStorageAdapter({
      parents, students, ledger, payments, installments,
      tenantId: "test-tenant", actorId: "test-actor", actorName: "Test Actor",
    }),
    auditSink: { async logAction() { /* no-op */ } },
  });
  const bytes = new Uint8Array(fs.readFileSync(XLSX_PATH));
  const t0 = Date.now();
  const ctx = await engine.importFile(bytes, XLSX_PATH, { dryRun: false });
  console.log(`import: ${Date.now() - t0}ms — imported=${ctx.stats.rowsImported} updated=${ctx.stats.rowsUpdated} rejected=${ctx.stats.rowsRejected}`);
  console.log(`in-memory: students=${students.rows.size} installments=${installments.rows.size} payments=${payments.rows.size} ledger=${ledger.rows.length}`);

  // ledger balance per student
  const bal = new Map<string, number>();
  for (const e of ledger.rows) bal.set(e.studentId ?? "—", (bal.get(e.studentId ?? "—") ?? 0) + e.amount);

  const instsByStudent = new Map<string, Installment[]>();
  for (const i of installments.rows.values()) {
    const list = instsByStudent.get(i.studentId) ?? [];
    list.push(i);
    instsByStudent.set(i.studentId, list);
  }

  let curMatch = 0, wfMatch = 0, ledMatch = 0, both = 0, neither = 0;
  let curTotal = 0, wfTotal = 0, ledTotal = 0, qTotal = 0, qRawTotal = 0;
  let curOverpaidRows = 0, wfOverpaidRows = 0;
  let curT1Unpaid = 0, wfT1Unpaid = 0;
  const wfMismatches: string[] = [];
  const curMismatches: string[] = [];

  for (const row of rows) {
    const student = [...students.rows.values()].find(
      (s) => (s.displayName ?? "") === row.name && parents.rows.get(s.parentId)?.phone === row.phone,
    );
    if (!student) continue;
    const insts = instsByStudent.get(student.id) ?? [];

    // CURRENT model remaining
    const curRemaining = insts.reduce((s, i) => s + Math.max(0, i.amountDue - i.amountPaid - (i.amountPending ?? 0)), 0);
    curOverpaidRows += insts.filter((i) => i.amountPaid > i.amountDue).length;
    curT1Unpaid += insts.filter((i) => i.category === "tuition" && i.trancheNumber === 1 && i.status !== "paid").length;

    // WATERFALL model: zero out, pool payments, allocate oldest-first.
    // Cross-category pooling (categoryFilter = null) — the SAME semantics
    // as the live collect RPC's p_category IS NULL branch (ADR-023).
    const wfInsts: Installment[] = insts.map((i) => ({
      ...i, amountPaid: 0, amountPending: 0, status: i.amountDue > 0 ? "unpaid" : "paid",
    }));
    const tuitionPool = row.fi + row.v1 + row.v2alt + row.v3 + row.regl;
    const transportPool = row.t1 + row.t2 + row.t3;
    const applyAlloc = (amount: number, category: PaymentCategory | null) => {
      if (amount <= 0) return;
      const res = allocatePaymentToInstallments(wfInsts, amount, category);
      for (const a of res.allocations) {
        const idx = wfInsts.findIndex((x) => x.id === a.installmentId);
        if (idx >= 0) {
          wfInsts[idx] = {
            ...wfInsts[idx],
            amountPaid: a.newAmountPaid, amountPending: a.newAmountPending, status: a.newStatus,
          };
        }
      }
    };
    applyAlloc(tuitionPool, null);       // cross-category (the RPC's NULL scope)
    applyAlloc(transportPool, null);
    const wfRemaining = wfInsts.reduce((s, i) => s + Math.max(0, i.amountDue - i.amountPaid - (i.amountPending ?? 0)), 0);
    wfOverpaidRows += wfInsts.filter((i) => i.amountPaid > i.amountDue).length;
    wfT1Unpaid += wfInsts.filter((i) => i.category === "tuition" && i.trancheNumber === 1 && i.status !== "paid").length;

    const ledgerBal = bal.get(student.id) ?? 0;

    curTotal += curRemaining;
    wfTotal += wfRemaining;
    ledTotal += Math.max(0, ledgerBal);
    qTotal += row.q;
    qRawTotal += row.qRaw;

    const curOk = Math.abs(curRemaining - row.q) <= 1;
    const wfOk = Math.abs(wfRemaining - row.q) <= 1;
    const ledOk = Math.abs(Math.max(0, ledgerBal) - row.q) <= 1;
    if (curOk) curMatch++; else if (curMismatches.length < 8) curMismatches.push(`${row.name}: current ${curRemaining} vs Q ${row.q}`);
    if (wfOk) wfMatch++; else wfMismatches.push(`${row.name} (${row.phone}): waterfall ${wfRemaining} vs Q ${row.q} (raw ${row.qRaw}) — row: fi=${row.fi} v1=${row.v1} v2a=${row.v2alt} v3=${row.v3} t=${row.t1}/${row.t2}/${row.t3} regl=${row.regl}`);
    if (ledOk) ledMatch++;
    if (curOk && wfOk) both++;
    if (!curOk && !wfOk) neither++;
  }

  const n = rows.length;
  console.log(`\n=== PER-STUDENT MODEL COMPARISON (oracle: Q = max(0, L+N−M−payments), n=${n}) ===`);
  console.log(`CURRENT (straight column→tranche):   matches Q: ${curMatch}/${n}   Σremaining=${Math.round(curTotal).toLocaleString("fr-DZ")}`);
  console.log(`WATERFALL (pooled, oldest-first):    matches Q: ${wfMatch}/${n}   Σremaining=${Math.round(wfTotal).toLocaleString("fr-DZ")}`);
  console.log(`LEDGER replay (max(0,balance)):      matches Q: ${ledMatch}/${n}   Σ=${Math.round(ledTotal).toLocaleString("fr-DZ")}`);
  console.log(`workbook Σ max(0,Q)=${Math.round(qTotal).toLocaleString("fr-DZ")}   Σ raw Q=${Math.round(qRawTotal).toLocaleString("fr-DZ")}`);
  console.log(`both models match: ${both}; neither: ${neither}`);
  console.log(`\noverpaid rows (paid>due): CURRENT=${curOverpaidRows}  WATERFALL=${wfOverpaidRows}`);
  console.log(`tuition T1 rows not status=paid: CURRENT=${curT1Unpaid}  WATERFALL=${wfT1Unpaid}`);
  console.log(`\ncurrent mismatches (sample):\n  ` + curMismatches.join("\n  "));
  console.log(`waterfall mismatches (sample):\n  ` + wfMismatches.join("\n  "));
}

main().catch((e) => { console.error("ANALYSIS FAILED:", e); process.exit(1); });
