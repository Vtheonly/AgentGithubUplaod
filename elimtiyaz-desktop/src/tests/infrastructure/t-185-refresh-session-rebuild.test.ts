/**
 * T-185 — refreshSession rebuilds WITHOUT a second credential grant (AUTH-301).
 *
 * Problem (owner's 2026-09-05 desktop console paste):
 *   "Stored session expired, attempting token refresh..."
 *   → POST /auth/v1/token?grant_type=password → 400
 *   → "Session refresh failed, clearing expired session"
 *
 * SupabaseAuthRepository.refreshSession called the SDK's refreshSession
 * (grant_type=refresh_token — that SUCCEEDED), then "rebuilt" the domain
 * Session by delegating to `this.signIn(user.email, "")` — a password
 * grant with an EMPTY password, rejected 400 on every attempt. The
 * auth-provider then cleared the (perfectly valid) refreshed session and
 * logged the user out on every session expiry / app restart.
 *
 * Fix: signIn and refreshSession now share buildSession(user, authSession)
 * — the profile/roles/permissions fetch — with NO second grant.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseAuthRepository } from "../../infrastructure/supabase/repositories/supabase-auth-repository";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_SRC = readFileSync(
  join(__dirname, "../../infrastructure/supabase/repositories/supabase-auth-repository.ts"),
  "utf8",
);

const AUTH_USER_ID = "auth-user-1";
const PROFILE = {
  id: "profile-1",
  tenant_id: "00000000-0000-0000-0000-000000000001",
  email: "admin@elimtiyaz.dz",
  display_name: "Admin",
  status: "active",
  avatar_url: null,
};

interface SignInCall {
  email: string;
  password: string;
}

function makeClient(opts: { refreshError?: unknown } = {}) {
  const signInCalls: SignInCall[] = [];
  const rpcCalls: string[] = [];
  const profileFilters: { col: string; value: unknown }[] = [];

  const authSession = {
    access_token: "refreshed-access-token",
    refresh_token: "refreshed-refresh-token",
    expires_at: 2_000_000_000,
    user: { id: AUTH_USER_ID, email: "admin@elimtiyaz.dz" },
  };

  const client = {
    auth: {
      // The SDK refresh — must be the ONLY auth call on the refresh path.
      refreshSession: async () =>
        opts.refreshError
          ? { data: {}, error: opts.refreshError }
          : { data: { user: authSession.user, session: authSession }, error: null },
      // The credential grant — SPIED: refreshSession must never reach it.
      signInWithPassword: async (creds: SignInCall) => {
        signInCalls.push(creds);
        return { data: { user: authSession.user, session: authSession }, error: null };
      },
    },
    from(table: string) {
      if (table !== "user_profiles") throw new Error(`unexpected table ${table}`);
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = (col: string, value: unknown) => {
        profileFilters.push({ col, value });
        return q;
      };
      q.single = () => Promise.resolve({ data: PROFILE, error: null });
      return q;
    },
    rpc(name: string) {
      rpcCalls.push(name);
      if (name === "current_user_roles") return Promise.resolve({ data: ["super_admin"], error: null });
      if (name === "current_user_permissions") return Promise.resolve({ data: ["view_roster"], error: null });
      throw new Error(`unexpected rpc ${name}`);
    },
  };

  return {
    client: client as unknown as SupabaseClient,
    signInCalls,
    rpcCalls,
    profileFilters,
  };
}

describe("T-185 — refreshSession rebuilds without a password grant (AUTH-301)", () => {
  it("returns the rebuilt Session and NEVER issues a password grant", async () => {
    const { client, signInCalls } = makeClient();
    const repo = new SupabaseAuthRepository(client);

    const res = await repo.refreshSession();

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.userId).toBe(PROFILE.id);
      expect(res.value.email).toBe(PROFILE.email);
      expect(res.value.accessToken).toBe("refreshed-access-token");
      expect(res.value.refreshToken).toBe("refreshed-refresh-token");
      expect(res.value.expiresAt).toBe(2_000_000_000 * 1000);
      expect(res.value.role).toBe("super_admin");
    }
    // THE regression: the old code called signIn(email, "") here → 400.
    expect(signInCalls).toEqual([]);
  });

  it("fetches the profile by the REFRESHED auth user id, then roles + permissions", async () => {
    const { client, profileFilters, rpcCalls } = makeClient();
    const repo = new SupabaseAuthRepository(client);

    await repo.refreshSession();

    expect(profileFilters).toContainEqual({ col: "auth_user_id", value: AUTH_USER_ID });
    expect(rpcCalls).toEqual(["current_user_roles", "current_user_permissions"]);
  });

  it("refresh failure still surfaces the SDK error (no silent swallow)", async () => {
    const { client } = makeClient({ refreshError: { message: "refresh_token expired" } });
    const repo = new SupabaseAuthRepository(client);

    const res = await repo.refreshSession();

    expect(res.ok).toBe(false);
  });

  it("signIn keeps its credential grant and shares the same buildSession path", async () => {
    const { client, signInCalls } = makeClient();
    const repo = new SupabaseAuthRepository(client);

    const res = await repo.signIn("admin@elimtiyaz.dz", "correct-password");

    expect(signInCalls).toEqual([{ email: "admin@elimtiyaz.dz", password: "correct-password" }]);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.accessToken).toBe("refreshed-access-token");
  });

  it("source guard: refreshSession delegates to buildSession, never to this.signIn", () => {
    const refreshBody = REPO_SRC.split("async refreshSession")[1]?.split("async signOut")[0] ?? "";
    expect(refreshBody, "refreshSession method not found in source").toContain("this.buildSession(");
    expect(refreshBody).not.toContain("this.signIn(");
    // The shared builder exists and takes the auth user + session.
    expect(REPO_SRC).toContain("private async buildSession(");
  });

  it("source guard: no empty-password delegation anywhere in the repository", () => {
    expect(REPO_SRC).not.toMatch(/signIn\([^)]*""\s*,\s*""\)/);
    expect(REPO_SRC).not.toContain(`signIn(data.user.email ?? "", "")`);
  });
});
