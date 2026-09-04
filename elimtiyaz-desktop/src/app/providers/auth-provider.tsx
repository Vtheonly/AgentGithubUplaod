/**
 * Auth state — current session, sign-in / sign-out, role gating, token refresh.
 *
 * Persisted to localStorage so reloads during a session do not force a
 * re-login. Cleared on sign-out.
 *
 * Resilient Startup & Auto-Refresh:
 *   - Does NOT initialize with an expired token to avoid 401s on initial render.
 *   - On startup, if a stored session is expired, it proactively calls
 *     `repos.auth.refreshSession()` before unblocking the app.
 *   - While an active session is running, a timer proactively refreshes the
 *     access token before it expires.
 *
 * Password Governance (plan §12.04):
 *   - `changePassword(currentPassword, newPassword)` requires re-authentication
 *     with the current password before accepting the new one.
 *   - On success, the active session is revoked across all devices and
 *     a truthful audit log entry is written.
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
   * T-053 (TENANT-103): switch the WORKING tenant (global admins only).
   */
  switchTenant(tenantId: string): void;
  /**
   * Change password (plan §12.04).
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

      if (isExpired(stored)) {
        logger.info("Stored session expired, attempting token refresh...");
        try {
          const res = await repos.auth.refreshSession();
          if (!cancelled) {
            if (res.ok && res.value) {
              logger.info("Session successfully refreshed");
              setSession(res.value);
              persistSession(res.value);
            } else {
              logger.info("Session refresh failed, clearing expired session");
              clearSession();
              setSession(null);
            }
          }
        } catch (err) {
          logger.warn("Failed to refresh session on startup", { err });
          if (!cancelled) {
            clearSession();
            setSession(null);
          }
        } finally {
          if (!cancelled) setIsLoading(false);
        }
      } else {
        setIsLoading(false);
      }
    }

    void initSession();

    return () => {
      cancelled = true;
    };
  }, [repos.auth]);

  
  useEffect(() => {
    if (!session) return;
    const msUntilRefresh = Math.max(10_000, session.expiresAt - Date.now() - 120_000);
    const timer = setTimeout(async () => {
      logger.info("Proactively refreshing session token before expiration...");
      try {
        const res = await repos.auth.refreshSession();
        if (res.ok && res.value) {
          setSession(res.value);
          persistSession(res.value);
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
    try {
      await repos.auth.signOut();
    } catch {
     
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

      const result = await repos.auth.changePassword(currentPassword, newPassword);
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
   
  }
}