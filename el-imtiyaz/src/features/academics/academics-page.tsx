/**
 * Academics hub — Hub 3. Plan §05 / §06.
 *
 * Tabs: Classes / Matières / Devoirs.
 * Each class card navigates to /academics/class/:classId which has 4 sub-tabs:
 *   Élèves / Matières / Présences / Notes
 * Class detail exposes quick actions: Appel (Roll Call), Notes (Grade Entry), Devoirs.
 */
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Plus, Download, Filter, ChevronRight } from "lucide-react";
import { PageHeader } from "../../shared/components/page-header";
import { Card, CardContent } from "../../shared/ui/card";
import { PageTabs, PageTabList, PageTab, PageTabContent } from "../../shared/components/page-tabs";
import { Button } from "../../shared/ui/button";
import { Avatar, AvatarFallback } from "../../shared/ui/avatar";
import { Progress } from "../../shared/ui/progress";
import { ComingSoonCard } from "../../shared/components/coming-soon-card";
import { useRepositories } from "../../infrastructure/repository-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import { LEVEL_LABELS_FR } from "../../domain/model/student";
import { HomeworkPushModal } from "./homework-push-modal";
import { HomeworkHistoryTab } from "./homework-history-tab";
import { SubjectsDirectoryTab } from "./subjects-directory-tab";
import { useState } from "react";

export function AcademicsPage() {
  const { t } = useTranslation();
  const [homeworkOpen, setHomeworkOpen] = useState(false);

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title={t("nav.academics")}
        description="Scolarité (Primaire / CEM / Lycée) + extracurricular — gestion des classes, matières, notes, devoirs"
        actions={
          <>
            <Button variant="outline" size="sm"><Download className="h-4 w-4" /> {t("common.export")}</Button>
            <Button variant="outline" size="sm" onClick={() => setHomeworkOpen(true)}>
              <Plus className="h-4 w-4" /> Diffuser un devoir
            </Button>
            <Button size="sm"><Plus className="h-4 w-4" /> Nouvelle classe</Button>
          </>
        }
      />
      <PageTabs defaultValue="classes" className="flex-1 flex flex-col px-6 pb-6 min-h-0">
        <PageTabList>
          <PageTab value="classes" label="Classes" />
          <PageTab value="subjects" label="Matières" />
          <PageTab value="homework" label="Devoirs" />
        </PageTabList>
        <PageTabContent value="classes" className="flex-1 overflow-y-auto mt-4">
          <ClassesTab />
        </PageTabContent>
        <PageTabContent value="subjects" className="flex-1 overflow-y-auto mt-4">
          <SubjectsDirectoryTab />
        </PageTabContent>
        <PageTabContent value="homework" className="flex-1 overflow-y-auto mt-4">
          <HomeworkHistoryTab />
        </PageTabContent>
      </PageTabs>

      <HomeworkPushModal open={homeworkOpen} onOpenChange={setHomeworkOpen} />
    </div>
  );
}

function ClassesTab() {
  const repos = useRepositories();
  const navigate = useNavigate();
  const classes = useObservable(() => repos.classes.observe(), []);

  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex items-center gap-2 border-b border-border p-3">
          <Button variant="outline" size="sm"><Filter className="h-4 w-4" /> Niveau</Button>
          <Button variant="outline" size="sm"><Download className="h-4 w-4" /></Button>
        </div>
        <ul className="divide-y divide-border">
          {classes.map((c) => {
            const fill = c.capacity > 0 ? Math.round((c.enrolledCount / c.capacity) * 100) : 0;
            const tone = fill >= 100 ? "danger" : fill >= 80 ? "warning" : "success";
            return (
              <li
                key={c.id}
                className="flex items-center gap-3 p-3 cursor-pointer hover:bg-accent/5"
                onClick={() => navigate(`/academics/class/${c.id}`)}
              >
                <Avatar className="h-10 w-10 rounded-md">
                  <AvatarFallback className="rounded-md">
                    {c.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-foreground">{c.name}</p>
                    <span className="text-xs text-muted-foreground">{LEVEL_LABELS_FR[c.level]}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{c.homeroomTeacherName ?? "—"}</p>
                </div>
                <div className="w-32 space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">{c.enrolledCount}/{c.capacity}</span>
                    <span className={tone === "danger" ? "text-status-danger" : tone === "warning" ? "text-status-warning" : "text-status-success"}>
                      {fill}%
                    </span>
                  </div>
                  <Progress
                    value={fill}
                    indicatorClassName={tone === "danger" ? "bg-status-danger" : tone === "warning" ? "bg-status-warning" : "bg-status-success"}
                  />
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

