// ============================================================================
// FILE: src/core/rbac/session.ts
// ============================================================================
/**
 * Session — the authenticated user context.
 *
 * Sessions are immutable; modifying session state requires creating a new
 * Session object. Permissions are precomputed at sign-in time so feature
 * gating never re-queries the role map.
 *
 * SuperAdmin invariant (T-313 / REG-006): a SuperAdmin session is recognized
 * EXACTLY by the canonical `Role.SuperAdmin` value. Every session producer
 * already guarantees it — `mapRoleCode` (supabase-auth-repository.ts) maps
 * the wire code `super_admin` to the enum, `loadSession` re-hydrates the
 * persisted value, and `ensureSuperAdminPermissions` stamps the full
 * permission set at construction. Gate functions therefore bypass on that
 * ONE value; matching loose strings ("admin", "superadmin", …) here would
 * mint SuperAdmin privileges for roles that exist in no enum and no wire
 * protocol — the 9e70078 "admin" conflation was exactly that surface.
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

/**
 * True only for the canonical SuperAdmin role. Kept as a named predicate so
 * the bypass sites (can / hasRole / hasAnyRole / feature-gate / route-access)
 * share ONE definition of the invariant.
 */
export function isSuperAdmin(session: Session | null | undefined): boolean {
  return session?.role === Role.SuperAdmin;
}

export function can(
  session: Session | null | undefined,
  permission: Permission,
): boolean {
  if (!session) return false;
  // permissions is ALWAYS a Set at every producer (buildSession constructs
  // it; loadSession re-hydrates it). Tolerating arrays here would silently
  // mask a producer regression instead of failing loud at the boundary.
  return session.permissions.has(permission);
}

export function hasRole(
  session: Session | null | undefined,
  role: Role,
): boolean {
  if (!session) return false;
  // SuperAdmin matches any role check (plan §02.07: unrestricted).
  if (isSuperAdmin(session)) return true;
  return session.role === role;
}

export function hasAnyRole(
  session: Session | null | undefined,
  ...roles: Role[]
): boolean {
  if (!session) return false;
  if (isSuperAdmin(session)) return true;
  return roles.includes(session.role);
}

export function isExpired(
  session: Session | null,
  now: number = Date.now(),
): boolean {
  if (!session) return true;
  return now > session.expiresAt - 60_000;
}
