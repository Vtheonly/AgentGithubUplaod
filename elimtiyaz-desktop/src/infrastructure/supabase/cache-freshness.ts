/**
 * T-034 / CROSS-104 — cache freshness policy for the Supabase-backed
 * repositories (desktop).
 *
 * DESIGN CHOICE (documented in the T-034 change-log entry and CROSS-104):
 * the desktop repositories keep their SubjectBehavior caches but re-seed
 * them under a freshness policy — a TTL (default 30s) PLUS a forced refresh
 * on window focus. Realtime subscriptions were deliberately NOT chosen for
 * this pass: they would multiply per-table channels and lifecycle concerns
 * (reconnect, teardown) across 9 repository caches, while the freshness
 * policy delivers the CROSS-104 freshness budget ("cross-client writes are
 * visible without restart") with one small, uniformly testable mechanism.
 * Realtime can still be layered on per-repository later (the website's
 * useFinancialRealtime is the reference implementation).
 *
 * WHY THE OLD BEHAVIOUR WAS A DEFECT: every cache used a one-shot
 * `seeded` boolean — once seeded, the server was never consulted again for
 * the lifetime of the app session, so payments/parents/ledger/... collected
 * by Android (or another desktop instance) stayed invisible until restart.
 *
 * MECHANICS (drop-in for the old boolean):
 *   - `shouldReseed()` replaces `if (this.seeded) return;`
 *   - `markSeeded()` replaces `this.seeded = true;` (call BEFORE the fetch —
 *     the old code marked first too, preventing concurrent seed stampedes;
 *     a FAILED seed now retries after the TTL instead of never, which also
 *     fixes the transient-failure-never-recovers corner of CROSS-104)
 *   - window `focus` forces the NEXT seed() to re-fetch (covers the most
 *     common "another client wrote while I was away" flow without waiting
 *     for the TTL)
 */

export const CACHE_TTL_MS = 30_000;

export class CacheFreshness {
  private seededAt = Number.NEGATIVE_INFINITY;
  private forced = false;
  private readonly onFocus: () => void;

  constructor(
    private readonly ttlMs: number = CACHE_TTL_MS,
    /** Test seam: deterministic clock. Defaults to the wall clock. */
    private readonly now: () => number = () => Date.now(),
    /** Where to attach the focus listener (auto-detected; inject [] for tests). */
    focusTarget?: { addEventListener(type: "focus", listener: () => void): void },
  ) {
    this.onFocus = () => {
      this.forced = true;
    };
    const target =
      focusTarget ??
      (typeof window !== "undefined"
        ? window
        : undefined);
    target?.addEventListener("focus", this.onFocus);
  }

  /** True when the cache is new enough. */
  shouldReseed(): boolean {
    if (this.forced) return true;
    return this.now() - this.seededAt > this.ttlMs;
  }

  markSeeded(): void {
    this.seededAt = this.now();
    this.forced = false;
  }

  /** Test/programmatic seam: force the next seed() to re-fetch. */
  forceRefresh(): void {
    this.forced = true;
  }
}
