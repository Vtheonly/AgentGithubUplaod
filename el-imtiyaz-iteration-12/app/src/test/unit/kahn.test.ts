/**
 * Unit tests for Kahn's algorithm (cycle detection) — plan §10.03.
 *
 * 10+ cases covering:
 *   - Empty graph, single node, two nodes (with/without cycle).
 *   - Self-loop.
 *   - Disconnected components (one cyclic, one acyclic).
 *   - 4-node diamond (acyclic).
 *   - 4-node cycle.
 *   - 6-node graph with a 3-node cycle embedded.
 *   - Duplicate edges (deduplicated).
 */
import { describe, it, expect } from "vitest";
import { detectCycle } from "../../domain/workflow/kahn";

const n = (id: string) => ({ id });
const e = (from: string, to: string) => ({ from, to });

describe("detectCycle (Kahn's algorithm)", () => {
  it("returns no cycle for an empty graph", () => {
    const r = detectCycle([], []);
    expect(r.hasCycle).toBe(false);
    expect(Array.from(r.cycleNodeIds)).toEqual([]);
    expect(Array.from(r.cycleEdgeKeys)).toEqual([]);
  });

  it("returns no cycle for a single node with no edges", () => {
    const r = detectCycle([n("a")], []);
    expect(r.hasCycle).toBe(false);
  });

  it("returns no cycle for two nodes with one edge a→b", () => {
    const r = detectCycle([n("a"), n("b")], [e("a", "b")]);
    expect(r.hasCycle).toBe(false);
  });

  it("detects a 2-node cycle a→b, b→a", () => {
    const r = detectCycle([n("a"), n("b")], [e("a", "b"), e("b", "a")]);
    expect(r.hasCycle).toBe(true);
    expect(Array.from(r.cycleNodeIds).sort()).toEqual(["a", "b"]);
    expect(Array.from(r.cycleEdgeKeys).sort()).toEqual(["a->b", "b->a"]);
  });

  it("detects a self-loop a→a", () => {
    const r = detectCycle([n("a")], [e("a", "a")]);
    expect(r.hasCycle).toBe(true);
    expect(Array.from(r.cycleNodeIds)).toEqual(["a"]);
    expect(Array.from(r.cycleEdgeKeys)).toEqual(["a->a"]);
  });

  it("detects a cycle in disconnected components where only one is cyclic", () => {
    // a → b → a   (cycle)
    // c → d       (acyclic)
    const r = detectCycle(
      [n("a"), n("b"), n("c"), n("d")],
      [e("a", "b"), e("b", "a"), e("c", "d")],
    );
    expect(r.hasCycle).toBe(true);
    expect(Array.from(r.cycleNodeIds).sort()).toEqual(["a", "b"]);
    // Only the cyclic component's edges should appear.
    expect(Array.from(r.cycleEdgeKeys).sort()).toEqual(["a->b", "b->a"]);
  });

  it("returns no cycle for a 4-node diamond a→b, a→c, b→d, c→d", () => {
    const r = detectCycle(
      [n("a"), n("b"), n("c"), n("d")],
      [e("a", "b"), e("a", "c"), e("b", "d"), e("c", "d")],
    );
    expect(r.hasCycle).toBe(false);
  });

  it("detects a 4-node cycle a→b→c→d→a", () => {
    const r = detectCycle(
      [n("a"), n("b"), n("c"), n("d")],
      [e("a", "b"), e("b", "c"), e("c", "d"), e("d", "a")],
    );
    expect(r.hasCycle).toBe(true);
    expect(Array.from(r.cycleNodeIds).sort()).toEqual(["a", "b", "c", "d"]);
    expect(Array.from(r.cycleEdgeKeys).length).toBe(4);
  });

  it("detects only the cyclic nodes in a 6-node graph with a 3-node cycle embedded", () => {
    // Structure: a feeds into both branches; the cyclic branch is isolated.
    //   a → b → c → b   (cycle b-c)
    //   a → d → e → f   (acyclic)
    // Kahn peels: a (in-degree 0). Then d (in-degree becomes 0 after a peeled),
    // then e, then f. The b-c pair remains because each has in-degree 1 from
    // the other. So the cyclic leftover = {b, c}.
    const r = detectCycle(
      [n("a"), n("b"), n("c"), n("d"), n("e"), n("f")],
      [
        e("a", "b"),
        e("a", "d"),
        e("b", "c"),
        e("c", "b"),
        e("d", "e"),
        e("e", "f"),
      ],
    );
    expect(r.hasCycle).toBe(true);
    expect(Array.from(r.cycleNodeIds).sort()).toEqual(["b", "c"]);
    expect(Array.from(r.cycleEdgeKeys).sort()).toEqual(["b->c", "c->b"]);
  });

  it("deduplicates duplicate edges a→b (no false cycle)", () => {
    // Two copies of a→b should not double-count in-degree.
    const r = detectCycle([n("a"), n("b")], [e("a", "b"), e("a", "b")]);
    expect(r.hasCycle).toBe(false);
  });

  it("handles multi-component cycle (two disjoint 2-node cycles)", () => {
    // a → b → a   AND   c → d → c
    const r = detectCycle(
      [n("a"), n("b"), n("c"), n("d")],
      [e("a", "b"), e("b", "a"), e("c", "d"), e("d", "c")],
    );
    expect(r.hasCycle).toBe(true);
    expect(Array.from(r.cycleNodeIds).sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("ignores edges that reference unknown nodes (defensive)", () => {
    const r = detectCycle([n("a"), n("b")], [e("a", "b"), e("a", "z"), e("x", "b")]);
    expect(r.hasCycle).toBe(false);
  });
});
