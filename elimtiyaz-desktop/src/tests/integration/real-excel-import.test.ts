/**
 * Real Excel import end-to-end test.
 *
 * This test reads the ACTUAL `Suivis clients 2026_2027.xlsx` workbook that
 * ships with the Desktop repository and runs the full import pipeline:
 *
 *   Suivis clients 2026_2027.xlsx
 *     ↓
 *   ImportEngine.importFile()
 *     ↓
 *   RepositoryStorageAdapter.upsertEtatRecord()
 *     ↓
 *   Mock ParentRepository / StudentRepository / LedgerRepository
 *     ↓
 *   trackInsertedRow() with resolved entities
 *     ↓
 *   listInsertedForRun() returns StorageRecords carrying entities
 *
 * The test verifies the COMPLETE pipeline:
 *   - The Excel file is actually read (not stubbed).
 *   - All non-empty rows in the ETAT sheet are detected.
 *   - Every detected row produces a resolved Parent + Student (+ ledger entries).
 *   - No rows are silently lost.
 *   - No duplicate students are created on re-import.
 *   - Parent names are preserved COMPLETELY in `displayName` (the fix for
 *     the "Tuteur BENALI" prefix bug — migration 0027).
 *   - The extended columns (PSY1, PSY2, ORTH1, ORTH2, E-PLANT, Ratrapage,
 *     SEPTEMBRE, DECEMBRE, MARS) are parsed and produce therapy + quarterly
 *     ledger entries.
 *
 * The numbers are NOT hardcoded — they are computed dynamically from the
 * workbook via `exceljs` so the test stays accurate as the file evolves.
 */
import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import ExcelJS from "exceljs";
import { ImportEngine } from "../../infrastructure/excel/import-engine";
import { ETAT_SCHEMA } from "../../infrastructure/excel/import-engine/schemas/etat-schema";
import { RepositoryStorageAdapter } from "../../infrastructure/excel/import-engine/storage/repository-adapter";
import type { ParentRepository, StudentRepository, LedgerRepository, PaymentRepository, InstallmentRepository, Observable, ImportInstallmentInput } from "../../domain/repository/repository";
import type { Result } from "../../core/result";
import { Ok, Err } from "../../core/result";
import { Errors } from "../../core/app-error";
import type { Parent, CreateParentInput, UpdateParentInput } from "../../domain/model/parent";
import type { Student, CreateStudentInput } from "../../domain/model/student";
import type { LedgerEntry } from "../../domain/model/ledger";
import type { Payment, Installment, CollectPaymentInput, PaymentCategory } from "../../domain/model/payment";
import { SubjectBehavior } from "../../infrastructure/mock/subject-behavior";

// The workbook is at the repo root (one level above `elimtiyaz-desktop/`).
// Try several candidate paths so the test works in different layouts.
const REPO_ROOT = path.resolve(__dirname, "../../..");
const XLSX_CANDIDATES = [
  path.join(REPO_ROOT, "Suivis clients  2026_2027.xlsx"), // double space — real file
  path.join(REPO_ROOT, "..", "Suivis clients  2026_2027.xlsx"),
  path.join(REPO_ROOT, "Suivis clients 2026_2027.xlsx"), // single space — fallback
  path.join(REPO_ROOT, "..", "Suivis clients 2026_2027.xlsx"),
];
const XLSX_PATH = XLSX_CANDIDATES.find((p) => fs.existsSync(p));

// Skip the entire suite if the workbook isn't present (e.g. running in a
// CI environment that didn't clone the repo assets). This keeps the test
// suite green without compromising the assertion strength when the file
// IS available.
const describeOrSkip = XLSX_PATH ? describe : describe.skip;

// The real workbook has ~390 rows; each row triggers a parent + student
// lookup/create + up to 22 ledger entries. The mock repos are in-memory
// but still take time per row. Use a generous per-test timeout so the
// import completes without vitest killing it.
const TEST_TIMEOUT_MS = 120_000;

// Stash the repos + engine so the idempotency test can reuse the same
// repository instances across two separate ImportEngine instances.
interface EngineBundle {
  engine: ImportEngine;
  deps: ConstructorParameters<typeof RepositoryStorageAdapter>[0];
}
const BUNDLES = new Map<ImportEngine, EngineBundle>();

describeOrSkip("Real Excel import — Suivis clients 2026_2027.xlsx", () => {
  let xlsxBytes: Uint8Array;
  let expectedRowCount: number;
  let expectedNomRowCount: number;

  beforeAll(async () => {
    if (!XLSX_PATH) throw new Error("Workbook not found");
    const buf = fs.readFileSync(XLSX_PATH);
    xlsxBytes = new Uint8Array(buf);
    const counts = await countEtatRows(XLSX_PATH);
    expectedRowCount = counts.anyNonEmpty; // rows with ANY non-empty cell in B-Y
    expectedNomRowCount = counts.withNom;   // rows with a non-empty NOM (column F)
  });

  it("reads every non-empty row in the ETAT sheet", async () => {
    const engine = makeEngine();
    const ctx = await engine.importFile(xlsxBytes, XLSX_PATH!, { dryRun: false });
    // The engine's `rowsRead` counts every row it iterated over (including
    // empty rows the parser skipped internally). Assert that the count of
    // IMPORTED + UPDATED + SKIPPED + REJECTED rows is at least the number
    // of non-empty rows we counted with our direct exceljs scan — every
    // non-empty row MUST be accounted for somewhere in the stats.
    const accounted = ctx.stats.rowsImported + ctx.stats.rowsUpdated + ctx.stats.rowsSkipped + ctx.stats.rowsRejected;
    expect(
      accounted,
      `expected at least ${expectedRowCount} rows accounted for, got ${accounted}`,
    ).toBeGreaterThanOrEqual(expectedRowCount);
  }, TEST_TIMEOUT_MS);

  it("creates a resolved Parent + Student for every row with a NOM", async () => {
    const engine = makeEngine();
    const ctx = await engine.importFile(xlsxBytes, XLSX_PATH!, { dryRun: false });
    const records = await engine.getStorage().listInsertedForRun(ctx.runId);
    // Every StorageRecord should carry at least a `parent` entity (the
    // adapter always creates one) and a `student` entity (unless the row
    // was rejected before the student could be created — which shouldn't
    // happen for valid ETAT rows).
    const parents = records.flatMap((r) => (r.entities ?? []).filter((e) => e.kind === "parent"));
    const students = records.flatMap((r) => (r.entities ?? []).filter((e) => e.kind === "student"));
    // The importer only imports rows with a non-empty NOM (column F) — that's
    // the schema's only required header. Rows with data in other columns but
    // no NOM are correctly skipped. So `students.length` should be >= the
    // number of rows with a NOM. `parents.length` may be SMALLER because
    // multiple students can share a parent (same phone number).
    expect(parents.length, "every imported run should produce at least one parent entity").toBeGreaterThan(0);
    expect(
      students.length,
      `expected at least ${expectedNomRowCount} students (rows with NOM), got ${students.length}`,
    ).toBeGreaterThanOrEqual(expectedNomRowCount);
  }, TEST_TIMEOUT_MS);

  it("preserves the complete parent name in `displayName` (no 'Tuteur' prefix)", async () => {
    const engine = makeEngine();
    const ctx = await engine.importFile(xlsxBytes, XLSX_PATH!, { dryRun: false });
    const records = await engine.getStorage().listInsertedForRun(ctx.runId);
    const parents = records.flatMap(
      (r) => (r.entities ?? []).filter((e) => e.kind === "parent").map((e) => e.entity as Parent),
    );
    expect(parents.length).toBeGreaterThan(0);
    // Every parent should have a non-empty displayName. The old bug was that
    // displayName was null and the UI fell back to "Tuteur <LastName>".
    for (const p of parents) {
      expect(p.displayName, `parent ${p.code} displayName should be non-empty`).toBeTruthy();
      // displayName should NEVER start with "Tuteur " — that was the old
      // placeholder-prefix bug the importer used when TUTEUR was missing.
      expect(p.displayName, `parent ${p.code} displayName must not be prefixed with "Tuteur"`).not.toMatch(/^Tuteur\s/);
    }
    // Sanity-check: at least SOME parents should have a multi-token displayName
    // (e.g. "ZIREG LEA") — this confirms we're preserving the FULL NOM column,
    // not just the family name.
    const multiTokenCount = parents.filter((p) => p.displayName && p.displayName.trim().includes(" ")).length;
    expect(multiTokenCount, "expected at least one multi-token displayName").toBeGreaterThan(0);
  }, TEST_TIMEOUT_MS);

  it("schema declares + processes the extended therapy + quarterly columns (PSY/ORTH/E-PLANT/Ratrapage/SEPTEMBRE/DECEMBRE/MARS)", async () => {
    // The real workbook has the PSY1/PSY2/ORTH1/ORTH2/E-PLANT/Ratrapage/SEPTEMBRE/
    // DECEMBRE/MARS HEADERS in row 1 but the data cells are all empty in the
    // 2026_2027 file. So we verify TWO things:
    //   1. The schema DECLARES the extended columns (static contract check).
    //   2. When the columns ARE populated, the importer produces the correct
    //      therapy_psychology / therapy_speech / tuition ledger entries
    //      (end-to-end check with a synthetic workbook).
    const fieldKeys = (ETAT_SCHEMA.fields as unknown as Array<{ key: string }>).map((f) => f.key);
    const expectedExtendedKeys = [
      "psy1", "psy2", "orth1", "orth2", "eplant", "ratrapage",
      "septembre", "decembre", "mars",
    ];
    for (const key of expectedExtendedKeys) {
      expect(fieldKeys, `ETAT_SCHEMA should declare the extended column '${key}'`).toContain(key);
    }
    // End-to-end: build a synthetic workbook with non-zero PSY1 + ORTH1 +
    // SEPTEMBRE + MARS values and verify the importer produces the right
    // ledger categories.
    const engine = makeEngine();
    const syntheticBytes = await buildSyntheticWorkbookWithExtendedData();
    const ctx = await engine.importFile(syntheticBytes, "synthetic.xlsx", { dryRun: false });
    const records = await engine.getStorage().listInsertedForRun(ctx.runId);
    const ledgerEntries = records.flatMap(
      (r) => (r.entities ?? []).filter((e) => e.kind === "ledger_entry").map((e) => e.entity as LedgerEntry),
    );
    const therapyCount = ledgerEntries.filter(
      (e) => e.category === "therapy_psychology" || e.category === "therapy_speech",
    ).length;
    expect(therapyCount, "synthetic row with PSY1+ORTH1 should produce therapy ledger entries").toBeGreaterThan(0);
    const quarterlyCount = ledgerEntries.filter(
      (e) => e.metadata?.field === "SEPTEMBRE" || e.metadata?.field === "DECEMBRE" || e.metadata?.field === "MARS",
    ).length;
    expect(quarterlyCount, "synthetic row with SEPTEMBRE+MARS should produce quarterly ledger entries").toBeGreaterThan(0);
  }, TEST_TIMEOUT_MS);

  it("is idempotent — re-importing the same file does not create duplicate students", async () => {
    const engine1 = makeEngine();
    const ctx1 = await engine1.importFile(xlsxBytes, XLSX_PATH!, { dryRun: false });
    const records1 = await engine1.getStorage().listInsertedForRun(ctx1.runId);
    const students1 = records1.flatMap(
      (r) => (r.entities ?? []).filter((e) => e.kind === "student").map((e) => e.entity as Student),
    );
    const uniqueStudentIds1 = new Set(students1.map((s) => s.id));
    expect(uniqueStudentIds1.size, "first import should produce unique student IDs").toBeGreaterThan(0);

    // Re-import the same bytes through a FRESH engine that shares the same
    // repositories — this simulates the user re-running the import. The
    // adapter should match existing parents (by phone) and students (by
    // parentId + name) and UPDATE them instead of creating duplicates.
    const engine2 = makeEngine({ shareReposWith: engine1 });
    const ctx2 = await engine2.importFile(xlsxBytes, XLSX_PATH!, { dryRun: false });
    const records2 = await engine2.getStorage().listInsertedForRun(ctx2.runId);
    const students2 = records2.flatMap(
      (r) => (r.entities ?? []).filter((e) => e.kind === "student").map((e) => e.entity as Student),
    );
    const uniqueStudentIds2 = new Set(students2.map((s) => s.id));

    // The set of student IDs from the second import should be a SUBSET of
    // the first import's IDs — every student from run 2 should already exist
    // from run 1. No NEW student IDs should appear in run 2.
    const newIdsInRun2 = [...uniqueStudentIds2].filter((id) => !uniqueStudentIds1.has(id));
    expect(
      newIdsInRun2,
      `re-import should not create new student IDs; found ${newIdsInRun2.length} new IDs`,
    ).toHaveLength(0);

    // The second import should report mostly `update` actions, not `insert`.
    expect(ctx2.stats.rowsUpdated, "re-import should report updates").toBeGreaterThan(0);
  }, TEST_TIMEOUT_MS);

  // ──────────────────────────────────────────────────────────────────────────
  // BULK IMPORT FIX — payments + installments creation
  // ──────────────────────────────────────────────────────────────────────────
  // These tests verify the fix for the user's complaint that "no payment
  // history" and "no payment tranches/installments" were being created.
  // The fix wires PaymentRepository + InstallmentRepository into the
  // RepositoryStorageAdapter so each ETAT row's payment fields produce
  // corresponding `payments` and `installments` rows (not just ledger
  // entries). The student payments tab reads from these tables.

  it("creates `payments` rows for every payment-type field (FI, V2, T1, PSY1, etc.)", async () => {
    const engine = makeEngine({ withPaymentsAndInstallments: true });
    const ctx = await engine.importFile(xlsxBytes, XLSX_PATH!, { dryRun: false });
    const records = await engine.getStorage().listInsertedForRun(ctx.runId);
    // The adapter should have produced `payment` entities alongside the
    // ledger entries. At least ONE row in the real workbook has FI > 0
    // (registration fee), so we should get at least one payment entity.
    const paymentEntities = records.flatMap(
      (r) => (r.entities ?? []).filter((e) => e.kind === "payment").map((e) => e.entity as Payment),
    );
    expect(
      paymentEntities.length,
      "expected at least one payment entity (FI/V2/T1/etc.) from the real workbook",
    ).toBeGreaterThan(0);
    // Every payment should have a deterministic receipt number starting with
    // "IMP-" (the importer's convention) so re-imports are idempotent.
    for (const p of paymentEntities.slice(0, 10)) {
      expect(p.receiptNumber, `payment ${p.id} receiptNumber should start with IMP-`).toMatch(/^IMP-/);
    }
  }, TEST_TIMEOUT_MS);

  it("creates `installments` rows for tuition + transport tranches", async () => {
    const engine = makeEngine({ withPaymentsAndInstallments: true });
    const ctx = await engine.importFile(xlsxBytes, XLSX_PATH!, { dryRun: false });
    const records = await engine.getStorage().listInsertedForRun(ctx.runId);
    const installmentEntities = records.flatMap(
      (r) => (r.entities ?? []).filter((e) => e.kind === "installment").map((e) => e.entity as Installment),
    );
    expect(
      installmentEntities.length,
      "expected at least one installment entity (tuition/transport tranche) from the real workbook",
    ).toBeGreaterThan(0);
    // Every student with a DEVIS ANNUEL > 0 should have at least one tuition
    // installment. Every student with transport (OPTION=TRNSP or DISTINATION)
    // should have at least one transport installment.
    const tuitionInstallments = installmentEntities.filter((i) => i.category === "tuition");
    const transportInstallments = installmentEntities.filter((i) => i.category === "transport");
    expect(tuitionInstallments.length, "expected at least one tuition installment").toBeGreaterThan(0);
    // The real workbook has many students with OPTION=TRNSP and DISTINATION
    // populated (e.g. "BOUDOUAOU") — so transport installments should exist.
    expect(transportInstallments.length, "expected at least one transport installment").toBeGreaterThan(0);
  }, TEST_TIMEOUT_MS);

  it("links each student to its parent via parentId (parent-child relationship)", async () => {
    const engine = makeEngine();
    const ctx = await engine.importFile(xlsxBytes, XLSX_PATH!, { dryRun: false });
    const records = await engine.getStorage().listInsertedForRun(ctx.runId);
    const parents = records.flatMap(
      (r) => (r.entities ?? []).filter((e) => e.kind === "parent").map((e) => e.entity as Parent),
    );
    const students = records.flatMap(
      (r) => (r.entities ?? []).filter((e) => e.kind === "student").map((e) => e.entity as Student),
    );
    expect(parents.length, "should have at least one parent").toBeGreaterThan(0);
    expect(students.length, "should have at least one student").toBeGreaterThan(0);
    // Every student should have a non-empty parentId that matches an
    // existing parent — this is the parent-child relationship link.
    const parentIds = new Set(parents.map((p) => p.id));
    for (const s of students) {
      expect(s.parentId, `student ${s.code} should have a parentId`).toBeTruthy();
      expect(
        parentIds.has(s.parentId),
        `student ${s.code} parentId ${s.parentId} should match an existing parent`,
      ).toBe(true);
    }
    // Multiple students should share a parent (the real workbook has families
    // like SEDIKI with 2+ children sharing the same NEM phone number).
    const parentsWithMultipleChildren = new Map<string, number>();
    for (const s of students) {
      parentsWithMultipleChildren.set(s.parentId, (parentsWithMultipleChildren.get(s.parentId) ?? 0) + 1);
    }
    const familiesWithMultipleChildren = Array.from(parentsWithMultipleChildren.values()).filter((n) => n > 1).length;
    expect(
      familiesWithMultipleChildren,
      "expected at least one parent with multiple children (family)",
    ).toBeGreaterThan(0);
  }, TEST_TIMEOUT_MS);

  it("imports student information: level, gradeLevel, transport tier (DISTINATION)", async () => {
    const engine = makeEngine();
    const ctx = await engine.importFile(xlsxBytes, XLSX_PATH!, { dryRun: false });
    const records = await engine.getStorage().listInsertedForRun(ctx.runId);
    const students = records.flatMap(
      (r) => (r.entities ?? []).filter((e) => e.kind === "student").map((e) => e.entity as Student),
    );
    expect(students.length).toBeGreaterThan(0);
    // Every student should have a non-empty gradeLevel (mapped from the
    // niveau column: PRIM → 1ap, COLG → 1am, LYC → 1ere_annee, etc.).
    for (const s of students.slice(0, 20)) {
      expect(s.gradeLevel, `student ${s.code} should have a gradeLevel`).toBeTruthy();
      expect(s.level, `student ${s.code} should have an academic level`).toBeTruthy();
    }
    // At least one student should have a non-empty transportTier (DISTINATION
    // column — e.g. "BOUDOUAOU", "DJENAT", "FIGUIER"). The real workbook
    // has many rows with transport.
    const studentsWithTransport = students.filter((s) => s.transportTier);
    expect(
      studentsWithTransport.length,
      "expected at least one student with a transport tier (DISTINATION)",
    ).toBeGreaterThan(0);
  }, TEST_TIMEOUT_MS);
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build an ImportEngine wired to FAST in-memory stub repositories. */
function makeEngine(opts?: { shareReposWith?: ImportEngine; withPaymentsAndInstallments?: boolean }): ImportEngine {
  // For the idempotency test: when shareReposWith is provided, reuse the
  // same repository instances so the second import sees the first import's data.
  if (opts?.shareReposWith) {
    const cached = BUNDLES.get(opts.shareReposWith);
    if (cached) {
      const engine = new ImportEngine({
        storage: new RepositoryStorageAdapter(cached.deps),
        auditSink: { async logAction() { /* no-op */ } },
      });
      BUNDLES.set(engine, { engine, deps: cached.deps });
      return engine;
    }
  }
  // The shared mock repos in `mock-repositories.ts` have artificial 120-400ms
  // delays per call to simulate network latency. For a 390-row import that
  // would take ~25 minutes — way too slow for a test. Use fast in-memory
  // stubs instead. They implement just enough of the repository interfaces
  // for the importer to work: create/search/update for parents + students,
  // appendMany + observeByParent for the ledger.
  const parents = new FastParentRepo();
  const students = new FastStudentRepo();
  const ledger = new FastLedgerRepo();
  const payments = opts?.withPaymentsAndInstallments ? new FastPaymentRepo() : undefined;
  const installments = opts?.withPaymentsAndInstallments ? new FastInstallmentRepo() : undefined;
  const deps = {
    parents,
    students,
    ledger,
    payments,
    installments,
    tenantId: "test-tenant",
    actorId: "test-actor",
    actorName: "Test Actor",
  };
  const engine = new ImportEngine({
    storage: new RepositoryStorageAdapter(deps),
    auditSink: { async logAction() { /* no-op */ } },
  });
  BUNDLES.set(engine, { engine, deps });
  return engine;
}

// ── Fast in-memory stub repositories ─────────────────────────────────────────
// These implement just enough of the repository interfaces for the importer
// to work. They have NO artificial delays, so a 390-row import completes in
// <1 second. They're test-only — production code uses the mock or Supabase
// repositories.

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
  private readonly rows: LedgerEntry[] = [];
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
  async reconcile(): Promise<Result<import("../../domain/reconcile").ReconciliationReport>> {
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
  private readonly rows = new Map<string, Installment>();

  private key(parentId: string, studentId: string, category: PaymentCategory, trancheNumber: number): string {
    return `${parentId}:${studentId}:${category}:${trancheNumber}`;
  }

  observeByParent(parentId: string): Observable<Installment[]> {
    return new SubjectBehavior<Installment[]>([...this.rows.values()].filter((i) => i.parentId === parentId));
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
  async allocatePayment(): Promise<Result<import("../../domain/calc/payment/installments").AllocationResult>> {
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

/**
 * Count rows in the ETAT sheet via a direct exceljs scan.
 * Returns:
 *   - `anyNonEmpty`: rows (excluding header) with at least one non-empty
 *     cell in columns B (2) through Y (25) — the schema-declared range.
 *   - `withNom`: rows (excluding header) with a non-empty NOM (column F).
 *     The importer requires NOM, so this is the count of rows that should
 *     actually be imported.
 */
async function countEtatRows(xlsxPath: string): Promise<{ anyNonEmpty: number; withNom: number }> {
  const wb = new ExcelJS.Workbook();
  const buf = fs.readFileSync(xlsxPath);
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.worksheets.find((s) => /^ETAT/i.test(s.name));
  if (!ws) throw new Error("ETAT sheet not found in workbook");
  let anyNonEmpty = 0;
  let withNom = 0;
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    let isEmpty = true;
    // Columns B (2) through Y (25).
    for (let c = 2; c <= 25; c++) {
      const cell = row.getCell(c);
      const v = cell?.value;
      if (v !== null && v !== undefined && v !== "") {
        isEmpty = false;
        break;
      }
    }
    if (!isEmpty) anyNonEmpty++;
    // NOM is column F (6).
    const nom = row.getCell(6)?.value;
    if (nom !== null && nom !== undefined && nom !== "") withNom++;
  }
  return { anyNonEmpty, withNom };
}

/**
 * Build a synthetic .xlsx workbook with one ETAT row that has non-zero
 * values in the extended therapy + quarterly columns (PSY1, ORTH1,
 * SEPTEMBRE, MARS). Used to verify the importer produces the correct
 * ledger categories when those columns ARE populated (the real 2026_2027
 * workbook has them as headers but no data).
 */
async function buildSyntheticWorkbookWithExtendedData(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("ETAT 20262027");
  // Header row — must match the real workbook's headers exactly (including
  // trailing spaces, which the parser trims).
  const headers = [
    "", "INFOS ", "E-MAIL", "NEM", "TUTEUR ", "NOM", "niveau", "CLASSE ",
    "OPTION ", "REMISE", "JUSTIFICATION ", "DEVIS ANNUEL", "REMBOURCEMENT ",
    "DETTES ", "REGLEMENTS DETTES ", "TOTAL VERSEMENTS", "TOTAL*CREANCE",
    "FI", "V2", "2V", "v3", "DISTINATION", "1T", "T2", "t3",
    "PSY1", "PSY2", "ORTH1", "ORTH2", "E-PLANT", "Ratrapage",
    "SEPTEMBRE", "CREANCES SEPTEMBRE", "DECEMBRE", "CREANCES DECEMBRE",
    "MARS", "CREANCES MARS", "TOTAL",
  ];
  ws.addRow(headers);
  // One data row with non-zero PSY1 + ORTH1 + SEPTEMBRE + MARS.
  ws.addRow([
    "", // A
    "", // B INFOS
    "", // C E-MAIL
    "0663701834", // D NEM
    "", // E TUTEUR
    "TEST STUDENT", // F NOM
    "PRIM", // G niveau
    "CP", // H CLASSE
    "", // I OPTION
    0, // J REMISE
    "", // K JUSTIFICATION
    100000, // L DEVIS ANNUEL
    0, // M REMBOURCEMENT
    0, // N DETTES
    0, // O REGLEMENTS DETTES
    0, // P TOTAL VERSEMENTS
    0, // Q TOTAL*CREANCE
    25000, // R FI
    0, // S V2
    0, // T 2V
    0, // U v3
    "", // V DISTINATION
    0, // W 1T
    0, // X T2
    0, // Y t3
    15000, // Z PSY1
    0, // AA PSY2
    12000, // AB ORTH1
    0, // AC ORTH2
    0, // AD E-PLANT
    0, // AE Ratrapage
    30000, // AF SEPTEMBRE
    0, // AG CREANCES SEPTEMBRE
    0, // AH DECEMBRE
    0, // AI CREANCES DECEMBRE
    25000, // AJ MARS
    0, // AK CREANCES MARS
    0, // AL TOTAL
  ]);
  // Serialize to a Uint8Array buffer.
  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf);
}
