/**
 * EmployeeProfileDrawer — slide-over showing the full profile of an employee
 * (iteration 8 management module).
 *
 * Sections (all live from repositories):
 *   - Personal info (name, phone, email, address, DOB, national id, emergency contact)
 *   - Employment info (hire date, position, department, supervisor, salary, payment method, bank account)
 *   - Schedule (weekly hours target / logged + assigned shifts)
 *   - Assigned tasks (repos.tasks.observe() filtered by assigneeIds.includes(personnel.id))
 *   - Attendance history (repos.workforceAttendance.observeByPersonnel(id, from, to))
 *   - Performance reviews (repos.performanceReviews.observeByPersonnel(id))
 *   - Documents (mock list)
 *   - Internal notes (read-only)
 *
 * Footer actions: Edit (opens the form modal), Open chat (mock toast).
 */
import { useMemo } from "react";
import {
  UserCircle, Phone, Mail, MapPin, CalendarClock, Briefcase, Building2,
  CreditCard, FileText, ClipboardList, Star, MessageSquare, Edit, Pencil,
} from "lucide-react";
import { useRepositories } from "../../../app/providers/repository-provider";
import { useObservable } from "../../../shared/hooks/use-observable";
import { useAuth } from "../../../app/providers/auth-provider";
import { useToast } from "../../../app/providers/toast-provider";
import { UnifiedModal } from "../../../shared/ui/unified-modal";
import { Button } from "../../../shared/ui/button";
import { Avatar, AvatarFallback } from "../../../shared/ui/avatar";
import { Separator } from "../../../shared/ui/separator";
import { Progress } from "../../../shared/ui/progress";
import { StatusChip } from "../../../shared/ui/status-chip";
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

const STAFF_COLORS: Record<string, string> = {
  teacher: "bg-primary/15 text-primary",
  administration: "bg-brand-blue-deep/15 text-brand-blue-deep",
  support: "bg-status-warning/15 text-status-warning",
  maintenance: "bg-status-neutral/15 text-status-neutral",
  driver: "bg-status-info/15 text-status-info",
  buyer: "bg-status-info/15 text-status-info",
  warehouse: "bg-status-success/15 text-status-success",
  worker: "bg-brand-brown/15 text-brand-brown",
};

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

  // Subscribe to the live personnel list and look up by id (so edits re-render).
  const allPersonnel = useObservable(() => repos.personnel.observe(), []);
  const departments = useObservable(() => repos.departments.observe(), []);
  const allTasks = useObservable(() => repos.tasks.observe(), []);
  const shifts = useObservable(() => repos.shifts.observe(), []);

  const personnel = useMemo(
    () => allPersonnel.find((p) => p.id === personnelId) ?? null,
    [allPersonnel, personnelId],
  );

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

  if (!open || !personnelId || !personnel) return null;

  const canSeeSalary = session?.role === Role.SuperAdmin || session?.role === Role.FinancialOfficer;
  const fill = personnel.weeklyHoursTarget > 0
    ? Math.round((personnel.weeklyHoursLogged / personnel.weeklyHoursTarget) * 100)
    : 0;
  const initials = `${personnel.firstName[0] ?? ""}${personnel.lastName[0] ?? ""}`.toUpperCase();
  const department = departments.find((d) => d.id === personnel.departmentId) ?? null;
  const supervisor = allPersonnel.find((p) => p.id === personnel.supervisorId) ?? null;
  const assignedTasks = allTasks.filter((t) => t.assigneeIds.includes(personnel.id));

  // Build set of shift ids across this person's schedules
  const scheduledShiftIds = new Set<string>();
  for (const s of schedules) s.shiftIds.forEach((id) => scheduledShiftIds.add(id));
  const assignedShifts = shifts.filter((s) => scheduledShiftIds.has(s.id));

  function handleEdit() {
    onEdit(personnel!.id);
  }

  function handleOpenChat() {
    toast.showInfo("Chat", `Chat ouvert avec ${personnel!.firstName} ${personnel!.lastName}`);
  }

  return (
    <UnifiedModal
      open={open}
      onOpenChange={onOpenChange}
      variant="drawer"
      size="lg"
      icon={UserCircle}
      iconTone="primary"
      title={
        <span className="flex items-center gap-3">
          <Avatar className="h-10 w-10">
            <AvatarFallback className={STAFF_COLORS[personnel.staffCategory] ?? "bg-primary/15 text-primary"}>
              {initials}
            </AvatarFallback>
          </Avatar>
          <span className="truncate">{personnel.firstName} {personnel.lastName}</span>
        </span>
      }
      description={`${personnel.position || STAFF_CATEGORY_LABELS_FR[personnel.staffCategory]} · ${department?.name ?? "Sans département"}`}
      footer={
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleOpenChat}>
            <MessageSquare className="h-4 w-4" /> Ouvrir le chat
          </Button>
          <Button size="sm" onClick={handleEdit}>
            <Edit className="h-4 w-4" /> Modifier
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        {/* Personal info */}
        <Section icon={<UserCircle className="h-3.5 w-3.5" />} title="Informations personnelles">
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <Detail label="Prénom" value={personnel.firstName} />
            <Detail label="Nom" value={personnel.lastName} />
            <Detail label="Téléphone" value={personnel.phone} />
            <Detail label="E-mail" value={personnel.email ?? "—"} />
            <Detail label="Adresse" value={personnel.address ?? "—"} />
            <Detail label="Date de naissance" value={personnel.dateOfBirth ? formatDate(personnel.dateOfBirth) : "—"} />
            <Detail label="Identifiant national" value={personnel.nationalId ?? "—"} />
            <Detail label="Statut" value={PERSONNEL_STATUS_LABELS_FR[personnel.status]} />
          </div>
          {personnel.emergencyContact && (
            <div className="mt-3 rounded-md border border-border p-3 bg-muted/30">
              <p className="text-[10px] uppercase text-muted-foreground mb-1">Contact d'urgence</p>
              <p className="text-sm text-foreground">
                {personnel.emergencyContact.name} · {personnel.emergencyContact.relation}
              </p>
              <p className="text-xs text-muted-foreground font-mono">{personnel.emergencyContact.phone}</p>
            </div>
          )}
        </Section>

        <Separator />

        {/* Employment info */}
        <Section icon={<Briefcase className="h-3.5 w-3.5" />} title="Informations professionnelles">
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <Detail label="Date d'embauche" value={formatDate(personnel.hireDate)} />
            <Detail label="Poste" value={personnel.position || "—"} />
            <Detail label="Département" value={department?.name ?? "—"} />
            <Detail label="Superviseur" value={supervisor ? `${supervisor.firstName} ${supervisor.lastName}` : "—"} />
            <Detail label="Catégorie" value={STAFF_CATEGORY_LABELS_FR[personnel.staffCategory]} />
            <Detail label="Date de fin" value={personnel.terminationDate ? formatDate(personnel.terminationDate) : "—"} />
            {canSeeSalary && (
              <Detail label="Salaire" value={personnel.salary != null ? formatDzd(personnel.salary) : "—"} />
            )}
            <Detail
              label="Méthode de paie"
              value={personnel.paymentMethod ? PAYROLL_METHOD_LABELS_FR[personnel.paymentMethod] : "—"}
            />
            {canSeeSalary && (
              <Detail label="Compte bancaire" value={personnel.bankAccount ?? "—"} />
            )}
          </div>
        </Section>

        <Separator />

        {/* Schedule + hours */}
        <Section icon={<CalendarClock className="h-3.5 w-3.5" />} title="Horaires et heures hebdomadaires">
          <div className="rounded-md border border-border p-3 space-y-2 mb-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Cette semaine</span>
              <span className="font-mono font-semibold">
                {personnel.weeklyHoursLogged} / {personnel.weeklyHoursTarget} h
              </span>
            </div>
            <Progress
              value={fill}
              indicatorClassName={
                fill >= 100 ? "bg-status-success" : fill >= 80 ? "bg-status-warning" : "bg-primary"
              }
            />
            <p className="text-[11px] text-muted-foreground">{fill}% de l'objectif atteint</p>
          </div>
          {assignedShifts.length === 0 ? (
            <p className="text-xs text-muted-foreground">Aucun créneau planifié.</p>
          ) : (
            <ul className="space-y-1">
              {assignedShifts.map((s) => (
                <li key={s.id} className="flex items-center justify-between text-sm border border-border rounded-md px-3 py-1.5">
                  <span className="font-medium">{s.label}</span>
                  <span className="text-xs text-muted-foreground font-mono">
                    {WEEKDAY_LABELS_FR[s.weekday]} · {SHIFT_TYPE_LABELS_FR[s.shiftType]} · {s.startTime}–{s.endTime}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Separator />

        {/* Assigned tasks */}
        <Section icon={<ClipboardList className="h-3.5 w-3.5" />} title={`Tâches affectées (${assignedTasks.length})`}>
          {assignedTasks.length === 0 ? (
            <p className="text-xs text-muted-foreground">Aucune tâche affectée.</p>
          ) : (
            <ul className="space-y-1.5">
              {assignedTasks.map((task) => (
                <li key={task.id} className="flex items-center justify-between gap-2 border border-border rounded-md px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{task.title}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {task.dueDate ? `Échéance ${formatDate(task.dueDate)}` : "Sans échéance"} · Priorité {TASK_PRIORITY_LABELS_FR[task.priority]}
                    </p>
                  </div>
                  <StatusChip label={TASK_STATUS_LABELS_FR[task.status]} tone={TASK_STATUS_TONES[task.status] ?? "neutral"} />
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Separator />

        {/* Attendance */}
        <Section icon={<CalendarClock className="h-3.5 w-3.5" />} title={`Pointages (30 derniers jours · ${attendance.length})`}>
          {attendance.length === 0 ? (
            <p className="text-xs text-muted-foreground">Aucun pointage enregistré.</p>
          ) : (
            <ul className="divide-y divide-border max-h-48 overflow-y-auto">
              {attendance.slice(-8).reverse().map((e) => (
                <li key={e.id} className="py-1.5 flex items-center justify-between text-sm">
                  <span className="text-foreground">{ATTENDANCE_EVENT_LABELS_FR[e.eventType]}</span>
                  <span className="text-xs text-muted-foreground font-mono">{formatDateTime(e.timestamp)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Separator />

        {/* Performance reviews */}
        <Section icon={<Star className="h-3.5 w-3.5" />} title={`Évaluations (${reviews.length})`}>
          {reviews.length === 0 ? (
            <p className="text-xs text-muted-foreground">Aucune évaluation enregistrée.</p>
          ) : (
            <ul className="space-y-2">
              {reviews.map((r) => (
                <li key={r.id} className="border border-border rounded-md p-3 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{r.period}</span>
                    <StatusChip label={`${r.rating.toFixed(1)} / 5`} tone={r.rating >= 4 ? "success" : r.rating >= 3 ? "warning" : "danger"} />
                  </div>
                  <p className="text-xs text-muted-foreground">Par {r.reviewerName} · {formatDate(r.reviewedAt)}</p>
                  {r.strengths && <p className="text-xs text-foreground"><strong>Forces :</strong> {r.strengths}</p>}
                  {r.improvements && <p className="text-xs text-foreground"><strong>À améliorer :</strong> {r.improvements}</p>}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Separator />

        {/* Documents (mock list) */}
        <Section icon={<FileText className="h-3.5 w-3.5" />} title={`Documents (${personnel.documents.length})`}>
          {personnel.documents.length === 0 ? (
            <p className="text-xs text-muted-foreground">Aucun document téléversé.</p>
          ) : (
            <ul className="space-y-1">
              {personnel.documents.map((d) => (
                <li key={d.id} className="flex items-center justify-between text-sm border border-border rounded-md px-3 py-1.5">
                  <span className="truncate">{d.filename}</span>
                  <span className="text-[11px] text-muted-foreground">{formatDate(d.uploadedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Separator />

        {/* Internal notes (read-only) */}
        <Section icon={<Pencil className="h-3.5 w-3.5" />} title={`Notes internes (${personnel.notes.length})`}>
          {personnel.notes.length === 0 ? (
            <p className="text-xs text-muted-foreground">Aucune note interne.</p>
          ) : (
            <ul className="space-y-1.5">
              {personnel.notes.map((n) => (
                <li key={n.id} className="border-s-2 border-border ps-2 text-sm">
                  <p className="text-foreground">{n.body}</p>
                  <p className="text-[11px] text-muted-foreground">{n.authorName} · {formatDate(n.createdAt)}</p>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </UnifiedModal>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {icon}
        {title}
      </p>
      {children}
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase text-muted-foreground">{label}</p>
      <p className="text-sm text-foreground break-words">{value}</p>
    </div>
  );
}

/** Re-exports for icons used by callers — keeps imports tidy. */
export { Building2, CreditCard, Mail, MapPin, Phone, Briefcase };
