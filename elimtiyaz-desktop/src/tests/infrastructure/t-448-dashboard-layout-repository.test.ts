/**
 * T-448 suite — the dashboard-layout repository contract (UI-326).
 *
 * Pins the DEDICATED layout store's client contract:
 *   1. The domain parser (parseStoredDashboardLayout) — the ONE shared
 *      defensive shape validator (editor + both twins).
 *   2. The mock twin's load/save/clear lifecycle over localStorage (the
 *      editor's own offline-cache key — mock-mode parity).
 *   3. SOURCE GUARDS (the t-230 source-pin pattern): the Supabase twin
 *      saves through the save_dashboard_layout RPC (the migration-0134
 *      explicit-save write path — never a direct table write for saves);
 *      the migration file carries its self-registration (the ARCH-016
 *      lesson); the editor consumes the ONE shared storage module (no
 *      duplicated key string anywhere).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseStoredDashboardLayout,
  type DashboardLayoutRepository,
  type StoredDashboardLayout,
} from "../../domain/repository/dashboard-layout-repository";
import { mockDashboardLayoutRepository } from "../../infrastructure/mock/repositories/dashboard-layout-repository";
import { DASHBOARD_LAYOUT_STORAGE_PREFIX, dashboardLayoutCacheKey } from "../../features/dashboard/dashboard-layout-storage";

const VIEW_KEY = "t448-test-view";
const CACHE_KEY = dashboardLayoutCacheKey(VIEW_KEY);

beforeEach(() => {
  localStorage.clear();
});

// ============================================================
// 1. The domain parser — one shape, validated once
// ============================================================
describe("T-448 — parseStoredDashboardLayout (the shared defensive parser)", () => {
  it("parses a valid stored layout verbatim", () => {
    const parsed = parseStoredDashboardLayout({
      kpi: { x: 0, y: 1, w: 6, h: 4 },
      chart: { x: 6, y: 1, w: 6, h: 8 },
    });
    expect(parsed).toEqual({
      kpi: { x: 0, y: 1, w: 6, h: 4 },
      chart: { x: 6, y: 1, w: 6, h: 8 },
    });
  });

  it("returns null for non-objects (null, arrays, strings, numbers)", () => {
    expect(parseStoredDashboardLayout(null)).toBeNull();
    expect(parseStoredDashboardLayout(undefined)).toBeNull();
    expect(parseStoredDashboardLayout([{ x: 0, y: 0, w: 6, h: 4 }])).toBeNull();
    expect(parseStoredDashboardLayout("layout")).toBeNull();
    expect(parseStoredDashboardLayout(42)).toBeNull();
  });

  it("drops malformed rects but keeps the valid siblings (never crashes the editor)", () => {
    const parsed = parseStoredDashboardLayout({
      good: { x: 1, y: 2, w: 3, h: 4 },
      missingH: { x: 1, y: 2, w: 3 },
      nanX: { x: Number.NaN, y: 2, w: 3, h: 4 },
      stringY: { x: 1, y: "2", w: 3, h: 4 },
      notAnObject: "nope",
      nullRect: null,
    });
    expect(parsed).toEqual({ good: { x: 1, y: 2, w: 3, h: 4 } });
  });
});

// ============================================================
// 2. The mock twin — the load/save/clear lifecycle (mock-mode parity)
// ============================================================
describe("T-448 — MockDashboardLayoutRepository (the localStorage twin)", () => {
  it("load returns null when nothing was ever saved", async () => {
    const result = await mockDashboardLayoutRepository.load(VIEW_KEY);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBeNull();
  });

  it("save → load round-trips the layout under the editor's own cache key", async () => {
    const layout: StoredDashboardLayout = {
      overviewKpis: { x: 0, y: 0, w: 6, h: 5 },
      calendar: { x: 6, y: 0, w: 6, h: 9 },
    };
    const saved = await mockDashboardLayoutRepository.save(VIEW_KEY, layout);
    expect(saved.ok).toBe(true);

    // The twin persists under the EDITOR's key — mock mode is the same
    // storage the editor always used (parity by construction).
    expect(localStorage.getItem(CACHE_KEY)).toBe(JSON.stringify(layout));

    const loaded = await mockDashboardLayoutRepository.load(VIEW_KEY);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(loaded.value).toEqual(layout);
  });

  it("clear removes the saved layout (Réinitialiser)", async () => {
    await mockDashboardLayoutRepository.save(VIEW_KEY, {
      a: { x: 0, y: 0, w: 12, h: 4 },
    });
    const cleared = await mockDashboardLayoutRepository.clear(VIEW_KEY);
    expect(cleared.ok).toBe(true);
    expect(localStorage.getItem(CACHE_KEY)).toBeNull();
    const loaded = await mockDashboardLayoutRepository.load(VIEW_KEY);
    if (loaded.ok) expect(loaded.value).toBeNull();
  });

  it("tolerates corrupt local JSON (load → null, never a throw)", async () => {
    localStorage.setItem(CACHE_KEY, "{not json");
    const loaded = await mockDashboardLayoutRepository.load(VIEW_KEY);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(loaded.value).toBeNull();
  });

  it("filters malformed rects on load through the shared parser", async () => {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        good: { x: 1, y: 2, w: 3, h: 4 },
        bad: { x: "left", y: 2, w: 3, h: 4 },
      }),
    );
    const loaded = await mockDashboardLayoutRepository.load(VIEW_KEY);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.value).toEqual({ good: { x: 1, y: 2, w: 3, h: 4 } });
    }
  });
});

// ============================================================
// 3. SOURCE GUARDS — the architecture pins (the t-230 pattern)
// ============================================================
describe("T-448 — source guards (the dedicated store's architecture)", () => {
  const SUPABASE_REPO_SRC = readFileSync(
    join(__dirname, "../../infrastructure/supabase/repositories/supabase-dashboard-layout-repository.ts"),
    "utf8",
  );
  const MIGRATION_SRC = readFileSync(
    join(__dirname, "../../../supabase/migrations/0134_dashboard_layouts.sql"),
    "utf8",
  );
  const EDITOR_SRC = readFileSync(
    join(__dirname, "../../features/dashboard/dashboard-layout-editor.tsx"),
    "utf8",
  );
  const STORAGE_MODULE_SRC = readFileSync(
    join(__dirname, "../../features/dashboard/dashboard-layout-storage.ts"),
    "utf8",
  );

  it("the Supabase twin SAVES through the save_dashboard_layout RPC (the migration-0134 write path — never a direct table write)", () => {
    expect(SUPABASE_REPO_SRC).toContain('.rpc("save_dashboard_layout"');
    expect(SUPABASE_REPO_SRC).not.toMatch(/\.from\("dashboard_layouts"\)[\s\S]{0,80}\.upsert/);
  });

  it("the Supabase twin LOADS/CLEARS through RLS-scoped select/delete (no identity columns sent from the client)", () => {
    expect(SUPABASE_REPO_SRC).toMatch(/\.from\("dashboard_layouts"\)[\s\S]{0,200}\.select\("layout"\)/);
    expect(SUPABASE_REPO_SRC).toMatch(/\.from\("dashboard_layouts"\)[\s\S]{0,200}\.delete\(\)/);
    expect(SUPABASE_REPO_SRC).not.toContain("user_profile_id:");
    expect(SUPABASE_REPO_SRC).not.toContain("tenant_id:");
  });

  it("migration 0134 self-registers in the same file as its DDL (the ARCH-016 lesson)", () => {
    expect(MIGRATION_SRC).toContain("insert into supabase_migrations.schema_migrations");
    expect(MIGRATION_SRC).toContain("'0134'");
  });

  it("migration 0134 RLS pins every policy to the caller's own profile (user-scoped, not role-gated)", () => {
    expect(MIGRATION_SRC).toMatch(/user_profile_id = public\.current_user_profile_id\(\)/);
    // The layout is a personal preference — no admin role gate on it.
    const ownPolicyCount = (MIGRATION_SRC.match(/current_user_profile_id\(\)/g) ?? []).length;
    expect(ownPolicyCount).toBeGreaterThanOrEqual(4); // select/insert/update/delete
    expect(MIGRATION_SRC).not.toMatch(/has_role\(['"]super_admin/);
  });

  it("the editor consumes the ONE shared storage module (no duplicated key string)", () => {
    expect(STORAGE_MODULE_SRC).toContain('"el-imtiyaz:dashboard-layout:"');
    expect(EDITOR_SRC).toContain("readDashboardLayoutCache");
    expect(EDITOR_SRC).not.toContain('"el-imtiyaz:dashboard-layout:"');
    // The mock twin imports the SAME module — one key, three consumers.
    const MOCK_SRC = readFileSync(
      join(__dirname, "../../infrastructure/mock/repositories/dashboard-layout-repository.ts"),
      "utf8",
    );
    expect(MOCK_SRC).toContain("dashboard-layout-storage");
    expect(MOCK_SRC).not.toContain('"el-imtiyaz:dashboard-layout:"');
  });

  it("the editor's explicit save is the ONLY server write path (persistNow → save; the debounced buffer stays local)", () => {
    expect(EDITOR_SRC).toMatch(/persistNow[\s\S]{0,600}repos\.dashboardLayouts\.save/);
    // The debounced editing buffer writes the LOCAL cache only.
    const debounceMatch = EDITOR_SRC.match(
      /useEffect\(\(\) => \{\s*if \(!dirty\) return;\s*const timer[\s\S]{0,200}?writeStoredLayout/,
    );
    expect(debounceMatch).toBeTruthy();
    expect(debounceMatch?.[0]).not.toContain("dashboardLayouts.save");
  });

  it("the prefix constant is exported for the twins (the single definition point)", () => {
    expect(DASHBOARD_LAYOUT_STORAGE_PREFIX).toBe("el-imtiyaz:dashboard-layout:");
  });

  it("a fake repository satisfying the contract passes through the provider type (compile-time pin)", async () => {
    // Type-level contract check + runtime smoke: any object implementing
    // load/save/clear is a valid DashboardLayoutRepository (structural).
    const fake: DashboardLayoutRepository = {
      load: vi.fn().mockResolvedValue({ ok: true, value: null } as const),
      save: vi.fn().mockResolvedValue({ ok: true, value: "now" } as const),
      clear: vi.fn().mockResolvedValue({ ok: true, value: undefined } as const),
    };
    const loaded = await fake.load("v");
    expect(loaded.ok).toBe(true);
  });
});
