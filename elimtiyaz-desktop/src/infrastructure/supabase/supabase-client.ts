/**
 * Supabase client singleton.
 *
 * Development may read a local configuration, but packaged production builds
 * are deliberately locked to the canonical production project. This prevents
 * an old Electron userData/localStorage configuration from silently selecting
 * an old public key or stale Supabase session after a project migration.
 *
 * The renderer only ever uses a PUBLIC Supabase key. Secret/service-role keys
 * must never be bundled into the desktop application.
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
const CANONICAL_PRODUCTION_PUBLIC_KEY =
  "sb_publishable_IPUtQMYQzr1wNnfGTcl5MA_wuz3RUdg";
const CANONICAL_PROJECT_REF = "vebfehrpzajhstyhinnw";

const envSupabaseUrl = readEnv("VITE_SUPABASE_URL");
const envSupabasePublishableKey = readEnv("VITE_SUPABASE_PUBLISHABLE_KEY");
const envSupabaseAnonKey = readEnv("VITE_SUPABASE_ANON_KEY");
const envPublicKey =
  envSupabasePublishableKey ?? envSupabaseAnonKey ?? CANONICAL_PRODUCTION_PUBLIC_KEY;
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

/**
 * Production is intentionally independent from persisted desktop settings.
 * A user can have an old config.json/localStorage value from before the DB
 * migration; allowing that value to override the production key makes the
 * packaged app appear disconnected even though the build itself is correct.
 */
const productionSupabaseUrl = CANONICAL_PRODUCTION_SUPABASE_URL;
const productionSupabaseKey = CANONICAL_PRODUCTION_PUBLIC_KEY;

export const supabaseUrl = isProductionDesktopBuild
  ? productionSupabaseUrl
  : (localConfig.url ?? envSupabaseUrl);

export const supabaseAnonKey = isProductionDesktopBuild
  ? productionSupabaseKey
  : (localConfig.anonKey ?? envPublicKey);

/**
 * Packaged production builds are always live-Supabase builds. Development
 * retains the existing explicit mock-mode option for local testing.
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
        // Scope the persisted session to the NEW project. This prevents a JWT
        // issued by the previous Supabase project from being restored after
        // the production backend migration.
        storageKey: `el-imtiyaz.supabase.session.${CANONICAL_PROJECT_REF}`,
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

/**
 * Non-secret runtime diagnostics for the production connection path.
 * NEVER includes the API key or session tokens — URL hostname only.
 */
export function describeSupabaseConnection(): {
  url: string | undefined;
  host: string | undefined;
  isProductionBuild: boolean;
  useSupabase: boolean;
  configured: boolean;
  keyFormat: "publishable" | "anon-jwt" | "missing" | "other";
} {
  let host: string | undefined;
  try {
    host = supabaseUrl ? new URL(supabaseUrl).hostname : undefined;
  } catch {
    host = undefined;
  }
  const keyFormat = !supabaseAnonKey
    ? "missing"
    : supabaseAnonKey.startsWith("sb_publishable_")
      ? "publishable"
      : supabaseAnonKey.startsWith("eyJ")
        ? "anon-jwt"
        : "other";
  return {
    url: supabaseUrl,
    host,
    isProductionBuild,
    useSupabase,
    configured: isSupabaseConfigured(),
    keyFormat,
  };
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
