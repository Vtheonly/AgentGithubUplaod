/**
 * Worker dashboard — clock in/out, tasks, leave, supervisor contact
 * (iteration 8 / 9 auth bridge fix).
 *
 * A general worker sees their assigned tasks, clocks in/out, requests leave,
 * and communicates with their supervisor. Dashboard surfaces:
 *
 *   - KPIs (assigned tasks, completed this week, pending leave requests, hours this week)
 *   - Clock-in/out card at the top showing current status (uses
 *     repos.workforceAttendance.latestFor() — a synchronous test helper —
 *     to inspect today's most recent event)
 *   - "My tasks" list with inline Start / Complete / Block actions
 *   - "Request leave" UnifiedModal → repos.leaveRequests.submit()
 *   - My recent leave requests with status chips
 *   - Quick contact to supervisor (name + chat button placeholder)
 *
 * Iteration 9: the displayName→personnel match hack is replaced by the new
 * PersonnelRepository.observeByUserId() bridge.
 */
import { useMemo, useState } from "react";
import {
  ClipboardList, CheckCircle2, CalendarClock, Clock,
  Plus, PlayCircle, StopCircle, PauseCircle, RotateCcw,
  Send, AlertCircle, MessageSquare,
} from "lucide-react";
import { useRepositories } from "../../../infrastructure/repository-provider";
import { useObservable } from "../../../shared/hooks/use-observable";
import { useAuth } from "../../../state/auth-context";
import { useToast } from "../../../state/toast-context";
import {
  REQUEST_TYPE_LABELS_FR,
  REQUEST_STATUS_LABELS_FR,
  TASK_STATUS_LABELS_FR,
  type AttendanceEventType,
  type RequestType,
  type TaskStatus,
} from "../../../domain/model/workforce";
import { StatusChip } from "../../../shared/components/status-chip";
import { Button } from "../../../shared/ui/button";
import { Input } from "../../../shared/ui/input";
import { Label } from "../../../shared/ui/label";
import { Textarea } from "../../../shared/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../../../shared/ui/select";
import { UnifiedModal } from "../../../shared/components/unified-modal";
import {
  DashboardGrid, DashboardKpiRow, DashboardSection, KpiCard,
} from "./dashboard-primitives";

const todayIso = () => new Date().toISOString().slice(0, 10);
const REQUEST_TONE = {
  pending: "warning", approved: "success", rejected: "danger", cancelled: "neutral",
} as const;

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
  return "out"; // clock_out
}

const TASK_STATUS_TONE = {
  pending: "neutral", assigned: "info", in_progress: "warning",
  blocked: "danger", completed: "success", cancelled: "neutral",
} as const;

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
  const [clockTick, setClockTick] = useState(0); // re-render trigger after clock events

  // Iteration 9: resolve the worker's own personnel record via the
  // auth→personnel userId bridge (replaces the displayName string match).
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

  // Supervisor lookup
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

  return (
    <DashboardGrid>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Tableau de bord Ouvrier</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {me ? me.position : "Vos tâches, pointages et demandes."}
          </p>
        </div>
        <Button size="sm" onClick={() => setLeaveOpen(true)}>
          <Plus className="h-4 w-4" /> Demander un congé
        </Button>
      </div>

      {/* Clock-in / out card */}
      <div className="rounded-lg border border-border bg-card p-5">
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
              <p className="text-xl font-semibold text-foreground">{CLOCK_STATE_LABEL_FR[clockState]}</p>
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
                <PlayCircle className="h-4 w-4" /> Pointer l'arrivée
              </Button>
            )}
            {clockState === "in" && (
              <>
                <Button size="sm" variant="outline" onClick={() => recordEvent("break_start")}>
                  <PauseCircle className="h-4 w-4" /> Pause
                </Button>
                <Button size="sm" variant="outline" onClick={() => recordEvent("clock_out")}>
                  <StopCircle className="h-4 w-4" /> Pointer le départ
                </Button>
              </>
            )}
            {clockState === "break" && (
              <>
                <Button size="sm" onClick={() => recordEvent("break_end")}>
                  <RotateCcw className="h-4 w-4" /> Reprise
                </Button>
                <Button size="sm" variant="outline" onClick={() => recordEvent("clock_out")}>
                  <StopCircle className="h-4 w-4" /> Pointer le départ
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      <DashboardKpiRow>
        <KpiCard
          label="Tâches affectées"
          value={myTasks.length.toString()}
          icon={<ClipboardList className="h-5 w-5" />}
          tone={myTasks.length > 0 ? "warning" : "default"}
        />
        <KpiCard
          label="Terminées cette semaine"
          value={completedThisWeek.toString()}
          icon={<CheckCircle2 className="h-5 w-5" />}
          tone="success"
        />
        <KpiCard
          label="Demandes en attente"
          value={pendingLeave.toString()}
          icon={<CalendarClock className="h-5 w-5" />}
          tone={pendingLeave > 0 ? "warning" : "default"}
        />
        <KpiCard
          label="Heures cette semaine"
          value={`${me?.weeklyHoursLogged ?? 0}h`}
          icon={<Clock className="h-5 w-5" />}
          tone="info"
          hint={`Objectif : ${me?.weeklyHoursTarget ?? 0}h`}
        />
      </DashboardKpiRow>

      <DashboardSection title="Mes tâches" icon={ClipboardList}>
        {myTasks.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            Aucune tâche ne vous est affectée pour le moment.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {myTasks.slice(0, 8).map((task) => (
              <li key={task.id} className="py-3 flex items-center gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{task.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {task.dueDate ? `Échéance ${task.dueDate}` : "Sans échéance"}
                  </p>
                </div>
                <StatusChip label={TASK_STATUS_LABELS_FR[task.status]} tone={TASK_STATUS_TONE[task.status]} />
                {task.status === "pending" || task.status === "assigned" ? (
                  <Button size="sm" onClick={() => updateTaskStatus(task.id, "in_progress")}>
                    <PlayCircle className="h-4 w-4" /> Démarrer
                  </Button>
                ) : null}
                {task.status === "in_progress" && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => updateTaskStatus(task.id, "blocked")}>
                      <AlertCircle className="h-4 w-4" /> Bloquer
                    </Button>
                    <Button size="sm" onClick={() => updateTaskStatus(task.id, "completed")}>
                      <CheckCircle2 className="h-4 w-4" /> Terminer
                    </Button>
                  </>
                )}
                {task.status === "blocked" && (
                  <Button size="sm" onClick={() => updateTaskStatus(task.id, "in_progress")}>
                    <PlayCircle className="h-4 w-4" /> Reprendre
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </DashboardSection>

      <DashboardSection title="Mes demandes de congé" icon={CalendarClock}>
        {myLeave.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Aucune demande soumise.</p>
        ) : (
          <ul className="divide-y divide-border">
            {myLeave.slice(0, 6).map((r) => (
              <li key={r.id} className="py-2.5 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground truncate">
                    {REQUEST_TYPE_LABELS_FR[r.type]} • {r.fromDate} → {r.toDate}
                  </p>
                  {r.reason && <p className="text-xs text-muted-foreground truncate">« {r.reason} »</p>}
                </div>
                <StatusChip label={REQUEST_STATUS_LABELS_FR[r.status]} tone={REQUEST_TONE[r.status]} />
              </li>
            ))}
          </ul>
        )}
      </DashboardSection>

      <DashboardSection title="Mon superviseur" icon={MessageSquare}>
        {supervisor ? (
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-sm font-medium text-foreground">
                {supervisor.firstName} {supervisor.lastName}
              </p>
              <p className="text-xs text-muted-foreground">{supervisor.position}</p>
              <p className="text-xs text-muted-foreground font-mono">{supervisor.phone}</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => toast.showInfo("Chat", "Canal de discussion à venir dans une prochaine itération.")}
            >
              <MessageSquare className="h-4 w-4" /> Envoyer un message
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground py-4">Aucun superviseur rattaché.</p>
        )}
      </DashboardSection>

      <LeaveRequestModal
        open={leaveOpen}
        onOpenChange={setLeaveOpen}
        personnelId={personnelId}
        personnelName={session?.displayName ?? ""}
      />
    </DashboardGrid>
  );
}

function LeaveRequestModal({
  open, onOpenChange, personnelId, personnelName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  personnelId: string;
  personnelName: string;
}) {
  const repos = useRepositories();
  const toast = useToast();
  const [type, setType] = useState<RequestType>("leave");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");

  function reset() { setType("leave"); setFrom(""); setTo(""); setReason(""); }

  async function handleSubmit() {
    if (!from || !to) {
      toast.showWarning("Dates requises", "Veuillez saisir les dates de début et fin.");
      return;
    }
    const result = await repos.leaveRequests.submit({
      personnelId, personnelName, type, fromDate: from, toDate: to, reason: reason.trim(),
    });
    if (result.ok) {
      toast.showSuccess("Demande envoyée", "Votre superviseur a été notifié.");
      reset();
      onOpenChange(false);
    } else {
      toast.showError("Erreur", "Impossible de soumettre la demande.");
    }
  }

  return (
    <UnifiedModal
      open={open}
      onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}
      title="Demander un congé"
      description="Votre superviseur recevra une notification pour approbation."
      icon={Plus}
      size="md"
      submitLabel="Soumettre"
      submitIcon={Send}
      onSubmit={handleSubmit}
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label>Type de demande</Label>
          <Select value={type} onValueChange={(v) => setType(v as RequestType)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="leave">Congé</SelectItem>
              <SelectItem value="absence">Absence</SelectItem>
              <SelectItem value="overtime">Heures supplémentaires</SelectItem>
              <SelectItem value="shift_swap">Échange de poste</SelectItem>
              <SelectItem value="remote">Télétravail</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="leave-from">Du</Label>
            <Input id="leave-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="leave-to">Au</Label>
            <Input id="leave-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="leave-reason">Motif</Label>
          <Textarea id="leave-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      </div>
    </UnifiedModal>
  );
}
