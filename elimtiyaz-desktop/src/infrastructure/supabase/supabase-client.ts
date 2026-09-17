/**
 * Supabase client singleton.
 *
 * Reads URL + public API key in this priority order:
 *   1. Electron userData/config.json (set via Settings → Configuration tab)
 *   2. localStorage fallback (browser dev mode)
 *   3. Vite env vars (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / VITE_SUPABASE_PUBLISHABLE_KEY)
 *
 * The public key field accepts BOTH public formats (legacy anon JWT and
 * modern sb_publishable_...). The service_role/secret key is never used
 * in the renderer.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function readEnv(name: string): string | undefined {
  try {
    const env = (import.meta as { env?: Record<string, string | undefined> }).env;
    return env?.[name];
  } catch {
    return undefined;
  }
}

const CANONICAL_PRODUCTION_SUPABASE_URL = "https://vebfehrpzajhstyhinnw.supabase.co";
const envSupabaseUrl = readEnv("VITE_SUPABASE_URL");
const envSupabasePublishableKey = readEnv("VITE_SUPABASE_PUBLISHABLE_KEY");
const envSupabaseAnonKey = readEnv("VITE_SUPABASE_ANON_KEY");
const envPublicKey = envSupabasePublishableKey ?? envSupabaseAnonKey;
const isProductionDesktopBuild = readEnv("VITE_DESKTOP_PRODUCTION") === "true";

function readLocalConfigSync(): { url?: string; anonKey?: string; useSupabase?: boolean } {
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
    // Ignore malformed local config and continue with env/runtime defaults.
  }
  return {};
}

const localConfig = readLocalConfigSync();
const localConfigIsExplicitlyEnabled = localConfig.useSupabase === true;
const localConfigMatchesProductionProject =
  !!localConfig.url && localConfig.url.trim() === CANONICAL_PRODUCTION_SUPABASE_URL;
const useLocalProductionConfig =
  isProductionDesktopBuild &&
  localConfigIsExplicitlyEnabled &&
  localConfigMatchesProductionProject &&
  !!localConfig.anonKey;

export const supabaseUrl = isProductionDesktopBuild
  ? CANONICAL_PRODUCTION_SUPABASE_URL
  : (localConfig.url ?? envSupabaseUrl);

export const supabaseAnonKey = isProductionDesktopBuild
  ? (useLocalProductionConfig ? localConfig.anonKey : envPublicKey)
  : (localConfig.anonKey ?? envPublicKey);

/**
 * Packaged production builds are always Supabase-backed and always point at
 * the canonical production project. Development builds retain the existing
 * explicit mock-mode option for local testing.
 */
export const useSupabase = isProductionDesktopBuild
  ? true
  : (localConfig.useSupabase ?? (readEnv("VITE_USE_SUPABASE") === "true"));

if (!supabaseUrl || !supabaseAnonKey) {
  if (useSupabase) {
    throw new Error(
      "Supabase URL and public key must be configured. Open Settings → Configuration or set the production Vite environment."
    );
  }
}

let _client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!_client) {
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error(
        "Supabase client requested but URL/public key are not configured."
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

export function isSupabaseConfigured(): boolean {
  return !!(supabaseUrl && supabaseAnonKey);
}

import { Errors } from "../../core/app-error";
import type { AppError, Result } from "../../core/result";

export function supabaseErrorToAppError(error: {
  code?: string;
  message: string;
  details?: unknown;
}): AppError {
  const msg = error.message ?? "Unknown Supabase error";
  const code = error.code ?? "";

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

export type { Result };
