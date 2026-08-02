/**
 * TaskManagement — full task board (Kanban-style) for administrators.
 *
 * Columns by status: pending / assigned / in_progress / blocked / completed
 * (cancelled tasks are omitted from the board for clarity — they are still
 * accessible via the drawer when navigated to directly).
 *
 * Each task card shows: title, priority chip, assignee avatars, due date,
 * progress bar, tags.
 *
 * Toolbar: New task button + filter bar (priority / department / assignee).
 * Click card → opens <UnifiedModal variant="drawer"> with full task detail.
 */
import { useMemo, useState } from "react";
import { Plus, ClipboardList, Calendar, Tag } from "lucide-react";
import { useRepositories } from "../../../app/providers/repository-provider";
import { useObservable } from "../../../shared/hooks/use-observable";
import { DashboardSection } from "../dashboards/dashboard-primitives";
import { Button } from "../../../shared/ui/button";
import { Avatar, AvatarFallback } from "../../../shared/ui/avatar";
import { Progress } from "../../../shared/ui/progress";
import { StatusChip } from "../../../shared/ui/status-chip";
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

const BOARD_COLUMNS: readonly TaskStatus[] = [
  "pending", "assigned", "in_progress", "blocked", "completed",
];

const COLUMN_TONES: Record<TaskStatus, "success" | "warning" | "danger" | "neutral" | "info"> = {
  pending: "neutral",
  assigned: "info",
  in_progress: "warning",
  blocked: "danger",
  completed: "success",
  cancelled: "neutral",
};

const PRIORITY_TONES: Record<TaskPriority, "success" | "warning" | "danger" | "neutral" | "info"> = {
  low: "neutral",
  medium: "info",
  high: "warning",
  urgent: "danger",
};

const PRIORITIES: readonly TaskPriority[] = ["low", "medium", "high", "urgent"];

const AVATAR_COLORS = [
  "bg-primary/15 text-primary",
  "bg-brand-blue-deep/15 text-brand-blue-deep",
  "bg-status-info/15 text-status-info",
  "bg-status-success/15 text-status-success",
  "bg-status-warning/15 text-status-warning",
  "bg-brand-brown/15 text-brand-brown",
];

function colorFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

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
  const [drawerOpen, setDrawerOpen] = useState(false);

  const filtered = useMemo(() => {
    return tasks.filter((t) => {
      if (t.status === "cancelled") return false;
      if (priorityFilter && t.priority !== priorityFilter) return false;
      if (departmentFilter && t.departmentId !== departmentFilter) return false;
      if (assigneeFilter && !t.assigneeIds.includes(assigneeFilter)) return false;
      return true;
    });
  }, [tasks, priorityFilter, departmentFilter, assigneeFilter]);

  const columns = useMemo(() => {
    const map = new Map<TaskStatus, Task[]>();
    for (const status of BOARD_COLUMNS) map.set(status, []);
    for (const t of filtered) {
      if (map.has(t.status)) map.get(t.status)!.push(t);
    }
    return map;
  }, [filtered]);

  function openTask(id: string) {
    setDrawerId(id);
    setDrawerOpen(true);
  }

  return (
    <>
      <DashboardSection
        title="Tableau des tâches"
        icon={ClipboardList}
        action={
          <Button size="sm" onClick={() => setFormOpen(true)}>
            <Plus className="h-4 w-4" /> Nouvelle tâche
          </Button>
        }
      >
        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <Select value={priorityFilter} onValueChange={(v) => setPriorityFilter(v === "all" ? "" : v)}>
            <SelectTrigger className="w-[160px]"><SelectValue placeholder="Toutes priorités" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes priorités</SelectItem>
              {PRIORITIES.map((p) => (
                <SelectItem key={p} value={p}>{TASK_PRIORITY_LABELS_FR[p]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={departmentFilter} onValueChange={(v) => setDepartmentFilter(v === "all" ? "" : v)}>
            <SelectTrigger className="w-[180px]"><SelectValue placeholder="Tous départements" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous départements</SelectItem>
              {departments.filter((d) => !d.archivedAt).map((d) => (
                <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={assigneeFilter} onValueChange={(v) => setAssigneeFilter(v === "all" ? "" : v)}>
            <SelectTrigger className="w-[200px]"><SelectValue placeholder="Tous assignés" /></SelectTrigger>
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

        {/* Kanban board */}
        <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-5 gap-3">
          {BOARD_COLUMNS.map((status) => (
            <div key={status} className="flex flex-col rounded-lg border border-border bg-muted/30 min-h-[200px]">
              <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                <span className="text-xs font-semibold uppercase tracking-wide text-foreground">
                  {TASK_STATUS_LABELS_FR[status]}
                </span>
                <StatusChip label={columns.get(status)!.length.toString()} tone={COLUMN_TONES[status]} />
              </div>
              <div className="flex-1 p-2 space-y-2 overflow-y-auto max-h-[400px]">
                {columns.get(status)!.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground text-center py-4">Aucune tâche.</p>
                ) : (
                  columns.get(status)!.map((t) => (
                    <TaskCard
                      key={t.id}
                      task={t}
                      personnel={personnel}
                      onClick={() => openTask(t.id)}
                    />
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      </DashboardSection>

      <TaskFormModal open={formOpen} onOpenChange={setFormOpen} />

      <TaskDetailDrawer
        taskId={drawerId}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
      />
    </>
  );
}

function TaskCard({
  task, personnel, onClick,
}: {
  task: Task;
  personnel: readonly { id: string; firstName: string; lastName: string }[];
  onClick: () => void;
}) {
  const assignees = personnel.filter((p) => task.assigneeIds.includes(p.id));
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left rounded-md border border-border bg-card p-2.5 hover:border-primary/40 hover:bg-accent/5 transition-colors space-y-2"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-foreground line-clamp-2 flex-1">{task.title}</p>
        <StatusChip label={TASK_PRIORITY_LABELS_FR[task.priority]} tone={PRIORITY_TONES[task.priority]} />
      </div>
      {task.description && (
        <p className="text-[11px] text-muted-foreground line-clamp-2">{task.description}</p>
      )}
      <Progress value={task.progress} />
      {task.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {task.tags.slice(0, 3).map((tag) => (
            <span key={tag} className="inline-flex items-center gap-0.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              <Tag className="h-2.5 w-2.5" /> {tag}
            </span>
          ))}
          {task.tags.length > 3 && (
            <span className="text-[10px] text-muted-foreground">+{task.tags.length - 3}</span>
          )}
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <div className="flex -space-x-1.5">
          {assignees.slice(0, 3).map((p) => (
            <Avatar key={p.id} className="h-5 w-5 border border-card">
              <AvatarFallback className={`text-[9px] ${colorFor(p.id)}`}>
                {p.firstName[0]}{p.lastName[0]}
              </AvatarFallback>
            </Avatar>
          ))}
          {assignees.length > 3 && (
            <span className="h-5 w-5 rounded-full bg-muted border border-card flex items-center justify-center text-[9px] text-muted-foreground">
              +{assignees.length - 3}
            </span>
          )}
          {assignees.length === 0 && (
            <span className="text-[10px] text-muted-foreground italic">Non affectée</span>
          )}
        </div>
        {task.dueDate && (
          <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
            <Calendar className="h-2.5 w-2.5" /> {formatDate(task.dueDate, "dd/MM")}
          </span>
        )}
      </div>
    </button>
  );
}
