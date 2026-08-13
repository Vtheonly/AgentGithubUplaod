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
import { StorageAdapter, type StorageRecord, type RunAuditEntry } from "./storage-adapter";
import { uuid } from "../utils/id";
import type { ParentRepository, StudentRepository, LedgerRepository, PaymentRepository, InstallmentRepository, ImportInstallmentInput } from "../../../../domain/repository/repository";
import type { Parent, CreateParentInput } from "../../../../domain/model/parent";
import type { CreateStudentInput, Student } from "../../../../domain/model/student";
import type { LedgerEntry } from "../../../../domain/model/ledger";
import type { Payment, Installment, PaymentCategory, AcademicCycle, CollectPaymentInput } from "../../../../domain/model/payment";
import { createChargeEntry, createPaymentEntry, createAdjustmentEntry } from "../../../../domain/calc/ledger/entries";
import { mapNiveauCode } from "../mappers/niveau-mapper";
import { splitFullName } from "../mappers/name-splitter";
import {
  mapExcelDestinationToCanonical,
  OFFICIAL_TUITION_SCHEDULE,
  OFFICIAL_TRANSPORT_SCHEDULE,
} from "../mappers/destination-mapper";

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
  /** Progress callback — called after each row is processed. */
  progressCallback: ((processed: number, total: number, currentRow: string) => void) | null = null;

  constructor(deps: RepositoryStorageAdapterDeps) {
    super();
    this.deps = deps;
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
  }

  async beginTransaction(): Promise<void> {
    // Clear the batch buffers at the start of a new import run.
    this.pendingLedgerEntries = [];
    this.pendingPayments = [];
    this.pendingInstallments = [];
  }

  async commitTransaction(): Promise<void> {
    // BULK IMPORT SPEED FIX: Flush all pending writes in bulk.
    await this.flushPendingBatches();
  }

  /**
   * Flush all pending ledger entries, payments, and installments using
   * the bulk methods. Called once at the end of the import (in
   * `commitTransaction`). This is the key optimization that turns
   * 18,000 individual RPC calls into ~3 bulk INSERT calls.
   */
  private async flushPendingBatches(): Promise<void> {
    // Flush ledger entries.
    if (this.pendingLedgerEntries.length > 0 && this.deps.ledger) {
      try {
        if (typeof this.deps.ledger.bulkAppend === "function") {
          await this.deps.ledger.bulkAppend(this.pendingLedgerEntries);
        } else {
          await this.deps.ledger.appendMany(this.pendingLedgerEntries);
        }
      } catch (e) {
        console.warn("[ExcelImport] bulk ledger flush failed:", e);
      }
      this.pendingLedgerEntries = [];
    }
    // Flush payments.
    if (this.pendingPayments.length > 0 && this.deps.payments) {
      try {
        if (typeof this.deps.payments.bulkCollect === "function") {
          await this.deps.payments.bulkCollect(this.pendingPayments);
        } else {
          for (const { input, collectedBy } of this.pendingPayments) {
            await this.deps.payments.collect(input, collectedBy);
          }
        }
      } catch (e) {
        console.warn("[ExcelImport] bulk payment flush failed:", e);
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
        console.warn("[ExcelImport] bulk installment flush failed:", e);
      }
      this.pendingInstallments = [];
    }
  }

  async rollbackTransaction(): Promise<void> {
    // Clear the batch buffers + per-run insertion log on rollback.
    this.pendingLedgerEntries = [];
    this.pendingPayments = [];
    this.pendingInstallments = [];
    this.rowsByRun.clear();
  }

  async upsertRecord(
    schema: ImportSchema,
    record: ImportRecord,
    identityKeys: readonly string[],
    runId: string,
  ): Promise<UpsertResult> {
    // Track the current runId so ensureParent / ensureStudent can tag
    // their errors with the right run for later display in the modal.
    this.currentRunId = runId;
    if (schema.name === "etat") {
      return this.upsertEtatRecord(record, runId);
    }
    // Non-ETAT schemas fall back to in-memory tracking (BON, Devis, REF).
    return this.upsertTrackedRecord(schema, record, identityKeys, runId);
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

  // ── ETAT upsert ────────────────────────────────────────────────────────

  private async upsertEtatRecord(
    record: ImportRecord,
    runId: string,
  ): Promise<UpsertResult> {
    const parent = await this.ensureParent(record);
    if (!parent) {
      return { action: "skip" };
    }
    const studentInput = this.buildStudentInput(record);
    const existing = await this.findExistingStudent(parent, studentInput);
    let action: "insert" | "update" | "skip";
    let studentId: string | null = null;
    let resolvedStudent: Student | null = null;
    if (existing) {
      // Actually call updateStudent() so changes to grade level, transport
      // tier, class assignment, etc. propagate on re-import. The previous
      // implementation set `action = "update"` but never called the update
      // method — leaving the existing record unchanged.
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
        // Update failed — fall back to the existing ID so financial entries
        // still land against the right student.
        action = "update";
        studentId = existing.id;
        resolvedStudent = existing;
      }
    } else {
      const result = await this.deps.students.createStudent(parent.id, studentInput);
      if (!result.ok) {
        // Surface the student creation error (same pattern as ensureParent).
        const errMsg = formatErrorMessage(result.error);
        const rowIndex = typeof (record as { __rowIndex?: number }).__rowIndex === "number"
          ? (record as { __rowIndex: number }).__rowIndex
          : 0;
        const identity = studentInput.displayName ?? `${studentInput.firstName} ${studentInput.lastName}`;
        const list = this.errorsByRun.get(runId) ?? [];
        list.push({ rowIndex, identity, error: `Student creation failed: ${errMsg}` });
        this.errorsByRun.set(runId, list);
        // Throttle console output: only log the first student creation
        // failure per run (same rationale as ensureParent).
        if (list.filter((e) => e.error.startsWith("Student creation failed")).length === 1) {
          // eslint-disable-next-line no-console
          console.error(
            `[ExcelImport] Student creation FAILED for row ${rowIndex} (${identity}): ${errMsg}`,
            result.error,
          );
        }
        return { action: "skip" };
      }
      action = "insert";
      studentId = result.value.id;
      resolvedStudent = result.value;
    }
    // BULK IMPORT SPEED FIX: Build the ledger entries / payments / installments
    // and add them to the pending batch buffers. The actual Supabase writes
    // happen ONCE at the end of the import (in `commitTransaction`) via the
    // bulk methods (`bulkAppend`, `bulkCollect`, `bulkImportInstallments`).
    // This turns ~18,000 individual RPC calls into ~3 bulk INSERT calls.
    let ledgerEntries: LedgerEntry[] = [];
    if (this.deps.ledger && studentId) {
      ledgerEntries = this.buildFinancialEntries(record, parent.id, studentId, runId);
      this.pendingLedgerEntries.push(...ledgerEntries);
    }
    // Build payment rows (deferred — flushed in commitTransaction).
    let paymentRows: Payment[] = [];
    if (this.deps.payments && studentId) {
      paymentRows = this.buildPaymentRows(record, parent.id, studentId, runId);
      // Add to pending batch — the actual collect() calls happen in
      // commitTransaction via bulkCollect.
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
    // Build installment rows (deferred — flushed in commitTransaction).
    let installmentRows: Installment[] = [];
    if (this.deps.installments && studentId) {
      installmentRows = this.buildInstallmentRows(record, parent.id, studentId, resolvedStudent, runId);
      // Add to pending batch — the actual importInstallment() calls happen
      // in commitTransaction via bulkImportInstallments.
      for (const inst of installmentRows) {
        const trancheNum = Number(inst.label.match(/Tranche (\d)/)?.[1] ?? "1") as 1 | 2 | 3;
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
    // Notify progress callback if registered.
    if (this.progressCallback) {
      this.progressCallback(0, 0, String(record.nom ?? ""));
    }
    // Build the resolved-entities list for the sync queue. The sync queue's
    // defaultPushHandler reads firstName/lastName/displayName/parentId/amount
    // directly off payload — those fields live on the domain entities, NOT
    // on the raw ImportRecord. Without this list, every queue push sends
    // undefined fields to the upsert RPCs and Supabase never receives the
    // imported data.
    const entities: Array<{ kind: InsertedEntityKind; entity: Parent | Student | LedgerEntry | Payment | Installment }> = [
      { kind: "parent", entity: parent },
    ];
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
    return { action };
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

  private async ensureParent(record: ImportRecord): Promise<Parent | null> {
    const input = this.buildParentInput(record);
    const existing = await this.findExistingParent(input);
    if (existing) return existing;
    const result = await this.deps.parents.createParent(input);
    if (!result.ok) {
      const errMsg = formatErrorMessage(result.error);
      const rowIndex = typeof (record as { __rowIndex?: number }).__rowIndex === "number"
        ? (record as { __rowIndex: number }).__rowIndex
        : 0;
      const identity = input.displayName ?? input.phone ?? input.lastName ?? "(unknown)";
      const runId = this.currentRunId ?? "unknown";
      const list = this.errorsByRun.get(runId) ?? [];
      list.push({ rowIndex, identity, error: errMsg });
      this.errorsByRun.set(runId, list);
      // Throttle console output: only the FIRST failure of each run logs
      // the full error (with stack/object). Subsequent failures are
      // tracked in `errorsByRun` and surfaced in the modal — flooding the
      // console with 390 identical "column reference is ambiguous" errors
      // makes DevTools unusable.
      if (list.length === 1) {
        // eslint-disable-next-line no-console
        console.error(
          `[ExcelImport] Parent creation FAILED for row ${rowIndex} (${identity}): ${errMsg}`,
          result.error,
        );
        // eslint-disable-next-line no-console
        console.warn(
          `[ExcelImport] Further parent creation failures in this run will be ` +
          `collected silently and shown in the modal. Run ID: ${runId}`,
        );
      }
      return null;
    }
    return result.value;
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

  /**
   * Find an existing parent by phone first; when phone is "(inconnu)"
   * (blank NEM), fall back to matching on (firstName, lastName, displayName)
   * so that re-imports don't create duplicate placeholder parents.
   *
   * The match strategy is intentionally multi-pronged to keep imports
   * idempotent across the migration from the old "Tuteur <LastName>" format
   * to the new displayName-based format:
   *   1. Exact phone match.
   *   2. Exact (firstName, lastName) match — handles both the old placeholder
   *      format and the new empty-firstName format.
   *   3. Exact displayName match — the canonical idempotency key for
   *      placeholder parents.
   */
  private async findExistingParent(input: CreateParentInput): Promise<Parent | null> {
    if (input.phone && input.phone !== "(inconnu)") {
      const result = await this.deps.parents.search(input.phone);
      if (result.ok) {
        const match = result.value.find((p) => p.phone === input.phone);
        if (match) return match;
      }
    }
    if (input.email) {
      const result = await this.deps.parents.search(input.email);
      if (result.ok) {
        const match = result.value.find((p) => p.email === input.email);
        if (match) return match;
      }
    }
    // Placeholder parent — match by name to keep re-imports idempotent.
    const query = input.displayName ?? input.lastName ?? input.firstName ?? "";
    const result = await this.deps.parents.search(query);
    if (!result.ok) return null;
    return (
      result.value.find(
        (p) =>
          p.phone === "(inconnu)" &&
          p.firstName === input.firstName &&
          p.lastName === input.lastName,
      ) ??
      result.value.find(
        (p) =>
          p.phone === "(inconnu)" &&
          input.displayName !== null &&
          p.displayName === input.displayName,
      ) ??
      // Backward-compat: also match the OLD placeholder format where
      // firstName was "Tuteur". This lets a re-import upgrade an existing
      // row to the new displayName format instead of creating a duplicate.
      result.value.find(
        (p) =>
          p.phone === "(inconnu)" &&
          p.firstName === "Tuteur" &&
          p.lastName === input.lastName,
      ) ??
      null
    );
  }

  private buildStudentInput(record: ImportRecord): CreateStudentInput {
    const nameParts = splitFullName(record.nom);
    const mapping = mapNiveauCode(record.niveau);
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
      birthDate: "2000-01-01",
      level: mapping.academicLevel,
      gradeYear: mapping.gradeYear,
      gradeLevel: mapping.gradeLevel,
      classId: null,
      medicalNotes: null,
      transportTier: distination ?? optionCode,
    };
  }

  private async findExistingStudent(
    parent: Parent,
    input: CreateStudentInput,
  ): Promise<Student | null> {
    const result = await this.deps.students.search(
      `${input.firstName} ${input.lastName}`.trim(),
    );
    if (!result.ok) return null;
    const match = result.value.find((s) => s.parentId === parent.id);
    return match ?? null;
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
   * List existing bulk-import ledger entries for a parent. Used by
   * `persistFinancialEntries` to dedupe re-imports — if an entry with the
   * same (studentId, field) already exists, it's skipped rather than
   * appended again.
   *
   * The LedgerRepository interface doesn't expose a synchronous "list"
   * method, but every implementation's `observe()` returns an Observable
   * whose `.get()` returns the current cached array. We use that.
   */
  private async listExistingImportEntriesForParent(parentId: string): Promise<LedgerEntry[]> {
    if (!this.deps.ledger) return [];
    try {
      const obs = this.deps.ledger.observeByParent(parentId);
      const all = typeof obs.get === "function" ? obs.get() : [];
      return all.filter(
        (e) => e.sourceType === "bulk_import" && e.metadata?.field,
      );
    } catch {
      // If the observable isn't available (e.g. in tests with a stub
      // repository), skip dedup — append everything.
      return [];
    }
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
   * Dedup note: re-import idempotency is now handled at the DB level by
   * the `upsert_ledger_entry_from_import` RPC's identity match on
   * `(tenant, source_type, source_id)`. The old client-side dedup
   * (`listExistingImportEntriesForParent`) was slow (fetched all entries
   * per parent) and is no longer needed.
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

    // REMISE — discount applied to the annual quote (credit adjustment).
    if (remise > 0) {
      entries.push(
        createAdjustmentEntry({
          tenantId,
          parentId,
          studentId,
          category: "tuition",
          amount: -remise, // negative = credit (discount)
          reason: `Remise sur devis (import Excel run ${runId})`,
          sourceType: "bulk_import",
          sourceId: sid("REMISE"),
          actorId,
          actorName,
          at,
          metadata: { field: "REMISE", importRunId: runId },
        }),
      );
    }

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
   * PAYMENT BREAKDOWN: Each payment includes `expectedAmount` — the real
   * expected amount for the corresponding tranche from `Prices.md`. When
   * the paid amount exceeds the expected, `excessAmount` + `excessRemark`
   * are set so the UI can show the overpayment clearly.
   */
  private buildPaymentRows(
    record: ImportRecord,
    parentId: string,
    studentId: string,
    runId: string,
  ): Payment[] {
    const actorId = this.deps.actorId ?? "excel-import";
    const at = new Date().toISOString();

    // REAL PRICING from Prices.md — look up expected amounts per tranche.
    const mapping = mapNiveauCode(record.niveau);
    const gradeLevel = mapping.gradeLevel;
    const tuitionSchedule = OFFICIAL_TUITION_SCHEDULE[gradeLevel] ?? [0, 0, 0, 0];
    const tuitionAnnual = tuitionSchedule[0];
    const remise = numOrZero(record.remise);
    const remiseRatio = tuitionAnnual > 0 ? Math.max(0, 1 - remise / tuitionAnnual) : 1;

    // Expected tuition tranche amounts (after REMISE).
    const expectedTuitionTranches: [number, number, number] = [
      Math.round(tuitionSchedule[1] * remiseRatio),
      Math.round(tuitionSchedule[2] * remiseRatio),
      Math.round(tuitionSchedule[3] * remiseRatio),
    ];

    // Expected transport tranche amounts.
    const canonicalDestination = mapExcelDestinationToCanonical(record.distination);
    const transportSchedule = OFFICIAL_TRANSPORT_SCHEDULE[canonicalDestination];
    const expectedTransportTranches: [number, number, number] = [
      transportSchedule[1],
      transportSchedule[2],
      transportSchedule[3],
    ];

    // Each entry: [field, amount, category, description, expectedAmount]
    // expectedAmount = the real expected amount for this tranche from Prices.md.
    type PaymentSpec = [string, number, PaymentCategory, string, number];
    const specs: PaymentSpec[] = [
      ["REGLEMENTS_DETTES", numOrZero(record.reglementsDettes), "tuition", "Règlement dettes antérieures", 0],
      ["FI", numOrZero(record.fi), "tuition", "Frais d'inscription (FI) — Tranche 1", expectedTuitionTranches[0]],
      ["V2", numOrZero(record.v2), "tuition", "Versement 2 (V2) — Tranche 2", expectedTuitionTranches[1]],
      ["V2_ALT", numOrZero(record.v2Alt), "tuition", "Versement 2 alternatif (2V) — Tranche 2", expectedTuitionTranches[1]],
      ["V3", numOrZero(record.v3), "tuition", "Versement 3 (v3) — Tranche 3", expectedTuitionTranches[2]],
      ["T1", numOrZero(record.t1), "transport", `Tranche 1 transport (1T) — ${canonicalDestination}`, expectedTransportTranches[0]],
      ["T2", numOrZero(record.t2), "transport", `Tranche 2 transport (T2) — ${canonicalDestination}`, expectedTransportTranches[1]],
      ["T3", numOrZero(record.t3), "transport", `Tranche 3 transport (t3) — ${canonicalDestination}`, expectedTransportTranches[2]],
      ["PSY1", numOrZero(record.psy1), "therapy_psychology", "Séance psychologie 1 (PSY1)", 10_000],
      ["PSY2", numOrZero(record.psy2), "therapy_psychology", "Séance psychologie 2 (PSY2)", 10_000],
      ["ORTH1", numOrZero(record.orth1), "therapy_speech", "Séance orthophonie 1 (ORTH1)", 10_000],
      ["ORTH2", numOrZero(record.orth2), "therapy_speech", "Séance orthophonie 2 (ORTH2)", 10_000],
      ["EPLANT", numOrZero(record.eplant), "other", "E-PLANT (plan d'accompagnement)", 0],
      ["RATRAPAGE", numOrZero(record.ratrapage), "tuition", "Rattrapage", 0],
      ["SEPTEMBRE", numOrZero(record.septembre), "tuition", "Tranche septembre — Tranche 1", expectedTuitionTranches[0]],
      ["DECEMBRE", numOrZero(record.decembre), "tuition", "Tranche décembre — Tranche 2", expectedTuitionTranches[1]],
      ["MARS", numOrZero(record.mars), "tuition", "Tranche mars — Tranche 3", expectedTuitionTranches[2]],
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
  // The Excel file models tuition as 3 tranches (FI/V2/v3) and transport as
  // 3 tranches (1T/T2/t3). The installer creates one `installments` row per
  // tranche, marking them paid/partial/unpaid according to the imported
  // amounts. The official schedule per `Prices.md` is Sept 15 / Dec 15 /
  // Mar 15 for ALL cycles and for Transport.

  /**
   * BUILD INSTALLMENT ROWS (deferred write — added to pendingInstallments).
   *
   * Returns Installment objects WITHOUT calling `installments.importInstallment()`.
   * The caller adds them to `pendingInstallments`, and the actual write
   * happens ONCE in `commitTransaction` via `bulkImportInstallments`.
   *
   * PRICING FIX: Uses the REAL prices from `Prices.md` (not made-up
   * percentages). The tuition tranche amounts are looked up per grade
   * level from `OFFICIAL_TUITION_SCHEDULE`. The transport tranche amounts
   * are looked up per destination from `OFFICIAL_TRANSPORT_SCHEDULE`.
   */
  private buildInstallmentRows(
    record: ImportRecord,
    parentId: string,
    studentId: string,
    student: Student | null,
    runId: string,
  ): Installment[] {
    void runId;
    const now = new Date();

    // Resolve the academic cycle + grade level for pricing lookup.
    const mapping = mapNiveauCode(record.niveau);
    const cycle: AcademicCycle = mapping.academicLevel === "lycee"
      ? "lycee"
      : mapping.academicLevel === "cem"
        ? "cem"
        : "primaire";
    const gradeLevel = mapping.gradeLevel;

    // Official due dates — Sept 15 / Dec 15 / Mar 15 per `Prices.md`.
    const academicYearStart = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
    const dueDates: [string, string, string] = [
      `${academicYearStart}-09-15`,
      `${academicYearStart}-12-15`,
      `${academicYearStart + 1}-03-15`,
    ];

    // REAL TUITION PRICES from Prices.md — look up by grade level.
    // Each schedule is [annual, tranche1, tranche2, tranche3].
    const tuitionSchedule = OFFICIAL_TUITION_SCHEDULE[gradeLevel] ?? [0, 0, 0, 0];
    const tuitionAnnual = tuitionSchedule[0];
    const tuitionTrancheDue: [number, number, number] = [
      tuitionSchedule[1],
      tuitionSchedule[2],
      tuitionSchedule[3],
    ];

    // Apply the REMISE (discount) — subtract from the annual, then
    // redistribute proportionally across the 3 tranches.
    const remise = numOrZero(record.remise);
    let netTuitionTrancheDue = tuitionTrancheDue;
    if (remise > 0 && tuitionAnnual > 0) {
      const ratio = Math.max(0, 1 - remise / tuitionAnnual);
      netTuitionTrancheDue = [
        Math.round(tuitionTrancheDue[0] * ratio),
        Math.round(tuitionTrancheDue[1] * ratio),
        Math.round(tuitionTrancheDue[2] * ratio),
      ];
    }

    // Tuition amounts PAID — from the Excel payment columns.
    // FI (frais d'inscription) + SEPTEMBRE → tranche 1
    // V2 + V2_ALT + DECEMBRE → tranche 2
    // V3 + MARS + RATRAPAGE → tranche 3
    const tuitionTranchePaid: [number, number, number] = [
      numOrZero(record.fi) + numOrZero(record.septembre),
      numOrZero(record.v2) + numOrZero(record.v2Alt) + numOrZero(record.decembre),
      numOrZero(record.v3) + numOrZero(record.mars) + numOrZero(record.ratrapage),
    ];

    // REAL TRANSPORT PRICES from Prices.md — look up by destination.
    // Map the Excel DISTINATION (raw town name) → canonical TransportDestination.
    const hasTransport =
      !!record.distination ||
      String(record.option ?? "").toUpperCase() === "TRNSP";
    const canonicalDestination = mapExcelDestinationToCanonical(record.distination);
    const transportSchedule = OFFICIAL_TRANSPORT_SCHEDULE[canonicalDestination];
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

    const results: Installment[] = [];

    const buildInstallment = (
      category: PaymentCategory,
      trancheNumber: 1 | 2 | 3,
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

    // Tuition installments (3 tranches) — use REAL Prices.md amounts.
    for (let i = 0; i < 3; i++) {
      const trancheNumber = (i + 1) as 1 | 2 | 3;
      const amountDue = netTuitionTrancheDue[i];
      const amountPaid = tuitionTranchePaid[i];
      if (amountDue === 0 && amountPaid === 0) continue;
      results.push(buildInstallment(
        "tuition", trancheNumber, `Tranche ${trancheNumber} — Scolarité`,
        amountDue, amountPaid, dueDates[i],
      ));
    }

    // Transport installments (3 tranches) — use REAL Prices.md amounts.
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
