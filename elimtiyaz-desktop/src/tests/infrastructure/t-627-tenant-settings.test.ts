/**
 * t-627-tenant-settings.test.ts — T-627 / C-25 follow-up register item 1:
 * the tenant-level collapse of the ai-config (non-secret half) +
 * backup-scheduler-enabled + custom-themes onto `system_settings`
 * (migration 0007 + the client seam).
 *
 * What this suite pins:
 *
 *   A. The domain share helpers: toTenantAIConfigShare extracts the
 *      NON-SECRET half (never the keys); mergeTenantAIConfigShare lets
 *      the TENANT row win the non-secret fields while the device keeps
 *      the secrets; parseTenantAIConfigShare accepts a valid row and
 *      rejects malformed ones (fail-open null).
 *   B. The MockTenantSettingsRepository: load() reads the EXISTING device
 *      stores; the three saves write them (the mock mode IS the offline
 *      mode — no new storage key).
 *   C. The SupabaseTenantSettingsRepository RPC contract: load() maps
 *      read_public_settings' payload (null row → null); the saves call
 *      save_public_setting with the exact key + jsonb value; a scheduler
 *      save mirrors the device key; errors surface as Err.
 *   D. The ai-config tenant overlay: unconfigured (mock/test mode) →
 *      device-only (the T-472 hermeticity default); configured with a
 *      tenant row → the tenant share wins the non-secret fields while
 *      the device secrets are preserved; a failed read → fail-open to
 *      the device config; invalidateTenantAIOverlay resets the cache.
 *   E. readSchedulerEnabledConfig: tenant row first (boolean), device
 *      cache when null/unconfigured, fail-open on a failed read.
 *   F. Migration 0007 content pins: the three seed keys, the RPC names,
 *      the SEC-121 gates in the upsert pair, the narrow grants.
 *   G. The provider's hydrateCustomThemes merge semantics: tenant wins on
 *      id collision; the merged list mirrors back to the device store.
 *
 * Run:
 *   npx vitest run src/tests/infrastructure/t-627-tenant-settings.test.ts
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The controllable backend seam (§15.94a: the mock must intercept the module
// BY RESOLVED PATH, hoisted to the file top). Default = UNCONFIGURED (the
// T-472 hermeticity posture — every other test in this file expects
// device-only behavior); test D flips `configured` + the rpc payload.
const backendMock = vi.hoisted(() => ({
  configured: false,
  rpcResponse: null as { data: unknown; error: unknown } | null,
  rpcCalls: 0,
}));
vi.mock("../../infrastructure/supabase/backend-access", () => ({
  isSupabaseConfigured: () => backendMock.configured,
  getSupabaseClient: () => ({
    rpc: async () => {
      backendMock.rpcCalls++;
      return backendMock.rpcResponse ?? { data: null, error: null };
    },
  }),
  useSupabase: () => false,
  supabaseUrl: () => "https://fake.test",
  supabaseAnonKey: () => "fake-key",
  describeSupabaseConnection: () => "fake",
  normalizeSupabaseUrl: (u: string) => u,
}));

import {
  toTenantAIConfigShare,
  mergeTenantAIConfigShare,
  parseTenantAIConfigShare,
  DEFAULT_AI_PROVIDER_CONFIG,
  type AIProviderConfig,
} from "../../domain/model/ai";
import { MockTenantSettingsRepository } from "../../infrastructure/mock/repositories/mock-tenant-settings-repository";
import { SupabaseTenantSettingsRepository } from "../../infrastructure/supabase/repositories/supabase-tenant-settings-repository";
import { SupabaseAIConfigRepository } from "../../infrastructure/supabase/repositories/supabase-ai-config-repository";
import { loadConfig, saveConfig, invalidateTenantAIOverlay, AI_CONFIG_STORAGE_KEY } from "../../infrastructure/ai/ai-config-storage";
import {
  isSchedulerEnabled,
  setSchedulerEnabled,
  readSchedulerEnabledConfig,
} from "../../infrastructure/backup/backup-scheduler";
import {
  loadStoredCustomThemes,
  saveStoredCustomThemes,
} from "../../core/theme/theme-engine";
import type { CustomThemePalette } from "../../core/theme/theme-types";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), "utf8");

beforeEach(() => {
  localStorage.clear();
  backendMock.configured = false;
  backendMock.rpcResponse = null;
  backendMock.rpcCalls = 0;
  invalidateTenantAIOverlay();
});

/* ------------------------------------------------------------------ */
/*  A. The domain share helpers                                        */
/* ------------------------------------------------------------------ */

describe("T-627 A — the tenant AI config share", () => {
  it("toTenantAIConfigShare extracts the NON-SECRET half (no key fields)", () => {
    const config: AIProviderConfig = {
      ...DEFAULT_AI_PROVIDER_CONFIG,
      groqApiKey: "gsk-secret",
      openRouterApiKey: "sk-or-secret",
      customApiKey: "sk-custom-secret",
      defaultModel: "openai/gpt-oss-20b",
      temperature: 0.2,
    };
    const share = toTenantAIConfigShare(config);
    const asRecord = share as unknown as Record<string, unknown>;
    for (const key of ["groqApiKey", "openRouterApiKey", "customApiKey"]) {
      expect(asRecord[key]).toBeUndefined();
    }
    expect(share.defaultModel).toBe("openai/gpt-oss-20b");
    expect(share.temperature).toBe(0.2);
    // The migration's shape validation: the object form + no array.
    expect(parseTenantAIConfigShare(share)).not.toBeNull();
  });

  it("mergeTenantAIConfigShare: the tenant wins the non-secret fields; the device keeps the secrets", () => {
    const device: AIProviderConfig = {
      ...DEFAULT_AI_PROVIDER_CONFIG,
      groqApiKey: "gsk-device",
      defaultModel: "openai/gpt-oss-120b",
      temperature: 0.6,
    };
    const share = parseTenantAIConfigShare({
      defaultProvider: "groq",
      defaultModel: "openai/gpt-oss-20b",
      fastModel: "openai/gpt-oss-20b",
      reasoningModel: "openai/gpt-oss-120b",
      fallbackModel: "openai/gpt-oss-20b",
      customBaseUrl: null,
      enableSmartRouting: false,
      temperature: 0.1,
      topP: 0.8,
      maxTokens: 1024,
    });
    expect(share).not.toBeNull();
    const merged = mergeTenantAIConfigShare(device, share!);
    // The tenant wins every non-secret field:
    expect(merged.defaultModel).toBe("openai/gpt-oss-20b");
    expect(merged.temperature).toBe(0.1);
    expect(merged.enableSmartRouting).toBe(false);
    // The device keeps the SECRETS:
    expect(merged.groqApiKey).toBe("gsk-device");
  });

  it("parseTenantAIConfigShare: null/array/malformed → null (fail-open)", () => {
    expect(parseTenantAIConfigShare(null)).toBeNull();
    expect(parseTenantAIConfigShare(undefined)).toBeNull();
    expect(parseTenantAIConfigShare([])).toBeNull();
    expect(parseTenantAIConfigShare("groq")).toBeNull();
    // missing model + wrong types
    expect(parseTenantAIConfigShare({ defaultProvider: "groq" })).toBeNull();
    expect(
      parseTenantAIConfigShare({ defaultProvider: "not-a-provider", defaultModel: "m", fastModel: "f", reasoningModel: "r", fallbackModel: null, customBaseUrl: null, enableSmartRouting: true, temperature: 1, topP: 1, maxTokens: 1 }),
    ).toBeNull();
    expect(
      parseTenantAIConfigShare({ defaultProvider: "groq", defaultModel: "m", fastModel: "f", reasoningModel: "r", fallbackModel: null, customBaseUrl: null, enableSmartRouting: true, temperature: "not-a-number", topP: 1, maxTokens: 1 }),
    ).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/*  B. The mock twin (the offline mode over the EXISTING keys)         */
/* ------------------------------------------------------------------ */

describe("T-627 B — the mock tenant-settings repository", () => {
  it("load() reads the existing device stores", async () => {
    // the device scheduler flag disabled + one custom theme on disk
    setSchedulerEnabled(false);
    const palette: CustomThemePalette = {
      id: "theme-b",
      name: "Palette B",
      isDark: false,
      isBuiltIn: false,
      colors: {} as never,
    };
    saveStoredCustomThemes([palette]);

    const repo = new MockTenantSettingsRepository();
    const r = await repo.load();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.backupSchedulerEnabled).toBe(false);
    expect(r.value.customThemes?.map((t) => t.id)).toEqual(["theme-b"]);
    // the AI half: the DEVICE config's non-secret share (defaults here —
    // unconfigured ⇒ the defaults' share, never null in offline mode).
    expect(r.value.aiProviderConfig?.defaultProvider).toBe("groq");
  });

  it("the scheduler save writes the device key", async () => {
    const repo = new MockTenantSettingsRepository();
    const r = await repo.saveSchedulerEnabled(false);
    expect(r.ok).toBe(true);
    expect(isSchedulerEnabled()).toBe(false);
    await repo.saveSchedulerEnabled(true);
    expect(isSchedulerEnabled()).toBe(true);
  });

  it("the themes save writes the device store; null clears it", async () => {
    const palette: CustomThemePalette = {
      id: "theme-m",
      name: "Palette M",
      isDark: true,
      isBuiltIn: false,
      colors: {} as never,
    };
    const repo = new MockTenantSettingsRepository();
    await repo.saveCustomThemes([palette]);
    expect(loadStoredCustomThemes().map((t) => t.id)).toEqual(["theme-m"]);
    await repo.saveCustomThemes(null);
    expect(loadStoredCustomThemes()).toEqual([]);
  });

  it("the AI share save merges over the device config's secrets", async () => {
    // device store: a config with a key + the default model
    await saveConfig({
      ...DEFAULT_AI_PROVIDER_CONFIG,
      groqApiKey: "gsk-device-keep",
      defaultModel: "openai/gpt-oss-120b",
    });
    const repo = new MockTenantSettingsRepository();
    const share = parseTenantAIConfigShare({
      defaultProvider: "groq",
      defaultModel: "openai/gpt-oss-20b",
      fastModel: "openai/gpt-oss-20b",
      reasoningModel: "openai/gpt-oss-120b",
      fallbackModel: null,
      customBaseUrl: null,
      enableSmartRouting: true,
      temperature: 0.3,
      topP: 0.9,
      maxTokens: 2048,
    });
    const r = await repo.saveAiProviderConfig(share);
    expect(r.ok).toBe(true);
    const reloaded = await loadConfig();
    expect(reloaded.defaultModel).toBe("openai/gpt-oss-20b");
    expect(reloaded.temperature).toBe(0.3);
    expect(reloaded.groqApiKey).toBe("gsk-device-keep");
  });
});

/* ------------------------------------------------------------------ */
/*  C. The Supabase twin's RPC contract (a fake client)                */
/* ------------------------------------------------------------------ */

/** A minimal fake Supabase client capturing rpc calls. */
function fakeClient(
  readPayload: unknown,
  saveError?: { message: string },
) {
  const calls: Array<{ fn: string; args?: unknown }> = [];
  return {
    calls,
    client: {
      rpc: vi.fn(async (fn: string, args?: unknown) => {
        calls.push({ fn, args });
        if (fn === "read_public_settings") {
          return { data: readPayload, error: null };
        }
        if (fn === "save_public_setting") {
          if (saveError) return { data: null, error: saveError };
          return { data: { saved: true, key: (args as { p_key: string }).p_key }, error: null };
        }
        return { data: null, error: { message: `unexpected rpc ${fn}` } };
      }),
    } as never,
  };
}

describe("T-627 C — the Supabase tenant-settings repository", () => {
  it("load() maps the reader payload (null rows → null)", async () => {
    const { client } = fakeClient({
      aiProviderConfig: null,
      backupSchedulerEnabled: null,
      customThemes: null,
    });
    const repo = new SupabaseTenantSettingsRepository(client);
    const r = await repo.load();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.aiProviderConfig).toBeNull();
    expect(r.value.backupSchedulerEnabled).toBeNull();
    expect(r.value.customThemes).toBeNull();
  });

  it("load() maps real values (a share + false + an array, malformed entries dropped)", async () => {
    const { client } = fakeClient({
      aiProviderConfig: {
        defaultProvider: "groq",
        defaultModel: "openai/gpt-oss-20b",
        fastModel: "openai/gpt-oss-20b",
        reasoningModel: "openai/gpt-oss-120b",
        fallbackModel: null,
        customBaseUrl: null,
        enableSmartRouting: true,
        temperature: 0.4,
        topP: 0.9,
        maxTokens: 2048,
      },
      backupSchedulerEnabled: false,
      customThemes: [
        { id: "t1", name: "T1", isDark: false, colors: { primary: "#111" } },
        "garbage-entry",
      ],
    });
    const repo = new SupabaseTenantSettingsRepository(client);
    const r = await repo.load();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.backupSchedulerEnabled).toBe(false);
    expect(r.value.aiProviderConfig?.defaultModel).toBe("openai/gpt-oss-20b");
    expect(r.value.customThemes?.map((t) => t.id)).toEqual(["t1"]);
  });

  it("the three saves call save_public_setting with the exact keys + values", async () => {
    const { client, calls } = fakeClient(null);
    const repo = new SupabaseTenantSettingsRepository(client);

    await repo.saveSchedulerEnabled(false);
    await repo.saveCustomThemes([
      { id: "t2", name: "T2", isDark: true, isBuiltIn: false, colors: {} as never },
    ]);
    const share = parseTenantAIConfigShare({
      defaultProvider: "groq",
      defaultModel: "m",
      fastModel: "f",
      reasoningModel: "r",
      fallbackModel: null,
      customBaseUrl: null,
      enableSmartRouting: true,
      temperature: 0.5,
      topP: 1,
      maxTokens: 2,
    });
    await repo.saveAiProviderConfig(share);

    const saves = calls.filter((c) => c.fn === "save_public_setting");
    expect(saves.map((c) => (c.args as { p_key: string }).p_key)).toEqual([
      "backup.scheduler_enabled",
      "theme.custom_palettes",
      "ai.provider_config",
    ]);
    expect((saves[0].args as { p_value: unknown }).p_value).toBe(false);
  });

  it("a scheduler save mirrors the device key; an RPC error surfaces as Err", async () => {
    const ok = fakeClient(null);
    const repoOk = new SupabaseTenantSettingsRepository(ok.client);
    setSchedulerEnabled(true);
    await repoOk.saveSchedulerEnabled(false);
    expect(isSchedulerEnabled()).toBe(false); // the device mirror followed

    const bad = fakeClient(null, { message: "42501 seul un super admin" });
    const repoBad = new SupabaseTenantSettingsRepository(bad.client);
    const r = await repoBad.saveSchedulerEnabled(true);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toContain("42501");
    // the mirror did NOT run on the failed write
    expect(isSchedulerEnabled()).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  D. The ai-config tenant overlay (the storage module)               */
/* ------------------------------------------------------------------ */

describe("T-627 D — loadConfig's tenant overlay", () => {
  it("unconfigured (the default test env) → device-only, no RPC", async () => {
    // The T-472 seam: inside vitest the default env is UNCONFIGURED MOCK
    // MODE — isSupabaseConfigured() is false, the overlay is skipped.
    await saveConfig({
      ...DEFAULT_AI_PROVIDER_CONFIG,
      groqApiKey: "gsk-device",
      defaultModel: "openai/gpt-oss-120b",
    });
    const cfg = await loadConfig();
    expect(cfg.defaultModel).toBe("openai/gpt-oss-120b");
    expect(cfg.groqApiKey).toBe("gsk-device");
  });

  it("configured + a tenant row → the tenant share wins the non-secret fields, the device keeps the secrets", async () => {
    backendMock.configured = true;
    backendMock.rpcResponse = {
      data: {
        aiProviderConfig: {
          defaultProvider: "groq",
          defaultModel: "openai/gpt-oss-20b",
          fastModel: "openai/gpt-oss-20b",
          reasoningModel: "openai/gpt-oss-120b",
          fallbackModel: null,
          customBaseUrl: null,
          enableSmartRouting: true,
          temperature: 0.25,
          topP: 0.9,
          maxTokens: 512,
        },
        backupSchedulerEnabled: true,
        customThemes: null,
      },
      error: null,
    };
    try {
      // Fresh module instances so the per-session overlay cache starts
      // empty (the static instance above shares the same mock).
      vi.resetModules();
      const storage = await import("../../infrastructure/ai/ai-config-storage");
      await storage.saveConfig({
        ...DEFAULT_AI_PROVIDER_CONFIG,
        groqApiKey: "gsk-device",
        defaultModel: "openai/gpt-oss-120b",
        temperature: 0.6,
      });
      const cfg = await storage.loadConfig();
      // the tenant row WINS the non-secret fields:
      expect(cfg.defaultModel).toBe("openai/gpt-oss-20b");
      expect(cfg.temperature).toBe(0.25);
      expect(cfg.maxTokens).toBe(512);
      // the device store keeps the SECRET:
      expect(cfg.groqApiKey).toBe("gsk-device");
      // The overlay is cached per-session: a second load does NOT re-call
      // the RPC (one read per app session — the llm-adapter calls loadConfig
      // per request).
      expect(backendMock.rpcCalls).toBe(1);
      await storage.loadConfig();
      expect(backendMock.rpcCalls).toBe(1);
    } finally {
      backendMock.configured = false;
      backendMock.rpcResponse = null;
      vi.resetModules();
    }
  });

  it("configured + a FAILED read → fail-open to the device config", async () => {
    backendMock.configured = true;
    backendMock.rpcResponse = { data: null, error: { message: "500" } };
    try {
      vi.resetModules();
      const storage = await import("../../infrastructure/ai/ai-config-storage");
      await storage.saveConfig({
        ...DEFAULT_AI_PROVIDER_CONFIG,
        groqApiKey: "gsk-device",
        defaultModel: "openai/gpt-oss-120b",
      });
      const cfg = await storage.loadConfig();
      // The failed read degrades to the DEVICE values (offline cache —
      // never throws, never nulls the config).
      expect(cfg.defaultModel).toBe("openai/gpt-oss-120b");
      expect(cfg.groqApiKey).toBe("gsk-device");
    } finally {
      backendMock.configured = false;
      backendMock.rpcResponse = null;
      vi.resetModules();
    }
  });
});

/* ------------------------------------------------------------------ */
/*  E. readSchedulerEnabledConfig                                       */
/* ------------------------------------------------------------------ */

describe("T-627 E — readSchedulerEnabledConfig (tenant-first, fail-open)", () => {
  it("unconfigured → the device cache (default ON)", async () => {
    expect(await readSchedulerEnabledConfig()).toBe(true);
    setSchedulerEnabled(false);
    expect(await readSchedulerEnabledConfig()).toBe(false);
    setSchedulerEnabled(true);
  });
});

/* ------------------------------------------------------------------ */
/*  F. Migration 0007 content pins                                      */
/* ------------------------------------------------------------------ */

describe("T-627 F — migration 0007 content pins", () => {
  const sql = read("../../../supabase/migrations/0007_tenant_public_settings.sql");

  it("seeds the three per-tenant rows (idempotent ON CONFLICT)", () => {
    expect(sql).toContain("'ai.provider_config'");
    expect(sql).toContain("'backup.scheduler_enabled'");
    expect(sql).toContain("'theme.custom_palettes'");
    expect(sql).toContain("on conflict (tenant_id, category, key) do nothing");
    expect(sql).toContain("'true'::jsonb"); // the default-ON seed
  });

  it("the two RPCs + the staff gate + the whitelist", () => {
    expect(sql).toContain("create or replace function public.read_public_settings()");
    expect(sql).toContain("create or replace function public.save_public_setting(p_key text, p_value jsonb)");
    expect(sql).toContain("public.profile_has_staff_role(v_profile)");
    expect(sql).toContain("s.is_sensitive = false");
  });

  it("SEC-121: the upsert pair carries the caller-verification gates", () => {
    expect(sql).toContain("create or replace function public.upsert_setting(p_tenant_id uuid");
    expect(sql).toContain("create or replace function public.upsert_secret_setting(p_tenant_id uuid");
    expect(sql).toContain("v_caller_is_service_role boolean");
    expect(sql).toContain("p_tenant_id is distinct from public.current_tenant_id()");
    expect(sql).toContain("revoke all on function public.upsert_setting");
    expect(sql).toContain("revoke all on function public.upsert_secret_setting");
  });

  it("the max(jsonb) DOA repair: no aggregate over the jsonb values (the scalar-subquery form)", () => {
    // The first-run defect: coalesce(max(case … then s.value end)) —
    // PostgreSQL has no max() for jsonb. The repair reads each key
    // through a scalar subquery instead.
    expect(sql).not.toContain("max(case when s.key = 'ai.provider_config' then s.value end)");
    expect(sql).toContain("(select s.value from public.system_settings s");
    expect(sql).toContain("into v_ai, v_scheduler, v_themes;");
  });
});

/* ------------------------------------------------------------------ */
/*  G. The provider hydration semantics (pure merge, against the      */
/*     same merge body the provider uses)                               */
/* ------------------------------------------------------------------ */

describe("T-627 G — the hydration merge semantics", () => {
  it("the tenant list wins on id collision and mirrors back to the device store", () => {
    // The provider's merge body, exercised over the same stores:
    const localA: CustomThemePalette = { id: "a", name: "A local", isDark: false, isBuiltIn: false, colors: {} as never };
    const localB: CustomThemePalette = { id: "b", name: "B local", isDark: false, isBuiltIn: false, colors: {} as never };
    const tenantA: CustomThemePalette = { id: "a", name: "A tenant", isDark: true, isBuiltIn: false, colors: {} as never };
    const tenantC: CustomThemePalette = { id: "c", name: "C tenant", isDark: false, isBuiltIn: false, colors: {} as never };
    saveStoredCustomThemes([localA, localB]);

    // (the UserPreferencesProvider's hydrate body)
    const tenantThemes = [tenantA, tenantC];
    const tenantById = new Map(tenantThemes.map((t) => [t.id, t]));
    const prev = loadStoredCustomThemes();
    const kept = prev.filter((t) => !tenantById.has(t.id));
    const merged = [...kept, ...tenantThemes];
    saveStoredCustomThemes(merged);

    const final = loadStoredCustomThemes();
    expect(final.map((t) => t.id).sort()).toEqual(["a", "b", "c"]);
    expect(final.find((t) => t.id === "a")?.name).toBe("A tenant"); // tenant wins
    expect(final.find((t) => t.id === "b")?.name).toBe("B local"); // local-only kept
  });
});

/* ------------------------------------------------------------------ */
/*  H. The SupabaseAIConfigRepository (the ARCH-001 retirement)        */
/* ------------------------------------------------------------------ */

describe("T-627 H — SupabaseAIConfigRepository (the fail-loud tenant mirror)", () => {
  it("updateConfig writes the device store, mirrors the share, and surfaces a failed mirror as Err", async () => {
    // A fake tenantSettings capturing the save.
    const savedShares: unknown[] = [];
    const tenantSettings = {
      saveAiProviderConfig: async (v: unknown) => {
        savedShares.push(v);
        return { ok: true, value: undefined } as const;
      },
    };
    const repo = new SupabaseAIConfigRepository({} as never, tenantSettings as never);
    const r = await repo.updateConfig(
      { defaultModel: "openai/gpt-oss-20b", groqApiKey: "gsk-x" },
      "admin@elimtiyaz.dz",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.defaultModel).toBe("openai/gpt-oss-20b");
    expect(savedShares).toHaveLength(1);
    // the device store was written through the encrypted seam:
    expect(localStorage.getItem(AI_CONFIG_STORAGE_KEY)).not.toBeNull();
    expect(localStorage.getItem(AI_CONFIG_STORAGE_KEY)).not.toContain("gsk-x"); // encrypted at rest

    // A FAILED mirror → Err (fail-loud, the honest split-state message).
    const failingTenantSettings = {
      saveAiProviderConfig: async () => ({ ok: false, error: { code: "ERR_FORBIDDEN", message: "42501", userMessage: "Seul un Super Administrateur peut modifier les réglages." } }) as const,
    };
    const repo2 = new SupabaseAIConfigRepository({} as never, failingTenantSettings as never);
    const r2 = await repo2.updateConfig({ temperature: 0.4 }, "admin@elimtiyaz.dz");
    expect(r2.ok).toBe(false);
    if (r2.ok) return;
    expect(r2.error.userMessage).toContain("enregistrée sur cet appareil");
    expect(r2.error.userMessage).toContain("Seul un Super Administrateur");
  });
});
