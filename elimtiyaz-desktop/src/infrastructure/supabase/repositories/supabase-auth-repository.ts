/**
 * SupabaseAuthRepository — implements AuthRepository against Supabase Auth.
 *
 * Plan §12 (Authentication & Sessions):
 *   - Staff sign in via Supabase Auth (email/password)
 *   - Parents sign in via Google OAuth + 6-7 digit activation code
 *   - JWT tokens drive RLS filtering
 *   - Password changes revoke all sessions (plan §12.04)
 *   - service_role key NEVER used in client
 */

import type { Session as SupabaseAuthSession, SupabaseClient, User as SupabaseUser } from "@supabase/supabase-js";
import type { AuthRepository } from "../../../domain/repository/repository";
import type { Session } from "../../../core/rbac/session";
import { Role } from "../../../core/rbac/roles";
import { Permission } from "../../../core/rbac/permissions";
import { Ok, Err, type Result } from "../../../core/result";
import { Errors } from "../../../core/app-error";
import { supabaseErrorToAppError } from "../supabase-client";

/**
 * Map a role code string from the database to the Role enum.
 * Falls back to SupportStaff if the code is unknown.
 */
function mapRoleCode(code: string): Role {
  const mapping: Record<string, Role> = {
    super_admin: Role.SuperAdmin,
    financial_officer: Role.FinancialOfficer,
    teacher: Role.Teacher,
    support_staff: Role.SupportStaff,
    manager: Role.Manager,
    buyer: Role.Buyer,
    driver: Role.Driver,
    warehouse_worker: Role.WarehouseWorker,
    worker: Role.Worker,
    parent: Role.Parent,
    student: Role.Student,
  };
  return mapping[code] ?? Role.SupportStaff;
}

/**
 * Map a permission code string from the database to the Permission enum.
 * Unknown codes are silently dropped (defensive).
 */
function mapPermissionCodes(codes: string[]): ReadonlySet<Permission> {
  const result = new Set<Permission>();
  // The Permission enum uses PascalCase (ViewRoster, EnterGrades, etc.)
  // while DB codes are snake_case (view_roster, enter_grades, etc.)
  for (const code of codes) {
    const pascal = code
      .split("_")
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
      .join("");
    if (pascal in Permission) {
      result.add((Permission as unknown as Record<string, Permission>)[pascal]);
    }
  }
  return result;
}

export class SupabaseAuthRepository implements AuthRepository {
  constructor(private readonly client: SupabaseClient) {}

  async signIn(email: string, password: string): Promise<Result<Session>> {
    const { data, error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) {
      return Err(supabaseErrorToAppError(error));
    }
    if (!data.user || !data.session) {
      return Err(Errors.unauthorized("No user returned from Supabase"));
    }

    return this.buildSession(data.user, data.session);
  }

  /**
   * Build the domain Session from a live Supabase auth session — the ONE
   * shared path for signIn AND refreshSession (T-185 / AUTH-301).
   *
   * AUTH-301 history: refreshSession used to "rebuild" the session by
   * delegating to `this.signIn(user.email, "")` — a password grant with an
   * EMPTY password, which Supabase rejects with 400 on EVERY refresh. The
   * auth-provider then logged "Session refresh failed, clearing expired
   * session" and logged the user out, even though the SDK's refresh-token
   * grant had just SUCCEEDED (the owner's 2026-09-05 console paste:
   * `token?grant_type=password → 400` right after "Stored session expired,
   * attempting token refresh..."). Both callers now build the Session here
   * without any second credential grant.
   */
  private async buildSession(
    user: SupabaseUser,
    authSession: SupabaseAuthSession,
  ): Promise<Result<Session>> {
    // Fetch the user profile to build the Session
    const { data: profile, error: profileError } = await this.client
      .from("user_profiles")
      .select("id, tenant_id, email, display_name, status, avatar_url")
      .eq("auth_user_id", user.id)
      .single();

    if (profileError) {
      return Err(supabaseErrorToAppError(profileError));
    }
    if (!profile) {
      return Err(Errors.notFound("User profile", "current_user"));
    }
    if (profile.status === "pending") {
      return Err(Errors.forbidden("Your account is pending administrator approval. Please try again later."));
    }
    if (profile.status === "suspended") {
      return Err(Errors.forbidden("Your account has been suspended. Please contact your administrator."));
    }

    // Fetch roles + permissions
    const { data: rolesData } = await this.client.rpc("current_user_roles");
    const roleCodes: string[] = rolesData ?? [];
    const primaryRole = roleCodes[0] ? mapRoleCode(roleCodes[0]) : Role.SupportStaff;

    const { data: permsData } = await this.client.rpc("current_user_permissions");
    const permissions = mapPermissionCodes(permsData ?? []);

    const session: Session = {
      userId: profile.id,
      // T-053 (TENANT-103): a global admin's profile has tenant_id NULL — store
      // the honest null (the tenant switcher provides the working context)
      // instead of "" (which getTenantId() previously turned into the DEMO
      // tenant UUID — the TENANT-103 defect).
      tenantId: profile.tenant_id ?? null,
      homeTenantId: profile.tenant_id ?? null,
      email: profile.email,
      displayName: profile.display_name ?? profile.email,
      avatarUrl: profile.avatar_url ?? null,
      role: primaryRole,
      permissions,
      accessToken: authSession.access_token,
      refreshToken: authSession.refresh_token ?? null,
      expiresAt: (authSession.expires_at ?? 0) * 1000,  // seconds → milliseconds
      locale: "fr",
    };

    return Ok(session);
  }

  async signOut(): Promise<Result<void>> {
    const { error } = await this.client.auth.signOut();
    if (error) {
      return Err(supabaseErrorToAppError(error));
    }
    return Ok(undefined);
  }

  async refreshSession(): Promise<Result<Session>> {
    const { data, error } = await this.client.auth.refreshSession();
    if (error) {
      return Err(supabaseErrorToAppError(error));
    }
    if (!data.user || !data.session) {
      return Err(Errors.unauthorized("No active session to refresh"));
    }

    // T-185 (AUTH-301): rebuild the domain Session directly from the
    // refreshed auth session — the previous delegation (signIn with an
    // EMPTY password) issued a password grant that 400'd on every refresh →
    // "Session refresh failed, clearing expired session". Never re-grant
    // credentials to rebuild a session the SDK already refreshed.
    return this.buildSession(data.user, data.session);
  }

  /**
   * Plan §12.04: Password governance.
   * Re-authenticates the user (via Supabase's verifyPassword) and then
   * calls updateUser with the new password. Supabase automatically
   * revokes all sessions for the user when the password is changed.
   */
  async changePassword(currentPassword: string, newPassword: string): Promise<Result<void>> {
    // Validate new password strength
    if (newPassword.length < 8) {
      return Err(Errors.validation("Password must be at least 8 characters long"));
    }
    if (!/[a-z]/.test(newPassword)) {
      return Err(Errors.validation("Password must contain at least one lowercase letter"));
    }
    if (!/[A-Z]/.test(newPassword)) {
      return Err(Errors.validation("Password must contain at least one uppercase letter"));
    }
    if (!/\d/.test(newPassword)) {
      return Err(Errors.validation("Password must contain at least one digit"));
    }

    // Re-authenticate (Supabase doesn't expose verifyPassword directly,
    // but signInWithPassword with the current password serves the same purpose)
    const { data: session } = await this.client.auth.getSession();
    if (!session.session) {
      return Err(Errors.unauthorized("No active session"));
    }

    const email = session.session.user.email;
    if (!email) {
      return Err(Errors.validation("User has no email — cannot re-authenticate"));
    }

    const { error: reauthError } = await this.client.auth.signInWithPassword({
      email,
      password: currentPassword,
    });
    if (reauthError) {
      return Err(Errors.unauthorized("Current password is incorrect"));
    }

    // Update the password — Supabase revokes all other sessions automatically
    const { error: updateError } = await this.client.auth.updateUser({ password: newPassword });
    if (updateError) {
      return Err(supabaseErrorToAppError(updateError));
    }

    // Sign out everywhere (force re-login on all devices)
    await this.client.auth.signOut({ scope: "global" });

    return Ok(undefined);
  }

  /**
   * Initiate Google OAuth flow for parent web portal login.
   * Used by the desktop app to redirect to the web portal for OAuth,
   * OR by the web portal directly.
   */
  async signInWithGoogle(returnTo: string = "/auth/callback"): Promise<Result<void>> {
    const { error } = await this.client.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}${returnTo}`,
        queryParams: { access_type: "offline", prompt: "consent" },
      },
    });
    if (error) {
      return Err(supabaseErrorToAppError(error));
    }
    return Ok(undefined);
  }
}
