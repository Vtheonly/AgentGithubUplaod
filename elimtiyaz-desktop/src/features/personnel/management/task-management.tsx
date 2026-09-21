// ============================================================================
// FILE: src/features/personnel/management/task-management.tsx
// ============================================================================
/**
 * Task Management Center.
 *
 * Provides complete task tracking:
 *   - Super Admin: Creates tasks, assigns workers, reviews completed tasks (`needs_review` -> `completed`).
 *   - Worker: Views assigned tasks, starts them (`in_progress`), and marks completed with note.
 */

import { useMemo, useState } from "react";
import {
  Plus,
  ClipboardList,
  CheckCircle2,
  PlayCircle,
  Eye,
} from "lucide-react";
import { useRepositories } from "../../../app/providers/repository-provider";
import { useObservable } from "../../../shared/hooks/use-observable";
import { useAuth } from "../../../app/providers/auth-provider";
import { useToast } from "../../../app/providers/toast-provider";
import { DashboardSection } from "../dashboards/role-dashboard-layout";
import { Button } from "../../../shared/ui/button";
import { Avatar, AvatarFallback } from "../../../shared/ui/avatar";
import { Progress } from "../../../shared/ui/progress";
import { StatusChip } from "../../../shared/ui/status-chip";
import {
  DataTable,
  type DataTableColumn,
  type DataTableAction,
} from "../../../shared/ui/data-table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../shared/ui/select";
import { formatDate } from "../../../core/format/date";
import { Role } from "../../../core/rbac/roles";
import {
  TASK_PRIORITY_LABELS_FR,
  TASK_STATUS_LABELS_FR,
  type Task,
  type TaskPriority,
  type TaskStatus,
} from "../../../domain/model/workforce";
import { TaskFormModal } from "./task-form-modal";
import { TaskDetailDrawer } from "./task-detail-drawer";

const PRIORITY_TONES: Record<
  TaskPriority,
  "success" | "warning" | "danger" | "neutral" | "info"
> = {
  low: "neutral",
  medium: "info",
  high: "warning",
  urgent: "danger",
};

const STATUS_TONES: Record<
  TaskStatus,
  "success" | "warning" | "danger" | "neutral" | "info"
> = {
  pending: "neutral",
  assigned: "info",
  in_progress: "warning",
  needs_review: "info",
  completed: "success",
  cancelled: "neutral",
};

const PRIORITIES: readonly TaskPriority[] = ["low", "medium", "high", "urgent"];

export function TaskManagement() {
  const repos = useRepositories();
  const { session } = useAuth();
  const toast = useToast();

  const canManageTasks =
    session?.role === Role.SuperAdmin || session?.role === Role.Manager;
  const currentUserId = session?.userId ?? "";

  const me = useObservable(
    () => repos.personnel.observeByUserId(currentUserId),
    [currentUserId, repos.personnel],
  );
  // T-371 (WORKFORCE-501) — assignee_ids stores ACCOUNT ids
  // (user_profiles.id per 0010/0019), so the self-filter matches on the
  // account id: me.userId when the dossier resolves, the session account id
  // otherwise. (The pre-T-371 personnel-id fallback never matched a row
  // under the schema's id space — the split-brain this task repairs.)
  const myAccountId = me?.userId ?? currentUserId;

  const allTasks = useObservable(() => repos.tasks.observe(), []);
  const departments = useObservable(() => repos.departments.observe(), []);
  const personnel = useObservable(() => repos.personnel.observe(), []);

  const [priorityFilter, setPriorityFilter] = useState<string>("");
  const [departmentFilter, setDepartmentFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");

  const [formOpen, setFormOpen] = useState(false);
  const [drawerId, setDrawerId] = useState<string | null>(null);

  const displayedTasks = useMemo(() => {
    if (canManageTasks) return allTasks;
    return allTasks.filter((t) => t.assigneeIds.includes(myAccountId));
  }, [allTasks, canManageTasks, myAccountId]);

  const filtered = useMemo(() => {
    return displayedTasks.filter((t) => {
      if (t.status === "cancelled") return false;
      if (priorityFilter && t.priority !== priorityFilter) return false;
      if (departmentFilter && t.departmentId !== departmentFilter) return false;
      if (statusFilter && t.status !== statusFilter) return false;
      return true;
    });
  }, [displayedTasks, priorityFilter, departmentFilter, statusFilter]);

  async function handleQuickAdvance(task: Task) {
    if (!session) return;
    if (task.status === "pending" || task.status === "assigned") {
      const res = await repos.tasks.updateTaskStatus(
        task.id,
        "in_progress",
        session.userId,
      );
      if (res.ok)
        toast.showSuccess(
          "Tâche démarrée",
          `« ${task.title} » est maintenant en cours.`,
        );
    } else if (task.status === "in_progress") {
      // If admin, mark directly completed; if worker, send for review
      const nextStatus: TaskStatus = canManageTasks
        ? "completed"
        : "needs_review";
      const res = await repos.tasks.updateTaskStatus(
        task.id,
        nextStatus,
        session.userId,
        "Terminé par le collaborateur.",
      );
      if (res.ok) {
        toast.showSuccess(
          canManageTasks ? "Tâche terminée" : "Transmise pour validation",
          canManageTasks
            ? "La tâche est clôturée."
            : "La direction a été notifiée pour validation.",
        );
      }
    }
  }

  const columns: readonly DataTableColumn<Task>[] = [
    {
      header: "Tâche & Mission",
      accessor: "title",
      cell: (t) => (
        <div className="min-w-0">
          <p className="font-semibold text-sm text-foreground truncate">
            {t.title}
          </p>
          {t.description && (
            <p className="text-xs text-muted-foreground truncate max-w-sm">
              {t.description}
            </p>
          )}
          {t.completionNote && (
            <p className="text-[11px] text-status-success italic truncate">
              Note : {t.completionNote}
            </p>
          )}
        </div>
      ),
    },
    {
      header: "Priorité",
      accessor: "priority",
      cell: (t) => (
        <StatusChip
          label={TASK_PRIORITY_LABELS_FR[t.priority]}
          tone={PRIORITY_TONES[t.priority]}
        />
      ),
    },
    {
      header: "Statut",
      accessor: "status",
      cell: (t) => (
        <StatusChip
          label={TASK_STATUS_LABELS_FR[t.status]}
          tone={STATUS_TONES[t.status]}
        />
      ),
    },
    {
      header: "Assigné(s)",
      accessor: (t) => t.assigneeIds.length,
      cell: (t) => {
        // T-371 — assignee_ids holds ACCOUNT ids; resolve names through
        // the personnel rows bound to those accounts (personnel.userId).
        const assignees = personnel.filter(
          (p) => p.userId !== null && t.assigneeIds.includes(p.userId),
        );
        if (assignees.length === 0) {
          return (
            <span className="text-xs text-muted-foreground">Non assignée</span>
          );
        }
        return (
          <div className="flex items-center gap-1">
            <div className="flex -space-x-2">
              {assignees.slice(0, 3).map((p) => (
                <Avatar
                  key={p.id}
                  className="size-7 border-2 border-background"
                >
                  <AvatarFallback className="text-[10px]">
                    {`${p.firstName[0] ?? ""}${p.lastName[0] ?? ""}`.toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              ))}
            </div>
            <span className="text-xs font-medium text-foreground ml-1">
              {assignees.map((p) => `${p.firstName} ${p.lastName}`).join(", ")}
            </span>
          </div>
        );
      },
    },
    {
      header: "Échéance",
      accessor: "dueDate",
      cell: (t) => (t.dueDate ? formatDate(t.dueDate) : "—"),
    },
    {
      header: "Progression",
      accessor: "progress",
      cell: (t) => (
        <div className="w-24">
          <Progress value={t.progress} />
          <p className="text-[10px] text-muted-foreground text-center mt-1 font-mono">
            {t.progress}%
          </p>
        </div>
      ),
    },
  ];

  const actions: readonly DataTableAction<Task>[] = [
    {
      label: "Démarrer / Valider",
      icon: <PlayCircle className="size-3.5" />,
      variant: "outline",
      disabled: (t) => t.status === "completed" || t.status === "cancelled",
      onClick: (t) => handleQuickAdvance(t),
    },
    {
      label: "Détails",
      icon: <Eye className="size-3.5" />,
      variant: "ghost",
      onClick: (t) => setDrawerId(t.id),
    },
  ];

  return (
    <>
      <DashboardSection
        title={
          canManageTasks
            ? "Gestion & Supervision des Tâches"
            : "Mes Tâches & Missions"
        }
        icon={ClipboardList}
        action={
          canManageTasks ? (
            <Button size="sm" onClick={() => setFormOpen(true)}>
              <Plus className="size-4" /> Assigner une tâche
            </Button>
          ) : undefined
        }
      >
        <DataTable<Task>
          data={filtered}
          columns={columns}
          actions={actions}
          searchFields={["title", "description"]}
          searchPlaceholder="Rechercher une tâche..."
          pageSize={10}
          onRowClick={(t) => setDrawerId(t.id)}
          toolbar={
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={statusFilter || "all"}
                onValueChange={(v) => setStatusFilter(v === "all" ? "" : v)}
              >
                <SelectTrigger className="w-[170px] h-9">
                  <SelectValue placeholder="Tous statuts" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous statuts</SelectItem>
                  <SelectItem value="assigned">Assignées</SelectItem>
                  <SelectItem value="in_progress">En cours</SelectItem>
                  <SelectItem value="needs_review">
                    À valider (Review)
                  </SelectItem>
                  <SelectItem value="completed">Terminées</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={priorityFilter || "all"}
                onValueChange={(v) => setPriorityFilter(v === "all" ? "" : v)}
              >
                <SelectTrigger className="w-[160px] h-9">
                  <SelectValue placeholder="Toutes priorités" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toutes priorités</SelectItem>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {TASK_PRIORITY_LABELS_FR[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {canManageTasks && (
                <Select
                  value={departmentFilter || "all"}
                  onValueChange={(v) =>
                    setDepartmentFilter(v === "all" ? "" : v)
                  }
                >
                  <SelectTrigger className="w-[180px] h-9">
                    <SelectValue placeholder="Tous départements" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tous départements</SelectItem>
                    {departments
                      .filter((d) => !d.archivedAt)
                      .map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          }
        />
      </DashboardSection>

      <TaskFormModal open={formOpen} onOpenChange={setFormOpen} />

      <TaskDetailDrawer
        taskId={drawerId}
        open={drawerId !== null}
        onOpenChange={(open) => !open && setDrawerId(null)}
      />
    </>
  );
}
