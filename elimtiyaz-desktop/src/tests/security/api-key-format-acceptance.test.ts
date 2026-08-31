/**
 * T-107 / MIG-KEYS-201 — new-format Supabase API key acceptance (desktop).
 *
 * ADR-009 (2026-09-01): the project migrates its public identifiers to the
 * new-format Supabase API keys (`sb_publishable_…`) while KEEPING the legacy
 * anon JWT valid (dual acceptance, publishable-preferred). The desktop
 * reads its key at runtime (Electron userData config.json → localStorage →
 * Vite env), so the migration here means:
 *
 *  1. the config singleton resolves `isSupabaseConfigured()` and constructs
 *     `getSupabaseClient()` with EITHER key format (both are opaque strings
 *     for supabase-js ^2.111 — it never parses the apikey);
 *  2. the Configuration tab's guidance mentions BOTH formats (source-scan
 *     guard, T-065 technique) so the next operator is not told the field
 *     only accepts the legacy JWT;
 *  3. no client file ever suggests the service_role / sb_secret_ keys are
 *     acceptable client-side (SEC guard, T-001 technique).
 *
 * Live evidence (2026-09-01, hkvkefubghbbotgnteir): auth/health 200, REST
 * query processed and password-grant 200 with BOTH key formats — recorded in
 * docs/operations/credentials.md.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUB_KEY = "sb_publishable_YJR7u7BgicV1QZRnc1WdHA_BkGzfVgo";
const LEGACY_KEY_PREFIX = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";

describe("T-107 / MIG-KEYS-201 — desktop accepts both public key formats", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
  });

  it("publishable key in local config → configured + client constructs", async () => {
    localStorage.setItem(
      "el-imtiyaz.local-config",
      JSON.stringify({
        supabase_url: "https://hkvkefubghbbotgnteir.supabase.co",
        supabase_anon_key: PUB_KEY,
        supabase_use_supabase: true,
      })
    );
    const mod = await import("../../infrastructure/supabase/supabase-client");
    expect(mod.isSupabaseConfigured()).toBe(true);
    expect(mod.supabaseAnonKey).toBe(PUB_KEY);
    // Constructing the singleton with the new-format key must not throw.
    expect(() => mod.getSupabaseClient()).not.toThrow();
    expect(mod.getSupabaseClient()).toBeTruthy();
  });

  it("legacy anon JWT still accepted (dual acceptance — rollback safety)", async () => {
    localStorage.setItem(
      "el-imtiyaz.local-config",
      JSON.stringify({
        supabase_url: "https://hkvkefubghbbotgnteir.supabase.co",
        supabase_anon_key: `${LEGACY_KEY_PREFIX}.legacy-value-for-test`,
        supabase_use_supabase: true,
      })
    );
    const mod = await import("../../infrastructure/supabase/supabase-client");
    expect(mod.isSupabaseConfigured()).toBe(true);
    expect(() => mod.getSupabaseClient()).not.toThrow();
  });

  it("Configuration tab guidance mentions BOTH key formats (source-scan guard)", () => {
    const card = readFileSync(
      join(__dirname, "../../features/settings/configuration/connection-card.tsx"),
      "utf8"
    );
    expect(card).toContain("sb_publishable_");
    expect(card).toContain("anon");
  });

  it("SEC guard: the client layer never treats secret keys as client-side values", () => {
    // The connection card's help text must FORBID service_role / sb_secret_
    // client-side (the phrase 'Ne JAMAIS' + the key names co-occur in the
    // same guidance block).
    const card = readFileSync(
      join(__dirname, "../../features/settings/configuration/connection-card.tsx"),
      "utf8"
    );
    expect(card).toContain("Ne JAMAIS utiliser la clé service_role (ou sb_secret_) côté client");
  });
});
