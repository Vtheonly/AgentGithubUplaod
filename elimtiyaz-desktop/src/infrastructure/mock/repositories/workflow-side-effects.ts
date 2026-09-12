/**
 * T-314 — REAL workflow action side-effects (mock mode).
 *
 * The mock repository's `execute` and the event bridge call this module so
 * a workflow execution produces VISIBLE, REAL artifacts in the shared mock
 * store — not just a run record:
 *
 *   - `dispatch_task`      → a real Task row (Personnel → Tâches);
 *   - `push_notification`  → a real AppNotification (Topbar bell, source
 *                            "workflow", targetRole "parent");
 *   - `restrict_account`   → `financiallyRestricted: true` on the parent
 *                            (CRM shows « Accès restreint »);
 *   - `log_audit`          → a real audit entry (appendAudit);
 *   - `send_whatsapp`      → an audit entry + a staff notification with the
 *                            resolved wa.me link (delivery itself is out of
 *                            scope in mock mode — the PREPARATION is real);
 *   - `generate_document`  → an audit entry (PDF generation is simulated);
 *   - `send_email`         → an audit entry.
 *
 * This module NEVER executes the graph — the dry-run engine decides the
 * taken path; this applies effects for the SUCCEEDED action nodes only.
 */
import { store, appendAudit, nowIso } from "./mock-store";
import { mockTaskRepository } from "../workforce";
import { Role } from "../../../core/rbac/roles";
import { AuditActions } from "../../../core/audit-actions";
import { resolveTemplate, type ConditionContext } from "../../../domain/calc/workflow/condition-evaluator";
import type { DryRunNodeResult } from "../../../domain/calc/workflow/dry-run";
import type { AppNotification, AlertPriority } from "../../../domain/model/operations";
import type { TaskPriority } from "../../../domain/model/workforce";
import { parentDisplayName, type Parent } from "../../../domain/model/parent";

/** Input for one side-effect application pass. */
export interface SideEffectsInput {
  readonly workflowId: string;
  readonly workflowName: string;
  readonly runId: string;
  /** Simulation results (only succeeded action rows produce effects). */
  readonly results: readonly DryRunNodeResult[];
  /** The execution context (template resolution + parent targeting). */
  readonly context: ConditionContext;
  /** The parent the run targets (restrict_account / notifications). */
  readonly targetParentId: string | null;
  readonly actorId: string;
  readonly actorName: string;
}

/** assignee_role config string → canonical Role (fallback: SupportStaff). */
function mapAssigneeRole(raw: unknown): Role {
  const value = typeof raw === "string" ? raw.toLowerCase().trim() : "";
  switch (value) {
    case "finance_officer":
    case "financial_officer":
    case "financier":
      return Role.FinancialOfficer;
    case "super_admin":
    case "admin":
      return Role.SuperAdmin;
    case "teacher":
    case "enseignant":
      return Role.Teacher;
    case "manager":
    case "responsable":
      return Role.Manager;
    case "parent":
      return Role.Parent;
    case "supervisor":
    case "surveillant":
    case "support_staff":
    case "default":
    default:
      return Role.SupportStaff;
  }
}

function mapPriority(raw: unknown): TaskPriority {
  const value = typeof raw === "string" ? raw.toLowerCase().trim() : "";
  if (value === "urgent" || value === "high" || value === "medium" || value === "low") return value;
  return "medium";
}

function mapAlertPriority(raw: unknown): AlertPriority {
  const value = typeof raw === "string" ? raw.toLowerCase().trim() : "";
  if (value === "urgent") return "urgent";
  if (value === "high") return "high";
  if (value === "low") return "low";
  return "medium";
}

function strConfig(config: Readonly<Record<string, unknown>>, key: string, fallback: string): string {
  const raw = config[key];
  return typeof raw === "string" && raw.trim() !== "" ? raw : fallback;
}

function readParent(parentId: string | null): Parent | null {
  if (!parentId) return null;
  return store.parents.find((p) => p.id === parentId) ?? null;
}

function parentLabel(parent: Parent | null, context: ConditionContext): string {
  if (parent) return parentDisplayName(parent) || parent.id;
  const name = (context.parent as Record<string, unknown> | undefined)?.name;
  return typeof name === "string" && name !== "" ? name : "parent";
}

/* ------------------------------------------------------------------ */
/*  The effect appliers                                                */
/* ------------------------------------------------------------------ */

function applyDispatchTask(
  input: SideEffectsInput,
  nodeId: string,
  config: Readonly<Record<string, unknown>>,
  context: ConditionContext,
): string {
  const title = resolveTemplate(
    strConfig(config, "title", "Tâche workflow — à traiter"),
    context,
  );
  const description = resolveTemplate(
    strConfig(config, "description", `Généré par le workflow « ${input.workflowName} ».`),
    context,
  );
  // REAL task creation through the canonical task repository — the row
  // appears in Personnel → Tâches immediately (observable stream fires).
  void mockTaskRepository
    .createTask({
      title,
      description,
      priority: mapPriority(config.priority),
      departmentId: null,
      assigneeIds: [],
      dueDate: null,
      createdBy: input.actorId,
      createdByName: input.actorName,
      tags: ["workflow", input.workflowId],
    })
    .then((r) => {
      if (r.ok) {
        appendAudit({
          action: AuditActions.WorkflowTriggered,
          entityType: "task",
          entityId: r.value.id,
          actorId: input.actorId,
          actorName: input.actorName,
          diff: { before: null, after: { title, priority: r.value.priority, run: input.runId, node: nodeId } },
          note: `dispatch_task — tâche réelle créée par le workflow « ${input.workflowName} » (Personnel → Tâches)`,
        });
      }
    })
    .catch(() => {
      /* the audit trail already records the attempt below */
    });
  appendAudit({
    action: "workflow.action.dispatch_task",
    entityType: "workflow",
    entityId: input.workflowId,
    actorId: input.actorId,
    actorName: input.actorName,
    diff: { before: null, after: { run: input.runId, node: nodeId, title } },
    note: `dispatch_task — « ${title} » (priorité ${mapPriority(config.priority)}) ajoutée à la file.`,
  });
  return `Tâche réelle créée dans Personnel → Tâches : « ${title} »`;
}

function applyPushNotification(
  input: SideEffectsInput,
  nodeId: string,
  config: Readonly<Record<string, unknown>>,
  context: ConditionContext,
): string {
  const title = resolveTemplate(
    strConfig(config, "title", "Notification workflow"),
    context,
  );
  const body = resolveTemplate(
    strConfig(config, "body", strConfig(config, "template", "Le workflow « " + input.workflowName + " » s'est exécuté.")),
    context,
  );
  const notification: AppNotification = {
    id: `ntf-wf-${input.runId}-${nodeId}`,
    title,
    body,
    type: "custom",
    priority: mapAlertPriority(config.priority),
    source: "workflow",
    sourceLabel: `Workflow — ${input.workflowName}`,
    entityType: input.targetParentId ? "parent" : null,
    entityId: input.targetParentId,
    targetUserId: null,
    targetRole: input.targetParentId ? Role.Parent : mapAssigneeRole(config.recipient_role),
    triggeredAt: null,
    readAt: null,
    createdAt: nowIso(),
    createdBy: input.actorId,
  };
  store.notifications = [notification, ...store.notifications];
  store.notifyNotifications();
  return `Notification réelle créée (cloche topbar +1) : « ${title} » — ${body.slice(0, 80)}${body.length > 80 ? "…" : ""}`;
}

function applyRestrictAccount(
  input: SideEffectsInput,
  _nodeId: string,
  config: Readonly<Record<string, unknown>>,
  context: ConditionContext,
): string {
  const parent = readParent(input.targetParentId);
  if (!parent) {
    return "restrict_account ignoré — aucun parent ciblé pour cette exécution (contexte sans entité).";
  }
  const idx = store.parents.findIndex((p) => p.id === parent.id);
  if (idx >= 0) {
    const after: Parent = { ...store.parents[idx], financiallyRestricted: true, updatedAt: nowIso() };
    store.parents[idx] = after;
    store.notifyParents();
  }
  appendAudit({
    action: AuditActions.ParentUpdate,
    entityType: "parent",
    entityId: parent.id,
    actorId: input.actorId,
    actorName: input.actorName,
    diff: { before: { financiallyRestricted: false }, after: { financiallyRestricted: true } },
    note: `restrict_account — compte parent restreint par le workflow « ${input.workflowName} » (CRM : Accès restreint)`,
  });
  const label = parentLabel(parent, context);
  return `Compte parent réellement restreint (CRM : « Accès restreint ») — ${label}.`;
}

function applyWhatsApp(
  input: SideEffectsInput,
  nodeId: string,
  config: Readonly<Record<string, unknown>>,
  context: ConditionContext,
): string {
  const parent = readParent(input.targetParentId);
  const template = strConfig(config, "template", strConfig(config, "body", "Bonjour, votre solde de {{debt.amount}} DZD nécessite votre attention."));
  const resolved = resolveTemplate(template, context);
  const phone = parent?.phone?.replace(/[^\d+]/g, "") ?? null;
  const link = phone ? `https://wa.me/${phone.replace("+", "")}` : null;
  // The WhatsApp PREPARATION is a real staff notification (delivery is
  // out of scope in mock mode): the surveillant gets the ready-to-send
  // message so the action has a visible, actionable artifact.
  const notification: AppNotification = {
    id: `ntf-wa-${input.runId}-${nodeId}`,
    title: `WhatsApp prêt — ${parentLabel(parent, context)}`,
    body: link ? `${resolved} (${link})` : resolved,
    type: "custom",
    priority: "medium",
    source: "workflow",
    sourceLabel: `Workflow — ${input.workflowName}`,
    entityType: input.targetParentId ? "parent" : null,
    entityId: input.targetParentId,
    targetUserId: null,
    targetRole: Role.SupportStaff,
    triggeredAt: null,
    readAt: null,
    createdAt: nowIso(),
    createdBy: input.actorId,
  };
  store.notifications = [notification, ...store.notifications];
  store.notifyNotifications();
  appendAudit({
    action: AuditActions.WorkflowTriggered,
    entityType: "parent",
    entityId: input.targetParentId ?? "unknown",
    actorId: input.actorId,
    actorName: input.actorName,
    diff: { before: null, after: { message: resolved, link } },
    note: `send_whatsapp — message préparé : « ${resolved.slice(0, 120)} »`,
  });
  return `WhatsApp préparé et notifié au personnel : « ${resolved} »${link ? ` → ${link}` : ""}`;
}

function applyLogAudit(
  input: SideEffectsInput,
  _nodeId: string,
  config: Readonly<Record<string, unknown>>,
  context: ConditionContext,
): string {
  const note = resolveTemplate(
    strConfig(config, "note", strConfig(config, "action", `Workflow « ${input.workflowName} » exécuté.`)),
    context,
  );
  appendAudit({
    action: "workflow.action.log_audit",
    entityType: "workflow",
    entityId: input.workflowId,
    actorId: input.actorId,
    actorName: input.actorName,
    diff: { before: null, after: { run: input.runId, note } },
    note: `log_audit — ${note}`,
  });
  return `Entrée réelle écrite dans le journal d'audit : « ${note} »`;
}

function applyGenericAction(
  input: SideEffectsInput,
  nodeId: string,
  subtype: string,
  config: Readonly<Record<string, unknown>>,
  context: ConditionContext,
): string {
  const detail = resolveTemplate(
    strConfig(config, "template", strConfig(config, "body", "")),
    context,
  );
  appendAudit({
    action: `workflow.action.${subtype}`,
    entityType: "workflow",
    entityId: input.workflowId,
    actorId: input.actorId,
    actorName: input.actorName,
    diff: { before: null, after: { run: input.runId, node: nodeId } },
    note: `${subtype} exécuté${detail ? ` : « ${detail.slice(0, 120)} »` : ""} (effet simulé côté mock)`,
  });
  return `Effet enregistré (audit) pour ${subtype}${detail ? ` : « ${detail.slice(0, 100)} »` : ""}`;
}

/**
 * Apply side effects for ONE action node (the repository/bridge iterate the
 * simulation results and call this per node with the node's config).
 */
export function applyActionEffect(
  input: SideEffectsInput,
  node: { id: string; subtype: string; config: Readonly<Record<string, unknown>> },
  context: ConditionContext,
): string {
  try {
    switch (node.subtype) {
      case "dispatch_task":
        return applyDispatchTask(input, node.id, node.config, context);
      case "push_notification":
        return applyPushNotification(input, node.id, node.config, context);
      case "restrict_account":
        return applyRestrictAccount(input, node.id, node.config, context);
      case "send_whatsapp":
        return applyWhatsApp(input, node.id, node.config, context);
      case "log_audit":
        return applyLogAudit(input, node.id, node.config, context);
      default:
        return applyGenericAction(input, node.id, node.subtype, node.config, context);
    }
  } catch (err) {
    appendAudit({
      action: "workflow.action.error",
      entityType: "workflow",
      entityId: input.workflowId,
      actorId: input.actorId,
      actorName: input.actorName,
      diff: { before: null, after: { node: node.id, error: String(err) } },
      note: `Effet de bord échoué pour ${node.subtype} — ${String(err)}`,
    });
    return `Effet échoué pour ${node.subtype} (voir audit) — ${String(err)}`;
  }
}
