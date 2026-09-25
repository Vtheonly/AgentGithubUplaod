// ============================================================================
// FILE: src/features/academics/academics-page.tsx
// ============================================================================
import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import {
  School,
  BookOpen,
  ClipboardList,
  Trophy,
  Brain,
  Stethoscope,
  FileCheck,
  Users,
  GraduationCap,
  CalendarDays,
  Search,
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
import { can } from "../../core/rbac/session";
import { useObservable } from "../../shared/hooks/use-observable";
import { Button } from "../../shared/ui/button";
import { SchoolYearsTab } from "./school-years-tab";
import { ClubsTab } from "./clubs/clubs-tab";
import { PsychologyTab } from "./therapy/psychology-tab";
import { OrthophonieTab } from "./therapy/orthophonie-tab";
import { GradeLevelsClassView } from "./grade-levels-class-view";
import { PromotionCyclesTab } from "./promotion-cycles/promotion-cycles-tab";
import { TeachersTab } from "./teachers-tab";
import { SubjectsDirectoryTab } from "./subjects-directory-tab";
import { HomeworkHistoryTab } from "./homework-history-tab";
import { JustificationsTab } from "./justifications-tab";
import { HomeworkPushModal } from "./homework-push-modal";
import { TimetableTab } from "./timetable/timetable-tab";
import { StudentsDirectoryTab } from "./students-directory-tab";

type AcademicsTab =
  | "school_years"
  | "classes"
  | "students_directory"
  | "teachers"
  | "subjects"
  | "promotion_cycles"
  | "timetable"
  | "homework"
  | "justifications"
  | "clubs"
  | "psychology"
  | "orthophonie";

export function AcademicsPage() {
  const { t } = useTranslation();
  const repos = useRepositories();
  const { session } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState<AcademicsTab>("classes");
  const [homeworkOpen, setHomeworkOpen] = useState(false);
  // T-413: the "Open in Pédagogie" deep link — the student directory opens
  // with the referenced student pre-selected (the /crm?studentId convention).
  const [directoryStudentId, setDirectoryStudentId] = useState<string | null>(null);

  const classes = useObservable(() => repos.classes.observe(), []) ?? [];
  const students = useObservable(() => repos.students.observe(), []) ?? [];
  const subjects = useObservable(() => repos.subjects.observe(), []) ?? [];
  const clubs = useObservable(() => repos.clubs.observe(), []) ?? [];
  const psychFollowUps = useObservable(
    () => repos.psychology.observeFollowUps(),
    [],
  ) ?? [];
  const orthoFollowUps = useObservable(
    () => repos.orthophonie.observeFollowUps(),
    [],
  ) ?? [];
  const pendingJustifications = useObservable(
    () => repos.attendance.observeJustifications("submitted"),
    [],
  ) ?? [];
  const personnel = useObservable(() => repos.personnel.observe(), []) ?? [];

  // T-413: consume the /academics?studentId=… deep link (the 3-dot menu's
  // "Ouvrir dans Pédagogie" target) — switch to the students directory with
  // the canonical student pre-selected, then clean the param.
  useMemo(() => {
    const sid = searchParams.get("studentId");
    if (sid) {
      setTab("students_directory");
      setDirectoryStudentId(sid);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete("studentId");
          return next;
        },
        { replace: true },
      );
    }
    return null;
  }, [searchParams, setSearchParams]);

  const canObj = useMemo(() => {
    return {
      viewAcademics: can(session, Permission.ViewAcademics),
      manageClasses: can(session, Permission.ManageClasses),
      manageSubjects: can(session, Permission.ManageSubjects),
      assignHomework: can(session, Permission.AssignHomework),
      viewClubs: can(session, Permission.ViewClubs),
      manageClubs: can(session, Permission.ManageClubs),
      viewPsychology:
        can(session, Permission.ViewPsychology) ||
        can(session, Permission.ManagePsychology),
      managePsychology: can(session, Permission.ManagePsychology),
      viewOrthophonie:
        can(session, Permission.ViewOrthophonie) ||
        can(session, Permission.ManageOrthophonie),
      manageOrthophonie: can(session, Permission.ManageOrthophonie),
      viewAttendance:
        can(session, Permission.ViewAttendance) ||
        can(session, Permission.RollCall),
    };
  }, [session]);

  const teacherCount = useMemo(() => {
    return personnel.filter(
      (p) => p.staffCategory === "teacher" || p.roleId === "teacher",
    ).length;
  }, [personnel]);

  const tabs = useMemo(() => {
    const list: Array<{
      value: AcademicsTab;
      label: string;
      icon: typeof School;
      count?: number;
      visible: boolean;
    }> = [
      {
        value: "classes",
        label: "Niveaux & Classes",
        icon: School,
        count: classes.length,
        visible: canObj.viewAcademics,
      },
      {
        value: "students_directory",
        label: "Annuaire élèves",
        icon: Search,
        count: students.length,
        visible: canObj.viewAcademics,
      },
      {
        value: "teachers",
        label: "Enseignants",
        icon: Users,
        count: teacherCount,
        visible: canObj.viewAcademics,
      },
      {
        value: "subjects",
        label: "Matières",
        icon: BookOpen,
        count: subjects.length,
        visible: canObj.viewAcademics,
      },
      {
        value: "promotion_cycles",
        label: "Cycles de promotion",
        icon: GraduationCap,
        visible: canObj.manageClasses,
      },
      {
        value: "timetable",
        label: "Emploi du temps",
        icon: CalendarDays,
        visible: canObj.viewAcademics,
      },
      {
        value: "school_years",
        label: "Années scolaires",
        icon: School,
        visible: canObj.viewAcademics,
      },
      {
        value: "homework",
        label: "Devoirs",
        icon: ClipboardList,
        visible: canObj.assignHomework,
      },
      {
        value: "justifications",
        label: "Justificatifs",
        icon: FileCheck,
        count: pendingJustifications.filter(
          (r) => (r.justificationStatus ?? "none") === "submitted",
        ).length,
        visible: canObj.viewAttendance,
      },
      {
        value: "clubs",
        label: "Clubs",
        icon: Trophy,
        count: clubs.filter((c) => !c.isArchived).length,
        visible: canObj.viewClubs,
      },
      {
        value: "psychology",
        label: "Psychologie",
        icon: Brain,
        count: psychFollowUps.filter((f) => f.status === "active").length,
        visible: canObj.viewPsychology,
      },
      {
        value: "orthophonie",
        label: "Orthophonie",
        icon: Stethoscope,
        count: orthoFollowUps.filter((f) => f.status === "active").length,
        visible: canObj.viewOrthophonie,
      },
    ];
    return list.filter((x) => x.visible);
  }, [
    canObj,
    classes.length,
    students.length,
    teacherCount,
    subjects.length,
    clubs,
    psychFollowUps,
    orthoFollowUps,
    pendingJustifications,
  ]);

  const descriptionFor = (active: AcademicsTab): string => {
    switch (active) {
      case "classes":
        return "Organisation par niveaux scolaires & classes indépendantes — création et affectation des enseignants.";
      case "students_directory":
        return "Annuaire des élèves du dossier central — recherche par nom, code, famille ou classe, et navigation transversale (T-413).";
      case "teachers":
        return "Gestion du corps enseignant, affectations aux classes et matières.";
      case "school_years":
        return "Cycle de vie des années scolaires — création, modification, archivage, restauration, suppression.";
      case "subjects":
        return "Catalogue des matières avec coefficients par cycle et niveau.";
      case "promotion_cycles":
        return "Cycles de promotion par année scolaire — revue et confirmation classe par classe (T-403).";
      case "homework":
        return "Historique des devoirs diffusés aux classes.";
      case "timetable":
        return "Génération automatique de l'emploi du temps — configuration, contraintes, essais, validation et publication.";
      case "justifications":
        return "Justificatifs d'absence soumis par les parents — examen et décision administrative.";
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
          tab === "homework" && canObj.assignHomework ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setHomeworkOpen(true)}
            >
              Diffuser un devoir
            </Button>
          ) : null
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

        <PageTabContent value="classes">
          <GradeLevelsClassView canCreate={canObj.manageClasses} />
        </PageTabContent>

        <PageTabContent value="students_directory">
          <StudentsDirectoryTab initialStudentId={directoryStudentId} />
        </PageTabContent>

        <PageTabContent value="teachers">
          <TeachersTab canManage={canObj.manageClasses} />
        </PageTabContent>

        <PageTabContent value="school_years">
          <SchoolYearsTab />
        </PageTabContent>

        <PageTabContent value="subjects">
          <SubjectsDirectoryTab />
        </PageTabContent>

        <PageTabContent value="promotion_cycles">
          <PromotionCyclesTab />
        </PageTabContent>

        <PageTabContent value="timetable">
          <TimetableTab />
        </PageTabContent>

        <PageTabContent value="homework">
          <HomeworkHistoryTab />
        </PageTabContent>

        <PageTabContent value="justifications">
          <JustificationsTab />
        </PageTabContent>

        <PageTabContent value="clubs">
          <ClubsTab canManage={canObj.manageClubs} />
        </PageTabContent>

        <PageTabContent value="psychology">
          <PsychologyTab canManage={canObj.managePsychology} />
        </PageTabContent>

        <PageTabContent value="orthophonie">
          <OrthophonieTab canManage={canObj.manageOrthophonie} />
        </PageTabContent>
      </PageTabs>

      <HomeworkPushModal open={homeworkOpen} onOpenChange={setHomeworkOpen} />
    </div>
  );
}