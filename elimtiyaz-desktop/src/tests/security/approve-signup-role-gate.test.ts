/**
 * Regression tests for SEC-107 (task T-008).
 *
 * The `approve-signup-request` Edge Function requires only `support_staff`
 * to call, but its `assign_role` body parameter used to accept ANY role
 * code — including `super_admin` — letting a support_staff caller escalate
 * themselves or others to super_admin during an approval (the desktop UI
 * gates role management behind super_admin; the EF was the bypass).
 *
 * Fix (T-008):
 *   1. Pure decision core `canAssignRole` in
 *      `supabase/functions/_shared/role-assignment.ts`: staff/admin roles
 *      (roles.is_staff_role = true) may ONLY be assigned by a super_admin
 *      caller; parent/student stay overridable by support_staff.
 *   2. The EF now (a) rejects UNKNOWN role codes with 400 `invalid_role`
 *      (previously silently skipped the override), (b) returns 403
 *      `role_assignment_forbidden` + writes an
 *      `account_approval.role_override_denied` audit entry when a
 *      non-super_admin attempts a staff role, (c) error-checks the
 *      revoke/insert writes (a failed revoke + successful insert minted
 *      duplicate role_assignments).
 *
 * Coverage:
 *   1. Unit tests of the pure decision core (Deno-free, imported directly).
 *   2. Source scans of the EF asserting the vulnerable patterns are gone
 *      and the guard is actually wired in (T-001/T-004 technique; the
 *      source scans fail against the pre-fix source by construction).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canAssignRole, type TargetRole } from "../../../supabase/functions/_shared/role-assignment.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Repository root (…/elimtiyaz-desktop) — this file lives in src/tests/security/. */
const DESKTOP_ROOT = join(__dirname, "..", "..", "..");

const EF_SOURCE = readFileSync(
  join(DESKTOP_ROOT, "supabase/functions/approve-signup-request/index.ts"),
  "utf-8",
);

const role = (code: string, is_staff_role: boolean): TargetRole => ({ code, is_staff_role });

// Canonical roles per migration 0003 (verified live 2026-08-31): the nine
// staff roles carry is_staff_role=true; parent/student do not.
const SUPER_ADMIN = role("super_admin", true);
const SUPPORT_STAFF = role("support_staff", true);
const TEACHER = role("teacher", true);
const FINANCIAL_OFFICER = role("financial_officer", true);
const PARENT = role("parent", false);
const STUDENT = role("student", false);

describe("SEC-107 — canAssignRole decision core", () => {
  it("a support_staff caller CANNOT assign a staff role (the SEC-107 hole)", () => {
    expect(canAssignRole(["support_staff"], SUPER_ADMIN)).toBe("forbidden_staff_role");
    expect(canAssignRole(["support_staff"], TEACHER)).toBe("forbidden_staff_role");
    expect(canAssignRole(["support_staff"], FINANCIAL_OFFICER)).toBe("forbidden_staff_role");
    // Escalating to the caller's own role is equally forbidden.
    expect(canAssignRole(["support_staff"], SUPPORT_STAFF)).toBe("forbidden_staff_role");
  });

  it("a support_staff caller CAN override to non-staff (web) roles", () => {
    expect(canAssignRole(["support_staff"], PARENT)).toBe("allowed");
    expect(canAssignRole(["support_staff"], STUDENT)).toBe("allowed");
  });

  it("a super_admin caller can assign any role", () => {
    expect(canAssignRole(["super_admin"], SUPER_ADMIN)).toBe("allowed");
    expect(canAssignRole(["super_admin"], TEACHER)).toBe("allowed");
    expect(canAssignRole(["super_admin"], PARENT)).toBe("allowed");
  });

  it("multi-role callers: super_admin anywhere in the list wins", () => {
    expect(canAssignRole(["teacher", "super_admin"], SUPER_ADMIN)).toBe("allowed");
    expect(canAssignRole(["teacher"], SUPER_ADMIN)).toBe("forbidden_staff_role");
  });

  it("empty-role callers cannot assign staff roles (defence in depth)", () => {
    expect(canAssignRole([], SUPER_ADMIN)).toBe("forbidden_staff_role");
    expect(canAssignRole([], PARENT)).toBe("allowed");
  });

  it("a missing/unknown role row is never 'allowed'", () => {
    expect(canAssignRole(["super_admin"], null)).toBe("forbidden_staff_role");
    expect(canAssignRole(["super_admin"], undefined)).toBe("forbidden_staff_role");
  });
});

describe("SEC-107 — approve-signup-request EF wiring (source scans)", () => {
  it("imports and consults the shared decision core", () => {
    expect(EF_SOURCE).toContain('from "../_shared/role-assignment.ts"');
    expect(EF_SOURCE).toContain("canAssignRole(ctx.roles, newRole)");
  });

  it("rejects unknown role codes with 400 invalid_role (was: silent skip)", () => {
    expect(EF_SOURCE).toContain('"invalid_role"');
    expect(EF_SOURCE).toMatch(/if \(roleLookupError \|\| !newRole\)/);
    expect(EF_SOURCE).toContain('.select("id, code, is_staff_role")');
  });

  it("returns 403 role_assignment_forbidden for staff-role attempts", () => {
    expect(EF_SOURCE).toContain('"role_assignment_forbidden"');
    expect(EF_SOURCE).toContain("Only super_admin can assign staff roles");
  });

  it("audits denied override attempts as account_approval.role_override_denied", () => {
    expect(EF_SOURCE).toContain('"account_approval.role_override_denied"');
  });

  it("error-checks the revoke and insert writes (no fire-and-forget role writes)", () => {
    expect(EF_SOURCE).toContain('"role_revoke_failed"');
    expect(EF_SOURCE).toContain('"role_assign_failed"');
    // The old inline double-lookup (fetched the profile twice, unchecked)
    // is gone: exactly ONE explicit targetProfile lookup remains.
    expect(EF_SOURCE.match(/from\("user_profiles"\)\s*\.select\("id"\)\s*\.eq\("auth_user_id", approvalRequest\.auth_user_id\)/g)?.length).toBe(1);
  });

  it("the approve flow still resolves roles from the DB lookup — no client-trusted role names", () => {
    // The override must use newRole.id from the roles table, never a raw
    // body string, when inserting the role assignment.
    expect(EF_SOURCE).toContain("role_id: newRole.id");
    expect(EF_SOURCE).not.toContain("role_id: body.assign_role");
  });
});
