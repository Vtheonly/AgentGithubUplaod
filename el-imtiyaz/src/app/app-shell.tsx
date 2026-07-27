/**
 * AppShell — the main authenticated layout: sidebar + topbar + content area.
 *
 * Routes are wired here so each feature hub owns its own routing subtree.
 * The content area uses overflow-y-auto so each page manages its own scroll.
 */
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
import { RoutingPage } from "../features/routing/routing-page";
import { SettingsPage } from "../features/settings/settings-page";

export function AppShell() {
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
            <Route path="/routing" element={<RoutingPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
