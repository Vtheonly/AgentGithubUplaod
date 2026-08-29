// ============================================================================
// _shared/cron-auth.ts — Authentication guard for cron-triggered Edge Functions
// ============================================================================
// SEC-105 fix (task T-004): the four cron EFs (expire-pending-approvals,
// refresh-materialized-views, purge-expired-backups, run-overdue-scan)
// previously treated a request with NO Authorization header as a trusted
// cron invocation and executed service_role operations across ALL tenants.
// Any anonymous POST matched that branch (verify_jwt=false let it through
// the gateway), so the EFs were effectively public.
//
// After this fix an invocation is authorised ONLY when the Authorization
// header carries a Bearer token equal to one of the configured internal
// secrets:
//
//   1. Bearer <CRON_SECRET>      — operator-controlled shared secret
//                                  (`supabase secrets set CRON_SECRET=…`).
//                                  The scheduler MUST send this header for
//                                  headerless schedulers such as pg_cron +
//                                  pg_net (pass it in the http_post call).
//   2. Bearer <service_role key> — Supabase's managed function scheduler
//                                  (config.toml `cron = …`) injects the
//                                  project's service_role key. Possession
//                                  of that key already grants unrestricted
//                                  DB access, so accepting it here adds no
//                                  new exposure.
//
// EVERYTHING ELSE is denied — including a MISSING Authorization header
// (fail closed). A missing or invalid secret yields the same generic 401
// so the endpoint cannot be probed for which check failed.
//
// The decision core `isCronAuthorized` is intentionally Deno-free so the
// desktop's Node/vitest regression suite can import it directly
// (src/tests/security/cron-auth.test.ts); only the `isCronInvocation`
// wrapper touches the Deno environment.

/**
 * Ambient declaration so the desktop's tsc — which type-checks this file
 * because the regression test imports it — accepts the Deno global.
 * Type-only: erased at runtime, where the real Deno global of the Supabase
 * Edge Runtime is used.
 */
declare const Deno: { env: { get(key: string): string | undefined } };

export interface CronAuthSecrets {
  /** Operator-controlled shared secret (env CRON_SECRET), if configured. */
  cronSecret?: string | null;
  /** The project's service_role key (env SUPABASE_SERVICE_ROLE_KEY), if configured. */
  serviceRoleKey?: string | null;
}

/**
 * Constant-time string comparison to avoid leaking, through response
 * timing, how much of a presented token matches a configured secret.
 * Pure JS (no runtime-specific crypto import): works identically under
 * Deno (Edge Runtime) and Node (vitest).
 */
function timingSafeEqual(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

/** Extract the Bearer token from the Authorization header, or null. */
function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

/**
 * Pure decision core: is this request an authorised cron/internal invocation?
 *
 * Returns true ONLY when the Bearer token equals a CONFIGURED secret.
 * An absent header, an absent secret configuration, or a mismatching token
 * all return false — fail closed (SEC-105).
 */
export function isCronAuthorized(req: Request, secrets: CronAuthSecrets): boolean {
  const token = bearerToken(req);
  if (!token) return false;
  const { cronSecret, serviceRoleKey } = secrets;
  if (cronSecret && timingSafeEqual(token, cronSecret)) return true;
  if (serviceRoleKey && timingSafeEqual(token, serviceRoleKey)) return true;
  return false;
}

/**
 * Deno runtime wrapper used by the cron EFs: reads the configured secrets
 * from the Edge Function environment and applies the shared decision core.
 */
export function isCronInvocation(req: Request): boolean {
  return isCronAuthorized(req, {
    cronSecret: Deno.env.get("CRON_SECRET"),
    serviceRoleKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
  });
}
