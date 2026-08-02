/**
 * WorkflowPage — Automatisations hub (plan §10).
 *
 * Two tabs (PageTabs):
 *   - Éditeur (variant="elevated", icon=Workflow): list of workflows on the
 *     left + DagCanvas + NodePalette on the right.
 *   - Exécutions (icon=Activity): filterable list of WorkflowRuns. Click a
 *     row → opens UnifiedModal variant="drawer" with full run detail.
 *
 * Sidebar entry "Automatisations" → route /workflow (between Personnel and
 * Tournées). Gated by ManageWorkflows OR ViewWorkflowRuns (feature-registry).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Workflow as WorkflowIcon,
  Activity,
  Plus,
  Filter as FilterIcon,
  Send,
  RefreshCw,
} from "lucide-react";
import { useRepositories } from "../../app/providers/repository-provider";
import { useAuth } from "../../app/providers/auth-provider";
import { useToast } from "../../app/providers/toast-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import { PageHeader } from "../../shared/layout/page-header";
import { PageTabs, PageTabList, PageTab, PageTabContent } from "../../shared/layout/page-tabs";
import { Card, CardContent } from "../../shared/ui/card";
import { Button } from "../../shared/ui/button";
import { StatusChip } from "../../shared/ui/status-chip";
import { Input } from "../../shared/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../shared/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../shared/ui/dropdown-menu";
import { UnifiedModal } from "../../shared/ui/unified-modal";
import { FormField } from "../../shared/ui/form-field";
import { Textarea } from "../../shared/ui/textarea";
import { formatDateTime, formatRelative } from "../../core/format/date";
import { Permission } from "../../core/rbac/permissions";
import {
  WORKFLOW_STATUS_LABELS_FR,
  WORKFLOW_RUN_STATUS_LABELS_FR,
  WORKFLOW_TRIGGER_LABELS_FR,
  WORKFLOW_RUN_STATUS_TONE,
  type Workflow,
  type WorkflowRun,
  type WorkflowRunStatus,
  type WorkflowStatus,
  type WorkflowTriggerType,
  type WorkflowNode,
  type WorkflowNodeSubtype,
  type WorkflowEdge,
  type WorkflowNodeType,
} from "../../domain/model/workflow";
import { DagCanvas, makeNode } from "./dag-canvas";
import { NodePalette } from "./node-palette";
import { WorkflowRunDetailDrawer } from "./workflow-run-detail-drawer";

const RUN_STATUS_TONE: Record<WorkflowRunStatus, "success" | "danger" | "warning" | "info"> = {
  succeeded: "success",
  failed: "danger",
  timeout: "warning",
  running: "info",
};

const STATUS_TONE: Record<WorkflowStatus, "neutral" | "success" | "warning"> = {
  draft: "neutral",
  deployed: "success",
  disabled: "warning",
};

export function WorkflowPage() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title={t("workflow.title")}
        description="Éditeur visuel de DAG + moniteur d'exécutions (plan §10)"
      />
      <PageTabs defaultValue="editor" className="flex-1 flex flex-col px-6 pb-6 min-h-0">
        <PageTabList>
          <PageTab value="editor" label={t("workflow.editor")} icon={WorkflowIcon} />
          <PageTab value="runs" label={t("workflow.runs")} icon={Activity} />
        </PageTabList>
        <PageTabContent value="editor">
          <EditorTab />
        </PageTabContent>
        <PageTabContent value="runs">
          <RunsTab />
        </PageTabContent>
      </PageTabs>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Editor tab                                                         */
/* ------------------------------------------------------------------ */

function EditorTab() {
  const { t } = useTranslation();
  const repos = useRepositories();
  const { session } = useAuth();
  const toast = useToast();
  const workflows = useObservable(() => repos.workflows.observe(), []);
  const [selectedId, setSelectedId] = useState<string | null>(workflows[0]?.id ?? null);
  const [newOpen, setNewOpen] = useState(false);

  const selected = workflows.find((w) => w.id === selectedId) ?? null;
  const canEdit = !!session && session.permissions.has(Permission.ManageWorkflows);

  async function handleSave(nodes: WorkflowNode[], edges: WorkflowEdge[]) {
    if (!selected || !session) return;
    const r = await repos.workflows.updateWorkflow(selected.id, { nodes, edges }, session.userId);
    if (r.ok) toast.showSuccess(t("workflow.save"), t("workflow.saved"));
    else toast.showError("Échec", r.error.userMessage);
  }

  async function handleDeploy() {
    if (!selected || !session) return;
    const r = await repos.workflows.deploy(selected.id, session.userId);
    if (r.ok) toast.showSuccess(t("workflow.deploy"), t("workflow.deployed"));
    else toast.showError("Échec", r.error.userMessage);
  }

  function handleAddNode(subtype: WorkflowNodeSubtype, type: WorkflowNodeType) {
    if (!selected || !session) return;
    const newNode = makeNode(subtype, type, selected.nodes);
    void repos.workflows.updateWorkflow(
      selected.id,
      { nodes: [...selected.nodes, newNode] },
      session.userId,
    );
  }

  return (
    <div className="flex gap-4 h-full min-h-0">
      {/* Workflow list (left) */}
      <Card className="w-72 shrink-0 flex flex-col">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Workflows ({workflows.length})
          </h3>
          <Button size="sm" variant="ghost" onClick={() => setNewOpen(true)} disabled={!canEdit}>
            <Plus className="h-3.5 w-3.5" /> Nouveau
          </Button>
        </div>
        <ul className="flex-1 overflow-y-auto divide-y divide-border">
          {workflows.length === 0 && (
            <li className="px-3 py-6 text-center text-xs text-muted-foreground">
              {t("workflow.noWorkflows")}
            </li>
          )}
          {workflows.map((w) => (
            <li
              key={w.id}
              className={cnRow(selectedId === w.id)}
              onClick={() => setSelectedId(w.id)}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{w.name}</p>
                <p className="text-[11px] text-muted-foreground truncate">{w.description}</p>
                <div className="flex items-center gap-2 mt-1">
                  <StatusChip
                    label={WORKFLOW_STATUS_LABELS_FR[w.status]}
                    tone={STATUS_TONE[w.status]}
                  />
                  <span className="text-[10px] text-muted-foreground">
                    {w.lastDeployedAt ? `Déployé ${formatRelative(w.lastDeployedAt)}` : "Jamais déployé"}
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      {/* Canvas + palette (right) */}
      <div className="flex-1 flex gap-3 min-h-0">
        {selected ? (
          <>
            <div className="flex-1 min-w-0">
              <DagCanvas
                workflow={selected}
                onChange={() => {
                  // DagCanvas owns its own state; we only persist on Save.
                  // No-op here to avoid parent re-renders during drag.
                }}
                onSave={handleSave}
                onDeploy={handleDeploy}
                canEdit={canEdit}
              />
            </div>
            <NodePalette onAddNode={handleAddNode} disabled={!canEdit} />
          </>
        ) : (
          <Card className="flex-1 flex items-center justify-center">
            <CardContent className="text-center text-sm text-muted-foreground p-6">
              {t("workflow.selectWorkflow")}
            </CardContent>
          </Card>
        )}
      </div>

      <NewWorkflowModal open={newOpen} onOpenChange={setNewOpen} onCreated={(id) => setSelectedId(id)} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  New Workflow modal                                                 */
/* ------------------------------------------------------------------ */

function NewWorkflowModal({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const repos = useRepositories();
  const { session } = useAuth();
  const toast = useToast();
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [triggerType, setTriggerType] = useState<WorkflowTriggerType>("manual");
  const [alert, setAlert] = useState<{ tone: "warning" | "error"; title: string; description?: string } | null>(null);

  function reset() {
    setName("");
    setDescription("");
    setTriggerType("manual");
    setAlert(null);
  }

  async function submit() {
    if (!session) return;
    if (!name.trim()) {
      setAlert({ tone: "warning", title: "Nom requis", description: "Donnez un nom au workflow." });
      return;
    }
    const r = await repos.workflows.createWorkflow({
      name: name.trim(),
      description: description.trim(),
      triggerType,
      createdBy: session.userId,
    });
    if (r.ok) {
      toast.showSuccess("Workflow créé", `${r.value.name} — brouillon prêt à éditer.`);
      onCreated(r.value.id);
      onOpenChange(false);
      setTimeout(reset, 200);
    } else {
      setAlert({ tone: "error", title: "Échec", description: r.error.userMessage });
    }
  }

  return (
    <UnifiedModal
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      variant="dialog"
      icon={Plus}
      iconTone="primary"
      title={t("workflow.new")}
      description="Crée un workflow vide (brouillon). Vous ajouterez des nœuds ensuite."
      submitLabel="Créer"
      submitIcon={Send}
      onSubmit={submit}
      alert={alert}
      onDismissAlert={() => setAlert(null)}
    >
      <div className="space-y-3">
        <FormField label="Nom" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Relance impayés" />
        </FormField>
        <FormField label="Description">
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Ce que fait ce workflow…"
            rows={3}
          />
        </FormField>
        <FormField label="Type de déclencheur">
          <Select value={triggerType} onValueChange={(v) => setTriggerType(v as WorkflowTriggerType)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(WORKFLOW_TRIGGER_LABELS_FR).map(([k, label]) => (
                <SelectItem key={k} value={k}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      </div>
    </UnifiedModal>
  );
}

/* ------------------------------------------------------------------ */
/*  Runs tab                                                           */
/* ------------------------------------------------------------------ */

function RunsTab() {
  const repos = useRepositories();
  const { session } = useAuth();
  const toast = useToast();
  const { t } = useTranslation();
  const allRuns = useObservable(() => repos.workflowRuns.observe(), []);
  const workflows = useObservable(() => repos.workflows.observe(), []);
  const [filterWorkflow, setFilterWorkflow] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [detailRunId, setDetailRunId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const runs = allRuns
    .filter((r) => filterWorkflow === "all" || r.workflowId === filterWorkflow)
    .filter((r) => filterStatus === "all" || r.status === filterStatus);

  const detailRun = allRuns.find((r) => r.id === detailRunId) ?? null;
  const canRetry = !!session && session.permissions.has(Permission.ManageWorkflows);

  async function retry(run: WorkflowRun) {
    if (!session) return;
    setRetrying(true);
    try {
      const r = await repos.workflowRuns.retryRun(run.id, session.userId, session.displayName);
      if (r.ok) toast.showSuccess(t("workflow.retry"), t("workflow.executed"));
      else toast.showError("Échec", r.error.userMessage);
    } finally {
      setRetrying(false);
    }
  }

  return (
    <Card className="flex flex-col h-full">
      <div className="flex items-center gap-2 border-b border-border p-3">
        <FilterIcon className="h-4 w-4 text-muted-foreground" />
        <Select value={filterWorkflow} onValueChange={setFilterWorkflow}>
          <SelectTrigger className="w-56"><SelectValue placeholder="Workflow" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous les workflows</SelectItem>
            {workflows.map((w) => (
              <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Statut" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous les statuts</SelectItem>
            {Object.entries(WORKFLOW_RUN_STATUS_LABELS_FR).map(([k, label]) => (
              <SelectItem key={k} value={k}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">{runs.length} exécution(s)</span>
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
              <th className="text-right font-medium px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {runs.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-xs text-muted-foreground">
                  Aucune exécution ne correspond aux filtres.
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
                <td className="px-3 py-2 font-medium text-foreground truncate max-w-[200px]">{r.workflowName}</td>
                <td className="px-3 py-2">
                  <StatusChip label={WORKFLOW_RUN_STATUS_LABELS_FR[r.status]} tone={RUN_STATUS_TONE[r.status]} />
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground font-mono">{formatDateTime(r.startedAt)}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground font-mono">{r.durationMs} ms</td>
                <td className="px-3 py-2 text-xs text-foreground truncate max-w-[160px]">{r.actorName}</td>
                <td className="px-3 py-2 text-right">
                  {canRetry && r.status !== "running" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        void retry(r);
                      }}
                      disabled={retrying}
                    >
                      <RefreshCw className="h-3.5 w-3.5" /> {t("workflow.retry")}
                    </Button>
                  )}
                </td>
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

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function cnRow(active: boolean): string {
  return [
    "flex items-center gap-2 px-3 py-2.5 cursor-pointer transition-colors",
    active ? "bg-primary/10 hover:bg-primary/15" : "hover:bg-accent/5",
  ].join(" ");
}
