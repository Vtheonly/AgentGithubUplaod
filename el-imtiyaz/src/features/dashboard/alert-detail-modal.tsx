/**
 * AlertDetailModal — detailed alert inspection drawer.
 *
 * Iteration 9 — Alert & Notification System Overhaul.
 *
 * Per spec §4.2: "Clicking any notification or alert (in the topbar or
 * notification feed) must open a dedicated detail modal/drawer displaying
 * the full context, associated entity details, and actionable options
 * rather than just marking it as read."
 *
 * This drawer surfaces:
 *   - The full title, body, type, priority, and source
 *   - The associated entity (parent, student, expense, installment…) with a
 *     deep-link to the entity's own drawer
 *   - Targeting info (broadcast / user / role)
 *   - Schedule info (immediate / scheduled trigger)
 *   - Audit info (created by, created at)
 *   - Actions: mark as read, dismiss, edit, deep-link to entity
 */
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bell,
  User as UserIcon,
  Users as UsersIcon,
  Clock,
  Building2,
  Trash2,
  CheckCheck,
  ArrowUpRight,
  AlertTriangle,
} from "lucide-react";
import { useRepositories } from "../../app/providers/repository-provider";
import { UnifiedModal } from "../../shared/ui/unified-modal";
import { Button } from "../../shared/ui/button";
import { Badge } from "../../shared/ui/badge";
import { Separator } from "../../shared/ui/separator";
import { StatusChip } from "../../shared/ui/status-chip";
import { formatRelative, formatDateTime } from "../../core/format/date";
import {
  ALERT_PRIORITY_LABELS_FR,
  ALERT_PRIORITY_TONE,
  ALERT_SOURCE_LABELS_FR,
  NOTIFICATION_TYPE_LABELS_FR,
  type AppNotification,
} from "../../domain/model/operations";
import { ROLE_LABELS_FR } from "../../core/rbac/roles";

export interface AlertDetailModalProps {
  alert: AppNotification | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

export function AlertDetailModal({ alert, open, onOpenChange }: AlertDetailModalProps) {
  const repos = useRepositories();
  const navigate = useNavigate();

  const linkedEntity = useMemo(() => {
    if (!alert?.entityType || !alert?.entityId) return null;
    switch (alert.entityType) {
      case "parent": {
        const p = repos.parents.observe().get().find((x) => x.id === alert.entityId);
        return p
          ? {
              kind: "parent" as const,
              label: `${p.firstName} ${p.lastName}`,
              subtitle: p.code,
              route: `/crm?parent=${p.id}`,
            }
          : null;
      }
      case "student": {
        const s = repos.students.observe().get().find((x) => x.id === alert.entityId);
        return s
          ? { kind: "student" as const, label: `${s.firstName} ${s.lastName}`, subtitle: s.code, route: `/crm?student=${s.id}` }
          : null;
      }
      case "expense": {
        const e = repos.expenses.observe().get().find((x) => x.id === alert.entityId);
        return e
          ? { kind: "expense" as const, label: e.title, subtitle: e.requestCode, route: `/financials?expense=${e.id}` }
          : null;
      }
      case "installment": {
        const i = repos.installments.observeByParent("").get().find((x) => x.id === alert.entityId);
        return i
          ? { kind: "installment" as const, label: i.label, subtitle: `${i.amountDue.toLocaleString("fr-FR")} DZD`, route: `/financials?installment=${i.id}` }
          : null;
      }
      case "homework": {
        return { kind: "homework" as const, label: "Devoir", subtitle: alert.entityId, route: `/academics?homework=${alert.entityId}` };
      }
      default:
        return null;
    }
  }, [alert, repos]);

  if (!alert) return null;

  async function handleMarkRead() {
    if (!alert) return;
    await repos.notifications.markRead(alert.id);
    onOpenChange(false);
  }

  async function handleDismiss() {
    if (!alert) return;
    await repos.notifications.dismiss(alert.id);
    onOpenChange(false);
  }

  function handleDeepLink() {
    if (!linkedEntity) return;
    navigate(linkedEntity.route);
    onOpenChange(false);
  }

  const priorityTone = ALERT_PRIORITY_TONE[alert.priority];

  return (
    <UnifiedModal
      open={open}
      onOpenChange={onOpenChange}
      variant="drawer"
      size="md"
      icon={Bell}
      iconTone={priorityTone === "danger" ? "danger" : priorityTone === "warning" ? "warning" : "primary"}
      title={alert.title}
      description={NOTIFICATION_TYPE_LABELS_FR[alert.type]}
      badge={
        <Badge variant="outline" className="text-[10px]">
          {ALERT_PRIORITY_LABELS_FR[alert.priority]}
        </Badge>
      }
      footer={
        <div className="flex items-center gap-2 w-full">
          <Button
            variant="ghost"
            size="sm"
            className="text-status-danger"
            onClick={handleDismiss}
            title="Supprimer l'alerte"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Supprimer
          </Button>
          <div className="flex-1" />
          {linkedEntity && (
            <Button variant="outline" size="sm" onClick={handleDeepLink}>
              <ArrowUpRight className="h-3.5 w-3.5" />
              Ouvrir {linkedEntity.kind}
            </Button>
          )}
          {!alert.readAt && (
            <Button size="sm" onClick={handleMarkRead}>
              <CheckCheck className="h-3.5 w-3.5" />
              Marquer comme lue
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        {/* Priority + Source banner */}
        <div className="flex items-center gap-2">
          <StatusChip
            label={`Priorité ${ALERT_PRIORITY_LABELS_FR[alert.priority]}`}
            tone={priorityTone}
          />
          <StatusChip
            label={ALERT_SOURCE_LABELS_FR[alert.source]}
            tone="neutral"
          />
          <StatusChip label={alert.sourceLabel} tone="info" />
        </div>

        {/* Body */}
        <div className="rounded-md border border-border bg-muted/20 p-3">
          <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
            {alert.body}
          </p>
        </div>

        {/* Targeting + Schedule */}
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="space-y-1">
            <p className="text-[10px] uppercase text-muted-foreground">Cible</p>
            {alert.targetUserId ? (
              <div className="flex items-center gap-1.5">
                <UserIcon className="h-3 w-3 text-muted-foreground" />
                <span>Utilisateur précis</span>
              </div>
            ) : alert.targetRole ? (
              <div className="flex items-center gap-1.5">
                <UsersIcon className="h-3 w-3 text-muted-foreground" />
                <span>{ROLE_LABELS_FR[alert.targetRole]}</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <UsersIcon className="h-3 w-3 text-muted-foreground" />
                <span>Tous les utilisateurs</span>
              </div>
            )}
          </div>
          <div className="space-y-1">
            <p className="text-[10px] uppercase text-muted-foreground">Déclenchement</p>
            {alert.triggeredAt ? (
              <div className="flex items-center gap-1.5">
                <Clock className="h-3 w-3 text-muted-foreground" />
                <span>{formatDateTime(alert.triggeredAt)}</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <Clock className="h-3 w-3 text-muted-foreground" />
                <span>Immédiat</span>
              </div>
            )}
          </div>
        </div>

        {/* Linked entity */}
        {linkedEntity && (
          <>
            <Separator />
            <div className="space-y-2">
              <p className="text-[10px] uppercase text-muted-foreground">Entité liée</p>
              <button
                type="button"
                onClick={handleDeepLink}
                className="flex items-center gap-2 w-full rounded-md border border-border p-2 hover:bg-accent/10 transition-colors text-start"
              >
                <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{linkedEntity.label}</p>
                  <p className="text-[10px] text-muted-foreground font-mono truncate">{linkedEntity.subtitle}</p>
                </div>
                <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              </button>
            </div>
          </>
        )}

        {/* Audit footer */}
        <Separator />
        <div className="text-[10px] text-muted-foreground space-y-0.5">
          <p>Créée par <span className="font-mono">{alert.createdBy}</span></p>
          <p>Créée {formatRelative(alert.createdAt)} · {formatDateTime(alert.createdAt)}</p>
          {alert.readAt && <p>Lue {formatRelative(alert.readAt)}</p>}
        </div>

        {alert.priority === "urgent" && !alert.readAt && (
          <div className="flex items-start gap-2 rounded-md border border-status-danger/30 bg-status-danger/10 p-2 text-xs text-status-danger">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <p>Cette alerte est urgente. Veuillez la traiter en priorité.</p>
          </div>
        )}
      </div>
    </UnifiedModal>
  );
}
