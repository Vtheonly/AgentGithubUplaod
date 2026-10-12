/**
 * T-504 suite (UI-337) — the VIEW-MODE hidden-indicator restore bar:
 *
 * The owner's report: "when toggling things on and off there is no way to
 * toggle the thing off [back on] so make sure there is a way so I can see
 * the thing I toggled off to bring them back." The T-503c show/hide design
 * placed the restoration surface exclusively in edit mode (the tray below
 * the grid) — in view mode hidden indicators were simply ABSENT, with no
 * count, no chip, no path back.
 *
 * Pins:
 *   1. THE BAR: view mode with hidden indicators renders the persistent
 *      restore bar — the hidden count, one chip per hidden indicator, and
 *      the Tout afficher restore-all. No bar when nothing is hidden, and
 *      no bar in edit mode (the tray is the edit-mode home).
 *   2. THE RESTORE PERSISTS IMMEDIATELY: a view-mode chip click restores
 *      the indicator to the grid AND saves the layout (the click IS the
 *      explicit change — the T-448 explicit-save contract stays intact for
 *      edit mode); the saved row carries the restored rect with the hidden
 *      flag REMOVED.
 *   3. TOUT AFFICHER: one click restores every hidden indicator and
 *      persists once.
 *   4. THE ALL-HIDDEN STATE: the honest empty state renders TOGETHER with
 *      the bar (the guidance points at it — no edit-mode knowledge
 *      required), and the bar's Tout afficher empties the hidden set.
 *   5. THE SERVER-UNREACHABLE HINT: a failed save surfaces the honest
 *      "conservé localement" note inside the bar (the T-448 posture).
 */
import { describe, it, expect, beforeEach, afterEach, vi, beforeAll } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";

// Initialize i18n FIRST — the surfaces are French-labeled.
import "../../../i18n/i18n";
import { DashboardLayoutEditor } from "../../../features/dashboard/dashboard-layout-editor";
import { Ok } from "../../../core/result";
import { dashboardLayoutCacheKey } from "../../../features/dashboard/dashboard-layout-storage";
import type {
  DashboardLayoutRepository,
  StoredDashboardLayout,
} from "../../../domain/repository/dashboard-layout-repository";

// ---------------------------------------------------------------------------
// The fake dedicated layout store (the t-448/t-503 structural pattern).
// ---------------------------------------------------------------------------
const layoutStore = {
  load: vi.fn(),
  save: vi.fn(),
  clear: vi.fn(),
};

function makeStore(): DashboardLayoutRepository {
  return {
    load: layoutStore.load as unknown as DashboardLayoutRepository["load"],
    save: layoutStore.save as unknown as DashboardLayoutRepository["save"],
    clear: layoutStore.clear as unknown as DashboardLayoutRepository["clear"],
  };
}

vi.mock("../../../app/providers/repository-provider", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../../app/providers/repository-provider")
    >();
  return {
    ...actual,
    useRepositories: () => ({
      ...actual.useRepositories(),
      dashboardLayouts: makeStore(),
    }),
  };
});

beforeAll(() => {
  class ResizeObserverStub {
    observe = () => undefined;
    unobserve = () => undefined;
    disconnect = () => undefined;
  }
  (globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
});

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  layoutStore.load.mockResolvedValue(Ok(null));
  layoutStore.save.mockResolvedValue(Ok(new Date(0).toISOString()));
  layoutStore.clear.mockResolvedValue(Ok(undefined));
});

afterEach(() => {
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// Fixtures (the t-503 conventions).
// ---------------------------------------------------------------------------
const EDITOR_ITEMS = [
  {
    id: "radar",
    label: "Radar de vigilance",
    content: <div data-testid="content-radar">radar</div>,
    x: 0,
    y: 0,
    w: 6,
    h: 6,
  },
  {
    id: "console",
    label: "Console de diagnostic",
    content: <div data-testid="content-console">console</div>,
    x: 6,
    y: 0,
    w: 6,
    h: 6,
  },
  {
    id: "aging",
    label: "Ancienneté des créances",
    content: <div data-testid="content-aging">aging</div>,
    x: 0,
    y: 7,
    w: 12,
    h: 6,
  },
] as unknown as Parameters<typeof DashboardLayoutEditor>[0]["items"];

function cellExists(itemId: string): boolean {
  return Boolean(
    document.querySelector(`[data-dashboard-layout-id="${itemId}"]`),
  );
}

/** Hide items in EDIT mode, then land in VIEW mode with them hidden. */
function renderViewWithHidden(hiddenIds: string[]) {
  const { rerender } = render(
    <DashboardLayoutEditor storageKey="t504-ui337" items={EDITOR_ITEMS} editing />,
  );
  for (const id of hiddenIds) {
    const label = EDITOR_ITEMS.find((i) => i.id === id)!.label;
    fireEvent.click(screen.getByRole("button", { name: `Masquer ${label}` }));
  }
  rerender(<DashboardLayoutEditor storageKey="t504-ui337" items={EDITOR_ITEMS} />);
}

// ============================================================
// 1. THE BAR
// ============================================================
describe("T-504 (UI-337) — the view-mode hidden-indicator restore bar", () => {
  it("A: view mode with hidden indicators renders the bar — the count, one chip per hidden item, and Tout afficher", () => {
    renderViewWithHidden(["radar"]);
    const bar = screen.getByTestId("dashboard-hidden-restore-bar");
    expect(within(bar).getByText(/1 indicateur masqué/)).toBeTruthy();
    expect(
      within(bar).getByRole("button", { name: "Afficher Radar de vigilance" }),
    ).toBeTruthy();
    expect(within(bar).getByRole("button", { name: "Tout afficher" })).toBeTruthy();
    // The hidden item is absent from the grid; its sibling renders.
    expect(cellExists("radar")).toBe(false);
    expect(cellExists("console")).toBe(true);
  });

  it("B: NO bar when nothing is hidden (the clean dashboard stays clean)", () => {
    render(<DashboardLayoutEditor storageKey="t504-ui337" items={EDITOR_ITEMS} />);
    expect(screen.queryByTestId("dashboard-hidden-restore-bar")).toBeNull();
  });

  it("C: NO bar in EDIT mode (the tray below the grid is the edit-mode home — the T-503 surface unchanged)", () => {
    // ONE instance across the whole flow: edit → hide → still editing.
    const { rerender } = render(
      <DashboardLayoutEditor storageKey="t504-ui337" items={EDITOR_ITEMS} editing />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Masquer Radar de vigilance" }));
    rerender(<DashboardLayoutEditor storageKey="t504-ui337" items={EDITOR_ITEMS} editing />);
    // Edit mode: the TRAY (below the grid), never the view-mode bar.
    expect(screen.queryByTestId("dashboard-hidden-restore-bar")).toBeNull();
    expect(screen.getByTestId("dashboard-hidden-tray")).toBeInTheDocument();
    // And the tray's own restore still works (the T-503 contract).
    fireEvent.click(
      screen.getByRole("button", { name: "Afficher Radar de vigilance" }),
    );
    expect(cellExists("radar")).toBe(true);
    expect(screen.queryByTestId("dashboard-hidden-tray")).toBeNull();
  });

  it("D: the singular/plural count is honest (2 hidden items → « 2 indicateurs masqués »)", () => {
    renderViewWithHidden(["radar", "aging"]);
    const bar = screen.getByTestId("dashboard-hidden-restore-bar");
    expect(within(bar).getByText(/2 indicateurs masqués/)).toBeTruthy();
  });
});

// ============================================================
// 2. THE RESTORE PERSISTS IMMEDIATELY
// ============================================================
describe("T-504 (UI-337) — the view-mode restore persists immediately", () => {
  it("A: a chip click restores the indicator to the grid AND saves the layout (the hidden flag REMOVED from the saved rect)", async () => {
    renderViewWithHidden(["radar"]);
    fireEvent.click(
      screen.getByRole("button", { name: "Afficher Radar de vigilance" }),
    );
    // The indicator is back in the grid…
    expect(cellExists("radar")).toBe(true);
    // …the bar is gone (nothing hidden anymore)…
    expect(screen.queryByTestId("dashboard-hidden-restore-bar")).toBeNull();
    // …and the restore SAVED immediately — no Enregistrer exists in view
    // mode; leaving the restore dirty-only would silently lose it.
    await waitFor(() => expect(layoutStore.save).toHaveBeenCalled());
    const [viewKey, saved] = layoutStore.save.mock.calls[0] as [
      string,
      StoredDashboardLayout,
    ];
    expect(viewKey).toBe("t504-ui337");
    expect(saved.radar).toEqual({ x: 0, y: 0, w: 6, h: 6 }); // hidden GONE
    expect(saved.console).toEqual({ x: 6, y: 0, w: 6, h: 6 });
  });

  it("B: the restored layout round-trips through the local cache (a fresh mount sees the restored indicator)", () => {
    renderViewWithHidden(["radar"]);
    fireEvent.click(
      screen.getByRole("button", { name: "Afficher Radar de vigilance" }),
    );
    // A fresh mount (no server row) reads the local cache the restore wrote.
    render(
      <DashboardLayoutEditor storageKey="t504-ui337" items={EDITOR_ITEMS} />,
    );
    expect(cellExists("radar")).toBe(true);
    expect(screen.queryByTestId("dashboard-hidden-restore-bar")).toBeNull();
  });
});

// ============================================================
// 3. TOUT AFFICHER
// ============================================================
describe("T-504 (UI-337) — Tout afficher (the view-mode restore-all)", () => {
  it("one click restores EVERY hidden indicator and persists once", async () => {
    renderViewWithHidden(["radar", "aging"]);
    fireEvent.click(screen.getByRole("button", { name: "Tout afficher" }));
    expect(cellExists("radar")).toBe(true);
    expect(cellExists("console")).toBe(true);
    expect(cellExists("aging")).toBe(true);
    expect(screen.queryByTestId("dashboard-hidden-restore-bar")).toBeNull();
    await waitFor(() => expect(layoutStore.save).toHaveBeenCalled());
    expect(layoutStore.save).toHaveBeenCalledTimes(1);
    const [, saved] = layoutStore.save.mock.calls[0] as [
      string,
      StoredDashboardLayout,
    ];
    expect(saved.radar?.hidden).toBeUndefined();
    expect(saved.aging?.hidden).toBeUndefined();
  });
});

// ============================================================
// 4. THE ALL-HIDDEN STATE
// ============================================================
describe("T-504 (UI-337) — the all-hidden honest state meets the bar", () => {
  it("the empty state renders TOGETHER with the bar, and the guidance points at the bar (no edit-mode knowledge required)", () => {
    renderViewWithHidden(["radar", "console", "aging"]);
    expect(screen.getByTestId("dashboard-all-hidden")).toBeInTheDocument();
    const bar = screen.getByTestId("dashboard-hidden-restore-bar");
    expect(within(bar).getByText(/3 indicateurs masqués/)).toBeTruthy();
    expect(screen.getByTestId("dashboard-all-hidden").textContent).toContain(
      "barre",
    );
    expect(screen.getByTestId("dashboard-all-hidden").textContent).toContain(
      "Tout afficher",
    );
    // And the bar's restore-all empties the hidden set.
    fireEvent.click(screen.getByRole("button", { name: "Tout afficher" }));
    expect(screen.queryByTestId("dashboard-all-hidden")).toBeNull();
    expect(screen.queryByTestId("dashboard-hidden-restore-bar")).toBeNull();
    expect(cellExists("radar")).toBe(true);
    expect(cellExists("console")).toBe(true);
    expect(cellExists("aging")).toBe(true);
  });
});

// ============================================================
// 5. THE SERVER-UNREACHABLE HINT
// ============================================================
describe("T-504 (UI-337) — the honest save-failure hint inside the bar", () => {
  it("a failed server save surfaces the conservé-localement note (the restore itself stands, the local cache keeps it)", async () => {
    // A failing server save (the t-448 save-failed posture).
    layoutStore.save.mockResolvedValue({
      ok: false,
      error: { message: "network down", code: "ERR_NETWORK" },
    } as never);
    // A pre-hidden pair in the local cache (a fresh profile, no server
    // row): the bar renders in view mode.
    localStorage.setItem(
      dashboardLayoutCacheKey("t504-ui337-hint"),
      JSON.stringify({
        radar: { x: 0, y: 0, w: 6, h: 6, hidden: true },
        console: { x: 6, y: 0, w: 6, h: 6, hidden: true },
        aging: { x: 0, y: 7, w: 12, h: 6 },
      }),
    );
    render(
      <DashboardLayoutEditor storageKey="t504-ui337-hint" items={EDITOR_ITEMS} />,
    );
    // Restore ONE of the two hidden indicators with the server down.
    fireEvent.click(
      screen.getByRole("button", { name: "Afficher Radar de vigilance" }),
    );
    // The restore itself stands (the local cache keeps it)…
    expect(cellExists("radar")).toBe(true);
    // …the bar persists for the still-hidden console…
    expect(
      screen.getByRole("button", { name: "Afficher Console de diagnostic" }),
    ).toBeInTheDocument();
    // …and the honest hint appears inside the bar once the save rejects.
    await waitFor(() =>
      expect(
        screen.getByText(/Serveur injoignable/i, { selector: "span" }),
      ).toBeInTheDocument(),
    );
  });
});
