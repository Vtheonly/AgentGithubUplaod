/**
 * Role-based dashboard router for the Personnel module (iteration 8).
 *
 * The Personnel page is the primary workspace for every employee. Instead of
 * a single one-size-fits-all UI, it dispatches to a role-specific dashboard
 * that exposes only the tools and information the role needs.
 *
 * Routing table:
 *   SuperAdmin / FinancialOfficer / SupportStaff → AdministratorDashboard
 *   Manager                                     → ManagerDashboard
 *   Buyer                                       → BuyerDashboard
 *   Driver                                      → DriverDashboard
 *   WarehouseWorker                             → WarehouseWorkerDashboard
 *   Teacher                                     → TeacherDashboard
 *   Worker                                      → WorkerDashboard
 *
 * Unknown / Parent / Student roles fall back to a "no access" panel.
 */
import type { Role } from "../../../core/rbac/roles";
import { AdministratorDashboard } from "./administrator-dashboard";
import { ManagerDashboard } from "./manager-dashboard";
import { BuyerDashboard } from "./buyer-dashboard";
import { DriverDashboard } from "./driver-dashboard";
import { WarehouseWorkerDashboard } from "./warehouse-worker-dashboard";
import { TeacherDashboard } from "./teacher-dashboard";
import { WorkerDashboard } from "./worker-dashboard";
import { ComingSoonCard } from "../../../shared/layout/coming-soon-card";

export function RoleDashboardRouter({ role }: { role: Role }) {
  switch (role) {
    case "super_admin":
    case "financial_officer":
    case "support_staff":
      return <AdministratorDashboard role={role} />;
    case "manager":
      return <ManagerDashboard />;
    case "buyer":
      return <BuyerDashboard />;
    case "driver":
      return <DriverDashboard />;
    case "warehouse_worker":
      return <WarehouseWorkerDashboard />;
    case "teacher":
      return <TeacherDashboard />;
    case "worker":
      return <WorkerDashboard />;
    default:
      return (
        <ComingSoonCard
          title="Accès non configuré"
          description="Aucun tableau de bord n'est défini pour votre rôle. Contactez un administrateur."
        />
      );
  }
}
