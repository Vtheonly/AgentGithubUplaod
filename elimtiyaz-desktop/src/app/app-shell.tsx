// ============================================================================
// FILE: elimtiyaz-desktop/src/app/app-shell.tsx
// ============================================================================

import { lazy, Suspense, useEffect } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { Sidebar } from "../shared/layout/sidebar";
import { Topbar } from "../shared/layout/topbar";
import { DesktopWindowFrame } from "../shared/layout/window-frame";
import { LoadingState } from "../shared/layout/state-views";
/*
 * T-583 (startup acceleration — EXECUTION-PLAN §4 / BUG-054): every
 * feature page is a route-level lazy chunk. The eleven static page
 * imports kept the ENTIRE feature graph (financials, academics, CRM,
 * personnel, workflow, settings + their heavy dependencies) inside the
 * eager entry bundle; React.lazy + Suspense moves each page behind its
 * first navigation, and the shared LoadingState is the fallback so a
 * slow chunk never renders a blank main region.
 */
const DashboardPage = lazy(() => import("../features/dashboard/dashboard-page").then((m) => ({ default: m.DashboardPage })));
const CrmPage = lazy(() => import("../features/crm/crm-page").then((m) => ({ default: m.CrmPage })));
const AcademicsPage = lazy(() => import("../features/academics/academics-page").then((m) => ({ default: m.AcademicsPage })));
const ClassDetailPage = lazy(() => import("../features/academics/class-detail-page").then((m) => ({ default: m.ClassDetailPage })));
const RollCallScreen = lazy(() => import("../features/academics/roll-call-screen").then((m) => ({ default: m.RollCallScreen })));
const GradeEntryScreen = lazy(() => import("../features/academics/grade-entry-screen").then((m) => ({ default: m.GradeEntryScreen })));
const FinancialsPage = lazy(() => import("../features/financials/financials-page").then((m) => ({ default: m.FinancialsPage })));
const PersonnelPage = lazy(() => import("../features/personnel/personnel-page").then((m) => ({ default: m.PersonnelPage })));
const WorkflowPage = lazy(() => import("../features/workflow/workflow-page").then((m) => ({ default: m.WorkflowPage })));
const SettingsPage = lazy(() => import("../features/settings/settings-page").then((m) => ({ default: m.SettingsPage })));
const ProfilePage = lazy(() => import("../features/profile/profile-page").then((m) => ({ default: m.ProfilePage })));
import { useRepositories } from "./providers/repository-provider";
import { useAuth } from "./providers/auth-provider";
import { startBackupScheduler } from "../infrastructure/backup/backup-scheduler";
import { routeRedirectFor, ROUTE_GUARD_REDIRECT } from "../core/rbac/route-access";
import { AICopilotDrawer } from "../features/ai/copilot-drawer";
import { PersonNavigationProvider } from "../shared/navigation/person-navigation-context";
// T-627 (C-25): the tenant custom-palette hydration — pushes the tenant's
// branding list over the device cache once per session (null-rendering).
import { TenantThemeHydrator } from "./tenant-theme-hydrator";

export function AppShell() {
  const repos = useRepositories();
  const { session } = useAuth();
  const location = useLocation();

  useEffect(() => {
    if (!session) return;
    const stop = startBackupScheduler(repos, () => {
      if (!session) return null;
      // T-581 (BUG-015): the scheduler actor carries the session tenant
      // (injected context — the backup family never hardcodes it).
      return { id: session.userId, name: session.displayName, tenantId: session.tenantId ?? undefined };
    });
    return stop;
  }, [repos, session]);

  const redirectTo = routeRedirectFor(session, location.pathname);

  if (redirectTo) {
    return (
      <PersonNavigationProvider>
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
      </PersonNavigationProvider>
    );
  }

  return (
    <PersonNavigationProvider>
      <DesktopWindowFrame>
        <div className="flex h-full w-full overflow-hidden bg-background text-foreground">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <Topbar />
            <main className="min-h-0 flex-1 overflow-y-auto">
              {/* T-583: the route pages load as async chunks — the shared
                  loading state fills the main region until each lands. */}
              <Suspense fallback={<LoadingState />}>
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
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route path="/profile" element={<ProfilePage />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </Suspense>
            </main>
          </div>
          {/* T-627 (C-25): the tenant custom-palette hydration — mounted once
              per shell (per session); null-rendering, fail-open. */}
          <TenantThemeHydrator />
          <AICopilotDrawer />
        </div>
      </DesktopWindowFrame>
    </PersonNavigationProvider>
  );
}