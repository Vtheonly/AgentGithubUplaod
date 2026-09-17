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
  shell: {
    openExternal: (url: string): Promise<ExternalOpenResult> =>
      ipcRenderer.invoke("shell:open-external", url) as Promise<ExternalOpenResult>,
  },
  saveFile: (fileName: string, bytes: Uint8Array | number[]): Promise<SaveFileResult> =>
    ipcRenderer.invoke("vault:save-file", { fileName, bytes }) as Promise<SaveFileResult>,
  pickFile: (): Promise<PickFileResult> =>
    ipcRenderer.invoke("vault:pick-file") as Promise<PickFileResult>,
};

contextBridge.exposeInMainWorld("elImtiyazDesktop", api);
export type ElImtiyazDesktopApi = typeof api;
