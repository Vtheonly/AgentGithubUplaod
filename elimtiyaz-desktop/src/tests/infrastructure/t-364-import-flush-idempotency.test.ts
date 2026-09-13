/**
 * T-364 — Excel import restore-integrity unit tests (IMPORT-107/108/109).
 *
 * Three focused regressions for the empty-state restore defect family the
 * IMPORT-106 verification probe exposed, pinned at the UNIT level (the
 * end-to-end evidence lives in empty-state-excel-restore.test.ts):
 *
 *  IMPORT-107 — the direct ledger flush ignored the canonical
 *    (tenant, source_type, source_id) identity (migration 0027 +
 *    ledger_entries_source_uidx). The adapter now dedupes its pending batch
 *    against the ledger stream; the Supabase bulkAppend now uses
 *    ignore-duplicates, fails LOUD on chunk errors (the old
 *    console.warn-and-continue swallowed them) and updates its cache with
 *    ONLY the rows actually inserted (the old unconditional cache push
 *    polluted the UI with phantom rows on every rejected chunk).
 *
 *  IMPORT-108 — the mock payment repository had NO bulkCollect, so the
 *    importer's payment flush fell back to the INTERACTIVE collect() loop:
 *    each imported payment got a SECOND ledger entry (collect writes its
 *    own), the waterfall re-allocated amountPaid the importer had already
 *    set, and the deterministic IMP- receipt was discarded (auto REC-… →
 *    re-imports duplicated payments). The mock now implements bulkCollect
 *    with the Supabase import contract: insert-only, receipt honoured,
 *    idempotent by receipt.
 *
 *  IMPORT-109 — findExistingStudent matched the FIRST search result whose
 *    parentId fit, but the repository search is SUBSTRING-based: the query
 *    "LINA BELGRIMAT" also matches a sibling "MILINA BELGRIMAT"
 *    ("miLINA BELGRIMAT" contains the query). On re-import the first-match
 *    cross-wired the siblings (MILINA renamed to LINA via updateStudent, a
 *    duplicate MILINA created, financial entries re-buffered against the
 *    WRONG student). The match is now EXACT on (parentId + displayName)
 *    with (parentId + firstName + lastName) as fallback.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseLedgerRepository } from "../../infrastructure/supabase/repositories/supabase-shared-repositories";
import { MockPaymentRepository } from "../../infrastructure/mock/repositories/financial-repository";
import { store } from "../../infrastructure/mock/repositories/mock-store";
import { RepositoryStorageAdapter } from "../../infrastructure/excel/import-engine/storage/repository-adapter";
import { ImportEngine } from "../../infrastructure/excel/import-engine";
import type {
  ParentRepository, StudentRepository, LedgerRepository, PaymentRepository,
  InstallmentRepository, Observable, ImportInstallmentInput,
} from "../../domain/repository/repository";
import type { Result } from "../../core/result";
import { Ok, Err } from "../../core/result";
import { Errors } from "../../core/app-error";
import type { Parent, CreateParentInput, UpdateParentInput } from "../../domain/model/parent";
import type { Student, CreateStudentInput, UpdateStudentInput, BatchRegistrationInput, BatchRegistrationResult, GradeLevel } from "../../domain/model/student";
import type { LedgerEntry } from "../../domain/model/ledger";
import type { Payment, Installment, CollectPaymentInput, PaymentCategory, PaymentStatus } from "../../domain/model/payment";
import { SubjectBehavior } from "../../infrastructure/mock/subject-behavior";
import { createChargeEntry } from "../../domain/calc/ledger/entries";

// T-053: explicit working tenant for the Supabase repository tests.
beforeAll(() => {
  localStorage.setItem(
    "el-imtiyaz.session",
    JSON.stringify({ tenantId: "00000000-0000-0000-0000-000000000001", userId: "staff-1" }),
  );
});
afterAll(() => {
  localStorage.removeItem("el-imtiyaz.session");
});

// ── Fake Supabase client (t-012 pattern, extended with upsert) ───────────────

type Row = Record<string, any>;

interface UpsertCall {
  table: string;
  rows: Row[];
  options: { ignoreDuplicates?: boolean } | undefined;
  wantedSelect: boolean;
}

class FakeLedgerClient {
  readonly upsertCalls: UpsertCall[] = [];
  /** Rows the fake DB reports as ALREADY inserted (dedupe simulation). */
  existingSourceIds = new Set<string>();
  error: { code: string; message: string } | null = null;

  from(table: string) {
    // Arrow functions keep `this` lexical — no this-aliasing needed.
    return {
      upsert: (rows: Row[], options?: { ignoreDuplicates?: boolean }) => {
        const call: UpsertCall = { table, rows, options, wantedSelect: false };
        this.upsertCalls.push(call);
        return {
          select: () => {
            call.wantedSelect = true;
            return Promise.resolve(this.execInsert(call));
          },
        };
      },
    };
  }

  private execInsert(call: UpsertCall): { data: Row[] | null; error: unknown } {
    if (this.error) return { data: null, error: this.error };
    // Simulate ON CONFLICT DO NOTHING: rows whose source_id already exists
    // are skipped; .select() returns ONLY the actually-inserted rows.
    const inserted = call.rows.filter(
      (r) => r.source_id == null || !this.existingSourceIds.has(String(r.source_id)),
    );
    for (const r of inserted) {
      if (r.source_id != null) this.existingSourceIds.add(String(r.source_id));
    }
    return { data: inserted, error: null };
  }
}

function ledgerEntry(sourceId: string, amount: number): LedgerEntry {
  return createChargeEntry({
    tenantId: "00000000-0000-0000-0000-000000000001",
    parentId: "p-1",
    studentId: "s-1",
    category: "tuition",
    amount,
    sourceType: "bulk_import",
    sourceId,
    description: `Test entry ${sourceId}`,
    actorId: "staff-1",
    actorName: "Staff One",
  });
}

// ── IMPORT-107: SupabaseLedgerRepository.bulkAppend ──────────────────────────

describe("T-364 / IMPORT-107 — SupabaseLedgerRepository.bulkAppend idempotency + atomicity", () => {
  it("uses upsert with ignoreDuplicates (ON CONFLICT DO NOTHING) and .select()", async () => {
    const fake = new FakeLedgerClient();
    const repo = new SupabaseLedgerRepository(fake as unknown as SupabaseClient);
    const result = await repo.bulkAppend([ledgerEntry("stu-1:DEVIS_ANNUEL", 239500)]);
    expect(result.ok).toBe(true);
    expect(fake.upsertCalls).toHaveLength(1);
    expect(fake.upsertCalls[0].options?.ignoreDuplicates).toBe(true);
    expect(fake.upsertCalls[0].wantedSelect).toBe(true);
  });

  it("returns Err (loud) on a chunk error instead of swallowing it", async () => {
    const fake = new FakeLedgerClient();
    fake.error = { code: "23505", message: "duplicate key value violates unique constraint" };
    const repo = new SupabaseLedgerRepository(fake as unknown as SupabaseClient);
    const result = await repo.bulkAppend([ledgerEntry("stu-1:DEVIS_ANNUEL", 239500)]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("bulkAppend");
      expect(result.error.message).toContain("duplicate key");
    }
  });

  it("skips already-existing source identities and returns ONLY the inserted rows", async () => {
    const fake = new FakeLedgerClient();
    fake.existingSourceIds.add("stu-1:DEVIS_ANNUEL"); // re-import scenario
    const repo = new SupabaseLedgerRepository(fake as unknown as SupabaseClient);
    const result = await repo.bulkAppend([
      ledgerEntry("stu-1:DEVIS_ANNUEL", 239500), // exists → skipped
      ledgerEntry("stu-1:DETTES", 18000), // new → inserted
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0].sourceId).toBe("stu-1:DETTES");
    }
  });
});

// ── IMPORT-107: the adapter's flush dedupe ───────────────────────────────────

describe("T-364 / IMPORT-107 — RepositoryStorageAdapter ledger flush dedupe", () => {
  it("re-importing an existing sourceId writes NOTHING (the flush filters the pending batch)", async () => {
    // Ledger stub pre-populated with the entry the re-import would rebuild.
    const existing = ledgerEntry("stu-1:DEVIS_ANNUEL", 239500);
    const ledger = new FlushLedgerStub([existing]);
    const adapter = new RepositoryStorageAdapter({
      parents: new NoopParentRepo(),
      students: new NoopStudentRepo(),
      ledger,
      tenantId: "00000000-0000-0000-0000-000000000001",
    });
    // Simulate the buffered pending entries of a re-import: one duplicate
    // (same source identity, fresh entry id) + one genuinely new entry.
    const duplicate = ledgerEntry("stu-1:DEVIS_ANNUEL", 239500);
    const fresh = ledgerEntry("stu-1:DETTES", 18000);
    (adapter as unknown as { pendingLedgerEntries: LedgerEntry[] }).pendingLedgerEntries = [
      duplicate,
      fresh,
    ];
    await (adapter as unknown as { flushPendingBatches(): Promise<void> }).flushPendingBatches();
    // Only the fresh entry was appended — the duplicate was filtered out.
    expect(ledger.rows).toHaveLength(2);
    expect(ledger.rows.map((e) => e.sourceId)).toEqual([
      "stu-1:DEVIS_ANNUEL",
      "stu-1:DETTES",
    ]);
  });

  it("honours an Err Result from bulkAppend (the import fails atomically)", async () => {
    const ledger = new ErringLedgerStub();
    const adapter = new RepositoryStorageAdapter({
      parents: new NoopParentRepo(),
      students: new NoopStudentRepo(),
      ledger,
      tenantId: "00000000-0000-0000-0000-000000000001",
    });
    (adapter as unknown as { pendingLedgerEntries: LedgerEntry[] }).pendingLedgerEntries = [
      ledgerEntry("stu-1:DEVIS_ANNUEL", 239500),
    ];
    await expect(
      (adapter as unknown as { flushPendingBatches(): Promise<void> }).flushPendingBatches(),
    ).rejects.toThrow(/écritures du journal/);
  });
});

// ── IMPORT-108: the mock bulkCollect ────────────────────────────────────────

describe("T-364 / IMPORT-108 — MockPaymentRepository.bulkCollect import contract", () => {
  const payments = new MockPaymentRepository();
  const INPUT = (receiptNumber: string, amount: number): CollectPaymentInput => ({
    parentId: "par-900",
    studentId: "stu-900",
    amount,
    method: "cash",
    category: "tuition",
    installmentId: null,
    receiptNumber,
  });

  it("inserts payments rows WITHOUT writing ledger entries or allocating installments", async () => {
    const ledgerBefore = store.ledger.length;
    const installmentsBefore = store.installments.length;
    const result = await payments.bulkCollect([
      { input: INPUT("IMP-stu-900-FI", 25000), collectedBy: "excel-import" },
      { input: INPUT("IMP-stu-900-V2", 71500), collectedBy: "excel-import" },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(2);
    // The generic collect() would have appended 2 ledger payment entries
    // and run the waterfall — bulkCollect must do NEITHER.
    expect(store.ledger.length).toBe(ledgerBefore);
    expect(store.installments.length).toBe(installmentsBefore);
    // The deterministic IMP- receipts are honoured verbatim.
    expect(result.ok && result.value.every((p) => p.receiptNumber.startsWith("IMP-"))).toBe(true);
  });

  it("is idempotent by receiptNumber (re-import returns the existing rows)", async () => {
    const before = store.payments.length;
    const result = await payments.bulkCollect([
      { input: INPUT("IMP-stu-900-FI", 25000), collectedBy: "excel-import" },
    ]);
    expect(result.ok).toBe(true);
    expect(store.payments.length).toBe(before); // no duplicate row
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0].amount).toBe(25000);
    }
  });
});

// ── IMPORT-109: exact student identity matching ─────────────────────────────

describe("T-364 / IMPORT-109 — findExistingStudent exact identity (LINA vs MILINA)", () => {
  it("a re-import matches each sibling EXACTLY (no cross-wiring, no duplicate)", async () => {
    // The workbook rows: 229 "BELGRIMAT LINA" (CM2) / 230 "BELGRIMAT MILINA"
    // (CE1) — the SAME parent (phone 0661607648). The substring search for
    // "LINA BELGRIMAT" returns BOTH students; the old first-match picked
    // MILINA (store order) and renamed her to LINA.
    const students = new StudentSearchStub();
    const parents = new ParentPhoneStub();
    const lina: Student = {
      ...BASE_STUDENT,
      id: "stu-228",
      parentId: "par-155",
      firstName: "LINA",
      lastName: "BELGRIMAT",
      displayName: "BELGRIMAT LINA",
    };
    const milina: Student = {
      ...BASE_STUDENT,
      id: "stu-229",
      parentId: "par-155",
      firstName: "MILINA",
      lastName: "BELGRIMAT",
      displayName: "BELGRIMAT MILINA",
    };
    // Mock store order: unshift → the NEWEST (MILINA) comes FIRST in the
    // search results — the exact order that triggered the cross-wiring.
    students.rows.push(milina, lina);

    const adapter = new RepositoryStorageAdapter({
      parents,
      students,
      tenantId: "00000000-0000-0000-0000-000000000001",
    });
    // Row 229 (LINA) — must match stu-228, NOT stu-229.
    const matchLina = await (adapter as unknown as {
      findExistingStudent(p: Parent, i: CreateStudentInput): Promise<Student | null>;
    }).findExistingStudent(
      { id: "par-155" } as Parent,
      { firstName: "LINA", lastName: "BELGRIMAT", displayName: "BELGRIMAT LINA" } as CreateStudentInput,
    );
    expect(matchLina?.id).toBe("stu-228");
    // Row 230 (MILINA) — must match stu-229.
    const matchMilina = await (adapter as unknown as {
      findExistingStudent(p: Parent, i: CreateStudentInput): Promise<Student | null>;
    }).findExistingStudent(
      { id: "par-155" } as Parent,
      { firstName: "MILINA", lastName: "BELGRIMAT", displayName: "BELGRIMAT MILINA" } as CreateStudentInput,
    );
    expect(matchMilina?.id).toBe("stu-229");
    // Neither search path created a duplicate.
    expect(students.rows).toHaveLength(2);
  });
});

// ── Test stubs ───────────────────────────────────────────────────────────────

const BASE_STUDENT: Student = {
  id: "stu-x",
  tenantId: "t",
  code: "ELV-2026-XXXX",
  parentId: "par-x",
  firstName: "",
  middleName: null,
  lastName: "",
  displayName: null,
  gender: "unspecified",
  birthDate: "2000-01-01",
  enrollmentDate: "2026-09-01",
  level: "primaire",
  gradeYear: 1,
  gradeLevel: "1ap" as GradeLevel,
  classId: null,
  photoUrl: null,
  medicalNotes: null,
  transportTier: null,
  status: "active",
  paymentPlan: "tranches",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

class StudentSearchStub implements StudentRepository {
  readonly rows: Student[] = [];
  private readonly cache = new SubjectBehavior<Student[]>([]);
  observe(): Observable<Student[]> { return this.cache; }
  observeByParent(): Observable<Student[]> { return new SubjectBehavior<Student[]>(this.rows); }
  observeByClass(): Observable<Student[]> { return new SubjectBehavior<Student[]>([]); }
  observeById(): Observable<Student | null> { return new SubjectBehavior<Student | null>(null); }
  async search(query: string): Promise<Result<Student[]>> {
    const q = query.toLowerCase().trim();
    if (!q) return Ok([...this.rows]);
    return Ok(this.rows.filter((s) =>
      `${s.firstName} ${s.lastName} ${s.displayName ?? ""} ${s.code}`.toLowerCase().includes(q)
    ));
  }
  async createStudent(): Promise<Result<Student>> { return Err(Errors.server("stub")); }
  async updateStudent(): Promise<Result<Student>> { return Err(Errors.server("stub")); }
  async deleteStudent(): Promise<Result<void>> { return Err(Errors.server("stub")); }
  async batchRegister(): Promise<Result<BatchRegistrationResult>> { return Err(Errors.server("stub")); }
  async promote(): Promise<Result<Student[]>> { return Err(Errors.server("stub")); }
}

class ParentPhoneStub implements ParentRepository {
  observe(): Observable<Parent[]> { return new SubjectBehavior<Parent[]>([]); }
  observeById(): Observable<Parent | null> { return new SubjectBehavior<Parent | null>(null); }
  async search(): Promise<Result<Parent[]>> { return Ok([]); }
  async createParent(): Promise<Result<Parent>> { return Err(Errors.server("stub")); }
  async updateParent(): Promise<Result<Parent>> { return Err(Errors.server("stub")); }
  async deleteParent(): Promise<Result<void>> { return Err(Errors.server("stub")); }
}

class NoopParentRepo extends ParentPhoneStub {}
class NoopStudentRepo extends StudentSearchStub {}

class FlushLedgerStub implements LedgerRepository {
  readonly rows: LedgerEntry[];
  private readonly cache = new SubjectBehavior<LedgerEntry[]>([]);
  constructor(initial: LedgerEntry[] = []) {
    this.rows = [...initial];
    this.cache.set([...this.rows]);
  }
  observe(): Observable<LedgerEntry[]> { return this.cache; }
  observeByParent(): Observable<LedgerEntry[]> { return new SubjectBehavior<LedgerEntry[]>(this.rows); }
  observeByAccount(): Observable<LedgerEntry[]> { return new SubjectBehavior<LedgerEntry[]>(this.rows); }
  observeByStudent(): Observable<LedgerEntry[]> { return new SubjectBehavior<LedgerEntry[]>(this.rows); }
  async append(entry: LedgerEntry): Promise<Result<LedgerEntry>> {
    this.rows.push(entry);
    this.cache.set([...this.rows]);
    return Ok(entry);
  }
  async appendMany(entries: readonly LedgerEntry[]): Promise<Result<readonly LedgerEntry[]>> {
    this.rows.push(...entries);
    this.cache.set([...this.rows]);
    return Ok([...entries]);
  }
  async reverse(): Promise<Result<LedgerEntry>> { return Err(Errors.server("stub")); }
  async summary(): Promise<Result<import("../../domain/model/ledger").ParentLedgerSummary>> { return Err(Errors.server("stub")); }
  async reconcile(): Promise<Result<import("../../domain/calc/reconcile").ReconciliationReport>> { return Err(Errors.server("stub")); }
  async bulkAppend(entries: readonly LedgerEntry[]): Promise<Result<readonly LedgerEntry[]>> {
    return this.appendMany(entries);
  }
}

class ErringLedgerStub extends FlushLedgerStub {
  async bulkAppend(): Promise<Result<readonly LedgerEntry[]>> {
    return Err(Errors.server("bulkAppend simulated failure"));
  }
}
