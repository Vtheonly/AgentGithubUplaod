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
 *
 * T-472 (TEST-503) — the hermeticity seam: inside Vitest the canonical
 * production fallbacks are DISABLED and the default mode is MOCK. The
 * f39eb17 fallback existed so a packaged build connects without env, but it
 * also made `isSupabaseConfigured()` TRUE inside every test suite — silently
 * repealing T-314's hermetic contract (the vault pair was uploading to the
 * REAL production bucket). A suite that genuinely needs a configured path
 * must pin it explicitly: localStorage `el-imtiyaz.local-config` +
 * `vi.resetModules()` + a dynamic import, or a partial `vi.mock` of this
 * module (the vault-suite pattern). Production, packaged builds and the
 * dev/browser default are unchanged.
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

/**
 * T-472 (TEST-503): true only inside a Vitest run — the hermeticity seam.
 *
 * The detection is layered, each signal independently sufficient, and NONE
 * of them can be true inside the packaged app (the Electron renderer runs
 * with `nodeIntegration: false`, so `process` does not even exist there):
 *   1. `process.env.VITEST === "true"` — set by the Vitest runner itself in
 *      every environment it creates (jsdom included; verified empirically —
 *      vitest 2.1.8's `import.meta.env.VITEST` is FILTERED OUT by this
 *      project's own `envPrefix: ["VITE_TEST_"]` contract from T-314, so
 *      `process.env` is the reliable carrier);
 *   2. `import.meta.env.VITEST` — the documented flag, present whenever the
 *      envPrefix allows it (kept as a second positive signal: it can only
 *      make a test run MORE hermetic, never less);
 *   3. `import.meta.vitest` — defined only when the Vitest plugin transformed
 *      this module (never in a production Vite build).
 *
 * Read defensively — some SSR transforms strip `import.meta.env`.
 */
const isVitestRun = (() => {
  try {
    if (typeof process !== "undefined" && process.env?.VITEST === "true") {
      return true;
    }
    const metaVitest = (import.meta as { vitest?: unknown }).vitest;
    if (metaVitest != null) return true;
    const envVitest = (import.meta as { env?: Record<string, unknown> }).env?.VITEST;
    return envVitest === true || envVitest === "true";
  } catch {
    return false;
  }
})();

function normalizeSupabaseUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;

  const trimmed = value.trim();
  if (!trimmed) return undefined;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return undefined;
    }

    // Keep the origin/path supplied by configuration, but never allow
    // whitespace around the host to become an encoded %20 in requests.
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

/**
 * OPS-318 (T-392): the shared URL-normalization seam. Every place that
 * stores or probes a user-supplied Supabase URL must go through this
 * function — `LocalConfigService.validateConnection` previously built
 * `${url}/rest/v1/…` from the RAW input, so a trailing space survived
 * the `startsWith("https://")` check and became the owner's
 * `…supabase.co%20/rest/v1/tenants` ERR_NAME_NOT_RESOLVED request.
 * Re-exported for the config validation path (never a second client —
 * TASK 2 invariant holds: this is pure string handling, no SDK state).
 */
export { normalizeSupabaseUrl };

function normalizePublicKey(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

const envSupabaseUrl = normalizeSupabaseUrl(readEnv("VITE_SUPABASE_URL"));
const envSupabasePublishableKey = normalizePublicKey(
  readEnv("VITE_SUPABASE_PUBLISHABLE_KEY"),
);
const envSupabaseAnonKey = normalizePublicKey(readEnv("VITE_SUPABASE_ANON_KEY"));
// T-472 (TEST-503): the canonical-key fallback is disabled inside Vitest —
// the hermetic contract is "no env ⇒ not configured".
const envPublicKey =
  envSupabasePublishableKey ?? envSupabaseAnonKey ?? (isVitestRun ? undefined : CANONICAL_PRODUCTION_PUBLIC_KEY);
const isProductionDesktopBuild = readEnv("VITE_DESKTOP_PRODUCTION") === "true";

function readLocalConfigSync(): { url?: string; anonKey?: string; useSupabase?: boolean } {
  try {
    const raw = localStorage.getItem("el-imtiyaz.local-config");
    if (raw) {
      const config = JSON.parse(raw);
      return {
        url: normalizeSupabaseUrl(config.supabase_url),
        anonKey: normalizePublicKey(config.supabase_anon_key),
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
  : (localConfig.url ?? envSupabaseUrl ?? (isVitestRun ? undefined : CANONICAL_PRODUCTION_SUPABASE_URL));

export const supabaseAnonKey = isProductionDesktopBuild
  ? productionSupabaseKey
  : (localConfig.anonKey ?? envPublicKey);

/**
 * Live Supabase is the default whenever the application has a Supabase
 * configuration. Development can still explicitly opt into mock mode by
 * setting VITE_USE_SUPABASE=false or the local configuration toggle.
 *
 * T-472 (TEST-503): inside Vitest the DEFAULT is mock mode (T-314's
 * documented contract). A suite that wants the configured path must pin it
 * explicitly (local-config or vi.mock) — including VITE_USE_SUPABASE via
 * vi.stubEnv + vi.resetModules() + a dynamic import when the env route is
 * the seam under test.
 */
const envUseSupabase = readEnv("VITE_USE_SUPABASE");
export const useSupabase = isProductionDesktopBuild
  ? true
  : (localConfig.useSupabase ??
    (envUseSupabase !== undefined
      ? envUseSupabase !== "false"
      : !isVitestRun));

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
    isProductionBuild: isProductionDesktopBuild,
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
