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
 * to access the main dashboard route ("/").
 *
 * T-234 / RBAC-300 (35th session): the single-route guard became a full
 * route-guard table. EVERY gated navigation section (/, /crm, /academics,
 * /financials, /workflow, /routing, /settings) is now guarded through the
 * SAME FeatureNode requirement the sidebar evaluates (route-access.ts) —
 * direct-URL access to an administrative module by an operational role
 * (Teacher/Driver/Buyer/WarehouseWorker/Worker) redirects to /personnel.
 * The per-route DASHBOARD_RESTRICTED_ROLES set was replaced by the shared
 * gate table (defense in depth, ONE source of truth — no drift between
 * the sidebar padlock and the route guard).
 */
import { useEffect } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
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
import { routeRedirectFor, ROUTE_GUARD_REDIRECT } from "../core/rbac/route-access";

export function AppShell() {
  const repos = useRepositories();
  const { session } = useAuth();
  const location = useLocation();

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

  // T-234 / RBAC-300: route guard. Every protected prefix is evaluated
  // against the same FeatureNode requirement the sidebar uses; a session
  // that fails it is redirected to /personnel (the operational staff's
  // workspace). Runs on every location change so deep links AND in-app
  // navigations are covered ("defense in depth" — the sidebar padlock
  // alone was bypassable via the URL bar).
  const redirectTo = routeRedirectFor(session, location.pathname);

  if (redirectTo) {
    return (
      <div className="flex h-screen w-screen overflow-hidden bg-surface-background text-foreground">
        <Sidebar />
        <div className="flex flex-1 flex-col min-w-0">
          <Topbar />
          <main className="flex-1 overflow-y-auto">
            <Routes>
              <Route path="*" element={<Navigate to={ROUTE_GUARD_REDIRECT} replace />} />
            </Routes>
          </main>
        </div>
      </div>
    );
  }

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
