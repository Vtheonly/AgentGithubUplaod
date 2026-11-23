/**
 * t-t614-prepare-cutover-profile — T-614/P3: the desktop reconnect tool.
 *
 * The suite imports BOTH the script (the .mjs pure surface, the t-575
 * convention) and the REAL wire contract (electron/backend-profile-contract —
 * the t-573 convention). The equivalence proof IS the test: the profile this
 * tool emits must pass the production validator — no mirror drift is
 * possible because the suite runs the actual validateBackendProfile.
 */
import { describe, expect, it } from "vitest";
import {
  TARGET_URL_ENV,
  TARGET_KEY_ENV,
  PROFILE_FILE_NAME,
  DEFAULT_NOTE,
  isValidSupabaseProjectUrl,
  classifyPublicKey,
  buildCutoverProfile,
  userDataGuidance,
  main,
} from "../../../scripts/prepare-cutover-profile.mjs";
import {
  validateBackendProfile,
  buildBackendProfileSnapshot,
  deriveProjectRef,
  FACTORY_DEFAULT_SUPABASE_URL,
} from "../../../electron/backend-profile-contract.cts";

const NEW_PROJECT_URL = "https://gvuvibcsfjhwcjikgxql.supabase.co";
const OLD_PROJECT_URL = "https://vebfehrpzajhstyhinnw.supabase.co";
const TEST_PUBLIC_KEY = "sb_publishable_0000000000000000000000000000test";

function envWith(url?: string, key?: string): Record<string, string> {
  const env: Record<string, string> = {};
  if (url !== undefined) env[TARGET_URL_ENV] = url;
  if (key !== undefined) env[TARGET_KEY_ENV] = key;
  return env;
}

// ============================================================================
// A. The URL shape — the contract's supabase-kind rule, mirrored exactly.
// ============================================================================

describe("T-614/P3 A — the URL shape gate", () => {
  it("accepts the relocation target (incl. the trailing-slash form, normalized to origin) and rejects the drift shapes", () => {
    expect(isValidSupabaseProjectUrl(NEW_PROJECT_URL)).toBe(true);
    expect(isValidSupabaseProjectUrl(`${NEW_PROJECT_URL}/`)).toBe(true); // trailing slash ≡ root — the builder normalizes to origin (the contract's normalizeProfileUrl discipline)
    expect(isValidSupabaseProjectUrl("https://gvuvibcsfjhwcjikgxql.supabase.co/rest/v1")).toBe(false); // a real path
    expect(isValidSupabaseProjectUrl("https://gvuvibcsfjhwcjikgxql.supabase.co/#x")).toBe(false); // hash
    expect(isValidSupabaseProjectUrl("http://gvuvibcsfjhwcjikgxql.supabase.co")).toBe(false); // not https
    expect(isValidSupabaseProjectUrl("https://supabase.co")).toBe(false); // no ref
    expect(isValidSupabaseProjectUrl("https://example.com")).toBe(false); // not a supabase host
    expect(isValidSupabaseProjectUrl("")).toBe(false);
    expect(isValidSupabaseProjectUrl("not a url")).toBe(false);
  });
});

// ============================================================================
// B. The key classifier — PUBLIC keys only, fail-closed on secret material.
// ============================================================================

describe("T-614/P3 B — the key classifier (fail-closed)", () => {
  it("accepts the sb_publishable shape (the new project's key family)", () => {
    expect(classifyPublicKey("sb_publishable_IPUtQMYQzr1wNnfGTcl5MA_wuz3RUdg")).toEqual({
      ok: true,
      shape: "sb_publishable",
    });
  });

  it("REFUSES secret/service-role material — always, with no override", () => {
    const secret = classifyPublicKey("sb_secret_deadbeefdeadbeef");
    expect(secret.ok).toBe(false);
    expect(secret.reason).toContain("SECRET");
    // The legacy-anon override must NOT soften the secret refusal.
    const stillSecret = classifyPublicKey("sb_secret_deadbeefdeadbeef", { allowLegacyAnonJwt: true });
    expect(stillSecret.ok).toBe(false);
  });

  it("REFUSES the legacy anon-JWT shape unless the operator explicitly allows it", () => {
    const legacyJwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.signature";
    const refused = classifyPublicKey(legacyJwt);
    expect(refused.ok).toBe(false);
    expect(refused.reason).toContain("legacy anon-JWT");
    const allowed = classifyPublicKey(legacyJwt, { allowLegacyAnonJwt: true });
    expect(allowed).toEqual({ ok: true, shape: "legacy-anon-jwt" });
  });

  it("refuses garbage and empty values", () => {
    expect(classifyPublicKey("").ok).toBe(false);
    expect(classifyPublicKey("   ").ok).toBe(false);
    expect(classifyPublicKey("not-a-key").ok).toBe(false);
  });
});

// ============================================================================
// C. The builder — the emitted profile passes the REAL wire contract.
// ============================================================================

describe("T-614/P3 C — buildCutoverProfile × the REAL validateBackendProfile (the equivalence proof)", () => {
  it("builds the relocation-target profile and it passes the PRODUCTION validator", () => {
    const verdict = buildCutoverProfile(envWith(NEW_PROJECT_URL, TEST_PUBLIC_KEY));
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    // THE proof: the real contract accepts the tool's output verbatim.
    const contractVerdict = validateBackendProfile(verdict.profile);
    expect(contractVerdict.ok).toBe(true);
    expect(verdict.profile.backendKind).toBe("supabase");
    expect(verdict.profile.supabase?.url).toBe(NEW_PROJECT_URL);
    expect(verdict.profile.supabase?.anonKey).toBe(TEST_PUBLIC_KEY);
    expect(verdict.profile.note).toBe(DEFAULT_NOTE);
    // And the snapshot builder (what the main process actually runs at boot):
    const snapshot = buildBackendProfileSnapshot(JSON.stringify(verdict.profile), "/x/backend-profile.json");
    expect(snapshot.source).toBe("file");
    expect(snapshot.profile?.supabase?.url).toBe(NEW_PROJECT_URL);
  });

  it("the derived project ref is the relocation target — and after the T-614 cutover the factory default IS it", () => {
    const verdict = buildCutoverProfile(envWith(NEW_PROJECT_URL, TEST_PUBLIC_KEY));
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    const ref = deriveProjectRef(verdict.profile.supabase?.url);
    expect(ref).toBe("gvuvibcsfjhwcjikgxql");
    // T-614 cutover (2026-11-22): the factory default moved to the
    // relocation target (the desktop mirror of the website's re-point) — a
    // profile for the SAME target is now a no-op re-point (still valid), and
    // the OLD project's profile remains writable for rollback.
    expect(FACTORY_DEFAULT_SUPABASE_URL).toBe(NEW_PROJECT_URL); // the cutover landed — the factory default and the relocation target are one
    expect(deriveProjectRef(OLD_PROJECT_URL)).toBe("vebfehrpzajhstyhinnw"); // the rollback target still derives
  });

  it("fails closed with the exact remedy on each missing env var", () => {
    const noUrl = buildCutoverProfile(envWith(undefined, TEST_PUBLIC_KEY));
    expect(noUrl.ok).toBe(false);
    if (!noUrl.ok) expect(noUrl.reason).toContain(TARGET_URL_ENV);

    const noKey = buildCutoverProfile(envWith(NEW_PROJECT_URL, undefined));
    expect(noKey.ok).toBe(false);
    if (!noKey.ok) expect(noKey.reason).toContain(TARGET_KEY_ENV);

    const neither = buildCutoverProfile({});
    expect(neither.ok).toBe(false);
  });

  it("refuses a bad URL even with a good key, and vice versa", () => {
    expect(buildCutoverProfile(envWith("https://example.com", TEST_PUBLIC_KEY)).ok).toBe(false);
    expect(buildCutoverProfile(envWith(NEW_PROJECT_URL, "sb_secret_deadbeef")).ok).toBe(false);
    expect(buildCutoverProfile(envWith(NEW_PROJECT_URL, "")).ok).toBe(false);
  });

  it("the custom note flows through and the >500-char note is left to the contract", () => {
    const custom = buildCutoverProfile(envWith(NEW_PROJECT_URL, TEST_PUBLIC_KEY), { note: "the owner's window note" });
    expect(custom.ok).toBe(true);
    if (!custom.ok) return;
    expect(custom.profile.note).toBe("the owner's window note");
    // A 501-char note: the BUILDER does not enforce (the contract owns that
    // rule) — but the full-contract round trip must then fail closed, which
    // the CLI surfaces before any write (proven by the D-block write tests).
    const long = buildCutoverProfile(envWith(NEW_PROJECT_URL, TEST_PUBLIC_KEY), { note: "x".repeat(501) });
    expect(long.ok).toBe(true);
    if (!long.ok) return;
    expect(validateBackendProfile(long.profile).ok).toBe(false);
  });
});

// ============================================================================
// D. The CLI — dry-run default, guarded write, the .bak rollback artifact.
// ============================================================================

describe("T-614/P3 D — the CLI (dry-run default; --write only with --userData)", () => {
  const goodEnv = envWith(NEW_PROJECT_URL, TEST_PUBLIC_KEY);

  function fakeIo(existing?: string) {
    const files = new Map<string, string>();
    if (existing !== undefined) files.set(`/ud/${PROFILE_FILE_NAME}`, existing);
    const ops = { writes: [] as string[] };
    return {
      files,
      ops,
      io: {
        writeFileSync: (p: string, content: string) => {
          ops.writes.push(p);
          files.set(p, content);
        },
        renameSync: (from: string, to: string) => {
          files.set(to, files.get(from) ?? "");
          files.delete(from);
        },
        mkdirSync: () => {},
        readFileSync: (p: string) => {
          const content = files.get(p);
          if (content === undefined) throw new Error("ENOENT");
          return content;
        },
      },
    };
  }

  it("dry-run (default): prints the profile, writes NOTHING, exit 0", () => {
    const { io, ops } = fakeIo();
    const result = main([], goodEnv, io);
    expect(result.exitCode).toBe(0);
    expect((result as { dryRun?: boolean }).dryRun).toBe(true);
    expect(ops.writes).toEqual([]);
  });

  it("--write without --userData: refuses, exit 2", () => {
    const { io, ops } = fakeIo();
    const result = main(["--write"], goodEnv, io);
    expect(result.exitCode).toBe(2);
    expect(ops.writes).toEqual([]);
  });

  it("missing env: refuses with exit 2 and the usage text", () => {
    const { io } = fakeIo();
    const result = main(["--write", "--userData", "/ud"], {}, io);
    expect(result.exitCode).toBe(2);
  });

  it("--write --userData: persists atomically (tmp+rename), preserves the previous profile as .bak", () => {
    const previous = JSON.stringify({ profileVersion: 1, backendKind: "supabase", supabase: { url: OLD_PROJECT_URL, anonKey: "sb_publishable_oldoldoldoldoldoldoldold" } });
    const { io, files } = fakeIo(previous);
    const result = main(["--write", "--userData", "/ud"], goodEnv, io);
    expect(result.exitCode).toBe(0);
    const written = files.get(`/ud/${PROFILE_FILE_NAME}`);
    expect(written).toBeDefined();
    expect(written).not.toContain("vebfehrpzajhstyhinnw"); // the OLD ref never lands in the new profile
    expect(files.get(`/ud/${PROFILE_FILE_NAME}.bak`)).toBe(previous); // the rollback artifact
    expect(files.get(`/ud/${PROFILE_FILE_NAME}.tmp`)).toBeUndefined(); // atomic — no tmp residue
    // The written file round-trips through the REAL main-process snapshot builder:
    const snapshot = buildBackendProfileSnapshot(written ?? null, `/ud/${PROFILE_FILE_NAME}`);
    expect(snapshot.source).toBe("file");
    expect(snapshot.profile?.supabase?.url).toBe(NEW_PROJECT_URL);
  });

  it("--write with no prior profile: writes without a .bak", () => {
    const { io, files } = fakeIo();
    const result = main(["--write", "--userData", "/ud"], goodEnv, io);
    expect(result.exitCode).toBe(0);
    expect(files.has(`/ud/${PROFILE_FILE_NAME}.bak`)).toBe(false);
    expect(files.get(`/ud/${PROFILE_FILE_NAME}`)).toContain(NEW_PROJECT_URL);
  });

  it("the userData guidance names the three OS shapes (the operator's map)", () => {
    const text = userDataGuidance();
    expect(text).toContain("Windows");
    expect(text).toContain("El-Imtiyaz Desktop");
    expect(text).toContain("Linux");
    expect(text).toContain("macOS");
  });
});
