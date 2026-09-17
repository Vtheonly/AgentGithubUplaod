/**
 * Regression tests for T-392 — the desktop session-state synchronization
 * (AUTH-302), the seed-error surfacing (OPS-317), and the connection-probe
 * sanitization/honesty (OPS-318).
 *
 * AUTH-302 (the root cause behind the owner's 2026-09-17 report): the
 * stored domain session stayed "logged in" while the Supabase SDK session
 * was gone, so every REST call ran as `anon` → RLS `200 []` → the
 * repositories' silent catch degraded every list to empty. The fix evicts
 * the domain session when the startup refresh fails with an AUTH-CLASS
 * error, and keeps it for NETWORK-class errors (offline start).
 *
 * OPS-317: the parent/student `seed()` catches still degrade to the
 * honest empty cache, but the classified reason is now recorded
 * (`getSeedDiagnostics`) and logged.
 *
 * OPS-318: `validateConnection` builds its probe URL from the NORMALIZED
 * input (a trailing space previously became `%20/rest/v1/…`) and a
 * `200 []` anon probe is reported with the honest "reachable ≠ data
 * access" note (the Task-29 trap).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { AuthProvider, useAuth } from "../../app/providers/auth-provider";
import { RepositoryProvider, mockRepositories, type Repositories } from "../../app/providers/repository-provider";
import type { AuthRepository } from "../../domain/repository/repository";
import type { Result } from "../../core/result";
import { Ok, Err } from "../../core/result";
import { Errors } from "../../core/app-error";
import type { Session } from "../../core/rbac/session";
import { Role } from "../../core/rbac/roles";
import type { Permission } from "../../core/rbac/permissions";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  SupabaseParentRepository,
  SupabaseStudentRepository,
  getSeedDiagnostics,
  __resetSeedDiagnosticsForTests,
} from "../../infrastructure/supabase/repositories/supabase-shared-repositories";
import { LocalConfigService } from "../../infrastructure/system-config";

/** Narrow the Result union for assertions (TS discriminated-union guard). */
function expectOk<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`expected Ok, got: ${r.error.message}`);
  return r.value;
}

const SESSION_KEY = "el-imtiyaz.session";
const CONFIG_KEY = "el-imtiyaz.local-config";

function makeStoredSession(expiresAt = Date.now() + 3600_000): Session {
  return {
    userId: "user-1",
    tenantId: "00000000-0000-0000-0000-000000000001",
    homeTenantId: "00000000-0000-0000-0000-000000000001",
    email: "agent@el-imtiyaz.test",
    displayName: "Test Agent",
    avatarUrl: null,
    role: Role.SupportStaff,
    permissions: new Set<Permission>([]),
    accessToken: "stored-access-token",
    refreshToken: "stored-refresh-token",
    expiresAt,
    locale: "fr",
  };
}

function persistStoredSession(s: Session): void {
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({ ...s, permissions: [...s.permissions] }),
  );
}

// ============================================================================
// AUTH-302 — the auth-provider startup eviction behaviour
// ============================================================================

class ControlledAuthRepository implements AuthRepository {
  /** The Result the next refreshSession() returns (T-392 seam). */
  nextRefresh: Result<Session | null> = Ok(null);

  async signIn(email: string, password: string): Promise<Result<Session>> {
    void email;
    void password;
    return Ok(makeStoredSession());
  }
  async signOut(): Promise<Result<void>> {
    return Ok(undefined);
  }
  async refreshSession(): Promise<Result<Session | null>> {
    return this.nextRefresh;
  }
  async changePassword(current: string, next: string): Promise<Result<void>> {
    void current;
    void next;
    return Ok(undefined);
  }
  async signInWithGoogle(returnTo?: string): Promise<Result<void>> {
    void returnTo;
    return Ok(undefined);
  }
}

interface HookLike {
  hook: { result: { current: ReturnType<typeof useAuth> } };
}

function renderAuthHarness(auth: ControlledAuthRepository): HookLike {
  const repositories = { ...mockRepositories, auth } as Repositories;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <RepositoryProvider repositories={repositories}>
      <AuthProvider>{children}</AuthProvider>
    </RepositoryProvider>
  );
  const hook = renderHook(() => useAuth(), { wrapper });
  return { hook } as unknown as HookLike;
}

describe("T-392 / AUTH-302 — auth-provider session eviction", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
  });

  it("evicts the time-valid domain session when the startup refresh fails AUTH-CLASS (no SDK session)", async () => {
    // The AUTH-302 state: a time-valid stored domain session, but the SDK
    // has NO session to refresh (the repository answers unauthorized).
    persistStoredSession(makeStoredSession());
    const auth = new ControlledAuthRepository();
    auth.nextRefresh = Err(Errors.unauthorized("No active session to refresh"));

    const { hook } = renderAuthHarness(auth);

    await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
    expect(hook.result.current.session).toBeNull();
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it("evicts the time-valid domain session when the refresh GRANT is rejected (auth-class 401)", async () => {
    persistStoredSession(makeStoredSession());
    const auth = new ControlledAuthRepository();
    auth.nextRefresh = Err(Errors.unauthorized("Invalid Refresh Token: Already Used"));

    const { hook } = renderAuthHarness(auth);
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
    expect(hook.result.current.session).toBeNull();
  });

  it("KEEPS the time-valid domain session when the startup refresh fails NETWORK-CLASS (offline start)", async () => {
    persistStoredSession(makeStoredSession());
    const auth = new ControlledAuthRepository();
    auth.nextRefresh = Err(Errors.network("fetch failed"));

    const { hook } = renderAuthHarness(auth);
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
    // The session survives: the SDK retries the refresh when connectivity
    // returns; reads degrade to the honest empty state with the reason
    // recorded (OPS-317) instead of a silent logout.
    expect(hook.result.current.session).not.toBeNull();
    expect(hook.result.current.session?.userId).toBe("user-1");
    expect(localStorage.getItem(SESSION_KEY)).not.toBeNull();
  });

  it("KEEPS the time-valid domain session on Ok(null) (the mock-mode refresh contract) — previous behaviour preserved", async () => {
    persistStoredSession(makeStoredSession());
    const auth = new ControlledAuthRepository();
    auth.nextRefresh = Ok(null);

    const { hook } = renderAuthHarness(auth);
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
    expect(hook.result.current.session).not.toBeNull();
  });

  it("refreshes into the new session when the startup refresh SUCCEEDS", async () => {
    persistStoredSession(makeStoredSession());
    const fresh = makeStoredSession();
    const auth = new ControlledAuthRepository();
    auth.nextRefresh = Ok({ ...fresh, displayName: "Refreshed Agent" });

    const { hook } = renderAuthHarness(auth);
    await waitFor(() => expect(hook.result.current.session?.displayName).toBe("Refreshed Agent"));
  });

  it("sign-in still works after an eviction (the honest re-login path)", async () => {
    persistStoredSession(makeStoredSession());
    const auth = new ControlledAuthRepository();
    auth.nextRefresh = Err(Errors.unauthorized("No active session to refresh"));

    const { hook } = renderAuthHarness(auth);
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
    expect(hook.result.current.session).toBeNull();

    auth.nextRefresh = Ok(null);
    let signInResult: { ok: boolean } | undefined;
    await act(async () => {
      signInResult = await hook.result.current.signIn("agent@el-imtiyaz.test", "irrelevant");
    });
    expect(signInResult?.ok).toBe(true);
    expect(hook.result.current.session?.userId).toBe("user-1");
  });
});

// ============================================================================
// OPS-317 — the seed-error recording (honest empty, visible reason)
// ============================================================================

/** A client whose whole-tenant SELECT always fails with the given error. */
function failingSelectClient(error: { code?: string; message: string }): SupabaseClient {
  const chain = {
    eq: () => chain,
    is: () => chain,
    order: async () => ({ data: null, error }),
  };
  const client = {
    from: (table: string) => {
      void table;
      return { select: () => chain };
    },
  };
  return client as unknown as SupabaseClient;
}

describe("T-392 / OPS-317 — seed diagnostics recording", () => {
  beforeEach(() => {
    __resetSeedDiagnosticsForTests();
    localStorage.clear();
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ tenantId: "00000000-0000-0000-0000-000000000001", userId: "staff-1" }),
    );
  });
  afterEach(() => {
    localStorage.clear();
    __resetSeedDiagnosticsForTests();
  });

  it("records the classified reason when the PARENTS seed degrades to empty (the owner's annuaire symptom)", async () => {
    const client = failingSelectClient({ code: "ERR_UNAUTHORIZED", message: "JWT invalid" });
    const repo = new SupabaseParentRepository(client);

    const result = await repo.search("");
    expect(result.ok).toBe(true);
    expect(result.ok ? result.value : []).toEqual([]); // the honest-empty contract is unchanged

    const diagnostics = getSeedDiagnostics();
    expect(diagnostics.length).toBeGreaterThanOrEqual(1);
    const parentsEntry = diagnostics.find((d) => d.source === "parents");
    expect(parentsEntry).toBeDefined();
    expect(parentsEntry?.code).toBe("ERR_UNAUTHORIZED");
    expect(parentsEntry?.networkClass).toBe(false);
    expect(parentsEntry?.message).toContain("JWT invalid");
  });

  it("records the classified reason when the STUDENTS seed degrades to empty (the children symptom)", async () => {
    const client = failingSelectClient({ message: "Failed to fetch" });
    const repo = new SupabaseStudentRepository(client);

    await repo.observe();
    // The seed is fire-and-forget on observe(); refresh() awaits it.
    await repo.refresh();

    const diagnostics = getSeedDiagnostics();
    const studentsEntry = diagnostics.find((d) => d.source === "students");
    expect(studentsEntry).toBeDefined();
    expect(studentsEntry?.networkClass).toBe(true); // "Failed to fetch" classified network
  });

  it("records nothing when the seed SUCCEEDS (a healthy read is not a diagnostic)", async () => {
    const chain = {
      eq: () => chain,
      is: () => chain,
      order: async () => ({ data: [], error: null }),
    };
    const client = { from: () => ({ select: () => chain }) } as unknown as SupabaseClient;
    const repo = new SupabaseParentRepository(client);

    await repo.search("");
    expect(getSeedDiagnostics().filter((d) => d.source === "parents")).toHaveLength(0);
  });
});

// ============================================================================
// OPS-318 — validateConnection sanitization + honest classification
// ============================================================================

describe("T-392 / OPS-318 — validateConnection URL normalization + honesty", () => {
  const ORIGINAL_FETCH = globalThis.fetch;

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = ORIGINAL_FETCH;
    localStorage.clear();
    delete (window as unknown as { elImtiyaz?: unknown }).elImtiyaz;
  });

  it("normalizes a trailing-space URL — the probe request carries NO %20 and no whitespace (the Root-Problem-2 artifact)", async () => {
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response(JSON.stringify([]), { status: 200 });
    }) as unknown as typeof fetch;

    const service = new LocalConfigService();
    const result = await service.validateConnection(
      "https://vebfehrpzajhstyhinnw.supabase.co ",
      " sb_publishable_testkey ",
    );

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("https://vebfehrpzajhstyhinnw.supabase.co/rest/v1/tenants");
    expect(calls[0]).not.toContain("%20");
    expect(calls[0]).not.toMatch(/\s/);
  });

  it("classifies a 200-empty anon probe honestly: connected=true + the reachable≠data-access note (the Task-29 trap)", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify([]), { status: 200 })) as unknown as typeof fetch;

    const service = new LocalConfigService();
    const result = await service.validateConnection(
      "https://vebfehrpzajhstyhinnw.supabase.co",
      "sb_publishable_testkey",
    );

    expect(result.ok).toBe(true);
    const value = expectOk(result);
    expect(value.connected).toBe(true);
    expect(value.tenantCount).toBe(0);
    expect(value.note).toBeDefined();
    expect(value.note).toContain("anonyme");
  });

  it("surfaces the exact HTTP status when the key is rejected (401)", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify({ message: "Invalid API key" }), { status: 401 }),
    ) as unknown as typeof fetch;

    const service = new LocalConfigService();
    const result = await service.validateConnection(
      "https://vebfehrpzajhstyhinnw.supabase.co",
      "sb_publishable_wrongkey",
    );

    expect(result.ok).toBe(true);
    const value = expectOk(result);
    expect(value.connected).toBe(false);
    expect(value.error).toContain("HTTP 401");
  });

  it("persists the SANITIZED url through saveConnectionAndRestart (no whitespace round-trips into the config)", async () => {
    (window as unknown as { elImtiyaz?: unknown }).elImtiyaz = {
      app: { restart: async () => ({ ok: true }) },
    };

    const service = new LocalConfigService();
    const result = await service.saveConnectionAndRestart(
      "https://vebfehrpzajhstyhinnw.supabase.co/ ",
      " sb_publishable_testkey ",
      true,
    );
    expect(result.ok).toBe(true);

    const stored = JSON.parse(localStorage.getItem(CONFIG_KEY) ?? "{}");
    expect(stored.supabase_url).toBe("https://vebfehrpzajhstyhinnw.supabase.co");
    expect(stored.supabase_anon_key).toBe("sb_publishable_testkey");
  });

  it("rejects a non-supabase URL at the format gate (validation error, no fetch)", async () => {
    let fetchCalled = false;
    globalThis.fetch = vi.fn(async () => {
      fetchCalled = true;
      return new Response("[]", { status: 200 });
    }) as unknown as typeof fetch;

    const service = new LocalConfigService();
    const result = await service.validateConnection("https://example.com", "sb_publishable_testkey");
    expect(result.ok).toBe(false);
    expect(fetchCalled).toBe(false);
  });
});
