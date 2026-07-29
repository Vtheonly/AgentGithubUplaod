/**
 * JSON reporter — produces a machine-readable import-report file.
 *
 * Ported from `excel-import-engine/src/reporters/JsonReporter.js`. The
 * renderer version triggers a browser download via `Blob` + `URL.createObjectURL`
 * rather than writing to the file system (the original used `fs.writeFileSync`).
 *
 * The JSON payload is the full `ImportContext.toJSON()` output — the same
 * shape that gets persisted to the audit log. This file is the human-
 * reviewable export; the audit log is the canonical system of record.
 */
import type { ImportContext } from "../import-context";
import { downloadBlob } from "../../export-engine";

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
  summary: JsonReportSummary;
}

export class JsonReporter {
  async write(context: ImportContext): Promise<JsonReportResult> {
    const payload = context.toJSON();
    const json = JSON.stringify(payload, null, 2);
    const fileName = `import-report-${context.runId}.json`;
    downloadBlob(new TextEncoder().encode(json), fileName, "application/json");
    return { fileName, summary: this.summarize(payload) };
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
