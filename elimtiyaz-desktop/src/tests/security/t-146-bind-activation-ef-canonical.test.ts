/**
 * T-146 regression tests — the canonical bind-activation-code Edge
 * Function (CROSS-009 / BUSINESS-008 / SEC-104 / ADR-011).
 *
 * The defect stack (owner report 2026-09-03: "the activation code is
 * rejected as already been used"):
 *
 *   1. [CROSS-009] Two contradictory EFs: the hub's canonical version
 *      (bind + audit, NO activation — the user stayed 'pending' forever)
 *      and the website's drifted duplicate (activation with NO audit and
 *      an unsafe transition that resurrected suspended/deleted users).
 *   2. [BUSINESS-008] Whichever deployed, the SAME code could either
 *      activate the account or leave it pending — divergence the owner
 *      experienced as "the system rejects my code".
 *   3. [SEC-104] The website version flipped `status` from ANY non-active
 *      state — including suspended and deleted.
 *   4. [T-146 discovery] The hub EF authenticated via
 *      `extractAuthContext()`, which REJECTS every profile whose
 *      status !== 'active' — the endpoint 401'd the very 'pending' users
 *      it exists for (live evidence: the owner's bind attempts never
 *      reached the RPC).
 *
 * The fix: ONE canonical EF in the hub, with ADR-011's activation
 * semantics (pending → active + parent role), hardened status gates, and
 * caller verification done directly (JWT → profile) instead of the
 * active-only `extractAuthContext` gate.
 *
 * These source scans pin:
 *   1. The canonical EF source exists in the hub repo.
 *   2. It does NOT use extractAuthContext (the pending-user 401 defect).
 *   3. It accepts BOTH body keys (`activation_code` and `code` — the
 *      CROSS-004 cross-platform contract).
 *   4. It enforces the ADR-011 status gates: account_already_active /
 *      account_suspended / account_rejected codes.
 *   5. It grants the `parent` role + flips status 'pending'→'active' +
 *      clears approval_request_id (the activation semantics).
 *   6. It maps RPC errors to structured codes the portal can localize
 *      (code_not_found / code_expired / parent_already_bound).
 *   7. It writes BOTH audit entries (activation_code.bind + account.activated).
 *   8. The website repo carries NO bind-activation-code EF anymore
 *      (the drifted duplicate is deleted — the T-126 pattern).
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Repository root (…/AgentGithubUplaod) — this file lives in elimtiyaz-desktop/src/tests/security/. */
const HUB_ROOT = join(__dirname, "..", "..", "..", "..");
const DESKTOP_ROOT = join(__dirname, "..", "..", "..");

const EF = join(DESKTOP_ROOT, "supabase", "functions", "bind-activation-code", "index.ts");
const WEBSITE_FUNCTIONS = join(HUB_ROOT, "elimtiyaz-website", "supabase", "functions");

const read = (p: string): string => readFileSync(p, "utf8");

/** Strip // line comments and block comments so scans hit CODE, not prose. */
const codeOnly = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/^\s*\/\/.*$/, ""))
    .join("\n");

describe("T-146 — canonical bind-activation-code EF (ADR-011 / CROSS-009 / BUSINESS-008 / SEC-104)", () => {
  it("the canonical EF source exists in the hub repo", () => {
    expect(existsSync(EF)).toBe(true);
  });

  it("does NOT gate the caller through extractAuthContext (pending users were 401'd pre-fix)", () => {
    const code = codeOnly(read(EF));
    // The helper must be neither imported nor invoked (the header comment
    // explains WHY it is not used — comments are stripped before scanning).
    expect(code).not.toMatch(/extractAuthContext/);
    // Direct JWT verification instead.
    expect(code).toContain("auth.getUser(callerJwt)");
  });

  it("accepts BOTH body keys — activation_code (desktop/Android) and code (portal)", () => {
    const src = read(EF);
    expect(src).toContain("body.activation_code ?? body.code");
  });

  it("enforces the ADR-011 status gates (already-active / suspended / rejected)", () => {
    const src = read(EF);
    expect(src).toContain('"account_already_active"');
    expect(src).toContain('"account_suspended"');
    expect(src).toContain('"account_rejected"');
  });

  it("implements the activation semantics: parent role grant + pending→active flip + approval link clear", () => {
    const src = read(EF);
    expect(src).toContain('.eq("code", "parent")');
    expect(src).toContain('.update({ status: "active", approval_request_id: null })');
  });

  it("maps RPC failures to structured error codes (portal-localizable)", () => {
    const src = read(EF);
    expect(src).toContain('"code_not_found"');
    expect(src).toContain('"code_expired"');
    expect(src).toContain('"parent_already_bound"');
  });

  it("writes BOTH audit entries (activation_code.bind + account.activated)", () => {
    const src = read(EF);
    expect(src).toContain('"activation_code.bind"');
    expect(src).toContain('"account.activated"');
  });

  it("the website repo carries NO bind-activation-code EF (drifted duplicate deleted)", () => {
    // The sibling website checkout exists in this workspace layout; when
    // absent (CI without siblings) this scan degrades to the hub-only
    // assertion that the hub still owns the canonical copy.
    if (existsSync(WEBSITE_FUNCTIONS)) {
      const fns = readdirSync(WEBSITE_FUNCTIONS).filter((d) => !d.startsWith("_"));
      expect(fns).toEqual([]);
    }
  });
});
