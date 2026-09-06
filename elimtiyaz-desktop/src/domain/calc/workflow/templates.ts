/**
 * Pre-built educational workflow templates — T-221 (owner mandate: one-click
 * starter recipes for the school's multi-step business protocols).
 *
 * Three templates (owner's spec, §Part 2.3):
 *   1. "Pack Relance Impayés Échelonné"  — overdue installments → 3-stage
 *      reminder escalation (soft push → WhatsApp + delinquent flag →
 *      finance-officer task).
 *   2. "Alerte Assiduité & Retards"      — 3+ unexcused absences → parent
 *      alert + supervisor review task.
 *   3. "Clôture Trimestrielle"           — end-of-term cron → query grades →
 *      compile bulletins → notify parents.
 *
 * Every template is acyclic BY CONSTRUCTION (edges only point forward in
 * node-array order) — verified by the workflow-templates test suite, which
 * also pins: edges reference existing node ids, each template has ≥ 1
 * trigger, and the condition trees parse via `parseConditionConfig`.
 */
import {
  NODE_SUBTYPE_TO_TYPE,
  WORKFLOW_NODE_SUBTYPE_LABELS_FR,
  type WorkflowNode,
  type WorkflowEdge,
  type WorkflowNodeSubtype,
  type WorkflowTriggerType,
} from "../../model/workflow";
import { parseConditionConfig, type ConditionNode } from "./condition-evaluator";
import { detectCycle } from "../../kahn";

export interface WorkflowTemplate {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly triggerType: WorkflowTriggerType;
  /** Build the nodes + edges (ids suffixed to stay unique per instantiation). */
  readonly build: () => { nodes: WorkflowNode[]; edges: WorkflowEdge[] };
}

/* ------------------------------------------------------------------ */
/*  Builder helpers                                                    */
/* ------------------------------------------------------------------ */

let instanceCounter = 0;
/** Disambiguator for instantiateTemplate — monotonic + random so two
 * instantiations inside the same millisecond can never collide. */
let instantiateCounter = 0;

function makeNode(
  subtype: WorkflowNodeSubtype,
  label: string,
  x: number,
  y: number,
  config: Record<string, unknown> = {},
): WorkflowNode {
  instanceCounter += 1;
  return {
    id: `tpl-${subtype}-${instanceCounter}`,
    type: NODE_SUBTYPE_TO_TYPE[subtype],
    subtype,
    label,
    position: { x, y },
    config,
  };
}

function makeEdge(from: string, to: string): WorkflowEdge {
  return { id: `tpl-e-${from}-${to}`, from, to };
}

/** Comparison leaf helper (visual-predicate-builder output shape). */
function cmp(field: string, op: ">" | "<" | ">=" | "<=" | "==" | "!=", value: number | string): ConditionNode {
  return { kind: "comparison", field, op, value };
}

/* ------------------------------------------------------------------ */
/*  Template 1 — Pack Relance Impayés Échelonné                        */
/* ------------------------------------------------------------------ */

const overdueCollection: WorkflowTemplate = {
  id: "relance-impayes-echelonne",
  name: "Pack Relance Impayés Échelonné",
  description:
    "Tranche impayée 7 jours après échéance : rappel doux portail ; si la dette dépasse 40 000 DZD, préparation WhatsApp + compte marqué délinquant + tâche urgente pour le responsable financier.",
  triggerType: "automatic",
  build: () => {
    instanceCounter = 0;
    const trigger = makeNode(
      "payment_overdue",
      "Tranche impayée (+7 j)",
      60,
      140,
      { grace_days: 7 },
    );
    const debt = makeNode(
      "debt_over_threshold",
      "Dette > 40 000 DZD ?",
      320,
      140,
      {
        condition: cmp("debt.amount", ">", 40_000),
      },
    );
    const soft = makeNode(
      "push_notification",
      "Rappel doux portail",
      320,
      340,
      {
        title: "Rappel de paiement",
        body: "Une échéance est dépassée. Merci de régulariser votre situation.",
        recipient_role: "parent",
      },
    );
    const whatsapp = makeNode(
      "send_whatsapp",
      "Message WhatsApp parent",
      580,
      60,
      {
        template:
          "Bonjour, votre solde dû atteint {{debt.amount}} DZD. Merci de contacter l'administration.",
      },
    );
    const restrict = makeNode(
      "restrict_account",
      "Marquer délinquant",
      580,
      220,
      { days_overdue: 30 },
    );
    const task = makeNode(
      "dispatch_task",
      "Tâche — responsable financier",
      840,
      140,
      {
        title: "Appeler la famille (créance élevée)",
        assignee_role: "finance_officer",
        priority: "urgent",
      },
    );
    const nodes = [trigger, debt, soft, whatsapp, restrict, task];
    const edges = [
      makeEdge(trigger.id, debt.id),
      makeEdge(trigger.id, soft.id),
      makeEdge(debt.id, whatsapp.id),
      makeEdge(debt.id, restrict.id),
      makeEdge(whatsapp.id, task.id),
      makeEdge(restrict.id, task.id),
    ];
    return { nodes, edges };
  },
};

/* ------------------------------------------------------------------ */
/*  Template 2 — Alerte Assiduité & Retards                            */
/* ------------------------------------------------------------------ */

const absenteeism: WorkflowTemplate = {
  id: "alerte-assiduite-retards",
  name: "Alerte Assiduité & Retards",
  description:
    "3e absence non justifiée du trimestre (§09.04) : alerte urgente aux parents + convocation en examen disciplinaire + tâche pour le surveillant général.",
  triggerType: "automatic",
  build: () => {
    instanceCounter = 0;
    const trigger = makeNode(
      "absence_limit_exceeded",
      "3e absence non justifiée",
      60,
      160,
      { threshold: 3, term: "current" },
    );
    const guard = makeNode(
      "time_window",
      "Heures ouvrées (dim–jeu)",
      320,
      160,
      { startHour: 8, endHour: 16.5, days: [0, 1, 2, 3, 4] },
    );
    const alert = makeNode(
      "push_notification",
      "Alerte urgente parents",
      580,
      60,
      {
        title: "Absence non justifiée",
        body: "Votre enfant a accumulé 3 absences non justifiées ce trimestre.",
        recipient_role: "parent",
        priority: "urgent",
      },
    );
    const convocation = makeNode(
      "generate_document",
      "Convocation disciplinaire",
      580,
      260,
      { document_type: "convocation", recipient: "parent" },
    );
    const task = makeNode(
      "dispatch_task",
      "Tâche — surveillant général",
      840,
      160,
      {
        title: "Examen disciplinaire — assiduité",
        assignee_role: "supervisor",
        priority: "high",
      },
    );
    const nodes = [trigger, guard, alert, convocation, task];
    const edges = [
      makeEdge(trigger.id, guard.id),
      makeEdge(guard.id, alert.id),
      makeEdge(guard.id, convocation.id),
      makeEdge(alert.id, task.id),
      makeEdge(convocation.id, task.id),
    ];
    return { nodes, edges };
  },
};

/* ------------------------------------------------------------------ */
/*  Template 3 — Clôture Trimestrielle                                 */
/* ------------------------------------------------------------------ */

const termClose: WorkflowTemplate = {
  id: "cloture-trimestrielle",
  name: "Clôture Trimestrielle",
  description:
    "Fin de trimestre (cron) : vérifie que toutes les notes sont saisies, compile les bulletins PDF puis notifie chaque famille que le relevé est disponible sur le portail.",
  triggerType: "scheduled",
  build: () => {
    instanceCounter = 0;
    const trigger = makeNode(
      "calendar_cron_event",
      "Fin de trimestre (cron)",
      60,
      160,
      { cron: "0 18 * * 12", description: "Fin de trimestre à 18:00" },
    );
    const grades = makeNode(
      "database_query",
      "Notes toutes saisies ?",
      320,
      160,
      { entity: "grades", filter: "term = current AND missing = 0" },
    );
    const check = makeNode(
      "student_status_match",
      "Élèves actifs",
      580,
      160,
      { condition: cmp("student.status", "==", "active") },
    );
    const bulletins = makeNode(
      "generate_document",
      "Compiler les bulletins",
      840,
      60,
      { document_type: "bulletin", batch: true },
    );
    const notify = makeNode(
      "push_notification",
      "Notifier les familles",
      1080,
      160,
      {
        title: "Bulletin disponible",
        body: "Le bulletin du trimestre est disponible sur votre portail.",
        recipient_role: "parent",
      },
    );
    const audit = makeNode(
      "log_audit",
      "Journaliser la clôture",
      1080,
      320,
      { note: "Clôture trimestrielle exécutée" },
    );
    const nodes = [trigger, grades, check, bulletins, notify, audit];
    const edges = [
      makeEdge(trigger.id, grades.id),
      makeEdge(grades.id, check.id),
      makeEdge(check.id, bulletins.id),
      makeEdge(bulletins.id, notify.id),
      makeEdge(notify.id, audit.id),
    ];
    return { nodes, edges };
  },
};

/** All built-in templates (registry order = picker order). */
export const WORKFLOW_TEMPLATES: readonly WorkflowTemplate[] = [
  overdueCollection,
  absenteeism,
  termClose,
];

/**
 * Instantiate a template into a NEW workflow's node/edge sets. The ids are
 * re-suffixed with a per-call disambiguator (monotonic counter + random)
 * so multiple instantiations of the same template — even inside the same
 * millisecond — never collide.
 */
export function instantiateTemplate(
  template: WorkflowTemplate,
): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } {
  const { nodes, edges } = template.build();
  instantiateCounter += 1;
  const suffix = `${Date.now().toString(36)}-${instantiateCounter}-${Math.random().toString(36).slice(2, 6)}`;
  const idMap = new Map<string, string>();
  const finalNodes = nodes.map((n) => {
    const id = `${n.id}-${suffix}`;
    idMap.set(n.id, id);
    return { ...n, id };
  });
  const finalEdges = edges.map((e) => ({
    ...e,
    id: `${e.id}-${suffix}`,
    from: idMap.get(e.from) ?? e.from,
    to: idMap.get(e.to) ?? e.to,
  }));
  return { nodes: finalNodes, edges: finalEdges };
}

/**
 * Template integrity guard — used by the test suite AND defensively by the
 * picker (a broken template can never reach the canvas).
 */
export function templateIsValid(template: WorkflowTemplate): { ok: boolean; error?: string } {
  const { nodes, edges } = template.build();
  if (nodes.length === 0) return { ok: false, error: "Template vide" };
  if (!nodes.some((n) => n.type === "trigger")) {
    return { ok: false, error: "Template sans déclencheur" };
  }
  const ids = new Set(nodes.map((n) => n.id));
  for (const e of edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) {
      return { ok: false, error: `Arête orpheline ${e.from}→${e.to}` };
    }
  }
  const cycle = detectCycle(nodes, edges);
  if (cycle.hasCycle) return { ok: false, error: "Template cyclique" };
  // Condition configs must parse (a malformed tree silently degrades to
  // "no gate", which is NOT what these templates promise).
  for (const n of nodes) {
    if (n.config.condition !== undefined && parseConditionConfig(n.config.condition) === null) {
      return { ok: false, error: `Condition illisible sur « ${n.label} »` };
    }
  }
  return { ok: true };
}

/** Human label for a template's node (re-export convenience for the picker). */
export function templateNodeLabel(subtype: WorkflowNodeSubtype): string {
  return WORKFLOW_NODE_SUBTYPE_LABELS_FR[subtype] ?? subtype;
}
