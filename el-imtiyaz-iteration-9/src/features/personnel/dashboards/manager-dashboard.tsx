/**
 * Manager dashboard — team supervision (iteration 8 / 9 auth bridge fix).
 *
 * A Manager supervises one or more teams. Their dashboard surfaces:
 *   - Top-line KPIs (team headcount, open tasks, pending leave, attendance today)
 *   - Team roster (employees whose supervisorId === me OR departmentId === my dept)
 *   - Team tasks with status chips + inline status updates
 *   - Pending requests from team members with approve / reject
 *   - "Create task" modal routed through UnifiedModal
 *
 * Iteration 9: the displayName→personnel match hack is replaced by the new
 * PersonnelRepository.observeByUserId() bridge, which reacts to the live
 * personnel store instead of a string-equality lookup.
 */
import { useMemo, useState } from "react";
import {
  Users, ClipboardList, CalendarClock, CheckCircle2, XCircle,
  Plus, ListTodo, UserCheck, Activity,
} from "lucide-react";
import { useRepositories } from "../../../infrastructure/repository-provider";
import { useObservable } from "../../../shared/hooks/use-observable";
import { useAuth } from "../../../state/auth-context";
import { useToast } from "../../../state/toast-context";
import {
  TASK_PRIORITY_LABELS_FR,
  TASK_STATUS_LABELS_FR,
  REQUEST_TYPE_LABELS_FR,
  REQUEST_STATUS_LABELS_FR,
  type TaskPriority,
  type TaskStatus,
} from "../../../domain/model/workforce";
import { PERSONNEL_STATUS_LABELS_FR } from "../../../domain/model/personnel";
import { StatusChip } from "../../../shared/components/status-chip";
import { Button } from "../../../shared/ui/button";
import { Input } from "../../../shared/ui/input";
import { Label } from "../../../shared/ui/label";
import { Textarea } from "../../../shared/ui/textarea";
import { Avatar, AvatarFallback } from "../../../shared/ui/avatar";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../../../shared/ui/select";
import { UnifiedModal } from "../../../shared/components/unified-modal";
import {
  DashboardGrid, DashboardKpiRow, DashboardSection, KpiCard,
} from "./dashboard-primitives";

const TASK_STATUS_TONE: Record<TaskStatus, "neutral" | "info" | "warning" | "danger" | "success"> = {
  pending: "neutral",
  assigned: "info",
  in_progress: "warning",
  blocked: "danger",
  completed: "success",
  cancelled: "neutral",
};

const todayIso = () => new Date().toISOString().slice(0, 10);

export function ManagerDashboard() {
  const repos = useRepositories();
  const { session } = useAuth();
  const toast = useToast();

  const personnel = useObservable(() => repos.personnel.observe(), []);
  const departments = useObservable(() => repos.departments.observe(), []);
  const tasks = useObservable(() => repos.tasks.observe(), []);
  const leaveRequests = useObservable(() => repos.leaveRequests.observe(), []);
  const todayAttendance = useObservable(
    () => repos.workforceAttendance.observeByDate(todayIso()),
    [],
  );

  const [createTaskOpen, setCreateTaskOpen] = useState(false);

  // Iteration 9: resolve the manager's own personnel record via the
  // auth→personnel userId bridge (replaces the displayName string match).
  const me = useObservable(
    () => repos.personnel.observeByUserId(session?.userId ?? ""),
    [session?.userId],
  );

  const teamMembers = useMemo(() => {
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
      toast.showError("Erreur", "Impossible d'enregistrer la décision.");
    }
  }

  async function handleUpdateTaskStatus(taskId: string, status: TaskStatus) {
    if (!session) return;
    const result = await repos.tasks.updateTaskStatus(taskId, status, session.userId);
    if (result.ok) {
      toast.showSuccess("Tâche mise à jour", `Statut : ${TASK_STATUS_LABELS_FR[status]}.`);
    } else {
      toast.showError("Erreur", "Impossible de mettre à jour la tâche.");
    }
  }

  return (
    <DashboardGrid>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Tableau de bord Responsable</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {me ? `Équipe : ${me.position}` : "Supervision d'équipe, tâches, demandes et assiduité."}
          </p>
        </div>
        <Button size="sm" onClick={() => setCreateTaskOpen(true)}>
          <Plus className="h-4 w-4" /> Créer une tâche
        </Button>
      </div>

      <DashboardKpiRow>
        <KpiCard
          label="Effectif équipe"
          value={teamMembers.length.toString()}
          icon={<Users className="h-5 w-5" />}
          tone="default"
          hint={`${teamMembers.filter((p) => p.status === "active").length} actifs`}
        />
        <KpiCard
          label="Tâches ouvertes"
          value={openTeamTasks.length.toString()}
          icon={<ListTodo className="h-5 w-5" />}
          tone={openTeamTasks.length > 0 ? "warning" : "default"}
        />
        <KpiCard
          label="Demandes en attente"
          value={pendingTeamRequests.length.toString()}
          icon={<ClipboardList className="h-5 w-5" />}
          tone={pendingTeamRequests.length > 0 ? "warning" : "default"}
        />
        <KpiCard
          label="Assiduité aujourd'hui"
          value={`${attendanceRate}%`}
          icon={<CalendarClock className="h-5 w-5" />}
          tone={attendanceRate >= 80 ? "success" : attendanceRate >= 50 ? "warning" : "danger"}
        />
      </DashboardKpiRow>

      <DashboardSection title="Équipe" icon={Users}>
        {teamMembers.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            Aucun membre d'équipe rattaché.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {teamMembers.map((p) => (
              <li key={p.id} className="py-2.5 flex items-center gap-3">
                <Avatar className="h-9 w-9">
                  <AvatarFallback>{p.firstName[0]}{p.lastName[0]}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {p.firstName} {p.lastName}
                  </p>
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
      </DashboardSection>

      <DashboardSection
        title="Tâches de l'équipe"
        icon={ListTodo}
        action={<span className="text-xs text-muted-foreground">{openTeamTasks.length} ouverte(s)</span>}
      >
        {teamTasks.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Aucune tâche affectée à l'équipe.</p>
        ) : (
          <ul className="divide-y divide-border">
            {teamTasks.slice(0, 8).map((task) => (
              <li key={task.id} className="py-3 flex items-center gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{task.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {TASK_PRIORITY_LABELS_FR[task.priority]}
                    {task.dueDate ? ` • Échéance ${task.dueDate}` : ""}
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
      </DashboardSection>

      <DashboardSection
        title="Demandes à traiter"
        icon={ClipboardList}
        action={<StatusChip label={`${pendingTeamRequests.length} en attente`} tone="warning" />}
      >
        {pendingTeamRequests.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Aucune demande en attente.</p>
        ) : (
          <ul className="divide-y divide-border">
            {pendingTeamRequests.map((req) => (
              <li key={req.id} className="py-3 flex items-center gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{req.personnelName}</p>
                  <p className="text-xs text-muted-foreground">
                    {REQUEST_TYPE_LABELS_FR[req.type]} • {req.fromDate} → {req.toDate}
                  </p>
                  {req.reason && (
                    <p className="text-xs text-muted-foreground mt-0.5 italic">« {req.reason} »</p>
                  )}
                </div>
                <StatusChip label={REQUEST_STATUS_LABELS_FR[req.status]} tone="warning" />
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => handleDecide(req.id, "rejected")}>
                    <XCircle className="h-4 w-4" /> Refuser
                  </Button>
                  <Button size="sm" onClick={() => handleDecide(req.id, "approved")}>
                    <CheckCircle2 className="h-4 w-4" /> Approuver
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </DashboardSection>

      <DashboardSection title="Activité assiduité du jour" icon={Activity}>
        {todayAttendance.filter((e) => teamIds.has(e.personnelId)).length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            Aucun pointage enregistré aujourd'hui pour l'équipe.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {todayAttendance
              .filter((e) => teamIds.has(e.personnelId))
              .slice(0, 6)
              .map((e) => {
                const member = teamMembers.find((m) => m.id === e.personnelId);
                return (
                  <li key={e.id} className="py-2 flex items-center gap-3">
                    <UserCheck className="h-4 w-4 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground truncate">
                        {member ? `${member.firstName} ${member.lastName}` : e.personnelId}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(e.timestamp).toLocaleTimeString("fr-FR")} — {e.eventType.replace("_", " ")}
                      </p>
                    </div>
                  </li>
                );
              })}
          </ul>
        )}
      </DashboardSection>

      <CreateTaskModal
        open={createTaskOpen}
        onOpenChange={setCreateTaskOpen}
        teamMembers={teamMembers}
        defaultDepartmentId={me?.departmentId ?? null}
      />
    </DashboardGrid>
  );
}

function CreateTaskModal({
  open,
  onOpenChange,
  teamMembers,
  defaultDepartmentId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teamMembers: readonly { id: string; firstName: string; lastName: string }[];
  defaultDepartmentId: string | null;
}) {
  const repos = useRepositories();
  const { session } = useAuth();
  const toast = useToast();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [assigneeId, setAssigneeId] = useState<string>("");
  const [dueDate, setDueDate] = useState<string>("");

  function reset() {
    setTitle(""); setDescription(""); setPriority("medium"); setAssigneeId(""); setDueDate("");
  }

  async function handleSubmit() {
    if (!session) return;
    if (!title.trim()) {
      toast.showWarning("Titre requis", "Veuillez saisir un titre de tâche.");
      return;
    }
    const result = await repos.tasks.createTask({
      title: title.trim(),
      description: description.trim(),
      priority,
      departmentId: defaultDepartmentId,
      assigneeIds: assigneeId ? [assigneeId] : [],
      dueDate: dueDate || null,
      createdBy: session.userId,
      createdByName: session.displayName,
    });
    if (result.ok) {
      toast.showSuccess("Tâche créée", "La tâche a été affectée à l'équipe.");
      reset();
      onOpenChange(false);
    } else {
      toast.showError("Erreur", "Impossible de créer la tâche.");
    }
  }

  return (
    <UnifiedModal
      open={open}
      onOpenChange={onOpenChange}
      title="Créer une tâche"
      description="Affectez une tâche à un membre de l'équipe."
      icon={Plus}
      size="md"
      submitLabel="Créer"
      submitIcon={CheckCircle2}
      onSubmit={handleSubmit}
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="task-title">Titre</Label>
          <Input id="task-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex. Préparer commande manuels" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="task-desc">Description</Label>
          <Textarea id="task-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Priorité</Label>
            <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Basse</SelectItem>
                <SelectItem value="medium">Moyenne</SelectItem>
                <SelectItem value="high">Haute</SelectItem>
                <SelectItem value="urgent">Urgente</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="task-due">Échéance</Label>
            <Input id="task-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Assigné à</Label>
          <Select value={assigneeId} onValueChange={setAssigneeId}>
            <SelectTrigger><SelectValue placeholder="Sélectionner un membre" /></SelectTrigger>
            <SelectContent>
              {teamMembers.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.firstName} {m.lastName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </UnifiedModal>
  );
}
