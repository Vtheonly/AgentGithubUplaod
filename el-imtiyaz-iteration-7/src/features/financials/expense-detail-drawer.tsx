/**
 * ExpenseDetailDrawer — slide-over with the two-tier workflow timeline.
 *
 * Plan §08:
 *   Draft → Submitted → Approved/Rejected → Disbursed → Settled (with proof)
 *
 * Renders a vertical timeline of the 4 stages. Status-gated action buttons
 * appear based on the current state and the user's permissions:
 *   - submitted: Approve / Reject (ApproveExpense permission)
 *   - approved: Disburse (DisburseExpense permission)
 *   - disbursed: Settle Proof (SettleExpenseProof permission)
 *
 * Anomaly badge renders when anomalyScore > 0.7 (signal, not verdict —
 * human always decides).
 *
 * Iteration 4: migrated from raw `Drawer` + 2 raw `Dialog`s to `UnifiedModal`
 * so the expense drawer and its 3 nested modals (reject / disburse / proof)
 * share the exact same chrome, padding, header, footer, animations, and
 * close behavior as every other modal in the application.
 */
import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  XCircle,
  DollarSign,
  Upload,
  Receipt,
} from "lucide-react";
import { useRepositories } from "../../infrastructure/repository-provider";
import { useToast } from "../../state/toast-context";
import { useAuth } from "../../state/auth-context";
import { useObservable } from "../../shared/hooks/use-observable";
import { UnifiedModal } from "../../shared/components/unified-modal";
import { Button } from "../../shared/ui/button";
import { StatusChip } from "../../shared/components/status-chip";
import { Separator } from "../../shared/ui/separator";
import { Textarea } from "../../shared/ui/textarea";
import { FormField } from "../../shared/components/form-field";
import { ConfirmDialog } from "../../shared/components/confirm-dialog";
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

  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [disburseDialogOpen, setDisburseDialogOpen] = useState(false);
  const [proofDialogOpen, setProofDialogOpen] = useState(false);
  const [proofFileName, setProofFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [anomalyOpen, setAnomalyOpen] = useState(false);

  if (!open || !expenseId || !expense) return null;

  const canApprove = !!session && session.permissions.has(Permission.ApproveExpense) && session.userId !== expense.submittedBy;
  const canDisburse = !!session && session.permissions.has(Permission.DisburseExpense);
  const canSettle = !!session && session.permissions.has(Permission.SettleExpenseProof);
  const hasAnomaly = (expense.anomalyScore ?? 0) > 0.7;
  const isRejected = expense.status === "rejected";
  const currentStageIdx = STAGE_ORDER.indexOf(expense.status);

  async function approve() {
    if (!session) return;
    setBusy(true);
    try {
      const r = await repos.expenses.approve(expense!.id, session.userId, "Approuvé");
      if (r.ok) toast.showSuccess("Dépense approuvée");
      else toast.showError("Échec", r.error.userMessage);
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    if (!session || !rejectReason.trim()) {
      toast.showWarning("Motif requis", "Le rejet nécessite un motif.");
      return;
    }
    setBusy(true);
    try {
      const r = await repos.expenses.reject(expense!.id, session.userId, rejectReason.trim());
      if (r.ok) {
        toast.showSuccess("Dépense rejetée");
        setRejectDialogOpen(false);
        setRejectReason("");
      } else {
        toast.showError("Échec", r.error.userMessage);
      }
    } finally {
      setBusy(false);
    }
  }

  async function disburse() {
    if (!session) return;
    setBusy(true);
    try {
      const r = await repos.expenses.disburse(expense!.id, session.userId);
      if (r.ok) {
        toast.showSuccess("Fonds décaissés");
        setDisburseDialogOpen(false);
      } else {
        toast.showError("Échec", r.error.userMessage);
      }
    } finally {
      setBusy(false);
    }
  }

  async function settleProof() {
    if (!session || !proofFileName) {
      toast.showWarning("Justificatif requis", "Téléversez un justificatif avant de clôturer.");
      return;
    }
    setBusy(true);
    try {
      const r = await repos.expenses.settleProof(expense!.id, `mock://proof/${proofFileName}`, session.userId);
      if (r.ok) {
        toast.showSuccess("Dépense justifiée et clôturée");
        setProofDialogOpen(false);
        setProofFileName(null);
      } else {
        toast.showError("Échec", r.error.userMessage);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <UnifiedModal
        open={open}
        onOpenChange={onOpenChange}
        variant="drawer"
        size="lg"
        icon={Receipt}
        iconTone="primary"
        title={
          <span className="flex items-center gap-2">
            <span className="truncate">{expense.title}</span>
            <code className="text-xs font-mono text-muted-foreground">{expense.requestCode}</code>
          </span>
        }
        description={`${EXPENSE_CATEGORY_LABELS_FR[expense.category]} · ${expense.payee}`}
        hideFooter={expense.status === "settled" || expense.status === "rejected" || !((expense.status === "submitted" && canApprove) || (expense.status === "approved" && canDisburse) || (expense.status === "disbursed" && canSettle))}
        footer={
          <>
            {expense.status === "submitted" && canApprove && (
              <>
                <Button onClick={approve} disabled={busy}>
                  <CheckCircle2 className="h-4 w-4" />
                  Approuver
                </Button>
                <Button variant="outline" onClick={() => setRejectDialogOpen(true)}>
                  <XCircle className="h-4 w-4" /> Rejeter
                </Button>
              </>
            )}
            {expense.status === "approved" && canDisburse && (
              <Button onClick={() => setDisburseDialogOpen(true)} disabled={busy}>
                <DollarSign className="h-4 w-4" /> Décaisser les fonds
              </Button>
            )}
            {expense.status === "disbursed" && canSettle && (
              <Button onClick={() => setProofDialogOpen(true)} disabled={busy}>
                <Upload className="h-4 w-4" /> Téléverser justificatif
              </Button>
            )}
            {(expense.status === "settled" || expense.status === "rejected") && (
              <span className="text-xs text-muted-foreground text-center py-2 ml-auto">
                {expense.status === "settled" ? "Dépense clôturée et justifiée." : "Dépense rejetée."}
              </span>
            )}
          </>
        }
      >
        <div className="space-y-5">
          {/* Anomaly banner — clickable to open the AnomalyExplainerModal (plan §11.07) */}
          {hasAnomaly && (
            <button
              type="button"
              onClick={() => setAnomalyOpen(true)}
              className="w-full text-left rounded-md border border-status-danger/40 bg-status-danger/10 p-3 flex items-start gap-2 transition-colors hover:bg-status-danger/15 cursor-pointer"
              title="Cliquer pour voir l'explication de l'anomalie"
            >
              <AlertTriangle className="h-4 w-4 text-status-danger shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-status-danger">Anomalie détectée — cliquer pour l'explication</p>
                <p className="text-xs text-muted-foreground mt-0.5">{expense.anomalyNote}</p>
                <p className="text-[10px] text-muted-foreground mt-1 italic">
                  Signal — l'humain décide toujours (plan §11).
                </p>
              </div>
            </button>
          )}

          {/* Header card */}
          <div className="rounded-md border border-border p-3 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Montant</span>
              <span className="font-mono font-semibold text-base">{formatDzd(expense.amount)}</span>
            </div>
            {expense.description && (
              <div>
                <p className="text-[10px] uppercase text-muted-foreground">Description</p>
                <p className="text-foreground">{expense.description}</p>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Demandeur</span>
              <span>{expense.submittedBy}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Soumise</span>
              <span>{formatRelative(expense.submittedAt)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Statut</span>
              <StatusChip
                label={EXPENSE_STATUS_LABELS_FR[expense.status]}
                tone={
                  expense.status === "settled"
                    ? "success"
                    : expense.status === "approved"
                      ? "info"
                      : expense.status === "disbursed"
                        ? "warning"
                        : expense.status === "rejected"
                          ? "danger"
                          : "warning"
                }
              />
            </div>
          </div>

          <Separator />

          {/* Timeline */}
          <section>
            <p className="text-xs font-semibold uppercase text-muted-foreground mb-3">
              Cycle d'approbation
            </p>
            <ol className="space-y-3">
              {STAGE_ORDER.map((stage, idx) => {
                const isPast = !isRejected && idx < currentStageIdx;
                const isCurrent = !isRejected && idx === currentStageIdx;
                const isFuture = !isRejected && idx > currentStageIdx;
                const isRejectStage = isRejected && idx === 0;
                return (
                  <li key={stage} className="flex items-start gap-3">
                    <div className="flex flex-col items-center">
                      <div
                        className={`flex h-7 w-7 items-center justify-center rounded-full border-2 ${
                          isPast
                            ? "border-status-success bg-status-success/15 text-status-success"
                            : isCurrent
                              ? "border-primary bg-primary/15 text-primary"
                              : isRejectStage
                                ? "border-status-danger bg-status-danger/15 text-status-danger"
                                : "border-border text-muted-foreground"
                        }`}
                      >
                        {isPast ? (
                          <CheckCircle2 className="h-4 w-4" />
                        ) : isRejectStage ? (
                          <XCircle className="h-4 w-4" />
                        ) : (
                          <span className="text-xs font-bold">{idx + 1}</span>
                        )}
                      </div>
                      {idx < STAGE_ORDER.length - 1 && (
                        <div className={`w-px h-6 mt-1 ${isPast ? "bg-status-success" : "bg-border"}`} />
                      )}
                    </div>
                    <div className="flex-1 min-w-0 pt-0.5">
                      <p className={`text-sm font-medium ${isFuture ? "text-muted-foreground" : "text-foreground"}`}>
                        {EXPENSE_STATUS_LABELS_FR[stage]}
                      </p>
                      {stage === "submitted" && (
                        <p className="text-[11px] text-muted-foreground">
                          {formatDateTime(expense.submittedAt)} · {expense.submittedBy}
                        </p>
                      )}
                      {stage === "approved" && expense.approvedAt && (
                        <p className="text-[11px] text-muted-foreground">
                          {formatDateTime(expense.approvedAt)} · {expense.approvedBy}
                          {expense.approvalNote && ` — "${expense.approvalNote}"`}
                        </p>
                      )}
                      {stage === "disbursed" && expense.disbursedAt && (
                        <p className="text-[11px] text-muted-foreground">
                          {formatDateTime(expense.disbursedAt)} · {expense.disbursedBy}
                        </p>
                      )}
                      {stage === "settled" && expense.proofUploadedAt && (
                        <p className="text-[11px] text-muted-foreground">
                          {formatDateTime(expense.proofUploadedAt)} · {expense.proofUploadedBy}
                        </p>
                      )}
                      {isRejectStage && expense.approvalNote && (
                        <p className="text-[11px] text-status-danger">
                          Motif: {expense.approvalNote}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>

          {/* Proof image (if settled) */}
          {expense.proofUrl && (
            <section>
              <p className="text-xs font-semibold uppercase text-muted-foreground mb-2">
                Justificatif
              </p>
              <div className="rounded-md border border-border p-3 text-center">
                <img
                  src={expense.proofUrl}
                  alt="Justificatif"
                  className="max-h-32 mx-auto rounded"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
                <p className="text-[10px] text-muted-foreground mt-1 font-mono">{expense.proofUrl}</p>
              </div>
            </section>
          )}
        </div>
      </UnifiedModal>

      {/* Reject dialog — UnifiedModal with destructive submit */}
      <UnifiedModal
        open={rejectDialogOpen}
        onOpenChange={setRejectDialogOpen}
        variant="dialog"
        size="sm"
        icon={XCircle}
        iconTone="danger"
        title="Rejeter la dépense"
        description="Le motif est obligatoire et sera tracé dans l'audit."
        submitLabel="Confirmer le rejet"
        submitVariant="destructive"
        submitIcon={XCircle}
        submitDisabled={!rejectReason.trim()}
        submitLoading={busy}
        onSubmit={reject}
      >
        <FormField label="Motif du rejet" required>
          <Textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Justificatif manquant, montant excessif…"
            rows={3}
          />
        </FormField>
      </UnifiedModal>

      {/* Disburse confirm — ConfirmDialog (wraps UnifiedModal) */}
      <ConfirmDialog
        open={disburseDialogOpen}
        onOpenChange={setDisburseDialogOpen}
        title="Décaisser les fonds ?"
        description={`Les fonds (${formatDzd(expense.amount)}) seront libérés au bénéficiaire "${expense.payee}". Action tracée dans l'audit.`}
        confirmLabel="Décaisser"
        onConfirm={disburse}
      />

      {/* Settle proof dialog — UnifiedModal with file upload */}
      <UnifiedModal
        open={proofDialogOpen}
        onOpenChange={setProofDialogOpen}
        variant="dialog"
        size="sm"
        icon={Upload}
        iconTone="primary"
        title="Téléverser le justificatif"
        description="Le justificatif (reçu/facture) est OBLIGATOIRE avant clôture (plan §08)."
        submitLabel="Justifier et clôturer"
        submitIcon={CheckCircle2}
        submitDisabled={!proofFileName}
        submitLoading={busy}
        onSubmit={settleProof}
      >
        <FormField label="Fichier justificatif" required>
          <label className="flex items-center gap-2 rounded-md border border-dashed border-border p-3 cursor-pointer hover:bg-accent/5">
            <Upload className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">
              {proofFileName ?? "Téléverser un justificatif (image/PDF)"}
            </span>
            <input
              type="file"
              accept="image/*,.pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) setProofFileName(f.name);
              }}
            />
          </label>
        </FormField>
      </UnifiedModal>

      {/* Anomaly explainer modal — opens when the anomaly banner is clicked */}
      <AnomalyExplainerModal
        expenseId={expenseId}
        open={anomalyOpen}
        onOpenChange={setAnomalyOpen}
      />
    </>
  );
}
