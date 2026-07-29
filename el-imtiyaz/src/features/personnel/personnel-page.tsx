/**
 * Personnel hub — plan §09 + iteration 8 workforce expansion.
 *
 * The Personnel page is the primary workspace for every employee. On first
 * run, an onboarding wizard collects the org structure. After onboarding,
 * the page dispatches to a role-based dashboard:
 *
 *   - SuperAdmin / FinancialOfficer / SupportStaff → AdministratorDashboard
 *   - Manager                                     → ManagerDashboard
 *   - Buyer                                       → BuyerDashboard
 *   - Driver                                      → DriverDashboard
 *   - WarehouseWorker                             → WarehouseWorkerDashboard
 *   - Teacher                                     → TeacherDashboard
 *   - Worker                                      → WorkerDashboard
 *
 * Tabs (secondary navigation):
 *   - Mon espace  → role dashboard (default)
 *   - Annuaire    → full directory (admin-only via GatedContent)
 *   - Tâches      → task management
 *   - Messagerie  → internal chat
 *   - Relevé      → activity log
 *   - Alertes     → custom alert creator + feed (iteration 9 — spec §4.3)
 *   - Workflows   → workflow monitor (iteration 7)
 *
 * Iteration 7 unified all modals — zero raw Dialog/Drawer call sites.
 * Iteration 8 adds the workforce tabs and the role-based dispatch.
 * Iteration 9 adds the Alertes tab so non-admin staff (workers, drivers,
 * teachers, etc.) who cannot access the main Dashboard's Alerts tab can
 * still create and manage custom alerts / reminders / timers from their
 * own workspace.
 */
import { useTranslation } from "react-i18next";
import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { BookUser, Clock, ScrollText, Workflow, LayoutDashboard, ListTodo, MessageSquare, Bell, Plus, Filter, ArrowDownUp, Trash2, CheckCheck } from "lucide-react";
import { useRepositories } from "../../infrastructure/repository-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import { useAuth } from "../../state/auth-context";
import { useToast } from "../../state/toast-context";
import { Role, ROLE_LABELS_FR } from "../../core/rbac/roles";
import { PageHeader } from "../../shared/components/page-header";
import { ComingSoonCard } from "../../shared/components/coming-soon-card";
import { PageTabs, PageTabList, PageTab, PageTabContent } from "../../shared/components/page-tabs";
import { RoleDashboardRouter } from "./dashboards/role-dashboard-router";
import { TaskManagement } from "./management/task-management";
import { ChatPanel } from "./management/chat-panel";
import { PersonnelDetailDrawer } from "./personnel-detail-drawer";
import { ReleveTab } from "./releve-tab";
import { WorkflowMonitorTab } from "./workflow-monitor-tab";
import { OnboardingWizard } from "./onboarding/onboarding-wizard";
import { AdministratorEmployeeDirectory } from "./management/employee-directory";
import { AlertCreatorModal } from "../../shared/components/alert-creator-modal";
import { AlertDetailModal } from "../../shared/components/alert-detail-modal";
import { Card, CardContent } from "../../shared/ui/card";
import { Button } from "../../shared/ui/button";
import { Badge } from "../../shared/ui/badge";
import { StatusChip } from "../../shared/components/status-chip";
import { EmptyState } from "../../shared/components/state-views";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../shared/ui/select";
import { formatRelative, formatDateTime } from "../../core/format/date";
import type { AuditEntry } from "../../domain/model/audit";
import {
  NOTIFICATION_TYPE_LABELS_FR,
  ALERT_PRIORITY_LABELS_FR,
  ALERT_PRIORITY_TONE,
  ALERT_SOURCE_LABELS_FR,
  sortAlertsByPriority,
  isAlertVisibleTo,
  type AppNotification,
} from "../../domain/model/operations";

export function PersonnelPage() {
  const { t } = useTranslation();
  const repos = useRepositories();
  const { session } = useAuth();
  const onboarding = useObservable(() => repos.onboarding.observe(), []);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  function openDetail(id: string) {
    setDrawerId(id);
    setDrawerOpen(true);
  }

  // Gate: if onboarding has not been completed, show the wizard instead of
  // the dashboard. This is the "first-run experience" described in the spec.
  // (For demo purposes the wizard is always reachable via the "Relancer
  // l'onboarding" button on the Administrator dashboard.)
  if (onboarding && onboarding.completedAt === null && session?.role === "super_admin") {
    return <OnboardingWizard />;
  }

  const role = session?.role ?? Role.SupportStaff;
  const isAdmin = role === Role.SuperAdmin || role === Role.FinancialOfficer || role === Role.SupportStaff;

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title={t("nav.personnel")}
        description="Espace de travail personnalisé selon votre rôle : tâches, communication, planning, assiduité."
      />
      <PageTabs defaultValue="dashboard" className="flex-1 flex flex-col px-6 pb-6 min-h-0">
        <PageTabList>
          <PageTab value="dashboard" label="Mon espace" icon={LayoutDashboard} />
          {isAdmin && <PageTab value="directory" label="Annuaire" icon={BookUser} />}
          <PageTab value="tasks" label="Tâches" icon={ListTodo} />
          <PageTab value="chat" label="Messagerie" icon={MessageSquare} />
          <PageTab value="releve" label="Relevé" icon={Clock} />
          {/* Iteration 9 — Alertes tab. Available to ALL staff, including
              non-admin staff who can't access the main Dashboard's Alerts tab.
              Per spec §4.3: "Worker / Personnel Workspace Integration" */}
          <PageTab value="alerts" label="Alertes" icon={Bell} />
          <PageTab value="audit" label="Journal d'audit" icon={ScrollText} />
          <PageTab value="workflows" label="Workflows" icon={Workflow} />
        </PageTabList>
        <PageTabContent value="dashboard">
          <RoleDashboardRouter role={role} />
        </PageTabContent>
        {isAdmin && (
          <PageTabContent value="directory">
            <AdministratorEmployeeDirectory />
          </PageTabContent>
        )}
        <PageTabContent value="tasks">
          <TaskManagement />
        </PageTabContent>
        <PageTabContent value="chat">
          <ChatPanel />
        </PageTabContent>
        <PageTabContent value="releve">
          <ReleveTab />
        </PageTabContent>
        <PageTabContent value="alerts">
          <PersonnelAlertsTab />
        </PageTabContent>
        <PageTabContent value="audit">
          {/* Iteration 10 — Personal activity feed (plan §12.03).
              Per spec: "The audit logging interface lives under the Settings hub
              on Desktop and the Personnel Tab on Mobile." This tab shows the
              current user's own recent actions (always visible to the user
              themselves). The full admin audit log remains in Settings → Audit. */}
          <PersonalAuditFeedTab />
        </PageTabContent>
        <PageTabContent value="workflows">
          <WorkflowMonitorTab />
        </PageTabContent>
      </PageTabs>

      <PersonnelDetailDrawer
        personnelId={drawerId}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
      />
    </div>
  );
}

/**
 * PersonnelAlertsTab — custom alert creator + feed for non-admin staff.
 *
 * Iteration 9 — spec §4.3: "Worker / Personnel Workspace Integration.
 * Because general workers and staff do not have access to the main
 * dashboard's Alerts tab, they must also be able to create and manage
 * custom alerts/notifications directly from their dedicated Personnel /
 * Worker workspace tab."
 *
 * This tab mirrors the dashboard Alerts tab's behavior but is reachable
 * from the Personnel page (which all staff roles can access).
 */
function PersonnelAlertsTab() {
  const repos = useRepositories();
  const { session } = useAuth();
  const toast = useToast();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [selected, setSelected] = useState<AppNotification | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [priorityFilter, setPriorityFilter] = useState<string>("all");

  useEffect(() => {
    if (!session) return;
    const unsub = repos.notifications
      .observeForSession({ userId: session.userId, role: session.role })
      .subscribe((n) => setItems([...n]));
    return unsub;
  }, [repos.notifications, session]);

  const filtered = useMemo(() => {
    let list = items;
    if (priorityFilter !== "all") list = list.filter((n) => n.priority === priorityFilter);
    return sortAlertsByPriority(list);
  }, [items, priorityFilter]);

  const unreadCount = items.filter((n) => !n.readAt).length;

  function openDetail(alert: AppNotification) {
    setSelected(alert);
    setDetailOpen(true);
    if (!alert.readAt) {
      void repos.notifications.markRead(alert.id);
    }
  }

  async function markAllRead() {
    await repos.notifications.markAllRead();
    toast.showSuccess("Alertes marquées", `${unreadCount} alerte(s) marquée(s) comme lue(s).`);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger className="w-40 h-8 text-xs">
            <Filter className="h-3 w-3" />
            <SelectValue placeholder="Priorité" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toutes priorités</SelectItem>
            <SelectItem value="urgent">Urgente</SelectItem>
            <SelectItem value="high">Haute</SelectItem>
            <SelectItem value="medium">Moyenne</SelectItem>
            <SelectItem value="low">Basse</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex-1" />
        {unreadCount > 0 && (
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={markAllRead}>
            <CheckCheck className="h-3 w-3" /> Tout marquer lu ({unreadCount})
          </Button>
        )}
        <Button size="sm" className="h-8" onClick={() => setCreatorOpen(true)}>
          <Plus className="h-4 w-4" /> Créer une alerte
        </Button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="Aucune alerte"
          description="Vous n'avez aucune alerte pour le moment. Créez une alerte personnalisée ou un rappel."
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {filtered.map((n) => (
                <li
                  key={n.id}
                  className="flex items-start gap-3 p-4 hover:bg-accent/5 cursor-pointer"
                  onClick={() => openDetail(n)}
                >
                  <div className="flex flex-col items-center gap-1 shrink-0 w-16">
                    <StatusChip
                      label={ALERT_PRIORITY_LABELS_FR[n.priority]}
                      tone={ALERT_PRIORITY_TONE[n.priority]}
                    />
                    {!n.readAt && (
                      <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-foreground">{n.title}</p>
                      <Badge variant="outline" className="text-[10px]">
                        {NOTIFICATION_TYPE_LABELS_FR[n.type]}
                      </Badge>
                      <Badge variant="outline" className="text-[10px] text-muted-foreground">
                        {ALERT_SOURCE_LABELS_FR[n.source]}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Source: <span className="font-medium">{n.sourceLabel}</span>
                      {n.triggeredAt && (
                        <> · Déclencheur: {formatDateTime(n.triggeredAt)}</>
                      )}
                    </p>
                  </div>
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {formatRelative(n.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <AlertCreatorModal
        open={creatorOpen}
        onOpenChange={setCreatorOpen}
        sourceLabel={`Personnel — ${session ? ROLE_LABELS_FR[session.role] : "Utilisateur"}`}
      />
      <AlertDetailModal
        alert={selected}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />
    </div>
  );
}

/**
 * PersonalAuditFeedTab — read-only feed of the current user's own audit
 * entries (plan §12.03 + §12.01 Universal Action Traceability).
 *
 * Per plan §12.03: "The audit logging interface lives under the Settings
 * hub on Desktop and the Personnel Tab on Mobile." This tab gives every
 * employee visibility into their OWN actions without exposing other users'
 * data. SuperAdmin / FinancialOfficer can click "Voir le journal complet"
 * to navigate to Settings → Audit Log for the full admin view.
 *
 * Per plan §12.01: every state-changing operation is attributed to a
 * unique user account. This tab makes that attribution visible to the
 * user themselves, supporting transparency and self-audit.
 */
function PersonalAuditFeedTab() {
  const repos = useRepositories();
  const { session } = useAuth();
  const navigate = useNavigate();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState<string>("all");

  useEffect(() => {
    if (!session) return;
    void (async () => {
      setLoading(true);
      // Query the most recent 50 audit entries by the current user.
      const result = await repos.audit.query({
        actorNameContains: session.displayName,
        limit: 50,
      });
      if (result.ok) {
        // Filter to entries actually by this user (defensive — actorNameContains
        // can match partial names; require exact actorId match).
        const filtered = result.value.entries.filter(
          (e) => e.actorId === session.userId || e.actorName === session.displayName,
        );
        setEntries(filtered);
      }
      setLoading(false);
    })();
  }, [session, repos.audit]);

  // Build a unique action-type list from the entries (for the filter dropdown).
  const actionTypes = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) set.add(e.action);
    return Array.from(set).sort();
  }, [entries]);

  const filtered = useMemo(() => {
    let list = entries;
    if (actionFilter !== "all") list = list.filter((e) => e.action === actionFilter);
    return list;
  }, [entries, actionFilter]);

  const canViewFullAudit = session?.role === Role.SuperAdmin || session?.role === Role.FinancialOfficer;

  if (!session) {
    return <EmptyState title="Session expirée" description="Reconnectez-vous pour voir votre activité." />;
  }

  return (
    <div className="space-y-3">
      {/* Header card with explanation + link to full audit log */}
      <Card>
        <CardContent className="p-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground">
              Mon activité ({entries.length} action{entries.length > 1 ? "s" : ""})
            </p>
            <p className="text-[11px] text-muted-foreground">
              Plan §12.03 — traçabilité universelle de vos propres actions. Le journal complet (tous utilisateurs) est dans Paramètres → Audit.
            </p>
          </div>
          {canViewFullAudit && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => navigate("/settings?tab=audit")}
            >
              Voir le journal complet →
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Filter bar */}
      {actionTypes.length > 0 && (
        <Select value={actionFilter} onValueChange={setActionFilter}>
          <SelectTrigger className="w-72 h-8 text-xs">
            <Filter className="h-3 w-3" />
            <SelectValue placeholder="Type d'action" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toutes les actions ({entries.length})</SelectItem>
            {actionTypes.map((a) => (
              <SelectItem key={a} value={a}>{a}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Activity feed */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <p className="text-sm text-muted-foreground text-center py-8">Chargement…</p>
          ) : filtered.length === 0 ? (
            <EmptyState
              title="Aucune activité"
              description="Vos actions apparaîtront ici dès que vous interagissez avec le système."
            />
          ) : (
            <ul className="divide-y divide-border">
              {filtered.map((entry) => (
                <li key={entry.id} className="flex items-start gap-3 p-3">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <ScrollText className="h-3.5 w-3.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <code className="text-xs font-mono text-primary font-medium">{entry.action}</code>
                      <Badge variant="outline" className="text-[10px]">{entry.entityType}</Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Entité: <span className="font-mono">{entry.entityId}</span>
                      {entry.note && ` · ${entry.note}`}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {formatDateTime(entry.at)} · {formatRelative(entry.at)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
