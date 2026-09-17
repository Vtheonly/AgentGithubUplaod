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
}

type StoredLayout = Record<string, { w: number; h: number }>;
const STORAGE_PREFIX = "el-imtiyaz:dashboard-layout:";

function readLayout(storageKey: string): StoredLayout {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as StoredLayout;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function DashboardLayoutEditor({
  storageKey,
  items,
  editing,
  onSave,
  onReset,
}: {
  storageKey: string;
  items: DashboardLayoutItem[];
  editing: boolean;
  onSave?: () => void;
  onReset?: () => void;
}) {
  const [order, setOrder] = useState(() => items.map((item) => item.id));
  const [sizes, setSizes] = useState<StoredLayout>(() => readLayout(storageKey));
  const dragId = useRef<string | null>(null);
  const resizeState = useRef<{ id: string; x: number; y: number; w: number; h: number } | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const nextIds = items.map((item) => item.id);
    setOrder((prev) => {
      const kept = prev.filter((id) => nextIds.includes(id));
      return [...kept, ...nextIds.filter((id) => !kept.includes(id))];
    });
  }, [items]);

  useEffect(() => {
    if (!editing) return;
    const onPointerMove = (event: PointerEvent) => {
      const state = resizeState.current;
      if (!state) return;
      const item = items.find((entry) => entry.id === state.id);
      if (!item) return;
      const widthDelta = Math.round((event.clientX - state.x) / 80);
      const heightDelta = Math.round((event.clientY - state.y) / 120);
      const w = Math.max(item.minW ?? 3, Math.min(item.maxW ?? 12, state.w + widthDelta));
      const h = Math.max(item.minH ?? 1, Math.min(item.maxH ?? 3, state.h + heightDelta));
      setSizes((prev) => ({ ...prev, [state.id]: { w, h } }));
      setDirty(true);
    };
    const onPointerUp = () => { resizeState.current = null; };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [editing, items]);

  const orderedItems = useMemo(() => {
    const byId = new Map(items.map((item) => [item.id, item]));
    return order.map((id) => byId.get(id)).filter(Boolean) as DashboardLayoutItem[];
  }, [items, order]);

  const startDrag = (id: string, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!editing) return;
    event.preventDefault();
    dragId.current = id;
  };

  const endDrag = (targetId: string, event: ReactPointerEvent<HTMLDivElement>) => {
    if (!editing || !dragId.current || dragId.current === targetId) {
      dragId.current = null;
      return;
    }
    const sourceId = dragId.current;
    const rect = event.currentTarget.getBoundingClientRect();
    const before = event.clientY < rect.top + rect.height / 2;
    setOrder((prev) => {
      const next = [...prev];
      const from = next.indexOf(sourceId);
      const to = next.indexOf(targetId);
      if (from < 0 || to < 0) return prev;
      next.splice(from, 1);
      next.splice(Math.min(before ? to : to + 1, next.length), 0, sourceId);
      return next;
    });
    setDirty(true);
    dragId.current = null;
  };

  const startResize = (item: DashboardLayoutItem, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!editing) return;
    event.preventDefault();
    event.stopPropagation();
    const current = sizes[item.id] ?? { w: item.w ?? 12, h: item.h ?? 1 };
    resizeState.current = { id: item.id, x: event.clientX, y: event.clientY, w: current.w, h: current.h };
  };

  const persist = () => {
    localStorage.setItem(STORAGE_PREFIX + storageKey, JSON.stringify(sizes));
    localStorage.setItem(STORAGE_PREFIX + storageKey + ":order", JSON.stringify(order));
    setDirty(false);
    onSave?.();
  };

  const reset = () => {
    localStorage.removeItem(STORAGE_PREFIX + storageKey);
    localStorage.removeItem(STORAGE_PREFIX + storageKey + ":order");
    setSizes({});
    setOrder(items.map((item) => item.id));
    setDirty(false);
    onReset?.();
  };

  return (
    <>
      <style>{`
        .dashboard-layout-editor-grid { grid-template-columns: repeat(12, minmax(0, 1fr)); }
        .dashboard-layout-editor-item { grid-column: span var(--dashboard-layout-w) / span var(--dashboard-layout-w); }
        @media (max-width: 1023px) {
          .dashboard-layout-editor-grid { grid-template-columns: minmax(0, 1fr); }
          .dashboard-layout-editor-item { grid-column: 1 / -1 !important; }
        }
      `}</style>
      {editing && (
        <div className="mb-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-muted-foreground flex items-center justify-between gap-3">
          <span>Mode personnalisation actif — utilisez la poignée pour déplacer un widget et le coin pour le redimensionner.</span>
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
      <div className={`dashboard-layout-editor-grid grid gap-4 pb-8 ${editing ? "rounded-xl border border-dashed border-primary/30 bg-[linear-gradient(to_right,hsl(var(--primary)/0.05)_1px,transparent_1px),linear-gradient(to_bottom,hsl(var(--primary)/0.05)_1px,transparent_1px)] bg-[size:8.333%_32px] p-2" : ""}`}>
        {orderedItems.map((item) => {
          const size = sizes[item.id] ?? { w: item.w ?? 12, h: item.h ?? 1 };
          const colSpan = Math.max(item.minW ?? 1, Math.min(item.maxW ?? 12, size.w));
          const minHeight = 120 + (size.h - 1) * 120;
          return (
            <div
              key={item.id}
              onPointerUp={(event) => endDrag(item.id, event)}
              className={`dashboard-layout-editor-item relative min-w-0 ${editing ? "rounded-xl ring-1 ring-primary/20 bg-surface-background/80" : ""}`}
              style={{ "--dashboard-layout-w": colSpan, minHeight } as CSSProperties}
            >
              {editing && (
                <>
                  <button type="button" aria-label={`Déplacer ${item.label}`} title={`Déplacer ${item.label}`} onPointerDown={(event) => startDrag(item.id, event)} className="absolute left-2 top-2 z-30 inline-flex h-7 w-7 cursor-grab items-center justify-center rounded-md border border-primary/30 bg-surface-panel/95 text-primary shadow-sm active:cursor-grabbing">
                    <GripVertical className="h-4 w-4" />
                  </button>
                  <button type="button" aria-label={`Redimensionner ${item.label}`} title={`Redimensionner ${item.label}`} onPointerDown={(event) => startResize(item, event)} className="absolute bottom-2 right-2 z-30 inline-flex h-7 w-7 cursor-nwse-resize items-center justify-center rounded-md border border-primary/30 bg-surface-panel/95 text-primary shadow-sm">
                    <Maximize2 className="h-3.5 w-3.5" />
                  </button>
                  <div className="absolute right-2 top-2 z-20 rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-mono text-primary">{colSpan}/12</div>
                </>
              )}
              {item.content}
            </div>
          );
        })}
      </div>
    </>
  );
}
