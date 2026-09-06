/**
 * T-230 — desktop UX wiring to the REAL server pipeline:
 *   1. the domain contract `WorkflowRepository.dryRun` (server dry-run);
 *   2. the mock implementation (local engine → server-dry-run shape);
 *   3. the Supabase implementation (the EF dry_run invocation + mapping);
 *   4. the page/canvas wiring (Exécuter + Test serveur, published-only
 *      gating, honest server-failure rings);
 *   5. the DryRunNodeResult "failed" status (server failures are never
 *      disguised as skips).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mockWorkflowRepository } from "../../infrastructure/mock/repositories/workflow-repository";
import { store } from "../../infrastructure/mock/repositories/mock-store";
import type { WorkflowNode } from "../../domain/model/workflow";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DESKTOP_ROOT = join(__dirname, "..", "..", "..");
const read = (rel: string): string => readFileSync(join(DESKTOP_ROOT, rel), "utf8");

const ACTOR = { id: "usr-test-t230", name: "T-230 Test" };

function node(id: string, type: WorkflowNode["type"], subtype: WorkflowNode["subtype"], config: Record<string, unknown> = {}): WorkflowNode {
  return { id, type, subtype, label: id, position: { x: 0, y: 0 }, config };
}

async function makeWorkflow(nodes: WorkflowNode[], edges: { from: string; to: string }[]): Promise<string> {
  const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const created = await mockWorkflowRepository.createWorkflow({
    name: `T-230 dry-run ${suffix}`,
    description: "server dry-run contract probe",
    triggerType: "manual",
    createdBy: ACTOR.id,
  });
  if (!created.ok) throw new Error(created.error.userMessage);
  const seeded = await mockWorkflowRepository.updateWorkflow(
    created.value.id,
    { nodes, edges: edges.map((e) => ({ id: `e-${e.from}-${e.to}`, ...e })) },
    ACTOR.id,
  );
  if (!seeded.ok) throw new Error(seeded.error.userMessage);
  return created.value.id;
}

describe("T-230 — mock dryRun (local engine → server-dry-run contract)", () => {
  it("returns the simulated path with statuses, outputs and taken edges", async () => {
    const id = await makeWorkflow(
      [
        node("t1", "trigger", "payment_overdue"),
        node("c1", "condition", "debt_over_threshold", {
          condition: { kind: "comparison", field: "debt.amount", op: ">", value: 1_000_000 },
        }),
        node("a1", "action", "log_audit", {}),
      ],
      [{ from: "t1", to: "c1" }, { from: "c1", to: "a1" }],
    );
    const r = await mockWorkflowRepository.dryRun(id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.status).toBe("succeeded");
    expect(r.value.workflowId).toBe(id);
    // debt.amount (60 000) > 1 000 000 is FALSE → a1 skipped.
    const a1 = r.value.nodeOutcomes.find((o) => o.nodeId === "a1");
    expect(a1?.status).toBe("skipped");
    // No run row was created (dry runs never pollute the history).
    expect(store.workflowRuns.some((run) => run.workflowId === id)).toBe(false);
  });

  it("rejects an unknown workflow", async () => {
    const r = await mockWorkflowRepository.dryRun("wf-does-not-exist");
    expect(r.ok).toBe(false);
  });
});

describe("T-230 — source wiring (page + canvas + supabase contract)", () => {
  it("the domain contract declares dryRun(entity?)", () => {
    const contract = read("src/domain/repository/repository.ts");
    expect(contract).toContain("dryRun(");
    expect(contract).toContain("entity?: { parentId?: string; studentId?: string }");
  });

  it("the Supabase repository invokes the EF with dry_run and maps the payload", () => {
    const repo = read("src/infrastructure/supabase/repositories/supabase-workflow-repository.ts");
    expect(repo).toContain('functions.invoke("workflow-execute"');
    expect(repo).toContain("dry_run: true");
    expect(repo).toContain("parent_id: entity.parentId");
    expect(repo).toContain("node_results");
    expect(repo).toContain("taken_edge_keys");
  });

  it("the page gates Exécuter + Test serveur to PUBLISHED workflows and passes entities", () => {
    const page = read("src/features/workflow/workflow-page.tsx");
    expect(page).toContain('selected.status === "deployed" ? handleExecute : undefined');
    expect(page).toContain('selected.status === "deployed" ? handleServerDryRun : undefined');
    expect(page).toContain("serverDryRunEntities");
    expect(page).toContain("repos.workflows.execute(selected.id, session.userId, session.displayName)");
  });

  it("the canvas renders the Exécuter + Test serveur controls and honest failure rings", () => {
    const canvas = read("src/features/workflow/dag-canvas.tsx");
    expect(canvas).toContain("Exécuter");
    expect(canvas).toContain("Test serveur");
    expect(canvas).toContain("handleServerDryRun");
    expect(canvas).toContain("handleExecute");
    // Failed server nodes render a DANGER ring — never disguised as skips.
    expect(canvas).toContain('runStatus === "failed"');
    expect(canvas).toContain("stroke-status-danger");
  });

  it("DryRunNodeResult carries the server-failure status (documented)", () => {
    const engine = read("src/domain/calc/workflow/dry-run.ts");
    expect(engine).toContain('"succeeded" | "skipped" | "failed"');
    expect(engine).toContain("the LOCAL simulator never emits it");
  });

  it("i18n keys exist (fr + ar)", () => {
    expect(read("src/i18n/fr.ts")).toContain('execute: "Exécuter"');
    expect(read("src/i18n/ar.ts")).toContain("execute:");
  });
});
