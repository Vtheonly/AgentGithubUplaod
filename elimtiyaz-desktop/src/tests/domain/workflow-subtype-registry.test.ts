/**
 * T-221 — workflow node-subtype registry completeness guard.
 *
 * The 33rd session nearly tripled the subtype surface (29 subtypes across
 * 5 types). Every subtype MUST carry: a French label, a French description,
 * a type mapping, and a palette entry under that mapped type — otherwise
 * the palette, the canvas, the inspector or the run-detail drawer silently
 * render raw enum keys. This guard fails the suite on the first hole.
 */
import { describe, expect, it } from "vitest";
import {
  NODE_SUBTYPES_BY_TYPE,
  NODE_SUBTYPE_DESCRIPTIONS_FR,
  NODE_SUBTYPE_TO_TYPE,
  WORKFLOW_NODE_SUBTYPE_LABELS_FR,
  WORKFLOW_NODE_TYPE_COLORS,
  WORKFLOW_NODE_TYPE_LABELS_FR,
  NODE_SUBTYPE_DESCRIPTIONS_FR as DESCRIPTIONS,
  type WorkflowNodeSubtype,
  type WorkflowNodeType,
} from "../../domain/model/workflow";

/** The full subtype union, materialised from the palette grouping. */
const ALL_SUBTYPES: readonly WorkflowNodeSubtype[] = Object.values(
  NODE_SUBTYPES_BY_TYPE,
).flat() as readonly WorkflowNodeSubtype[];

const ALL_TYPES: readonly WorkflowNodeType[] = [
  "trigger",
  "condition",
  "action",
  "delay",
  "transform",
];

describe("workflow subtype registry completeness (T-221)", () => {
  it("every palette subtype has a label", () => {
    for (const subtype of ALL_SUBTYPES) {
      expect(WORKFLOW_NODE_SUBTYPE_LABELS_FR[subtype], `label missing for ${subtype}`).toBeTruthy();
    }
  });

  it("every palette subtype has a description", () => {
    for (const subtype of ALL_SUBTYPES) {
      expect(DESCRIPTIONS[subtype], `description missing for ${subtype}`).toBeTruthy();
    }
  });

  it("every palette subtype has a type mapping consistent with its palette group", () => {
    for (const [type, subtypes] of Object.entries(NODE_SUBTYPES_BY_TYPE) as [
      WorkflowNodeType,
      WorkflowNodeSubtype[],
    ][]) {
      for (const subtype of subtypes) {
        expect(NODE_SUBTYPE_TO_TYPE[subtype], `type mapping missing for ${subtype}`).toBe(type);
      }
    }
  });

  it("label / description / mapping maps cover EXACTLY the palette union (no strays)", () => {
    const palette = new Set<string>(ALL_SUBTYPES);
    for (const key of Object.keys(WORKFLOW_NODE_SUBTYPE_LABELS_FR)) {
      expect(palette.has(key as WorkflowNodeSubtype), `label stray: ${key}`).toBe(true);
    }
    for (const key of Object.keys(NODE_SUBTYPE_DESCRIPTIONS_FR)) {
      expect(palette.has(key as WorkflowNodeSubtype), `description stray: ${key}`).toBe(true);
    }
    for (const key of Object.keys(NODE_SUBTYPE_TO_TYPE)) {
      expect(palette.has(key as WorkflowNodeSubtype), `mapping stray: ${key}`).toBe(true);
    }
  });

  it("the palette union has no duplicates", () => {
    expect(new Set(ALL_SUBTYPES).size).toBe(ALL_SUBTYPES.length);
  });

  it("all 5 node types have labels and canvas colors", () => {
    for (const type of ALL_TYPES) {
      expect(WORKFLOW_NODE_TYPE_LABELS_FR[type], `type label missing for ${type}`).toBeTruthy();
      expect(WORKFLOW_NODE_TYPE_COLORS[type], `type colors missing for ${type}`).toBeTruthy();
      expect(NODE_SUBTYPES_BY_TYPE[type].length, `palette group empty for ${type}`).toBeGreaterThan(0);
    }
  });

  it("the T-221 expansion is present (spot-check the new subtypes)", () => {
    const expected: readonly WorkflowNodeSubtype[] = [
      "grade_below_threshold",
      "payment_cleared_or_bounced",
      "document_expiration",
      "calendar_cron_event",
      "stock_level_critical",
      "time_window",
      "route_switch",
      "send_whatsapp",
      "restrict_account",
      "dispatch_task",
      "generate_document",
      "account_adjustment",
    ];
    const palette = new Set<string>(ALL_SUBTYPES);
    for (const subtype of expected) {
      expect(palette.has(subtype), `${subtype} missing from the palette`).toBe(true);
    }
  });
});
