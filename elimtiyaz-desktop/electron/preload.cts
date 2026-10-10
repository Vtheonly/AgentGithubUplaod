import { contextBridge, ipcRenderer, webFrame } from "electron";

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
  shell: {
    openExternal: (url: string): Promise<ExternalOpenResult> =>
      ipcRenderer.invoke("shell:open-external", url) as Promise<ExternalOpenResult>,
  },
  saveFile: (fileName: string, bytes: Uint8Array | number[]): Promise<SaveFileResult> =>
    ipcRenderer.invoke("vault:save-file", { fileName, bytes }) as Promise<SaveFileResult>,
  pickFile: (): Promise<PickFileResult> =>
    ipcRenderer.invoke("vault:pick-file") as Promise<PickFileResult>,
};

// Keep both names compatible with the existing renderer contract. The
// renderer currently uses `window.elImtiyaz`, while the original preload
// exposed `window.elImtiyazDesktop`.
contextBridge.exposeInMainWorld("elImtiyaz", api);
contextBridge.exposeInMainWorld("elImtiyazDesktop", api);
export type ElImtiyazDesktopApi = typeof api;
