/**
 * Auth state — current session, sign-in / sign-out, role gating.
 *
 * Persisted to localStorage so reloads during a session do not force a
 * re-login. Cleared on sign-out. Production will swap localStorage for
 * Supabase's session management.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session } from "../core/rbac/session";
import { isExpired } from "../core/rbac/session";
import type { Permission } from "../core/rbac/permissions";
import { useRepositories } from "../infrastructure/repository-provider";
import { logger } from "../core/logging/logger";

const STORAGE_KEY = "el-imtiyaz.session";

interface AuthContextValue {
  session: Session | null;
  isLoading: boolean;
  signIn(email: string, password: string): Promise<{ ok: true } | { ok: false; error: string }>;
  signOut(): Promise<void>;
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

  async function signIn(email: string, password: string) {
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
  }

  async function signOut() {
    await repos.auth.signOut();
    clearSession();
    setSession(null);
  }

  const value = useMemo<AuthContextValue>(
    () => ({ session, isLoading, signIn, signOut }),
    [session, isLoading],
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
