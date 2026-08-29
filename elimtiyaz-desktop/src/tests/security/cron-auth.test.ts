/**
 * Regression tests for SEC-105 (task T-004).
 *
 * The four cron Edge Functions (`expire-pending-approvals`,
 * `refresh-materialized-views`, `purge-expired-backups`, `run-overdue-scan`)
 * used to treat a request with NO `Authorization` header as a legitimate
 * cron invocation and executed service_role operations across ALL tenants.
 * The "security" was the assumption that only Supabase's scheduler sends
 * headerless requests — in reality ANY anonymous POST matched the same
 * branch (verify_jwt = false lets it through the gateway).
 *
 * Fix (T-004): a shared guard `supabase/functions/_shared/cron-auth.ts`
 * authorises an invocation ONLY when
 *   - `Authorization: Bearer <CRON_SECRET>` matches the configured secret,
 *   - or `Authorization: Bearer <service_role key>` matches (the managed
 *     scheduler injects the project's service_role key; possessing it
 *     already grants full DB access, so this adds no exposure),
 * and denies EVERYTHING ELSE — including a MISSING header (fail closed).
 *
 * Coverage:
 *   1. Unit tests of the pure decision core `isCronAuthorized` (Deno-free,
 *      imported directly from the shared EF module).
 *   2. Source scans of the four EF files asserting the vulnerable
 *      "no Authorization header = cron" patterns are gone and the shared
 *      guard is actually wired in (same scanning approach as the SEC-100
 *      regression suite).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isCronAuthorized } from "../../../supabase/functions/_shared/cron-auth.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Repository root (…/elimtiyaz-desktop) — this file lives in src/tests/security/. */
const DESKTOP_ROOT = join(__dirname, "..", "..", "..");

/** The four cron EF entry points (SEC-105's exact scope). */
const CRON_EF_FILES = [
  "supabase/functions/expire-pending-approvals/index.ts",
  "supabase/functions/refresh-materialized-views/index.ts",
  "supabase/functions/purge-expired-backups/index.ts",
  "supabase/functions/run-overdue-scan/index.ts",
] as const;

const CRON_SECRET = "test-cron-secret-0123456789abcdef";
const SERVICE_ROLE_KEY = "test-service-role-key-fedcba9876543210";

function request(headers: Record<string, string>, method = "POST"): Request {
  return new Request("https://example.supabase.co/functions/v1/run-overdue-scan", {
    method,
    headers,
  });
}

describe("SEC-105 — cron-auth guard unit behaviour", () => {
  it("denies a request with NO Authorization header (the SEC-105 hole)", () => {
    const req = request({});
    expect(
      isCronAuthorized(req, { cronSecret: CRON_SECRET, serviceRoleKey: SERVICE_ROLE_KEY }),
    ).toBe(false);
  });

  it("denies a request with an empty Bearer token", () => {
    const req = request({ authorization: "Bearer " });
    expect(
      isCronAuthorized(req, { cronSecret: CRON_SECRET, serviceRoleKey: SERVICE_ROLE_KEY }),
    ).toBe(false);
  });

  it("denies a non-Bearer authorization scheme", () => {
    const req = request({ authorization: `Basic ${CRON_SECRET}` });
    expect(
      isCronAuthorized(req, { cronSecret: CRON_SECRET, serviceRoleKey: SERVICE_ROLE_KEY }),
    ).toBe(false);
  });

  it("denies a wrong secret", () => {
    const req = request({ authorization: "Bearer not-the-secret" });
    expect(
      isCronAuthorized(req, { cronSecret: CRON_SECRET, serviceRoleKey: SERVICE_ROLE_KEY }),
    ).toBe(false);
  });

  it("fails closed when CRON_SECRET is not configured", () => {
    const req = request({ authorization: `Bearer ${CRON_SECRET}` });
    expect(isCronAuthorized(req, { cronSecret: undefined, serviceRoleKey: undefined })).toBe(false);
    expect(isCronAuthorized(req, { cronSecret: null, serviceRoleKey: null })).toBe(false);
  });

  it("accepts a matching CRON_SECRET bearer token", () => {
    const req = request({ authorization: `Bearer ${CRON_SECRET}` });
    expect(isCronAuthorized(req, { cronSecret: CRON_SECRET, serviceRoleKey: SERVICE_ROLE_KEY })).toBe(true);
  });

  it("accepts the service_role key (managed scheduler invocation)", () => {
    const req = request({ authorization: `Bearer ${SERVICE_ROLE_KEY}` });
    expect(isCronAuthorized(req, { cronSecret: CRON_SECRET, serviceRoleKey: SERVICE_ROLE_KEY })).toBe(true);
  });

  it("does not accept a user-grade JWT-like token", () => {
    const userJwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sig";
    const req = request({ authorization: `Bearer ${userJwt}` });
    expect(
      isCronAuthorized(req, { cronSecret: CRON_SECRET, serviceRoleKey: SERVICE_ROLE_KEY }),
    ).toBe(false);
  });

  it("denies secrets that only share a prefix with the configured value", () => {
    const req = request({ authorization: `Bearer ${CRON_SECRET}-extended` });
    expect(
      isCronAuthorized(req, { cronSecret: CRON_SECRET, serviceRoleKey: SERVICE_ROLE_KEY }),
    ).toBe(false);
  });

  it("denies when no secret is configured at all and the header is present", () => {
    const req = request({ authorization: "Bearer whatever" });
    expect(isCronAuthorized(req, {})).toBe(false);
  });
});

describe("SEC-105 — the four cron EFs are wired to the shared guard", () => {
  it("the shared guard module exists", () => {
    const guard = readFileSync(join(DESKTOP_ROOT, "supabase/functions/_shared/cron-auth.ts"), "utf8");
    expect(guard).toContain("isCronAuthorized");
  });

  for (const efPath of CRON_EF_FILES) {
    it(`${efPath} imports and uses isCronInvocation`, () => {
      const source = readFileSync(join(DESKTOP_ROOT, efPath), "utf8");
      expect(source).toContain("_shared/cron-auth.ts");
      expect(source).toContain("isCronInvocation");
    });

    it(`${efPath} no longer treats a missing Authorization header as cron`, () => {
      const source = readFileSync(join(DESKTOP_ROOT, efPath), "utf8");
      // The vulnerable patterns that granted execution on an absent header:
      expect(source).not.toContain("const isCron = !authHeader");
      expect(source).not.toContain("No JWT required (cron invocation)");
      expect(source).not.toContain("Allow only cron (no auth)");
    });
  }
});
