/**
 * El-Imtiyaz Desktop — preload bridge.
 *
 * The ONLY privileged surface exposed to the renderer. Each function maps to
 * one allowlisted IPC channel; the renderer can never reach Node/Electron
 * APIs directly (contextIsolation is on, nodeIntegration is off).
 */
import { contextBridge, ipcRenderer } from "electron";

export interface SaveFileResult {
  saved: boolean;
  path?: string;
  canceled?: boolean;
  error?: string;
}

export interface PickFileResult {
  name?: string;
  bytes?: number[];
  canceled?: boolean;
  error?: string;
}

const api = {
  /** Save bytes (PDF / XLSX / CSV / encrypted backup) via the OS dialog. */
  saveFile: (fileName: string, bytes: Uint8Array | number[]): Promise<SaveFileResult> =>
    ipcRenderer.invoke("vault:save-file", { fileName, bytes }) as Promise<SaveFileResult>,
  /** Pick a file via the OS dialog and read its bytes. */
  pickFile: (): Promise<PickFileResult> =>
    ipcRenderer.invoke("vault:pick-file") as Promise<PickFileResult>,
};

contextBridge.exposeInMainWorld("elImtiyazDesktop", api);

// Type augmentation for the renderer (window.elImtiyazDesktop).
export type ElImtiyazDesktopApi = typeof api;
