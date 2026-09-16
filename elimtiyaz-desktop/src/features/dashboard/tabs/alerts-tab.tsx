// ============================================================================
// FILE: elimtiyaz-desktop/src/features/dashboard/tabs/alerts-tab.tsx
// ============================================================================

import { useEffect, useMemo, useState } from "react";
import {
  Plus,
  Filter,
  ArrowDownUp,
  CheckCheck,
  AlertTriangle,
  Bell,
  Clock,
  ShieldAlert,
  Inbox,
} from "lucide-react";
import { useRepositories } from "../../../app/providers/repository-provider";
import { useAuth } from "../../../app/providers/auth-provider";
import { useToast } from "../../../app/providers/toast-provider";
import type { AppNotification } from "../../../domain/model/operations";
import {
  NOTIFICATION_TYPE_LABELS_FR,
  ALERT_PRIORITY_LABELS_FR,
  ALERT_PRIORITY_TONE,
  ALERT_SOURCE_LABELS_FR,
  sortAlertsByPriority,
} from "../../../domain/model/operations";
import { formatRelative, formatDateTime } from "../../../core/format/date";
import { EmptyState } from "../../../shared/layout/state-views";
import { Card, CardContent } from "../../../shared/ui/card";
import { Button } from "../../../shared/ui/button";
import { Badge } from "../../../shared/ui/badge";
import { StatusChip } from "../../../shared/ui/status-chip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../shared/ui/select";
import { AlertCreatorModal } from "../alert-creator-modal";
import { AlertDetailModal } from "../alert-detail-modal";

const SOURCE_LABEL = "Alertes — Manuelle";

export function AlertsTab() {
  const repos = useRepositories();
  const { session } = useAuth();
  const toast = useToast();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [selected, setSelected] = useState<AppNotification | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"priority" | "newest" | "unread">(
    "priority",
  );

  useEffect(() => {
    if (!session) return;
    const unsub = repos.notifications
      .observeForSession({ userId: session.userId, role: session.role })
      .subscribe((n) => {
        setItems([...n]);
      });
    return unsub;
  }, [repos.notifications, session]);

  const filtered = useMemo(() => {
    let list = items;
    if (priorityFilter !== "all")
      list = list.filter((n) => n.priority === priorityFilter);
    if (sourceFilter !== "all")
      list = list.filter((n) => n.source === sourceFilter);
    if (sortBy === "priority") {
      list = sortAlertsByPriority(list);
    } else if (sortBy === "newest") {
      list = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    } else if (sortBy === "unread") {
      list = [...list].sort((a, b) => {
        if (!!a.readAt === !b.readAt)
          return b.createdAt.localeCompare(a.createdAt);
        return a.readAt ? 1 : -1;
      });
    }
    return list;
  }, [items, priorityFilter, sourceFilter, sortBy]);

  const counts = useMemo(() => {
    const unread = items.filter((n) => !n.readAt).length;
    const urgent = items.filter((n) => n.priority === "urgent").length;
    const high = items.filter((n) => n.priority === "high").length;
    return { unread, urgent, high, total: items.length };
  }, [items]);

  function openDetail(alert: AppNotification) {
    setSelected(alert);
    setDetailOpen(true);
    if (!alert.readAt) {
      void repos.notifications.markRead(alert.id);
    }
  }

  async function markAllRead() {
    await repos.notifications.markAllRead();
    toast.showSuccess(
      "Alertes marquées",
      `${counts.unread} alerte(s) marquée(s) comme lue(s).`,
    );
  }

  return (
    <div className="space-y-4 pb-8" data-testid="alerts-tab">
      {/* 1. Header Overview Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-xl border border-border/70 bg-surface-panel p-3.5 flex items-center justify-between shadow-sm">
          <div>
            <span className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider block">
              Total Notifications
            </span>
            <span className="text-xl font-bold font-mono text-foreground tabular-nums">
              {counts.total}
            </span>
          </div>
          <div className="h-8 w-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
            <Bell className="h-4 w-4" />
          </div>
        </div>

        <div className="rounded-xl border border-border/70 bg-surface-panel p-3.5 flex items-center justify-between shadow-sm">
          <div>
            <span className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider block">
              Non Lues
            </span>
            <span className="text-xl font-bold font-mono text-status-warning tabular-nums">
              {counts.unread}
            </span>
          </div>
          <div className="h-8 w-8 rounded-lg bg-status-warning/10 text-status-warning flex items-center justify-center">
            <Clock className="h-4 w-4" />
          </div>
        </div>

        <div className="rounded-xl border border-border/70 bg-surface-panel p-3.5 flex items-center justify-between shadow-sm">
          <div>
            <span className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider block">
              Urgentes
            </span>
            <span className="text-xl font-bold font-mono text-status-danger tabular-nums">
              {counts.urgent}
            </span>
          </div>
          <div className="h-8 w-8 rounded-lg bg-status-danger/10 text-status-danger flex items-center justify-center">
            <ShieldAlert className="h-4 w-4" />
          </div>
        </div>

        <div className="rounded-xl border border-border/70 bg-surface-panel p-3.5 flex items-center justify-between shadow-sm">
          <div>
            <span className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider block">
              Priorité Haute
            </span>
            <span className="text-xl font-bold font-mono text-foreground tabular-nums">
              {counts.high}
            </span>
          </div>
          <div className="h-8 w-8 rounded-lg bg-surface-elevated text-muted-foreground flex items-center justify-center">
            <AlertTriangle className="h-4 w-4" />
          </div>
        </div>
      </div>

      {/* 2. Control Toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap rounded-xl border border-border/70 bg-surface-panel p-3 shadow-sm">
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={priorityFilter} onValueChange={setPriorityFilter}>
            <SelectTrigger className="w-36 h-8 text-xs bg-surface-elevated/40">
              <Filter className="h-3 w-3 mr-1" />
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

          <Select value={sourceFilter} onValueChange={setSourceFilter}>
            <SelectTrigger className="w-36 h-8 text-xs bg-surface-elevated/40">
              <SelectValue placeholder="Source" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes sources</SelectItem>
              <SelectItem value="system">Système</SelectItem>
              <SelectItem value="manual">Manuelle</SelectItem>
              <SelectItem value="workflow">Workflow</SelectItem>
              <SelectItem value="schedule">Planifiée</SelectItem>
              <SelectItem value="audit">Audit</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={sortBy}
            onValueChange={(v) => setSortBy(v as typeof sortBy)}
          >
            <SelectTrigger className="w-36 h-8 text-xs bg-surface-elevated/40">
              <ArrowDownUp className="h-3 w-3 mr-1" />
              <SelectValue placeholder="Trier" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="priority">Par priorité</SelectItem>
              <SelectItem value="newest">Plus récentes</SelectItem>
              <SelectItem value="unread">Non lues d'abord</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          {counts.unread > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs gap-1.5"
              onClick={markAllRead}
            >
              <CheckCheck className="h-3.5 w-3.5 text-status-success" />
              Tout marquer lu ({counts.unread})
            </Button>
          )}

          <Button
            size="sm"
            className="h-8 text-xs gap-1.5 shadow-sm"
            onClick={() => setCreatorOpen(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            Diffuser une Alerte
          </Button>
        </div>
      </div>

      {/* 3. Alerts Feed */}
      {items.length === 0 ? (
        <EmptyState
          title="Aucune notification enregistrée"
          description="Le journal des alertes est à jour. Vous pouvez diffuser un message ou un rappel si nécessaire."
          icon={<Inbox className="h-8 w-8 text-muted-foreground" />}
        />
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-border/70 bg-surface-panel p-12 text-center text-xs text-muted-foreground">
          Aucune alerte ne correspond aux filtres sélectionnés.
        </div>
      ) : (
        <div className="space-y-2.5">
          {filtered.map((n) => {
            const isUnread = !n.readAt;
            const priorityTone = ALERT_PRIORITY_TONE[n.priority];

            return (
              <Card
                key={n.id}
                onClick={() => openDetail(n)}
                className={`cursor-pointer border-border/70 bg-surface-panel hover:bg-surface-elevated/40 transition-all shadow-sm ${
                  isUnread ? "border-l-4 border-l-primary" : ""
                }`}
              >
                <CardContent className="p-3.5 flex items-start gap-3.5">
                  <div className="flex flex-col items-center gap-1 shrink-0 pt-0.5">
                    <StatusChip
                      label={ALERT_PRIORITY_LABELS_FR[n.priority]}
                      tone={priorityTone}
                    />
                    {isUnread && (
                      <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm font-bold text-foreground truncate">
                          {n.title}
                        </span>
                        <Badge
                          variant="outline"
                          className="text-[10px] px-1.5 py-0"
                        >
                          {NOTIFICATION_TYPE_LABELS_FR[n.type]}
                        </Badge>
                        <span className="text-[10px] font-mono text-muted-foreground">
                          {ALERT_SOURCE_LABELS_FR[n.source]}
                        </span>
                      </div>
                      <span className="text-[11px] text-muted-foreground font-mono shrink-0">
                        {formatRelative(n.createdAt)}
                      </span>
                    </div>

                    <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
                      {n.body}
                    </p>

                    <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-1 border-t border-border/30">
                      <span>Source : {n.sourceLabel}</span>
                      {n.triggeredAt && (
                        <span>
                          Déclenché le {formatDateTime(n.triggeredAt)}
                        </span>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <AlertCreatorModal
        open={creatorOpen}
        onOpenChange={setCreatorOpen}
        sourceLabel={SOURCE_LABEL}
      />
      <AlertDetailModal
        alert={selected}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />
    </div>
  );
}
