/**
 * ProfilePage — dedicated /profile route (iteration 3-J).
 *
 * Replaces the previous behavior where the topbar profile menu navigated
 * to Settings. Now the profile menu opens this dedicated page with:
 *   - Header (avatar, displayName, email, role badge, tenant ID, session expiry)
 *   - Permission grid (chip per granted permission)
 *   - Recent activity (10 most-recent audit entries by current user)
 *
 * Iteration 10 — added Password Governance card (plan §12.04):
 *   - "Modifier mon mot de passe" button opens the ChangePasswordModal.
 *   - Self-service password change with re-authentication + session revocation.
 *   - Strength checklist (8+ chars, lowercase, uppercase, digit) per
 *     plan §12.04 "Strong Entropy".
 *
 * Uses UnifiedModal-style cards and the standard PageHeader so the
 * visual language matches every other page in the application.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft, Shield, Clock, Mail, Building2, KeyRound, Lock,
  Briefcase, ListTodo, CalendarDays, UserCheck, Receipt,
} from "lucide-react";
import { useAuth } from "../../app/providers/auth-provider";
import { useRepositories } from "../../app/providers/repository-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import { PageHeader } from "../../shared/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../shared/ui/card";
import { Button } from "../../shared/ui/button";
import { Avatar, AvatarFallback } from "../../shared/ui/avatar";
import { Badge } from "../../shared/ui/badge";
import { StatusChip } from "../../shared/ui/status-chip";
import { EmptyState } from "../../shared/layout/state-views";
import { ChangePasswordModal } from "./change-password-modal";
import { Permission, PERMISSION_LABELS_FR } from "../../core/rbac/permissions";
import { ROLE_LABELS_FR } from "../../core/rbac/roles";
import { formatDateTime, formatDate } from "../../core/format/date";
import type { AuditEntry } from "../../domain/model/audit";
import {
  STAFF_CATEGORY_LABELS_FR,
  type Personnel,
} from "../../domain/model/personnel";
import {
  TASK_STATUS_LABELS_FR,
  REQUEST_STATUS_LABELS_FR,
} from "../../domain/model/workforce";
import type { Task, LeaveRequest } from "../../domain/model/workforce";

export function ProfilePage() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const repos = useRepositories();

  const [recentActivity, setRecentActivity] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [pwdOpen, setPwdOpen] = useState(false);

  // T-371 (WORKFORCE-501) — the EMPLOYEE dossier: when the signed-in
  // account is linked to a personnel record (personnel.user_id — the
  // binding the redesigned account-creation workflow makes), resolve "me"
  // and surface the employee's own profile, responsibilities, tasks and
  // requests. Unlinked accounts (admins without a fiche, parents, …) see
  // the session-only view, unchanged.
  const currentUserId = session?.userId ?? "";
  const me = useObservable(
    () => repos.personnel.observeByUserId(currentUserId),
    [currentUserId, repos.personnel],
  );
  const personnelDirectory = useObservable(() => repos.personnel.observe(), []);
  const departments = useObservable(() => repos.departments.observe(), []);
  const myTasks = useObservable(
    () =>
      currentUserId
        ? repos.tasks.observeByAssignee(currentUserId)
        : repos.tasks.observe(),
    [currentUserId, repos.tasks],
  );
  const myLeave = useObservable(
    () =>
      me
        ? repos.leaveRequests.observeByPersonnel(me.id)
        : repos.leaveRequests.observe(),
    [me?.id, repos.leaveRequests],
  );

  const departmentName = useMemo(
    () => departments.find((d) => d.id === me?.departmentId)?.name ?? null,
    [departments, me?.departmentId],
  );
  const supervisor = useMemo(
    () =>
      me?.supervisorId
        ? personnelDirectory.find((p) => p.id === me.supervisorId) ?? null
        : null,
    [personnelDirectory, me?.supervisorId],
  );
  const openTasks = useMemo(
    () =>
      myTasks.filter(
        (t) => t.status !== "completed" && t.status !== "cancelled",
      ),
    [myTasks],
  );
  const completedTasks = useMemo(
    () => myTasks.filter((t) => t.status === "completed").length,
    [myTasks],
  );
  const pendingRequests = useMemo(
    () => myLeave.filter((r) => r.status === "pending").length,
    [myLeave],
  );

  useEffect(() => {
    void (async () => {
      if (!session) return;
      setLoading(true);
      // Query the most recent 10 audit entries by the current user
      const result = await repos.audit.query({
        actorNameContains: session.displayName,
        limit: 10,
      });
      if (result.ok) {
        // Filter to entries actually by this user (defensive)
        const filtered = result.value.entries.filter(
          (e) => e.actorName === session.displayName || e.actorId === session.userId,
        );
        setRecentActivity(filtered.slice(0, 10));
      }
      setLoading(false);
    })();
  }, [session, repos.audit]);

  if (!session) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader title="Profil" description="Aucune session active." />
      </div>
    );
  }

  const initials = session.displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0] ?? "")
    .join("")
    .toUpperCase();

  const expiresAt = new Date(session.expiresAt);
  const msUntilExpiry = session.expiresAt - Date.now();
  const hoursUntilExpiry = Math.round(msUntilExpiry / (1000 * 60 * 60));
  const minutesUntilExpiry = Math.round(msUntilExpiry / (1000 * 60));

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Mon profil"
        description="Vos informations de session, permissions et activité récente"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setPwdOpen(true)}>
              <Lock className="h-4 w-4" /> Mot de passe
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate(-1)}>
              <ArrowLeft className="h-4 w-4" /> Retour
            </Button>
          </>
        }
      />

      <div className="flex-1 overflow-y-auto px-6 pb-6 space-y-4">
        {/* T-371 — the employee dossier (rendered only when the account is
            linked to a personnel record; see observeByUserId above). */}
        {me && (
          <EmployeeDossierCard
            me={me}
            departmentName={departmentName}
            supervisorName={
              supervisor ? `${supervisor.firstName} ${supervisor.lastName}` : null
            }
            openTasks={openTasks}
            completedTasks={completedTasks}
            recentTasks={openTasks.slice(0, 5)}
            pendingRequests={pendingRequests}
            recentRequests={myLeave.slice(0, 3)}
          />
        )}

        {/* Identity header */}
        <Card>
          <CardContent className="p-5">
            <div className="flex items-start gap-4">
              <Avatar className="h-16 w-16">
                <AvatarFallback className="text-lg font-semibold">
                  {initials || "?"}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold text-foreground">{session.displayName}</h2>
                  <Badge variant="default">{ROLE_LABELS_FR[session.role]}</Badge>
                </div>
                <div className="mt-1 space-y-0.5 text-sm text-muted-foreground">
                  <p className="flex items-center gap-1.5">
                    <Mail className="h-3.5 w-3.5" /> {session.email}
                  </p>
                  <p className="flex items-center gap-1.5">
                    <Building2 className="h-3.5 w-3.5" /> Tenant: <code className="font-mono text-xs">{session.tenantId}</code>
                  </p>
                  <p className="flex items-center gap-1.5">
                    <KeyRound className="h-3.5 w-3.5" /> User ID: <code className="font-mono text-xs">{session.userId}</code>
                  </p>
                  <p className="flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" />
                    Session: expire {hoursUntilExpiry > 0
                      ? `dans ${hoursUntilExpiry}h`
                      : `dans ${minutesUntilExpiry}min`}
                    <span className="text-[11px]">({formatDateTime(expiresAt.toISOString())})</span>
                  </p>
                </div>
              </div>
              <StatusChip
                label={msUntilExpiry > 0 ? "Active" : "Expirée"}
                tone={msUntilExpiry > 0 ? "success" : "danger"}
              />
            </div>
          </CardContent>
        </Card>

        {/* Iteration 10 — Password Governance card (plan §12.04) */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Lock className="h-4 w-4 text-status-warning" /> Sécurité du compte
            </CardTitle>
            <CardDescription>
              Plan §12.04 — modification du mot de passe avec ré-authentification + révocation de session.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-foreground">Mot de passe</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Modifiez votre mot de passe pour sécuriser votre compte. Toutes vos sessions actives
                  seront révoquées après le changement.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setPwdOpen(true)}>
                <KeyRound className="h-4 w-4" /> Modifier
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Permissions grid */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary" /> Permissions accordées
            </CardTitle>
            <CardDescription>
              {session.permissions.size} permission(s) — précalculées à la connexion (plan §02.07)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {Array.from(session.permissions).map((perm) => (
                <div
                  key={perm}
                  className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-status-success" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">
                      {PERMISSION_LABELS_FR[perm as Permission] ?? perm}
                    </p>
                    <p className="text-[10px] font-mono text-muted-foreground">{perm}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Recent activity */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary" /> Activité récente
            </CardTitle>
            <CardDescription>10 dernières actions enregistrées dans le journal d'audit</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground text-center py-6">Chargement…</p>
            ) : recentActivity.length === 0 ? (
              <EmptyState
                title="Aucune activité récente"
                description="Vos actions apparaîtront ici dès que vous interagissez avec le système."
              />
            ) : (
              <ul className="divide-y divide-border">
                {recentActivity.map((entry) => (
                  <li key={entry.id} className="flex items-center gap-3 py-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <code className="text-xs font-mono text-primary">{entry.action}</code>
                        <span className="text-xs text-muted-foreground">{entry.entityType}</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {entry.entityId}
                        {entry.note ? ` · ${entry.note}` : ""}
                      </p>
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {formatDateTime(entry.at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <ChangePasswordModal open={pwdOpen} onOpenChange={setPwdOpen} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* T-371 — the employee dossier card                                    */
/* ------------------------------------------------------------------ */

/**
 * The self-service dossier a LINKED employee sees on /profile: identity +
 * responsibilities (position, department, supervisor, hire date), the task
 * summary (open / completed, next five with due dates) and the request
 * pipeline state. Everything resolves through the personnel.user_id binding
 * created by the redesigned account-creation workflow (WORKFORCE-501) —
 * with no binding this card never renders.
 */
function EmployeeDossierCard(props: {
  me: Personnel;
  departmentName: string | null;
  supervisorName: string | null;
  openTasks: readonly Task[];
  completedTasks: number;
  recentTasks: readonly Task[];
  pendingRequests: number;
  recentRequests: readonly LeaveRequest[];
}) {
  const {
    me,
    departmentName,
    supervisorName,
    openTasks,
    completedTasks,
    recentTasks,
    pendingRequests,
    recentRequests,
  } = props;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <Briefcase className="h-4 w-4 text-primary" /> Mon dossier employé
        </CardTitle>
        <CardDescription>
          Vos informations professionnelles, responsabilités et tâches — issues
          de votre fiche employé, visibles uniquement par vous.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Identity + responsibilities */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">
            {me.firstName} {me.lastName}
          </span>
          <Badge variant="outline">{STAFF_CATEGORY_LABELS_FR[me.staffCategory]}</Badge>
          <StatusChip
            label={me.status === "active" ? "En poste" : me.status}
            tone={me.status === "active" ? "success" : "warning"}
          />
        </div>
        <div className="grid grid-cols-1 gap-2 text-sm text-muted-foreground sm:grid-cols-2">
          <p className="flex items-center gap-1.5">
            <UserCheck className="h-3.5 w-3.5" />
            {me.position || "Poste non précisé"}
          </p>
          <p className="flex items-center gap-1.5">
            <Building2 className="h-3.5 w-3.5" />
            {departmentName ?? "Sans département"}
            {supervisorName ? ` · Responsable : ${supervisorName}` : ""}
          </p>
          <p className="flex items-center gap-1.5">
            <CalendarDays className="h-3.5 w-3.5" />
            Embauché le {formatDate(me.hireDate)}
          </p>
          <p className="flex items-center gap-1.5">
            <Mail className="h-3.5 w-3.5" />
            {me.email ?? "—"}
          </p>
        </div>

        {/* Tasks summary */}
        <div className="rounded-lg border border-border bg-muted/30 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <ListTodo className="h-4 w-4 text-primary" /> Mes tâches
            </div>
            <div className="flex items-center gap-2 text-xs">
              <StatusChip label={`${openTasks.length} en cours`} tone="info" />
              <StatusChip label={`${completedTasks} terminées`} tone="success" />
            </div>
          </div>
          {recentTasks.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Aucune tâche en cours — les tâches qui vous sont assignées
              apparaîtront ici.
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-border">
              {recentTasks.map((t) => (
                <li key={t.id} className="flex items-center gap-3 py-1.5">
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm text-foreground">{t.title}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {TASK_STATUS_LABELS_FR[t.status]}
                      {t.dueDate ? ` · échéance ${formatDate(t.dueDate)}` : ""}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Requests pipeline */}
        <div className="rounded-lg border border-border bg-muted/30 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Receipt className="h-4 w-4 text-primary" /> Mes demandes
            </div>
            <StatusChip
              label={`${pendingRequests} en attente`}
              tone={pendingRequests > 0 ? "warning" : "neutral"}
            />
          </div>
          {recentRequests.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Aucune demande (congé, remboursement…) enregistrée.
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-border">
              {recentRequests.map((r) => (
                <li key={r.id} className="flex items-center gap-3 py-1.5">
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm text-foreground">{r.reason}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {formatDate(r.fromDate)} → {formatDate(r.toDate)}
                    </p>
                  </div>
                  <StatusChip
                    label={REQUEST_STATUS_LABELS_FR[r.status]}
                    tone={
                      r.status === "approved"
                        ? "success"
                        : r.status === "rejected"
                          ? "danger"
                          : "neutral"
                    }
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
