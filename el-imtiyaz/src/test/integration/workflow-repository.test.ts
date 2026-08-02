/**
 * Integration tests for the workflow repository layer — plan §10.
 *
 * Verifies that the mock workflow + workflow-run repositories honor the
 * domain contracts: createWorkflow round-trips through observe(),
 * updateWorkflow preserves nodes/edges, deploy marks status, execute
 * validates DAG (cycle detection), retryRun creates a new run, and
 * observeByWorkflow filters correctly.
 */
import { describe, it, expect } from "vitest";
import {
  mockWorkflowRepository,
  mockWorkflowRunRepository,
  mockAuditRepository,
} from "../../infrastructure/mock/mock-repositories";
import { detectCycle } from "../../domain/kahn";
import type { Workflow, WorkflowNode, WorkflowEdge, WorkflowNodeType } from "../../domain/model/workflow";

const ACTOR_ID = "usr-adm-001";
const ACTOR_NAME = "Brahim Souilah";

function mkNode(id: string, type: WorkflowNodeType = "trigger", x = 60, y = 60): WorkflowNode {
  return { id, type, subtype: "manual_run", label: `Node ${id}`, position: { x, y }, config: {} };
}
function mkEdge(id: string, from: string, to: string): WorkflowEdge {
  return { id, from, to };
}

describe("MockWorkflowRepository — round-trip + lifecycle", () => {
  it("createWorkflow round-trips through observe()", async () => {
    const before = mockWorkflowRepository.observe().get().length;
    const r = await mockWorkflowRepository.createWorkflow({
      name: "Test workflow",
      description: "Round-trip test",
      triggerType: "manual",
      createdBy: ACTOR_ID,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.name).toBe("Test workflow");
      expect(r.value.status).toBe("draft");
      expect(r.value.nodes).toEqual([]);
      expect(r.value.lastDeployedAt).toBeNull();
    }
    const after = mockWorkflowRepository.observe().get().length;
    expect(after).toBe(before + 1);
  });

  it("updateWorkflow preserves nodes/edges", async () => {
    const createR = await mockWorkflowRepository.createWorkflow({
      name: "Nodes preserve test",
      description: "",
      triggerType: "manual",
      createdBy: ACTOR_ID,
    });
    if (!createR.ok) throw new Error("create failed");
    const id = createR.value.id;
    const nodes = [mkNode("n1"), mkNode("n2")];
    const edges = [mkEdge("e1", "n1", "n2")];
    const updateR = await mockWorkflowRepository.updateWorkflow(id, { nodes, edges }, ACTOR_ID);
    expect(updateR.ok).toBe(true);
    if (updateR.ok) {
      expect(updateR.value.nodes).toHaveLength(2);
      expect(updateR.value.edges).toHaveLength(1);
      expect(updateR.value.edges[0].from).toBe("n1");
      expect(updateR.value.edges[0].to).toBe("n2");
    }
    // Verify the change is persisted in the observable.
    const observed = mockWorkflowRepository.observe().get().find((w) => w.id === id);
    expect(observed?.nodes).toHaveLength(2);
  });

  it("deleteWorkflow removes the workflow from observe()", async () => {
    const createR = await mockWorkflowRepository.createWorkflow({
      name: "To delete",
      description: "",
      triggerType: "manual",
      createdBy: ACTOR_ID,
    });
    if (!createR.ok) throw new Error("create failed");
    const id = createR.value.id;
    const before = mockWorkflowRepository.observe().get().find((w) => w.id === id);
    expect(before).toBeDefined();
    const delR = await mockWorkflowRepository.deleteWorkflow(id);
    expect(delR.ok).toBe(true);
    const after = mockWorkflowRepository.observe().get().find((w) => w.id === id);
    expect(after).toBeUndefined();
  });

  it("deploy changes status to 'deployed' and sets lastDeployedAt", async () => {
    const createR = await mockWorkflowRepository.createWorkflow({
      name: "To deploy",
      description: "",
      triggerType: "manual",
      createdBy: ACTOR_ID,
    });
    if (!createR.ok) throw new Error("create failed");
    const id = createR.value.id;
    // Add at least one node so it's a "real" workflow.
    await mockWorkflowRepository.updateWorkflow(id, { nodes: [mkNode("n1")] }, ACTOR_ID);
    const deployR = await mockWorkflowRepository.deploy(id, ACTOR_ID);
    expect(deployR.ok).toBe(true);
    if (deployR.ok) {
      expect(deployR.value.status).toBe("deployed");
      expect(deployR.value.lastDeployedAt).not.toBeNull();
    }
  });

  it("execute on a cyclic workflow returns Err", async () => {
    const createR = await mockWorkflowRepository.createWorkflow({
      name: "Cyclic",
      description: "",
      triggerType: "manual",
      createdBy: ACTOR_ID,
    });
    if (!createR.ok) throw new Error("create failed");
    const id = createR.value.id;
    // a→b, b→a — 2-node cycle.
    const nodes = [mkNode("a"), mkNode("b", "action", 240)];
    const edges = [mkEdge("e1", "a", "b"), mkEdge("e2", "b", "a")];
    await mockWorkflowRepository.updateWorkflow(id, { nodes, edges }, ACTOR_ID);
    // Sanity: detectCycle independently confirms the cycle.
    const cycle = detectCycle(nodes, edges);
    expect(cycle.hasCycle).toBe(true);
    const execR = await mockWorkflowRepository.execute(id, ACTOR_ID, ACTOR_NAME);
    expect(execR.ok).toBe(false);
    if (!execR.ok) {
      expect(execR.error.code).toMatch(/VALIDATION/);
    }
  });

  it("execute on an acyclic workflow returns Ok and creates a WorkflowRun", async () => {
    const createR = await mockWorkflowRepository.createWorkflow({
      name: "Acyclic",
      description: "",
      triggerType: "manual",
      createdBy: ACTOR_ID,
    });
    if (!createR.ok) throw new Error("create failed");
    const id = createR.value.id;
    // a → b → c (linear, no cycle).
    const nodes = [
      mkNode("a", "trigger"),
      mkNode("b", "action", 240),
      mkNode("c", "action", 440),
    ];
    const edges = [mkEdge("e1", "a", "b"), mkEdge("e2", "b", "c")];
    await mockWorkflowRepository.updateWorkflow(id, { nodes, edges }, ACTOR_ID);
    const runsBefore = mockWorkflowRunRepository.observe().get().length;
    const execR = await mockWorkflowRepository.execute(id, ACTOR_ID, ACTOR_NAME);
    expect(execR.ok).toBe(true);
    if (execR.ok) {
      expect(execR.value.workflowId).toBe(id);
      expect(execR.value.nodeResults.length).toBeGreaterThan(0);
      // The new run should appear in the runs observable.
      const runsAfter = mockWorkflowRunRepository.observe().get().length;
      expect(runsAfter).toBe(runsBefore + 1);
    }
  });

  it("retryRun on a failed run creates a new run", async () => {
    // Find a non-running seeded run to retry.
    const seeded = mockWorkflowRunRepository.observe().get();
    const target = seeded.find((r) => r.status === "failed") ?? seeded[0];
    expect(target).toBeDefined();
    const before = mockWorkflowRunRepository.observe().get().length;
    const retryR = await mockWorkflowRunRepository.retryRun(target.id, ACTOR_ID, ACTOR_NAME);
    expect(retryR.ok).toBe(true);
    if (retryR.ok) {
      expect(retryR.value.id).not.toBe(target.id);
      const after = mockWorkflowRunRepository.observe().get().length;
      expect(after).toBe(before + 1);
    }
  });

  it("observeByWorkflow filters by workflowId", async () => {
    // The seed has 3 workflows; pick the first.
    const wf = mockWorkflowRepository.observe().get()[0];
    expect(wf).toBeDefined();
    const runs = mockWorkflowRunRepository.observeByWorkflow(wf.id).get();
    expect(runs.length).toBeGreaterThan(0);
    expect(runs.every((r) => r.workflowId === wf.id)).toBe(true);
  });

  it("deploy writes an audit log entry", async () => {
    const createR = await mockWorkflowRepository.createWorkflow({
      name: "Audit on deploy",
      description: "",
      triggerType: "manual",
      createdBy: ACTOR_ID,
    });
    if (!createR.ok) throw new Error("create failed");
    const id = createR.value.id;
    await mockWorkflowRepository.updateWorkflow(id, { nodes: [mkNode("n1")] }, ACTOR_ID);
    const auditBeforeR = await mockAuditRepository.query({});
    if (!auditBeforeR.ok) throw new Error("audit query failed");
    const auditBefore = auditBeforeR.value.entries.length;
    await mockWorkflowRepository.deploy(id, ACTOR_ID);
    const auditAfterR = await mockAuditRepository.query({});
    if (!auditAfterR.ok) throw new Error("audit query failed");
    const auditAfter = auditAfterR.value.entries.length;
    expect(auditAfter).toBeGreaterThan(auditBefore);
  });
});

describe("MockWorkflowRepository — execution semantics", () => {
  it("does not execute a disabled workflow", async () => {
    // wf-003 is seeded as disabled.
    const wf = mockWorkflowRepository.observe().get().find((w) => w.status === "disabled");
    expect(wf).toBeDefined();
    if (!wf) return;
    const r = await mockWorkflowRepository.execute(wf.id, ACTOR_ID, ACTOR_NAME);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toMatch(/CONFLICT/);
    }
  });

  it("returns Err when the workflow does not exist", async () => {
    const r = await mockWorkflowRepository.execute("wf-does-not-exist", ACTOR_ID, ACTOR_NAME);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toMatch(/NOT_FOUND/);
    }
  });
});
