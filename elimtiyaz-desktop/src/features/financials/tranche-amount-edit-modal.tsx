// ============================================================================
// FILE: elimtiyaz-desktop/src/features/financials/tranche-amount-edit-modal.tsx
// ============================================================================
/**
 * TrancheAmountEditModal — T-510 (DEBT-105, GitHub issue #31): the
 * per-tranche amount editor. The owner's mandate: "The workflow must let
 * me select an account, inspect its tranches, and set the amount due for
 * each tranche individually. Adjusting one tranche must not
 * unintentionally change other tranches or create inconsistencies
 * between account-level and tranche-level balances."
 *
 * ONE canonical write path (§6 — never a parallel implementation): the
 * modal is a thin FORM over `InstallmentRepository.adjustAmountDue` —
 * the client of the `adjust_installment_amount` RPC (migration 0152).
 * The repository performs the three atomic writes (the tranche row, the
 * signed-delta ledger adjustment, the audit row); this component computes
 * NOTHING financial beyond the PREVIEW the owner sees before confirming
 * (the delta and the INV-4 remaining are derived through the canonical
 * helpers — `installmentRemaining` — never inline formulas).
 *
 * The input's meaning is EXPLICIT (the issue's mandate: "make clear
 * whether the input represents the tranche's new total due or an
 * adjustment to its existing amount"): the field is labeled « Nouveau
 * montant dû TOTAL » — an absolute amount, never a delta; the live
 * preview shows the signed delta it implies.
 *
 * The OVER-COVERED case (new < paid + pending — an already-paid or
 * allocated tranche reduced below its coverage) is displayed BEFORE the
 * save (the explicit excess amount + the statement that payments are
 * never moved) and re-surfaced after the save in the toast — never
 * silent, never blocked (the issue: "handle paid, partially paid, unpaid,
 * and overpaid tranches correctly" + "explicitly handle adjustments
 * affecting already-paid or allocated amounts").
 *
 * Mounted (the reuse-first rule — ONE component, the échéancier surface):
 *   - the Finance « Échéancier » tab (`InstallmentScheduleTab` — the
 *     row-level « Montant » action on every tranche row).
 */
import { useMemo, useState } from "react";
import { Wallet, AlertTriangle, ArrowRight } from "lucide-react";

import { useRepositories } from "../../app/providers/repository-provider";
import { useAuth } from "../../app/providers/auth-provider";
import { useToast } from "../../app/providers/toast-provider";
import { UnifiedModal } from "../../shared/ui/unified-modal";
import { FormField } from "../../shared/ui/form-field";
import { MoneyInput } from "../../shared/ui/money-input";
import { Textarea } from "../../shared/ui/textarea";
import { StatusChip } from "../../shared/ui/status-chip";
import {
  PAYMENT_CATEGORY_LABELS_FR,
  PAYMENT_STATUS_LABELS_FR,
  type Installment,
} from "../../domain/model/payment";
// The canonical INV-4-family remaining — the same helper every surface
// uses (never an inline `due − paid` formula — the DATA-008 defect class).
import { installmentRemaining } from "../../domain/calc/payment/queries";
import { formatDzd, formatDzdPlain } from "../../core/format/currency";
import { formatDate } from "../../core/format/date";

const PAYMENT_STATUS_TONE: Record<string, "success" | "warning" | "danger" | "neutral" | "info"> = {
  paid: "success",
  partial: "warning",
  pending: "info",
  pending_clearance: "info",
  overdue: "danger",
  unpaid: "neutral",
  cancelled: "neutral",
};

export interface TrancheAmountEditModalProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** The tranche to adjust — its OWN row only (never a sibling). */
  installment: Installment | null;
  /** The family's display name (header context). */
  parentName?: string;
}

export function TrancheAmountEditModal({
  open,
  onOpenChange,
  installment,
  parentName,
}: TrancheAmountEditModalProps) {
  const repos = useRepositories();
  const { session } = useAuth();
  const toast = useToast();
  const [amount, setAmount] = useState(0);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  // The current financial details (the issue's "display each tranche and
  // its current financial details") — all through the canonical helpers.
  const current = useMemo(() => {
    if (!installment) return null;
    return {
      remaining: installmentRemaining(installment),
      covered: installment.amountPaid + (installment.amountPending ?? 0),
    };
  }, [installment]);

  // The LIVE PREVIEW — the delta the save implies (signed), the new
  // remaining (INV-4 clamp), and the over-coverage classification. This
  // is display-only derivation through the same formula the write path
  // applies; the repository remains the authority.
  const preview = useMemo(() => {
    if (!installment || !current) return null;
    const delta = amount - installment.amountDue;
    const newRemaining = Math.max(0, amount - current.covered);
    const overcovered = amount < current.covered && delta !== 0;
    const excess = overcovered ? current.covered - amount : 0;
    return { delta, newRemaining, overcovered, excess };
  }, [installment, amount, current]);

  const reasonTrimmed = reason.trim();
  const reasonValid = reasonTrimmed.length >= 3;
  const deltaZero = preview !== null && preview.delta === 0;
  const canSubmit =
    installment !== null &&
    amount >= 0 &&
    reasonValid &&
    !deltaZero &&
    !saving;

  async function submit() {
    if (!installment || !preview) return;
    // §15.15 (never fabricate): when the repository implementation does not
    // carry the canonical write path, surface the unavailability honestly.
    if (typeof repos.installments.adjustAmountDue !== "function") {
      toast.showError(
        "Indisponible",
        "L'édition du montant par tranche n'est pas disponible sur ce dépôt de données (chemin canonique absent).",
      );
      return;
    }
    if (!canSubmit) {
      if (deltaZero) {
        toast.showWarning(
          "Aucun changement",
          "Le nouveau montant dû est identique au montant actuel — rien à ajuster.",
        );
      } else if (!reasonValid) {
        toast.showWarning("Champs invalides", "Le motif est obligatoire (≥ 3 caractères).");
      }
      return;
    }
    setSaving(true);
    try {
      const res = await repos.installments.adjustAmountDue({
        installmentId: installment.id,
        newAmountDue: amount,
        reason: reasonTrimmed,
        actorId: session?.userId,
        actorName: session?.displayName ?? session?.userId,
      });
      if (res.ok) {
        const r = res.value;
        toast.showSuccess(
          "Montant de la tranche modifié",
          `${installment.label}${parentName ? ` — ${parentName}` : ""} : ${formatDzdPlain(r.previousAmountDue)} → ${formatDzdPlain(amount)} DZD (${r.delta > 0 ? "+" : ""}${formatDzdPlain(r.delta)}). ` +
            `Reste à payer : ${formatDzdPlain(installmentRemaining(r.installment))} DZD. ` +
            `Total dû famille : ${formatDzdPlain(r.installmentsDueAfter)} DZD. ` +
            (r.overcovered
              ? `ATTENTION : tranche surcouverte de ${formatDzdPlain(r.excess)} DZD — les paiements existants ne sont JAMAIS déplacés ni réécrits.`
              : "Les paiements et l'historique restent intacts."),
        );
        setAmount(0);
        setReason("");
        onOpenChange(false);
      } else {
        toast.showError("Échec de l'enregistrement", res.error.userMessage);
      }
    } finally {
      setSaving(false);
    }
  }

  if (!installment || !current) {
    return null;
  }

  return (
    <UnifiedModal
      open={open}
      onOpenChange={onOpenChange}
      variant="dialog"
      size="sm"
      icon={Wallet}
      iconTone="primary"
      title={`Modifier le montant — ${installment.label}`}
      description={
        parentName
          ? `${parentName} · ${PAYMENT_CATEGORY_LABELS_FR[installment.category] ?? installment.category}`
          : PAYMENT_CATEGORY_LABELS_FR[installment.category] ?? installment.category
      }
      submitLabel="Enregistrer le montant"
      submitIcon={Wallet}
      onSubmit={submit}
      submitDisabled={!canSubmit}
    >
      <div className="space-y-3">
        {/* The tranche's CURRENT financial details (the issue's "display
            each tranche and its current financial details"). */}
        <div
          className="rounded-md border border-border p-2.5 text-xs bg-muted/20 space-y-1"
          data-testid="tranche-amount-edit-current"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Montant dû actuel</span>
            <span className="font-mono font-semibold">{formatDzd(installment.amountDue)}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Déjà encaissé (clair)</span>
            <span className="font-mono">{formatDzd(installment.amountPaid)}</span>
          </div>
          {(installment.amountPending ?? 0) > 0 && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">En attente de clearance</span>
              <span className="font-mono">{formatDzd(installment.amountPending ?? 0)}</span>
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Reste (INV-4)</span>
            <span className="font-mono font-semibold text-status-danger">{formatDzd(current.remaining)}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Échéance</span>
            <span className="font-mono">{formatDate(installment.dueDate)}</span>
          </div>
          <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/60">
            <span className="text-muted-foreground">Statut</span>
            <StatusChip
              label={PAYMENT_STATUS_LABELS_FR[installment.status as keyof typeof PAYMENT_STATUS_LABELS_FR] ?? installment.status}
              tone={PAYMENT_STATUS_TONE[installment.status] ?? "neutral"}
            />
          </div>
        </div>

        {/* The NEW TOTAL DUE — the input's meaning is explicit (the issue's
            mandate): an ABSOLUTE amount, never a delta. */}
        <FormField
          label="Nouveau montant dû TOTAL (DZD)"
          required
          hint="Le montant total que cette tranche devra coûter après l'enregistrement — PAS un ajustement à additionner."
        >
          <MoneyInput value={amount} onChange={setAmount} id="tranche-new-amount-due" />
        </FormField>

        {/* The LIVE PREVIEW — what the save implies, derived through the
            canonical INV-4 formula (never an inline `due − paid`). */}
        {preview && amount > 0 && (
          <div
            className="rounded-md border border-border p-2.5 text-xs space-y-1"
            data-testid="tranche-amount-edit-preview"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Ajustement impliqué</span>
              <span
                className={
                  "font-mono font-semibold " +
                  (preview.delta > 0 ? "text-status-danger" : preview.delta < 0 ? "text-status-success" : "text-muted-foreground")
                }
              >
                {preview.delta > 0 ? "+" : ""}
                {formatDzdPlain(preview.delta)} DZD
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Reste après (INV-4)</span>
              <span className="font-mono font-semibold">{formatDzd(preview.newRemaining)}</span>
            </div>
            {deltaZero && (
              <p className="text-[11px] text-status-warning flex items-start gap-1.5">
                <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                <span data-testid="tranche-amount-edit-noop">
                  Identique au montant actuel — un nouvel enregistrement de la même valeur est
                  rejeté (aucun double ajustement).
                </span>
              </p>
            )}
          </div>
        )}

        {/* The OVER-COVERED warning — BEFORE the save (explicit, never
            silent, never blocking): the new due sits below the funds
            already paid or allocated; the payments are NEVER moved. */}
        {preview && preview.overcovered && (
          <div
            className="rounded-md border border-status-warning/40 bg-status-warning/10 p-2.5 text-[11px] space-y-1"
            data-testid="tranche-amount-edit-overcovered"
          >
            <p className="flex items-start gap-1.5 text-status-warning font-medium">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>Tranche surcouverte de {formatDzdPlain(preview.excess)} DZD</span>
            </p>
            <p className="text-muted-foreground">
              Le nouveau montant est inférieur aux fonds déjà encaissés/engagés
              ({formatDzdPlain(current.covered)} DZD). La tranche passera à « Payé » ; l'excédent
              reste visible sur le compte de la famille — les paiements existants ne sont
              <b> jamais</b> déplacés, réécrits ou réattribués.
            </p>
          </div>
        )}

        <FormField
          label="Motif de l'ajustement"
          required
          hint="Obligatoire pour la traçabilité d'audit (≥ 3 caractères) — enregistré avec l'auteur et l'horodatage."
        >
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ex. Remise exceptionnelle direction · Erreur de saisie import · Majoration transport…"
            rows={3}
            id="tranche-adjust-reason"
          />
        </FormField>

        <p className="text-[10px] text-muted-foreground flex items-start gap-1.5">
          <ArrowRight className="h-3 w-3 shrink-0 mt-0.5" />
          <span>
            Un ajustement de tranche n'affecte QUE cette tranche — les autres tranches de la
            famille ne changent pas ; l'écart est inscrit au registre (audit + écriture
            comptable) et les soldes compte/tranches restent réconciliés.
          </span>
        </p>
      </div>
    </UnifiedModal>
  );
}
