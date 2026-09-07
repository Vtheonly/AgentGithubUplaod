/**
 * Route-level access guard (T-234 / RBAC-300 — 35th session).
 *
 * The AppShell previously guarded ONLY the dashboard root "/"
 * (DASHBOARD_RESTRICTED_ROLES). Any signed-in role could reach /crm,
 * /academics, /financials, /workflow, /routing or /settings by typing
 * the URL — the sidebar padlock was cosmetic (the audit's "Severe Gap").
 *
 * This table maps every protected route prefix to the SAME FeatureNode
 * the sidebar evaluates, so the route guard and the sidebar lock share
 * ONE source of truth (the feature-registry). A session that fails the
 * node's requirement is redirected to /personnel — the operational
 * staff's dedicated workspace.
 *
 * Pure functions only — safe to unit-test without React.
 */
import type { Session } from "./session";
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

/** The fallback destination for sessions that fail a route gate. */
export const ROUTE_GUARD_REDIRECT = "/personnel";

export interface RouteGate {
  /** Route path prefix this gate guards ("/" matches the exact root only). */
  readonly prefix: string;
  /** The feature node whose requirement protects this route (shared with the sidebar). */
  readonly node: FeatureNode;
}

/**
 * Every gated navigation section, in AppShell route order.
 * "/personnel" (ViewPersonnel — every staff role holds it) and "/profile"
 * are deliberately NOT gated: they are every staff member's own workspace.
 */
export const PROTECTED_ROUTE_PREFIXES: readonly RouteGate[] = [
  { prefix: "/", node: Dashboard },
  { prefix: "/crm", node: Crm },
  { prefix: "/academics", node: Academics },
  { prefix: "/financials", node: Financials },
  { prefix: "/workflow", node: WorkflowAutomation },
  { prefix: "/routing", node: Routing },
  { prefix: "/settings", node: Settings },
];

/**
 * Resolve the route gate for a pathname.
 *
 * Matching rule: "/" matches the exact root ONLY (a bare prefix match
 * would swallow every route in the app); every other prefix matches on
 * startsWith so deep links (/academics/class/:id/roll-call) inherit
 * their section's gate.
 */
export function routeGateFor(pathname: string): RouteGate | null {
  if (pathname === "/") {
    return PROTECTED_ROUTE_PREFIXES[0]; // the Dashboard gate
  }
  return (
    PROTECTED_ROUTE_PREFIXES.find(
      (g) => g.prefix !== "/" && pathname.startsWith(g.prefix),
    ) ?? null
  );
}

/**
 * Returns the redirect target when the session may NOT enter `pathname`,
 * or null when access is allowed (or the route is not protected).
 *
 * Unauthenticated sessions fail every gate (evaluate → not_authenticated),
 * matching the shell's existing behavior of never rendering an
 * administrative page without a session.
 */
export function routeRedirectFor(session: Session | null, pathname: string): string | null {
  const gate = routeGateFor(pathname);
  if (!gate) return null;
  const state = evaluate(gate.node.requirement, { session, flags: alwaysOnFlagProvider });
  return state.kind === "enabled" ? null : ROUTE_GUARD_REDIRECT;
}
