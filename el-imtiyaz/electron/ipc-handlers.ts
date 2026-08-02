import { app, dialog, BrowserWindow, type IpcMain } from "electron";
import { writeFile, mkdir, readFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
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

  // ==========================================================================
  // Local config (config.json in userData) — for Supabase URL + anon key +
  // feature flags that must be available BEFORE the Supabase client initializes.
  // ==========================================================================

  ipcMain.handle("config:read", async () => {
    try {
      const configPath = join(app.getPath("userData"), "config.json");
      if (!existsSync(configPath)) {
        return { ok: true, config: {} };
      }
      const raw = await readFile(configPath, "utf-8");
      const config = JSON.parse(raw);
      return { ok: true, config };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle("config:write", async (_evt, config: Record<string, unknown>) => {
    try {
      const configPath = join(app.getPath("userData"), "config.json");
      await mkdir(dirname(configPath), { recursive: true });
      await writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle("config:delete", async () => {
    try {
      const configPath = join(app.getPath("userData"), "config.json");
      if (existsSync(configPath)) {
        await unlink(configPath);
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  // ==========================================================================
  // App restart — required after changing Supabase connection settings so the
  // renderer re-initializes the Supabase client with the new URL/key.
  // ==========================================================================

  ipcMain.handle("app:restart", async () => {
    try {
      // Relaunch the app and exit the current instance. Electron's relaunch()
      // starts a new process; quit() terminates this one.
      app.relaunch();
      app.quit();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  // ==========================================================================
  // Check if running in Electron (vs web browser)
  // ==========================================================================

  ipcMain.handle("app:is-electron", () => {
    return true;
  });
}

/** Convenience helper exposed for tests / non-Electron environments. */
export function defaultBackupPath(): string {
  return join(app.getPath("userData"), "backups", `backup-${new Date().toISOString().replace(/[:.]/g, "-")}.db`);
}
