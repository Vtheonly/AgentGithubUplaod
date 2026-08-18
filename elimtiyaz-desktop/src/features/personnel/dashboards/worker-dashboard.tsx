/**
 * Worker dashboard — clock in/out, tasks, leave, supervisor contact.
 *
 * A general worker sees their assigned tasks, clocks in/out, requests leave,
 * and communicates with their supervisor.
 *
 * Refactored to consume `<RoleDashboardLayout>` (KPI row + task list + leave
 * feed) and `<AutoFormModal>` (leave-request form). The clock-in/out card is
 * preserved as `children` since it is a stateful control that doesn't fit the
 * layout's KPI/task/feed slots.
 */
import { useMemo, useState } from "react";
import {
  ClipboardList, CheckCircle2, CalendarClock, Clock,
  Plus, PlayCircle, StopCircle, PauseCircle, RotateCcw,
  AlertCircle, MessageSquare,
} from "lucide-react";
import { z } from "zod";
import { useRepositories } from "../../../app/providers/repository-provider";
import { useObservable } from "../../../shared/hooks/use-observable";
import { useAuth } from "../../../app/providers/auth-provider";
import { useToast } from "../../../app/providers/toast-provider";
import { AutoFormModal, type AutoFormField } from "../../../shared/ui/auto-form";
import { StatusChip } from "../../../shared/ui/status-chip";
import { Button } from "../../../shared/ui/button";
import {
  RoleDashboardLayout,
  type DashboardKpi,
  type DashboardTask,
  type DashboardFeedItem,
} from "./role-dashboard-layout";
import {
  REQUEST_TYPE_LABELS_FR,
  REQUEST_STATUS_LABELS_FR,
  TASK_STATUS_LABELS_FR,
  type AttendanceEventType,
  type RequestType,
  type TaskStatus,
} from "../../../domain/model/workforce";

const todayIso = () => new Date().toISOString().slice(0, 10);

const REQUEST_TONE = {
  pending: "warning", approved: "success", rejected: "danger", cancelled: "neutral",
} as const;

const TASK_STATUS_TONE: Record<TaskStatus, "neutral" | "info" | "warning" | "danger" | "success"> = {
  pending: "neutral",
  assigned: "info",
  in_progress: "warning",
  blocked: "danger",
  completed: "success",
  cancelled: "neutral",
};

type ClockState = "out" | "in" | "break";

const CLOCK_STATE_LABEL_FR: Record<ClockState, string> = {
  out: "Non pointé",
  in: "En service",
  break: "En pause",
};

function clockStateFromEvent(eventType: AttendanceEventType | null): ClockState {
  if (!eventType) return "out";
  if (eventType === "clock_in" || eventType === "break_end") return "in";
  if (eventType === "break_start") return "break";
  return "out";
}

const LeaveSchema = z.object({
  type: z.enum(["leave", "absence", "overtime", "shift_swap", "remote"]),
  fromDate: z.string().min(1, "Date de début requise"),
  toDate: z.string().min(1, "Date de fin requise"),
  reason: z.string().optional().default(""),
});

type LeaveFormData = z.infer<typeof LeaveSchema>;

const leaveFields: readonly AutoFormField[] = [
  {
    name: "type", label: "Type de demande", type: "select", required: true, wide: true,
    options: [
      { label: "Congé", value: "leave" },
      { label: "Absence", value: "absence" },
      { label: "Heures supplémentaires", value: "overtime" },
      { label: "Échange de poste", value: "shift_swap" },
      { label: "Télétravail", value: "remote" },
    ],
  },
  { name: "fromDate", label: "Du", type: "date", required: true },
  { name: "toDate", label: "Au", type: "date", required: true },
  { name: "reason", label: "Motif", type: "textarea", wide: true, placeholder: "Précisez le motif de la demande…" },
];

export function WorkerDashboard() {
  const repos = useRepositories();
  const { session } = useAuth();
  const toast = useToast();

  const personnel = useObservable(() => repos.personnel.observe(), []);
  const allTasks = useObservable(
    () => session ? repos.tasks.observeByAssignee(session.userId) : repos.tasks.observe(),
    [session?.userId],
  );
  const myLeave = useObservable(
    () => session ? repos.leaveRequests.observeByPersonnel(session.userId) : repos.leaveRequests.observe(),
    [session?.userId],
  );

  const [leaveOpen, setLeaveOpen] = useState(false);
  const [clockTick, setClockTick] = useState(0);

  const me = useObservable(
    () => repos.personnel.observeByUserId(session?.userId ?? ""),
    [session?.userId],
  );
  const personnelId = me?.id ?? session?.userId ?? "";

  const today = todayIso();
  const latestEvent = useMemo(
    () => repos.workforceAttendance.latestFor(personnelId, today),
    [repos.workforceAttendance, personnelId, today, clockTick],
  );
  const clockState = clockStateFromEvent(latestEvent?.eventType ?? null);

  const myTasks = useMemo(
    () => allTasks.filter((t) => t.status !== "cancelled"),
    [allTasks],
  );
  const completedThisWeek = useMemo(
    () => myTasks.filter((t) => t.status === "completed").length,
    [myTasks],
  );
  const pendingLeave = useMemo(
    () => myLeave.filter((r) => r.status === "pending").length,
    [myLeave],
  );

  const supervisor = useMemo(
    () => personnel.find((p) => p.id === (me?.supervisorId ?? null)) ?? null,
    [personnel, me?.supervisorId],
  );

  async function recordEvent(eventType: AttendanceEventType) {
    if (!session) return;
    const result = await repos.workforceAttendance.recordEvent({
      personnelId, date: today, eventType,
    });
    if (result.ok) {
      setClockTick((t) => t + 1);
      toast.showSuccess(
        CLOCK_STATE_LABEL_FR[clockStateFromEvent(eventType)],
        "Événement de pointage enregistré.",
      );
    } else {
      toast.showError("Erreur", "Impossible d'enregistrer le pointage.");
    }
  }

  async function updateTaskStatus(taskId: string, status: TaskStatus) {
    if (!session) return;
    const result = await repos.tasks.updateTaskStatus(taskId, status, session.userId);
    if (result.ok) {
      toast.showSuccess("Tâche mise à jour", `Statut : ${TASK_STATUS_LABELS_FR[status]}.`);
    } else {
      toast.showError("Erreur", "Impossible de mettre à jour la tâche.");
    }
  }

  async function handleLeaveSubmit(data: LeaveFormData) {
    if (!session) return;
    const result = await repos.leaveRequests.submit({
      personnelId,
      personnelName: session.displayName,
      type: data.type as RequestType,
      fromDate: data.fromDate,
      toDate: data.toDate,
      reason: data.reason?.trim() ?? "",
    });
    if (result.ok) {
      toast.showSuccess("Demande envoyée", "Votre superviseur a été notifié.");
      setLeaveOpen(false);
    } else {
      throw new Error(result.error.userMessage);
    }
  }

  const kpis: readonly DashboardKpi[] = [
    { label: "Tâches affectées", value: myTasks.length, icon: ClipboardList },
    { label: "Terminées cette semaine", value: completedThisWeek, icon: CheckCircle2 },
    { label: "Demandes en attente", value: pendingLeave, icon: CalendarClock },
    { label: "Heures cette semaine", value: `${me?.weeklyHoursLogged ?? 0}h`, icon: Clock, trend: `Objectif : ${me?.weeklyHoursTarget ?? 0}h` },
  ];

  const tasks: readonly DashboardTask[] = myTasks.slice(0, 6).map((t) => ({
    id: t.id,
    label: t.title,
    description: t.dueDate ? `Échéance : ${t.dueDate}` : "Sans échéance",
    priority: t.priority === "urgent" || t.priority === "high" ? "high" : "medium",
  }));

  const feed: readonly DashboardFeedItem[] = myLeave.slice(0, 5).map((r) => ({
    id: r.id,
    label: `${REQUEST_TYPE_LABELS_FR[r.type]} · ${r.fromDate} → ${r.toDate}`,
    description: r.reason || undefined,
    timestamp: REQUEST_STATUS_LABELS_FR[r.status],
    icon: CalendarClock,
  }));

  return (
    <>
      <RoleDashboardLayout
        role="Ouvrier"
        actorName={session?.displayName ?? "Ouvrier"}
        kpis={kpis}
        tasks={tasks}
        feed={feed}
        actions={[
          { label: "Demander un congé", icon: Plus, variant: "default", onClick: () => setLeaveOpen(true) },
        ]}
      >
        {/* Clock-in / out card — stateful, doesn't fit KPI/task/feed slots */}
        <div className="rounded-lg border bg-card p-5">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-4">
              <div className={`h-12 w-12 rounded-full flex items-center justify-center ${
                clockState === "in" ? "bg-status-success/15 text-status-success"
                : clockState === "break" ? "bg-status-warning/15 text-status-warning"
                : "bg-muted text-muted-foreground"
              }`}>
                <Clock className="h-6 w-6" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">État du pointage</p>
                <p className="text-xl font-semibold">{CLOCK_STATE_LABEL_FR[clockState]}</p>
                {latestEvent && (
                  <p className="text-xs text-muted-foreground">
                    Dernier événement : {new Date(latestEvent.timestamp).toLocaleTimeString("fr-FR")}
                  </p>
                )}
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              {clockState === "out" && (
                <Button size="sm" onClick={() => recordEvent("clock_in")}>
                  <PlayCircle className="size-4" /> Pointer l'arrivée
                </Button>
              )}
              {clockState === "in" && (
                <>
                  <Button size="sm" variant="outline" onClick={() => recordEvent("break_start")}>
                    <PauseCircle className="size-4" /> Pause
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => recordEvent("clock_out")}>
                    <StopCircle className="size-4" /> Pointer le départ
                  </Button>
                </>
              )}
              {clockState === "break" && (
                <>
                  <Button size="sm" onClick={() => recordEvent("break_end")}>
                    <RotateCcw className="size-4" /> Reprise
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => recordEvent("clock_out")}>
                    <StopCircle className="size-4" /> Pointer le départ
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* My tasks with inline status actions */}
        <div className="rounded-lg border bg-card p-4">
          <h3 className="text-sm font-semibold mb-3">Mes tâches</h3>
          {myTasks.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Aucune tâche ne vous est affectée pour le moment.</p>
          ) : (
            <ul className="divide-y divide-border">
              {myTasks.slice(0, 8).map((task) => (
                <li key={task.id} className="py-3 flex items-center gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{task.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {task.dueDate ? `Échéance ${task.dueDate}` : "Sans échéance"}
                    </p>
                  </div>
                  <StatusChip label={TASK_STATUS_LABELS_FR[task.status]} tone={TASK_STATUS_TONE[task.status]} />
                  {(task.status === "pending" || task.status === "assigned") && (
                    <Button size="sm" onClick={() => updateTaskStatus(task.id, "in_progress")}>
                      <PlayCircle className="size-4" /> Démarrer
                    </Button>
                  )}
                  {task.status === "in_progress" && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => updateTaskStatus(task.id, "blocked")}>
                        <AlertCircle className="size-4" /> Bloquer
                      </Button>
                      <Button size="sm" onClick={() => updateTaskStatus(task.id, "completed")}>
                        <CheckCircle2 className="size-4" /> Terminer
                      </Button>
                    </>
                  )}
                  {task.status === "blocked" && (
                    <Button size="sm" onClick={() => updateTaskStatus(task.id, "in_progress")}>
                      <PlayCircle className="size-4" /> Reprendre
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Supervisor contact card */}
        <div className="rounded-lg border bg-card p-4">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <MessageSquare className="size-4" /> Mon superviseur
          </h3>
          {supervisor ? (
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <p className="text-sm font-medium">{supervisor.firstName} {supervisor.lastName}</p>
                <p className="text-xs text-muted-foreground">{supervisor.position}</p>
                <p className="text-xs text-muted-foreground font-mono">{supervisor.phone}</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => toast.showInfo("Chat", "Canal de discussion à venir dans une prochaine itération.")}
              >
                <MessageSquare className="size-4" /> Envoyer un message
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-2">Aucun superviseur rattaché.</p>
          )}
        </div>
      </RoleDashboardLayout>

      <AutoFormModal
        open={leaveOpen}
        onOpenChange={setLeaveOpen}
        title="Demander un congé"
        description="Votre superviseur recevra une notification pour approbation."
        schema={LeaveSchema}
        fields={leaveFields}
        onSubmit={handleLeaveSubmit}
        submitLabel="Soumettre la demande"
      />
    </>
  );
}
