/**
 * Workflow seed data — plan §10.
 *
 * 3 seeded workflows + 15 mock runs across them. The workflows cover the
 * three lifecycle states (deployed / draft / disabled) and exercise every
 * node type (trigger / condition / action / delay / transform).
 *
 * All node positions are in the canvas SVG viewBox (1000×600).
 */

import type {
  Workflow,
  WorkflowRun,
  WorkflowNode,
  WorkflowNodeSubtype,
  WorkflowEdge,
  WorkflowNodeResult,
  WorkflowRunStatus,
} from "../../domain/model/workflow";
import { TENANT_ID } from "./seed-data";

const NOW = new Date("2025-09-15T10:00:00Z");
const iso = (d: Date) => d.toISOString();
const daysAgo = (n: number) => iso(new Date(NOW.getTime() - n * 86_400_000));
const hoursAgo = (n: number) => iso(new Date(NOW.getTime() - n * 3_600_000));
const minsAgo = (n: number) => iso(new Date(NOW.getTime() - n * 60_000));

function node(
  id: string,
  type: WorkflowNode["type"],
  subtype: WorkflowNodeSubtype,
  label: string,
  x: number,
  y: number,
  config: Record<string, unknown> = {},
): WorkflowNode {
  return { id, type, subtype, label, position: { x, y }, config };
}

function edge(id: string, from: string, to: string): WorkflowEdge {
  return { id, from, to };
}

/* ------------------------------------------------------------------ */
/*  Workflow 1: "Relance impayés" (deployed, manual)                  */
/* ------------------------------------------------------------------ */

const workflow1: Workflow = {
  id: "wf-001",
  tenantId: TENANT_ID,
  name: "Relance impayés",
  description:
    "Identifie les parents avec créance > 5 000 DZD, envoie un e-mail de relance puis journalise l'activité.",
  triggerType: "manual",
  lastDeployedAt: daysAgo(7),
  status: "deployed",
  createdAt: daysAgo(30),
  updatedAt: daysAgo(7),
  createdBy: "usr-adm-001",
  nodes: [
    node("n1-1", "trigger", "manual_run", "Exécution manuelle", 60, 260),
    node("n1-2", "transform", "database_query", "Requête: comptes en retard", 240, 260, {
      sql: "SELECT * FROM parents WHERE outstanding > 5000",
    }),
    node("n1-3", "condition", "debt_over_threshold", "Dette > 5 000 DZD", 440, 260, {
      threshold: 5000,
    }),
    node("n1-4", "action", "send_email", "Envoyer e-mail de relance", 640, 180, {
      template: "relance_impayes_v2",
    }),
    node("n1-5", "action", "log_audit", "Journaliser l'envoi", 640, 360, {
      action: "debt.reminder_sent",
    }),
  ],
  edges: [
    edge("e1-1", "n1-1", "n1-2"),
    edge("e1-2", "n1-2", "n1-3"),
    edge("e1-3", "n1-3", "n1-4"),
    edge("e1-4", "n1-3", "n1-5"),
  ],
};

/* ------------------------------------------------------------------ */
/*  Workflow 2: "Promotion fin d'année" (draft, scheduled)            */
/* ------------------------------------------------------------------ */

const workflow2: Workflow = {
  id: "wf-002",
  tenantId: TENANT_ID,
  name: "Promotion fin d'année",
  description:
    "À la fin de l'année scolaire, applique la remise passage palier (-10 000 DZD), génère une facture et notifie le parent.",
  triggerType: "scheduled",
  lastDeployedAt: null,
  status: "draft",
  createdAt: daysAgo(15),
  updatedAt: daysAgo(2),
  createdBy: "usr-adm-001",
  nodes: [
    node("n2-1", "trigger", "schedule", "1er juin (annuel)", 60, 260, {
      cron: "0 0 1 6 *",
    }),
    node("n2-2", "transform", "database_query", "Liste des élèves éligibles", 240, 260, {
      sql: "SELECT * FROM students WHERE status='active'",
    }),
    node("n2-3", "condition", "student_status_match", "Statut = actif", 440, 260, {
      status: "active",
    }),
    node("n2-4", "action", "apply_discount", "Remise passage palier", 640, 180, {
      code: "passage_palier",
      amount: 10000,
    }),
    node("n2-5", "action", "create_invoice", "Facture T1", 640, 360, {
      period: "T1-2026",
    }),
    node("n2-6", "action", "push_notification", "Notification parent", 840, 270, {
      template: "promotion_appliquee",
    }),
  ],
  edges: [
    edge("e2-1", "n2-1", "n2-2"),
    edge("e2-2", "n2-2", "n2-3"),
    edge("e2-3", "n2-3", "n2-4"),
    edge("e2-4", "n2-3", "n2-5"),
    edge("e2-5", "n2-4", "n2-6"),
    edge("e2-6", "n2-5", "n2-6"),
  ],
};

/* ------------------------------------------------------------------ */
/*  Workflow 3: "Verrouillage comptes délinquants" (deployed, disabled) */
/* ------------------------------------------------------------------ */

const workflow3: Workflow = {
  id: "wf-003",
  tenantId: TENANT_ID,
  name: "Verrouillage comptes délinquants",
  description:
    "Quand une absence de paiement > 90 jours est détectée, attend 24h puis verrouille le compte parent (audit log).",
  triggerType: "automatic",
  lastDeployedAt: daysAgo(45),
  status: "disabled",
  createdAt: daysAgo(60),
  updatedAt: daysAgo(20),
  createdBy: "usr-fin-001",
  nodes: [
    node("n3-1", "trigger", "payment_overdue", "Paiement en retard", 60, 260, {
      overdueDays: 90,
    }),
    node("n3-2", "condition", "debt_over_threshold", "Dette > 20 000 DZD", 260, 260, {
      threshold: 20000,
    }),
    node("n3-3", "delay", "wait_duration", "Attendre 24h", 460, 260, {
      durationMs: 86_400_000,
    }),
    node("n3-4", "action", "log_audit", "Verrouiller compte", 660, 260, {
      action: "account.locked",
    }),
  ],
  edges: [
    edge("e3-1", "n3-1", "n3-2"),
    edge("e3-2", "n3-2", "n3-3"),
    edge("e3-3", "n3-3", "n3-4"),
  ],
};

export const seedWorkflows: readonly Workflow[] = [workflow1, workflow2, workflow3];

/* ------------------------------------------------------------------ */
/*  15 mock WorkflowRuns                                              */
/*  - 5 succeeded, 3 failed, 2 running, 5 timeout                    */
/* ------------------------------------------------------------------ */

function buildNodeResults(
  wf: Workflow,
  status: WorkflowRunStatus,
  startedAt: string,
): { results: WorkflowNodeResult[]; completedAt: string; durationMs: number; error?: string } {
  const results: WorkflowNodeResult[] = [];
  let cursor = new Date(startedAt).getTime();
  let failureNode: string | null = null;
  for (const n of wf.nodes) {
    const nodeStart = iso(new Date(cursor));
    // Mock per-node timing: 50-200ms pseudo-random per type. charCodeAt may
    // return NaN for short ids — coerce to 0 defensively.
    const charAt2 = n.id.charCodeAt(2);
    const dur = n.type === "delay" ? 0 : 50 + ((Number.isNaN(charAt2) ? 0 : charAt2) % 150);
    cursor += dur;
    const nodeEnd = iso(new Date(cursor));
    // Conditions always succeed; actions 90% success; on failure, mark
    // remaining nodes as not executed (we still emit entries for those
    // already visited, then break).
    let nodeStatus: WorkflowNodeResult["status"] = "succeeded";
    if (status === "failed" && n.type === "action" && failureNode === null) {
      // Force failure on the first action node for failed runs (deterministic).
      nodeStatus = "failed";
      failureNode = n.id;
    } else if (status === "timeout" && n.type === "delay") {
      nodeStatus = "timeout";
    }
    results.push({
      nodeId: n.id,
      nodeLabel: n.label,
      status: nodeStatus,
      startedAt: nodeStart,
      completedAt: nodeEnd,
      output:
        nodeStatus === "succeeded"
          ? `OK (${n.subtype})`
          : undefined,
      error:
        nodeStatus === "failed"
          ? "Échec de l'envoi — service e-mail indisponible"
          : nodeStatus === "timeout"
            ? "Délai expiré après 60s"
            : undefined,
    });
    if (failureNode !== null) break;
  }
  const completedAt = iso(new Date(cursor));
  const durationMs = cursor - new Date(startedAt).getTime();
  const error =
    status === "failed"
      ? `Échec au nœud ${failureNode ?? "?"}`
      : status === "timeout"
        ? "Délai d'exécution dépassé"
        : undefined;
  return { results, completedAt, durationMs, error };
}

function buildRun(
  id: string,
  wf: Workflow,
  status: WorkflowRunStatus,
  startedAt: string,
  actorId: string,
  actorName: string,
): WorkflowRun {
  const { results, completedAt, durationMs, error } = buildNodeResults(wf, status, startedAt);
  return {
    id,
    tenantId: wf.tenantId,
    workflowId: wf.id,
    workflowName: wf.name,
    triggerType: wf.triggerType,
    status,
    startedAt,
    completedAt,
    durationMs,
    actorId,
    actorName,
    nodeResults: results,
    error,
  };
}

export const seedWorkflowRuns: readonly WorkflowRun[] = [
  // Workflow 1 — Relance impayés (manual)
  buildRun("wfr-001", workflow1, "succeeded", hoursAgo(2), "usr-adm-001", "Brahim Souilah"),
  buildRun("wfr-002", workflow1, "succeeded", hoursAgo(26), "usr-fin-001", "Fatima Belkacem (Fin)"),
  buildRun("wfr-003", workflow1, "failed", hoursAgo(50), "usr-adm-001", "Brahim Souilah"),
  buildRun("wfr-004", workflow1, "succeeded", daysAgo(3), "usr-fin-001", "Fatima Belkacem (Fin)"),
  buildRun("wfr-005", workflow1, "timeout", daysAgo(4), "usr-adm-001", "Brahim Souilah"),

  // Workflow 2 — Promotion fin d'année (scheduled)
  buildRun("wfr-006", workflow2, "succeeded", daysAgo(105), "system", "Système (planification)"),
  buildRun("wfr-007", workflow2, "failed", daysAgo(110), "system", "Système (planification)"),
  buildRun("wfr-008", workflow2, "succeeded", daysAgo(470), "system", "Système (planification)"),
  buildRun("wfr-009", workflow2, "timeout", daysAgo(475), "system", "Système (planification)"),
  buildRun("wfr-010", workflow2, "running", minsAgo(2), "system", "Système (planification)"),

  // Workflow 3 — Verrouillage (automatic)
  buildRun("wfr-011", workflow3, "succeeded", hoursAgo(8), "system", "Système (trigger auto)"),
  buildRun("wfr-012", workflow3, "succeeded", hoursAgo(33), "system", "Système (trigger auto)"),
  buildRun("wfr-013", workflow3, "failed", daysAgo(2), "system", "Système (trigger auto)"),
  buildRun("wfr-014", workflow3, "running", minsAgo(1), "system", "Système (trigger auto)"),
  buildRun("wfr-015", workflow3, "timeout", daysAgo(5), "system", "Système (trigger auto)"),
];
