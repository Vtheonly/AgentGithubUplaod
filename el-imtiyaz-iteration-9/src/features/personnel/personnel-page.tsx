/**
 * Personnel hub — plan §09 + iteration 8 workforce expansion.
 *
 * The Personnel page is the primary workspace for every employee. On first
 * run, an onboarding wizard collects the org structure. After onboarding,
 * the page dispatches to a role-based dashboard:
 *
 *   - SuperAdmin / FinancialOfficer / SupportStaff → AdministratorDashboard
 *   - Manager                                     → ManagerDashboard
 *   - Buyer                                       → BuyerDashboard
 *   - Driver                                      → DriverDashboard
 *   - WarehouseWorker                             → WarehouseWorkerDashboard
 *   - Teacher                                     → TeacherDashboard
 *   - Worker                                      → WorkerDashboard
 *
 * Tabs (secondary navigation):
 *   - Mon espace  → role dashboard (default)
 *   - Annuaire    → full directory (admin-only via GatedContent)
 *   - Tâches      → task management
 *   - Messagerie  → internal chat
 *   - Relevé      → activity log
 *   - Workflows   → workflow monitor (iteration 7)
 *
 * Iteration 7 unified all modals — zero raw Dialog/Drawer call sites.
 * Iteration 8 adds the workforce tabs and the role-based dispatch.
 */
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { BookUser, Clock, ScrollText, Workflow, LayoutDashboard, ListTodo, MessageSquare } from "lucide-react";
import { useRepositories } from "../../infrastructure/repository-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import { useAuth } from "../../state/auth-context";
import { Role } from "../../core/rbac/roles";
import { PageHeader } from "../../shared/components/page-header";
import { ComingSoonCard } from "../../shared/components/coming-soon-card";
import { PageTabs, PageTabList, PageTab, PageTabContent } from "../../shared/components/page-tabs";
import { RoleDashboardRouter } from "./dashboards/role-dashboard-router";
import { TaskManagement } from "./management/task-management";
import { ChatPanel } from "./management/chat-panel";
import { PersonnelDetailDrawer } from "./personnel-detail-drawer";
import { ReleveTab } from "./releve-tab";
import { WorkflowMonitorTab } from "./workflow-monitor-tab";
import { OnboardingWizard } from "./onboarding/onboarding-wizard";
import { AdministratorEmployeeDirectory } from "./management/employee-directory";

export function PersonnelPage() {
  const { t } = useTranslation();
  const repos = useRepositories();
  const { session } = useAuth();
  const onboarding = useObservable(() => repos.onboarding.observe(), []);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  function openDetail(id: string) {
    setDrawerId(id);
    setDrawerOpen(true);
  }

  // Gate: if onboarding has not been completed, show the wizard instead of
  // the dashboard. This is the "first-run experience" described in the spec.
  // (For demo purposes the wizard is always reachable via the "Relancer
  // l'onboarding" button on the Administrator dashboard.)
  if (onboarding && onboarding.completedAt === null && session?.role === "super_admin") {
    return <OnboardingWizard />;
  }

  const role = session?.role ?? Role.SupportStaff;
  const isAdmin = role === Role.SuperAdmin || role === Role.FinancialOfficer || role === Role.SupportStaff;

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title={t("nav.personnel")}
        description="Espace de travail personnalisé selon votre rôle : tâches, communication, planning, assiduité."
      />
      <PageTabs defaultValue="dashboard" className="flex-1 flex flex-col px-6 pb-6 min-h-0">
        <PageTabList>
          <PageTab value="dashboard" label="Mon espace" icon={LayoutDashboard} />
          {isAdmin && <PageTab value="directory" label="Annuaire" icon={BookUser} />}
          <PageTab value="tasks" label="Tâches" icon={ListTodo} />
          <PageTab value="chat" label="Messagerie" icon={MessageSquare} />
          <PageTab value="releve" label="Relevé" icon={Clock} />
          <PageTab value="audit" label="Journal d'audit" icon={ScrollText} />
          <PageTab value="workflows" label="Workflows" icon={Workflow} />
        </PageTabList>
        <PageTabContent value="dashboard">
          <RoleDashboardRouter role={role} />
        </PageTabContent>
        {isAdmin && (
          <PageTabContent value="directory">
            <AdministratorEmployeeDirectory />
          </PageTabContent>
        )}
        <PageTabContent value="tasks">
          <TaskManagement />
        </PageTabContent>
        <PageTabContent value="chat">
          <ChatPanel />
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
