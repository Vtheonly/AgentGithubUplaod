/**
 * T-503 suite (PERF-509) — the DashboardLayoutEditor's INTERACTION
 * PERFORMANCE repairs:
 *
 *   1. QUANTIZE-THEN-COMPARE: a pointermove whose delta stays inside the
 *      current grid cell (sub-cell jitter — the majority of move events
 *      between two grid snaps) touches NO state: the layout does not
 *      change and the dirty flag does NOT flip (the Enregistrer button
 *      stays disabled). Only a real cell change enters the pipeline.
 *   2. UNRELATED COMPONENTS ARE NOT RE-RENDERED: during a full drag of
 *      one card, a sibling's content component never re-renders (the
 *      mandate: "Prevent unrelated dashboard components from being
 *      recalculated or re-rendered unnecessarily during layout
 *      adjustments").
 *   3. THE MEMOIZATION + IDENTITY DISCIPLINE (source pins): the cell is a
 *      React.memo boundary; the collision resolver is copy-on-write and
 *      returns the ORIGINAL object when nothing moves (identity gates).
 *
 * jsdom conventions (same as the geometry suite): the grid rect is 0×0,
 * so columnStep = 1 and rowStep = 32 + 12 = 44px per grid row.
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

const VIEW_KEY = "t503-perf-view";

/** A content probe that counts its renders (the mandate's "unrelated
 *  components are not re-rendered" observable). */
function makeRenderCounter(id: string) {
  const counter = { renders: 0 };
  const Probe = () => {
    counter.renders += 1;
    return <div data-testid={`probe-${id}`}>{id}</div>;
  };
  return { counter, element: <Probe /> };
}

const leftProbe = makeRenderCounter("left");
const rightProbe = makeRenderCounter("right");

const ITEMS = [
  {
    id: "left",
    label: "Carte gauche",
    content: leftProbe.element,
    x: 0,
    y: 0,
    w: 6,
    h: 6,
  },
  {
    id: "right",
    label: "Carte droite",
    content: rightProbe.element,
    x: 6,
    y: 0,
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

/** jsdom's zero-size grid: rowStep = 32 + 12 = 44px per grid row. */
const ROW_PX = 44;

// ============================================================
// 1. QUANTIZE-THEN-COMPARE
// ============================================================
describe("T-503 (PERF-509) — sub-cell jitter touches no state", () => {
  it("pointermoves INSIDE the same grid cell do not dirty the editor nor move anything", () => {
    render(
      <DashboardLayoutEditor storageKey={VIEW_KEY} items={ITEMS} editing />,
    );
    const saveButton = screen.getByRole("button", {
      name: /Enregistrer/,
    }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);

    const handle = screen.getByRole("button", { name: "Déplacer Carte gauche" });
    fireEvent.pointerDown(handle, { clientX: 100, clientY: 100, pointerId: 1 });

    // A burst of sub-cell jitter (each < 22px — half the 44px rowStep —
    // so Math.round floors to 0 and no cell boundary is crossed; the
    // horizontal columnStep is 1px in jsdom, so keep dx = 0).
    for (const dy of [5, 12, 18, 15, 10, 8]) {
      fireEvent.pointerMove(window, {
        clientX: 100,
        clientY: 100 + dy,
        pointerId: 1,
      });
    }
    // Nothing quantized to a new cell: the rect is unchanged…
    expect(rectOf("left").gridRow).toBe("1 / span 6");
    // …and the dirty flag NEVER flipped (the gated setDirty — the
    // pre-T-503b code dirtied on the first sub-cell event).
    expect(saveButton.disabled).toBe(true);
  });

  it("a REAL cell change enters the pipeline: the rect moves and the editor dirties", () => {
    render(
      <DashboardLayoutEditor storageKey={VIEW_KEY} items={ITEMS} editing />,
    );
    const saveButton = screen.getByRole("button", {
      name: /Enregistrer/,
    }) as HTMLButtonElement;

    const handle = screen.getByRole("button", { name: "Déplacer Carte gauche" });
    fireEvent.pointerDown(handle, { clientX: 100, clientY: 100, pointerId: 1 });
    // One full row down (44px) — a real cell change.
    fireEvent.pointerMove(window, {
      clientX: 100,
      clientY: 100 + ROW_PX,
      pointerId: 1,
    });
    expect(rectOf("left").gridRow).toBe("2 / span 6");
    expect(saveButton.disabled).toBe(false);
  });

  it("the resize interaction has the same gate: sub-cell deltas change nothing", () => {
    render(
      <DashboardLayoutEditor storageKey={VIEW_KEY} items={ITEMS} editing />,
    );
    const saveButton = screen.getByRole("button", {
      name: /Enregistrer/,
    }) as HTMLButtonElement;
    const handle = screen.getByRole("button", {
      name: "Redimensionner Carte gauche",
    });
    fireEvent.pointerDown(handle, { clientX: 100, clientY: 100, pointerId: 1 });
    // 15px < 22px (half the rowStep) — the resize quantizes to the same
    // rect and nothing changes.
    fireEvent.pointerMove(window, {
      clientX: 100,
      clientY: 100 + 15,
      pointerId: 1,
    });
    expect(rectOf("left").gridRow).toBe("1 / span 6");
    expect(saveButton.disabled).toBe(true);
  });
});

// ============================================================
// 2. UNRELATED COMPONENTS ARE NOT RE-RENDERED
// ============================================================
describe("T-503 (PERF-509) — unrelated components are not re-rendered during a drag", () => {
  it("dragging the left card never re-renders the right card's content", () => {
    render(
      <DashboardLayoutEditor storageKey={VIEW_KEY} items={ITEMS} editing />,
    );
    const baselineLeft = leftProbe.counter.renders;
    const baselineRight = rightProbe.counter.renders;
    expect(baselineLeft).toBeGreaterThan(0);
    expect(baselineRight).toBeGreaterThan(0);

    const handle = screen.getByRole("button", { name: "Déplacer Carte gauche" });
    fireEvent.pointerDown(handle, { clientX: 100, clientY: 100, pointerId: 1 });
    // A full multi-cell drag: down one row, then down another (each move is
    // a real cell change → the editor re-renders; the sibling must not).
    fireEvent.pointerMove(window, {
      clientX: 100,
      clientY: 100 + ROW_PX,
      pointerId: 1,
    });
    fireEvent.pointerMove(window, {
      clientX: 100,
      clientY: 100 + 2 * ROW_PX,
      pointerId: 1,
    });
    fireEvent.pointerUp(window, { pointerId: 1 });

    expect(rectOf("left").gridRow).toBe("3 / span 6");
    // The dragged card's content MAY re-render (its wrapper did)…
    expect(leftProbe.counter.renders).toBeGreaterThanOrEqual(baselineLeft);
    // …but the untouched sibling's content never did (the element-identity
    // bailout + the memoized wrapper): the mandate's "unrelated dashboard
    // components are not re-rendered" — pinned.
    expect(rightProbe.counter.renders).toBe(baselineRight);
  });
});

// ============================================================
// 3. THE MEMOIZATION + IDENTITY DISCIPLINE (source pins)
// ============================================================
describe("T-503 (PERF-509) — the memoization + identity discipline (source pins)", () => {
  const readSrc = () =>
    readFileSync(
      join(__dirname, "../../../features/dashboard/dashboard-layout-editor.tsx"),
      "utf8",
    );

  it("the grid cell is a React.memo boundary", () => {
    const src = readSrc();
    expect(src).toContain("const LayoutCell = memo(function LayoutCell(");
  });

  it("the collision resolver is COPY-ON-WRITE and identity-returning when nothing moves", () => {
    const src = readSrc();
    // Copy-on-write: a new rect object only for the rects the pass moves.
    expect(src).toContain("result[pushId] = { ...pushed, y: nextY }");
    // The identity gate: an already-resolved layout re-checked returns the
    // ORIGINAL object (the callers' no-op paths see the same identity).
    expect(src).toContain("if (!mutated) return layout;");
  });

  it("both interaction pipelines quantize-then-compare before touching state", () => {
    const src = readSrc();
    expect(src).toContain("quantizedDragTarget(");
    expect(src).toContain("quantizedResizeTarget(");
    expect(src).toContain("if (!rectsEqual(moved, current))");
    expect(src).toContain("if (!rectsEqual(resized, current))");
  });
});
