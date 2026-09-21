import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { GripVertical, Maximize2, RotateCcw, Save } from "lucide-react";

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

type LayoutRect = { x: number; y: number; w: number; h: number };
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

const STORAGE_PREFIX = "el-imtiyaz:dashboard-layout:";
const GRID_COLUMNS = 12;
const ROW_HEIGHT = 32;
const GRID_GAP = 12;
const DEFAULT_HEIGHT = 6;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
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
  };
}

function readStoredLayout(storageKey: string): StoredLayout {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    const result: StoredLayout = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const candidate = value as Record<string, unknown>;
      if (
        typeof candidate.x === "number" &&
        typeof candidate.y === "number" &&
        typeof candidate.w === "number" &&
        typeof candidate.h === "number"
      ) {
        result[id] = {
          x: candidate.x,
          y: candidate.y,
          w: candidate.w,
          h: candidate.h,
        };
      }
    }
    return result;
  } catch {
    return {};
  }
}

function writeStoredLayout(storageKey: string, layout: StoredLayout) {
  try {
    localStorage.setItem(STORAGE_PREFIX + storageKey, JSON.stringify(layout));
  } catch {
    // The editor remains usable when local persistence is unavailable.
  }
}

function overlaps(a: LayoutRect, b: LayoutRect) {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

function resolveCollisions(layout: StoredLayout, movedId: string): StoredLayout {
  const result: StoredLayout = Object.fromEntries(
    Object.entries(layout).map(([id, rect]) => [id, { ...rect }]),
  );

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
          pushed.y = nextY;
          changed = true;
        }
      }
    }

    if (!changed) break;
  }

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
  for (const rect of Object.values(layout)) bottom = Math.max(bottom, rect.y + rect.h);
  return bottom;
}

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
  const gridRef = useRef<HTMLDivElement | null>(null);
  const dragState = useRef<DragState | null>(null);
  const resizeState = useRef<ResizeState | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [layout, setLayout] = useState<StoredLayout>(() =>
    buildInitialLayout(items, readStoredLayout(storageKey)),
  );

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
        setLayout((previous) => {
          const item = items.find((candidate) => candidate.id === drag.id);
          const current = previous[drag.id];
          if (!item || !current) return previous;
          const moved = sanitizeRect(
            {
              ...current,
              x: drag.startX + Math.round(dx / drag.columnStep),
              y: drag.startY + Math.round(dy / drag.rowStep),
            },
            item,
          );
          return resolveCollisions({ ...previous, [drag.id]: moved }, drag.id);
        });
        setDirty(true);
        return;
      }

      const resize = resizeState.current;
      if (resize && event.pointerId === resize.pointerId) {
        const dx = event.clientX - resize.startPointerX;
        const dy = event.clientY - resize.startPointerY;
        setLayout((previous) => {
          const item = items.find((candidate) => candidate.id === resize.id);
          const current = previous[resize.id];
          if (!item || !current) return previous;
          const resized = sanitizeRect(
            {
              ...current,
              w: resize.startW + Math.round(dx / resize.columnStep),
              h: resize.startH + Math.round(dy / resize.rowStep),
            },
            item,
          );
          return resolveCollisions({ ...previous, [resize.id]: resized }, resize.id);
        });
        setDirty(true);
      }
    };

    const onPointerUp = (event: PointerEvent) => {
      if (dragState.current?.pointerId === event.pointerId) dragState.current = null;
      if (resizeState.current?.pointerId === event.pointerId) resizeState.current = null;
      if (!dragState.current && !resizeState.current) setActiveId(null);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [editing, items]);

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

  function startDrag(item: DashboardLayoutItem, event: ReactPointerEvent<HTMLButtonElement>) {
    if (!editing) return;
    const steps = measureSteps();
    if (!steps) return;
    const current = layout[item.id];
    if (!current) return;
    event.preventDefault();
    event.stopPropagation();
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
  }

  function startResize(item: DashboardLayoutItem, event: ReactPointerEvent<HTMLButtonElement>) {
    if (!editing) return;
    const steps = measureSteps();
    if (!steps) return;
    const current = layout[item.id];
    if (!current) return;
    event.preventDefault();
    event.stopPropagation();
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
  }

  function persistNow() {
    writeStoredLayout(storageKey, layout);
    setDirty(false);
    onSave?.();
  }

  function reset() {
    try {
      localStorage.removeItem(STORAGE_PREFIX + storageKey);
    } catch {
      // Ignore persistence failures.
    }
    setLayout(buildInitialLayout(items, {}));
    setDirty(false);
    onReset?.();
  }

  const contentRows = useMemo(() => layoutBottom(layout), [layout]);

  return (
    <>
      {editing && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
          <span>Mode personnalisation actif — chaque bloc a une poignée de déplacement et un coin de redimensionnement.</span>
          <div className="flex items-center gap-1.5 shrink-0">
            <button type="button" onClick={reset} className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-panel px-2 py-1 hover:bg-muted">
              <RotateCcw className="h-3 w-3" /> Réinitialiser
            </button>
            <button type="button" onClick={persistNow} disabled={!dirty} className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-primary-foreground disabled:opacity-50">
              <Save className="h-3 w-3" /> Enregistrer
            </button>
          </div>
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
        {items.map((item) => {
          const rect = layout[item.id] ?? sanitizeRect(
            { x: 0, y: 0, w: item.w ?? GRID_COLUMNS, h: item.h ?? DEFAULT_HEIGHT },
            item,
          );
          const isActive = activeId === item.id;
          return (
            <div
              key={item.id}
              className={`relative min-w-0 min-h-0 ${editing ? "rounded-xl ring-1 ring-primary/20 bg-surface-background/80" : ""} ${isActive ? "z-40 ring-2 ring-primary shadow-xl" : "z-10"}`}
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
                    onPointerDown={(event) => startDrag(item, event)}
                    className="absolute left-2 top-2 z-50 inline-flex h-8 w-8 cursor-grab touch-none items-center justify-center rounded-md border border-primary/40 bg-surface-panel/95 text-primary shadow-sm active:cursor-grabbing"
                  >
                    <GripVertical className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Redimensionner ${item.label}`}
                    title={`Redimensionner ${item.label}`}
                    onPointerDown={(event) => startResize(item, event)}
                    className="absolute bottom-2 right-2 z-50 inline-flex h-8 w-8 cursor-nwse-resize touch-none items-center justify-center rounded-md border border-primary/40 bg-surface-panel/95 text-primary shadow-sm active:cursor-nwse-resize"
                  >
                    <Maximize2 className="h-3.5 w-3.5" />
                  </button>
                  <div className="absolute right-2 top-2 z-40 rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-mono text-primary">
                    {rect.w}/12 × {rect.h}
                  </div>
                </>
              )}
              <div className="h-full min-h-0 min-w-0">{item.content}</div>
            </div>
          );
        })}
      </div>
    </>
  );
}
