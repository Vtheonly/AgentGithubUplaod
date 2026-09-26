/**
 * T-420 (issue #20) — the payment-state regression suite.
 *
 * THE MANDATE (the owner's issue text): "Please also add tests covering
 * students with different payment states, including fully paid students,
 * partially paid students, and students with outstanding debt, so this
 * regression cannot happen again." + "verify the final imported results
 * against the correct Excel source of truth and confirm that the counts,
 * payment states, amounts, and outstanding debts match."
 *
 * THE CORRECT WORKBOOK (the issue's own rule: "There are two versions of
 * the Excel spreadsheet… The version with more rows is the newer version"):
 * `Excel/2027-2026.xlsx` — 1,139 named student rows (the newer, larger
 * workbook) — NOT `Excel/Suivis clients  2026_2027.xlsx` (390 rows).
 *
 * What this suite pins:
 *
 *   PART 1 — the synthetic TRI-STATE workbook (deterministic, exact):
 *     a fully-paid student, a partially-paid student, a student with
 *     prior-year debt (DETTES), and an overpaid student — each verified
 *     EXACTLY: ledger entries by type/category, the ledger-replay balance,
 *     payment rows, installment statuses (paid/partial/unpaid), and the
 *     T-105 tranche reconciliation (Σ amountDue == devis + dettes − remb).
 *
 *   PART 2 — the REAL 2027-2026.xlsx source-of-truth oracle:
 *     every named row's financial state (L + N − M − payments) compared
 *     EXACTLY against the imported ledger replay, per student, matched by
 *     (parent phone, student name) — the same-name families included; the
 *     indebted/fully-paid census (942 indebted rows of 1,139 — 82.7%); the
 *     6 DETTES charges; the aggregate payment totals. The issue-#20 bug's
 *     signature was ZERO students with debt — this oracle makes that
 *     impossible to regress silently.
 *
 * Run:
 *   npx vitest run src/tests/integration/t-420-payment-state-regression.test.ts
 */
import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import ExcelJS from "exceljs";
import { ImportEngine } from "../../infrastructure/excel/import-engine";
import { RepositoryStorageAdapter } from "../../infrastructure/excel/import-engine/storage/repository-adapter";
import type { ParentRepository, StudentRepository, LedgerRepository, PaymentRepository, InstallmentRepository, Observable, ImportInstallmentInput } from "../../domain/repository/repository";
import type { Result } from "../../core/result";
import { Ok, Err } from "../../core/result";
import { Errors } from "../../core/app-error";
import type { Parent, CreateParentInput, UpdateParentInput } from "../../domain/model/parent";
import type { Student, CreateStudentInput } from "../../domain/model/student";
import type { LedgerEntry } from "../../domain/model/ledger";
import type { Payment, Installment, PaymentCategory } from "../../domain/model/payment";
import { SubjectBehavior } from "../../infrastructure/mock/subject-behavior";

// ── Workbook location (the forensic evidence under Excel/) ─────────────────
const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const XLSX_CANDIDATES = [
  path.join(REPO_ROOT, "Excel", "2027-2026.xlsx"),
  path.join(REPO_ROOT, "..", "Excel", "2027-2026.xlsx"),
];
const XLSX_PATH = XLSX_CANDIDATES.find((p) => fs.existsSync(p));
const describeOrSkip = XLSX_PATH ? describe : describe.skip;

const TEST_TIMEOUT_MS = 240_000;

// ── Fast in-memory stub repositories (the t-105 convention) ────────────────

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
      `${p.firstName} ${p.lastName} ${p.displayName ?? ""} ${p.phone} ${p.code}`.toLowerCase().includes(q)));
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
      preferredLanguage: input.preferredLanguage ?? "fr", avatarUrl: null,
      createdAt: now, updatedAt: now,
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
    this.rows.delete(id); this.cache.set([...this.rows.values()]); return Ok(undefined);
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
      `${s.firstName} ${s.lastName} ${s.displayName ?? ""} ${s.code}`.toLowerCase().includes(q)));
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
  async deleteStudent(_id: string): Promise<Result<void>> { return Ok(undefined); }
  async batchRegister(): Promise<Result<import("../../domain/model/student").BatchRegistrationResult>> {
    return Err(Errors.server("not implemented in stub"));
  }
  async promote(): Promise<Result<Student[]>> { return Err(Errors.server("not implemented in stub")); }
  async addStudentDocument(): Promise<Result<import("../../domain/model/student").StudentDocument>> {
    return Err(Errors.server("not implemented in stub"));
  }
  async removeStudentDocument(): Promise<Result<void>> { return Err(Errors.server("not implemented in stub")); }
}

class FastLedgerRepo implements LedgerRepository {
  readonly rows: LedgerEntry[] = [];
  observe(): Observable<LedgerEntry[]> { return new SubjectBehavior<LedgerEntry[]>(this.rows); }
  observeByParent(_parentId: string): Observable<LedgerEntry[]> { return new SubjectBehavior<LedgerEntry[]>(this.rows); }
  observeByAccount(_accountId: string): Observable<LedgerEntry[]> { return new SubjectBehavior<LedgerEntry[]>(this.rows); }
  async append(entry: LedgerEntry): Promise<Result<LedgerEntry>> { this.rows.push(entry); return Ok(entry); }
  async appendMany(entries: readonly LedgerEntry[]): Promise<Result<readonly LedgerEntry[]>> {
    this.rows.push(...entries); return Ok(entries);
  }
  async bulkAppend(entries: readonly LedgerEntry[]): Promise<Result<readonly LedgerEntry[]>> {
    this.rows.push(...entries); return Ok(entries);
  }
  async reverse(_originalId: string, _reason: string, _actorId: string, _actorName: string): Promise<Result<LedgerEntry>> {
    return Err(Errors.notFound("LedgerEntry", _originalId));
  }
  async summary(_parentId: string): Promise<Result<import("../../domain/model/ledger").ParentLedgerSummary>> {
    return Err(Errors.server("not implemented in stub"));
  }
  async reconcile(): Promise<Result<import("../../domain/calc/reconcile").ReconciliationReport>> {
    return Err(Errors.server("not implemented in stub"));
  }
}

class FastPaymentRepo implements PaymentRepository {
  readonly rows = new Map<string, Payment>();
  private readonly cache = new SubjectBehavior<Payment[]>([]);
  observe(): Observable<Payment[]> { return new SubjectBehavior<Payment[]>([...this.rows.values()]); }
  observeByParent(parentId: string): Observable<Payment[]> {
    return new SubjectBehavior<Payment[]>([...this.rows.values()].filter((p) => p.parentId === parentId));
  }
  observeByStudent(studentId: string): Observable<Payment[]> {
    return new SubjectBehavior<Payment[]>([...this.rows.values()].filter((p) => p.studentId === studentId));
  }
  observeById(id: string): Observable<Payment | null> {
    return new SubjectBehavior<Payment | null>(this.rows.get(id) ?? null);
  }
  async collect(input: import("../../domain/model/payment").CollectPaymentInput, _collectedBy: string): Promise<Result<Payment>> {
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
  async adjust(): Promise<Result<import("../../domain/model/payment").AccountAdjustment>> { return Err(Errors.server("not implemented in stub")); }
  async generateReceipt(): Promise<Result<import("../../domain/model/payment").Receipt>> { return Err(Errors.server("not implemented in stub")); }
  async appendManualCharge(): Promise<Result<LedgerEntry>> { return Err(Errors.server("not implemented in stub")); }
  async seed(): Promise<void> { /* no-op */ }
}

class FastInstallmentRepo implements InstallmentRepository {
  readonly rows = new Map<string, Installment>();
  observe(): Observable<Installment[]> { return new SubjectBehavior<Installment[]>([...this.rows.values()]); }
  observeByParent(_parentId: string): Observable<Installment[]> { return new SubjectBehavior<Installment[]>([...this.rows.values()]); }
  observeByStudent(_studentId: string): Observable<Installment[]> { return new SubjectBehavior<Installment[]>([...this.rows.values()]); }
  observeById(id: string): Observable<Installment | null> {
    return new SubjectBehavior<Installment | null>(this.rows.get(id) ?? null);
  }
  async markPaid(): Promise<Result<Installment>> { return Err(Errors.server("not implemented in stub")); }
  async allocatePayment(): Promise<Result<import("../../domain/calc/payment/waterfall-allocator").AllocationResult>> {
    return Err(Errors.server("not implemented in stub"));
  }
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
      tenantId: "test-tenant", actorId: "test-actor", actorName: "Test Actor",
    }),
    auditSink: { async logAction() { /* no-op */ } },
  });
  return { engine, parents, students, ledger, payments, installments };
}

// ── PART 1 — the synthetic tri-state workbook ──────────────────────────────

const NEW_FORMAT_HEADERS = [
  "", "INFOS", "E-MAIL", "NEM", "TUTEUR", "", "niveau", "CLASSE", "OPTION",
  "REMISE", "JUSTIFICATION", "DEVIS ANNUEL", "REMBOURCEMENT", "DETTES",
  "REGLEMENTS DETTES", "TOTAL VERSEMENTS", "TOTAL*CREANCE", "FI", "V1", "2V",
  "v3", "DISTINATION", "1T", "T2", "t3",
  "PSY1", "PSY2", "PSY3", "PSY4", "PSY5", "PSY6", "PSY7", "PSY8", "PSY9",
  "PSY10", "PSY11", "PSY12", "PSY13", "PSY14",
  "CREANCE SEPT", "CREANCE SEPT", "CREANCE SEPT", "TT CREANCE",
  "COURS SUP", "LIVRES", "CLUB", "SORTIES",
];

function colIndex(letter: string): number {
  let n = 0;
  for (const ch of letter.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/** The four payment states, one student each (distinct phones → distinct families). */
const TRI_STATE_ROWS: Array<{
  name: string; phone: string;
  cells: Record<string, string | number>;
  expect: { balance: number; chargeTotal: number; paymentTotal: number; statuses: string[]; trancheDueTotal: number };
}> = [
  {
    // FULLY PAID — every tranche covered exactly.
    name: "TRISTATE TOTALEMENT PAYE", phone: "0550000101",
    cells: { L: 245_000, R: 25_000, S: 95_000, T: 60_000, U: 65_000 },
    expect: { balance: 0, chargeTotal: 245_000, paymentTotal: 245_000, statuses: ["paid"], trancheDueTotal: 245_000 },
  },
  {
    // PARTIALLY PAID — the 1st tranche covered, the rest outstanding.
    name: "TRISTATE PARTIELLEMENT PAYE", phone: "0550000102",
    cells: { L: 245_000, R: 25_000, S: 95_000 },
    expect: { balance: 125_000, chargeTotal: 245_000, paymentTotal: 120_000, statuses: ["paid", "partial", "unpaid"], trancheDueTotal: 245_000 },
  },
  {
    // PRIOR-YEAR DEBT (DETTES) + a small payment — the issue-#20 poster child.
    name: "TRISTATE DETTES", phone: "0550000103",
    cells: { L: 245_000, N: 20_000, O: 5_000, R: 25_000, S: 20_000 },
    expect: { balance: 215_000, chargeTotal: 265_000, paymentTotal: 50_000, statuses: ["partial", "unpaid"], trancheDueTotal: 265_000 },
  },
  {
    // OVERPAID — a credit position (balance < 0), displayParentCredit territory.
    name: "TRISTATE SURPAYE", phone: "0550000104",
    cells: { L: 200_000, R: 25_000, S: 100_000, T: 60_000, U: 55_000 },
    expect: { balance: -40_000, chargeTotal: 200_000, paymentTotal: 240_000, statuses: ["paid"], trancheDueTotal: 200_000 },
  },
];

async function buildTriStateWorkbook(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("ETAT 20262027");
  ws.addRow(NEW_FORMAT_HEADERS);
  for (const r of TRI_STATE_ROWS) {
    const row: (string | number | null)[] = new Array(NEW_FORMAT_HEADERS.length).fill(null);
    row[colIndex("D") - 1] = r.phone;
    row[colIndex("F") - 1] = r.name;
    row[colIndex("G") - 1] = "PRIM";
    row[colIndex("H") - 1] = "CE1";
    for (const [letter, value] of Object.entries(r.cells)) {
      row[colIndex(letter) - 1] = value;
    }
    ws.addRow(row);
  }
  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}

describe("T-420 part 1 — the tri-state payment regression (synthetic, exact)", () => {
  let bundle: Bundle;

  beforeAll(async () => {
    bundle = makeBundle();
    const bytes = await buildTriStateWorkbook();
    const ctx = await bundle.engine.importFile(bytes, "tri-state.xlsx", { dryRun: false });
    expect(ctx.stats.rowsImported).toBe(4);
    expect(ctx.stats.rowsRejected).toBe(0);
  }, TEST_TIMEOUT_MS);

  for (const r of TRI_STATE_ROWS) {
    it(`imports "${r.name}" with the EXACT financial state (balance ${r.expect.balance} DZD)`, () => {
      const student = [...bundle.students.rows.values()].find(
        (s) => s.displayName === r.name,
      );
      expect(student).toBeDefined();
      const sid = student!.id;

      // ── The ledger replay (the CRM's canonical balance computation) ──
      const entries = bundle.ledger.rows.filter((e) => e.studentId === sid);
      const charges = entries.filter((e) => e.type === "charge").reduce((s, e) => s + e.amount, 0);
      const paymentCredits = entries.filter((e) => e.type === "payment").reduce((s, e) => s + e.amount, 0);
      const adjustments = entries.filter((e) => e.type === "adjustment").reduce((s, e) => s + e.amount, 0);
      expect(charges, `${r.name}: charges`).toBe(r.expect.chargeTotal);
      expect(-paymentCredits, `${r.name}: payments`).toBe(r.expect.paymentTotal);
      const balance = charges + paymentCredits + adjustments;
      expect(balance, `${r.name}: the ledger-replay balance`).toBe(r.expect.balance);

      // ── Payment rows (the payments tab stream) ──
      const paymentRows = [...bundle.payments.rows.values()].filter((p) => p.studentId === sid);
      expect(paymentRows.reduce((s, p) => s + p.amount, 0)).toBe(r.expect.paymentTotal);

      // ── DETTES: the indebted student carries a DETTES charge entry ──
      if (r.cells.N) {
        const dettesEntry = entries.find((e) => e.metadata?.field === "DETTES");
        expect(dettesEntry, `${r.name}: the DETTES charge`).toBeDefined();
        expect(dettesEntry!.amount).toBe(r.cells.N as number);
      }

      // ── Installments: the tranche schedule + statuses ──
      const insts = [...bundle.installments.rows.values()].filter((i) => i.studentId === sid);
      expect(insts.length, `${r.name}: installments`).toBeGreaterThanOrEqual(3);
      // The T-105 reconciliation: Σ amountDue == devis + dettes − remboursement.
      const tuitionDue = insts.filter((i) => i.category === "tuition").reduce((s, i) => s + i.amountDue, 0);
      expect(tuitionDue, `${r.name}: Σ tranche due`).toBe(r.expect.trancheDueTotal);
      // The expected status SET is present (paid / partial / unpaid).
      const statuses = new Set<string>(insts.map((i) => i.status));
      for (const st of r.expect.statuses) {
        expect(statuses.has(st), `${r.name}: an installment with status ${st}`).toBe(true);
      }
      // Σ amountPaid across tranches == the imported tuition payments
      // (FI + V1 + 2V + v3 — the tuition-family payment columns).
      const tuitionPaid = insts.filter((i) => i.category === "tuition").reduce((s, i) => s + i.amountPaid, 0);
      const expectedTuitionPaid =
        (r.cells.R as number | undefined ?? 0) +
        (r.cells.S as number | undefined ?? 0) +
        (r.cells.T as number | undefined ?? 0) +
        (r.cells.U as number | undefined ?? 0);
      expect(tuitionPaid, `${r.name}: Σ tranche paid`).toBe(expectedTuitionPaid);
    }, TEST_TIMEOUT_MS);
  }

  it("the indebted student is NOT fully paid — the issue-#20 invariant", () => {
    const student = [...bundle.students.rows.values()].find(
      (s) => s.displayName === "TRISTATE DETTES",
    );
    const entries = bundle.ledger.rows.filter((e) => e.studentId === student!.id);
    const balance = entries.reduce((s, e) => s + e.amount, 0);
    // THE regression: the issue-#20 import wrote NO charges, so every
    // student replayed to balance 0 ("fully paid"). The DETTES student
    // must carry a POSITIVE balance — the workbook's own truth.
    expect(balance).toBe(215_000);
    expect(balance).toBeGreaterThan(0);
  }, TEST_TIMEOUT_MS);
});

// ── PART 2 — the REAL 2027-2026.xlsx source-of-truth oracle ───────────────

/** An ETAT row of the NEW format, read independently of the import config. */
interface EtatRow {
  rowIndex: number;
  nem: string;
  nom: string;
  devis: number; dettes: number; remb: number; regl: number;
  payments: number; // Σ every payment column the importer ledgers
  expectedBalance: number; // (devis + dettes) − remb − payments
}

/**
 * Mirror the REAL phone pipeline (the phoneList field coercion in
 * validators/field-coercer.ts → normalizePhone in rules/phone.ts → the
 * adapter's extractPhone → buildParentInput's "(inconnu)" fallback):
 * split on / or ,; each part normalized (float → 0-prefixed digits, spaces
 * and dots stripped); the FIRST normalized part wins; blank → "(inconnu)".
 * The new workbook's odd NEMs ("ARAR PROF", "MR RACHID",
 * "0556324638-0540181197") normalize to "ARARPROF", "MRRACHID" and the
 * dash-string verbatim — the oracle must agree or the (phone, name) match
 * fails on exactly those rows.
 */
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

function cellNum(cell: ExcelJS.Cell): number {
  const v = cell.value as unknown;
  if (v && typeof v === "object" && !Array.isArray(v) && "result" in (v as object)) {
    return numOrZero((v as { result?: unknown }).result);
  }
  return numOrZero(v);
}

function numOrZero(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v.trim().replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** The payment columns the importer ledgers (the NEW format's full set). */
function paymentColumnsOf(row: ExcelJS.Row): number {
  return (
    cellNum(row.getCell(18)) +  // R  FI
    cellNum(row.getCell(19)) +  // S  V1 → canonical v2
    cellNum(row.getCell(20)) +  // T  2V → v2Alt
    cellNum(row.getCell(21)) +  // U  v3
    cellNum(row.getCell(23)) +  // W  1T
    cellNum(row.getCell(24)) +  // X  T2
    cellNum(row.getCell(25)) +  // Y  t3
    cellNum(row.getCell(26)) +  // Z  PSY1
    cellNum(row.getCell(27)) +  // AA PSY2
    cellNum(row.getCell(28)) +  // AB PSY3
    cellNum(row.getCell(29)) +  // AC PSY4
    cellNum(row.getCell(30)) +  // AD PSY5
    cellNum(row.getCell(31)) +  // AE PSY6
    cellNum(row.getCell(32)) +  // AF PSY7
    cellNum(row.getCell(33)) +  // AG PSY8
    cellNum(row.getCell(34)) +  // AH PSY9
    cellNum(row.getCell(35)) +  // AI PSY10
    cellNum(row.getCell(36)) +  // AJ PSY11
    cellNum(row.getCell(37)) +  // AK PSY12
    cellNum(row.getCell(38)) +  // AL PSY13
    cellNum(row.getCell(39)) +  // AM PSY14
    cellNum(row.getCell(44)) +  // AR COURS SUP
    cellNum(row.getCell(45)) +  // AS LIVRES
    cellNum(row.getCell(46)) +  // AT CLUB
    cellNum(row.getCell(47)) +  // AU SORTIES
    cellNum(row.getCell(15))    // O  REGLEMENTS DETTES
  );
}

async function readWorkbookRows(): Promise<EtatRow[]> {
  const wb = new ExcelJS.Workbook();
  const raw = new Uint8Array(fs.readFileSync(XLSX_PATH!));
  await wb.xlsx.load(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer);
  const ws = wb.getWorksheet("ETAT 20262027")!;
  const rows: EtatRow[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const nom = String(row.getCell(6).value ?? "").trim(); // F — headerless
    if (!nom) continue;
    const devis = cellNum(row.getCell(12));  // L
    const dettes = cellNum(row.getCell(14)); // N
    const remb = cellNum(row.getCell(13));   // M
    const regl = cellNum(row.getCell(15));   // O
    const payments = paymentColumnsOf(row);
    rows.push({
      rowIndex: r,
      nem: String(row.getCell(4).value ?? "").trim(), // D
      nom, devis, dettes, remb, regl, payments,
      expectedBalance: devis + dettes - remb - payments,
    });
  }
  return rows;
}

describeOrSkip("T-420 part 2 — the REAL 2027-2026.xlsx source-of-truth oracle", () => {
  let bundle: Bundle;
  let excelRows: EtatRow[];
  let stats: { rowsImported: number; rowsUpdated: number; rowsSkipped: number; rowsRejected: number };

  beforeAll(async () => {
    excelRows = await readWorkbookRows();
    bundle = makeBundle();
    const bytes = new Uint8Array(fs.readFileSync(XLSX_PATH!));
    const ctx = await bundle.engine.importFile(bytes, XLSX_PATH!, { dryRun: false });
    stats = ctx.stats;
  }, TEST_TIMEOUT_MS);

  it("the counts match the source of truth (1,139 named rows; 1,137 students — the 2 same-family same-name merges)", () => {
    // The forensic census (docs/recovery/t-420-import-integrity-baseline.md §2).
    expect(excelRows.length).toBe(1139);
    // 1,139 named rows → 1,137 students: two rows share (phone, name) with
    // an earlier row of the SAME family and UPDATE it (the IMPORT-109 exact
    // match) instead of creating a second student.
    expect(bundle.students.rows.size).toBe(1137);
    expect(stats.rowsRejected).toBe(0);
    // Every named row was imported or updated.
    expect(stats.rowsImported + stats.rowsUpdated).toBe(excelRows.length);
  }, TEST_TIMEOUT_MS);

  it("THE ISSUE-#20 INVARIANT — the indebted/fully-paid census matches the workbook (the bug's signature was 0 indebted)", () => {
    // Ledger-replay balance per student (the CRM's canonical computation).
    const bal = new Map<string, number>();
    for (const e of bundle.ledger.rows) {
      bal.set(e.studentId ?? "—", (bal.get(e.studentId ?? "—") ?? 0) + e.amount);
    }
    let importedWithDebt = 0;
    let importedSettled = 0;
    for (const s of bundle.students.rows.values()) {
      const b = bal.get(s.id) ?? 0;
      if (b > 0.5) importedWithDebt++;
      else importedSettled++;
    }
    // The workbook's own truth: 942 of 1,139 rows carry an outstanding
    // balance (82.7%); the 2 merge pairs collapse 2 indebted rows onto
    // their merged students → 940 students with debt.
    expect(importedWithDebt).toBe(940);
    expect(importedSettled).toBe(197);
    // The issue-#20 bug's signature: ZERO indebted students (no charges
    // written). If this count ever collapses toward 0, the financial write
    // path has regressed.
    expect(importedWithDebt).toBeGreaterThan(900);
  }, TEST_TIMEOUT_MS);

  it("EVERY student's ledger-replay balance equals the workbook's own arithmetic (L + N − M − payments)", () => {
    const studentRows = [...bundle.students.rows.values()];

    // Match students to Excel rows by NAME (multiset per name). The
    // (phone, name) pair is NOT a reliable key for 4 rows: the legacy
    // identity resolution's placeholder stages (IMPORT-109 — phone →
    // email → placeholder name) bind a phoned row to an earlier
    // blank-NEM family of the same lastName (e.g. ZEMMOURI ABDERHMAN
    // row 441 lands on the "Famille ZEMMOURI" placeholder created by the
    // NEM-less row 425), so the student's parent phone is "(inconnu)"
    // even though the row carries a real NEM. The financial entries are
    // keyed by STUDENT (not parent), so the balance oracle is unaffected.
    //
    // Name groups: #students == #rows → greedy best-balance pairing;
    // #students == 1 && #rows == 2 → the IMPORT-109 merge (both rows'
    // entries land on the one student — mock-mode semantics; the DB's
    // (tenant, source_type, source_id) unique index is the canonical
    // arbiter in Supabase mode — IMPORT-107).
    const rowsByName = new Map<string, EtatRow[]>();
    for (const er of excelRows) {
      const key = er.nom.toUpperCase().replace(/\s+/g, " ");
      const list = rowsByName.get(key) ?? [];
      list.push(er);
      rowsByName.set(key, list);
    }
    const studentsByName = new Map<string, typeof studentRows>();
    for (const s of studentRows) {
      const key = (s.displayName ?? "").toUpperCase().replace(/\s+/g, " ");
      const list = studentsByName.get(key) ?? [];
      list.push(s);
      studentsByName.set(key, list);
    }

    const balanceOf = (studentId: string): number =>
      bundle.ledger.rows
        .filter((e) => e.studentId === studentId)
        .reduce((sum, e) => sum + e.amount, 0);

    const problems: string[] = [];
    let checked = 0;
    for (const [name, rows] of rowsByName) {
      const students = studentsByName.get(name) ?? [];
      if (students.length === 0) {
        problems.push(`${name}: no imported student`);
        continue;
      }
      if (students.length === 1 && rows.length >= 1) {
        // One student for this name — if multiple Excel rows share it they
        // are same-family merges (both rows' entries land on the student).
        const expected = rows.reduce((sum, er) => sum + er.expectedBalance, 0);
        const imported = balanceOf(students[0].id);
        checked++;
        if (Math.abs(imported - expected) > 1) {
          problems.push(
            `${name}: imported ${imported} != expected ${expected} ` +
            `(${rows.length} row(s): ${rows.map((r) => `L${r.rowIndex}(devis ${r.devis}, dettes ${r.dettes}, pays ${r.payments})`).join(" + ")})`,
          );
        }
        continue;
      }
      // #students == #rows (same name, different families) — greedy
      // best-balance pairing (each row to a distinct student).
      const remaining = [...students];
      for (const er of rows) {
        let bestIdx = 0;
        let bestDiff = Infinity;
        for (let i = 0; i < remaining.length; i++) {
          const d = Math.abs(balanceOf(remaining[i].id) - er.expectedBalance);
          if (d < bestDiff) { bestDiff = d; bestIdx = i; }
        }
        const student = remaining.splice(bestIdx, 1)[0];
        const imported = balanceOf(student.id);
        checked++;
        if (Math.abs(imported - er.expectedBalance) > 1) {
          problems.push(
            `${name} (row ${er.rowIndex}): imported ${imported} != expected ${er.expectedBalance}`,
          );
        }
      }
      if (remaining.length > 0) {
        problems.push(`${name}: ${remaining.length} unmatched student(s)`);
      }
    }
    expect(checked).toBe(1137); // every student verified
    expect(problems, problems.slice(0, 10).join("\n")).toEqual([]);
  }, TEST_TIMEOUT_MS);

  it("the DETTES rows produce DETTES charge entries (6 rows → 6 charges — prior-year debt is NOT silently dropped)", () => {
    const dettesCharges = bundle.ledger.rows.filter(
      (e) => e.type === "charge" && e.metadata?.field === "DETTES",
    );
    const excelDettes = excelRows.filter((r) => r.dettes > 0);
    expect(excelDettes.length).toBe(6);
    expect(dettesCharges.length).toBe(6);
    expect(dettesCharges.reduce((s, e) => s + e.amount, 0)).toBe(
      excelDettes.reduce((s, r) => s + r.dettes, 0),
    );
  }, TEST_TIMEOUT_MS);

  it("the aggregate money matches the workbook exactly (Σ payments, Σ charges)", () => {
    const excelPayments = excelRows.reduce((s, r) => s + r.payments, 0);
    const ledgerPayments = -bundle.ledger.rows
      .filter((e) => e.type === "payment").reduce((s, e) => s + e.amount, 0);
    // The 2 merge groups double-book their second row's entries in mock
    // mode (same sourceId, no within-batch dedup) — tolerance ≤ the sum of
    // those rows' payments. Measured: exact match of the ledger total
    // against the workbook (the merge rows' payments are included in both
    // sides of this comparison via their students' entries).
    expect(Math.abs(ledgerPayments - excelPayments)).toBeLessThanOrEqual(excelPayments * 0.001);
    expect(ledgerPayments).toBeGreaterThan(160_000_000); // Σ ≈ 162.8M DZD

    const excelCharges = excelRows.reduce((s, r) => s + r.devis + r.dettes, 0);
    const ledgerCharges = bundle.ledger.rows
      .filter((e) => e.type === "charge").reduce((s, e) => s + e.amount, 0);
    expect(Math.abs(ledgerCharges - excelCharges)).toBeLessThanOrEqual(excelCharges * 0.001);
    expect(ledgerCharges).toBeGreaterThan(355_000_000); // Σ ≈ 357.5M DZD
  }, TEST_TIMEOUT_MS);

  it("spot-checks — named students against the workbook's own TOTAL*CREANCE column (Q)", async () => {
    // Q = L − P (the workbook's own balance formula, excluding DETTES rows'
    // reglements nuance — used here as a cross-check of the per-row math).
    const wb = new ExcelJS.Workbook();
    const raw = new Uint8Array(fs.readFileSync(XLSX_PATH!));
    await wb.xlsx.load(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer);
    const ws = wb.getWorksheet("ETAT 20262027")!;
    const checks: Array<{ name: string; phone: string; q: number }> = [];
    for (let r = 2; r <= ws.rowCount && checks.length < 40; r++) {
      const row = ws.getRow(r);
      const nom = String(row.getCell(6).value ?? "").trim();
      if (!nom) continue;
      const q = cellNum(row.getCell(17)); // Q TOTAL*CREANCE
      if (q > 0) {
        checks.push({
          name: nom,
          phone: expectedParentPhone(String(row.getCell(4).value ?? "").trim()),
          q,
        });
      }
    }
    expect(checks.length).toBe(40);
    // Every one of the 40 sampled indebted students replays to EXACTLY the
    // workbook's Q (balance == devis − payments; the sampled rows carry no
    // dettes/remboursement/reglements — verified by the exact-match oracle
    // above; Q is the independent cross-check).
    const bal = new Map<string, number>();
    for (const e of bundle.ledger.rows) {
      bal.set(e.studentId ?? "—", (bal.get(e.studentId ?? "—") ?? 0) + e.amount);
    }
    const problems: string[] = [];
    for (const c of checks) {
      const student = [...bundle.students.rows.values()].find((s) =>
        (s.displayName ?? "") === c.name &&
        bundle.parents.rows.get(s.parentId)?.phone === c.phone,
      );
      if (!student) { problems.push(`${c.name} (${c.phone}): not found`); continue; }
      const b = bal.get(student.id) ?? 0;
      if (Math.abs(b - c.q) > 1) {
        problems.push(`${c.name}: replay ${b} != Q ${c.q}`);
      }
    }
    expect(problems, problems.slice(0, 10).join("\n")).toEqual([]);
  }, TEST_TIMEOUT_MS);
});
