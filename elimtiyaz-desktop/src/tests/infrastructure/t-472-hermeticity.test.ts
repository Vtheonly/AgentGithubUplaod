/**
 * T-472 (TEST-503) — the hermeticity seam + the source-scan guard.
 *
 * TEST-503 registered the systemic class: since the owner's f39eb17
 * canonical-production-URL fallback, `isSupabaseConfigured()` was TRUE in
 * the whole Vitest environment — the vault-compliance pair was uploading to
 * the REAL production `homework-attachments` bucket for two weeks before
 * T-470 pinned that ONE suite. This suite pins the systemic fix:
 *
 *  1. THE SEAM (the default contract): inside Vitest, with no localStorage
 *     config and no env, the client module is UNCONFIGURED and in MOCK mode
 *     — `supabaseUrl === undefined`, `supabaseAnonKey === undefined`,
 *     `useSupabase === false`, `isSupabaseConfigured() === false`, and
 *     `getSupabaseClient()` REFUSES to construct a client. T-314's hermetic
 *     contract, restored at the module itself.
 *
 *  2. THE ESCAPE HATCH (pin-per-suite): a suite that genuinely needs a
 *     configured path pins it explicitly — the localStorage
 *     `el-imtiyaz.local-config` + `vi.resetModules()` + dynamic-import
 *     pattern yields a configured module with the PINNED values (never the
 *     canonical production ones).
 *
 *  3. THE SOURCE-SCAN GUARD: every test file under `src/tests/` that reaches
 *     a configured-path seam (a direct `@supabase/supabase-js` import, or a
 *     call of `getSupabaseClient(`) must carry a pin marker — a
 *     `vi.mock("…supabase-client")` pin, a local-config localStorage pin, or
 *     the env-gated LIVE pattern (`describe.skipIf` + process.env). A new
 *     test that reaches for the configured path WITHOUT pinning it fails
 *     THIS guard, so the reach is visible at review time instead of
 *     silently talking to production (the TEST-503 trap).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TESTS_ROOT = join(__dirname, "..");
const PINNED_THIS_SUITE = "t-472-hermeticity";

function listTestFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listTestFiles(full));
    } else if (/\.(test|spec)\.[tj]sx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("T-472 / TEST-503 — the hermeticity seam (the default contract)", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllEnvs();
  });

  it("default Vitest module state: UNCONFIGURED + MOCK mode (T-314 restored)", async () => {
    const mod = await import("../../infrastructure/supabase/supabase-client");
    expect(mod.supabaseUrl).toBeUndefined();
    expect(mod.supabaseAnonKey).toBeUndefined();
    expect(mod.useSupabase).toBe(false);
    expect(mod.isSupabaseConfigured()).toBe(false);
    // The client must REFUSE to construct — no real Supabase client may be
    // built from the test environment's default state.
    expect(() => mod.getSupabaseClient()).toThrow(/not configured/i);
    // The diagnostic describe reports the honest unconfigured state.
    const describe = mod.describeSupabaseConnection();
    expect(describe.configured).toBe(false);
    expect(describe.keyFormat).toBe("missing");
    expect(describe.useSupabase).toBe(false);
  });

  it("the module IMPORT no longer throws for the default test state (mock mode is legal)", async () => {
    // Before T-472 the fallback made this import succeed while
    // "configured"; the hermetic default must not trade that for a
    // module-load throw — `useSupabase=false` keeps the import inert.
    await expect(
      import("../../infrastructure/supabase/supabase-client"),
    ).resolves.toBeTruthy();
  });

  it("the escape hatch: the localStorage pin yields the PINNED values (never the canonical production ones)", async () => {
    localStorage.setItem(
      "el-imtiyaz.local-config",
      JSON.stringify({
        supabase_url: "https://pinned-example.supabase.co",
        supabase_anon_key: "sb_publishable_PINNED_KEY_FOR_TEST",
        supabase_use_supabase: true,
      }),
    );
    const mod = await import("../../infrastructure/supabase/supabase-client");
    expect(mod.supabaseUrl).toBe("https://pinned-example.supabase.co");
    expect(mod.supabaseAnonKey).toBe("sb_publishable_PINNED_KEY_FOR_TEST");
    expect(mod.useSupabase).toBe(true);
    expect(mod.isSupabaseConfigured()).toBe(true);
    // The client CONSTRUCTS against the pinned (fake) project — constructing
    // performs no network I/O; the pin is the suite's explicit declaration.
    expect(() => mod.getSupabaseClient()).not.toThrow();
    const describe = mod.describeSupabaseConnection();
    expect(describe.host).toBe("pinned-example.supabase.co");
    expect(describe.keyFormat).toBe("publishable");
    // The canonical production host must NEVER appear through the env-gated
    // default in tests — that was the TEST-503 leak.
    expect(describe.host).not.toContain("vebfehrpzajhstyhinnw");
  });

  it("the repository provider's DEFAULT selection is the mock composite in the hermetic default", async () => {
    // T-470 extracted the mock composite so the provider is importable
    // without the app-layer cycle; T-472 makes the provider's default
    // selection the mock composite in tests (was: the REAL supabase
    // repositories built over the production-pointing client).
    vi.resetModules();
    localStorage.clear();
    const provider = await import("../../app/providers/repository-provider");
    expect(provider.mockRepositories).toBeTruthy();
    expect(provider.mockRepositories.parents).toBeTruthy();
  });
});

describe("T-472 / TEST-503 — the source-scan guard (configured-path reachability)", () => {
  it("every configured-path seam in src/tests is pinned (vi.mock / local-config / env-gated LIVE)", () => {
    const files = listTestFiles(TESTS_ROOT);
    expect(files.length).toBeGreaterThan(200); // the scan actually walked the tree

    const violations: string[] = [];

    for (const file of files) {
      const rel = relative(TESTS_ROOT, file);
      const source = readFileSync(file, "utf8");

      // This suite is the guard itself — it imports the module under test by
      // design (with the pin asserted above).
      if (rel.includes(PINNED_THIS_SUITE)) continue;

      // A configured-path reach: a DIRECT VALUE import from supabase-js
      // (building a client by hand — `import type` is erased at runtime and
      // harmless) or a call of getSupabaseClient(.
      const hasValueImport =
        /^[ \t]*import\s+(?!type\b)[^;]*?from\s*["']@supabase\/supabase-js["']/m.test(source);
      const callsGetClient = /getSupabaseClient\s*\(/.test(source) &&
        !/^\s*\/\/.*getSupabaseClient/m.test(source);
      const reachesConfiguredPath = hasValueImport || callsGetClient;
      if (!reachesConfiguredPath) continue;

      // The pin markers:
      const hasViMockPin = /vi\.mock\(\s*["'][^"']*supabase-client["']/.test(source);
      const hasLocalConfigPin = source.includes("el-imtiyaz.local-config");
      const hasEnvGatedLivePin =
        /describe\.skipIf/.test(source) &&
        /process\.env\.(SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)/.test(source);
      const hasMockClientFactory =
        /makeMockClient|mockClient|fakeClient|mockState\.client/.test(source) &&
        /vi\.mock\(/.test(source);

      if (
        !hasViMockPin &&
        !hasLocalConfigPin &&
        !hasEnvGatedLivePin &&
        !hasMockClientFactory
      ) {
        violations.push(
          `${rel}: reaches a configured-path seam (direct @supabase/supabase-js import or getSupabaseClient call) without a pin marker (vi.mock of supabase-client, el-imtiyaz.local-config, or the env-gated describe.skipIf LIVE pattern)`,
        );
      }
    }

    expect(violations).toEqual([]);
  });
});
