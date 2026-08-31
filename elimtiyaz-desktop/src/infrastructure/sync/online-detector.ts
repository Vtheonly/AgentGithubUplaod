/*
 * OnlineDetector — monitors the browser/Electron online status.
 *
 * Wraps `navigator.onLine` + the `online`/`offline` window events so
 * the rest of the app has a single typed API.
 *
 * The detector also performs an HTTP probe to confirm the network is
 * actually reachable (the `online` event only signals the network
 * interface is up — DNS may still be broken). The probe is throttled to
 * at most one per `probeIntervalMs`.
 *
 * T-050 (CACHE-101): the probe targets OUR configured Supabase project's
 * `/auth/v1/health` endpoint (never a third-party host — no metadata
 * leak), runs in `cors` mode so the response STATUS
 * is readable (a captive portal's redirect/login page no longer counts
 * as "online"), and fails CLOSED: any throw, abort, or non-
 * {200, 401} status means offline. When no Supabase URL is configured
 * (mock/dev mode) the detector does not probe at all and follows
 * `navigator.onLine` only.
 */

import { supabaseUrl, supabaseAnonKey } from "../supabase/supabase-client";

export interface OnlineState {
  /** Whether the browser reports `navigator.onLine`. */
  navigatorOnline: boolean;
  /** Whether the last HTTP probe succeeded. */
  probeOk: boolean;
  /** Combined: true only when both signals are positive. */
  online: boolean;
  /** ISO timestamp of the last state change. */
  changedAt: string;
}

const DEFAULT_PROBE_INTERVAL_MS = 30_000;

/**
 * Resolve the probe endpoint from the CONFIGURED Supabase URL, or null when
 * unconfigured (mock/dev mode — then the detector never makes a request).
 */
export function resolveProbeUrl(url: string | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim().replace(/"/g, "");
  if (!/^https?:\/\//.test(trimmed)) return null;
  return trimmed.replace(/\/+$/, "") + "/auth/v1/health";
}

/**
 * Probe verdict: 200 = healthy (with apikey) · 401 = reachable but
 * unauthenticated — both prove the REAL auth service answered. A redirect
 * (captive portal login) or 5xx does not.
 */
export function probeAccepts(status: number): boolean {
  return status === 200 || status === 401;
}

export class OnlineDetector {
  protected state: OnlineState = {
    navigatorOnline: typeof navigator !== "undefined" ? navigator.onLine : true,
    // Fail-closed until the first probe completes — but when there is
    // nothing to probe (unconfigured), trust navigator alone.
    probeOk: true,
    online: typeof navigator !== "undefined" ? navigator.onLine : true,
    changedAt: new Date().toISOString(),
  };
  protected listeners = new Set<(s: OnlineState) => void>();
  private lastProbeAt = 0;
  private probeTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    /** Probe endpoint; null/undefined = never probe (navigator-only). */
    protected readonly probeUrl: string | null | undefined = null,
    protected readonly probeIntervalMs: number = DEFAULT_PROBE_INTERVAL_MS,
    /** Sent with the probe (apikey → healthy 200 instead of 401). */
    protected readonly probeHeaders: Record<string, string> = {},
  ) {
    if (this.probeUrl) {
      // Configured: fail-closed until the first probe result lands.
      this.update({ probeOk: false });
    }
  }

  start(): void {
    if (typeof window === "undefined") return;
    window.addEventListener("online", this.handleNavigatorOnline);
    window.addEventListener("offline", this.handleNavigatorOffline);
    if (!this.probeUrl) return; // unconfigured: navigator-only, zero requests
    // Probe immediately so we don't trust the initial navigator.onLine alone.
    void this.probe();
    this.probeTimer = setInterval(() => void this.probe(), this.probeIntervalMs);
  }

  stop(): void {
    if (typeof window === "undefined") return;
    window.removeEventListener("online", this.handleNavigatorOnline);
    window.removeEventListener("offline", this.handleNavigatorOffline);
    if (this.probeTimer) clearInterval(this.probeTimer);
    this.probeTimer = null;
  }

  getState(): OnlineState {
    return { ...this.state };
  }

  subscribe(fn: (s: OnlineState) => void): () => void {
    this.listeners.add(fn);
    fn(this.getState());
    return () => this.listeners.delete(fn);
  }

  /** Force a probe now — used by tests + after a failed sync attempt. */
  async probe(): Promise<boolean> {
    if (!this.probeUrl) {
      // Unconfigured: nothing to probe — keep navigator-only semantics.
      return this.state.navigatorOnline;
    }
    const now = Date.now();
    // Throttle.
    if (now - this.lastProbeAt < 5_000) return this.state.online;
    this.lastProbeAt = now;

    let probeOk = false;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5_000);
      const res = await fetch(this.probeUrl, {
        method: "GET",
        // cors (not no-cors): Supabase serves `access-control-allow-origin: *`
        // on /auth/v1/health, so the STATUS is readable — a captive portal's
        // opaque redirect no longer passes for "online" (CACHE-101).
        mode: "cors",
        cache: "no-store",
        headers: this.probeHeaders,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      probeOk = probeAccepts(res.status);
    } catch {
      // FAIL-CLOSED: DNS failure / timeout / refused / CORS rejection → offline.
      probeOk = false;
    }
    this.update({ probeOk });
    return probeOk;
  }

  private handleNavigatorOnline = () => {
    this.update({ navigatorOnline: true });
    // Re-probe immediately when the OS says we're back online.
    void this.probe();
  };

  private handleNavigatorOffline = () => {
    this.update({ navigatorOnline: false, probeOk: false });
  };

  private update(patch: Partial<OnlineState>): void {
    const prevOnline = this.state.online;
    const next: OnlineState = {
      ...this.state,
      ...patch,
      changedAt: new Date().toISOString(),
    };
    next.online = next.navigatorOnline && next.probeOk;
    this.state = next;
    if (next.online !== prevOnline) {
      for (const fn of this.listeners) fn(this.getState());
    }
  }
}

/** Singleton detector — the entire app shares one. */
let _detector: OnlineDetector | null = null;
export function getOnlineDetector(): OnlineDetector {
  if (!_detector) {
    // T-050 (CACHE-101): probe OUR backend, not a third-party host; no probe at all
    // when the Supabase URL is unconfigured (mock/dev mode).
    const probeUrl = resolveProbeUrl(supabaseUrl);
    const headers: Record<string, string> = supabaseAnonKey ? { apikey: supabaseAnonKey } : {};
    _detector = new OnlineDetector(probeUrl, DEFAULT_PROBE_INTERVAL_MS, headers);
  }
  return _detector;
}

/** Test-only: reset the singleton. */
export function _resetOnlineDetectorForTests(): void {
  if (_detector) _detector.stop();
  _detector = null;
}

/**
 * Test helper: a stub OnlineDetector whose state can be controlled
 * directly. Used by SyncService tests to simulate online/offline
 * transitions without relying on `navigator.onLine` (which jsdom
 * doesn't reliably set).
 */
export class StubOnlineDetector extends OnlineDetector {
  constructor(initialOnline = true) {
    super();
    this.state = {
      navigatorOnline: initialOnline,
      probeOk: initialOnline,
      online: initialOnline,
      changedAt: new Date().toISOString(),
    };
  }

  start(): void {
    // No-op — we don't want window listeners in tests.
  }
  stop(): void {
    // No-op.
  }
  getState(): OnlineState {
    return { ...this.state };
  }
  subscribe(fn: (s: OnlineState) => void): () => void {
    this.listeners.add(fn);
    fn(this.getState());
    return () => this.listeners.delete(fn);
  }
  async probe(): Promise<boolean> {
    return this.state.online;
  }

  /** Test-only: force the state + notify subscribers. */
  setOnline(online: boolean): void {
    this.state = {
      navigatorOnline: online,
      probeOk: online,
      online,
      changedAt: new Date().toISOString(),
    };
    for (const fn of this.listeners) fn(this.getState());
  }
}
