/**
 * The BackendProfile wire contract — T-573 (ADD-9 / the S18 §B relocation
 * design; supersedes T-551's hard-lock removal + E1.7's declaration deletion).
 *
 * WHAT THIS IS:
 *   A versioned profile object that tells the PACKAGED app which backend to
 *   use. It is resolved by ONE main-process service (`backend-profile.cts`)
 *   from `userData/backend-profile.json`, validated HERE (fail-closed: ANY
 *   invalid input → the factory default governs), and exposed to the renderer
 *   through the preload bridge as a SYNCHRONOUS snapshot (one `sendSync` at
 *   preload-init — the renderer's module-init resolution stays sync).
 *
 * THE ACCEPTANCE (EXECUTION-PLAN §3 Step 6):
 *   A packaged app can be pointed at a new Supabase project WITHOUT a
 *   rebuild: drop a valid `backend-profile.json` into the app's userData
 *   directory, relaunch — the effective URL/key/useSupabase come from the
 *   profile in EVERY build mode. No profile (or an invalid one) reproduces
 *   the pre-T-573 behavior EXACTLY: the compiled-in canonical constants are
 *   the FACTORY DEFAULT below.
 *
 * WHY THE CONSTANTS LIVE HERE:
 *   The canonical production project (previously hard-locked in
 *   `supabase-client.ts:35-38,148-157,171-172` — ARCH-022/023/024) DEMOTES
 *   to the factory default: it is what an app with NO profile connects to.
 *   `scripts/package-target.mjs` mirrors the same defaults for the packager
 *   (a build-time mirror — the packager cannot import TS; the t-573 census
 *   keeps the mirror honest via its doc-note + the probe against the
 *   resolved target).
 *
 * THIS MODULE IS PURE (no electron, no node builtins): it is imported by the
 * main process (compiled by electron/tsconfig.json), by the renderer
 * (`supabase-client.ts` — the client re-validates whatever the bridge hands
 * it), and by the vitest suites.
 */

// ============================================================================
// The factory defaults (the DEMOTED canonical production project)
// ============================================================================

/**
 * The factory-default Supabase target — the T-614 relocation target
 * (2026-11-22 cutover; history: `vebfehrpzajhstyhinnw` 2026-09-17 → the
 * relocation window, now 402-quota-dead; `hkvkefubghbbotgnteir` before it).
 */
export const FACTORY_DEFAULT_SUPABASE_URL = "https://gvuvibcsfjhwcjikgxql.supabase.co";
/**
 * The factory-default PUBLIC key. PUBLIC on purpose: publishable/anon keys
 * are safe to embed in the client bundle; secret/service-role keys must
 * never appear anywhere near the desktop app or this contract.
 */
export const FACTORY_DEFAULT_SUPABASE_PUBLIC_KEY = "sb_publishable_d-0XZQsTuzr3r2-kFxw-rA__BuQAvAa";
/** The factory-default project ref (the session storageKey's last resort). */
export const FACTORY_DEFAULT_PROJECT_REF = "gvuvibcsfjhwcjikgxql";

// ============================================================================
// The profile schema (v1)
// ============================================================================

export const BACKEND_PROFILE_VERSION = 1;

/**
 * The backend kinds. v1 renderer semantics (honest, fail-closed):
 *   - "supabase": the profile's supabase target GOVERNS url/key/useSupabase
 *     in every build mode (the packaged re-point path).
 *   - "local":   Stage B (T-599) — declared but NOT yet implemented by the
 *     renderer; the client treats it as "no supabase target from the
 *     profile" (useSupabase=false → the honest mock fallback; the settings
 *     surfaces report the declared kind). The validator FORBIDS a supabase
 *     target on a local profile (strict v1).
 *   - "relay":   the self-hosted relay (T-601) — declared but NOT yet
 *     implemented; validator requires an https origin (any host); the
 *     renderer treats it like local (no supabase wiring today).
 */
export type BackendKind = "supabase" | "local" | "relay";

export interface SupabaseBackendTarget {
  /** The backend origin (https; supabase kind: https://<ref>.supabase.co). */
  url: string;
  /** The PUBLIC key (publishable/anon) — never a secret/service-role key. */
  anonKey: string;
  /** Optional override — default true for a supabase-kind profile. */
  useSupabase?: boolean;
}

export interface BackendProfileV1 {
  profileVersion: 1;
  backendKind: BackendKind;
  /** Required for "supabase", forbidden for "local", required for "relay". */
  supabase?: SupabaseBackendTarget;
  /** Free-form owner note (≤ 500 chars), carried for the settings surfaces. */
  note?: string;
}

/**
 * The bridge snapshot: the validated profile (or null = absent/invalid →
 * the factory default governs) + WHERE it came from + why it was rejected.
 */
export interface BackendProfileSnapshot {
  profile: BackendProfileV1 | null;
  source: "file" | "factory" | "invalid";
  invalidReason?: string;
  /** The userData file path (main-process knowledge, for the diagnostics UI). */
  filePath?: string;
}

export type BackendProfileWriteResult =
  | { ok: true; snapshot: BackendProfileSnapshot }
  | { ok: false; error: string };

// ============================================================================
// T-619 / BUG-055 — the known-dead project quarantine
// ============================================================================

/**
 * Supabase projects VERIFIED dead (permanently quota-restricted — probed
 * 2026-11-24: every endpoint returns 402 "Service for this project is
 * restricted … exceed_egress_quota"). A backend profile OR a local-config
 * target pointing at one of these is REJECTED so the live factory default
 * governs — otherwise a stale profile bricks the app at the login screen
 * with an opaque "Erreur interne du serveur" (the owner-reported BUG-055:
 * "refuses to login at all … error in the server").
 *
 * This list only ever grows when a project is VERIFIED dead — never as a
 * speculative blocklist. hkvkefubghbbotgnteir died before 2026-09-17;
 * vebfehrpzajhstyhinnw went 402-dead at the 2026-11-22 T-614 cutover.
 */
export const DEAD_SUPABASE_PROJECT_REFS: readonly string[] = [
  "hkvkefubghbbotgnteir",
  "vebfehrpzajhstyhinnw",
];

/** True when the URL points at a known-dead (quota-restricted) project. */
export function isKnownDeadSupabaseProject(url: string | undefined | null): boolean {
  const ref = deriveProjectRef(url);
  return ref !== null && DEAD_SUPABASE_PROJECT_REFS.includes(ref);
}

export type BackendProfileValidation =
  | { ok: true; profile: BackendProfileV1 }
  | { ok: false; reason: string };

// ============================================================================
// Validation — fail-closed, strict v1
// ============================================================================

const PROFILE_TOP_LEVEL_KEYS = ["profileVersion", "backendKind", "supabase", "note"] as const;
const TARGET_KEYS = ["url", "anonKey", "useSupabase"] as const;
const BACKEND_KINDS: BackendKind[] = ["supabase", "local", "relay"];

/** Normalize an https origin (strip hash/trailing slash) — null when invalid. */
export function normalizeProfileUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:") return undefined;
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

/**
 * The project ref behind a URL: `https://<ref>.supabase.co` → `<ref>`;
 * any other parseable host → the sanitized hostname; garbage → null.
 * The session storageKey scopes JWTs PER TARGET (a session issued by
 * project A is never restored against project B — the pre-T-573 pin's
 * intent, now derived from the EFFECTIVE target instead of the constant).
 */
export function deriveProjectRef(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (!host) return null;
    if (host.endsWith(".supabase.co")) {
      const ref = host.slice(0, -".supabase.co".length);
      return ref || null;
    }
    return host.replace(/[^a-z0-9-]/g, "-") || null;
  } catch {
    return null;
  }
}

function validateTarget(
  raw: unknown,
  backendKind: BackendKind,
): { ok: true; target?: SupabaseBackendTarget } | { ok: false; reason: string } {
  if (raw === undefined) {
    if (backendKind === "local") return { ok: true };
    return {
      ok: false,
      reason:
        backendKind === "supabase"
          ? "backendKind 'supabase' requires a supabase target"
          : "backendKind 'relay' requires an https target",
    };
  }
  if (backendKind === "local") {
    return { ok: false, reason: "backendKind 'local' must not carry a supabase target (strict v1)" };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: "supabase target must be a JSON object" };
  }
  const record = raw as Record<string, unknown>;
  const unknownKeys = Object.keys(record).filter((k) => !TARGET_KEYS.includes(k as (typeof TARGET_KEYS)[number]));
  if (unknownKeys.length > 0) {
    return { ok: false, reason: `unknown supabase-target key(s): ${unknownKeys.join(", ")}` };
  }
  const url = normalizeProfileUrl(record.url);
  if (!url) {
    return { ok: false, reason: "supabase target url must be a valid https:// origin" };
  }
  if (backendKind === "supabase" && !url.includes(".supabase.co")) {
    return { ok: false, reason: "supabase-kind profile url must be https://<ref>.supabase.co" };
  }
  // T-619 / BUG-055: a profile pinning a KNOWN-DEAD project is invalid —
  // the live factory default governs instead of bricking login.
  if (backendKind === "supabase" && isKnownDeadSupabaseProject(url)) {
    return {
      ok: false,
      reason: `supabase target points at the known-dead project '${deriveProjectRef(url)}' (quota-restricted) — delete the profile or re-point it at the current project`,
    };
  }
  const anonKey = typeof record.anonKey === "string" ? record.anonKey.trim() : "";
  if (!anonKey) {
    return { ok: false, reason: "supabase target anonKey must be a non-empty public key" };
  }
  if (typeof record.useSupabase !== "undefined" && typeof record.useSupabase !== "boolean") {
    return { ok: false, reason: "supabase target useSupabase must be a boolean" };
  }
  return {
    ok: true,
    target: {
      url,
      anonKey,
      ...(typeof record.useSupabase === "boolean" ? { useSupabase: record.useSupabase } : {}),
    },
  };
}

/** The fail-closed v1 validator — the wire contract's single source of truth. */
export function validateBackendProfile(raw: unknown): BackendProfileValidation {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: "the backend profile must be a JSON object" };
  }
  const record = raw as Record<string, unknown>;
  const unknownKeys = Object.keys(record).filter(
    (k) => !PROFILE_TOP_LEVEL_KEYS.includes(k as (typeof PROFILE_TOP_LEVEL_KEYS)[number]),
  );
  if (unknownKeys.length > 0) {
    return { ok: false, reason: `unknown top-level key(s): ${unknownKeys.join(", ")}` };
  }
  if (record.profileVersion !== BACKEND_PROFILE_VERSION) {
    return {
      ok: false,
      reason: `unsupported profileVersion: ${String(record.profileVersion)} (supported: ${BACKEND_PROFILE_VERSION})`,
    };
  }
  const backendKind = record.backendKind;
  if (
    typeof backendKind !== "string" ||
    !BACKEND_KINDS.includes(backendKind as BackendKind)
  ) {
    return {
      ok: false,
      reason: `unknown backendKind: ${String(backendKind)} (supported: ${BACKEND_KINDS.join(", ")})`,
    };
  }
  const target = validateTarget(record.supabase, backendKind as BackendKind);
  if (!target.ok) return target;
  const note = typeof record.note === "string" ? record.note : undefined;
  if (note !== undefined && note.length > 500) {
    return { ok: false, reason: "note exceeds 500 characters" };
  }
  const profile: BackendProfileV1 = {
    profileVersion: 1,
    backendKind: backendKind as BackendKind,
    ...(target.target ? { supabase: target.target } : {}),
    ...(note !== undefined ? { note } : {}),
  };
  return { ok: true, profile };
}

/**
 * Build the snapshot from the RAW FILE TEXT (the main-process service calls
 * this with `userData/backend-profile.json`'s content). Pure and total:
 * null text (missing/unreadable file) → factory; garbage JSON → invalid
 * (fail-closed with the reason); valid JSON → the validated profile.
 */
export function buildBackendProfileSnapshot(
  rawText: string | null,
  filePath: string,
): BackendProfileSnapshot {
  if (rawText === null) {
    return { profile: null, source: "factory", filePath };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(rawText);
  } catch (err) {
    return {
      profile: null,
      source: "invalid",
      invalidReason: `backend-profile.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      filePath,
    };
  }
  const verdict = validateBackendProfile(raw);
  if (!verdict.ok) {
    return { profile: null, source: "invalid", invalidReason: verdict.reason, filePath };
  }
  return { profile: verdict.profile, source: "file", filePath };
}
