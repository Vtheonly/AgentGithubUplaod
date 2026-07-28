/**
 * PersonnelDetailDrawer — slide-over for a staff member.
 *
 * Sections: Identity / Weekly hours / Quick actions (call / email).
 * Salary visible only to SuperAdmin + FinancialOfficer (plan §09.04).
 *
 * Iteration 4: migrated from raw `Drawer` to `UnifiedModal variant="drawer"`
 * so this drawer shares the exact same chrome, padding, header, footer,
 * animations, and close behavior as every other modal/drawer in the app.
 */
import { Phone, Mail, Clock, Briefcase, UserCircle } from "lucide-react";
import { useRepositories } from "../../infrastructure/repository-provider";
import { useAuth } from "../../state/auth-context";
import { useObservable } from "../../shared/hooks/use-observable";
import { UnifiedModal } from "../../shared/components/unified-modal";
import { Button } from "../../shared/ui/button";
import { Avatar, AvatarFallback } from "../../shared/ui/avatar";
import { Separator } from "../../shared/ui/separator";
import { Progress } from "../../shared/ui/progress";
import { formatDzd } from "../../core/format/currency";
import { formatDate } from "../../core/format/date";
import {
  STAFF_CATEGORY_LABELS_FR,
  PERSONNEL_STATUS_LABELS_FR,
} from "../../domain/model/personnel";
import { Role } from "../../core/rbac/roles";

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

        {/* Recent Relevé (mock — empty for now) */}
        <section className="space-y-2">
          <SectionTitle icon={<Clock className="h-3.5 w-3.5" />}>Relevé d'activité</SectionTitle>
          <p className="text-xs text-muted-foreground">
            Les saisies de relevé (clock-in/out) apparaîtront ici. Append-only — base du audit paie.
          </p>
        </section>
      </div>
    </UnifiedModal>
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
