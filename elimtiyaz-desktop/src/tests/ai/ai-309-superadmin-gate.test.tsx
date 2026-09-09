/**
 * T-266 — AI-309: the SuperAdmin lockout on the AI gates (41st session).
 *
 * Root cause (BOTH legs confirmed in source):
 *   1. DB leg — the AI permission codes ("use_ai", "manage_ai_config",
 *      plan §11) exist ONLY in the desktop Permission enum. NO migration
 *      ever inserted them, so `current_user_permissions()` can never
 *      return them: a DB-derived (Supabase-mode) SuperAdmin session is
 *      born without them — and `persistSession` re-strips the stored
 *      snapshot on every proactive token refresh.
 *   2. Stale-snapshot leg — `loadSession()` trusted the persisted session
 *      verbatim, so a session saved before the AI iteration stayed
 *      stripped forever.
 *
 * Effect: SuperAdmin (the role plan §11.04/§11.05 authorizes) hit
 * "Accès refusé" on Configuration IA, the Assistant IA topbar button was
 * hidden (canUse false), and Ctrl+J was dead.
 *
 * Fix under test (role-OR-permission gates + the two session repairs):
 *   - supabase-auth-repository.buildSession: SuperAdmin ⇒ full permission
 *     set (mirrors DEFAULT_ROLE_PERMISSIONS "SuperAdmin: unrestricted");
 *   - auth-provider.loadSession: repairs a stale SuperAdmin snapshot;
 *   - ai-config-tab / ai-copilot-provider: role OR permission.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseAuthRepository } from "../../infrastructure/supabase/repositories/supabase-auth-repository";
import { RepositoryProvider, mockRepositories } from "../../app/providers/repository-provider";
import { AuthProvider, useAuth } from "../../app/providers/auth-provider";
import { ToastProvider } from "../../app/providers/toast-provider";
import { ToastViewport } from "../../shared/layout/toast-viewport";
import { AICopilotProvider, useAICopilot } from "../../app/providers/ai-copilot-provider";
import { AIConfigTab } from "../../features/settings/ai-config-tab";
import { Permission } from "../../core/rbac/permissions";
import { Role } from "../../core/rbac/roles";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SESSION_KEY = "el-imtiyaz.session";

/* ------------------------------------------------------------------ */
/*  Leg 1 — the DB-derived session (SupabaseAuthRepository)            */
/* ------------------------------------------------------------------ */

const PROFILE = {
  id: "profile-1",
  tenant_id: "00000000-0000-0000-0000-000000000001",
  email: "admin@elimtiyaz.dz",
  display_name: "Admin",
  status: "active",
  avatar_url: null,
};

function makeSupabaseClient(opts: { roles: string[]; perms: string[] }) {
  const authSession = {
    access_token: "tok",
    refresh_token: "rtok",
    expires_at: 2_000_000_000,
    user: { id: "auth-user-1", email: "admin@elimtiyaz.dz" },
  };
  const client = {
    auth: {
      signInWithPassword: async () => ({ data: { user: authSession.user, session: authSession }, error: null }),
    },
    from(table: string) {
      if (table !== "user_profiles") throw new Error(`unexpected table ${table}`);
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = () => q;
      q.single = () => Promise.resolve({ data: PROFILE, error: null });
      return q;
    },
    rpc(name: string) {
      if (name === "current_user_roles") return Promise.resolve({ data: opts.roles, error: null });
      if (name === "current_user_permissions") return Promise.resolve({ data: opts.perms, error: null });
      throw new Error(`unexpected rpc ${name}`);
    },
  };
  return client as unknown as SupabaseClient;
}

describe("T-266 leg 1 — SupabaseAuthRepository repairs a DB-derived SuperAdmin session", () => {
  it("a super_admin whose DB resolver returns ONLY view_roster still gains use_ai + manage_ai_config", async () => {
    // The EXACT live-DB situation: no migration ever inserted the AI codes.
    const repo = new SupabaseAuthRepository(
      makeSupabaseClient({ roles: ["super_admin"], perms: ["view_roster"] }),
    );
    const res = await repo.signIn("admin@elimtiyaz.dz", "pw");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.role).toBe(Role.SuperAdmin);
      expect(res.value.permissions.has(Permission.UseAI)).toBe(true);
      expect(res.value.permissions.has(Permission.ManageAIConfig)).toBe(true);
      expect(res.value.permissions.has(Permission.ViewRoster)).toBe(true);
    }
  });

  it("a super_admin with an EMPTY DB permission set gains ALL client permissions", async () => {
    const repo = new SupabaseAuthRepository(makeSupabaseClient({ roles: ["super_admin"], perms: [] }));
    const res = await repo.signIn("admin@elimtiyaz.dz", "pw");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.permissions.size).toBe(Object.values(Permission).length);
  });

  it("a non-super_admin session is NOT inflated (DB resolver stays authoritative)", async () => {
    const repo = new SupabaseAuthRepository(
      makeSupabaseClient({ roles: ["driver"], perms: ["view_personnel"] }),
    );
    const res = await repo.signIn("driver@elimtiyaz.dz", "pw");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.role).toBe(Role.Driver);
      expect(res.value.permissions.has(Permission.UseAI)).toBe(false);
      expect(res.value.permissions.has(Permission.ViewPersonnel)).toBe(true);
    }
  });
});
