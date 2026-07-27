/**
 * Personnel hub — Plan §09.
 *
 * Tabs: Annuaire / Relevé / Audit / Workflows.
 *
 * Iteration 2: directory rows now open a slide-over drawer with identity,
 * weekly hours, and quick actions. Releve tab is now a functional clock-in
 * form. Audit/Workflows remain ComingSoonCards (audit log lives in Settings).
 */
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { Plus, Download, Filter } from "lucide-react";
import { useRepositories } from "../../infrastructure/repository-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import {
  STAFF_CATEGORY_LABELS_FR,
  PERSONNEL_STATUS_LABELS_FR,
} from "../../domain/model/personnel";
import { PageHeader } from "../../shared/components/page-header";
import { StatusChip } from "../../shared/components/status-chip";
import { ComingSoonCard } from "../../shared/components/coming-soon-card";
import { Card, CardContent } from "../../shared/ui/card";
import { PageTabs, PageTabList, PageTab, PageTabContent } from "../../shared/components/page-tabs";
import { Button } from "../../shared/ui/button";
import { Avatar, AvatarFallback } from "../../shared/ui/avatar";
import { Progress } from "../../shared/ui/progress";
import { PersonnelDetailDrawer } from "./personnel-detail-drawer";
import { ReleveTab } from "./releve-tab";

const STAFF_COLORS: Record<string, string> = {
  teacher: "bg-primary/15 text-primary",
  administration: "bg-brand-blue-deep/15 text-brand-blue-deep",
  support: "bg-status-warning/15 text-status-warning",
  maintenance: "bg-status-neutral/15 text-status-neutral",
  driver: "bg-status-info/15 text-status-info",
};

export function PersonnelPage() {
  const { t } = useTranslation();
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
            <Button variant="outline" size="sm"><Download className="h-4 w-4" /> {t("common.export")}</Button>
            <Button size="sm"><Plus className="h-4 w-4" /> Nouveau personnel</Button>
          </>
        }
      />
      <PageTabs defaultValue="directory" className="flex-1 flex flex-col px-6 pb-6 min-h-0">
        <PageTabList>
          <PageTab value="directory" label="Annuaire" />
          <PageTab value="releve" label="Relevé" />
          <PageTab value="audit" label="Journal d'audit" />
          <PageTab value="workflows" label="Workflows" />
        </PageTabList>
        <PageTabContent value="directory" className="flex-1 overflow-y-auto mt-4">
          <DirectoryTab onOpenDetail={openDetail} />
        </PageTabContent>
        <PageTabContent value="releve" className="flex-1 overflow-y-auto mt-4">
          <ReleveTab />
        </PageTabContent>
        <PageTabContent value="audit" className="flex-1 overflow-y-auto mt-4">
          <ComingSoonCard
            title="Journal d'audit"
            description="Le journal d'audit complet est accessible depuis Paramètres → Journal d'audit (réservé SuperAdmin + Agent Financier)."
          />
        </PageTabContent>
        <PageTabContent value="workflows" className="flex-1 overflow-y-auto mt-4">
          <ComingSoonCard
            title="Moniteur de workflows"
            description="Exécutions des Edge Functions / DAG. Vue en lecture seule sur mobile. L'éditeur DAG visuel est réservé au terminal de bureau."
          />
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

function DirectoryTab({ onOpenDetail }: { onOpenDetail: (id: string) => void }) {
  const repos = useRepositories();
  const personnel = useObservable(() => repos.personnel.observe(), []);
  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex items-center gap-2 border-b border-border p-3">
          <Button variant="outline" size="sm"><Filter className="h-4 w-4" /> Catégorie</Button>
          <Button variant="outline" size="sm"><Download className="h-4 w-4" /></Button>
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
