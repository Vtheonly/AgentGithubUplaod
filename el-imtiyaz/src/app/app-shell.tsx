/**
 * AppShell — the main authenticated layout: sidebar + topbar + content area.
 *
 * Routes are wired here so each feature hub owns its own routing subtree.
 * The content area uses overflow-y-auto so each page manages its own scroll.
 *
 * Iteration 7: the AES-256 backup scheduler (plan §13) is started here in
 * a useEffect after the user is authenticated. The scheduler ticks every
 * 24h in production (every 5m in dev) and writes a new encrypted archive
 * to the IndexedDB vault using the current session user as the actor.
 *
 * Iteration 9: Dashboard access control (spec §1.1). Teachers and other
 * non-administrative staff are redirected to /personnel when they attempt
 * to access the main dashboard route ("/"). The Sidebar's GatedContent
 * also hides the dashboard nav entry for these roles, but we add a route
 * guard here as defense-in-depth so direct URL access is also blocked.
 */
import { useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { Sidebar } from "../shared/layout/sidebar";
import { Topbar } from "../shared/layout/topbar";
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
import { Role } from "../core/rbac/roles";

/**
 * Iteration 9 — set of roles that are NOT allowed to access the main
 * administrative dashboard. They are redirected to /personnel instead.
 */
const DASHBOARD_RESTRICTED_ROLES = new Set<Role>([
  Role.Teacher,
  Role.Buyer,
  Role.Driver,
  Role.WarehouseWorker,
  Role.Worker,
  Role.Parent,
  Role.Student,
]);

export function AppShell() {
  const repos = useRepositories();
  const { session } = useAuth();

  // Iteration 7: start the backup scheduler after the user is authenticated.
  // The scheduler uses the current session user as the actor at tick-time
  // (not start-time), so user changes (logout/login) are picked up. The
  // returned unsubscribe function is called on cleanup (component unmount
  // or session change).
  useEffect(() => {
    if (!session) return;
    const stop = startBackupScheduler(repos, () => {
      if (!session) return null;
      return { id: session.userId, name: session.displayName };
    });
    return stop;
  }, [repos, session]);

  // Iteration 9: route guard for the dashboard. If the session role is in
  // the restricted set, render a redirect to /personnel instead of the
  // dashboard. This blocks direct URL access ("defense in depth").
  const canAccessDashboard = session ? !DASHBOARD_RESTRICTED_ROLES.has(session.role) : false;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-surface-background text-foreground">
      <Sidebar />
      <div className="flex flex-1 flex-col min-w-0">
        <Topbar />
        <main className="flex-1 overflow-y-auto">
          <Routes>
            <Route
              path="/"
              element={canAccessDashboard ? <DashboardPage /> : <Navigate to="/personnel" replace />}
            />
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
    </div>
  );
}
