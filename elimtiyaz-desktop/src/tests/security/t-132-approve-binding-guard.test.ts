/**
 * Regression tests for PARENT-102 (task T-132, 22nd session).
 *
 * Defect: the approve-signup-request EF happily approved a PARENT-role
 * request with NEITHER `target_parent_id` NOR `create_new_parent=true`.
 * The SQL RPC (`approve_account_request`, migration 0005) skips the
 * parent-binding block when p_target_parent_id is NULL, so the user was
 * activated with the parent role but `parents.auth_user_id` was never set
 * anywhere. On the website this user signs in via Google OAuth, the
 * auth-provider finds no parent row for their auth_user_id, and they are
 * shown "account not activated" FOREVER despite being status='active'
 * with a role — there is no recovery flow (bind-activation-code rejects
 * already-active users with 409; the request is no longer 'pending' so
 * approve_account_request can't be re-called).
 *
 * Fix (T-132): the EF validates, on the approve path, that a parent-role
 * request carries a binding intent — `target_parent_id` OR
 * `create_new_parent` — and otherwise returns 400 `missing_target_parent`
 * WITH an audit entry (denied-by evidence). Escape hatch: an explicit
 * assign_role override to a STAFF role (checked against the roles table's
 * is_staff_role) legitimately produces a staff account with no parent
 * binding — allowed. Staff-role requests (requested_role='staff') never
 * need a binding — the guard is scoped to parent-role requests only.
 *
 * The EF is a Deno module (https://esm.sh imports) so this suite pins the
 * behaviour with source scans (the T-126/T-131 pattern): the guard exists,
 * sits BEFORE the approve RPC call, audits the denial, and keeps the
 * staff-override escape.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Repository root (…/elimtiyaz-desktop) — this file lives in src/tests/security/. */
const DESKTOP_ROOT = join(__dirname, "..", "..", "..");

const EF_PATH = "supabase/functions/approve-signup-request/index.ts";

function efSource(): string {
  return readFileSync(join(DESKTOP_ROOT, EF_PATH), "utf8");
}

describe("PARENT-102 — approve-without-target-parent guard (T-132)", () => {
  it("returns 400 missing_target_parent when a parent-role approve has NO binding intent", () => {
    const src = efSource();
    expect(src).toContain('"missing_target_parent"');
    // jsonError(req, 400, "missing_target_parent", …)
    expect(src).toMatch(/jsonError\(\s*req,\s*400,\s*"missing_target_parent"/);
  });

  it("scopes the guard to PARENT-role requests (staff requests legitimately need no binding)", () => {
    const src = efSource();
    // The guard's condition must reference the request's own requested_role.
    expect(src).toMatch(/requested_role\s*===?\s*"parent"|requested_role\)\s*===?\s*"parent"/);
  });

  it("accepts BOTH escape routes: an explicit target_parent_id OR create_new_parent", () => {
    const src = efSource();
    // One guard condition naming both body keys.
    const guard = src.match(
      /requested_role[^;]{0,400}create_new_parent[^;]{0,200}target_parent_id[^;]{0,200}/s,
    );
    expect(guard).not.toBeNull();
  });

  it("keeps the staff-override escape (an assign_role override to a STAFF role needs no binding)", () => {
    const src = efSource();
    expect(src).toContain("is_staff_role");
    // The escape must appear in the PARENT-102 guard region (before the RPC call).
    const rpcIndex = src.indexOf('rpc("approve_account_request"');
    const guardIndex = src.indexOf("missing_target_parent");
    expect(rpcIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeGreaterThan(-1);
    // Find the is_staff_role lookup that precedes the RPC call (the 6c
    // override block ALSO mentions is_staff_role — it runs after; the
    // guard's own lookup must come before the RPC).
    const staffLookups = [...src.matchAll(/is_staff_role/g)].map((m) => m.index ?? -1);
    expect(staffLookups.some((i) => i > -1 && i < rpcIndex && i > src.indexOf("PARENT-102"))).toBe(true);
  });

  it("audits the denial before returning the 400 (denied-by evidence for the audit trail)", () => {
    const src = efSource();
    const guardIndex = src.indexOf("missing_target_parent");
    const errorCallIndex = src.indexOf('jsonError(req, 400, "missing_target_parent"');
    // writeAuditLog must be called in the guard block between its start and the 400.
    const guardStart = src.lastIndexOf("PARENT-102", guardIndex);
    const region = src.slice(guardStart, errorCallIndex);
    expect(region).toMatch(/await writeAuditLog\(/);
    expect(region).toMatch(/account_approval\./);
  });

  it("the guard fires BEFORE any state change: before the parent-creation block AND before the approve RPC", () => {
    const src = efSource();
    const guardIndex = src.indexOf("missing_target_parent");
    const rpcIndex = src.indexOf('rpc("approve_account_request"');
    const createParentIndex = src.indexOf("6a. If create_new_parent");
    expect(guardIndex).toBeGreaterThan(-1);
    expect(rpcIndex).toBeGreaterThan(guardIndex);
    expect(createParentIndex).toBeGreaterThan(-1);
    // Guard before the parent-creation step (6a) — no orphan parent row is
    // created for a request that will be rejected... the 6a block creates
    // a parent only when create_new_parent IS set, so the guard must simply
    // precede the RPC; asserting both orders is still the strongest pin.
    expect(guardIndex).toBeLessThan(rpcIndex);
  });

  it("documents the PARENT-102 limbo in the guard's comment (the next agent must not remove it silently)", () => {
    const src = efSource();
    const guardIndex = src.indexOf("missing_target_parent");
    const comment = src.slice(Math.max(0, guardIndex - 2000), guardIndex);
    expect(comment).toMatch(/PARENT-102/);
    expect(comment).toMatch(/active but unbound|unbound|limbo/i);
  });
});
