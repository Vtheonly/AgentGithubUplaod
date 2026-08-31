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
  /**
   * T-053 (TENANT-103): the WORKING tenant — every query/audit/write runs in
   * this context. Null ONLY for a global admin (profile tenant_id NULL per
   * migration 0002) who has not picked a tenant yet: reads return empty and
   * writes fail loud (requireTenantId) until they choose one.
   */
  readonly tenantId: string | null;
  /**
   * T-053: the profile's HOME tenant (null = global admin). Only the tenant
   * switcher reads this — it is shown exactly when homeTenantId is null.
   */
  readonly homeTenantId?: string | null;
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
