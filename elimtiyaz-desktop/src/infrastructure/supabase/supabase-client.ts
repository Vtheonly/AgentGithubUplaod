/**
 * Supabase client singleton.
 *
 * T-573 (ADD-9) — the canonical hard-lock is DEMOTED: the compiled-in
 * constants (previously `CANONICAL_*` here) are now the FACTORY DEFAULT,
 * consulted only when no valid `BackendProfile` is present. The effective
 * target resolves through `resolveEffectiveSupabaseTarget` (below):
 *   1. the runtime BackendProfile — ONE main-process service → the preload
 *      bridge's init-time snapshot: a packaged app can be re-pointed to a
 *      new Supabase project WITHOUT a rebuild (the T-573 acceptance),
 *   2. otherwise the pre-T-573 chain EXACTLY: production → factory default;
 *      dev → local config → env → factory default (disabled in Vitest — the
 *      T-472/T-314 hermeticity seam is UNCHANGED).
 * Fail-closed semantics preserved: no valid target + useSupabase → the
 * provider's selection still refuses to fall back to mock silently.
 *
 * The renderer only ever uses a PUBLIC Supabase key. Secret/service-role keys
 * must never be bundled into the desktop application.
 *
 * T-472 (TEST-503) — the hermeticity seam: inside Vitest the factory
 * fallbacks are DISABLED and the default mode is MOCK. A suite that
 * genuinely needs a configured path must pin it explicitly: localStorage
 * `el-imtiyaz.local-config` + `vi.resetModules()` + a dynamic import, or a
 * partial `vi.mock` of this module (the vault-suite pattern). Production,
 * packaged builds and the dev/browser default are unchanged.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  deriveProjectRef,
  FACTORY_DEFAULT_PROJECT_REF,
  FACTORY_DEFAULT_SUPABASE_PUBLIC_KEY,
  FACTORY_DEFAULT_SUPABASE_URL,
  validateBackendProfile,
  type BackendKind,
  type BackendProfileSnapshot,
  type BackendProfileV1,
} from "../../../electron/backend-profile-contract";

export { deriveProjectRef, FACTORY_DEFAULT_PROJECT_REF, FACTORY_DEFAULT_SUPABASE_URL };

function readEnv(name: string): string | undefined {
  try {
    const env = (import.meta as { env?: Record<string, string | undefined> }).env;
    return env?.[name];
  } catch {
    return undefined;
  }
}

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
// T-472 (TEST-503): the factory-key fallback is disabled inside Vitest —
// the hermetic contract is "no env ⇒ not configured".
const envPublicKey =
  envSupabasePublishableKey ?? envSupabaseAnonKey ?? (isVitestRun ? undefined : FACTORY_DEFAULT_SUPABASE_PUBLIC_KEY);
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

const envUseSupabase = readEnv("VITE_USE_SUPABASE");

const localConfig = readLocalConfigSync();

// ============================================================================
// T-573 — the BackendProfile resolution (the DEMOTED factory default governs
// only when no valid profile is present)
// ============================================================================

/**
 * The PURE resolver — the effective supabase target for one build/runtime.
 * Exported for the t-573 switch-matrix tests; the module init below calls it
 * with the real inputs (identical computation, now testable). Zero behavior
 * change when no profile is present: every fallback matches the pre-T-573
 * chain verbatim (production → factory; dev → localConfig → env → factory;
 * vitest → unconfigured).
 */
export function resolveEffectiveSupabaseTarget(input: {
  profile: BackendProfileV1 | null;
  localConfig: { url?: string; anonKey?: string; useSupabase?: boolean };
  env: { url?: string; publicKey?: string; useSupabase?: string | undefined };
  flags: { isProductionDesktopBuild: boolean; isVitestRun: boolean };
}): {
  url?: string;
  anonKey?: string;
  useSupabase: boolean;
  backendKind: BackendKind;
  profileApplied: boolean;
} {
  const { profile, localConfig, env, flags } = input;
  // The profile GOVERNS when it declares a supabase target (any build mode —
  // the packaged re-point path). Non-supabase kinds are declared-but-unbuilt
  // renderer-side (Stage B/T-599, relay/T-601): they contribute NO target and
  // the honest fallback is mock (useSupabase=false).
  const profileTarget =
    profile?.backendKind === "supabase" && profile.supabase ? profile.supabase : undefined;
  const profileGoverned = profileTarget !== undefined;

  const url = profileTarget
    ? profileTarget.url
    : flags.isProductionDesktopBuild
      ? FACTORY_DEFAULT_SUPABASE_URL
      : (localConfig.url ?? env.url ?? (flags.isVitestRun ? undefined : FACTORY_DEFAULT_SUPABASE_URL));

  const anonKey = profileTarget
    ? profileTarget.anonKey
    : flags.isProductionDesktopBuild
      ? FACTORY_DEFAULT_SUPABASE_PUBLIC_KEY
      : (localConfig.anonKey ?? env.publicKey);

  const useSupabase = profileTarget
    ? (profileTarget.useSupabase ?? true)
    : profile
      // A DECLARED non-supabase kind (local/relay) is an honest "not wired
      // yet" (Stage B/T-599, relay/T-601): the owner's explicit profile
      // governs — the supabase wiring is NOT activated from it (mock).
      ? false
      : flags.isProductionDesktopBuild
        ? true
        : (localConfig.useSupabase ??
          (env.useSupabase !== undefined ? env.useSupabase !== "false" : !flags.isVitestRun));

  return {
    url,
    anonKey,
    useSupabase,
    backendKind: profile?.backendKind ?? "supabase",
    profileApplied: profileGoverned,
  };
}

/**
 * The session storageKey PER TARGET: a JWT issued by project A is never
 * restored against project B (the pre-T-573 pin's intent at the createClient
 * storageKey, now derived from the EFFECTIVE target instead of the constant).
 * With no profile and the factory default this yields the pre-T-573 string
 * VERBATIM.
 */
export function supabaseSessionStorageKey(effectiveUrl?: string): string {
  const ref = deriveProjectRef(effectiveUrl) ?? FACTORY_DEFAULT_PROJECT_REF;
  return `el-imtiyaz.supabase.session.${ref}`;
}

/**
 * The bridge snapshot (synchronous — ONE sendSync cached in the preload at
 * init). Defensively re-validated HERE against the wire contract: even a
 * misbehaving bridge cannot promote an invalid profile (fail-closed twice).
 */
function readBackendProfileSnapshotSync(): BackendProfileSnapshot | null {
  try {
    const bridge = (
      window as unknown as
        | { elImtiyaz?: { backendProfile?: { getSync?: () => BackendProfileSnapshot | null } } }
        | undefined
    )?.elImtiyaz?.backendProfile;
    const snapshot = bridge?.getSync?.() ?? null;
    if (!snapshot) return null;
    if (snapshot.profile) {
      const verdict = validateBackendProfile(snapshot.profile);
      if (!verdict.ok) {
        return {
          profile: null,
          source: "invalid",
          invalidReason: `renderer re-validation rejected the bridge snapshot: ${verdict.reason}`,
          filePath: snapshot.filePath,
        };
      }
      return { ...snapshot, profile: verdict.profile };
    }
    return snapshot;
  } catch {
    return null; // outside Electron (browser/vitest) or a broken bridge
  }
}

const backendProfileSnapshot = readBackendProfileSnapshotSync();
/** The effective profile (null = absent/invalid → the factory default governs). */
export const activeBackendProfile = backendProfileSnapshot;

const effectiveTarget = resolveEffectiveSupabaseTarget({
  profile: backendProfileSnapshot?.profile ?? null,
  localConfig,
  env: { url: envSupabaseUrl, publicKey: envPublicKey, useSupabase: envUseSupabase },
  flags: { isProductionDesktopBuild, isVitestRun },
});

/** The declared backend kind (the settings/diagnostics surfaces' honest label). */
export const activeBackendKind: BackendKind = effectiveTarget.backendKind;

export const supabaseUrl = effectiveTarget.url;

export const supabaseAnonKey = effectiveTarget.anonKey;

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
 *
 * T-573: a profile declaring a supabase target governs this flag in EVERY
 * build mode (`useSupabase ?? true`); non-supabase profile kinds yield the
 * honest mock fallback (false).
 */
export const useSupabase = effectiveTarget.useSupabase;

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
        // T-573: scope the persisted session to the EFFECTIVE target project
        // (derived from supabaseUrl) — a JWT issued by project A is never
        // restored against project B. With no profile this yields the
        // pre-T-573 canonical string VERBATIM.
        storageKey: supabaseSessionStorageKey(supabaseUrl),
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
 *
 * T-573 additions: `backendKind` (the effective profile's declared kind —
 * "supabase" when no profile exists) + `profileSource` (where the profile
 * came from) + `projectRef` (the EFFECTIVE target's derived ref, the
 * session-scoping key). Additive only — every pre-T-573 field is unchanged.
 */
export function describeSupabaseConnection(): {
  url: string | undefined;
  host: string | undefined;
  isProductionBuild: boolean;
  useSupabase: boolean;
  configured: boolean;
  keyFormat: "publishable" | "anon-jwt" | "missing" | "other";
  backendKind: BackendKind;
  profileSource: "file" | "factory" | "invalid" | "none";
  projectRef: string;
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
    backendKind: activeBackendKind,
    profileSource: activeBackendProfile?.source ?? "none",
    projectRef: deriveProjectRef(supabaseUrl) ?? FACTORY_DEFAULT_PROJECT_REF,
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
