import { contextBridge, ipcRenderer } from "electron";

/**
 * Preload bridge — exposes a minimal, typed surface to the renderer.
 *
 * Security posture:
 *  - contextIsolation: true (renderer cannot touch Node directly)
 *  - nodeIntegration: false
 *  - Only explicit allow-listed channels pass through.
 */
const api = {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  app: {
    getVersion: () => ipcRenderer.invoke("app:get-version"),
    getPath: (name: string) => ipcRenderer.invoke("app:get-path", name),
  },
  fs: {
    showSaveDialog: (opts: unknown) => ipcRenderer.invoke("fs:save-dialog", opts),
    writeBackup: (path: string, data: Uint8Array) =>
      ipcRenderer.invoke("fs:write-backup", path, data),
  },
  shell: {
    openExternal: (url: string) => ipcRenderer.invoke("shell:open-external", url),
    openPath: (path: string) => ipcRenderer.invoke("shell:open-path", path),
  },
} as const;

export type ElImtiyazDesktopApi = typeof api;

contextBridge.exposeInMainWorld("elImtiyaz", api);
