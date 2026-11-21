/**
 * The BackendProfile main-process service — T-573 (ADD-9).
 *
 * ONE service resolves the versioned profile from
 * `userData/backend-profile.json`, validates it through the pure wire
 * contract (fail-closed: ANY invalid input → the factory default governs,
 * with the reason carried on the snapshot), and serves it to the preload
 * bridge:
 *   - `backend-profile:get-sync` (ipcMain.on + event.returnValue) — the ONE
 *     synchronous snapshot the preload caches at init so the renderer's
 *     module-init resolution stays SYNCHRONOUS (a single sendSync at
 *     preload-load; the main event loop is live by then — the window only
 *     loads after `app.whenReady`).
 *   - `backend-profile:get` / `:write` / `:clear` — the async management
 *     surface (the write validates BEFORE persisting; a persisted profile
 *     is always a valid one — garbage never reaches the disk).
 *
 * THIS FILE OWNS THE FS + ELECTRON (it is imported only by `main.cts` and
 * compiled by electron/tsconfig.json). All logic that needs testing lives
 * in the pure contract module (`backend-profile-contract.ts`).
 */
import { app, ipcMain } from "electron";
import * as fsSync from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  buildBackendProfileSnapshot,
  validateBackendProfile,
  type BackendProfileSnapshot,
  type BackendProfileWriteResult,
} from "./backend-profile-contract";

export const BACKEND_PROFILE_FILE_NAME = "backend-profile.json";

let cachedSnapshot: BackendProfileSnapshot | null = null;

function profileFilePath(): string {
  return path.join(app.getPath("userData"), BACKEND_PROFILE_FILE_NAME);
}

/** Read (and cache) the effective snapshot — fail-closed by construction. */
export function resolveBackendProfileSync(): BackendProfileSnapshot {
  if (cachedSnapshot) return cachedSnapshot;
  const filePath = profileFilePath();
  let raw: string | null = null;
  try {
    raw = fsSync.readFileSync(filePath, "utf8");
    if (raw.length === 0) raw = null;
  } catch {
    raw = null; // missing / unreadable file → the factory default governs
  }
  cachedSnapshot = buildBackendProfileSnapshot(raw, filePath);
  return cachedSnapshot;
}

/** Drop the cache (after a write/clear or before an explicit re-read). */
export function invalidateBackendProfileCache(): void {
  cachedSnapshot = null;
}

/** Register the IPC surface — called ONCE from `main.cts` at module load. */
export function registerBackendProfileIpc(): void {
  ipcMain.on("backend-profile:get-sync", (event) => {
    event.returnValue = resolveBackendProfileSync();
  });

  ipcMain.handle("backend-profile:get", async (): Promise<BackendProfileSnapshot> => {
    invalidateBackendProfileCache();
    return resolveBackendProfileSync();
  });

  ipcMain.handle(
    "backend-profile:write",
    async (_event, raw: unknown): Promise<BackendProfileWriteResult> => {
      // Validate FIRST — an invalid profile never reaches the disk.
      const verdict = validateBackendProfile(raw);
      if (!verdict.ok) {
        return { ok: false, error: verdict.reason };
      }
      const filePath = profileFilePath();
      try {
        await fs.writeFile(filePath, `${JSON.stringify(verdict.profile, null, 2)}\n`, "utf8");
      } catch (err) {
        return {
          ok: false,
          error: `Failed to write ${BACKEND_PROFILE_FILE_NAME}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        };
      }
      invalidateBackendProfileCache();
      return { ok: true, snapshot: resolveBackendProfileSync() };
    },
  );

  ipcMain.handle("backend-profile:clear", async (): Promise<BackendProfileWriteResult> => {
    const filePath = profileFilePath();
    try {
      await fs.rm(filePath, { force: true });
    } catch (err) {
      return {
        ok: false,
        error: `Failed to remove ${BACKEND_PROFILE_FILE_NAME}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }
    invalidateBackendProfileCache();
    return { ok: true, snapshot: resolveBackendProfileSync() };
  });
}
