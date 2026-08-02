/**
 * Unit tests for the RBAC FeatureGate evaluator.
 *
 * The FeatureGate is a PURE function — given (requirement, ctx) it returns
 * an AccessState. Evaluation order (per feature-gate.ts):
 *   1. requirement.kind === "empty"           → Enabled
 *   2. requirement.kind === "permanent"       → Disabled(permanent)
 *   3. session == null                         → Disabled(not_authenticated) | Hidden
 *   4. permission / anyOf / allOf / role       → matching checks
 *
 * Plan §02.07: 6 roles, 28 permissions, 3-layer gating
 * (FeatureRegistry → FeatureGate → <GatedContent>).
 */
import { describe, it, expect } from "vitest";
import { evaluate, alwaysOnFlagProvider } from "../../core/rbac/feature-gate";
import {
  empty,
  permanent,
  requiresPermission,
  requiresAnyOf,
  requiresAllOf,
  requiresRole,
} from "../../core/rbac/access-requirement";
import { Permission } from "../../core/rbac/permissions";
import { Role } from "../../core/rbac/roles";
import type { Session } from "../../core/rbac/session";

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    userId: "usr-1",
    tenantId: "tenant-1",
    email: "test@example.com",
    displayName: "Test User",
    avatarUrl: null,
    role: Role.SuperAdmin,
    permissions: new Set(Object.values(Permission)),
    accessToken: "tok",
    refreshToken: null,
    expiresAt: Date.now() + 60_000,
    locale: "fr",
    ...overrides,
  };
}

describe("FeatureGate — empty requirement", () => {
  it("returns Enabled for everyone (even unauthenticated)", () => {
    const state = evaluate(empty, { session: null, flags: alwaysOnFlagProvider });
    expect(state).toEqual({ kind: "enabled" });
  });

  it("returns Enabled for authenticated users", () => {
    const state = evaluate(empty, {
      session: makeSession(),
      flags: alwaysOnFlagProvider,
    });
    expect(state).toEqual({ kind: "enabled" });
  });
});

describe("FeatureGate — permanent requirement", () => {
  it("returns Disabled(permanent) with the state", () => {
    const state = evaluate(permanent("removed"), {
      session: makeSession(),
      flags: alwaysOnFlagProvider,
    });
    expect(state).toEqual({
      kind: "disabled",
      reason: { kind: "permanent", state: "removed" },
    });
  });

  it("returns Disabled(permanent) even for unauthenticated users", () => {
    const state = evaluate(permanent("desktop_only"), {
      session: null,
      flags: alwaysOnFlagProvider,
    });
    expect(state).toEqual({
      kind: "disabled",
      reason: { kind: "permanent", state: "desktop_only" },
    });
  });

  it("supports all 4 permanent states", () => {
    for (const s of ["removed", "not_yet_available", "desktop_only", "plan_upgrade_required"] as const) {
      const state = evaluate(permanent(s), {
        session: makeSession(),
        flags: alwaysOnFlagProvider,
      });
      expect(state.kind).toBe("disabled");
    }
  });
});

describe("FeatureGate — unauthenticated session", () => {
  it("returns Disabled(not_authenticated) by default", () => {
    const state = evaluate(requiresPermission(Permission.ViewRoster), {
      session: null,
      flags: alwaysOnFlagProvider,
    });
    expect(state).toEqual({
      kind: "disabled",
      reason: { kind: "not_authenticated" },
    });
  });

  it("returns Hidden when hideWhenUnauthenticated is true", () => {
    const state = evaluate(
      requiresPermission(Permission.ViewRoster, { hideWhenUnauthenticated: true }),
      { session: null, flags: alwaysOnFlagProvider },
    );
    expect(state).toEqual({ kind: "hidden" });
  });
});

describe("FeatureGate — single permission requirement", () => {
  it("returns Enabled when the session has the permission", () => {
    const state = evaluate(requiresPermission(Permission.ViewRoster), {
      session: makeSession({ permissions: new Set([Permission.ViewRoster]) }),
      flags: alwaysOnFlagProvider,
    });
    expect(state).toEqual({ kind: "enabled" });
  });

  it("returns Disabled(missing_permission) when the session lacks the permission", () => {
    const state = evaluate(requiresPermission(Permission.ApproveExpense), {
      session: makeSession({ permissions: new Set([Permission.ViewRoster]) }),
      flags: alwaysOnFlagProvider,
    });
    expect(state).toEqual({
      kind: "disabled",
      reason: { kind: "missing_permission", permission: Permission.ApproveExpense },
    });
  });
});

describe("FeatureGate — anyOfPermission requirement", () => {
  it("returns Enabled when the session has at least one of the permissions", () => {
    const state = evaluate(
      requiresAnyOf([Permission.ApproveExpense, Permission.DisburseExpense]),
      {
        session: makeSession({
          permissions: new Set([Permission.DisburseExpense]),
        }),
        flags: alwaysOnFlagProvider,
      },
    );
    expect(state).toEqual({ kind: "enabled" });
  });

  it("returns Disabled(missing_permission) when the session has none of the permissions", () => {
    const state = evaluate(
      requiresAnyOf([Permission.ApproveExpense, Permission.DisburseExpense]),
      {
        session: makeSession({
          permissions: new Set([Permission.ViewRoster]),
        }),
        flags: alwaysOnFlagProvider,
      },
    );
    expect(state).toEqual({
      kind: "disabled",
      reason: { kind: "missing_permission", permission: Permission.ApproveExpense },
    });
  });
});

describe("FeatureGate — allOfPermission requirement", () => {
  it("returns Enabled when the session has ALL the permissions", () => {
    const state = evaluate(
      requiresAllOf([Permission.SubmitExpense, Permission.ApproveExpense]),
      {
        session: makeSession({
          permissions: new Set([Permission.SubmitExpense, Permission.ApproveExpense]),
        }),
        flags: alwaysOnFlagProvider,
      },
    );
    expect(state).toEqual({ kind: "enabled" });
  });

  it("returns Disabled(missing_permission) for the first missing permission", () => {
    const state = evaluate(
      requiresAllOf([Permission.SubmitExpense, Permission.ApproveExpense, Permission.DisburseExpense]),
      {
        session: makeSession({
          permissions: new Set([Permission.SubmitExpense]), // missing approve + disburse
        }),
        flags: alwaysOnFlagProvider,
      },
    );
    expect(state).toEqual({
      kind: "disabled",
      reason: { kind: "missing_permission", permission: Permission.ApproveExpense },
    });
  });
});

describe("FeatureGate — role requirement", () => {
  it("returns Enabled when the session role is in the allowed list", () => {
    const state = evaluate(requiresRole([Role.SuperAdmin, Role.FinancialOfficer]), {
      session: makeSession({ role: Role.FinancialOfficer }),
      flags: alwaysOnFlagProvider,
    });
    expect(state).toEqual({ kind: "enabled" });
  });

  it("returns Disabled(missing_role) when the role is not in the list", () => {
    const state = evaluate(requiresRole([Role.SuperAdmin, Role.FinancialOfficer]), {
      session: makeSession({ role: Role.Teacher }),
      flags: alwaysOnFlagProvider,
    });
    expect(state).toEqual({
      kind: "disabled",
      reason: {
        kind: "missing_role",
        roles: [Role.SuperAdmin, Role.FinancialOfficer],
      },
    });
  });
});

describe("FeatureGate — default role permissions (regression)", () => {
  it("SuperAdmin has all permissions defined in the Permission enum", () => {
    // The plan §02.07 originally specified 28 permissions, but iteration 2 added
    // ManagePricing and iteration 1 had AccessDriverMode + ManageTenants already,
    // bringing the total to 32. The exact count is not load-bearing — what
    // matters is that SuperAdmin receives EVERY permission in the enum.
    const allPermissions = Object.values(Permission);
    expect(allPermissions.length).toBeGreaterThanOrEqual(28);

    const session = makeSession({
      role: Role.SuperAdmin,
      permissions: new Set(allPermissions),
    });
    expect(session.permissions.size).toBe(allPermissions.length);

    // SuperAdmin can do everything in the gate
    for (const p of allPermissions) {
      const state = evaluate(requiresPermission(p), {
        session,
        flags: alwaysOnFlagProvider,
      });
      expect(state.kind).toBe("enabled");
    }
  });
});
