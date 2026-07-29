/**
 * Workflow domain model — iteration 7 (plan §10).
 *
 * Visual DAG (Directed Acyclic Graph) editor for constructing background
 * automation graphs by connecting Triggers, Conditions, Actions, Delays,
 * and Transforms. Deployed to Supabase Edge Functions in production;
 * mocked in this iteration.
 */

export type WorkflowNodeType = "trigger" | "condition" | "action" | "delay" | "transform";

export type WorkflowTriggerType = "manual" | "automatic" | "scheduled";

export type WorkflowStatus = "draft" | "deployed" | "disabled";

export type WorkflowRunStatus = "running" | "succeeded" | "failed" | "timeout";

/** Node subtype identifiers — per plan §10.03-06. */
export type WorkflowNodeSubtype =
  // Triggers (§10.03)
  | "payment_overdue"
  | "student_enrolled"
  | "payment_recorded"
  | "schedule"
  | "absence_limit_exceeded"
  | "manual_run"
  // Conditions (§10.04)
  | "debt_over_threshold"
  | "payment_method_match"
  | "student_status_match"
  // Actions (§10.05)
  | "send_email"
  | "apply_discount"
  | "create_invoice"
  | "push_notification"
  | "log_audit"
  // Delays & Transforms (§10.06)
  | "wait_duration"
  | "database_query"
  | "extract_field";

export interface WorkflowNode {
  readonly id: string;
  readonly type: WorkflowNodeType;
  readonly subtype: WorkflowNodeSubtype;
  readonly label: string;
  readonly position: { x: number; y: number };
  readonly config: Readonly<Record<string, unknown>>;
}

export interface WorkflowEdge {
  readonly id: string;
  readonly from: string; // node id
  readonly to: string; // node id
}

export interface Workflow {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly description: string;
  readonly nodes: readonly WorkflowNode[];
  readonly edges: readonly WorkflowEdge[];
  readonly triggerType: WorkflowTriggerType;
  readonly lastDeployedAt: string | null;
  readonly status: WorkflowStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly createdBy: string;
}

export interface WorkflowNodeResult {
  readonly nodeId: string;
  readonly nodeLabel: string;
  readonly status: "skipped" | "running" | "succeeded" | "failed" | "timeout";
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly output?: string;
  readonly error?: string;
}

export interface WorkflowRun {
  readonly id: string;
  readonly tenantId: string;
  readonly workflowId: string;
  readonly workflowName: string;
  readonly triggerType: WorkflowTriggerType;
  readonly status: WorkflowRunStatus;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly durationMs: number | null;
  readonly actorId: string;
  readonly actorName: string;
  readonly nodeResults: readonly WorkflowNodeResult[];
  readonly error?: string;
}

/* ------------------------------------------------------------------ */
/*  Metadata                                                           */
/* ------------------------------------------------------------------ */

export const WORKFLOW_NODE_TYPE_LABELS_FR: Record<WorkflowNodeType, string> = {
  trigger: "Déclencheur",
  condition: "Condition",
  action: "Action",
  delay: "Délai",
  transform: "Transformation",
};

export const WORKFLOW_NODE_SUBTYPE_LABELS_FR: Record<WorkflowNodeSubtype, string> = {
  payment_overdue: "Paiement en retard",
  student_enrolled: "Élève inscrit",
  payment_recorded: "Paiement enregistré",
  schedule: "Planification",
  absence_limit_exceeded: "Limite d'absences atteinte",
  manual_run: "Exécution manuelle",
  debt_over_threshold: "Dette > seuil",
  payment_method_match: "Méthode de paiement",
  student_status_match: "Statut élève",
  send_email: "Envoyer un email",
  apply_discount: "Appliquer une remise",
  create_invoice: "Créer une facture",
  push_notification: "Notification push",
  log_audit: "Journaliser",
  wait_duration: "Attendre",
  database_query: "Requête base de données",
  extract_field: "Extraire un champ",
};

export const WORKFLOW_STATUS_LABELS_FR: Record<WorkflowStatus, string> = {
  draft: "Brouillon",
  deployed: "Déployé",
  disabled: "Désactivé",
};

export const WORKFLOW_RUN_STATUS_LABELS_FR: Record<WorkflowRunStatus, string> = {
  running: "En cours",
  succeeded: "Réussie",
  failed: "Échouée",
  timeout: "Expirée",
};

export const WORKFLOW_TRIGGER_LABELS_FR: Record<WorkflowTriggerType, string> = {
  manual: "Manuel",
  automatic: "Automatique",
  scheduled: "Planifié",
};

/** Run status → status chip tone. */
export const WORKFLOW_RUN_STATUS_TONE: Record<WorkflowRunStatus, "info" | "success" | "danger" | "warning"> = {
  running: "info",
  succeeded: "success",
  failed: "danger",
  timeout: "warning",
};

/** Node type → color (used by the DAG canvas). */
export const WORKFLOW_NODE_TYPE_COLORS: Record<WorkflowNodeType, {
  bg: string;
  border: string;
  text: string;
}> = {
  trigger: { bg: "#dbeafe", border: "#3b82f6", text: "#1e40af" },
  condition: { bg: "#fef3c7", border: "#f59e0b", text: "#92400e" },
  action: { bg: "#dcfce7", border: "#22c55e", text: "#166534" },
  delay: { bg: "#f3e8ff", border: "#a855f7", text: "#6b21a8" },
  transform: { bg: "#e0e7ff", border: "#6366f1", text: "#3730a3" },
};

/** Node subtype → type lookup. */
export const NODE_SUBTYPE_TO_TYPE: Record<WorkflowNodeSubtype, WorkflowNodeType> = {
  payment_overdue: "trigger",
  student_enrolled: "trigger",
  payment_recorded: "trigger",
  schedule: "trigger",
  absence_limit_exceeded: "trigger",
  manual_run: "trigger",
  debt_over_threshold: "condition",
  payment_method_match: "condition",
  student_status_match: "condition",
  send_email: "action",
  apply_discount: "action",
  create_invoice: "action",
  push_notification: "action",
  log_audit: "action",
  wait_duration: "delay",
  database_query: "transform",
  extract_field: "transform",
};

/** Node subtypes grouped by type — used by the palette UI. */
export const NODE_SUBTYPES_BY_TYPE: Record<WorkflowNodeType, WorkflowNodeSubtype[]> = {
  trigger: ["payment_overdue", "student_enrolled", "payment_recorded", "schedule", "absence_limit_exceeded", "manual_run"],
  condition: ["debt_over_threshold", "payment_method_match", "student_status_match"],
  action: ["send_email", "apply_discount", "create_invoice", "push_notification", "log_audit"],
  delay: ["wait_duration"],
  transform: ["database_query", "extract_field"],
};
