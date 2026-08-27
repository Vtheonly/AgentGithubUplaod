/**
 * ExpenseDetailDrawer — slide-over with the two-tier workflow timeline.
 *
 * Plan §08:
 *   Draft → Submitted → Approved/Rejected → Disbursed → Settled (with proof)
 *
 * Refactored to consume `<EntityDetailDrawer<Expense>>` so the drawer chrome,
 * metadata grid, tab body, and sticky action bar all flow through the shared
 * primitive. The reject confirmation uses `<ConfirmModal>` with a MANDATORY
 * reason input (vault §08.03 — "requester is notified with the rejection
 * reason"). The disburse step uses `<ConfirmModal>` too (one-click action
 * that benefits from explicit confirmation).
 *
 * VAULT §08.05 (Tier 3) — the proof step is a REAL file upload (file picker,
 * image/PDF, read to a data URL in mock mode with a size cap) AND captures
 * the actual final spent amount; the financial officer can compare it against
 * the disbursed amount before the ticket closes. A variance banner highlights
 * over/under-spending when the final amount differs from the request.
 *
 * Anomaly badge renders when anomalyScore > 0.7 (signal, not verdict —
 * human always decides).
 */
import { useState } from "react";
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
import { UnifiedModal } from "../../shared/ui/unified-modal";
import { StatusChip } from "../../shared/ui/status-chip";
import { MoneyInput } from "../../shared/ui/money-input";
import { FormField } from "../../shared/ui/form-field";
import { formatDzd, formatDzdPlain } from "../../core/format/currency";
import { formatRelative, formatDateTime } from "../../core/format/date";
import {
  EXPENSE_STATUS_LABELS_FR,
  EXPENSE_CATEGORY_LABELS_FR,
  EXPENSE_URGENCY_LABELS_FR,
  type Expense,
  type ExpenseStatus,
} from "../../domain/model/expense";
import { Permission } from "../../core/rbac/permissions";
import { AnomalyExplainerModal } from "./anomaly-explainer-modal";

const STAGE_ORDER: ExpenseStatus[] = ["submitted", "approved", "disbursed", "settled"];

/** Max proof file size kept in memory as a data URL (mock vault). */
const MAX_PROOF_BYTES = 2 * 1024 * 1024;

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
  const [rejectReason, setRejectReason] = useState("");
  const [disburseOpen, setDisburseOpen] = useState(false);
  const [proofOpen, setProofOpen] = useState(false);
  const [anomalyOpen, setAnomalyOpen] = useState(false);
  // Proof upload state (real file → data URL in mock mode).
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofDataUrl, setProofDataUrl] = useState<string | null>(null);
  const [proofError, setProofError] = useState<string | null>(null);
  const [finalSpent, setFinalSpent] = useState<number>(0);
  const [settling, setSettling] = useState(false);

  if (!expense) return null;

  const canApprove = !!session && session.permissions.has(Permission.ApproveExpense) && session.userId !== expense.submittedBy;
  const canDisburse = !!session && session.permissions.has(Permission.DisburseExpense);
  const canSettle = !!session && session.permissions.has(Permission.SettleExpenseProof);
  const hasAnomaly = (expense.anomalyScore ?? 0) > 0.7;
  const currentStageIdx = STAGE_ORDER.indexOf(expense.status);

  async function handleApprove() {
    if (!session) return;
    const r = await repos.expenses.approve(expense!.id, session.userId, "Approuvé");
    if (r.ok) toast.showSuccess("Dépense approuvée", "Le demandeur a été notifié de la décision.");
    else toast.showError("Échec", r.error.userMessage);
  }

  async function handleReject() {
    if (!session) return;
    const reason = rejectReason.trim();
    if (!reason) {
      toast.showWarning("Motif requis", "Le motif du rejet est obligatoire — il sera communiqué au demandeur.");
      return;
    }
    const r = await repos.expenses.reject(expense!.id, session.userId, reason);
    if (r.ok) {
      toast.showSuccess("Dépense rejetée", "Le demandeur a été notifié avec le motif du rejet.");
      setRejectOpen(false);
      setRejectReason("");
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

  function handleProofFileSelected(file: File | null) {
    setProofError(null);
    setProofDataUrl(null);
    setProofFile(file);
    if (!file) return;
    if (file.size > MAX_PROOF_BYTES) {
      setProofError(`Fichier trop volumineux (${(file.size / 1024 / 1024).toFixed(1)} Mo) — maximum 2 Mo pour l'aperçu. Sélectionnez un fichier plus léger.`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setProofDataUrl(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => setProofError("Échec de lecture du fichier.");
    reader.readAsDataURL(file);
  }

  async function handleSettleProof() {
    if (!session) return;
    if (!proofFile) {
      setProofError("Le justificatif (reçu) est obligatoire pour clôturer la dépense.");
      return;
    }
    setSettling(true);
    try {
      // Mock mode stores the proof as a data URL (with a mock://-style marker
      // for small files, or the data URL directly when previewable). In
      // Supabase mode this would upload to the private `expense-receipts`
      // bucket and store the signed path.
      const proofUrl = proofDataUrl ?? `mock://proof/${proofFile.name}`;
      const r = await repos.expenses.settleProof(
        expense!.id,
        proofUrl,
        session.userId,
        finalSpent > 0 ? finalSpent : undefined,
      );
      if (r.ok) {
        toast.showSuccess(
          "Dépense justifiée et clôturée",
          finalSpent > 0
            ? `Reçu enregistré. Montant final dépensé : ${formatDzdPlain(finalSpent)}.`
            : "Reçu enregistré.",
        );
        setProofOpen(false);
        setProofFile(null);
        setProofDataUrl(null);
        setFinalSpent(0);
      } else {
        toast.showError("Échec", r.error.userMessage);
      }
    } finally {
      setSettling(false);
    }
  }

  const metadata = (e: Expense): readonly EntityDrawerMetaItem[] => [
    { label: "Montant demandé", value: formatDzd(e.amount) },
    { label: "Catégorie", value: EXPENSE_CATEGORY_LABELS_FR[e.category] },
    { label: "Urgence", value: EXPENSE_URGENCY_LABELS_FR[e.urgency] },
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
                <AlertTriangle className="size-4" /> Anomalie détectée
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

          {/* VAULT §08.05 — proof + final spent amount summary once settled */}
          {e.status === "settled" && (
            <div className="rounded-md border border-status-success/30 bg-status-success/5 p-3 space-y-1.5">
              <p className="text-xs font-medium text-status-success">Dépense clôturée avec justificatif</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <span className="text-muted-foreground">Montant demandé</span>
                <span className="font-mono text-right">{formatDzdPlain(e.amount)}</span>
                {e.finalSpentAmount !== null && (
                  <>
                    <span className="text-muted-foreground">Montant final dépensé</span>
                    <span className="font-mono text-right">{formatDzdPlain(e.finalSpentAmount)}</span>
                    <span className="text-muted-foreground">Écart</span>
                    <span
                      className={`font-mono text-right ${
                        Math.abs(e.finalSpentAmount - e.amount) < 0.5
                          ? "text-status-success"
                          : "text-status-warning"
                      }`}
                    >
                      {e.finalSpentAmount - e.amount > 0 ? "+" : ""}
                      {formatDzdPlain(e.finalSpentAmount - e.amount)}
                    </span>
                  </>
                )}
                <span className="text-muted-foreground">Justificatif</span>
                <span className="text-right break-all">{e.proofUrl ? "Fourni" : "—"}</span>
              </div>
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
        subtitle={(e) => `${e.requestCode} · ${EXPENSE_CATEGORY_LABELS_FR[e.category]} · Urgence ${EXPENSE_URGENCY_LABELS_FR[e.urgency]}`}
        metadata={metadata}
        tabs={tabs}
        actions={actions}
      />

      <ConfirmModal
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        title="Rejeter la dépense"
        description={
          <div className="space-y-2">
            <p>
              Confirmez-vous le rejet de cette demande de fonds ? Le demandeur sera notifié
              avec le motif du rejet.
            </p>
            <label className="block space-y-1">
              <span className="text-xs font-medium">Motif du rejet (obligatoire) :</span>
              <input
                value={rejectReason}
                onChange={(ev) => setRejectReason(ev.target.value)}
                placeholder="ex. Justificatif manquant — reformulez la demande"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
            </label>
          </div>
        }
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

      {/* VAULT §08.05 — proof upload with REAL file picker + final spent amount */}
      <UnifiedModal
        open={proofOpen}
        onOpenChange={setProofOpen}
        variant="dialog"
        size="md"
        icon={Upload}
        iconTone="primary"
        title="Justificatif et montant final"
        description="Téléversez le reçu du fournisseur et saisissez le montant réellement dépensé. L'officier financier vérifiera le reçu contre les fonds décaissés."
        submitLabel="Clôturer la dépense"
        submitIcon={CheckCircle2}
        onSubmit={handleSettleProof}
        submitDisabled={!proofFile || settling}
      >
        <div className="space-y-3">
          <FormField
            label="Reçu / justificatif"
            required
            error={proofError ?? undefined}
            hint="Image ou PDF — maximum 2 Mo"
          >
            <label className="flex items-center gap-2 rounded-md border border-dashed border-border p-3 cursor-pointer hover:bg-accent/5">
              <Upload className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground truncate">
                {proofFile ? `${proofFile.name} (${(proofFile.size / 1024).toFixed(0)} Ko)` : "Choisir un fichier (image / PDF)"}
              </span>
              <input
                type="file"
                accept="image/*,.pdf"
                className="hidden"
                onChange={(e) => handleProofFileSelected(e.target.files?.[0] ?? null)}
              />
            </label>
            {proofDataUrl && proofFile && proofFile.type.startsWith("image/") && (
              // eslint-disable-next-line jsx-a11y/img-redundant-alt -- proof preview
              <img
                src={proofDataUrl}
                alt="Aperçu du justificatif"
                className="mt-2 max-h-40 rounded-md border border-border object-contain"
              />
            )}
          </FormField>
          <FormField
            label="Montant final réellement dépensé (DZD)"
            hint="Peut différer du montant demandé — l'écart sera affiché pour vérification."
          >
            <MoneyInput value={finalSpent} onChange={setFinalSpent} />
          </FormField>
          {finalSpent > 0 && Math.abs(finalSpent - expense.amount) >= 0.5 && (
            <div
              className={`rounded-md border p-2 text-xs ${
                finalSpent > expense.amount
                  ? "border-status-warning/40 bg-status-warning/10 text-status-warning"
                  : "border-status-success/40 bg-status-success/10 text-status-success"
              }`}
            >
              {finalSpent > expense.amount ? "Dépassement" : "Économie"} de{" "}
              {formatDzdPlain(Math.abs(finalSpent - expense.amount))} par rapport au montant
              décaissé ({formatDzdPlain(expense.amount)}).
            </div>
          )}
        </div>
      </UnifiedModal>

      <AnomalyExplainerModal
        expenseId={expense.id}
        open={anomalyOpen}
        onOpenChange={setAnomalyOpen}
      />
    </>
  );
}
