/**
 * TaskDetailDrawer — slide-over detail panel for a workforce Task.
 *
 * Refactored to consume `<EntityDetailDrawer<T>>` so the drawer chrome,
 * metadata grid, tab body, and sticky action bar all flow through the shared
 * primitive instead of hand-rolled `<UnifiedModal variant="drawer">` +
 * bespoke `Detail` helpers + nested modals. The delete confirmation now
 * uses `<ConfirmModal>` from the shared unified-modal family.
 */
import { useMemo, useState } from "react";
import { Trash2, CheckCircle2 } from "lucide-react";
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
import { ConfirmModal } from "../../../shared/ui/unified-modal";
import { formatDate } from "../../../core/format/date";
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

  const [confirmDelete, setConfirmDelete] = useState(false);

  const task = useMemo(
    () => allTasks.find((t) => t.id === taskId) ?? null,
    [allTasks, taskId],
  );

  async function handleComplete() {
    if (!session || !task) return;
    const res = await repos.tasks.updateTaskStatus(task.id, "completed", session.userId);
    if (res.ok) toast.showSuccess("Tâche terminée", `« ${task.title} » est maintenant terminée.`);
    else toast.showError("Erreur", res.error.userMessage);
  }

  async function handleDelete() {
    if (!task) return;
    const res = await repos.tasks.deleteTask(task.id);
    if (res.ok) {
      toast.showSuccess("Tâche supprimée", `« ${task.title} » a été supprimée.`);
      setConfirmDelete(false);
      onOpenChange(false);
    } else {
      toast.showError("Erreur", res.error.userMessage);
    }
  }

  const metadata = (t: Task): readonly EntityDrawerMetaItem[] => [
    { label: "Statut", value: TASK_STATUS_LABELS_FR[t.status] },
    { label: "Priorité", value: TASK_PRIORITY_LABELS_FR[t.priority] },
    { label: "Département", value: departments.find((d) => d.id === t.departmentId)?.name ?? "—" },
    { label: "Échéance", value: t.dueDate ? formatDate(t.dueDate) : "Sans date" },
    { label: "Créée par", value: t.createdByName },
    { label: "Progression", value: `${t.progress}%` },
  ];

  const tabs = (t: Task): readonly EntityDrawerTab<Task>[] => {
    const assigneeNames = personnel
      .filter((p) => t.assigneeIds.includes(p.id))
      .map((p) => `${p.firstName} ${p.lastName}`);

    return [
      {
        id: "details",
        label: "Détails & Activité",
        content: () => (
          <div className="space-y-4 text-sm">
            <div>
              <p className="text-xs uppercase text-muted-foreground">Description</p>
              <p className="mt-1 whitespace-pre-wrap">{t.description || "Aucune description."}</p>
            </div>
            {t.tags.length > 0 && (
              <div>
                <p className="text-xs uppercase text-muted-foreground">Étiquettes</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {t.tags.map((tag) => (
                    <span key={tag} className="rounded bg-muted px-1.5 py-0.5 text-[11px]">{tag}</span>
                  ))}
                </div>
              </div>
            )}
            <div>
              <p className="text-xs uppercase text-muted-foreground">Assignés ({t.assigneeIds.length})</p>
              {assigneeNames.length === 0 ? (
                <p className="mt-1 text-muted-foreground">Non assignée</p>
              ) : (
                <ul className="mt-1 space-y-0.5">
                  {assigneeNames.map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                </ul>
              )}
            </div>
            {t.comments.length > 0 && (
              <div>
                <p className="text-xs uppercase text-muted-foreground">Commentaires ({t.comments.length})</p>
                <ul className="mt-1 space-y-2">
                  {t.comments.map((c) => (
                    <li key={c.id} className="rounded border p-2">
                      <p className="text-xs font-medium">{c.authorName}</p>
                      <p className="mt-1 text-sm">{c.body}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ),
      },
    ];
  };

  const actions = (t: Task): readonly EntityDrawerAction<Task>[] => {
    const list: EntityDrawerAction<Task>[] = [];
    if (t.status !== "completed" && t.status !== "cancelled") {
      list.push({
        label: "Terminer",
        icon: <CheckCircle2 className="size-3.5" />,
        variant: "default",
        onClick: handleComplete,
      });
    }
    list.push({
      label: "Supprimer",
      icon: <Trash2 className="size-3.5" />,
      variant: "destructive",
      onClick: () => setConfirmDelete(true),
    });
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
