/**
 * T-314 — TRUE/FALSE (IF/ELSE) binary condition branching.
 *
 * Pins the new `WorkflowEdge.sourceHandle` contract on BOTH engines:
 *   - the desktop dry-run engine (domain/calc/workflow/dry-run.ts);
 *   - the server workflow-execute EF engine (engine.ts).
 *
 * Contract:
 *   - `sourceHandle: "true"`  → open iff the condition PASSES (green port);
 *   - `sourceHandle: "false"` → open iff the condition FAILS (red port);
 *   - unlabeled edges         → LEGACY GATE semantics (open iff it passes)
 *     — backward compatibility with every pre-T-314 graph (all existing
 *     tests use unlabeled edges, so those semantics are pinned twice).
 *
 * Plus semantic EQUIVALENCE between the two engines on labeled graphs
 * (the single-source-of-truth rule, T-224 §5).
 */
import { describe, expect, it } from "vitest";
import { dryRunWorkflow } from "../../../domain/calc/workflow/dry-run";
import type { WorkflowNode, WorkflowEdge } from "../../../domain/model/workflow";
import {
  executeWorkflowDefinition,
  type ActionHandler,
  type EngineActionOutcome,
  type EngineDefinition,
} from "../../../../supabase/functions/workflow-execute/engine.ts";

/* ------------------------------- fixtures ------------------------------- */

function node(id: string, type: WorkflowNode["type"], subtype: WorkflowNode["subtype"], config: Record<string, unknown> = {}): WorkflowNode {
  return { id, type, subtype, label: id, position: { x: 0, y: 0 }, config };
}

function edge(from: string, to: string, sourceHandle?: "true" | "false"): WorkflowEdge {
  return { id: `e-${from}-${to}-${sourceHandle ?? "out"}`, from, to, ...(sourceHandle ? { sourceHandle } : {}) };
}

const comparison = (field: string, op: string, value: unknown) => ({
  kind: "comparison" as const,
  field,
  op,
  value,
});

/** trigger → condition → (TRUE: aEscalate, FALSE: aSoft) → convergence */
const ifElseNodes: WorkflowNode[] = [
  node("t1", "trigger", "payment_overdue"),
  node("c1", "condition", "debt_over_threshold", {
    condition: comparison("debt.amount", ">", 40_000),
  }),
  node("aEscalate", "action", "restrict_account"),
  node("aSoft", "action", "push_notification", { title: "Rappel doux" }),
  node("aFinal", "action", "log_audit"),
];
const ifElseEdges: WorkflowEdge[] = [
  edge("t1", "c1"),
  edge("c1", "aEscalate", "true"),
  edge("c1", "aSoft", "false"),
  edge("aEscalate", "aFinal"),
  edge("aSoft", "aFinal"),
];

const HIGH_DEBT = { debt: { amount: 65_000 }, student: { status: "active" } };
const LOW_DEBT = { debt: { amount: 5_000 }, student: { status: "active" } };

/* ----------------------------- dry-run engine ---------------------------- */

describe("dry-run — TRUE/FALSE (IF/ELSE) branching (T-314)", () => {
  it("passing condition opens ONLY the true edges; the false branch is skipped", () => {
    const r = dryRunWorkflow(ifElseNodes, ifElseEdges, HIGH_DEBT);
    expect(r.ok).toBe(true);
    const byId = new Map(r.results.map((x) => [x.nodeId, x]));
    expect(byId.get("c1")?.status).toBe("succeeded");
    expect(byId.get("aEscalate")?.status).toBe("succeeded");
    expect(byId.get("aSoft")?.status).toBe("skipped");
    expect(byId.get("aFinal")?.status).toBe("succeeded"); // fed by the TRUE branch
    expect(r.takenEdgeKeys).toContain("c1->aEscalate");
    expect(r.takenEdgeKeys).not.toContain("c1->aSoft");
  });

  it("failing condition opens ONLY the false edges — a real ELSE path", () => {
    const r = dryRunWorkflow(ifElseNodes, ifElseEdges, LOW_DEBT);
    expect(r.ok).toBe(true);
    const byId = new Map(r.results.map((x) => [x.nodeId, x]));
    expect(byId.get("c1")?.status).toBe("succeeded"); // the node itself runs
    expect(byId.get("aEscalate")?.status).toBe("skipped");
    expect(byId.get("aSoft")?.status).toBe("succeeded"); // the ELSE branch RUNS
    expect(byId.get("aFinal")?.status).toBe("succeeded");
    expect(r.takenEdgeKeys).toContain("c1->aSoft");
    expect(r.takenEdgeKeys).not.toContain("c1->aEscalate");
  });

  it("legacy UNLABELED edges keep the GATE semantics (backward compat)", () => {
    const unlabeledEdges: WorkflowEdge[] = [
      edge("t1", "c1"),
      edge("c1", "aEscalate"),
      edge("c1", "aSoft"),
      edge("aEscalate", "aFinal"),
      edge("aSoft", "aFinal"),
    ];
    const r = dryRunWorkflow(ifElseNodes, unlabeledEdges, LOW_DEBT);
    const byId = new Map(r.results.map((x) => [x.nodeId, x]));
    // A failing condition closes BOTH unlabeled edges (gate).
    expect(byId.get("aEscalate")?.status).toBe("skipped");
    expect(byId.get("aSoft")?.status).toBe("skipped");
    expect(byId.get("aFinal")?.status).toBe("skipped");
  });

  it("condition results carry the human-readable MATH EVALUATION (Test Studio)", () => {
    const r = dryRunWorkflow(ifElseNodes, ifElseEdges, HIGH_DEBT);
    const c1 = r.results.find((x) => x.nodeId === "c1");
    expect(c1?.evaluation).toBeTruthy();
    // Separator style (space vs NBSP) is ICU-dependent — assert digits.
    const flat = (c1?.evaluation ?? "").replace(/[\u202f\u00a0 ]/g, "");
    expect(flat).toContain("debt.amount");
    expect(flat).toContain("40000"); // threshold
    expect(flat).toContain("65000"); // real value
    expect(c1?.evaluation).toContain("VRAI");
  });

  it("message templates resolve against the context (resolvedTemplate)", () => {
    const nodes: WorkflowNode[] = [
      node("t1", "trigger", "payment_overdue"),
      node("w1", "action", "send_whatsapp", {
        template: "Bonjour {{parent.name}}, votre solde de {{debt.amount}} DZD…",
      }),
    ];
    const r = dryRunWorkflow(nodes, [edge("t1", "w1")], {
      parent: { name: "Karim Benali" },
      debt: { amount: 65_000 },
    });
    const w1 = r.results.find((x) => x.nodeId === "w1");
    expect(w1?.resolvedTemplate).toBeTruthy();
    expect(w1?.resolvedTemplate).toContain("Karim Benali");
    expect(w1?.resolvedTemplate?.replace(/[\u202f\u00a0 ]/g, "")).toContain("65000");
    expect(w1?.resolvedTemplate).not.toContain("{{");
  });

  it("nodes carry the input payload snapshot for the step inspector", () => {
    const r = dryRunWorkflow(ifElseNodes, ifElseEdges, HIGH_DEBT);
    const c1 = r.results.find((x) => x.nodeId === "c1");
    expect(c1?.inputSnapshot).toBeTruthy();
    expect((c1?.inputSnapshot as Record<string, unknown>)?.debt).toBeTruthy();
  });
});

/* --------------------------- engine parity (EF) -------------------------- */

const okAction: EngineActionOutcome = { status: "succeeded", output: { done: true }, auditNote: "ok" };
const succeedAll: ActionHandler = async () => okAction;

function toEngineDef(nodes: WorkflowNode[], edges: WorkflowEdge[]): EngineDefinition {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.type,
      subtype: n.subtype,
      label: n.label,
      position: n.position,
      config: n.config,
    })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.from,
      target: e.to,
      ...(e.sourceHandle ? { source_handle: e.sourceHandle } : {}),
    })),
  };
}

describe("EF engine — TRUE/FALSE parity with the dry-run (T-314)", () => {
  for (const [name, ctx] of [["true branch", HIGH_DEBT], ["false branch", LOW_DEBT]] as const) {
    it(`branch outcome parity — ${name}`, async () => {
      const sim = dryRunWorkflow(ifElseNodes, ifElseEdges, ctx);
      const run = await executeWorkflowDefinition(toEngineDef(ifElseNodes, ifElseEdges), {
        context: ctx,
        actions: succeedAll,
      });
      const simById = new Map(sim.results.map((r) => [r.nodeId, r.status]));
      for (const r of run.node_results) {
        expect(simById.get(r.node_id), `node ${r.node_id} diverged`).toBe(
          r.status === "skipped" ? "skipped" : "succeeded",
        );
      }
      // The ELSE branch diverges: on the false context it RUNS on both engines.
      const elseNode = run.node_results.find((r) => r.node_id === "aSoft");
      expect(elseNode?.status).toBe(ctx === LOW_DEBT ? "succeeded" : "skipped");
    });
  }

  it("taken edge keys parity — the engines highlight the SAME path", async () => {
    for (const ctx of [HIGH_DEBT, LOW_DEBT]) {
      const sim = dryRunWorkflow(ifElseNodes, ifElseEdges, ctx);
      const run = await executeWorkflowDefinition(toEngineDef(ifElseNodes, ifElseEdges), {
        context: ctx,
        actions: succeedAll,
      });
      expect([...run.taken_edge_keys].sort()).toEqual([...sim.takenEdgeKeys].sort());
    }
  });

  it("validation rejects an invalid source_handle value", async () => {
    const { validateWorkflowDefinition } = await import(
      "../../../../supabase/functions/workflow-execute/engine.ts"
    );
    const bad = toEngineDef(ifElseNodes, [
      edge("t1", "c1"),
      { ...edge("c1", "aSoft"), sourceHandle: "maybe" as "false" },
    ]);
    const outcome = validateWorkflowDefinition(bad, { strict: false });
    expect(outcome.valid).toBe(false);
    expect(outcome.errors.join(" ")).toContain("invalid source_handle");
  });

  it("validation warns (non-fatal) when a non-condition node carries a handle", async () => {
    const { validateWorkflowDefinition } = await import(
      "../../../../supabase/functions/workflow-execute/engine.ts"
    );
    const warnDef = toEngineDef(ifElseNodes, [
      edge("t1", "c1"),
      edge("c1", "aSoft", "false"),
      edge("aSoft", "aFinal"),
      { ...edge("aFinal", "aEscalate"), sourceHandle: "true" },
    ]);
    const outcome = validateWorkflowDefinition(warnDef, { strict: false });
    expect(outcome.warnings.join(" ")).toContain("only meaningful from a condition node");
  });

  it("the condition node's output names the branch it took", async () => {
    const run = await executeWorkflowDefinition(toEngineDef(ifElseNodes, ifElseEdges), {
      context: HIGH_DEBT,
      actions: succeedAll,
    });
    const c1 = run.node_results.find((r) => r.node_id === "c1");
    expect((c1?.output as Record<string, unknown>)?.branch).toBe("true");
    const run2 = await executeWorkflowDefinition(toEngineDef(ifElseNodes, ifElseEdges), {
      context: LOW_DEBT,
      actions: succeedAll,
    });
    const c1b = run2.node_results.find((r) => r.node_id === "c1");
    expect((c1b?.output as Record<string, unknown>)?.branch).toBe("false");
  });
});
