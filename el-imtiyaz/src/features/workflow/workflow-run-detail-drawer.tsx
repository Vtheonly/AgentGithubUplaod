/**
 * WorkflowRunDetailDrawer — UnifiedModal "drawer" variant showing the full
 * WorkflowRun timeline: per-node results with status, started/completed,
 * output, error. Used by both the Workflow page Exécutions tab and the
 * Personnel page Workflows tab.
 *
 * Plan §10.04 — read-only (no actions inside).
 */
import { CheckCircle2, XCircle, Clock, Loader2, AlertTriangle, Activity } from "lucide-react";
import { UnifiedModal } from "../../shared/ui/unified-modal";
import { StatusChip } from "../../shared/ui/status-chip";
import { formatDateTime } from "../../core/format/date";
import {
  WORKFLOW_RUN_STATUS_LABELS_FR,
  WORKFLOW_TRIGGER_LABELS_FR,
  type WorkflowRun,
  type WorkflowRunStatus,
  type WorkflowNodeResult,
} from "../../domain/model/workflow";

const STATUS_TONE: Record<WorkflowRunStatus, "success" | "danger" | "warning" | "info"> = {
  succeeded: "success",
  failed: "danger",
  timeout: "warning",
  running: "info",
};

const NODE_RESULT_STATUS_TONE: Record<WorkflowNodeResult["status"], "success" | "danger" | "warning" | "info" | "neutral"> = {
  succeeded: "success",
  failed: "danger",
  timeout: "warning",
  running: "info",
  skipped: "neutral",
};

const NODE_RESULT_STATUS_LABELS_FR: Record<WorkflowNodeResult["status"], string> = {
  succeeded: "Réussi",
  failed: "Échoué",
  timeout: "Expiré",
  running: "En cours",
  skipped: "Ignoré",
};

function NodeResultIcon({ status }: { status: WorkflowNodeResult["status"] }) {
  switch (status) {
    case "succeeded":
      return <CheckCircle2 className="h-4 w-4 text-status-success shrink-0" />;
    case "failed":
      return <XCircle className="h-4 w-4 text-status-danger shrink-0" />;
    case "timeout":
      return <AlertTriangle className="h-4 w-4 text-status-warning shrink-0" />;
    case "running":
      return <Loader2 className="h-4 w-4 text-status-info animate-spin shrink-0" />;
    case "skipped":
      return <Clock className="h-4 w-4 text-muted-foreground shrink-0" />;
  }
}

function NodeResultRow({ result }: { result: WorkflowNodeResult }) {
  return (
    <div className="flex items-start gap-3 py-2 border-b border-border/60 last:border-b-0">
      <NodeResultIcon status={result.status} />
      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium text-foreground truncate">{result.nodeLabel}</p>
          <StatusChip
            label={NODE_RESULT_STATUS_LABELS_FR[result.status]}
            tone={NODE_RESULT_STATUS_TONE[result.status]}
          />
        </div>
        <p className="text-[11px] text-muted-foreground font-mono">
          {formatDateTime(result.startedAt)} → {result.completedAt ? formatDateTime(result.completedAt) : "—"}
        </p>
        {result.output && (
          <p className="text-[11px] text-muted-foreground mt-0.5">Sortie: {result.output}</p>
        )}
        {result.error && (
          <p className="text-[11px] text-status-danger mt-0.5">Erreur: {result.error}</p>
        )}
      </div>
    </div>
  );
}

export function WorkflowRunDetailDrawer({
  run,
  open,
  onOpenChange,
}: {
  run: WorkflowRun | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  return (
    <UnifiedModal
      open={open}
      onOpenChange={onOpenChange}
      variant="drawer"
      size="lg"
      icon={Activity}
      iconTone="primary"
      title={run ? `Exécution — ${run.workflowName}` : "Exécution"}
      description={run ? `Déclenché par ${run.actorName}` : undefined}
      hideFooter
    >
      {run && (
        <div className="space-y-4">
          {/* Summary grid */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <SummaryCell label="Statut">
              <StatusChip
                label={WORKFLOW_RUN_STATUS_LABELS_FR[run.status]}
                tone={STATUS_TONE[run.status]}
              />
            </SummaryCell>
            <SummaryCell label="Déclencheur">
              <span className="text-xs text-foreground">{WORKFLOW_TRIGGER_LABELS_FR[run.triggerType]}</span>
            </SummaryCell>
            <SummaryCell label="Durée">
              <span className="text-xs font-mono text-foreground">{run.durationMs} ms</span>
            </SummaryCell>
            <SummaryCell label="Début">
              <span className="text-xs font-mono text-foreground">{formatDateTime(run.startedAt)}</span>
            </SummaryCell>
          </div>
          {run.error && (
            <div className="rounded-md border border-status-danger/30 bg-status-danger/10 px-3 py-2 text-sm text-status-danger">
              <p className="font-medium">Erreur globale</p>
              <p className="text-xs mt-0.5">{run.error}</p>
            </div>
          )}
          {/* Node timeline */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
              Résultats par nœud
            </p>
            <div className="rounded-md border border-border bg-card px-3">
              {run.nodeResults.length === 0 ? (
                <p className="text-xs text-muted-foreground py-3 text-center">
                  Aucun nœud exécuté (workflow vide)
                </p>
              ) : (
                run.nodeResults.map((r) => <NodeResultRow key={r.nodeId} result={r} />)
              )}
            </div>
          </div>
        </div>
      )}
    </UnifiedModal>
  );
}

function SummaryCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-card p-2.5 space-y-1">
      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
      {children}
    </div>
  );
}

/** Re-export the clock icon so callers can reuse it. */
export const ClockIcon = Clock;
