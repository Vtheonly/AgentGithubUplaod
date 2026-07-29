/**
 * WorkflowMonitorTab — Personnel page > Workflows tab (plan §10.04).
 *
 * Read-only list of the most recent 50 workflow runs across all workflows.
 * Click a row → opens a UnifiedModal variant="drawer" with the full run
 * detail (same component as the workflow page's Exécutions tab).
 *
 * No filters, no execute button — this is the "supervisor dashboard" view
 * that personnel with `ViewWorkflowRuns` permission can see. Full management
 * lives in the dedicated /workflow page.
 */
import { useState } from "react";
import { Activity } from "lucide-react";
import { useRepositories } from "../../infrastructure/repository-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import { Card } from "../../shared/ui/card";
import { StatusChip } from "../../shared/components/status-chip";
import { formatDateTime } from "../../core/format/date";
import {
  WORKFLOW_RUN_STATUS_LABELS_FR,
  type WorkflowRun,
  type WorkflowRunStatus,
} from "../../domain/model/workflow";
import { WorkflowRunDetailDrawer } from "../workflow/workflow-run-detail-drawer";

const RUN_STATUS_TONE: Record<WorkflowRunStatus, "success" | "danger" | "warning" | "info"> = {
  succeeded: "success",
  failed: "danger",
  timeout: "warning",
  running: "info",
};

const MAX_RUNS = 50;

export function WorkflowMonitorTab() {
  const repos = useRepositories();
  const allRuns = useObservable(() => repos.workflowRuns.observe(), []);
  const [detailRunId, setDetailRunId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // Sort by startedAt desc and cap to 50 to keep the list scannable.
  const runs = [...allRuns]
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, MAX_RUNS);

  const detailRun = allRuns.find((r) => r.id === detailRunId) ?? null;

  return (
    <Card className="flex flex-col h-full">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          <Activity className="h-3.5 w-3.5" />
          Exécutions récentes ({runs.length}/{MAX_RUNS})
        </h3>
        <span className="text-[11px] text-muted-foreground">
          Lecture seule — gestion complète sur la page Automatisations
        </span>
      </div>
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-card border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
            <tr>
              <th className="text-left font-medium px-3 py-2">Workflow</th>
              <th className="text-left font-medium px-3 py-2">Statut</th>
              <th className="text-left font-medium px-3 py-2">Début</th>
              <th className="text-left font-medium px-3 py-2">Durée</th>
              <th className="text-left font-medium px-3 py-2">Acteur</th>
            </tr>
          </thead>
          <tbody>
            {runs.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-xs text-muted-foreground">
                  Aucune exécution enregistrée.
                </td>
              </tr>
            )}
            {runs.map((r) => (
              <tr
                key={r.id}
                className="border-b border-border/60 hover:bg-accent/5 cursor-pointer"
                onClick={() => {
                  setDetailRunId(r.id);
                  setDetailOpen(true);
                }}
              >
                <td className="px-3 py-2 font-medium text-foreground truncate max-w-[220px]">{r.workflowName}</td>
                <td className="px-3 py-2">
                  <StatusChip label={WORKFLOW_RUN_STATUS_LABELS_FR[r.status]} tone={RUN_STATUS_TONE[r.status]} />
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground font-mono">{formatDateTime(r.startedAt)}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground font-mono">{r.durationMs} ms</td>
                <td className="px-3 py-2 text-xs text-foreground truncate max-w-[160px]">{r.actorName}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <WorkflowRunDetailDrawer
        run={detailRun}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />
    </Card>
  );
}
