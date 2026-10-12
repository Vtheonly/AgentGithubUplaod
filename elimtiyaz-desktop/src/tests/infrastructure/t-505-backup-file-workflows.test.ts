/**
 * t-505-backup-file-workflows.test.tsx — T-505 (BKUP-511): the file-based
 * backup workflows — the ZIP-of-Excel checkpoint, the restore-from-file
 * validation ladder, the import-then-EXISTING-restore chain, and the
 * last-location memory.
 *
 * What this suite pins:
 *
 *   A. zip-reader — the production STORE-method reader: round-trips the
 *      writer's output; a Deflate ZIP fails with the explicit message; a
 *      truncated/garbage file fails honestly.
 *   B. backup-locations — the last-source/last-destination memory
 *      round-trips and persists; parentDirectoryOf handles both separators.
 *   C. inspectBackupFile — THE VALIDATION LADDER: a real entire-archive
 *      export inspects as kind=entire-archive-zip with the per-archive
 *      census + prepared records; an excel-zip export is honestly routed
 *      to the import path; garbage / manifest-less / tampered files are
 *      invalid with explicit notes.
 *   D. importBackupArchive — the checksum gate: the happy path imports the
 *      record into the vault; a TAMPERED ciphertext fails WITHOUT mutating
 *      the vault.
 *   E. THE END-TO-END CHAIN — backup → export-to-file → WIPE the vault →
 *      pick-the-file → inspect → import → the EXISTING restore() → the
 *      restored-from marker (the owner's "recover the data from a kept
 *      ZIP" requirement, proven through the app's real code paths).
 *   F. buildBackupCheckpoint — the warmed ZIP-of-Excel checkpoint builds +
 *      audits; a warm-up degradation is recorded in the manifest.
 *
 * Run:
 *   npx vitest run src/tests/infrastructure/t-505-backup-file-workflows.test.tsx
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import "../../i18n/i18n";

import { buildZip, type ZipEntry } from "../../infrastructure/export/zip-writer";
import { readZip, ZipFormatError } from "../../infrastructure/export/zip-reader";
import {
  getLastBackupSourceDir,
  setLastBackupSourceDir,
  getLastBackupDestinationDir,
  setLastBackupDestinationDir,
  parentDirectoryOf,
} from "../../infrastructure/backup/backup-locations";
import {
  inspectBackupFile,
  importBackupArchive,
  type PickedBackupFile,
} from "../../infrastructure/backup/backup-file-restore";
import {
  buildEntireArchiveExport,
  buildExcelOnlyExport,
} from "../../infrastructure/export/archive-export";
import {
  setBackupPassphrase,
  restore,
  getRestoredFromMarker,
  clearRestoredFromMarker,
} from "../../infrastructure/backup/backup-service";
import {
  getArchive,
  clearVault,
} from "../../infrastructure/backup/indexed-db-vault";
import { store } from "../../infrastructure/mock/repositories/mock-store";
import { mockRepositories } from "../../app/providers/repository-provider";
import { buildBackupCheckpoint } from "../../infrastructure/backup/backup-checkpoint";
import type { FullExportData } from "../../infrastructure/excel/full-export";

/* ================================================================== */
/* A. zip-reader                                                        */
/* ================================================================== */

describe("T-505 A. zip-reader — the production STORE-method reader", () => {
  it("round-trips the writer's output byte-identically", () => {
    const entries: ZipEntry[] = [
      { name: "manifest.json", data: new TextEncoder().encode('{"format":"entire-archive"}') },
      { name: "backups/backup-2026-10-12-020000-123.db", data: new Uint8Array([9, 8, 7, 250, 0, 255]) },
      { name: "dossiers/élèves-2026.xlsx", data: new Uint8Array(64).fill(3) },
    ];
    const zip = buildZip(entries);
    const read = readZip(zip);
    expect(read.map((e) => e.name)).toEqual(entries.map((e) => e.name));
    for (let i = 0; i < entries.length; i++) {
      expect(Buffer.from(read[i].data).equals(Buffer.from(entries[i].data))).toBe(true);
    }
  });

  it("a DEFLATE zip (foreign tool) fails with the explicit unsupported-method message", () => {
    // Hand-craft a minimal central record declaring method 8 (Deflate).
    const eocd = new Uint8Array(22);
    const dv = new DataView(eocd.buffer);
    dv.setUint32(0, 0x06054b50, true);
    dv.setUint16(8, 0, true); // disk numbers
    dv.setUint16(10, 1, true); // 1 entry
    const central = new Uint8Array(46);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, 8, true); // method = Deflate
    const zip = new Uint8Array([...central, ...eocd]);
    expect(() => readZip(zip)).toThrow(/méthode de compression non supportée/i);
  });

  it("a truncated file fails honestly", () => {
    expect(() => readZip(new Uint8Array([0x50, 0x4b, 1, 2, 3]))).toThrow(ZipFormatError);
  });
});

/* ================================================================== */
/* B. backup-locations — the last-location memory                       */
/* ================================================================== */

describe("T-505 B. backup-locations — the remembered directories", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips the source + destination slots", () => {
    expect(getLastBackupSourceDir()).toBeNull();
    expect(getLastBackupDestinationDir()).toBeNull();
    setLastBackupSourceDir("D:\\Sauvegardes");
    setLastBackupDestinationDir("/home/owner/backups");
    expect(getLastBackupSourceDir()).toBe("D:\\Sauvegardes");
    expect(getLastBackupDestinationDir()).toBe("/home/owner/backups");
    // Changeable at any time (the owner's mandate).
    setLastBackupDestinationDir("/media/usb");
    expect(getLastBackupDestinationDir()).toBe("/media/usb");
    // Clearing works.
    setLastBackupSourceDir(null);
    expect(getLastBackupSourceDir()).toBeNull();
  });

  it("parentDirectoryOf handles both separators", () => {
    expect(parentDirectoryOf("/home/owner/backups/export.zip")).toBe("/home/owner/backups");
    expect(parentDirectoryOf("D:\\Sauvegardes\\export.zip")).toBe("D:\\Sauvegardes");
    expect(parentDirectoryOf("export.zip")).toBeNull();
  });
});

/* ================================================================== */
/* C+D+E. the validation ladder + the end-to-end chain                  */
/* ================================================================== */

describe("T-505 C–E. the restore-from-file ladder + the end-to-end chain", () => {
  beforeEach(async () => {
    localStorage.clear();
    await clearVault();
    clearRestoredFromMarker();
    setBackupPassphrase("t505-file-workflow-passphrase");
  });

  /** Build a REAL backup in the vault with recognizable counts. */
  async function seedVaultBackup(): Promise<string> {
    const { runBackup } = await import("../../infrastructure/backup/backup-service");
    const r = await runBackup(mockRepositories, "usr-t505", "T505 Suite");
    expect(r.ok).toBe(true);
    return (r as { value: { id: string } }).value.id;
  }

  function toPickedFile(bytes: Uint8Array, name = "el-imtiyaz-archive-complete-test.zip"): PickedBackupFile {
    return {
      name,
      path: `/mnt/usb-drive/${name}`,
      bytes,
      sizeBytes: bytes.byteLength,
      lastModified: "2026-10-12T08:00:00.000Z",
    };
  }

  it("C1: a real entire-archive export inspects with the per-archive census + prepared records", async () => {
    await seedVaultBackup();
    const built = await buildEntireArchiveExport(new Date("2026-10-12T08:00:00Z"));
    const inspection = inspectBackupFile(toPickedFile(built.bytes));
    expect(inspection.kind).toBe("entire-archive-zip");
    expect(inspection.fileName).toBe("el-imtiyaz-archive-complete-test.zip");
    expect(inspection.filePath).toBe("/mnt/usb-drive/el-imtiyaz-archive-complete-test.zip");
    expect(inspection.lastModified).toBe("2026-10-12T08:00:00.000Z");
    expect(inspection.exportedAt).toBe("2026-10-12T08:00:00.000Z");
    expect(inspection.archives.length).toBe(1);
    const a = inspection.archives[0];
    expect(a.integrity).toBe("verified");
    expect(a.record).not.toBeNull();
    expect(a.counts.parents).toBe(store.parents.length);
    expect(a.counts.students).toBe(store.students.length);
  });

  it("C2: an excel-zip export is honestly routed to the import path", async () => {
    const data: FullExportData = {
      parents: [], students: [], personnel: [], payments: [], installments: [],
      ledger: [], expenses: [], assessments: [], subjects: [], attendance: [],
      debtSummaries: [], classes: [], pricing: null,
      exportedAt: "2026-10-12T08:00:00.000Z",
    };
    const built = await buildExcelOnlyExport(data, new Date("2026-10-12T08:00:00Z"));
    const inspection = inspectBackupFile(toPickedFile(built.bytes));
    expect(inspection.kind).toBe("excel-zip");
    expect(inspection.integrityNote).toContain("import Excel");
  });

  it("C3: garbage fails honestly (invalid + the explicit note)", () => {
    const inspection = inspectBackupFile(toPickedFile(new Uint8Array(64).fill(0x41), "not-a-zip.zip"));
    expect(inspection.kind).toBe("invalid");
    expect(inspection.integrityNote).toBeTruthy();
  });

  it("C4: a zip without the manifest is invalid", () => {
    const zip = buildZip([{ name: "random.bin", data: new Uint8Array([1, 2, 3]) }]);
    const inspection = inspectBackupFile(toPickedFile(zip));
    expect(inspection.kind).toBe("invalid");
    expect(inspection.integrityNote).toContain("Manifeste introuvable");
  });

  it("D1: a TAMPERED ciphertext fails the checksum gate WITHOUT mutating the vault", async () => {
    await seedVaultBackup();
    const built = await buildEntireArchiveExport(new Date("2026-10-12T08:00:00Z"));
    // Tamper: flip the FIRST byte of the manifest's first archive ciphertext.
    const read = readZip(built.bytes);
    const entries: ZipEntry[] = read.map((e) => {
      if (e.name.startsWith("backups/") && !e.name.endsWith(".json")) {
        const tampered = new Uint8Array(e.data);
        tampered[0] = tampered[0] ^ 0xff;
        return { name: e.name, data: tampered };
      }
      return { name: e.name, data: e.data };
    });
    const tamperedZip = buildZip(entries, new Date("2026-10-12T08:00:00Z"));

    const inspection = inspectBackupFile(toPickedFile(tamperedZip));
    expect(inspection.kind).toBe("entire-archive-zip");
    expect(inspection.archives[0].integrity).toBe("verified"); // structure OK
    await clearVault(); // the vault is empty before the import attempt
    const result = await importBackupArchive(inspection.archives[0]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Checksum");
    // The vault is STILL empty — no mutation on failure.
    expect(await getArchive(inspection.archives[0].archiveId)).toBeNull();
  });

  it("E: THE END-TO-END CHAIN — backup → export to file → WIPE the vault → pick → inspect → import → the EXISTING restore → the marker", async () => {
    const archiveId = await seedVaultBackup();
    // The owner keeps the export…
    const built = await buildEntireArchiveExport(new Date("2026-10-12T08:00:00Z"));
    // …then the vault is lost (new machine / cleared storage).
    await clearVault();
    expect(await getArchive(archiveId)).toBeNull();

    // Pick the kept file → inspect → select → import.
    const inspection = inspectBackupFile(toPickedFile(built.bytes));
    expect(inspection.kind).toBe("entire-archive-zip");
    const selected = inspection.archives.find((a) => a.archiveId === archiveId);
    expect(selected).toBeTruthy();
    const imported = await importBackupArchive(selected!);
    expect(imported.ok).toBe(true);

    // The EXISTING restore path — no parallel implementation.
    const r = await restore(mockRepositories, archiveId, "usr-t505", "T505 Suite");
    expect(r.ok).toBe(true);
    const marker = getRestoredFromMarker();
    expect(marker?.archiveId).toBe(archiveId);
    expect(marker?.counts.parents).toBe(store.parents.length);
    expect(marker?.counts.students).toBe(store.students.length);
  });
});

/* ================================================================== */
/* F. buildBackupCheckpoint — the ZIP-of-Excel checkpoint               */
/* ================================================================== */

describe("T-505 F. the ZIP-of-Excel backup checkpoint", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("builds the warmed checkpoint (a real PK zip) + writes the audit entry + records degradations in the manifest", async () => {
    const auditLog = vi.fn(
      async (input: { action: string; entityType: string }) =>
        ({ ok: true, value: { id: "audit-1", action: input.action } }) as never,
    );
    const repos = {
      ...mockRepositories,
      audit: { log: auditLog },
    } as unknown as typeof mockRepositories;
    const result = await buildBackupCheckpoint(repos, "usr-t505", "T505 Suite");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.bytes[0]).toBe(0x50); // PK
      expect(result.value.fileName).toMatch(/^el-imtiyaz-excel-.*\.zip$/);
      // The audit entry — the traceability contract.
      expect(auditLog).toHaveBeenCalledTimes(1);
      const firstCall = auditLog.mock.calls[0] as unknown as [
        { action: string; entityType: string },
      ];
      expect(firstCall[0].action).toBe("backup.checkpoint");
      expect(firstCall[0].entityType).toBe("backup");
      // The manifest carries the warm-up record (the mock layer = skipped).
      const read = readZip(result.value.bytes);
      const manifestEntry = read.find((e) => e.name === "manifest.json")!;
      const manifest = JSON.parse(new TextDecoder().decode(manifestEntry.data));
      expect(Array.isArray(manifest.sourceWarmup)).toBe(true);
      expect(manifest.sourceWarmup.length).toBeGreaterThan(0);
    }
  });
});
