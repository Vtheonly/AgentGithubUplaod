/**
 * Session — the authenticated user context.
 *
 * Sessions are immutable; modifying session state requires creating a new
 * Session object. Permissions are precomputed at sign-in time so feature
 * gating never re-queries the role map.
 */
import type { Permission } from "./permissions";
import { Role } from "./roles";

export interface Session {
  readonly userId: string;
  readonly tenantId: string;
  readonly email: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly role: Role;
  readonly permissions: ReadonlySet<Permission>;
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly expiresAt: number;
  readonly locale: "fr" | "ar" | "en";
}

export function can(session: Session | null, permission: Permission): boolean {
  if (!session) return false;
  return session.permissions.has(permission);
}

export function hasRole(session: Session | null, role: Role): boolean {
  return session?.role === role;
}

export function hasAnyRole(session: Session | null, ...roles: Role[]): boolean {
  return session ? roles.includes(session.role) : false;
}

export function isExpired(session: Session | null, now: number = Date.now()): boolean {
  if (!session) return true;
  return now > session.expiresAt - 60_000;
}
