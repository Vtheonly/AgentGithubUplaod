/**
 * T-619 / BUG-055 — the login-screen "Erreur interne du serveur" blocker.
 *
 * The owner report (2026-11-24): "It refuses to login at all … it says error
 * in the server." Root cause chain (verified by live probes, NOT guessed):
 *
 *   1. The OLD project (vebfehrpzajhstyhinnw) is 402 quota-dead — every
 *      endpoint returns "Service for this project is restricted …
 *      exceed_egress_quota" (probed 2026-11-24).
 *   2. The NEW project (gvuvibcsfjhwcjikgxql) is ALIVE — auth health OK,
 *      a password grant with wrong credentials returns a proper
 *      400 invalid_credentials, and the admin users (admin3..6 + the
 *      owner) exist and are confirmed.
 *   3. An app whose EFFECTIVE target is the dead project (a stale backend
 *      profile, a stale local-config, or a pre-cutover build) gets the
 *      402 message on every auth request — and supabaseErrorToAppError
 *      matched NOTHING (no "network"/"fetch"/"timeout"/"JWT" substring),
 *      falling through to Errors.server → the login toast said
 *      "Erreur interne du serveur" with no actionable hint.
 *   4. Bonus lie: "Invalid login credentials" ALSO fell through to
 *      Errors.server — a wrong password showed "server error" too.
 *
 * The fix, pinned here:
 *   S1  the mapper recognizes the 402 quota-restriction →
 *       ERR_BACKEND_RESTRICTED with the actionable userMessage (NOT
 *       "Erreur interne du serveur").
 *   S2  the mapper maps invalid credentials → ERR_UNAUTHORIZED with
 *       "E-mail ou mot de passe incorrect." (NOT ERR_SERVER).
 *   S3  validateBackendProfile REJECTS a profile pinning a known-dead
 *       project (the stale-profile un-brick: the snapshot turns invalid
 *       → the live factory default governs).
 *   S4  buildBackendProfileSnapshot surfaces the dead-ref reason (the
 *       settings diagnostics show WHY).
 *   S5  resolveEffectiveSupabaseTarget quarantines a dead local-config
 *       target AND a dead profile target (belt-and-braces) — the
 *       env/factory chain governs instead.
 *   S6  a LIVE profile target still governs (no regression on the
 *       T-573 re-point path).
 *   S7  the auth repository surfaces the mapped userMessage on a
 *       quota-restricted sign-in (the end-to-end login-screen contract).
 */
import { describe, it, expect } from "vitest";
import {
  validateBackendProfile,
  buildBackendProfileSnapshot,
  isKnownDeadSupabaseProject,
  DEAD_SUPABASE_PROJECT_REFS,
  type BackendProfileV1,
} from "../../../electron/backend-profile-contract.cts";
import { supabaseErrorToAppError, resolveEffectiveSupabaseTarget } from "../../infrastructure/supabase/supabase-client";
import { SupabaseAuthRepository } from "../../infrastructure/supabase/repositories/supabase-auth-repository";
import type { SupabaseClient } from "@supabase/supabase-js";

const DEAD_URL = "https://vebfehrpzajhstyhinnw.supabase.co";
const LIVE_URL = "https://gvuvibcsfjhwcjikgxql.supabase.co";
const LIVE_KEY = "sb_publishable_live-key-for-tests";

describe("T-619 / BUG-055 — the quota-dead target is recognized and quarantined", () => {
  it("S1: the 402 quota-restriction maps to ERR_BACKEND_RESTRICTED (actionable), not ERR_SERVER", () => {
    const err = supabaseErrorToAppError({
      message:
        "Service for this project is restricted due to the following violations: exceed_egress_quota. The project owner must upgrade their plan or remove spend caps to restore service.",
    });
    expect(err.code).toBe("ERR_BACKEND_RESTRICTED");
    expect(err.userMessage).not.toBe("Erreur interne du serveur.");
    expect(err.userMessage).toContain("quota");
    // The code-only variant (HTTP status carried as code).
    expect(supabaseErrorToAppError({ code: "402", message: "Payment Required" }).code).toBe("ERR_BACKEND_RESTRICTED");
  });

  it("S2: invalid credentials map to ERR_UNAUTHORIZED (a wrong password is NOT a server error)", () => {
    const err = supabaseErrorToAppError({ code: "invalid_credentials", message: "Invalid login credentials" });
    expect(err.code).toBe("ERR_UNAUTHORIZED");
    expect(err.userMessage).toBe("E-mail ou mot de passe incorrect.");
    // The pre-fix behavior is dead: no ERR_SERVER for bad credentials.
    expect(err.code).not.toBe("ERR_SERVER");
  });

  it("S3: validateBackendProfile REJECTS a profile pinning the dead project (the stale-profile un-brick)", () => {
    const deadProfile = {
      profileVersion: 1,
      backendKind: "supabase",
      supabase: { url: DEAD_URL, anonKey: "sb_publishable_old" },
    };
    const verdict = validateBackendProfile(deadProfile);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toContain("known-dead project");
      expect(verdict.reason).toContain("vebfehrpzajhstyhinnw");
    }
    // The helper agrees on what is dead (and only the verified-dead refs).
    expect(isKnownDeadSupabaseProject(DEAD_URL)).toBe(true);
    expect(isKnownDeadSupabaseProject(LIVE_URL)).toBe(false);
    expect(isKnownDeadSupabaseProject(undefined)).toBe(false);
    expect(DEAD_SUPABASE_PROJECT_REFS).toContain("vebfehrpzajhstyhinnw");
  });

  it("S4: buildBackendProfileSnapshot surfaces the dead-ref reason — the factory default governs", () => {
    const snapshot = buildBackendProfileSnapshot(
      JSON.stringify({
        profileVersion: 1,
        backendKind: "supabase",
        supabase: { url: DEAD_URL, anonKey: "sb_publishable_old" },
      }),
      "/userData/backend-profile.json",
    );
    expect(snapshot.source).toBe("invalid");
    expect(snapshot.profile).toBeNull();
    expect(snapshot.invalidReason).toContain("known-dead project");
  });

  it("S5: resolveEffectiveSupabaseTarget quarantines dead local-config AND dead profile targets", () => {
    const base = {
      env: { url: undefined, publicKey: undefined, useSupabase: undefined },
      flags: { isProductionDesktopBuild: false, isVitestRun: true },
    };
    // A dead local-config target is dropped — the chain falls through
    // (vitest: unconfigured; the LIVE factory default outside vitest).
    const localDead = resolveEffectiveSupabaseTarget({
      ...base,
      profile: null,
      localConfig: { url: DEAD_URL, anonKey: "sb_publishable_old", useSupabase: true },
    });
    expect(localDead.profileApplied).toBe(false);
    expect(localDead.url).toBeUndefined(); // quarantined, not used
    expect(localDead.useSupabase).toBe(false); // vitest hermeticity: no factory fallback

    // A dead PROFILE target also loses governance (belt-and-braces).
    const deadProfile: BackendProfileV1 = {
      profileVersion: 1,
      backendKind: "supabase",
      supabase: { url: DEAD_URL, anonKey: "sb_publishable_old" },
    };
    const profileDead = resolveEffectiveSupabaseTarget({
      ...base,
      profile: deadProfile,
      localConfig: {},
    });
    expect(profileDead.profileApplied).toBe(false);
    expect(profileDead.url).toBeUndefined();
  });

  it("S6: a LIVE profile target still governs (no T-573 regression)", () => {
    const liveProfile: BackendProfileV1 = {
      profileVersion: 1,
      backendKind: "supabase",
      supabase: { url: LIVE_URL, anonKey: LIVE_KEY },
    };
    const out = resolveEffectiveSupabaseTarget({
      profile: liveProfile,
      localConfig: {},
      env: { url: undefined, publicKey: undefined, useSupabase: undefined },
      flags: { isProductionDesktopBuild: false, isVitestRun: true },
    });
    expect(out.profileApplied).toBe(true);
    expect(out.url).toBe(LIVE_URL);
    expect(out.anonKey).toBe(LIVE_KEY);
    expect(out.useSupabase).toBe(true);
  });

  it("S7: the auth repository surfaces the mapped userMessage on a quota-restricted sign-in", async () => {
    // A Supabase client whose signInWithPassword resolves the 402 body —
    // exactly what the dead project returns (probed 2026-11-24).
    const fakeClient = {
      auth: {
        signInWithPassword: async () => ({
          data: { user: null, session: null },
          error: {
            message:
              "Service for this project is restricted due to the following violations: exceed_egress_quota. The project owner must upgrade their plan or remove spend caps to restore service.",
          },
        }),
      },
    } as unknown as SupabaseClient;
    const repo = new SupabaseAuthRepository(fakeClient);
    const result = await repo.signIn("admin4@elimtiyaz.dz", "whatever");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // THE BUG-055 pin: the login screen's toast description must point
      // at the real problem — never the generic "Erreur interne du serveur."
      expect(result.error.code).toBe("ERR_BACKEND_RESTRICTED");
      expect(result.error.userMessage).toContain("quota");
      expect(result.error.userMessage).not.toBe("Erreur interne du serveur.");
    }
  });
});
