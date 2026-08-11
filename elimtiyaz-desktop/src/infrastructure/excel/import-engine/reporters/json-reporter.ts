/**
 * JSON reporter — produces a machine-readable import-report file.
 *
 * Ported from `excel-import-engine/src/reporters/JsonReporter.js`. The
 * renderer version RETURNS the report bytes (UTF-8 JSON) so the caller
 * can decide what to do with them — typically offering a "Download JSON
 * report" button on the done screen.
 *
 * Previously this class called `downloadBlob()` directly, which forced a
 * browser download EVERY time the user imported an Excel file. Users
 * complained that "every Excel upload generates another JSON file at the
 * beginning and at the end". Now the bytes are returned in-memory and the
 * UI decides whether to download them.
 *
 * The JSON payload is the full `ImportContext.toJSON()` output — the same
 * shape that gets persisted to the audit log. This file is the human-
 * reviewable export; the audit log is the canonical system of record.
 */
import type { ImportContext } from "../import-context";

export interface JsonReportSummary {
  runId: string;
  status: "success" | "partial" | "failed";
  durationMs: number | null;
  sheets: Array<{ sheet: string; imported: number; rejected: number }>;
  imported: number;
  updated: number;
  rejected: number;
  warnings: number;
}

export interface JsonReportResult {
  fileName: string;
  /** Raw UTF-8 JSON bytes. The caller decides whether to download them. */
  bytes: Uint8Array;
  summary: JsonReportSummary;
}

export class JsonReporter {
  async write(context: ImportContext): Promise<JsonReportResult> {
    const payload = context.toJSON();
    const json = JSON.stringify(payload, null, 2);
    const fileName = `import-report-${context.runId}.json`;
    const bytes = new TextEncoder().encode(json);
    return { fileName, bytes, summary: this.summarize(payload) };
  }

  private summarize(ctx: Record<string, unknown>): JsonReportSummary {
    const stats = ctx.stats as JsonReportSummary;
    return {
      runId: ctx.runId as string,
      status:
        (stats.rejected as number) > 0
          ? (stats.imported as number) > 0
            ? "partial"
            : "failed"
          : "success",
      durationMs: ctx.durationMs as number | null,
      sheets: (ctx.sheetResults as Array<{ sheet: string; rowsImported: number; rowsRejected: number }>).map((s) => ({
        sheet: s.sheet,
        imported: s.rowsImported,
        rejected: s.rowsRejected,
      })),
      imported: stats.imported as number,
      updated: stats.updated as number,
      rejected: stats.rejected as number,
      warnings: stats.warnings as number,
    };
  }
}
