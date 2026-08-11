/**
 * Excel reporter — produces a 3-sheet XLSX import-report file.
 *
 * Ported from `excel-import-engine/src/reporters/ExcelReporter.js`. Uses
 * the project's existing `export-engine.ts` (which already wraps ExcelJS
 * with brand-coloured headers, zebra striping, and auto-filter) rather
 * than calling ExcelJS directly. This keeps a single styling seam and
 * matches the rest of the app's export UX.
 *
 * The 3 sheets are:
 *   1. `Résumé` — global metrics + per-sheet detail.
 *   2. `Lignes rejetées` — one row per error.
 *   3. `Avertissements` — one row per warning.
 *
 * ITERATION 23 (auto-download fix): Previously this class called
 * `exportToXlsx()` directly, which forced a browser download EVERY time
 * the user imported an Excel file. Users complained that "every Excel
 * upload generates another Excel file at the beginning and at the end".
 * Now the XLSX bytes are returned in-memory (as a Uint8Array) and the
 * UI decides whether to download them via a "Download Excel report"
 * button on the done screen.
 */
import type { ImportContext } from "../import-context";
import {
  buildXlsxBuffer,
  type SheetSpec,
} from "../../export-engine";

export interface ExcelReportResult {
  fileName: string;
  /** Raw XLSX bytes. The caller decides whether to download them. */
  bytes: Uint8Array;
}

const BRAND_BLUE = "349BD4";
const BRAND_DEEP = "2B7FB0";
const STATUS_DANGER = "C0504D";
const STATUS_WARNING = "C8A98C";

export class ExcelReporter {
  async write(context: ImportContext): Promise<ExcelReportResult> {
    const summarySheet: SheetSpec = {
      name: "Résumé",
      accentColor: BRAND_BLUE,
      columns: [
        { header: "Métrique", key: "metric", width: 32 },
        { header: "Valeur", key: "value", width: 48 },
      ],
      rows: [
        { metric: "Run ID", value: context.runId },
        { metric: "Fichier", value: context.filePath },
        { metric: "Checksum (SHA-256)", value: context.fileChecksum ?? "" },
        { metric: "Taille (octets)", value: context.fileSize },
        { metric: "Début", value: context.startedAt.toISOString() },
        { metric: "Fin", value: context.finishedAt ? context.finishedAt.toISOString() : "" },
        { metric: "Durée (ms)", value: context.durationMs ?? "" },
        { metric: "— Statistiques globales —", value: "" },
        { metric: "Feuilles traitées", value: context.stats.sheetsProcessed },
        { metric: "Lignes lues", value: context.stats.rowsRead },
        { metric: "Lignes insérées", value: context.stats.rowsImported },
        { metric: "Lignes mises à jour", value: context.stats.rowsUpdated },
        { metric: "Lignes ignorées (doublons)", value: context.stats.rowsSkipped },
        { metric: "Lignes rejetées", value: context.stats.rowsRejected },
        { metric: "Avertissements", value: context.stats.warnings },
      ],
    };

    // Per-sheet detail rows.
    for (const sheetResult of context.sheetResults) {
      summarySheet.rows.push(
        { metric: `— Feuille: ${sheetResult.sheet} (${sheetResult.schema}) —`, value: "" },
        { metric: "  Lignes lues", value: sheetResult.rowsRead },
        { metric: "  Insérées", value: sheetResult.rowsImported },
        { metric: "  Mises à jour", value: sheetResult.rowsUpdated },
        { metric: "  Ignorées", value: sheetResult.rowsSkipped },
        { metric: "  Rejetées", value: sheetResult.rowsRejected },
      );
    }

    const rejectedSheet: SheetSpec = {
      name: "Lignes rejetées",
      accentColor: STATUS_DANGER,
      columns: [
        { header: "Feuille", key: "sheet", width: 22 },
        { header: "Ligne", key: "row", width: 8 },
        { header: "Champ", key: "field", width: 22 },
        { header: "En-tête", key: "header", width: 22 },
        { header: "Règle", key: "rule", width: 18 },
        { header: "Raison", key: "reason", width: 60 },
      ],
      rows:
        context.errors.length === 0
          ? [{ sheet: "Aucune erreur", row: "", field: "", header: "", rule: "", reason: "" }]
          : context.errors.map((e) => ({
              sheet: e.sheet ?? "",
              row: e.rowIndex ?? "",
              field: e.field ?? "",
              header: e.header ?? "",
              rule: e.rule,
              reason: e.message,
            })),
    };

    const warningsSheet: SheetSpec = {
      name: "Avertissements",
      accentColor: STATUS_WARNING,
      columns: [
        { header: "Feuille", key: "sheet", width: 22 },
        { header: "Ligne", key: "row", width: 8 },
        { header: "Champ", key: "field", width: 22 },
        { header: "Règle", key: "rule", width: 18 },
        { header: "Message", key: "message", width: 60 },
      ],
      rows:
        context.warnings.length === 0
          ? [{ sheet: "Aucun avertissement", row: "", field: "", rule: "", message: "" }]
          : context.warnings.map((w) => ({
              sheet: w.sheet ?? "",
              row: w.rowIndex ?? "",
              field: w.field ?? "",
              rule: w.rule,
              message: w.message,
            })),
    };

    const fileName = `import-report-${context.runId}.xlsx`;
    const bytes = await buildXlsxBuffer([summarySheet, rejectedSheet, warningsSheet]);
    return { fileName, bytes };
  }
}

// Brand constants re-exported for tests / external consumers.
export { BRAND_BLUE, BRAND_DEEP, STATUS_DANGER, STATUS_WARNING };
