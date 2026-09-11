// ============================================================================
// FILE: src/core/rbac/route-access.ts
// ============================================================================
import type { Session } from "./session";
import { isSuperAdmin } from "./session";
import type { FeatureNode } from "./feature-registry";
import { evaluate, alwaysOnFlagProvider } from "./feature-gate";
import {
  Dashboard,
  Crm,
  Academics,
  Financials,
  WorkflowAutomation,
  Routing,
  Settings,
} from "./feature-registry";

export const ROUTE_GUARD_REDIRECT = "/personnel";

export interface RouteGate {
  readonly prefix: string;
  readonly node: FeatureNode;
}

export const PROTECTED_ROUTE_PREFIXES: readonly RouteGate[] = [
  { prefix: "/", node: Dashboard },
  { prefix: "/crm", node: Crm },
  { prefix: "/academics", node: Academics },
  { prefix: "/financials", node: Financials },
  { prefix: "/workflow", node: WorkflowAutomation },
  { prefix: "/routing", node: Routing },
  { prefix: "/settings", node: Settings },
];

export function routeGateFor(pathname: string): RouteGate | null {
  if (pathname === "/") {
    return PROTECTED_ROUTE_PREFIXES[0];
  }
  return (
    PROTECTED_ROUTE_PREFIXES.find(
      (g) => g.prefix !== "/" && pathname.startsWith(g.prefix),
    ) ?? null
  );
}

export function routeRedirectFor(
  session: Session | null,
  pathname: string,
): string | null {
  if (isSuperAdmin(session)) return null;
  const gate = routeGateFor(pathname);
  if (!gate) return null;
  const state = evaluate(gate.node.requirement, {
    session,
    flags: alwaysOnFlagProvider,
  });
  return state.kind === "enabled" ? null : ROUTE_GUARD_REDIRECT;
}
