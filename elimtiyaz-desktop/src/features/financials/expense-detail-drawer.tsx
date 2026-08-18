/**
 * ExpenseDetailDrawer — slide-over with the two-tier workflow timeline.
 *
 * Plan §08:
 *   Draft → Submitted → Approved/Rejected → Disbursed → Settled (with proof)
 *
 * Refactored to consume `<EntityDetailDrawer<Expense>>` so the drawer chrome,
 * metadata grid, tab body, and sticky action bar all flow through the shared
 * primitive. The reject confirmation now uses `<ConfirmModal>`. The disburse
 * step uses `<ConfirmModal>` too (it's a one-click destructive-ish action
 * that benefits from explicit confirmation). The proof upload uses a small
 * `<AutoFormModal>` to collect the proof file name (mocked in this iteration).
 *
 * Anomaly badge renders when anomalyScore > 0.7 (signal, not verdict —
 * human always decides).
 */
import { useState } from "react";
import { z } from "zod";
import {
  AlertTriangle, CheckCircle2, XCircle, DollarSign, Upload,
} from "lucide-react";
import { useRepositories } from "../../app/providers/repository-provider";
import { useToast } from "../../app/providers/toast-provider";
import { useAuth } from "../../app/providers/auth-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import {
  EntityDetailDrawer,
  type EntityDrawerTab,
  type EntityDrawerAction,
  type EntityDrawerMetaItem,
} from "../../shared/ui/entity-drawer";
import { ConfirmModal } from "../../shared/ui/unified-modal";
import { AutoFormModal, type AutoFormField } from "../../shared/ui/auto-form";
import { StatusChip } from "../../shared/ui/status-chip";
import { formatDzd } from "../../core/format/currency";
import { formatRelative, formatDateTime } from "../../core/format/date";
import {
  EXPENSE_STATUS_LABELS_FR,
  EXPENSE_CATEGORY_LABELS_FR,
  type Expense,
  type ExpenseStatus,
} from "../../domain/model/expense";
import { Permission } from "../../core/rbac/permissions";
import { AnomalyExplainerModal } from "./anomaly-explainer-modal";

const STAGE_ORDER: ExpenseStatus[] = ["submitted", "approved", "disbursed", "settled"];

const ProofSchema = z.object({
  proofFileName: z.string().min(3, "Nom du justificatif requis"),
});

const proofFields: readonly AutoFormField[] = [
  { name: "proofFileName", label: "Justificatif (nom de fichier)", type: "text", required: true, wide: true, placeholder: "recu-facture.pdf" },
];

export function ExpenseDetailDrawer({
  expenseId,
  open,
  onOpenChange,
}: {
  expenseId: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const repos = useRepositories();
  const { session } = useAuth();
  const toast = useToast();
  const expense = useObservable(
    () => repos.expenses.observeById(expenseId ?? ""),
    [expenseId],
  );

  const [rejectOpen, setRejectOpen] = useState(false);
  const [disburseOpen, setDisburseOpen] = useState(false);
  const [proofOpen, setProofOpen] = useState(false);
  const [anomalyOpen, setAnomalyOpen] = useState(false);

  if (!expense) return null;

  const canApprove = !!session && session.permissions.has(Permission.ApproveExpense) && session.userId !== expense.submittedBy;
  const canDisburse = !!session && session.permissions.has(Permission.DisburseExpense);
  const canSettle = !!session && session.permissions.has(Permission.SettleExpenseProof);
  const hasAnomaly = (expense.anomalyScore ?? 0) > 0.7;
  const currentStageIdx = STAGE_ORDER.indexOf(expense.status);

  async function handleApprove() {
    if (!session) return;
    const r = await repos.expenses.approve(expense!.id, session.userId, "Approuvé");
    if (r.ok) toast.showSuccess("Dépense approuvée");
    else toast.showError("Échec", r.error.userMessage);
  }

  async function handleReject() {
    if (!session) return;
    const r = await repos.expenses.reject(expense!.id, session.userId, "Non conforme");
    if (r.ok) {
      toast.showSuccess("Dépense rejetée");
      setRejectOpen(false);
    } else {
      toast.showError("Échec", r.error.userMessage);
    }
  }

  async function handleDisburse() {
    if (!session) return;
    const r = await repos.expenses.disburse(expense!.id, session.userId);
    if (r.ok) {
      toast.showSuccess("Fonds décaissés");
      setDisburseOpen(false);
    } else {
      toast.showError("Échec", r.error.userMessage);
    }
  }

  async function handleSettleProof(data: z.infer<typeof ProofSchema>) {
    if (!session) return;
    const r = await repos.expenses.settleProof(expense!.id, `mock://proof/${data.proofFileName}`, session.userId);
    if (r.ok) {
      toast.showSuccess("Dépense justifiée et clôturée");
      setProofOpen(false);
    } else {
      throw new Error(r.error.userMessage);
    }
  }

  const metadata = (e: Expense): readonly EntityDrawerMetaItem[] => [
    { label: "Montant", value: formatDzd(e.amount) },
    { label: "Catégorie", value: EXPENSE_CATEGORY_LABELS_FR[e.category] },
    { label: "Bénéficiaire", value: e.payee },
    { label: "Statut", value: EXPENSE_STATUS_LABELS_FR[e.status] },
    { label: "Soumis par", value: e.submittedBy },
    { label: "Date", value: formatDateTime(e.submittedAt) },
  ];

  const tabs = (e: Expense): readonly EntityDrawerTab<Expense>[] => [
    {
      id: "workflow",
      label: "Workflow & Détails",
      content: () => (
        <div className="space-y-4 text-sm">
          {hasAnomaly && (
            <button
              type="button"
              onClick={() => setAnomalyOpen(true)}
              className="w-full rounded-md border border-status-danger/40 bg-status-danger/10 p-3 text-left hover:bg-status-danger/20 transition-colors"
            >
              <div className="flex items-center gap-2 font-medium text-status-danger">
                <AlertTriangle className="size-4" /> Anomalie IA Détectée
              </div>
              <p className="text-xs text-muted-foreground mt-1">{e.anomalyNote ?? "Score d'anomalie élevé"}</p>
            </button>
          )}

          {/* Vertical timeline */}
          <ol className="relative border-l border-border pl-4 space-y-3">
            {STAGE_ORDER.map((stage, idx) => {
              const reached = idx <= currentStageIdx;
              const isCurrent = idx === currentStageIdx;
              return (
                <li key={stage} className="relative">
                  <span
                    className={`absolute -left-[21px] top-1 size-3 rounded-full border-2 border-background ${
                      reached ? "bg-primary" : "bg-muted"
                    } ${isCurrent ? "ring-2 ring-primary/30" : ""}`}
                  />
                  <div className="flex items-center justify-between">
                    <span className={`font-medium ${reached ? "text-foreground" : "text-muted-foreground"}`}>
                      {EXPENSE_STATUS_LABELS_FR[stage]}
                    </span>
                    {isCurrent && <StatusChip label="En cours" tone="info" />}
                  </div>
                  {reached && (
                    <p className="text-xs text-muted-foreground">
                      {formatRelative(e.submittedAt)}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>

          {e.status === "rejected" && (
            <div className="rounded-md border border-status-danger/30 bg-status-danger/5 p-3">
              <p className="text-xs font-medium text-status-danger">Demande rejetée</p>
              <p className="text-xs text-muted-foreground mt-1">{e.approvalNote ?? "Aucun motif fourni."}</p>
            </div>
          )}

          <div>
            <p className="text-xs uppercase text-muted-foreground">Description</p>
            <p className="mt-1">{e.description || "Aucune description fournie."}</p>
          </div>
        </div>
      ),
    },
  ];

  const actions = (e: Expense): readonly EntityDrawerAction<Expense>[] => {
    const list: EntityDrawerAction<Expense>[] = [];
    if (e.status === "submitted" && canApprove) {
      list.push(
        { label: "Approuver", icon: <CheckCircle2 className="size-3.5" />, variant: "default", onClick: handleApprove },
        { label: "Rejeter", icon: <XCircle className="size-3.5" />, variant: "destructive", onClick: () => setRejectOpen(true) },
      );
    }
    if (e.status === "approved" && canDisburse) {
      list.push({ label: "Décaisser", icon: <DollarSign className="size-3.5" />, variant: "default", onClick: () => setDisburseOpen(true) });
    }
    if (e.status === "disbursed" && canSettle) {
      list.push({ label: "Téléverser reçu", icon: <Upload className="size-3.5" />, variant: "default", onClick: () => setProofOpen(true) });
    }
    return list;
  };

  return (
    <>
      <EntityDetailDrawer<Expense>
        open={open}
        onOpenChange={onOpenChange}
        entity={expense}
        title={(e) => e.title}
        subtitle={(e) => `${e.requestCode} · ${EXPENSE_CATEGORY_LABELS_FR[e.category]}`}
        metadata={metadata}
        tabs={tabs}
        actions={actions}
      />

      <ConfirmModal
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        title="Rejeter la dépense"
        description="Confirmez-vous le rejet de cette demande de fonds ? Le motif par défaut « Non conforme » sera enregistré."
        confirmLabel="Rejeter la demande"
        destructive
        onConfirm={handleReject}
      />

      <ConfirmModal
        open={disburseOpen}
        onOpenChange={setDisburseOpen}
        title="Décaisser les fonds"
        description={`Confirmez-vous le décaissement de ${formatDzd(expense.amount)} au profit de ${expense.payee} ?`}
        confirmLabel="Décaisser"
        onConfirm={handleDisburse}
      />

      <AutoFormModal
        open={proofOpen}
        onOpenChange={setProofOpen}
        title="Téléverser le justificatif"
        description="Joignez le justificatif de la dépense pour clôturer la demande."
        schema={ProofSchema}
        fields={proofFields}
        onSubmit={handleSettleProof}
        submitLabel="Clôturer la dépense"
      />

      <AnomalyExplainerModal
        expenseId={expense.id}
        open={anomalyOpen}
        onOpenChange={setAnomalyOpen}
      />
    </>
  );
}
