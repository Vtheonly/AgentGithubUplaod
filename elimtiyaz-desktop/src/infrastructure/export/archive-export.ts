/**
 * archive-export.ts — the two owner-mandated export formats (T-382 / BKUP-500).
 *
 * Owner mandate (73rd session, 2026-09-16): "When the user chooses the
 * export location, they should also be able to choose the export format:
 *   - Export the entire archive: the complete archive structure and all
 *     associated files.
 *   - Export only the zipped Excel files: only the Excel files as a ZIP."
 *
 * Format 1 — "entire archive" (`buildEntireArchiveExport`): a ZIP of the
 * COMPLETE local backup-vault structure:
 *     manifest.json                    — export metadata + every archive's
 *                                        BackupArchive record (id, dates,
 *                                        size, checksum, vault, retention,
 *                                        created-by, counts) + a README
 *     backups/<archiveId>.db          — the raw AES-256-GCM ciphertext
 *                                        (byte-identical to the vault entry)
 *     backups/<archiveId>.iv.json     — the per-archive GCM IV (without the
 *                                        IV the ciphertext is unrestorable)
 * The archives stay ENCRYPTED in the export — the passphrase never leaves
 * the operator's head (VAULT §13.02: restoring requires the same passphrase
 * the backups were taken with; the export is an OFF-SITE COPY of the vault,
 * not a plaintext dump).
 *
 * Format 2 — "zipped Excel files" (`buildExcelOnlyExport`): a ZIP
 * containing the generated Excel workbook(s) — the full-application export
 * (full-export.ts, the T-368 13-sheet workbook built OVER the same
 * repository streams the UI renders) — plus a small manifest.json
 * describing the contents. This is the "lighter" format for when the
 * recipient needs the DATA, not the vault.
 *
 * Both builders return `{ bytes, fileName, mime }` — the CALLER decides the
 * destination (saveExportWithPicker) so the destination choice and the
 * format choice stay orthogonal, exactly as the mandate describes.
 */

import { buildZip, type ZipEntry } from "./zip-writer";
import { listAllRecords } from "../backup/indexed-db-vault";
import { buildFullWorkbook, type FullExportData } from "../excel/full-export";
import type { BackupArchive } from "../../domain/model/backup";

/** The two owner-mandated export formats (the UI's radio values). */
export type ArchiveExportFormat = "entire-archive" | "excel-zip";

/** What a builder returns — destination-agnostic. */
export interface BuiltExport {
  bytes: Uint8Array;
  fileName: string;
  mime: string;
  /** Human summary for the toast + audit trail. */
  summary: string;
}

/** The manifest written at the ZIP root (both formats). */
interface ExportManifest {
  format: ArchiveExportFormat;
  exportedAt: string;
  generator: "el-imtiyaz-desktop";
  /** Present on the entire-archive format. */
  archives?: Array<BackupArchive & { file: string; ivFile: string }>;
  /** Present on the excel-zip format. */
  files?: Array<{ name: string; sizeBytes: number; description: string }>;
  readme?: string;
}

/** Timestamped file-stem: 2026-09-16T14-30-05 (colon-free, sortable). */
function timestampStem(at: Date = new Date()): string {
  return at.toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

/**
 * Format 1 — the ENTIRE archive: the complete vault structure + all
 * associated files (encrypted archives, per-archive IVs, manifest).
 */
export async function buildEntireArchiveExport(
  at: Date = new Date(),
): Promise<BuiltExport> {
  const records = await listAllRecords();

  if (records.length === 0) {
    throw new Error(
      "Aucune archive dans le coffre — lancez d'abord une sauvegarde (l'export de l'archive complète exporte les sauvegardes existantes).",
    );
  }

  const entries: ZipEntry[] = [];
  const manifestArchives: NonNullable<ExportManifest["archives"]> = [];

  for (const record of records) {
    // The vault convention (VAULT §13.02) names archive ids
    // `backup-YYYY-MM-DD-HHMMSS.db` — the id IS the file name (no extra
    // extension, or the off-site copy lands as "backup-….db.db").
    const file = `backups/${record.id}`;
    const ivFile = `backups/${record.id}.iv.json`;
    entries.push({ name: file, data: record.ciphertext });
    entries.push({
      name: ivFile,
      data: new TextEncoder().encode(JSON.stringify({ iv: Array.from(record.iv) })),
    });
    manifestArchives.push({
      ...record.metadata,
      file,
      ivFile,
    });
  }

  const manifest: ExportManifest = {
    format: "entire-archive",
    exportedAt: at.toISOString(),
    generator: "el-imtiyaz-desktop",
    archives: manifestArchives,
    readme:
      "Export complet du coffre de sauvegardes El-Imtiyaz. Les fichiers backups/*.db sont " +
      "les archives AES-256-GCM chiffrees, byte-identiques au coffre local ; chaque " +
      "backups/*.iv.json porte le vecteur d'initialisation correspondant. La " +
      "restauration exige la MEME phrase secrete que celle utilisee lors des " +
      "sauvegardes (plan VAULT §13.02) — aucune donnee en clair n'est exportee.",
  };
  entries.push({
    name: "manifest.json",
    data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
  });

  const bytes = buildZip(entries, at);
  const totalBytes = records.reduce((acc, r) => acc + r.ciphertext.byteLength, 0);
  return {
    bytes,
    fileName: `el-imtiyaz-archive-complete-${timestampStem(at)}.zip`,
    mime: "application/zip",
    summary: `${records.length} archive(s) chiffrée(s) (${totalBytes} octets de données chiffrées) + manifeste`,
  };
}

/**
 * Format 2 — ONLY the zipped Excel files: the generated workbook(s) inside a
 * ZIP, plus the manifest. `data` is the reactive FullExportData snapshot the
 * caller collected from the repository streams (RLS applies — the export
 * contains what the current user may see, the T-368 convention).
 */
export async function buildExcelOnlyExport(
  data: FullExportData,
  at: Date = new Date(),
): Promise<BuiltExport> {
  const workbookBytes = await buildFullWorkbook(data);
  const xlsxName =
    `el-imtiyaz-export-complet-${data.exportedAt.replace(/[:.]/g, "-").slice(0, 19)}.xlsx`;

  const manifest: ExportManifest = {
    format: "excel-zip",
    exportedAt: at.toISOString(),
    generator: "el-imtiyaz-desktop",
    files: [
      {
        name: xlsxName,
        sizeBytes: workbookBytes.byteLength,
        description:
          "Export complet Excel (13 feuilles : Résumé, Parents, Élèves, Personnel, Paiements, Tranches, Journal, Dépenses, Notes, Présences, Créances, Classes, Services).",
      },
    ],
    readme:
      "Export des fichiers Excel uniquement (format ZIP) — les classeurs générés " +
      "par l'application, sans le coffre de sauvegardes chiffré.",
  };

  const entries: ZipEntry[] = [
    { name: xlsxName, data: workbookBytes },
    { name: "manifest.json", data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) },
  ];

  const bytes = buildZip(entries, at);
  return {
    bytes,
    fileName: `el-imtiyaz-excel-${timestampStem(at)}.zip`,
    mime: "application/zip",
    summary: `1 classeur Excel (${workbookBytes.byteLength} octets) dans l'archive ZIP + manifeste`,
  };
}

/** The French labels for the two formats (single source for every surface). */
export const ARCHIVE_EXPORT_FORMAT_LABELS_FR: Record<
  ArchiveExportFormat,
  { title: string; description: string }
> = {
  "entire-archive": {
    title: "Archive complète",
    description:
      "La structure complète du coffre et tous les fichiers associés : chaque sauvegarde chiffrée AES-256-GCM (backups/*.db), son vecteur d'initialisation et le manifeste — prête à être restaurée avec la phrase secrète.",
  },
  "excel-zip": {
    title: "Fichiers Excel seulement (ZIP)",
    description:
      "Uniquement les fichiers Excel générés (le classeur complet 13 feuilles de l'application) dans une archive ZIP — sans le coffre chiffré.",
  },
};
