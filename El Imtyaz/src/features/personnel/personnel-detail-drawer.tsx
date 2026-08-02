/**
 * PersonnelDetailDrawer — slide-over for a staff member.
 *
 * Sections: Identity / Weekly hours / Recent Relevé / Quick actions (call / email).
 * Salary visible only to SuperAdmin + FinancialOfficer (plan §09.04).
 *
 * Iteration 4: migrated from raw `Drawer` to `UnifiedModal variant="drawer"`
 * so this drawer shares the exact same chrome, padding, header, footer,
 * animations, and close behavior as every other modal/drawer in the app.
 *
 * Iteration 9: added "Fiche de paie PDF" download button (spec §5.2 —
 * entity-specific report generated exclusively inside the PersonnelDetailDrawer).
 *
 * Iteration 10: replaced the "Relevé d'activité" placeholder with a real
 * read-only list of the personnel's recent ReleveEntry records (clock-in/out
 * log) pulled from `repos.releve.observeByPersonnel`. This was the last
 * remaining "empty for now" placeholder in the codebase.
 */
import { useState } from "react";
import { Phone, Mail, Clock, Briefcase, UserCircle, Download, FileText, History } from "lucide-react";
import { useRepositories } from "../../app/providers/repository-provider";
import { useAuth } from "../../app/providers/auth-provider";
import { useToast } from "../../app/providers/toast-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import { UnifiedModal } from "../../shared/ui/unified-modal";
import { Button } from "../../shared/ui/button";
import { Avatar, AvatarFallback } from "../../shared/ui/avatar";
import { Separator } from "../../shared/ui/separator";
import { Progress } from "../../shared/ui/progress";
import { Badge } from "../../shared/ui/badge";
import { ScrollArea } from "../../shared/ui/scroll-area";
import { EmptyState } from "../../shared/layout/state-views";
import { StatusChip } from "../../shared/ui/status-chip";
import { formatDzd } from "../../core/format/currency";
import { formatDate, formatRelative } from "../../core/format/date";
import {
  STAFF_CATEGORY_LABELS_FR,
  PERSONNEL_STATUS_LABELS_FR,
  RELEVE_ACTIVITY_LABELS_FR,
  type ReleveActivity,
} from "../../domain/model/personnel";
import { Role } from "../../core/rbac/roles";
import { generatePayslipPdf, downloadPdf } from "../../infrastructure/receipt-pdf";

/** Tone for each ReleveActivity — used by StatusChip in the activity log. */
const RELEVE_ACTIVITY_TONE: Record<ReleveActivity, "info" | "neutral" | "success" | "warning" | "danger"> = {
  course: "info",
  meeting: "neutral",
  supervision: "warning",
  correction: "info",
  task: "neutral",
  delivery: "success",
  warehouse: "success",
  other: "neutral",
};

/** Format an `hoursIn` / `hoursOut` decimal as "HH:MM". */
function formatHours(h: number | null): string {
  if (h == null) return "—";
  const hours = Math.floor(h);
  const minutes = Math.round((h - hours) * 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/** Compute the duration (in hours) between hoursIn and hoursOut. */
function durationLabel(hoursIn: number, hoursOut: number | null): string {
  if (hoursOut == null) return "En cours";
  const d = hoursOut - hoursIn;
  if (d <= 0) return "—";
  const h = Math.floor(d);
  const m = Math.round((d - h) * 60);
  return m > 0 ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
}

const STAFF_COLORS: Record<string, string> = {
  teacher: "bg-primary/15 text-primary",
  administration: "bg-brand-blue-deep/15 text-brand-blue-deep",
  support: "bg-status-warning/15 text-status-warning",
  maintenance: "bg-status-neutral/15 text-status-neutral",
  driver: "bg-status-info/15 text-status-info",
};

export function PersonnelDetailDrawer({
  personnelId,
  open,
  onOpenChange,
}: {
  personnelId: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const repos = useRepositories();
  const { session } = useAuth();
  const toast = useToast();
  const [downloading, setDownloading] = useState(false);
  const personnel = useObservable(
    () => repos.personnel.observeById(personnelId ?? ""),
    [personnelId],
  );

  if (!open || !personnelId || !personnel) return null;

  const canSeeSalary = session?.role === Role.SuperAdmin || session?.role === Role.FinancialOfficer;
  const fill = personnel.weeklyHoursTarget > 0
    ? Math.round((personnel.weeklyHoursLogged / personnel.weeklyHoursTarget) * 100)
    : 0;
  const initials = `${personnel.firstName[0] ?? ""}${personnel.lastName[0] ?? ""}`.toUpperCase();

  /**
   * Iteration 9 — Fiche de paie PDF download (spec §5.2).
   *
   * Per spec: "Employee Salary Slips / Payroll Reports (Fiche de paie /
   * Rapport de salaire): Must be generated exclusively inside the
   * Employee Profile Drawer (PersonnelDetailDrawer)."
   *
   * Restricted to roles that can see salary (SuperAdmin, FinancialOfficer).
   */
  async function handleDownloadPayslip() {
    if (!personnel) return;
    setDownloading(true);
    try {
      const pdfBytes = await generatePayslipPdf(personnel);
      const fileName = `fiche-paie-${personnel.id}-${new Date().toISOString().slice(0, 7)}.pdf`;
      downloadPdf(pdfBytes, fileName);
      toast.showSuccess("Fiche de paie téléchargée", fileName);
    } catch (e) {
      toast.showError("Échec du téléchargement", e instanceof Error ? e.message : String(e));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <UnifiedModal
      open={open}
      onOpenChange={onOpenChange}
      variant="drawer"
      size="md"
      icon={UserCircle}
      iconTone="primary"
      title={
        <span className="flex items-center gap-3">
          <Avatar className="h-9 w-9">
            <AvatarFallback className={STAFF_COLORS[personnel.staffCategory]}>
              {initials}
            </AvatarFallback>
          </Avatar>
          <span>{personnel.firstName} {personnel.lastName}</span>
        </span>
      }
      description={STAFF_CATEGORY_LABELS_FR[personnel.staffCategory]}
      footer={
        <div className="ml-auto flex items-center gap-1.5">
          {canSeeSalary && (
            <Button
              variant="outline"
              size="sm"
              title="Télécharger la fiche de paie"
              onClick={handleDownloadPayslip}
              disabled={downloading}
            >
              {downloading ? (
                <><FileText className="h-4 w-4" /> Génération…</>
              ) : (
                <><Download className="h-4 w-4" /> Fiche de paie</>
              )}
            </Button>
          )}
          <Button variant="outline" size="icon" title="Appeler" onClick={() => window.open(`tel:${personnel.phone}`)}>
            <Phone className="h-4 w-4" />
          </Button>
          {personnel.email && (
            <Button variant="outline" size="icon" title="E-mail" onClick={() => window.open(`mailto:${personnel.email}`)}>
              <Mail className="h-4 w-4" />
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-5">
        {/* Identity */}
        <section className="space-y-2">
          <SectionTitle icon={<Briefcase className="h-3.5 w-3.5" />}>Identité</SectionTitle>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <Detail label="Catégorie" value={STAFF_CATEGORY_LABELS_FR[personnel.staffCategory]} />
            <Detail label="Statut" value={PERSONNEL_STATUS_LABELS_FR[personnel.status]} />
            <Detail label="Téléphone" value={personnel.phone} />
            <Detail label="E-mail" value={personnel.email ?? "—"} />
            <Detail label="Date d'embauche" value={formatDate(personnel.hireDate)} />
            {canSeeSalary && personnel.salary != null && (
              <Detail label="Salaire" value={formatDzd(personnel.salary)} />
            )}
          </div>
        </section>

        <Separator />

        {/* Weekly hours */}
        <section className="space-y-2">
          <SectionTitle icon={<Clock className="h-3.5 w-3.5" />}>Heures hebdomadaires</SectionTitle>
          <div className="rounded-md border border-border p-3 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Cette semaine</span>
              <span className="font-mono font-semibold">
                {personnel.weeklyHoursLogged} / {personnel.weeklyHoursTarget} h
              </span>
            </div>
            <Progress
              value={fill}
              indicatorClassName={
                fill >= 100
                  ? "bg-status-success"
                  : fill >= 80
                    ? "bg-status-warning"
                    : "bg-primary"
              }
            />
            <p className="text-[11px] text-muted-foreground">
              {fill}% de l'objectif hebdomadaire atteint
            </p>
          </div>
        </section>

        <Separator />

        {/* Iteration 10 — Recent Relevé (real entries from repos.releve.observeByPersonnel).
            Per plan §09.05: append-only ledger of grades/homework/attendance/hours
            per teacher. Supports payroll audits and performance reviews. */}
        <RecentReleveSection personnelId={personnel.id} personnelName={`${personnel.firstName} ${personnel.lastName}`} />
      </div>
    </UnifiedModal>
  );
}

/**
 * RecentReleveSection — read-only list of the personnel's recent ReleveEntry
 * records (clock-in/out log). Append-only — never editable from this view
 * (per plan §09.05: "Do not let teachers edit their own Relevé entries").
 *
 * Pulls the last 30 days of entries from `repos.releve.observeByPersonnel`
 * and renders them in a chronological list with activity chip + duration.
 */
function RecentReleveSection({
  personnelId,
  personnelName,
}: {
  personnelId: string;
  personnelName: string;
}) {
  const repos = useRepositories();
  // Range: last 30 days → today.
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 86_400_000);
  const entries = useObservable(
    () => repos.releve.observeByPersonnel(
      personnelId,
      from.toISOString().slice(0, 10),
      to.toISOString().slice(0, 10),
    ),
    [personnelId],
  );

  // Sort newest first.
  const sorted = [...entries].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));

  // Aggregate hours for the period (only entries with hoursOut count).
  const totalHours = sorted.reduce((sum, e) => {
    if (e.hoursOut == null) return sum;
    return sum + Math.max(0, e.hoursOut - e.hoursIn);
  }, 0);

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <SectionTitle icon={<History className="h-3.5 w-3.5" />}>Relevé d'activité</SectionTitle>
        <Badge variant="outline" className="text-[10px]">
          {sorted.length} entrée{sorted.length > 1 ? "s" : ""} · 30 j · {totalHours.toFixed(1)} h
        </Badge>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Plan §09.05 — journal append-only des activités de {personnelName}. Base de l'audit paie.
      </p>
      {sorted.length === 0 ? (
        <EmptyState
          title="Aucune saisie sur la période"
          description="Aucun relevé n'a été enregistré pour cet employé au cours des 30 derniers jours."
        />
      ) : (
        <ScrollArea className="max-h-[260px] rounded-md border border-border">
          <ul className="divide-y divide-border">
            {sorted.map((entry) => (
              <li key={entry.id} className="flex items-center gap-3 p-2.5">
                <div className="flex flex-col items-center gap-0.5 shrink-0 w-14">
                  <StatusChip
                    label={RELEVE_ACTIVITY_LABELS_FR[entry.activity]}
                    tone={RELEVE_ACTIVITY_TONE[entry.activity]}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-medium text-foreground">
                      {formatDate(entry.date)}
                    </p>
                    <span className="text-[10px] text-muted-foreground">
                      {formatHours(entry.hoursIn)} → {formatHours(entry.hoursOut)}
                    </span>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {formatRelative(entry.recordedAt)}
                    {entry.classId && ` · Classe: ${entry.classId}`}
                    {entry.subjectId && ` · Matière: ${entry.subjectId}`}
                  </p>
                </div>
                <Badge variant="outline" className="text-[10px] font-mono shrink-0">
                  {durationLabel(entry.hoursIn, entry.hoursOut)}
                </Badge>
              </li>
            ))}
          </ul>
        </ScrollArea>
      )}
    </section>
  );
}

function SectionTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {icon}
      {children}
    </p>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase text-muted-foreground">{label}</p>
      <p className="text-sm text-foreground">{value}</p>
    </div>
  );
}
