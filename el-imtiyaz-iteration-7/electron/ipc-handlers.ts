import { app, dialog, BrowserWindow, type IpcMain } from "electron";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

interface HandlerDeps {
  dialog: typeof dialog;
}

/**
 * IPC handler registration.
 *
 * Every handler is async and returns a structured payload — never throws
 * across the IPC boundary. The renderer always sees either a resolved value
 * or a serializable error.
 */
export function registerIpcHandlers(ipcMain: IpcMain, _deps: HandlerDeps): void {
  ipcMain.handle("app:get-version", () => app.getVersion());

  ipcMain.handle("app:get-path", (_evt, name: string) => {
    try {
      return { ok: true, path: app.getPath(name as Parameters<typeof app.getPath>[0]) };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(
    "fs:save-dialog",
    async (_evt, opts: { defaultName?: string; filters?: Electron.FileFilter[] }) => {
      const win = BrowserWindow.getFocusedWindow() ?? undefined;
      const result = await dialog.showSaveDialog(win!, {
        title: "Enregistrer sous",
        defaultPath: opts.defaultName ?? "el-imtiyaz-export",
        filters: opts.filters ?? [
          { name: "Excel", extensions: ["xlsx"] },
          { name: "CSV", extensions: ["csv"] },
          { name: "Tous les fichiers", extensions: ["*"] },
        ],
      });
      return { ok: true, canceled: result.canceled, path: result.filePath ?? null };
    },
  );

  ipcMain.handle(
    "fs:write-backup",
    async (_evt, targetPath: string, data: Uint8Array) => {
      try {
        await mkdir(dirname(targetPath), { recursive: true });
        await writeFile(targetPath, data);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  ipcMain.handle("shell:open-external", async (_evt, url: string) => {
    try {
      const { shell } = await import("electron");
      await shell.openExternal(url);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle("shell:open-path", async (_evt, targetPath: string) => {
    try {
      const { shell } = await import("electron");
      await shell.openPath(targetPath);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });
}

/** Convenience helper exposed for tests / non-Electron environments. */
export function defaultBackupPath(): string {
  return join(app.getPath("userData"), "backups", `backup-${new Date().toISOString().replace(/[:.]/g, "-")}.db`);
}
