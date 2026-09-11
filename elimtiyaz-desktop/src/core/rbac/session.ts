// ============================================================================
// FILE: src/core/rbac/session.ts
// ============================================================================
/**
 * Session — the authenticated user context.
 *
 * Standardizes super-admin privilege resolution so that SuperAdmin sessions
 * unconditionally bypass role/permission gating everywhere in the application.
 */
import type { Permission } from "./permissions";
import { Role } from "./roles";

export interface Session {
  readonly userId: string;
  readonly tenantId: string | null;
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
 * Checks whether a session holds SuperAdmin privileges across all role name variants.
 */
export function isSuperAdmin(session: Session | null | undefined): boolean {
  if (!session) return false;
  const rawRole = ((session.role as unknown as string) || "")
    .toLowerCase()
    .replace(/[-_\s]/g, "");
  return rawRole === "superadmin" || rawRole === "admin";
}

/**
 * Evaluates whether a session holds a specific permission.
 * SuperAdmin unconditionally returns `true`.
 */
export function can(
  session: Session | null | undefined,
  permission: Permission,
): boolean {
  if (!session) return false;
  if (isSuperAdmin(session)) return true;
  if (!session.permissions) return false;
  if (session.permissions instanceof Set) {
    return session.permissions.has(permission);
  }
  if (Array.isArray(session.permissions)) {
    return (session.permissions as unknown as string[]).includes(permission);
  }
  return false;
}

/**
 * Checks if a session matches a specific role. SuperAdmin matches any role check.
 */
export function hasRole(
  session: Session | null | undefined,
  role: Role,
): boolean {
  if (!session) return false;
  if (isSuperAdmin(session)) return true;
  return session.role === role;
}

/**
 * Checks if a session matches any of the specified roles. SuperAdmin returns `true`.
 */
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
