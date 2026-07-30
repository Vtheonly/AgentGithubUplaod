/**
 * In-memory storage adapter.
 *
 * Replaces the standalone engine's `SqliteAdapter` (better-sqlite3, native)
 * with a renderer-compatible in-memory implementation. Run audit entries
 * + records live in memory for the session; for cross-session durability,
 * the host application can persist them via `ImportRunRepository` (the
 * mock implementation stores them in memory too, but a future Supabase
 * adapter can drop in seamlessly).
 *
 * The adapter implements the same idempotent upsert semantics as the
 * SQLite version: records are keyed by schema identity, and re-importing
 * the same file produces `skip` actions (not duplicates) when the
 * checksum matches.
 */
import type { ImportSchema, ImportRecord, UpsertResult } from "../types";
import type { ImportContext } from "../import-context";
import { objectChecksum } from "../utils/checksum";
import { StorageAdapter, type StorageRecord, type RunAuditEntry } from "./storage-adapter";
import { uuid } from "../utils/id";

interface InMemoryRecord extends StorageRecord {}

interface RefTable {
  readonly table: string;
  readonly column: string;
  readonly values: Set<string>;
}

export class InMemoryAdapter extends StorageAdapter {
  private records: Map<string, InMemoryRecord> = new Map(); // key: `${schemaName}:${identityHash}`
  private refTables: Map<string, RefTable> = new Map();
  private runs: Map<string, RunAuditEntry> = new Map();
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) return;
    // Pre-create the standard reference tables.
    this.refTables.set("ref_enseignants", { table: "ref_enseignants", column: "nom", values: new Set() });
    this.refTables.set("ref_classes", { table: "ref_classes", column: "code", values: new Set() });
    this.refTables.set("ref_localites", { table: "ref_localites", column: "nom", values: new Set() });
    this.initialized = true;
  }

  async beginTransaction(): Promise<void> {
    // No-op — in-memory adapter is single-threaded and atomic by virtue of JS's event loop.
  }

  async commitTransaction(): Promise<void> {
    // No-op.
  }

  async rollbackTransaction(): Promise<void> {
    // No-op — in-memory state is already in memory only; no transaction log to roll back.
  }

  async upsertRecord(
    schema: ImportSchema,
    record: ImportRecord,
    identityKeys: readonly string[],
    runId: string,
  ): Promise<UpsertResult> {
    const identity = this.extractIdentity(schema, record, identityKeys);
    const checksum = await objectChecksum(record as Record<string, unknown>);
    const key = `${schema.name}:${this.identityHash(identity)}`;
    const now = new Date().toISOString();

    const existing = this.records.get(key);
    if (existing) {
      if (existing.checksum === checksum) {
        return { action: "skip", id: existing.id };
      }
      // Update.
      const updated: InMemoryRecord = {
        ...existing,
        record,
        identity,
        lastUpdatedRunId: runId,
        lastUpdatedAt: now,
        checksum,
      };
      this.records.set(key, updated);
      return { action: "update", id: existing.id };
    }

    // Insert.
    const id = uuid();
    const newRecord: InMemoryRecord = {
      id,
      schemaName: schema.name,
      record,
      identity,
      firstImportedRunId: runId,
      firstImportedAt: now,
      lastUpdatedRunId: runId,
      lastUpdatedAt: now,
      checksum,
    };
    this.records.set(key, newRecord);
    return { action: "insert", id };
  }

  async insertRecord(table: string, record: ImportRecord): Promise<UpsertResult> {
    const refTable = this.refTables.get(table);
    if (!refTable) {
      // Unknown reference table — create one on the fly.
      const column = Object.keys(record)[0] ?? "value";
      this.refTables.set(table, { table, column, values: new Set() });
    }
    const col = this.refTables.get(table)!.column;
    const value = String(record[col] ?? "");
    if (!value) return { action: "skip" };
    if (this.refTables.get(table)!.values.has(value)) {
      return { action: "skip" };
    }
    this.refTables.get(table)!.values.add(value);
    return { action: "insert" };
  }

  async saveAuditRun(context: ImportContext): Promise<void> {
    const status: RunAuditEntry["status"] =
      context.stats.rowsRejected > 0
        ? context.stats.rowsImported > 0
          ? "partial"
          : "failed"
        : "success";

    const entry: RunAuditEntry = {
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
    };
    this.runs.set(context.runId, entry);
  }

  async listRecords(schemaName: string): Promise<StorageRecord[]> {
    return Array.from(this.records.values()).filter((r) => r.schemaName === schemaName);
  }

  async listRefRecords(table: string): Promise<StorageRecord[]> {
    const refTable = this.refTables.get(table);
    if (!refTable) return [];
    return Array.from(refTable.values).map((value, i) => ({
      id: `ref-${table}-${i}`,
      schemaName: "ref",
      record: { [refTable.column]: value } as ImportRecord,
      identity: { [refTable.column]: value },
      firstImportedRunId: "",
      firstImportedAt: "",
      lastUpdatedRunId: "",
      lastUpdatedAt: "",
      checksum: "",
    }));
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
    // No-op — let GC reclaim the maps.
  }

  // ── Private helpers ────────────────────────────────────────────────────

  private extractIdentity(
    schema: ImportSchema,
    record: ImportRecord,
    identityKeys: readonly string[],
  ): Record<string, string | number> {
    // Build header→key translation map (identityKeys are header names, records use camelCase keys).
    const headerToKey = new Map<string, string>();
    for (const f of schema.fields) {
      if (f.header) {
        headerToKey.set(f.header.toString().trim().toLowerCase(), f.key);
      }
    }

    const identity: Record<string, string | number> = {};
    for (const headerName of identityKeys) {
      const key = headerToKey.get(headerName.toString().trim().toLowerCase()) ?? headerName;
      let v: unknown = record[key];
      if (Array.isArray(v)) v = (v as unknown[]).join(",");
      if (v instanceof Date) v = v.toISOString();
      if (v === null || v === undefined || v === "") continue;
      identity[key] = typeof v === "number" ? v : String(v);
    }
    return identity;
  }

  private identityHash(identity: Record<string, string | number>): string {
    return Object.entries(identity)
      .map(([k, v]) => `${k}=${v}`)
      .sort()
      .join("|");
  }
}
