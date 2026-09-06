/**
 * T-221 — workflow auto-layout (domain/calc/workflow/auto-layout).
 *
 * Pins the "Réorganiser" (Clean Up Layout) contract:
 *   - layer depth follows the topology (longest path from a source);
 *   - same-layer nodes stack vertically at the SAME x;
 *   - node identity/config/label are preserved verbatim (only position moves);
 *   - positions snap to the 20px grid;
 *   - cyclic graphs are refused with an error (never laid out);
 *   - empty graphs are a no-op.
 */
import { describe, expect, it } from "vitest";
import { autoLayout, LAYOUT_GRID, LAYOUT_LAYER_GAP, LAYOUT_ROW_GAP } from "../../../domain/calc/workflow/auto-layout";
import type { WorkflowNode, WorkflowEdge } from "../../../domain/model/workflow";

function node(id: string, type: WorkflowNode["type"], subtype: WorkflowNode["subtype"], x = 0, y = 0): WorkflowNode {
  return { id, type, subtype, label: id, position: { x, y }, config: { keep: "me" } };
}

function edge(from: string, to: string): WorkflowEdge {
  return { id: `e-${from}-${to}`, from, to };
}

describe("autoLayout (T-221)", () => {
  it("linear chain: layers increase left→right by the layer gap", () => {
    const nodes = [node("t", "trigger", "payment_overdue"), node("c", "condition", "debt_over_threshold"), node("a", "action", "log_audit")];
    const r = autoLayout(nodes, [edge("t", "c"), edge("c", "a")]);
    expect(r.ok).toBe(true);
    const byId = new Map(r.nodes.map((n) => [n.id, n]));
    const t = byId.get("t")!;
    const c = byId.get("c")!;
    const a = byId.get("a")!;
    expect(c.position.x - t.position.x).toBe(LAYOUT_LAYER_GAP);
    expect(a.position.x - c.position.x).toBe(LAYOUT_LAYER_GAP);
    expect(t.position.x).toBeGreaterThanOrEqual(0);
  });

  it("fan-out: siblings share the SAME x, stack vertically by the row gap", () => {
    const nodes = [
      node("t", "trigger", "payment_overdue"),
      node("a", "action", "log_audit"),
      node("b", "action", "push_notification"),
      node("c", "action", "send_whatsapp"),
    ];
    const r = autoLayout(nodes, [edge("t", "a"), edge("t", "b"), edge("t", "c")]);
    expect(r.ok).toBe(true);
    const byId = new Map(r.nodes.map((n) => [n.id, n]));
    const xs = [byId.get("a")!, byId.get("b")!, byId.get("c")!].map((n) => n.position.x);
    expect(new Set(xs).size).toBe(1); // same layer → same column
    const ys = [byId.get("a")!, byId.get("b")!, byId.get("c")!].map((n) => n.position.y);
    const diffs = [ys[1] - ys[0], ys[2] - ys[1]];
    expect(diffs).toEqual([LAYOUT_ROW_GAP, LAYOUT_ROW_GAP]);
  });

  it("diamond: converging node lands one layer AFTER both branches", () => {
    const nodes = [
      node("t", "trigger", "payment_overdue"),
      node("l", "action", "log_audit"),
      node("r", "action", "send_whatsapp"),
      node("j", "action", "dispatch_task"),
    ];
    const r = autoLayout(nodes, [edge("t", "l"), edge("t", "r"), edge("l", "j"), edge("r", "j")]);
    expect(r.ok).toBe(true);
    const byId = new Map(r.nodes.map((n) => [n.id, n]));
    expect(byId.get("j")!.position.x).toBeGreaterThan(byId.get("l")!.position.x);
    expect(byId.get("j")!.position.x).toBeGreaterThan(byId.get("r")!.position.x);
  });

  it("preserves node identity, type, subtype, label and config verbatim", () => {
    const nodes = [node("t", "trigger", "payment_overdue", 123, 456)];
    const r = autoLayout(nodes, []);
    expect(r.ok).toBe(true);
    expect(r.nodes[0].id).toBe("t");
    expect(r.nodes[0].type).toBe("trigger");
    expect(r.nodes[0].subtype).toBe("payment_overdue");
    expect(r.nodes[0].label).toBe("t");
    expect(r.nodes[0].config).toEqual({ keep: "me" });
    // Position changed (snapped away from 123/456).
    expect(r.nodes[0].position).not.toEqual({ x: 123, y: 456 });
  });

  it("all positions snap to the 20px grid", () => {
    const nodes = [
      node("t", "trigger", "payment_overdue", 37, 91),
      node("a", "action", "log_audit", 411, 233),
      node("b", "action", "send_whatsapp", 999, 577),
    ];
    const r = autoLayout(nodes, [edge("t", "a"), edge("t", "b")]);
    for (const n of r.nodes) {
      expect(n.position.x % LAYOUT_GRID).toBe(0);
      expect(n.position.y % LAYOUT_GRID).toBe(0);
    }
  });

  it("cycle → refused with an error", () => {
    const nodes = [node("a", "action", "log_audit"), node("b", "action", "log_audit")];
    const r = autoLayout(nodes, [edge("a", "b"), edge("b", "a")]);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("Cycle");
  });

  it("empty graph → ok no-op", () => {
    const r = autoLayout([], []);
    expect(r.ok).toBe(true);
    expect(r.nodes).toHaveLength(0);
  });

  it("isolated nodes (no edges) still get a position", () => {
    const nodes = [node("solo", "transform", "extract_field")];
    const r = autoLayout(nodes, []);
    expect(r.ok).toBe(true);
    expect(r.nodes[0].position.x).toBeGreaterThanOrEqual(0);
    expect(r.nodes[0].position.y).toBeGreaterThanOrEqual(0);
  });
});
