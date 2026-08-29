/**
 * Mock AuthRepository — in-memory authentication against seed accounts.
 *
 * Extracted from `mock-repositories.ts` in iteration 2 of the platform-wide
 * refactor. Behavior preserved verbatim, EXCEPT the password check (see
 * signIn below — SEC-100, task T-001).
 */
import type { AuthRepository, Observable } from "../../../domain/repository/repository";
import type { Result } from "../../../core/result";
import { Ok, Err } from "../../../core/result";
import { Errors } from "../../../core/app-error";
import type { Session } from "../../../core/rbac/session";
import { Role } from "../../../core/rbac/roles";
import { DEFAULT_ROLE_PERMISSIONS } from "../../../core/rbac/permissions";
import { SubjectBehavior } from "../subject-behavior";
import {
  store,
  seedAccounts,
  TENANT_ID,
  AuditActions,
  appendAudit,
  delay,
} from "./mock-store";

export class MockAuthRepository implements AuthRepository {
  /** Tracks the last successful sign-in (for the logout audit event). */
  private lastSession: Session | null = null;

  async signIn(email: string, password: string): Promise<Result<Session>> {
    await delay(220);
    // SEC-100 (task T-001): seedAccounts no longer carries static password
    // literals — shipping them leaked the nine staff passwords into the
    // production bundle. Mock sign-in matches on email only; the password
    // must merely be non-empty (the form enforces this). The mock layer is a
    // dev/demo fallback that is bypassed entirely when Supabase is
    // configured (see repository-provider.tsx), so no real credential check
    // is lost.
    const account = seedAccounts.find((a) => a.email === email);
    if (!account || password.length === 0) {
      // VAULT §12.01 — authentication events are tracked, INCLUDING failed
      // attempts. The failed login is attributed to the attempted identity
      // (email prefix when it matches a known account) and audit-logged.
      const attempted = seedAccounts.find((a) => a.email === email);
      appendAudit({
        action: AuditActions.AuthLoginFailed,
        entityType: "session",
        entityId: attempted?.userId ?? email,
        actorId: attempted?.userId ?? "anonymous",
        actorName: attempted?.displayName ?? email,
        diff: {
          before: null,
          after: { email, reason: "invalid_credentials", knownAccount: !!attempted },
        },
        note: `Tentative de connexion échouée (${email})`,
      });
      return Err(Errors.unauthorized("Invalid credentials"));
    }
    const role = account.role as Role;
    const session: Session = {
      userId: account.userId,
      tenantId: TENANT_ID,
      email: account.email,
      displayName: account.displayName,
      avatarUrl: null,
      role,
      permissions: DEFAULT_ROLE_PERMISSIONS[role] ?? new Set(),
      accessToken: `mock-jwt-${account.userId}-${Date.now()}`,
      refreshToken: `mock-refresh-${account.userId}`,
      expiresAt: Date.now() + 8 * 3600_000,
      locale: "fr",
    };
    this.lastSession = session;
    appendAudit({
      action: AuditActions.AuthLogin,
      entityType: "session",
      entityId: session.userId,
      actorId: session.userId,
      actorName: session.displayName,
      diff: {
        before: null,
        after: { email: session.email, role: session.role },
      },
      note: "Connexion réussie",
    });
    return Ok(session);
  }

  async signOut(): Promise<Result<void>> {
    // VAULT §12.01 — logout is an authentication event and must be audited.
    if (this.lastSession) {
      appendAudit({
        action: AuditActions.AuthLogout,
        entityType: "session",
        entityId: this.lastSession.userId,
        actorId: this.lastSession.userId,
        actorName: this.lastSession.displayName,
        diff: {
          before: { email: this.lastSession.email, role: this.lastSession.role },
          after: null,
        },
        note: "Déconnexion",
      });
      this.lastSession = null;
    }
    return Ok(undefined);
  }

  async refreshSession(): Promise<Result<Session | null>> {
    return Ok(null);
  }

  /**
   * SEC-103 (task T-003): the AuthRepository contract now requires
   * changePassword. Consistent with mock signIn semantics after T-001
   * (email + any NON-EMPTY password — the static literals were removed),
   * the current password must merely be non-empty; strength rules match
   * the Supabase repository (plan §12.04). Ok is a dev/demo no-op: mock
   * sign-in accepts any non-empty password, so there is no stored secret
   * to rotate. The provider still writes its audit entry and clears the
   * local session on this Ok.
   */
  async changePassword(currentPassword: string, newPassword: string): Promise<Result<void>> {
    await delay(180);
    if (currentPassword.length === 0) {
      return Err(Errors.unauthorized("Current password is required"));
    }
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
    return Ok(undefined);
  }
}

/** Singleton instance — exported for the barrel re-export in `mock-repositories.ts`. */
export const mockAuthRepository: AuthRepository = new MockAuthRepository();

// Re-export Observable so consumers of this file don't need a second import.
export type { Observable };
