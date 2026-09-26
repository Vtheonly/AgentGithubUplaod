/**
 * Storage adapter interface.
 *
 * Ported from `excel-import-engine/src/storage/StorageAdapter.js`. The
 * interface is identical; only the implementations differ — the standalone
 * engine shipped `SqliteAdapter` (better-sqlite3, native) and `JsonAdapter`
 * (file-system JSON). The renderer-compatible port ships `InMemoryAdapter`
 * (keeps run history + records in memory, persists via the project's
 * `ImportRunRepository` for cross-session durability).
 *
 * All methods are `async` even when the underlying implementation is
 * synchronous — this matches the standalone engine's uniformity contract
 * and lets us swap adapters without touching call sites.
 */
import type { ImportSchema, ImportRecord, UpsertResult, ImportIssue, SheetResult, RunStats } from "../types";
import type { ImportContext } from "../import-context";

/**
 * PERF-503 (T-417): one row of a batch upsert request.
 *
 * `rowIndex` is the 1-based worksheet row — the same value the per-row
 * path derived from `record.__rowIndex`; carrying it explicitly lets the
 * batch implementation report per-row errors with the exact row number
 * without reading it back off the raw record.
 */
export interface BatchUpsertRow {
  readonly record: ImportRecord;
  readonly rowIndex: number;
}

/**
 * PERF-503 (T-417): write-phase progress reporter.
 *
 * `written` counts rows whose storage write completed; `total` is the
 * batch size; `currentRow` is a human label (the student name) for the
 * most recently completed row. The engine re-emits this as
 * `sheet:progress` events so the write phase is visible in the UI the
 * same way the parse phase already is.
 */
export type BatchProgressCallback = (
  written: number,
  total: number,
  currentRow: string,
) => void;

export interface StorageRecord {
  readonly id: string;
  readonly schemaName: string;
  readonly record: ImportRecord;
  readonly identity: Record<string, string | number>;
  readonly firstImportedRunId: string;
  readonly firstImportedAt: string;
  readonly lastUpdatedRunId: string;
  readonly lastUpdatedAt: string;
  readonly checksum: string;
  /**
   * Resolved domain entities (Parent / Student / LedgerEntry) that were
   * created or updated for this row. Used by the sync queue to push the
   * correct shape to the `upsert_*_from_import` RPCs.
   *
   * Each entry is tagged with its entity kind so the dispatcher can route
   * to the right RPC. The entity object is the canonical domain model
   * (firstName, lastName, displayName, parentId, amount, etc.) — NOT the
   * raw French Excel fields.
   *
   * May be empty for non-ETAT schemas (BON, Devis, REF) that don't resolve
   * to domain entities.
   */
  readonly entities?: ReadonlyArray<{ kind: string; entity: unknown }>;
}

export interface RunAuditEntry {
  readonly runId: string;
  readonly filePath: string;
  readonly fileChecksum: string | null;
  readonly fileSize: number;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly durationMs: number | null;
  readonly options: Record<string, unknown>;
  readonly source: Record<string, unknown>;
  readonly stats: RunStats;
  readonly sheetResults: SheetResult[];
  readonly errors: ImportIssue[];
  readonly warnings: ImportIssue[];
  readonly status: "running" | "success" | "partial" | "failed";
}

/**
 * IMPORT-114 (T-420, 2026-09-27): the outcome of the LAST compensating
 * rollback — what the best-effort per-entity deletes actually achieved.
 *
 * Live evidence (issue #20): under pool exhaustion the rollback itself died
 * partway (384 soft-deletes succeeded, 463 students survived from a
 * "failed" import) and the engine swallowed the failure — the user was told
 * the import was annulled while the database kept a corrupted half-state.
 * The engine now surfaces this: when `failedStudents + failedParents > 0`
 * the thrown error carries an explicit partial-state warning.
 */
export interface RollbackOutcome {
  readonly studentsDeleted: number;
  readonly parentsDeleted: number;
  readonly failedStudents: number;
  readonly failedParents: number;
}

export abstract class StorageAdapter {
  abstract init(): Promise<void>;
  abstract beginTransaction(): Promise<void>;
  abstract commitTransaction(): Promise<void>;
  abstract rollbackTransaction(): Promise<void>;

  /** Upsert a record by schema identity. Returns the action taken. */
  abstract upsertRecord(
    schema: ImportSchema,
    record: ImportRecord,
    identityKeys: readonly string[],
    runId: string,
  ): Promise<UpsertResult>;

  /**
   * PERF-503 (T-417): upsert a WHOLE sheet's validated rows in one call.
   *
   * This is the batch seam the engine uses when a storage adapter can
   * process rows more efficiently than one `upsertRecord` at a time
   * (deduplicated lookups, bounded-concurrency writes). The DEFAULT
   * implementation is the exact legacy behavior — a sequential per-row
   * `upsertRecord` loop — so every existing adapter (InMemoryAdapter,
   * tests) keeps its semantics untouched; only adapters that opt in
   * (RepositoryStorageAdapter) get the fast path.
   *
   * Contract (identical outcomes to the per-row path, by row index):
   *   - returns one UpsertResult per input row, IN INPUT ORDER;
   *   - side effects (rows written, errors recorded, audit/compensation
   *     logs) are exactly those the sequential loop would produce;
   *   - a thrown error aborts the batch and the engine rolls the run back
   *     (same as a per-row throw today).
   */
  async upsertRecordsBatch(
    schema: ImportSchema,
    rows: ReadonlyArray<BatchUpsertRow>,
    identityKeys: readonly string[],
    runId: string,
    _onProgress?: BatchProgressCallback,
  ): Promise<UpsertResult[]> {
    const results: UpsertResult[] = [];
    for (const { record } of rows) {
      results.push(await this.upsertRecord(schema, record, identityKeys, runId));
    }
    return results;
  }

  /** Insert a record into a reference table (no identity check). */
  abstract insertRecord(table: string, record: ImportRecord): Promise<UpsertResult>;

  /** Persist the run audit entry + issues. */
  abstract saveAuditRun(context: ImportContext): Promise<void>;

  /** List all stored records for a schema (used by tests + history views). */
  abstract listRecords(schemaName: string): Promise<StorageRecord[]>;

  /** List all stored reference records for a table. */
  abstract listRefRecords(table: string): Promise<StorageRecord[]>;

  /** List all persisted run audit entries (newest first). */
  abstract listRuns(): Promise<RunAuditEntry[]>;

  /** Get a single run by ID. */
  abstract getRun(runId: string): Promise<RunAuditEntry | null>;

  /** Return every record inserted during the given run — used by the sync queue.
   *  Optional: default implementation returns an empty array. */
  async listInsertedForRun(_runId: string): Promise<StorageRecord[]> {
    return [];
  }

  /**
   * IMPORT-114 (T-420): report what the LAST rollbackTransaction actually
   * achieved. Optional — adapters whose rollback cannot partially fail
   * (fully in-memory, transactional) may omit it. Null before any rollback.
   */
  getRollbackOutcome?(): RollbackOutcome | null;

  /** Close any open resources. */
  abstract close(): Promise<void>;
}
