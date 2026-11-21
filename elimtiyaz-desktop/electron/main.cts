import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { readFileSync, writeFileSync } from "node:fs";
import { registerBackendProfileIpc } from "./backend-profile";
import { buildAppMenuTemplate, buildContextMenuTemplate } from "./menu-builders";

const RENDERER_DIST = path.join(__dirname, "..", "dist");
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL ?? "http://localhost:5173";
const isDev = !app.isPackaged && process.env.NODE_ENV !== "production";

let mainWindow: BrowserWindow | null = null;

// ============================================================================
// T-573 (ADD-9): the BackendProfile IPC surface — registered at MODULE LOAD
// (before any window/preload exists) so the preload's ONE sendSync snapshot
// at init always finds its listener. The profile file lives in the app's
// userData directory: dropping/edits/re-pointing a packaged installation
// WITHOUT a rebuild is the whole acceptance (the executable never changes).
// ============================================================================
registerBackendProfileIpc();

// ============================================================================
// T-573 (R-1): the `window.elImtiyaz.config` + `window.elImtiyaz.app`
// declarations in `src/vite-env.d.ts` are NOW TRUE — the real IPC bridge.
// Pre-T-573 these members were phantom (ARCH-034): system-config.ts's IPC
// branches were dead code (everything fell back to localStorage, and the
// "restart" was a silent page reload in Electron).
// ============================================================================
const CONFIG_FILE_NAME = "config.json";
const CONFIG_MAX_BYTES = 64 * 1024;

ipcMain.handle("config:read", async (): Promise<{ ok: true; config: Record<string, unknown> } | { ok: false; error: string }> => {
  const filePath = path.join(app.getPath("userData"), CONFIG_FILE_NAME);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { ok: true, config: {} }; // a corrupt file reads as empty — the renderer re-writes it
    }
    return { ok: true, config: parsed };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { ok: true, config: {} };
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("config:write", async (_event, config: Record<string, unknown>): Promise<{ ok: true } | { ok: false; error: string }> => {
  let serialized: string;
  try {
    serialized = JSON.stringify(config ?? {}, null, 2);
  } catch (err) {
    return { ok: false, error: `Config is not JSON-serializable: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (Buffer.byteLength(serialized, "utf8") > CONFIG_MAX_BYTES) {
    return { ok: false, error: `Config exceeds the ${CONFIG_MAX_BYTES} byte bridge cap.` };
  }
  const filePath = path.join(app.getPath("userData"), CONFIG_FILE_NAME);
  try {
    await fs.writeFile(filePath, serialized, "utf8");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("config:delete", async (): Promise<{ ok: true } | { ok: false; error: string }> => {
  const filePath = path.join(app.getPath("userData"), CONFIG_FILE_NAME);
  try {
    await fs.rm(filePath, { force: true });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

// The app lifecycle members declared in vite-env.d.ts (used by
// system-config.ts's restartApp()/isElectron() — pre-T-573 dead branches).
ipcMain.handle("app:restart", (): { ok: true } => {
  // relaunch + exit — the RELAUNCH env is prepared by Electron before exit;
  // the invoke reply never reaches the renderer (the process exits first).
  app.relaunch();
  app.exit(0);
  return { ok: true };
});

ipcMain.handle("app:get-version", (): string => app.getVersion());
ipcMain.handle("app:is-electron", (): boolean => true);

const SAFE_PATH_NAMES = new Set<string>([
  "userData",
  "sessionData",
  "temp",
  "home",
  "desktop",
  "documents",
  "downloads",
  "logs",
]);

ipcMain.handle("app:get-path", (_event, name: string): { ok: true; path: string } | { ok: false; error: string } => {
  if (!SAFE_PATH_NAMES.has(name)) {
    return { ok: false, error: `Path name not allowed: ${name}` };
  }
  try {
    return { ok: true, path: app.getPath(name as "userData") };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

// ============================================================================
// T-577 (OPS-014): window-state persistence — the bounds + maximized flag
// saved at close, restored at create (a JSON file in userData; a corrupt or
// absent file simply falls back to the defaults below).
// ============================================================================
const WINDOW_STATE_FILE = "window-state.json";
const DEFAULT_WINDOW_WIDTH = 1440;
const DEFAULT_WINDOW_HEIGHT = 900;
const MIN_WINDOW_WIDTH = 1100;
const MIN_WINDOW_HEIGHT = 700;

interface WindowState {
  width: number;
  height: number;
  x?: number;
  y?: number;
  maximized: boolean;
}

function loadWindowState(): WindowState | null {
  try {
    const raw = readFileSync(path.join(app.getPath("userData"), WINDOW_STATE_FILE), "utf8");
    const parsed = JSON.parse(raw) as Partial<WindowState>;
    if (
      typeof parsed.width !== "number" ||
      typeof parsed.height !== "number" ||
      typeof parsed.maximized !== "boolean" ||
      !Number.isFinite(parsed.width) ||
      !Number.isFinite(parsed.height)
    ) {
      return null;
    }
    return {
      // Clamp to the app's minimums — a stale tiny state never shrinks the
      // window below usable.
      width: Math.max(MIN_WINDOW_WIDTH, Math.round(parsed.width)),
      height: Math.max(MIN_WINDOW_HEIGHT, Math.round(parsed.height)),
      x: typeof parsed.x === "number" && Number.isFinite(parsed.x) ? Math.round(parsed.x) : undefined,
      y: typeof parsed.y === "number" && Number.isFinite(parsed.y) ? Math.round(parsed.y) : undefined,
      maximized: parsed.maximized,
    };
  } catch {
    return null; // absent or corrupt — the defaults govern
  }
}

function saveWindowState(win: BrowserWindow): void {
  try {
    // getNormalBounds() returns the RESTORED bounds even while maximized —
    // exactly what a relaunch should reopen at.
    const bounds = win.getNormalBounds();
    const state: WindowState = {
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      maximized: win.isMaximized(),
    };
    writeFileSync(
      path.join(app.getPath("userData"), WINDOW_STATE_FILE),
      JSON.stringify(state, null, 2),
      "utf8",
    );
  } catch (err) {
    console.warn("[main] window-state save failed:", err);
  }
}

function createWindow(): void {
  const restored = loadWindowState();
  mainWindow = new BrowserWindow({
    width: restored?.width ?? DEFAULT_WINDOW_WIDTH,
    height: restored?.height ?? DEFAULT_WINDOW_HEIGHT,
    ...(restored?.x !== undefined && restored?.y !== undefined ? { x: restored.x, y: restored.y } : {}),
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    show: false,
    frame: false,
    backgroundColor: "#242526",
    title: "El-Imtiyaz — Terminal Desktop",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      // T-577 (OPS-014): the sandboxed preload — contextBridge/ipcRenderer/
      // webFrame are exactly the sandbox-safe surface preload.cts uses.
      sandbox: true,
    },
  });

  if (restored?.maximized) {
    mainWindow.maximize();
  }

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  // T-577 (BUG-045): the right-click context menu — Couper/Copier/Coller/
  // Tout sélectionner with the enabled-flag matrix, INCLUDING read-only
  // surfaces (tables, cards, receipts — the owner's explicit requirement).
  // Nothing actionable → no popup at all (never a fully-grayed menu).
  mainWindow.webContents.on("context-menu", (_event, params) => {
    const template = buildContextMenuTemplate(params);
    if (template.length > 0 && mainWindow) {
      Menu.buildFromTemplate(template).popup({ window: mainWindow });
    }
  });

  // T-577 (OPS-014): the did-fail-load handler — the failure is LOGGED
  // always and surfaced to the operator in production (dev reloads during
  // server startup are not spammed with dialogs).
  mainWindow.webContents.on(
    "did-fail-load",
    (_event, errorCode: number, errorDescription: string, validatedURL: string) => {
      console.error(`[main] did-fail-load ${errorCode} ${errorDescription} ${validatedURL}`);
      if (!isDev) {
        dialog.showErrorBox(
          "Échec du chargement",
          `La page n'a pas pu être chargée (code ${errorCode}).\n${validatedURL}\n\nRelancez l'application ; si le problème persiste, contactez l'administrateur.`,
        );
      }
    },
  );

  if (isDev) {
    void mainWindow.loadURL(DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    void mainWindow.loadFile(path.join(RENDERER_DIST, "index.html"));
  }

  // T-577 (OPS-014): persist the window state at close (bounds + the
  // maximized flag — the next launch reopens where the operator left it).
  mainWindow.on("close", () => {
    if (mainWindow) saveWindowState(mainWindow);
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function buildMenu(): Menu {
  return Menu.buildFromTemplate(
    buildAppMenuTemplate({ isMac: process.platform === "darwin", isDev }),
  );
}

ipcMain.handle("window:minimize", () => {
  mainWindow?.minimize();
});

ipcMain.handle("window:toggle-maximize", () => {
  if (!mainWindow) return false;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
  return mainWindow.isMaximized();
});

ipcMain.handle("window:is-maximized", () => mainWindow?.isMaximized() ?? false);

ipcMain.handle("window:toggle-fullscreen", () => {
  if (!mainWindow) return false;
  mainWindow.setFullScreen(!mainWindow.isFullScreen());
  return mainWindow.isFullScreen();
});

ipcMain.handle("window:is-fullscreen", () => mainWindow?.isFullScreen() ?? false);

ipcMain.handle("window:close", () => {
  mainWindow?.close();
});

ipcMain.handle("shell:open-external", async (_event, url: string): Promise<{ ok: true } | { ok: false; error: string }> => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "mailto:") {
      return { ok: false, error: "External URL scheme is not allowed." };
    }
    await shell.openExternal(parsed.toString());
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
});

ipcMain.handle("vault:save-file", async (_event, payload: {
  fileName: string;
  bytes: number[] | Uint8Array;
  /** T-505 (BKUP-511): the remembered destination directory (the dialog's opener). */
  defaultDir?: string;
}): Promise<{ saved: boolean; path?: string; canceled?: boolean; error?: string }> => {
  try {
    if (!mainWindow) return { saved: false, error: "no window" };
    const defaultPath = payload.defaultDir
      ? joinPath(payload.defaultDir, payload.fileName)
      : payload.fileName;
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      defaultPath,
    });
    if (canceled || !filePath) return { saved: false, canceled: true };
    const data = Uint8Array.from(payload.bytes);
    await fs.writeFile(filePath, data);
    return { saved: true, path: filePath };
  } catch (e) {
    return { saved: false, error: e instanceof Error ? e.message : String(e) };
  }
});

/** Join a directory + file name without importing node:path's win32 quirks twice. */
function joinPath(dir: string, fileName: string): string {
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  return dir.endsWith(sep) ? `${dir}${fileName}` : `${dir}${sep}${fileName}`;
}

/**
 * T-505 (BKUP-511): the BACKUP file picker — the restore-from-file
 * workflow's source. Native dialog, backup-specific filters (the
 * entire-archive ZIP the app exports + raw vault records), optional
 * remembered source directory as the opener. The BYTES come back to the
 * renderer once (the validation ladder runs in the renderer where the
 * crypto + vault live); no renderer-side fs access ever happens.
 */
ipcMain.handle("vault:pick-backup-file", async (_event, payload: {
  defaultDir?: string;
}): Promise<{
  name?: string;
  path?: string;
  bytes?: number[];
  sizeBytes?: number;
  lastModified?: string | null;
  canceled?: boolean;
  error?: string;
}> => {
  try {
    if (!mainWindow) return { error: "no window" };
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      properties: ["openFile"],
      ...(payload?.defaultDir ? { defaultPath: payload.defaultDir } : {}),
      filters: [
        { name: "Sauvegardes El-Imtiyaz (ZIP)", extensions: ["zip"] },
        { name: "Archive du coffre (brute)", extensions: ["db"] },
        { name: "Tous les fichiers", extensions: ["*"] },
      ],
    });
    if (canceled || filePaths.length === 0) return { canceled: true };
    const filePath = filePaths[0];
    const stat = await fs.stat(filePath);
    const bytes = await fs.readFile(filePath);
    return {
      name: path.basename(filePath),
      path: filePath,
      bytes: Array.from(bytes),
      sizeBytes: stat.size,
      lastModified: stat.mtime.toISOString(),
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
});

/**
 * T-505 (BKUP-511): the native DIRECTORY picker — the owner's explicit
 * destination/source folder choice (never a hardcoded backup directory).
 */
ipcMain.handle("vault:pick-directory", async (_event, payload: {
  title?: string;
  defaultDir?: string;
}): Promise<{ directory?: string; canceled?: boolean; error?: string }> => {
  try {
    if (!mainWindow) return { error: "no window" };
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: payload?.title ?? "Choisir un dossier",
      properties: ["openDirectory", "createDirectory"],
      ...(payload?.defaultDir ? { defaultPath: payload.defaultDir } : {}),
    });
    if (canceled || filePaths.length === 0) return { canceled: true };
    return { directory: filePaths[0] };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
});

ipcMain.handle("vault:pick-file", async (): Promise<{ name?: string; bytes?: number[]; canceled?: boolean; error?: string }> => {
  try {
    if (!mainWindow) return { error: "no window" };
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      properties: ["openFile"],
      filters: [
        { name: "Documents", extensions: ["xlsx", "csv", "pdf", "png", "jpg", "jpeg", "webp"] },
      ],
    });
    if (canceled || filePaths.length === 0) return { canceled: true };
    const bytes = await fs.readFile(filePaths[0]);
    return { name: path.basename(filePaths[0]), bytes: Array.from(bytes) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
});

// T-577 (OPS-014): the single-instance lock — a second launch focuses the
// FIRST instance's window (restoring it if minimized) instead of opening a
// duplicate terminal on the same tenant data.
const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  void app.whenReady().then(() => {
    Menu.setApplicationMenu(buildMenu());
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
