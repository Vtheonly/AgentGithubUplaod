/**
 * Mock AuthRepository — in-memory authentication against seed accounts.
 *
 * Extracted from `mock-repositories.ts` in iteration 2 of the platform-wide
 * refactor. Behavior preserved verbatim.
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
  async signIn(email: string, password: string): Promise<Result<Session>> {
    await delay(220);
    const account = seedAccounts.find((a) => a.email === email && a.password === password);
    if (!account) {
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
    appendAudit({
      action: AuditActions.AuthLogin,
      entityType: "session",
      entityId: session.userId,
      actorId: session.userId,
      actorName: session.displayName,
      note: "Connexion réussie",
    });
    return Ok(session);
  }

  async signOut(): Promise<Result<void>> {
    return Ok(undefined);
  }

  async refreshSession(): Promise<Result<Session | null>> {
    return Ok(null);
  }
}

/** Singleton instance — exported for the barrel re-export in `mock-repositories.ts`. */
export const mockAuthRepository: AuthRepository = new MockAuthRepository();

// Re-export Observable so consumers of this file don't need a second import.
export type { Observable };
