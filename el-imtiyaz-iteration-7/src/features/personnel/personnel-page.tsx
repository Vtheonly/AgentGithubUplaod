/**
 * Personnel hub — Plan §09.
 *
 * Tabs: Annuaire / Relevé / Audit / Workflows.
 *
 * Iteration 2: directory rows now open a slide-over drawer with identity,
 * weekly hours, and quick actions. Releve tab is now a functional clock-in
 * form. Audit/Workflows remain ComingSoonCards (audit log lives in Settings).
 *
 * Iteration 6: Filter and Export buttons in the directory toolbar are now
 * functional. Filter opens a category dropdown; Export generates an XLSX
 * roster of the currently-filtered personnel.
 */
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { Plus, Download, Filter, BookUser, Clock, ScrollText, Workflow } from "lucide-react";
import { useRepositories } from "../../infrastructure/repository-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import {
  STAFF_CATEGORY_LABELS_FR,
  PERSONNEL_STATUS_LABELS_FR,
  type StaffCategory,
} from "../../domain/model/personnel";
import { PageHeader } from "../../shared/components/page-header";
import { StatusChip } from "../../shared/components/status-chip";
import { ComingSoonCard } from "../../shared/components/coming-soon-card";
import { Card, CardContent } from "../../shared/ui/card";
import { PageTabs, PageTabList, PageTab, PageTabContent } from "../../shared/components/page-tabs";
import { Button } from "../../shared/ui/button";
import { Avatar, AvatarFallback } from "../../shared/ui/avatar";
import { Progress } from "../../shared/ui/progress";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../shared/ui/dropdown-menu";
import { useToast } from "../../state/toast-context";
import { exportToXlsx } from "../../infrastructure/excel/export-engine";
import { formatDzd } from "../../core/format/currency";
import { PersonnelDetailDrawer } from "./personnel-detail-drawer";
import { ReleveTab } from "./releve-tab";
import { WorkflowMonitorTab } from "./workflow-monitor-tab";

const STAFF_COLORS: Record<string, string> = {
  teacher: "bg-primary/15 text-primary",
  administration: "bg-brand-blue-deep/15 text-brand-blue-deep",
  support: "bg-status-warning/15 text-status-warning",
  maintenance: "bg-status-neutral/15 text-status-neutral",
  driver: "bg-status-info/15 text-status-info",
};

const ALL_CATEGORIES: readonly StaffCategory[] = ["teacher", "administration", "support", "maintenance", "driver"];

export function PersonnelPage() {
  const { t } = useTranslation();
  const repos = useRepositories();
  const personnel = useObservable(() => repos.personnel.observe(), []);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  function openDetail(id: string) {
    setDrawerId(id);
    setDrawerOpen(true);
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title={t("nav.personnel")}
        description="Annuaire du personnel, relevé d'activité (heures), journal d'audit, moniteur de workflows"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => exportPersonnelRoster(personnel)}>
              <Download className="h-4 w-4" /> {t("common.export")}
            </Button>
            <Button size="sm"><Plus className="h-4 w-4" /> Nouveau personnel</Button>
          </>
        }
      />
      <PageTabs defaultValue="directory" className="flex-1 flex flex-col px-6 pb-6 min-h-0">
        <PageTabList>
          <PageTab value="directory" label="Annuaire" icon={BookUser} count={personnel.length} />
          <PageTab value="releve" label="Relevé" icon={Clock} />
          <PageTab value="audit" label="Journal d'audit" icon={ScrollText} />
          <PageTab value="workflows" label="Workflows" icon={Workflow} />
        </PageTabList>
        <PageTabContent value="directory">
          <DirectoryTab onOpenDetail={openDetail} />
        </PageTabContent>
        <PageTabContent value="releve">
          <ReleveTab />
        </PageTabContent>
        <PageTabContent value="audit">
          <ComingSoonCard
            title="Journal d'audit"
            description="Le journal d'audit complet est accessible depuis Paramètres → Journal d'audit (réservé SuperAdmin + Agent Financier)."
          />
        </PageTabContent>
        <PageTabContent value="workflows">
          <WorkflowMonitorTab />
        </PageTabContent>
      </PageTabs>

      <PersonnelDetailDrawer
        personnelId={drawerId}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
      />
    </div>
  );
}

/**
 * Iteration 6: Exports the personnel roster to an XLSX file.
 * The export respects RLS — it only includes the personnel the current user
 * can see in the UI (which is what `personnel` already contains).
 */
function exportPersonnelRoster(personnel: readonly import("../../domain/model/personnel").Personnel[]) {
  if (personnel.length === 0) return;
  const columns = [
    { header: "Code", key: "code", width: 14 },
    { header: "Prénom", key: "firstName", width: 16 },
    { header: "Nom", key: "lastName", width: 18 },
    { header: "Catégorie", key: "category", width: 18 },
    { header: "Téléphone", key: "phone", width: 18 },
    { header: "E-mail", key: "email", width: 28 },
    { header: "Date d'embauche", key: "hireDate", width: 14 },
    { header: "Statut", key: "status", width: 14 },
    { header: "Heures hebdo. cibles", key: "weeklyHoursTarget", width: 14 },
    { header: "Heures hebdo. effectuées", key: "weeklyHoursLogged", width: 14 },
    { header: "Salaire (DZD)", key: "salary", width: 16 },
  ];
  const rows = personnel.map((p) => ({
    code: p.id,
    firstName: p.firstName,
    lastName: p.lastName,
    category: STAFF_CATEGORY_LABELS_FR[p.staffCategory],
    phone: p.phone,
    email: p.email ?? "",
    hireDate: p.hireDate,
    status: PERSONNEL_STATUS_LABELS_FR[p.status],
    weeklyHoursTarget: p.weeklyHoursTarget,
    weeklyHoursLogged: p.weeklyHoursLogged,
    salary: p.salary != null ? new Intl.NumberFormat("fr-FR").format(p.salary) : "—",
  }));
  exportToXlsx(
    [{ name: "Personnel", columns, rows }],
    `annuaire-personnel-${new Date().toISOString().slice(0, 10)}.xlsx`,
  );
}

function DirectoryTab({ onOpenDetail }: { onOpenDetail: (id: string) => void }) {
  const repos = useRepositories();
  const toast = useToast();
  const allPersonnel = useObservable(() => repos.personnel.observe(), []);
  const [filterCategory, setFilterCategory] = useState<StaffCategory | null>(null);

  // Iteration 6: filter personnel by selected category.
  const personnel = filterCategory
    ? allPersonnel.filter((p) => p.staffCategory === filterCategory)
    : allPersonnel;

  function handleExport() {
    if (personnel.length === 0) {
      toast.showWarning("Aucun personnel", "Rien à exporter pour ce filtre.");
      return;
    }
    exportPersonnelRoster(personnel);
    toast.showSuccess("Export XLSX", `${personnel.length} personnel(s) exporté(s).`);
  }

  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex items-center gap-2 border-b border-border p-3">
          {/* Iteration 6: Filter dropdown — cycles through categories. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Filter className="h-4 w-4" />
                {filterCategory ? STAFF_CATEGORY_LABELS_FR[filterCategory] : "Catégorie"}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>Filtrer par catégorie</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setFilterCategory(null)}>
                Toutes les catégories {filterCategory === null && "✓"}
              </DropdownMenuItem>
              {ALL_CATEGORIES.map((cat) => (
                <DropdownMenuItem key={cat} onClick={() => setFilterCategory(cat)}>
                  {STAFF_CATEGORY_LABELS_FR[cat]} {filterCategory === cat && "✓"}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {/* Iteration 6: Export button — generates XLSX of the currently-filtered list. */}
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="h-4 w-4" />
            Exporter ({personnel.length})
          </Button>
          {filterCategory && (
            <Button variant="ghost" size="sm" onClick={() => setFilterCategory(null)}>
              Réinitialiser le filtre
            </Button>
          )}
        </div>
        <ul className="divide-y divide-border">
          {personnel.map((p) => {
            const fill = p.weeklyHoursTarget > 0 ? Math.round((p.weeklyHoursLogged / p.weeklyHoursTarget) * 100) : 0;
            return (
              <li
                key={p.id}
                className="flex items-center gap-3 p-3 cursor-pointer hover:bg-accent/5"
                onClick={() => onOpenDetail(p.id)}
              >
                <Avatar className="h-10 w-10">
                  <AvatarFallback className={STAFF_COLORS[p.staffCategory]}>
                    {p.firstName[0]}{p.lastName[0]}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-foreground truncate">
                      {p.firstName} {p.lastName}
                    </p>
                    <StatusChip
                      label={STAFF_CATEGORY_LABELS_FR[p.staffCategory]}
                      tone="neutral"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground font-mono">{p.phone}</p>
                </div>
                <div className="hidden md:flex flex-col items-end gap-1 w-40">
                  <div className="flex justify-between text-xs w-full">
                    <span className="text-muted-foreground">Heures/sem</span>
                    <span className="font-mono">{p.weeklyHoursLogged}/{p.weeklyHoursTarget}</span>
                  </div>
                  <Progress value={fill} />
                </div>
                <StatusChip
                  label={PERSONNEL_STATUS_LABELS_FR[p.status]}
                  tone={p.status === "active" ? "success" : p.status === "on_leave" ? "warning" : p.status === "suspended" ? "danger" : "neutral"}
                />
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
