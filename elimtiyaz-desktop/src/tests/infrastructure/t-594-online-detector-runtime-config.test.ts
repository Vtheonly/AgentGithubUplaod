/**
 * T-594 (BUG-058 / C-23) — the online-detector's /auth/v1/health probe
 * respects the EFFECTIVE runtime config.
 *
 * THE BUG: `getOnlineDetector()` resolved the probe URL from `supabaseUrl`
 * ALONE — the compiled/env/local-config URL, which stays NON-EMPTY even
 * while the app runs in MOCK mode (`useSupabase === false`: the local mock
 * toggle, VITE_USE_SUPABASE=false, or the Vitest hermetic default). Result:
 * the detector dripped `GET /auth/v1/health` every 30s — ~120 doomed
 * requests/hour against the configured (quota-capped OLD) project in a
 * session that was NEVER going to use the network — the third two-gates
 * seam member of the OPS-015 egress-loop family.
 *
 * THE CONTRACT (C-23, narrowed):
 *   - CONFIGURED mode (useSupabase true + URL): the probe heartbeat KEEPS
 *     running — it is the by-design health signal (T-050/CACHE-101);
 *   - MOCK/unconfigured mode (useSupabase false, or no URL): ZERO probes —
 *     ever. The detector is navigator-only. A URL sitting in the config
 *     while the app runs on mocks does NOT re-arm the drip.
 *
 * Method: the t-472-sanctioned configured-path pin — `el-imtiyaz.local-config`
 * localStorage pin + `vi.resetModules()` + dynamic import (the seam under
 * test is the module-constant resolution), with `fetch` stubbed to a
 * counting resolver so the census is exact.
 *
 * Run:
 *   npx vitest run src/tests/infrastructure/t-594-online-detector-runtime-config.test.ts
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const CONFIG_KEY = "el-imtiyaz.local-config";

async function freshDetectorModule() {
  vi.resetModules();
  // Both imports share the SAME fresh module graph (the detector's
  // transitive supabase-client === this direct reference).
  const detector = await import("../../infrastructure/sync/online-detector");
  const client = await import("../../infrastructure/supabase/supabase-client");
  return { detector, client };
}

function stubFetchCounting(status = 200): { calls: () => number } {
  let calls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      calls += 1;
      return new Response(null, { status });
    }),
  );
  return { calls: () => calls };
}

const settle = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe("T-594 — the detector's probe respects the effective runtime config", () => {
  beforeEach(() => {
    localStorage.removeItem(CONFIG_KEY);
  });
  afterEach(() => {
    localStorage.removeItem(CONFIG_KEY);
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("MOCK mode with a configured URL: ZERO probes — the drip never starts (the pre-fix code keyed the probe on the URL alone and dripped ~120 doomed requests/hour)", async () => {
    // The URL and key EXIST in the local config — the pre-fix defect's exact
    // shape — but the app runs in mock mode (useSupabase false).
    localStorage.setItem(
      CONFIG_KEY,
      JSON.stringify({
        supabase_url: "https://fake-t594-mock.supabase.co",
        supabase_anon_key: "sb_publishable_T594_FAKE",
        supabase_use_supabase: false,
      }),
    );
    const fetchProbe = stubFetchCounting();

    const { detector: mod, client } = await freshDetectorModule();
    // The effective runtime config IS mock mode.
    expect(client.useSupabase).toBe(false);
    expect(client.supabaseUrl).toBe("https://fake-t594-mock.supabase.co");

    const detector = mod.getOnlineDetector();
    detector.start();
    // Long enough for the class's own 30s interval to fire MANY times if a
    // probe URL had leaked through (the drip would be visible immediately).
    await settle(120);
    detector.stop();

    expect(fetchProbe.calls()).toBe(0); // ZERO probes — mock mode never drips
  });

  it("CONFIGURED mode: the /auth/v1/health heartbeat KEEPS running (the by-design health signal, T-050/CACHE-101)", async () => {
    localStorage.setItem(
      CONFIG_KEY,
      JSON.stringify({
        supabase_url: "https://fake-t594-configured.supabase.co",
        supabase_anon_key: "sb_publishable_T594_FAKE",
        supabase_use_supabase: true,
      }),
    );
    const fetchProbe = stubFetchCounting(200);

    const { detector: mod, client } = await freshDetectorModule();
    expect(client.useSupabase).toBe(true);
    expect(client.isSupabaseConfigured()).toBe(true);

    const detector = mod.getOnlineDetector();
    detector.start();
    await settle(120);
    detector.stop();

    expect(fetchProbe.calls()).toBeGreaterThanOrEqual(1); // the immediate probe ran
    expect(detector.getState().probeOk).toBe(true); // 200 → healthy
  });

  it("the class-level probe pace is governed by the 5s throttle floor (an explicit probe URL drips at most once per 5s even at a 40ms interval — the documented cadence contract)", async () => {
    // The CLASS keeps its by-design drip when constructed with an explicit
    // probe URL (CONFIGURED mode's shape); T-594 only gates WHICH mode
    // constructs it with a URL at all. The 5s throttle floor caps the pace:
    // over a 150ms window at interval=40ms, exactly ONE probe runs.
    const fetchProbe = stubFetchCounting(200);
    const { detector: mod } = await freshDetectorModule();
    const detector = new mod.OnlineDetector(
      "https://fake-t594-class.supabase.co/auth/v1/health",
      40, // a fast interval for the unit
      { apikey: "sb_publishable_T594_FAKE" },
    );
    detector.start();
    await settle(150);
    detector.stop();
    expect(fetchProbe.calls()).toBe(1); // the throttle floor — never faster than 5s apart
    expect(detector.getState().probeOk).toBe(true);
  });

  it("the pure helpers stay EXACTLY as before (the regression guard: resolveProbeUrl + probeAccepts)", async () => {
    const { detector: mod } = await freshDetectorModule();
    expect(mod.resolveProbeUrl(undefined)).toBeNull();
    expect(mod.resolveProbeUrl("")).toBeNull();
    expect(mod.resolveProbeUrl("not-a-url")).toBeNull();
    expect(mod.resolveProbeUrl("https://x.supabase.co/")).toBe("https://x.supabase.co/auth/v1/health");
    expect(mod.resolveProbeUrl("https://x.supabase.co///")).toBe("https://x.supabase.co/auth/v1/health");
    expect(mod.probeAccepts(200)).toBe(true);
    expect(mod.probeAccepts(401)).toBe(true);
    expect(mod.probeAccepts(301)).toBe(false);
    expect(mod.probeAccepts(503)).toBe(false);
  });
});
