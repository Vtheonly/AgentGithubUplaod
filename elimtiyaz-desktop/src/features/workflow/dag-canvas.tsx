/**
 * DagCanvas — SVG-based workflow DAG editor (plan §10.03-04).
 *
 * Renders nodes as rounded rectangles (type-specific color + Lucide icon)
 * and edges as bezier curves with arrowheads. All drag + edge-creation is
 * mouse-event based (no HTML5 DnD API) per the iteration-7 spec.
 *
 * Plan §10.03 contract:
 *   - Click node → select (highlight border); drag node → move.
 *   - Click empty → deselect.
 *   - Click+drag from an output port (right side) to another node's input
 *     port (left side) → create an edge.
 *   - Right-click node → context menu (DropdownMenu) with "Supprimer".
 *   - "Save" button → validate via detectCycle. On cycle, highlight cycle
 *     edges in red + show inline alert. On success, call updateWorkflow.
 *   - "Déployer" button → ConfirmModal → on confirm, call deploy(id, actor).
 */
import { useCallback, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
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
import {
  NODE_SUBTYPE_TO_TYPE,
  WORKFLOW_NODE_TYPE_LABELS_FR,
  WORKFLOW_NODE_SUBTYPE_LABELS_FR,
  WORKFLOW_NODE_TYPE_COLORS,
  type Workflow,
  type WorkflowNode,
  type WorkflowNodeSubtype,
  type WorkflowEdge,
  type WorkflowNodeType,
} from "../../domain/model/workflow";

const NODE_W = 160;
const NODE_H = 60;

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
}

interface DragState {
  kind: "node";
  nodeId: string;
  offsetX: number;
  offsetY: number;
}

interface EdgeDraft {
  fromId: string;
  /** Pointer coordinates in SVG viewBox space. */
  cursorX: number;
  cursorY: number;
}

/**
 * Convert a clientX/clientY pair to SVG viewBox coordinates. The SVG is
 * rendered responsively; we use getBoundingClientRect + the known viewBox
 * (1000×600) to translate back.
 */
function clientToSvg(svg: SVGSVGElement | null, clientX: number, clientY: number): { x: number; y: number } {
  if (!svg) return { x: 0, y: 0 };
  const rect = svg.getBoundingClientRect();
  const sx = 1000 / rect.width;
  const sy = 600 / rect.height;
  return { x: (clientX - rect.left) * sx, y: (clientY - rect.top) * sy };
}

export function DagCanvas({ workflow, onChange, onSave, onDeploy, canEdit }: DagCanvasProps) {
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
  }

  const emit = useCallback((nextNodes: WorkflowNode[], nextEdges: WorkflowEdge[]) => {
    setNodes(nextNodes);
    setEdges(nextEdges);
    onChange(nextNodes, nextEdges);
  }, [onChange]);

  /* --------------------- Node drag (mousedown/mousemove/mouseup) --------------------- */
  function handleNodeMouseDown(e: ReactMouseEvent<SVGRectElement>, node: WorkflowNode) {
    if (!canEdit) return;
    e.stopPropagation();
    setSelectedId(node.id);
    const { x, y } = clientToSvg(svgRef.current, e.clientX, e.clientY);
    setDrag({
      kind: "node",
      nodeId: node.id,
      offsetX: x - node.position.x,
      offsetY: y - node.position.y,
    });
  }

  function handleCanvasMouseMove(e: ReactMouseEvent<SVGSVGElement>) {
    if (drag) {
      const { x, y } = clientToSvg(svgRef.current, e.clientX, e.clientY);
      const next = nodes.map((n) =>
        n.id === drag.nodeId
          ? { ...n, position: { x: Math.max(0, x - drag.offsetX), y: Math.max(0, y - drag.offsetY) } }
          : n,
      );
      setNodes(next);
      onChange(next, edges);
    } else if (edgeDraft) {
      const { x, y } = clientToSvg(svgRef.current, e.clientX, e.clientY);
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

  /* --------------------- Edge creation (port drag) --------------------- */
  function handleOutputPortMouseDown(e: ReactMouseEvent<SVGCircleElement>, node: WorkflowNode) {
    if (!canEdit) return;
    e.stopPropagation();
    const { x, y } = clientToSvg(svgRef.current, e.clientX, e.clientY);
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
          `Cycle détecté — ${cycle.cycleNodeIds.size} nœud(s) en boucle. Ce connexion créera une boucle : corrigez avant de sauvegarder.`,
        );
      } else {
        setCycleError(null);
      }
    }
    setEdgeDraft(null);
  }

  /* --------------------- Context menu (right-click) --------------------- */
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

  /* --------------------- Derived: cycle edges (for red highlight) --------------------- */
  const cycle = cycleError ? detectCycle(nodes, edges) : null;
  const cycleEdgeKeys = new Set(cycle?.cycleEdgeKeys ?? []);
  const cycleNodeIds = new Set(cycle?.cycleNodeIds ?? []);

  /* --------------------- Render --------------------- */
  return (
    <Card className="flex flex-col h-full">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground truncate">{workflow.name}</span>
          <span className="text-xs text-muted-foreground">·</span>
          <span className="text-xs text-muted-foreground">{nodes.length} nœud(s), {edges.length} lien(s)</span>
        </div>
        <div className="flex items-center gap-2">
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
      <CardContent className="flex-1 p-0 overflow-hidden">
        <svg
          ref={svgRef}
          viewBox="0 0 1000 600"
          className="w-full h-full bg-surface-background cursor-default select-none"
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onClick={handleCanvasClick}
        >
          {/* Grid background */}
          <defs>
            <pattern id="dag-grid" width="40" height="40" patternUnits="userSpaceOnUse">
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
          </defs>
          <rect width="1000" height="600" fill="url(#dag-grid)" />

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
            const path = `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
            return (
              <path
                key={edge.id}
                d={path}
                className={isCycle ? "stroke-status-danger" : "stroke-border"}
                strokeWidth={isCycle ? 2.5 : 1.8}
                fill="none"
                markerEnd={isCycle ? "url(#dag-arrow-cycle)" : "url(#dag-arrow)"}
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
            return (
              <g
                key={node.id}
                transform={`translate(${node.position.x}, ${node.position.y})`}
                className="cursor-move"
              >
                <rect
                  width={NODE_W}
                  height={NODE_H}
                  rx={10}
                  ry={10}
                  className={cn(colors.bg, colors.border, isCycle && "stroke-status-danger")}
                  strokeWidth={isSelected ? 2.5 : isCycle ? 2.5 : 1.5}
                  onMouseDown={(e) => handleNodeMouseDown(e, node)}
                  onContextMenu={(e) => {
                    // Prevent the browser's native context menu so the
                    // DropdownMenu (rendered below) can take over.
                    e.preventDefault();
                  }}
                />
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
        </svg>
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
    position: { x: 100, y: 100 + Math.random() * 200 },
    config: {},
  };
}

/** Plus icon re-exported for the palette header. */
export const PlusIcon = Plus;
