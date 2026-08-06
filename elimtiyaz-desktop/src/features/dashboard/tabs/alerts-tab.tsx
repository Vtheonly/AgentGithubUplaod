/**
 * Alerts tab — clean feed with priority sort + click-to-detail + create.
 *
 * Extracted from `dashboard-page.tsx` (Task 2-a). Behavior is preserved
 * exactly — only file location and imports changed.
 *
 * Cleanup pass (current refactor):
 *   - Removed the duplicate `AlertCreatorModal` that was rendered in the
 *     empty-state branch (it was rendered twice when the list was empty —
 *     once in the empty state, once at the bottom). Now there is exactly
 *     one `AlertCreatorModal` instance, hoisted to the end of the
 *     component so it works in both empty and populated states.
 *   - Fixed the typo `"Alertes — Manueluelle"` → `"Alertes — Manuelle"`
 *     on the empty-state sourceLabel.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Loader2,
  Plus,
  Filter,
  ArrowDownUp,
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../shared/ui/select";
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
  const [sortBy, setSortBy] = useState<"priority" | "newest" | "unread">("priority");

  useEffect(() => {
    if (!session) return;
    const unsub = repos.notifications.observeForSession({ userId: session.userId, role: session.role }).subscribe((n) => {
      setItems([...n]);
    });
    return unsub;
  }, [repos.notifications, session]);

  const filtered = useMemo(() => {
    let list = items;
    if (priorityFilter !== "all") list = list.filter((n) => n.priority === priorityFilter);
    if (sourceFilter !== "all") list = list.filter((n) => n.source === sourceFilter);
    if (sortBy === "priority") {
      list = sortAlertsByPriority(list);
    } else if (sortBy === "newest") {
      list = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    } else if (sortBy === "unread") {
      list = [...list].sort((a, b) => {
        if (!!a.readAt === !!b.readAt) return b.createdAt.localeCompare(a.createdAt);
        return a.readAt ? 1 : -1;
      });
    }
    return list;
  }, [items, priorityFilter, sourceFilter, sortBy]);

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

  if (items.length === 0) {
    return (
      <div className="space-y-3">
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setCreatorOpen(true)}>
            <Plus className="h-4 w-4" /> Créer une alerte
          </Button>
        </div>
        <EmptyState title="Aucune notification" description="Vous êtes à jour. Créez une alerte personnalisée si besoin." />
        <AlertCreatorModal open={creatorOpen} onOpenChange={setCreatorOpen} sourceLabel={SOURCE_LABEL} />
        <AlertDetailModal
          alert={selected}
          open={detailOpen}
          onOpenChange={setDetailOpen}
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Toolbar */}
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
        <Select value={sourceFilter} onValueChange={setSourceFilter}>
          <SelectTrigger className="w-40 h-8 text-xs">
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
        <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
          <SelectTrigger className="w-40 h-8 text-xs">
            <ArrowDownUp className="h-3 w-3" />
            <SelectValue placeholder="Trier" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="priority">Par priorité</SelectItem>
            <SelectItem value="newest">Plus récentes</SelectItem>
            <SelectItem value="unread">Non lues d'abord</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex-1" />
        {unreadCount > 0 && (
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={markAllRead}>
            <Loader2 className="h-3 w-3" /> Tout marquer lu ({unreadCount})
          </Button>
        )}
        <Button size="sm" className="h-8" onClick={() => setCreatorOpen(true)}>
          <Plus className="h-4 w-4" /> Créer une alerte
        </Button>
      </div>

      {/* Alerts feed */}
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

      <AlertCreatorModal open={creatorOpen} onOpenChange={setCreatorOpen} sourceLabel={SOURCE_LABEL} />
      <AlertDetailModal
        alert={selected}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />
    </div>
  );
}
