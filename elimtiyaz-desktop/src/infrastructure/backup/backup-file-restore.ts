/**
 * backup-file-restore.ts — T-505 (BKUP-511): the restore-from-file workflow.
 *
 * THE OWNER'S MANDATE: "Choose where to load backups from: Allow me to
 * browse my computer, select an existing backup file or ZIP archive, and
 * restore its contents through the application. I should not be restricted
 * to backups stored in a predefined directory." + "Display the selected
 * backup's filename, location, creation date when available, and relevant
 * contents before restoration."
 *
 * THE ARCHITECTURE (no parallel restore implementation — §6/§9):
 *   1. PICK — the native Electron file dialog (`vault:pick-backup-file`
 *      IPC; the renderer NEVER touches the filesystem). The bytes come to
 *      the renderer ONCE; the remembered source directory opens the dialog
 *      where the owner left off.
 *   2. VALIDATE — the ladder, all in the renderer where the crypto + the
 *      vault live:
 *        a. ZIP format (the production STORE-method reader — a foreign
 *           Deflate ZIP fails with an explicit message)
 *        b. the manifest (format "entire-archive" + the archives census)
 *        c. per-archive: the ciphertext present + the IV present + the
 *           SHA-256 checksum matches (the same bit-rot detector the vault
 *           restore runs)
 *      An EXCEL-ONLY ZIP (the T-382 excel-zip format) is identified and
 *      honestly routed: its recovery path is the Excel import, not the
 *      vault restore.
 *   3. PREVIEW — the inspection result (filename, path, size, dates, the
 *      per-archive counts from the manifest) feeds the pre-restore modal;
 *      the owner SELECTS which archive to restore (never a single
 *      auto-picked one).
 *   4. IMPORT — the selected archive's record goes INTO the IndexedDB
 *      vault (`storeArchive` — the SAME store the backups write), then the
 *      EXISTING `repos.backups.restore(archiveId)` path performs the
 *      actual restore (decrypt → verify → apply → stage → marker → audit).
 *      The safety backup of the current state is the caller's step (the
 *      UI runs `runBackup` first — the owner's "create a safety backup of
 *      the current data whenever appropriate").
 *
 * A corrupted/invalid file NEVER mutates the vault — the import only runs
 * after every gate passes.
 */
import { readZip, findZipEntry, ZipFormatError } from "../export/zip-reader";
import { sha256 } from "./aes-256";
import { storeArchive, type VaultRecord } from "./indexed-db-vault";
import type { BackupArchive } from "../../domain/model/backup";
import {
  getLastBackupSourceDir,
  setLastBackupSourceDir,
  parentDirectoryOf,
} from "./backup-locations";
import { logger } from "../../core/logger";

/** A picked backup file (the raw bytes + the OS metadata). */
export interface PickedBackupFile {
  readonly name: string;
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly sizeBytes: number;
  readonly lastModified: string | null;
}

/** One archive inside the picked file (the manifest's census + the gates). */
export interface InspectedBackupArchive {
  readonly archiveId: string;
  readonly createdAt: string;
  readonly sizeBytes: number;
  readonly checksum: string;
  readonly createdBy: string;
  readonly counts: {
    parents: number;
    students: number;
    payments: number;
    installments: number;
  };
  /** The per-archive gates: ciphertext + IV present, checksum verified. */
  readonly integrity: "verified" | "invalid";
  readonly integrityNote: string | null;
  /** The prepared vault record (only when integrity === "verified"). */
  readonly record: VaultRecord | null;
}

/** The full inspection result (the pre-restore modal's data). */
export interface BackupFileInspection {
  /** What the file turned out to be. */
  readonly kind: "entire-archive-zip" | "excel-zip" | "invalid";
  readonly fileName: string;
  readonly filePath: string;
  readonly sizeBytes: number;
  readonly lastModified: string | null;
  readonly exportedAt: string | null;
  readonly archives: InspectedBackupArchive[];
  readonly integrityNote: string | null;
}

/**
 * Open the native backup-file picker. Returns null when the owner canceled
 * (a clean outcome), throws on a bridge failure. The remembered source
 * directory opens the dialog where the owner left off and is updated only
 * after a SUCCESSFUL pick.
 */
export async function pickBackupFileViaDialog(): Promise<PickedBackupFile | null> {
  const bridge =
    typeof window !== "undefined" ? window.elImtiyazDesktop : undefined;
  if (typeof bridge?.pickBackupFile !== "function") {
    throw new Error(
      "Le sélecteur de fichiers natif nécessite l'application de bureau Electron (cette exécution n'expose pas le pont de dialogue).",
    );
  }
  const result = await bridge.pickBackupFile(getLastBackupSourceDir() ?? undefined);
  if (result.error) {
    throw new Error(`Échec du sélecteur de fichiers : ${result.error}`);
  }
  if (result.canceled || !result.name || !result.path || !result.bytes) {
    return null;
  }
  const file: PickedBackupFile = {
    name: result.name,
    path: result.path,
    bytes: Uint8Array.from(result.bytes),
    sizeBytes: result.sizeBytes ?? result.bytes.length,
    lastModified: result.lastModified ?? null,
  };
  const dir = parentDirectoryOf(file.path);
  if (dir) setLastBackupSourceDir(dir);
  return file;
}

/** The manifest's expected shape (archive-export.ts writes it). */
interface ExportManifestShape {
  format?: string;
  exportedAt?: string;
  generator?: string;
  archives?: Array<
    BackupArchive & { file?: string; ivFile?: string }
  >;
  files?: Array<{ name: string; sizeBytes: number; description: string }>;
}

/**
 * THE VALIDATION LADDER — inspect a picked file WITHOUT mutating anything.
 * Never throws for content problems: every failure lands in the inspection
 * result (kind "invalid" + the note) so the modal can explain it.
 */
export function inspectBackupFile(file: PickedBackupFile): BackupFileInspection {
  const base = {
    fileName: file.name,
    filePath: file.path,
    sizeBytes: file.sizeBytes,
    lastModified: file.lastModified,
  };

  // ── Gate 1: the ZIP container ────────────────────────────────────────────
  let entries;
  try {
    entries = readZip(file.bytes);
  } catch (err) {
    const note =
      err instanceof ZipFormatError
        ? err.message
        : "Le fichier n'a pas pu être lu comme une archive ZIP valide.";
    logger.warn("backup.file_restore.zip_invalid", { path: file.path, note });
    return {
      ...base,
      kind: "invalid",
      exportedAt: null,
      archives: [],
      integrityNote: note,
    };
  }

  // ── Gate 2: the manifest ─────────────────────────────────────────────────
  const manifestEntry = findZipEntry(entries, "manifest.json");
  if (!manifestEntry) {
    return {
      ...base,
      kind: "invalid",
      exportedAt: null,
      archives: [],
      integrityNote:
        "Manifeste introuvable dans l'archive — seuls les exports « Archive complète » produits par l'application sont restaurables (l'entrée manifest.json fait foi).",
    };
  }
  let manifest: ExportManifestShape;
  try {
    manifest = JSON.parse(new TextDecoder().decode(manifestEntry.data)) as ExportManifestShape;
  } catch {
    return {
      ...base,
      kind: "invalid",
      exportedAt: null,
      archives: [],
      integrityNote: "Le manifeste de l'archive est illisible (JSON invalide).",
    };
  }

  // ── The Excel-only ZIP: honestly routed to the import path ───────────────
  if (manifest.format === "excel-zip") {
    return {
      ...base,
      kind: "excel-zip",
      exportedAt: manifest.exportedAt ?? null,
      archives: [],
      integrityNote:
        "Ce fichier est un export « Fichiers Excel seulement » — il contient le classeur complet (13 feuilles) mais PAS les archives chiffrées du coffre. Sa voie de récupération est l'import Excel (Importer des données → le classeur), pas la restauration du coffre. Pour restaurer des archives chiffrées, utilisez un export « Archive complète ».",
    };
  }
  if (manifest.format !== "entire-archive") {
    return {
      ...base,
      kind: "invalid",
      exportedAt: null,
      archives: [],
      integrityNote: `Format de manifeste inconnu (« ${String(manifest.format)} ») — seuls les exports « Archive complète » et « Fichiers Excel seulement » sont reconnus.`,
    };
  }

  // ── Gate 3: the per-archive census + checksums ───────────────────────────
  const archives: InspectedBackupArchive[] = [];
  for (const meta of manifest.archives ?? []) {
    const note = (message: string): InspectedBackupArchive => ({
      archiveId: meta.id,
      createdAt: meta.createdAt,
      sizeBytes: meta.sizeBytes,
      checksum: meta.checksum,
      createdBy: meta.createdBy,
      counts: {
        parents: meta.metadata?.parentCount ?? 0,
        students: meta.metadata?.studentCount ?? 0,
        payments: meta.metadata?.paymentCount ?? 0,
        installments: meta.metadata?.installmentCount ?? 0,
      },
      integrity: "invalid",
      integrityNote: message,
      record: null,
    });

    const cipherEntry = findZipEntry(entries, meta.file ?? `backups/${meta.id}`);
    const ivEntry = findZipEntry(entries, meta.ivFile ?? `backups/${meta.id}.iv.json`);
    if (!cipherEntry) {
      archives.push(note("Chiffrement absent de l'archive (fichier backups/… manquant)."));
      continue;
    }
    if (!ivEntry) {
      archives.push(
        note("Vecteur d'initialisation absent (fichier backups/….iv.json manquant) — l'archive est irrécupérable sans lui."),
      );
      continue;
    }
    let iv: number[] | null = null;
    try {
      const parsed = JSON.parse(new TextDecoder().decode(ivEntry.data)) as { iv?: number[] };
      if (Array.isArray(parsed.iv)) iv = parsed.iv;
    } catch {
      /* handled below */
    }
    if (!iv || iv.length !== 12) {
      archives.push(note("Vecteur d'initialisation invalide (12 octets attendus)."));
      continue;
    }
    archives.push({
      archiveId: meta.id,
      createdAt: meta.createdAt,
      sizeBytes: meta.sizeBytes,
      checksum: meta.checksum,
      createdBy: meta.createdBy,
      counts: {
        parents: meta.metadata?.parentCount ?? 0,
        students: meta.metadata?.studentCount ?? 0,
        payments: meta.metadata?.paymentCount ?? 0,
        installments: meta.metadata?.installmentCount ?? 0,
      },
      integrity: "verified",
      integrityNote: null,
      // The prepared record — the async checksum runs in importBackupArchive
      // (the SHA-256 over the ciphertext is awaited there; everything here
      // is the synchronous structural validation).
      record: {
        id: meta.id,
        metadata: meta,
        ciphertext: cipherEntry.data,
        iv: Uint8Array.from(iv),
      },
    });
  }

  if (archives.length === 0) {
    return {
      ...base,
      kind: "invalid",
      exportedAt: manifest.exportedAt ?? null,
      archives: [],
      integrityNote: "Le manifeste ne déclare aucune archive.",
    };
  }

  return {
    ...base,
    kind: "entire-archive-zip",
    exportedAt: manifest.exportedAt ?? null,
    archives,
    integrityNote: null,
  };
}

/**
 * Import ONE inspected archive into the vault — the async half of the
 * ladder (the SHA-256 checksum needs the WebCrypto await). The vault is
 * mutated ONLY when every gate passes; a failure leaves the vault
 * byte-identical (the current data is preserved).
 */
export async function importBackupArchive(
  archive: InspectedBackupArchive,
): Promise<{ ok: true; archiveId: string } | { ok: false; error: string }> {
  if (archive.integrity !== "verified" || !archive.record) {
    return {
      ok: false,
      error: archive.integrityNote ?? "L'archive n'a pas passé la validation.",
    };
  }
  // The checksum gate — the same bit-rot detector the vault restore runs
  // (the manifest's recorded checksum vs the ciphertext as it exists in the
  // picked file).
  const actual = await sha256(archive.record.ciphertext);
  if (actual !== archive.checksum) {
    logger.warn("backup.file_restore.checksum_mismatch", {
      archiveId: archive.archiveId,
      expected: archive.checksum,
      actual,
    });
    return {
      ok: false,
      error:
        "Checksum SHA-256 invalide pour l'archive sélectionnée — le fichier a été modifié ou endommagé depuis l'export (bit-rot). Aucune donnée n'a été modifiée.",
    };
  }
  await storeArchive(archive.record);
  return { ok: true, archiveId: archive.archiveId };
}
