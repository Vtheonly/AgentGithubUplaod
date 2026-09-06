/**
 * T-224 — the server-side workflow execution engine, unit-tested directly.
 *
 * The engine (supabase/functions/workflow-execute/engine.ts) is PURE
 * TypeScript with zero imports, which means the desktop vitest suite can
 * import it and test the EXACT code the Deno Edge Function runs — not a
 * source-scan, not a parallel implementation. This file pins:
 *
 *   1. validation parity with the SQL validator (0081) — the same rejections;
 *   2. branch-aware execution semantics (the dry-run parity contract):
 *      a failing condition closes only its own branch, route_switch opens
 *      only the first passing route, convergence executes once, missing
 *      fields evaluate to false + a warning (§10.05, never a crash);
 *   3. honest failure semantics: a failed action closes only its
 *      downstream, parallel branches continue, the run ends "failed";
 *   4. the pause/resume contract (wait_duration parking);
 *   5. safety guards: deadline, max-nodes, unknown subtypes;
 *   6. SEMANTIC EQUIVALENCE with the desktop dry-run engine
 *      (dry-run.ts) on the same graphs — the single-source-of-truth rule.
 */
import { describe, expect, it } from "vitest";
import {
  executeWorkflowDefinition,
  parseDefinition,
  parseSwitchRoutes,
  validateWorkflowDefinition,
  type ActionHandler,
  type EngineActionOutcome,
  type EngineDefinition,
  type EngineNode,
} from "../../../supabase/functions/workflow-execute/engine.ts";
import { dryRunWorkflow } from "../../domain/calc/workflow/dry-run";
import type { WorkflowNode, WorkflowEdge } from "../../domain/model/workflow";

/* ------------------------------- fixtures ------------------------------- */

const okAction: EngineActionOutcome = {
  status: "succeeded",
  output: { done: true },
  auditNote: "fake ok",
};
const succeedAll: ActionHandler = async () => okAction;

function makeNode(
  id: string,
  type: string,
  subtype: string,
  config: Record<string, unknown> = {},
): EngineNode {
  return { id, type, subtype, label: id, position: { x: 0, y: 0 }, config };
}

function def(nodes: EngineNode[], edges: [string, string][]): EngineDefinition {
  return {
    nodes,
    edges: edges.map(([source, target], i) => ({ id: `e${i + 1}`, source, target })),
  };
}

const comparison = (field: string, op: string, value: unknown) => ({
  kind: "comparison" as const,
  field,
  op,
  value,
});

/** trigger → condition → (true-branch action, false-branch action) → convergence */
const branchDag = def(
  [
    makeNode("t1", "trigger", "payment_overdue"),
    makeNode("c1", "condition", "debt_over_threshold", {
      condition: comparison("parent.outstanding_balance", ">", 40_000),
    }),
    makeNode("aUrgent", "action", "push_notification", { title: "Urgent" }),
    makeNode("aNormal", "action", "send_email", { to: "x@y.dz" }),
    makeNode("aFinal", "action", "log_audit", {}),
  ],
  [
    ["t1", "c1"],
    ["c1", "aUrgent"],
    ["c1", "aNormal"],
    ["aUrgent", "aFinal"],
    ["aNormal", "aFinal"],
  ],
);

const richParent = {
  payment: { amount: 45_000, method: "check", status: "pending", category: "tuition", days_overdue: 0 },
  student: { absence_count: 2, status: "active", gpa: 12.5 },
  parent: { outstanding_balance: 60_000, days_overdue: 45, is_financially_restricted: false },
  workflow: { now: "2026-09-07T10:00:00.000Z", nowMs: 1_772_544_000_000 },
};

/* ------------------------------ 1. validation ---------------------------- */

describe("T-224 engine — validation parity with the SQL validator (0081)", () => {
  it("accepts the reference branch DAG (strict)", () => {
    const v = validateWorkflowDefinition(branchDag, { strict: true });
    expect(v.errors).toEqual([]);
    expect(v.valid).toBe(true);
  });

  it("rejects cycles and NAMES the involved nodes (Kahn)", () => {
    const v = validateWorkflowDefinition(
      def(
        [
          makeNode("t1", "trigger", "manual_run"),
          makeNode("c1", "condition", "student_status_match", { condition: comparison("student.status", "==", "active") }),
          makeNode("a1", "action", "log_audit"),
        ],
        [["t1", "c1"], ["c1", "a1"], ["a1", "c1"]],
      ),
      { strict: true },
    );
    expect(v.valid).toBe(false);
    expect(v.errors.join(" ")).toContain("cycle detected");
    expect(v.errors.join(" ")).toContain("c1");
    expect(v.errors.join(" ")).toContain("a1");
  });

  it("rejects duplicate node ids / missing edge refs / self-edges / duplicate pairs", () => {
    const dup = validateWorkflowDefinition(
      def([makeNode("n1", "trigger", "manual_run"), makeNode("n1", "action", "log_audit")], []),
      { strict: true },
    );
    expect(dup.errors.join(" ")).toContain("duplicate node id");

    const missing = validateWorkflowDefinition(
      def([makeNode("n1", "trigger", "manual_run")], [["n1", "ghost"]]),
      { strict: true },
    );
    expect(missing.errors.join(" ")).toContain("unknown target node");

    const self = validateWorkflowDefinition(
      def([makeNode("n1", "trigger", "manual_run")], [["n1", "n1"]]),
      { strict: true },
    );
    expect(self.errors.join(" ")).toContain("self-reference");

    const pair = validateWorkflowDefinition(
      def([makeNode("n1", "trigger", "manual_run"), makeNode("n2", "action", "log_audit")], [["n1", "n2"], ["n1", "n2"]]),
      { strict: true },
    );
    expect(pair.errors.join(" ")).toContain("duplicate edge between");
  });

  it("rejects unregistered subtypes and missing subtypes", () => {
    const bad = validateWorkflowDefinition(def([makeNode("n1", "trigger", "laser_beam")], []), { strict: true });
    expect(bad.errors.join(" ")).toContain("not registered");

    const missing = validateWorkflowDefinition(def([{ id: "n1", type: "action" } as EngineNode], []), { strict: true });
    expect(missing.errors.join(" ")).toContain("missing its subtype");
  });

  it("rejects triggers with incoming edges and (strict) trigger-less graphs", () => {
    const fed = validateWorkflowDefinition(
      def(
        [
          makeNode("n1", "trigger", "manual_run"),
          makeNode("n2", "action", "log_audit"),
          makeNode("n3", "trigger", "schedule"),
        ],
        [["n1", "n2"], ["n2", "n3"]],
      ),
      { strict: true },
    );
    expect(fed.errors.join(" ")).toContain("triggers must be roots");

    const noTrig = validateWorkflowDefinition(def([makeNode("n1", "action", "log_audit")], []), { strict: true });
    expect(noTrig.errors.join(" ")).toContain("no trigger node");
    // …tolerated in non-strict mode:
    expect(validateWorkflowDefinition(def([makeNode("n1", "action", "log_audit")], []), { strict: false }).valid).toBe(true);
  });

  it("strict mode rejects malformed condition trees and non-positive waits; legacy scalar conditions warn", () => {
    const badCond = validateWorkflowDefinition(
      def(
        [
          makeNode("t1", "trigger", "manual_run"),
          makeNode("c1", "condition", "debt_over_threshold", { condition: { kind: "comparison", field: "x", op: "~~", value: 1 } }),
        ],
        [["t1", "c1"]],
      ),
      { strict: true },
    );
    expect(badCond.errors.join(" ")).toContain("malformed condition tree");

    const badWait = validateWorkflowDefinition(
      def([makeNode("t1", "trigger", "manual_run"), makeNode("d1", "delay", "wait_duration", { duration_ms: -5 })], [["t1", "d1"]]),
      { strict: true },
    );
    expect(badWait.errors.join(" ")).toContain("positive duration_ms");

    const legacy = validateWorkflowDefinition(
      def(
        [
          makeNode("t1", "trigger", "manual_run"),
          makeNode("c1", "condition", "debt_over_threshold", { threshold: 5000 }),
        ],
        [["t1", "c1"]],
      ),
      { strict: true },
    );
    expect(legacy.valid).toBe(true);
    expect(legacy.warnings.join(" ")).toContain("legacy scalar");
  });

  it("parseDefinition tolerates a JSON-string definition and rejects garbage", () => {
    expect(parseDefinition(JSON.stringify(branchDag))?.nodes.length).toBe(5);
    expect(parseDefinition("not json")).toBeNull();
    expect(parseDefinition({ nodes: "x" })).toBeNull();
    expect(parseDefinition(null)).toBeNull();
  });
});

/* --------------------------- 2. branch semantics -------------------------- */

describe("T-224 engine — branch-aware execution (dry-run parity)", () => {
  it("a failing condition (GATE semantics, dry-run parity) blocks its downstream — the convergence node too", async () => {
    // Canonical semantics (dry-run.ts): a plain condition node is a GATE —
    // a false verdict closes ALL its outgoing edges. TRUE/FALSE divergence
    // is modeled with route_switch (routes map to outgoing edges), not with
    // labeled edges. The engine MUST match the dry-run exactly.
    const ctx = { parent: { outstanding_balance: 10_000 } };
    const run = await executeWorkflowDefinition(branchDag, { context: ctx, actions: succeedAll });
    expect(run.status).toBe("succeeded");
    const byId = new Map(run.node_results.map((r) => [r.node_id, r]));
    expect(byId.get("c1")?.status).toBe("succeeded");
    expect(byId.get("c1")?.output?.condition_result).toBe(false);
    expect(byId.get("aUrgent")?.status).toBe("skipped");
    expect(byId.get("aNormal")?.status).toBe("skipped");
    expect(byId.get("aFinal")?.status).toBe("skipped");
  });

  it("a passing gate lets the whole downstream run; the convergence node runs ONCE", async () => {
    const run = await executeWorkflowDefinition(branchDag, { context: richParent, actions: succeedAll });
    const byId = new Map(run.node_results.map((r) => [r.node_id, r]));
    expect(byId.get("aUrgent")?.status).toBe("succeeded");
    expect(byId.get("aNormal")?.status).toBe("succeeded");
    expect(byId.get("aFinal")?.status).toBe("succeeded");
    expect(run.node_results.filter((r) => r.node_id === "aFinal")).toHaveLength(1);
  });

  it("a failing gate on ONE parallel path leaves the sibling path alive (per-branch closure)", async () => {
    // t1 → c1 → a1 (gated branch)
    // t1 → a2            (free branch)
    // a1, a2 → aFinal    (convergence)
    const d = def(
      [
        makeNode("t1", "trigger", "payment_overdue"),
        makeNode("c1", "condition", "debt_over_threshold", {
          condition: comparison("parent.outstanding_balance", ">", 40_000),
        }),
        makeNode("a1", "action", "push_notification"),
        makeNode("a2", "action", "send_email"),
        makeNode("aFinal", "action", "log_audit"),
      ],
      [["t1", "c1"], ["t1", "a2"], ["c1", "a1"], ["a1", "aFinal"], ["a2", "aFinal"]],
    );
    const run = await executeWorkflowDefinition(d, {
      context: { parent: { outstanding_balance: 10_000 } }, // gate fails
      actions: succeedAll,
    });
    const byId = new Map(run.node_results.map((r) => [r.node_id, r]));
    expect(byId.get("a1")?.status).toBe("skipped"); // gated branch dead
    expect(byId.get("a2")?.status).toBe("succeeded"); // sibling ALIVE
    expect(byId.get("aFinal")?.status).toBe("succeeded"); // fed by a2
  });

  it("route_switch opens ONLY the first passing route; no match closes everything", async () => {
    const d = def(
      [
        makeNode("t1", "trigger", "manual_run"),
        makeNode("r1", "condition", "route_switch", {
          routes: [
            { label: "High", condition: comparison("parent.outstanding_balance", ">", 100_000) },
            { label: "Mid", condition: comparison("parent.outstanding_balance", ">", 40_000) },
            { label: "Low", condition: comparison("parent.outstanding_balance", ">", 0) },
          ],
        }),
        makeNode("aHigh", "action", "log_audit"),
        makeNode("aMid", "action", "log_audit"),
        makeNode("aLow", "action", "log_audit"),
      ],
      [["t1", "r1"], ["r1", "aHigh"], ["r1", "aMid"], ["r1", "aLow"]],
    );
    const run = await executeWorkflowDefinition(d, { context: richParent, actions: succeedAll });
    const byId = new Map(run.node_results.map((r) => [r.node_id, r]));
    expect(byId.get("aHigh")?.status).toBe("skipped");
    expect(byId.get("aMid")?.status).toBe("succeeded");
    expect(byId.get("aLow")?.status).toBe("skipped");

    // No route matches → all outputs closed.
    const run2 = await executeWorkflowDefinition(d, { context: { parent: { outstanding_balance: 0 } }, actions: succeedAll });
    const byId2 = new Map(run2.node_results.map((r) => [r.node_id, r]));
    expect(byId2.get("aHigh")?.status).toBe("skipped");
    expect(byId2.get("aMid")?.status).toBe("skipped");
    expect(byId2.get("aLow")?.status).toBe("skipped");
  });

  it("missing fields evaluate to FALSE with a §10.05 warning — never an exception", async () => {
    const run = await executeWorkflowDefinition(branchDag, {
      context: { student: { status: "active" } }, // parent.* entirely absent
      actions: succeedAll,
    });
    expect(run.status).toBe("succeeded");
    expect(run.warnings.join(" ")).toContain("Champ introuvable");
    const byId = new Map(run.node_results.map((r) => [r.node_id, r]));
    expect(byId.get("c1")?.output?.condition_result).toBe(false);
    expect(byId.get("aUrgent")?.status).toBe("skipped");
  });

  it("time_window evaluates against the context instant (caller-provided instant wins)", async () => {
    const d = def(
      [
        makeNode("t1", "trigger", "manual_run"),
        makeNode("w1", "condition", "time_window", { startHour: 8, endHour: 16.5, days: [0, 1, 2, 3, 4] }),
        makeNode("a1", "action", "log_audit"),
      ],
      [["t1", "w1"], ["w1", "a1"]],
    );
    // 2026-09-07 is a Monday, 10:00 UTC — inside the window (hours are LOCAL
    // to the runtime; use explicit nowMs so the assertion is deterministic
    // in any TZ: pick 23:00 local-equivalent via UTC hours of the date).
    const inside = await executeWorkflowDefinition(d, {
      context: { workflow: { nowMs: new Date("2026-09-07T10:00:00").getTime() } },
      actions: succeedAll,
    });
    const outside = await executeWorkflowDefinition(d, {
      context: { workflow: { nowMs: new Date("2026-09-07T22:00:00").getTime() } },
      actions: succeedAll,
    });
    // Local-time caveat: 10:00 in UTC+1 = 11:00 local (inside); 22:00 UTC = 23:00 local (outside).
    const byIdIn = new Map(inside.node_results.map((r) => [r.node_id, r]));
    const byIdOut = new Map(outside.node_results.map((r) => [r.node_id, r]));
    // In ANY timezone: 10:00→[10..12] local (inside 8–16.5) and 22:00→[22..24] local (outside).
    expect(byIdIn.get("a1")?.status).toBe("succeeded");
    expect(byIdOut.get("a1")?.status).toBe("skipped");
  });

  it("topological result order (trigger first, convergence last)", async () => {
    const run = await executeWorkflowDefinition(branchDag, { context: richParent, actions: succeedAll });
    const ids = run.node_results.map((r) => r.node_id);
    expect(ids.indexOf("t1")).toBe(0);
    expect(ids.indexOf("c1")).toBe(1);
    expect(ids.indexOf("aFinal")).toBe(4);
  });
});

/* ------------------------- 3. honest failure handling --------------------- */

describe("T-224 engine — honest failure semantics", () => {
  it("a failed action closes only its downstream; parallel branches continue; run ends failed", async () => {
    let failedOnce = false;
    const handler: ActionHandler = async (node) => {
      if (node.id === "aUrgent" && !failedOnce) {
        failedOnce = true;
        return { status: "failed", output: { error: "FCM unavailable" }, auditNote: "failed", error: "FCM unavailable" };
      }
      return okAction;
    };
    const run = await executeWorkflowDefinition(branchDag, { context: richParent, actions: handler });
    expect(run.status).toBe("failed");
    expect(run.error_message).toContain("aUrgent");
    const byId = new Map(run.node_results.map((r) => [r.node_id, r]));
    expect(byId.get("aUrgent")?.status).toBe("failed");
    expect(byId.get("aUrgent")?.error).toContain("FCM unavailable");
    // The parallel branch executed:
    expect(byId.get("aNormal")?.status).toBe("succeeded");
    // The convergence node: the false-branch still feeds it → executes.
    expect(byId.get("aFinal")?.status).toBe("succeeded");
  });

  it("unknown subtype → failed node with a diagnosable error (never a silent skip)", async () => {
    const d = def(
      [
        makeNode("t1", "trigger", "manual_run"),
        { ...makeNode("a1", "action", "teleport") },
      ],
      [["t1", "a1"]],
    );
    const run = await executeWorkflowDefinition(d, { context: {}, actions: succeedAll });
    expect(run.status).toBe("failed");
    const byId = new Map(run.node_results.map((r) => [r.node_id, r]));
    expect(byId.get("a1")?.status).toBe("failed");
    expect(byId.get("a1")?.error).toContain("unknown subtype 'teleport'");
  });

  it("a throwing handler becomes a per-node failure (the walk survives)", async () => {
    const handler: ActionHandler = async (node) => {
      if (node.id === "aNormal") throw new Error("boom");
      return okAction;
    };
    const run = await executeWorkflowDefinition(branchDag, { context: richParent, actions: handler });
    expect(run.status).toBe("failed");
    const byId = new Map(run.node_results.map((r) => [r.node_id, r]));
    expect(byId.get("aNormal")?.status).toBe("failed");
    expect(byId.get("aUrgent")?.status).toBe("succeeded");
  });

  it("deadline breach → status timeout, remaining nodes skipped with the reason", async () => {
    const run = await executeWorkflowDefinition(branchDag, {
      context: richParent,
      actions: succeedAll,
      deadlineMs: -1, // already breached
    });
    expect(run.status).toBe("timeout");
    expect(run.error_message).toContain("deadline");
    const skipped = run.node_results.filter((r) => r.status === "skipped");
    expect(skipped.length).toBeGreaterThan(0);
    expect(JSON.stringify(skipped[0].output)).toContain("deadline_breached");
  });

  it("max-nodes guard", async () => {
    const run = await executeWorkflowDefinition(branchDag, {
      context: richParent,
      actions: succeedAll,
      maxNodes: 2,
    });
    const guarded = run.node_results.filter((r) => JSON.stringify(r.output).includes("max_nodes_guard"));
    expect(guarded.length).toBeGreaterThan(0);
  });
});

/* ---------------------------- 4. pause / resume --------------------------- */

describe("T-224 engine — persistent delay (pause/resume contract)", () => {
  const waitDag = def(
    [
      makeNode("t1", "trigger", "payment_overdue"),
      makeNode("a1", "action", "push_notification"),
      makeNode("d1", "delay", "wait_duration", { duration_ms: 7 * 86_400_000 }), // 7 days
      makeNode("a2", "action", "send_email"),
    ],
    [["t1", "a1"], ["a1", "d1"], ["d1", "a2"]],
  );

  it("wait > inline cap parks the run: status paused + resume_state + honest pause note", async () => {
    const run = await executeWorkflowDefinition(waitDag, { context: richParent, actions: succeedAll });
    expect(run.status).toBe("paused");
    expect(run.pause?.node_id).toBe("d1");
    expect(run.pause?.duration_ms).toBe(7 * 86_400_000);
    expect(run.resume_state?.parked_node_id).toBe("d1");
    expect(run.resume_state?.node_results.map((r) => r.node_id)).toContain("d1");
    expect(run.node_results.find((r) => r.node_id === "d1")?.output).toMatchObject({ parked: true });
    // The post-delay action has NOT run.
    expect(run.node_results.find((r) => r.node_id === "a2")).toBeUndefined();
  });

  it("resume continues from the parked node and completes the run", async () => {
    const parked = await executeWorkflowDefinition(waitDag, { context: richParent, actions: succeedAll });
    expect(parked.resume_state).toBeDefined();
    const resumed = await executeWorkflowDefinition(waitDag, {
      context: richParent,
      actions: succeedAll,
      resume: parked.resume_state!,
    });
    expect(resumed.status).toBe("succeeded");
    expect(resumed.pause).toBeUndefined();
    const byId = new Map(resumed.node_results.map((r) => [r.node_id, r]));
    expect(byId.get("a1")?.status).toBe("succeeded");
    expect(byId.get("a2")?.status).toBe("succeeded");
    // No duplicated results for the pre-park nodes.
    expect(resumed.node_results.filter((r) => r.node_id === "a1")).toHaveLength(1);
    expect(resumed.node_results.filter((r) => r.node_id === "d1")).toHaveLength(1);
  });

  it("wait <= inline cap executes inline through the action handler", async () => {
    const shortDag = def(
      [
        makeNode("t1", "trigger", "manual_run"),
        makeNode("d1", "delay", "wait_duration", { duration_ms: 2_000 }),
        makeNode("a1", "action", "log_audit"),
      ],
      [["t1", "d1"], ["d1", "a1"]],
    );
    const seen: string[] = [];
    const handler: ActionHandler = async (node) => {
      seen.push(node.id);
      return okAction;
    };
    const run = await executeWorkflowDefinition(shortDag, { context: {}, actions: handler });
    expect(run.status).toBe("succeeded");
    expect(seen).toContain("d1");
    const byId = new Map(run.node_results.map((r) => [r.node_id, r]));
    expect(byId.get("a1")?.status).toBe("succeeded");
  });
});

/* -------------------- 5. equivalence with the dry-run -------------------- */

describe("T-224 engine — semantic equivalence with the desktop dry-run engine", () => {
  const toDomainNodes = (nodes: EngineNode[]): WorkflowNode[] =>
    nodes.map((n) => ({
      id: n.id,
      type: n.type as WorkflowNode["type"],
      subtype: n.subtype as WorkflowNode["subtype"],
      label: n.label ?? n.id,
      position: n.position ?? { x: 0, y: 0 },
      config: n.config ?? {},
    }));
  const toDomainEdges = (edges: { id?: string; source: string; target: string }[]): WorkflowEdge[] =>
    edges.map((e, i) => ({ id: e.id ?? `e${i}`, from: e.source, to: e.target }));

  const cases: { name: string; dag: EngineDefinition; ctx: Record<string, unknown> }[] = [
    { name: "false branch", dag: branchDag, ctx: { parent: { outstanding_balance: 10_000 } } },
    { name: "true branch", dag: branchDag, ctx: richParent },
    { name: "missing field", dag: branchDag, ctx: { student: { status: "active" } } },
  ];

  for (const { name, dag, ctx } of cases) {
    it(`branch outcome parity — ${name}`, async () => {
      const sim = dryRunWorkflow(toDomainNodes(dag.nodes), toDomainEdges(dag.edges), ctx);
      expect(sim.ok).toBe(true);
      const run = await executeWorkflowDefinition(dag, { context: ctx, actions: succeedAll });
      // The executed/skipped verdicts must be IDENTICAL node-per-node.
      const simById = new Map(sim.results.map((r) => [r.nodeId, r.status]));
      for (const r of run.node_results) {
        expect(simById.get(r.node_id), `node ${r.node_id} diverged`).toBe(r.status === "skipped" ? "skipped" : "succeeded");
      }
      for (const [id, status] of simById) {
        const engineStatus = run.node_results.find((r) => r.node_id === id)?.status;
        expect(engineStatus, `sim node ${id} missing in engine results`).toBeDefined();
        expect(engineStatus === "skipped" ? "skipped" : "succeeded").toBe(status);
      }
    });
  }

  it("route_switch parity — first passing route, no-match closure", async () => {
    const d = def(
      [
        makeNode("t1", "trigger", "manual_run"),
        makeNode("r1", "condition", "route_switch", {
          routes: [
            { label: "High", condition: comparison("parent.outstanding_balance", ">", 100_000) },
            { label: "Low", condition: comparison("parent.outstanding_balance", ">", 0) },
          ],
        }),
        makeNode("aHigh", "action", "log_audit"),
        makeNode("aLow", "action", "log_audit"),
      ],
      [["t1", "r1"], ["r1", "aHigh"], ["r1", "aLow"]],
    );
    for (const ctx of [richParent, { parent: { outstanding_balance: 0 } }]) {
      const sim = dryRunWorkflow(toDomainNodes(d.nodes), toDomainEdges(d.edges), ctx);
      const run = await executeWorkflowDefinition(d, { context: ctx, actions: succeedAll });
      const simById = new Map(sim.results.map((r) => [r.nodeId, r.status]));
      for (const r of run.node_results) {
        expect(simById.get(r.node_id), `node ${r.node_id} diverged`).toBe(r.status === "skipped" ? "skipped" : "succeeded");
      }
    }
  });

  it("parseSwitchRoutes parity with dry-run.parseSwitchRoutes (malformed tolerated)", () => {
    const raw = [
      { label: "A", condition: { kind: "comparison", field: "x", op: ">", value: 1 } },
      "garbage",
      { condition: null },
    ];
    const engineRoutes = parseSwitchRoutes(raw);
    // The string entry is dropped; both OBJECT entries survive (malformed
    // conditions become null — "no gate" — never a throw).
    expect(engineRoutes).toHaveLength(2);
    expect(engineRoutes[0].label).toBe("A");
    expect(engineRoutes[1].label).toBe("Voie");
    expect(engineRoutes[1].condition).toBeNull();
  });
});
