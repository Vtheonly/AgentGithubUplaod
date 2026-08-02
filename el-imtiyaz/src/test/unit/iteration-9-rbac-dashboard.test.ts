/**
 * Iteration 9 — RBAC dashboard access tests.
 *
 * Verifies spec §1.1: "Teachers and non-administrative staff must be
 * completely restricted from accessing the main administrative/financial
 * dashboard (/)."
 */
import { describe, it, expect } from "vitest";
import { Dashboard } from "../../core/rbac/feature-registry";
import { evaluate, alwaysOnFlagProvider } from "../../core/rbac/feature-gate";
import { Role } from "../../core/rbac/roles";
import type { Session } from "../../core/rbac/session";

function sessionFor(role: Role): Session {
  return {
    userId: `usr-${role}-001`,
    tenantId: "tenant-test",
    email: `${role}@test.dz`,
    displayName: "Test User",
    avatarUrl: null,
    role,
    permissions: new Set(),
    accessToken: "test-token",
    refreshToken: null,
    expiresAt: Date.now() + 86_400_000,
    locale: "fr",
  };
}

function evaluateFor(role: Role) {
  return evaluate(Dashboard.requirement, {
    session: sessionFor(role),
    flags: alwaysOnFlagProvider,
  });
}

describe("Iteration 9 — RBAC dashboard access (spec §1.1)", () => {
  it("allows SuperAdmin to access the dashboard", () => {
    const result = evaluateFor(Role.SuperAdmin);
    expect(result.kind).toBe("enabled");
  });

  it("allows FinancialOfficer to access the dashboard", () => {
    const result = evaluateFor(Role.FinancialOfficer);
    expect(result.kind).toBe("enabled");
  });

  it("allows SupportStaff to access the dashboard", () => {
    const result = evaluateFor(Role.SupportStaff);
    expect(result.kind).toBe("enabled");
  });

  it("allows Manager to access the dashboard", () => {
    const result = evaluateFor(Role.Manager);
    expect(result.kind).toBe("enabled");
  });

  it("restricts Teacher from accessing the dashboard", () => {
    const result = evaluateFor(Role.Teacher);
    expect(result.kind).not.toBe("enabled");
  });

  it("restricts Buyer from accessing the dashboard", () => {
    const result = evaluateFor(Role.Buyer);
    expect(result.kind).not.toBe("enabled");
  });

  it("restricts Driver from accessing the dashboard", () => {
    const result = evaluateFor(Role.Driver);
    expect(result.kind).not.toBe("enabled");
  });

  it("restricts WarehouseWorker from accessing the dashboard", () => {
    const result = evaluateFor(Role.WarehouseWorker);
    expect(result.kind).not.toBe("enabled");
  });

  it("restricts Worker from accessing the dashboard", () => {
    const result = evaluateFor(Role.Worker);
    expect(result.kind).not.toBe("enabled");
  });

  it("restricts Parent from accessing the dashboard", () => {
    const result = evaluateFor(Role.Parent);
    expect(result.kind).not.toBe("enabled");
  });

  it("restricts Student from accessing the dashboard", () => {
    const result = evaluateFor(Role.Student);
    expect(result.kind).not.toBe("enabled");
  });
});
