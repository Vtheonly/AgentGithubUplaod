/**
 * T-573 — the BackendProfile switcher verification suite (ADD-9).
 *
 * Gates:
 *  A. THE WIRE CONTRACT (fail-closed): the v1 validator's full matrix —
 *     version gate, kind gate, target rules, strict unknown keys, garbage.
 *  B. THE SNAPSHOT BUILDER: raw file text → file/factory/invalid sources.
 *  C. THE PROJECT-REF DERIVATION: the per-target session scoping.
 *  D. THE RESOLVER SWITCH MATRIX: profile present → target wins in EVERY
 *     build mode (the packaged re-point acceptance); profile absent → the
 *     pre-T-573 chain verbatim (production → factory; dev → localConfig →
 *     env → factory; vitest → unconfigured); non-supabase kinds → the
 *     honest mock fallback; useSupabase semantics incl. the explicit false.
 *  E. THE SESSION STORAGE KEY: the canonical string verbatim with no
 *     profile; the new-project key when re-pointed.
 *  F. THE MODULE-INIT MODULE (hermeticity unchanged): the static-import
 *     describeSupabaseConnection() — no bridge in vitest → factory/none.
 *  G. THE BACKEND-KIND-AWARE validateConnection MATRIX (RED-then-GREEN —
 *     the kind param stashed → the local/relay pins fail).
 *  H. THE R-1 MIRROR PINS: the vite-env.d.ts bridge declarations are
 *     type-identical to the wire contract (drift = a tsc error).
 *  I. THE PACKAGER TARGET RESOLUTION (the OPS-016 re-point): explicit
 *     target wins, env chain, factory default, the secret-key hard fail.
 */
import { describe, expect, expectTypeOf, it, vi, afterEach } from "vitest";

import {
  BACKEND_PROFILE_VERSION,
  buildBackendProfileSnapshot,
  deriveProjectRef,
  FACTORY_DEFAULT_PROJECT_REF,
  FACTORY_DEFAULT_SUPABASE_PUBLIC_KEY,
  FACTORY_DEFAULT_SUPABASE_URL,
  validateBackendProfile,
  type BackendProfileSnapshot,
  type BackendProfileV1,
} from "../../../electron/backend-profile-contract";
import {
  describeSupabaseConnection,
  resolveEffectiveSupabaseTarget,
  supabaseSessionStorageKey,
} from "../../infrastructure/supabase/supabase-client";
import { LocalConfigService } from "../../infrastructure/system-config";
// The packager's pure target-resolution helpers run as PLAIN NODE (.mjs —
// build-windows.mjs imports them at packaging time). The .d.mts sibling
// resolves cleanly (the earlier @ts-ignore was an unused suppression —
// TS2578 when converted to @ts-expect-error); the type surface below is
// pinned by gate I itself; vitest executes the real module.
import {
  isValidTargetKey,
  isValidTargetUrl,
  resolvePackageTarget,
} from "../../../scripts/package-target.mjs";

const NEW_PROJECT_URL = "https://gvuvibcsfjhwcjikgxql.supabase.co";
const NEW_PROJECT_KEY = "sb_publishable_0000000000000000000000000000test";

function supabaseProfile(overrides: Partial<BackendProfileV1> = {}): BackendProfileV1 {
  return {
    profileVersion: 1,
    backendKind: "supabase",
    supabase: { url: NEW_PROJECT_URL, anonKey: NEW_PROJECT_KEY },
    ...overrides,
  };
}

// ============================================================================
// A. The wire contract — fail-closed validation matrix
// ============================================================================

describe("T-573 A — the v1 wire contract validator (fail-closed)", () => {
  it("accepts a valid supabase-kind profile (url normalized, trailing slash stripped)", () => {
    const verdict = validateBackendProfile(
      supabaseProfile({ supabase: { url: `${NEW_PROJECT_URL}/`, anonKey: NEW_PROJECT_KEY } }),
    );
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.profile.supabase?.url).toBe(NEW_PROJECT_URL);
      expect(verdict.profile.supabase?.anonKey).toBe(NEW_PROJECT_KEY);
      expect(verdict.profile.profileVersion).toBe(BACKEND_PROFILE_VERSION);
    }
  });

  it("accepts a valid local-kind profile WITHOUT a target (Stage B declared)", () => {
    const verdict = validateBackendProfile({ profileVersion: 1, backendKind: "local", note: "bureau" });
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.profile.supabase).toBeUndefined();
  });

  it("accepts a valid relay-kind profile with any https origin (T-601 declared)", () => {
    const verdict = validateBackendProfile({
      profileVersion: 1,
      backendKind: "relay",
      supabase: { url: "https://relay.example.org", anonKey: NEW_PROJECT_KEY },
    });
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.profile.supabase?.url).toBe("https://relay.example.org");
  });

  it("FAILS on non-object inputs (null, array, string, number)", () => {
    for (const bad of [null, [], "profile", 42, true]) {
      const verdict = validateBackendProfile(bad);
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) expect(verdict.reason).toContain("must be a JSON object");
    }
  });

  it("FAILS on an unsupported profileVersion (the version gate)", () => {
    const verdict = validateBackendProfile({ profileVersion: 2, backendKind: "supabase" });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain("unsupported profileVersion: 2");
  });

  it("FAILS on an unknown backendKind (the kind gate)", () => {
    const verdict = validateBackendProfile({
      profileVersion: 1,
      backendKind: "postgres-on-a-usb-stick",
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain("unknown backendKind");
  });

  it("FAILS on unknown top-level keys (strict v1)", () => {
    const verdict = validateBackendProfile({
      profileVersion: 1,
      backendKind: "local",
      serviceRoleKey: "never",
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain("unknown top-level key(s): serviceRoleKey");
  });

  it("FAILS: supabase kind requires a target; local kind FORBIDS one", () => {
    const missing = validateBackendProfile({ profileVersion: 1, backendKind: "supabase" });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.reason).toContain("requires a supabase target");

    const forbidden = validateBackendProfile({
      profileVersion: 1,
      backendKind: "local",
      supabase: { url: NEW_PROJECT_URL, anonKey: NEW_PROJECT_KEY },
    });
    expect(forbidden.ok).toBe(false);
    if (!forbidden.ok) expect(forbidden.reason).toContain("must not carry a supabase target");
  });

  it("FAILS: supabase-kind url must be a *.supabase.co https origin; relay url any https", () => {
    const wrongHost = validateBackendProfile({
      profileVersion: 1,
      backendKind: "supabase",
      supabase: { url: "https://relay.example.org", anonKey: NEW_PROJECT_KEY },
    });
    expect(wrongHost.ok).toBe(false);
    if (!wrongHost.ok) expect(wrongHost.reason).toContain("https://<ref>.supabase.co");

    const http = validateBackendProfile({
      profileVersion: 1,
      backendKind: "supabase",
      supabase: { url: "http://gvuvibcsfjhwcjikgxql.supabase.co", anonKey: NEW_PROJECT_KEY },
    });
    expect(http.ok).toBe(false);
    if (!http.ok) expect(http.reason).toContain("https:// origin");
  });

  it("FAILS on an empty/missing anonKey, a non-boolean useSupabase, and an oversized note", () => {
    const noKey = validateBackendProfile({
      profileVersion: 1,
      backendKind: "supabase",
      supabase: { url: NEW_PROJECT_URL, anonKey: "   " },
    });
    expect(noKey.ok).toBe(false);
    if (!noKey.ok) expect(noKey.reason).toContain("non-empty public key");

    const badFlag = validateBackendProfile({
      profileVersion: 1,
      backendKind: "supabase",
      supabase: { url: NEW_PROJECT_URL, anonKey: NEW_PROJECT_KEY, useSupabase: "yes" },
    });
    expect(badFlag.ok).toBe(false);
    if (!badFlag.ok) expect(badFlag.reason).toContain("useSupabase must be a boolean");

    const badTargetKey = validateBackendProfile({
      profileVersion: 1,
      backendKind: "supabase",
      supabase: { url: NEW_PROJECT_URL, anonKey: NEW_PROJECT_KEY, surprise: 1 },
    });
    expect(badTargetKey.ok).toBe(false);
    if (!badTargetKey.ok) expect(badTargetKey.reason).toContain("unknown supabase-target key");

    const longNote = validateBackendProfile({
      profileVersion: 1,
      backendKind: "local",
      note: "x".repeat(501),
    });
    expect(longNote.ok).toBe(false);
    if (!longNote.ok) expect(longNote.reason).toContain("500 characters");
  });
});

// ============================================================================
// B. The snapshot builder — file / factory / invalid
// ============================================================================

describe("T-573 B — buildBackendProfileSnapshot (the main-process read path)", () => {
  const FILE_PATH = "C:\\Users\\owner\\AppData\\Roaming\\el-imtiyaz\\backend-profile.json";

  it("a missing/unreadable file (null) → the FACTORY source, profile null", () => {
    const snapshot = buildBackendProfileSnapshot(null, FILE_PATH);
    expect(snapshot).toEqual({ profile: null, source: "factory", filePath: FILE_PATH });
  });

  it("garbage JSON → invalid with the parse reason (fail-closed, never a crash)", () => {
    const snapshot = buildBackendProfileSnapshot("{not json", FILE_PATH);
    expect(snapshot.source).toBe("invalid");
    expect(snapshot.profile).toBeNull();
    expect(snapshot.invalidReason).toContain("not valid JSON");
  });

  it("valid JSON → the validated profile with the FILE source", () => {
    const snapshot = buildBackendProfileSnapshot(JSON.stringify(supabaseProfile()), FILE_PATH);
    expect(snapshot.source).toBe("file");
    expect(snapshot.profile?.backendKind).toBe("supabase");
    expect(snapshot.profile?.supabase?.url).toBe(NEW_PROJECT_URL);
  });

  it("valid JSON with an INVALID shape → invalid with the validator's reason", () => {
    const snapshot = buildBackendProfileSnapshot(
      JSON.stringify({ profileVersion: 9, backendKind: "supabase" }),
      FILE_PATH,
    );
    expect(snapshot.source).toBe("invalid");
    if (!snapshot.profile) expect(snapshot.invalidReason).toContain("unsupported profileVersion");
  });
});

// ============================================================================
// C. The project-ref derivation (the per-target session scoping)
// ============================================================================

describe("T-573 C — deriveProjectRef (the storageKey scope)", () => {
  it("the factory default and the historical refs derive from their hosts", () => {
    // T-614 cutover (2026-11-22): the factory default IS the relocation
    // target gvuvibcsfjhwcjikgxql (the OLD canonical vebfehrpzajhstyhinnw
    // is 402-quota-dead; both refs kept pinned — the derivation must work
    // for either host).
    expect(deriveProjectRef(FACTORY_DEFAULT_SUPABASE_URL)).toBe("gvuvibcsfjhwcjikgxql");
    expect(deriveProjectRef(NEW_PROJECT_URL)).toBe("gvuvibcsfjhwcjikgxql");
    expect(deriveProjectRef("https://vebfehrpzajhstyhinnw.supabase.co")).toBe("vebfehrpzajhstyhinnw");
  });

  it("a non-supabase host sanitizes into a storage-key-safe label; garbage/empty yields null", () => {
    // The sanitize rule: lowercase, every non [a-z0-9-] byte → '-' (dots
    // included — a storage key, not a hostname).
    expect(deriveProjectRef("https://relay.example.org")).toBe("relay-example-org");
    expect(deriveProjectRef("https://My-Relay-Host")).toBe("my-relay-host");
    expect(deriveProjectRef(undefined)).toBeNull();
    expect(deriveProjectRef("not a url")).toBeNull();
  });
});

// ============================================================================
// D. The resolver switch matrix (the packaged re-point acceptance)
// ============================================================================

describe("T-573 D — resolveEffectiveSupabaseTarget (the switch matrix)", () => {
  const DEV = { isProductionDesktopBuild: false, isVitestRun: false };
  const PROD = { isProductionDesktopBuild: true, isVitestRun: false };
  const VITEST = { isProductionDesktopBuild: false, isVitestRun: true };

  it("a supabase-kind profile GOVERNS in production (the packaged re-point — no rebuild)", () => {
    const effective = resolveEffectiveSupabaseTarget({
      profile: supabaseProfile(),
      localConfig: {},
      env: {},
      flags: PROD,
    });
    expect(effective.url).toBe(NEW_PROJECT_URL);
    expect(effective.anonKey).toBe(NEW_PROJECT_KEY);
    expect(effective.useSupabase).toBe(true);
    expect(effective.backendKind).toBe("supabase");
    expect(effective.profileApplied).toBe(true);
  });

  it("a supabase-kind profile GOVERNS in dev too (it outranks the local config)", () => {
    const effective = resolveEffectiveSupabaseTarget({
      profile: supabaseProfile(),
      localConfig: { url: "https://old-config.supabase.co", anonKey: "stale", useSupabase: false },
      env: { url: "https://env.supabase.co", publicKey: "env-key" },
      flags: DEV,
    });
    expect(effective.url).toBe(NEW_PROJECT_URL);
    expect(effective.anonKey).toBe(NEW_PROJECT_KEY);
    expect(effective.useSupabase).toBe(true);
    expect(effective.profileApplied).toBe(true);
  });

  it("an explicit useSupabase:false on the profile target is honored (the honest off switch)", () => {
    const effective = resolveEffectiveSupabaseTarget({
      profile: supabaseProfile({ supabase: { url: NEW_PROJECT_URL, anonKey: NEW_PROJECT_KEY, useSupabase: false } }),
      localConfig: {},
      env: {},
      flags: PROD,
    });
    expect(effective.url).toBe(NEW_PROJECT_URL);
    expect(effective.useSupabase).toBe(false);
  });

  it("NO profile + production → the factory default verbatim (pre-T-573 behavior)", () => {
    const effective = resolveEffectiveSupabaseTarget({ profile: null, localConfig: {}, env: {}, flags: PROD });
    expect(effective.url).toBe(FACTORY_DEFAULT_SUPABASE_URL);
    expect(effective.anonKey).toBe(FACTORY_DEFAULT_SUPABASE_PUBLIC_KEY);
    expect(effective.useSupabase).toBe(true);
    expect(effective.backendKind).toBe("supabase");
    expect(effective.profileApplied).toBe(false);
  });

  it("NO profile + dev → the pre-T-573 chain: localConfig → env → factory", () => {
    const viaLocal = resolveEffectiveSupabaseTarget({
      profile: null,
      localConfig: { url: NEW_PROJECT_URL, anonKey: NEW_PROJECT_KEY },
      env: {},
      flags: DEV,
    });
    expect(viaLocal.url).toBe(NEW_PROJECT_URL);
    expect(viaLocal.anonKey).toBe(NEW_PROJECT_KEY);

    const viaEnv = resolveEffectiveSupabaseTarget({
      profile: null,
      localConfig: {},
      env: { url: NEW_PROJECT_URL, publicKey: NEW_PROJECT_KEY },
      flags: DEV,
    });
    expect(viaEnv.url).toBe(NEW_PROJECT_URL);

    const viaFactory = resolveEffectiveSupabaseTarget({ profile: null, localConfig: {}, env: {}, flags: DEV });
    expect(viaFactory.url).toBe(FACTORY_DEFAULT_SUPABASE_URL);
  });

  it("NO profile + vitest → UNCONFIGURED (the T-472 hermeticity seam is unchanged)", () => {
    const effective = resolveEffectiveSupabaseTarget({
      profile: null,
      localConfig: {},
      env: { useSupabase: "false" },
      flags: VITEST,
    });
    expect(effective.url).toBeUndefined();
    expect(effective.anonKey).toBeUndefined();
    expect(effective.useSupabase).toBe(false);
  });

  it("non-supabase profile kinds (local/relay) contribute NO target and yield the honest mock fallback", () => {
    for (const kind of ["local", "relay"] as const) {
      const effective = resolveEffectiveSupabaseTarget({
        profile: { profileVersion: 1, backendKind: kind },
        localConfig: {},
        env: {},
        flags: PROD,
      });
      expect(effective.backendKind).toBe(kind);
      expect(effective.profileApplied).toBe(false);
      // The wiring is NOT activated from a non-supabase profile — the honest
      // mock fallback (the diagnostics label the declared kind):
      expect(effective.useSupabase).toBe(false);
    }
  });

  it("VITE_USE_SUPABASE=false still opts dev OUT (no profile) — the dev mock contract", () => {
    const effective = resolveEffectiveSupabaseTarget({
      profile: null,
      localConfig: {},
      env: { useSupabase: "false" },
      flags: DEV,
    });
    expect(effective.useSupabase).toBe(false);
  });
});

// ============================================================================
// E. The session storage key — canonical verbatim / per-target after re-point
// ============================================================================

describe("T-573 E — supabaseSessionStorageKey (the per-target scope)", () => {
  it("the factory default (post-T-614: the relocation target) scopes to its own ref", () => {
    expect(supabaseSessionStorageKey(FACTORY_DEFAULT_SUPABASE_URL)).toBe(
      "el-imtiyaz.supabase.session.gvuvibcsfjhwcjikgxql",
    );
  });

  it("the OLD canonical project's sessions keep their legacy scope (orphaned by design)", () => {
    // T-614 cutover note: sessions persisted under the OLD ref are inert
    // after the re-point (a different storageKey = a clean logout, never a
    // cross-project session replay).
    expect(supabaseSessionStorageKey("https://vebfehrpzajhstyhinnw.supabase.co")).toBe(
      "el-imtiyaz.supabase.session.vebfehrpzajhstyhinnw",
    );
  });

  it("no url → the factory ref fallback (never a bare/empty scope)", () => {
    expect(supabaseSessionStorageKey(undefined)).toBe(
      `el-imtiyaz.supabase.session.${FACTORY_DEFAULT_PROJECT_REF}`,
    );
  });
});

// ============================================================================
// F. The module init under vitest — hermeticity + the diagnostics label
// ============================================================================

describe("T-573 F — the module-init behavior inside Vitest (no bridge)", () => {
  it("describeSupabaseConnection reports the factory/none state (additive fields only)", () => {
    const described = describeSupabaseConnection();
    expect(described.backendKind).toBe("supabase");
    expect(described.profileSource).toBe("none");
    expect(described.projectRef).toBe("gvuvibcsfjhwcjikgxql");
    // The pre-T-573 fields keep their vitest hermeticity values:
    expect(described.configured).toBe(false);
    expect(described.useSupabase).toBe(false);
    expect(described.isProductionBuild).toBe(false);
    expect(described.keyFormat).toBe("missing");
  });
});

// ============================================================================
// G. The backend-kind-aware validateConnection matrix (RED-then-GREEN)
// ============================================================================

describe("T-573 G — LocalConfigService.validateConnection (the kind matrix)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("the LOCAL kind needs NO url/key and performs ZERO network I/O", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const service = new LocalConfigService();
    const result = await service.validateConnection("", "", "local");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.connected).toBe(true);
      expect(result.value.note).toContain("local");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("the RELAY kind admits any https origin and probes its REACHABILITY", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => new Response("ok", { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const service = new LocalConfigService();
    const result = await service.validateConnection("https://relay.example.org", NEW_PROJECT_KEY, "relay");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.connected).toBe(true);
      expect(result.value.note).toContain("v0");
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://relay.example.org");
  });

  it("the RELAY kind rejects a non-https origin (fail-closed)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const service = new LocalConfigService();
    const result = await service.validateConnection("http://relay.example.org", NEW_PROJECT_KEY, "relay");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("https:// origin");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("the SUPABASE kind keeps the CURRENT check verbatim: non-supabase.co https is rejected", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const service = new LocalConfigService();
    const result = await service.validateConnection("https://relay.example.org", NEW_PROJECT_KEY);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("https://xxxx.supabase.co format");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("the SUPABASE kind rejects a local:// scheme and keeps the canonical probe shape", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => new Response("[]", { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const service = new LocalConfigService();

    const localScheme = await service.validateConnection("local://db", NEW_PROJECT_KEY);
    expect(localScheme.ok).toBe(false);
    if (!localScheme.ok) expect(localScheme.error.message).toContain("URL and anon key are required");

    const canonical = await service.validateConnection(FACTORY_DEFAULT_SUPABASE_URL, NEW_PROJECT_KEY);
    expect(canonical.ok).toBe(true);
    if (canonical.ok) {
      expect(canonical.value.connected).toBe(true);
      expect(canonical.value.note).toContain("anonyme");
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(`${FACTORY_DEFAULT_SUPABASE_URL}/rest/v1/tenants?select=id&limit=1`);
  });
});

// ============================================================================
// H. The R-1 mirror pins — the vite-env bridge declarations vs the contract
// ============================================================================

describe("T-573 H — the R-1 bridge mirror (vite-env.d.ts ↔ the wire contract)", () => {
  it("the snapshot mirror is type-identical to the wire contract's snapshot", () => {
    expectTypeOf<BackendProfileSnapshotMirror>().toEqualTypeOf<BackendProfileSnapshot>();
  });

  it("the write-result mirror is type-identical to the wire contract's write result", () => {
    type ContractWriteResult = Awaited<
      ReturnType<NonNullable<Window["elImtiyaz"]>["backendProfile"]["write"]>
    >;
    expectTypeOf<ContractWriteResult>().toEqualTypeOf<BackendProfileWriteResultMirror>();
  });

  it("getSync's snapshot type matches the contract (the init-time snapshot is the SAME shape)", () => {
    type BridgeSnapshot = ReturnType<
      NonNullable<Window["elImtiyaz"]>["backendProfile"]["getSync"]
    >;
    expectTypeOf<BridgeSnapshot>().toEqualTypeOf<BackendProfileSnapshot | null>();
  });
});

// ============================================================================
// I. The packager target resolution (the OPS-016 re-point)
// ============================================================================

describe("T-573 I — resolvePackageTarget (the packager's readiness re-point)", () => {
  it("the explicit target wins over everything (the packaged re-point)", () => {
    const resolved = resolvePackageTarget({
      processEnv: { EL_IMTIYAZ_TARGET_URL: NEW_PROJECT_URL, EL_IMTIYAZ_TARGET_KEY: NEW_PROJECT_KEY },
      viteEnv: { VITE_SUPABASE_URL: "https://fromvite.supabase.co" },
    });
    expect(resolved.url).toBe(NEW_PROJECT_URL);
    expect(resolved.key).toBe(NEW_PROJECT_KEY);
    expect(resolved.source).toContain("explicit target");
  });

  it("no explicit target → the VITE_* env chain, else the FACTORY DEFAULT", () => {
    const viaVite = resolvePackageTarget({
      processEnv: {},
      viteEnv: { VITE_SUPABASE_URL: NEW_PROJECT_URL, VITE_SUPABASE_PUBLISHABLE_KEY: NEW_PROJECT_KEY },
    });
    expect(viaVite.url).toBe(NEW_PROJECT_URL);

    const factory = resolvePackageTarget({ processEnv: {}, viteEnv: {} });
    expect(factory.url).toBe(FACTORY_DEFAULT_SUPABASE_URL);
    expect(factory.key).toBe(FACTORY_DEFAULT_SUPABASE_PUBLIC_KEY);
    expect(factory.source).toContain("factory default");
  });

  it("a service-role/secret key or a placeholder is NEVER a valid target key", () => {
    expect(isValidTargetKey("sb_secret_AAAA1111BBBB2222CCCC3333DDDD4444EEEE5555FFFF6666")).toBe(false);
    expect(isValidTargetKey("placeholder")).toBe(false);
    expect(isValidTargetKey("")).toBe(false);
    expect(isValidTargetKey(NEW_PROJECT_KEY)).toBe(true);
  });

  it("the target URL must be an https origin (any host — readiness, not identity)", () => {
    expect(isValidTargetUrl(NEW_PROJECT_URL)).toBe(true);
    expect(isValidTargetUrl("https://relay.example.org")).toBe(true);
    expect(isValidTargetUrl("http://relay.example.org")).toBe(false);
    expect(isValidTargetUrl("not a url")).toBe(false);
  });
});
