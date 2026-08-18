/**
 * TaskManagement — unified task table for administrators.
 *
 * Refactored to consume `<DataTable<Task>>` so the search box, sortable
 * columns, row actions, and pagination all flow through the shared primitive
 * instead of a bespoke Kanban grid with hand-rolled filter state. The
 * previous 5-column Kanban view was visually appealing but duplicated search,
 * sorting, and pagination logic that `<DataTable>` already provides
 * declaratively.
 *
 * Each row shows: title, priority, status, assignee, due date, progress.
 * Click row → opens `<TaskDetailDrawer>`. Toolbar holds the priority /
 * department / assignee filters (still useful as discrete value-set filters)
 * plus the "New task" action.
 */
import { useMemo, useState } from "react";
import { Plus, ClipboardList } from "lucide-react";
import { useRepositories } from "../../../app/providers/repository-provider";
import { useObservable } from "../../../shared/hooks/use-observable";
import { DashboardSection } from "../dashboards/role-dashboard-layout";
import { Button } from "../../../shared/ui/button";
import { Avatar, AvatarFallback } from "../../../shared/ui/avatar";
import { Progress } from "../../../shared/ui/progress";
import { StatusChip } from "../../../shared/ui/status-chip";
import { DataTable, type DataTableColumn, type DataTableAction } from "../../../shared/ui/data-table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../../../shared/ui/select";
import { formatDate } from "../../../core/format/date";
import {
  TASK_PRIORITY_LABELS_FR,
  TASK_STATUS_LABELS_FR,
  type Task, type TaskPriority, type TaskStatus,
} from "../../../domain/model/workforce";
import { TaskFormModal } from "./task-form-modal";
import { TaskDetailDrawer } from "./task-detail-drawer";

const PRIORITY_TONES: Record<TaskPriority, "success" | "warning" | "danger" | "neutral" | "info"> = {
  low: "neutral",
  medium: "info",
  high: "warning",
  urgent: "danger",
};

const STATUS_TONES: Record<TaskStatus, "success" | "warning" | "danger" | "neutral" | "info"> = {
  pending: "neutral",
  assigned: "info",
  in_progress: "warning",
  blocked: "danger",
  completed: "success",
  cancelled: "neutral",
};

const PRIORITIES: readonly TaskPriority[] = ["low", "medium", "high", "urgent"];

export function TaskManagement() {
  const repos = useRepositories();
  const tasks = useObservable(() => repos.tasks.observe(), []);
  const departments = useObservable(() => repos.departments.observe(), []);
  const personnel = useObservable(() => repos.personnel.observe(), []);

  const [priorityFilter, setPriorityFilter] = useState<string>("");
  const [departmentFilter, setDepartmentFilter] = useState<string>("");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("");

  const [formOpen, setFormOpen] = useState(false);
  const [drawerId, setDrawerId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return tasks.filter((t) => {
      if (t.status === "cancelled") return false;
      if (priorityFilter && t.priority !== priorityFilter) return false;
      if (departmentFilter && t.departmentId !== departmentFilter) return false;
      if (assigneeFilter && !t.assigneeIds.includes(assigneeFilter)) return false;
      return true;
    });
  }, [tasks, priorityFilter, departmentFilter, assigneeFilter]);

  const columns: readonly DataTableColumn<Task>[] = [
    {
      header: "Tâche",
      accessor: "title",
      cell: (t) => (
        <div className="min-w-0">
          <p className="font-medium text-sm truncate">{t.title}</p>
          {t.description && <p className="text-xs text-muted-foreground truncate">{t.description}</p>}
        </div>
      ),
    },
    {
      header: "Priorité",
      accessor: "priority",
      cell: (t) => (
        <StatusChip label={TASK_PRIORITY_LABELS_FR[t.priority]} tone={PRIORITY_TONES[t.priority]} />
      ),
    },
    {
      header: "Statut",
      accessor: "status",
      cell: (t) => (
        <StatusChip label={TASK_STATUS_LABELS_FR[t.status]} tone={STATUS_TONES[t.status]} />
      ),
    },
    {
      header: "Assignés",
      accessor: (t) => t.assigneeIds.length,
      cell: (t) => {
        const assignees = personnel.filter((p) => t.assigneeIds.includes(p.id));
        if (assignees.length === 0) {
          return <span className="text-xs text-muted-foreground">Non assignée</span>;
        }
        return (
          <div className="flex -space-x-2">
            {assignees.slice(0, 3).map((p) => (
              <Avatar key={p.id} className="size-7 border-2 border-background">
                <AvatarFallback className="text-[10px]">
                  {`${p.firstName[0] ?? ""}${p.lastName[0] ?? ""}`.toUpperCase()}
                </AvatarFallback>
              </Avatar>
            ))}
            {assignees.length > 3 && (
              <div className="size-7 rounded-full bg-muted border-2 border-background flex items-center justify-center text-[10px] text-muted-foreground">
                +{assignees.length - 3}
              </div>
            )}
          </div>
        );
      },
    },
    {
      header: "Échéance",
      accessor: "dueDate",
      cell: (t) => t.dueDate ? formatDate(t.dueDate) : "—",
    },
    {
      header: "Progression",
      accessor: "progress",
      cell: (t) => (
        <div className="w-24">
          <Progress value={t.progress} />
          <p className="text-[10px] text-muted-foreground text-center mt-1 font-mono">{t.progress}%</p>
        </div>
      ),
    },
  ];

  const actions: readonly DataTableAction<Task>[] = [
    {
      label: "Détails",
      variant: "outline",
      onClick: (t) => setDrawerId(t.id),
    },
  ];

  return (
    <>
      <DashboardSection
        title="Tableau des tâches"
        icon={ClipboardList}
        action={
          <Button size="sm" onClick={() => setFormOpen(true)}>
            <Plus className="size-4" /> Nouvelle tâche
          </Button>
        }
      >
        <DataTable<Task>
          data={filtered}
          columns={columns}
          actions={actions}
          searchFields={["title", "description"]}
          searchPlaceholder="Rechercher une tâche…"
          pageSize={10}
          onRowClick={(t) => setDrawerId(t.id)}
          toolbar={
            <div className="flex flex-wrap items-center gap-2">
              <Select value={priorityFilter || "all"} onValueChange={(v) => setPriorityFilter(v === "all" ? "" : v)}>
                <SelectTrigger className="w-[160px] h-9"><SelectValue placeholder="Toutes priorités" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toutes priorités</SelectItem>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p}>{TASK_PRIORITY_LABELS_FR[p]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={departmentFilter || "all"} onValueChange={(v) => setDepartmentFilter(v === "all" ? "" : v)}>
                <SelectTrigger className="w-[180px] h-9"><SelectValue placeholder="Tous départements" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous départements</SelectItem>
                  {departments.filter((d) => !d.archivedAt).map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={assigneeFilter || "all"} onValueChange={(v) => setAssigneeFilter(v === "all" ? "" : v)}>
                <SelectTrigger className="w-[200px] h-9"><SelectValue placeholder="Tous assignés" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous assignés</SelectItem>
                  {personnel.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.firstName} {p.lastName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {(priorityFilter || departmentFilter || assigneeFilter) && (
                <Button variant="ghost" size="sm" onClick={() => { setPriorityFilter(""); setDepartmentFilter(""); setAssigneeFilter(""); }}>
                  Réinitialiser
                </Button>
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
