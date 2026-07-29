/**
 * Administrator dashboard — full workforce oversight (iteration 8).
 *
 * Visible to SuperAdmin, FinancialOfficer, and SupportStaff. Administrators
 * have unrestricted access: they manage employees, departments, schedules,
 * tasks, attendance, requests, performance, chat, reports, and onboarding.
 *
 * The dashboard surfaces:
 *   - Top-line KPIs (headcount, pending requests, open tasks, on-leave count)
 *   - Department directory with one-click drill-down
 *   - Pending leave / absence requests (approve / reject inline)
 *   - Recent audit log entries
 *   - Workforce analytics chart (headcount by department)
 *
 * Role variation:
 *   - SuperAdmin: full CRUD, can rerun onboarding, can manage RBAC matrix
 *   - FinancialOfficer: read-only directory + approve purchase requests
 *   - SupportStaff: limited directory (own department only)
 */
import { useEffect, useMemo, useState } from "react";
import {
  Users, Building2, ClipboardList, CalendarClock, ShieldCheck,
  CheckCircle2, XCircle, Settings, Activity,
} from "lucide-react";
import { useRepositories } from "../../../infrastructure/repository-provider";
import { useObservable } from "../../../shared/hooks/use-observable";
import { useAuth } from "../../../state/auth-context";
import { useToast } from "../../../state/toast-context";
import type { Role } from "../../../core/rbac/roles";
import { ROLE_LABELS_FR } from "../../../core/rbac/roles";
import { REQUEST_STATUS_LABELS_FR, REQUEST_TYPE_LABELS_FR } from "../../../domain/model/workforce";
import { StatusChip } from "../../../shared/components/status-chip";
import { Button } from "../../../shared/ui/button";
import type { AuditEntry } from "../../../domain/model/audit";
import { DashboardGrid, DashboardKpiRow, DashboardSection, KpiCard } from "./dashboard-primitives";
import { AdministratorEmployeeDirectory } from "../management/employee-directory";
import { DepartmentManagement } from "../management/department-management";

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

  const departmentHeadcount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of personnel) {
      if (!p.departmentId) continue;
      counts.set(p.departmentId, (counts.get(p.departmentId) ?? 0) + 1);
    }
    return counts;
  }, [personnel]);

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
      toast.showError("Erreur", "Impossible d'enregistrer la décision.");
    }
  }

  return (
    <DashboardGrid>
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">
            Tableau de bord {ROLE_LABELS_FR[role]}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Vue d'ensemble de l'organisation : effectifs, départements, demandes et activité.
          </p>
        </div>
        {isFullAdmin && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              repos.onboarding.reset();
              toast.showInfo("Onboarding", "L'assistant de configuration a été réinitialisé.");
            }}
          >
            <Settings className="h-4 w-4" /> Relancer l'onboarding
          </Button>
        )}
      </div>

      {/* KPI row */}
      <DashboardKpiRow>
        <KpiCard
          label="Effectif total"
          value={personnel.length.toString()}
          icon={<Users className="h-5 w-5" />}
          tone="default"
          hint={`${personnel.filter((p) => p.status === "active").length} actifs`}
        />
        <KpiCard
          label="Départements"
          value={departments.filter((d) => !d.archivedAt).length.toString()}
          icon={<Building2 className="h-5 w-5" />}
          tone="info"
        />
        <KpiCard
          label="Demandes en attente"
          value={pendingRequests.length.toString()}
          icon={<ClipboardList className="h-5 w-5" />}
          tone={pendingRequests.length > 0 ? "warning" : "default"}
        />
        <KpiCard
          label="En congé"
          value={onLeaveCount.toString()}
          icon={<CalendarClock className="h-5 w-5" />}
          tone="warning"
        />
      </DashboardKpiRow>

      {/* Department overview */}
      <DashboardSection title="Départements" icon={Building2}>
        <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {departments.filter((d) => !d.archivedAt).map((dept) => {
            const count = departmentHeadcount.get(dept.id) ?? 0;
            return (
              <div
                key={dept.id}
                className="flex items-center justify-between rounded-lg border border-border p-3 hover:bg-accent/5 transition-colors"
              >
                <div className="min-w-0">
                  <p className="font-medium text-sm text-foreground truncate">{dept.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{dept.description}</p>
                </div>
                <StatusChip label={`${count} employé${count > 1 ? "s" : ""}`} tone="neutral" />
              </div>
            );
          })}
        </div>
      </DashboardSection>

      {/* Pending leave requests */}
      <DashboardSection title="Demandes à traiter" icon={ClipboardList}>
        {pendingRequests.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            Aucune demande en attente.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {pendingRequests.map((req) => (
              <li key={req.id} className="py-3 flex items-center gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm text-foreground truncate">
                    {req.personnelName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {REQUEST_TYPE_LABELS_FR[req.type]} • {req.fromDate} → {req.toDate}
                  </p>
                  {req.reason && (
                    <p className="text-xs text-muted-foreground mt-1 italic">« {req.reason} »</p>
                  )}
                </div>
                <StatusChip label={REQUEST_STATUS_LABELS_FR[req.status]} tone="warning" />
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => handleDecide(req.id, "rejected")}>
                    <XCircle className="h-4 w-4" /> Refuser
                  </Button>
                  <Button size="sm" onClick={() => handleDecide(req.id, "approved")}>
                    <CheckCircle2 className="h-4 w-4" /> Approuver
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </DashboardSection>

      {/* Recent activity (audit log) */}
      <DashboardSection title="Activité récente" icon={Activity}>
        {auditEntries.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Aucune activité enregistrée.</p>
        ) : (
          <ul className="divide-y divide-border">
            {auditEntries.slice(0, 6).map((entry) => (
              <li key={entry.id} className="py-2 flex items-center gap-3">
                <div className="h-7 w-7 rounded-full bg-accent/10 flex items-center justify-center shrink-0">
                  <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground truncate">
                    <span className="font-mono text-xs text-muted-foreground">{entry.action}</span>
                    {" — "}
                    {entry.actorName}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {new Date(entry.at).toLocaleString("fr-FR")}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </DashboardSection>

      {/* Employee directory (full admin / financial only) */}
      {isFullAdmin && (
        <>
          <AdministratorEmployeeDirectory />
          <DepartmentManagement />
        </>
      )}
    </DashboardGrid>
  );
}
