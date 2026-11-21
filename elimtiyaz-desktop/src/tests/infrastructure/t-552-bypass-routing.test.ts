/**
 * T-552 (ARCH-019) — the bypass-routing census gate.
 *
 * The rule under test: application code (features, shared, app, non-supabase
 * infrastructure) may reach the Supabase client module ONLY through
 * `infrastructure/supabase/backend-access` (the app-facing access surface
 * installed by T-552). `repository-provider.tsx` — the composition root that
 * builds the 54-slot repository composite — is the ONE file allowed to
 * import `supabase-client` directly. Tests under `src/tests/` are outside
 * the census by design: they import the module they test (the t-472
 * hermeticity / t-573 switch-matrix / t-594 runtime-config lanes).
 *
 * What this gate pins permanently:
 *   1. SHAPE 1 — no static `from "…supabase-client"` import outside the
 *      supabase tree, tests, and repository-provider.tsx (the verification
 *      grep from EXECUTION-PLAN §3 Step 1, automated).
 *   2. SHAPE 2 — no dynamic `import("…supabase-client")` outside the supabase
 *      tree and tests (the second grep shape — the conflict-detector /
 *      default-push-handler pair now import backend-access dynamically,
 *      preserving their lazy crash-avoidance semantics).
 *   3. The routing surface — `backend-access.ts` exists inside the supabase
 *      tree, and its exports are VERBATIM re-exports (binding identity) of
 *      the canonical `supabase-client` symbols: the behavior-preservation
 *      proof at the module level.
 *   4. The 17-file census — every routed file's source references
 *      backend-access (the routing is real and complete; a future revert of
 *      any single file fails here by name).
 *   5. The tenant-switcher E4.4 relocation — the file lives at
 *      features/settings (ARCH-003: `shared` must not reach infrastructure),
 *      the old shared/layout path is gone, and the topbar imports it from
 *      its new home.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, "..", "..");
const SUPABASE_TREE = join(SRC, "infrastructure", "supabase");
const PROVIDER = join(SRC, "app", "providers", "repository-provider.tsx");

/** The 17 bypass files routed by T-552 (the S6 census; paths post-relocation). */
const ROUTED_FILES = [
  "features/crm/excel-import-modal.tsx",
  "features/crm/parent-detail-drawer.tsx",
  "features/settings/backup-tab.tsx",
  "features/settings/configuration-tab.tsx",
  "features/settings/contextual-thresholds-config.tsx",
  "features/settings/danger-zone-card.tsx",
  "features/settings/tenant-switcher.tsx", // relocated from shared/layout (E4.4)
  "features/settings/supabase-diagnostics/crud-test-tab.tsx",
  "features/settings/supabase-diagnostics/diagnostics-runner.ts",
  "features/settings/supabase-diagnostics/supabase-diagnostics-tab.tsx",
  "app/providers/sync-provider.tsx",
  "infrastructure/system-config.ts",
  "infrastructure/storage/media-vault.ts",
  "infrastructure/ai/llm-adapter.ts",
  "infrastructure/sync/online-detector.ts",
  "infrastructure/sync/conflict-detector.ts", // dynamic importer
  "infrastructure/sync/default-push-handler.ts", // dynamic importer
] as const;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** The census scope: every src file EXCEPT the supabase tree and the tests. */
function censusFiles(): string[] {
  const all = walk(SRC);
  return all.filter((f) => {
    const rel = relative(SRC, f).replaceAll("\\", "/");
    return !rel.startsWith("infrastructure/supabase/") && !rel.startsWith("tests/");
  });
}

const STATIC_IMPORT_RE = /(?:^|\n)\s*import\s[^;]*?from\s*["'][^"']*supabase-client["']/;
const DYNAMIC_IMPORT_RE = /import\s*\(\s*["'][^"']*supabase-client["']\s*\)/;

describe("T-552 — the bypass-routing census (ARCH-019)", () => {
  it("SHAPE 1: no static supabase-client import outside the supabase tree/tests, except repository-provider.tsx", () => {
    const offenders: string[] = [];
    for (const file of censusFiles()) {
      const rel = relative(SRC, file).replaceAll("\\", "/");
      if (rel === "app/providers/repository-provider.tsx") continue; // the sanctioned composition root
      const source = readFileSync(file, "utf8");
      if (STATIC_IMPORT_RE.test(source)) offenders.push(rel);
    }
    expect(
      offenders,
      "files importing supabase-client directly (must route through backend-access)",
    ).toEqual([]);
  });

  it("SHAPE 2: no dynamic supabase-client import outside the supabase tree/tests", () => {
    const offenders: string[] = [];
    for (const file of censusFiles()) {
      const rel = relative(SRC, file).replaceAll("\\", "/");
      const source = readFileSync(file, "utf8");
      if (DYNAMIC_IMPORT_RE.test(source)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it("the composition root keeps its sanctioned direct import (the one allowed seam)", () => {
    const provider = readFileSync(PROVIDER, "utf8");
    expect(provider).toMatch(/from\s+["'][^"']*supabase\/supabase-client["']/);
  });

  it("the routing surface exists inside the supabase tree", () => {
    expect(existsSync(join(SUPABASE_TREE, "backend-access.ts"))).toBe(true);
  });

  it("each of the 17 routed files references the backend-access surface", () => {
    const unRouted: string[] = [];
    for (const rel of ROUTED_FILES) {
      const source = readFileSync(join(SRC, rel), "utf8");
      if (!source.includes("backend-access")) unRouted.push(rel);
    }
    expect(unRouted).toEqual([]);
  });

  it("the tenant-switcher relocation (E4.4): features/settings home, old path gone, topbar re-pointed", () => {
    expect(existsSync(join(SRC, "features/settings/tenant-switcher.tsx"))).toBe(true);
    expect(existsSync(join(SRC, "shared/layout/tenant-switcher.tsx"))).toBe(false);
    const topbar = readFileSync(join(SRC, "shared/layout/topbar.tsx"), "utf8");
    expect(topbar).toContain('from "../../features/settings/tenant-switcher"');
    expect(topbar).not.toContain('from "./tenant-switcher"');
  });
});

describe("T-552 — the behavior-preservation proof (verbatim re-export identity)", () => {
  it("the access surface's exports ARE the canonical client module's bindings", async () => {
    const access = await import("../../infrastructure/supabase/backend-access");
    const client = await import("../../infrastructure/supabase/supabase-client");
    // Binding identity: the same functions/objects, not copies — zero behavior
    // change by construction at every routed call site.
    expect(access.getSupabaseClient).toBe(client.getSupabaseClient);
    expect(access.isSupabaseConfigured).toBe(client.isSupabaseConfigured);
    expect(access.describeSupabaseConnection).toBe(client.describeSupabaseConnection);
    expect(access.normalizeSupabaseUrl).toBe(client.normalizeSupabaseUrl);
    expect(access.useSupabase).toBe(client.useSupabase);
    expect(access.supabaseUrl).toBe(client.supabaseUrl);
    expect(access.supabaseAnonKey).toBe(client.supabaseAnonKey);
  });
});
