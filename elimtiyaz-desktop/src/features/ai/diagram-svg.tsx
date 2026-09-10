// ============================================================================
// FILE: elimtiyaz-desktop/src/features/ai/diagram-svg.tsx
// ============================================================================
/**
 * Zero-dependency SVG diagram renderer for copilot artifacts (T-272,
 * 42nd session — AI-311a).
 *
 * Renders `hierarchy` diagrams (the family / class structures the
 * draw_relationship_diagram tool builds): a layered top-down layout —
 * nodes are grouped by `level`, one row per level, edges drawn as
 * elbow connectors. `flow` diagrams render as a vertical step chain.
 *
 * The layout is deterministic (no physics, no auto-layout library):
 * nodes per level are distributed evenly across the row; boxes carry
 * label + sublabel; the box color follows the node kind (root = filled
 * primary, branch = tinted, leaf = outline).
 */
import React from "react";
import type { DiagramArtifact, DiagramNode } from "../../core/ai/artifacts";

const NODE_W = 120;
const NODE_H = 44;
const ROW_GAP = 56;
const SIDE_GAP = 26;
const BOX_FILL: Record<string, string> = {
  root: "#2f8fd6",
  branch: "#10b981",
  leaf: "#0ea5e9",
  step: "#f59e0b",
};
const BOX_TINT: Record<string, number> = { root: 1, branch: 0.22, leaf: 0.2, step: 0.2 };

function boxFill(node: DiagramNode): string {
  return BOX_FILL[node.kind ?? "leaf"] ?? BOX_FILL.leaf;
}
function boxOpacity(node: DiagramNode): number {
  return BOX_TINT[node.kind ?? "leaf"] ?? 0.2;
}

function fitText(text: string, maxPx: number, fontSize: number): string {
  const maxChars = Math.floor(maxPx / (fontSize * 0.58));
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(1, maxChars - 1))}…`;
}

export function DiagramSvg({ diagram }: { diagram: DiagramArtifact }) {
  if (diagram.diagramType === "flow") return <FlowDiagram diagram={diagram} />;
  return <HierarchyDiagram diagram={diagram} />;
}

/* ---------------------------- hierarchy ---------------------------- */

function HierarchyDiagram({ diagram }: { diagram: DiagramArtifact }) {
  const levels = new Map<number, DiagramNode[]>();
  for (const n of diagram.nodes) {
    const list = levels.get(n.level) ?? [];
    list.push(n);
    levels.set(n.level, list);
  }
  const sortedLevels = [...levels.keys()].sort((a, b) => a - b);

  // Layout: row height per level; x positions computed after the widest
  // row is known (the SVG scales to the widest row).
  const rowW = Math.max(
    ...sortedLevels.map((lv) => {
      const count = levels.get(lv)!.length;
      return count * (NODE_W + SIDE_GAP) - SIDE_GAP;
    }),
    NODE_W,
  );
  const svgW = Math.max(rowW, 320);
  const svgH = sortedLevels.length * (NODE_H + ROW_GAP) - ROW_GAP + 16;
  const positions = new Map<string, { x: number; y: number; node: DiagramNode }>();

  sortedLevels.forEach((lv, li) => {
    const nodes = levels.get(lv)!;
    const rowWidth = nodes.length * (NODE_W + SIDE_GAP) - SIDE_GAP;
    const startX = (svgW - rowWidth) / 2;
    const y = 8 + li * (NODE_H + ROW_GAP);
    nodes.forEach((n, i) => {
      positions.set(n.id, { x: startX + i * (NODE_W + SIDE_GAP), y, node: n });
    });
  });

  const bottomAnchor = (id: string) => {
    const p = positions.get(id)!;
    return { x: p.x + NODE_W / 2, y: p.y + NODE_H };
  };
  const topAnchor = (id: string) => {
    const p = positions.get(id)!;
    return { x: p.x + NODE_W / 2, y: p.y };
  };

  return (
    <svg
      viewBox={`0 0 ${svgW} ${Math.max(svgH, 90)}`}
      className="h-auto w-full"
      role="img"
      aria-label={diagram.title}
    >
      {/* Edges: elbow connectors (down, across, down) */}
      {diagram.edges.map((e, i) => {
        const from = bottomAnchor(e.from);
        const to = topAnchor(e.to);
        const midY = (from.y + to.y) / 2;
        const d = `M ${from.x} ${from.y} L ${from.x} ${midY} L ${to.x} ${midY} L ${to.x} ${to.y}`;
        return (
          <g key={i}>
            <path d={d} fill="none" stroke="currentColor" strokeOpacity={0.4} strokeWidth={1.4} className="text-muted-foreground" />
            {e.label && (
              <text
                x={(from.x + to.x) / 2}
                y={midY - 3}
                textAnchor="middle"
                fontSize={7.5}
                className="fill-muted-foreground"
              >
                {fitText(e.label, Math.abs(from.x - to.x) + 40, 7.5)}
              </text>
            )}
          </g>
        );
      })}
      {/* Nodes */}
      {[...positions.values()].map(({ x, y, node }) => (
        <g key={node.id}>
          <rect
            x={x}
            y={y}
            width={NODE_W}
            height={NODE_H}
            rx={7}
            fill={boxFill(node)}
            fillOpacity={boxOpacity(node)}
            stroke={boxFill(node)}
            strokeOpacity={0.85}
          />
          <text x={x + NODE_W / 2} y={y + 18} textAnchor="middle" fontSize={10} fontWeight={600} className="fill-foreground">
            {fitText(node.label, NODE_W - 12, 10)}
          </text>
          {node.sublabel && (
            <text x={x + NODE_W / 2} y={y + 32} textAnchor="middle" fontSize={8} className="fill-muted-foreground">
              {fitText(node.sublabel, NODE_W - 10, 8)}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

/* ---------------------------- flow ---------------------------- */

function FlowDiagram({ diagram }: { diagram: DiagramArtifact }) {
  const nodes = diagram.nodes;
  const svgW = Math.max(320, NODE_W + 60);
  const svgH = nodes.length * (NODE_H + 34) + 8;
  return (
    <svg viewBox={`0 0 ${svgW} ${svgH}`} className="h-auto w-full" role="img" aria-label={diagram.title}>
      {nodes.map((n, i) => {
        const x = (svgW - NODE_W) / 2;
        const y = 8 + i * (NODE_H + 34);
        return (
          <g key={n.id}>
            {i < nodes.length - 1 && (
              <path
                d={`M ${svgW / 2} ${y + NODE_H} L ${svgW / 2} ${y + NODE_H + 34}`}
                stroke="currentColor"
                strokeOpacity={0.4}
                strokeWidth={1.6}
                className="text-muted-foreground"
              />
            )}
            <rect
              x={x}
              y={y}
              width={NODE_W}
              height={NODE_H}
              rx={9}
              fill={boxFill(n)}
              fillOpacity={boxOpacity(n)}
              stroke={boxFill(n)}
              strokeOpacity={0.85}
            />
            <text x={x + NODE_W / 2} y={y + 18} textAnchor="middle" fontSize={10} fontWeight={600} className="fill-foreground">
              {fitText(n.label, NODE_W - 12, 10)}
            </text>
            {n.sublabel && (
              <text x={x + NODE_W / 2} y={y + 32} textAnchor="middle" fontSize={8} className="fill-muted-foreground">
                {fitText(n.sublabel, NODE_W - 10, 8)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
