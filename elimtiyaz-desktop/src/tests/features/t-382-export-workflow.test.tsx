/**
 * T-382 (BKUP-500) — the export destination + format workflow suite.
 *
 * Owner mandate (73rd session, 2026-09-16): "add the ability to choose
 * where the export will be saved" (Backups → Sync/Export area) and "for
 * both Excel and Archive, a button that allows the user to choose the
 * export location", with the format choice: the ENTIRE archive or ONLY
 * the zipped Excel files — both choices BEFORE the export starts.
 *
 * What this suite pins:
 *
 *   A. zip-writer — the dependency-free STORE-method ZIP: entries
 *      round-trip byte-identically (parsed back from the central
 *      directory), UTF-8 names survive, duplicates/invalid names throw.
 *   B. export-target — the destination seam: with the Electron bridge the
 *      bytes go to saveFile (the OS dialog) with saved/canceled/path
 *      mapping; without it the browser downloadBlob fallback runs.
 *   C. archive-export — the two formats: "entire archive" (manifest +
 *      every vault archive's ciphertext + per-archive IV; friendly error
 *      on an empty vault) and "zipped Excel files" (the 13-sheet workbook +
 *      manifest inside the ZIP; the xlsx is a REAL ExcelJS-readable
 *      package).
 *   D. The UI wiring — the BackupTab Sync/Export button, the
 *      ConfigurationTab (Backend) Excel + Archive buttons, and the shared
 *      ExportDialog: both format radios render, the default format is
 *      preselected per entry point, and submitting routes through the
 *      destination seam (the mocked bridge).
 *
 * Run:
 *   npx vitest run src/tests/features/t-382-export-workflow.test.tsx
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import * as fs from "node:fs";
import * as path from "node:path";
import "fake-indexeddb/auto";
import "../../i18n/i18n";

import { buildZip, type ZipEntry } from "../../infrastructure/export/zip-writer";
import {
  buildEntireArchiveExport,
  buildExcelOnlyExport,
  ARCHIVE_EXPORT_FORMAT_LABELS_FR,
} from "../../infrastructure/export/archive-export";
import { clearVault, storeArchive } from "../../infrastructure/backup/indexed-db-vault";
import { ExportDialog } from "../../features/settings/export-dialog";
import { Role } from "../../core/rbac/roles";
import { Permission } from "../../core/rbac/permissions";
import type { BackupArchive } from "../../domain/model/backup";
import type { FullExportData } from "../../infrastructure/excel/full-export";

/* ------------------------------------------------------------------ */
/* A minimal ZIP reader (central-directory driven) for the round-trip    */
/* ------------------------------------------------------------------ */

interface ParsedEntry {
  name: string;
  data: Uint8Array;
}

function readU16(b: Uint8Array, o: number): number {
  return b[o] | (b[o + 1] << 8);
}

function readU32(b: Uint8Array, o: number): number {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}

/** Parse a STORE-method ZIP built by buildZip (the format subset we emit). */
function parseZip(zip: Uint8Array): ParsedEntry[] {
  // Find EOCD (scan backwards — no comment is ever written).
  let eocd = -1;
  for (let i = zip.length - 22; i >= 0; i--) {
    if (readU32(zip, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  expect(eocd).toBeGreaterThan(-1);
  const count = readU16(zip, eocd + 10);
  let offset = readU32(zip, eocd + 16);

  const entries: ParsedEntry[] = [];
  for (let n = 0; n < count; n++) {
    expect(readU32(zip, offset)).toBe(0x02014b50); // central signature
    const method = readU16(zip, offset + 10);
    expect(method).toBe(0); // STORE
    const size = readU32(zip, offset + 20);
    const nameLen = readU16(zip, offset + 28);
    const localOffset = readU32(zip, offset + 42);
    const name = new TextDecoder().decode(zip.slice(offset + 46, offset + 46 + nameLen));

    // The local header must agree with the central record.
    expect(readU32(zip, localOffset)).toBe(0x04034b50);
    const localNameLen = readU16(zip, localOffset + 26);
    const dataStart = localOffset + 30 + localNameLen;
    entries.push({ name, data: zip.slice(dataStart, dataStart + size) });
    offset += 46 + nameLen;
  }
  return entries;
}

/* ================================================================== */
/* A. zip-writer                                                        */
/* ================================================================== */

describe("T-382 A. zip-writer — the dependency-free STORE-method ZIP", () => {
  it("round-trips every entry byte-identically with UTF-8 names intact", () => {
    const entries: ZipEntry[] = [
      { name: "manifest.json", data: new TextEncoder().encode('{"format":"test"}') },
      { name: "backups/backup-2026-09-16-020000.db", data: new Uint8Array([1, 2, 3, 250, 255, 0]) },
      { name: "dossier-élèves/résultats.xlsx", data: new Uint8Array(300).fill(7) },
    ];
    const zip = buildZip(entries);
    const parsed = parseZip(zip);
    expect(parsed.map((e) => e.name)).toEqual(entries.map((e) => e.name));
    for (let i = 0; i < entries.length; i++) {
      expect(Buffer.from(parsed[i].data).equals(Buffer.from(entries[i].data))).toBe(true);
    }
  });

  it("rejects duplicate entry names (a malformed archive is worse than a loud error)", () => {
    expect(() =>
      buildZip([
        { name: "a.txt", data: new Uint8Array(1) },
        { name: "a.txt", data: new Uint8Array(1) },
      ]),
    ).toThrow(/Duplicate/);
  });

  it("rejects empty and leading-slash names", () => {
    expect(() => buildZip([{ name: "", data: new Uint8Array(1) }])).toThrow(/Invalid/);
    expect(() => buildZip([{ name: "/abs.txt", data: new Uint8Array(1) }])).toThrow(/Invalid/);
  });
});

/* ================================================================== */
/* B. export-target — the destination seam                               */
/* ================================================================== */

// Mock the export engine so downloadBlob is observable (the fallback path)
// while every OTHER export stays real (buildXlsxBuffer keeps working).
const downloadBlobMock = vi.fn();
vi.mock("../../infrastructure/excel/export-engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../infrastructure/excel/export-engine")>();
  return {
    ...actual,
    downloadBlob: (...args: unknown[]) => downloadBlobMock(...args),
  };
});

const saveFileMock = vi.fn();

function withBridge(): void {
  (window as unknown as { elImtiyazDesktop: unknown }).elImtiyazDesktop = {
    saveFile: saveFileMock,
    pickFile: vi.fn(),
  };
}

function withoutBridge(): void {
  delete (window as unknown as { elImtiyazDesktop?: unknown }).elImtiyazDesktop;
}

describe("T-382 B. export-target — the destination seam", () => {
  beforeEach(() => {
    saveFileMock.mockReset();
    downloadBlobMock.mockReset();
  });

  it("routes through the Electron bridge (the OS save dialog) when present", async () => {
    withBridge();
    saveFileMock.mockResolvedValue({ saved: true, path: "/home/owner/Desktop/export.zip" });
    const { saveExportWithPicker } = await import("../../infrastructure/export/export-target");

    const result = await saveExportWithPicker(new Uint8Array([9, 9]), "f.zip", "application/zip");
    expect(saveFileMock).toHaveBeenCalledWith("f.zip", new Uint8Array([9, 9]));
    expect(result.method).toBe("electron-save-dialog");
    expect(result.saved).toBe(true);
    expect(result.path).toBe("/home/owner/Desktop/export.zip");
    expect(result.canceled).toBe(false);
    expect(downloadBlobMock).not.toHaveBeenCalled();
  });

  it("a canceled dialog is a clean non-error outcome (no bytes written)", async () => {
    withBridge();
    saveFileMock.mockResolvedValue({ saved: false, canceled: true });
    const { saveExportWithPicker } = await import("../../infrastructure/export/export-target");

    const result = await saveExportWithPicker(new Uint8Array([1]), "f.zip", "application/zip");
    expect(result.canceled).toBe(true);
    expect(result.saved).toBe(false);
    expect(downloadBlobMock).not.toHaveBeenCalled();
  });

  it("falls back to the browser download when the bridge is absent", async () => {
    withoutBridge();
    const { saveExportWithPicker } = await import("../../infrastructure/export/export-target");

    const result = await saveExportWithPicker(new Uint8Array([3]), "f.zip", "application/zip");
    expect(result.method).toBe("browser-download");
    expect(result.saved).toBe(true);
    expect(downloadBlobMock).toHaveBeenCalledWith(new Uint8Array([3]), "f.zip", "application/zip");
  });

  it("a bridge IO error surfaces as a thrown error the caller can toast", async () => {
    withBridge();
    saveFileMock.mockResolvedValue({ saved: false, error: "disk full" });
    const { saveExportWithPicker } = await import("../../infrastructure/export/export-target");

    await expect(
      saveExportWithPicker(new Uint8Array([1]), "f.zip", "application/zip"),
    ).rejects.toThrow(/disk full/);
  });
});

/* ================================================================== */
/* C. archive-export — the two formats                                  */
/* ================================================================== */

function archiveMetadata(id: string, createdAt: string): BackupArchive {
  return {
    id,
    tenantId: "tenant-test",
    createdAt,
    sizeBytes: 16,
    checksum: "deadbeef",
    vaultLocation: "local",
    status: "encrypted",
    retentionExpiresAt: "2027-09-16T00:00:00.000Z",
    createdBy: "Test Runner",
    metadata: { parentCount: 1, studentCount: 1, paymentCount: 0, ledgerEntryCount: 0, installmentCount: 0, workflowCount: 0 },
  } as unknown as BackupArchive;
}

const EMPTY_EXPORT_DATA = {
  parents: [],
  students: [],
  personnel: [],
  payments: [],
  installments: [],
  ledger: [],
  expenses: [],
  assessments: [],
  subjects: [],
  attendance: [],
  debtSummaries: [],
  classes: [],
  pricing: null,
  exportedAt: "2026-09-16T10-00-00",
} as unknown as FullExportData;

describe("T-382 C. archive-export — the two formats", () => {
  beforeEach(async () => {
    await clearVault();
  });
  afterEach(async () => {
    await clearVault();
  });

  it("entire-archive: exports the COMPLETE vault structure — every archive's ciphertext + IV + the manifest", async () => {
    const c1 = new Uint8Array([1, 2, 3, 4]);
    const c2 = new Uint8Array([5, 6]);
    await storeArchive({
      id: "backup-2026-09-16-020000.db",
      metadata: archiveMetadata("backup-2026-09-16-020000.db", "2026-09-16T02:00:00.000Z"),
      ciphertext: c1,
      iv: new Uint8Array([11, 12]),
    });
    await storeArchive({
      id: "backup-2026-09-16-030000.db",
      metadata: archiveMetadata("backup-2026-09-16-030000.db", "2026-09-16T03:00:00.000Z"),
      ciphertext: c2,
      iv: new Uint8Array([21]),
    });

    const built = await buildEntireArchiveExport();
    expect(built.fileName).toMatch(/^el-imtiyaz-archive-complete-.*\.zip$/);
    expect(built.mime).toBe("application/zip");

    const parsed = parseZip(built.bytes);
    const names = parsed.map((e) => e.name);
    expect(names).toContain("manifest.json");
    expect(names).toContain("backups/backup-2026-09-16-020000.db");
    expect(names).toContain("backups/backup-2026-09-16-020000.db.iv.json");
    expect(names).toContain("backups/backup-2026-09-16-030000.db");
    expect(names).toContain("backups/backup-2026-09-16-030000.db.iv.json");

    // The ciphertext is byte-identical to the vault entry (an off-site COPY).
    const db1 = parsed.find((e) => e.name === "backups/backup-2026-09-16-020000.db")!;
    expect(Buffer.from(db1.data).equals(Buffer.from(c1))).toBe(true);

    // The manifest carries the archive records + the README.
    const manifest = JSON.parse(
      new TextDecoder().decode(parsed.find((e) => e.name === "manifest.json")!.data),
    ) as { format: string; archives: Array<{ id: string }>; readme?: string };
    expect(manifest.format).toBe("entire-archive");
    expect(manifest.archives.map((a) => a.id)).toEqual([
      // newest-first
      "backup-2026-09-16-030000.db",
      "backup-2026-09-16-020000.db",
    ]);
    expect(manifest.readme).toBeTruthy();
  });

  it("entire-archive: friendly error when the vault is empty", async () => {
    await expect(buildEntireArchiveExport()).rejects.toThrow(/Aucune archive/);
  });

  it("excel-zip: exports ONLY the Excel files — the 13-sheet workbook + manifest inside the ZIP", async () => {
    const built = await buildExcelOnlyExport(EMPTY_EXPORT_DATA);
    expect(built.fileName).toMatch(/^el-imtiyaz-excel-.*\.zip$/);

    const parsed = parseZip(built.bytes);
    const names = parsed.map((e) => e.name);
    expect(names).toContain("manifest.json");
    const xlsxName = names.find((n) => n.endsWith(".xlsx"));
    expect(xlsxName).toBeDefined();

    // The embedded xlsx is a REAL package (the ZIP magic "PK\x03\x04").
    const xlsxBytes = parsed.find((e) => e.name === xlsxName)!.data;
    expect(xlsxBytes[0]).toBe(0x50);
    expect(xlsxBytes[1]).toBe(0x4b);

    const manifest = JSON.parse(
      new TextDecoder().decode(parsed.find((e) => e.name === "manifest.json")!.data),
    ) as { format: string; files: Array<{ name: string }> };
    expect(manifest.format).toBe("excel-zip");
    expect(manifest.files[0].name).toBe(xlsxName);
  });

  it("the format labels exist for both mandate options", () => {
    expect(ARCHIVE_EXPORT_FORMAT_LABELS_FR["entire-archive"].title).toContain("Archive complète");
    expect(ARCHIVE_EXPORT_FORMAT_LABELS_FR["excel-zip"].title).toContain("Excel");
  });
});

/* ================================================================== */
/* D. The UI wiring — both entry points + the shared dialog             */
/* ================================================================== */

const toasts = {
  showSuccess: vi.fn(),
  showError: vi.fn(),
  showWarning: vi.fn(),
  showInfo: vi.fn(),
};

let mockSession: Record<string, unknown> | null;

function obs<T>(value: T) {
  return {
    get: () => value,
    subscribe: (fn: (v: T) => void) => {
      fn(value);
      return () => undefined;
    },
  };
}

vi.mock("../../app/providers/repository-provider", () => ({
  useRepositories: () => ({
    parents: { observe: () => obs([]) },
    students: { observe: () => obs([]) },
    personnel: { observe: () => obs([]) },
    payments: { observe: () => obs([]) },
    installments: { observe: () => obs([]) },
    ledger: { observe: () => obs([]) },
    expenses: { observe: () => obs([]) },
    classes: { observe: () => obs([]) },
    subjects: { observe: () => obs([]) },
    grades: { observeAll: () => obs([]) },
    attendance: { observeAll: () => obs([]) },
    pricing: { observe: () => obs(null) },
    debt: { observeSummary: () => obs([]) },
    backups: {
      observe: () => obs([]),
    },
  }),
}));

vi.mock("../../app/providers/toast-provider", () => ({
  useToast: () => toasts,
}));

vi.mock("../../app/providers/auth-provider", () => ({
  useAuth: () => ({ session: mockSession }),
}));

// The dialog suite (D) needs the builders stubbed (jsdom's vault is empty);
// sections A–C exercise the REAL builders. The factory falls back to the
// original implementations whenever the spy has no impl set.
const buildEntireMock = vi.fn();
const buildExcelMock = vi.fn();
vi.mock("../../infrastructure/export/archive-export", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../infrastructure/export/archive-export")>();
  return {
    ...original,
    buildEntireArchiveExport: (...args: Parameters<typeof original.buildEntireArchiveExport>) =>
      buildEntireMock.getMockImplementation()
        ? buildEntireMock(...args)
        : original.buildEntireArchiveExport(...args),
    buildExcelOnlyExport: (...args: Parameters<typeof original.buildExcelOnlyExport>) =>
      buildExcelMock.getMockImplementation()
        ? buildExcelMock(...args)
        : original.buildExcelOnlyExport(...args),
  };
});

function adminSession(): Record<string, unknown> {
  return {
    userId: "usr-admin",
    displayName: "Super Admin",
    role: Role.SuperAdmin,
    tenantId: "t1",
    permissions: { has: (p: Permission) => p === Permission.ManageBackups || true },
  };
}

describe("T-382 D. The UI wiring — both entry points + the shared dialog", () => {
  beforeEach(async () => {
    await clearVault();
    toasts.showSuccess.mockReset();
    toasts.showError.mockReset();
    toasts.showInfo.mockReset();
    buildEntireMock.mockReset();
    buildExcelMock.mockReset();
    saveFileMock.mockReset();
    downloadBlobMock.mockReset();
    mockSession = adminSession();
    const bytes = new Uint8Array([1, 2, 3]);
    const built = { bytes, fileName: "out.zip", mime: "application/zip", summary: "s" };
    buildEntireMock.mockResolvedValue(built);
    buildExcelMock.mockResolvedValue(built);
    withBridge();
    saveFileMock.mockResolvedValue({ saved: true, path: "/tmp/out.zip" });
  });

  afterEach(() => {
    cleanup();
    withoutBridge();
  });

  it("the ExportDialog offers BOTH mandate formats, preselects the caller's default, and routes the submit through the destination seam", async () => {
    render(
      <ExportDialog
        open
        onOpenChange={() => undefined}
        origin="backend-archive"
        defaultFormat="entire-archive"
      />,
    );

    // Both format radios render (the mandate: choose the format before exporting).
    expect(screen.getByTestId("export-format-entire-archive").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByTestId("export-format-excel-zip").getAttribute("aria-checked")).toBe("false");

    // The destination explainer is honest about the mechanism.
    expect(screen.getByText(/boîte de dialogue d'enregistrement du système/i)).toBeTruthy();

    // Submit → build (entire archive default) → the OS save dialog bridge.
    fireEvent.click(screen.getByRole("button", { name: /Choisir l'emplacement et exporter/ }));
    await waitFor(() => {
      expect(buildEntireMock).toHaveBeenCalled();
      expect(saveFileMock).toHaveBeenCalledWith("out.zip", new Uint8Array([1, 2, 3]));
    });
    await waitFor(() => {
      expect(toasts.showSuccess).toHaveBeenCalledWith(
        "Export enregistré",
        expect.stringContaining("/tmp/out.zip"),
      );
    });
  });

  it("switching the format to excel-zip routes the submit through the Excel builder", async () => {
    render(
      <ExportDialog
        open
        onOpenChange={() => undefined}
        origin="backups"
        defaultFormat="entire-archive"
      />,
    );

    // The user switches the format BEFORE exporting (the mandate's order).
    fireEvent.click(screen.getByTestId("export-format-excel-zip"));
    expect(screen.getByTestId("export-format-excel-zip").getAttribute("aria-checked")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: /Choisir l'emplacement et exporter/ }));
    await waitFor(() => {
      expect(buildExcelMock).toHaveBeenCalled();
      expect(buildEntireMock).not.toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(saveFileMock).toHaveBeenCalled();
    });
  });

  it("a canceled dialog is a clean outcome (info toast, no error toast)", async () => {
    saveFileMock.mockResolvedValue({ saved: false, canceled: true });
    render(
      <ExportDialog
        open
        onOpenChange={() => undefined}
        origin="backend-excel"
        defaultFormat="excel-zip"
      />,
    );

    // The Excel entry point preselects the zipped-Excel format.
    expect(screen.getByTestId("export-format-excel-zip").getAttribute("aria-checked")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: /Choisir l'emplacement et exporter/ }));
    await waitFor(() => {
      expect(toasts.showInfo).toHaveBeenCalledWith("Export annulé", expect.any(String));
    });
    expect(toasts.showError).not.toHaveBeenCalled();
  });

  it("the BackupTab hosts the Sync/Export area's export button (gated by ManageBackups)", async () => {
    const { BackupTab } = await import("../../features/settings/backup-tab");
    mockSession = {
      ...adminSession(),
      permissions: { has: (p: Permission) => p === Permission.ManageBackups },
    };
    const { act } = await import("react");
    await act(async () => {
      render(<BackupTab />);
    });
    expect(screen.getByTestId("backup-export-button")).toBeTruthy();
  });

  it("the ConfigurationTab (Backend) hosts the Excel + Archive export buttons (SuperAdmin)", async () => {
    const { ConfigurationTab } = await import("../../features/settings/configuration-tab");
    const { act } = await import("react");
    await act(async () => {
      render(<ConfigurationTab />);
    });
    expect(screen.getByTestId("backend-export-excel")).toBeTruthy();
    expect(screen.getByTestId("backend-export-archive")).toBeTruthy();

    // The Archive button opens the shared dialog with the entire-archive preselected.
    fireEvent.click(screen.getByTestId("backend-export-archive"));
    expect(await screen.findByTestId("export-format-entire-archive")).toBeTruthy();
    expect(
      screen.getByTestId("export-format-entire-archive").getAttribute("aria-checked"),
    ).toBe("true");

    // The Excel button preselects the zipped-Excel format.
    fireEvent.click(screen.getByTestId("backend-export-excel"));
    expect(
      screen.getByTestId("export-format-excel-zip").getAttribute("aria-checked"),
    ).toBe("true");
  });
});

/* ================================================================== */
/* E. Source guards                                                     */
/* ================================================================== */

describe("T-382 E. Source guards", () => {
  it("the destination seam is wired to the REAL preload bridge (vault:save-file), not the phantom elImtiyaz API", () => {
    const target = fs.readFileSync(
      path.resolve(__dirname, "../../infrastructure/export/export-target.ts"),
      "utf8",
    );
    expect(target).toContain("elImtiyazDesktop");
    expect(target).not.toContain("window.elImtiyaz.");
  });

  it("the Electron preload actually exposes saveFile on the elImtiyazDesktop bridge", () => {
    const preload = fs.readFileSync(
      path.resolve(__dirname, "../../../electron/preload.cts"),
      "utf8",
    );
    expect(preload).toContain("elImtiyazDesktop");
    expect(preload).toContain("vault:save-file");
  });

  it("the vault gained the complete-record listing the entire-archive format needs", () => {
    const vault = fs.readFileSync(
      path.resolve(__dirname, "../../infrastructure/backup/indexed-db-vault.ts"),
      "utf8",
    );
    expect(vault).toContain("export async function listAllRecords");
  });
});
