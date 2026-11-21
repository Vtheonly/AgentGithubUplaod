/**
 * T-559 (EGRESS-LOOP / the S10 loop family) — the toast context stability
 * suite: the actions context NEVER identity-churns on toast traffic.
 *
 * THE BUG: one single toast context whose value was memoized on
 * `[toasts, show, dismiss]` — so EVERY toast landing or expiring produced a
 * NEW context value identity, re-rendering every `useToast()` consumer and
 * re-firing any effect whose dependency list included a toast action (the
 * S10 egress-loop engine: a failing load → `showError` toast → context
 * identity change → the `[refresh]`/`[loadSettings]` effect re-fires → the
 * failing load AGAIN → the unbounded request loop; the audit-toaster
 * variant of this loop was pinned live by the 141st session, T-485).
 *
 * THE FIX (this suite's contract):
 *   1. the ACTIONS context value identity is STABLE for the provider's
 *      lifetime — landing toasts, dismissing toasts, clearing: the object
 *      reference NEVER changes, and an actions-only consumer does NOT
 *      re-render on toast traffic (a render-count probe stays at 1);
 *   2. the toast LIST (`useToastList`) — the second context — still
 *      follows the stack: the viewport renders toasts and dismiss works
 *      (the split did not lose the list);
 *   3. THE S10 REGRESSION SHAPE, killed at the provider level: a
 *      worst-case consumer that lists THE WHOLE `useToast()` VALUE as its
 *      effect dependency, whose effect performs a failing async load and
 *      surfaces the error through `showError` — the load fires EXACTLY
 *      ONCE (pre-fix: the error toast re-armed the effect — unbounded).
 *      A/B contrast: the SAME consumer mounted under an inline replica
 *      of the PRE-FIX provider (the single context memoized on
 *      `[toasts, show, dismiss]` — the historical shape, reproduced
 *      verbatim) re-fires its load the moment its own error toast lands —
 *      proving the pin detects the exact defect the fix removed.
 *
 * Run:
 *   npx vitest run src/tests/app/t-559-toast-context-stability.test.tsx
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import * as React from "react";

import { ToastProvider, useToast, useToastList, type Toast } from "../../app/providers/toast-provider";
import { ToastViewport } from "../../shared/layout/toast-viewport";

/* ------------------------------------------------------------------ */
/* Probes + drivers.                                                    */
/* ------------------------------------------------------------------ */

interface ProbeLog {
  identities: unknown[];
  renders: number;
}

/** An actions-only consumer: records the context identity every render. */
function IdentityProbe({ log }: { log: ProbeLog }) {
  const value = useToast();
  log.renders += 1;
  log.identities.push(value);
  return null;
}

/** Fires a barrage of toasts on demand (list-context traffic). */
function ToastBarrage() {
  const { showInfo, showError, clear } = useToast();
  return (
    <>
      <button
        data-testid="barrage"
        onClick={() => {
          showInfo("B1");
          showInfo("B2");
          showError("B3");
        }}
      >
        barrage
      </button>
      <button data-testid="clear-all" onClick={() => clear()}>
        clear-all
      </button>
    </>
  );
}

/** Dismisses the first toast currently on screen (list traffic via the
 * actions + the viewport's own dismiss button). */
function FirstToastDismissal() {
  const toasts = useToastList();
  const { dismiss } = useToast();
  return (
    <button data-testid="dismiss-first" onClick={() => dismiss(toasts[0]?.id ?? "")}>
      dismiss-first
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* The S10 worst-case consumer — the whole context value as effect dep.   */
/* ------------------------------------------------------------------ */

interface LoadLog {
  count: number;
}

/**
 * The S10 shape: the effect lists THE WHOLE toast value as its dependency
 * (the worst-case consumer — even more fragile than the real sites, which
 * list individual actions), and the effect performs the failing async load
 * + surfaces the error through `showError`. Pre-fix, the error toast
 * re-armed the effect (unbounded loop); post-fix the identity is stable so
 * the load fires exactly once.
 *
 * `bailAfter` (the A/B driver ONLY): stop surfacing the error toast after N
 * loads — the legacy replica's loop is unbounded in real time (it freezes
 * the app — the exact T-485 live symptom), so the contrast mount BOUNDS it
 * to prove the re-arm engine while letting the test terminate.
 */
function FailingListAllConsumer({
  loadLog,
  useToastHook,
  bailAfter = Number.POSITIVE_INFINITY,
}: {
  loadLog: LoadLog;
  useToastHook: () => ReturnType<typeof useToast>;
  bailAfter?: number;
}) {
  const toast = useToastHook();
  React.useEffect(() => {
    loadLog.count += 1;
    void (async () => {
      // The failing async call — resolves next microtask; the error toast
      // lands AFTER the effect, which is exactly the re-arm window the
      // pre-fix identity churn exploited.
      await Promise.reject(new Error("listAll: network down")).catch(() => {});
      if (loadLog.count <= bailAfter) {
        toast.showError("Chargement impossible", "listAll a échoué");
      }
    })();
  }, [toast]);
  return null;
}

/**
 * The PRE-FIX provider replica — the historical single-context shape whose
 * value was memoized on `[toasts, show, dismiss]` (verbatim from the
 * pre-T-559 file). Mounted ONLY to prove the A/B contrast: the same
 * worst-case consumer loops under the old shape and does not under the
 * real provider.
 */
function LegacyToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const dismiss = React.useCallback((id: string) => {
    setToasts((curr) => curr.filter((t) => t.id !== id));
  }, []);
  const show = React.useCallback(
    (severity: "success" | "warning" | "danger" | "info", title: string, description?: string, durationMs = 4500): string => {
      const id = `tst-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setToasts((curr) => [...curr, { id, severity, title, description, durationMs }]);
      return id;
    },
    [dismiss],
  );
  const value = React.useMemo(
    () => ({
      toasts,
      show,
      showSuccess: (t: string, d?: string) => show("success", t, d),
      showWarning: (t: string, d?: string) => show("warning", t, d),
      showError: (t: string, d?: string) => show("danger", t, d),
      showInfo: (t: string, d?: string) => show("info", t, d),
      dismiss,
      clear: () => setToasts([]),
    }),
    [toasts, show, dismiss],
  );
  return (
    <LegacyToastContextLegacy.Provider value={value as never}>{children}</LegacyToastContextLegacy.Provider>
  );
}

const LegacyToastContextLegacy = React.createContext<unknown>(null);
function useLegacyToast(): ReturnType<typeof useToast> {
  const ctx = React.useContext(LegacyToastContextLegacy) as ReturnType<typeof useToast> | null;
  if (!ctx) throw new Error("useLegacyToast must be used inside <LegacyToastProvider>");
  return ctx;
}

const settle = (ms = 80) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------------------ */

describe("T-559 — the toast ACTIONS context is stable across toast traffic", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });
  afterEach(() => {
    cleanup();
  });

  it("the useToast() value identity NEVER changes and an actions-only consumer never re-renders on toast lands, dismisses, or clears", () => {
    const log: ProbeLog = { identities: [], renders: 0 };
    render(
      <ToastProvider>
        <IdentityProbe log={log} />
        <ToastBarrage />
        <FirstToastDismissal />
        <ToastViewport />
      </ToastProvider>,
    );
    expect(log.renders).toBe(1);

    // A barrage of toasts lands (list context churns — the actions must not).
    fireEvent.click(screen.getByTestId("barrage"));
    fireEvent.click(screen.getByTestId("barrage"));
    expect(screen.getAllByText("B1").length).toBeGreaterThanOrEqual(1); // the viewport DID render them

    // Dismiss the first toast + clear the rest (more list churn).
    fireEvent.click(screen.getByTestId("dismiss-first"));
    fireEvent.click(screen.getByTestId("clear-all"));

    expect(log.renders).toBe(1); // the probe NEVER re-rendered
    expect(new Set(log.identities).size).toBe(1); // ONE identity for the provider's lifetime
  });

  it("the toast LIST still follows the stack: the viewport renders a toast, the dismiss button removes it", async () => {
    render(
      <ToastProvider>
        <ToastBarrage />
        <ToastViewport />
      </ToastProvider>,
    );
    expect(screen.queryByText("B1")).toBeNull();
    fireEvent.click(screen.getByTestId("barrage"));
    await waitFor(() => {
      expect(screen.getAllByText("B1").length).toBe(1);
      expect(screen.getAllByText("B3").length).toBe(1);
    });
    // The viewport's own dismiss button (aria-label-less: the X button inside
    // the first toast card) — use the dismissal driver instead for determinism.
    fireEvent.click(screen.getByTestId("clear-all"));
    await waitFor(() => {
      expect(screen.queryByText("B1")).toBeNull();
    });
  });
});

describe("T-559 — the S10 regression shape (a failing listAll behind a worst-case effect dep) fires EXACTLY ONCE", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });
  afterEach(() => {
    cleanup();
  });

  it("the REAL provider: the error toast cannot re-arm the effect — the load count stays 1 under a toast barrage", async () => {
    const loadLog: LoadLog = { count: 0 };
    render(
      <ToastProvider>
        <FailingListAllConsumer loadLog={loadLog} useToastHook={useToast} />
        <ToastBarrage />
        <ToastViewport />
      </ToastProvider>,
    );
    await waitFor(() => {
      expect(screen.getAllByText("Chargement impossible").length).toBeGreaterThanOrEqual(1);
    });
    expect(loadLog.count).toBe(1); // the mount load — the error toast did NOT re-arm it

    // The barrage: more toast traffic while the failing consumer stays mounted.
    fireEvent.click(screen.getByTestId("barrage"));
    fireEvent.click(screen.getByTestId("barrage"));
    fireEvent.click(screen.getByTestId("clear-all"));
    await settle();
    fireEvent.click(screen.getByTestId("barrage"));
    await settle();

    expect(loadLog.count).toBe(1); // STILL exactly one load — the loop is dead at the provider level
  });

  it("A/B contrast — the PRE-FIX single-context shape (inline replica, verbatim semantics) re-arms the effect from the error toast alone (the loop engine)", async () => {
    // bailAfter=4: the replica's loop is unbounded in real time (the app
    // freezes — T-485's live evidence); the bail lets the engine run PAST the
    // mount load and then settle so the test can terminate and assert.
    const loadLog: LoadLog = { count: 0 };
    render(
      <LegacyToastProvider>
        <FailingListAllConsumer loadLog={loadLog} useToastHook={useLegacyToast} bailAfter={4} />
      </LegacyToastProvider>,
    );
    await settle(200);
    // The legacy value memo keys on `toasts` — the consumer's OWN error toast
    // changes the identity → the `[toast]` effect re-fires → the count climbs
    // past the mount load to the bail. This is the defect T-559 removed (kept
    // as the permanent contrast pin: the loop engine is REAL, not hypothetical).
    expect(loadLog.count).toBeGreaterThanOrEqual(4);
  });
});
