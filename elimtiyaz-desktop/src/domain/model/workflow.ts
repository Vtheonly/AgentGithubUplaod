/**
 * Workflow domain model — iteration 7 (plan §10), expanded in the 33rd
 * session (T-221, owner mandate "fully do the DAG automations").
 *
 * Visual DAG (Directed Acyclic Graph) editor for constructing background
 * automation graphs by connecting Triggers, Conditions, Actions, Delays,
 * and Transforms. Deployed to Supabase Edge Functions in production;
 * mocked in this iteration.
 *
 * T-221 additions (the "high-impact educational automation" set):
 *   - Triggers: grade_below_threshold, payment_cleared_or_bounced,
 *     document_expiration, calendar_cron_event, stock_level_critical.
 *   - Conditions: time_window (temporal guard), route_switch (multi-way
 *     switch / router with per-outgoing-edge route conditions).
 *   - Actions: send_whatsapp, restrict_account, dispatch_task,
 *     generate_document, account_adjustment.
 */

export type WorkflowNodeType = "trigger" | "condition" | "action" | "delay" | "transform";

export type WorkflowTriggerType = "manual" | "automatic" | "scheduled";

export type WorkflowStatus = "draft" | "deployed" | "disabled";

export type WorkflowRunStatus = "running" | "succeeded" | "failed" | "timeout";

/** Node subtype identifiers — per plan §10.03-06 + T-221 expansion. */
export type WorkflowNodeSubtype =
  // Triggers (§10.03 + T-221)
  | "payment_overdue"
  | "student_enrolled"
  | "payment_recorded"
  | "schedule"
  | "absence_limit_exceeded"
  | "manual_run"
  | "grade_below_threshold"
  | "payment_cleared_or_bounced"
  | "document_expiration"
  | "calendar_cron_event"
  | "stock_level_critical"
  // Conditions (§10.04 + T-221)
  | "debt_over_threshold"
  | "payment_method_match"
  | "student_status_match"
  | "time_window"
  | "route_switch"
  // Actions (§10.05 + T-221)
  | "send_email"
  | "apply_discount"
  | "create_invoice"
  | "push_notification"
  | "log_audit"
  | "send_whatsapp"
  | "restrict_account"
  | "dispatch_task"
  | "generate_document"
  | "account_adjustment"
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
  /**
   * VAULT §10.09 (best practice 5) — maximum execution count per day per
   * workflow, to prevent runaway loops. Mirrors the backend
   * `workflows.max_daily_executions` column (migration 0012, default 100).
   */
  readonly maxDailyExecutions?: number;
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
  grade_below_threshold: "Note sous le seuil",
  payment_cleared_or_bounced: "Chèque compensé / rejeté",
  document_expiration: "Document expire bientôt",
  calendar_cron_event: "Événement planifié (cron)",
  stock_level_critical: "Stock critique",
  debt_over_threshold: "Dette > seuil",
  payment_method_match: "Méthode de paiement",
  student_status_match: "Statut élève",
  time_window: "Fenêtre horaire",
  route_switch: "Aiguillage multi-voies",
  send_email: "Envoyer un email",
  apply_discount: "Appliquer une remise",
  create_invoice: "Créer une facture",
  push_notification: "Notification push",
  log_audit: "Journaliser",
  send_whatsapp: "Envoyer WhatsApp",
  restrict_account: "Restreindre le compte",
  dispatch_task: "Créer une tâche",
  generate_document: "Générer un document",
  account_adjustment: "Ajustement de compte",
  wait_duration: "Attendre",
  database_query: "Requête base de données",
  extract_field: "Extraire un champ",
};

/**
 * T-221: one-line subtype descriptions — palette tooltips + the node
 * inspector's header line. Every subtype MUST have an entry (guarded by
 * the workflow-subtype-registry test).
 */
export const NODE_SUBTYPE_DESCRIPTIONS_FR: Record<WorkflowNodeSubtype, string> = {
  payment_overdue: "Déclenche lorsqu'une tranche reste impayée après le délai de grâce.",
  student_enrolled: "Déclenche à l'inscription d'un élève (batch ou individuelle).",
  payment_recorded: "Déclenche dès qu'un paiement est encaissé au comptoir.",
  schedule: "Déclenche à intervalles réguliers (quotidien, hebdomadaire…).",
  absence_limit_exceeded: "Déclenche au N-ième absence non justifiée du trimestre.",
  manual_run: "Ne se déclenche que par le bouton Exécuter (test humain).",
  grade_below_threshold: "Déclenche quand une note saisie passe sous le seuil (rattrapage).",
  payment_cleared_or_bounced: "Déclenche à la compensation ou au rejet d'un chèque.",
  document_expiration: "Déclenche N jours avant l'expiration d'un document (certificat, contrat).",
  calendar_cron_event: "Déclenche selon une expression cron (ex. dimanche 08:00).",
  stock_level_critical: "Déclenche quand un stock passe sous le seuil de réapprovisionnement.",
  debt_over_threshold: "Poursuit si la créance familiale dépasse le montant configuré.",
  payment_method_match: "Poursuit si le paiement utilise la méthode configurée.",
  student_status_match: "Poursuit si le statut de l'élève correspond (actif, suspendu…).",
  time_window: "Poursuit uniquement pendant la fenêtre horaire scolaire configurée.",
  route_switch: "Distribue l'exécution vers la première voie dont la condition est vraie.",
  send_email: "Envoie un email au parent ou au personnel (RESEND_API_KEY requis).",
  apply_discount: "Applique une remise au engagement annuel de la famille.",
  create_invoice: "Génère une facture/échéancier pour la famille.",
  push_notification: "Notifie le portail parent (table notifications) — livré par MSG-200.",
  log_audit: "Journalise l'événement dans le journal d'audit (write_audit_log).",
  send_whatsapp: "Prépare un message WhatsApp (wa.me) pour le parent.",
  restrict_account: "Restreint l'accès portail des comptes fortement débiteurs.",
  dispatch_task: "Injecte une tâche dans la file du rôle désigné (tasks).",
  generate_document: "Génère un PDF officiel (relevé, convocation, bulletin).",
  account_adjustment: "Comptabilise un ajustement de compte (ex. remise passage de palier).",
  wait_duration: "Suspend le flux pendant la durée configurée.",
  database_query: "Charge des entités supplémentaires dans le contexte.",
  extract_field: "Extrait un champ du contexte pour l'afficher en sortie.",
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
  grade_below_threshold: "trigger",
  payment_cleared_or_bounced: "trigger",
  document_expiration: "trigger",
  calendar_cron_event: "trigger",
  stock_level_critical: "trigger",
  debt_over_threshold: "condition",
  payment_method_match: "condition",
  student_status_match: "condition",
  time_window: "condition",
  route_switch: "condition",
  send_email: "action",
  apply_discount: "action",
  create_invoice: "action",
  push_notification: "action",
  log_audit: "action",
  send_whatsapp: "action",
  restrict_account: "action",
  dispatch_task: "action",
  generate_document: "action",
  account_adjustment: "action",
  wait_duration: "delay",
  database_query: "transform",
  extract_field: "transform",
};

/** Node subtypes grouped by type — used by the palette UI. */
export const NODE_SUBTYPES_BY_TYPE: Record<WorkflowNodeType, WorkflowNodeSubtype[]> = {
  trigger: [
    "payment_overdue",
    "student_enrolled",
    "payment_recorded",
    "schedule",
    "absence_limit_exceeded",
    "manual_run",
    "grade_below_threshold",
    "payment_cleared_or_bounced",
    "document_expiration",
    "calendar_cron_event",
    "stock_level_critical",
  ],
  condition: [
    "debt_over_threshold",
    "payment_method_match",
    "student_status_match",
    "time_window",
    "route_switch",
  ],
  action: [
    "send_email",
    "apply_discount",
    "create_invoice",
    "push_notification",
    "log_audit",
    "send_whatsapp",
    "restrict_account",
    "dispatch_task",
    "generate_document",
    "account_adjustment",
  ],
  delay: ["wait_duration"],
  transform: ["database_query", "extract_field"],
};
