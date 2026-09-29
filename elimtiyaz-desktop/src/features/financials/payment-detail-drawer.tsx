// ============================================================================
// FILE: elimtiyaz-desktop/src/features/financials/payment-detail-drawer.tsx
// ============================================================================

import { useState } from "react";
import {
  User,
  GraduationCap,
  ExternalLink,
  Download,
  RotateCcw,
} from "lucide-react";
import { useRepositories } from "../../app/providers/repository-provider";
import { useAuth } from "../../app/providers/auth-provider";
import { useToast } from "../../app/providers/toast-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import { EntityDetailDrawer, type EntityDrawerTab, type EntityDrawerMetaItem } from "../../shared/ui/entity-drawer";
import { ConfirmModal } from "../../shared/ui/unified-modal/confirm-modal";
import { Permission } from "../../core/rbac/permissions";
import {
  PAYMENT_METHOD_LABELS_FR,
  PAYMENT_STATUS_LABELS_FR,
  paymentCategoryLabelFr,
  type Payment,
} from "../../domain/model/payment";
import { formatDzd } from "../../core/format/currency";
import { formatDate, formatDateTime } from "../../core/format/date";
import { parentDisplayName } from "../../domain/model/parent";
import { usePersonNavigation } from "../../shared/navigation/person-navigation-context";
import { ParentActionsMenu } from "../../shared/ui/parent-actions-menu";
import { StudentActionsMenu } from "../../shared/ui/student-actions-menu";
import { Button } from "../../shared/ui/button";
import { Card, CardContent } from "../../shared/ui/card";
import { StatusChip } from "../../shared/ui/status-chip";
import { generatePaymentReceiptPdf, downloadPdf } from "../../infrastructure/receipt-pdf";

export function PaymentDetailDrawer({
  paymentId,
  open,
  onOpenChange,
}: {
  paymentId: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const repos = useRepositories();
  const toast = useToast();
  const { session } = useAuth();
  const { openParent, openStudent } = usePersonNavigation();

  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmBounce, setConfirmBounce] = useState(false);
  const [bounceReason, setBounceReason] = useState("");
  const [confirmRefund, setConfirmRefund] = useState(false);
  const [refundReason, setRefundReason] = useState("");
  const [transitioning, setTransitioning] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const payment = useObservable(
    () => repos.payments.observeById(paymentId ?? ""),
    [paymentId],
  );
  const parents = useObservable(() => repos.parents.observe(), []);
  const students = useObservable(() => repos.students.observe(), []);

  const entity: Payment | null = open && paymentId && payment ? payment : null;
  const parent = entity ? parents.find((p) => p.id === entity.parentId) : null;
  const student = entity && entity.studentId
    ? students.find((s) => s.id === entity.studentId)
    : null;

  async function handleMarkCleared() {
    if (!entity || !session) return;
    setTransitioning(true);
    try {
      const res = await repos.payments.markCleared(
        entity.id,
        session.userId,
        session.displayName ?? "Session courante",
      );
      if (res.ok) {
        toast.showSuccess(
          "Compensation bancaire confirmée",
          `${entity.receiptNumber} est maintenant payé.`,
        );
        setConfirmClear(false);
      } else {
        toast.showError("Échec", res.error.userMessage);
      }
    } finally {
      setTransitioning(false);
    }
  }

  async function handleMarkBounced() {
    if (!entity || !session) return;
    if (!bounceReason.trim()) {
      toast.showWarning("Motif obligatoire", "Précisez la raison du rejet du paiement.");
      return;
    }
    setTransitioning(true);
    try {
      const res = await repos.payments.markBounced(
        entity.id,
        bounceReason.trim(),
        session.userId,
        session.displayName ?? "Session courante",
      );
      if (res.ok) {
        toast.showWarning("Paiement rejeté", "Écriture de contrepassation effectuée.");
        setConfirmBounce(false);
      }
    } finally {
      setTransitioning(false);
    }
  }

  async function handleRefund() {
    if (!entity || !session) return;
    if (refundReason.trim().length < 3) {
      toast.showWarning("Motif obligatoire", "Précisez le motif du remboursement.");
      return;
    }
    setTransitioning(true);
    try {
      const res = await repos.payments.refund(
        entity.id,
        refundReason.trim(),
        session.userId,
        session.displayName ?? "Session courante",
      );
      if (res.ok) {
        toast.showSuccess("Paiement remboursé", "Le versement a été contrepassé avec succès.");
        setConfirmRefund(false);
      }
    } finally {
      setTransitioning(false);
    }
  }

  async function handleDownloadPdf() {
    if (!entity) return;
    setDownloading(true);
    try {
      const pdfBytes = await generatePaymentReceiptPdf(entity, parent ?? undefined);
      downloadPdf(pdfBytes, `recu-${entity.receiptNumber}.pdf`);
      toast.showSuccess("Reçu téléchargé", `${entity.receiptNumber}.pdf`);
    } catch (e) {
      toast.showError("Échec du téléchargement", String(e));
    } finally {
      setDownloading(false);
    }
  }

  const canRefund = !!session && session.permissions.has(Permission.RefundPayment);

  const metadata = (p: Payment): readonly EntityDrawerMetaItem[] => [
    { label: "N° Reçu", value: p.receiptNumber },
    { label: "Canal", value: PAYMENT_METHOD_LABELS_FR[p.method] },
    { label: "Pôle", value: paymentCategoryLabelFr(p.category) },
    { label: "Date", value: formatDateTime(p.collectedAt) },
  ];

  const tabs: readonly EntityDrawerTab<Payment>[] = [
    {
      id: "details",
      label: "Règlement & Affectation",
      content: () => (
        <div className="space-y-4 text-sm">
          {/* Hero Amount Tile */}
          <div className="rounded-xl border border-primary/30 bg-gradient-to-br from-primary/15 via-primary/5 to-surface-panel p-4 flex items-center justify-between">
            <div className="space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                Montant Encaissé
              </span>
              <p className="text-2xl font-mono font-bold text-foreground">
                {formatDzd(entity?.amount ?? 0)}
              </p>
              <p className="text-[11px] text-muted-foreground">
                Enregistré par {entity?.collectedBy || "Guichetier"}
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <StatusChip
                label={PAYMENT_STATUS_LABELS_FR[entity?.status ?? "paid"]}
                tone={entity?.status === "paid" ? "success" : "warning"}
              />
              <Button size="sm" variant="outline" onClick={handleDownloadPdf} disabled={downloading} className="h-7 text-xs gap-1">
                <Download className="h-3 w-3" /> Reçu PDF
              </Button>
            </div>
          </div>

          {/* Connected Payer / Parent Card */}
          {parent && (
            <Card className="rounded-xl border border-border/80 bg-surface-panel shadow-sm">
              <CardContent className="p-3.5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                    <User className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                      Parent Payeur
                    </span>
                    <button
                      type="button"
                      onClick={() => openParent(parent.id)}
                      className="font-bold text-sm text-foreground hover:text-primary hover:underline text-left truncate block"
                    >
                      {parentDisplayName(parent)}
                    </button>
                    <span className="text-xs text-muted-foreground font-mono">{parent.code} · {parent.phone}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <ParentActionsMenu parent={parent} />
                  <Button size="sm" variant="ghost" className="h-8 text-xs text-primary" onClick={() => openParent(parent.id)}>
                    Dossier <ExternalLink className="h-3 w-3 ml-1" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Connected Student Card */}
          {student && (
            <Card className="rounded-xl border border-border/80 bg-surface-panel shadow-sm">
              <CardContent className="p-3.5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-10 w-10 rounded-xl bg-brand-gold/10 text-brand-gold flex items-center justify-center shrink-0">
                    <GraduationCap className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                      Élève Bénéficiaire
                    </span>
                    <button
                      type="button"
                      onClick={() => openStudent(student.id)}
                      className="font-bold text-sm text-foreground hover:text-primary hover:underline text-left truncate block"
                    >
                      {student.firstName} {student.lastName}
                    </button>
                    <span className="text-xs text-muted-foreground font-mono">{student.code}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <StudentActionsMenu student={student} parentName={parent ? parentDisplayName(parent) : null} />
                  <Button size="sm" variant="ghost" className="h-8 text-xs text-primary" onClick={() => openStudent(student.id)}>
                    Fiche <ExternalLink className="h-3 w-3 ml-1" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Payment Method Details */}
          {entity?.method === "check" && (
            <div className="rounded-xl border border-border bg-surface-elevated/40 p-3.5 space-y-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                Détails du Chèque
              </span>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><span className="text-muted-foreground">N° Chèque :</span> <strong className="font-mono">{entity.checkNumber ?? "—"}</strong></div>
                <div><span className="text-muted-foreground">Banque :</span> <strong>{entity.checkBankName ?? "—"}</strong></div>
                <div><span className="text-muted-foreground">Émission :</span> <span>{entity.checkIssueDate ? formatDate(entity.checkIssueDate) : "—"}</span></div>
                <div><span className="text-muted-foreground">Compensation :</span> <span>{entity.checkClearanceDate ? formatDate(entity.checkClearanceDate) : "—"}</span></div>
              </div>
            </div>
          )}

          {entity?.notes && (
            <div className="rounded-lg border border-border p-3 text-xs">
              <span className="text-[10px] uppercase font-bold text-muted-foreground block mb-1">Notes de caisse</span>
              <p className="text-muted-foreground italic">{entity.notes}</p>
            </div>
          )}

          {/* Status Transitions */}
          {entity?.status === "pending" && (
            <div className="rounded-xl border border-status-warning/40 bg-status-warning/5 p-3.5 space-y-2.5">
              <p className="text-xs text-status-warning leading-relaxed font-medium">
                Paiement non compensé : les fonds sont réservés mais pas encore libérés sur l'échéancier.
              </p>
              <div className="flex gap-2">
                {/* T-444/UI-324 restored: the transitioning double-submit guards
                    on the money-moving buttons (1cead9d dropped them). */}
                <Button size="sm" className="h-8 text-xs" disabled={transitioning} onClick={() => setConfirmClear(true)}>
                  Valider la compensation bancaire
                </Button>
                <Button size="sm" variant="outline" className="h-8 text-xs text-status-danger" disabled={transitioning} onClick={() => setConfirmBounce(true)}>
                  Chèque rejeté
                </Button>
              </div>
            </div>
          )}

          {canRefund && entity && (entity.status === "paid" || entity.status === "pending") && (
            <div className="pt-2">
              <Button size="sm" variant="outline" className="h-8 text-xs text-status-danger border-status-danger/30 hover:bg-status-danger/10 gap-1.5" disabled={transitioning} onClick={() => setConfirmRefund(true)}>
                <RotateCcw className="h-3.5 w-3.5" />
                Rembourser ce versement
              </Button>
            </div>
          )}

          {/* T-444/UI-324 restored: the failed-payment state explanation
              (1cead9d dropped it — the operator lost the recovery hint). */}
          {entity?.status === "unpaid" && (
            <div className="rounded-xl border border-status-danger/40 bg-status-danger/5 p-3 text-xs text-status-danger">
              Paiement échoué (rejeté par la banque). La tranche concernée a été
              rouverte — relancez l'encaissement ou enregistrez un nouveau paiement.
            </div>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <EntityDetailDrawer<Payment>
        open={open}
        onOpenChange={onOpenChange}
        entity={entity}
        widthClass="w-full sm:max-w-lg md:max-w-xl"
        title={() => `Paiement ${entity?.receiptNumber ?? ""}`}
        subtitle={(p) => `${PAYMENT_METHOD_LABELS_FR[p.method]} · Encaissé le ${formatDate(p.collectedAt)}`}
        metadata={metadata}
        tabs={() => tabs}
      />

      <ConfirmModal
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Confirmer la compensation bancaire"
        description="Les fonds seront considérés comme acquis définitivement sur les tranches."
        confirmLabel="Confirmer"
        onConfirm={handleMarkCleared}
      />

      <ConfirmModal
        open={confirmBounce}
        onOpenChange={setConfirmBounce}
        destructive
        title="Marquer le paiement comme rejeté"
        description={
          <div className="space-y-2">
            <p>La dette correspondante sera immédiatement rouverte.</p>
            <input
              value={bounceReason}
              onChange={(e) => setBounceReason(e.target.value)}
              placeholder="Motif du rejet…"
              className="w-full rounded border px-3 py-1.5 text-xs"
            />
          </div>
        }
        confirmLabel="Rejeter"
        onConfirm={handleMarkBounced}
      />

      <ConfirmModal
        open={confirmRefund}
        onOpenChange={setConfirmRefund}
        destructive
        title="Rembourser ce paiement"
        description={
          <div className="space-y-2">
            {/* T-444/UI-324 restored: the informative refund body (1cead9d
                shortened it to a bare placeholder — the operator lost the
                LIFO/ledger explanation AND the mandatory-reason rule). */}
            <p>
              Le paiement {entity?.receiptNumber} ({entity ? formatDzd(entity.amount) : ""}) sera
              remboursé. L'allocation sera inversée (LIFO), une écriture de contrepassation sera
              enregistrée au ledger et les tranches concernées seront rouvertes. Cette action est
              journalisée avec votre identité et le motif saisi.
            </p>
            <label className="block space-y-1">
              <span className="text-xs font-medium">Motif du remboursement (obligatoire, 3 caractères minimum) :</span>
              <input
                value={refundReason}
                onChange={(e) => setRefundReason(e.target.value)}
                placeholder="ex. Erreur de saisie — doublon annulé par la direction"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
            </label>
          </div>
        }
        confirmLabel="Confirmer le remboursement"
        onConfirm={handleRefund}
      />
    </>
  );
}