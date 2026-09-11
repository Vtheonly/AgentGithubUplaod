// ============================================================================
// FILE: src/app/providers/auth-provider.tsx
// ============================================================================
/**
 * Auth state — current session, sign-in / sign-out, role gating, token refresh.
 *
 * Persisted to localStorage so reloads during a session do not force a
 * re-login. Cleared on sign-out.
 *
 * Session lifecycle contracts (T-313 / REG-006 pin):
 *   - The persisted session is serialized with `permissions: Permission[]`
 *     and re-hydrated into a `Set` by loadSession() — the ONLY boundary
 *     where the array form exists.
 *   - SuperAdmin permission repair happens at CONSTRUCTION
 *     (ensureSuperAdminPermissions — mirroring buildSession's T-266/AI-309
 *     repair) and after load, never scattered across gate consumers.
 *   - refreshSession rebuilds the domain Session from the SDK's refreshed
 *     auth session via the shared buildSession (AUTH-301) — no credential
 *     grant is ever re-issued on the refresh path.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "../../core/rbac/session";
import { isSuperAdmin } from "../../core/rbac/session";
import { getSyncQueueStore } from "../../infrastructure/sync/sync-queue-store";
import { isExpired } from "../../core/rbac/session";
import { Permission } from "../../core/rbac/permissions";
import { Role } from "../../core/rbac/roles";
import { useRepositories } from "./repository-provider";
import { AuditActions } from "../../core/audit-actions";
import { logger } from "../../core/logger";

const STORAGE_KEY = "el-imtiyaz.session";

interface AuthContextValue {
  session: Session | null;
  isLoading: boolean;
  signIn(
    email: string,
    password: string,
  ): Promise<{ ok: true } | { ok: false; error: string }>;
  signOut(): Promise<void>;
  switchTenant(tenantId: string): void;
  changePassword(
    currentPassword: string,
    newPassword: string,
  ): Promise<{ ok: true } | { ok: false; error: string }>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface SerializedSession extends Omit<Session, "permissions"> {
  permissions: Permission[];
}

function ensureSuperAdminPermissions(s: Session): Session {
  if (isSuperAdmin(s)) {
    const fullPerms = new Set(s.permissions);
    Object.values(Permission).forEach((p) => fullPerms.add(p));
    return { ...s, permissions: fullPerms };
  }
  return s;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const repos = useRepositories();

  const [session, setSession] = useState<Session | null>(() => {
    const s = loadSession();
    return s && !isExpired(s) ? s : null;
  });

  const [isLoading, setIsLoading] = useState<boolean>(() => {
    const s = loadSession();
    return !!(s && isExpired(s));
  });

  useEffect(() => {
    let cancelled = false;

    async function initSession() {
      const stored = loadSession();
      if (!stored) {
        setIsLoading(false);
        return;
      }

      try {
        // T-185 (AUTH-301): refreshSession rebuilds the domain Session via
        // the shared buildSession(user, authSession) — NEVER a second
        // credential grant. Validating the stored session against the
        // server on every startup (not only when expired) also evicts
        // sessions whose profile was suspended since the last visit.
        const res = await repos.auth.refreshSession();
        if (!cancelled) {
          if (res.ok && res.value) {
            const s = ensureSuperAdminPermissions(res.value);
            setSession(s);
            persistSession(s);
          } else if (isExpired(stored)) {
            clearSession();
            setSession(null);
          }
        }
      } catch (err) {
        logger.warn("Failed to refresh session on startup", { err });
        if (!cancelled && isExpired(stored)) {
          clearSession();
          setSession(null);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void initSession();

    return () => {
      cancelled = true;
    };
  }, [repos.auth]);

  useEffect(() => {
    if (!session) return;
    const msUntilRefresh = Math.max(
      10_000,
      session.expiresAt - Date.now() - 120_000,
    );
    const timer = setTimeout(async () => {
      try {
        const res = await repos.auth.refreshSession();
        if (res.ok && res.value) {
          const s = ensureSuperAdminPermissions(res.value);
          setSession(s);
          persistSession(s);
        }
      } catch (err) {
        logger.warn("Proactive session refresh failed", { err });
      }
    }, msUntilRefresh);

    return () => clearTimeout(timer);
  }, [session, repos.auth]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      setIsLoading(true);
      try {
        const result = await repos.auth.signIn(email, password);
        if (result.ok) {
          const s = ensureSuperAdminPermissions(result.value);
          setSession(s);
          persistSession(s);
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
    try {
      await repos.auth.signOut();
    } catch {
      /* ignore */
    }

    try {
      await getSyncQueueStore().clear();
    } catch (err) {
      logger.warn("Failed to clear the sync queue on sign-out", { err });
    }
    clearSession();
    setSession(null);
  }, [repos]);

  const switchTenant = useCallback(
    (tenantId: string) => {
      if (!session || !tenantId) return;
      const next: Session = { ...session, tenantId };
      setSession(next);
      persistSession(next);
      window.location.reload();
    },
    [session],
  );

  const changePassword = useCallback(
    async (
      currentPassword: string,
      newPassword: string,
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      if (!session) {
        return { ok: false, error: "Aucune session active." };
      }
      if (newPassword.length < 8) {
        return {
          ok: false,
          error: "Le nouveau mot de passe doit contenir au moins 8 caractères.",
        };
      }
      if (!/[a-z]/.test(newPassword)) {
        return {
          ok: false,
          error:
            "Le nouveau mot de passe doit contenir au moins une lettre minuscule.",
        };
      }
      if (!/[A-Z]/.test(newPassword)) {
        return {
          ok: false,
          error:
            "Le nouveau mot de passe doit contenir au moins une lettre majuscule.",
        };
      }
      if (!/[0-9]/.test(newPassword)) {
        return {
          ok: false,
          error: "Le nouveau mot de passe doit contenir au moins un chiffre.",
        };
      }
      if (newPassword === currentPassword) {
        return {
          ok: false,
          error: "Le nouveau mot de passe doit être différent de l'actuel.",
        };
      }

      const result = await repos.auth.changePassword(
        currentPassword,
        newPassword,
      );
      if (!result.ok) {
        const error =
          result.error.code === "ERR_UNAUTHORIZED"
            ? "Mot de passe actuel incorrect."
            : result.error.userMessage;
        return { ok: false, error };
      }

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

      clearSession();
      setSession(null);

      logger.info("Password changed; sessions revoked", {
        userId: session.userId,
      });
      return { ok: true as const };
    },
    [repos, session],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      isLoading,
      signIn,
      signOut,
      switchTenant,
      changePassword,
    }),
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
    // T-313 (REG-006): the permissions Set is RE-HYDRATED here — the single
    // boundary where the JSON array becomes a Set again. Downstream `can()`
    // deliberately does NOT tolerate arrays (fail loud at the producer).
    const permissions = new Set(
      Array.isArray(parsed.permissions) ? parsed.permissions : [],
    );

    // If session belongs to SuperAdmin, make sure all permissions are granted
    // (T-266/AI-309: the DB catalog may lag the client permission enum).
    if (parsed.role === Role.SuperAdmin) {
      Object.values(Permission).forEach((p) => permissions.add(p));
    }

    return { ...parsed, permissions };
  } catch {
    return null;
  }
}

function persistSession(s: Session) {
  try {
    const serializable: SerializedSession = {
      ...s,
      permissions: [...s.permissions],
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializable));
  } catch (err) {
    logger.warn("Failed to persist session", { err });
  }
}

function clearSession() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
