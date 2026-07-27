/// <reference types="vite/client" />

interface ElImtiyazDesktopApi {
  platform: string;
  versions: { electron: string; chrome: string; node: string };
  app: {
    getVersion: () => Promise<string>;
    getPath: (name: string) => Promise<{ ok: true; path: string } | { ok: false; error: string }>;
  };
  fs: {
    showSaveDialog: (
      opts: { defaultName?: string; filters?: { name: string; extensions: string[] }[] },
    ) => Promise<{ ok: true; canceled: boolean; path: string | null }>;
    writeBackup: (
      path: string,
      data: Uint8Array,
    ) => Promise<{ ok: true } | { ok: false; error: string }>;
  };
  shell: {
    openExternal: (url: string) => Promise<{ ok: true } | { ok: false; error: string }>;
    openPath: (path: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  };
}

interface Window {
  elImtiyaz?: ElImtiyazDesktopApi;
}
