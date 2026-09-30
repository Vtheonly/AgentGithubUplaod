/**
 * T-448 suite — the DashboardLayoutEditor's server-backed save/load
 * lifecycle (UI-326): the owner's exact acceptance contract.
 *
 *   1. LOAD-ON-MOUNT, SERVER WINS: when a saved server row exists, it
 *      replaces any local residue AND refreshes the local cache —
 *      "when I open the application again, I should be able to load the
 *      previously saved layout configuration and continue using the exact
 *      same layout".
 *   2. ONE-TIME PROMOTION: no server row + a pre-T-448 local layout →
 *      the local layout is promoted to the server once ("configure once,
 *      never configure it again").
 *   3. FRESH PROFILE: no server row + no local cache → defaults, no save.
 *   4. EXPLICIT SAVE ONLY: the Enregistrer button saves the server row
 *      with the CURRENT layout ("only update the saved configuration when
 *      I explicitly change and save it"); the server row is NOT written
 *      by merely editing (the debounced buffer stays local).
 *   5. RESET: Réinitialiser clears the server row too (otherwise the
 *      server row would resurrect the layout on the next mount).
 *   6. DEGRADED (offline): a failed server load keeps the local cache
 *      layout (honest degradation — never a crash, never a blank).
 *   7. STRICTMODE: the load runs exactly ONCE per mount (the dev
 *      double-invoke is a no-op).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { StrictMode } from "react";

// Initialize i18n FIRST — the editor banner is French-labeled.
import "../../../i18n/i18n";
import { DashboardLayoutEditor } from "../../../features/dashboard/dashboard-layout-editor";
import type {
  DashboardLayoutRepository,
  StoredDashboardLayout,
} from "../../../domain/repository/dashboard-layout-repository";
import { Ok, Err } from "../../../core/result";
import { dashboardLayoutCacheKey } from "../../../features/dashboard/dashboard-layout-storage";

// ---------------------------------------------------------------------------
// The fake dedicated layout store (structural — the provider's slot type).
// ---------------------------------------------------------------------------
const layoutStore = {
  load: vi.fn(),
  save: vi.fn(),
  clear: vi.fn(),
};

let repoState: { dashboardLayouts: DashboardLayoutRepository };

vi.mock("../../../app/providers/repository-provider", () => ({
  useRepositories: () => repoState,
}));

function makeStore(): DashboardLayoutRepository {
  return {
    load: layoutStore.load as unknown as DashboardLayoutRepository["load"],
    save: layoutStore.save as unknown as DashboardLayoutRepository["save"],
    clear: layoutStore.clear as unknown as DashboardLayoutRepository["clear"],
  };
}

const VIEW_KEY = "t448-editor-view";
const CACHE_KEY = dashboardLayoutCacheKey(VIEW_KEY);

const ITEMS = [
  {
    id: "kpi",
    label: "KPI",
    content: <div data-testid="content-kpi">kpi</div>,
    w: 6,
    h: 6,
  },
  {
    id: "chart",
    label: "Chart",
    content: <div data-testid="content-chart">chart</div>,
    w: 6,
    h: 6,
  },
] as unknown as Parameters<typeof DashboardLayoutEditor>[0]["items"];

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  layoutStore.load.mockResolvedValue(Ok(null));
  layoutStore.save.mockResolvedValue(Ok(new Date(0).toISOString()));
  layoutStore.clear.mockResolvedValue(Ok(undefined));
  repoState = { dashboardLayouts: makeStore() };
});

afterEach(() => {
  localStorage.clear();
});

function rectOf(itemId: string): { gridColumn: string; gridRow: string } {
  const node = document.querySelector<HTMLElement>(
    `[data-dashboard-layout-id="${itemId}"]`,
  );
  if (!node) throw new Error(`layout item not rendered: ${itemId}`);
  return { gridColumn: node.style.gridColumn, gridRow: node.style.gridRow };
}

// A layout where kpi sits at x=2,y=3 (grid-column 3, grid-row 4).
const SERVER_LAYOUT: StoredDashboardLayout = {
  kpi: { x: 2, y: 3, w: 6, h: 6 },
  chart: { x: 8, y: 3, w: 4, h: 6 },
};

// A DIFFERENT local residue (e.g. an unsaved crashed-session edit).
const LOCAL_RESIDUE: StoredDashboardLayout = {
  kpi: { x: 0, y: 0, w: 12, h: 4 },
  chart: { x: 0, y: 5, w: 12, h: 9 },
};

// ============================================================
// 1. LOAD-ON-MOUNT — the saved server row WINS
// ============================================================
describe("T-448 editor — load-on-mount (the saved configuration is reused)", () => {
  it("applies the SAVED server layout over local residue and refreshes the local cache", async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify(LOCAL_RESIDUE));
    layoutStore.load.mockResolvedValue(Ok(SERVER_LAYOUT));

    render(<DashboardLayoutEditor storageKey={VIEW_KEY} items={ITEMS} />);

    // First paint: the local residue (offline-safe instant start).
    expect(rectOf("kpi").gridColumn).toBe("1 / span 12");

    await waitFor(() => {
      expect(rectOf("kpi").gridColumn).toBe("3 / span 6");
    });
    expect(rectOf("chart").gridColumn).toBe("9 / span 4");

    // The offline cache now carries the SAVED layout — the next mount
    // starts identical even before the server answers.
    expect(JSON.parse(localStorage.getItem(CACHE_KEY) ?? "{}")).toEqual(
      SERVER_LAYOUT,
    );
  });

  it("keeps defaults when no server row and no local cache exist (fresh profile)", async () => {
    render(<DashboardLayoutEditor storageKey={VIEW_KEY} items={ITEMS} />);
    await waitFor(() => expect(layoutStore.load).toHaveBeenCalledWith(VIEW_KEY));
    // No promotion — nothing to promote.
    expect(layoutStore.save).not.toHaveBeenCalled();
    // Default flow layout: first item at column 1.
    expect(rectOf("kpi").gridColumn).toBe("1 / span 6");
  });

  it("runs the server load EXACTLY ONCE under StrictMode (the double-invoke is a no-op)", async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify(LOCAL_RESIDUE));
    layoutStore.load.mockResolvedValue(Ok(SERVER_LAYOUT));

    render(
      <StrictMode>
        <DashboardLayoutEditor storageKey={VIEW_KEY} items={ITEMS} />
      </StrictMode>,
    );

    await waitFor(() => {
      expect(rectOf("kpi").gridColumn).toBe("3 / span 6");
    });
    expect(layoutStore.load).toHaveBeenCalledTimes(1);
  });
});

// ============================================================
// 2. THE ONE-TIME PROMOTION — a pre-T-448 local layout reaches the server
// ============================================================
describe("T-448 editor — the one-time promotion of an existing local layout", () => {
  it("promotes the local layout to the server when no saved row exists", async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify(SERVER_LAYOUT));
    layoutStore.load.mockResolvedValue(Ok(null));

    render(<DashboardLayoutEditor storageKey={VIEW_KEY} items={ITEMS} />);

    await waitFor(() =>
      expect(layoutStore.save).toHaveBeenCalledWith(VIEW_KEY, SERVER_LAYOUT),
    );
    // Exactly one promotion call.
    expect(layoutStore.save).toHaveBeenCalledTimes(1);
  });

  it("does NOT promote an empty local cache", async () => {
    layoutStore.load.mockResolvedValue(Ok(null));
    render(<DashboardLayoutEditor storageKey={VIEW_KEY} items={ITEMS} />);
    await waitFor(() => expect(layoutStore.load).toHaveBeenCalled());
    // Give the async promotion path a beat to (wrongly) fire.
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(layoutStore.save).not.toHaveBeenCalled();
  });

  it("a FAILED promotion is a deferred retry, never an error state (the layout stays usable)", async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify(SERVER_LAYOUT));
    layoutStore.load.mockResolvedValue(Ok(null));
    layoutStore.save.mockResolvedValue(
      Err({ code: "ERR_NETWORK", message: "offline", userMessage: "offline" }),
    );

    render(<DashboardLayoutEditor storageKey={VIEW_KEY} items={ITEMS} />);
    await waitFor(() => expect(layoutStore.save).toHaveBeenCalled());
    // The local layout still applies — no crash, no blank.
    expect(rectOf("kpi").gridColumn).toBe("3 / span 6");
  });
});

// ============================================================
// 3. THE EXPLICIT SAVE — the only server write path
// ============================================================
describe("T-448 editor — Enregistrer saves the server row (explicit save only)", () => {
  it("the save button persists the CURRENT layout to the server", async () => {
    layoutStore.load.mockResolvedValue(Ok(null));
    render(
      <DashboardLayoutEditor storageKey={VIEW_KEY} items={ITEMS} editing />,
    );

    // Simulate a drag: pointer down on the KPI handle, move, up.
    const handle = screen.getByLabelText("Déplacer KPI");
    fireEvent.pointerDown(handle, { pointerId: 7, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { pointerId: 7, clientX: 150, clientY: 150 });
    fireEvent.pointerUp(window, { pointerId: 7 });

    // The button is enabled now (dirty).
    const saveButton = screen.getByRole("button", { name: /enregistrer/i });
    expect((saveButton as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(saveButton);

    await waitFor(() => expect(layoutStore.save).toHaveBeenCalled());
    const [viewKey, savedLayout] = layoutStore.save.mock.calls[0] as [
      string,
      StoredDashboardLayout,
    ];
    expect(viewKey).toBe(VIEW_KEY);
    // The dragged KPI moved (x clamped by the grid; y advanced one row).
    expect(savedLayout.kpi.x).toBeGreaterThan(0);
    expect(savedLayout.kpi.y).toBe(1);

    // The honest inline outcome appears.
    await waitFor(() =>
      expect(screen.getByText("Disposition enregistrée")).toBeTruthy(),
    );

    // The local cache was refreshed too (offline continuity).
    expect(JSON.parse(localStorage.getItem(CACHE_KEY) ?? "{}")).toEqual(
      savedLayout,
    );
  });

  it("the server row is NOT written by merely editing (the debounced buffer stays local-only)", async () => {
    render(
      <DashboardLayoutEditor storageKey={VIEW_KEY} items={ITEMS} editing />,
    );

    const handle = screen.getByLabelText("Déplacer KPI");
    fireEvent.pointerDown(handle, { pointerId: 3, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { pointerId: 3, clientX: 140, clientY: 140 });
    fireEvent.pointerUp(window, { pointerId: 3 });

    // Wait past the debounced buffer write.
    await new Promise((resolve) => setTimeout(resolve, 400));

    // The LOCAL cache holds the in-flight edit…
    const cached = JSON.parse(
      localStorage.getItem(CACHE_KEY) ?? "{}",
    ) as StoredDashboardLayout;
    expect(cached.kpi).toBeDefined();
    // …but NO server save happened without the explicit Enregistrer.
    expect(layoutStore.save).not.toHaveBeenCalled();
  });
});

// ============================================================
// 4. RESET — Réinitialiser clears the SAVED row too
// ============================================================
describe("T-448 editor — Réinitialiser clears the saved configuration", () => {
  it("clears the local cache AND the server row, back to defaults", async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify(SERVER_LAYOUT));
    layoutStore.load.mockResolvedValue(Ok(SERVER_LAYOUT));

    render(
      <DashboardLayoutEditor storageKey={VIEW_KEY} items={ITEMS} editing />,
    );

    // Wait for the saved layout to apply.
    await waitFor(() => {
      expect(rectOf("kpi").gridColumn).toBe("3 / span 6");
    });

    fireEvent.click(screen.getByRole("button", { name: /réinitialiser/i }));

    await waitFor(() =>
      expect(layoutStore.clear).toHaveBeenCalledWith(VIEW_KEY),
    );
    expect(localStorage.getItem(CACHE_KEY)).toBeNull();
    // Back to the default flow (column 1).
    await waitFor(() => {
      expect(rectOf("kpi").gridColumn).toBe("1 / span 6");
    });
  });
});

// ============================================================
// 5. DEGRADED — offline behavior
// ============================================================
describe("T-448 editor — honest degradation when the server is unreachable", () => {
  it("a failed server load keeps the local cache layout (no crash, no blank)", async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify(SERVER_LAYOUT));
    layoutStore.load.mockResolvedValue(
      Err({ code: "ERR_NETWORK", message: "offline", userMessage: "offline" }),
    );

    render(<DashboardLayoutEditor storageKey={VIEW_KEY} items={ITEMS} />);

    // Give the failed load a beat to (wrongly) clobber the layout.
    await new Promise((resolve) => setTimeout(resolve, 25));

    // The local layout still applies.
    expect(rectOf("kpi").gridColumn).toBe("3 / span 6");
    expect(screen.getByTestId("content-chart")).toBeTruthy();
  });

  it("a failed server SAVE keeps the local layout and shows the honest inline failure", async () => {
    layoutStore.load.mockResolvedValue(Ok(null));
    layoutStore.save.mockResolvedValue(
      Err({ code: "ERR_NETWORK", message: "offline", userMessage: "offline" }),
    );

    render(
      <DashboardLayoutEditor storageKey={VIEW_KEY} items={ITEMS} editing />,
    );

    const handle = screen.getByLabelText("Déplacer KPI");
    fireEvent.pointerDown(handle, { pointerId: 9, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { pointerId: 9, clientX: 150, clientY: 150 });
    fireEvent.pointerUp(window, { pointerId: 9 });

    fireEvent.click(screen.getByRole("button", { name: /enregistrer/i }));

    await waitFor(() =>
      expect(
        screen.getByText(/Serveur injoignable — conservé localement/),
      ).toBeTruthy(),
    );
    // The layout itself is untouched (locally kept).
    expect(screen.getByTestId("content-kpi")).toBeTruthy();
  });
});
