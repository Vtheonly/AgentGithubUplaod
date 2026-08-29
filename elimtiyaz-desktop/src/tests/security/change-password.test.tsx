/**
 * Regression tests for SEC-103 / task T-003 — the desktop
 * AuthProvider.changePassword must actually change the password.
 *
 * Defect (audit second-pass SEC-103): the provider re-authenticated,
 * wrote a FORGED `auth.password_change` audit entry, cleared the local
 * session and reported success — but never called the repository's
 * changePassword (SupabaseAuthRepository.changePassword →
 * supabase.auth.updateUser), so the real password was never updated.
 *
 * The auth repository fake below models real password semantics
 * (verify current, store new) so the task's stated integration test —
 * "after change, old password fails, new password works" — runs without
 * a live Supabase.
 *
 * Note on the MockAuthRepository tests: they reach the method through a
 * narrow structural cast so THIS file typechecks both before the fix
 * (method missing → runtime failure, the red state) and after it. The
 * interface compliance itself is additionally enforced by
 * `npm run typecheck` once `changePassword` is added to
 * `AuthRepository`.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { AuthProvider, useAuth } from "../../app/providers/auth-provider";
import { RepositoryProvider, mockRepositories, type Repositories } from "../../app/providers/repository-provider";
import { MockAuthRepository } from "../../infrastructure/mock/repositories/auth-repository";
import type { AuthRepository } from "../../domain/repository/repository";
import type { Result } from "../../core/result";
import { Ok, Err } from "../../core/result";
import { Errors } from "../../core/app-error";
import type { Session } from "../../core/rbac/session";
import { Role } from "../../core/rbac/roles";
import type { Permission } from "../../core/rbac/permissions";

const EMAIL = "agent@el-imtiyaz.test";
const OLD_PASSWORD = "OldPassw0rd";
const NEW_PASSWORD = "NewPassw0rd1";

function makeSession(): Session {
  return {
    userId: "user-1",
    tenantId: "tenant-1",
    email: EMAIL,
    displayName: "Test Agent",
    avatarUrl: null,
    role: Role.SupportStaff,
    permissions: new Set<Permission>([]),
    accessToken: "test-access-token",
    refreshToken: null,
    expiresAt: Date.now() + 3600_000,
    locale: "fr",
  };
}

/**
 * In-memory AuthRepository with REAL password semantics: signIn verifies
 * the stored password, changePassword verifies the current password and
 * stores the new one. Records every changePassword call so tests can
 * assert the provider actually delegates (the core SEC-103 regression).
 */
class InMemoryAuthRepository implements AuthRepository {
  password = OLD_PASSWORD;
  changePasswordCalls: Array<{ currentPassword: string; newPassword: string }> = [];
  /** When set, changePassword returns this failure instead of succeeding. */
  failNextChangeWith: ReturnType<typeof Errors.server> | null = null;

  async signIn(email: string, password: string): Promise<Result<Session>> {
    if (email !== EMAIL || password !== this.password) {
      return Err(Errors.unauthorized("Invalid credentials"));
    }
    return Ok(makeSession());
  }

  async signOut(): Promise<Result<void>> {
    return Ok(undefined);
  }

  async refreshSession(): Promise<Result<Session | null>> {
    return Ok(null);
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<Result<void>> {
    this.changePasswordCalls.push({ currentPassword, newPassword });
    if (this.failNextChangeWith) {
      const failure = this.failNextChangeWith;
      this.failNextChangeWith = null;
      return Err(failure);
    }
    if (currentPassword !== this.password) {
      return Err(Errors.unauthorized("Current password is incorrect"));
    }
    if (
      newPassword.length < 8 ||
      !/[a-z]/.test(newPassword) ||
      !/[A-Z]/.test(newPassword) ||
      !/[0-9]/.test(newPassword)
    ) {
      return Err(Errors.validation("Password must be at least 8 characters with upper, lower and digit"));
    }
    this.password = newPassword;
    return Ok(undefined);
  }
}

/** Records every audit log call without any storage. */
class RecordingAuditRepository {
  entries: Array<Record<string, unknown>> = [];

  async query(): Promise<Result<{ entries: unknown[]; total: number }>> {
    return Ok({ entries: [], total: 0 });
  }
  async byEntity(): Promise<Result<unknown[]>> {
    return Ok([]);
  }
  async recent(): Promise<Result<unknown[]>> {
    return Ok([]);
  }
  async log(input: Record<string, unknown>): Promise<Result<{ id: string }>> {
    this.entries.push(input);
    return Ok({ id: `audit-${this.entries.length}` });
  }
}

/** Structural subset of renderHook's result — avoids generic gymnastics. */
interface HookLike {
  result: { current: ReturnType<typeof useAuth> };
}

interface Harness {
  hook: HookLike;
  auth: InMemoryAuthRepository;
  audit: RecordingAuditRepository;
}

function renderAuthHarness(): Harness {
  const auth = new InMemoryAuthRepository();
  const audit = new RecordingAuditRepository();
  const repositories = {
    ...mockRepositories,
    auth,
    // Structurally compatible with AuditRepository for the fields the
    // provider touches (log); cast keeps the fake's query stubs simple.
    audit: audit as unknown as Repositories["audit"],
  } as Repositories;

  const wrapper = ({ children }: { children: ReactNode }) => (
    <RepositoryProvider repositories={repositories}>
      <AuthProvider>{children}</AuthProvider>
    </RepositoryProvider>
  );

  const hook = renderHook(() => useAuth(), { wrapper });
  return { hook, auth, audit };
}

async function signIn(hook: HookLike) {
  let result: { ok: boolean } = { ok: false };
  await act(async () => {
    result = await hook.result.current.signIn(EMAIL, OLD_PASSWORD);
  });
  expect(result.ok).toBe(true);
  expect(hook.result.current.session).not.toBeNull();
}

describe("AuthProvider.changePassword — SEC-103 regression", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
  });

  it("delegates to the auth repository's changePassword (was: silent no-op)", async () => {
    const h = renderAuthHarness();
    await signIn(h.hook);

    let res: { ok: boolean } = { ok: false };
    await act(async () => {
      res = await h.hook.result.current.changePassword(OLD_PASSWORD, NEW_PASSWORD);
    });

    expect(res.ok).toBe(true);
    // THE regression assertion: before the fix, the provider never called
    // the repository — the password never changed despite "success".
    expect(h.auth.changePasswordCalls).toHaveLength(1);
    expect(h.auth.changePasswordCalls[0]).toEqual({
      currentPassword: OLD_PASSWORD,
      newPassword: NEW_PASSWORD,
    });
  });

  it("after a successful change, the old password no longer signs in and the new one does", async () => {
    const h = renderAuthHarness();
    await signIn(h.hook);

    await act(async () => {
      const res = await h.hook.result.current.changePassword(OLD_PASSWORD, NEW_PASSWORD);
      expect(res.ok).toBe(true);
    });

    // The session was revoked by the change — sign in again with each password.
    let oldResult: { ok: boolean } = { ok: true };
    await act(async () => {
      oldResult = await h.hook.result.current.signIn(EMAIL, OLD_PASSWORD);
    });
    expect(oldResult.ok).toBe(false);

    let newResult: { ok: boolean } = { ok: false };
    await act(async () => {
      newResult = await h.hook.result.current.signIn(EMAIL, NEW_PASSWORD);
    });
    expect(newResult.ok).toBe(true);
  });

  it("writes the auth.password_change audit entry only after a successful change, attributed to the real actor", async () => {
    const h = renderAuthHarness();
    await signIn(h.hook);

    // Failed attempt first: wrong current password.
    await act(async () => {
      const res = await h.hook.result.current.changePassword("WrongPassw0rd", NEW_PASSWORD);
      expect(res.ok).toBe(false);
    });
    expect(h.audit.entries).toHaveLength(0);
    expect(h.auth.changePasswordCalls).toHaveLength(1); // repo was consulted and rejected

    // Successful attempt.
    await act(async () => {
      const res = await h.hook.result.current.changePassword(OLD_PASSWORD, NEW_PASSWORD);
      expect(res.ok).toBe(true);
    });

    expect(h.audit.entries).toHaveLength(1);
    const entry = h.audit.entries[0] as { action: string; actorId: string; entityId: string; tenantId: string };
    expect(entry.action).toBe("auth.password_change");
    expect(entry.actorId).toBe("user-1");
    expect(entry.entityId).toBe("user-1");
    expect(entry.tenantId).toBe("tenant-1");
  });

  it("a wrong current password returns a specific error and preserves the session", async () => {
    const h = renderAuthHarness();
    await signIn(h.hook);

    let res: { ok: boolean; error?: string } = { ok: true };
    await act(async () => {
      res = await h.hook.result.current.changePassword("WrongPassw0rd", NEW_PASSWORD);
    });

    expect(res.ok).toBe(false);
    expect(res.error).toContain("Mot de passe actuel incorrect");
    expect(h.hook.result.current.session).not.toBeNull();
    expect(h.audit.entries).toHaveLength(0);
  });

  it("a repository failure is surfaced, the session is preserved and no audit entry is written", async () => {
    const h = renderAuthHarness();
    await signIn(h.hook);
    // Supabase updateUser failure, simulated at the repository boundary.
    h.auth.failNextChangeWith = Errors.server("updateUser failed");

    let res: { ok: boolean; error?: string } = { ok: true };
    await act(async () => {
      res = await h.hook.result.current.changePassword(OLD_PASSWORD, NEW_PASSWORD);
    });

    // Before the fix the provider ignored the repository entirely and
    // reported success here — the audit entry was forged.
    expect(res.ok).toBe(false);
    expect(typeof res.error).toBe("string");
    expect(h.hook.result.current.session).not.toBeNull();
    expect(h.audit.entries).toHaveLength(0);
  });

  it("a successful change clears the local session (forces re-login)", async () => {
    const h = renderAuthHarness();
    await signIn(h.hook);

    await act(async () => {
      const res = await h.hook.result.current.changePassword(OLD_PASSWORD, NEW_PASSWORD);
      expect(res.ok).toBe(true);
    });

    expect(h.hook.result.current.session).toBeNull();
    expect(localStorage.getItem("el-imtiyaz.session")).toBeNull();
  });

  it("still rejects weak new passwords without touching the repository", async () => {
    const h = renderAuthHarness();
    await signIn(h.hook);

    const cases: Array<{ pw: string; error: string }> = [
      { pw: "Ab1", error: "8 caractères" },
      { pw: "alllowercase1", error: "majuscule" },
      { pw: "ALLUPPERCASE1", error: "minuscule" },
      { pw: "NoDigitsHere", error: "chiffre" },
      { pw: OLD_PASSWORD, error: "différent" },
    ];
    for (const c of cases) {
      let res: { ok: boolean; error?: string } = { ok: true };
      await act(async () => {
        res = await h.hook.result.current.changePassword(OLD_PASSWORD, c.pw);
      });
      expect(res.ok).toBe(false);
      expect(res.error).toContain(c.error);
    }
    expect(h.auth.changePasswordCalls).toHaveLength(0);
    expect(h.audit.entries).toHaveLength(0);
    expect(h.hook.result.current.session).not.toBeNull();
  });

  it("refuses to change the password with no active session", async () => {
    const h = renderAuthHarness();
    // No signIn — no session.

    let res: { ok: boolean } = { ok: true };
    await act(async () => {
      res = await h.hook.result.current.changePassword(OLD_PASSWORD, NEW_PASSWORD);
    });

    expect(res.ok).toBe(false);
    expect(h.auth.changePasswordCalls).toHaveLength(0);
  });
});

describe("MockAuthRepository.changePassword — interface compliance (SEC-103)", () => {
  // Reached through a narrow structural cast: the file must typecheck
  // both before the fix (red: method missing) and after it (green).
  type ChangePasswordFn = (currentPassword: string, newPassword: string) => Promise<Result<void>>;

  function getChangePassword(repo: MockAuthRepository): ChangePasswordFn | undefined {
    return (repo as unknown as { changePassword?: ChangePasswordFn }).changePassword;
  }

  it("implements changePassword", async () => {
    const repo = new MockAuthRepository();
    expect(getChangePassword(repo), "MockAuthRepository must implement AuthRepository.changePassword").toBeTypeOf("function");
  });

  it("rejects an empty current password (mock sign-in semantics: non-empty required)", async () => {
    const repo = new MockAuthRepository();
    const changePassword = getChangePassword(repo);
    expect(changePassword).toBeTypeOf("function");
    const res = await changePassword!("", NEW_PASSWORD);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("ERR_UNAUTHORIZED");
    }
  });

  it("rejects a weak new password with a validation error", async () => {
    const repo = new MockAuthRepository();
    const changePassword = getChangePassword(repo);
    expect(changePassword).toBeTypeOf("function");
    const res = await changePassword!("anything", "weak");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("ERR_VALIDATION");
    }
  });

  it("accepts a valid change (dev/demo no-op consistent with mock signIn)", async () => {
    const repo = new MockAuthRepository();
    const changePassword = getChangePassword(repo);
    expect(changePassword).toBeTypeOf("function");
    const res = await changePassword!("anything", NEW_PASSWORD);
    expect(res.ok).toBe(true);
  });
});
