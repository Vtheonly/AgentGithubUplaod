/**
 * T-221 — workflow dry-run simulator (domain/calc/workflow/dry-run).
 *
 * Pins the branch-aware topological execution semantics that the canvas
 * "Tester" button visualises and the mock repository executor reuses:
 *   - linear chains execute fully;
 *   - a FAILING condition closes ONLY its branch (parallel branches keep
 *     running — the divergence the old linear executor could not model);
 *   - route_switch opens only the first passing route;
 *   - converging open paths execute the shared node once;
 *   - cycles are rejected without throwing;
 *   - missing fields degrade to false + a vault §10.05 warning.
 */
import { describe, expect, it } from "vitest";
import { dryRunWorkflow, parseSwitchRoutes, topologicalOrder } from "../../../domain/calc/workflow/dry-run";
import { defaultConditionContext } from "../../../domain/calc/workflow/condition-evaluator";
import { detectCycle } from "../../../domain/kahn";
import type { WorkflowNode, WorkflowEdge } from "../../../domain/model/workflow";

function node(id: string, type: WorkflowNode["type"], subtype: WorkflowNode["subtype"], config: Record<string, unknown> = {}): WorkflowNode {
  return { id, type, subtype, label: id, position: { x: 0, y: 0 }, config };
}

function edge(from: string, to: string): WorkflowEdge {
  return { id: `e-${from}-${to}`, from, to };
}

const ctx = defaultConditionContext();

describe("dryRunWorkflow — branch semantics (T-221)", () => {
  it("linear chain: every node executes, every edge is taken", () => {
    const nodes = [
      node("t1", "trigger", "payment_overdue", { grace_days: 7 }),
      node("a1", "action", "push_notification", { title: "x" }),
    ];
    const edges = [edge("t1", "a1")];
    const r = dryRunWorkflow(nodes, edges, ctx);
    expect(r.ok).toBe(true);
    expect(r.results.map((x) => x.status)).toEqual(["succeeded", "succeeded"]);
    expect(r.takenEdgeKeys).toEqual(["t1->a1"]);
  });

  it("failing condition closes ONLY its branch — the parallel branch keeps running", () => {
    // debt.amount is 60 000 in the default context → > 1 000 000 is FALSE.
    const nodes = [
      node("t1", "trigger", "payment_overdue"),
      node("c1", "condition", "debt_over_threshold", {
        condition: { kind: "comparison", field: "debt.amount", op: ">", value: 1_000_000 },
      }),
      node("a1", "action", "send_whatsapp"), // fed ONLY by the failing condition
      node("a2", "action", "log_audit"), // fed directly by the trigger
    ];
    const edges = [edge("t1", "c1"), edge("c1", "a1"), edge("t1", "a2")];
    const r = dryRunWorkflow(nodes, edges, ctx);
    expect(r.ok).toBe(true);
    const byId = new Map(r.results.map((x) => [x.nodeId, x.status]));
    expect(byId.get("t1")).toBe("succeeded");
    expect(byId.get("c1")).toBe("succeeded"); // the node itself runs…
    expect(byId.get("a1")).toBe("skipped"); // …but its branch is closed
    expect(byId.get("a2")).toBe("succeeded"); // parallel branch unaffected
    expect(r.takenEdgeKeys).toContain("t1->a2");
    expect(r.takenEdgeKeys).not.toContain("c1->a1");
  });

  it("route_switch opens ONLY the first passing route", () => {
    const nodes = [
      node("t1", "trigger", "payment_overdue"),
      node("s1", "condition", "route_switch", {
        routes: [
          { label: "Voie haute", condition: { kind: "comparison", field: "debt.amount", op: ">", value: 1_000_000 } }, // false
          { label: "Voie normale", condition: { kind: "comparison", field: "debt.amount", op: ">", value: 50_000 } }, // true (60k)
        ],
      }),
      node("a1", "action", "push_notification"), // route 0 target → skipped
      node("a2", "action", "send_whatsapp"), // route 1 target → executed
    ];
    const edges = [edge("t1", "s1"), edge("s1", "a1"), edge("s1", "a2")];
    const r = dryRunWorkflow(nodes, edges, ctx);
    expect(r.ok).toBe(true);
    const byId = new Map(r.results.map((x) => [x.nodeId, x.status]));
    expect(byId.get("a1")).toBe("skipped");
    expect(byId.get("a2")).toBe("succeeded");
    expect(r.takenEdgeKeys).toContain("s1->a2");
    expect(r.takenEdgeKeys).not.toContain("s1->a1");
  });

  it("route_switch with no passing route closes all outputs", () => {
    const nodes = [
      node("t1", "trigger", "payment_overdue"),
      node("s1", "condition", "route_switch", {
        routes: [
          { label: "A", condition: { kind: "comparison", field: "debt.amount", op: ">", value: 1_000_000 } },
          { label: "B", condition: { kind: "comparison", field: "debt.amount", op: ">", value: 2_000_000 } },
        ],
      }),
      node("a1", "action", "log_audit"),
    ];
    const r = dryRunWorkflow([nodes[0], nodes[1], nodes[2]], [edge("t1", "s1"), edge("s1", "a1")], ctx);
    expect(r.ok).toBe(true);
    expect(r.results.find((x) => x.nodeId === "a1")?.status).toBe("skipped");
  });

  it("converging open paths execute the shared node exactly once", () => {
    const nodes = [
      node("t1", "trigger", "payment_overdue"),
      node("c1", "condition", "debt_over_threshold", {
        condition: { kind: "comparison", field: "debt.amount", op: ">", value: 50_000 },
      }),
      node("a1", "action", "log_audit"),
    ];
    const edges = [edge("t1", "c1"), edge("t1", "a1"), edge("c1", "a1")];
    const r = dryRunWorkflow(nodes, edges, ctx);
    expect(r.ok).toBe(true);
    const a1Rows = r.results.filter((x) => x.nodeId === "a1");
    expect(a1Rows).toHaveLength(1);
    expect(a1Rows[0].status).toBe("succeeded");
  });

  it("cycle → ok:false with a Kahn error, never throws", () => {
    const nodes = [node("a", "action", "log_audit"), node("b", "action", "log_audit")];
    const edges = [edge("a", "b"), edge("b", "a")];
    const r = dryRunWorkflow(nodes, edges, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("Cycle");
    expect(r.results).toHaveLength(0);
  });

  it("missing field → condition false + vault §10.05 warning", () => {
    const nodes = [
      node("t1", "trigger", "payment_overdue"),
      node("c1", "condition", "student_status_match", {
        condition: { kind: "comparison", field: "student.gpaX", op: ">", value: 10 },
      }),
      node("a1", "action", "log_audit"),
    ];
    const r = dryRunWorkflow(nodes, [edge("t1", "c1"), edge("c1", "a1")], ctx);
    const c1 = r.results.find((x) => x.nodeId === "c1");
    expect(c1?.status).toBe("succeeded");
    expect(c1?.warnings.join(" ")).toContain("Champ introuvable");
    expect(r.results.find((x) => x.nodeId === "a1")?.status).toBe("skipped");
  });

  it("time_window evaluates against the context instant", () => {
    // Build a fixed context instant: a Wednesday 10:00 local time.
    const fixed = new Date(2026, 8, 9, 10, 0, 0); // Sept 9 2026 is a Wednesday
    const context = {
      ...ctx,
      workflow: { now: fixed.toISOString(), nowMs: fixed.getTime() },
    };
    const inWindow = node("w1", "condition", "time_window", { startHour: 8, endHour: 16.5, days: [0, 1, 2, 3, 4] });
    const r = dryRunWorkflow([inWindow], [], context);
    expect(r.results[0].status).toBe("succeeded");
    expect(r.results[0].output).toContain("ouvert");

    // Same instant, but window excludes Wednesdays.
    const outWindow = node("w2", "condition", "time_window", { startHour: 8, endHour: 16.5, days: [5, 6] });
    const r2 = dryRunWorkflow([outWindow], [], context);
    expect(r2.results[0].output).toContain("fermé");
    expect(r2.takenEdgeKeys).toHaveLength(0);
  });
});

describe("parseSwitchRoutes (T-221)", () => {
  it("parses well-formed routes and drops malformed entries", () => {
    const routes = parseSwitchRoutes([
      { label: "A", condition: { kind: "comparison", field: "debt.amount", op: ">", value: 1 } },
      "garbage",
      null,
      { label: 42, condition: "nope" },
    ]);
    expect(routes).toHaveLength(2);
    expect(routes[0].label).toBe("A");
    expect(routes[0].condition?.kind).toBe("comparison");
    expect(routes[1].label).toBe("Voie"); // fallback label
    expect(routes[1].condition).toBeNull(); // unparseable condition → null (no gate)
  });

  it("non-array input → empty routes", () => {
    expect(parseSwitchRoutes(undefined)).toHaveLength(0);
    expect(parseSwitchRoutes({})).toHaveLength(0);
  });
});

describe("topologicalOrder (T-221)", () => {
  it("orders by dependency depth and returns the ORIGINAL node objects", () => {
    const a = node("a", "action", "log_audit");
    const b = node("b", "action", "log_audit");
    const c = node("c", "action", "log_audit");
    const order = topologicalOrder([c, a, b], [edge("a", "b"), edge("b", "c")]);
    expect(order.map((n) => n.id)).toEqual(["a", "b", "c"]);
    expect(order[0]).toBe(a); // identity, not a copy
  });

  it("duplicate edges are de-duplicated", () => {
    const a = node("a", "action", "log_audit");
    const b = node("b", "action", "log_audit");
    const order = topologicalOrder([a, b], [edge("a", "b"), edge("a", "b")]);
    expect(order.map((n) => n.id)).toEqual(["a", "b"]);
  });
});

describe("dry-run ↔ kahn consistency", () => {
  it("dry-run ok ⟺ detectCycle hasCycle false (property sample)", () => {
    const acyclic = [node("t", "trigger", "manual_run"), node("a", "action", "log_audit")];
    const cyclicEdges = [edge("t", "a"), edge("a", "t")];
    expect(detectCycle(acyclic, cyclicEdges).hasCycle).toBe(true);
    expect(dryRunWorkflow(acyclic, cyclicEdges, ctx).ok).toBe(false);
    const acyclicEdges = [edge("t", "a")];
    expect(detectCycle(acyclic, acyclicEdges).hasCycle).toBe(false);
    expect(dryRunWorkflow(acyclic, acyclicEdges, ctx).ok).toBe(true);
  });
});
