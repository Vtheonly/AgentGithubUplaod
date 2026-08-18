/**
 * Manager dashboard — team supervision.
 *
 * A Manager supervises one or more teams. Surfaces:
 *   - KPIs (team headcount, open tasks, pending leave, attendance today)
 *   - Team roster (employees whose supervisorId === me OR departmentId === my dept)
 *   - Team tasks with status chips + inline status updates
 *   - Pending requests from team members with approve / reject
 *   - "Create task" modal routed through `<AutoFormModal>`
 *
 * Refactored to consume `<RoleDashboardLayout>` + `<AutoFormModal>` so the
 * KPI row, task list, activity feed, and creation modal all flow through the
 * shared UI primitives instead of bespoke markup and hand-rolled form state.
 */
import { useMemo, useState } from "react";
import {
  Users, ListTodo, ClipboardList, CalendarClock, CheckCircle2, XCircle,
  Plus,
} from "lucide-react";
import { z } from "zod";
import { useRepositories } from "../../../app/providers/repository-provider";
import { useObservable } from "../../../shared/hooks/use-observable";
import { useAuth } from "../../../app/providers/auth-provider";
import { useToast } from "../../../app/providers/toast-provider";
import { AutoFormModal, type AutoFormField } from "../../../shared/ui/auto-form";
import { StatusChip } from "../../../shared/ui/status-chip";
import { Button } from "../../../shared/ui/button";
import { Avatar, AvatarFallback } from "../../../shared/ui/avatar";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../../../shared/ui/select";
import {
  RoleDashboardLayout,
  type DashboardKpi,
  type DashboardTask,
  type DashboardFeedItem,
} from "./role-dashboard-layout";
import {
  TASK_PRIORITY_LABELS_FR,
  TASK_STATUS_LABELS_FR,
  REQUEST_TYPE_LABELS_FR,
  REQUEST_STATUS_LABELS_FR,
  type TaskPriority,
  type TaskStatus,
} from "../../../domain/model/workforce";
import { PERSONNEL_STATUS_LABELS_FR, type Personnel } from "../../../domain/model/personnel";

const todayIso = () => new Date().toISOString().slice(0, 10);

const TASK_STATUS_TONE: Record<TaskStatus, "neutral" | "info" | "warning" | "danger" | "success"> = {
  pending: "neutral",
  assigned: "info",
  in_progress: "warning",
  blocked: "danger",
  completed: "success",
  cancelled: "neutral",
};

const CreateTaskSchema = z.object({
  title: z.string().min(3, "Titre requis (min. 3 caractères)"),
  description: z.string().optional().default(""),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  assigneeId: z.string().optional().default(""),
  dueDate: z.string().optional().default(""),
});

type CreateTaskFormData = z.infer<typeof CreateTaskSchema>;

export function ManagerDashboard() {
  const repos = useRepositories();
  const { session } = useAuth();
  const toast = useToast();

  const personnel = useObservable(() => repos.personnel.observe(), []);
  const tasks = useObservable(() => repos.tasks.observe(), []);
  const leaveRequests = useObservable(() => repos.leaveRequests.observe(), []);
  const todayAttendance = useObservable(
    () => repos.workforceAttendance.observeByDate(todayIso()),
    [],
  );

  const [createTaskOpen, setCreateTaskOpen] = useState(false);

  const me = useObservable(
    () => repos.personnel.observeByUserId(session?.userId ?? ""),
    [session?.userId],
  );

  const teamMembers = useMemo<Personnel[]>(() => {
    if (!me) return [];
    return personnel.filter(
      (p) => p.id !== me.id && (p.supervisorId === me.id || p.departmentId === me.departmentId),
    );
  }, [personnel, me]);

  const teamIds = useMemo(() => new Set(teamMembers.map((p) => p.id)), [teamMembers]);

  const teamTasks = useMemo(
    () => tasks.filter((t) => t.assigneeIds.some((id) => teamIds.has(id)) || (me && t.departmentId === me.departmentId)),
    [tasks, teamIds, me],
  );

  const openTeamTasks = useMemo(
    () => teamTasks.filter((t) => t.status !== "completed" && t.status !== "cancelled"),
    [teamTasks],
  );

  const teamLeaveRequests = useMemo(
    () => leaveRequests.filter((r) => teamIds.has(r.personnelId) || (me && r.personnelId === me.id)),
    [leaveRequests, teamIds, me],
  );
  const pendingTeamRequests = useMemo(
    () => teamLeaveRequests.filter((r) => r.status === "pending"),
    [teamLeaveRequests],
  );

  const attendanceRate = useMemo(() => {
    if (teamMembers.length === 0) return 0;
    const clockedIn = todayAttendance.filter((e) => teamIds.has(e.personnelId) && e.eventType === "clock_in").length;
    return Math.round((clockedIn / teamMembers.length) * 100);
  }, [todayAttendance, teamMembers, teamIds]);

  async function handleDecide(requestId: string, status: "approved" | "rejected") {
    if (!session) return;
    const result = await repos.leaveRequests.decide(
      requestId, status, session.userId, session.displayName,
      status === "approved" ? "Approuvé par le responsable" : "Refusé par le responsable",
    );
    if (result.ok) {
      toast.showSuccess(
        status === "approved" ? "Demande approuvée" : "Demande refusée",
        "La décision a été enregistrée.",
      );
    } else {
      toast.showError("Erreur", result.error.userMessage);
    }
  }

  async function handleUpdateTaskStatus(taskId: string, status: TaskStatus) {
    if (!session) return;
    const result = await repos.tasks.updateTaskStatus(taskId, status, session.userId);
    if (result.ok) {
      toast.showSuccess("Tâche mise à jour", `Statut : ${TASK_STATUS_LABELS_FR[status]}.`);
    } else {
      toast.showError("Erreur", result.error.userMessage);
    }
  }

  async function handleCreateTask(data: CreateTaskFormData) {
    if (!session) return;
    const result = await repos.tasks.createTask({
      title: data.title,
      description: data.description ?? "",
      priority: data.priority as TaskPriority,
      departmentId: me?.departmentId ?? null,
      assigneeIds: data.assigneeId ? [data.assigneeId] : [],
      dueDate: data.dueDate || null,
      createdBy: session.userId,
      createdByName: session.displayName,
    });
    if (result.ok) {
      toast.showSuccess("Tâche créée", "La tâche a été affectée à l'équipe.");
      setCreateTaskOpen(false);
    } else {
      throw new Error(result.error.userMessage);
    }
  }

  const kpis: readonly DashboardKpi[] = [
    { label: "Effectif équipe", value: teamMembers.length, icon: Users, trend: `${teamMembers.filter((p) => p.status === "active").length} actifs` },
    { label: "Tâches ouvertes", value: openTeamTasks.length, icon: ListTodo },
    { label: "Demandes en attente", value: pendingTeamRequests.length, icon: ClipboardList, trend: pendingTeamRequests.length > 0 ? "À traiter" : undefined },
    { label: "Assiduité aujourd'hui", value: `${attendanceRate}%`, icon: CalendarClock },
  ];

  const dashboardTasks: readonly DashboardTask[] = pendingTeamRequests.slice(0, 5).map((req) => ({
    id: req.id,
    label: `${req.personnelName} — ${REQUEST_TYPE_LABELS_FR[req.type]}`,
    description: `${req.fromDate} → ${req.toDate}${req.reason ? ` : ${req.reason}` : ""}`,
    priority: "high",
  }));

  const feed: readonly DashboardFeedItem[] = openTeamTasks.slice(0, 6).map((t) => ({
    id: t.id,
    label: t.title,
    description: `${TASK_PRIORITY_LABELS_FR[t.priority]}${t.dueDate ? ` · Échéance ${t.dueDate}` : ""}`,
    timestamp: TASK_STATUS_LABELS_FR[t.status],
    icon: ListTodo,
  }));

  const createTaskFields: readonly AutoFormField[] = [
    { name: "title", label: "Titre", type: "text", required: true, wide: true, placeholder: "Ex. Préparer commande manuels" },
    {
      name: "priority", label: "Priorité", type: "select", required: true,
      options: [
        { label: "Basse", value: "low" },
        { label: "Moyenne", value: "medium" },
        { label: "Haute", value: "high" },
        { label: "Urgente", value: "urgent" },
      ],
    },
    {
      name: "assigneeId", label: "Assigner à", type: "select",
      options: [
        { label: "— Non assignée —", value: "" },
        ...teamMembers.map((m) => ({ label: `${m.firstName} ${m.lastName}`, value: m.id })),
      ],
    },
    { name: "dueDate", label: "Échéance", type: "date" },
    { name: "description", label: "Description", type: "textarea", wide: true },
  ];

  return (
    <>
      <RoleDashboardLayout
        role="Responsable"
        actorName={session?.displayName ?? "Responsable"}
        kpis={kpis}
        tasks={dashboardTasks}
        feed={feed}
        actions={[
          { label: "Créer une tâche", icon: Plus, variant: "default", onClick: () => setCreateTaskOpen(true) },
        ]}
      >
        {/* Team roster */}
        <div className="rounded-lg border bg-card p-4">
          <h3 className="text-sm font-semibold mb-3">Équipe ({teamMembers.length})</h3>
          {teamMembers.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Aucun membre d'équipe rattaché.</p>
          ) : (
            <ul className="divide-y divide-border">
              {teamMembers.map((p) => (
                <li key={p.id} className="py-2.5 flex items-center gap-3">
                  <Avatar className="size-9">
                    <AvatarFallback>{`${p.firstName[0]}${p.lastName[0]}`.toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{p.firstName} {p.lastName}</p>
                    <p className="text-xs text-muted-foreground truncate">{p.position}</p>
                  </div>
                  <StatusChip
                    label={PERSONNEL_STATUS_LABELS_FR[p.status]}
                    tone={p.status === "active" ? "success" : p.status === "on_leave" ? "warning" : "neutral"}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Team tasks with inline status updates */}
        <div className="rounded-lg border bg-card p-4">
          <h3 className="text-sm font-semibold mb-3">Tâches de l'équipe</h3>
          {teamTasks.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Aucune tâche affectée à l'équipe.</p>
          ) : (
            <ul className="divide-y divide-border">
              {teamTasks.slice(0, 8).map((task) => (
                <li key={task.id} className="py-3 flex items-center gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{task.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {TASK_PRIORITY_LABELS_FR[task.priority]}
                      {task.dueDate ? ` · Échéance ${task.dueDate}` : ""}
                    </p>
                  </div>
                  <StatusChip label={TASK_STATUS_LABELS_FR[task.status]} tone={TASK_STATUS_TONE[task.status]} />
                  {task.status !== "completed" && task.status !== "cancelled" && (
                    <Select onValueChange={(v) => handleUpdateTaskStatus(task.id, v as TaskStatus)}>
                      <SelectTrigger className="h-8 w-40 text-xs">
                        <SelectValue placeholder="Changer le statut" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="in_progress">En cours</SelectItem>
                        <SelectItem value="blocked">Bloquée</SelectItem>
                        <SelectItem value="completed">Terminée</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Pending leave requests with approve / reject */}
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold">Demandes à traiter</h3>
            <StatusChip label={`${pendingTeamRequests.length} en attente`} tone="warning" />
          </div>
          {pendingTeamRequests.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Aucune demande en attente.</p>
          ) : (
            <ul className="divide-y divide-border">
              {pendingTeamRequests.map((req) => (
                <li key={req.id} className="py-3 flex items-center gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{req.personnelName}</p>
                    <p className="text-xs text-muted-foreground">
                      {REQUEST_TYPE_LABELS_FR[req.type]} · {req.fromDate} → {req.toDate}
                    </p>
                    {req.reason && <p className="text-xs text-muted-foreground mt-0.5 italic">« {req.reason} »</p>}
                  </div>
                  <StatusChip label={REQUEST_STATUS_LABELS_FR[req.status]} tone="warning" />
                  <div className="flex gap-2 shrink-0">
                    <Button size="sm" variant="outline" onClick={() => handleDecide(req.id, "rejected")}>
                      <XCircle className="size-3.5" /> Refuser
                    </Button>
                    <Button size="sm" onClick={() => handleDecide(req.id, "approved")}>
                      <CheckCircle2 className="size-3.5" /> Approuver
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </RoleDashboardLayout>

      <AutoFormModal
        open={createTaskOpen}
        onOpenChange={setCreateTaskOpen}
        title="Créer une tâche d'équipe"
        description="Affectez une tâche à un membre de l'équipe."
        schema={CreateTaskSchema}
        fields={createTaskFields}
        initialValues={{ priority: "medium" }}
        onSubmit={handleCreateTask}
        submitLabel="Créer la tâche"
      />
    </>
  );
}
