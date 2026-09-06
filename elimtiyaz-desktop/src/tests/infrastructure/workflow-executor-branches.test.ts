/**
 * T-221 — MockWorkflowRepository.execute branch semantics.
 *
 * The executor was upgraded from a linear node-array walk with a single
 * global `conditionFailed` flag to a topological traversal that reuses the
 * dry-run engine. These tests pin the new behaviour through the REAL
 * repository (run records + audit trail included):
 *   - a failing condition skips only its own downstream branch;
 *   - a parallel branch keeps executing (the old executor couldn't);
 *   - a passing condition lets the branch run;
 *   - the run record lists nodes in topological order with skipped rows.
 *
 * Node ids are chosen so the 90% action-failure hash never fires in the
 * happy paths ("n-a-*" → 110+97=207, 207 % 10 = 7).
 */
import { describe, expect, it } from "vitest";
import { mockWorkflowRepository } from "../../infrastructure/mock/repositories/workflow-repository";
import { store } from "../../infrastructure/mock/repositories/mock-store";
import type { WorkflowNode, WorkflowEdge } from "../../domain/model/workflow";

const ACTOR = { id: "usr-test-t221", name: "T-221 Test" };

function node(id: string, type: WorkflowNode["type"], subtype: WorkflowNode["subtype"], config: Record<string, unknown> = {}): WorkflowNode {
  return { id, type, subtype, label: id, position: { x: 0, y: 0 }, config };
}

function edge(from: string, to: string): WorkflowEdge {
  return { id: `e-${from}-${to}`, from, to };
}

async function makeWorkflow(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): Promise<string> {
  const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const created = await mockWorkflowRepository.createWorkflow({
    name: `T-221 executor ${suffix}`,
    description: "branch semantics probe",
    triggerType: "manual",
    createdBy: ACTOR.id,
  });
  if (!created.ok) throw new Error(created.error.userMessage);
  const seeded = await mockWorkflowRepository.updateWorkflow(
    created.value.id,
    { nodes, edges },
    ACTOR.id,
  );
  if (!seeded.ok) throw new Error(seeded.error.userMessage);
  return created.value.id;
}

describe("MockWorkflowRepository.execute — branch-aware execution (T-221)", () => {
  it("failing condition skips its branch; the parallel branch still runs", async () => {
    // debt.amount = 60 000 in the default context → > 1 000 000 is FALSE.
    const nodes = [
      node("n-t-1", "trigger", "payment_overdue", { grace_days: 7 }),
      node("n-c-1", "condition", "debt_over_threshold", {
        condition: { kind: "comparison", field: "debt.amount", op: ">", value: 1_000_000 },
      }),
      node("n-a-1", "action", "send_whatsapp", { template: "x" }), // gated by the failing condition
      node("n-a-2", "action", "log_audit"), // direct branch from the trigger
    ];
    const edges = [
      edge("n-t-1", "n-c-1"),
      edge("n-c-1", "n-a-1"),
      edge("n-t-1", "n-a-2"),
    ];
    const id = await makeWorkflow(nodes, edges);
    const r = await mockWorkflowRepository.execute(id, ACTOR.id, ACTOR.name);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // Overall: succeeded (a closed branch is NOT a failure).
    expect(r.value.status).toBe("succeeded");

    const byId = new Map(r.value.nodeResults.map((x) => [x.nodeId, x]));
    expect(byId.get("n-t-1")?.status).toBe("succeeded");
    expect(byId.get("n-c-1")?.status).toBe("succeeded");
    expect(byId.get("n-a-1")?.status).toBe("skipped");
    expect(byId.get("n-a-2")?.status).toBe("succeeded");

    // The skipped row carries the explanatory output.
    expect(byId.get("n-a-1")?.output?.toLowerCase()).toContain("branche");
  });

  it("passing condition lets the downstream action run", async () => {
    const nodes = [
      node("n-t-2", "trigger", "payment_overdue"),
      node("n-c-2", "condition", "debt_over_threshold", {
        condition: { kind: "comparison", field: "debt.amount", op: ">", value: 50_000 },
      }),
      node("n-a-3", "action", "push_notification", { title: "Relance" }),
    ];
    const edges = [edge("n-t-2", "n-c-2"), edge("n-c-2", "n-a-3")];
    const id = await makeWorkflow(nodes, edges);
    const r = await mockWorkflowRepository.execute(id, ACTOR.id, ACTOR.name);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.status).toBe("succeeded");
    const byId = new Map(r.value.nodeResults.map((x) => [x.nodeId, x]));
    expect(byId.get("n-c-2")?.status).toBe("succeeded");
    expect(byId.get("n-a-3")?.status).toBe("succeeded");
    expect(byId.get("n-a-3")?.output).toContain("simulé");
  });

  it("topological order: the run record follows dependency order, not array order", async () => {
    // Deliberately list nodes OUT of dependency order.
    const nodes = [
      node("n-a-4", "action", "log_audit"),
      node("n-c-3", "condition", "student_status_match", {
        condition: { kind: "comparison", field: "student.status", op: "==", value: "active" },
      }),
      node("n-t-3", "trigger", "manual_run"),
    ];
    const edges = [edge("n-t-3", "n-c-3"), edge("n-c-3", "n-a-4")];
    const id = await makeWorkflow(nodes, edges);
    const r = await mockWorkflowRepository.execute(id, ACTOR.id, ACTOR.name);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.nodeResults.map((x) => x.nodeId)).toEqual([
      "n-t-3",
      "n-c-3",
      "n-a-4",
    ]);
  });

  it("the run lands in the observable run log with its workflow name", async () => {
    const nodes = [node("n-t-4", "trigger", "manual_run")];
    const id = await makeWorkflow(nodes, []);
    const r = await mockWorkflowRepository.execute(id, ACTOR.id, ACTOR.name);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const persisted = store.workflowRuns.find((x) => x.id === r.value.id);
    expect(persisted).toBeDefined();
    expect(persisted?.actorName).toBe(ACTOR.name);
    expect(persisted?.workflowId).toBe(id);
  });
});
