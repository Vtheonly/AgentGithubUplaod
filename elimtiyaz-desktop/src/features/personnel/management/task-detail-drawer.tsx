// ============================================================================
// FILE: src/features/personnel/management/task-detail-drawer.tsx
// ============================================================================
/**
 * Task Detail Inspector & Review Drawer.
 *
 * Implements the administrative review step:
 *   - Super Admin / Manager reviews completion notes and validates or sends back.
 *   - Worker submits completion notes and progress updates.
 */

import { useMemo, useState } from "react";
import {
  Trash2,
  CheckCircle2,
  PlayCircle,
  RefreshCcw,
  Send,
  UserCheck,
} from "lucide-react";
import { useRepositories } from "../../../app/providers/repository-provider";
import { useObservable } from "../../../shared/hooks/use-observable";
import { useAuth } from "../../../app/providers/auth-provider";
import { useToast } from "../../../app/providers/toast-provider";
import {
  EntityDetailDrawer,
  type EntityDrawerTab,
  type EntityDrawerAction,
  type EntityDrawerMetaItem,
} from "../../../shared/ui/entity-drawer";
import { ConfirmModal, UnifiedModal } from "../../../shared/ui/unified-modal";
import { Button } from "../../../shared/ui/button";
import { Textarea } from "../../../shared/ui/textarea";
import { FormField } from "../../../shared/ui/form-field";
import { formatDate } from "../../../core/format/date";
import { Role } from "../../../core/rbac/roles";
import {
  TASK_PRIORITY_LABELS_FR,
  TASK_STATUS_LABELS_FR,
  type Task,
} from "../../../domain/model/workforce";

export function TaskDetailDrawer({
  taskId,
  open,
  onOpenChange,
}: {
  taskId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const repos = useRepositories();
  const { session } = useAuth();
  const toast = useToast();
  const allTasks = useObservable(() => repos.tasks.observe(), []);
  const departments = useObservable(() => repos.departments.observe(), []);
  const personnel = useObservable(() => repos.personnel.observe(), []);

  const isSuperAdmin =
    session?.role === Role.SuperAdmin ||
    session?.role === Role.FinancialOfficer ||
    session?.role === Role.Manager;

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [completionModalOpen, setCompletionModalOpen] = useState(false);
  const [completionNote, setCompletionNote] = useState("");

  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [reviewApproved, setReviewApproved] = useState(true);
  const [reviewNote, setReviewNote] = useState("");

  const task = useMemo(
    () => allTasks.find((t) => t.id === taskId) ?? null,
    [allTasks, taskId],
  );

  async function handleStartTask() {
    if (!session || !task) return;
    const res = await repos.tasks.updateTaskStatus(
      task.id,
      "in_progress",
      session.userId,
    );
    if (res.ok)
      toast.showSuccess(
        "Tâche en cours",
        `« ${task.title} » est maintenant en cours d'exécution.`,
      );
  }

  async function handleCompleteSubmit() {
    if (!session || !task) return;
    const nextStatus = isSuperAdmin ? "completed" : "needs_review";
    const res = await repos.tasks.updateTaskStatus(
      task.id,
      nextStatus,
      session.userId,
      completionNote.trim(),
    );
    if (res.ok) {
      toast.showSuccess(
        isSuperAdmin ? "Tâche validée" : "Tâche transmise pour validation",
        isSuperAdmin
          ? "La tâche est marquée terminée."
          : "L'administrateur a été notifié pour examen.",
      );
      setCompletionModalOpen(false);
      setCompletionNote("");
    }
  }

  async function handleReviewSubmit() {
    if (!session || !task) return;
    const res = await repos.tasks.reviewTask(
      task.id,
      reviewApproved,
      session.userId,
      session.displayName ?? "Super Admin",
      reviewNote.trim(),
    );
    if (res.ok) {
      toast.showSuccess(
        reviewApproved
          ? "Tâche validée et clôturée"
          : "Régularisation demandée",
        reviewApproved
          ? "La tâche est officiellement terminée."
          : "La tâche a été renvoyée à l'exécutant.",
      );
      setReviewModalOpen(false);
      setReviewNote("");
    }
  }

  async function handleDelete() {
    if (!task) return;
    const res = await repos.tasks.deleteTask(task.id);
    if (res.ok) {
      toast.showSuccess(
        "Tâche supprimée",
        `« ${task.title} » a été supprimée.`,
      );
      setConfirmDelete(false);
      onOpenChange(false);
    }
  }

  if (!task) return null;

  const metadata = (t: Task): readonly EntityDrawerMetaItem[] => [
    { label: "Statut", value: TASK_STATUS_LABELS_FR[t.status] },
    { label: "Priorité", value: TASK_PRIORITY_LABELS_FR[t.priority] },
    {
      label: "Département",
      value: departments.find((d) => d.id === t.departmentId)?.name ?? "—",
    },
    {
      label: "Échéance",
      value: t.dueDate ? formatDate(t.dueDate) : "Sans date",
    },
    { label: "Assignée par", value: t.createdByName },
    { label: "Progression", value: `${t.progress}%` },
  ];

  const tabs = (t: Task): readonly EntityDrawerTab<Task>[] => {
    const assigneeNames = personnel
      .filter((p) => t.assigneeIds.includes(p.id))
      .map((p) => `${p.firstName} ${p.lastName}`);

    return [
      {
        id: "details",
        label: "Détails & Suivi",
        content: () => (
          <div className="space-y-4 text-sm">
            <div>
              <p className="text-xs uppercase text-muted-foreground font-semibold">
                Description de la mission
              </p>
              <p className="mt-1 whitespace-pre-wrap text-foreground bg-muted/20 p-3 rounded-lg border">
                {t.description || "Aucune consigne spécifique."}
              </p>
            </div>

            {t.completionNote && (
              <div className="rounded-lg border border-status-success/30 bg-status-success/5 p-3">
                <p className="text-xs uppercase text-status-success font-semibold">
                  Note de fin de mission
                </p>
                <p className="text-xs text-foreground mt-1">
                  {t.completionNote}
                </p>
                {t.completedAt && (
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Transmis le {formatDate(t.completedAt)}
                  </p>
                )}
              </div>
            )}

            {t.reviewNote && (
              <div className="rounded-lg border border-status-warning/30 bg-status-warning/5 p-3">
                <p className="text-xs uppercase text-status-warning font-semibold">
                  Retour de l'administration
                </p>
                <p className="text-xs text-foreground mt-1">{t.reviewNote}</p>
              </div>
            )}

            <div>
              <p className="text-xs uppercase text-muted-foreground font-semibold">
                Collaborateur(s) responsable(s)
              </p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {assigneeNames.map((name) => (
                  <span
                    key={name}
                    className="px-2.5 py-1 rounded bg-muted text-xs font-medium text-foreground"
                  >
                    {name}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ),
      },
    ];
  };

  const actions = (t: Task): readonly EntityDrawerAction<Task>[] => {
    const list: EntityDrawerAction<Task>[] = [];

    if (t.status === "pending" || t.status === "assigned") {
      list.push({
        label: "Démarrer la tâche",
        icon: <PlayCircle className="size-3.5" />,
        variant: "default",
        onClick: handleStartTask,
      });
    }

    if (t.status === "in_progress") {
      list.push({
        label: isSuperAdmin ? "Marquer terminée" : "Soumettre pour validation",
        icon: <CheckCircle2 className="size-3.5" />,
        variant: "default",
        onClick: () => setCompletionModalOpen(true),
      });
    }

    if (isSuperAdmin && t.status === "needs_review") {
      list.push({
        label: "Examiner la réalisation",
        icon: <UserCheck className="size-3.5" />,
        variant: "default",
        onClick: () => setReviewModalOpen(true),
      });
    }

    if (isSuperAdmin) {
      list.push({
        label: "Supprimer",
        icon: <Trash2 className="size-3.5" />,
        variant: "destructive",
        onClick: () => setConfirmDelete(true),
      });
    }

    return list;
  };

  return (
    <>
      <EntityDetailDrawer<Task>
        open={open}
        onOpenChange={onOpenChange}
        entity={task}
        title={(t) => t.title}
        subtitle={(t) => TASK_STATUS_LABELS_FR[t.status]}
        metadata={metadata}
        tabs={tabs}
        actions={actions}
      />

      {/* Completion Modal */}
      {completionModalOpen && (
        <UnifiedModal
          open={completionModalOpen}
          onOpenChange={setCompletionModalOpen}
          title="Validation de la réalisation"
          description="Indiquez vos remarques ou livrables pour l'administration."
          submitLabel={
            isSuperAdmin ? "Clôturer la tâche" : "Transmettre pour validation"
          }
          onSubmit={handleCompleteSubmit}
          size="md"
        >
          <div className="space-y-3">
            <FormField label="Compte-rendu d'exécution (optionnel)">
              <Textarea
                value={completionNote}
                onChange={(e) => setCompletionNote(e.target.value)}
                placeholder="Ex. Tâche terminée conformément aux consignes..."
                rows={3}
              />
            </FormField>
          </div>
        </UnifiedModal>
      )}

      {/* Admin Review Modal */}
      {reviewModalOpen && (
        <UnifiedModal
          open={reviewModalOpen}
          onOpenChange={setReviewModalOpen}
          title="Arbitrage et validation de la tâche"
          description={`Éxaminer le livrable transmis : « ${task.completionNote || "Aucune note transmise"} »`}
          submitLabel={
            reviewApproved ? "Valider & Clôturer" : "Demander une reprise"
          }
          submitVariant={reviewApproved ? "default" : "destructive"}
          onSubmit={handleReviewSubmit}
          size="md"
        >
          <div className="space-y-4">
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setReviewApproved(true)}
                className={`flex-1 p-3 rounded-lg border text-left transition-all ${
                  reviewApproved
                    ? "border-status-success bg-status-success/10 text-status-success"
                    : "border-border text-muted-foreground hover:bg-muted/20"
                }`}
              >
                <div className="flex items-center gap-1.5 font-bold text-xs">
                  <CheckCircle2 className="h-4 w-4" /> Valider (Travail
                  Conforme)
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">
                  La tâche passe au statut terminée.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setReviewApproved(false)}
                className={`flex-1 p-3 rounded-lg border text-left transition-all ${
                  !reviewApproved
                    ? "border-status-danger bg-status-danger/10 text-status-danger"
                    : "border-border text-muted-foreground hover:bg-muted/20"
                }`}
              >
                <div className="flex items-center gap-1.5 font-bold text-xs">
                  <RefreshCcw className="h-4 w-4" /> Demander une révision
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">
                  La tâche repasse en cours avec vos remarques.
                </p>
              </button>
            </div>

            <FormField label="Remarques de l'évaluateur">
              <Textarea
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
                placeholder="Ex. Excellent travail / Merci de compléter la section 2..."
                rows={3}
              />
            </FormField>
          </div>
        </UnifiedModal>
      )}

      <ConfirmModal
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Supprimer la tâche"
        description="Cette action est irréversible. Confirmez-vous la suppression définitive de cette tâche ?"
        confirmLabel="Supprimer définitivement"
        destructive
        onConfirm={handleDelete}
      />
    </>
  );
}
