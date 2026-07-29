/**
 * ImportEngine — main orchestrator.
 *
 * Ported from `excel-import-engine/src/ImportEngine.js`. Ties together:
 *   - ExcelParser (read workbook, iterate rows)
 *   - SheetDetector (auto-detect schema per sheet)
 *   - RowValidator + FieldCoercer (coerce + validate cells)
 *   - UpsertMatcher (idempotent identity extraction)
 *   - StorageAdapter (in-memory record + run history store)
 *   - JsonReporter + ExcelReporter (human-reviewable export files)
 *
 * Replaces Node's `EventEmitter` with a tiny typed listener bag (mirrors
 * the pattern used by the renderer-side `ParticleEngine`). The lifecycle
 * events match the standalone engine's contract so any future IPC bridge
 * can consume them unchanged.
 *
 * Audit integration: the engine emits `import.run_started` and
 * `import.run_completed` audit actions via the optional `auditSink`
 * callback (the host wires this to `repos.audit.log()`).
 */
import type { ImportSchema, ImportRecord, ImportOptions, ImportSource, SheetResult } from "./types";
import { ImportContext } from "./import-context";
import { ExcelParser } from "./parsers/excel-parser";
import { SheetDetector } from "./parsers/sheet-detector";
import { RowValidator } from "./validators/row-validator";
import { UpsertMatcher } from "./dedupe/upsert-matcher";
import { JsonReporter } from "./reporters/json-reporter";
import { ExcelReporter } from "./reporters/excel-reporter";
import { StorageAdapter } from "./storage/storage-adapter";
import { InMemoryAdapter } from "./storage/in-memory-adapter";
import { defaultLogger } from "./utils/logger";
import { ConfigurationError, ImportEngineError } from "./errors";
import { findSchemaByName } from "./schemas";
import type ExcelJS from "exceljs";

/** Audit sink — called by the engine to persist audit entries. */
export interface AuditSink {
  logAction(action: string, entityType: string, entityId: string, diff?: Record<string, unknown>, note?: string): Promise<void>;
}

export interface ImportEngineConfig {
  /** Storage adapter (defaults to `InMemoryAdapter`). */
  storage?: StorageAdapter;
  /** Audit sink (defaults to no-op). Host wires this to `repos.audit.log()`. */
  auditSink?: AuditSink;
  /** Enable report generation (default true). */
  generateReports?: boolean;
}

// ── Event types ──────────────────────────────────────────────────────────

export type ImportEventMap = {
  start: { runId: string; filePath: string; fileChecksum: string | null };
  "sheet:start": { sheet: string; schema: string };
  "sheet:progress": { sheet: string; read: number; total: number };
  "sheet:row": { sheet: string; row: ImportRecord; rowIndex: number; action: "insert" | "update" | "skip" | "dry-run" };
  "sheet:warn": { sheet: string; warning: { rule: string; message: string } };
  "sheet:error": { sheet: string; error: { rule: string; message: string }; rowIndex: number };
  "sheet:done": { sheet: string; result: SheetResult };
  done: { context: ImportContext; reports: { json?: string; excel?: string } };
  error: { error: Error; context: ImportContext };
};

type EventName = keyof ImportEventMap;
type Listener<T> = (payload: T) => void;
type AnyListenerSet = Set<(payload: unknown) => void>;

export class ImportEngine {
  private readonly parser: ExcelParser;
  private readonly detector: SheetDetector;
  private readonly storage: StorageAdapter;
  private readonly auditSink: AuditSink;
  private readonly generateReports: boolean;
  private readonly jsonReporter: JsonReporter;
  private readonly excelReporter: ExcelReporter;
  private initialized = false;
  private listeners: Record<EventName, AnyListenerSet> = {
    start: new Set(),
    "sheet:start": new Set(),
    "sheet:progress": new Set(),
    "sheet:row": new Set(),
    "sheet:warn": new Set(),
    "sheet:error": new Set(),
    "sheet:done": new Set(),
    done: new Set(),
    error: new Set(),
  };

  constructor(config: ImportEngineConfig = {}) {
    this.parser = new ExcelParser();
    this.detector = new SheetDetector();
    this.storage = config.storage ?? new InMemoryAdapter();
    this.auditSink = config.auditSink ?? defaultNoOpAuditSink;
    this.generateReports = config.generateReports ?? true;
    this.jsonReporter = new JsonReporter();
    this.excelReporter = new ExcelReporter();
  }

  /** Initialise the storage adapter. Must be called before `importFile`. */
  async init(): Promise<void> {
    if (this.initialized) return;
    await this.storage.init();
    this.initialized = true;
    defaultLogger.info("Import engine initialised");
  }

  /** Subscribe to an engine event. Returns an unsubscribe function. */
  on<K extends EventName>(event: K, listener: Listener<ImportEventMap[K]>): () => void {
    const set = this.listeners[event];
    const wrapped = listener as (payload: unknown) => void;
    set.add(wrapped);
    return () => set.delete(wrapped);
  }

  private emit<K extends EventName>(event: K, payload: ImportEventMap[K]): void {
    const set = this.listeners[event];
    for (const listener of set) {
      try {
        listener(payload as unknown);
      } catch {
        // Listeners must not crash the import.
      }
    }
  }

  /**
   * Import an Excel file.
   *
   * @param file - The `File` or `ArrayBuffer` to import.
   * @param filePath - The file's name (for audit + reporting).
   * @param options - Import options (sheet filter, dryRun, strict, etc.).
   * @returns The run's `ImportContext` with stats, errors, and sheet results.
   */
  async importFile(
    file: File | ArrayBuffer | Uint8Array,
    filePath: string,
    options: ImportOptions = {},
  ): Promise<ImportContext> {
    if (!this.initialized) await this.init();

    const ctx = new ImportContext({ filePath, options, source: options.source ?? {} });

    // Compute file metadata (checksum + size) from the byte buffer.
    const bytes = file instanceof File ? new Uint8Array(await file.arrayBuffer()) : file instanceof Uint8Array ? file : new Uint8Array(file);
    await ctx.computeFileMetadata(bytes);

    this.emit("start", { runId: ctx.runId, filePath, fileChecksum: ctx.fileChecksum });
    defaultLogger.info(`Starting import run=${ctx.runId}`, { filePath, checksum: ctx.fileChecksum });

    // Audit: run started.
    await this.auditSink.logAction(
      "import.run_started",
      "import_run",
      ctx.runId,
      { filePath, fileChecksum: ctx.fileChecksum, fileSize: ctx.fileSize, options },
      `Import démarré: ${filePath}`,
    );

    try {
      const wb = await this.parser.open(file);
      const sheets = wb.worksheets;

      const targetSheets = this.selectSheets(sheets, options);
      if (targetSheets.length === 0) {
        ctx.addWarning({ sheet: null, rule: "no_sheets", message: "Aucune feuille correspondante aux critères" });
      }

      // Single transaction wraps all sheets (matches the standalone engine's contract).
      if (!options.dryRun) await this.storage.beginTransaction();

      try {
        for (const ws of targetSheets) {
          await this.processSheet(ws, ctx, options);
        }
        if (!options.dryRun) await this.storage.commitTransaction();
      } catch (e) {
        if (!options.dryRun) {
          try {
            await this.storage.rollbackTransaction();
          } catch {
            // Swallow rollback errors — the original error is more important.
          }
        }
        throw e;
      }

      ctx.finish();

      // Reports.
      const reports: { json?: string; excel?: string } = {};
      if (this.generateReports) {
        try {
          const jsonResult = await this.jsonReporter.write(ctx);
          reports.json = jsonResult.fileName;
        } catch (e) {
          defaultLogger.warn("JSON report generation failed", { error: (e as Error).message });
        }
        try {
          const excelResult = await this.excelReporter.write(ctx);
          reports.excel = excelResult.fileName;
        } catch (e) {
          defaultLogger.warn("Excel report generation failed", { error: (e as Error).message });
        }
      }

      // Audit log persistence.
      if (!options.dryRun) {
        await this.storage.saveAuditRun(ctx);
      }

      this.emit("done", { context: ctx, reports });
      defaultLogger.info(`Import run=${ctx.runId} finished`, { durationMs: ctx.durationMs, stats: ctx.stats });

      // Audit: run completed.
      await this.auditSink.logAction(
        "import.run_completed",
        "import_run",
        ctx.runId,
        {
          stats: ctx.stats,
          durationMs: ctx.durationMs,
          reports,
        },
        `Import terminé: ${ctx.stats.rowsImported} insérés, ${ctx.stats.rowsRejected} rejetés`,
      );

      // Strict mode: reject if any errors (post-commit, matching standalone behaviour).
      if (options.strict && ctx.errors.length > 0) {
        throw new ImportEngineError(
          `Mode strict : ${ctx.errors.length} erreur(s) — import annulé`,
          "STRICT_MODE_REJECTED",
          { errorsCount: ctx.errors.length },
        );
      }

      return ctx;
    } catch (e) {
      ctx.finish();
      const err = e as Error;
      this.emit("error", { error: err, context: ctx });
      defaultLogger.error(`Import run=${ctx.runId} failed`, { message: err.message });
      throw err;
    }
  }

  /** Preview the sheets of a file without importing. */
  async preview(file: File | ArrayBuffer | Uint8Array): Promise<{ name: string; rowCount: number; schema: ImportSchema | null }[]> {
    if (!this.initialized) await this.init();
    return this.parser.listSheets(file);
  }

  /** Close the engine and release storage resources. */
  async close(): Promise<void> {
    await this.storage.close();
    this.initialized = false;
  }

  /** Expose the storage adapter (for tests + history views). */
  getStorage(): StorageAdapter {
    return this.storage;
  }

  // ── Private helpers ────────────────────────────────────────────────────

  private selectSheets(
    allSheets: ExcelJS.Worksheet[],
    options: ImportOptions,
  ): ExcelJS.Worksheet[] {
    if (options.schemas && options.schemas.length > 0) {
      return allSheets.filter((ws) => {
        const schema = this.detector.detect(ws.name);
        return schema && options.schemas!.includes(schema.name);
      });
    }
    if (options.sheets && options.sheets.length > 0) {
      return allSheets.filter((ws) => options.sheets!.includes(ws.name));
    }
    // Default: all sheets that match a known schema.
    return allSheets.filter((ws) => this.detector.detect(ws.name) !== null);
  }

  private async processSheet(
    ws: ExcelJS.Worksheet,
    ctx: ImportContext,
    options: ImportOptions,
  ): Promise<void> {
    const sheetName = ws.name;
    const schema = this.detector.detect(sheetName);
    if (!schema) {
      ctx.addWarning({ sheet: sheetName, rule: "unknown_schema", message: `Feuille « ${sheetName} » ignorée (schéma inconnu)` });
      this.emit("sheet:warn", { sheet: sheetName, warning: { rule: "unknown_schema", message: "schéma inconnu" } });
      return;
    }

    this.emit("sheet:start", { sheet: sheetName, schema: schema.name });
    defaultLogger.info(`Processing sheet « ${sheetName} » (schema=${schema.name})`);

    const validator = new RowValidator(schema);
    const matcher = new UpsertMatcher(schema);

    const sheetResult: SheetResult = {
      sheet: sheetName,
      schema: schema.name,
      rowsRead: 0,
      rowsImported: 0,
      rowsUpdated: 0,
      rowsSkipped: 0,
      rowsRejected: 0,
    };

    // Use the parser's iterateRows.
    await this.parser.iterateRows(ws, schema, {
      onRow: async (rawRow, rowIndex) => {
        sheetResult.rowsRead += 1;
        const { record, errors, warnings, skipped } = validator.validate(rawRow, rowIndex);

        for (const w of warnings) {
          ctx.addWarning({
            sheet: sheetName,
            rowIndex,
            field: w.field,
            header: w.header,
            rule: w.rule,
            message: w.message,
            rawValue: w.rawValue,
          });
          this.emit("sheet:warn", { sheet: sheetName, warning: { rule: w.rule, message: w.message } });
        }

        if (skipped) {
          for (const e of errors) {
            ctx.addError({
              sheet: sheetName,
              rowIndex,
              field: e.field,
              header: e.header,
              rule: e.rule,
              message: e.message,
              rawValue: e.rawValue,
            });
          }
          sheetResult.rowsRejected += 1;
          if (errors.length > 0) {
            this.emit("sheet:error", {
              sheet: sheetName,
              error: { rule: errors[0].rule, message: errors[0].message },
              rowIndex,
            });
          }
          return;
        }

        // REF schema special-case: fan-out into multiple reference tables.
        if (schema.name === "ref" && schema.extractAs) {
          await this.insertRefRecord(schema, record, ctx, sheetName, options);
          sheetResult.rowsImported += 1;
          this.emit("sheet:row", { sheet: sheetName, row: record, rowIndex, action: "insert" });
          return;
        }

        // Identity extraction for upsert.
        const identity = matcher.extractIdentity(record);
        if (!identity && matcher.identityFields.length > 0) {
          ctx.addError({
            sheet: sheetName,
            rowIndex,
            field: "identity",
            header: matcher.identityFields.join(", "),
            rule: "identity",
            message: `Ligne sans identité complète (${matcher.identityFields.join(", ")})`,
            rawValue: JSON.stringify(record).slice(0, 200),
          });
          sheetResult.rowsRejected += 1;
          return;
        }

        // Upsert into storage.
        if (!options.dryRun) {
          const result = await this.storage.upsertRecord(schema, record, matcher.identityFields, ctx.runId);
          if (result.action === "insert") sheetResult.rowsImported += 1;
          else if (result.action === "update") sheetResult.rowsUpdated += 1;
          else if (result.action === "skip") sheetResult.rowsSkipped += 1;
          this.emit("sheet:row", { sheet: sheetName, row: record, rowIndex, action: result.action });
        } else {
          sheetResult.rowsImported += 1;
          this.emit("sheet:row", { sheet: sheetName, row: record, rowIndex, action: "dry-run" });
        }
      },
      onProgress: (read, total) => {
        this.emit("sheet:progress", { sheet: sheetName, read, total });
      },
    });

    ctx.addSheetResult(sheetResult);
    this.emit("sheet:done", { sheet: sheetName, result: sheetResult });
    defaultLogger.info(`Sheet « ${sheetName} » done`, {
      rowsRead: sheetResult.rowsRead,
      rowsImported: sheetResult.rowsImported,
      rowsUpdated: sheetResult.rowsUpdated,
      rowsSkipped: sheetResult.rowsSkipped,
      rowsRejected: sheetResult.rowsRejected,
    });
  }

  private async insertRefRecord(
    schema: ImportSchema,
    record: ImportRecord,
    ctx: ImportContext,
    sheetName: string,
    options: ImportOptions,
  ): Promise<void> {
    if (!schema.extractAs) return;
    for (const [fieldKey, target] of Object.entries(schema.extractAs)) {
      const value = record[fieldKey];
      if (!value) continue;
      if (!options.dryRun) {
        try {
          await this.storage.insertRecord(target.table, { [target.column]: value });
        } catch (e) {
          ctx.addWarning({
            sheet: sheetName,
            rule: "ref_insert_failed",
            message: `Échec insertion ${target.table}: ${(e as Error).message}`,
          });
        }
      }
    }
  }
}

/** Default no-op audit sink — used when the host doesn't wire one. */
const defaultNoOpAuditSink: AuditSink = {
  async logAction() {
    // No-op.
  },
};

/** Convenience factory. */
export function createImportEngine(config?: ImportEngineConfig): ImportEngine {
  return new ImportEngine(config);
}

// Re-export schema lookup for convenience.
export { findSchemaByName };
export { ConfigurationError, ImportEngineError } from "./errors";
