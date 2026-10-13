// ============================================================================
// FILE: src/features/personnel/dashboards/administrator-dashboard.tsx
// ============================================================================
/**
 * Administrator Dashboard — Executive Command Radar for Personnel.
 *
 * Provides complete operational oversight:
 *   - Headcount & Payroll budget
 *   - Pending Leave & Expense Reimbursement queue
 *   - Staff Absence Justification Alerts
 *   - Task Execution Velocity & Review Queue
 */

import { useMemo } from "react";
import {
  Users,
  ClipboardList,
  Wallet,
  Settings,
  Calendar,
  AlertTriangle,
} from "lucide-react";
import { useRepositories } from "../../../app/providers/repository-provider";
import { useObservable } from "../../../shared/hooks/use-observable";
import { useAuth } from "../../../app/providers/auth-provider";
import { useToast } from "../../../app/providers/toast-provider";
import type { Role } from "../../../core/rbac/roles";
import {
  RoleDashboardLayout,
  type DashboardKpi,
  type DashboardTask,
} from "./role-dashboard-layout";
import { formatDzd } from "../../../core/format/currency";
import { REQUEST_TYPE_LABELS_FR } from "../../../domain/model/workforce";
// T-521: the expense labels for the admin task list's expense entries.
import { EXPENSE_CATEGORY_LABELS_FR } from "../../../domain/model/expense";

interface Props {
  role: Role;
}

export function AdministratorDashboard({ role }: Props) {
  const repos = useRepositories();
  const { session } = useAuth();
  const toast = useToast();

  const personnel = useObservable(() => repos.personnel.observe(), []);
  const tasks = useObservable(() => repos.tasks.observe(), []);
  const leaveRequests = useObservable(() => repos.leaveRequests.observe(), []);
  // T-521 (issue #29 / WORKFORCE-517): the canonical expenses stream — the
  // KPI card named "Demandes & Dépenses" now counts the REAL pending expense
  // tickets alongside the leave requests (it previously counted leave only).
  const expenses = useObservable(() => repos.expenses.observe(), []);
  const absences = useObservable(
    () => repos.workforceAttendance.observeAbsences(),
    [],
  );

  const activeCount = useMemo(
    () => personnel.filter((p) => p.status === "active").length,
    [personnel],
  );
  const pendingRequests = useMemo(
    () => leaveRequests.filter((r) => r.status === "pending"),
    [leaveRequests],
  );
  // T-521: the pending EXPENSE tickets (the canonical stream — the same
  // records the Finance tab and the Personnel review queue show).
  const pendingExpenses = useMemo(
    () => expenses.filter((e) => e.status === "submitted"),
    [expenses],
  );
  const unexcusedAbsences = useMemo(
    () => absences.filter((a) => !a.isExcused),
    [absences],
  );
  const tasksToReview = useMemo(
    () => tasks.filter((t) => t.status === "needs_review"),
    [tasks],
  );

  const totalPayrollBudget = useMemo(
    () =>
      personnel
        .filter((p) => p.status === "active")
        .reduce((sum, p) => sum + (p.salary ?? 0), 0),
    [personnel],
  );

  const isFullAdmin = role === "super_admin";
  const roleLabel =
    role === "super_admin"
      ? "Super Administrateur"
      : role === "financial_officer"
        ? "Agent Financier"
        : "Agent de Support";

  const kpis: readonly DashboardKpi[] = [
    {
      label: "Masse Salariale Mensuelle",
      value: formatDzd(totalPayrollBudget, { compact: true }),
      icon: Wallet,
      trend: `${activeCount} actifs`,
    },
    {
      label: "Tâches à valider",
      value: tasksToReview.length,
      icon: ClipboardList,
      trend: tasksToReview.length > 0 ? "Action requise" : "À jour",
    },
    {
      label: "Absences non justifiées",
      value: unexcusedAbsences.length,
      icon: Calendar,
      trend: unexcusedAbsences.length > 0 ? "Relance justif." : "0 alertes",
    },
    {
      label: "Demandes & Dépenses",
      value: pendingRequests.length + pendingExpenses.length,
      icon: Users,
      trend:
        pendingRequests.length + pendingExpenses.length > 0
          ? `${pendingRequests.length} congé(s) · ${pendingExpenses.length} dépense(s)`
          : "0 en attente",
    },
  ];

  const dashboardTasks: readonly DashboardTask[] = [
    ...tasksToReview.map((t) => ({
      id: t.id,
      label: `Valider tâche : ${t.title}`,
      description: `Soumis par : ${t.assigneeIds.join(", ")}`,
      priority: "high" as const,
    })),
    ...pendingRequests.map((req) => ({
      id: req.id,
      label: `Demande : ${req.personnelName} (${REQUEST_TYPE_LABELS_FR[req.type]})`,
      description: `${req.reason}`,
      priority: "medium" as const,
    })),
    // T-521: the pending expense tickets join the admin task list.
    ...pendingExpenses.map((exp) => ({
      id: exp.id,
      label: `Dépense : ${exp.title} (${exp.requestCode})`,
      description: `${EXPENSE_CATEGORY_LABELS_FR[exp.category]} · ${exp.payee}`,
      priority: (exp.urgency === "high" ? "high" : "medium") as "high" | "medium",
    })),
  ];

  return (
    <RoleDashboardLayout
      role={roleLabel}
      actorName={session?.displayName ?? "Administrateur"}
      kpis={kpis}
      tasks={dashboardTasks}
      actions={
        isFullAdmin
          ? [
              {
                label: "Réinitialiser Onboarding",
                icon: Settings,
                variant: "outline",
                onClick: () => {
                  repos.onboarding.reset();
                  toast.showInfo(
                    "Onboarding",
                    "L'assistant de configuration a été réinitialisé.",
                  );
                },
              },
            ]
          : []
      }
    >
      {/* Alert Banner for pending justifications or reviews */}
      {(tasksToReview.length > 0 || unexcusedAbsences.length > 0) && (
        <div className="rounded-lg border border-status-warning/40 bg-status-warning/10 p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-status-warning" />
            <div>
              <p className="text-sm font-semibold text-foreground">
                Points d'attention administrative
              </p>
              <p className="text-xs text-muted-foreground">
                {tasksToReview.length} tâche(s) terminée(s) en attente de
                validation administrative et {unexcusedAbsences.length}{" "}
                absence(s) nécessitant une justification.
              </p>
            </div>
          </div>
        </div>
      )}
    </RoleDashboardLayout>
  );
}
