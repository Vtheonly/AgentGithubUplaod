/**
 * RoleDashboardTemplate — E6.10 (ROADMAP 5.11 / D-U3): the ONE role-dashboard
 * page template. The seven personnel dashboards are near-parallel consumers:
 * they declare their subscriptions, KPI derivations, and task lists, and
 * hand the page chrome to this template — which resolves the header label
 * through the CANONICAL core ROLE_LABELS_FR map (§6 reuse-first: no second
 * label map; this also ends the administrator dashboard's inline ternary
 * chain, whose "Agent de Support" was a non-canonical third variant of
 * support_staff — §15.3 one-wording, now aligned) and the actor name
 * (prop → session display name → the role's dashboard default).
 *
 * T-596's dashboard overhaul consumes this template for its role-scoped
 * views (the plan's « D-U3 RoleDashboardTemplate » seam).
 *
 * The rendering shell is RoleDashboardLayout (header + KPI row + tasks +
 * children) — the template is the wiring layer above it, not a second
 * layout (§6: one canonical implementation, no parallel skeleton).
 */
import type { ReactNode } from "react";
import { Role, ROLE_LABELS_FR } from "../../../core/rbac/roles";
import { useAuth } from "../../../app/providers/auth-provider";
import {
  RoleDashboardLayout,
  type DashboardKpi,
  type DashboardTask,
  type DashboardHeaderAction,
} from "./role-dashboard-layout";

/** The actor-line fallback per role (when the session carries no display
 *  name) — dashboard semantics, not role semantics: the three admin roles
 *  all land on the shared "Administrateur" default, exactly as the three
 *  pre-template call sites inlined. */
const ROLE_DASHBOARD_ACTOR_DEFAULTS_FR: Record<Role, string> = {
  [Role.SuperAdmin]: "Administrateur",
  [Role.FinancialOfficer]: "Administrateur",
  [Role.SupportStaff]: "Administrateur",
  [Role.Manager]: "Responsable",
  [Role.Buyer]: "Acheteur",
  [Role.Driver]: "Chauffeur",
  [Role.WarehouseWorker]: "Magasinier",
  [Role.Teacher]: "Enseignant",
  [Role.Worker]: "Ouvrier",
  [Role.Parent]: "Parent",
  [Role.Student]: "Élève",
};

export interface RoleDashboardTemplateProps {
  /** The caller's Role — the template resolves the header label (the
   *  administrator dashboard passes its super_admin/financial_officer/
   *  support_staff role through; the fixed-role dashboards their role). */
  readonly role: Role;
  readonly kpis: readonly DashboardKpi[];
  readonly tasks?: readonly DashboardTask[];
  readonly actions?: readonly DashboardHeaderAction[];
  /** Override for the actor line (wins over the session display name). */
  readonly actorName?: string;
  readonly children?: ReactNode;
}

export function RoleDashboardTemplate({
  role,
  kpis,
  tasks,
  actions,
  actorName,
  children,
}: RoleDashboardTemplateProps): ReactNode {
  const { session } = useAuth();
  const resolvedActor =
    actorName ?? session?.displayName ?? ROLE_DASHBOARD_ACTOR_DEFAULTS_FR[role];

  return (
    <RoleDashboardLayout
      role={ROLE_LABELS_FR[role]}
      actorName={resolvedActor}
      kpis={kpis}
      tasks={tasks}
      actions={actions}
    >
      {children}
    </RoleDashboardLayout>
  );
}
