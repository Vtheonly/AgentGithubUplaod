// ============================================================================
// FILE: src/features/personnel/personnel-page.tsx
// ============================================================================
/**
 * Personnel Hub — Multi-Role Operational Workspace.
 *
 * TABS & PERMISSIONS STRUCTURE:
 *   - Super Admin & Financial Officer:
 *     1. Mon Espace (Executive Dashboard with instant radar)
 *     2. Annuaire & Profils (Full directory, contracts, HR records)
 *     3. Rémunérations & Salaires (Payroll, salary payments, audited adjustments)
 *     4. Centre de Tâches (Task creation, worker assignment & validation)
 *     5. Assiduité & Justifications (Absence management & 2-way justification loop)
 *     6. Demandes & Notes de Frais (Triage for spending/leave requests)
 *     7. Messagerie (Internal team chat)
 *     8. Relevé d'Activité
 *
 *   - Teacher:
 *     1. Mon Espace (Pedagogical shortcuts, classes & homework)
 *     2. Mes Tâches (Assigned tasks)
 *     3. Mon Assiduité & Justifications (Clock-in, personal absence responses)
 *     4. Ma Rémunération (Salary breakdown & payslip downloads)
 *     5. Mes Demandes (Leave & spending submissions)
 *     6. Messagerie
 *     7. Mon Relevé
 *
 *   - Worker / Maintenance / Driver / Buyer / Warehouse:
 *     1. Mon Espace (Operational dashboard tailored to role)
 *     2. Mes Tâches (Actionable assigned tasks)
 *     3. Pointage & Assiduité (Clock-in/out station & absence justifications)
 *     4. Ma Rémunération (Compensation details & payslips)
 *     5. Mes Demandes (Leave & reimbursement submissions)
 *     6. Messagerie
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  LayoutDashboard,
  BookUser,
  ListTodo,
  Calendar,
  Wallet,
  Receipt,
  MessageSquare,
  Clock,
  Workflow,
  ShieldCheck,
} from "lucide-react";
import { useRepositories } from "../../app/providers/repository-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import { useAuth } from "../../app/providers/auth-provider";
import { Role } from "../../core/rbac/roles";
import { PageHeader } from "../../shared/layout/page-header";
import {
  PageTabs,
  PageTabList,
  PageTab,
  PageTabContent,
} from "../../shared/layout/page-tabs";
import { RoleDashboardRouter } from "./dashboards/role-dashboard-router";
import { TaskManagement } from "./management/task-management";
import { ChatPanel } from "./management/chat-panel";
import { ReleveTab } from "./releve-tab";
import { WorkflowMonitorTab } from "./workflow-monitor-tab";
import { OnboardingWizard } from "./onboarding/onboarding-wizard";
import { AdministratorEmployeeDirectory } from "./management/employee-directory";
import { StaffAttendanceCenter } from "./management/staff-attendance-center";
import { PayrollManagement } from "./management/payroll-management";
import { RequestsManagement } from "./management/requests-management";

export function PersonnelPage() {
  const { t } = useTranslation();
  const repos = useRepositories();
  const { session } = useAuth();
  const onboarding = useObservable(() => repos.onboarding.observe(), []);

  const [activeTab, setActiveTab] = useState<string>("dashboard");

  if (
    onboarding &&
    onboarding.completedAt === null &&
    session?.role === "super_admin"
  ) {
    return <OnboardingWizard />;
  }

  const role = session?.role ?? Role.Worker;
  const isSuperAdmin =
    role === Role.SuperAdmin || role === Role.FinancialOfficer;
  const isTeacher = role === Role.Teacher;

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title={t("nav.personnel")}
        description={
          isSuperAdmin
            ? "Gestion intégrale des ressources humaines, rémunérations, tâches, assiduité et arbitrages."
            : "Espace collaborateur personnel : vos missions, assiduité, fiches de paie et communications."
        }
      />

      <PageTabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="flex-1 flex flex-col px-6 pb-6 min-h-0"
      >
        <PageTabList scrollable>
          <PageTab
            value="dashboard"
            label="Mon espace"
            icon={LayoutDashboard}
          />

          {/* Admin tabs */}
          {isSuperAdmin && (
            <PageTab
              value="directory"
              label="Annuaire & Profils"
              icon={BookUser}
            />
          )}
          <PageTab
            value="payroll"
            label={isSuperAdmin ? "Gestion des Salaires" : "Ma Rémunération"}
            icon={Wallet}
          />
          <PageTab
            value="tasks"
            label={isSuperAdmin ? "Centre de Tâches" : "Mes Tâches"}
            icon={ListTodo}
          />
          <PageTab
            value="attendance"
            label={
              isSuperAdmin ? "Assiduité & Justifications" : "Mon Assiduité"
            }
            icon={Calendar}
          />
          <PageTab
            value="requests"
            label={isSuperAdmin ? "Demandes & Dépenses" : "Mes Demandes"}
            icon={Receipt}
          />
          <PageTab value="chat" label="Messagerie" icon={MessageSquare} />

          {/* Teacher and specialized tabs */}
          {(isSuperAdmin || isTeacher) && (
            <PageTab value="releve" label="Relevé d'Activité" icon={Clock} />
          )}
          {isSuperAdmin && (
            <PageTab value="workflows" label="Workflows" icon={Workflow} />
          )}
        </PageTabList>

        <PageTabContent value="dashboard">
          <RoleDashboardRouter role={role} />
        </PageTabContent>

        {isSuperAdmin && (
          <PageTabContent value="directory">
            <AdministratorEmployeeDirectory />
          </PageTabContent>
        )}

        <PageTabContent value="payroll">
          <PayrollManagement />
        </PageTabContent>

        <PageTabContent value="tasks">
          <TaskManagement />
        </PageTabContent>

        <PageTabContent value="attendance">
          <StaffAttendanceCenter />
        </PageTabContent>

        <PageTabContent value="requests">
          <RequestsManagement />
        </PageTabContent>

        <PageTabContent value="chat">
          <ChatPanel />
        </PageTabContent>

        {(isSuperAdmin || isTeacher) && (
          <PageTabContent value="releve">
            <ReleveTab />
          </PageTabContent>
        )}

        {isSuperAdmin && (
          <PageTabContent value="workflows">
            <WorkflowMonitorTab />
          </PageTabContent>
        )}
      </PageTabs>
    </div>
  );
}
