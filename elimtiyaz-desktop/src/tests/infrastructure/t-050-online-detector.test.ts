/**
 * Regression test for T-050 (CACHE-101) — desktop OnlineDetector.
 *
 * The detector used to HEAD `https://www.google.com/generate_204` every 30
 * seconds with `mode: "no-cors"`:
 *   1. PRIVACY: a school financial app told Google the user's IP, session
 *      length and usage cadence, forever.
 *   2. CAPTIVE PORTAL: no-cors responses are opaque — a portal's 302 login
 *      page counted as "online", so SyncService drained into a broken
 *      network and the queue filled with failed entries.
 *
 * T-050 semantics under test:
 *   - the probe targets OUR configured Supabase project /auth/v1/health;
 *   - unconfigured (mock/dev) → NO network traffic at all;
 *   - cors mode, status readable: only 200 (healthy) or 401 (reachable)
 *     count as online — redirects/5xx are offline;
 *   - fail-closed: initial state offline until the first probe succeeds;
 *     any throw/abort → offline.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MODULE_SRC = join(__dirname, "..", "..", "infrastructure", "sync", "online-detector.ts");

import {
  OnlineDetector,
  probeAccepts,
  resolveProbeUrl,
} from "../../infrastructure/sync/online-detector";

const HEALTH = "https://acme-school.supabase.co/auth/v1/health";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("T-050 — probe target resolution (CACHE-101: our backend, not Google)", () => {
  it("maps a configured Supabase URL to its own auth health endpoint", () => {
    expect(resolveProbeUrl("https://example.supabase.co")).toBe(HEALTH);
  });

  it("normalizes trailing slashes and strips quotes", () => {
    expect(resolveProbeUrl('"https://example.supabase.co/"')).toBe(HEALTH);
  });

  it("yields null when unconfigured — no third-party probe, ever", () => {
    expect(resolveProbeUrl(undefined)).toBeNull();
    expect(resolveProbeUrl("")).toBeNull();
    expect(resolveProbeUrl("   ")).toBeNull();
  });

  it("yields null for non-URL garbage (never falls back to a public host)", () => {
    expect(resolveProbeUrl("not-a-url")).toBeNull();
    expect(resolveProbeUrl("your-project")).toBeNull();
  });

  it("the module no longer references google.com or supabase.com", () => {
    const src = readFileSync(MODULE_SRC, "utf8");
    expect(src).not.toContain("google.com");
    expect(src).not.toContain("supabase.com");
  });
});

describe("T-050 — probe verdict (captive-portal-proof)", () => {
  it("accepts 200 (healthy) and 401 (reachable, unauthenticated)", () => {
    expect(probeAccepts(200)).toBe(true);
    expect(probeAccepts(401)).toBe(true);
  });

  it("rejects redirects, 5xx and everything else", () => {
    expect(probeAccepts(301)).toBe(false);
    expect(probeAccepts(302)).toBe(false); // captive portal login redirect
    expect(probeAccepts(500)).toBe(false);
    expect(probeAccepts(503)).toBe(false);
  });
});

describe("T-050 — fail-closed state machine", () => {
  it("starts OFFLINE when a probe target is configured (until the first probe)", () => {
    const d = new OnlineDetector(HEALTH);
    expect(d.getState().probeOk).toBe(false);
    expect(d.getState().online).toBe(false);
  });

  it("a healthy 200 response (with apikey) brings it online", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 200 } as Response);
    vi.stubGlobal("fetch", fetchMock);
    const d = new OnlineDetector(HEALTH, 30_000, { apikey: "anon-key" });
    const ok = await d.probe();
    expect(ok).toBe(true);
    expect(d.getState().online).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      HEALTH,
      expect.objectContaining({ mode: "cors", method: "GET" }),
    );
  });

  it("sends the apikey header so the healthy path returns 200, not 401", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 200 } as Response);
    vi.stubGlobal("fetch", fetchMock);
    const d = new OnlineDetector(HEALTH, 30_000, { apikey: "anon-key" });
    await d.probe();
    expect(fetchMock).toHaveBeenCalledWith(
      HEALTH,
      expect.objectContaining({ headers: { apikey: "anon-key" } }),
    );
  });

  it("a network failure (DNS/timeout/refused) means OFFLINE", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const d = new OnlineDetector(HEALTH);
    const ok = await d.probe();
    expect(ok).toBe(false);
    expect(d.getState().online).toBe(false);
  });

  it("a captive-portal 302 means OFFLINE (status is now readable)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 302 } as Response));
    const d = new OnlineDetector(HEALTH);
    const ok = await d.probe();
    expect(ok).toBe(false);
    expect(d.getState().online).toBe(false);
  });

  it("unconfigured: probe() never touches the network and follows navigator", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const d = new OnlineDetector(null);
    const ok = await d.probe();
    expect(ok).toBe(d.getState().navigatorOnline);
    expect(fetchMock).not.toHaveBeenCalled();
    // navigator.onLine is true in jsdom by default → navigator-only semantics.
    expect(d.getState().online).toBe(d.getState().navigatorOnline);
  });
});
