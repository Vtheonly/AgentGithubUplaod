/**
 * Route-level access guard tests (T-234 / RBAC-300 — 35th session).
 *
 * The AppShell previously guarded ONLY "/" (DASHBOARD_RESTRICTED_ROLES).
 * Direct URL navigation to /crm, /academics, /financials, /workflow,
 * /routing, /settings landed any signed-in staff role inside the full
 * administrative pages — the sidebar padlock was cosmetic.
 *
 * route-access.ts is the pure guard table: every protected route prefix
 * maps to the SAME FeatureNode requirement the sidebar evaluates, and
 * routeRedirectFor() returns "/personnel" when the session may not enter.
 * This keeps ONE source of truth for both the sidebar lock and the route
 * guard (defense in depth without a second permission map).
 */
import { describe, it, expect } from "vitest";
import { routeRedirectFor, PROTECTED_ROUTE_PREFIXES } from "../../core/rbac/route-access";
import { DEFAULT_ROLE_PERMISSIONS } from "../../core/rbac/permissions";
import { Role } from "../../core/rbac/roles";
import type { Session } from "../../core/rbac/session";

function sessionFor(role: Role): Session {
  const perms = DEFAULT_ROLE_PERMISSIONS[role];
  return {
    userId: `user-${role}`,
    tenantId: "tenant-1",
    homeTenantId: "tenant-1",
    email: `${role}@test.local`,
    displayName: role,
    avatarUrl: null,
    role,
    permissions: perms,
    accessToken: "token",
    refreshToken: "rt",
    expiresAt: Date.now() + 3600_000,
    locale: "fr",
  };
}

describe("RBAC-300 — route guards (route-access.ts)", () => {
  describe("guard table covers every gated navigation section", () => {
    it("protects dashboard, crm, academics, financials, workflow, routing, settings", () => {
      const prefixes = PROTECTED_ROUTE_PREFIXES.map((g) => g.prefix).sort();
      expect(prefixes).toEqual(
        ["/", "/academics", "/crm", "/financials", "/routing", "/settings", "/workflow"].sort(),
      );
    });
  });

  describe("operational roles are redirected away from administrative routes", () => {
    const operational: readonly Role[] = [
      Role.Teacher,
      Role.Buyer,
      Role.Driver,
      Role.WarehouseWorker,
      Role.Worker,
    ];
    const adminRoutes = ["/", "/crm", "/academics", "/financials"];

    for (const role of operational) {
      for (const route of adminRoutes) {
        it(`${role} → ${route} redirects to /personnel`, () => {
          expect(routeRedirectFor(sessionFor(role), route)).toBe("/personnel");
        });
      }
    }

    it("teacher → /academics/class/abc-123 (deep admin page) redirects", () => {
      expect(routeRedirectFor(sessionFor(Role.Teacher), "/academics/class/abc-123")).toBe("/personnel");
    });

    it("teacher → /academics/class/abc-123/roll-call redirects (the old leak path)", () => {
      expect(
        routeRedirectFor(sessionFor(Role.Teacher), "/academics/class/abc-123/roll-call"),
      ).toBe("/personnel");
    });
  });

  describe("administrative roles keep route access", () => {
    const administrative: readonly Role[] = [
      Role.SuperAdmin,
      Role.FinancialOfficer,
      Role.SupportStaff,
      Role.Manager,
    ];

    for (const role of administrative) {
      it(`${role} → /, /crm, /academics all allowed`, () => {
        const s = sessionFor(role);
        expect(routeRedirectFor(s, "/")).toBeNull();
        expect(routeRedirectFor(s, "/crm")).toBeNull();
        expect(routeRedirectFor(s, "/academics")).toBeNull();
        expect(routeRedirectFor(s, "/academics/class/x")).toBeNull();
      });
    }

    it("financial-data roles (server contract) keep /financials; manager is redirected (0019 payments_select parity)", () => {
      expect(routeRedirectFor(sessionFor(Role.SuperAdmin), "/financials")).toBeNull();
      expect(routeRedirectFor(sessionFor(Role.FinancialOfficer), "/financials")).toBeNull();
      expect(routeRedirectFor(sessionFor(Role.SupportStaff), "/financials")).toBeNull();
      expect(routeRedirectFor(sessionFor(Role.Manager), "/financials")).toBe("/personnel");
    });

    it("SuperAdmin keeps /workflow, /settings, /routing", () => {
      const s = sessionFor(Role.SuperAdmin);
      expect(routeRedirectFor(s, "/workflow")).toBeNull();
      expect(routeRedirectFor(s, "/settings")).toBeNull();
      expect(routeRedirectFor(s, "/routing")).toBeNull();
    });

    it("FinancialOfficer keeps /workflow + /settings (ViewWorkflowRuns + ViewAuditLog)", () => {
      const s = sessionFor(Role.FinancialOfficer);
      expect(routeRedirectFor(s, "/workflow")).toBeNull();
      expect(routeRedirectFor(s, "/settings")).toBeNull();
    });
  });

  describe("unguarded routes stay accessible to every staff role", () => {
    it("/personnel and /profile are never redirected for any staff role", () => {
      const roles: readonly Role[] = [
        Role.SuperAdmin,
        Role.FinancialOfficer,
        Role.SupportStaff,
        Role.Manager,
        Role.Teacher,
        Role.Buyer,
        Role.Driver,
        Role.WarehouseWorker,
        Role.Worker,
      ];
      for (const role of roles) {
        const s = sessionFor(role);
        expect(routeRedirectFor(s, "/personnel")).toBeNull();
        expect(routeRedirectFor(s, "/personnel/my-space")).toBeNull();
        expect(routeRedirectFor(s, "/profile")).toBeNull();
      }
    });
  });

  describe("driver keeps the driver-mode route", () => {
    it("driver → /routing allowed, teacher → /routing redirected", () => {
      expect(routeRedirectFor(sessionFor(Role.Driver), "/routing")).toBeNull();
      expect(routeRedirectFor(sessionFor(Role.Teacher), "/routing")).toBe("/personnel");
    });
  });

  describe("unauthenticated sessions are always redirected", () => {
    it("null session → every protected route redirects to /personnel", () => {
      for (const route of ["/", "/crm", "/academics", "/financials", "/workflow", "/settings"]) {
        expect(routeRedirectFor(null, route)).toBe("/personnel");
      }
    });
  });

  describe("prefix matching is exact for the dashboard root", () => {
    it("'/' matches ONLY the exact root — other top-level paths are not dashboard-gated", () => {
      // /personnel must not be caught by the "/" prefix matcher.
      expect(routeRedirectFor(sessionFor(Role.Teacher), "/personnel")).toBeNull();
      expect(routeRedirectFor(sessionFor(Role.Teacher), "/profile")).toBeNull();
    });
  });
});
