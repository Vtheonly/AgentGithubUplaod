/**
 * EmployeeProfileDrawer — slide-over showing the full profile of an employee.
 *
 * Refactored to consume `<EntityDetailDrawer<Person>>` so the drawer chrome,
 * avatar header, metadata grid, tabbed body, and sticky action bar all flow
 * through the shared primitive instead of hand-rolled `<UnifiedModal
 * variant="drawer">` + bespoke `Section` / `Detail` helpers. All live data
 * sources (personnel, departments, tasks, attendance, performance reviews,
 * schedules) are preserved.
 */
import { useMemo } from "react";
import { Edit, MessageSquare } from "lucide-react";
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
import { StatusChip } from "../../../shared/ui/status-chip";
import { Progress } from "../../../shared/ui/progress";
import { formatDzd } from "../../../core/format/currency";
import { formatDate, formatDateTime } from "../../../core/format/date";
import {
  STAFF_CATEGORY_LABELS_FR,
  PERSONNEL_STATUS_LABELS_FR,
  PAYROLL_METHOD_LABELS_FR,
  type Personnel,
} from "../../../domain/model/personnel";
import {
  TASK_PRIORITY_LABELS_FR,
  TASK_STATUS_LABELS_FR,
  ATTENDANCE_EVENT_LABELS_FR,
  SHIFT_TYPE_LABELS_FR,
  WEEKDAY_LABELS_FR,
} from "../../../domain/model/workforce";
import { Role } from "../../../core/rbac/roles";

const STATUS_TONES: Record<string, "success" | "warning" | "danger" | "neutral"> = {
  active: "success",
  on_leave: "warning",
  suspended: "danger",
  terminated: "neutral",
  archived: "neutral",
};

const TASK_STATUS_TONES: Record<string, "success" | "warning" | "danger" | "neutral" | "info"> = {
  pending: "neutral",
  assigned: "info",
  in_progress: "warning",
  blocked: "danger",
  completed: "success",
  cancelled: "neutral",
};

export function EmployeeProfileDrawer({
  personnelId,
  open,
  onOpenChange,
  onEdit,
}: {
  personnelId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: (id: string) => void;
}) {
  const repos = useRepositories();
  const { session } = useAuth();
  const toast = useToast();

  const allPersonnel = useObservable(() => repos.personnel.observe(), []);
  const departments = useObservable(() => repos.departments.observe(), []);
  const allTasks = useObservable(() => repos.tasks.observe(), []);
  const shifts = useObservable(() => repos.shifts.observe(), []);

  // Attendance window = last 30 days
  const today = new Date();
  const from = new Date(today);
  from.setDate(from.getDate() - 30);
  const fromIso = from.toISOString().slice(0, 10);
  const toIso = today.toISOString().slice(0, 10);

  const attendance = useObservable(
    () => repos.workforceAttendance.observeByPersonnel(personnelId ?? "", fromIso, toIso),
    [personnelId],
  );
  const reviews = useObservable(
    () => repos.performanceReviews.observeByPersonnel(personnelId ?? ""),
    [personnelId],
  );
  const schedules = useObservable(
    () => repos.schedules.observeByPersonnel(personnelId ?? ""),
    [personnelId],
  );

  const personnel = useMemo(
    () => allPersonnel.find((p) => p.id === personnelId) ?? null,
    [allPersonnel, personnelId],
  );

  if (!personnel) return null;

  const canSeeSalary = session?.role === Role.SuperAdmin || session?.role === Role.FinancialOfficer;
  const department = departments.find((d) => d.id === personnel.departmentId) ?? null;
  const supervisor = allPersonnel.find((p) => p.id === personnel.supervisorId) ?? null;
  const assignedTasks = allTasks.filter((t) => t.assigneeIds.includes(personnel.id));
  const fill = personnel.weeklyHoursTarget > 0
    ? Math.round((personnel.weeklyHoursLogged / personnel.weeklyHoursTarget) * 100)
    : 0;

  // Build set of shift ids across this person's schedules
  const scheduledShiftIds = new Set<string>();
  for (const s of schedules) s.shiftIds.forEach((id) => scheduledShiftIds.add(id));
  const assignedShifts = shifts.filter((s) => scheduledShiftIds.has(s.id));

  const metadata = (p: Personnel): readonly EntityDrawerMetaItem[] => {
    const list: EntityDrawerMetaItem[] = [
      { label: "Téléphone", value: p.phone },
      { label: "E-mail", value: p.email ?? "—" },
      { label: "Poste", value: p.position || "—" },
      { label: "Département", value: department?.name ?? "Non affecté" },
      { label: "Embauche", value: formatDate(p.hireDate) },
      { label: "Heures hebdo", value: `${p.weeklyHoursLogged} / ${p.weeklyHoursTarget} h` },
    ];
    if (canSeeSalary && p.salary != null) {
      list.push({ label: "Salaire", value: formatDzd(p.salary) });
    }
    if (supervisor) {
      list.push({ label: "Superviseur", value: `${supervisor.firstName} ${supervisor.lastName}` });
    }
    return list;
  };

  const tabs = (p: Personnel): readonly EntityDrawerTab<Personnel>[] => [
    {
      id: "personal",
      label: "Fiche Employé",
      content: () => (
        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs uppercase text-muted-foreground">Catégorie</p>
              <p className="font-medium">{STAFF_CATEGORY_LABELS_FR[p.staffCategory]}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-muted-foreground">Statut</p>
              <StatusChip
                label={PERSONNEL_STATUS_LABELS_FR[p.status]}
                tone={STATUS_TONES[p.status] ?? "neutral"}
              />
            </div>
            <div>
              <p className="text-xs uppercase text-muted-foreground">Date de naissance</p>
              <p>{p.dateOfBirth ? formatDate(p.dateOfBirth) : "—"}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-muted-foreground">N° national</p>
              <p className="font-mono">{p.nationalId ?? "—"}</p>
            </div>
            <div className="col-span-2">
              <p className="text-xs uppercase text-muted-foreground">Adresse</p>
              <p>{p.address ?? "—"}</p>
            </div>
          </div>
          {p.emergencyContact && (
            <div className="rounded-md border border-border p-3 bg-muted/30">
              <p className="text-[10px] uppercase text-muted-foreground mb-1">Contact d'urgence</p>
              <p className="font-medium">{p.emergencyContact.name} · {p.emergencyContact.relation}</p>
              <p className="text-xs text-muted-foreground font-mono">{p.emergencyContact.phone}</p>
            </div>
          )}
          {canSeeSalary && (
            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border">
              <div>
                <p className="text-xs uppercase text-muted-foreground">Méthode de paiement</p>
                <p>{p.paymentMethod ? PAYROLL_METHOD_LABELS_FR[p.paymentMethod] : "—"}</p>
              </div>
              <div>
                <p className="text-xs uppercase text-muted-foreground">Compte bancaire</p>
                <p className="font-mono">{p.bankAccount ?? "—"}</p>
              </div>
            </div>
          )}
        </div>
      ),
    },
    {
      id: "schedule",
      label: "Horaires",
      content: () => (
        <div className="space-y-4 text-sm">
          <div>
            <p className="text-xs uppercase text-muted-foreground">Heures hebdomadaires</p>
            <div className="mt-1 flex items-center gap-3">
              <Progress value={fill} />
              <span className="font-mono text-xs whitespace-nowrap">{p.weeklyHoursLogged} / {p.weeklyHoursTarget} h</span>
            </div>
          </div>
          {assignedShifts.length > 0 ? (
            <div>
              <p className="text-xs uppercase text-muted-foreground">Postes assignés</p>
              <ul className="mt-1 divide-y divide-border">
                {assignedShifts.map((s) => (
                  <li key={s.id} className="py-2">
                    <p className="text-sm font-medium">{SHIFT_TYPE_LABELS_FR[s.shiftType] ?? s.shiftType}</p>
                    <p className="text-xs text-muted-foreground">
                      {WEEKDAY_LABELS_FR[s.weekday]} · {s.startTime} → {s.endTime}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Aucun poste planifié.</p>
          )}
        </div>
      ),
    },
    {
      id: "tasks",
      label: "Tâches",
      badge: () => assignedTasks.length,
      content: () =>
        assignedTasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucune tâche assignée.</p>
        ) : (
          <ul className="divide-y divide-border">
            {assignedTasks.map((t) => (
              <li key={t.id} className="py-2.5 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{t.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {TASK_PRIORITY_LABELS_FR[t.priority]}
                    {t.dueDate ? ` · Échéance ${formatDate(t.dueDate)}` : ""}
                  </p>
                </div>
                <StatusChip label={TASK_STATUS_LABELS_FR[t.status]} tone={TASK_STATUS_TONES[t.status] ?? "neutral"} />
              </li>
            ))}
          </ul>
        ),
    },
    {
      id: "attendance",
      label: "Présence",
      badge: () => attendance.length,
      content: () =>
        attendance.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun pointage sur les 30 derniers jours.</p>
        ) : (
          <ul className="divide-y divide-border">
            {attendance.slice(0, 12).map((e) => (
              <li key={e.id} className="py-2 flex items-center justify-between">
                <div>
                  <p className="text-sm">{ATTENDANCE_EVENT_LABELS_FR[e.eventType]}</p>
                  <p className="text-xs text-muted-foreground">{formatDate(e.date)}</p>
                </div>
                <span className="text-xs text-muted-foreground">{formatDateTime(e.timestamp)}</span>
              </li>
            ))}
          </ul>
        ),
    },
    {
      id: "reviews",
      label: "Évaluations",
      badge: () => reviews.length,
      content: () =>
        reviews.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucune évaluation de performance enregistrée.</p>
        ) : (
          <ul className="divide-y divide-border">
            {reviews.map((r) => (
              <li key={r.id} className="py-2.5">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">Période {r.period}</p>
                  <StatusChip label={`${r.rating}/5`} tone="info" />
                </div>
                <p className="text-xs text-muted-foreground mt-1">{r.strengths || r.improvements || "—"}</p>
              </li>
            ))}
          </ul>
        ),
    },
  ];

  const actions = (p: Personnel): readonly EntityDrawerAction<Personnel>[] => [
    {
      label: "Ouvrir le chat",
      icon: <MessageSquare className="size-3.5" />,
      variant: "outline",
      onClick: () => toast.showInfo("Chat", `Chat ouvert avec ${p.firstName} ${p.lastName}`),
    },
    {
      label: "Modifier",
      icon: <Edit className="size-3.5" />,
      variant: "default",
      onClick: () => onEdit(p.id),
    },
  ];

  return (
    <EntityDetailDrawer<Personnel>
      open={open}
      onOpenChange={onOpenChange}
      entity={personnel}
      title={(p) => `${p.firstName} ${p.lastName}`}
      subtitle={(p) => p.position || STAFF_CATEGORY_LABELS_FR[p.staffCategory]}
      avatar={(p) => ({ initials: `${p.firstName[0] ?? ""}${p.lastName[0] ?? ""}`.toUpperCase() })}
      metadata={metadata}
      tabs={tabs}
      actions={actions}
    />
  );
}
