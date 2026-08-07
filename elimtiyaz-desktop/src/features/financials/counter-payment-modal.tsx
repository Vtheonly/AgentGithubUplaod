/**
 * CounterPaymentModal — counter payment workflow (plan §07).
 *
 * Steps:
 *   1. Searchable parent picker
 *   2. Student picker (filtered by parent) — optional
 *   3. Amount + category + method (Espèces/Chèque/Virement)
 *   4. Installment auto-suggest (oldest unpaid matching category)
 *   5. Proof capture (mock file picker; MANDATORY for Check/Transfer per §18.03)
 *   6. Submit → receipt preview with "Partager le reçu"
 *
 * Per plan: non-cash methods REQUIRE proof scan before submission.
 * Initial status: cash → paid, check/transfer → pending (bank clearance).
 *
 * Iteration 3: refactored to use UnifiedModal. The "form" and "success"
 * stages are now rendered inside the UnifiedModal body. The footer is
 * custom so we can swap "Encaisser" / "Terminer + Partager" depending
 * on the stage.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Search, Loader2, CheckCircle2, Share2, X, Upload, Wallet,
} from "lucide-react";
import { useRepositories } from "../../app/providers/repository-provider";
import { useToast } from "../../app/providers/toast-provider";
import { useAuth } from "../../app/providers/auth-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import { useDebounce } from "../../shared/hooks/use-debounce";
import { UnifiedModal, type UnifiedModalProps } from "../../shared/ui/unified-modal";
import { Button } from "../../shared/ui/button";
import { Input } from "../../shared/ui/input";
import { FormField } from "../../shared/ui/form-field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../shared/ui/select";
import { Separator } from "../../shared/ui/separator";
import { StatusChip } from "../../shared/ui/status-chip";
import { formatDzd } from "../../core/format/currency";
import { formatDateTime, formatDate } from "../../core/format/date";
import {
  PAYMENT_METHOD_LABELS_FR,
  PAYMENT_CATEGORY_LABELS_FR,
  PAYMENT_STATUS_LABELS_FR,
  type PaymentMethod,
  type PaymentCategory,
  type Payment,
  proofRequiredFor,
} from "../../domain/model/payment";
import type { Parent } from "../../domain/model/parent";
import {
  allocatePaymentToInstallments,
  currentTrancheLabel,
} from "../../domain/calc/payment/installments";
import { PaymentSlider, type PaymentTrancheSpec } from "./payment-slider";
import { DebtMeter } from "./debt-meter";

/** Compact date label for the slider's tranche strip (e.g. "15 déc."). */
function formatDateShort(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  } catch {
    return iso;
  }
}

type Stage = "form" | "success";
type Alert = NonNullable<UnifiedModalProps["alert"]>;

export function CounterPaymentModal({
  open,
  onOpenChange,
  presetParentId,
  presetStudentId,
  presetCategory,
  presetAmount,
  presetInstallmentId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  presetParentId?: string | null;
  presetStudentId?: string | null;
  presetCategory?: PaymentCategory | null;
  presetAmount?: number | null;
  presetInstallmentId?: string | null;
}) {
  const repos = useRepositories();
  const toast = useToast();
  const { session } = useAuth();

  const [stage, setStage] = useState<Stage>("form");
  const [parentQuery, setParentQuery] = useState("");
  const debouncedQuery = useDebounce(parentQuery, 220);
  const [parentResults, setParentResults] = useState<Parent[]>([]);
  const [searching, setSearching] = useState(false);

  const [selectedParentId, setSelectedParentId] = useState<string | null>(presetParentId ?? null);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(presetStudentId ?? null);
  const [amount, setAmount] = useState<number>(presetAmount ?? 0);
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [category, setCategory] = useState<PaymentCategory>(presetCategory ?? "tuition");
  // `installmentId` is intentionally NOT used as state anymore — the
  // waterfall allocator distributes payments across all eligible unpaid
  // installments automatically. The `presetInstallmentId` prop is kept
  // for backwards compatibility with callers that pre-select a tranche,
  // but we no longer constrain the payment to a single tranche.
  const [proofFileName, setProofFileName] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [receiptPayment, setReceiptPayment] = useState<Payment | null>(null);
  const [alert, setAlert] = useState<Alert | null>(null);

  const parents = useObservable(() => repos.parents.observe(), []);
  const students = useObservable(
    () => repos.students.observeByParent(selectedParentId ?? ""),
    [selectedParentId],
  );
  const installments = useObservable(
    () => repos.installments.observeByParent(selectedParentId ?? ""),
    [selectedParentId],
  );

  // Reset on close
  useEffect(() => {
    if (!open) {
      setTimeout(() => {
        setStage("form");
        setParentQuery("");
        setSelectedParentId(null);
        setSelectedStudentId(null);
        setAmount(0);
        setMethod("cash");
        setCategory("tuition");
        setProofFileName(null);
        setNotes("");
        setReceiptPayment(null);
        setAlert(null);
      }, 200);
    }
  }, [open]);

  // Apply presets when opening
  useEffect(() => {
    if (open) {
      if (presetParentId) setSelectedParentId(presetParentId);
      if (presetStudentId) setSelectedStudentId(presetStudentId);
      if (presetAmount) setAmount(presetAmount);
      if (presetCategory) setCategory(presetCategory);
      // `presetInstallmentId` is intentionally ignored — the waterfall
      // allocator will distribute the payment across all eligible
      // unpaid installments automatically.
    }
  }, [open, presetParentId, presetStudentId, presetAmount, presetCategory, presetInstallmentId]);

  // Search parents
  useEffect(() => {
    if (!open) return;
    const q = debouncedQuery.trim();
    if (!q) {
      setParentResults([]);
      return;
    }
    setSearching(true);
    void (async () => {
      const r = await repos.parents.search(q);
      if (r.ok) setParentResults(r.value.slice(0, 8));
      setSearching(false);
    })();
  }, [debouncedQuery, open, repos.parents]);

  // Auto-suggest oldest unpaid installment matching category (plan §07.03).
  // We no longer force a single installmentId — the waterfall allocator will
  // distribute the payment across all eligible unpaid installments. We still
  // auto-prefill the amount to "complete the oldest unpaid tranche" when no
  // preset was supplied.
  useEffect(() => {
    if (presetAmount) return; // operator provided an explicit amount
    if (category !== "tuition" && category !== "transport") return;
    const matching = installments
      .filter((i) => i.category === category && i.status !== "paid")
      .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
    if (matching.length > 0 && amount === 0) {
      setAmount(matching[0].amountDue - matching[0].amountPaid);
    }
  }, [installments, category, amount, presetAmount]);

  // Build the tranche specs for the slider (category-filtered installments,
  // sorted oldest-first, max 3 tranches shown for visual clarity).
  const sliderTranches = useMemo<PaymentTrancheSpec[]>(() => {
    const eligible = installments
      .filter((i) => i.status !== "paid")
      .filter((i) => category === "tuition" || category === "transport" ? i.category === category : true)
      .slice()
      .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
      .slice(0, 6); // cap at 6 visible tranches (2 cycles max)
    return eligible.map((i) => ({
      id: i.id,
      label: i.label,
      dueWindowLabel: formatDateShort(i.dueDate),
      amountDue: i.amountDue,
      amountPaid: i.amountPaid,
    }));
  }, [installments, category]);

  // Compute the totals needed by the DebtMeter.
  const totalDue = useMemo(
    () => sliderTranches.reduce((s, t) => s + t.amountDue, 0),
    [sliderTranches],
  );
  const alreadyPaid = useMemo(
    () => sliderTranches.reduce((s, t) => s + Math.min(t.amountPaid, t.amountDue), 0),
    [sliderTranches],
  );

  // Pre-compute the waterfall allocation plan for the live preview.
  const allocationPreview = useMemo(() => {
    if (!selectedParentId) return null;
    const eligible = installments
      .filter((i) => i.status !== "paid")
      .filter((i) => category === "tuition" || category === "transport" ? i.category === category : true);
    return allocatePaymentToInstallments(eligible, amount, category === "tuition" || category === "transport" ? category : undefined);
  }, [installments, amount, category, selectedParentId]);

  const overpayingNow = allocationPreview ? allocationPreview.unallocatedAmount > 0.5 : false;
  const focusedTrancheLabelFromCalc = useMemo(
    () => {
      if (!selectedParentId) return null;
      const eligible = installments
        .filter((i) => i.status !== "paid")
        .filter((i) => category === "tuition" || category === "transport" ? i.category === category : true);
      return currentTrancheLabel(eligible, category === "tuition" || category === "transport" ? category : undefined);
    },
    [installments, category, selectedParentId],
  );

  const selectedParent = parents.find((p) => p.id === selectedParentId);
  const proofRequired = proofRequiredFor(method);
  const canSubmit =
    !!selectedParentId &&
    amount > 0 &&
    (!proofRequired || !!proofFileName) &&
    !!session;

  async function submit() {
    if (!session || !selectedParentId) return;
    if (proofRequired && !proofFileName) {
      setAlert({
        tone: "warning",
        title: "Justificatif requis",
        description: "Chèque et virement nécessitent un justificatif (plan §18.03).",
      });
      return;
    }
    setSubmitting(true);
    try {
      // 1. Collect the payment — creates Payment row + canonical Ledger entry.
      const result = await repos.payments.collect(
        {
          parentId: selectedParentId,
          studentId: selectedStudentId,
          amount,
          method,
          category,
          // installmentId stays null — the waterfall allocator handles linking.
          installmentId: null,
          proofUrl: proofFileName ? `mock://proof/${proofFileName}` : null,
          notes: notes.trim() || null,
        },
        session.userId,
      );
      if (result.ok) {
        // 2. Waterfall Allocation — distribute the payment across all eligible
        //    unpaid installments (oldest first). Guarantees Ledger ↔ Installment
        //    consistency.
        const categoryFilter = category === "tuition" || category === "transport" ? category : undefined;
        const allocResult = await repos.installments.allocatePayment(
          selectedParentId,
          amount,
          result.value.id,
          categoryFilter,
          session.userId,
          session.displayName ?? "Session courante",
        );
        if (allocResult.ok) {
          const plan = allocResult.value;
          const trancheCount = plan.allocations.length;
          const credit = plan.unallocatedAmount;
          if (credit > 0.5) {
            toast.showWarning(
              "Paiement encaissé (avec excédent)",
              `Alloué à ${trancheCount} tranche(s). Crédit parent : ${formatDzd(credit)}.`,
            );
          } else {
            toast.showSuccess(
              "Paiement encaissé",
              `Alloué à ${trancheCount} tranche(s) via water­fall. Reçu ${result.value.receiptNumber}.`,
            );
          }
        } else {
          toast.showWarning(
            "Paiement encaissé (allocation échouée)",
            "Le paiement a été enregistré au ledger mais l'allocation automatique a échoué. Vérifiez les tranches manuellement.",
          );
        }
        // 3. Auto-generate receipt.
        const receipt = await repos.payments.generateReceipt(result.value.id, session.userId);
        if (!receipt.ok) {
          toast.showWarning("Paiement encaissé", "La génération du reçu a échoué.");
        }
        setReceiptPayment(result.value);
        setStage("success");
      } else {
        setAlert({
          tone: "error",
          title: "Échec de l'encaissement",
          description: result.error.userMessage,
        });
      }
    } finally {
      setSubmitting(false);
    }
  }

  // Custom footer — different per stage
  const footerNode = stage === "form" ? (
    <>
      <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
        Annuler
      </Button>
      <Button onClick={submit} disabled={!canSubmit || submitting}>
        {submitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Encaissement…
          </>
        ) : (
          <>Encaisser {formatDzd(amount)}</>
        )}
      </Button>
    </>
  ) : (
    <>
      <Button variant="outline" onClick={() => onOpenChange(false)}>
        Terminer
      </Button>
      <Button onClick={() => onOpenChange(false)}>
        <Share2 className="h-4 w-4" /> Partager le reçu
      </Button>
    </>
  );

  return (
    <UnifiedModal
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      variant="dialog"
      icon={Wallet}
      iconTone="success"
      title={stage === "form" ? "Encaissement" : "Paiement encaissé"}
      description={
        stage === "form"
          ? "Encaissement comptable — reçu généré automatiquement (plan §07.05)."
          : "Reçu généré automatiquement — prêt à partager."
      }
      alert={alert}
      onDismissAlert={() => setAlert(null)}
      footer={footerNode}
      hideFooter={false}
    >
      {stage === "form" && (
        <div className="space-y-4">
          {/* Parent picker */}
          {!selectedParent ? (
            <FormField label="Parent" required>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  autoFocus
                  value={parentQuery}
                  onChange={(e) => setParentQuery(e.target.value)}
                  placeholder="Rechercher par nom, téléphone, code…"
                  className="pl-9"
                />
              </div>
              {searching && (
                <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" /> Recherche…
                </p>
              )}
              {parentResults.length > 0 && (
                <ul className="mt-2 rounded-md border border-border max-h-48 overflow-y-auto">
                  {parentResults.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedParentId(p.id);
                          setParentQuery("");
                          setParentResults([]);
                        }}
                        className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-accent/5"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {p.firstName} {p.lastName}
                          </p>
                          <p className="text-[11px] text-muted-foreground font-mono">{p.code}</p>
                        </div>
                        <span className="text-xs text-muted-foreground">{p.phone}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </FormField>
          ) : (
            <div className="rounded-md border border-border p-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">
                  {selectedParent.firstName} {selectedParent.lastName}
                </p>
                <p className="text-xs text-muted-foreground font-mono">{selectedParent.code}</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => {
                  setSelectedParentId(null);
                  setSelectedStudentId(null);
                  setAmount(0);
                }}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}

          {/* Student picker */}
          {selectedParent && students.length > 0 && (
            <FormField label="Élève (optionnel)">
              <Select
                value={selectedStudentId ?? "__none__"}
                onValueChange={(v) => setSelectedStudentId(v === "__none__" ? null : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Aucun élève particulier" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Aucun —</SelectItem>
                  {students.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.firstName} {s.lastName} · {s.code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          )}

          {/* Category + method */}
          <div className="grid gap-3 md:grid-cols-2">
            <FormField label="Catégorie" required>
              <Select value={category} onValueChange={(v) => setCategory(v as PaymentCategory)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PAYMENT_CATEGORY_LABELS_FR).map(([k, label]) => (
                    <SelectItem key={k} value={k}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Méthode" required>
              <div className="grid grid-cols-3 gap-2 h-10">
                {(["cash", "check", "transfer"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMethod(m)}
                    className={`rounded-md border px-2 text-center text-xs transition-colors ${
                      method === m
                        ? "border-primary bg-primary/10 text-primary font-medium"
                        : "border-border hover:border-primary/50"
                    }`}
                  >
                    {PAYMENT_METHOD_LABELS_FR[m]}
                  </button>
                ))}
              </div>
            </FormField>
          </div>

          {/* === Interactive Payment Slider === */}
          {selectedParent && sliderTranches.length > 0 && (
            <PaymentSlider
              tranches={sliderTranches}
              value={amount}
              onChange={setAmount}
              disabled={submitting}
            />
          )}
          {selectedParent && sliderTranches.length === 0 && (
            <div className="rounded-md border border-status-success/40 bg-status-success/5 p-3 text-xs text-status-success">
              ✓ Aucune tranche impayée pour cette catégorie — le paiement sera enregistré comme crédit parent.
            </div>
          )}

          {/* === Debt Meter === */}
          {selectedParent && (
            <DebtMeter
              totalDue={totalDue}
              alreadyPaid={alreadyPaid}
              payingNow={amount}
              currentTrancheLabel={focusedTrancheLabelFromCalc}
              statusNote={
                allocationPreview && allocationPreview.allocations.length > 0
                  ? `Sera alloué à ${allocationPreview.allocations.length} tranche(s) — waterfall chronologique.`
                  : overpayingNow
                    ? "Excédent — sera stocké comme crédit parent (avance)."
                    : null
              }
            />
          )}

          {/* Proof capture (mandatory for check/transfer) */}
          {proofRequired && (
            <FormField
              label="Justificatif (scan)"
              required
              error={!proofFileName ? "Obligatoire pour chèque et virement (plan §18.03)" : undefined}
            >
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
              {proofFileName && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-1 text-xs"
                  onClick={() => setProofFileName(null)}
                >
                  Retirer
                </Button>
              )}
            </FormField>
          )}

          {/* Notes */}
          <FormField label="Notes / Remarques" hint="Obligatoires pour chèque/virement en attente">
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={method !== "cash" ? "Chèque en attente de compensation" : "Notes internes (optionnel)"}
            />
          </FormField>

          <Separator />

          {/* Status preview */}
          <div className="rounded-md border border-border p-3 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Statut initial</span>
              <StatusChip
                label={PAYMENT_STATUS_LABELS_FR[method === "cash" ? "paid" : "pending"]}
                tone={method === "cash" ? "success" : "warning"}
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              {method === "cash"
                ? "Espèces → statut Payé immédiatement."
                : "Chèque/Virement → statut En attente jusqu'à compensation bancaire."}
            </p>
          </div>
        </div>
      )}

      {stage === "success" && receiptPayment && (
        <div className="space-y-3">
          <div className="rounded-md border border-status-success/40 bg-status-success/5 p-4 space-y-2">
            <div className="flex items-center gap-2 text-status-success font-medium">
              <CheckCircle2 className="h-4 w-4" />
              Paiement encaissé avec succès
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Reçu</span>
              <span className="font-mono font-semibold">{receiptPayment.receiptNumber}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Montant</span>
              <span className="font-mono font-bold text-base">{formatDzd(receiptPayment.amount)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Méthode</span>
              <span>{PAYMENT_METHOD_LABELS_FR[receiptPayment.method]}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Catégorie</span>
              <span>{PAYMENT_CATEGORY_LABELS_FR[receiptPayment.category]}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Date</span>
              <span>{formatDateTime(receiptPayment.collectedAt)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Statut</span>
              <StatusChip
                label={PAYMENT_STATUS_LABELS_FR[receiptPayment.status]}
                tone={receiptPayment.status === "paid" ? "success" : "warning"}
              />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground text-center">
            Le reçu PDF complet sera disponible dans l'onglet Reçus.
          </p>
        </div>
      )}
    </UnifiedModal>
  );
}
