/**
 * Workflow auto-layout — T-221 ("Clean Up Layout" canvas button).
 *
 * Deterministic left-to-right layered layout derived from the graph's
 * TOPOLOGY (not from the current drag positions):
 *   - layer(n) = longest-path depth from any source (Kahn layers);
 *   - nodes in the same layer are stacked vertically, centred as a group;
 *   - the x axis is the layer index, the y axis the within-layer rank;
 *   - positions snap to a 20px grid (the same grid the canvas dot-pattern
 *     renders, so nodes visually align with the background).
 *
 * Pure function: node identity, type, subtype, label and config are all
 * preserved verbatim — only `position` changes. A cyclic graph returns an
 * error (the canvas surfaces it instead of laying out a loop).
 */
import { detectCycle } from "../../kahn";
import { topologicalOrder } from "./dry-run";
import type { WorkflowNode, WorkflowEdge } from "../../model/workflow";

/** Layout constants (shared with the DAG canvas geometry). */
export const LAYOUT_GRID = 20;
export const LAYOUT_LAYER_GAP = 260;
// NOTE: every gap must be a multiple of LAYOUT_GRID, otherwise per-node
// snapping produces ragged spacing (a 110px gap snapped to the 20px grid
// alternates 100/120 — caught by the auto-layout test).
export const LAYOUT_ROW_GAP = 120;
export const LAYOUT_MARGIN = 60;

export interface AutoLayoutResult {
  readonly ok: boolean;
  readonly error?: string;
  /** Re-sequenced nodes with fresh positions (same order as the input). */
  readonly nodes: readonly WorkflowNode[];
}

/**
 * Compute the layered layout. Edge semantics: `route_switch` fan-outs and
 * normal branches all count as one layer step downstream.
 */
export function autoLayout(
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
): AutoLayoutResult {
  const cycle = detectCycle(nodes, edges);
  if (cycle.hasCycle) {
    return {
      ok: false,
      error: `Cycle détecté — ${cycle.cycleNodeIds.size} nœud(s) en boucle : impossible de réorganiser.`,
      nodes,
    };
  }

  // Layer = longest path from any source (nodes with no incoming edges).
  const nodeIds = new Set(nodes.map((n) => n.id));
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const id of nodeIds) {
    incoming.set(id, []);
    outgoing.set(id, []);
  }
  for (const e of edges) {
    if (!nodeIds.has(e.from) || !nodeIds.has(e.to)) continue;
    incoming.get(e.to)!.push(e.from);
    outgoing.get(e.from)!.push(e.to);
  }

  const layer = new Map<string, number>();
  const order = topologicalOrder(nodes, edges);
  for (const { id } of order) {
    const feeders = incoming.get(id) ?? [];
    const depth = feeders.length === 0 ? 0 : Math.max(...feeders.map((f) => (layer.get(f) ?? 0) + 1));
    layer.set(id, depth);
  }

  // Group by layer, preserving the topological order inside each layer
  // (stable, deterministic output).
  const layers = new Map<number, string[]>();
  for (const { id } of order) {
    const l = layer.get(id) ?? 0;
    const bucket = layers.get(l) ?? [];
    bucket.push(id);
    layers.set(l, bucket);
  }

  const maxRows = Math.max(1, ...Array.from(layers.values(), (b) => b.length));
  const canvasHeight = LAYOUT_MARGIN * 2 + Math.max(1, maxRows - 1) * LAYOUT_ROW_GAP;

  const positionById = new Map<string, { x: number; y: number }>();
  for (const [l, bucket] of layers) {
    const groupHeight = (bucket.length - 1) * LAYOUT_ROW_GAP;
    const startY = (canvasHeight - groupHeight) / 2;
    bucket.forEach((id, row) => {
      positionById.set(id, {
        x: snap(LAYOUT_MARGIN + l * LAYOUT_LAYER_GAP),
        y: snap(startY + row * LAYOUT_ROW_GAP),
      });
    });
  }

  return {
    ok: true,
    nodes: nodes.map((n) => {
      const position = positionById.get(n.id);
      return position ? { ...n, position } : n;
    }),
  };
}

/** Snap a coordinate to the 20px canvas grid. */
function snap(value: number): number {
  return Math.round(value / LAYOUT_GRID) * LAYOUT_GRID;
}
