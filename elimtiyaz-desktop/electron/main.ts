/**
 * El-Imtiyaz Desktop Terminal — Electron main process.
 *
 * VAULT §02.01 — "The Desktop Terminal is built with Electron 33 + Vite 6 +
 * React 18 + TypeScript 5.7 … The only node that runs backup routines,
 * parses raw `.xlsx` files, and hosts the visual DAG workflow canvas editor."
 *
 * This is the OS-level main process: it creates the BrowserWindow that hosts
 * the Vite-built renderer, wires the menu, and exposes safe IPC channels
 * (file save dialogs for PDF receipts / XLSX exports / encrypted backup
 * archives) to the preload bridge.
 *
 * Security posture:
 *   - `contextIsolation: true` + `nodeIntegration: false` (renderer never
 *     touches Node directly).
 *   - All privileged operations go through the explicitly-allowlisted
 *     `preload.ts` bridge.
 */
import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import * as path from "node:path";
import * as fs from "node:fs/promises";

/** The renderer entry — `index.html` at the Vite build root. */
const RENDERER_DIST = path.join(__dirname, "..", "dist");

/** Development server (vite dev). */
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL ?? "http://localhost:5173";

const isDev = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: "#242526",
    title: "El-Imtiyaz — Terminal Desktop",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload needs limited Node (path/fs via IPC only)
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  // External links open in the OS browser, never in-app (security).
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

/* ------------------------------------------------------------------ */
/* Application menu                                                     */
/* ------------------------------------------------------------------ */

function buildMenu(): Menu {
  const isMac = process.platform === "darwin";
  const fileSubmenu: Electron.MenuItemConstructorOptions[] = [
    { role: "quit" },
  ];
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
      ? ([{
          label: app.name,
          submenu: [
            { role: "about" },
            { type: "separator" },
            { role: "quit" },
          ] as Electron.MenuItemConstructorOptions[],
        }])
      : []),
    { label: "Fichier", submenu: fileSubmenu },
    { label: "Affichage", submenu: viewSubmenu },
  ];
  return Menu.buildFromTemplate(template);
}

/* ------------------------------------------------------------------ */
/* IPC — privileged file operations for the renderer                    */
/* ------------------------------------------------------------------ */

/**
 * Save arbitrary bytes (PDF receipts, XLSX/CSV exports, encrypted backup
 * archives) via the OS save dialog. The renderer supplies the suggested
 * filename + bytes; the user picks the destination. Never writes without
 * explicit user consent (the dialog IS the consent).
 */
ipcMain.handle("vault:save-file", async (_event, payload: {
  fileName: string;
  bytes: number[] | Uint8Array;
}): Promise<{ saved: boolean; path?: string; canceled?: boolean; error?: string }> => {
  try {
    if (!mainWindow) return { saved: false, error: "no window" };
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      defaultPath: payload.fileName,
    });
    if (canceled || !filePath) return { saved: false, canceled: true };
    const data = Uint8Array.from(payload.bytes);
    await fs.writeFile(filePath, data);
    return { saved: true, path: filePath };
  } catch (e) {
    return { saved: false, error: e instanceof Error ? e.message : String(e) };
  }
});

/** Open an OS file picker and return the selected file's bytes + name. */
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

/* ------------------------------------------------------------------ */
/* App lifecycle                                                        */
/* ------------------------------------------------------------------ */

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
