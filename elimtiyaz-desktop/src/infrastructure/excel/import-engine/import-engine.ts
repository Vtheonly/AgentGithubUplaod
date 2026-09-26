import type {
  ImportSchema,
  ImportRecord,
  ImportOptions,
  ImportSource,
  SheetResult,
} from "./types";
import { ImportContext } from "./import-context";
import { ExcelParser } from "./parsers/excel-parser";
import { SheetDetector } from "./parsers/sheet-detector";
import { RowValidator } from "./validators/row-validator";
import { UpsertMatcher } from "./dedupe/upsert-matcher";
import { JsonReporter } from "./reporters/json-reporter";
import { ExcelReporter } from "./reporters/excel-reporter";
import { StorageAdapter } from "./storage/storage-adapter";
import { InMemoryAdapter } from "./storage/in-memory-adapter";
import type { BatchUpsertRow } from "./storage/storage-adapter";
import { defaultLogger } from "./utils/logger";
import { ConfigurationError, ImportEngineError } from "./errors";
import { findSchemaByName } from "./schemas";
import type ExcelJS from "exceljs";

export interface AuditSink {
  logAction(
    action: string,
    entityType: string,
    entityId: string,
    diff?: Record<string, unknown>,
    note?: string,
  ): Promise<void>;
}

export interface ImportEngineConfig {
  storage?: StorageAdapter;
  auditSink?: AuditSink;
  generateReports?: boolean;
}

export type ImportEventMap = {
  start: { runId: string; filePath: string; fileChecksum: string | null };
  "sheet:start": { sheet: string; schema: string };
  "sheet:progress": { sheet: string; read: number; total: number };
  "sheet:row": {
    sheet: string;
    row: ImportRecord;
    rowIndex: number;
    action: "insert" | "update" | "skip" | "dry-run";
  };
  "sheet:warn": { sheet: string; warning: { rule: string; message: string } };
  "sheet:error": {
    sheet: string;
    error: { rule: string; message: string };
    rowIndex: number;
  };
  "sheet:done": { sheet: string; result: SheetResult };
  done: {
    context: ImportContext;
    /**
     * Generated reports (only for non-dry-run imports).
     *
     * Each report carries its file name AND its raw bytes — the bytes
     * are NOT auto-downloaded. The caller (e.g. ExcelImportModal) is
     * responsible for offering a "Download report" button and calling
     * `downloadBlob()` when the user clicks it. This prevents the
     * "every Excel upload generates another Excel + JSON file" issue
     * that occurred when reporters auto-downloaded on every commit.
     */
    reports: {
      json?: { fileName: string; bytes: Uint8Array };
      excel?: { fileName: string; bytes: Uint8Array };
    };
  };
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

  async init(): Promise<void> {
    if (this.initialized) return;
    await this.storage.init();
    this.initialized = true;
    defaultLogger.info("Import engine initialised");
  }

  on<K extends EventName>(
    event: K,
    listener: Listener<ImportEventMap[K]>,
  ): () => void {
    const set = this.listeners[event];
    const wrapped = listener as (payload: unknown) => void;
    set.add(wrapped);
    return () => set.delete(wrapped);
  }

  private emit<K extends EventName>(
    event: K,
    payload: ImportEventMap[K],
  ): void {
    const set = this.listeners[event];
    for (const listener of set) {
      try {
        listener(payload as unknown);
      } catch {
        // Listeners must not crash the import.
      }
    }
  }

  async importFile(
    file: File | ArrayBuffer | Uint8Array,
    filePath: string,
    options: ImportOptions = {},
  ): Promise<ImportContext> {
    if (!this.initialized) await this.init();

    const ctx = new ImportContext({
      filePath,
      options,
      source: options.source ?? {},
    });

    const bytes =
      file instanceof File
        ? new Uint8Array(await file.arrayBuffer())
        : file instanceof Uint8Array
          ? file
          : new Uint8Array(file);
    await ctx.computeFileMetadata(bytes);

    this.emit("start", {
      runId: ctx.runId,
      filePath,
      fileChecksum: ctx.fileChecksum,
    });
    defaultLogger.info(`Starting import run=${ctx.runId}`, {
      filePath,
      checksum: ctx.fileChecksum,
    });

    await this.auditSink.logAction(
      "import.run_started",
      "import_run",
      ctx.runId,
      {
        filePath,
        fileChecksum: ctx.fileChecksum,
        fileSize: ctx.fileSize,
        options,
      },
      `Import démarré: ${filePath}`,
    );

    try {
      const wb = await this.parser.open(file);
      const sheets = wb.worksheets;

      const targetSheets = this.selectSheets(sheets, options);
      if (targetSheets.length === 0) {
        ctx.addWarning({
          sheet: null,
          rule: "no_sheets",
          message: "Aucune feuille correspondante aux critères",
        });
      }

      if (!options.dryRun) await this.storage.beginTransaction();

      try {
        for (const ws of targetSheets) {
          await this.processSheet(ws, ctx, options);
        }
        // VAULT §14.02 — ATOMIC IMPORT: "If any row fails validation, the
        // ENTIRE import rolls back via atomic transaction. No partial
        // imports. A partial import leaves the database in an inconsistent
        // state with some rows imported and others not."
        //
        // The check happens BEFORE commitTransaction so the rollback path
        // actually undoes everything (previously `strict` mode threw AFTER
        // the commit — the data was already persisted and the "partial"
        // status leaked through).
        if (!options.dryRun && ctx.errors.length > 0) {
          throw new ImportEngineError(
            `${ctx.errors.length} ligne(s) en erreur — import ANNULÉ (atomique, aucune donnée partielle). ` +
              "Corrigez les lignes signalées dans le rapport puis relancez.",
            "ATOMIC_IMPORT_ABORTED",
            { errorsCount: ctx.errors.length, firstErrors: ctx.errors.slice(0, 5) },
          );
        }
        if (!options.dryRun) await this.storage.commitTransaction();
      } catch (e) {
        if (!options.dryRun) {
          // IMPORT-114 (T-420): the rollback is best-effort and its failure
          // must not mask the original error — but a PARTIAL compensation
          // means the database is left inconsistent, and the user must know.
          // Live evidence (issue #20): under pool exhaustion the compensating
          // deletes died partway (384 of 847 students soft-deleted) while the
          // error message claimed the import had been fully annulled.
          let rollbackWarning: string | null = null;
          try {
            await this.storage.rollbackTransaction();
            const outcome =
              typeof this.storage.getRollbackOutcome === "function"
                ? this.storage.getRollbackOutcome()
                : null;
            if (outcome && outcome.failedStudents + outcome.failedParents > 0) {
              rollbackWarning =
                ` ATTENTION : le rollback n'a PAS pu annuler ` +
                `${outcome.failedStudents} élève(s) et ${outcome.failedParents} parent(s) créés par cet import ` +
                `(${outcome.studentsDeleted} élève(s) et ${outcome.parentsDeleted} parent(s) supprimés) — ` +
                `la base est dans un ÉTAT PARTIEL. Ne réimportez pas avant d'avoir inspecté/nettoyé les enregistrements orphelins.`;
            }
          } catch {
            // Ignore rollback failure — the original error still propagates.
          }
          if (rollbackWarning) {
            const original = e instanceof Error ? e.message : String(e);
            const wrapped = new ImportEngineError(
              `${original}${rollbackWarning}`,
              "PARTIAL_ROLLBACK_STATE",
              { originalError: e },
            );
            throw wrapped;
          }
        }
        throw e;
      }

      ctx.finish();

      // Reports are ONLY generated for real (non-dry-run) imports. The
      // preview step (dryRun=true) used to trigger downloads too — that
      // caused the "every Excel upload generates another Excel + JSON
      // file at the beginning AND at the end" bug. Now only the commit
      // step (dryRun=false) emits reports, AND the bytes are returned
      // in-memory (not auto-downloaded) — the UI offers download buttons.
      const reports: {
        json?: { fileName: string; bytes: Uint8Array };
        excel?: { fileName: string; bytes: Uint8Array };
      } = {};
      if (this.generateReports && !options.dryRun) {
        try {
          const jsonResult = await this.jsonReporter.write(ctx);
          reports.json = { fileName: jsonResult.fileName, bytes: jsonResult.bytes };
        } catch (e) {
          defaultLogger.warn("JSON report generation failed", {
            error: (e as Error).message,
          });
        }
        try {
          const excelResult = await this.excelReporter.write(ctx);
          reports.excel = { fileName: excelResult.fileName, bytes: excelResult.bytes };
        } catch (e) {
          defaultLogger.warn("Excel report generation failed", {
            error: (e as Error).message,
          });
        }
      }
      // Attach reports to the context so the caller (ExcelImportModal)
      // can read ctx.reports and offer download buttons.
      ctx.reports = reports;

      if (!options.dryRun) {
        await this.storage.saveAuditRun(ctx);
      }

      this.emit("done", { context: ctx, reports });
      defaultLogger.info(`Import run=${ctx.runId} finished`, {
        durationMs: ctx.durationMs,
        stats: ctx.stats,
      });

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
      defaultLogger.error(`Import run=${ctx.runId} failed`, {
        message: err.message,
      });
      throw err;
    }
  }

  async preview(
    file: File | ArrayBuffer | Uint8Array,
  ): Promise<
    { name: string; rowCount: number; schema: ImportSchema | null }[]
  > {
    if (!this.initialized) await this.init();
    return this.parser.listSheets(file);
  }

  async close(): Promise<void> {
    await this.storage.close();
    this.initialized = false;
  }

  getStorage(): StorageAdapter {
    return this.storage;
  }

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
    return allSheets.filter((ws) => this.detector.detect(ws.name) !== null);
  }

  private async processSheet(
    ws: ExcelJS.Worksheet,
    ctx: ImportContext,
    options: ImportOptions,
  ): Promise<void> {
    const sheetName = ws.name;
    // T-414 (IMPORT-111): FORMAT disambiguation — the same sheet NAME can
    // exist in different workbook formats ("ETAT 20262027" is in BOTH the
    // 2026-2027 and 2027-2026 workbooks). Name-only detection returns the
    // first match; re-detecting with the ACTUAL header row lets the
    // registry pick the format whose header signature matches (V1 /
    // LIVRES / CLUB / SORTIES vs NOM).
    const nameMatch = this.detector.detect(sheetName);
    const headerRowNumber =
      nameMatch && nameMatch.headerRow > 0 ? nameMatch.headerRow : 1;
    const headerRow = this.parser.readSheetHeaderRow(ws, headerRowNumber);
    const schema = this.detector.detect(sheetName, headerRow) ?? nameMatch;
    if (!schema) {
      ctx.addWarning({
        sheet: sheetName,
        rule: "unknown_schema",
        message: `Feuille « ${sheetName} » ignorée (schéma inconnu)`,
      });
      this.emit("sheet:warn", {
        sheet: sheetName,
        warning: { rule: "unknown_schema", message: "schéma inconnu" },
      });
      return;
    }

    this.emit("sheet:start", { sheet: sheetName, schema: schema.name });
    defaultLogger.info(
      `Processing sheet « ${sheetName} » (schema=${schema.name})`,
    );

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

    // PERF-503 (T-417): validated rows destined for the storage layer are
    // BUFFERED here and written in ONE `upsertRecordsBatch` call after the
    // sheet has been fully read. The parse/validate phase (CPU-bound, fast)
    // stays row-by-row — warnings, rejects, ref-record inserts and identity
    // skips are emitted during iteration exactly as before; only the
    // storage writes (the network-bound legs) move to the batch seam.
    // Storages that do not override the batch method get the default
    // sequential loop inside it — byte-identical legacy behavior.
    const batchRows: BatchUpsertRow[] = [];

    await this.parser.iterateRows(ws, schema, {
      onRow: async (rawRow, rowIndex) => {
        sheetResult.rowsRead += 1;
        const { record, errors, warnings, skipped, isNonDataRow } =
          validator.validate(rawRow, rowIndex);

        if (isNonDataRow) {
          sheetResult.rowsSkipped += 1;
          return;
        }

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
          this.emit("sheet:warn", {
            sheet: sheetName,
            warning: { rule: w.rule, message: w.message },
          });
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

        if (schema.name === "ref" && schema.extractAs) {
          await this.insertRefRecord(schema, record, ctx, sheetName, options);
          sheetResult.rowsImported += 1;
          this.emit("sheet:row", {
            sheet: sheetName,
            row: record,
            rowIndex,
            action: "insert",
          });
          return;
        }

        const identity = matcher.extractIdentity(record);
        if (!identity && matcher.identityFields.length > 0) {
          ctx.addWarning({
            sheet: sheetName,
            rowIndex,
            field: "identity",
            header: matcher.identityFields.join(", "),
            rule: "identity",
            message: `Ligne ignorée : aucun identifiant valide (${matcher.identityFields.join(", ")})`,
            rawValue: JSON.stringify(record).slice(0, 200),
          });
          sheetResult.rowsSkipped += 1;
          return;
        }

        if (options.dryRun) {
          sheetResult.rowsImported += 1;
          this.emit("sheet:row", {
            sheet: sheetName,
            row: record,
            rowIndex,
            action: "dry-run",
          });
          return;
        }

        // Non-dry-run — deferred: written once, in bulk, after the sheet
        // is fully read (see the batch call below).
        batchRows.push({ record, rowIndex });
      },
      onProgress: (read, total) => {
        this.emit("sheet:progress", { sheet: sheetName, read, total });
      },
    });

    // PERF-503 (T-417): the single batch write for this sheet. The adapter
    // resolves identities against ONE in-memory snapshot (instead of
    // ~1,000 per-row `search()` round trips) and executes the canonical
    // per-family upsert RPCs with bounded concurrency (instead of one
    // sequential await per row). Per-row results come back in row order,
    // so counters and events stay exactly as the sequential path produced
    // them.
    if (batchRows.length > 0) {
      const batchResults = await this.storage.upsertRecordsBatch(
        schema,
        batchRows,
        matcher.identityFields,
        ctx.runId,
        (written, total) => {
          // Write-phase progress — same event channel the parse phase
          // already uses, so a UI listening to `sheet:progress` sees the
          // storage phase too (issue #19: "Progress tracking and UI
          // responsiveness").
          this.emit("sheet:progress", {
            sheet: sheetName,
            read: written,
            total,
          });
        },
      );
      for (let i = 0; i < batchRows.length; i++) {
        const result = batchResults[i] ?? { action: "skip" as const };
        if (result.action === "insert") sheetResult.rowsImported += 1;
        else if (result.action === "update") sheetResult.rowsUpdated += 1;
        else if (result.action === "skip") sheetResult.rowsSkipped += 1;
        this.emit("sheet:row", {
          sheet: sheetName,
          row: batchRows[i].record,
          rowIndex: batchRows[i].rowIndex,
          action: result.action,
        });
      }
    }

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
          await this.storage.insertRecord(target.table, {
            [target.column]: value,
          });
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

const defaultNoOpAuditSink: AuditSink = {
  async logAction() {},
};

export function createImportEngine(config?: ImportEngineConfig): ImportEngine {
  return new ImportEngine(config);
}

export { findSchemaByName };
export { ConfigurationError, ImportEngineError } from "./errors";
