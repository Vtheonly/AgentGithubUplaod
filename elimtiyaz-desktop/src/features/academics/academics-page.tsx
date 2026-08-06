/**
 * AcademicsPage — unified Pédagogie hub.
 *
 * Redesigned to host ALL pedagogy-related sub-modules as controlled tabs:
 *   1. Années scolaires  — school year lifecycle (create/edit/archive/restore/delete)
 *   2. Niveaux & Classes — grade levels + class catalog (existing)
 *   3. Matières          — subject directory (existing)
 *   4. Devoirs           — homework history (existing)
 *   5. Clubs             — extracurricular clubs catalog + memberships + activities
 *   6. Psychologie       — psychological follow-ups + sessions + reports (restricted)
 *   7. Orthophonie       — speech therapy follow-ups + evaluations + sessions (restricted)
 *
 * Each tab renders its OWN action buttons in the PageHeader — they are
 * purpose-bound to the active tab (no more "useless or unrelated" buttons
 * above the tab bar, per user brief).
 *
 * Tab visibility is driven by RBAC: tabs the user can't see are hidden.
 * Therapy tabs (Psychologie / Orthophonie) require explicit
 * ViewPsychology / ViewOrthophonie permissions and are restricted by
 * confidentiality level at the row level.
 */
import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  School,
  BookOpen,
  ClipboardList,
  Trophy,
  Brain,
  Stethoscope,
} from "lucide-react";
import { PageHeader } from "../../shared/layout/page-header";
import {
  PageTabs,
  PageTabList,
  PageTab,
  PageTabContent,
} from "../../shared/layout/page-tabs";
import { useRepositories } from "../../app/providers/repository-provider";
import { useAuth } from "../../app/providers/auth-provider";
import { Permission } from "../../core/rbac/permissions";
import { useObservable } from "../../shared/hooks/use-observable";
import { SchoolYearsTab } from "./school-years-tab";
import { ClubsTab } from "./clubs/clubs-tab";
import { PsychologyTab } from "./therapy/psychology-tab";
import { OrthophonieTab } from "./therapy/orthophonie-tab";
import { GradeLevelsClassView } from "./grade-levels-class-view";
import { SubjectsDirectoryTab } from "./subjects-directory-tab";
import { HomeworkHistoryTab } from "./homework-history-tab";
import { HomeworkPushModal } from "./homework-push-modal";

type AcademicsTab =
  | "school_years"
  | "classes"
  | "subjects"
  | "homework"
  | "clubs"
  | "psychology"
  | "orthophonie";

export function AcademicsPage() {
  const { t } = useTranslation();
  const repos = useRepositories();
  const { session } = useAuth();
  const [tab, setTab] = useState<AcademicsTab>("school_years");
  const [homeworkOpen, setHomeworkOpen] = useState(false);

  const classes = useObservable(() => repos.classes.observe(), []);
  const subjects = useObservable(() => repos.subjects.observe(), []);
  const clubs = useObservable(() => repos.clubs.observe(), []);
  const psychFollowUps = useObservable(
    () => repos.psychology.observeFollowUps(),
    [],
  );
  const orthoFollowUps = useObservable(
    () => repos.orthophonie.observeFollowUps(),
    [],
  );

  const can = useMemo(() => {
    if (!session) {
      return {
        viewAcademics: false,
        manageClasses: false,
        manageSubjects: false,
        assignHomework: false,
        viewClubs: false,
        manageClubs: false,
        viewPsychology: false,
        managePsychology: false,
        viewOrthophonie: false,
        manageOrthophonie: false,
      };
    }
    const p = session.permissions;
    return {
      viewAcademics: p.has(Permission.ViewAcademics),
      manageClasses: p.has(Permission.ManageClasses),
      manageSubjects: p.has(Permission.ManageSubjects),
      assignHomework: p.has(Permission.AssignHomework),
      viewClubs: p.has(Permission.ViewClubs),
      manageClubs: p.has(Permission.ManageClubs),
      viewPsychology: p.has(Permission.ViewPsychology) || p.has(Permission.ManagePsychology),
      managePsychology: p.has(Permission.ManagePsychology),
      viewOrthophonie: p.has(Permission.ViewOrthophonie) || p.has(Permission.ManageOrthophonie),
      manageOrthophonie: p.has(Permission.ManageOrthophonie),
    };
  }, [session]);

  // Build the tab list dynamically based on permissions.
  const tabs = useMemo(() => {
    const list: Array<{
      value: AcademicsTab;
      label: string;
      icon: typeof School;
      count?: number;
      visible: boolean;
    }> = [
      {
        value: "school_years",
        label: "Années scolaires",
        icon: School,
        visible: can.viewAcademics,
      },
      {
        value: "classes",
        label: "Niveaux & Classes",
        icon: School,
        count: classes.length,
        visible: can.viewAcademics,
      },
      {
        value: "subjects",
        label: "Matières",
        icon: BookOpen,
        count: subjects.length,
        visible: can.viewAcademics,
      },
      {
        value: "homework",
        label: "Devoirs",
        icon: ClipboardList,
        visible: can.assignHomework,
      },
      {
        value: "clubs",
        label: "Clubs",
        icon: Trophy,
        count: clubs.filter((c) => !c.isArchived).length,
        visible: can.viewClubs,
      },
      {
        value: "psychology",
        label: "Psychologie",
        icon: Brain,
        count: psychFollowUps.filter((f) => f.status === "active").length,
        visible: can.viewPsychology,
      },
      {
        value: "orthophonie",
        label: "Orthophonie",
        icon: Stethoscope,
        count: orthoFollowUps.filter((f) => f.status === "active").length,
        visible: can.viewOrthophonie,
      },
    ];
    return list.filter((x) => x.visible);
  }, [can, classes.length, subjects.length, clubs, psychFollowUps, orthoFollowUps]);

  // Compute the active tab description (shown in the header)
  const descriptionFor = (active: AcademicsTab): string => {
    switch (active) {
      case "school_years":
        return "Cycle de vie des années scolaires — création, modification, archivage, restauration, suppression.";
      case "classes":
        return "Organisation par niveaux scolaires & classes indépendantes — création illimitée par niveau.";
      case "subjects":
        return "Catalogue des matières avec coefficients par cycle et niveau.";
      case "homework":
        return "Historique des devoirs diffusés aux classes.";
      case "clubs":
        return "Clubs extrascolaires : catalogue, adhésions, activités, encadrement.";
      case "psychology":
        return "Suivi psychologique des élèves — accès restreint, confidentialité renforcée.";
      case "orthophonie":
        return "Suivi orthophonique des élèves — accès restreint, évaluations et séances.";
    }
  };

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title={t("nav.academics")}
        description={descriptionFor(tab)}
        actions={
          <TabActions
            tab={tab}
            can={can}
            onPushHomework={() => setHomeworkOpen(true)}
          />
        }
      />

      <PageTabs
        value={tab}
        onValueChange={(v) => setTab(v as AcademicsTab)}
        className="flex-1 flex flex-col px-6 pb-6 min-h-0"
      >
        <PageTabList scrollable>
          {tabs.map((t) => (
            <PageTab
              key={t.value}
              value={t.value}
              label={t.label}
              icon={t.icon}
              count={t.count}
            />
          ))}
        </PageTabList>

        {tabs.some((t) => t.value === "school_years") && (
          <PageTabContent value="school_years">
            <SchoolYearsTab />
          </PageTabContent>
        )}

        {tabs.some((t) => t.value === "classes") && (
          <PageTabContent value="classes">
            <GradeLevelsClassView canCreate={can.manageClasses} />
          </PageTabContent>
        )}

        {tabs.some((t) => t.value === "subjects") && (
          <PageTabContent value="subjects">
            <SubjectsDirectoryTab />
          </PageTabContent>
        )}

        {tabs.some((t) => t.value === "homework") && (
          <PageTabContent value="homework">
            <HomeworkHistoryTab />
          </PageTabContent>
        )}

        {tabs.some((t) => t.value === "clubs") && (
          <PageTabContent value="clubs">
            <ClubsTab canManage={can.manageClubs} />
          </PageTabContent>
        )}

        {tabs.some((t) => t.value === "psychology") && (
          <PageTabContent value="psychology">
            <PsychologyTab canManage={can.managePsychology} />
          </PageTabContent>
        )}

        {tabs.some((t) => t.value === "orthophonie") && (
          <PageTabContent value="orthophonie">
            <OrthophonieTab canManage={can.manageOrthophonie} />
          </PageTabContent>
        )}
      </PageTabs>

      <HomeworkPushModal open={homeworkOpen} onOpenChange={setHomeworkOpen} />
    </div>
  );
}

// ============================================================================
// TabActions — purpose-bound action buttons that change based on active tab
// ============================================================================

function TabActions({
  tab,
  can,
  onPushHomework,
}: {
  tab: AcademicsTab;
  can: {
    manageClasses: boolean;
    assignHomework: boolean;
    manageClubs: boolean;
    managePsychology: boolean;
    manageOrthophonie: boolean;
  };
  onPushHomework: () => void;
}) {
  // Each tab owns its actions. Empty fragment when no action is relevant.
  switch (tab) {
    case "homework":
      return can.assignHomework ? (
        <HomeworkActionButton onPushHomework={onPushHomework} />
      ) : null;
    case "classes":
    case "school_years":
    case "subjects":
    case "clubs":
    case "psychology":
    case "orthophonie":
      // These tabs render their own action buttons inside the tab content
      // (closer to the data they act on), so the header stays clean.
      return null;
    default:
      return null;
  }
}

import { Button } from "../../shared/ui/button";
import { Plus } from "lucide-react";

function HomeworkActionButton({ onPushHomework }: { onPushHomework: () => void }) {
  return (
    <Button variant="outline" size="sm" onClick={onPushHomework}>
      <Plus className="h-4 w-4" /> Diffuser un devoir
    </Button>
  );
}
