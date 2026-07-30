/*
 * OnlineDetector — monitors the browser/Electron online status.
 *
 * Wraps `navigator.onLine` + the `online`/`offline` window events so
 * the rest of the app has a single typed API.
 *
 * The detector also performs an HTTP probe to confirm the network
 * is actually reachable (the `online` event only signals the
 * network interface is up — DNS may still be broken). The probe is
 * throttled to at most one per `probeIntervalMs`.
 */

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

const DEFAULT_PROBE_URL = "https://www.google.com/generate_204";
const DEFAULT_PROBE_INTERVAL_MS = 30_000;

export class OnlineDetector {
  protected state: OnlineState = {
    navigatorOnline: typeof navigator !== "undefined" ? navigator.onLine : true,
    probeOk: true,
    online: typeof navigator !== "undefined" ? navigator.onLine : true,
    changedAt: new Date().toISOString(),
  };
  protected listeners = new Set<(s: OnlineState) => void>();
  private lastProbeAt = 0;
  private probeTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    protected readonly probeUrl: string = DEFAULT_PROBE_URL,
    protected readonly probeIntervalMs: number = DEFAULT_PROBE_INTERVAL_MS,
  ) {}

  start(): void {
    if (typeof window === "undefined") return;
    window.addEventListener("online", this.handleNavigatorOnline);
    window.addEventListener("offline", this.handleNavigatorOffline);
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
    const now = Date.now();
    // Throttle.
    if (now - this.lastProbeAt < 5_000) return this.state.online;
    this.lastProbeAt = now;

    let probeOk = false;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5_000);
      const res = await fetch(this.probeUrl, {
        method: "HEAD",
        mode: "no-cors",
        cache: "no-store",
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      // In no-cors mode we can't read the status, but any non-throwing
      // response means the network is reachable.
      probeOk = true;
      void res;
    } catch {
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
  if (!_detector) _detector = new OnlineDetector();
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
