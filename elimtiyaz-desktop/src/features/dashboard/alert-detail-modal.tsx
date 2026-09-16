// ============================================================================
// FILE: elimtiyaz-desktop/src/features/dashboard/alert-detail-modal.tsx
// ============================================================================

import { useMemo, useState } from "react";
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
  Wallet,
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
import { UnifiedPaymentModal } from "../../features/financials/unified-payment-modal";
import type { PaymentNavigationContext } from "../../domain/model/payment";
import { parentDisplayName } from "../../domain/model/parent";

export interface AlertDetailModalProps {
  alert: AppNotification | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

export function AlertDetailModal({
  alert,
  open,
  onOpenChange,
}: AlertDetailModalProps) {
  const repos = useRepositories();
  const navigate = useNavigate();
  const [collectOpen, setCollectOpen] = useState(false);

  const linkedEntity = useMemo(() => {
    if (!alert?.entityType || !alert?.entityId) return null;
    switch (alert.entityType) {
      case "parent": {
        const p = repos.parents
          .observe()
          .get()
          .find((x) => x.id === alert.entityId);
        return p
          ? {
              kind: "parent" as const,
              label: parentDisplayName(p),
              subtitle: p.code,
              route: `/crm?parent=${p.id}`,
            }
          : null;
      }
      case "student": {
        const s = repos.students
          .observe()
          .get()
          .find((x) => x.id === alert.entityId);
        return s
          ? {
              kind: "student" as const,
              label: `${s.firstName} ${s.lastName}`,
              subtitle: s.code,
              route: `/crm?student=${s.id}`,
            }
          : null;
      }
      case "expense": {
        const e = repos.expenses
          .observe()
          .get()
          .find((x) => x.id === alert.entityId);
        return e
          ? {
              kind: "expense" as const,
              label: e.title,
              subtitle: e.requestCode,
              route: `/financials?expense=${e.id}`,
            }
          : null;
      }
      case "installment": {
        const parentsList = repos.parents.observe().get();
        let found: { installment: any; parent: any } | null = null;
        for (const p of parentsList) {
          const items = repos.installments.observeByParent(p.id).get();
          const match = items.find((x) => x.id === alert.entityId);
          if (match) {
            found = { installment: match, parent: p };
            break;
          }
        }
        if (!found) return null;
        return {
          kind: "installment" as const,
          label: found.installment.label,
          subtitle: `${found.installment.amountDue.toLocaleString("fr-FR")} DZD`,
          route: `/financials?installment=${found.installment.id}`,
          installment: found.installment,
          parent: found.parent,
        };
      }
      case "homework": {
        return {
          kind: "homework" as const,
          label: "Devoir",
          subtitle: alert.entityId,
          route: `/academics?homework=${alert.entityId}`,
        };
      }
      default:
        return null;
    }
  }, [alert, repos]);

  if (!alert) return null;

  const isInstallmentAlert =
    alert.entityType === "installment" &&
    linkedEntity &&
    (linkedEntity as any).installment;

  const installmentCtx: PaymentNavigationContext | null = isInstallmentAlert
    ? (() => {
        const inst = (linkedEntity as any).installment;
        const parent = (linkedEntity as any).parent;
        const remaining = Math.max(0, inst.amountDue - inst.amountPaid);
        const isOverdue = inst.status === "overdue";
        const overdueDays = isOverdue
          ? Math.max(
              0,
              Math.floor(
                (Date.now() - new Date(inst.dueDate).getTime()) / 86_400_000,
              ),
            )
          : undefined;
        return {
          parentId: inst.parentId,
          parentName: parent ? parentDisplayName(parent) : undefined,
          parentCode: parent?.code,
          studentId: inst.studentId ?? null,
          mode: "installment_tranche" as const,
          targetItemId: inst.id,
          presetAmount: remaining,
          overdueDays,
          dueWindowLabel: new Date(inst.dueDate).toLocaleDateString("fr-FR", {
            day: "numeric",
            month: "short",
            year: "numeric",
          }),
          lineItems: [
            {
              itemId: inst.id,
              category: inst.category,
              label: inst.label,
              grossAmount: inst.amountDue,
              discountAmount: 0,
              netAmount: inst.amountDue,
              alreadyPaidAmount: inst.amountPaid,
              remainingAmount: remaining,
              dueDate: inst.dueDate,
              isOverdue,
              daysOverdue: overdueDays,
            },
          ],
          allowPartial: true,
          originRoute: "dashboard.alert_detail",
        };
      })()
    : null;

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
    <>
      <UnifiedModal
        open={open}
        onOpenChange={onOpenChange}
        variant="drawer"
        size="md"
        icon={Bell}
        iconTone={
          priorityTone === "danger"
            ? "danger"
            : priorityTone === "warning"
              ? "warning"
              : "primary"
        }
        title={alert.title}
        description={NOTIFICATION_TYPE_LABELS_FR[alert.type]}
        badge={
          <Badge variant="outline" className="text-[10px]">
            {ALERT_PRIORITY_LABELS_FR[alert.priority]}
          </Badge>
        }
        footer={
          <div className="flex items-center gap-2 w-full justify-between">
            <Button
              variant="ghost"
              size="sm"
              className="text-status-danger hover:bg-status-danger/10 text-xs"
              onClick={handleDismiss}
            >
              <Trash2 className="h-3.5 w-3.5 mr-1" />
              Supprimer
            </Button>

            <div className="flex items-center gap-2">
              {isInstallmentAlert && installmentCtx && (
                <Button
                  size="sm"
                  variant="default"
                  className="text-xs"
                  onClick={() => setCollectOpen(true)}
                >
                  <Wallet className="h-3.5 w-3.5 mr-1" />
                  Encaisser{" "}
                  {installmentCtx.presetAmount
                    ? `${installmentCtx.presetAmount.toLocaleString("fr-FR")} DZD`
                    : ""}
                </Button>
              )}

              {linkedEntity && (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs"
                  onClick={handleDeepLink}
                >
                  <ArrowUpRight className="h-3.5 w-3.5 mr-1" />
                  Ouvrir le dossier
                </Button>
              )}

              {!alert.readAt && (
                <Button size="sm" className="text-xs" onClick={handleMarkRead}>
                  <CheckCheck className="h-3.5 w-3.5 mr-1" />
                  Marquer lu
                </Button>
              )}
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
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

          <div className="rounded-xl border border-border/80 bg-surface-elevated/40 p-4">
            <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
              {alert.body}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="p-3 rounded-lg border border-border/50 bg-surface-elevated/20 space-y-1">
              <span className="text-[10px] uppercase font-bold text-muted-foreground block">
                Audience Cible
              </span>
              {alert.targetUserId ? (
                <div className="flex items-center gap-1.5 font-medium">
                  <UserIcon className="h-3.5 w-3.5 text-primary" />
                  <span>Utilisateur spécifique</span>
                </div>
              ) : alert.targetRole ? (
                <div className="flex items-center gap-1.5 font-medium">
                  <UsersIcon className="h-3.5 w-3.5 text-primary" />
                  <span>{ROLE_LABELS_FR[alert.targetRole]}</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 font-medium">
                  <UsersIcon className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>Tous les collaborateurs</span>
                </div>
              )}
            </div>

            <div className="p-3 rounded-lg border border-border/50 bg-surface-elevated/20 space-y-1">
              <span className="text-[10px] uppercase font-bold text-muted-foreground block">
                Planification
              </span>
              <div className="flex items-center gap-1.5 font-mono text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                <span>
                  {alert.triggeredAt
                    ? formatDateTime(alert.triggeredAt)
                    : "Instantané"}
                </span>
              </div>
            </div>
          </div>

          {linkedEntity && (
            <>
              <Separator />
              <div className="space-y-1.5">
                <span className="text-[10px] uppercase font-bold text-muted-foreground block">
                  Élément Associé
                </span>
                <button
                  type="button"
                  onClick={handleDeepLink}
                  className="flex items-center gap-3 w-full rounded-xl border border-border/70 p-3 hover:bg-surface-elevated/50 transition-colors text-left"
                >
                  <Building2 className="h-5 w-5 text-primary shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">
                      {linkedEntity.label}
                    </p>
                    <p className="text-[11px] text-muted-foreground font-mono truncate">
                      {linkedEntity.subtitle}
                    </p>
                  </div>
                  <ArrowUpRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </button>
              </div>
            </>
          )}

          {alert.priority === "urgent" && !alert.readAt && (
            <div className="flex items-start gap-2.5 rounded-xl border border-status-danger/40 bg-status-danger/10 p-3 text-xs text-status-danger">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <p className="leading-relaxed">
                Notification critique : Cette opération requiert une
                intervention immédiate de la direction.
              </p>
            </div>
          )}

          <Separator />
          <div className="text-[11px] text-muted-foreground space-y-0.5">
            <p>
              Émetteur : <span className="font-mono">{alert.createdBy}</span>
            </p>
            <p>
              Créée {formatRelative(alert.createdAt)} (
              {formatDateTime(alert.createdAt)})
            </p>
            {alert.readAt && <p>Consultée {formatRelative(alert.readAt)}</p>}
          </div>
        </div>
      </UnifiedModal>

      <UnifiedPaymentModal
        open={collectOpen}
        onOpenChange={setCollectOpen}
        context={installmentCtx}
      />
    </>
  );
}
