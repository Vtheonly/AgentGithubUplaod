import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { RotateCcw, Save, Settings2 } from "lucide-react";

const STORAGE_PREFIX = "el-imtiyaz:dashboard-layout:tab:";
const GRID_COLUMNS = 12;
const GRID_ROW_HEIGHT = 160;

type LayoutSize = { w: number; h: number };
type StoredLayout = { order: string[]; sizes: Record<string, LayoutSize> };

type ChildSnapshot = {
  id: string;
  element: HTMLElement;
  rect: DOMRect;
};

function readStoredLayout(storageKey: string): StoredLayout {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + storageKey);
    if (!raw) return { order: [], sizes: {} };
    const parsed = JSON.parse(raw) as Partial<StoredLayout>;
    return {
      order: Array.isArray(parsed.order) ? parsed.order.filter((id): id is string => typeof id === "string") : [],
      sizes: parsed.sizes && typeof parsed.sizes === "object" ? parsed.sizes : {},
    };
  } catch {
    return { order: [], sizes: {} };
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function DashboardTabLayoutEditor({
  storageKey,
  children,
  editing,
  onEditingChange,
}: {
  storageKey: string;
  children: ReactNode;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const resizeRef = useRef<{ id: string; x: number; y: number; w: number; h: number; gridWidth: number } | null>(null);
  const dragRef = useRef<{ id: string } | null>(null);
  const [stored, setStored] = useState<StoredLayout>(() => readStoredLayout(storageKey));
  const [childrenSnapshot, setChildrenSnapshot] = useState<ChildSnapshot[]>([]);
  const [dirty, setDirty] = useState(false);

  const inspectChildren = useCallback(() => {
    const host = hostRef.current;
    const root = host?.firstElementChild as HTMLElement | null;
    if (!host || !root) return;

    const elements = Array.from(root.children).filter((node): node is HTMLElement => node instanceof HTMLElement);
    const snapshots = elements.map((element, index) => ({
      id: element.dataset.dashboardLayoutId ?? `${storageKey}-${index}`,
      element,
      rect: element.getBoundingClientRect(),
    }));
    setChildrenSnapshot(snapshots);

    const ids = snapshots.map((item) => item.id);
    setStored((prev) => {
      const kept = prev.order.filter((id) => ids.includes(id));
      const nextOrder = [...kept, ...ids.filter((id) => !kept.includes(id))];
      if (nextOrder.length === prev.order.length && nextOrder.every((id, index) => id === prev.order[index])) return prev;
      return { ...prev, order: nextOrder };
    });
  }, [storageKey]);

  useLayoutEffect(() => {
    inspectChildren();
    const host = hostRef.current;
    const root = host?.firstElementChild as HTMLElement | null;
    if (!host || !root) return;

    const observer = new ResizeObserver(inspectChildren);
    observer.observe(root);
    for (const child of Array.from(root.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [inspectChildren, children]);

  useEffect(() => {
    const host = hostRef.current;
    const root = host?.firstElementChild as HTMLElement | null;
    if (!host || !root) return;

    const hasCustomLayout = stored.order.length > 0 && (Object.keys(stored.sizes).length > 0 || editing);
    if (!hasCustomLayout) {
      root.style.removeProperty("display");
      root.style.removeProperty("grid-template-columns");
      root.style.removeProperty("grid-auto-rows");
      root.style.removeProperty("gap");
      for (const child of Array.from(root.children) as HTMLElement[]) {
        child.style.removeProperty("grid-column");
        child.style.removeProperty("grid-row");
        child.style.removeProperty("margin");
        child.style.removeProperty("order");
      }
      inspectChildren();
      return;
    }

    root.style.display = "grid";
    root.style.gridTemplateColumns = `repeat(${GRID_COLUMNS}, minmax(0, 1fr))`;
    root.style.gridAutoRows = `${GRID_ROW_HEIGHT}px`;
    root.style.gap = "16px";

    const byId = new Map(childrenSnapshot.map((item) => [item.id, item.element]));
    const ordered = stored.order.map((id) => byId.get(id)).filter(Boolean) as HTMLElement[];
    for (const child of Array.from(root.children) as HTMLElement[]) {
      const id = child.dataset.dashboardLayoutId ?? `${storageKey}-${Array.from(root.children).indexOf(child)}`;
      const size = stored.sizes[id] ?? { w: GRID_COLUMNS, h: 1 };
      child.style.gridColumn = `span ${clamp(size.w, 1, GRID_COLUMNS)}`;
      child.style.gridRow = `span ${clamp(size.h, 1, 8)}`;
      child.style.margin = "0";
      child.style.order = String(Math.max(0, ordered.indexOf(child)));
    }
    requestAnimationFrame(inspectChildren);
  }, [stored, childrenSnapshot, editing, storageKey, inspectChildren]);

  useEffect(() => {
    if (!editing) return;
    const onMove = (event: PointerEvent) => {
      const state = resizeRef.current;
      if (!state) return;
      const nextW = clamp(state.w + Math.round((event.clientX - state.x) / (state.gridWidth / GRID_COLUMNS)), 1, GRID_COLUMNS);
      const nextH = clamp(state.h + Math.round((event.clientY - state.y) / GRID_ROW_HEIGHT), 1, 8);
      setStored((prev) => ({ ...prev, sizes: { ...prev.sizes, [state.id]: { w: nextW, h: nextH } } }));
      setDirty(true);
    };
    const onUp = () => { resizeRef.current = null; };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [editing]);

  const startMove = (id: string, event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = { id };
  };

  useEffect(() => {
    if (!editing) return;
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const target = childrenSnapshot.find((item) =>
        item.id !== drag.id &&
        event.clientX >= item.rect.left &&
        event.clientX <= item.rect.right &&
        event.clientY >= item.rect.top &&
        event.clientY <= item.rect.bottom,
      );
      if (target) {
        setStored((prev) => {
          const next = prev.order.filter((id) => id !== drag.id);
          const targetIndex = next.indexOf(target.id);
          const insertAt = event.clientY < target.rect.top + target.rect.height / 2 ? targetIndex : targetIndex + 1;
          next.splice(Math.max(0, Math.min(insertAt, next.length)), 0, drag.id);
          return { ...prev, order: next };
        });
        setDirty(true);
        dragRef.current = null;
      }
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [editing, childrenSnapshot]);

  const startResize = (id: string, event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const host = hostRef.current;
    const root = host?.firstElementChild as HTMLElement | null;
    if (!root) return;
    const current = stored.sizes[id] ?? { w: GRID_COLUMNS, h: 1 };
    resizeRef.current = {
      id,
      x: event.clientX,
      y: event.clientY,
      w: current.w,
      h: current.h,
      gridWidth: root.getBoundingClientRect().width,
    };
  };

  const persist = () => {
    localStorage.setItem(STORAGE_PREFIX + storageKey, JSON.stringify(stored));
    setDirty(false);
    onEditingChange(false);
    requestAnimationFrame(inspectChildren);
  };

  const reset = () => {
    localStorage.removeItem(STORAGE_PREFIX + storageKey);
    setStored({ order: [], sizes: {} });
    setDirty(false);
    requestAnimationFrame(inspectChildren);
  };

  const hostRect = hostRef.current?.getBoundingClientRect();

  return (
    <div className="relative min-h-0">
      {editing && (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
          <span>Mode personnalisation actif — déplacez les sections avec la poignée et redimensionnez-les avec le coin.</span>
          <div className="flex items-center gap-1.5 shrink-0">
            <button type="button" onClick={reset} className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-panel px-2 py-1 hover:bg-muted">
              <RotateCcw className="h-3 w-3" /> Réinitialiser
            </button>
            <button type="button" onClick={persist} disabled={!dirty} className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-primary-foreground disabled:opacity-50">
              <Save className="h-3 w-3" /> Enregistrer
            </button>
          </div>
        </div>
      )}
      <div ref={hostRef} className="relative min-h-0">
        {children}
        {editing && hostRect && childrenSnapshot.map((item) => {
          const rect = item.rect;
          const size = stored.sizes[item.id] ?? { w: GRID_COLUMNS, h: 1 };
          return (
            <div key={item.id} className="pointer-events-none absolute z-50" style={{ left: rect.left - hostRect.left, top: rect.top - hostRect.top, width: rect.width, height: rect.height } as CSSProperties}>
              <button type="button" aria-label={`Déplacer la section ${item.id}`} onPointerDown={(event) => startMove(item.id, event)} className="pointer-events-auto absolute left-2 top-2 inline-flex h-7 w-7 cursor-grab items-center justify-center rounded-md border border-primary/40 bg-surface-panel/95 text-primary shadow-sm active:cursor-grabbing" title="Déplacer">
                <Settings2 className="h-3.5 w-3.5" />
              </button>
              <button type="button" aria-label={`Redimensionner la section ${item.id}`} onPointerDown={(event) => startResize(item.id, event)} className="pointer-events-auto absolute bottom-2 right-2 inline-flex h-7 w-7 cursor-nwse-resize items-center justify-center rounded-md border border-primary/40 bg-surface-panel/95 text-primary shadow-sm" title="Redimensionner">
                <span className="text-[10px] font-mono">{size.w}/{GRID_COLUMNS}</span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
