import { useEffect } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { Sidebar } from "../shared/layout/sidebar";
import { Topbar } from "../shared/layout/topbar";
import { DesktopWindowFrame } from "../shared/layout/window-frame";
import { DashboardPage } from "../features/dashboard/dashboard-page";
import { CrmPage } from "../features/crm/crm-page";
import { AcademicsPage } from "../features/academics/academics-page";
import { ClassDetailPage } from "../features/academics/class-detail-page";
import { RollCallScreen } from "../features/academics/roll-call-screen";
import { GradeEntryScreen } from "../features/academics/grade-entry-screen";
import { FinancialsPage } from "../features/financials/financials-page";
import { PersonnelPage } from "../features/personnel/personnel-page";
import { WorkflowPage } from "../features/workflow/workflow-page";
import { RoutingPage } from "../features/routing/routing-page";
import { SettingsPage } from "../features/settings/settings-page";
import { ProfilePage } from "../features/profile/profile-page";
import { useRepositories } from "./providers/repository-provider";
import { useAuth } from "./providers/auth-provider";
import { startBackupScheduler } from "../infrastructure/backup/backup-scheduler";
import { routeRedirectFor, ROUTE_GUARD_REDIRECT } from "../core/rbac/route-access";
import { AICopilotDrawer } from "../features/ai/copilot-drawer";

export function AppShell() {
  const repos = useRepositories();
  const { session } = useAuth();
  const location = useLocation();

  useEffect(() => {
    if (!session) return;
    const stop = startBackupScheduler(repos, () => {
      if (!session) return null;
      return { id: session.userId, name: session.displayName };
    });
    return stop;
  }, [repos, session]);

  const redirectTo = routeRedirectFor(session, location.pathname);

  if (redirectTo) {
    return (
      <DesktopWindowFrame>
        <div className="flex h-full w-full overflow-hidden bg-background text-foreground">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <Topbar />
            <main className="min-h-0 flex-1 overflow-y-auto">
              <Routes>
                <Route path="*" element={<Navigate to={ROUTE_GUARD_REDIRECT} replace />} />
              </Routes>
            </main>
          </div>
          <AICopilotDrawer />
        </div>
      </DesktopWindowFrame>
    );
  }

  return (
    <DesktopWindowFrame>
      <div className="flex h-full w-full overflow-hidden bg-background text-foreground">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          <main className="min-h-0 flex-1 overflow-y-auto">
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/crm" element={<CrmPage />} />
              <Route path="/academics" element={<AcademicsPage />} />
              <Route path="/academics/class/:classId" element={<ClassDetailPage />} />
              <Route path="/academics/class/:classId/roll-call" element={<RollCallScreen />} />
              <Route path="/academics/class/:classId/grades/:subjectId" element={<GradeEntryScreen />} />
              <Route path="/financials" element={<FinancialsPage />} />
              <Route path="/personnel" element={<PersonnelPage />} />
              <Route path="/workflow" element={<WorkflowPage />} />
              <Route path="/routing" element={<RoutingPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </div>
        <AICopilotDrawer />
      </div>
    </DesktopWindowFrame>
  );
}
