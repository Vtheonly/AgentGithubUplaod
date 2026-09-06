/**
 * T-221 — pre-built educational workflow templates
 * (domain/calc/workflow/templates).
 *
 * Pins the one-click starter recipes:
 *   - exactly the 3 owner-specified templates ship;
 *   - each is acyclic, edge-complete, has ≥1 trigger, and its condition
 *     configs parse via the canonical parser;
 *   - each template's condition actually evaluates against the default
 *     context (the recipes' branch decisions are meaningful, not decorative);
 *   - instantiation produces unique ids across repeated calls and preserves
 *     the structure;
 *   - templateIsValid guards the picker.
 */
import { describe, expect, it } from "vitest";
import {
  WORKFLOW_TEMPLATES,
  instantiateTemplate,
  templateIsValid,
} from "../../../domain/calc/workflow/templates";
import { defaultConditionContext, evaluateConditionTree, parseConditionConfig } from "../../../domain/calc/workflow/condition-evaluator";
import { dryRunWorkflow } from "../../../domain/calc/workflow/dry-run";
import { detectCycle } from "../../../domain/kahn";
import type { WorkflowNode } from "../../../domain/model/workflow";

const ctx = defaultConditionContext();

describe("WORKFLOW_TEMPLATES registry (T-221)", () => {
  it("ships exactly the three owner-specified recipes", () => {
    expect(WORKFLOW_TEMPLATES.map((t) => t.id)).toEqual([
      "relance-impayes-echelonne",
      "alerte-assiduite-retards",
      "cloture-trimestrielle",
    ]);
  });

  for (const template of WORKFLOW_TEMPLATES) {
    describe(`template « ${template.name} »`, () => {
      const { nodes, edges } = template.build();

      it("is acyclic (Kahn)", () => {
        expect(detectCycle(nodes, edges).hasCycle).toBe(false);
      });

      it("has at least one trigger", () => {
        expect(nodes.some((n) => n.type === "trigger")).toBe(true);
      });

      it("every edge references existing nodes", () => {
        const ids = new Set(nodes.map((n) => n.id));
        for (const e of edges) {
          expect(ids.has(e.from)).toBe(true);
          expect(ids.has(e.to)).toBe(true);
        }
      });

      it("condition configs parse via the canonical parser", () => {
        for (const n of nodes) {
          if (n.config.condition !== undefined) {
            expect(parseConditionConfig(n.config.condition)).not.toBeNull();
          }
        }
      });

      it("dry-runs green with at least one taken edge", () => {
        const r = dryRunWorkflow(nodes, edges, ctx);
        expect(r.ok).toBe(true);
        expect(r.takenEdgeKeys.length).toBeGreaterThan(0);
      });

      it("templateIsValid → ok", () => {
        const v = templateIsValid(template);
        expect(v.ok).toBe(true);
      });
    });
  }
});

describe("template branch decisions are meaningful (T-221)", () => {
  it("relance: debt>40k passes against the default context (60k) and actions run", () => {
    const { nodes, edges } = WORKFLOW_TEMPLATES[0].build();
    const debtCondition = nodes.find((n) => n.subtype === "debt_over_threshold")!;
    const tree = parseConditionConfig(debtCondition.config.condition);
    expect(evaluateConditionTree(tree, ctx).passed).toBe(true);
    const r = dryRunWorkflow(nodes, edges, ctx);
    // The escalation branch (WhatsApp + restriction + task) runs.
    const actions = r.results.filter((x) => x.status === "succeeded" && x.type === "action");
    expect(actions.length).toBeGreaterThanOrEqual(2);
  });

  it("assiduité: time window passes on a school-hour instant", () => {
    const { nodes, edges } = WORKFLOW_TEMPLATES[1].build();
    const wednesday10h = { ...ctx, workflow: { now: new Date(2026, 8, 9, 10, 0, 0).toISOString(), nowMs: new Date(2026, 8, 9, 10, 0, 0).getTime() } };
    const r = dryRunWorkflow(nodes, edges, wednesday10h);
    expect(r.ok).toBe(true);
    const alert = r.results.find((x) => x.subtype === "push_notification");
    expect(alert?.status).toBe("succeeded");
  });

  it("clôture: student_status_match passes for the active default student", () => {
    const { nodes } = WORKFLOW_TEMPLATES[2].build();
    const check = nodes.find((n) => n.subtype === "student_status_match")!;
    const tree = parseConditionConfig(check.config.condition);
    expect(evaluateConditionTree(tree, ctx).passed).toBe(true);
  });
});

describe("instantiateTemplate (T-221)", () => {
  it("two instantiations produce disjoint node ids but identical structure", () => {
    const a = instantiateTemplate(WORKFLOW_TEMPLATES[0]);
    const b = instantiateTemplate(WORKFLOW_TEMPLATES[0]);
    const idsA = new Set(a.nodes.map((n) => n.id));
    const idsB = new Set(b.nodes.map((n) => n.id));
    for (const id of idsB) expect(idsA.has(id)).toBe(false);
    expect(a.nodes.map((n) => n.subtype)).toEqual(b.nodes.map((n) => n.subtype));
    expect(a.edges.length).toBe(b.edges.length);
  });

  it("instantiated edges reference the RE-MAPPED node ids", () => {
    const { nodes, edges } = instantiateTemplate(WORKFLOW_TEMPLATES[1]);
    const ids = new Set(nodes.map((n) => n.id));
    for (const e of edges) {
      expect(ids.has(e.from)).toBe(true);
      expect(ids.has(e.to)).toBe(true);
    }
  });

  it("instantiated graph is acyclic and dry-runs green", () => {
    for (const template of WORKFLOW_TEMPLATES) {
      const { nodes, edges } = instantiateTemplate(template);
      expect(detectCycle(nodes, edges).hasCycle).toBe(false);
      const r = dryRunWorkflow(nodes, edges, ctx);
      expect(r.ok).toBe(true);
    }
  });
});

describe("templateIsValid guards (T-221)", () => {
  it("rejects a template with no trigger", () => {
    const broken = {
      id: "broken",
      name: "Broken",
      description: "",
      triggerType: "manual" as const,
      build: () => ({
        nodes: [{ id: "a", type: "action", subtype: "log_audit", label: "a", position: { x: 0, y: 0 }, config: {} } as WorkflowNode],
        edges: [],
      }),
    };
    expect(templateIsValid(broken).ok).toBe(false);
  });

  it("rejects a template with an orphan edge", () => {
    const broken = {
      id: "orphan",
      name: "Orphan",
      description: "",
      triggerType: "manual" as const,
      build: () => ({
        nodes: [{ id: "a", type: "trigger", subtype: "manual_run", label: "a", position: { x: 0, y: 0 }, config: {} } as WorkflowNode],
        edges: [{ id: "e1", from: "a", to: "ghost" }],
      }),
    };
    expect(templateIsValid(broken).ok).toBe(false);
  });
});
