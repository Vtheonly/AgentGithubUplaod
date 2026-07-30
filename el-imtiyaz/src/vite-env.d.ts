/// <reference types="vite/client" />

interface ElImtiyazDesktopApi {
  platform: string;
  versions: { electron: string; chrome: string; node: string };
  app: {
    getVersion: () => Promise<string>;
    getPath: (name: string) => Promise<{ ok: true; path: string } | { ok: false; error: string }>;
    restart: () => Promise<{ ok: true } | { ok: false; error: string }>;
    isElectron: () => Promise<boolean>;
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
  config: {
    read: () => Promise<{ ok: true; config: Record<string, unknown> } | { ok: false; error: string }>;
    write: (config: Record<string, unknown>) => Promise<{ ok: true } | { ok: false; error: string }>;
    delete: () => Promise<{ ok: true } | { ok: false; error: string }>;
  };
}

interface Window {
  elImtiyaz?: ElImtiyazDesktopApi;
}

// ============================================================================
// Vite environment variables (declared in .env.local)
// ============================================================================

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_APP_NAME: string;
  readonly VITE_APP_VERSION: string;
  readonly VITE_DEFAULT_LOCALE: string;
  readonly VITE_DEFAULT_CURRENCY: string;
  readonly VITE_DEFAULT_TIMEZONE: string;
  /** Toggle between mock (false) and Supabase (true) repository backends. */
  readonly VITE_USE_SUPABASE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
