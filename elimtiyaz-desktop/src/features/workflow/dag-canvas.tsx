/**
 * DagCanvas — SVG-based workflow DAG editor (plan §10.03-04).
 *
 * T-221 upgrades (owner mandate "fully do the DAG automations"):
 *   - Zoom & pan: toolbar buttons (zoom in/out/reset/fit) + wheel zoom
 *     (anchored at the cursor) + drag-on-empty-canvas panning.
 *   - Minimap: bottom-right overlay showing node positions and the current
 *     viewport rectangle; click to jump.
 *   - Snap-to-grid: node drags snap to the 20px background grid.
 *   - Auto-layout ("Réorganiser"): deterministic layered layout derived
 *     from the topological order (domain/calc/workflow/auto-layout).
 *   - Dry-run simulator ("Tester"): runs the PURE topological simulator
 *     (domain/calc/workflow/dry-run) and visualises the outcome — edges
 *     on the taken path turn green/thick, executed nodes get a green
 *     ring, skipped nodes fade with a dashed border, and a summary banner
 *     lists per-node verdicts + vault §10.05 warnings.
 *   - Node inspector: double-click a node (or its "⋯" menu → Configurer)
 *     opens the NodeInspectorDrawer via `onInspectNode`.
 *
 * Preserved plan §10.03 contract:
 *   - Click node → select (highlight border); drag node → move.
 *   - Click empty → deselect. Output-port drag → input port → create edge.
 *   - "Enregistrer" → validate via detectCycle (red cycle edges + banner).
 *   - "Déployer" → ConfirmModal → onDeploy.
 */
import { useCallback, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type WheelEvent as ReactWheelEvent } from "react";
import {
  Webhook,
  Filter,
  Send,
  Clock,
  GitBranch,
  Save,
  Rocket,
  Trash2,
  AlertCircle,
  Plus,
  ZoomIn,
  ZoomOut,
  Maximize,
  Wand2,
  Play,
  XCircle,
  Settings2,
  Map as MapIcon,
  type LucideIcon,
} from "lucide-react";
import { cn } from "../../shared/ui/cn";
import { Button } from "../../shared/ui/button";
import { Card, CardContent } from "../../shared/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../shared/ui/dropdown-menu";
import { ConfirmModal } from "../../shared/ui/unified-modal";
import { detectCycle } from "../../domain/kahn";
import { dryRunWorkflow } from "../../domain/calc/workflow/dry-run";
import { defaultConditionContext } from "../../domain/calc/workflow/condition-evaluator";
import { autoLayout } from "../../domain/calc/workflow/auto-layout";
import type { DryRunResult } from "../../domain/calc/workflow/dry-run";
import {
  NODE_SUBTYPE_TO_TYPE,
  WORKFLOW_NODE_TYPE_LABELS_FR,
  WORKFLOW_NODE_SUBTYPE_LABELS_FR,
  type Workflow,
  type WorkflowNode,
  type WorkflowNodeSubtype,
  type WorkflowEdge,
  type WorkflowNodeType,
} from "../../domain/model/workflow";

const NODE_W = 160;
const NODE_H = 60;
const GRID = 20;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2.5;

const ICON_FOR_TYPE: Record<WorkflowNodeType, LucideIcon> = {
  trigger: Webhook,
  condition: Filter,
  action: Send,
  delay: Clock,
  transform: GitBranch,
};

const COLOR_FOR_TYPE: Record<WorkflowNodeType, { border: string; bg: string; text: string }> = {
  trigger: { border: "stroke-primary", bg: "fill-primary/10", text: "text-primary" },
  condition: { border: "stroke-status-warning", bg: "fill-status-warning/10", text: "text-status-warning" },
  action: { border: "stroke-status-success", bg: "fill-status-success/10", text: "text-status-success" },
  delay: { border: "stroke-status-info", bg: "fill-status-info/10", text: "text-status-info" },
  transform: { border: "stroke-status-neutral", bg: "fill-status-neutral/10", text: "text-status-neutral" },
};

export interface DagCanvasProps {
  workflow: Workflow;
  onChange: (nodes: WorkflowNode[], edges: WorkflowEdge[]) => void;
  onSave: (nodes: WorkflowNode[], edges: WorkflowEdge[]) => Promise<void>;
  onDeploy: () => Promise<void>;
  canEdit: boolean;
  /** T-221: open the node inspector for this node (double-click / menu). */
  onInspectNode: (node: WorkflowNode) => void;
}

interface DragState {
  kind: "node" | "pan";
  nodeId: string;
  offsetX: number;
  offsetY: number;
}

interface EdgeDraft {
  fromId: string;
  /** Pointer coordinates in viewBox viewBox space. */
  cursorX: number;
  cursorY: number;
}

interface ViewState {
  zoom: number;
  panX: number;
  panY: number;
}

/**
 * Convert a clientX/clientY pair to SVG viewBox coordinates, inverting the
 * zoom/pan viewport transform.
 */
function clientToSvg(
  svg: SVGSVGElement | null,
  view: ViewState,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  if (!svg) return { x: 0, y: 0 };
  const rect = svg.getBoundingClientRect();
  const baseX = (clientX - rect.left) * (1000 / rect.width);
  const baseY = (clientY - rect.top) * (600 / rect.height);
  return {
    x: (baseX - view.panX) / view.zoom,
    y: (baseY - view.panY) / view.zoom,
  };
}

/** Snap to the canvas grid (T-221 snap-to-grid). */
function snap(value: number): number {
  return Math.round(value / GRID) * GRID;
}

export function DagCanvas({ workflow, onChange, onSave, onDeploy, canEdit, onInspectNode }: DagCanvasProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [nodes, setNodes] = useState<WorkflowNode[]>([...workflow.nodes]);
  const [edges, setEdges] = useState<WorkflowEdge[]>([...workflow.edges]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [edgeDraft, setEdgeDraft] = useState<EdgeDraft | null>(null);
  const [cycleError, setCycleError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deployOpen, setDeployOpen] = useState(false);
  const [deploying, setDeploying] = useState(false);
  // T-221 canvas state.
  const [view, setView] = useState<ViewState>({ zoom: 1, panX: 0, panY: 0 });
  const [dryRun, setDryRun] = useState<DryRunResult | null>(null);
  const [showMinimap, setShowMinimap] = useState(true);

  // Sync from parent workflow if the workflow id changes (selecting a different wf).
  // We intentionally use the workflow.id as a key dependency — not the array contents —
  // so internal edits don't trigger a parent→child overwrite on every render.
  // (parent stays in sync via onChange + the parent's re-emit from observable.)
  const wfIdRef = useRef<string>(workflow.id);
  if (wfIdRef.current !== workflow.id) {
    wfIdRef.current = workflow.id;
    setNodes([...workflow.nodes]);
    setEdges([...workflow.edges]);
    setSelectedId(null);
    setCycleError(null);
    setDryRun(null);
    setView({ zoom: 1, panX: 0, panY: 0 });
  }

  const emit = useCallback((nextNodes: WorkflowNode[], nextEdges: WorkflowEdge[]) => {
    setNodes(nextNodes);
    setEdges(nextEdges);
    onChange(nextNodes, nextEdges);
  }, [onChange]);

  /* --------------------- Node drag + canvas pan --------------------- */

  function handleNodeMouseDown(e: ReactMouseEvent<SVGRectElement>, node: WorkflowNode) {
    if (!canEdit) return;
    e.stopPropagation();
    setSelectedId(node.id);
    const { x, y } = clientToSvg(svgRef.current, view, e.clientX, e.clientY);
    setDrag({
      kind: "node",
      nodeId: node.id,
      offsetX: x - node.position.x,
      offsetY: y - node.position.y,
    });
  }

  function handleCanvasMouseDown(e: ReactMouseEvent<SVGSVGElement>) {
    // Drag on the empty canvas → pan the viewport (T-221).
    if (e.target === e.currentTarget || (e.target as Element).getAttribute("data-canvas-bg") === "true") {
      setDrag({ kind: "pan", nodeId: "", offsetX: e.clientX, offsetY: e.clientY });
    }
  }

  function handleCanvasMouseMove(e: ReactMouseEvent<SVGSVGElement>) {
    if (drag?.kind === "pan") {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;
      const dx = (e.clientX - drag.offsetX) * (1000 / rect.width);
      const dy = (e.clientY - drag.offsetY) * (600 / rect.height);
      setDrag({ ...drag, offsetX: e.clientX, offsetY: e.clientY });
      setView((v) => ({ ...v, panX: v.panX + dx, panY: v.panY + dy }));
      return;
    }
    if (drag && drag.kind === "node") {
      const { x, y } = clientToSvg(svgRef.current, view, e.clientX, e.clientY);
      const next = nodes.map((n) =>
        n.id === drag.nodeId
          ? { ...n, position: { x: snap(Math.max(0, x - drag.offsetX)), y: snap(Math.max(0, y - drag.offsetY)) } }
          : n,
      );
      setNodes(next);
      onChange(next, edges);
    } else if (edgeDraft) {
      const { x, y } = clientToSvg(svgRef.current, view, e.clientX, e.clientY);
      setEdgeDraft({ ...edgeDraft, cursorX: x, cursorY: y });
    }
  }

  function handleMouseUp() {
    setDrag(null);
    setEdgeDraft(null);
  }

  function handleCanvasClick(e: ReactMouseEvent<SVGSVGElement>) {
    // Click on empty canvas (not on a node/edge) → deselect.
    if (e.target === e.currentTarget) setSelectedId(null);
  }

  /* --------------------- Zoom & fit (T-221) --------------------- */

  function zoomBy(factor: number, anchorClient?: { x: number; y: number }) {
    setView((v) => {
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * factor));
      if (Math.abs(next - v.zoom) < 0.0001) return v;
      // Anchor the zoom at the cursor when provided: the viewBox point under
      // the cursor stays under the cursor.
      if (anchorClient && svgRef.current) {
        const rect = svgRef.current.getBoundingClientRect();
        const svgX = (anchorClient.x - rect.left) * (1000 / rect.width);
        const svgY = (anchorClient.y - rect.top) * (600 / rect.height);
        const viewX = (svgX - v.panX) / v.zoom;
        const viewY = (svgY - v.panY) / v.zoom;
        return { zoom: next, panX: svgX - viewX * next, panY: svgY - viewY * next };
      }
      return { ...v, zoom: next };
    });
  }

  function handleWheel(e: ReactWheelEvent<SVGSVGElement>) {
    if (!e.ctrlKey && !e.metaKey) return; // plain wheel scrolls the page vertically otherwise
    try {
      e.preventDefault();
    } catch {
      // Passive listener fallback — zoom continues without preventing scroll.
    }
    zoomBy(e.deltaY < 0 ? 1.1 : 0.9, { x: e.clientX, y: e.clientY });
  }

  /** Content bounding box in view coordinates (with node size + margin). */
  const contentBounds = useMemo(() => {
    if (nodes.length === 0) return { minX: 0, minY: 0, maxX: 1000, maxY: 600 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.position.x);
      minY = Math.min(minY, n.position.y);
      maxX = Math.max(maxX, n.position.x + NODE_W);
      maxY = Math.max(maxY, n.position.y + NODE_H);
    }
    const m = 60;
    return { minX: minX - m, minY: minY - m, maxX: maxX + m, maxY: maxY + m };
  }, [nodes]);

  function fitView() {
    const w = Math.max(1, contentBounds.maxX - contentBounds.minX);
    const h = Math.max(1, contentBounds.maxY - contentBounds.minY);
    const zoom = Math.min(MAX_ZOOM, Math.max(0.25, Math.min(1000 / w, 600 / h)));
    setView({
      zoom,
      panX: (1000 - (contentBounds.minX + contentBounds.maxX) * zoom) / 2,
      panY: (600 - (contentBounds.minY + contentBounds.maxY) * zoom) / 2,
    });
  }

  /* --------------------- Edge creation (port drag) --------------------- */

  function handleOutputPortMouseDown(e: ReactMouseEvent<SVGCircleElement>, node: WorkflowNode) {
    if (!canEdit) return;
    e.stopPropagation();
    const { x, y } = clientToSvg(svgRef.current, view, e.clientX, e.clientY);
    setEdgeDraft({ fromId: node.id, cursorX: x, cursorY: y });
  }

  function handleInputPortMouseUp(e: ReactMouseEvent<SVGCircleElement>, node: WorkflowNode) {
    if (!edgeDraft || !canEdit) return;
    e.stopPropagation();
    if (edgeDraft.fromId === node.id) {
      setEdgeDraft(null);
      return;
    }
    // Avoid duplicate edges.
    const exists = edges.some((ed) => ed.from === edgeDraft.fromId && ed.to === node.id);
    if (!exists) {
      const newEdge: WorkflowEdge = {
        id: `e-${edgeDraft.fromId}-${node.id}-${Date.now().toString(36)}`,
        from: edgeDraft.fromId,
        to: node.id,
      };
      const nextEdges = [...edges, newEdge];
      emit(nodes, nextEdges);
      // VAULT §10.09 (best practice 7) — LIVE cycle feedback: check the new
      // connection IMMEDIATELY so the offending edge renders red before the
      // user clicks Save (previously the cycle banner only appeared on save).
      const cycle = detectCycle(nodes, nextEdges);
      if (cycle.hasCycle) {
        setCycleError(
          `Cycle détecté — ${cycle.cycleNodeIds.size} nœud(s) en boucle. Cette connexion créera une boucle : corrigez avant de sauvegarder.`,
        );
      } else {
        setCycleError(null);
      }
    }
    setEdgeDraft(null);
  }

  /* --------------------- Context menu (right-click / ⋯) --------------------- */

  function deleteNode(id: string) {
    const nextNodes = nodes.filter((n) => n.id !== id);
    const nextEdges = edges.filter((e) => e.from !== id && e.to !== id);
    emit(nextNodes, nextEdges);
    if (selectedId === id) setSelectedId(null);
    // VAULT §10.09 (best practice 7) — re-evaluate the live cycle state after
    // deleting a node (the cycle may have been resolved by the deletion).
    const cycle = detectCycle(nextNodes, nextEdges);
    setCycleError(
      cycle.hasCycle
        ? `Cycle détecté — ${cycle.cycleNodeIds.size} nœud(s) en boucle. Corrigez avant de sauvegarder.`
        : null,
    );
  }

  /* --------------------- Auto-layout (T-221) --------------------- */

  function handleAutoLayout() {
    const result = autoLayout(nodes, edges);
    if (!result.ok) {
      setCycleError(result.error ?? "Réorganisation impossible.");
      return;
    }
    setCycleError(null);
    emit([...result.nodes], edges);
    fitView();
  }

  /* --------------------- Dry-run simulator (T-221) --------------------- */

  function handleDryRun() {
    const result = dryRunWorkflow(nodes, edges, defaultConditionContext());
    setDryRun(result);
  }

  const dryRunNodeStatus = useMemo(() => {
    const map = new Map<string, "succeeded" | "skipped">();
    if (dryRun) for (const r of dryRun.results) map.set(r.nodeId, r.status);
    return map;
  }, [dryRun]);

  const dryRunTakenEdges = useMemo(() => new Set(dryRun?.takenEdgeKeys ?? []), [dryRun]);
  const dryRunWarningCount = useMemo(
    () => dryRun?.results.reduce((s, r) => s + r.warnings.length, 0) ?? 0,
    [dryRun],
  );

  /* --------------------- Save + Deploy --------------------- */

  async function handleSave() {
    setSaving(true);
    setCycleError(null);
    const cycle = detectCycle(nodes, edges);
    if (cycle.hasCycle) {
      setCycleError(`Cycle détecté — ${cycle.cycleNodeIds.size} nœud(s) en boucle. Sauvegarde impossible.`);
      setSaving(false);
      return;
    }
    try {
      await onSave(nodes, edges);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeployConfirm() {
    setDeploying(true);
    try {
      await onDeploy();
    } finally {
      setDeploying(false);
    }
  }

  /* --------------------- Derived: cycle edges (red highlight) --------------------- */
  const cycle = cycleError ? detectCycle(nodes, edges) : null;
  const cycleEdgeKeys = new Set(cycle?.cycleEdgeKeys ?? []);
  const cycleNodeIds = new Set(cycle?.cycleNodeIds ?? []);

  /* --------------------- Minimap geometry --------------------- */
  const minimap = useMemo(() => {
    const w = Math.max(1, contentBounds.maxX - contentBounds.minX);
    const h = Math.max(1, contentBounds.maxY - contentBounds.minY);
    const scale = Math.min(180 / w, 108 / h);
    const mapW = w * scale;
    const mapH = h * scale;
    const toMap = (x: number, y: number) => ({
      x: ((x - contentBounds.minX) * scale),
      y: ((y - contentBounds.minY) * scale),
    });
    // Visible region in view coordinates.
    const visX = -view.panX / view.zoom;
    const visY = -view.panY / view.zoom;
    const visW = 1000 / view.zoom;
    const visH = 600 / view.zoom;
    const vis = toMap(visX, visY);
    return {
      mapW,
      mapH,
      scale,
      toMap,
      viewport: { x: vis.x, y: vis.y, w: visW * scale, h: visH * scale },
    };
  }, [contentBounds, view]);

  function handleMinimapJump(e: ReactMouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const mapX = ((e.clientX - rect.left) / rect.width) * minimap.mapW;
    const mapY = ((e.clientY - rect.top) / rect.height) * minimap.mapH;
    const viewX = mapX / minimap.scale + contentBounds.minX;
    const viewY = mapY / minimap.scale + contentBounds.minY;
    setView((v) => ({ ...v, panX: 500 - viewX * v.zoom, panY: 300 - viewY * v.zoom }));
  }

  /* --------------------- Render --------------------- */

  const zoomPct = Math.round(view.zoom * 100);

  return (
    <Card className="flex flex-col h-full min-h-0">
      {/* ---------- Toolbar ---------- */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium text-foreground truncate">{workflow.name}</span>
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            · {nodes.length} nœud(s), {edges.length} lien(s)
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Viewport controls */}
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => zoomBy(1.2)} title="Zoom avant (Ctrl+molette)">
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => zoomBy(1 / 1.2)} title="Zoom arrière (Ctrl+molette)">
            <ZoomOut className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={fitView} title="Ajuster à l'écran">
            <Maximize className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 w-8 p-0"
            onClick={() => setShowMinimap((s) => !s)}
            title={showMinimap ? "Masquer la mini-carte" : "Afficher la mini-carte"}
          >
            <MapIcon className="h-4 w-4" />
          </Button>
          <span className="text-[10px] font-mono text-muted-foreground w-9 text-center">{zoomPct}%</span>
          <span className="w-px h-5 bg-border mx-0.5" />
          {/* Layout + dry-run */}
          <Button size="sm" variant="outline" onClick={handleAutoLayout} disabled={!canEdit} title="Réorganiser selon la topologie">
            <Wand2 className="h-4 w-4" /> Réorganiser
          </Button>
          <Button
            size="sm"
            variant={dryRun ? "default" : "outline"}
            onClick={handleDryRun}
            disabled={nodes.length === 0}
            title="Simulation sans effet de bord"
          >
            <Play className="h-4 w-4" /> Tester
          </Button>
          {dryRun && (
            <Button size="sm" variant="ghost" onClick={() => setDryRun(null)} title="Effacer la simulation">
              <XCircle className="h-4 w-4" />
            </Button>
          )}
          <span className="w-px h-5 bg-border mx-0.5" />
          {/* Persistence */}
          <Button size="sm" variant="outline" onClick={handleSave} disabled={!canEdit || saving}>
            <Save className="h-4 w-4" /> {saving ? "Sauvegarde…" : "Enregistrer"}
          </Button>
          <Button size="sm" onClick={() => setDeployOpen(true)} disabled={!canEdit || deploying}>
            <Rocket className="h-4 w-4" /> Déployer
          </Button>
        </div>
      </div>

      {cycleError && (
        <div className="flex items-start gap-2 border-b border-status-danger/30 bg-status-danger/10 px-3 py-2 text-sm text-status-danger">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span className="leading-snug">{cycleError}</span>
        </div>
      )}

      {/* ---------- Dry-run banner ---------- */}
      {dryRun && (
        <div
          className={cn(
            "border-b px-3 py-2 text-xs",
            dryRun.ok
              ? "border-status-success/30 bg-status-success/10 text-status-success"
              : "border-status-danger/30 bg-status-danger/10 text-status-danger",
          )}
        >
          <p className="font-semibold flex items-center gap-1.5">
            <Play className="h-3.5 w-3.5" />
            {dryRun.ok
              ? `Simulation : ${dryRun.results.filter((r) => r.status === "succeeded").length} nœud(s) exécuté(s), ${dryRun.results.filter((r) => r.status === "skipped").length} ignoré(s) — ${dryRun.takenEdgeKeys.length} lien(s) emprunté(s)${dryRunWarningCount > 0 ? ` · ${dryRunWarningCount} avertissement(s)` : ""}`
              : dryRun.error}
          </p>
          {dryRun.ok && dryRunWarningCount > 0 && (
            <ul className="mt-1 space-y-0.5 pl-5 list-disc">
              {dryRun.results
                .flatMap((r) => r.warnings.map((w) => `${r.nodeLabel}: ${w}`))
                .slice(0, 4)
                .map((w, i) => (
                  <li key={i} className="leading-snug">{w}</li>
                ))}
            </ul>
          )}
        </div>
      )}

      <CardContent className="relative flex-1 p-0 overflow-hidden">
        <svg
          ref={svgRef}
          viewBox="0 0 1000 600"
          className="w-full h-full bg-surface-background select-none"
          style={{ cursor: drag?.kind === "pan" ? "grabbing" : "default" }}
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onClick={handleCanvasClick}
          onWheel={handleWheel}
        >
          <defs>
            <pattern id="dag-grid" width={40} height={40} patternUnits="userSpaceOnUse">
              <circle cx="0" cy="0" r="1" fill="rgba(0,0,0,0.06)" />
            </pattern>
            <marker
              id="dag-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" className="fill-border" />
            </marker>
            <marker
              id="dag-arrow-cycle"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" className="fill-status-danger" />
            </marker>
            <marker
              id="dag-arrow-taken"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" className="fill-status-success" />
            </marker>
          </defs>
          <rect width="1000" height="600" fill="url(#dag-grid)" data-canvas-bg="true" />

          {/* Viewport transform: everything inside pan+zooms together. */}
          <g transform={`translate(${view.panX}, ${view.panY}) scale(${view.zoom})`}>
            {/* Edges */}
            {edges.map((edge) => {
              const from = nodes.find((n) => n.id === edge.from);
              const to = nodes.find((n) => n.id === edge.to);
              if (!from || !to) return null;
              const x1 = from.position.x + NODE_W;
              const y1 = from.position.y + NODE_H / 2;
              const x2 = to.position.x;
              const y2 = to.position.y + NODE_H / 2;
              const mx = (x1 + x2) / 2;
              const key = `${edge.from}->${edge.to}`;
              const isCycle = cycleEdgeKeys.has(key);
              const isTaken = dryRunTakenEdges.has(key);
              const path = `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
              return (
                <path
                  key={edge.id}
                  d={path}
                  className={cn(
                    isCycle ? "stroke-status-danger" : isTaken ? "stroke-status-success" : "stroke-border",
                    isTaken && dryRun && "animate-pulse",
                  )}
                  strokeWidth={isCycle || isTaken ? 2.5 : 1.8}
                  fill="none"
                  markerEnd={
                    isCycle
                      ? "url(#dag-arrow-cycle)"
                      : isTaken
                        ? "url(#dag-arrow-taken)"
                        : "url(#dag-arrow)"
                  }
                />
              );
            })}

            {/* Edge draft (while dragging from a port) */}
            {edgeDraft && (() => {
              const from = nodes.find((n) => n.id === edgeDraft.fromId);
              if (!from) return null;
              const x1 = from.position.x + NODE_W;
              const y1 = from.position.y + NODE_H / 2;
              const x2 = edgeDraft.cursorX;
              const y2 = edgeDraft.cursorY;
              const mx = (x1 + x2) / 2;
              return (
                <path
                  d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
                  className="stroke-primary/60"
                  strokeWidth={1.8}
                  strokeDasharray="6 4"
                  fill="none"
                />
              );
            })()}

            {/* Nodes */}
            {nodes.map((node) => {
              const Icon = ICON_FOR_TYPE[node.type];
              const colors = COLOR_FOR_TYPE[node.type];
              const isSelected = selectedId === node.id;
              const isCycle = cycleNodeIds.has(node.id);
              const runStatus = dryRunNodeStatus.get(node.id);
              return (
                <g
                  key={node.id}
                  transform={`translate(${node.position.x}, ${node.position.y})`}
                  className="cursor-move"
                  onDoubleClick={() => onInspectNode(node)}
                >
                  <rect
                    width={NODE_W}
                    height={NODE_H}
                    rx={10}
                    ry={10}
                    className={cn(
                      colors.bg,
                      colors.border,
                      isCycle && "stroke-status-danger",
                      runStatus === "skipped" && "opacity-50",
                    )}
                    strokeWidth={isSelected ? 2.5 : isCycle ? 2.5 : 1.5}
                    strokeDasharray={runStatus === "skipped" ? "6 3" : undefined}
                    onMouseDown={(e) => handleNodeMouseDown(e, node)}
                    onContextMenu={(e) => {
                      // Prevent the browser's native context menu so the
                      // DropdownMenu (rendered below) can take over.
                      e.preventDefault();
                    }}
                  />
                  {/* Dry-run status ring (T-221). */}
                  {runStatus === "succeeded" && (
                    <rect
                      width={NODE_W}
                      height={NODE_H}
                      rx={10}
                      ry={10}
                      className="fill-none stroke-status-success"
                      strokeWidth={3}
                      pointerEvents="none"
                    />
                  )}
                  {/* Type tag at top */}
                  <text
                    x={10}
                    y={16}
                    className={cn("text-[10px] font-medium", colors.text)}
                    fill="currentColor"
                  >
                    {WORKFLOW_NODE_TYPE_LABELS_FR[node.type]}
                  </text>
                  {/* Label */}
                  <text
                    x={10}
                    y={36}
                    className="text-xs font-semibold text-foreground"
                    fill="currentColor"
                  >
                    {node.label}
                  </text>
                  <text
                    x={10}
                    y={52}
                    className="text-[10px] text-muted-foreground"
                    fill="currentColor"
                  >
                    {WORKFLOW_NODE_SUBTYPE_LABELS_FR[node.subtype] ?? node.subtype}
                  </text>
                  {/* Icon (top-right) */}
                  <foreignObject x={NODE_W - 28} y={6} width={22} height={22}>
                    <Icon className={cn("h-5 w-5", colors.text)} />
                  </foreignObject>
                  {/* Input port (left) */}
                  <circle
                    cx={0}
                    cy={NODE_H / 2}
                    r={5}
                    className="fill-popover stroke-border"
                    strokeWidth={1.5}
                    onMouseUp={(e) => handleInputPortMouseUp(e, node)}
                  />
                  {/* Output port (right) */}
                  <circle
                    cx={NODE_W}
                    cy={NODE_H / 2}
                    r={5}
                    className="fill-popover stroke-primary"
                    strokeWidth={1.5}
                    onMouseDown={(e) => handleOutputPortMouseDown(e, node)}
                    style={{ cursor: "crosshair" }}
                  />

                  {/* Context menu — small "⋯" button in the top-right corner. */}
                  {canEdit && (
                    <foreignObject x={NODE_W - 22} y={NODE_H - 22} width={20} height={20}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className="flex items-center justify-center h-5 w-5 rounded text-muted-foreground hover:bg-accent/20 hover:text-foreground transition-colors"
                            aria-label="Actions du nœud"
                            onClick={(ev) => ev.stopPropagation()}
                          >
                            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                              <circle cx="3" cy="7" r="1.2" />
                              <circle cx="7" cy="7" r="1.2" />
                              <circle cx="11" cy="7" r="1.2" />
                            </svg>
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => onInspectNode(node)}>
                            <Settings2 className="h-3.5 w-3.5" /> Configurer
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => deleteNode(node.id)}>
                            <Trash2 className="h-3.5 w-3.5" /> Supprimer
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </foreignObject>
                  )}
                </g>
              );
            })}

            {/* Empty state hint */}
            {nodes.length === 0 && (
              <text x={500} y={300} textAnchor="middle" className="text-xs text-muted-foreground" fill="currentColor">
                Cliquez un type de nœud dans la palette à droite pour commencer
              </text>
            )}
          </g>
        </svg>

        {/* ---------- Minimap (T-221) ---------- */}
        {showMinimap && nodes.length > 0 && (
          <div className="absolute bottom-3 right-3 rounded-md border border-border bg-popover/95 shadow-lg p-1.5">
            <svg
              width={180}
              height={108}
              viewBox={`0 0 ${minimap.mapW} ${minimap.mapH}`}
              className="cursor-pointer"
              onClick={handleMinimapJump}
            >
              <rect
                x={0}
                y={0}
                width={minimap.mapW}
                height={minimap.mapH}
                className="fill-muted/40"
              />
              {nodes.map((n) => {
                const p = minimap.toMap(n.position.x, n.position.y);
                return (
                  <rect
                    key={n.id}
                    x={p.x}
                    y={p.y}
                    width={Math.max(4, NODE_W * minimap.scale)}
                    height={Math.max(3, NODE_H * minimap.scale)}
                    rx={2}
                    className={cn(
                      n.type === "trigger"
                        ? "fill-primary"
                        : n.type === "condition"
                          ? "fill-status-warning"
                          : n.type === "action"
                            ? "fill-status-success"
                            : "fill-muted-foreground",
                      dryRunNodeStatus.get(n.id) === "skipped" && "opacity-40",
                    )}
                  />
                );
              })}
              {/* Viewport rectangle */}
              <rect
                x={minimap.viewport.x}
                y={minimap.viewport.y}
                width={Math.max(6, minimap.viewport.w)}
                height={Math.max(4, minimap.viewport.h)}
                className="fill-none stroke-foreground/70"
                strokeWidth={1.5}
              />
            </svg>
          </div>
        )}
      </CardContent>

      <ConfirmModal
        open={deployOpen}
        onOpenChange={setDeployOpen}
        title="Déployer ce workflow"
        description="Le workflow sera figé et exécutable. Les modifications futures nécessiteront un nouveau déploiement."
        confirmLabel="Déployer"
        onConfirm={handleDeployConfirm}
      />
    </Card>
  );
}

/**
 * Helper exported for the parent component: generate a new node at a
 * default position with the next available id. The palette calls this.
 */
export function makeNode(subtype: WorkflowNodeSubtype, type: WorkflowNodeType, existing: readonly WorkflowNode[]): WorkflowNode {
  const idx = existing.length + 1;
  return {
    id: `n-${idx}-${Date.now().toString(36)}`,
    type,
    subtype,
    label: WORKFLOW_NODE_SUBTYPE_LABELS_FR[subtype] ?? subtype,
    position: { x: snap(100), y: snap(100 + ((idx * 70) % 400)) },
    config: {},
  };
}

/** Plus icon re-exported for the palette header. */
export const PlusIcon = Plus;

/** Re-exported for the workflow page (node-type resolution on template import). */
export { NODE_SUBTYPE_TO_TYPE };
