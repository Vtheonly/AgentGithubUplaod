/**
 * Administrator dashboard — full workforce oversight.
 *
 * Visible to SuperAdmin, FinancialOfficer, and SupportStaff. Administrators
 * have unrestricted access: they manage employees, departments, schedules,
 * tasks, attendance, requests, performance, chat, reports, and onboarding.
 *
 * Refactored to consume `<RoleDashboardLayout>` (KPI row + pending-request
 * tasks + audit-log feed) and embed `<AdministratorEmployeeDirectory>` +
 * `<DepartmentManagement>` as `children`.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Users, Building2, ClipboardList, CalendarClock, ShieldCheck, Settings,
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
  type DashboardFeedItem,
} from "./role-dashboard-layout";
import { AdministratorEmployeeDirectory } from "../management/employee-directory";
import { DepartmentManagement } from "../management/department-management";
import type { AuditEntry } from "../../../domain/model/audit";
import { REQUEST_TYPE_LABELS_FR, REQUEST_STATUS_LABELS_FR } from "../../../domain/model/workforce";

interface Props {
  role: Role;
}

export function AdministratorDashboard({ role }: Props) {
  const repos = useRepositories();
  const personnel = useObservable(() => repos.personnel.observe(), []);
  const departments = useObservable(() => repos.departments.observe(), []);
  const leaveRequests = useObservable(() => repos.leaveRequests.observe(), []);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const { session } = useAuth();
  const toast = useToast();

  // Audit log is async (Promise<Result<…>>), not an Observable — load on mount.
  useEffect(() => {
    let cancelled = false;
    repos.audit.recent(8).then((res) => {
      if (!cancelled && res.ok) setAuditEntries(res.value);
    });
    return () => { cancelled = true; };
  }, [repos.audit]);

  const pendingRequests = useMemo(
    () => leaveRequests.filter((r) => r.status === "pending"),
    [leaveRequests],
  );
  const onLeaveCount = useMemo(
    () => personnel.filter((p) => p.status === "on_leave").length,
    [personnel],
  );
  const activeCount = useMemo(
    () => personnel.filter((p) => p.status === "active").length,
    [personnel],
  );

  const isFullAdmin = role === "super_admin";

  async function handleDecide(requestId: string, status: "approved" | "rejected") {
    if (!session) return;
    const result = await repos.leaveRequests.decide(
      requestId,
      status,
      session.userId,
      session.displayName,
      status === "approved" ? "Approuvé par l'administrateur" : "Refusé par l'administrateur",
    );
    if (result.ok) {
      toast.showSuccess(
        status === "approved" ? "Demande approuvée" : "Demande refusée",
        "La décision a été enregistrée.",
      );
    } else {
      toast.showError("Erreur", result.error.userMessage);
    }
  }

  const kpis: readonly DashboardKpi[] = [
    { label: "Effectif total", value: personnel.length, icon: Users, trend: `${activeCount} actifs` },
    { label: "Départements", value: departments.filter((d) => !d.archivedAt).length, icon: Building2 },
    { label: "Demandes en attente", value: pendingRequests.length, icon: ClipboardList, trend: pendingRequests.length > 0 ? "À traiter" : undefined },
    { label: "En congé", value: onLeaveCount, icon: CalendarClock },
  ];

  const tasks: readonly DashboardTask[] = pendingRequests.slice(0, 6).map((req) => ({
    id: req.id,
    label: `${req.personnelName} — ${REQUEST_TYPE_LABELS_FR[req.type]}`,
    description: `${req.fromDate} → ${req.toDate}${req.reason ? ` : ${req.reason}` : ""}`,
    priority: "high",
  }));

  const feed: readonly DashboardFeedItem[] = auditEntries.slice(0, 6).map((e) => ({
    id: e.id,
    label: `${e.action} — ${e.actorName}`,
    description: e.entityId,
    timestamp: new Date(e.at).toLocaleTimeString("fr-FR"),
    icon: ShieldCheck,
  }));

  return (
    <RoleDashboardLayout
      role="Administration"
      actorName={session?.displayName ?? "Administrateur"}
      kpis={kpis}
      tasks={tasks}
      feed={feed}
      actions={isFullAdmin ? [
        {
          label: "Relancer l'onboarding",
          icon: Settings,
          variant: "outline",
          onClick: () => {
            repos.onboarding.reset();
            toast.showInfo("Onboarding", "L'assistant de configuration a été réinitialisé.");
          },
        },
      ] : []}
    >
      {/* Inline pending-requests quick-decision panel (kept for one-click approve) */}
      {pendingRequests.length > 0 && (
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold">Demandes à traiter</h3>
            <span className="text-xs text-muted-foreground">
              {REQUEST_STATUS_LABELS_FR.pending} · {pendingRequests.length} en attente
            </span>
          </div>
          <ul className="divide-y divide-border">
            {pendingRequests.map((req) => (
              <li key={req.id} className="py-3 flex items-center gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{req.personnelName}</p>
                  <p className="text-xs text-muted-foreground">
                    {REQUEST_TYPE_LABELS_FR[req.type]} · {req.fromDate} → {req.toDate}
                  </p>
                  {req.reason && <p className="text-xs text-muted-foreground mt-0.5 italic">« {req.reason} »</p>}
                </div>
                <button
                  type="button"
                  onClick={() => handleDecide(req.id, "rejected")}
                  className="text-xs text-status-danger hover:underline"
                >
                  Refuser
                </button>
                <button
                  type="button"
                  onClick={() => handleDecide(req.id, "approved")}
                  className="text-xs text-status-success hover:underline"
                >
                  Approuver
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {isFullAdmin && (
        <div className="space-y-6">
          <AdministratorEmployeeDirectory />
          <DepartmentManagement />
        </div>
      )}
    </RoleDashboardLayout>
  );
}
