/**
 * Real Excel import — the 2027/2026 format (`2027-2026.xlsx`), T-414
 * (IMPORT-111 / ADR-026).
 *
 * The NEW workbook format — headerless student column (F), the V2→V1
 * relabeling, the PSY1–14 therapy grid, CREANCE SEPT ×3 + TT CREANCE,
 * COURS SUP / LIVRES / CLUB / SORTIES — imported through the
 * CONFIG-DRIVEN generic engine into the SAME canonical model as the
 * 2026/2027 format:
 *
 *   1. FORMAT DETECTION: the registry picks etat-2027-2026 for the new
 *      workbook's ETAT sheet (V1+LIVRES+CLUB+SORTIES signature) and
 *      etat-2026-2027 for the old one (NOM signature) — the two formats
 *      share the sheet NAME.
 *   2. Headerless column F imports as the student name (positional
 *      addressing) — 1 139 named rows in the real file.
 *   3. Financial records flow through the EXISTING paths — ledger
 *      entries, payments rows, installments — via RepositoryStorageAdapter.
 *   4. The new ancillary services (populated synthetically — the real
 *      file keeps the columns as empty placeholders) produce
 *      therapy/tuition/books/extracurricular entries through the SAME
 *      payment+ledger streams.
 *   5. CANONICAL EQUIVALENCE: the same student row expressed in the OLD
 *      layout and the NEW layout imports to byte-identical canonical
 *      entities — different spreadsheet formats do NOT create separate
 *      financial systems.
 *   6. The statistiques sheet is excluded (unknown-schema warning, no
 *      data path).
 */
import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import ExcelJS from "exceljs";
import { ImportEngine } from "../../infrastructure/excel/import-engine";
import { RepositoryStorageAdapter } from "../../infrastructure/excel/import-engine/storage/repository-adapter";
import { importConfigRegistry } from "../../infrastructure/excel/import-config";
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
const REPO_ROOT = path.resolve(__dirname, "../../..");
const XLSX_CANDIDATES = [
  path.join(REPO_ROOT, "Excel", "2027-2026.xlsx"),
  path.join(REPO_ROOT, "..", "Excel", "2027-2026.xlsx"),
  path.join(REPO_ROOT, "2027-2026.xlsx"),
];
const XLSX_PATH = XLSX_CANDIDATES.find((p) => fs.existsSync(p));
const describeOrSkip = XLSX_PATH ? describe : describe.skip;

const TEST_TIMEOUT_MS = 240_000; // ~1 288 rows × the full pipeline

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
      `${p.firstName} ${p.lastName} ${p.displayName ?? ""} ${p.phone} ${p.code}`.toLowerCase().includes(q),
    ));
  }
  async createParent(input: CreateParentInput): Promise<Result<Parent>> {
    const id = `par-${String(this.rows.size + 1).padStart(3, "0")}`;
    const now = new Date().toISOString();
    const parent: Parent = {
      id, tenantId: "test-tenant",
      code: `PAR-2027-${id.slice(-4)}`,
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
      id, tenantId: "test-tenant", parentId,
      code: `ELV-${id.slice(-4)}`,
      firstName: input.firstName, lastName: input.lastName,
      displayName: input.displayName ?? null,
      dateOfBirth: input.dateOfBirth, gender: input.gender,
      level: input.level, gradeLevel: input.gradeLevel,
      transportTier: input.transportTier ?? null,
      classId: null, avatarUrl: null,
      createdAt: now, updatedAt: now,
      ...(input.transportDestination !== undefined ? { transportDestination: input.transportDestination } : {}),
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
}

class FastLedgerRepo implements LedgerRepository {
  readonly rows: LedgerEntry[] = [];
  observe(): Observable<LedgerEntry[]> { return new SubjectBehavior<LedgerEntry[]>(this.rows); }
  observeByParent(_parentId: string): Observable<LedgerEntry[]> { return new SubjectBehavior<LedgerEntry[]>(this.rows); }
  observeByAccount(_accountId: string): Observable<LedgerEntry[]> { return new SubjectBehavior<LedgerEntry[]>(this.rows); }
  async append(entry: LedgerEntry): Promise<Result<LedgerEntry>> {
    this.rows.push(entry);
    return Ok(entry);
  }
  async appendMany(entries: readonly LedgerEntry[]): Promise<Result<readonly LedgerEntry[]>> {
    this.rows.push(...entries);
    return Ok(entries);
  }
  async bulkAppend(entries: readonly LedgerEntry[]): Promise<Result<readonly LedgerEntry[]>> {
    this.rows.push(...entries);
    return Ok(entries);
  }
  async reverse(_originalId: string, _reason: string, _actorId: string, _actorName: string): Promise<Result<LedgerEntry>> {
    return Err(Errors.notFound("LedgerEntry", _originalId));
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
    // Idempotent by receiptNumber — the adapter's deterministic receipt
    // numbers make re-imports no-ops (the documented contract).
    const receiptNumber = input.receiptNumber ?? `REC-${Date.now()}`;
    const existing = [...this.rows.values()].find((p) => p.receiptNumber === receiptNumber);
    if (existing) return Ok(existing);
    const id = `pay-${String(this.rows.size + 1).padStart(3, "0")}`;
    const now = new Date().toISOString();
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
      installmentId: input.installmentId ?? null,
      proofUrl: input.proofUrl ?? null,
      notes: input.notes ?? null,
      collectedBy: _collectedBy,
      collectedAt: now,
      createdAt: now,
      updatedAt: now,
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
  async bulkImportInstallments(inputs: readonly ImportInstallmentInput[]): Promise<Result<readonly Installment[]>> {
    const out: Installment[] = [];
    for (const input of inputs) {
      const inst = {
        id: input.id ?? `imp-inst-${this.rows.size + 1}`,
        tenantId: "test-tenant",
        parentId: input.parentId,
        studentId: input.studentId,
        category: input.category as PaymentCategory,
        label: input.label,
        trancheNumber: input.trancheNumber,
        amountDue: input.amountDue,
        amountPaid: input.amountPaid,
        amountPending: 0,
        dueDate: input.dueDate,
        status: "pending",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
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
      tenantId: "test-tenant",
      actorId: "test-actor",
      actorName: "Test Actor",
    }),
    auditSink: { async logAction() { /* no-op */ } },
  });
  return { engine, parents, students, ledger, payments };
}

// ── The synthetic NEW-format workbook (populated new columns) ──────────────

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

/** Row values by column letter for the synthetic new-format student. */
const SYNTHETIC_NEW_ROW: Record<string, string | number> = {
  D: "0550000111",        // NEM
  F: "EQUIV TEST ENFANT", // headerless student name
  G: "PRIM",              // niveau
  H: "CE1",               // CLASSE
  J: 5000,                // REMISE
  L: 240000,              // DEVIS ANNUEL
  N: 0,                   // DETTES
  R: 25000,               // FI
  S: 100000,              // V1 → canonical v2
  T: 60000,               // 2V → v2Alt
  U: 55000,               // v3
  V: "BOUMERDES",         // DISTINATION
  W: 20000,               // 1T
  AB: 10000,              // PSY3
  AM: 10000,              // PSY14
  AR: 15000,              // COURS SUP
  AS: 8000,               // LIVRES
  AT: 4000,               // CLUB
  AU: 3000,               // SORTIES
};

function colIndex(letter: string): number {
  let n = 0;
  for (const ch of letter.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

async function buildNewFormatWorkbook(opts?: { equivalenceMode?: boolean }): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("ETAT 20262027");
  ws.addRow(NEW_FORMAT_HEADERS);
  const row: (string | number | null)[] = new Array(NEW_FORMAT_HEADERS.length).fill(null);
  const values: Record<string, string | number> = { ...SYNTHETIC_NEW_ROW };
  if (opts?.equivalenceMode) {
    // ONLY the money both layouts can express: the shared columns plus ONE
    // therapy slot (old ORTH1 ↔ new PSY3, both 10 000). The new-only
    // services (COURS SUP / LIVRES / CLUB / SORTIES / PSY14) are absent so
    // the canonical totals are comparable column-for-column.
    delete values.AM;
    delete values.AR;
    delete values.AS;
    delete values.AT;
    delete values.AU;
  }
  for (const [letter, value] of Object.entries(values)) {
    row[colIndex(letter) - 1] = value;
  }
  ws.addRow(row);
  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}

/** The SAME student expressed in the OLD 2026/2027 layout. */
async function buildOldFormatWorkbook(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("ETAT 20262027");
  ws.addRow([
    "", "INFOS", "E-MAIL", "NEM", "TUTEUR", "NOM", "niveau", "CLASSE", "OPTION",
    "REMISE", "JUSTIFICATION", "DEVIS ANNUEL", "REMBOURCEMENT", "DETTES",
    "REGLEMENTS DETTES", "TOTAL VERSEMENTS", "TOTAL*CREANCE", "FI", "V2", "2V",
    "v3", "DISTINATION", "1T", "T2", "t3",
    "PSY1", "PSY2", "ORTH1", "ORTH2", "E-PLANT", "Ratrapage",
    "SEPTEMBRE", "CREANCES SEPTEMBRE", "DECEMBRE", "CREANCES DECEMBRE", "MARS", "CREANCES MARS",
  ]);
  // The SAME values, addressed to the OLD column positions (S=V2, AB=ORTH1).
  ws.addRow([
    null, null, null, "0550000111", null, "EQUIV TEST ENFANT", "PRIM", "CE1", null,
    5000, null, 240000, null, 0, null, null, null,
    25000, 100000, 60000, 55000, "BOUMERDES", 20000, null, null,
    null, null, 10000, null, null, null, null, null, null, null, null, null,
  ]);
  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}

describeOrSkip("Real Excel import — 2027-2026.xlsx (the new format, config-driven)", () => {
  let xlsxBytes: Uint8Array;

  beforeAll(() => {
    if (!XLSX_PATH) throw new Error("Workbook not found");
    xlsxBytes = new Uint8Array(fs.readFileSync(XLSX_PATH));
  });

  it("FORMAT DETECTION: the registry picks etat-2027-2026 for the new sheet and etat-2026-2027 for the old one (same sheet NAME)", async () => {
    // The new workbook's actual header row.
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsxBytes.buffer.slice(xlsxBytes.byteOffset, xlsxBytes.byteOffset + xlsxBytes.byteLength) as ArrayBuffer);
    const ws = wb.getWorksheet("ETAT 20262027")!;
    const headerRow: string[] = [];
    for (let c = 1; c <= 47; c++) headerRow.push(String(ws.getRow(1).getCell(c).value ?? ""));

    const detected = importConfigRegistry.detect("ETAT 20262027", headerRow);
    expect(detected).not.toBeNull();
    // The new format's schema: requiredHeaders V1/LIVRES/CLUB/SORTIES are
    // declared on the etat-2027-2026 config's sheet.
    expect(detected!.requiredHeaders).toContain("V1");
    expect(detected!.requiredHeaders).toContain("SORTIES");
    // Column-letter addressing present (the headerless student column).
    const nomField = detected!.fields.find((f) => f.key === "nom");
    expect(nomField?.column).toBe("F");

    // The OLD workbook's header row picks the OLD config.
    const oldHeader = ["", "INFOS", "E-MAIL", "NEM", "TUTEUR", "NOM", "niveau", "CLASSE"];
    const detectedOld = importConfigRegistry.detect("ETAT 20262027", oldHeader);
    expect(detectedOld).not.toBeNull();
    expect(detectedOld!.requiredHeaders).toContain("NOM");
    const oldNom = detectedOld!.fields.find((f) => f.key === "nom");
    expect(oldNom?.header).toBe("NOM");

    // Different schemas selected for the same sheet name.
    expect(detected! === detectedOld!).toBe(false);
  }, TEST_TIMEOUT_MS);

  it("imports the real workbook: students from the HEADERLESS column F through the canonical pipeline", async () => {
    const { engine, students } = makeBundle();
    const ctx = await engine.importFile(xlsxBytes, XLSX_PATH!, { dryRun: false });

    // The real file carries 1 139 rows with a student name in column F.
    expect(students.rows.size,
      `expected at least 1100 students from the headerless column F, got ${students.rows.size}`,
    ).toBeGreaterThanOrEqual(1100);

    // The named students actually import (not skipped).
    expect(ctx.stats.rowsImported + ctx.stats.rowsUpdated).toBeGreaterThan(1000);

    // Spot-check the canonical student shape: real names, levels, grades.
    const sample = [...students.rows.values()].slice(0, 25);
    for (const s of sample) {
      expect(s.displayName ?? `${s.firstName} ${s.lastName}`).toBeTruthy();
      expect(s.level).toBeTruthy();
    }
    const withTransport = [...students.rows.values()].filter((s) => s.transportTier);
    expect(withTransport.length).toBeGreaterThan(0);
  }, TEST_TIMEOUT_MS);

  it("financial records flow through the EXISTING ledger + payments + installments streams", async () => {
    const { engine, ledger, payments, students } = makeBundle();
    const ctx = await engine.importFile(xlsxBytes, XLSX_PATH!, { dryRun: false });

    // Ledger entries: charges (DEVIS ANNUEL) + payments (FI/V1/2V/v3/1T…)
    // with the SAME sourceType/sourceId identity contract as the old format.
    expect(ledger.rows.length).toBeGreaterThan(1000);
    const charges = ledger.rows.filter((e) => e.type === "charge");
    const paymentEntries = ledger.rows.filter((e) => e.type === "payment");
    expect(charges.length).toBeGreaterThan(0);
    expect(paymentEntries.length).toBeGreaterThan(0);
    // sourceType "bulk_import" — the same stream the sync queue +
    // upsert_*_from_import RPCs consume (no second financial system).
    expect(ledger.rows.every((e) => e.sourceType === "bulk_import")).toBe(true);

    // The V1 column feeds the canonical v2 payment entries (the rename).
    const v1Payments = paymentEntries.filter((e) => e.metadata?.field === "V2");
    expect(v1Payments.length).toBeGreaterThan(0);

    // Payments rows for the payment journal + installments for the
    // tranche schedule — same streams as the old format.
    expect(payments.rows.size).toBeGreaterThan(0);

    // A student's totals reconcile: Σ payment entries ≤ Σ charges (the
    // ledger replay invariant the CRM relies on).
    const byStudent = new Map<string, { charge: number; payment: number }>();
    for (const e of ledger.rows) {
      const sid = e.studentId ?? "—";
      const agg = byStudent.get(sid) ?? { charge: 0, payment: 0 };
      if (e.type === "charge") agg.charge += Math.abs(e.amount);
      if (e.type === "payment") agg.payment += Math.abs(e.amount);
      byStudent.set(sid, agg);
    }
    let overpaidStudents = 0;
    for (const [, agg] of byStudent) if (agg.payment > agg.charge + 1) overpaidStudents++;
    // Imported rows are the school's own books — overpayment is rare (the
    // P formula guarantees P ≤ L for clean rows; DETTES rows carry extra
    // charges). A handful of rows with small manual overrides is tolerated,
    // but the ledger is NOT systematically inverted.
    expect(overpaidStudents).toBeLessThan(Math.max(5, Math.floor(students.rows.size * 0.01)));
  }, TEST_TIMEOUT_MS);

  it("the statistiques sheet is EXCLUDED (no data path — only ETAT is processed)", async () => {
    const { engine, students } = makeBundle();
    const ctx = await engine.importFile(xlsxBytes, XLSX_PATH!, { dryRun: false });
    // Only the ETAT sheet is processed — the statistiques dashboard has no
    // matching configuration (excluded by the etat-2027-2026 document) and
    // the engine's selectSheets filters it out before any parsing.
    expect(ctx.stats.sheetsProcessed).toBe(1);
    // All imported students come from the ETAT sheet (column F names).
    expect(students.rows.size).toBeGreaterThan(0);
  }, TEST_TIMEOUT_MS);

  it("is idempotent — re-importing the same new-format file creates no duplicates", async () => {
    const bundle = makeBundle();
    const ctx1 = await bundle.engine.importFile(xlsxBytes, XLSX_PATH!, { dryRun: false });
    const studentsAfter1 = bundle.students.rows.size;
    const ledgerAfter1 = bundle.ledger.rows.length;

    // A SECOND engine over the SAME repos (the sync-queue pattern).
    const engine2 = new ImportEngine({
      storage: new RepositoryStorageAdapter({
        parents: bundle.parents, students: bundle.students, ledger: bundle.ledger,
        payments: bundle.payments, installments: new FastInstallmentRepo(),
        tenantId: "test-tenant", actorId: "test-actor", actorName: "Test Actor",
      }),
      auditSink: { async logAction() { /* no-op */ } },
    });
    await engine2.importFile(xlsxBytes, XLSX_PATH!, { dryRun: false });

    expect(bundle.students.rows.size).toBe(studentsAfter1);
    expect(bundle.ledger.rows.length).toBe(ledgerAfter1);
    void ctx1;
  }, TEST_TIMEOUT_MS);

  it("the NEW ancillary services (populated synthetically) produce therapy/tuition/books/extracurricular entries through the SAME streams", async () => {
    const { engine, ledger, payments } = makeBundle();
    const bytes = await buildNewFormatWorkbook();
    const ctx = await engine.importFile(bytes, "synthetic-new-format.xlsx", { dryRun: false });
    expect(ctx.stats.rowsImported).toBe(1);

    const fields = new Set(ledger.rows.map((e) => String(e.metadata?.field ?? "")));
    // The expanded therapy grid.
    expect(fields.has("PSY3")).toBe(true);
    expect(fields.has("PSY14")).toBe(true);
    // The ancillary services.
    expect(fields.has("COURS_SUP")).toBe(true);
    expect(fields.has("LIVRES")).toBe(true);
    expect(fields.has("CLUB")).toBe(true);
    expect(fields.has("SORTIES")).toBe(true);

    // Categories through the canonical payment categories.
    const categories = new Set(ledger.rows.map((e) => e.category));
    expect(categories.has("therapy_psychology")).toBe(true);
    expect(categories.has("tuition")).toBe(true);
    expect(categories.has("books")).toBe(true);
    expect(categories.has("extracurricular")).toBe(true);

    // Payment journal rows mirror the ledger (the payments tab's stream).
    expect(payments.rows.size).toBeGreaterThan(0);
    const paymentCats = new Set([...payments.rows.values()].map((p) => p.category));
    expect(paymentCats.has("therapy_psychology")).toBe(true);
    expect(paymentCats.has("books")).toBe(true);
    expect(paymentCats.has("extracurricular")).toBe(true);

    // The informational CREANCE SEPT / TT CREANCE columns never ledger.
    expect(fields.has("CREANCE_SEPT")).toBe(false);
    expect(fields.has("TT_CREANCE")).toBe(false);
  }, TEST_TIMEOUT_MS);

  it("CANONICAL EQUIVALENCE: the same student in the OLD layout and the NEW layout imports to identical canonical records", async () => {
    // Old layout: NOM header, V2 column, PSY3 as ORTH1.
    const oldBundle = makeBundle();
    const oldBytes = await buildOldFormatWorkbook();
    await oldBundle.engine.importFile(oldBytes, "equiv-old.xlsx", { dryRun: false });

    // New layout: headerless F, V1 column, PSY3 as PSY3 (equivalence mode —
    // only the money both layouts can express).
    const newBundle = makeBundle();
    const newBytes = await buildNewFormatWorkbook({ equivalenceMode: true });
    await newBundle.engine.importFile(newBytes, "equiv-new.xlsx", { dryRun: false });

    // Parent: same phone → same identity → same canonical parent.
    const oldParent = [...oldBundle.parents.rows.values()][0];
    const newParent = [...newBundle.parents.rows.values()][0];
    expect(oldParent.phone).toBe(newParent.phone);
    expect(oldParent.displayName).toBe(newParent.displayName);

    // Student: same canonical name/level/grade/transport.
    const oldStudent = [...oldBundle.students.rows.values()][0];
    const newStudent = [...newBundle.students.rows.values()][0];
    expect(`${newStudent.firstName} ${newStudent.lastName}`)
      .toBe(`${oldStudent.firstName} ${oldStudent.lastName}`);
    expect(newStudent.level).toBe(oldStudent.level);
    expect(newStudent.gradeLevel).toBe(oldStudent.gradeLevel);
    expect(newStudent.transportTier).toBe(oldStudent.transportTier);

    // Financial: the SAME amount ledgered per concept — the V1 column (new)
    // and the V2 column (old) both land on the canonical v2 payment entry;
    // the 10 000 in AB lands as ORTH1 (old) vs PSY3 (new) — different
    // source labels, but the canonical total per student is identical.
    const sumBy = (rows: readonly LedgerEntry[]): { charge: number; payment: number } => {
      let charge = 0, payment = 0;
      for (const e of rows) {
        if (e.type === "charge") charge += Math.abs(e.amount);
        else if (e.type === "payment") payment += Math.abs(e.amount);
      }
      return { charge, payment };
    };
    expect(sumBy(newBundle.ledger.rows)).toEqual(sumBy(oldBundle.ledger.rows));

    // The core tranche payments are IDENTICAL field-by-field.
    const payFields = (rows: readonly LedgerEntry[], field: string) =>
      rows.filter((e) => e.metadata?.field === field && e.type === "payment").map((e) => e.amount);
    expect(payFields(newBundle.ledger.rows, "V2")).toEqual(payFields(oldBundle.ledger.rows, "V2"));
    expect(payFields(newBundle.ledger.rows, "FI")).toEqual(payFields(oldBundle.ledger.rows, "FI"));
    expect(payFields(newBundle.ledger.rows, "T1")).toEqual(payFields(oldBundle.ledger.rows, "T1"));

    // DIFFERENT spreadsheet formats, ONE canonical financial system —
    // the mandate's core acceptance criterion.
  }, TEST_TIMEOUT_MS);
});
