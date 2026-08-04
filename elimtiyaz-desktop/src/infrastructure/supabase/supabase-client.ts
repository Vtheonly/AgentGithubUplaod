/**
 * Supabase client singleton.
 *
 * Reads URL + anon key in this priority order:
 *   1. Electron userData/config.json (set via Settings → Configuration tab)
 *   2. localStorage fallback (browser dev mode)
 *   3. Vite env vars (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY) — legacy
 *
 * The anon key is safe to publish in client-side code because RLS enforces
 * all data access server-side. The service_role key (which bypasses RLS) is
 * NEVER used in the renderer process — only in Supabase Edge Functions.
 *
 * Plan §12.05: "service_role key in client is FORBIDDEN — use anon key only."
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Safe accessor for Vite env vars — `import.meta.env` only exists under Vite.
// In Node scripts / tests, this returns undefined, which is the correct
// fallback (no Supabase env vars configured).
function readEnv(name: string): string | undefined {
  try {
    const env = (import.meta as { env?: Record<string, string | undefined> }).env;
    return env?.[name];
  } catch {
    return undefined;
  }
}

const envSupabaseUrl = readEnv("VITE_SUPABASE_URL");
const envSupabaseAnonKey = readEnv("VITE_SUPABASE_ANON_KEY");

/**
 * Read the Supabase URL + anon key from local config (Electron userData or
 * localStorage). Falls back to env vars if local config is not set.
 *
 * This is synchronous because the Supabase client needs to be initialized
 * before the React tree renders. The Electron IPC is async, so we use a
 * synchronous localStorage fallback for the first render. The Configuration
 * tab will restart the app after saving new settings, so the next render
 * picks up the new values.
 */
function readLocalConfigSync(): { url?: string; anonKey?: string; useSupabase?: boolean } {
  // Try localStorage (works in both Electron renderer + browser)
  try {
    const raw = localStorage.getItem("el-imtiyaz.local-config");
    if (raw) {
      const config = JSON.parse(raw);
      return {
        url: config.supabase_url,
        anonKey: config.supabase_anon_key,
        useSupabase: config.supabase_use_supabase,
      };
    }
  } catch {
    // ignore parse errors
  }
  return {};
}

const localConfig = readLocalConfigSync();

export const supabaseUrl = localConfig.url ?? envSupabaseUrl;
export const supabaseAnonKey = localConfig.anonKey ?? envSupabaseAnonKey;

/**
 * Whether the Supabase adapter should be used instead of the mock layer.
 * Priority: local config > env var.
 */
export const useSupabase = localConfig.useSupabase ?? (readEnv("VITE_USE_SUPABASE") === "true");

if (!supabaseUrl || !supabaseAnonKey) {
  // Only throw if Supabase is explicitly enabled
  if (useSupabase) {
    throw new Error(
      "Supabase URL and anon key must be configured. Open Settings → Configuration to set them, " +
        "or set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local."
    );
  }
}

/**
 * The shared Supabase client. Lazy-initialised so we don't throw in dev mode
 * where the env vars may be unset (when VITE_USE_SUPABASE=false).
 */
let _client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!_client) {
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error(
        "Supabase client requested but URL/anon key are not configured. " +
          "Open Settings → Configuration to set them."
      );
    }
    _client = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage: window.localStorage,
        storageKey: "el-imtiyaz.supabase.session",
      },
      realtime: {
        params: { eventsPerSecond: 10 },
      },
      global: {
        headers: { "x-application-name": "el-imtiyaz-desktop" },
      },
    });
  }
  return _client;
}

/**
 * Whether the Supabase client has been initialized (URL + anon key configured).
 */
export function isSupabaseConfigured(): boolean {
  return !!(supabaseUrl && supabaseAnonKey);
}

/**
 * Helper: convert a Supabase error into the AppError shape used by Result<T>.
 */
import { Errors } from "../../core/app-error";
import type { AppError, Result } from "../../core/result";

export function supabaseErrorToAppError(error: {
  code?: string;
  message: string;
  details?: unknown;
}): AppError {
  const msg = error.message ?? "Unknown Supabase error";
  const code = error.code ?? "";

  // Map common Postgres / Supabase error codes to AppError categories
  if (code === "23505" || msg.includes("duplicate key")) {
    return Errors.conflict(msg);
  }
  if (code === "23503" || msg.includes("foreign key")) {
    return Errors.validation(msg);
  }
  if (code === "42501" || msg.includes("permission denied") || msg.includes("RLS")) {
    return Errors.forbidden(msg);
  }
  if (code === "PGRST116" || msg.includes("JSON object requested")) {
    return Errors.notFound("Row", msg);
  }
  if (code === "401" || msg.includes("JWT") || msg.includes("auth")) {
    return Errors.unauthorized(msg);
  }
  if (msg.includes("network") || msg.includes("fetch")) {
    return Errors.network(msg);
  }
  if (msg.includes("timeout")) {
    return Errors.timeout(msg);
  }
  return Errors.server(msg);
}

// Re-export Result for convenience so callers don't need a separate import
export type { Result };
