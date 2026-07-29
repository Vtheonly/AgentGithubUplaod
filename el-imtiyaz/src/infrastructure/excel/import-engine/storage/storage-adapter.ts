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

  /** Close any open resources. */
  abstract close(): Promise<void>;
}
