/**
 * T-421 — the re-import failure regressions (IMPORT-116/117/118/119).
 *
 * The live trigger (the owner's 2026-09-26 23:00:40 run, issue #20's
 * follow-up log): re-importing a workbook whose financial data is ALREADY
 * in the database died at the bulk flush with
 *   `duplicate key value violates unique constraint
 *    "ledger_entries_source_uidx"` (ledger chunk @2000) and
 *   `payments_tenant_id_payment_number_key` (rows 1501–2000),
 * while a THIRD 409 (installments) never reached the surfaced error, the
 * message falsely claimed "le lot a été annulé (aucune écriture partielle)"
 * although ~2,000 + ~1,500 + ~4,000 rows from earlier chunks were already
 * committed, and the compensating rollback soft-deleted every student the
 * run's upserts had touched.
 *
 * The wire-semantics root cause (live-proven by scripts/t-421-wire-semantics.mjs,
 * residue-free): PostgREST's `.upsert(rows, { ignoreDuplicates: true })`
 * generates `ON CONFLICT (<PRIMARY KEY>) DO NOTHING` — the payloads never
 * carry `id`, so NO conflict is ever suppressed; cross-run conflicts on the
 * financial identity constraints raise 23505, and `on_conflict` cannot
 * repeat the partial-index predicates (42P10).
 *
 * Pinned here:
 *  IMPORT-116 — the flush preflights all three pending streams against the
 *    DATABASE (listImportLedgerSourceKeys / listImportPaymentNumbers /
 *    listImportInstallmentIdentities): a re-import of already-present data
 *    writes NOTHING (clean no-op), independent of cache state.
 *  IMPORT-117 — the installments Result is honored: a bulkImportInstallments
 *    Err FAILS the import (previously awaited and dropped).
 *  IMPORT-118 — the failure message is honest: per-table landed counts via
 *    the WithProgress callbacks, "ÉTAT PARTIEL" when rows landed, "état…
 *    intact" when none did — never the disproven blanket "aucune écriture
 *    partielle".
 *  IMPORT-119 — the compensating rollback only deletes entities the run
 *    actually CREATED (createStudentTracked/createParentTracked's
 *    wasInserted), and an upsert-matched pre-existing student counts as an
 *    UPDATE in the run stats (the live run misreported "1,137 imported").
 */
import { describe, it, expect } from "vitest";
import { RepositoryStorageAdapter } from "../../infrastructure/excel/import-engine/storage/repository-adapter";
import type {
  ParentRepository, StudentRepository, LedgerRepository, PaymentRepository,
  InstallmentRepository, Observable, ImportInstallmentInput,
} from "../../domain/repository/repository";
import type { Result } from "../../core/result";
import { Ok, Err } from "../../core/result";
import { Errors } from "../../core/app-error";
import type { Parent, CreateParentInput, UpdateParentInput } from "../../domain/model/parent";
import type {
  Student, CreateStudentInput, UpdateStudentInput, BatchRegistrationInput,
  BatchRegistrationResult,
} from "../../domain/model/student";
import type { LedgerEntry } from "../../domain/model/ledger";
import type { Payment, Installment, CollectPaymentInput } from "../../domain/model/payment";
import { SubjectBehavior } from "../../infrastructure/mock/subject-behavior";
import { createChargeEntry } from "../../domain/calc/ledger/entries";

const TENANT = "00000000-0000-0000-0000-000000000001";

// ── Shared fixtures ─────────────────────────────────────────────────────────

function ledgerEntry(sourceId: string, amount = 239500, studentId = "stu-1"): LedgerEntry {
  return createChargeEntry({
    tenantId: TENANT,
    parentId: "par-1",
    studentId,
    category: "tuition",
    amount,
    sourceType: "bulk_import",
    sourceId,
    description: `T-421 entry ${sourceId}`,
    actorId: "staff-1",
    actorName: "Staff One",
  });
}

function paymentInput(receiptNumber: string, amount = 25000): CollectPaymentInput {
  return {
    parentId: "par-1",
    studentId: "stu-1",
    amount,
    method: "cash",
    category: "tuition",
    installmentId: null,
    receiptNumber,
  };
}

function installmentInput(trancheNumber: 1 | 2 | 3 | 4 = 1): ImportInstallmentInput {
  return {
    parentId: "par-1",
    studentId: "stu-1",
    category: "tuition",
    trancheNumber,
    label: "INSCRIPTION (FI)",
    amountDue: 25000,
    amountPaid: 25000,
    dueDate: "2026-09-15",
    paidDate: "2026-09-10",
    status: "paid",
    academicCycle: "primaire",
    paymentPlan: "tranches",
    sourceType: "bulk_import",
    sourceId: `imp-stu-1-tuition-T${trancheNumber}`,
    actorId: "staff-1",
    actorName: "Staff One",
  };
}

type FlushSpy = {
  ledgerRows: LedgerEntry[];
  paymentRows: Array<{ input: CollectPaymentInput; collectedBy: string }>;
  installmentRows: ImportInstallmentInput[];
};

/** The pre-populated DB state of a SUCCESSFUL first import. */
class ReimportLedgerStub implements LedgerRepository {
  readonly rows: LedgerEntry[];
  readonly appended: LedgerEntry[] = [];
  private readonly cache = new SubjectBehavior<LedgerEntry[]>([]);
  constructor(initial: LedgerEntry[]) {
    this.rows = [...initial];
    this.cache.set([...this.rows]);
  }
  observe(): Observable<LedgerEntry[]> { return this.cache; }
  observeByParent(): Observable<LedgerEntry[]> { return new SubjectBehavior<LedgerEntry[]>(this.rows); }
  observeByAccount(): Observable<LedgerEntry[]> { return new SubjectBehavior<LedgerEntry[]>(this.rows); }
  observeByStudent(): Observable<LedgerEntry[]> { return new SubjectBehavior<LedgerEntry[]>(this.rows); }
  async append(entry: LedgerEntry): Promise<Result<LedgerEntry>> {
    this.appended.push(entry);
    this.rows.push(entry);
    return Ok(entry);
  }
  async appendMany(entries: readonly LedgerEntry[]): Promise<Result<readonly LedgerEntry[]>> {
    this.appended.push(...entries);
    this.rows.push(...entries);
    return Ok([...entries]);
  }
  async bulkAppend(entries: readonly LedgerEntry[]): Promise<Result<readonly LedgerEntry[]>> {
    return this.appendMany(entries);
  }
  async listImportLedgerSourceKeys(): Promise<Set<string>> {
    const keys = new Set<string>();
    for (const e of this.rows) {
      if (e.sourceType != null && e.sourceId != null) keys.add(`${e.sourceType}|${e.sourceId}`);
    }
    return keys;
  }
  async reverse(): Promise<Result<LedgerEntry>> { return Err(Errors.server("stub")); }
  async summary(): Promise<Result<import("../../domain/model/ledger").ParentLedgerSummary>> { return Err(Errors.server("stub")); }
  async reconcile(): Promise<Result<import("../../domain/calc/reconcile").ReconciliationReport>> { return Err(Errors.server("stub")); }
}

class ReimportPaymentStub implements PaymentRepository {
  readonly collected: Array<{ input: CollectPaymentInput; collectedBy: string }> = [];
  /** The DB's imported payment numbers (the IMP-… identity space). */
  constructor(readonly existingNumbers: Set<string>) {}
  observe(): Observable<Payment[]> { return new SubjectBehavior<Payment[]>([]); }
  observeByParent(): Observable<Payment[]> { return new SubjectBehavior<Payment[]>([]); }
  observeByStudent(): Observable<Payment[]> { return new SubjectBehavior<Payment[]>([]); }
  observeById(): Observable<Payment | null> { return new SubjectBehavior<Payment | null>(null); }
  async collect(input: CollectPaymentInput, collectedBy: string): Promise<Result<Payment>> {
    this.collected.push({ input, collectedBy });
    return Ok({} as Payment);
  }
  async bulkCollect(
    inputs: ReadonlyArray<{ input: CollectPaymentInput; collectedBy: string }>,
  ): Promise<Result<readonly Payment[]>> {
    this.collected.push(...inputs);
    return Ok(inputs.map(() => ({}) as Payment));
  }
  async listImportPaymentNumbers(): Promise<Set<string>> {
    return new Set(this.existingNumbers);
  }
  async refund(): Promise<Result<Payment>> { return Err(Errors.server("stub")); }
  async markCleared(): Promise<Result<Payment>> { return Err(Errors.server("stub")); }
  async markBounced(): Promise<Result<Payment>> { return Err(Errors.server("stub")); }
  async adjust(): Promise<Result<import("../../domain/model/payment").AccountAdjustment>> { return Err(Errors.server("stub")); }
  async generateReceipt(): Promise<Result<import("../../domain/model/payment").Receipt>> { return Err(Errors.server("stub")); }
  async appendManualCharge(): Promise<Result<LedgerEntry>> { return Err(Errors.server("stub")); }
}

class ReimportInstallmentStub implements InstallmentRepository {
  readonly imported: ImportInstallmentInput[] = [];
  /** The DB's imported tranche identities. */
  constructor(readonly existingIdentities: Set<string>) {}
  observe(): Observable<Installment[]> { return new SubjectBehavior<Installment[]>([]); }
  observeByParent(): Observable<Installment[]> { return new SubjectBehavior<Installment[]>([]); }
  observeByStudent(): Observable<Installment[]> { return new SubjectBehavior<Installment[]>([]); }
  observeById(): Observable<Installment | null> { return new SubjectBehavior<Installment | null>(null); }
  async importInstallment(input: ImportInstallmentInput): Promise<Result<Installment>> {
    this.imported.push(input);
    return Ok({} as Installment);
  }
  async bulkImportInstallments(inputs: readonly ImportInstallmentInput[]): Promise<Result<readonly Installment[]>> {
    this.imported.push(...inputs);
    return Ok(inputs.map(() => ({}) as Installment));
  }
  async listImportInstallmentIdentities(): Promise<Set<string>> {
    return new Set(this.existingIdentities);
  }
  async markPaid(): Promise<Result<Installment>> { return Err(Errors.server("stub")); }
  async allocatePayment(): Promise<Result<import("../../domain/calc/payment/waterfall-allocator").AllocationResult>> { return Err(Errors.server("stub")); }
  async updateDueDate(): Promise<Result<Installment>> { return Err(Errors.server("stub")); }
  async regenerateForCycle(): Promise<Result<readonly Installment[]>> { return Err(Errors.server("stub")); }
  async findOverdue(): Promise<Result<readonly Installment[]>> { return Ok([]); }
}

class NoopParentRepo implements ParentRepository {
  async createParent(input: CreateParentInput): Promise<Result<Parent>> { return Ok({ id: "par-new" } as Parent); }
  observe(): Observable<Parent[]> { return new SubjectBehavior<Parent[]>([]); }
  observeById(): Observable<Parent | null> { return new SubjectBehavior<Parent | null>(null); }
  async search(): Promise<Result<Parent[]>> { return Ok([]); }
  async updateParent(): Promise<Result<Parent>> { return Err(Errors.server("stub")); }
  async deleteParent(_id?: string): Promise<Result<void>> { return Err(Errors.server("stub")); }
}

class NoopStudentRepo implements StudentRepository {
  async createStudent(parentId: string, input: CreateStudentInput): Promise<Result<Student>> {
    return Ok({ id: "stu-new", parentId } as unknown as Student);
  }
  observe(): Observable<Student[]> { return new SubjectBehavior<Student[]>([]); }
  observeByParent(): Observable<Student[]> { return new SubjectBehavior<Student[]>([]); }
  observeByClass(): Observable<Student[]> { return new SubjectBehavior<Student[]>([]); }
  observeById(): Observable<Student | null> { return new SubjectBehavior<Student | null>(null); }
  async search(): Promise<Result<Student[]>> { return Ok([]); }
  async updateStudent(): Promise<Result<Student>> { return Err(Errors.server("stub")); }
  async deleteStudent(_id?: string): Promise<Result<void>> { return Err(Errors.server("stub")); }
  async batchRegister(): Promise<Result<BatchRegistrationResult>> { return Err(Errors.server("stub")); }
  async promote(): Promise<Result<Student[]>> { return Err(Errors.server("stub")); }
  async addStudentDocument(): Promise<Result<import("../../domain/model/student").StudentDocument>> { return Err(Errors.server("stub")); }
  async removeStudentDocument(): Promise<Result<void>> { return Err(Errors.server("stub")); }
}

/** Drive the private flush with a pending batch — the t-364 harness pattern. */
async function flushWith(
  adapter: RepositoryStorageAdapter,
  pending: {
    ledger?: LedgerEntry[];
    payments?: Array<{ input: CollectPaymentInput; collectedBy: string }>;
    installments?: ImportInstallmentInput[];
  },
): Promise<void> {
  const priv = adapter as unknown as {
    pendingLedgerEntries: LedgerEntry[];
    pendingPayments: Array<{ input: CollectPaymentInput; collectedBy: string }>;
    pendingInstallments: ImportInstallmentInput[];
    flushPendingBatches(): Promise<void>;
  };
  priv.pendingLedgerEntries = pending.ledger ?? [];
  priv.pendingPayments = pending.payments ?? [];
  priv.pendingInstallments = pending.installments ?? [];
  await priv.flushPendingBatches();
}

function reimportAdapter(
  ledger: LedgerRepository,
  payments: PaymentRepository,
  installments: InstallmentRepository,
): RepositoryStorageAdapter {
  return new RepositoryStorageAdapter({
    parents: new NoopParentRepo(),
    students: new NoopStudentRepo(),
    ledger,
    payments,
    installments,
    tenantId: TENANT,
  });
}

// ── IMPORT-116: the re-import no-op ─────────────────────────────────────────

describe("T-421 / IMPORT-116 — DB-based cross-run preflight: a re-import of already-present data writes NOTHING", () => {
  it("filters the pending batch against ALL THREE streams' DB identities (clean no-op)", async () => {
    // The DB of a successful first import: the ledger carries the entries,
    // payments the IMP- receipts, installments the tranche identities.
    const ledger = new ReimportLedgerStub([ledgerEntry("stu-1:DEVIS_ANNUEL")]);
    const payments = new ReimportPaymentStub(new Set(["IMP-stu-1-FI"]));
    const installments = new ReimportInstallmentStub(new Set(["par-1|stu-1|tuition|1"]));
    const adapter = reimportAdapter(ledger, payments, installments);

    // The re-import rebuilds the SAME identities (fresh entry ids — exactly
    // what buildFinancialEntries produces for the same student).
    await flushWith(adapter, {
      ledger: [ledgerEntry("stu-1:DEVIS_ANNUEL", 239500)],
      payments: [{ input: paymentInput("IMP-stu-1-FI"), collectedBy: "excel-import" }],
      installments: [installmentInput(1)],
    });

    expect(ledger.appended).toHaveLength(0); // nothing re-appended
    expect(payments.collected).toHaveLength(0); // nothing re-collected
    expect(installments.imported).toHaveLength(0); // nothing re-imported
  });

  it("genuinely-new identities still land (first-import semantics preserved)", async () => {
    const ledger = new ReimportLedgerStub([ledgerEntry("stu-1:DEVIS_ANNUEL")]);
    const payments = new ReimportPaymentStub(new Set<string>());
    const installments = new ReimportInstallmentStub(new Set<string>());
    const adapter = reimportAdapter(ledger, payments, installments);

    await flushWith(adapter, {
      ledger: [ledgerEntry("stu-1:DEVIS_ANNUEL"), ledgerEntry("stu-2:DEVIS_ANNUEL", 180000, "stu-2")],
      payments: [{ input: paymentInput("IMP-stu-1-V2", 71500), collectedBy: "excel-import" }],
      installments: [installmentInput(2)],
    });

    // Only the genuinely-new rows went through.
    expect(ledger.appended.map((e) => e.sourceId)).toEqual(["stu-2:DEVIS_ANNUEL"]);
    expect(payments.collected.map((c) => c.input.receiptNumber)).toEqual(["IMP-stu-1-V2"]);
    expect(installments.imported.map((i) => i.trancheNumber)).toEqual([2]);
  });

  it("falls back to first-import semantics when the repository lacks the preflight methods (legacy contract)", async () => {
    // A repository WITHOUT listImportLedgerSourceKeys (the optional-method
    // contract): the flush must still write (the caller assumes a fresh DB)
    // — the t-364 within-batch/cross-batch behaviors unchanged.
    const ledger = new ReimportLedgerStub([]);
    (ledger as unknown as { listImportLedgerSourceKeys?: unknown }).listImportLedgerSourceKeys = undefined;
    const payments = new ReimportPaymentStub(new Set<string>());
    (payments as unknown as { listImportPaymentNumbers?: unknown }).listImportPaymentNumbers = undefined;
    const installments = new ReimportInstallmentStub(new Set<string>());
    (installments as unknown as { listImportInstallmentIdentities?: unknown }).listImportInstallmentIdentities = undefined;
    const adapter = reimportAdapter(ledger, payments, installments);

    await flushWith(adapter, {
      ledger: [ledgerEntry("stu-1:DEVIS_ANNUEL")],
      payments: [{ input: paymentInput("IMP-stu-1-FI"), collectedBy: "excel-import" }],
      installments: [installmentInput(1)],
    });

    expect(ledger.appended).toHaveLength(1);
    expect(payments.collected).toHaveLength(1);
    expect(installments.imported).toHaveLength(1);
  });

  it("FAILS CLOSED when a preflight read fails: no write is attempted at all (the 01:12 live shape — a mid-pagination statement timeout must not degrade to partial knowledge)", async () => {
    // The 01:12 live shape: the scheduled backup's load times the preflight
    // pagination out mid-stream. The FIRST T-421 version degraded to the
    // partial set (page 1 only) and walked the rest of the batch into the
    // 23505 — the exact failure the preflight exists to prevent. The
    // fail-closed contract: the flush aborts BEFORE any write.
    class TimingOutPayments extends ReimportPaymentStub {
      constructor() { super(new Set<string>()); }
      override async listImportPaymentNumbers(): Promise<Set<string>> {
        throw new Error(
          "listImportPaymentNumbers: la base n'a pas répondu après 3 tentatives (canceling statement due to statement timeout)",
        );
      }
    }
    const ledger = new ReimportLedgerStub([]);
    const payments = new TimingOutPayments();
    const installments = new ReimportInstallmentStub(new Set<string>());
    const adapter = reimportAdapter(ledger, payments, installments);

    await expect(
      flushWith(adapter, {
        ledger: [ledgerEntry("stu-1:DEVIS_ANNUEL")],
        payments: [{ input: paymentInput("IMP-stu-1-FI"), collectedBy: "excel-import" }],
        installments: [installmentInput(1)],
      }),
    ).rejects.toThrow(/vérification préalable \(preflight\).*statement timeout/s);

    // NOTHING was written — not even the streams whose preflight succeeded.
    expect(ledger.appended).toHaveLength(0);
    expect(payments.collected).toHaveLength(0);
    expect(installments.imported).toHaveLength(0);
  });
});

// ── IMPORT-117: the installments Result is honored ─────────────────────────

describe("T-421 / IMPORT-117 — a bulkImportInstallments Err FAILS the import (no more dropped Result)", () => {
  it("surfaces the installments failure in the thrown flush error", async () => {
    const ledger = new ReimportLedgerStub([]);
    const payments = new ReimportPaymentStub(new Set<string>());
    class ErringInstallments extends ReimportInstallmentStub {
      constructor() { super(new Set<string>()); }
      override async bulkImportInstallments(): Promise<Result<readonly Installment[]>> {
        return Err(Errors.server(
          'bulkImportInstallments chunk 0: duplicate key value violates unique constraint "installments_bulk_import_identity_idx"',
        ));
      }
    }
    const adapter = reimportAdapter(ledger, payments, new ErringInstallments());

    // The ledger and payments legs succeed — WITHOUT the fix the installments
    // Err was awaited and dropped and the flush reported SUCCESS.
    await expect(
      flushWith(adapter, {
        ledger: [ledgerEntry("stu-1:DEVIS_ANNUEL")],
        payments: [{ input: paymentInput("IMP-stu-1-FI"), collectedBy: "excel-import" }],
        installments: [installmentInput(1)],
      }),
    ).rejects.toThrow(/tranches \(1\).*installments_bulk_import_identity_idx/s);
  });
});

// ── IMPORT-118: honest partial-state reporting ──────────────────────────────

describe("T-421 / IMPORT-118 — the flush failure message states exactly what landed", () => {
  it("reports ÉTAT PARTIEL with the landed counts when earlier chunks committed (live shape: ledger 2000 landed, chunk @2000 failed)", async () => {
    class PartialLedger extends ReimportLedgerStub {
      constructor() { super([]); }
      async bulkAppendWithProgress(
        _entries: readonly LedgerEntry[],
        onProgress?: (landedRows: number) => void,
      ): Promise<Result<readonly LedgerEntry[]>> {
        // The live shape: chunks 1-4 (2,000 rows) commit, chunk @2000 dies.
        onProgress?.(2000);
        return Err(Errors.server(
          'bulkAppend chunk 2000: duplicate key value violates unique constraint "ledger_entries_source_uidx"',
        ));
      }
    }
    const ledger = new PartialLedger();
    const payments = new ReimportPaymentStub(new Set<string>());
    const installments = new ReimportInstallmentStub(new Set<string>());
    const adapter = reimportAdapter(ledger, payments, installments);

    const promise = flushWith(adapter, {
      ledger: [ledgerEntry("stu-1:DEVIS_ANNUEL")],
    });
    await expect(promise).rejects.toThrow(/ledger_entries_source_uidx/s);
    await expect(promise).rejects.toThrow(/ÉTAT PARTIEL.*2000 écriture\(s\)/s);
    await expect(promise).rejects.not.toThrow(/aucune écriture partielle/s);
  });

  it("never claims 'aucune écriture partielle' when rows landed (the disproven sentence)", async () => {
    class PartialPayments extends ReimportPaymentStub {
      constructor() { super(new Set<string>()); }
      async bulkCollectWithProgress(
        inputs: ReadonlyArray<{ input: CollectPaymentInput; collectedBy: string }>,
        onProgress?: (landedRows: number) => void,
      ): Promise<Result<readonly Payment[]>> {
        onProgress?.(1500);
        return Err(Errors.server(
          'bulkCollect: insert of payment rows 1501–2000 failed: duplicate key value violates unique constraint "payments_tenant_id_payment_number_key"',
        ));
      }
    }
    const adapter = reimportAdapter(
      new ReimportLedgerStub([]),
      new PartialPayments(),
      new ReimportInstallmentStub(new Set<string>()),
    );

    const promise = flushWith(adapter, {
      payments: [{ input: paymentInput("IMP-stu-1-FI"), collectedBy: "excel-import" }],
    });
    await expect(promise).rejects.toThrow(/ÉTAT PARTIEL/s);
    await expect(promise).rejects.not.toThrow(/aucune écriture partielle/s);
    await expect(promise).rejects.toThrow(/1500 paiement\(s\)/s);
  });

  it("a first-chunk failure (nothing landed) truthfully reports an intact base", async () => {
    class FirstChunkFailLedger extends ReimportLedgerStub {
      constructor() { super([]); }
      override async bulkAppend(): Promise<Result<readonly LedgerEntry[]>> {
        return Err(Errors.server("bulkAppend chunk 0: connection reset"));
      }
    }
    const adapter = reimportAdapter(
      new FirstChunkFailLedger(),
      new ReimportPaymentStub(new Set<string>()),
      new ReimportInstallmentStub(new Set<string>()),
    );

    await expect(
      flushWith(adapter, { ledger: [ledgerEntry("stu-1:DEVIS_ANNUEL")] }),
    ).rejects.toThrow(/état de la base est intact/s);
  });
});

// ── IMPORT-119: rollback safety + honest stats ──────────────────────────────

/** The live IMPORT-119 shape: the student snapshot is EMPTY (stale cache)
 *  but the DB already has the student — the upsert RPC matches it and
 *  returns wasInserted: false. */
class UpsertMatchStudentRepo extends NoopStudentRepo {
  readonly deleted: string[] = [];
  readonly updates: string[] = [];
  async createStudentTracked(
    parentId: string,
    input: CreateStudentInput,
  ): Promise<Result<{ student: Student; wasInserted: boolean }>> {
    // The RPC converged on the PRE-EXISTING student (out_was_inserted=false).
    return Ok({
      student: { id: "stu-PREEXISTING", parentId } as unknown as Student,
      wasInserted: false,
    });
  }
  override async createStudent(_parentId?: string): Promise<Result<Student>> {
    throw new Error("the tracked seam must be preferred when present");
  }
  override async deleteStudent(id?: string): Promise<Result<void>> {
    this.deleted.push(id ?? "?");
    return Ok(undefined);
  }
}

class UpsertMatchParentRepo extends NoopParentRepo {
  readonly deleted: string[] = [];
  async createParentTracked(
    input: CreateParentInput,
  ): Promise<Result<{ parent: Parent; wasInserted: boolean }>> {
    return Ok({ parent: { id: "par-PREEXISTING" } as Parent, wasInserted: false });
  }
  override async createParent(_input?: CreateParentInput): Promise<Result<Parent>> {
    throw new Error("the tracked seam must be preferred when present");
  }
  override async deleteParent(id?: string): Promise<Result<void>> {
    this.deleted.push(id ?? "?");
    return Ok(undefined);
  }
}

describe("T-421 / IMPORT-119 — the rollback only compensates rows the run CREATED; upsert-matches count as updates", () => {
  it("an upsert-matched student is NOT pushed into the compensation log and counts as UPDATE", async () => {
    const students = new UpsertMatchStudentRepo();
    const parents = new UpsertMatchParentRepo();
    const adapter = new RepositoryStorageAdapter({
      parents,
      students,
      tenantId: TENANT,
    });
    const etatSchema = { name: "etat" } as unknown as Parameters<typeof adapter.upsertRecordsBatch>[0];
    const results = await adapter.upsertRecordsBatch(
      etatSchema,
      [{ record: { nem: "0555123456", nom: "AMARA AMINE" }, rowIndex: 5 }],
      ["nem"],
      "run-t421-a",
    );

    // Honest stats: the upsert matched a pre-existing student → UPDATE.
    expect(results[0]?.action).toBe("update");

    // The compensation log must NOT contain the pre-existing id.
    const createdIds = (adapter as unknown as { createdStudentIds: string[] }).createdStudentIds;
    expect(createdIds).not.toContain("stu-PREEXISTING");
    expect((adapter as unknown as { createdParentIds: string[] }).createdParentIds).not.toContain("par-PREEXISTING");

    // And a subsequent rollback deletes NOTHING (the run created nothing).
    await adapter.rollbackTransaction();
    expect(students.deleted).toHaveLength(0);
    expect(parents.deleted).toHaveLength(0);
  });

  it("a truly-created student IS compensated on rollback (the VAULT §14.02 contract unchanged)", async () => {
    class InsertingStudentRepo extends NoopStudentRepo {
      readonly deleted: string[] = [];
      async createStudentTracked(
        parentId: string,
      ): Promise<Result<{ student: Student; wasInserted: boolean }>> {
        return Ok({
          student: { id: "stu-NEW", parentId } as unknown as Student,
          wasInserted: true,
        });
      }
      override async deleteStudent(id?: string): Promise<Result<void>> {
        this.deleted.push(id ?? "?");
        return Ok(undefined);
      }
    }
    const students = new InsertingStudentRepo();
    const adapter = new RepositoryStorageAdapter({
      parents: new NoopParentRepo(),
      students,
      tenantId: TENANT,
    });
    const etatSchema = { name: "etat" } as unknown as Parameters<typeof adapter.upsertRecordsBatch>[0];
    const results = await adapter.upsertRecordsBatch(
      etatSchema,
      [{ record: { nem: "0555123456", nom: "AMARA AMINE" }, rowIndex: 5 }],
      ["nem"],
      "run-t421-b",
    );
    expect(results[0]?.action).toBe("insert");
    await adapter.rollbackTransaction();
    expect(students.deleted).toEqual(["stu-NEW"]);
  });
});
