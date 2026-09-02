/**
 * PaymentDetailDrawer — slide-over panel showing a payment's details.
 *
 * FIX (deep link + missing detail view): the global search routes to
 * `/financials?paymentId=…` but nothing consumed that param, and the
 * financials page had no way to inspect a payment at all (the Android app
 * has a full PaymentDetailScreen; the desktop had none).
 *
 * VAULT §07.02 — the drawer now hosts the payment lifecycle transitions:
 *   - "Confirmer compensation bancaire" (PENDING → PAID, bank clearance
 *     verified) — moves uncleared installment funds into cleared funds.
 *   - "Marquer comme échoué" (PENDING → UNPAID, check bounces / transfer
 *     fails) — LIFO-reverses the uncleared allocation and writes a
 *     reversal ledger entry. Requires a mandatory reason.
 *   - "Rembourser" (PAID/PENDING → REFUNDED, T-014 / DEAD-015) — full
 *     reversal via the canonical `revert_payment_allocation` RPC. Gated on
 *     Permission.RefundPayment, requires a mandatory reason (≥3 chars) and
 *     propagates the signed-in user's identity so the audit trail is real.
 * All actions are confirmation-gated and audit-logged by the repository.
 */
import { useState } from "react";
import {
  useRepositories,
} from "../../app/providers/repository-provider";
import { useAuth } from "../../app/providers/auth-provider";
import { useToast } from "../../app/providers/toast-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import { EntityDetailDrawer, type EntityDrawerTab, type EntityDrawerMetaItem } from "../../shared/ui/entity-drawer";
import { ConfirmModal } from "../../shared/ui/unified-modal/confirm-modal";
import { Permission } from "../../core/rbac/permissions";
import {
  PAYMENT_METHOD_LABELS_FR,
  PAYMENT_STATUS_LABELS_FR,
  PAYMENT_CATEGORY_LABELS_FR,
  type Payment,
} from "../../domain/model/payment";
import { formatDzd, formatDzdPlain } from "../../core/format/currency";
import { formatDate, formatRelative } from "../../core/format/date";
import { parentDisplayName } from "../../domain/model/parent";

export function PaymentDetailDrawer({
  paymentId,
  open,
  onOpenChange,
  onOpenParent,
}: {
  paymentId: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onOpenParent?: (parentId: string) => void;
}) {
  const repos = useRepositories();
  const toast = useToast();
  const { session } = useAuth();
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmBounce, setConfirmBounce] = useState(false);
  const [bounceReason, setBounceReason] = useState("");
  const [confirmRefund, setConfirmRefund] = useState(false);
  const [refundReason, setRefundReason] = useState("");
  const [transitioning, setTransitioning] = useState(false);

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
          `${entity.receiptNumber} est maintenant payé. Les fonds en attente ont été clearés sur les tranches.`,
        );
        setConfirmClear(false);
      } else {
        toast.showError("Échec de la confirmation", res.error.userMessage);
      }
    } finally {
      setTransitioning(false);
    }
  }

  async function handleMarkBounced() {
    if (!entity || !session) return;
    if (!bounceReason.trim()) {
      toast.showWarning("Motif obligatoire", "Précisez le motif du rejet (ex. chèque sans provision).");
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
        toast.showWarning(
          "Paiement marqué échoué",
          `${entity.receiptNumber} est repassé en non payé. Allocation inversée (LIFO) et écriture de contrepassation enregistrées.`,
        );
        setConfirmBounce(false);
        setBounceReason("");
      } else {
        toast.showError("Échec de l'opération", res.error.userMessage);
      }
    } finally {
      setTransitioning(false);
    }
  }

  /**
   * T-014 — full refund (PAID/PENDING → REFUNDED) through the canonical
   * `revert_payment_allocation` RPC. Reason is mandatory (≥3 chars, the
   * refund-payment EF contract); the signed-in user's identity is passed so
   * the audit entry attributes the refund to a real actor, never "Excel Import".
   */
  async function handleRefund() {
    if (!entity || !session) return;
    if (refundReason.trim().length < 3) {
      toast.showWarning("Motif obligatoire", "Précisez le motif du remboursement (3 caractères minimum).");
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
        toast.showWarning(
          "Paiement remboursé",
          `${entity.receiptNumber} est remboursé. Allocation inversée (LIFO), écriture de contrepassation et écritures de tranches mises à jour.`,
        );
        setConfirmRefund(false);
        setRefundReason("");
      } else {
        toast.showError("Échec du remboursement", res.error.userMessage);
      }
    } finally {
      setTransitioning(false);
    }
  }

  const canRefund =
    !!session && session.permissions.has(Permission.RefundPayment);

  const metadata = (p: Payment): readonly EntityDrawerMetaItem[] => [
    { label: "Reçu", value: p.receiptNumber },
    { label: "Méthode", value: PAYMENT_METHOD_LABELS_FR[p.method] },
    { label: "Catégorie", value: PAYMENT_CATEGORY_LABELS_FR[p.category] },
    { label: "Statut", value: PAYMENT_STATUS_LABELS_FR[p.status] },
    { label: "Encaissé le", value: formatDate(p.collectedAt) },
  ];

  const tabs: readonly EntityDrawerTab<Payment>[] = [
    {
      id: "details",
      label: "Détails",
      content: () => (
        <div className="space-y-3 text-sm">
          <div className="rounded-md border border-border p-3 text-center">
            <p className="text-[10px] uppercase text-muted-foreground">Montant encaissé</p>
            <p className="text-xl font-mono font-bold">{formatDzd(entity?.amount ?? 0)}</p>
          </div>

          {/* VAULT §07.01 — structured non-cash details */}
          {entity?.method === "check" && (
            <div className="rounded-md border border-border bg-surface-elevated/40 p-3 space-y-1.5">
              <p className="text-[10px] uppercase text-muted-foreground">Détails du chèque</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                <Detail label="N° de chèque" value={entity.checkNumber ?? "—"} mono />
                <Detail label="Banque" value={entity.checkBankName ?? "—"} />
                <Detail label="Date d'émission" value={entity.checkIssueDate ? formatDate(entity.checkIssueDate) : "—"} />
                <Detail label="Échéance / compensation" value={entity.checkClearanceDate ? formatDate(entity.checkClearanceDate) : "—"} />
              </div>
            </div>
          )}
          {entity?.method === "transfer" && (
            <div className="rounded-md border border-border bg-surface-elevated/40 p-3 space-y-1.5">
              <p className="text-[10px] uppercase text-muted-foreground">Détails du virement</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                <Detail label="Référence" value={entity.transferReference ?? "—"} mono />
                <Detail label="Banque émettrice" value={entity.transferSourceBank ?? "—"} />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            <Detail label="Parent" value={parent ? parentDisplayName(parent) : entity?.parentId ?? "—"} />
            <Detail label="Élève" value={student ? `${student.firstName} ${student.lastName}` : "—"} />
            <Detail label="Tranche liée" value={entity?.installmentId ?? "—"} mono />
            <Detail label="Encaissé par" value={entity?.collectedBy ?? "—"} mono />
            <Detail
              label="Justificatif"
              value={entity?.proofUrl ? "Fourni" : "—"}
              className={entity?.proofUrl ? "text-status-success" : undefined}
            />
            <Detail label="Notes" value={entity?.notes ?? "—"} />
          </div>

          {/* VAULT §07.02 — lifecycle transitions for uncleared payments */}
          {entity?.status === "pending" && (
            <div className="rounded-md border border-status-warning/40 bg-status-warning/5 p-3 space-y-2">
              <p className="text-xs text-status-warning">
                Paiement en attente de compensation bancaire — la dette n'est pas
                encore considérée comme réglée (Invariant 4).
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={transitioning}
                  onClick={() => setConfirmClear(true)}
                  className="rounded-md border border-status-success/50 bg-status-success/10 px-3 py-1.5 text-xs font-medium text-status-success hover:bg-status-success/20 disabled:opacity-50"
                >
                  ✓ Confirmer compensation bancaire
                </button>
                <button
                  type="button"
                  disabled={transitioning}
                  onClick={() => setConfirmBounce(true)}
                  className="rounded-md border border-status-danger/50 bg-status-danger/10 px-3 py-1.5 text-xs font-medium text-status-danger hover:bg-status-danger/20 disabled:opacity-50"
                >
                  ✗ Chèque rejeté / virement échoué
                </button>
              </div>
            </div>
          )}
          {/* T-014 — refund action (DEAD-015): gated on Permission.RefundPayment,
              reachable for every revertible payment (paid or pending). */}
          {entity && (entity.status === "paid" || entity.status === "pending") && canRefund && (
            <div className="rounded-md border border-border bg-surface-elevated/40 p-3 space-y-2">
              <p className="text-xs text-muted-foreground">
                Remboursement : l'allocation du paiement sera inversée (LIFO), les
                tranches seront rouvertes et une écriture de contrepassation sera
                enregistrée. Le motif est obligatoire et journalisé.
              </p>
              <button
                type="button"
                disabled={transitioning}
                onClick={() => setConfirmRefund(true)}
                className="rounded-md border border-status-danger/50 bg-status-danger/10 px-3 py-1.5 text-xs font-medium text-status-danger hover:bg-status-danger/20 disabled:opacity-50"
              >
                ↩ Rembourser ce paiement
              </button>
            </div>
          )}
          {entity?.status === "unpaid" && (
            <div className="rounded-md border border-status-danger/40 bg-status-danger/5 p-3 text-xs text-status-danger">
              Paiement échoué (rejeté par la banque). La tranche concernée a été
              rouverte — relancez l'encaissement ou enregistrez un nouveau paiement.
            </div>
          )}

          {parent && onOpenParent && (
            <button
              type="button"
              className="text-xs text-primary underline underline-offset-2"
              onClick={() => onOpenParent(parent.id)}
            >
              Ouvrir le dossier du parent →
            </button>
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
        widthClass="max-w-md"
        title={() => `Paiement ${entity?.receiptNumber ?? ""}`}
        subtitle={(p) => `${PAYMENT_METHOD_LABELS_FR[p.method]} · ${formatRelative(p.collectedAt)}`}
        metadata={metadata}
        tabs={() => tabs}
      />
      <ConfirmModal
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Confirmer la compensation bancaire"
        description={
          <>
            Confirmez-vous que la banque a encaissé {entity ? formatDzdPlain(entity.amount) : ""}{" "}
            ({entity ? PAYMENT_METHOD_LABELS_FR[entity.method] : ""} — reçu {entity?.receiptNumber}) ?
            Les fonds en attente seront convertis en fonds clearés sur les tranches concernées
            et le paiement passera au statut « Payé ». Cette action est journalisée.
          </>
        }
        confirmLabel="Confirmer la compensation"
        onConfirm={handleMarkCleared}
      />
      <ConfirmModal
        open={confirmBounce}
        onOpenChange={setConfirmBounce}
        destructive
        title="Marquer le paiement comme échoué"
        description={
          <div className="space-y-2">
            <p>
              Le paiement {entity?.receiptNumber} ({entity ? formatDzdPlain(entity.amount) : ""}) sera
              repositionné en « Non payé ». L'allocation en attente sera inversée (LIFO), une écriture
              de contrepassation sera enregistrée au ledger et les tranches seront rouvertes.
            </p>
            <label className="block space-y-1">
              <span className="text-xs font-medium">Motif du rejet (obligatoire) :</span>
              <input
                value={bounceReason}
                onChange={(e) => setBounceReason(e.target.value)}
                placeholder="ex. Chèque sans provision — banque BNA"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
            </label>
          </div>
        }
        confirmLabel="Marquer échoué"
        onConfirm={handleMarkBounced}
      />
      <ConfirmModal
        open={confirmRefund}
        onOpenChange={setConfirmRefund}
        destructive
        title="Rembourser le paiement"
        description={
          <div className="space-y-2">
            <p>
              Le paiement {entity?.receiptNumber} ({entity ? formatDzdPlain(entity.amount) : ""}) sera
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

function Detail({
  label,
  value,
  mono,
  className,
}: {
  label: string;
  value: string;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase text-muted-foreground">{label}</p>
      <p className={`text-sm text-foreground ${mono ? "font-mono" : ""} ${className ?? ""}`}>{value}</p>
    </div>
  );
}
