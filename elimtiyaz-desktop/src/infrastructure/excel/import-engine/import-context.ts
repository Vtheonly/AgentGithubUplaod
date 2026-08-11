/**
 * ImportContext — per-run state tracker.
 *
 * Ported from `excel-import-engine/src/ImportContext.js`. Holds the run
 * ID, file metadata, aggregate stats, per-sheet results, and the full
 * error/warning list. Serialisable via `toJSON()` for reporters + audit
 * log persistence.
 *
 * Unlike the standalone version (which used `fs.statSync` for file size),
 * this renderer-compatible version accepts pre-computed file metadata —
 * the caller obtains bytes via `File.arrayBuffer()` in the browser.
 */
import { generateRunId } from "./utils/id";
import { fileChecksum } from "./utils/checksum";
import type { ImportIssue, ImportOptions, ImportSource, RunStats, SheetResult } from "./types";

export class ImportContext {
  readonly runId: string;
  readonly startedAt: Date;
  finishedAt: Date | null = null;
  readonly filePath: string;
  readonly options: ImportOptions;
  readonly source: ImportSource;

  fileChecksum: string | null = null;
  fileSize = 0;

  stats: RunStats = {
    sheetsProcessed: 0,
    rowsRead: 0,
    rowsImported: 0,
    rowsUpdated: 0,
    rowsSkipped: 0,
    rowsRejected: 0,
    warnings: 0,
  };

  sheetResults: SheetResult[] = [];
  errors: ImportIssue[] = [];
  warnings: ImportIssue[] = [];
  durationMs: number | null = null;

  /**
   * Generated reports (only populated for non-dry-run imports).
   *
   * Each report carries its file name AND its raw bytes — the bytes are
   * NOT auto-downloaded. The caller (e.g. ExcelImportModal) is responsible
   * for offering a "Download report" button and calling `downloadBlob()`
   * when the user clicks it.
   *
   * This fixes the "every Excel upload generates another Excel + JSON
   * file at the beginning and at the end" bug — the previous implementation
   * auto-downloaded on every commit.
   */
  reports: {
    json?: { fileName: string; bytes: Uint8Array };
    excel?: { fileName: string; bytes: Uint8Array };
  } = {};

  constructor(opts: { filePath: string; options: ImportOptions; source?: ImportSource }) {
    this.runId = generateRunId();
    this.startedAt = new Date();
    this.filePath = opts.filePath;
    this.options = opts.options ?? {};
    this.source = opts.source ?? {};
  }

  addError(entry: Omit<ImportIssue, "runId" | "severity">): void {
    this.errors.push({ runId: this.runId, severity: "error", ...entry });
    // Note: do NOT increment `stats.rowsRejected` here — `addSheetResult`
    // is the canonical aggregation point for row counts. This avoids the
    // double-count bug documented in the standalone engine's technical map.
  }

  addWarning(entry: Omit<ImportIssue, "runId" | "severity">): void {
    this.warnings.push({ runId: this.runId, severity: "warn", ...entry });
    this.stats.warnings += 1;
  }

  addSheetResult(result: SheetResult): void {
    this.sheetResults.push(result);
    this.stats.sheetsProcessed += 1;
    this.stats.rowsRead += result.rowsRead;
    this.stats.rowsImported += result.rowsImported;
    this.stats.rowsUpdated += result.rowsUpdated;
    this.stats.rowsSkipped += result.rowsSkipped;
    this.stats.rowsRejected += result.rowsRejected;
  }

  finish(): void {
    this.finishedAt = new Date();
    this.durationMs = this.finishedAt.getTime() - this.startedAt.getTime();
  }

  /** Compute the file checksum + size from a byte buffer. */
  async computeFileMetadata(bytes: Uint8Array): Promise<void> {
    try {
      this.fileChecksum = await fileChecksum(bytes);
      this.fileSize = bytes.byteLength;
    } catch {
      // Ignore — the run can proceed without checksum metadata.
    }
  }

  toJSON(): Record<string, unknown> {
    return {
      runId: this.runId,
      filePath: this.filePath,
      fileChecksum: this.fileChecksum,
      fileSize: this.fileSize,
      startedAt: this.startedAt.toISOString(),
      finishedAt: this.finishedAt ? this.finishedAt.toISOString() : null,
      durationMs: this.durationMs,
      options: this.options,
      source: this.source,
      stats: this.stats,
      sheetResults: this.sheetResults,
      errors: this.errors,
      warnings: this.warnings,
    };
  }
}
