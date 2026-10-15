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
import {
  Eye,
  EyeOff,
  GripVertical,
  Maximize2,
  RotateCcw,
  Save,
} from "lucide-react";
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
import { cn } from "../../shared/ui/cn";

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

type LayoutRect = {
  x: number;
  y: number;
  w: number;
  h: number;
  hidden?: boolean;
};
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
const DEFAULT_HEIGHT = 8;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function rectsEqual(a: LayoutRect, b: LayoutRect) {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

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
  const maxH = Math.max(minH, item.maxH ?? 80);
  const w = clamp(Math.round(rect.w), minW, maxW);
  const h = clamp(Math.round(rect.h), minH, maxH);
  return {
    x: clamp(Math.round(rect.x), 0, GRID_COLUMNS - w),
    y: Math.max(0, Math.round(rect.y)),
    w,
    h,
    ...(rect.hidden === true ? { hidden: true } : {}),
  };
}

function readStoredLayout(storageKey: string): StoredLayout {
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
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
  );
}

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

function resolveCollisions(
  layout: StoredLayout,
  movedId: string,
): StoredLayout {
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

function buildInitialLayout(
  items: DashboardLayoutItem[],
  stored: StoredLayout,
): StoredLayout {
  const result: StoredLayout = {};
  let cursorX = 0;
  let cursorY = 0;
  let rowHeight = 0;

  for (const item of items) {
    const defaultW = clamp(
      item.w ?? GRID_COLUMNS,
      item.minW ?? 1,
      item.maxW ?? GRID_COLUMNS,
    );
    const defaultH = clamp(
      item.h ?? DEFAULT_HEIGHT,
      item.minH ?? 1,
      item.maxH ?? 80,
    );

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
  for (const rect of Object.values(layout)) {
    if (rect.hidden) continue;
    bottom = Math.max(bottom, rect.y + rect.h);
  }
  return bottom;
}

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
  onHide: (id: string) => void;
}) {
  return (
    <div
      className={cn(
        "relative min-w-0 transition-all",
        editing
          ? "min-h-0 overflow-hidden rounded-xl ring-1 ring-primary/20 bg-surface-background/80"
          : "h-auto overflow-visible",
        isActive ? "z-40 ring-2 ring-primary shadow-xl" : "z-10",
      )}
      style={
        {
          gridColumn: `${rect.x + 1} / span ${rect.w}`,
          // T-536 (UI-349): the saved row geometry renders in VIEW mode too
          // (b4a441e's auto-placement silently discarded y/h outside edit
          // mode, so moving/resizing a card had no visible effect). Combined
          // with the container's minmax view rows, a card keeps its saved
          // span as a MINIMUM and the tracks grow when content needs more.
          gridRow: `${rect.y + 1} / span ${rect.h}`,
        } as CSSProperties
      }
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
      <div className={editing ? "h-full min-h-0 min-w-0" : "h-full min-w-0"}>
        {item.content}
      </div>
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
  editing?: boolean;
  onSave?: () => void;
  onReset?: () => void;
}) {
  const repos = useRepositories();
  const gridRef = useRef<HTMLDivElement | null>(null);
  const dragState = useRef<DragState | null>(null);
  const resizeState = useRef<ResizeState | null>(null);
  const interactionRef = useRef<{ id: string; snapshot: StoredLayout } | null>(
    null,
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "save-failed" | null>(
    null,
  );
  const [layout, setLayout] = useState<StoredLayout>(() =>
    resolveCollisions(
      buildInitialLayout(items, readStoredLayout(storageKey)),
      "__load__",
    ),
  );

  const itemsRef = useRef(items);
  itemsRef.current = items;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const serverLoadDoneFor = useRef<string | null>(null);

  useEffect(() => {
    if (serverLoadDoneFor.current === storageKey) return;
    serverLoadDoneFor.current = storageKey;

    void (async () => {
      const localAtMount = readStoredLayout(storageKey);
      const loaded = await repos.dashboardLayouts.load(storageKey);
      if (!loaded.ok) {
        logger.warn("dashboard-layout: server load failed; using local cache", {
          viewKey: storageKey,
          error: loaded.error.message,
        });
        return;
      }

      if (loaded.value) {
        const serverLayout = loaded.value as StoredDashboardLayout;
        setDirty((currentlyDirty) => {
          if (!currentlyDirty) {
            setLayout(
              resolveCollisions(
                buildInitialLayout(itemsRef.current, serverLayout),
                "__load__",
              ),
            );
            writeStoredLayout(storageKey, serverLayout);
          }
          return currentlyDirty;
        });
        return;
      }

      const local = localAtMount;
      if (Object.keys(local).length > 0) {
        const promoted = await repos.dashboardLayouts.save(storageKey, local);
        if (!promoted.ok) {
          logger.warn(
            "dashboard-layout: one-time promotion of local layout deferred",
            { viewKey: storageKey, error: promoted.error.message },
          );
        }
      }
    })();
  }, [repos.dashboardLayouts, storageKey]);

  useEffect(() => {
    if (!dirty) return;
    const timer = window.setTimeout(
      () => writeStoredLayout(storageKey, layout),
      250,
    );
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
        const item = itemsRef.current.find(
          (candidate) => candidate.id === drag.id,
        );
        const current = layoutRef.current[drag.id];
        if (item && current) {
          const moved = quantizedDragTarget(drag, dx, dy, current, item);
          if (!rectsEqual(moved, current)) {
            setLayout((previous) => {
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
        const item = itemsRef.current.find(
          (candidate) => candidate.id === resize.id,
        );
        const current = layoutRef.current[resize.id];
        if (item && current) {
          const resized = quantizedResizeTarget(resize, dx, dy, current, item);
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

  const startDrag = useCallback(
    (
      item: DashboardLayoutItem,
      event: ReactPointerEvent<HTMLButtonElement>,
    ) => {
      if (!editing) return;
      const steps = measureSteps();
      if (!steps) return;
      const current = layoutRef.current[item.id];
      if (!current) return;
      event.preventDefault();
      event.stopPropagation();
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
    [editing],
  );

  const startResize = useCallback(
    (
      item: DashboardLayoutItem,
      event: ReactPointerEvent<HTMLButtonElement>,
    ) => {
      if (!editing) return;
      const steps = measureSteps();
      if (!steps) return;
      const current = layoutRef.current[item.id];
      if (!current) return;
      event.preventDefault();
      event.stopPropagation();
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
    [editing],
  );

  function persistNow(next: StoredLayout = layout) {
    writeStoredLayout(storageKey, next);
    setDirty(false);
    setSaveState(null);
    onSave?.();
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

  function showItemAndPersist(id: string) {
    const next = buildShownLayout(layoutRef.current, id);
    setLayout(next);
    persistNow(next);
  }

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
  const visibleItems = useMemo(
    () => items.filter((item) => layout[item.id]?.hidden !== true),
    [items, layout],
  );
  const hiddenItems = useMemo(
    () => items.filter((item) => layout[item.id]?.hidden === true),
    [items, layout],
  );

  // When viewing, sort items by their visual coordinates (y then x) so they flow naturally
  const displayItems = useMemo(() => {
    if (editing) return visibleItems;
    return [...visibleItems].sort((a, b) => {
      const ra = layout[a.id] ?? { x: a.x ?? 0, y: a.y ?? 0 };
      const rb = layout[b.id] ?? { x: b.x ?? 0, y: b.y ?? 0 };
      if (ra.y !== rb.y) return ra.y - rb.y;
      return ra.x - rb.x;
    });
  }, [visibleItems, layout, editing]);

  return (
    <>
      {editing && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
          <span>
            Mode personnalisation actif — déplacez les cartes avec la poignée et
            redimensionnez-les avec le coin.
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
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-panel px-2.5 py-1 text-xs hover:bg-muted"
            >
              <RotateCcw className="h-3 w-3" /> Réinitialiser
            </button>
            <button
              type="button"
              onClick={() => persistNow()}
              disabled={!dirty}
              className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs text-primary-foreground disabled:opacity-50"
            >
              <Save className="h-3 w-3" /> Enregistrer
            </button>
          </div>
        </div>
      )}

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
          {/* T-504 (UI-337) restored (T-536): the honest save-outcome hint
              must live in the VIEW bar too — a restore that persists
              locally while the server is down shows its failure here,
              not only inside the edit-mode banner (b4a441e dropped it). */}
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
          // T-536 (UI-349): BOTH modes place cards at their saved gridRow —
          // the saved layout IS the rendered layout. The difference is the
          // track budget: edit mode pins 32px rows (predictable drag/resize
          // math on the schematic canvas), while view mode lets every row
          // GROW past the 32px floor when a card's content needs more
          // (the owner's vertical-growth mandate — no clipping, no ignore).
          gridAutoRows: editing ? `${ROW_HEIGHT}px` : `minmax(${ROW_HEIGHT}px, auto)`,
          minHeight: editing
            ? `${contentRows * ROW_HEIGHT + Math.max(0, contentRows - 1) * GRID_GAP + 16}px`
            : undefined,
        }}
      >
        {displayItems.map((item) => {
          const rect =
            layout[item.id] ??
            sanitizeRect(
              {
                x: 0,
                y: 0,
                w: item.w ?? GRID_COLUMNS,
                h: item.h ?? DEFAULT_HEIGHT,
              },
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

      {/* T-504 (UI-337): the all-hidden honest state — the guidance names
          the bar's actual buttons (« Afficher » / « Tout afficher ») so the
          operator never needs edit-mode knowledge to restore (restored
          verbatim by T-536 after b4a441e shortened it past the contract). */}
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
