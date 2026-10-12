import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { Eye, EyeOff, GripVertical, Maximize2, RotateCcw, Save } from "lucide-react";
// T-448 (UI-326): the dedicated server-side layout store + the ONE shared
// localStorage-key module (the offline cache / mock-mode home).
import { useRepositories } from "../../app/providers/repository-provider";
import { logger } from "../../core/logger";
import {
  parseStoredDashboardLayout,
  type StoredDashboardLayout,
} from "../../domain/repository/dashboard-layout-repository";
import {
  readDashboardLayoutCache,
  removeDashboardLayoutCache,
  writeDashboardLayoutCache,
} from "./dashboard-layout-storage";

export interface DashboardLayoutItem {
  id: string;
  label: string;
  content: ReactNode;
  minW?: number;
  maxW?: number;
  minH?: number;
  maxH?: number;
  w?: number;
  h?: number;
  x?: number;
  y?: number;
}

type LayoutRect = { x: number; y: number; w: number; h: number; hidden?: boolean };
type StoredLayout = Record<string, LayoutRect>;

type DragState = {
  id: string;
  startPointerX: number;
  startPointerY: number;
  startX: number;
  startY: number;
  columnStep: number;
  rowStep: number;
  pointerId: number;
};

type ResizeState = {
  id: string;
  startPointerX: number;
  startPointerY: number;
  startW: number;
  startH: number;
  columnStep: number;
  rowStep: number;
  pointerId: number;
};
const GRID_COLUMNS = 12;
const ROW_HEIGHT = 32;
const GRID_GAP = 12;
const DEFAULT_HEIGHT = 6;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

/** T-503 (PERF-509): value-equality for two grid rects. */
function rectsEqual(a: LayoutRect, b: LayoutRect) {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

/**
 * T-503 (PERF-509): the QUANTIZED drag target — the grid cell the pointer
 * delta lands on, sanitized against the item's bounds. Pure; the caller
 * compares it to the item's current rect and skips the whole state
 * pipeline when they match (sub-cell pointer jitter — the majority of
 * move events between two grid snaps — must not touch React state).
 */
function quantizedDragTarget(
  drag: DragState,
  dx: number,
  dy: number,
  current: LayoutRect,
  item: DashboardLayoutItem,
): LayoutRect {
  return sanitizeRect(
    {
      ...current,
      x: drag.startX + Math.round(dx / drag.columnStep),
      y: drag.startY + Math.round(dy / drag.rowStep),
    },
    item,
  );
}

/** T-503 (PERF-509): the quantized resize target (same discipline). */
function quantizedResizeTarget(
  resize: ResizeState,
  dx: number,
  dy: number,
  current: LayoutRect,
  item: DashboardLayoutItem,
): LayoutRect {
  return sanitizeRect(
    {
      ...current,
      w: resize.startW + Math.round(dx / resize.columnStep),
      h: resize.startH + Math.round(dy / resize.rowStep),
    },
    item,
  );
}

function sanitizeRect(rect: LayoutRect, item: DashboardLayoutItem): LayoutRect {
  const minW = clamp(item.minW ?? 1, 1, GRID_COLUMNS);
  const maxW = clamp(item.maxW ?? GRID_COLUMNS, minW, GRID_COLUMNS);
  const minH = Math.max(1, item.minH ?? 1);
  const maxH = Math.max(minH, item.maxH ?? 40);
  const w = clamp(Math.round(rect.w), minW, maxW);
  const h = clamp(Math.round(rect.h), minH, maxH);
  return {
    x: clamp(Math.round(rect.x), 0, GRID_COLUMNS - w),
    y: Math.max(0, Math.round(rect.y)),
    w,
    h,
    // T-503 (UI-335): the per-indicator visibility flag survives the
    // sanitize pass (geometry clamping never changes visibility).
    ...(rect.hidden === true ? { hidden: true } : {}),
  };
}

function readStoredLayout(storageKey: string): StoredLayout {
  // T-448: the key + the defensive parse live in the ONE shared module
  // (dashboard-layout-storage + the domain parser) — no duplicated shape.
  const raw = readDashboardLayoutCache(storageKey);
  if (!raw) return {};
  try {
    return parseStoredDashboardLayout(JSON.parse(raw)) ?? {};
  } catch {
    return {};
  }
}

function writeStoredLayout(storageKey: string, layout: StoredLayout) {
  writeDashboardLayoutCache(storageKey, JSON.stringify(layout));
}

function overlaps(a: LayoutRect, b: LayoutRect) {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

/**
 * T-503 (UI-336): the drag/resize SETTLE pass. During an interaction the
 * resolver pushes every overlapped sibling DOWN live (the user sees the
 * displacement as it happens); when the interaction ends, every sibling
 * that CAN return to its pre-interaction position does — the dropped /
 * resized item KEEPS its new rect, and anything it now genuinely overlaps
 * is re-pushed (the resolver re-run over the restored snapshot). This is
 * what heals the monotonic downward growth the mandate reported
 * ("dragging and resizing components leaves elements misaligned"):
 * displacement without occlusion is reverted, so a drag ACROSS a stack
 * no longer permanently relocates it, while a drop ON TOP of a sibling
 * still stacks correctly. Idempotent; returns the SAME object when
 * nothing can settle (no identity churn — the PERF-509 discipline).
 */
function settleLayout(
  current: StoredLayout,
  interactionId: string,
  snapshot: StoredLayout,
): StoredLayout {
  let changed = false;
  const settled: StoredLayout = {};
  for (const [id, rect] of Object.entries(current)) {
    if (id === interactionId) {
      settled[id] = rect;
      continue;
    }
    const home = snapshot[id];
    if (
      home &&
      (home.x !== rect.x ||
        home.y !== rect.y ||
        home.w !== rect.w ||
        home.h !== rect.h)
    ) {
      settled[id] = home;
      changed = true;
    } else {
      settled[id] = rect;
    }
  }
  if (!changed) return current;
  return resolveCollisions(settled, interactionId);
}

/**
 * T-504 (UI-337): the pure RESTORE computation — un-hide one indicator,
 * returning the next layout. Extracted from the old inline showItem body
 * (same semantics byte-for-byte) so the edit-mode restore (dirty, saved via
 * Enregistrer) and the NEW view-mode restore (persists immediately) ride
 * ONE implementation. The restored indicator re-enters the grid at its
 * stored rect; the load-time resolver semantics ("__load__" — push
 * whichever of an overlapping pair sits lower) heal any overlap a sibling
 * may have drifted into while this one was hidden. Idempotent: an already
 * visible id returns the SAME object.
 */
function buildShownLayout(previous: StoredLayout, id: string): StoredLayout {
  const rect = previous[id];
  if (!rect || rect.hidden !== true) return previous;
  const rest: LayoutRect = {
    x: rect.x,
    y: rect.y,
    w: rect.w,
    h: rect.h,
  };
  return resolveCollisions({ ...previous, [id]: rest }, "__load__");
}

function resolveCollisions(layout: StoredLayout, movedId: string): StoredLayout {
  // T-503 (PERF-509): COPY-ON-WRITE — a shallow carrier plus a new rect
  // object ONLY for the rects the pass actually moves. Untouched rects keep
  // their object identity across the interaction, which is what lets the
  // memoized cells (and React's element-identity bailout beneath them)
  // skip re-rendering every sibling while one card is dragged. When no
  // rect moves (an already-resolved layout re-checked), the ORIGINAL object
  // is returned — the callers' identity gates see the no-op.
  const result: StoredLayout = { ...layout };
  let mutated = false;

  for (let pass = 0; pass < 100; pass += 1) {
    let changed = false;
    const ordered = Object.entries(result).sort(([, a], [, b]) => {
      if (a.y !== b.y) return a.y - b.y;
      return a.x - b.x;
    });

    for (let i = 0; i < ordered.length; i += 1) {
      const [idA, a] = ordered[i];
      for (let j = i + 1; j < ordered.length; j += 1) {
        const [idB, b] = ordered[j];
        if (!overlaps(a, b)) continue;

        const pushId = idA === movedId ? idB : idB === movedId ? idA : idB;
        if (pushId === movedId) continue;
        const pushed = result[pushId];
        const nextY = Math.max(pushed.y, a.y + a.h);
        if (pushed.y !== nextY) {
          result[pushId] = { ...pushed, y: nextY };
          mutated = true;
          changed = true;
        }
      }
    }

    if (!changed) break;
  }

  if (!mutated) return layout;
  return result;
}

function buildInitialLayout(items: DashboardLayoutItem[], stored: StoredLayout): StoredLayout {
  const result: StoredLayout = {};
  let cursorX = 0;
  let cursorY = 0;
  let rowHeight = 0;

  for (const item of items) {
    const defaultW = clamp(item.w ?? GRID_COLUMNS, item.minW ?? 1, item.maxW ?? GRID_COLUMNS);
    const defaultH = clamp(item.h ?? DEFAULT_HEIGHT, item.minH ?? 1, item.maxH ?? 40);

    if (stored[item.id]) {
      result[item.id] = sanitizeRect(stored[item.id], item);
      continue;
    }

    if (item.x !== undefined || item.y !== undefined) {
      result[item.id] = sanitizeRect(
        { x: item.x ?? 0, y: item.y ?? cursorY, w: defaultW, h: defaultH },
        item,
      );
      continue;
    }

    if (cursorX + defaultW > GRID_COLUMNS && cursorX > 0) {
      cursorX = 0;
      cursorY += rowHeight + 1;
      rowHeight = 0;
    }

    result[item.id] = sanitizeRect(
      { x: cursorX, y: cursorY, w: defaultW, h: defaultH },
      item,
    );
    cursorX += defaultW + 1;
    rowHeight = Math.max(rowHeight, defaultH);
  }

  return result;
}

function layoutBottom(layout: StoredLayout) {
  let bottom = 8;
  // T-503 (UI-335): hidden indicators reserve no grid space — the
  // container's minHeight tracks the VISIBLE footprint only.
  for (const rect of Object.values(layout)) {
    if (rect.hidden) continue;
    bottom = Math.max(bottom, rect.y + rect.h);
  }
  return bottom;
}

/**
 * T-503 (PERF-509): the MEMOIZED grid cell. During a drag only the cells
 * whose props actually changed re-render: the dragged/active cell (its
 * rect + isActive flipped) and the siblings the resolver genuinely
 * pushed (their rect objects are replaced — copy-on-write). Every
 * untouched sibling's props are IDENTICAL (same item reference from the
 * parent's items array, same rect object reference, same stable handlers)
 * so React.memo bails and the whole subtree — wrapper, editing chrome and
 * card content — is skipped. Before this boundary every pointermove
 * re-rendered every wrapper cell on the board.
 */
const LayoutCell = memo(function LayoutCell({
  item,
  rect,
  editing,
  isActive,
  onDragStart,
  onResizeStart,
  onHide,
}: {
  item: DashboardLayoutItem;
  rect: LayoutRect;
  editing: boolean;
  isActive: boolean;
  onDragStart: (
    item: DashboardLayoutItem,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => void;
  onResizeStart: (
    item: DashboardLayoutItem,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => void;
  /** T-503 (UI-335): the per-indicator hide toggle (edit mode only). */
  onHide: (id: string) => void;
}) {
  return (
    <div
      // T-503 (UI-336): OVERFLOW CONTAINMENT — the cell is the hard
      // layout boundary. A card whose content exceeds the cell's fixed
      // track height used to paint over the cell below (CSS grid items
      // overflow their tracks by default; min-w/min-h only prevented the
      // grid blowout, not the overlap). The containment keeps text and
      // content within component borders; dropdowns and tooltips are
      // Radix portals, so they are unaffected by the clip.
      className={`relative min-w-0 min-h-0 overflow-hidden ${editing ? "rounded-xl ring-1 ring-primary/20 bg-surface-background/80" : ""} ${isActive ? "z-40 ring-2 ring-primary shadow-xl" : "z-10"}`}
      style={{
        gridColumn: `${rect.x + 1} / span ${rect.w}`,
        gridRow: `${rect.y + 1} / span ${rect.h}`,
      } as CSSProperties}
      data-dashboard-layout-id={item.id}
      data-dashboard-layout-label={item.label}
    >
      {editing && (
        <>
          <button
            type="button"
            aria-label={`Déplacer ${item.label}`}
            title={`Déplacer ${item.label}`}
            onPointerDown={(event) => onDragStart(item, event)}
            className="absolute left-2 top-2 z-50 inline-flex h-8 w-8 cursor-grab touch-none items-center justify-center rounded-md border border-primary/40 bg-surface-panel/95 text-primary shadow-sm active:cursor-grabbing"
          >
            <GripVertical className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label={`Redimensionner ${item.label}`}
            title={`Redimensionner ${item.label}`}
            onPointerDown={(event) => onResizeStart(item, event)}
            className="absolute bottom-2 right-2 z-50 inline-flex h-8 w-8 cursor-nwse-resize touch-none items-center justify-center rounded-md border border-primary/40 bg-surface-panel/95 text-primary shadow-sm active:cursor-nwse-resize"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
          <div className="absolute right-2 top-2 z-40 flex items-center gap-1.5">
            <div className="rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-mono text-primary">
              {rect.w}/12 × {rect.h}
            </div>
            {/* T-503 (UI-335): the per-indicator HIDE toggle — the owner's
                show/hide mandate, one toggle per indicator, persisted with
                the layout (same store, same explicit-save contract). */}
            <button
              type="button"
              aria-label={`Masquer ${item.label}`}
              title={`Masquer ${item.label}`}
              onClick={() => onHide(item.id)}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border/70 bg-surface-panel/95 text-muted-foreground shadow-sm transition-colors hover:border-primary/40 hover:text-primary"
            >
              <EyeOff className="h-3 w-3" />
            </button>
          </div>
        </>
      )}
      <div className="h-full min-h-0 min-w-0">{item.content}</div>
    </div>
  );
});

export function DashboardLayoutEditor({
  storageKey,
  items,
  editing = false,
  onSave,
  onReset,
}: {
  storageKey: string;
  items: DashboardLayoutItem[];
  /** Optional since the T-404 packaging-gate typecheck repair (2026-09-22): the parallel session's editor merge made it required, breaking 6 pre-existing test fixtures. Default: not editing. */
  editing?: boolean;
  onSave?: () => void;
  onReset?: () => void;
}) {
  // T-448 (UI-326): the dedicated layout store — the Supabase twin behind
  // the migration-0134 table in production, the localStorage twin in mock
  // mode (both satisfy the same contract; the mock reads/writes this
  // editor's own cache key, so mock mode is behaviorally unchanged).
  const repos = useRepositories();
  const gridRef = useRef<HTMLDivElement | null>(null);
  const dragState = useRef<DragState | null>(null);
  const resizeState = useRef<ResizeState | null>(null);
  // T-503 (UI-336): the pre-interaction layout snapshot — taken at every
  // drag/resize START, consumed by the settle pass at pointer-up so the
  // siblings the resolver displaced during the interaction can return home
  // when the dropped item no longer occludes them.
  const interactionRef = useRef<{ id: string; snapshot: StoredLayout } | null>(
    null,
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  // T-448: "saved" | "save-failed" | null — the explicit save's server
  // outcome, surfaced inline in the editing banner (fail-loud, never a
  // silent drop; the local cache keeps the layout either way).
  const [saveState, setSaveState] = useState<"saved" | "save-failed" | null>(null);
  const [layout, setLayout] = useState<StoredLayout>(() =>
    // Load-time healing: a stored rect can be stale — e.g. a widget whose
    // default height was later raised would already overlap its neighbour in
    // the persisted grid (rows are fixed tracks, so two items sharing a track
    // render on top of each other). `resolveCollisions` is the SAME resolver
    // the drag/resize handlers use; the sentinel id means "nothing is being
    // dragged", i.e. push whichever of the two sits lower. For a clean layout
    // this is a no-op.
    resolveCollisions(
      buildInitialLayout(items, readStoredLayout(storageKey)),
      "__load__",
    ),
  );

  // T-448: `items` is rebuilt by every parent render (no useMemo at the
  // call sites) and the load effect must run ONCE per storageKey (not per
  // parent render) — the ref carries the fresh items without re-triggering.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  // T-503 (PERF-509): the same fresh-value pattern for the layout — the
  // pointermove handlers and the drag/resize starts read the CURRENT rect
  // through this ref (outside the setState updater), which is what lets
  // them gate the sub-cell jitter BEFORE any state is touched and keeps
  // the start handlers referentially stable for the memoized cells.
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  // StrictMode double-invokes effects in dev — the sentinel makes the
  // server load idempotent (the second invocation is a no-op).
  const serverLoadDoneFor = useRef<string | null>(null);

  useEffect(() => {
    if (serverLoadDoneFor.current === storageKey) return;
    serverLoadDoneFor.current = storageKey;

    // NOTE: no cancellation flag on purpose. StrictMode's dev cycle
    // (mount → effect → cleanup → effect) would cancel the ONLY load the
    // sentinel allows (the second run is a no-op) — the saved layout
    // would never apply in development. After a REAL unmount, a late
    // setState is a React-18 no-op and the cache write / idempotent
    // promotion save are both harmless — the exactly-once semantics the
    // sentinel gives are worth more than the cancelled flag.
    void (async () => {
      // T-504 (UI-337): the local-cache snapshot is taken BEFORE awaiting
      // the server load — the promotion can never race a persist that
      // lands while the load is in flight (the view-mode restore bar now
      // persists outside edit mode, making that window reachable: the
      // promotion used to re-read the cache AFTER the await and could
      // double-save — or worse, save a stale pre-restore snapshot over the
      // user's just-saved restore on a slow load).
      const localAtMount = readStoredLayout(storageKey);
      const loaded = await repos.dashboardLayouts.load(storageKey);
      if (!loaded.ok) {
        // Offline/degraded: the local cache (already applied in the state
        // initializer) stays the working layout — honest degradation, the
        // §15.63 keep-last-known convention.
        logger.warn("dashboard-layout: server load failed; using local cache", {
          viewKey: storageKey,
          error: loaded.error.message,
        });
        return;
      }

      if (loaded.value) {
        // The SAVED server layout WINS over any local residue (the owner's
        // "reuse the exact same saved layout" contract — unsaved local
        // leftovers never override an explicit save). Skipped while dirty:
        // the user is mid-edit and their in-flight work takes precedence
        // (their next explicit save will win).
        const serverLayout = loaded.value as StoredDashboardLayout;
        setDirty((currentlyDirty) => {
          if (!currentlyDirty) {
            setLayout(
              resolveCollisions(
                buildInitialLayout(itemsRef.current, serverLayout),
                "__load__",
              ),
            );
            // Refresh the offline cache so the next mount starts identical.
            writeStoredLayout(storageKey, serverLayout);
          }
          return currentlyDirty;
        });
        return;
      }

      // No server row yet: if the user already had a local layout (saved in
      // the localStorage-only era, or on a fresh profile with cache), PROMOTE
      // it to the server ONCE — the "configure once, never again" migration
      // for pre-T-448 layouts. A failed promotion is NOT an error: the next
      // mount retries it.
      const local = localAtMount;
      if (Object.keys(local).length > 0) {
        const promoted = await repos.dashboardLayouts.save(storageKey, local);
        if (!promoted.ok) {
          logger.warn(
            "dashboard-layout: one-time promotion of the local layout deferred (will retry on next mount)",
            { viewKey: storageKey, error: promoted.error.message },
          );
        }
      }
    })();
  }, [repos.dashboardLayouts, storageKey]);

  useEffect(() => {
    if (!dirty) return;
    const timer = window.setTimeout(() => writeStoredLayout(storageKey, layout), 250);
    return () => window.clearTimeout(timer);
  }, [dirty, layout, storageKey]);

  useEffect(() => {
    if (!editing) {
      dragState.current = null;
      resizeState.current = null;
      setActiveId(null);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      return;
    }

    const onPointerMove = (event: PointerEvent) => {
      const drag = dragState.current;
      if (drag && event.pointerId === drag.pointerId) {
        const dx = event.clientX - drag.startPointerX;
        const dy = event.clientY - drag.startPointerY;
        // T-503 (PERF-509): QUANTIZE-THEN-COMPARE — the grid cell the
        // pointer lands on is computed against the CURRENT rect first;
        // sub-cell jitter (the pointer still inside the same cell — the
        // majority of move events between two grid snaps) touches NO
        // state at all: no setLayout, no collision pass, no re-render, no
        // dirty flag. Only a real cell change enters the pipeline.
        const item = itemsRef.current.find(
          (candidate) => candidate.id === drag.id,
        );
        const current = layoutRef.current[drag.id];
        if (item && current) {
          const moved = quantizedDragTarget(drag, dx, dy, current, item);
          if (!rectsEqual(moved, current)) {
            setLayout((previous) => {
              // Re-verify against `previous`: several move events can fire
              // between two renders (the layoutRef may be one update
              // behind) — the updater is the single source of truth.
              const cur = previous[drag.id];
              if (!cur || rectsEqual(moved, cur)) return previous;
              return resolveCollisions(
                { ...previous, [drag.id]: moved },
                drag.id,
              );
            });
            setDirty(true);
          }
        }
        return;
      }

      const resize = resizeState.current;
      if (resize && event.pointerId === resize.pointerId) {
        const dx = event.clientX - resize.startPointerX;
        const dy = event.clientY - resize.startPointerY;
        // T-503 (PERF-509): the same quantize-then-compare gate for the
        // resize interactions.
        const item = itemsRef.current.find(
          (candidate) => candidate.id === resize.id,
        );
        const current = layoutRef.current[resize.id];
        if (item && current) {
          const resized = quantizedResizeTarget(
            resize,
            dx,
            dy,
            current,
            item,
          );
          if (!rectsEqual(resized, current)) {
            setLayout((previous) => {
              const cur = previous[resize.id];
              if (!cur || rectsEqual(resized, cur)) return previous;
              return resolveCollisions(
                { ...previous, [resize.id]: resized },
                resize.id,
              );
            });
            setDirty(true);
          }
        }
      }
    };

    const onPointerUp = (event: PointerEvent) => {
      const endedInteraction = interactionRef.current;
      const wasInteracting =
        dragState.current?.pointerId === event.pointerId ||
        resizeState.current?.pointerId === event.pointerId;
      if (dragState.current?.pointerId === event.pointerId)
        dragState.current = null;
      if (resizeState.current?.pointerId === event.pointerId)
        resizeState.current = null;
      if (!dragState.current && !resizeState.current) setActiveId(null);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      // T-503 (UI-336): the SETTLE — the interaction's displaced siblings
      // return to their pre-interaction positions unless the dropped /
      // resized item now genuinely occludes them (settleLayout re-runs the
      // resolver over the restored snapshot). Identity-preserving when
      // nothing can settle.
      if (wasInteracting && endedInteraction) {
        interactionRef.current = null;
        const { id, snapshot } = endedInteraction;
        setLayout((previous) => settleLayout(previous, id, snapshot));
      }
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [editing]);

  function measureSteps() {
    const rect = gridRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const widthWithoutGaps = rect.width - GRID_GAP * (GRID_COLUMNS - 1);
    const columnWidth = widthWithoutGaps / GRID_COLUMNS;
    return {
      columnStep: columnWidth + GRID_GAP,
      rowStep: ROW_HEIGHT + GRID_GAP,
    };
  }

  // T-503 (PERF-509): referentially-stable interaction starts — they read
  // the current rect through layoutRef (never the render closure's layout),
  // so the identity only changes with the editing toggle. This is what the
  // memoized cells compare to decide whether they can skip a re-render.
  const startDrag = useCallback(
    (item: DashboardLayoutItem, event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!editing) return;
      const steps = measureSteps();
      if (!steps) return;
      const current = layoutRef.current[item.id];
      if (!current) return;
      event.preventDefault();
      event.stopPropagation();
      // T-503 (UI-336): the pre-drag snapshot for the pointer-up settle.
      interactionRef.current = { id: item.id, snapshot: layoutRef.current };
      dragState.current = {
        id: item.id,
        startPointerX: event.clientX,
        startPointerY: event.clientY,
        startX: current.x,
        startY: current.y,
        columnStep: steps.columnStep,
        rowStep: steps.rowStep,
        pointerId: event.pointerId,
      };
      resizeState.current = null;
      setActiveId(item.id);
      document.body.style.userSelect = "none";
      document.body.style.cursor = "grabbing";
    },
    // PERF-503: only `editing` is captured — measureSteps reads gridRef
    // (a ref); layoutRef/itemsRef/interactionRef/dragState are refs;
    // setActiveId is a stable setter.
    [editing],
  );

  const startResize = useCallback(
    (item: DashboardLayoutItem, event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!editing) return;
      const steps = measureSteps();
      if (!steps) return;
      const current = layoutRef.current[item.id];
      if (!current) return;
      event.preventDefault();
      event.stopPropagation();
      // T-503 (UI-336): the pre-resize snapshot for the pointer-up settle.
      interactionRef.current = { id: item.id, snapshot: layoutRef.current };
      resizeState.current = {
        id: item.id,
        startPointerX: event.clientX,
        startPointerY: event.clientY,
        startW: current.w,
        startH: current.h,
        columnStep: steps.columnStep,
        rowStep: steps.rowStep,
        pointerId: event.pointerId,
      };
      dragState.current = null;
      setActiveId(item.id);
      document.body.style.userSelect = "none";
      document.body.style.cursor = "nwse-resize";
    },
    // PERF-503: same refs as startDrag; only `editing` is captured.
    [editing],
  );

  function persistNow(next: StoredLayout = layout) {
    writeStoredLayout(storageKey, next);
    setDirty(false);
    setSaveState(null);
    onSave?.();
    // T-448: the EXPLICIT save — the one and only path that updates the
    // saved server configuration ("only update the saved configuration when
    // I explicitly change and save it"). The local cache above keeps the
    // layout usable offline whatever the server outcome. T-504 (UI-337):
    // the optional `next` argument lets the view-mode restore bar persist
    // a JUST-COMPUTED layout (the caller's buildShownLayout result) — the
    // closure `layout` would be one render behind at that moment.
    void repos.dashboardLayouts.save(storageKey, next).then((result) => {
      setSaveState(result.ok ? "saved" : "save-failed");
      if (!result.ok) {
        logger.warn("dashboard-layout: server save failed", {
          viewKey: storageKey,
          error: result.error.message,
        });
      }
    });
  }

  // T-503 (UI-335): the per-indicator SHOW/HIDE toggles. Both ride the
  // SAME layout object (persisted by the existing explicit-save path — no
  // parallel visibility store) and both mark the layout dirty so the
  // Enregistrer button lights up exactly like a drag/resize would.
  const hideItem = useCallback((id: string) => {
    setLayout((previous) => {
      const rect = previous[id];
      if (!rect || rect.hidden === true) return previous;
      return { ...previous, [id]: { ...rect, hidden: true } };
    });
    setDirty(true);
  }, []);

  const showItem = useCallback((id: string) => {
    setLayout((previous) => buildShownLayout(previous, id));
    setDirty(true);
  }, []);

  // T-504 (UI-337): the VIEW-MODE restore — the click IS the explicit
  // change, so it persists IMMEDIATELY (the T-448 explicit-save contract
  // stays intact for edit mode; a view-mode user has no Enregistrer button,
  // so leaving the restore dirty-only would silently lose it on unmount).
  // Reads the CURRENT layout through layoutRef (never a stale closure) and
  // persists the computed NEXT object directly (the setLayout below and
  // the save below see the SAME layout — no race). Deliberately NOT
  // useCallback-wrapped: it calls persistNow (a per-render closure over
  // storageKey/onSave/repos) and no memoized cell depends on it — the
  // view-mode bar reads it fresh every render.
  function showItemAndPersist(id: string) {
    const next = buildShownLayout(layoutRef.current, id);
    setLayout(next);
    persistNow(next);
  }

  // T-504 (UI-337): the view-mode restore-ALL — one click un-hides every
  // hidden indicator of this view and persists once. Each unhide re-runs
  // the load-time resolver (a returning indicator yields to whatever now
  // occupies its stored rect — the same semantics as an individual
  // restore, applied in sequence).
  function showAllAndPersist() {
    let next = layoutRef.current;
    let changed = false;
    for (const item of itemsRef.current) {
      if (next[item.id]?.hidden === true) {
        next = buildShownLayout(next, item.id);
        changed = true;
      }
    }
    if (!changed) return;
    setLayout(next);
    persistNow(next);
  }

  function reset() {
    removeDashboardLayoutCache(storageKey);
    setLayout(buildInitialLayout(itemsRef.current, {}));
    setDirty(false);
    setSaveState(null);
    onReset?.();
    // T-448: Réinitialiser clears the SAVED configuration too — the saved
    // row must go, or the next mount would resurrect the layout the user
    // just reset (the server row wins on load).
    void repos.dashboardLayouts.clear(storageKey).then((result) => {
      if (!result.ok) {
        logger.warn("dashboard-layout: server clear failed", {
          viewKey: storageKey,
          error: result.error.message,
        });
      }
    });
  }

  const contentRows = useMemo(() => layoutBottom(layout), [layout]);
  // T-503 (UI-335): the visible/hidden split — hidden indicators render in
  // NEITHER mode's grid (view mode: simply absent; edit mode: listed in the
  // restoration tray below the grid instead).
  const visibleItems = useMemo(
    () => items.filter((item) => layout[item.id]?.hidden !== true),
    [items, layout],
  );
  const hiddenItems = useMemo(
    () => items.filter((item) => layout[item.id]?.hidden === true),
    [items, layout],
  );

  return (
    <>
      {editing && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
          <span>
            Mode personnalisation actif — chaque bloc a une poignée de déplacement et un coin de redimensionnement.
            {/* T-448: the explicit save's honest outcome (fail-loud inline). */}
            {saveState === "saved" && (
              <span className="ml-2 rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-600 dark:text-emerald-400">
                Disposition enregistrée
              </span>
            )}
            {saveState === "save-failed" && (
              <span className="ml-2 rounded bg-destructive/10 px-1.5 py-0.5 text-destructive">
                Serveur injoignable — conservé localement, réessayez
              </span>
            )}
          </span>
          <div className="flex items-center gap-1.5 shrink-0">
            <button type="button" onClick={reset} className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-panel px-2 py-1 hover:bg-muted">
              <RotateCcw className="h-3 w-3" /> Réinitialiser
            </button>
            <button type="button" onClick={() => persistNow()} disabled={!dirty} className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-primary-foreground disabled:opacity-50">
              <Save className="h-3 w-3" /> Enregistrer
            </button>
          </div>
        </div>
      )}

      {/* T-504 (UI-337): the VIEW-MODE hidden-indicator restore bar — the
          discoverability fix for the owner's report ("there is no way to…
          see the thing I toggled off to bring them back"). Whenever hidden
          indicators exist OUTSIDE edit mode, this compact bar renders with
          the grid: the hidden count, one chip per hidden indicator (a
          one-click Afficher that restores AND persists immediately — the
          click IS the explicit change), and the Tout afficher
          restore-all. The edit-mode home of hidden items stays the tray
          below the grid (the Enregistrer flow); this bar serves the reader
          persona that never enters edit mode. */}
      {!editing && hiddenItems.length > 0 && (
        <div
          data-testid="dashboard-hidden-restore-bar"
          className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border/70 bg-surface-panel/60 px-3 py-2 text-xs text-muted-foreground"
        >
          <span className="inline-flex items-center gap-1.5 font-semibold uppercase tracking-wider">
            <EyeOff className="h-3.5 w-3.5" />
            {hiddenItems.length === 1
              ? "1 indicateur masqué"
              : `${hiddenItems.length} indicateurs masqués`}
          </span>
          {hiddenItems.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-label={`Afficher ${item.label}`}
              title={`Afficher ${item.label}`}
              onClick={() => showItemAndPersist(item.id)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-surface-elevated/40 px-2.5 py-1.5 font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
            >
              <Eye className="h-3 w-3" />
              {item.label}
            </button>
          ))}
          <button
            type="button"
            aria-label="Tout afficher"
            title="Réafficher tous les indicateurs masqués"
            onClick={showAllAndPersist}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-2.5 py-1.5 font-medium text-primary transition-colors hover:bg-primary/10"
          >
            <Eye className="h-3 w-3" />
            Tout afficher
          </button>
          {/* The honest save-outcome hint (the T-448 save-failed posture —
              the local cache keeps the restore; the server retry can wait). */}
          {saveState === "save-failed" && (
            <span className="w-full text-destructive">
              Serveur injoignable — restauration conservée localement, réessayez depuis la personnalisation
            </span>
          )}
        </div>
      )}

      <div
        ref={gridRef}
        className={`relative grid grid-cols-12 gap-3 pb-8 ${editing ? "rounded-xl border border-dashed border-primary/30 bg-[linear-gradient(to_right,hsl(var(--primary)/0.06)_1px,transparent_1px),linear-gradient(to_bottom,hsl(var(--primary)/0.06)_1px,transparent_1px)] bg-[size:8.333%_32px] p-2" : ""}`}
        style={{
          gridAutoRows: `${ROW_HEIGHT}px`,
          minHeight: `${contentRows * ROW_HEIGHT + Math.max(0, contentRows - 1) * GRID_GAP + 16}px`,
        }}
      >
        {visibleItems.map((item) => {
          const rect = layout[item.id] ?? sanitizeRect(
            { x: 0, y: 0, w: item.w ?? GRID_COLUMNS, h: item.h ?? DEFAULT_HEIGHT },
            item,
          );
          return (
            <LayoutCell
              key={item.id}
              item={item}
              rect={rect}
              editing={editing}
              isActive={activeId === item.id}
              onDragStart={startDrag}
              onResizeStart={startResize}
              onHide={hideItem}
            />
          );
        })}
      </div>

      {/* T-503 (UI-335): the all-hidden honest empty state — the view never
          renders a silently blank dashboard. T-504 (UI-337): the guidance
          now points at the ALWAYS-PRESENT view-mode restore bar above
          (no edit-mode knowledge required). */}
      {visibleItems.length === 0 && (
        <div
          className="rounded-xl border border-dashed border-border/70 bg-surface-panel/50 px-4 py-10 text-center text-xs text-muted-foreground"
          data-testid="dashboard-all-hidden"
        >
          Tous les indicateurs de cette vue sont masqués. Utilisez la barre
          « {hiddenItems.length === 1 ? "1 indicateur masqué" : `${hiddenItems.length} indicateurs masqués`} »
          ci-dessus : « Afficher » restaure un indicateur, « Tout afficher »
          les rétablit tous en une fois.
        </div>
      )}

      {/* T-503 (UI-335): the HIDDEN INDICATORS TRAY — the edit-mode home of
          every hidden item (one-click restore, per-indicator). */}
      {editing && hiddenItems.length > 0 && (
        <div
          className="mt-3 rounded-lg border border-dashed border-border/70 bg-surface-panel/60 px-3 py-2.5"
          data-testid="dashboard-hidden-tray"
        >
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Indicateurs masqués ({hiddenItems.length})
          </span>
          <div className="mt-2 flex flex-wrap gap-2">
            {hiddenItems.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-label={`Afficher ${item.label}`}
                title={`Afficher ${item.label}`}
                onClick={() => showItem(item.id)}
                className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-surface-elevated/40 px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
              >
                <Eye className="h-3 w-3" />
                {item.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
