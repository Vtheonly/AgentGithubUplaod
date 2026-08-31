/**
 * T-053 — global-admin support regression suite (TENANT-103).
 *
 * Problem: getTenantId() fell back to the DEMO tenant UUID whenever the
 * session was missing or the user was a global admin (session.tenantId
 * empty) — pre-login code and global admins silently read/wrote the demo
 * tenant; RLS then denied the rest, leaving the desktop unusable for global
 * admins.
 *
 * Fixed: getTenantId() returns the session's WORKING tenant or null (no demo
 * fallback); write paths call requireTenantId() (loud French error when no
 * tenant is picked); global admins pick a working tenant via the
 * TenantSwitcher; the auth repository stores the honest null tenant.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getTenantId, requireTenantId } from "../../infrastructure/supabase/repositories/supabase-shared-repositories";
import { SupabaseAuditLogRepository } from "../../infrastructure/supabase/repositories/supabase-audit-log-repository";

const SESSION_KEY = "el-imtiyaz.session";
const DEMO_UUID = "00000000-0000-0000-0000-000000000001";

function setSession(raw: string | null) {
  if (raw === null) localStorage.removeItem(SESSION_KEY);
  else localStorage.setItem(SESSION_KEY, raw);
}

const SRC = join(__dirname, "../../");
const REPO_FILE = join(SRC, "infrastructure/supabase/repositories/supabase-shared-repositories.ts");

type Row = Record<string, any>;

function makeClient() {
  const calls: { table: string; filters: Row[]; inserted: Row[] }[] = [];
  const client = {
    from(table: string) {
      const rec = { table, filters: [] as Row[], inserted: [] as Row[] };
      calls.push(rec);
      const q: Record<string, unknown> = {};
      q.eq = (col: string, value: unknown) => {
        rec.filters.push({ col, value });
        return q;
      };
      q.select = () => q;
      q.order = () => q;
      q.limit = () => q;
      q.maybeSingle = () => Promise.resolve({ data: null, error: null });
      q.then = (resolve: unknown) =>
        Promise.resolve({ data: [], error: null }).then(resolve as never);
      return q;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

describe("T-053 — getTenantId(): no demo fallback, honest null (TENANT-103)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns null when no session exists (pre-login)", () => {
    setSession(null);
    expect(getTenantId()).toBeNull();
  });

  it("returns the session's working tenant when present", () => {
    setSession(JSON.stringify({ tenantId: "11111111-1111-1111-1111-111111111111", userId: "u1" }));
    expect(getTenantId()).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("returns null for a global-admin session (tenantId null) — NOT the demo UUID", () => {
    setSession(JSON.stringify({ tenantId: null, homeTenantId: null, userId: "u1" }));
    const tenantId = getTenantId();
    expect(tenantId).toBeNull();
    expect(tenantId).not.toBe(DEMO_UUID);
  });

  it("requireTenantId() throws the explicit French error when no tenant is picked", () => {
    setSession(null);
    expect(() => requireTenantId()).toThrow(/Aucun établissement actif/);
  });
});

describe("T-053 — source-scan guards (the demo fallback cannot come back silently)", () => {
  it("supabase-shared-repositories has no TENANT_FALLBACK demo constant in getTenantId", () => {
    const text = readFileSync(REPO_FILE, "utf8");
    // The function body must not return the demo UUID.
    const fnBody = text.slice(
      text.indexOf("export function getTenantId"),
      text.indexOf("export function getActorId"),
    );
    expect(fnBody).toContain("sess?.tenantId || null");
    expect(fnBody).not.toContain("00000000-0000-0000-0000-000000000001");
  });

  it("the auth repository stores the honest null tenant (no empty-string mask)", () => {
    const text = readFileSync(
      join(SRC, "infrastructure/supabase/repositories/supabase-auth-repository.ts"),
      "utf8",
    );
    expect(text).toContain("tenantId: profile.tenant_id ?? null");
    expect(text).not.toContain('tenantId: profile.tenant_id ?? ""');
  });

  it("the TenantSwitcher exists and the topbar renders it", () => {
    const switcher = readFileSync(join(SRC, "shared/layout/tenant-switcher.tsx"), "utf8");
    expect(switcher).toContain("switchTenant(t.id)");
    const topbar = readFileSync(join(SRC, "shared/layout/topbar.tsx"), "utf8");
    expect(topbar).toContain("<TenantSwitcher />");
  });

  it("the auth provider exposes switchTenant (persist + reload invalidation)", () => {
    const text = readFileSync(join(SRC, "app/providers/auth-provider.tsx"), "utf8");
    expect(text).toContain("switchTenant(tenantId: string)");
    expect(text).toContain("window.location.reload()");
  });
});

describe("T-053 — a repository read with a null tenant targets nothing (empty, not demo)", () => {
  it("query filters never carry the demo UUID for a null-tenant session", async () => {
    const storage = new Map<string, string>([
      ["el-imtiyaz.session", JSON.stringify({ tenantId: null, homeTenantId: null, userId: "u1" })],
    ]);
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, v),
      removeItem: (k: string) => void storage.delete(k),
    };
    const { client, calls } = makeClient();
    // A representative read: the audit-log query path builds a tenant filter.
    // Drive the real repository with the null-tenant session.
    const repo = new SupabaseAuditLogRepository(client);
    await repo.recent(5);
    const tenantFilters = calls.flatMap((c) =>
      c.filters.filter((f) => f.col === "tenant_id"),
    );
    for (const f of tenantFilters) {
      expect(f.value).not.toBe(DEMO_UUID);
    }
  });
});
