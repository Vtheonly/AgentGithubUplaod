/**
 * T-313 (REG-006) — session semantics after the 9e70078 shallow-fix redo.
 *
 * Pins the RBAC core contracts the unregistered patch broke or endangered:
 *
 *   1. `isSuperAdmin` recognizes the SuperAdmin session EXACTLY by the
 *      canonical `Role.SuperAdmin` enum value. The 9e70078 version also
 *      matched any role string normalizing to "admin" — a role that exists
 *      in NO enum and NO wire protocol (`mapRoleCode` maps unknown codes to
 *      SupportStaff), i.e. a privilege-escalation surface with zero
 *      legitimate producers. Canonical-only recognition means every session
 *      producer (buildSession, loadSession) is the single place where the
 *      wire code becomes the enum.
 *
 *   2. `can()` reads the permission Set — it does NOT tolerate arrays and
 *      does NOT bypass for SuperAdmin. The SuperAdmin completeness is a
 *      PRODUCER invariant: buildSession (T-266/AI-309) and
 *      ensureSuperAdminPermissions/loadSession stamp the full permission
 *      set at construction, so a correctly-produced SuperAdmin session
 *      passes every `can()` check through ordinary Set membership.
 *      Bypassing inside `can()` would mask a producer regression (a
 *      SuperAdmin session with a broken permission stamp would still pass
 *      gates) — the exact "fail loud at the boundary" doctrine of the
 *      Result contract.
 *
 *   3. `hasRole` / `hasAnyRole` keep the SuperAdmin bypass (plan §02.07:
 *      unrestricted) — these are ROLE questions, not permission questions.
 */
import { describe, expect, it } from "vitest";
import { can, hasAnyRole, hasRole, isSuperAdmin } from "../../core/rbac/session";
import { Permission } from "../../core/rbac/permissions";
import { Role } from "../../core/rbac/roles";
import type { Session } from "../../core/rbac/session";

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    userId: "usr-1",
    tenantId: "00000000-0000-0000-0000-000000000001",
    homeTenantId: "00000000-0000-0000-0000-000000000001",
    email: "staff@example.com",
    displayName: "Staff",
    avatarUrl: null,
    role: Role.Teacher,
    permissions: new Set<Permission>([Permission.EnterGrades]),
    accessToken: "tok",
    refreshToken: null,
    expiresAt: Date.now() + 3_600_000,
    locale: "fr",
    ...overrides,
  };
}

describe("T-313 — isSuperAdmin: canonical role only", () => {
  it("recognizes the canonical Role.SuperAdmin value", () => {
    expect(isSuperAdmin(makeSession({ role: Role.SuperAdmin }))).toBe(true);
  });

  it("does NOT recognize loose role-string variants (the 9e70078 escalation surface)", () => {
    // The 9e70078 isSuperAdmin matched rawRole "admin" after
    // lowercase + delimiter stripping — minting full SuperAdmin bypass
    // for a role that no producer can legitimately emit.
    for (const bogus of ["admin", "superadmin", "SuperAdmin", "super-admin", "super admin", "ADMIN"]) {
      const s = makeSession({ role: bogus as unknown as Role });
      expect(isSuperAdmin(s), `role "${bogus}" must NOT be SuperAdmin`).toBe(false);
    }
  });

  it("returns false for null/undefined sessions", () => {
    expect(isSuperAdmin(null)).toBe(false);
    expect(isSuperAdmin(undefined)).toBe(false);
  });
});

describe("T-313 — can(): Set membership, no bypass, no array tolerance", () => {
  it("reads ordinary Set membership for a non-SuperAdmin session", () => {
    const s = makeSession();
    expect(can(s, Permission.EnterGrades)).toBe(true);
    expect(can(s, Permission.ManageClasses)).toBe(false);
  });

  it("passes every check for a CORRECTLY-PRODUCED SuperAdmin session (full stamp)", () => {
    // The producer invariant (buildSession T-266/AI-309 +
    // ensureSuperAdminPermissions): the Set carries ALL permissions.
    const s = makeSession({
      role: Role.SuperAdmin,
      permissions: new Set<Permission>(Object.values(Permission)),
    });
    for (const p of Object.values(Permission)) {
      expect(can(s, p), `SuperAdmin must hold ${p}`).toBe(true);
    }
  });

  it("does NOT silently bypass for a SuperAdmin session with a broken permission stamp", () => {
    // Fail loud at the producer: if a future regression ships a SuperAdmin
    // session WITHOUT the full stamp, can() must surface it (return false),
    // not paper over it. The repair belongs in buildSession /
    // ensureSuperAdminPermissions / loadSession — the tested producers.
    const s = makeSession({ role: Role.SuperAdmin, permissions: new Set<Permission>() });
    expect(can(s, Permission.ManageClasses)).toBe(false);
  });

  it("does not tolerate array-shaped permissions (fail loud at the producer instead)", () => {
    // The 9e70078 can() had an Array.isArray branch that silently accepted
    // degraded sessions. The Session contract is ReadonlySet; an array
    // reaching this function is a producer bug and must throw, not pass.
    const degraded = makeSession({
      permissions: [Permission.EnterGrades] as unknown as ReadonlySet<Permission>,
    });
    expect(() => can(degraded, Permission.EnterGrades)).toThrow();
  });

  it("returns false for null sessions", () => {
    expect(can(null, Permission.EnterGrades)).toBe(false);
  });
});

describe("T-313 — hasRole/hasAnyRole keep the SuperAdmin bypass", () => {
  it("SuperAdmin matches any single role check", () => {
    const s = makeSession({ role: Role.SuperAdmin });
    expect(hasRole(s, Role.Manager)).toBe(true);
    expect(hasRole(s, Role.Teacher)).toBe(true);
  });

  it("SuperAdmin matches any role list", () => {
    const s = makeSession({ role: Role.SuperAdmin });
    expect(hasAnyRole(s, Role.Manager, Role.Buyer)).toBe(true);
  });

  it("ordinary roles match strictly", () => {
    const s = makeSession({ role: Role.Manager });
    expect(hasRole(s, Role.Manager)).toBe(true);
    expect(hasRole(s, Role.Teacher)).toBe(false);
    expect(hasAnyRole(s, Role.Manager, Role.Buyer)).toBe(true);
    expect(hasAnyRole(s, Role.Teacher, Role.Buyer)).toBe(false);
  });
});
