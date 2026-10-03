// ============================================================================
// FILE: elimtiyaz-desktop/src/features/personnel/management/employee-profile-drawer.tsx
// ============================================================================

import { useMemo, useState } from "react";
import {
  Edit,
  TrendingUp,
  TrendingDown,
  Download,
  Phone,
  Mail,
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
import { StatusChip } from "../../../shared/ui/status-chip";
import { Progress } from "../../../shared/ui/progress";
import { Button } from "../../../shared/ui/button";
import { Card, CardContent } from "../../../shared/ui/card";
import { formatDzd, formatDzdPlain } from "../../../core/format/currency";
import { formatDate, formatDateTime } from "../../../core/format/date";
import {
  STAFF_CATEGORY_LABELS_FR,
  PERSONNEL_STATUS_LABELS_FR,
  PAYROLL_METHOD_LABELS_FR,
  SALARY_ADJUSTMENT_TYPE_LABELS_FR,
  type Personnel,
} from "../../../domain/model/personnel";
import {
  TASK_PRIORITY_LABELS_FR,
  TASK_STATUS_LABELS_FR,
  ATTENDANCE_EVENT_LABELS_FR,
  // T-444/UI-324 restored: the Horaires & Shifts tab consumes these.
  SHIFT_TYPE_LABELS_FR,
  WEEKDAY_LABELS_FR,
} from "../../../domain/model/workforce";
import { Role } from "../../../core/rbac/roles";
import {
  generatePayslipPdf,
  downloadPdf,
} from "../../../infrastructure/receipt-pdf";

const STATUS_TONES: Record<
  string,
  "success" | "warning" | "danger" | "neutral"
> = {
  active: "success",
  on_leave: "warning",
  suspended: "danger",
  terminated: "neutral",
  archived: "neutral",
};

// T-444/UI-324 restored: the Tâches tab's status tones.
const TASK_STATUS_TONES: Record<
  string,
  "success" | "warning" | "danger" | "neutral" | "info"
> = {
  pending: "neutral",
  assigned: "info",
  in_progress: "warning",
  needs_review: "info",
  blocked: "danger",
  completed: "success",
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

  const today = new Date();
  const from = new Date(today);
  from.setDate(from.getDate() - 30);
  const fromIso = from.toISOString().slice(0, 10);
  const toIso = today.toISOString().slice(0, 10);

  const attendance = useObservable(
    () =>
      repos.workforceAttendance.observeByPersonnel(
        personnelId ?? "",
        fromIso,
        toIso,
      ),
    [personnelId, fromIso, toIso],
  );
  // T-444/UI-324 restored: the Horaires & Shifts tab's streams (1cead9d
  // deleted both the tab and its subscriptions).
  const schedules = useObservable(
    () => repos.schedules.observeByPersonnel(personnelId ?? ""),
    [personnelId],
  );
  const shifts = useObservable(() => repos.shifts.observe(), []);

  const personnel = useMemo(
    () => allPersonnel.find((p) => p.id === personnelId) ?? null,
    [allPersonnel, personnelId],
  );

  const [downloading, setDownloading] = useState(false);

  if (!personnel) return null;

  const canSeeSalary =
    session?.role === Role.SuperAdmin ||
    session?.role === Role.FinancialOfficer;
  const department =
    departments.find((d) => d.id === personnel.departmentId) ?? null;
  const supervisor =
    allPersonnel.find((p) => p.id === personnel.supervisorId) ?? null;
  // WORKFORCE-509 (T-480): tasks.assignee_ids stores ACCOUNT ids
  // (user_profiles.id per 0010/T-371) — the pre-T-480 filter matched the
  // PERSONNEL id against them and always returned zero tasks. Match on the
  // dossier's bound account id instead.
  const assignedTasks = allTasks.filter((t) =>
    personnel.userId !== null && t.assigneeIds.includes(personnel.userId),
  );
  // T-444/UI-324 restored: the shift assignment derivation (schedule rows
  // carry shift ids — the Set resolves the shift rows to render).
  const scheduledShiftIds = new Set<string>();
  for (const s of schedules)
    s.shiftIds.forEach((id) => scheduledShiftIds.add(id));
  const assignedShifts = shifts.filter((s) => scheduledShiftIds.has(s.id));

  const fill =
    personnel.weeklyHoursTarget > 0
      ? Math.round(
          (personnel.weeklyHoursLogged / personnel.weeklyHoursTarget) * 100,
        )
      : 0;

  async function handleDownloadPayslip() {
    if (!personnel) return;
    setDownloading(true);
    try {
      const pdfBytes = await generatePayslipPdf(personnel);
      const fileName = `fiche-paie-${personnel.firstName}-${personnel.lastName}.pdf`;
      downloadPdf(pdfBytes, fileName);
      toast.showSuccess("Fiche de paie téléchargée", fileName);
    } catch (e) {
      toast.showError("Erreur", String(e));
    } finally {
      setDownloading(false);
    }
  }

  const metadata = (p: Personnel): readonly EntityDrawerMetaItem[] => [
    { label: "Catégorie", value: STAFF_CATEGORY_LABELS_FR[p.staffCategory] },
    { label: "Poste", value: p.position || "—" },
    { label: "Département", value: department?.name ?? "Non affecté" },
    { label: "Statut", value: PERSONNEL_STATUS_LABELS_FR[p.status] },
  ];

  const tabs = (p: Personnel): readonly EntityDrawerTab<Personnel>[] => [
    {
      id: "personal",
      label: "Fiche Collaborateur",
      content: () => (
        <div className="space-y-4 text-sm">
          {/* Main Info Card */}
          <Card className="rounded-xl border border-border/80 bg-surface-panel shadow-sm">
            <CardContent className="p-4 space-y-3.5">
              <div className="flex items-center justify-between border-b border-border/50 pb-2.5">
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <UserCheck className="h-4 w-4 text-primary" /> Coordonnées &
                  Contrat
                </span>
                <StatusChip
                  label={PERSONNEL_STATUS_LABELS_FR[p.status]}
                  tone={STATUS_TONES[p.status] ?? "neutral"}
                />
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                    Téléphone
                  </span>
                  <span className="font-mono font-medium text-foreground text-sm">
                    {p.phone}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                    E-mail
                  </span>
                  <span className="text-foreground text-sm truncate block">
                    {p.email ?? "—"}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                    Date d'Embauche
                  </span>
                  <span className="text-foreground font-medium">
                    {formatDate(p.hireDate)}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                    N° National
                  </span>
                  <span className="font-mono text-muted-foreground">
                    {p.nationalId ?? "—"}
                  </span>
                </div>
                <div className="col-span-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                    Adresse
                  </span>
                  <span className="text-foreground">
                    {p.address ?? "Non renseignée"}
                  </span>
                </div>
              </div>

              {supervisor && (
                <div className="pt-2 border-t border-border/50 flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground">Supervisé par :</span>
                  <span className="font-semibold text-foreground">
                    {supervisor.firstName} {supervisor.lastName}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Emergency Contact */}
          {p.emergencyContact && (
            <Card className="rounded-xl border border-border/80 bg-surface-panel shadow-sm">
              <CardContent className="p-3.5 space-y-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                  Contact d'Urgence
                </span>
                <p className="text-sm font-semibold text-foreground">
                  {p.emergencyContact.name} ({p.emergencyContact.relation})
                </p>
                <p className="text-xs text-muted-foreground font-mono flex items-center gap-1">
                  <Phone className="h-3 w-3" /> {p.emergencyContact.phone}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Quick contact buttons */}
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1 h-8 text-xs"
              onClick={() => window.open(`tel:${p.phone}`)}
            >
              <Phone className="h-3.5 w-3.5 mr-1.5" /> Appeler
            </Button>
            {p.email && (
              <Button
                variant="outline"
                size="sm"
                className="flex-1 h-8 text-xs"
                onClick={() => window.open(`mailto:${p.email}`)}
              >
                <Mail className="h-3.5 w-3.5 mr-1.5" /> Envoyer un E-mail
              </Button>
            )}
          </div>
        </div>
      ),
    },
    {
      id: "salary",
      label: "Rémunération",
      content: () => (
        <div className="space-y-4 text-sm">
          {canSeeSalary ? (
            <>
              <div className="grid grid-cols-2 gap-3 p-4 rounded-xl border border-border bg-surface-panel shadow-sm">
                <div>
                  <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground block">
                    Salaire de Base Mensuel
                  </span>
                  <p className="text-2xl font-mono font-bold text-foreground mt-1">
                    {p.salary ? formatDzd(p.salary) : "Non défini"}
                  </p>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground block">
                    Mode de Règlement
                  </span>
                  <p className="text-sm font-semibold text-foreground mt-1">
                    {p.paymentMethod
                      ? PAYROLL_METHOD_LABELS_FR[p.paymentMethod]
                      : "Espèces"}
                  </p>
                  <p className="text-xs font-mono text-muted-foreground mt-0.5 truncate">
                    {p.bankAccount || "Sans RIB"}
                  </p>
                </div>
              </div>

              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleDownloadPayslip}
                  disabled={downloading}
                  className="h-8 text-xs gap-1.5"
                >
                  <Download className="h-3.5 w-3.5" /> Fiche de paie (PDF)
                </Button>
              </div>

              {/* Adjustments history */}
              <div className="space-y-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                  Historique des Ajustements
                </span>
                {(p.salaryAdjustments ?? []).length === 0 ? (
                  <p className="text-xs text-muted-foreground py-4 border border-dashed rounded-xl text-center">
                    Aucun ajustement antérieur enregistré.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {p.salaryAdjustments?.map((adj) => (
                      <div
                        key={adj.id}
                        className="p-3 rounded-xl border border-border/70 bg-surface-elevated/30 flex items-center justify-between text-xs"
                      >
                        <div className="space-y-0.5">
                          <span className="font-semibold text-foreground flex items-center gap-1">
                            {adj.delta > 0 ? (
                              <TrendingUp className="h-3.5 w-3.5 text-status-success" />
                            ) : (
                              <TrendingDown className="h-3.5 w-3.5 text-status-danger" />
                            )}
                            {SALARY_ADJUSTMENT_TYPE_LABELS_FR[adj.type]}
                          </span>
                          <p className="text-muted-foreground">{adj.reason}</p>
                        </div>
                        <span className="font-mono font-bold text-foreground">
                          {adj.delta > 0
                            ? `+${formatDzdPlain(adj.delta)}`
                            : formatDzdPlain(adj.delta)}{" "}
                          DA
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <p className="text-xs text-muted-foreground py-4 text-center">
              Accès aux données de salaire restreint à l'administration.
            </p>
          )}
        </div>
      ),
    },
    {
      // T-444/UI-324 restored: the Tâches tab (1cead9d deleted it while
      // keeping assignedTasks computed — the classic unused-consumer
      // fingerprint). Styled to the new UI's card language.
      id: "tasks",
      label: "Tâches",
      badge: () => assignedTasks.length,
      content: () =>
        assignedTasks.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            Aucune tâche assignée.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {assignedTasks.map((t) => (
              <li
                key={t.id}
                className="py-2.5 flex items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{t.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {TASK_PRIORITY_LABELS_FR[t.priority]}
                    {t.dueDate ? ` · Échéance ${formatDate(t.dueDate)}` : ""}
                  </p>
                </div>
                <StatusChip
                  label={TASK_STATUS_LABELS_FR[t.status]}
                  tone={TASK_STATUS_TONES[t.status] ?? "neutral"}
                />
              </li>
            ))}
          </ul>
        ),
    },
    {
      id: "attendance",
      label: "Pointages & Présence",
      badge: () => attendance.length,
      content: () => (
        <div className="space-y-3">
          <div>
            <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground block mb-1">
              Objectif Hebdomadaire
            </span>
            <div className="flex items-center gap-3">
              <Progress value={fill} className="h-2 flex-1" />
              <span className="font-mono text-xs font-semibold">
                {p.weeklyHoursLogged} / {p.weeklyHoursTarget} h
              </span>
            </div>
          </div>

          <div className="space-y-1.5">
            <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground block">
              Derniers Pointages (30 jours)
            </span>
            {attendance.length === 0 ? (
              <p className="text-xs text-muted-foreground py-6 text-center border border-dashed rounded-xl">
                Aucun pointage enregistré sur les 30 derniers jours.
              </p>
            ) : (
              <div className="space-y-1.5 max-h-80 overflow-y-auto">
                {attendance.slice(0, 15).map((e) => (
                  <div
                    key={e.id}
                    className="p-2.5 rounded-lg border border-border/60 bg-surface-elevated/20 flex items-center justify-between text-xs"
                  >
                    <div>
                      <p className="font-semibold text-foreground">
                        {ATTENDANCE_EVENT_LABELS_FR[e.eventType]}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {formatDate(e.date)}
                      </p>
                    </div>
                    <span className="font-mono text-muted-foreground text-[11px]">
                      {formatDateTime(e.timestamp)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ),
    },
    {
      // T-444/UI-324 restored: the Horaires & Shifts tab (1cead9d deleted
      // the tab AND its schedules/shifts streams).
      id: "schedule",
      label: "Horaires & Shifts",
      content: () => (
        <div className="space-y-4 text-sm">
          <div>
            <p className="text-xs uppercase text-muted-foreground">
              Volume hebdomadaire
            </p>
            <div className="mt-1 flex items-center gap-3">
              <Progress value={fill} />
              <span className="font-mono text-xs whitespace-nowrap">
                {p.weeklyHoursLogged} / {p.weeklyHoursTarget} h
              </span>
            </div>
          </div>
          {assignedShifts.length > 0 ? (
            <div>
              <p className="text-xs uppercase text-muted-foreground">
                Postes assignés
              </p>
              <ul className="mt-1 divide-y divide-border">
                {assignedShifts.map((s) => (
                  <li key={s.id} className="py-2">
                    <p className="text-sm font-medium">
                      {SHIFT_TYPE_LABELS_FR[s.shiftType] ?? s.shiftType}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {WEEKDAY_LABELS_FR[s.weekday]} · {s.startTime} →{" "}
                      {s.endTime}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-4 text-center">
              Aucun shift planifié.
            </p>
          )}
        </div>
      ),
    },
  ];

  const actions = (p: Personnel): readonly EntityDrawerAction<Personnel>[] => [
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
      widthClass="w-full sm:max-w-xl md:max-w-2xl"
      title={(p) => `${p.firstName} ${p.lastName}`}
      subtitle={(p) =>
        `${p.position || STAFF_CATEGORY_LABELS_FR[p.staffCategory]} · ${department?.name ?? "Sans département"}`
      }
      avatar={(p) => ({
        initials: `${p.firstName[0] ?? ""}${p.lastName[0] ?? ""}`.toUpperCase(),
      })}
      metadata={metadata}
      tabs={tabs}
      actions={actions}
    />
  );
}
