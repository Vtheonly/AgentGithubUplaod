/// <reference types="vite/client" />

/**
 * T-502 (UI-332): the app-level zoom contract — the window's OWN zoom
 * level (the SAME state the Electron Affichage menu roles drive), exposed
 * through the preload's webFrame bridge with factor clamps 0.5–2.0.
 */
interface ElImtiyazZoomApi {
  in(): { ok: true; level: number; factor: number; clamped: boolean };
  out(): { ok: true; level: number; factor: number; clamped: boolean };
  reset(): { ok: true; level: number; factor: number; clamped: boolean };
  get(): { ok: true; level: number; factor: number; clamped: boolean };
}

interface ElImtiyazDesktopApi {
  platform: string;
  versions: { electron: string; chrome: string; node: string };
  /**
   * T-573 (R-1): these members are NOW REAL — the preload exposes the
   * app-lifecycle IPC group (`app:restart` relaunch+exit, `getVersion`,
   * `getPath` allowlisted, `isElectron`). Pre-T-573 they were phantom
   * declarations (ARCH-034) and system-config's branches were dead code.
   */
  app: {
    getVersion: () => Promise<string>;
    getPath: (name: string) => Promise<{ ok: true; path: string } | { ok: false; error: string }>;
    restart: () => Promise<{ ok: true } | { ok: false; error: string }>;
    isElectron: () => Promise<boolean>;
  };
  /**
   * T-573 (R-1) doc note — TRULY UNBUILT (kept for the historical record):
   * no preload channel implements these members. The REAL file contract is
   * the top-level `saveFile`/`pickFile`/`pickBackupFile`/`pickDirectory`
   * (T-505) — a future bridge rename may promote these; until then callers
   * must use the top-level members.
   */
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
    /** T-573 (R-1) doc note — TRULY UNBUILT: no preload channel implements
     * openPath; callers use `openExternal` (https/mailto only). */
    openPath: (path: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  };
  /**
   * T-573 (R-1): NOW REAL — the LOCAL config round-trips through the
   * userData config.json via the `config:read/write/delete` IPC handlers
   * (pre-T-573 this group was phantom and everything fell back to
   * localStorage). Shapes match `src/infrastructure/system-config.ts`'s
   * `LocalConfig` consumers verbatim.
   */
  config: {
    read: () => Promise<{ ok: true; config: Record<string, unknown> } | { ok: false; error: string }>;
    write: (config: Record<string, unknown>) => Promise<{ ok: true } | { ok: false; error: string }>;
    delete: () => Promise<{ ok: true } | { ok: false; error: string }>;
  };
  /**
   * T-573 (ADD-9): the BackendProfile switcher bridge. `getSync` returns the
   * ONE init-time snapshot (validated + fail-closed by the main-process
   * service — null outside Electron); `get/write/clear` are the management
   * surface. The structural mirror below is pinned to the wire contract
   * (`electron/backend-profile-contract.ts`) by the t-573 suite's
   * expectTypeOf equality gate — drift between the two is a tsc error.
   */
  backendProfile: {
    getSync: () => BackendProfileSnapshotMirror | null;
    get: () => Promise<BackendProfileSnapshotMirror | null>;
    write: (profile: unknown) => Promise<BackendProfileWriteResultMirror>;
    clear: () => Promise<BackendProfileWriteResultMirror>;
  };
  /**
   * T-502 (UI-332): the app-level zoom entry point — the window's OWN zoom
   * level (the SAME state the Electron Affichage menu roles drive), exposed
   * through the preload's webFrame bridge with factor clamps 0.5–2.0.
   * Present in the desktop build only (undefined in the browser/tests —
   * the keyboard hook no-ops then).
   */
  zoom?: {
    in(): { ok: true; level: number; factor: number; clamped: boolean };
    out(): { ok: true; level: number; factor: number; clamped: boolean };
    reset(): { ok: true; level: number; factor: number; clamped: boolean };
    get(): { ok: true; level: number; factor: number; clamped: boolean };
  };
}

/** T-573: the vite-env mirror of the wire contract's BackendProfileSnapshot
 * (electron/backend-profile-contract.ts) — pinned by the t-573 suite. */
interface BackendProfileSnapshotMirror {
  profile: {
    profileVersion: 1;
    backendKind: "supabase" | "local" | "relay";
    supabase?: {
      url: string;
      anonKey: string;
      useSupabase?: boolean;
    };
    note?: string;
  } | null;
  source: "file" | "factory" | "invalid";
  invalidReason?: string;
  filePath?: string;
}

/** T-573: the vite-env mirror of the wire contract's BackendProfileWriteResult. */
type BackendProfileWriteResultMirror =
  | {
      ok: true;
      snapshot: BackendProfileSnapshotMirror;
    }
  | {
      ok: false;
      error: string;
    };

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
