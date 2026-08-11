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

/**
 * The kind of domain entity that was resolved for an inserted row.
 * The sync queue dispatcher uses this to route the row to the correct
 * `upsert_*_from_import` RPC (migration 0027).
 */
export type InsertedEntityKind = "parent" | "student" | "ledger_entry" | "payment" | "raw";

/**
 * A row inserted during an import run, together with the resolved domain
 * entities (Parent / Student / LedgerEntry) that were created or updated.
 *
 * The `record` field preserves the raw ImportRecord (French Excel fields)
 * for audit + reporting. The `entities` field carries the canonical domain
 * objects the sync queue needs to push to Supabase.
 *
 * CRITICAL: the sync queue's `defaultPushHandler` reads fields like
 * `firstName`, `lastName`, `displayName`, `parentId`, `amount`, etc. directly
 * off `payload`. Those fields live on the domain entities (Parent / Student /
 * LedgerEntry), NOT on the raw ImportRecord. Without this `entities` field,
 * the sync queue would receive a payload shaped like `{ nom, nem, tuteur, ... }`
 * and every RPC call would fail silently with `p_first_name = undefined`.
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
  readonly entities: ReadonlyArray<{ kind: InsertedEntityKind; entity: Parent | Student | LedgerEntry }>;
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
        return { action: "skip" };
      }
      action = "insert";
      studentId = result.value.id;
      resolvedStudent = result.value;
    }
    // Persist financial data (DEVIS ANNUEL charge, REMISE adjustment, DETTES
    // charge, REMBOURSEMENT refund, REGLEMENTS DETTES payments) to the ledger
    // so each student's transactions, balances, and payment history are
    // queryable from the CRM. Without this, financial data is dropped on
    // the floor — see iteration 21.
    let ledgerEntries: LedgerEntry[] = [];
    if (this.deps.ledger && studentId) {
      ledgerEntries = await this.persistFinancialEntries(record, parent.id, studentId, runId);
    }
    // Build the resolved-entities list for the sync queue. The sync queue's
    // defaultPushHandler reads firstName/lastName/displayName/parentId/amount
    // directly off payload — those fields live on the domain entities, NOT
    // on the raw ImportRecord. Without this list, every queue push sends
    // undefined fields to the upsert RPCs and Supabase never receives the
    // imported data.
    const entities: Array<{ kind: InsertedEntityKind; entity: Parent | Student | LedgerEntry }> = [
      { kind: "parent", entity: parent },
    ];
    if (resolvedStudent) {
      entities.push({ kind: "student", entity: resolvedStudent });
    }
    for (const le of ledgerEntries) {
      entities.push({ kind: "ledger_entry", entity: le });
    }
    this.trackInsertedRow("etat", record, ["NEM", "NOM"], runId, entities);
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
      // TUTEUR is a real name — use it as the COMPLETE display name.
      const tuteurParts = splitFullName(tuteurRaw);
      lastName = tuteurParts.lastName || "Inconnu";
      firstName = tuteurParts.firstName || "";
      displayName = tuteurRaw; // preserve the COMPLETE TUTEUR string verbatim
    } else if (record.nom) {
      // Derive parent name from student NOM (LASTNAME FIRSTNAME order).
      const nomParts = splitFullName(record.nom);
      if (nomParts.lastName) {
        lastName = nomParts.lastName;
        // Don't inherit the student's first name as the parent's — the
        // parent's firstName is left empty. The COMPLETE name is preserved
        // in `displayName` below.
        firstName = "";
      }
      // Preserve the FULL NOM string (e.g. "BENALI Mohamed") as the parent's
      // display name. This is the key fix — the UI will now show the
      // complete name instead of "Tuteur BENALI".
      displayName = String(record.nom).trim();
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
      return null;
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
  private async persistFinancialEntries(
    record: ImportRecord,
    parentId: string,
    studentId: string,
    runId: string,
  ): Promise<LedgerEntry[]> {
    if (!this.deps.ledger) return [];
    const ledger = this.deps.ledger;
    const tenantId = this.deps.tenantId;
    const actorId = this.deps.actorId ?? "excel-import";
    const actorName = this.deps.actorName ?? "Excel Import";
    const at = new Date().toISOString();

    // Build a set of existing (studentId, field) keys for this parent so we
    // can skip entries that were already imported. This makes re-imports
    // idempotent at the ledger level.
    const existingEntries = await this.listExistingImportEntriesForParent(parentId);
    const existingKeys = new Set<string>();
    for (const e of existingEntries) {
      const field = e.metadata?.field;
      if (field) existingKeys.add(`${e.studentId ?? ""}:${field}`);
    }

    const entries: LedgerEntry[] = [];
    // Helper to check if an entry already exists for this (studentId, field).
    const alreadyHas = (field: string): boolean =>
      existingKeys.has(`${studentId}:${field}`);

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
    if (devisAnnuel > 0 && !alreadyHas("DEVIS_ANNUEL")) {
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
    if (dettes > 0 && !alreadyHas("DETTES")) {
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
    if (remise > 0 && !alreadyHas("REMISE")) {
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
    if (remboursement > 0 && !alreadyHas("REMBOURSEMENT")) {
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
    if (reglementsDettes > 0 && !alreadyHas("REGLEMENTS_DETTES")) {
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
    if (fi > 0 && !alreadyHas("FI")) {
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
    if (v2 > 0 && !alreadyHas("V2")) {
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
    if (v2Alt > 0 && !alreadyHas("V2_ALT")) {
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
    if (v3 > 0 && !alreadyHas("V3")) {
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
    if (t1 > 0 && !alreadyHas("T1")) {
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
    if (t2 > 0 && !alreadyHas("T2")) {
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
    if (t3 > 0 && !alreadyHas("T3")) {
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
    if (psy1 > 0 && !alreadyHas("PSY1")) {
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
    if (psy2 > 0 && !alreadyHas("PSY2")) {
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
    if (orth1 > 0 && !alreadyHas("ORTH1")) {
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
    if (orth2 > 0 && !alreadyHas("ORTH2")) {
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
    if (eplant > 0 && !alreadyHas("EPLANT")) {
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
    if (ratrapage > 0 && !alreadyHas("RATRAPAGE")) {
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

    if (septembre > 0 && !alreadyHas("SEPTEMBRE")) {
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

    if (decembre > 0 && !alreadyHas("DECEMBRE")) {
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

    if (mars > 0 && !alreadyHas("MARS")) {
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

    if (entries.length === 0) return [];
    await ledger.appendMany(entries);
    return entries;
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
    entities: ReadonlyArray<{ kind: InsertedEntityKind; entity: Parent | Student | LedgerEntry }>,
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
