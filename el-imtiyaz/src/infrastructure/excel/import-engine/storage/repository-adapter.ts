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
import type { ParentRepository, StudentRepository, LedgerRepository } from "../../../../domain/repository/repository";
import type { Parent, CreateParentInput } from "../../../../domain/model/parent";
import type { CreateStudentInput, Student } from "../../../../domain/model/student";
import type { LedgerEntry } from "../../../../domain/model/ledger";
import { createChargeEntry, createPaymentEntry, createAdjustmentEntry } from "../../../../domain/calc/ledger/entries";
import { mapNiveauCode } from "../mappers/niveau-mapper";
import { splitFullName } from "../mappers/name-splitter";

export interface RepositoryStorageAdapterDeps {
  readonly parents: ParentRepository;
  readonly students: StudentRepository;
  /** Optional — when provided, the adapter writes charge/payment/adjustment
   * ledger entries for each ETAT row's financial fields. Without a ledger,
   * financial data (DEVIS ANNUEL, DETTES, REMISE, REGLEMENTS) is captured
   * in the import context but not persisted. */
  readonly ledger?: LedgerRepository;
  readonly tenantId: string;
  readonly actorId?: string;
  readonly actorName?: string;
}

interface InsertedRow {
  readonly id: string;
  readonly schemaName: string;
  readonly runId: string;
  readonly record: ImportRecord;
  readonly identity: Record<string, string | number>;
  readonly checksum: string;
  readonly insertedAt: string;
}

export class RepositoryStorageAdapter extends StorageAdapter {
  private readonly deps: RepositoryStorageAdapterDeps;
  private readonly rowsByRun: Map<string, InsertedRow[]> = new Map();
  private readonly runs: Map<string, RunAuditEntry> = new Map();
  private initialized = false;

  constructor(deps: RepositoryStorageAdapterDeps) {
    super();
    this.deps = deps;
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
  }

  async beginTransaction(): Promise<void> {
    // Repositories handle their own atomicity at the per-call level.
    // Cross-row atomicity is the engine's responsibility via rollback.
  }
  async commitTransaction(): Promise<void> {
    // No-op — see beginTransaction.
  }
  async rollbackTransaction(): Promise<void> {
    // Best-effort rollback: clear the per-run insertion log so the sync
    // queue doesn't enqueue rows whose parent transaction failed.
    this.rowsByRun.clear();
  }

  async upsertRecord(
    schema: ImportSchema,
    record: ImportRecord,
    identityKeys: readonly string[],
    runId: string,
  ): Promise<UpsertResult> {
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
    if (existing) {
      action = "update";
      studentId = existing.id;
    } else {
      const result = await this.deps.students.createStudent(parent.id, studentInput);
      if (!result.ok) {
        return { action: "skip" };
      }
      action = "insert";
      studentId = result.value.id;
    }
    // Persist financial data (DEVIS ANNUEL charge, REMISE adjustment, DETTES
    // charge, REMBOURSEMENT refund, REGLEMENTS DETTES payments) to the ledger
    // so each student's transactions, balances, and payment history are
    // queryable from the CRM. Without this, financial data is dropped on
    // the floor — see iteration 21.
    if (this.deps.ledger && studentId) {
      await this.persistFinancialEntries(record, parent.id, studentId, runId);
    }
    this.trackInsertedRow("etat", record, ["NEM", "NOM"], runId);
    return { action };
  }

  private async ensureParent(record: ImportRecord): Promise<Parent | null> {
    const input = this.buildParentInput(record);
    const existing = await this.findExistingParent(input);
    if (existing) return existing;
    const result = await this.deps.parents.createParent(input);
    return result.ok ? result.value : null;
  }

  private buildParentInput(record: ImportRecord): CreateParentInput {
    const phone = this.extractPhone(record);
    const tuteurRaw = (record.tuteur as string | undefined)?.trim();
    const tuteurParts = splitFullName(tuteurRaw);
    const firstName = tuteurParts.firstName || "Tuteur";
    const lastName = tuteurParts.lastName || "Inconnu";
    const email = (record.email as string | undefined)?.trim() || null;
    return {
      firstName,
      lastName,
      gender: "unspecified",
      phone: phone || "(inconnu)",
      email,
      preferredLanguage: "fr",
    };
  }

  /**
   * Find an existing parent by phone first; when phone is "(inconnu)"
   * (blank NEM), fall back to matching on (firstName, lastName) so that
   * re-imports don't create duplicate placeholder parents.
   */
  private async findExistingParent(input: CreateParentInput): Promise<Parent | null> {
    if (input.phone && input.phone !== "(inconnu)") {
      const result = await this.deps.parents.search(input.phone);
      if (result.ok) {
        const match = result.value.find((p) => p.phone === input.phone);
        if (match) return match;
      }
      return null;
    }
    // Placeholder parent — match by name to keep re-imports idempotent.
    const result = await this.deps.parents.search(input.firstName || input.lastName);
    if (!result.ok) return null;
    return (
      result.value.find(
        (p) =>
          p.phone === "(inconnu)" &&
          p.firstName === input.firstName &&
          p.lastName === input.lastName,
      ) ?? null
    );
  }

  private buildStudentInput(record: ImportRecord): CreateStudentInput {
    const nameParts = splitFullName(record.nom);
    const mapping = mapNiveauCode(record.niveau);
    return {
      firstName: nameParts.firstName,
      lastName: nameParts.lastName || "Inconnu",
      gender: "unspecified",
      birthDate: "2000-01-01",
      level: mapping.academicLevel,
      gradeYear: mapping.gradeYear,
      gradeLevel: mapping.gradeLevel,
      classId: null,
      medicalNotes: null,
      transportTier: (record.option as string | undefined)?.trim() || null,
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

  // ── Financial persistence ─────────────────────────────────────────────
  //
  // Each ETAT row carries 5 financial fields that MUST be persisted to the
  // ledger so each student's transactions, balances, and payment history
  // are queryable from the CRM:
  //
  //   DEVIS ANNUEL    → charge entry (category: tuition)
  //   DETTES          → charge entry (category: tuition — outstanding debt carried over)
  //   REMISE          → adjustment entry (negative — discount, category: tuition)
  //   REMBOURSEMENT   → refund entry (category: tuition)
  //   REGLEMENTS DETTES (12-month array) → 12 payment entries (category: tuition)
  //
  // All entries are tagged with sourceType="bulk_import" and sourceId=runId
  // so they can be traced back to the originating import run. Re-imports
  // are idempotent at the row level: the engine's UpsertMatcher decides
  // insert vs update; the ledger append is always additive (the engine
  // dedupes by row checksum before reaching this point).
  private async persistFinancialEntries(
    record: ImportRecord,
    parentId: string,
    studentId: string,
    runId: string,
  ): Promise<void> {
    if (!this.deps.ledger) return;
    const ledger = this.deps.ledger;
    const tenantId = this.deps.tenantId;
    const actorId = this.deps.actorId ?? "excel-import";
    const actorName = this.deps.actorName ?? "Excel Import";
    const at = new Date().toISOString();
    const entries: LedgerEntry[] = [];

    const devisAnnuel = numOrZero(record.devisAnnuel);
    const dettes = numOrZero(record.dettes);
    const remise = numOrZero(record.remise);
    const remboursement = numOrZero(record.remboursement);
    const reglements = record.reglements;
    const regMap = isMonthMap(reglements) ? reglements : {};

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
          sourceId: runId,
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
          sourceId: runId,
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
          sourceId: runId,
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
          sourceId: runId,
          actorId,
          actorName,
          at,
          metadata: { field: "REMBOURSEMENT", importRunId: runId },
        }),
      );
    }

    // REGLEMENTS DETTES — 12 monthly payments (sep..aug). Each non-zero
    // month becomes a separate payment entry so the student's payment
    // history is granular and matches the Excel sheet exactly.
    const MONTH_KEYS = ["sep", "oct", "nov", "dec", "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug"];
    for (const month of MONTH_KEYS) {
      const amount = numOrZero(regMap[month]);
      if (amount <= 0) continue;
      entries.push(
        createPaymentEntry({
          tenantId,
          parentId,
          studentId,
          category: "tuition",
          amount,
          method: "cash", // assumed — the Excel sheet doesn't record the method
          receiptNumber: `${runId}-${month}`,
          paymentStatus: "paid",
          sourceType: "bulk_import",
          sourceId: runId,
          description: `Règlement dettes ${month} (import Excel run ${runId})`,
          actorId,
          actorName,
          at,
          metadata: { field: "REGLEMENTS_DETTES", month, importRunId: runId },
        }),
      );
    }

    if (entries.length === 0) return;
    await ledger.appendMany(entries);
  }

  // ── Generic tracked upsert (BON, Devis, REF) ──────────────────────────

  private async upsertTrackedRecord(
    schema: ImportSchema,
    record: ImportRecord,
    identityKeys: readonly string[],
    runId: string,
  ): Promise<UpsertResult> {
    this.trackInsertedRow(schema.name, record, identityKeys, runId);
    return { action: "insert" };
  }

  private trackInsertedRow(
    schemaName: string,
    record: ImportRecord,
    identityKeys: readonly string[],
    runId: string,
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

/** Type guard: is the value a `Record<string, number>` month map? */
function isMonthMap(v: unknown): v is Record<string, number> {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  for (const val of Object.values(v as Record<string, unknown>)) {
    if (typeof val !== "number") return false;
  }
  return true;
}
