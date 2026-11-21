import { contextBridge, ipcRenderer, webFrame } from "electron";
import type { BackendProfileSnapshot, BackendProfileWriteResult } from "./backend-profile-contract";

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

/** T-505 (BKUP-511): the backup file picker's result (the restore source). */
export interface PickBackupFileResult {
  name?: string;
  path?: string;
  bytes?: number[];
  sizeBytes?: number;
  lastModified?: string | null;
  canceled?: boolean;
  error?: string;
}

/** T-505 (BKUP-511): the native directory picker's result. */
export interface PickDirectoryResult {
  directory?: string;
  canceled?: boolean;
  error?: string;
}

/**
 * T-502 (UI-332): the keyboard zoom contract. The zoom mechanism is the
 * window's OWN zoom level (webFrame.setZoomLevel — the SAME state the
 * Affichage menu's zoomIn/zoomOut/resetZoom roles and Chromium's Ctrl+
 * wheel share); the keyboard shortcuts below are just another entry
 * point into it, NEVER a competing CSS-transform implementation.
 *
 * The clamps (zoom FACTOR 0.5–2.0, step 1 zoom level = ×1.2 per press)
 * are enforced HERE — every caller (keyboard, future UI buttons) gets
 * the same sensible minimum/maximum for free.
 */
const ZOOM_STEP_LEVELS = 1;
const ZOOM_MIN_FACTOR = 0.5;
const ZOOM_MAX_FACTOR = 2.0;
const clampToFactorRange = (level: number): number => {
  const minLevel = Math.log(ZOOM_MIN_FACTOR) / Math.log(1.2);
  const maxLevel = Math.log(ZOOM_MAX_FACTOR) / Math.log(1.2);
  return Math.min(maxLevel, Math.max(minLevel, level));
};

export type ZoomStepResult = {
  ok: true;
  level: number;
  factor: number;
  clamped: boolean;
};

const zoomApi = {
  /** Zoom in one step (Ctrl+= / Ctrl++). Returns the resulting level/factor. */
  in: (): ZoomStepResult => {
    const requested = webFrame.getZoomLevel() + ZOOM_STEP_LEVELS;
    const next = clampToFactorRange(requested);
    webFrame.setZoomLevel(next);
    return {
      ok: true,
      level: next,
      factor: Number((1.2 ** next).toFixed(3)),
      clamped: requested !== next,
    };
  },
  /** Zoom out one step (Ctrl+-). Returns the resulting level/factor. */
  out: (): ZoomStepResult => {
    const requested = webFrame.getZoomLevel() - ZOOM_STEP_LEVELS;
    const next = clampToFactorRange(requested);
    webFrame.setZoomLevel(next);
    return {
      ok: true,
      level: next,
      factor: Number((1.2 ** next).toFixed(3)),
      clamped: requested !== next,
    };
  },
  /** Reset to 100% (Ctrl+0). */
  reset: (): ZoomStepResult => {
    webFrame.setZoomLevel(0);
    return { ok: true, level: 0, factor: 1, clamped: false };
  },
  /** The current level/factor (for UI affordances + tests). */
  get: (): ZoomStepResult => {
    const level = webFrame.getZoomLevel();
    return {
      ok: true,
      level,
      factor: Number((1.2 ** level).toFixed(3)),
      clamped: false,
    };
  },
};

export type ExternalOpenResult =
  | {
      ok: true;
    }
  | {
      ok: false;
      error: string;
    };

/**
 * T-573 (ADD-9): the BackendProfile snapshot — ONE `sendSync` at preload-init,
 * cached in this closure. The renderer's `supabase-client.ts` reads it through
 * `window.elImtiyaz.backendProfile.getSync()` at MODULE INIT (synchronously —
 * the same ordering the compiled-in constants used to have, so the provider
 * tree's module-scope `selectDefaultRepositories()` sees the EFFECTIVE target,
 * not a stale one). The snapshot is already validated + fail-closed by the
 * main-process service; the renderer re-validates defensively.
 */
const backendProfileSnapshot = (() => {
  try {
    return ipcRenderer.sendSync("backend-profile:get-sync") as BackendProfileSnapshot | null;
  } catch {
    // No listener (a stale preload against an old main) — the factory default governs.
    return null;
  }
})();

const backendProfileApi = {
  /** The cached init-time snapshot (synchronous; null outside Electron). */
  getSync: (): BackendProfileSnapshot | null => backendProfileSnapshot,
  /** Re-read from disk (invalidates the main-side cache). */
  get: (): Promise<BackendProfileSnapshot | null> =>
    ipcRenderer.invoke("backend-profile:get") as Promise<BackendProfileSnapshot | null>,
  /** Validate + persist a profile (an invalid profile never reaches disk). */
  write: (profile: unknown): Promise<BackendProfileWriteResult> =>
    ipcRenderer.invoke("backend-profile:write", profile) as Promise<BackendProfileWriteResult>,
  /** Remove the profile file — the factory default governs again. */
  clear: (): Promise<BackendProfileWriteResult> =>
    ipcRenderer.invoke("backend-profile:clear") as Promise<BackendProfileWriteResult>,
};

const api = {
  window: {
    minimize: (): Promise<void> => ipcRenderer.invoke("window:minimize"),
    toggleMaximize: (): Promise<boolean> => ipcRenderer.invoke("window:toggle-maximize"),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke("window:is-maximized"),
    toggleFullscreen: (): Promise<boolean> => ipcRenderer.invoke("window:toggle-fullscreen"),
    isFullscreen: (): Promise<boolean> => ipcRenderer.invoke("window:is-fullscreen"),
    close: (): Promise<void> => ipcRenderer.invoke("window:close"),
  },
  // T-502 (UI-332): the app-level zoom (webFrame — the SAME zoom level the
  // Affichage menu roles drive; one mechanism, two entry points).
  zoom: zoomApi,
  // T-573 (R-1): the app-lifecycle members declared in vite-env.d.ts are NOW
  // REAL (pre-T-573 they were phantom — system-config's restart fell back to
  // a silent page reload and isElectron() lied with a constant false).
  app: {
    getVersion: (): Promise<string> => ipcRenderer.invoke("app:get-version") as Promise<string>,
    getPath: (name: string): Promise<{ ok: true; path: string } | { ok: false; error: string }> =>
      ipcRenderer.invoke("app:get-path", name) as Promise<{ ok: true; path: string } | { ok: false; error: string }>,
    restart: (): Promise<{ ok: true } | { ok: false; error: string }> =>
      ipcRenderer.invoke("app:restart") as Promise<{ ok: true } | { ok: false; error: string }>,
    isElectron: (): Promise<boolean> => ipcRenderer.invoke("app:is-electron") as Promise<boolean>,
  },
  // T-573 (R-1): the config members are NOW REAL — the LOCAL config round-trips
  // through the userData config.json (pre-T-573 the IPC branches in
  // system-config.ts were dead code and everything lived in localStorage only).
  config: {
    read: (): Promise<{ ok: true; config: Record<string, unknown> } | { ok: false; error: string }> =>
      ipcRenderer.invoke("config:read") as Promise<{ ok: true; config: Record<string, unknown> } | { ok: false; error: string }>,
    write: (config: Record<string, unknown>): Promise<{ ok: true } | { ok: false; error: string }> =>
      ipcRenderer.invoke("config:write", config) as Promise<{ ok: true } | { ok: false; error: string }>,
    delete: (): Promise<{ ok: true } | { ok: false; error: string }> =>
      ipcRenderer.invoke("config:delete") as Promise<{ ok: true } | { ok: false; error: string }>,
  },
  // T-573 (ADD-9): the backend profile switcher (the packaged app re-points
  // WITHOUT a rebuild — see electron/backend-profile-contract.ts).
  backendProfile: backendProfileApi,
  shell: {
    openExternal: (url: string): Promise<ExternalOpenResult> =>
      ipcRenderer.invoke("shell:open-external", url) as Promise<ExternalOpenResult>,
  },
  saveFile: (fileName: string, bytes: Uint8Array | number[], defaultDir?: string): Promise<SaveFileResult> =>
    ipcRenderer.invoke("vault:save-file", { fileName, bytes, defaultDir }) as Promise<SaveFileResult>,
  pickFile: (): Promise<PickFileResult> =>
    ipcRenderer.invoke("vault:pick-file") as Promise<PickFileResult>,
  // T-505 (BKUP-511): the backup-file + directory pickers (main-process
  // dialogs only — the renderer never touches the filesystem).
  pickBackupFile: (defaultDir?: string): Promise<PickBackupFileResult> =>
    ipcRenderer.invoke("vault:pick-backup-file", { defaultDir }) as Promise<PickBackupFileResult>,
  pickDirectory: (title?: string, defaultDir?: string): Promise<PickDirectoryResult> =>
    ipcRenderer.invoke("vault:pick-directory", { title, defaultDir }) as Promise<PickDirectoryResult>,
};

// Keep both names compatible with the existing renderer contract. The
// renderer currently uses `window.elImtiyaz`, while the original preload
// exposed `window.elImtiyazDesktop`.
contextBridge.exposeInMainWorld("elImtiyaz", api);
contextBridge.exposeInMainWorld("elImtiyazDesktop", api);
export type ElImtiyazDesktopApi = typeof api;
