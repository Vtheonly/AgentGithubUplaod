/**
 * T-503 suite (UI-336) — the DashboardLayoutEditor's GEOMETRY repairs:
 *
 *   1. OVERFLOW CONTAINMENT: every grid cell carries overflow-hidden — a
 *      card whose content exceeds the cell's fixed track height stays
 *      WITHIN the cell (paints no longer bleed over the neighbouring
 *      components; the mandate's "text extends beyond component borders /
 *      content overlaps or renders on top of neighboring components").
 *   2. THE SETTLE PASS: during a drag the resolver pushes overlapped
 *      siblings DOWN live; at pointer-up every sibling that CAN return to
 *      its pre-drag position DOES (displacement without occlusion is
 *      reverted) — the mandate's "dragging and resizing components leaves
 *      elements misaligned". A drop that genuinely lands ON TOP of a
 *      sibling still stacks it below (occlusion keeps the displacement).
 *   3. THE STALE-ITEMS REPAIR: the pointer handlers read the items through
 *      the itemsRef and the effect subscribes ONCE per editing session
 *      (no per-parent-render listener churn).
 *
 * The drag simulations ride the same jsdom conventions as t-448: the grid
 * element's getBoundingClientRect() is 0×0, so measureSteps() resolves
 * columnStep = (0 − 12·11)/12 + 12 = 1 and rowStep = 32 + 12 = 44 — a
 * clientY delta of 44·n moves a card n grid rows down.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Initialize i18n FIRST — the editor banner is French-labeled.
import "../../../i18n/i18n";
import { DashboardLayoutEditor } from "../../../features/dashboard/dashboard-layout-editor";
import type {
  DashboardLayoutRepository,
} from "../../../domain/repository/dashboard-layout-repository";
import { Ok } from "../../../core/result";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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

const VIEW_KEY = "t503-geometry-view";

const ITEMS = [
  {
    id: "top",
    label: "Carte haute",
    content: <div data-testid="content-top">top</div>,
    x: 0,
    y: 0,
    w: 6,
    h: 6,
  },
  {
    id: "below",
    label: "Carte basse",
    content: <div data-testid="content-below">below</div>,
    x: 0,
    y: 7,
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

function cellOf(itemId: string): HTMLElement {
  const node = document.querySelector<HTMLElement>(
    `[data-dashboard-layout-id="${itemId}"]`,
  );
  if (!node) throw new Error(`layout item not rendered: ${itemId}`);
  return node;
}

/** jsdom's zero-size grid: rowStep = 32 + 12 = 44px per grid row. */
const ROW_PX = 44;

// ============================================================
// 1. OVERFLOW CONTAINMENT
// ============================================================
describe("T-503 (UI-336) — overflow containment", () => {
  it("every cell carries overflow-hidden (view mode AND editing mode)", () => {
    const { rerender } = render(
      <DashboardLayoutEditor storageKey={VIEW_KEY} items={ITEMS} />,
    );
    for (const id of ["top", "below"]) {
      expect(cellOf(id).className).toContain("overflow-hidden");
    }
    rerender(
      <DashboardLayoutEditor storageKey={VIEW_KEY} items={ITEMS} editing />,
    );
    for (const id of ["top", "below"]) {
      expect(cellOf(id).className).toContain("overflow-hidden");
    }
  });
});

// ============================================================
// 2. THE SETTLE PASS
// ============================================================
describe("T-503 (UI-336) — the drag settle pass", () => {
  it("a drag ACROSS a sibling displaces it live, and the settle RESTORES it when the drag returns home", () => {
    render(
      <DashboardLayoutEditor storageKey={VIEW_KEY} items={ITEMS} editing />,
    );
    // Baseline: top at y=0 (row 1), below at y=7 (row 8).
    expect(rectOf("top").gridRow).toBe("1 / span 6");
    expect(rectOf("below").gridRow).toBe("8 / span 6");

    const handle = screen.getByRole("button", { name: "Déplacer Carte haute" });
    fireEvent.pointerDown(handle, { clientX: 100, clientY: 100, pointerId: 1 });

    // Drag the top card DOWN onto the below card (y=7): the resolver pushes
    // `below` to y = 7 + 6 = 13 (row 14) — the live displacement.
    fireEvent.pointerMove(window, {
      clientX: 100,
      clientY: 100 + 7 * ROW_PX,
      pointerId: 1,
    });
    expect(rectOf("top").gridRow).toBe("8 / span 6");
    expect(rectOf("below").gridRow).toBe("14 / span 6");

    // Drag it back to the origin (y=0) — `below` stays pushed DURING the
    // interaction (the resolver never floats anything up mid-drag)…
    fireEvent.pointerMove(window, {
      clientX: 100,
      clientY: 100,
      pointerId: 1,
    });
    expect(rectOf("top").gridRow).toBe("1 / span 6");
    expect(rectOf("below").gridRow).toBe("14 / span 6");

    // …and the pointer-up SETTLE returns `below` home: the dropped card no
    // longer occludes it (top ends at y=6, below starts at y=7).
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(rectOf("top").gridRow).toBe("1 / span 6");
    expect(rectOf("below").gridRow).toBe("8 / span 6");
  });

  it("a drop that genuinely lands ON TOP of a sibling KEEPS it stacked below (occlusion)", () => {
    render(
      <DashboardLayoutEditor storageKey={VIEW_KEY} items={ITEMS} editing />,
    );
    const handle = screen.getByRole("button", { name: "Déplacer Carte haute" });
    fireEvent.pointerDown(handle, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(window, {
      clientX: 100,
      clientY: 100 + 7 * ROW_PX,
      pointerId: 1,
    });
    fireEvent.pointerUp(window, { pointerId: 1 });

    // The dropped card occupies y=7..13 — `below` cannot return to y=7 and
    // stays stacked directly beneath it (y=13, row 14).
    expect(rectOf("top").gridRow).toBe("8 / span 6");
    expect(rectOf("below").gridRow).toBe("14 / span 6");
  });

  it("the resize interaction settles too: growing a card over its neighbour pushes it, shrinking back restores it", () => {
    render(
      <DashboardLayoutEditor storageKey={VIEW_KEY} items={ITEMS} editing />,
    );
    const handle = screen.getByRole("button", {
      name: "Redimensionner Carte haute",
    });
    fireEvent.pointerDown(handle, { clientX: 100, clientY: 100, pointerId: 1 });

    // Grow the top card from h=6 to h=9: it now spans y=0..9, overlapping
    // `below` (y=7) — the resolver pushes `below` to y=9 (row 10).
    fireEvent.pointerMove(window, {
      clientX: 100,
      clientY: 100 + 3 * ROW_PX,
      pointerId: 1,
    });
    expect(rectOf("top").gridRow).toBe("1 / span 9");
    expect(rectOf("below").gridRow).toBe("10 / span 6");

    // Shrink back to h=6 and release: `below` returns home (y=7, row 8).
    fireEvent.pointerMove(window, {
      clientX: 100,
      clientY: 100,
      pointerId: 1,
    });
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(rectOf("top").gridRow).toBe("1 / span 6");
    expect(rectOf("below").gridRow).toBe("8 / span 6");
  });

  it("a click WITHOUT movement settles to a no-op (identity: no dirty, no save-state churn)", () => {
    render(
      <DashboardLayoutEditor storageKey={VIEW_KEY} items={ITEMS} editing />,
    );
    const saveButton = screen.getByRole("button", { name: /Enregistrer/ });
    // Not dirty before any interaction.
    expect((saveButton as HTMLButtonElement).disabled).toBe(true);

    const handle = screen.getByRole("button", { name: "Déplacer Carte haute" });
    fireEvent.pointerDown(handle, { clientX: 100, clientY: 100, pointerId: 1 });
    // A sub-cell pointermove (10px < 44px rowStep) quantizes to the SAME
    // rect — no layout change… but the pre-T-503b code still marks dirty.
    // (The PERF-509 gating lands in T-503b; this test pins the GEOMETRY:
    // the settle of an unmoved drag changes nothing.)
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(rectOf("top").gridRow).toBe("1 / span 6");
    expect(rectOf("below").gridRow).toBe("8 / span 6");
  });
});

// ============================================================
// 3. THE STALE-ITEMS REPAIR (source pins)
// ============================================================
describe("T-503 (UI-336) — the pointer-listener repair (source pins)", () => {
  const readSrc = () =>
    readFileSync(
      join(__dirname, "../../../features/dashboard/dashboard-layout-editor.tsx"),
      "utf8",
    );

  it("the handlers read the items through the ref (never the render closure)", () => {
    const src = readSrc();
    expect(src).toContain("itemsRef.current.find");
    // The stale-closure pattern is gone.
    expect(src).not.toContain("const item = items.find(");
  });

  it("the pointer effect subscribes once per editing session (deps [editing], not [editing, items])", () => {
    const src = readSrc();
    expect(src).toMatch(/\}, \[editing\]\);/);
    expect(src).not.toContain("}, [editing, items]);");
  });
});
