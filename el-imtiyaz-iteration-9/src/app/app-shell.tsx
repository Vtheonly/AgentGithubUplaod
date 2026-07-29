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
 */
import { useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { Sidebar } from "../shared/components/sidebar";
import { Topbar } from "../shared/components/topbar";
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
import { useRepositories } from "../infrastructure/repository-provider";
import { useAuth } from "../state/auth-context";
import { startBackupScheduler } from "../infrastructure/backup/backup-scheduler";

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

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-surface-background text-foreground">
      <Sidebar />
      <div className="flex flex-1 flex-col min-w-0">
        <Topbar />
        <main className="flex-1 overflow-y-auto">
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
    </div>
  );
}
