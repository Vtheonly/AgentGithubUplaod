/**
 * Repository-backed storage adapter.
 *
 * Bridges the standalone `ImportEngine` to the project's domain
 * repositories. When the engine calls `upsertRecord()` for an ETAT row,
 * this adapter translates the generic record into `CreateParentInput` +
 * `CreateStudentInput` and delegates to `ParentRepository` +
 * `StudentRepository`. This is the missing link that caused the Excel
 * import to silently lose every imported student (the default
 * `InMemoryAdapter` only stored records in an isolated Map).
 *
 * Design notes:
 *  - The adapter depends only on the repository INTERFACES — it works
 *    equally against the mock layer and the Supabase layer. This keeps
 *    the engine testable without React or Supabase.
 *  - Identity for ETAT rows: NEM (parent phone) first; when NEM is
 *    blank, fall back to tuteur name; when both blank, synthesize a
 *    placeholder parent so the student still imports.
 *  - Re-imports are idempotent: an existing parent (matched by phone)
 *    gets its students upserted rather than duplicated.
 *  - The adapter tracks every row it inserts in this run, so
 *    `listInsertedForRun(runId)` can feed the sync queue.
 */
import type { ImportSchema, ImportRecord, UpsertResult } from "../types";
import type { ImportContext } from "../import-context";
import { objectChecksum } from "../utils/checksum";
import { StorageAdapter, type StorageRecord, type RunAuditEntry, type BatchUpsertRow, type BatchProgressCallback, type RollbackOutcome } from "./storage-adapter";
import { uuid } from "../utils/id";
import type { ParentRepository, StudentRepository, LedgerRepository, PaymentRepository, InstallmentRepository, ImportInstallmentInput } from "../../../../domain/repository/repository";
import type { Parent, CreateParentInput, TransportDestination } from "../../../../domain/model/parent";
import { IMPORTED_BIRTH_DATE_PLACEHOLDER, type CreateStudentInput, type Student } from "../../../../domain/model/student";
import type { LedgerEntry } from "../../../../domain/model/ledger";
import type { Payment, Installment, PaymentCategory, AcademicCycle, CollectPaymentInput } from "../../../../domain/model/payment";
import { createChargeEntry, createPaymentEntry, createAdjustmentEntry } from "../../../../domain/calc/ledger/entries";
import { mapNiveauCode, resolveGradeFromClasse, isAutisteTrack } from "../mappers/niveau-mapper";
import { splitFullName } from "../mappers/name-splitter";
import { mapExcelDestinationToCanonical } from "../mappers/destination-mapper";
import {
  REAL_TRANSPORT_MATRIX,
  REAL_TUITION_BY_GRADE,
  REAL_FI_BY_GRADE,
  REAL_TUITION_AUTISTE,
  REAL_FI_AUTISTE,
} from "../../../../domain/calc/pricing/school-price-matrix";

export interface RepositoryStorageAdapterDeps {
  readonly parents: ParentRepository;
  readonly students: StudentRepository;
  /** Optional — when provided, the adapter writes charge/payment/adjustment
   * ledger entries for each ETAT row's financial fields. Without a ledger,
   * financial data (DEVIS ANNUEL, DETTES, REMISE, REGLEMENTS) is captured
   * in the import context but not persisted. */
  readonly ledger?: LedgerRepository;
  /**
   * Optional — when provided, the adapter writes a `payments` row for each
   * payment-type ledger entry (FI, V2, v3, T1, T2, T3, PSY1, etc.).
   * Without a payments repo, payment history is captured in the ledger but
   * NOT in the `payments` table — the student payments tab reads from
   * `payments` and would show "no payment history" without this.
   */
  readonly payments?: PaymentRepository;
  /**
   * Optional — when provided, the adapter writes `installments` rows for
   * each tuition tranche (Sept 15 / Dec 15 / Mar 15) and each transport
   * tranche, marking them paid/partial/unpaid according to the imported
   * amounts. Without an installments repo, the installment schedule tab
   * would show "no tranches" even though the payments exist.
   */
  readonly installments?: InstallmentRepository;
  readonly tenantId: string;
  readonly actorId?: string;
  readonly actorName?: string;
  /**
   * PERF-503 (T-417): maximum number of concurrently-running family write
   * tasks during a batch import (default 8 — comfortably under typical
   * browser/Electron per-host HTTP limits while HTTP/2 multiplexing makes
   * Supabase unaffected). 1 = fully sequential (the legacy behavior —
   * useful for deterministic debugging).
   *
   * Concurrency is scoped to INDEPENDENT families: all rows of one family
   * (one parent + its students) are processed strictly in row order inside
   * their own task, so intra-family semantics (parent create-once, sibling
   * identity resolution, duplicate-row update chains) are byte-identical
   * to the sequential importer.
   */
  readonly importConcurrency?: number;
}

/**
 * The kind of domain entity that was resolved for an inserted row.
 * The sync queue dispatcher uses this to route the row to the correct
 * `upsert_*_from_import` RPC (migration 0027).
 */
export type InsertedEntityKind = "parent" | "student" | "ledger_entry" | "payment" | "installment" | "raw";

/**
 * A row inserted during an import run, together with the resolved domain
 * entities (Parent / Student / LedgerEntry / Payment / Installment) that
 * were created or updated.
 *
 * The `record` field preserves the raw ImportRecord (French Excel fields)
 * for audit + reporting. The `entities` field carries the canonical domain
 * objects the sync queue needs to push to Supabase.
 *
 * CRITICAL: the sync queue's `defaultPushHandler` reads fields like
 * `firstName`, `lastName`, `displayName`, `parentId`, `amount`, etc. directly
 * off `payload`. Those fields live on the domain entities (Parent / Student /
 * LedgerEntry / Payment / Installment), NOT on the raw ImportRecord. Without
 * this `entities` field, the sync queue would receive a payload shaped like
 * `{ nom, nem, tuteur, ... }` and every RPC call would fail silently with
 * `p_first_name = undefined`.
 */
export interface InsertedRow {
  readonly id: string;
  readonly schemaName: string;
  readonly runId: string;
  readonly record: ImportRecord;
  readonly identity: Record<string, string | number>;
  readonly checksum: string;
  readonly insertedAt: string;
  /** Resolved domain entities for the sync queue. May be empty for non-ETAT schemas. */
  readonly entities: ReadonlyArray<{ kind: InsertedEntityKind; entity: Parent | Student | LedgerEntry | Payment | Installment }>;
}

function formatErrorMessage(err: unknown): string {
  if (!err) return "Unknown error";
  if (typeof err === "string") return err;
  if (typeof err === "object") {
    const obj = err as Record<string, unknown>;
    let msg = "";
    if (typeof obj.message === "string" && obj.message && obj.message !== "[object Object]") {
      msg = obj.message;
    } else if (typeof obj.userMessage === "string" && obj.userMessage) {
      msg = obj.userMessage;
    }
    if (obj.cause && typeof obj.cause === "object") {
      const causeStr = formatErrorMessage(obj.cause);
      if (causeStr && causeStr !== msg && causeStr !== "[object Object]") {
        msg = msg ? `${msg} (${causeStr})` : causeStr;
      }
    } else if (obj.details && typeof obj.details === "string") {
      msg = msg ? `${msg} — ${obj.details}` : obj.details;
    } else if (obj.hint && typeof obj.hint === "string") {
      msg = msg ? `${msg} — ${obj.hint}` : obj.hint;
    }
    if (msg) return msg;
    try {
      const json = JSON.stringify(err);
      if (json && json !== "{}") return json;
    } catch {
      /* ignore */
    }
  }
  return String(err);
}

export class RepositoryStorageAdapter extends StorageAdapter {
  private readonly deps: RepositoryStorageAdapterDeps;
  private readonly rowsByRun: Map<string, InsertedRow[]> = new Map();
  private readonly runs: Map<string, RunAuditEntry> = new Map();
  private initialized = false;
  /** The runId of the import currently in progress — used to tag errors. */
  private currentRunId: string | null = null;
  /** PERF-503 (T-417): bounded-concurrency limit for batch writes. */
  private readonly importConcurrency: number;

  /**
   * BULK IMPORT SPEED FIX: Batch buffers for deferred bulk writes.
   *
   * Instead of writing each ledger entry / payment / installment one-by-one
   * (18,000 RPC calls for a 390-row workbook), we collect them in these
   * buffers during `upsertEtatRecord`, then flush them all at once in
   * `commitTransaction` using the bulk methods (`bulkAppend`, `bulkCollect`,
   * `bulkImportInstallments`). This turns 18,000 RPCs into ~3 INSERT calls.
   */
  private pendingLedgerEntries: LedgerEntry[] = [];
  private pendingPayments: Array<{ input: CollectPaymentInput; collectedBy: string }> = [];
  private pendingInstallments: ImportInstallmentInput[] = [];
  /**
   * VAULT §14.02 — atomicity compensation log: parent/student ids CREATED
   * during the current run. If the run fails, `rollbackTransaction`
   * compensates by deleting them (students first, then parents) so NO
   * partial import ever persists. Previously parents/students were written
   * row-by-row immediately and a later failure left them orphaned.
   */
  private createdStudentIds: string[] = [];
  private createdParentIds: string[] = [];
  /** Progress callback — called after each row is processed. */
  progressCallback: ((processed: number, total: number, currentRow: string) => void) | null = null;

  constructor(deps: RepositoryStorageAdapterDeps) {
    super();
    this.deps = deps;
    this.importConcurrency = Math.max(1, Math.floor(deps.importConcurrency ?? 8));
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
  }

  /** IMPORT-114 (T-420): the outcome of the last rollback — surfaced by the
   * engine so a partial compensation is never silent. */
  private lastRollbackOutcome: RollbackOutcome | null = null;

  async beginTransaction(): Promise<void> {
    // Clear the batch buffers + the compensation log at the start of a run.
    this.pendingLedgerEntries = [];
    this.pendingPayments = [];
    this.pendingInstallments = [];
    this.createdStudentIds = [];
    this.createdParentIds = [];
    this.lastRollbackOutcome = null;
  }

  async commitTransaction(): Promise<void> {
    // BULK IMPORT SPEED FIX: Flush all pending writes in bulk.
    await this.flushPendingBatches();
    // The run succeeded — the created parents/students are now permanent.
    this.createdStudentIds = [];
    this.createdParentIds = [];
  }

  /**
   * Flush all pending ledger entries, payments, and installments using
   * the bulk methods. Called once at the end of the import (in
   * `commitTransaction`). This is the key optimization that turns
   * 18,000 individual RPC calls into ~3 bulk INSERT calls.
   *
   * FIX (silent data loss): bulk flush failures were previously swallowed
   * with `console.warn` and the import still reported SUCCESS — financial
   * data (ledger entries / payments / installments) could silently vanish.
   * Since the pipeline is documented as atomic ("BEGIN…COMMIT — tout réussit
   * ou tout échoue"), a flush failure now FAILS the import with a clear
   * message so the user knows nothing was silently dropped.
   */
  private async flushPendingBatches(): Promise<void> {
    const failures: string[] = [];
    // Flush ledger entries.
    if (this.pendingLedgerEntries.length > 0 && this.deps.ledger) {
      // IMPORT-107 (re-import idempotency): the canonical identity of an
      // imported ledger entry is (tenant, source_type, source_id) — the
      // migration-0027 `upsert_ledger_entry_from_import` contract, enforced
      // live by the `ledger_entries_source_uidx` unique index. The DIRECT
      // repository flush (bulkAppend / appendMany) used to skip that
      // contract entirely: every re-import re-appended the ENTIRE financial
      // history (mock: the local ledger doubled — every charge and payment,
      // so every dashboard balance doubled; Supabase: the unique index
      // rejected every chunk and the error was swallowed). Dedupe the
      // pending batch against the CURRENT ledger stream first so a
      // re-import of the same file is a no-op, exactly like the RPC path.
      const existingKeys = this.collectExistingImportLedgerKeys();
      const newLedgerEntries = this.pendingLedgerEntries.filter(
        (e) => e.sourceType == null || e.sourceId == null || !existingKeys.has(`${e.sourceType}|${e.sourceId}`),
      );
      if (newLedgerEntries.length > 0) {
        try {
          const result =
            typeof this.deps.ledger.bulkAppend === "function"
              ? await this.deps.ledger.bulkAppend(newLedgerEntries)
              : await this.deps.ledger.appendMany(newLedgerEntries);
          // A silent Err here would resurrect the exact silent-partial-
          // application defect the atomic contract forbids (the same
          // T-012 fix applied to bulkCollect) — honour the Result.
          if (result && result.ok === false) {
            failures.push(
              `écritures du journal (${newLedgerEntries.length}): ${result.error?.message ?? "erreur inconnue"}`,
            );
          }
        } catch (e) {
          failures.push(
            `écritures du journal (${newLedgerEntries.length}): ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
      this.pendingLedgerEntries = [];
    }
    // Flush payments.
    if (this.pendingPayments.length > 0 && this.deps.payments) {
      try {
        if (typeof this.deps.payments.bulkCollect === "function") {
          const bulk = await this.deps.payments.bulkCollect(this.pendingPayments);
          // T-012 (BUSINESS-100): bulkCollect now fails fast and returns Err
          // instead of Ok(partial). Honour the Result so the import transaction
          // is canceled — a swallowed Err here would resurrect the exact
          // silent-partial-application defect this contract forbids.
          if (bulk && bulk.ok === false) {
            failures.push(`paiements (${this.pendingPayments.length}): ${bulk.error?.message ?? "erreur inconnue"}`);
          }
        } else {
          for (const { input, collectedBy } of this.pendingPayments) {
            await this.deps.payments.collect(input, collectedBy);
          }
        }
      } catch (e) {
        failures.push(
          `paiements (${this.pendingPayments.length}): ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      this.pendingPayments = [];
    }
    // Flush installments.
    if (this.pendingInstallments.length > 0 && this.deps.installments) {
      try {
        if (typeof this.deps.installments.bulkImportInstallments === "function") {
          await this.deps.installments.bulkImportInstallments(this.pendingInstallments);
        } else {
          for (const input of this.pendingInstallments) {
            await this.deps.installments.importInstallment(input);
          }
        }
      } catch (e) {
        failures.push(
          `tranches (${this.pendingInstallments.length}): ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      this.pendingInstallments = [];
    }
    if (failures.length > 0) {
      throw new Error(
        `Échec de l'écriture en base (flush bulk) — ${failures.join(" ; ")}. ` +
          "L'import a été annulé : aucune donnée financière n'a été partiellement appliquée en silence.",
      );
    }
  }

  async rollbackTransaction(): Promise<void> {
    // VAULT §14.02 — compensating rollback: "If any row fails validation,
    // the ENTIRE import rolls back via atomic transaction. No partial
    // imports." Parents/students were inserted row-by-row during the run;
    // reverse them (students BEFORE parents — parents with children cannot
    // be deleted) so the database returns to its pre-import state.
    //
    // IMPORT-114 (T-420): the deletes stay BEST-EFFORT (a dead pool must not
    // stop us compensating the rows it can still reach), but every failure
    // is now COUNTED and exposed via getRollbackOutcome() — the engine
    // appends an explicit partial-state warning to the thrown error so the
    // user knows the database is inconsistent (live evidence: the issue-#20
    // rollback died partway — 384 soft-deletes landed, 463 students from
    // the "failed" import survived — and the user was told the import had
    // been annulled).
    let studentsDeleted = 0;
    let failedStudents = 0;
    for (const studentId of this.createdStudentIds.reverse()) {
      try {
        await this.deps.students.deleteStudent(studentId);
        studentsDeleted++;
      } catch {
        // Best-effort compensation — count and continue with the rest.
        failedStudents++;
      }
    }
    let parentsDeleted = 0;
    let failedParents = 0;
    for (const parentId of this.createdParentIds.reverse()) {
      try {
        await this.deps.parents.deleteParent(parentId);
        parentsDeleted++;
      } catch {
        // Best-effort compensation.
        failedParents++;
      }
    }
    this.lastRollbackOutcome = { studentsDeleted, parentsDeleted, failedStudents, failedParents };
    // Clear the batch buffers + per-run insertion log on rollback.
    this.pendingLedgerEntries = [];
    this.pendingPayments = [];
    this.pendingInstallments = [];
    this.createdStudentIds = [];
    this.createdParentIds = [];
    this.rowsByRun.clear();
  }

  /** IMPORT-114 (T-420): what the last rollback actually achieved. */
  getRollbackOutcome(): RollbackOutcome | null {
    return this.lastRollbackOutcome;
  }

  async upsertRecord(
    schema: ImportSchema,
    record: ImportRecord,
    identityKeys: readonly string[],
    runId: string,
  ): Promise<UpsertResult> {
    // PERF-503 (T-417): the single-row entry point delegates to the batch
    // seam with one row — ONE row-processing implementation for both entry
    // points (the §9 no-parallel-implementations rule). The rowIndex is
    // recovered exactly the way the legacy per-row error paths did
    // (record.__rowIndex, defaulting to 0).
    const rowIndex =
      typeof (record as { __rowIndex?: number }).__rowIndex === "number"
        ? (record as { __rowIndex: number }).__rowIndex
        : 0;
    const results = await this.upsertRecordsBatch(
      schema,
      [{ record, rowIndex }],
      identityKeys,
      runId,
    );
    return results[0] ?? { action: "skip" };
  }

  /**
   * PERF-503 (T-417) — the batch upsert.
   *
   * Non-ETAT schemas (BON, Devis, REF) keep the per-row tracked upsert
   * (in-memory, instant — no optimization needed or possible).
   *
   * ETAT rows go through `upsertEtatBatch`, which replaces the legacy
   * ~1,026 per-row `search()` round trips with TWO snapshot reads +
   * in-memory identity resolution, and replaces the sequential per-row
   * createParent/createStudent/updateStudent awaits with a bounded-
   * concurrency pool over INDEPENDENT families. Within one family the
   * per-row sequence is byte-identical to the legacy importer:
   *
   *   1. ensureParent — find (phone → email → placeholder multi-pronged
   *      match, incl. the "Tuteur" legacy format) or create; on create
   *      failure record the row error and SKIP the row (the NEXT row of
   *      the same family retries the create with its own input — the
   *      legacy retry semantics);
   *   2. findExistingStudent — the IMPORT-109 EXACT match (parentId +
   *      displayName, then parentId + exact first/last name), so a
   *      re-import UPDATES instead of duplicating;
   *   3. createStudent / updateStudent (with the legacy update-failure
   *      fallback that still lands financial rows against the existing
   *      student);
   *   4. the deferred financial buffers (ledger / payments / installments
   *      — flushed in `commitTransaction` by the bulk methods, unchanged).
   *
   * The returned results are in INPUT ROW ORDER regardless of completion
   * order, so the engine's counters and per-row events are identical to
   * the sequential path's.
   */
  async upsertRecordsBatch(
    schema: ImportSchema,
    rows: ReadonlyArray<BatchUpsertRow>,
    identityKeys: readonly string[],
    runId: string,
    onProgress?: BatchProgressCallback,
  ): Promise<UpsertResult[]> {
    this.currentRunId = runId;
    if (schema.name !== "etat") {
      const results: UpsertResult[] = [];
      for (const { record } of rows) {
        results.push(await this.upsertTrackedRecord(schema, record, identityKeys, runId));
      }
      return results;
    }
    return this.upsertEtatBatch(rows, runId, onProgress);
  }

  // ── PERF-503 (T-417): the ETAT batch machinery ────────────────────────

  private async upsertEtatBatch(
    rows: ReadonlyArray<BatchUpsertRow>,
    runId: string,
    onProgress?: BatchProgressCallback,
  ): Promise<UpsertResult[]> {
    // Phase 0 — ONE snapshot of each identity store (2 search calls total,
    // replacing the legacy per-row storm: measured 636 parent searches +
    // 390 student searches for the real 390-row workbook).
    //
    // search("") returns the FULL list in both repository layers (mock:
    // the whole store; Supabase: the seeded in-memory cache), and every
    // legacy find predicate was EXACT equality over that list — so an
    // in-memory filter over the snapshot is result-identical to the
    // per-row search+find. A failing snapshot read degrades to an empty
    // list, which is the same fallback shape the legacy per-row search
    // Err path produced (find fails → create path).
    const [parentsSnapshot, studentsSnapshot] = await Promise.all([
      this.snapshotParents(),
      this.snapshotStudents(),
    ]);

    // Students grouped per parent (search("") order preserved — the order
    // the per-row repository search would have returned them in).
    const studentsByParent = new Map<string, Student[]>();
    for (const s of studentsSnapshot) {
      const list = studentsByParent.get(s.parentId) ?? [];
      list.push(s);
      studentsByParent.set(s.parentId, list);
    }

    // Phase 1 — sequential pre-resolution (in-memory, no awaits): group
    // rows into families. This MUST be sequential because a family's
    // existence depends on every earlier row's resolution (a later row
    // with the same phone joins the family the earlier row created — the
    // legacy sequential semantics, preserved without the round trips).
    //
    // Index ordering: entries are PREPENDED (newest first), mirroring how
    // both repository layers surface created rows in search results —
    // snapshot parents are seeded first, run intents are prepended as
    // rows register them.
    const parentIndex = new BatchParentIndex((parent) => {
      // Lazy family construction for a pre-existing parent: resolved + its
      // snapshot students (the exact candidates the legacy per-row
      // findExistingStudent searched).
      const existingFamily: EtatFamily = {
        pendingInput: null,
        resolvedParent: parent,
        snapshotStudents: studentsByParent.get(parent.id) ?? [],
        createdStudents: [],
        rowTaskIndexes: [],
      };
      return existingFamily;
    });
    // Seed the index with EVERY pre-existing parent — the batch-time
    // equivalent of the legacy per-row `findExistingParent` search space.
    for (const parent of parentsSnapshot) {
      parentIndex.addExisting(parent);
    }

    const families: EtatFamily[] = [];
    const seen = new Set<EtatFamily>();
    const track = (family: EtatFamily): EtatFamily => {
      if (!seen.has(family)) {
        seen.add(family);
        families.push(family);
      }
      return family;
    };
    const rowTasks: EtatRowTask[] = rows.map(({ record, rowIndex }) => ({
      record,
      rowIndex,
      studentInput: null as unknown as CreateStudentInput,
      action: "skip" as "insert" | "update" | "skip",
    }));

    for (let i = 0; i < rowTasks.length; i++) {
      const task = rowTasks[i];
      const parentInput = this.buildParentInput(task.record);
      task.studentInput = this.buildStudentInput(task.record);
      // resolveFamilyFor lazily binds a snapshot family on first match —
      // track() registers EVERY family that carries rows, whether it came
      // from the snapshot (lazily created) or from a new create intent.
      let family = parentIndex.resolveFamilyFor(parentInput);
      if (!family) {
        family = track({
          pendingInput: parentInput,
          resolvedParent: null,
          snapshotStudents: [],
          createdStudents: [],
          rowTaskIndexes: [],
        });
        parentIndex.registerIntent(parentInput, family);
      } else {
        track(family);
      }
      family.rowTaskIndexes.push(i);
    }

    // Phase 2 — bounded-concurrency pool over INDEPENDENT families (only
    // families that actually carry rows — snapshot-only parents are no-ops).
    const runnable = families.filter((f) => f.rowTaskIndexes.length > 0);
    const total = rowTasks.length;
    let written = 0;
    const reportProgress = (): void => {
      const done = ++written;
      if (onProgress) onProgress(done, total, "");
    };

    await runPool(runnable, this.importConcurrency, async (family) => {
      await this.processEtatFamily(family, rowTasks, runId, reportProgress);
    });

    // Errors recorded by concurrent tasks interleave in completion order;
    // sort by rowIndex so "Première erreur" in the modal names the
    // LOWEST failing row — the same row the sequential path would have
    // reported first.
    this.sortRunErrorsByRowIndex(runId);
    this.emitThrottledImportErrorLogs(runId);

    return rowTasks.map((t) => ({ action: t.action }));
  }

  /**
   * Process ONE family's rows in row order — the legacy per-row sequence
   * (ensureParent → findExistingStudent → create/update → financial
   * buffering → entity tracking), with the identity lookups served from
   * the family's in-memory indexes instead of repository searches.
   */
  private async processEtatFamily(
    family: EtatFamily,
    rowTasks: readonly EtatRowTask[],
    runId: string,
    onRowDone: () => void,
  ): Promise<void> {
    for (const taskIndex of family.rowTaskIndexes) {
      const task = rowTasks[taskIndex];
      const { record } = task;

      // ── ensureParent (legacy semantics, index-backed) ──────────────
      let parent: Parent | null = family.resolvedParent;
      if (!parent && !family.pendingInput) {
        // A snapshot-matched family always has resolvedParent — unreachable
        // guard kept for structural safety.
        this.recordRowError(runId, task, "Parent resolution failed (no family parent)");
        task.action = "skip";
        onRowDone();
        continue;
      }
      if (!parent) {
        // First row of a new family (or a retry after an earlier create
        // failure — the legacy per-row retry semantics): create with THIS
        // row's own input.
        const input = family.pendingInput ?? this.buildParentInput(record);
        const result = await this.deps.parents.createParent(input);
        if (!result.ok) {
          // Same per-row error recording as the legacy ensureParent: the
          // row is skipped, the NEXT row of this family retries.
          const errMsg = formatErrorMessage(result.error);
          this.recordRowError(
            runId,
            task,
            errMsg,
            input.displayName ?? input.phone ?? input.lastName ?? "(unknown)",
          );
          task.action = "skip";
          onRowDone();
          continue;
        }
        parent = result.value;
        family.resolvedParent = parent;
        family.pendingInput = null;
        // VAULT §14.02 — record the created parent for compensating rollback.
        this.createdParentIds.push(result.value.id);
      }

      // ── findExistingStudent (IMPORT-109 EXACT match, family-scoped) ─
      const studentInput: CreateStudentInput = task.studentInput;
      const existing = this.findStudentInFamily(family, parent, studentInput);

      let action: "insert" | "update" | "skip";
      let studentId: string | null = null;
      let resolvedStudent: Student | null = null;
      if (existing) {
        // Actually call updateStudent() so changes to grade level,
        // transport tier, class assignment, etc. propagate on re-import
        // (preserved verbatim from the legacy path).
        const updateResult = await this.deps.students.updateStudent(existing.id, {
          firstName: studentInput.firstName,
          lastName: studentInput.lastName,
          displayName: studentInput.displayName,
          level: studentInput.level,
          gradeYear: studentInput.gradeYear,
          gradeLevel: studentInput.gradeLevel,
          classId: studentInput.classId,
          medicalNotes: studentInput.medicalNotes,
          transportTier: studentInput.transportTier,
        });
        if (updateResult.ok) {
          action = "update";
          studentId = updateResult.value.id;
          resolvedStudent = updateResult.value;
        } else {
          // Update failed — fall back to the existing ID so financial
          // entries still land against the right student (legacy behavior).
          action = "update";
          studentId = existing.id;
          resolvedStudent = existing;
        }
      } else {
        const result = await this.deps.students.createStudent(parent.id, studentInput);
        if (!result.ok) {
          // Surface the student creation error (legacy pattern).
          const errMsg = formatErrorMessage(result.error);
          const identity =
            studentInput.displayName ?? `${studentInput.firstName} ${studentInput.lastName}`;
          this.recordRowError(runId, task, `Student creation failed: ${errMsg}`, identity);
          task.action = "skip";
          onRowDone();
          continue;
        }
        action = "insert";
        studentId = result.value.id;
        resolvedStudent = result.value;
        family.createdStudents.unshift(result.value);
        // VAULT §14.02 — record the created student for compensating rollback.
        this.createdStudentIds.push(result.value.id);
      }

      // ── deferred financial buffers (BULK IMPORT SPEED FIX, unchanged) ─
      let ledgerEntries: LedgerEntry[] = [];
      if (this.deps.ledger && studentId) {
        ledgerEntries = this.buildFinancialEntries(record, parent.id, studentId, runId);
        this.pendingLedgerEntries.push(...ledgerEntries);
      }
      let paymentRows: Payment[] = [];
      if (this.deps.payments && studentId) {
        paymentRows = this.buildPaymentRows(record, parent.id, studentId, runId);
        for (const p of paymentRows) {
          this.pendingPayments.push({
            input: {
              parentId: p.parentId,
              studentId: p.studentId,
              amount: p.amount,
              method: p.method,
              category: p.category,
              installmentId: p.installmentId,
              notes: p.notes,
              receiptNumber: p.receiptNumber,
              collectedAt: p.collectedAt,
            },
            collectedBy: this.deps.actorId ?? "excel-import",
          });
        }
      }
      let installmentRows: Installment[] = [];
      if (this.deps.installments && studentId) {
        installmentRows = this.buildInstallmentRows(record, parent.id, studentId, resolvedStudent, runId);
        for (const inst of installmentRows) {
          // Tranche number is parsed from the deterministic id
          // (`imp-…-<category>-T<n>`) — NOT from the label: the BON labels
          // ("2EME TRANCHE (V2)"…) are uppercase and would never match the
          // old `/Tranche (\d)/` regex, silently collapsing every tuition
          // installment onto tranche 1 (the T-105 C3 regression).
          const trancheNum = Number(/-T(\d)$/.exec(inst.id)?.[1] ?? "1") as 1 | 2 | 3 | 4;
          this.pendingInstallments.push({
            parentId: inst.parentId,
            studentId: inst.studentId ?? studentId,
            category: inst.category,
            trancheNumber: trancheNum,
            label: inst.label,
            amountDue: inst.amountDue,
            amountPaid: inst.amountPaid,
            dueDate: inst.dueDate,
            paidDate: inst.paidDate,
            status: inst.status as "unpaid" | "partial" | "paid" | "overdue" | "pending_clearance",
            academicCycle: inst.academicCycle,
            paymentPlan: inst.paymentPlan,
            sourceType: "bulk_import",
            sourceId: `imp-${inst.studentId ?? studentId}-${inst.category}-T${trancheNum}`,
            actorId: this.deps.actorId,
            actorName: this.deps.actorName,
          });
        }
      }

      // Notify progress callbacks if registered (real counts — the legacy
      // vestige passed (0, 0, name)).
      if (this.progressCallback) {
        this.progressCallback(0, 0, String(record.nom ?? ""));
      }

      // ── resolved-entities list for the sync queue (unchanged shape) ──
      const entities: Array<{
        kind: InsertedEntityKind;
        entity: Parent | Student | LedgerEntry | Payment | Installment;
      }> = [{ kind: "parent", entity: parent }];
      if (resolvedStudent) {
        entities.push({ kind: "student", entity: resolvedStudent });
      }
      for (const le of ledgerEntries) {
        entities.push({ kind: "ledger_entry", entity: le });
      }
      for (const p of paymentRows) {
        entities.push({ kind: "payment", entity: p });
      }
      for (const i of installmentRows) {
        entities.push({ kind: "installment", entity: i });
      }
      this.trackInsertedRow("etat", record, ["NEM", "NOM"], runId, entities);
      task.action = action;
      onRowDone();
    }
  }

  /**
   * IMPORT-109 EXACT match, family-scoped: parentId + displayName first,
   * then parentId + exact (firstName, lastName). The candidate list is
   * [created-in-this-family (newest first), …snapshot students of the
   * parent] — the same order the repository search would return (both
   * layers PREPEND created rows).
   */
  private findStudentInFamily(
    family: EtatFamily,
    parent: Parent,
    input: CreateStudentInput,
  ): Student | null {
    const candidates: Student[] = [...family.createdStudents, ...family.snapshotStudents];
    const byDisplayName = candidates.find(
      (s) =>
        s.parentId === parent.id &&
        input.displayName != null &&
        s.displayName === input.displayName,
    );
    if (byDisplayName) return byDisplayName;
    return (
      candidates.find(
        (s) =>
          s.parentId === parent.id &&
          s.firstName === input.firstName &&
          s.lastName === input.lastName,
      ) ?? null
    );
  }

  /** One snapshot read of the parents store — Err degrades to []. */
  private async snapshotParents(): Promise<Parent[]> {
    try {
      const result = await this.deps.parents.search("");
      return result.ok ? result.value : [];
    } catch {
      return [];
    }
  }

  /** One snapshot read of the students store — Err degrades to []. */
  private async snapshotStudents(): Promise<Student[]> {
    try {
      const result = await this.deps.students.search("");
      return result.ok ? result.value : [];
    } catch {
      return [];
    }
  }

  /**
   * Record a per-row error (the legacy errorsByRun surface, unchanged
   * shape — { rowIndex, identity, error }).
   */
  private recordRowError(
    runId: string,
    task: EtatRowTask,
    error: string,
    identity?: string,
  ): void {
    const list = this.errorsByRun.get(runId) ?? [];
    list.push({ rowIndex: task.rowIndex, identity: identity ?? "(unknown)", error });
    this.errorsByRun.set(runId, list);
  }

  /** Sort a run's collected errors by rowIndex (row-order reporting parity). */
  private sortRunErrorsByRowIndex(runId: string): void {
    const list = this.errorsByRun.get(runId);
    if (list && list.length > 1) {
      list.sort((a, b) => a.rowIndex - b.rowIndex);
    }
  }

  /**
   * The throttled console logging the legacy per-row path performed
   * inline — only the FIRST parent-class and FIRST student-class failure
   * of the run log the full error (flooding the console with 390 identical
   * errors makes DevTools unusable). Because concurrent tasks complete
   * out of order, the throttle is applied AFTER the row-order sort, so
   * "first" means the lowest failing row — the same row the sequential
   * path logged.
   */
  private emitThrottledImportErrorLogs(runId: string): void {
    const list = this.errorsByRun.get(runId) ?? [];
    const firstParent = list.find((e) => !e.error.startsWith("Student creation failed"));
    if (firstParent) {
      // eslint-disable-next-line no-console
      console.error(
        `[ExcelImport] Parent creation FAILED for row ${firstParent.rowIndex} (${firstParent.identity}): ${firstParent.error}`,
      );
      // eslint-disable-next-line no-console
      console.warn(
        `[ExcelImport] Further parent creation failures in this run will be ` +
          `collected silently and shown in the modal. Run ID: ${runId}`,
      );
    }
    const firstStudent = list.find((e) => e.error.startsWith("Student creation failed"));
    if (firstStudent) {
      // eslint-disable-next-line no-console
      console.error(
        `[ExcelImport] Student creation FAILED for row ${firstStudent.rowIndex} (${firstStudent.identity}): ${firstStudent.error}`,
      );
    }
  }

  async insertRecord(table: string, record: ImportRecord): Promise<UpsertResult> {
    // Reference tables (REF schema) are not persisted as domain entities.
    // They are tracked for audit + reporting only.
    return { action: "insert" };
  }

  async saveAuditRun(context: ImportContext): Promise<void> {
    const status: RunAuditEntry["status"] =
      context.stats.rowsRejected > 0
        ? context.stats.rowsImported > 0
          ? "partial"
          : "failed"
        : "success";
    this.runs.set(context.runId, {
      runId: context.runId,
      filePath: context.filePath,
      fileChecksum: context.fileChecksum,
      fileSize: context.fileSize,
      startedAt: context.startedAt.toISOString(),
      finishedAt: context.finishedAt ? context.finishedAt.toISOString() : null,
      durationMs: context.durationMs,
      options: context.options as Record<string, unknown>,
      source: context.source as Record<string, unknown>,
      stats: context.stats,
      sheetResults: context.sheetResults,
      errors: context.errors,
      warnings: context.warnings,
      status,
    });
  }

  async listRecords(_schemaName: string): Promise<StorageRecord[]> {
    return [];
  }

  async listRefRecords(_table: string): Promise<StorageRecord[]> {
    return [];
  }

  async listRuns(): Promise<RunAuditEntry[]> {
    return Array.from(this.runs.values()).sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
    );
  }

  async getRun(runId: string): Promise<RunAuditEntry | null> {
    return this.runs.get(runId) ?? null;
  }

  async close(): Promise<void> {
    this.rowsByRun.clear();
    this.runs.clear();
  }

  /** Return every record inserted during the given run — used by the sync queue. */
  async listInsertedForRun(runId: string): Promise<StorageRecord[]> {
    const rows = this.rowsByRun.get(runId) ?? [];
    return rows.map((r) => ({
      id: r.id,
      schemaName: r.schemaName,
      record: r.record,
      identity: r.identity,
      firstImportedRunId: r.runId,
      firstImportedAt: r.insertedAt,
      lastUpdatedRunId: r.runId,
      lastUpdatedAt: r.insertedAt,
      checksum: r.checksum,
      entities: r.entities,
    }));
  }

  /**
   * Track per-row errors so the modal can show WHY rows were skipped
   * instead of the previous opaque "X ignoré(s)" message. The key is
   * the runId; the value is a list of { rowIndex, identity, error }.
   */
  private readonly errorsByRun: Map<string, Array<{ rowIndex: number; identity: string; error: string }>> = new Map();

  /** Return the collected errors for a run (used by the modal). */
  getErrorsForRun(runId: string): Array<{ rowIndex: number; identity: string; error: string }> {
    return this.errorsByRun.get(runId) ?? [];
  }


  private buildParentInput(record: ImportRecord): CreateParentInput {
    const phone = this.extractPhone(record);
    const tuteurRaw = (record.tuteur as string | undefined)?.trim();
    const email = (record.email as string | undefined)?.trim() || null;

    // Per `Clients_Sheet_Merged.md` → "03 - ETAT Columns / 01 - Identity (B-K)",
    // the TUTEUR column is *usually just the family name* (e.g. `ABDELAOUI`).
    // However, in the REAL `Suivis clients 2026_2027.xlsx`, 325 of 390 rows
    // have an EMPTY TUTEUR cell, and the 65 non-empty values are all "NV"
    // (a status flag, not a name). So in practice, TUTEUR is unused.
    //
    // PARENT-DISPLAY-NAME FIX (migration 0027):
    // The previous logic set `firstName = "Tuteur"` as a placeholder when
    // TUTEUR was missing — this produced prefixed displays like
    // "Tuteur BENALI" instead of the complete name.
    //
    // The new logic:
    //   1. If TUTEUR is name-like → use TUTEUR as the COMPLETE parent name.
    //      Split it for indexing (first/last) but ALSO store the full string
    //      in `displayName` so the UI shows the complete name verbatim.
    //   2. If TUTEUR is missing/non-name-like → derive the parent's family
    //      name from the student's NOM column (NOM is LASTNAME FIRSTNAME
    //      order, so the first token is the family name). Store the FULL
    //      NOM (e.g. "BENALI Mohamed") as `displayName` — this preserves
    //      the complete name through the pipeline.
    //   3. NEVER use "Tuteur" as a placeholder for firstName — that was the
    //      root cause of the prefix bug.
    //   4. PARENT-AS-STUDENT FIX: the parent's displayName must NEVER be the
    //      student's full name — that made the parent appear as a student in
    //      the UI. The parent's displayName is now "Famille {lastName}" so
    //      it's clearly a family/parent entity, distinct from the student.

    let lastName = "Inconnu";
    let firstName = "";
    let displayName: string | null = null;

    const isNameLikeTuteur =
      !!tuteurRaw &&
      !/^(nv|n\/?a|none|-|\?)$/i.test(tuteurRaw) &&
      // A single token with no digits and length >= 2 is treated as a name.
      // Anything else (numbers, "NV", short codes) is treated as missing.
      /^[a-zA-ZÀ-ÿ\u0600-\u06FF][a-zA-ZÀ-ÿ\u0600-\u06FF\s'-]{1,}$/.test(tuteurRaw);

    if (isNameLikeTuteur) {
      // TUTEUR is a real name — use it as the parent's name.
      const tuteurParts = splitFullName(tuteurRaw);
      lastName = tuteurParts.lastName || "Inconnu";
      firstName = tuteurParts.firstName || "";
      // Parent display = "Famille {lastName}" to distinguish from students.
      displayName = firstName
        ? `Famille ${lastName} (${firstName})`
        : `Famille ${lastName}`;
    } else if (record.nom) {
      // Derive parent family name from student NOM (LASTNAME FIRSTNAME order).
      const nomParts = splitFullName(record.nom);
      if (nomParts.lastName) {
        lastName = nomParts.lastName;
      }
      firstName = "";
      // PARENT-AS-STUDENT FIX: parent displayName = "Famille {lastName}",
      // NOT the student's full name. This ensures the parent is clearly
      // a family/parent entity and does NOT appear as a student in the UI.
      displayName = `Famille ${lastName}`;
    }

    // If we have a phone number, append it to the displayName for extra
    // disambiguation when multiple families share the same last name.
    if (phone && phone !== "(inconnu)" && displayName) {
      displayName = `${displayName} — ${phone}`;
    }

    return {
      firstName,
      lastName,
      displayName,
      gender: "unspecified",
      phone: phone || "(inconnu)",
      email,
      preferredLanguage: "fr",
    };
  }


  private buildStudentInput(record: ImportRecord): CreateStudentInput {
    const nameParts = splitFullName(record.nom);
    // CALC-001: resolve the EXACT grade from the CLASSE column (H) first —
    // the broad NIVEAU code (G: PRIM/COLG/LYC) would store every primary
    // student as 1ap and price them at the CP rate. Falls back to the
    // niveau mapping for unknown class codes (NV3/NV4 special tracks).
    const mapping = resolveGradeFromClasse(record.classe, record.niveau);
    // Store the DISTINATION town name as transportTier when present — this
    // is more useful than the OPTION code (TRNSP/TENSP/TRNP) because it
    // identifies the actual transport zone, which drives pricing per
    // plan §07.03. When DISTINATION is empty but OPTION indicates
    // transport, fall back to the OPTION code so the flag is preserved.
    const distination = (record.distination as string | undefined)?.trim() || null;
    const optionCode = (record.option as string | undefined)?.trim() || null;
    // Preserve the FULL student NOM (e.g. "BENALI Mohamed") as the display
    // name so the UI shows the complete name verbatim.
    const nomRaw = (record.nom as string | undefined)?.trim() || null;
    return {
      firstName: nameParts.firstName,
      lastName: nameParts.lastName || "Inconnu",
      displayName: nomRaw,
      gender: "unspecified",
      // DATA-018: the shared pinned placeholder (see student.ts) — never a
      // literal again; the demographics layer routes it to "Non renseigné".
      birthDate: IMPORTED_BIRTH_DATE_PLACEHOLDER,
      level: mapping.academicLevel,
      gradeYear: mapping.gradeYear,
      gradeLevel: mapping.gradeLevel,
      classId: null,
      medicalNotes: null,
      transportTier: distination ?? optionCode,
    };
  }


  private extractPhone(record: ImportRecord): string {
    const raw = record.nem;
    if (Array.isArray(raw)) return String(raw[0] ?? "");
    if (typeof raw === "string") {
      const first = raw.split(/[/,;]/)[0]?.trim();
      return first ?? "";
    }
    return "";
  }

  /**
   * IMPORT-107: collect the (sourceType|sourceId) identity keys of every
   * bulk-import ledger entry currently visible in the ledger stream.
   *
   * The LedgerRepository interface doesn't expose a synchronous "list"
   * method, but every implementation's `observe()` returns an Observable
   * whose `.get()` returns the current cached array (mock: the store-backed
   * SubjectBehavior — always current; Supabase: the client cache — may be
   * lazy, in which case this returns an empty set and the DB-level guard
   * (`ledger_entries_source_uidx` + `bulkAppend`'s ignore-duplicates) is
   * the authoritative dedupe).
   */
  private collectExistingImportLedgerKeys(): Set<string> {
    const keys = new Set<string>();
    if (!this.deps.ledger) return keys;
    try {
      const obs = this.deps.ledger.observe();
      const all = typeof obs.get === "function" ? obs.get() : [];
      for (const e of all) {
        if (e.sourceType != null && e.sourceId != null) {
          keys.add(`${e.sourceType}|${e.sourceId}`);
        }
      }
    } catch {
      // Dedupe unavailable — fall through with an empty set; the
      // DB-level unique index still guards the Supabase path.
    }
    return keys;
  }

  // ── Financial persistence ─────────────────────────────────────────────
  //
  // Each ETAT row carries financial fields that MUST be persisted to the
  // ledger so each student's transactions, balances, and payment history
  // are queryable from the CRM. The field set is aligned with the REAL
  // `Suivis clients 2026_2027.xlsx` structure documented in
  // `Clients_Sheet_Merged.md`:
  //
  //   DEVIS ANNUEL      (L)  → charge entry (category: tuition)
  //   DETTES            (N)  → charge entry (category: tuition — prior-year debt)
  //   REMISE            (J)  → adjustment entry (negative — discount)
  //   REMBOURSEMENT     (M)  → adjustment entry (negative — refund)
  //   REGLEMENTS DETTES (O)  → payment entry (category: tuition — debt payment)
  //   FI                (R)  → payment entry (category: tuition — registration fee)
  //   V2                (S)  → payment entry (category: tuition — 2nd installment)
  //   2V                (T)  → payment entry (category: tuition — alt 2nd installment)
  //   v3                (U)  → payment entry (category: tuition — 3rd installment)
  //   1T                (W)  → payment entry (category: transport — 1st tranche)
  //   T2                (X)  → payment entry (category: transport — 2nd tranche)
  //   t3                (Y)  → payment entry (category: transport — 3rd tranche)
  //
  // All entries are tagged with sourceType="bulk_import". The sourceId is
  // STABLE per (studentId, field) — `${studentId}:${field}` — so re-importing
  // the same file is idempotent at the ledger level: the adapter queries
  // existing entries for the parent and skips any whose (studentId, field)
  // key already exists. This prevents the "ledger doubles on re-import"
  // bug that would otherwise break the round-trip verification.
  /**
   * BULD FINANCIAL ENTRIES (deferred write — added to pendingLedgerEntries).
   *
   * Previously this method called `ledger.appendMany(entries)` immediately,
   * which for a 390-row workbook meant 390 separate `appendMany` calls
   * (each looping `append` → 1 RPC per entry = ~8,580 RPCs total).
   *
   * Now it ONLY builds the entries and returns them. The caller
   * (`upsertEtatRecord`) adds them to `pendingLedgerEntries`, and the
   * actual write happens ONCE in `commitTransaction` via `bulkAppend`.
   *
   * Dedup note (IMPORT-107): re-import idempotency is enforced at THREE
   * levels — (1) this adapter's flush dedupes the pending batch against
   * the current ledger stream by (sourceType, sourceId) identity;
   * (2) the DB-level `upsert_ledger_entry_from_import` RPC matches on
   * (tenant, source_type, source_id) for the sync-queue path; (3) the
   * live `ledger_entries_source_uidx` unique index + `bulkAppend`'s
   * ignore-duplicates guard the direct Supabase insert. Payments dedupe
   * by deterministic receiptNumber and installments by
   * (parent, student, category, trancheNumber) — all three financial
   * streams are now re-import-safe.
   */
  private buildFinancialEntries(
    record: ImportRecord,
    parentId: string,
    studentId: string,
    runId: string,
  ): LedgerEntry[] {
    const tenantId = this.deps.tenantId;
    const actorId = this.deps.actorId ?? "excel-import";
    const actorName = this.deps.actorName ?? "Excel Import";
    const at = new Date().toISOString();

    const entries: LedgerEntry[] = [];

    const devisAnnuel = numOrZero(record.devisAnnuel);
    const dettes = numOrZero(record.dettes);
    const remise = numOrZero(record.remise);
    const remboursement = numOrZero(record.remboursement);
    const reglementsDettes = numOrZero(record.reglementsDettes);
    const fi = numOrZero(record.fi);
    const v2 = numOrZero(record.v2);
    const v2Alt = numOrZero(record.v2Alt);
    const v3 = numOrZero(record.v3);
    const t1 = numOrZero(record.t1);
    const t2 = numOrZero(record.t2);
    const t3 = numOrZero(record.t3);
    // Extended columns (PSY/ORTH/E-PLANT/Ratrapage/quarterly).
    const psy1 = numOrZero(record.psy1);
    const psy2 = numOrZero(record.psy2);
    const orth1 = numOrZero(record.orth1);
    const orth2 = numOrZero(record.orth2);
    const eplant = numOrZero(record.eplant);
    const ratrapage = numOrZero(record.ratrapage);
    const septembre = numOrZero(record.septembre);
    const decembre = numOrZero(record.decembre);
    const mars = numOrZero(record.mars);

    // Stable sourceId per (student, field) — used for idempotent re-imports.
    const sid = (field: string): string => `${studentId}:${field}`;

    // DEVIS ANNUEL — the annual tuition quote (always a charge).
    if (devisAnnuel > 0) {
      entries.push(
        createChargeEntry({
          tenantId,
          parentId,
          studentId,
          category: "tuition",
          amount: devisAnnuel,
          sourceType: "bulk_import",
          sourceId: sid("DEVIS_ANNUEL"),
          description: `Devis annuel (import Excel run ${runId})`,
          actorId,
          actorName,
          at,
          metadata: { field: "DEVIS_ANNUEL", importRunId: runId },
        }),
      );
    }

    // DETTES — outstanding debt carried over from prior years (additional charge).
    if (dettes > 0) {
      entries.push(
        createChargeEntry({
          tenantId,
          parentId,
          studentId,
          category: "tuition",
          amount: dettes,
          sourceType: "bulk_import",
          sourceId: sid("DETTES"),
          description: `Dettes antérieures (import Excel run ${runId})`,
          actorId,
          actorName,
          at,
          metadata: { field: "DETTES", importRunId: runId },
        }),
      );
    }

    // REMISE — NO ledger adjustment (T-105 / DATA-010 fix, 2026-09-01).
    // The workbook's DEVIS ANNUEL (column L) is ALREADY net of the remise —
    // its formula is "components − J" (e.g. row 2: '=25000+205000+35000-J2',
    // verified across all 390 rows of Suivis clients  2026_2027.xlsx). Writing
    // a separate "Remise sur devis" adjustment on top of the devis charge
    // double-discounted every parent (223 parents, Σ −9,709,700 DZD live —
    // repaired by migration 0063). The remise remains visible in the tranche
    // proration (buildInstallmentRows) and in the import report only — no
    // ledger entry is written for it.
    void remise;

    // REMBOURSEMENT — refund issued to the parent.
    if (remboursement > 0) {
      // Refunds are negative entries (money out). We model them as an
      // adjustment with a negative amount — using createAdjustmentEntry
      // because createRefundEntry doesn't accept the same sourceType
      // metadata shape in this codebase.
      entries.push(
        createAdjustmentEntry({
          tenantId,
          parentId,
          studentId,
          category: "tuition",
          amount: -remboursement,
          reason: `Remboursement (import Excel run ${runId})`,
          sourceType: "bulk_import",
          sourceId: sid("REMBOURSEMENT"),
          actorId,
          actorName,
          at,
          metadata: { field: "REMBOURSEMENT", importRunId: runId },
        }),
      );
    }

    // REGLEMENTS DETTES — payment toward prior-year debts (single column).
    if (reglementsDettes > 0) {
      entries.push(
        createPaymentEntry({
          tenantId,
          parentId,
          studentId,
          category: "tuition",
          amount: reglementsDettes,
          method: "cash",
          receiptNumber: sid("REGLEMENTS_DETTES"),
          paymentStatus: "paid",
          sourceType: "bulk_import",
          sourceId: sid("REGLEMENTS_DETTES"),
          description: `Règlement dettes antérieures (import Excel run ${runId})`,
          actorId,
          actorName,
          at,
          metadata: { field: "REGLEMENTS_DETTES", importRunId: runId },
        }),
      );
    }

    // FI — registration fee payment (tuition category).
    if (fi > 0) {
      entries.push(
        createPaymentEntry({
          tenantId,
          parentId,
          studentId,
          category: "tuition",
          amount: fi,
          method: "cash",
          receiptNumber: sid("FI"),
          paymentStatus: "paid",
          sourceType: "bulk_import",
          sourceId: sid("FI"),
          description: `Frais d'inscription (FI) — import Excel run ${runId}`,
          actorId,
          actorName,
          at,
          metadata: { field: "FI", importRunId: runId },
        }),
      );
    }

    // V2 — 2nd tuition installment.
    if (v2 > 0) {
      entries.push(
        createPaymentEntry({
          tenantId,
          parentId,
          studentId,
          category: "tuition",
          amount: v2,
          method: "cash",
          receiptNumber: sid("V2"),
          paymentStatus: "paid",
          sourceType: "bulk_import",
          sourceId: sid("V2"),
          description: `Versement 2 (V2) — import Excel run ${runId}`,
          actorId,
          actorName,
          at,
          metadata: { field: "V2", importRunId: runId },
        }),
      );
    }

    // 2V — alternate 2nd tuition installment (split payment).
    if (v2Alt > 0) {
      entries.push(
        createPaymentEntry({
          tenantId,
          parentId,
          studentId,
          category: "tuition",
          amount: v2Alt,
          method: "cash",
          receiptNumber: sid("V2_ALT"),
          paymentStatus: "paid",
          sourceType: "bulk_import",
          sourceId: sid("V2_ALT"),
          description: `Versement 2 alternatif (2V) — import Excel run ${runId}`,
          actorId,
          actorName,
          at,
          metadata: { field: "V2_ALT", importRunId: runId },
        }),
      );
    }

    // v3 — 3rd tuition installment.
    if (v3 > 0) {
      entries.push(
        createPaymentEntry({
          tenantId,
          parentId,
          studentId,
          category: "tuition",
          amount: v3,
          method: "cash",
          receiptNumber: sid("V3"),
          paymentStatus: "paid",
          sourceType: "bulk_import",
          sourceId: sid("V3"),
          description: `Versement 3 (v3) — import Excel run ${runId}`,
          actorId,
          actorName,
          at,
          metadata: { field: "V3", importRunId: runId },
        }),
      );
    }

    // 1T — 1st transport tranche.
    if (t1 > 0) {
      entries.push(
        createPaymentEntry({
          tenantId,
          parentId,
          studentId,
          category: "transport",
          amount: t1,
          method: "cash",
          receiptNumber: sid("T1"),
          paymentStatus: "paid",
          sourceType: "bulk_import",
          sourceId: sid("T1"),
          description: `Tranche 1 transport (1T) — import Excel run ${runId}`,
          actorId,
          actorName,
          at,
          metadata: { field: "T1", importRunId: runId },
        }),
      );
    }

    // T2 — 2nd transport tranche.
    if (t2 > 0) {
      entries.push(
        createPaymentEntry({
          tenantId,
          parentId,
          studentId,
          category: "transport",
          amount: t2,
          method: "cash",
          receiptNumber: sid("T2"),
          paymentStatus: "paid",
          sourceType: "bulk_import",
          sourceId: sid("T2"),
          description: `Tranche 2 transport (T2) — import Excel run ${runId}`,
          actorId,
          actorName,
          at,
          metadata: { field: "T2", importRunId: runId },
        }),
      );
    }

    // t3 — 3rd transport tranche.
    if (t3 > 0) {
      entries.push(
        createPaymentEntry({
          tenantId,
          parentId,
          studentId,
          category: "transport",
          amount: t3,
          method: "cash",
          receiptNumber: sid("T3"),
          paymentStatus: "paid",
          sourceType: "bulk_import",
          sourceId: sid("T3"),
          description: `Tranche 3 transport (t3) — import Excel run ${runId}`,
          actorId,
          actorName,
          at,
          metadata: { field: "T3", importRunId: runId },
        }),
      );
    }

    // ── Therapy + extra sessions block (Z–AE) ─────────────────────────────
    // These categories were added to the ledger_entries_category_check by
    // migration 0026/0027. Each therapy session is a separate payment entry
    // so the student's therapy history is queryable per session.

    // PSY1 — psychology session 1.
    if (psy1 > 0) {
      entries.push(
        createPaymentEntry({
          tenantId,
          parentId,
          studentId,
          category: "therapy_psychology",
          amount: psy1,
          method: "cash",
          receiptNumber: sid("PSY1"),
          paymentStatus: "paid",
          sourceType: "bulk_import",
          sourceId: sid("PSY1"),
          description: `Séance psychologie 1 (PSY1) — import Excel run ${runId}`,
          actorId,
          actorName,
          at,
          metadata: { field: "PSY1", importRunId: runId },
        }),
      );
    }

    // PSY2 — psychology session 2.
    if (psy2 > 0) {
      entries.push(
        createPaymentEntry({
          tenantId,
          parentId,
          studentId,
          category: "therapy_psychology",
          amount: psy2,
          method: "cash",
          receiptNumber: sid("PSY2"),
          paymentStatus: "paid",
          sourceType: "bulk_import",
          sourceId: sid("PSY2"),
          description: `Séance psychologie 2 (PSY2) — import Excel run ${runId}`,
          actorId,
          actorName,
          at,
          metadata: { field: "PSY2", importRunId: runId },
        }),
      );
    }

    // ORTH1 — speech therapy session 1.
    if (orth1 > 0) {
      entries.push(
        createPaymentEntry({
          tenantId,
          parentId,
          studentId,
          category: "therapy_speech",
          amount: orth1,
          method: "cash",
          receiptNumber: sid("ORTH1"),
          paymentStatus: "paid",
          sourceType: "bulk_import",
          sourceId: sid("ORTH1"),
          description: `Séance orthophonie 1 (ORTH1) — import Excel run ${runId}`,
          actorId,
          actorName,
          at,
          metadata: { field: "ORTH1", importRunId: runId },
        }),
      );
    }

    // ORTH2 — speech therapy session 2.
    if (orth2 > 0) {
      entries.push(
        createPaymentEntry({
          tenantId,
          parentId,
          studentId,
          category: "therapy_speech",
          amount: orth2,
          method: "cash",
          receiptNumber: sid("ORTH2"),
          paymentStatus: "paid",
          sourceType: "bulk_import",
          sourceId: sid("ORTH2"),
          description: `Séance orthophonie 2 (ORTH2) — import Excel run ${runId}`,
          actorId,
          actorName,
          at,
          metadata: { field: "ORTH2", importRunId: runId },
        }),
      );
    }

    // E-PLANT — extra support plan payment (modeled as "other").
    if (eplant > 0) {
      entries.push(
        createPaymentEntry({
          tenantId,
          parentId,
          studentId,
          category: "other",
          amount: eplant,
          method: "cash",
          receiptNumber: sid("EPLANT"),
          paymentStatus: "paid",
          sourceType: "bulk_import",
          sourceId: sid("EPLANT"),
          description: `E-PLANT (plan d'accompagnement) — import Excel run ${runId}`,
          actorId,
          actorName,
          at,
          metadata: { field: "EPLANT", importRunId: runId },
        }),
      );
    }

    // Ratrapage — catch-up session payment (modeled as "tuition").
    if (ratrapage > 0) {
      entries.push(
        createPaymentEntry({
          tenantId,
          parentId,
          studentId,
          category: "tuition",
          amount: ratrapage,
          method: "cash",
          receiptNumber: sid("RATRAPAGE"),
          paymentStatus: "paid",
          sourceType: "bulk_import",
          sourceId: sid("RATRAPAGE"),
          description: `Rattrapage — import Excel run ${runId}`,
          actorId,
          actorName,
          at,
          metadata: { field: "RATRAPAGE", importRunId: runId },
        }),
      );
    }

    // ── Quarterly tranches (AF, AH, AJ) ───────────────────────────────────
    // September / December / March quarterly tuition tranches.

    if (septembre > 0) {
      entries.push(
        createPaymentEntry({
          tenantId,
          parentId,
          studentId,
          category: "tuition",
          amount: septembre,
          method: "cash",
          receiptNumber: sid("SEPTEMBRE"),
          paymentStatus: "paid",
          sourceType: "bulk_import",
          sourceId: sid("SEPTEMBRE"),
          description: `Tranche septembre — import Excel run ${runId}`,
          actorId,
          actorName,
          at,
          metadata: { field: "SEPTEMBRE", importRunId: runId },
        }),
      );
    }

    if (decembre > 0) {
      entries.push(
        createPaymentEntry({
          tenantId,
          parentId,
          studentId,
          category: "tuition",
          amount: decembre,
          method: "cash",
          receiptNumber: sid("DECEMBRE"),
          paymentStatus: "paid",
          sourceType: "bulk_import",
          sourceId: sid("DECEMBRE"),
          description: `Tranche décembre — import Excel run ${runId}`,
          actorId,
          actorName,
          at,
          metadata: { field: "DECEMBRE", importRunId: runId },
        }),
      );
    }

    if (mars > 0) {
      entries.push(
        createPaymentEntry({
          tenantId,
          parentId,
          studentId,
          category: "tuition",
          amount: mars,
          method: "cash",
          receiptNumber: sid("MARS"),
          paymentStatus: "paid",
          sourceType: "bulk_import",
          sourceId: sid("MARS"),
          description: `Tranche mars — import Excel run ${runId}`,
          actorId,
          actorName,
          at,
          metadata: { field: "MARS", importRunId: runId },
        }),
      );
    }

    // ── T-414 (IMPORT-111): the 2027-2026 format's expanded columns ─────
    // PSY3…PSY14 — the expanded therapy grid (all psychology sessions,
    // same category + expected amount as PSY1/PSY2). Driven by the
    // canonical record keys the etat-2027-2026 configuration maps.
    for (let n = 3; n <= 14; n++) {
      const amount = numOrZero(record[`psy${n}`]);
      if (amount > 0) {
        const field = `PSY${n}`;
        entries.push(
          createPaymentEntry({
            tenantId,
            parentId,
            studentId,
            category: "therapy_psychology",
            amount,
            method: "cash",
            receiptNumber: sid(field),
            paymentStatus: "paid",
            sourceType: "bulk_import",
            sourceId: sid(field),
            description: `Séance psychologie ${n} (${field}) — import Excel run ${runId}`,
            actorId,
            actorName,
            at,
            metadata: { field, importRunId: runId },
          }),
        );
      }
    }

    // COURS SUP — supplementary tutoring payment (tuition family).
    const coursSup = numOrZero(record.coursSup);
    if (coursSup > 0) {
      entries.push(
        createPaymentEntry({
          tenantId,
          parentId,
          studentId,
          category: "tuition",
          amount: coursSup,
          method: "cash",
          receiptNumber: sid("COURS_SUP"),
          paymentStatus: "paid",
          sourceType: "bulk_import",
          sourceId: sid("COURS_SUP"),
          description: `COURS SUP (cours de soutien) — import Excel run ${runId}`,
          actorId,
          actorName,
          at,
          metadata: { field: "COURS_SUP", importRunId: runId },
        }),
      );
    }

    // LIVRES — textbook payment (books — promoted from a free-text note in
    // the 2026/2027 format to a structured column).
    const livres = numOrZero(record.livres);
    if (livres > 0) {
      entries.push(
        createPaymentEntry({
          tenantId,
          parentId,
          studentId,
          category: "books",
          amount: livres,
          method: "cash",
          receiptNumber: sid("LIVRES"),
          paymentStatus: "paid",
          sourceType: "bulk_import",
          sourceId: sid("LIVRES"),
          description: `Livres scolaires — import Excel run ${runId}`,
          actorId,
          actorName,
          at,
          metadata: { field: "LIVRES", importRunId: runId },
        }),
      );
    }

    // CLUB — extracurricular club payment.
    const club = numOrZero(record.club);
    if (club > 0) {
      entries.push(
        createPaymentEntry({
          tenantId,
          parentId,
          studentId,
          category: "extracurricular",
          amount: club,
          method: "cash",
          receiptNumber: sid("CLUB"),
          paymentStatus: "paid",
          sourceType: "bulk_import",
          sourceId: sid("CLUB"),
          description: `Club (activité extrascolaire) — import Excel run ${runId}`,
          actorId,
          actorName,
          at,
          metadata: { field: "CLUB", importRunId: runId },
        }),
      );
    }

    // SORTIES — school-trip payment (extracurricular).
    const sorties = numOrZero(record.sorties);
    if (sorties > 0) {
      entries.push(
        createPaymentEntry({
          tenantId,
          parentId,
          studentId,
          category: "extracurricular",
          amount: sorties,
          method: "cash",
          receiptNumber: sid("SORTIES"),
          paymentStatus: "paid",
          sourceType: "bulk_import",
          sourceId: sid("SORTIES"),
          description: `Sortie scolaire — import Excel run ${runId}`,
          actorId,
          actorName,
          at,
          metadata: { field: "SORTIES", importRunId: runId },
        }),
      );
    }

    // NOTE (T-414): the informational columns CREANCE SEPT (×3) and
    // TT CREANCE are DELIBERATELY not ledgered — balances are recomputed
    // by the canonical ledger replay (INV-1), never copied from the
    // workbook's own formulas. They remain on the raw record for the
    // import report / audit trail.
    void record.creanceSept;
    void record.creanceSept2;
    void record.creanceSept3;
    void record.ttCreance;

    return entries;
  }

  // ── Payment rows persistence ──────────────────────────────────────────
  //
  // The student payments tab reads `repos.payments.observeByStudent(studentId)`
  // which queries the `payments` table — NOT the ledger. So in addition to
  // creating ledger entries (above), the importer MUST also create `payments`
  // rows for each payment-type field. Each payment gets a deterministic
  // receipt number derived from `(studentId, field)` so re-imports are
  // idempotent at the payments level.

  /**
   * BUILD PAYMENT ROWS (deferred write — added to pendingPayments).
   *
   * Returns Payment objects WITHOUT calling `payments.collect()`. The
   * caller adds them to `pendingPayments`, and the actual write happens
   * ONCE in `commitTransaction` via `bulkCollect`.
   *
   * PAYMENT BREAKDOWN: Each payment includes `expectedAmount` — the REAL
   * expected amount for the corresponding tranche from the CALC-001 matrix
   * (`school-price-matrix.ts`). When the paid amount exceeds the expected,
   * `excessAmount` + `excessRemark` are set so the UI can show the
   * overpayment clearly.
   */
  /**
   * The REAL 2026/2027 schedule for an imported row — the CALC-001 matrix
   * (per-grade FI, V2/2V/v3 tranches with the REMISE on V2 ONLY, per-town
   * transport). AUTISTE rows (detected via the CLASSE column) use the
   * dedicated autism schedule (23 000 + 250 000).
   */
  private realScheduleFor(record: ImportRecord): {
    fi: number;
    tuitionTranches: [number, number, number]; // [V2, 2V, v3] stickers
    transport: readonly [number, number, number, number];
    destination: TransportDestination;
  } {
    // EXACT grade from the CLASSE column (CALC-001) — the broad NIVEAU
    // code would price every primary student at the CP rate.
    const mapping = resolveGradeFromClasse(record.classe, record.niveau);
    const gradeLevel = mapping.gradeLevel;
    const isAutiste = isAutisteTrack(record.classe, record.option);
    const schedule = isAutiste ? REAL_TUITION_AUTISTE : REAL_TUITION_BY_GRADE[gradeLevel];
    const fi = isAutiste ? REAL_FI_AUTISTE : REAL_FI_BY_GRADE[gradeLevel];
    const tuitionTranches: [number, number, number] = schedule
      ? [schedule.v2, schedule.tranche3, schedule.tranche4]
      : [0, 0, 0];
    const destination = mapExcelDestinationToCanonical(record.distination);
    const transport = REAL_TRANSPORT_MATRIX[destination] ?? [0, 0, 0, 0];
    return { fi, tuitionTranches, transport, destination };
  }

  private buildPaymentRows(
    record: ImportRecord,
    parentId: string,
    studentId: string,
    runId: string,
  ): Payment[] {
    const actorId = this.deps.actorId ?? "excel-import";
    const at = new Date().toISOString();

    // CALC-001 REAL PRICING — expected amounts from the real matrix.
    const { fi: fiExpected, tuitionTranches, transport: transportSchedule, destination } =
      this.realScheduleFor(record);
    const remise = numOrZero(record.remise);

    // The REMISE lands on the V2 tranche ONLY (workbook column-S rule:
    // `=122000-J58`); 2V / v3 are never discounted.
    const expectedTuitionTranches: [number, number, number] = [
      Math.max(0, tuitionTranches[0] - remise),
      tuitionTranches[1],
      tuitionTranches[2],
    ];

    // Expected transport tranche amounts.
    const expectedTransportTranches: [number, number, number] = [
      transportSchedule[1],
      transportSchedule[2],
      transportSchedule[3],
    ];

    // Each entry: [field, amount, category, description, expectedAmount]
    // expectedAmount = the real expected amount for this tranche (CALC-001).
    // Tranche labels follow the BON receipt sheet: INSCRIPTION / 2EME /
    // 3ème / 4ème TRANCHE.
    type PaymentSpec = [string, number, PaymentCategory, string, number];
    const specs: PaymentSpec[] = [
      ["REGLEMENTS_DETTES", numOrZero(record.reglementsDettes), "tuition", "Règlement dettes antérieures", 0],
      ["FI", numOrZero(record.fi), "tuition", "INSCRIPTION (FI) — frais d'inscription", fiExpected],
      ["V2", numOrZero(record.v2), "tuition", "2EME TRANCHE (V2)", expectedTuitionTranches[0]],
      ["V2_ALT", numOrZero(record.v2Alt), "tuition", "3ème TRANCHE (2V)", expectedTuitionTranches[1]],
      ["V3", numOrZero(record.v3), "tuition", "4ème TRANCHE (v3)", expectedTuitionTranches[2]],
      ["T1", numOrZero(record.t1), "transport", `Tranche 1 transport (1T) — ${destination}`, expectedTransportTranches[0]],
      ["T2", numOrZero(record.t2), "transport", `Tranche 2 transport (T2) — ${destination}`, expectedTransportTranches[1]],
      ["T3", numOrZero(record.t3), "transport", `Tranche 3 transport (t3) — ${destination}`, expectedTransportTranches[2]],
      ["PSY1", numOrZero(record.psy1), "therapy_psychology", "Séance psychologie 1 (PSY1)", 10_000],
      ["PSY2", numOrZero(record.psy2), "therapy_psychology", "Séance psychologie 2 (PSY2)", 10_000],
      ["ORTH1", numOrZero(record.orth1), "therapy_speech", "Séance orthophonie 1 (ORTH1)", 10_000],
      ["ORTH2", numOrZero(record.orth2), "therapy_speech", "Séance orthophonie 2 (ORTH2)", 10_000],
      ["EPLANT", numOrZero(record.eplant), "other", "E-PLANT (plan d'accompagnement)", 0],
      ["RATRAPAGE", numOrZero(record.ratrapage), "tuition", "Rattrapage", 0],
      ["SEPTEMBRE", numOrZero(record.septembre), "tuition", "Tranche septembre — Tranche 1", expectedTuitionTranches[0]],
      ["DECEMBRE", numOrZero(record.decembre), "tuition", "Tranche décembre — Tranche 2", expectedTuitionTranches[1]],
      ["MARS", numOrZero(record.mars), "tuition", "Tranche mars — Tranche 3", expectedTuitionTranches[2]],
      // ── T-414 (IMPORT-111): the 2027-2026 format's expanded columns ──
      // The expanded therapy grid (PSY3…PSY14) + the four ancillary
      // services, through the SAME payment rows path (the payments tab
      // reads `payments`, not the ledger).
      ...Array.from({ length: 12 }, (_, i) => {
        const n = i + 3;
        return [
          `PSY${n}`,
          numOrZero(record[`psy${n}`]),
          "therapy_psychology",
          `Séance psychologie ${n} (PSY${n})`,
          10_000,
        ] as [string, number, PaymentCategory, string, number];
      }),
      ["COURS_SUP", numOrZero(record.coursSup), "tuition", "COURS SUP (cours de soutien)", 0],
      ["LIVRES", numOrZero(record.livres), "books", "Livres scolaires", 0],
      ["CLUB", numOrZero(record.club), "extracurricular", "Club (activité extrascolaire)", 0],
      ["SORTIES", numOrZero(record.sorties), "extracurricular", "Sortie scolaire", 0],
    ];

    const results: Payment[] = [];
    for (const [field, amount, category, description, expectedAmount] of specs) {
      if (amount <= 0) continue;
      const receiptNumber = `IMP-${studentId}-${field}`;
      // PAYMENT BREAKDOWN: detect overpayment — when the paid amount
      // exceeds the expected amount for this tranche.
      const excessAmount = expectedAmount > 0 ? Math.max(0, amount - expectedAmount) : 0;
      const excessRemark = excessAmount > 0
        ? `Surpaiement: payé ${amount} DA au lieu de ${expectedAmount} DA attendus. Excédent ${excessAmount} DA conservé comme crédit parent.`
        : null;
      const payment: Payment = {
        id: `imp-pay-${studentId}-${field}`,
        tenantId: this.deps.tenantId,
        receiptNumber,
        parentId,
        studentId,
        amount,
        method: "cash",
        status: "paid",
        category,
        installmentId: null,
        proofUrl: null,
        notes: `${description} — import Excel run ${runId}`,
        collectedBy: actorId,
        collectedAt: at,
        createdAt: at,
        updatedAt: at,
        expectedAmount,
        excessAmount,
        excessRemark,
      };
      results.push(payment);
    }
    return results;
  }

  // ── Installments persistence ─────────────────────────────────────────
  //
  // The Excel file models tuition as the 4-payment BON structure
  // (FI/V2/2V/v3 — the workbook's own receipt labels: INSCRIPTION, 2EME,
  // 3ème, 4ème TRANCHE) and transport as 3 tranches (1T/T2/t3). The
  // installer creates one `installments` row per payment, marking them
  // paid/partial/unpaid according to the imported amounts. Due dates
  // follow the BON rhythm: Sept 15 / Dec 15 / Mar 15 / Jun 15.

  /**
   * BUILD INSTALLMENT ROWS (deferred write — added to pendingInstallments).
   *
   * Returns Installment objects WITHOUT calling `installments.importInstallment()`.
   * The caller adds them to `pendingInstallments`, and the actual write
   * happens ONCE in `commitTransaction` via `bulkImportInstallments`.
   *
   * CALC-001 REAL PRICING: the tuition schedule is the 4-payment BON
   * structure — INSCRIPTION (FI) / 2EME TRANCHE (V2) / 3ème TRANCHE (2V) /
   * 4ème TRANCHE (v3) — with the REMISE deducted from the 2EME (V2)
   * tranche ONLY (workbook column-S rule `=122000-J58`). Transport
   * tranches come from the REAL per-town matrix.
   *
   * Negotiated-price rows (the school wrote custom constants in its own
   * workbook formula) are realigned by the T-105 reconciliation below,
   * which absorbs the residual delta into the latest tranche.
   */
  private buildInstallmentRows(
    record: ImportRecord,
    parentId: string,
    studentId: string,
    student: Student | null,
    runId: string,
  ): Installment[] {
    void runId;
    void student;
    const now = new Date();

    // Resolve the academic cycle for the installment rows.
    const mapping = resolveGradeFromClasse(record.classe, record.niveau);
    const cycle: AcademicCycle = mapping.academicLevel === "lycee"
      ? "lycee"
      : mapping.academicLevel === "cem"
        ? "cem"
        : "primaire";

    // Due dates — the BON rhythm: INSCRIPTION at signup (Sept 15), then
    // 2EME (Dec 15), 3ème (Mar 15), 4ème (Jun 15).
    const academicYearStart = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
    const dueDates: readonly [string, string, string, string] = [
      `${academicYearStart}-09-15`,
      `${academicYearStart}-12-15`,
      `${academicYearStart + 1}-03-15`,
      `${academicYearStart + 1}-06-15`,
    ];

    // REAL TUITION PRICES from the CALC-001 matrix — per grade (or the
    // AUTISTE schedule). The REMISE lands on the 2EME (V2) tranche ONLY.
    const { fi: fiDue, tuitionTranches, transport: transportSchedule, destination } =
      this.realScheduleFor(record);
    const remise = numOrZero(record.remise);
    const netTuitionTrancheDue: readonly [number, number, number, number] = [
      fiDue,
      Math.max(0, tuitionTranches[0] - remise), // 2EME (V2) — remise here only
      tuitionTranches[1],                        // 3ème (2V)
      tuitionTranches[2],                        // 4ème (v3)
    ];

    // Tuition amounts PAID — from the Excel payment columns.
    // FI + SEPTEMBRE → INSCRIPTION; V2 + DECEMBRE → 2EME;
    // V2_ALT + MARS → 3ème; V3 + RATRAPAGE → 4ème.
    const tuitionTranchePaid: readonly [number, number, number, number] = [
      numOrZero(record.fi) + numOrZero(record.septembre),
      numOrZero(record.v2) + numOrZero(record.decembre),
      numOrZero(record.v2Alt) + numOrZero(record.mars),
      numOrZero(record.v3) + numOrZero(record.ratrapage),
    ];
    const tuitionLabels: readonly [string, string, string, string] = [
      "INSCRIPTION (FI)",
      "2EME TRANCHE (V2)",
      "3ème TRANCHE (2V)",
      "4ème TRANCHE (v3)",
    ];

    // REAL TRANSPORT PRICES — per-town from the CALC-001 matrix.
    const hasTransport =
      !!record.distination ||
      String(record.option ?? "").toUpperCase() === "TRNSP";
    const canonicalDestination = destination;
    const transportTrancheDue: [number, number, number] = [
      transportSchedule[1],
      transportSchedule[2],
      transportSchedule[3],
    ];
    const transportTranchePaid: [number, number, number] = [
      numOrZero(record.t1),
      numOrZero(record.t2),
      numOrZero(record.t3),
    ];

    let results: Installment[] = [];

    const buildInstallment = (
      category: PaymentCategory,
      trancheNumber: 1 | 2 | 3 | 4,
      label: string,
      amountDue: number,
      amountPaid: number,
      dueDate: string,
    ): Installment => {
      const status = amountPaid >= amountDue && amountDue > 0
        ? "paid"
        : amountPaid > 0
          ? "partial"
          : amountDue > 0
            ? "unpaid"
            : "paid";
      return {
        id: `imp-${parentId}-${studentId}-${category}-T${trancheNumber}`,
        parentId,
        studentId,
        category,
        label,
        amountDue,
        amountPaid,
        amountPending: 0,
        dueDate,
        paidDate: status === "paid" ? now.toISOString() : null,
        status: status as "unpaid" | "partial" | "paid" | "overdue" | "pending_clearance",
        academicCycle: cycle,
        paymentPlan: "tranches",
        isCustomSchedule: false,
        customScheduleNote: null,
      };
    };

    // Tuition installments — the 4-payment BON structure (INSCRIPTION /
    // 2EME / 3ème / 4ème TRANCHE) with REAL matrix amounts.
    for (let i = 0; i < 4; i++) {
      const trancheNumber = (i + 1) as 1 | 2 | 3 | 4;
      const amountDue = netTuitionTrancheDue[i];
      const amountPaid = tuitionTranchePaid[i];
      if (amountDue === 0 && amountPaid === 0) continue;
      results.push(buildInstallment(
        "tuition", trancheNumber, tuitionLabels[i],
        amountDue, amountPaid, dueDates[i],
      ));
    }

    // Transport installments (3 tranches) — REAL per-town matrix amounts.
    if (hasTransport) {
      for (let i = 0; i < 3; i++) {
        const trancheNumber = (i + 1) as 1 | 2 | 3;
        const amountDue = transportTrancheDue[i];
        const amountPaid = transportTranchePaid[i];
        if (amountDue === 0 && amountPaid === 0) continue;
        results.push(buildInstallment(
          "transport", trancheNumber, `Tranche ${trancheNumber} — Transport (${canonicalDestination})`,
          amountDue, amountPaid, dueDates[i],
        ));
      }
    }

    // ── T-105 / C3 reconciliation (2026-09-01) ────────────────────────────
    // The ledger writes the DEVIS ANNUEL charge as imported from column L
    // (custom negotiated total, ALREADY net of remise), while the tranches
    // above come from the Prices.md grids. Without this step the schedule
    // disagrees with the ledger (the DATA-003 family — migration 0062/0063
    // had to repair it live). Deterministic rule (0062 precedent): the LAST
    // tuition tranche absorbs the delta; a negative delta cascades backwards
    // across tranches, flooring each at 0. Installment is immutable — shifted
    // tranches are REBUILT by index, never mutated.
    const ledgerTarget =
      numOrZero(record.devisAnnuel) + numOrZero(record.dettes) - numOrZero(record.remboursement);
    const tranchesTotal = results.reduce((sum, t) => sum + t.amountDue, 0);
    let alignDelta = Math.round(ledgerTarget - tranchesTotal);
    const byDueDesc = (a: Installment, b: Installment) =>
      new Date(b.dueDate).getTime() - new Date(a.dueDate).getTime() ||
      b.label.localeCompare(a.label);
    if (Math.abs(alignDelta) >= 1) {
      if (alignDelta > 0) {
        const lastTuitionIdx = results
          .map((t, i) => ({ t, i }))
          .filter(({ t }) => t.category === "tuition")
          .sort((a, b) => byDueDesc(a.t, b.t))[0]?.i;
        if (lastTuitionIdx !== undefined) {
          const t = results[lastTuitionIdx];
          results[lastTuitionIdx] = {
            ...t,
            amountDue: t.amountDue + alignDelta,
            customScheduleNote:
              `Alignement devis Excel (T-105): +${alignDelta} DZD absorbés par la dernière tranche`,
          };
        } else {
          results.push(buildInstallment(
            "tuition", 1, "Tranche 1 — Scolarité", alignDelta, 0, dueDates[2],
          ));
        }
      } else {
        const ordered = results
          .map((t, i) => ({ t, i }))
          .sort((a, b) => byDueDesc(a.t, b.t));
        for (const { t, i } of ordered) {
          if (alignDelta >= 0) break;
          const take = Math.min(t.amountDue, -alignDelta);
          if (take > 0) {
            results[i] = { ...t, amountDue: t.amountDue - take };
            alignDelta += take;
          }
        }
      }
      // Recompute statuses + paidDate for the shifted tranches (a tranche
      // marked "paid" under the old amountDue may now be partial, and vice
      // versa a reduced tranche may now be fully covered by amountPaid).
      results = results.map((t) => {
        const newStatus: Installment["status"] =
          t.amountDue > 0 && t.amountPaid >= t.amountDue
            ? "paid"
            : t.amountPaid > 0
              ? "partial"
              : t.amountDue > 0
                ? "unpaid"
                : "paid";
        if (newStatus !== t.status) {
          return {
            ...t,
            status: newStatus,
            paidDate: newStatus === "paid" ? now.toISOString() : null,
          };
        }
        return t;
      });
    }

    return results;
  }

  // ── Generic tracked upsert (BON, Devis, REF) ──────────────────────────

  private async upsertTrackedRecord(
    schema: ImportSchema,
    record: ImportRecord,
    identityKeys: readonly string[],
    runId: string,
  ): Promise<UpsertResult> {
    // Non-ETAT schemas don't resolve to domain entities — pass an empty list.
    this.trackInsertedRow(schema.name, record, identityKeys, runId, []);
    return { action: "insert" };
  }

  private trackInsertedRow(
    schemaName: string,
    record: ImportRecord,
    identityKeys: readonly string[],
    runId: string,
    entities: ReadonlyArray<{ kind: InsertedEntityKind; entity: Parent | Student | LedgerEntry | Payment | Installment }>,
  ): void {
    const identity: Record<string, string | number> = {};
    for (const key of identityKeys) {
      const v = record[key.toLowerCase()] ?? record[key];
      if (v !== undefined && v !== null && v !== "") {
        identity[key] = typeof v === "number" ? v : String(v);
      }
    }
    const row: InsertedRow = {
      id: uuid(),
      schemaName,
      runId,
      record,
      identity,
      checksum: "", // Computed lazily to avoid async in sync helper.
      insertedAt: new Date().toISOString(),
      entities,
    };
    const list = this.rowsByRun.get(runId) ?? [];
    list.push(row);
    this.rowsByRun.set(runId, list);
  }
}

// ── PERF-503 (T-417): module-scope batch support types ─────────────────────

/**
 * One row of an ETAT batch, carrying the prebuilt student input and the
 * row's resolved action (filled in as the family task processes it).
 */
interface EtatRowTask {
  readonly record: ImportRecord;
  readonly rowIndex: number;
  studentInput: CreateStudentInput;
  action: "insert" | "update" | "skip";
}

/**
 * One family — the CONCURRENCY UNIT of the ETAT batch. All rows that
 * resolve to the same parent identity are processed strictly in row
 * order inside one family task, so every intra-family semantic of the
 * sequential importer is preserved (parent create-once, sibling student
 * identity resolution, duplicate-row update chains, per-row retry after
 * a create failure).
 *
 * - `resolvedParent` is set for snapshot-matched families (pre-existing
 *   parent) and for intent families once the first `createParent` lands.
 * - `pendingInput` is the FIRST row's parent input — the one the create
 *   uses; a later row of the same family retries with ITS OWN input when
 *   an earlier attempt failed (the legacy per-row retry semantics).
 * - `snapshotStudents` are the pre-existing students of the resolved
 *   parent (search("") order); `createdStudents` are the students this
 *   run created for the family (newest first — search parity).
 */
interface EtatFamily {
  pendingInput: CreateParentInput | null;
  resolvedParent: Parent | null;
  readonly snapshotStudents: Student[];
  createdStudents: Student[];
  readonly rowTaskIndexes: number[];
}

/**
 * The in-memory parent index behind the batch pre-resolution — ONE
 * implementation of the legacy multi-pronged parent identity match
 * (phone → email → placeholder name stages, incl. the legacy "Tuteur"
 * format), served from a snapshot instead of per-row repository
 * searches.
 *
 * Entries are PREPENDED as they are registered (intents) or lazily
 * created (snapshot parents), mirroring how both repository layers
 * surface newly created rows FIRST in search results.
 */
class BatchParentIndex {
  private entries: Array<{
    phone: string | null;
    email: string | null;
    firstName: string;
    lastName: string;
    displayName: string | null;
    family: EtatFamily | null;
    parent: Parent | null;
  }> = [];

  constructor(
    private readonly makeExistingFamily: (parent: Parent) => EtatFamily,
  ) {}

  /** Register a snapshot (pre-existing) parent. */
  addExisting(parent: Parent): void {
    this.entries.unshift({
      phone: parent.phone,
      email: parent.email,
      firstName: parent.firstName,
      lastName: parent.lastName,
      displayName: parent.displayName,
      family: null, // lazily bound on first resolve
      parent,
    });
  }

  /** Register a pending create intent for a NEW family. */
  registerIntent(input: CreateParentInput, family: EtatFamily): void {
    this.entries.unshift({
      phone: input.phone ?? null,
      email: input.email ?? null,
      firstName: input.firstName,
      lastName: input.lastName,
      displayName: input.displayName ?? null,
      family,
      parent: null,
    });
  }

  /**
   * The legacy `findExistingParent` match strategy, verbatim:
   *   1. exact phone match (when the input phone is real);
   *   2. exact email match;
   *   3. placeholder stages — (firstName, lastName) under a "(inconnu)"
   *      phone, then exact displayName, then the legacy "Tuteur"
   *      firstName format.
   * Returns the bound family, or null when the row must CREATE the
   * parent.
   */
  resolveFamilyFor(input: CreateParentInput): EtatFamily | null {
    if (input.phone && input.phone !== "(inconnu)") {
      const hit = this.entries.find((e) => e.phone === input.phone);
      if (hit) return this.bind(hit);
    }
    if (input.email) {
      const hit = this.entries.find((e) => e.email === input.email);
      if (hit) return this.bind(hit);
    }
    // Placeholder parent — match by name to keep re-imports idempotent.
    const byName = this.entries.find(
      (e) =>
        e.phone === "(inconnu)" &&
        e.firstName === input.firstName &&
        e.lastName === input.lastName,
    );
    if (byName) return this.bind(byName);
    const byDisplayName = this.entries.find(
      (e) =>
        e.phone === "(inconnu)" &&
        input.displayName !== null &&
        e.displayName === input.displayName,
    );
    if (byDisplayName) return this.bind(byDisplayName);
    // Backward-compat: also match the OLD placeholder format where
    // firstName was "Tuteur".
    const byLegacyTuteur = this.entries.find(
      (e) =>
        e.phone === "(inconnu)" &&
        e.firstName === "Tuteur" &&
        e.lastName === input.lastName,
    );
    if (byLegacyTuteur) return this.bind(byLegacyTuteur);
    return null;
  }

  /** Bind a snapshot entry to its (lazily created) family. */
  private bind(entry: { parent: Parent | null; family: EtatFamily | null }): EtatFamily | null {
    if (entry.family) return entry.family;
    if (entry.parent) {
      const family = this.makeExistingFamily(entry.parent);
      entry.family = family;
      return family;
    }
    return null;
  }
}

/**
 * PERF-503 (T-417): a bounded-concurrency worker pool.
 *
 * Processes `items` through `worker` with at most `limit` workers
 * running at any time (work-stealing over a shared cursor — JS's
 * single-threaded event loop makes the cursor increment atomic between
 * awaits, so no locking is needed). Workers never throw: a worker error
 * propagates out of `runPool` after the in-flight workers settle — the
 * caller (the engine) turns it into the atomic rollback, exactly like a
 * legacy per-row throw.
 */
async function runPool<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const width = Math.max(1, Math.min(limit, items.length));
  const runners: Array<Promise<void>> = [];
  for (let w = 0; w < width; w++) {
    runners.push(
      (async () => {
        while (true) {
          const index = cursor++;
          if (index >= items.length) return;
          await worker(items[index]);
        }
      })(),
    );
  }
  await Promise.all(runners);
}

/** Compute checksums asynchronously after batching (kept for API parity). */
export async function hashRecord(record: ImportRecord): Promise<string> {
  return objectChecksum(record as Record<string, unknown>);
}

/** Coerce a possibly-null/undefined/NaN field value to a clean number. */
function numOrZero(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v.trim().replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}
