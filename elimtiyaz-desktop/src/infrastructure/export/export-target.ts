/**
 * export-target.ts — the export destination picker (T-382 / BKUP-500).
 *
 * THE DISCOVERY this file fixes: the Electron preload bridge
 * `window.elImtiyazDesktop.saveFile` (IPC channel "vault:save-file" — an
 * OS save dialog where the user picks the destination) has existed since
 * the Electron shell was written, but NO renderer code ever invoked it —
 * every export went through `downloadBlob` (a synthetic <a download> click),
 * which in Electron silently drops the file into the user's Downloads
 * folder with NO location choice. (Corollary discovery: `src/vite-env.d.ts`
 * declares a PHANTOM `window.elImtiyaz` API — fs.showSaveDialog,
 * writeBackup, config.read/write — that the preload never exposes; the real
 * bridge is `elImtiyazDesktop`. Both discoveries are registered in BKUP-500.)
 *
 * This module is the ONE sanctioned seam between the export features and
 * the destination:
 *   - In the Electron shell → the OS save dialog (the user picks the folder
 *     AND can rename the file — the dialog IS the consent, matching the
 *     main-process contract in electron/main.cts).
 *   - In a plain browser (tests, dev via vite) → the existing
 *     `downloadBlob` fallback (the browser's own save/location behavior).
 *
 * Every export surface that wants a destination choice goes through
 * `saveExportWithPicker` — no feature re-implements the bridge detection.
 */

import { downloadBlob } from "../excel/export-engine";

/** The REAL preload bridge shape (electron/preload.cts ElImtiyazDesktopApi). */
export interface ElImtiyazDesktopBridge {
  saveFile: (
    fileName: string,
    bytes: Uint8Array | number[],
  ) => Promise<{
    saved: boolean;
    path?: string;
    canceled?: boolean;
    error?: string;
  }>;
  pickFile: () => Promise<{
    name?: string;
    bytes?: number[];
    canceled?: boolean;
    error?: string;
  }>;
}

declare global {
  interface Window {
    /** The REAL Electron bridge (preload.cts) — absent in plain browsers. */
    elImtiyazDesktop?: ElImtiyazDesktopBridge;
  }
}

/** How the bytes actually reached the disk (surfaced in toasts + audits). */
export type ExportDeliveryMethod = "electron-save-dialog" | "browser-download";

/** The outcome of a picked export. */
export interface ExportSaveResult {
  /** True when the bytes were written somewhere durable. */
  saved: boolean;
  /** The user closed the dialog — NOT an error (no toast noise). */
  canceled: boolean;
  /** The absolute path (Electron) when known. */
  path: string | null;
  /** Which delivery mechanism was used. */
  method: ExportDeliveryMethod;
  /** The file name that was offered/saved. */
  fileName: string;
}

/** Whether the Electron save bridge is available in this environment. */
export function hasSaveDialogBridge(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.elImtiyazDesktop?.saveFile === "function"
  );
}

/**
 * Save `bytes` under `fileName` letting the USER choose the destination:
 * the OS save dialog inside Electron, the browser's download flow outside.
 * A canceled dialog is a clean, non-error outcome.
 */
export async function saveExportWithPicker(
  bytes: Uint8Array,
  fileName: string,
  mime: string,
): Promise<ExportSaveResult> {
  const bridge = typeof window !== "undefined" ? window.elImtiyazDesktop : undefined;
  if (typeof bridge?.saveFile === "function") {
    const result = await bridge.saveFile(fileName, bytes);
    if (result.error) {
      // Surface as a failure the caller can toast — the dialog contract
      // (electron/main.cts) returns { saved:false, error } on IO failure.
      throw new Error(`Échec de l'enregistrement : ${result.error}`);
    }
    return {
      saved: result.saved,
      canceled: result.canceled === true,
      path: result.path ?? null,
      method: "electron-save-dialog",
      fileName,
    };
  }
  // Browser fallback — the existing engine helper (one implementation).
  downloadBlob(bytes, fileName, mime);
  return {
    saved: true,
    canceled: false,
    path: null,
    method: "browser-download",
    fileName,
  };
}
