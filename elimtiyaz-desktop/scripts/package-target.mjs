/**
 * The PACKAGER TARGET resolution — T-573 (the OPS-016 unlock's re-point) +
 * the T-575 wiring seam (`scripts/preflight-target.mjs` rides on top).
 *
 * PRE-T-573 (canonical-identity): the packager hard-failed on any non-
 * canonical public key and probed ONLY the canonical URL — a packaged build
 * was hostage to the canonical project's health (its 402 quota state blocked
 * every installer: OPS-016).
 *
 * T-573 (target-readiness): the packager packages THE TARGET the owner
 * names — `EL_IMTIYAZ_TARGET_URL` / `EL_IMTIYAZ_TARGET_KEY` win, then the
 * VITE_* / SUPABASE_* env chain, then the FACTORY DEFAULT (the canonical
 * project, identical to the pre-T-573 behavior). The preflight probe runs
 * against THE RESOLVED TARGET (readiness, not identity): any healthy
 * Supabase project is packageable; the canonical project is just the
 * default. The foreign-key hard-fail rule is GONE — it was the identity
 * lock, and re-pointing is the whole point.
 *
 * PURE MODULE (no side effects) so the t-573 suite can unit-test the
 * resolution matrix. The values mirror `electron/backend-profile-contract.ts`'s
 * factory defaults (build-time mirror: plain node cannot import TS — kept
 * honest by the contract tests pinning the TS side and this mirror being
 * doc-noted).
 */

export const FACTORY_DEFAULT_SUPABASE_URL = "https://gvuvibcsfjhwcjikgxql.supabase.co";
export const FACTORY_DEFAULT_SUPABASE_PUBLIC_KEY =
  "sb_publishable_d-0XZQsTuzr3r2-kFxw-rA__BuQAvAa";

/**
 * Resolve the packaged target from the environment layers.
 *
 * @param {object} input
 * @param {Record<string, string|undefined>} input.processEnv - process.env
 *   (EL_IMTIYAZ_TARGET_*, SUPABASE_*, VITE_*).
 * @param {Record<string, string|undefined>} input.viteEnv - vite loadEnv("production") VITE_* values.
 * @param {Record<string, string|undefined>} [input.allEnv] - vite loadEnv("production", dir, "") values.
 * @returns {{ url: string, key: string, source: string }}
 */
export function resolvePackageTarget({ processEnv, viteEnv, allEnv }) {
  const env = processEnv ?? {};
  const vite = viteEnv ?? {};
  const all = allEnv ?? {};
  const pick = (...candidates) => {
    for (const c of candidates) {
      const value = typeof c === "string" ? c.trim() : undefined;
      if (value) return value;
    }
    return undefined;
  };

  const url = pick(
    env.EL_IMTIYAZ_TARGET_URL,
    vite.VITE_SUPABASE_URL,
    all.SUPABASE_URL,
    env.SUPABASE_URL,
    env.VITE_SUPABASE_URL,
  ) ?? FACTORY_DEFAULT_SUPABASE_URL;

  const key = pick(
    env.EL_IMTIYAZ_TARGET_KEY,
    vite.VITE_SUPABASE_PUBLISHABLE_KEY,
    vite.VITE_SUPABASE_ANON_KEY,
    all.SUPABASE_PUBLISHABLE_KEY,
    all.SUPABASE_ANON_KEY,
    env.SUPABASE_PUBLISHABLE_KEY,
    env.SUPABASE_ANON_KEY,
    env.VITE_SUPABASE_PUBLISHABLE_KEY,
    env.VITE_SUPABASE_ANON_KEY,
  ) ?? FACTORY_DEFAULT_SUPABASE_PUBLIC_KEY;

  const source = env.EL_IMTIYAZ_TARGET_URL
    ? "explicit target (EL_IMTIYAZ_TARGET_URL)"
    : url === FACTORY_DEFAULT_SUPABASE_URL
      ? "factory default (the canonical project)"
      : "env override";

  return { url, key, source };
}

/** The target URL must be an https origin (any host — readiness, not identity). */
export function isValidTargetUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.hostname.length > 0;
  } catch {
    return false;
  }
}

/** The key must be a non-empty PUBLIC key (never a secret/service-role value). */
export function isValidTargetKey(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^(?:changeme|change-me|your[-_]?key|placeholder|replace[-_]?me)$/i.test(trimmed)) return false;
  // A service-role/secret key must NEVER be packaged — fail loudly.
  if (trimmed.startsWith("sb_secret_")) return false;
  return true;
}

/**
 * The target-readiness probe (the packager's preflight; the pre-T-573
 * `verifyCanonicalSupabase` re-pointed). One REST reachability fetch against
 * THE TARGET. Returns { ok, status, detail } — the caller decides to fail.
 * NOT run during this session (OPS-015: zero live traffic) — it executes
 * only inside an actual packaging run.
 */
export async function probeTargetReadiness(url, key) {
  try {
    const response = await fetch(`${url}/rest/v1/tenants?select=id&limit=1`, {
      headers: { apikey: key },
    });
    if (response.status === 402) {
      return {
        ok: false,
        status: 402,
        detail:
          "HTTP 402 — the target project is egress-quota-blocked (exceed_egress_quota). " +
          "The package was not built: pick a healthy target (EL_IMTIYAZ_TARGET_URL) or lift the cap first (the owner-side G2 action).",
      };
    }
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        detail: `HTTP ${response.status} from the target REST gateway — verify the URL/key.`,
      };
    }
    return { ok: true, status: response.status, detail: "target REST gateway reachable, key accepted" };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      detail: `target probe failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
