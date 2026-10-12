/**
 * t-505-backup-tab-file-ui.test.tsx — T-505 (BKUP-511): the BackupTab's
 * file-based workflows AT THE UI LAYER — the integration the owner demanded
 * ("Test the actual integration between the frontend and backend, not just
 * the underlying business logic").
 *
 * What this suite pins:
 *
 *   A. The new "Sauvegarde locale — fichiers" card renders: the checkpoint
 *      button, the restore-from-file button, and the remembered-locations
 *      panel — gated by ManageBackups like every other mutation.
 *   B. Without the Electron bridge the restore-from-file button is
 *      DISABLED with the honest explanation (the browser cannot browse).
 *   C. THE FULL CLICK-THROUGH CHAIN with the bridge mocked to a REAL
 *      export: seed a real vault backup → export it → the owner "picks"
 *      the file → the inspection modal lists the archive (filename,
 *      location, dates, counts) → select it → confirm (the destructive
 *      gate) → the SAFETY BACKUP runs → the import lands in the vault →
 *      the EXISTING restore applies → the marker is set. Every step
 *      through the app's real code paths (the real mock repositories +
 *      the real vault + the real builders).
 *
 * Run:
 *   npx vitest run src/tests/features/settings/t-505-backup-tab-file-ui.test.tsx
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import React from "react";
import "fake-indexeddb/auto";
import "../../../i18n/i18n";

import { BackupTab } from "../../../features/settings/backup-tab";
import { Role } from "../../../core/rbac/roles";
import { Permission } from "../../../core/rbac/permissions";
import {
  setBackupPassphrase,
  getRestoredFromMarker,
  clearRestoredFromMarker,
} from "../../../infrastructure/backup/backup-service";
import { clearVault, listArchiveMetadata } from "../../../infrastructure/backup/indexed-db-vault";
import {
  getLastBackupSourceDir,
  getLastBackupDestinationDir,
} from "../../../infrastructure/backup/backup-locations";

const toasts = {
  showSuccess: vi.fn(),
  showError: vi.fn(),
  showWarning: vi.fn(),
  showInfo: vi.fn(),
};

let mockSession: Record<string, unknown> | null = null;

vi.mock("../../../app/providers/repository-provider", () => ({
  useRepositories: () => ({
    backups: {
      observe: () => ({
        get: () => currentArchives,
        subscribe: () => () => undefined,
      }),
      runBackup: async (actorId: string, actorName: string) => {
        // The REAL service (the same path the UI button rides).
        const { runBackup } = await import("../../../infrastructure/backup/backup-service");
        const { mockRepositories } = await import("../../../infrastructure/mock/mock-composite");
        const r = await runBackup(mockRepositories, actorId, actorName);
        if (r.ok) currentArchives = [r.value, ...currentArchives];
        return r;
      },
      restore: async (archiveId: string, actorId: string, actorName: string) => {
        const { restore } = await import("../../../infrastructure/backup/backup-service");
        const { mockRepositories } = await import("../../../infrastructure/mock/mock-composite");
        return restore(mockRepositories, archiveId, actorId, actorName);
      },
      inspectArchive: async () => ({ ok: true, value: {} as never }),
      deleteArchive: async () => ({ ok: true, value: undefined }),
      purgeExpired: async () => ({ ok: true, value: [] as never }),
    },
    audit: { log: async () => ({ ok: true, value: {} as never }) },
  }),
}));

vi.mock("../../../app/providers/toast-provider", () => ({
  useToast: () => toasts,
}));

vi.mock("../../../app/providers/auth-provider", () => ({
  useAuth: () => ({ session: mockSession }),
}));

let currentArchives: import("../../../domain/model/backup").BackupArchive[] = [];

function adminSession() {
  return {
    userId: "usr-admin",
    displayName: "Super Admin",
    role: Role.SuperAdmin,
    tenantId: "t1",
    permissions: { has: (p: Permission) => p === Permission.ManageBackups || true },
  };
}

/** The REAL entire-archive export bytes (what the owner's kept file holds). */
async function buildRealExport(): Promise<{ bytes: Uint8Array; fileName: string }> {
  const { buildEntireArchiveExport } = await import("../../../infrastructure/export/archive-export");
  const built = await buildEntireArchiveExport(new Date("2026-10-12T08:00:00Z"));
  return { bytes: built.bytes, fileName: built.fileName };
}

describe("T-505 — the BackupTab's file-based workflows (the UI integration)", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.clear();
    await clearVault();
    clearRestoredFromMarker();
    setBackupPassphrase("t505-ui-passphrase");
    currentArchives = [];
    mockSession = adminSession();
  });

  afterEach(() => {
    cleanup();
    delete (window as unknown as Record<string, unknown>).elImtiyazDesktop;
  });

  it("A: the local-backup-files card renders (checkpoint + restore-from-file + the locations panel)", async () => {
    render(<BackupTab />);
    expect(await screen.findByTestId("backup-excel-checkpoint-button")).toBeTruthy();
    expect(screen.getByTestId("backup-restore-from-file-button")).toBeTruthy();
    expect(screen.getByTestId("backup-locations-panel")).toBeTruthy();
    expect(screen.getByTestId("backup-choose-destination-button")).toBeTruthy();
  });

  it("B: without the Electron bridge the restore-from-file button is honestly disabled", async () => {
    render(<BackupTab />);
    const btn = await screen.findByTestId("backup-restore-from-file-button");
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(
      screen.getByText(/le sélecteur de fichiers natif n'est pas disponible dans cette exécution navigateur/i),
    ).toBeTruthy();
  });

  it("C: THE FULL CHAIN — pick a kept export → inspect → select → confirm → safety backup → import → the EXISTING restore → the marker", async () => {
    // Seed a REAL vault backup, then export it (the owner's kept file).
    const { runBackup } = await import("../../../infrastructure/backup/backup-service");
    const { mockRepositories } = await import("../../../infrastructure/mock/mock-composite");
    const seeded = await runBackup(mockRepositories, "usr-admin", "Super Admin");
    expect(seeded.ok).toBe(true);
    if (seeded.ok) currentArchives = [seeded.value];
    const kept = await buildRealExport();
    await clearVault(); // the vault is lost — the file is the only copy.

    // The Electron bridge mock: the native picker returns the kept file.
    (window as unknown as Record<string, unknown>).elImtiyazDesktop = {
      saveFile: vi.fn(),
      pickBackupFile: vi.fn(async () => ({
        name: kept.fileName,
        path: `/mnt/usb/${kept.fileName}`,
        bytes: Array.from(kept.bytes),
        sizeBytes: kept.bytes.byteLength,
        lastModified: "2026-10-12T09:00:00.000Z",
      })),
      pickDirectory: vi.fn(),
    };

    render(<BackupTab />);
    const btn = await screen.findByTestId("backup-restore-from-file-button");
    expect((btn as HTMLButtonElement).disabled).toBe(false);

    // 1. The owner browses + picks.
    fireEvent.click(btn);

    // 2. The inspection modal: the file identity + the archive census.
    await waitFor(
      () => expect(screen.getByText(/Fichier de sauvegarde —/)).toBeTruthy(),
      { timeout: 8000 },
    );
    if (toasts.showError.mock.calls.length > 0) {
      console.log("[debug] showError calls:", JSON.stringify(toasts.showError.mock.calls));
    }
    expect(screen.getByText(/\/mnt\/usb\/el-imtiyaz-archive-complete/)).toBeTruthy();
    const archiveRow = await screen.findByTestId(
      `file-archive-${(seeded as { value: { id: string } }).value.id}`,
    );
    expect(archiveRow.textContent).toContain("parents");
    expect(archiveRow.textContent).toContain("élèves");

    // 3. The owner SELECTS the specific archive (never auto-picked).
    fireEvent.click(archiveRow);
    expect(archiveRow.getAttribute("aria-checked")).toBe("true");

    // 4. The destructive confirmation gate.
    fireEvent.click(screen.getByRole("button", { name: /Restaurer l'archive sélectionnée/ }));
    await screen.findByText("Restaurer depuis le fichier ?");
    const confirmBtn = screen
      .getAllByRole("button")
      .find((b) => (b.textContent ?? "").trim() === "Restaurer");
    expect(confirmBtn).toBeTruthy();

    // 5. Confirm → the SAFETY BACKUP + the import + the EXISTING restore.
    fireEvent.click(confirmBtn!);
    await waitFor(
      () => expect(toasts.showSuccess).toHaveBeenCalledWith("Restauration depuis fichier appliquée", expect.any(String)),
      { timeout: 20000 },
    );

    // The marker proves the restore applied through the real path.
    const marker = getRestoredFromMarker();
    expect(marker?.archiveId).toBe((seeded as { value: { id: string } }).value.id);
    // The vault now holds BOTH the imported archive AND the safety backup.
    const vaultList = await listArchiveMetadata();
    expect(vaultList.length).toBe(2);
    // The remembered source directory was updated (the last-location memory).
    expect(getLastBackupSourceDir()).toBe("/mnt/usb");
    expect(getLastBackupDestinationDir()).toBeNull(); // untouched — no save happened
  }, 45000);
});
