import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import * as path from "node:path";
import * as fs from "node:fs/promises";

const RENDERER_DIST = path.join(__dirname, "..", "dist");
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL ?? "http://localhost:5173";
const isDev = !app.isPackaged && process.env.NODE_ENV !== "production";

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    frame: false,
    backgroundColor: "#242526",
    title: "El-Imtiyaz — Terminal Desktop",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  if (isDev) {
    void mainWindow.loadURL(DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    void mainWindow.loadFile(path.join(RENDERER_DIST, "index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function buildMenu(): Menu {
  const isMac = process.platform === "darwin";
  const fileSubmenu: Electron.MenuItemConstructorOptions[] = [{ role: "quit" }];
  const viewSubmenu: Electron.MenuItemConstructorOptions[] = [
    { role: "reload" },
    { role: "forceReload" },
    { role: "toggleDevTools" },
    { type: "separator" },
    { role: "resetZoom" },
    { role: "zoomIn" },
    { role: "zoomOut" },
    { role: "togglefullscreen" },
  ];
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: "about" },
            { type: "separator" },
            { role: "quit" },
          ] as Electron.MenuItemConstructorOptions[],
        }]
      : []),
    { label: "Fichier", submenu: fileSubmenu },
    { label: "Affichage", submenu: viewSubmenu },
  ];
  return Menu.buildFromTemplate(template);
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
