/**
 * T-560 (EGRESS-LOOP / the S10 loop family) — the five loop-capable sites'
 * load-generation-ref gate: per-site effect-count pins.
 *
 * THE BUG (the S10 loop engine, killed at the provider level by T-559 and
 * now fenced per-site): each site's load effect keyed on the load callback
 * identity (`useEffect(() => { void refresh(); }, [refresh])`), whose deps
 * included a toast action — so a failing load → its own error toast →
 * context identity churn → the effect re-fired → the failing load AGAIN
 * (unbounded doomed egress requests; the configuration-tab's `listAll`
 * against the capped OLD project was the canonical shape).
 *
 * THE GATE (this suite's contract, per site):
 *   - the load fires ON MOUNT (or on role arrival for the SuperAdmin-gated
 *     accounts tab) EXACTLY ONCE — a toast barrage (toast traffic), parent
 *     re-renders, and toasts landing/dismissing can NEVER re-fire the load;
 *   - the load-generation-ref counts exactly one generation per legitimate
 *     trigger: the cycle detail re-loads on `cycle.id` change (its ONE
 *     legitimate reactive dimension) and stays pinned for the SAME cycle
 *     under the barrage;
 *   - the explicit-refresh path still works (the configuration-tab's
 *     « Rafraîchir » button produces a SECOND load);
 *   - the identical-consecutive-error-toast dedupe: the SAME failure twice
 *     renders ONE toast card (the second failing refresh does not stack a
 *     duplicate error toast).
 *
 * Harness: the REAL components inside the REAL ToastProvider (the standing
 * heavy-test standard) + a controllable RepositoryProvider whose load
 * methods return a REAL failing Result (Err network — the same AppError
 * shape the repositories produce) with a call counter; the supabase-client
 * seam is pinned for the configuration-tab block (vi.mock: mock mode
 * `useSupabase=false` so the graph stays on mockRepositories, with
 * `isSupabaseConfigured=true` so the tab's own configured gate opens — the
 * documented t-472-style hermeticity pin for a configured-path seam) and
 * system-config's service factory is pinned to the counting failing fake.
 *
 * Run:
 *   npx vitest run src/tests/features/t-560-load-loop-guards.test.tsx
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import * as React from "react";

import "../../i18n/i18n";
import { Err } from "../../core/result";
import { Errors } from "../../core/app-error";
import { mockRepositories } from "../../app/providers/repository-provider";
import {
  RepositoryProvider,
  type Repositories,
} from "../../app/providers/repository-provider";
import { AuthProvider } from "../../app/providers/auth-provider";
import { ToastProvider, useToast } from "../../app/providers/toast-provider";
import { ToastViewport } from "../../shared/layout/toast-viewport";
import { ConfigurationTab } from "../../features/settings/configuration-tab";
import { AccountsTab } from "../../features/settings/accounts-tab";
import { PricingYearConfigBar } from "../../features/settings/pricing/pricing-year-config-bar";
import { PromotionCyclesTab } from "../../features/academics/promotion-cycles/promotion-cycles-tab";
import { PromotionCycleDetail } from "../../features/academics/promotion-cycles/promotion-cycle-detail";
import type { PromotionCycle } from "../../domain/model/promotion-cycle";

/* ------------------------------------------------------------------ */
/* The pinned seams (t-472-style hermeticity pins for this suite).       */
/* ------------------------------------------------------------------ */

const t560 = vi.hoisted(() => ({
  /** configuration-tab: the failing SystemConfigService.listAll counter. */
  listAllCalls: 0,
}));

vi.mock("../../infrastructure/supabase/supabase-client", () => ({
  // Mock mode for the GRAPH (repository-provider's module-load returns
  // mockRepositories — no live path anywhere), while the configuration-tab's
  // own configured gate opens for its load path — the t-472-sanctioned pin
  // for exercising a configured-path seam hermetically.
  useSupabase: false,
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => ({ __fakeClient: true }),
  supabaseUrl: "https://fake-t560.supabase.co",
  supabaseAnonKey: "sb_publishable_T560_FAKE",
  describeSupabaseConnection: () => ({
    url: "https://fake-t560.supabase.co",
    host: "fake-t560.supabase.co",
    isProductionBuild: false,
    useSupabase: false,
    configured: true,
    keyFormat: "publishable",
  }),
  normalizeSupabaseUrl: (v: string) => v,
}));

vi.mock("../../infrastructure/system-config", () => ({
  // The configuration-tab's service boundary: a REAL failing Result with the
  // canonical AppError shape + the load counter (the loop's pulse).
  getSystemConfigService: () => ({
    listAll: async () => {
      t560.listAllCalls += 1;
      return Err(Errors.network("listAll: network down"));
    },
  }),
  getLocalConfigService: () => ({
    read: async () => ({ ok: true, value: {} }),
  }),
}));

/* ------------------------------------------------------------------ */
/* The harness.                                                          */
/* ------------------------------------------------------------------ */

const SESSION_KEY = "el-imtiyaz.session";

function seedSuperAdminSession(): void {
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      userId: "user-t560",
      tenantId: "tenant-1",
      homeTenantId: "tenant-1",
      email: "agent@elimtiyaz.dz",
      displayName: "Agent T560",
      avatarUrl: null,
      role: "super_admin",
      permissions: [],
      accessToken: "test-access-token",
      refreshToken: null,
      expiresAt: Date.now() + 3600_000,
      locale: "fr",
    }),
  );
}

/** Fires toast traffic on demand (list-context churn — the loop's fuel). */
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

/** Forces the mounted children subtree to re-render on demand. */
function ParentWithBump({ children }: { children: React.ReactNode }) {
  const [, bump] = React.useReducer((x: number) => x + 1, 0);
  return (
    <>
      {children}
      <button data-testid="bump" onClick={bump}>
        bump
      </button>
    </>
  );
}

/** The full harness: the site under the real providers + toast traffic. */
function mountSite(site: React.ReactElement, repositories?: Repositories) {
  return render(
    <RepositoryProvider repositories={repositories ?? mockRepositories}>
      <AuthProvider>
        <ToastProvider>
          <ParentWithBump>
            {site}
            <ToastBarrage />
          </ParentWithBump>
          <ToastViewport />
        </ToastProvider>
      </AuthProvider>
    </RepositoryProvider>,
  );
}

/** A failing, counted repository method (the loop's pulse). */
function failingCountedMethod(): { calls: () => number } & (() => Promise<never>) {
  let calls = 0;
  const fn = async () => {
    calls += 1;
    return Err(Errors.network("list failed")) as never;
  };
  return Object.assign(fn, { calls: () => calls });
}

const settle = (ms = 120) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The standard barrage + bumps + settle (toast traffic + parent re-renders,
 * NO clear-all — the caller decides when to clear), then the caller asserts. */
async function barrageAndBump(): Promise<void> {
  fireEvent.click(screen.getByTestId("barrage"));
  fireEvent.click(screen.getByTestId("bump"));
  fireEvent.click(screen.getByTestId("barrage"));
  fireEvent.click(screen.getByTestId("bump"));
  fireEvent.click(screen.getByTestId("bump"));
  await settle();
  fireEvent.click(screen.getByTestId("barrage"));
  await settle();
}

/* ------------------------------------------------------------------ */

describe("T-560 — configuration-tab: the load-generation-ref gate (listAll)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    t560.listAllCalls = 0;
    seedSuperAdminSession();
  });
  afterEach(() => {
    cleanup();
    localStorage.removeItem(SESSION_KEY);
  });

  it("the failing listAll fires ONCE on mount — toast traffic + parent re-renders never re-fire it; « Rafraîchir » re-loads (explicit refresh); the identical consecutive failure is deduped", async () => {
    mountSite(<ConfigurationTab />);
    // The mount load (the S10 shape: a failing listAll + its own error toast).
    await waitFor(() => expect(t560.listAllCalls).toBe(1));

    // The error toast surfaced exactly once for this failure.
    expect(screen.getAllByText(/Erreur chargement paramètres/).length).toBe(1);

    // The barrage: toast traffic + parent re-renders — the load count must
    // stay pinned at the mount generation, and the error toast card is
    // STILL exactly one (the traffic never duplicated it).
    await barrageAndBump();
    expect(t560.listAllCalls).toBe(1);
    expect(screen.getAllByText(/Erreur chargement paramètres/).length).toBe(1);

    // Clear the stack (the user dismisses everything).
    fireEvent.click(screen.getByTestId("clear-all"));
    await waitFor(() => expect(screen.queryByText(/Erreur chargement paramètres/)).toBeNull());

    // The explicit-refresh path: the Refresh button produces a SECOND load.
    fireEvent.click(screen.getByRole("button", { name: /Rafraîchir/ }));
    await waitFor(() => expect(t560.listAllCalls).toBe(2));

    // The identical-consecutive-error dedupe: the second load failed with the
    // SAME message — NO new identical toast stacks (zero after the clear).
    await settle();
    expect(screen.queryByText(/Erreur chargement paramètres/)).toBeNull();
  });
});

describe("T-560 — accounts-tab: the load-generation-ref gate (listAccounts)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    seedSuperAdminSession();
  });
  afterEach(() => {
    cleanup();
    localStorage.removeItem(SESSION_KEY);
  });

  it("the failing listAccounts fires ONCE on mount (role arrived) — toast traffic + parent re-renders never re-fire it", async () => {
    const listAccounts = failingCountedMethod();
    // The full mock composite (CreateAccountModal observes personnel +
    // departments at mount) with ONLY the load method failing + counted.
    const repos = { ...mockRepositories, userAccounts: { listAccounts } } as unknown as Repositories;
    mountSite(<AccountsTab />, repos);
    await waitFor(() => expect(listAccounts.calls()).toBe(1));
    await barrageAndBump();
    expect(listAccounts.calls()).toBe(1); // the SuperAdmin surface's mount load — pinned
  });
});

describe("T-560 — pricing-year-config-bar: the load-generation-ref gate (listConfigs)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    seedSuperAdminSession();
  });
  afterEach(() => {
    cleanup();
    localStorage.removeItem(SESSION_KEY);
  });

  it("the failing listConfigs fires ONCE on mount — toast traffic + parent re-renders never re-fire it", async () => {
    const listConfigs = failingCountedMethod();
    const repos = {
      pricing: { listConfigs },
      academicYears: mockRepositories.academicYears,
    } as unknown as Repositories;
    mountSite(<PricingYearConfigBar />, repos);
    await waitFor(() => expect(listConfigs.calls()).toBe(1));
    await barrageAndBump();
    expect(listConfigs.calls()).toBe(1);
  });
});

describe("T-560 — promotion-cycles-tab: the load-generation-ref gate (listCycles)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    seedSuperAdminSession();
  });
  afterEach(() => {
    cleanup();
    localStorage.removeItem(SESSION_KEY);
  });

  it("the failing listCycles fires ONCE on mount — toast traffic + parent re-renders never re-fire it", async () => {
    const listCycles = failingCountedMethod();
    const repos = {
      promotionCycles: { listCycles },
      academicYears: mockRepositories.academicYears,
    } as unknown as Repositories;
    mountSite(<PromotionCyclesTab />, repos);
    await waitFor(() => expect(listCycles.calls()).toBe(1));
    await barrageAndBump();
    expect(listCycles.calls()).toBe(1);
  });
});

describe("T-560 — promotion-cycle-detail: the load-generation-ref gate (getCycleClasses)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    seedSuperAdminSession();
  });
  afterEach(() => {
    cleanup();
    localStorage.removeItem(SESSION_KEY);
  });

  const cycleA: PromotionCycle = {
    id: "cycle-a",
    sourceAcademicYear: "2025-2026",
    targetAcademicYear: "2026-2027",
    status: "in_review",
    notes: null,
    createdByName: "Agent T560",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    completedAt: null,
    completedByName: null,
    classesTotal: 3,
    classesProcessed: 0,
    studentsAwaiting: 0,
    promotedCount: 0,
    repeatingCount: 0,
    deferredCount: 0,
  };
  const cycleB: PromotionCycle = { ...cycleA, id: "cycle-b" };

  it("the failing getCycleClasses fires ONCE per cycle (the legitimate reactive dimension) — the SAME cycle stays pinned under the barrage; a NEW cycle.id loads exactly once more", async () => {
    const getCycleClasses = failingCountedMethod();
    const repos = { promotionCycles: { getCycleClasses } } as unknown as Repositories;

    const { rerender } = render(
      <RepositoryProvider repositories={repos}>
        <AuthProvider>
          <ToastProvider>
            <ParentWithBump>
              <PromotionCycleDetail cycle={cycleA} onBack={() => {}} onCycleUpdated={() => {}} />
              <ToastBarrage />
            </ParentWithBump>
            <ToastViewport />
          </ToastProvider>
        </AuthProvider>
      </RepositoryProvider>,
    );
    await waitFor(() => expect(getCycleClasses.calls()).toBe(1));

    // The SAME cycle under the full barrage: pinned at its one generation.
    await barrageAndBump();
    expect(getCycleClasses.calls()).toBe(1);

    // A DIFFERENT cycle = a NEW load (the one legitimate reactive dimension).
    rerender(
      <RepositoryProvider repositories={repos}>
        <AuthProvider>
          <ToastProvider>
            <ParentWithBump>
              <PromotionCycleDetail cycle={cycleB} onBack={() => {}} onCycleUpdated={() => {}} />
              <ToastBarrage />
            </ParentWithBump>
            <ToastViewport />
          </ToastProvider>
        </AuthProvider>
      </RepositoryProvider>,
    );
    await waitFor(() => expect(getCycleClasses.calls()).toBe(2));
    await barrageAndBump();
    expect(getCycleClasses.calls()).toBe(2);
  });
});
