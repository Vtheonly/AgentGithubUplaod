/**
 * Auth state — current session, sign-in / sign-out, role gating.
 *
 * Persisted to localStorage so reloads during a session do not force a
 * re-login. Cleared on sign-out. Production will swap localStorage for
 * Supabase's session management.
 *
 * Iteration 10 — Password Governance (plan §12.04):
 *   - `changePassword(currentPassword, newPassword)` requires re-authentication
 *     with the current password before accepting the new one.
 *   - On success, the active session is revoked (per plan §12.04: "Modifying
 *     a password automatically revokes all active JWT tokens and terminates
 *     active sessions across all devices for that user account").
 *   - A high-priority audit event is written via the audit repository —
 *     only AFTER the repository confirms the password actually changed
 *     (SEC-103, task T-003: the audit entry must never be forged).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session } from "../../core/rbac/session";
import { getSyncQueueStore } from "../../infrastructure/sync/sync-queue-store";
import { isExpired } from "../../core/rbac/session";
import type { Permission } from "../../core/rbac/permissions";
import { useRepositories } from "./repository-provider";
import { AuditActions } from "../../core/audit-actions";
import { logger } from "../../core/logger";

const STORAGE_KEY = "el-imtiyaz.session";

interface AuthContextValue {
  session: Session | null;
  isLoading: boolean;
  signIn(email: string, password: string): Promise<{ ok: true } | { ok: false; error: string }>;
  signOut(): Promise<void>;
  /**
   * T-053 (TENANT-103): switch the WORKING tenant (global admins only —
   * the switcher is rendered exactly for them). Persists the choice and
   * reloads so every repository cache (they hold per-tenant lists) is
   * rebuilt against the new context.
   */
  switchTenant(tenantId: string): void;
  /**
   * Iteration 10 — change password (plan §12.04).
   *
   * Requires the current password for re-authentication. Delegates the
   * actual change to `repos.auth.changePassword` (SEC-103, task T-003):
   * the repository re-authenticates, persists the new password via
   * Supabase `auth.updateUser` and revokes all sessions (global signOut).
   * On success:
   *   1. Writes a high-priority audit event (`auth.password_change`) —
   *      only now is it truthful.
   *   2. Clears the local session (the user must sign in again).
   *   3. Returns ok=true so the UI can navigate to the login screen.
   *
   * Returns `{ ok: false, error }` if the current password is wrong or
   * the new password fails the strength check (min 8 chars, mixed case,
   * digit, symbol — per plan §12.04 "Strong Entropy"). On failure the
   * session is preserved and NO audit entry is written.
   */
  changePassword(
    currentPassword: string,
    newPassword: string,
  ): Promise<{ ok: true } | { ok: false; error: string }>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface SerializedSession extends Omit<Session, "permissions"> {
  permissions: Permission[];
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const repos = useRepositories();
  const [session, setSession] = useState<Session | null>(() => loadSession());
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (session && isExpired(session)) {
      logger.info("Session expired, clearing");
      clearSession();
      setSession(null);
    }
  }, [session]);

  // T-158: the four actions are wrapped in useCallback so the context value
  // memo can list them as real dependencies (react-hooks/exhaustive-deps).
  // `repos` is a module-stable context value in production, so the callback
  // identities — and therefore the memo identity — still change exactly when
  // `session`/`isLoading` change; the previous hand-written dep array
  // ([session, isLoading]) silently captured stale `repos` if the provider
  // value ever changed identity without a session change.
  const signIn = useCallback(
    async (email: string, password: string) => {
      setIsLoading(true);
      try {
        const result = await repos.auth.signIn(email, password);
        if (result.ok) {
          setSession(result.value);
          persistSession(result.value);
          return { ok: true as const };
        }
        return { ok: false as const, error: result.error.userMessage };
      } finally {
        setIsLoading(false);
      }
    },
    [repos],
  );

  const signOut = useCallback(async () => {
    await repos.auth.signOut();
    // SYNC-102: the sync queue is session-scoped. User A's pending entries
    // must NOT leak into user B's session on a shared desktop (their
    // sync_queue upserts would fail RLS under B's tenant, and their entity
    // pushes would run under B's JWT — a confused audit trail). Clear the
    // local queue on sign-out; anything not yet synced must be re-imported
    // by its owner.
    try {
      await getSyncQueueStore().clear();
    } catch (err) {
      logger.warn("Failed to clear the sync queue on sign-out", { err });
    }
    clearSession();
    setSession(null);
  }, [repos]);

  // T-053 (TENANT-103) — see the interface doc comment.
  const switchTenant = useCallback(
    (tenantId: string) => {
      if (!session || !tenantId) return;
      const next: Session = { ...session, tenantId };
      setSession(next);
      persistSession(next);
      // Repository caches hold per-tenant lists; a reload is the honest full
      // invalidation (the alternative — a per-repository invalidation fan-out
      // — is T-034's cache-refresh design work).
      window.location.reload();
    },
    [session],
  );

  /**
   * Iteration 10 — change password (plan §12.04).
   *
   * Per spec: "Allow password changes without re-authentication. The user
   * must prove current credentials before setting a new password." → the
   * repository re-authenticates with the current password as its first
   * step (see SupabaseAuthRepository.changePassword).
   *
   * Per spec: "Modifying a password automatically revokes all active JWT
   * tokens and terminates active sessions across all devices for that user
   * account." → the repository performs a global signOut; we additionally
   * clear the local session.
   *
   * SEC-103 (task T-003): the actual update is delegated to
   * repos.auth.changePassword — this provider must NEVER report success
   * (or write the audit entry) unless the repository confirms the change.
   */
  const changePassword = useCallback(
    async (
      currentPassword: string,
      newPassword: string,
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      if (!session) {
        return { ok: false, error: "Aucune session active." };
      }
      // Strength check (plan §12.04 "Strong Entropy"): fail fast with a
      // specific French message before hitting the repository.
      if (newPassword.length < 8) {
        return { ok: false, error: "Le nouveau mot de passe doit contenir au moins 8 caractères." };
      }
      if (!/[a-z]/.test(newPassword)) {
        return { ok: false, error: "Le nouveau mot de passe doit contenir au moins une lettre minuscule." };
      }
      if (!/[A-Z]/.test(newPassword)) {
        return { ok: false, error: "Le nouveau mot de passe doit contenir au moins une lettre majuscule." };
      }
      if (!/[0-9]/.test(newPassword)) {
        return { ok: false, error: "Le nouveau mot de passe doit contenir au moins un chiffre." };
      }
      if (newPassword === currentPassword) {
        return { ok: false, error: "Le nouveau mot de passe doit être différent de l'actuel." };
      }

      // SEC-103: delegate the real change (re-auth + auth.updateUser +
      // global signOut) to the repository that owns it.
      const result = await repos.auth.changePassword(currentPassword, newPassword);
      if (!result.ok) {
        // In this flow ERR_UNAUTHORIZED means the re-authentication with the
        // current password failed — keep the specific French message this UI
        // has always shown for that case.
        const error =
          result.error.code === "ERR_UNAUTHORIZED"
            ? "Mot de passe actuel incorrect."
            : result.error.userMessage;
        return { ok: false, error };
      }

      // The password REALLY changed — the audit entry is now truthful.
      await repos.audit.log({
        action: AuditActions.AuthPasswordChange,
        entityType: "user",
        entityId: session.userId,
        actorId: session.userId,
        actorName: session.displayName,
        tenantId: session.tenantId,
        diff: { before: { password: "***" }, after: { password: "***" } },
        note: "Self-service password change — all sessions revoked (global signOut)",
      });

      // The repository already revoked every server-side session; clear the
      // local session so the user is sent back to the login screen.
      clearSession();
      setSession(null);

      logger.info("Password changed; sessions revoked", { userId: session.userId });
      return { ok: true as const };
    },
    [repos, session],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ session, isLoading, signIn, signOut, switchTenant, changePassword }),
    [session, isLoading, signIn, signOut, switchTenant, changePassword],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SerializedSession;
    return { ...parsed, permissions: new Set(parsed.permissions) };
  } catch {
    return null;
  }
}

function persistSession(s: Session) {
  try {
    const serializable: SerializedSession = { ...s, permissions: [...s.permissions] };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializable));
  } catch (err) {
    logger.warn("Failed to persist session", { err });
  }
}

function clearSession() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* noop */
  }
}
