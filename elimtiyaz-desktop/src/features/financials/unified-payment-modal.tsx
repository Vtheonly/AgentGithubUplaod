/**
 * UnifiedPaymentModal — the single canonical payment experience for the
 * entire platform (Epic 5.3).
 *
 * Accepts a `PaymentNavigationContext` (defined in `domain/model/payment.ts`)
 * that encodes everything the modal needs to render and validate:
 *   - mode: single_item | installment_tranche | consolidated_debt | account_adjustment
 *   - parent / student references
 *   - line items with their gross/discount/net/already-paid/remaining breakdown
 *   - preset amount, overdue context, due-window label
 *   - allowPartial flag (single-item mode requires full settlement)
 *
 * Stage 1 — Payment Parameters & Allocation:
 *   1. Context header (parent + student + item title)
 *   2. Line-item / tranche summary card (gross, discounts, net, paid, remaining)
 *   3. AdaptivePaymentSlider + numeric input + quick-snap buttons
 *   4. Payment method (Cash / Check / Transfer) + proof capture
 *   5. UnifiedDebtMeter (3-color progress + dynamic status badge)
 *
 * Stage 2 — Receipt Preview & Export:
 *   - PDF receipt preview (pdf-lib)
 *   - Download PDF, WhatsApp share, Terminer
 *
 * Backward-compat: `CounterPaymentModal` is now a thin wrapper that adapts
 * the legacy preset props (`presetParentId`, `presetCategory`, etc.) into
 * a `PaymentNavigationContext` and forwards to `UnifiedPaymentModal`.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Loader2, CheckCircle2, Share2, X, Upload, Wallet, FileDown, MessageCircle,
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
import { Separator } from "../../shared/ui/separator";
import { StatusChip } from "../../shared/ui/status-chip";
import { formatDzd, formatDzdPlain } from "../../core/format/currency";
import { formatDateTime, formatDate } from "../../core/format/date";
import {
  PAYMENT_METHOD_LABELS_FR,
  PAYMENT_CATEGORY_LABELS_FR,
  PAYMENT_STATUS_LABELS_FR,
  type PaymentMethod,
  type PaymentCategory,
  type Payment,
  type PaymentNavigationContext,
  type PaymentLineItem,
  proofRequiredFor,
} from "../../domain/model/payment";
import type { Parent } from "../../domain/model/parent";
import { allocatePaymentToInstallments } from "../../domain/calc/payment/waterfall-allocator";
import { currentTrancheLabel } from "../../domain/calc/payment/queries";
import { displayParentCredit } from "../../domain/calc/ledger/balance";
import { PaymentSlider, type PaymentTrancheSpec, type PaymentSliderMode } from "./payment-slider";
import { DebtMeter } from "./debt-meter";
import { generatePaymentReceiptPdf } from "../../infrastructure/receipt-pdf/payment-receipt";
import { downloadPdf } from "../../infrastructure/receipt-pdf/download";
import { uploadPrivateMedia } from "../../infrastructure/storage/media-vault";

type Stage = "form" | "success";
type Alert = NonNullable<UnifiedModalProps["alert"]>;

/** Compact date label for the slider's tranche strip (e.g. "15 déc."). */
function formatDateShort(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  } catch {
    return iso;
  }
}

/** Convert a `PaymentLineItem` to a `PaymentTrancheSpec` for the slider. */
function lineItemToTrancheSpec(item: PaymentLineItem): PaymentTrancheSpec {
  return {
    id: item.itemId,
    label: item.label,
    dueWindowLabel: item.dueDate ? formatDateShort(item.dueDate) : (item.isOverdue ? "En retard" : "—"),
    amountDue: item.netAmount,
    amountPaid: item.alreadyPaidAmount,
  };
}

export interface UnifiedPaymentModalProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /**
   * The universal payment context. When `null`, the modal falls back to
   * counter-payment mode with an inline parent search (legacy behavior).
   */
  context: PaymentNavigationContext | null;
  /** Called after a payment is successfully collected (for refresh hooks). */
  onPaymentCollected?: (payment: Payment) => void;
}

export function UnifiedPaymentModal({
  open,
  onOpenChange,
  context,
  onPaymentCollected,
}: UnifiedPaymentModalProps) {
  const repos = useRepositories();
  const toast = useToast();
  const { session } = useAuth();

  const [stage, setStage] = useState<Stage>("form");
  // === Inline parent search (only used when context is null) ===
  const [parentQuery, setParentQuery] = useState("");
  const debouncedQuery = useDebounce(parentQuery, 220);
  const [parentResults, setParentResults] = useState<Parent[]>([]);
  const [searching, setSearching] = useState(false);
  const [fallbackParentId, setFallbackParentId] = useState<string | null>(null);
  const [fallbackStudentId, setFallbackStudentId] = useState<string | null>(null);

  // === Form state ===
  const [amount, setAmount] = useState<number>(0);
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [category, setCategory] = useState<PaymentCategory>("tuition");
  const [proofFileName, setProofFileName] = useState<string | null>(null);
  // VAULT §12.07 — proof uploads go through the private media vault
  // (signed-URL flow); `proofVaultPath` is the persisted storage path.
  const [proofVaultPath, setProofVaultPath] = useState<string | null>(null);
  const [proofUploading, setProofUploading] = useState(false);
  const [notes, setNotes] = useState("");
  // VAULT §07.01 — structured non-cash payment fields (mirrors the backend
  // `payments` columns from migration 0007).
  const [checkNumber, setCheckNumber] = useState("");
  const [checkBankName, setCheckBankName] = useState("");
  const [checkIssueDate, setCheckIssueDate] = useState("");
  const [checkClearanceDate, setCheckClearanceDate] = useState("");
  const [transferReference, setTransferReference] = useState("");
  const [transferSourceBank, setTransferSourceBank] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [receiptPayment, setReceiptPayment] = useState<Payment | null>(null);
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [alert, setAlert] = useState<Alert | null>(null);

  // === Derived from context (or fallback) ===
  const effectiveParentId = context?.parentId ?? fallbackParentId;
  const effectiveStudentId = context?.studentId ?? fallbackStudentId;
  const mode = context?.mode ?? "consolidated_debt";
  const allowPartial = context?.allowPartial ?? true;

  const parents = useObservable(() => repos.parents.observe(), []);
  const students = useObservable(
    () => repos.students.observeByParent(effectiveParentId ?? ""),
    [effectiveParentId],
  );
  const installments = useObservable(
    () => repos.installments.observeByParent(effectiveParentId ?? ""),
    [effectiveParentId],
  );
  // T-157 (ADR-010 residual): the debt meter's "Crédit parent disponible" row
  // was dormant — the `unallocatedCredit` prop was never passed at this call
  // site (ADR-010's implementation-map note). Wire it through the canonical
  // DISPLAY derivation: the raw ledger balance double-counts the credit for
  // canonical-path overpayments (DATA-009), so the value handed to the meter
  // MUST be `displayParentCredit(totalOutstanding, totalUnallocatedCredit)` —
  // never `-balance` or the raw unallocated Σ.
  const debtProfile = useObservable(
    () => repos.debt.observeParentProfile(effectiveParentId ?? ""),
    [effectiveParentId],
  );
  const bankedCredit = useMemo(
    () =>
      displayParentCredit(
        debtProfile?.totalOutstanding ?? 0,
        debtProfile?.totalUnallocatedCredit ?? 0,
      ),
    [debtProfile],
  );

  // === Reset on close ===
  useEffect(() => {
    if (!open) {
      const t = setTimeout(() => {
        setStage("form");
        setParentQuery("");
        setFallbackParentId(null);
        setFallbackStudentId(null);
        setAmount(0);
        setMethod("cash");
        setCategory("tuition");
        setProofFileName(null);
        setProofVaultPath(null);
        setNotes("");
        setCheckNumber("");
        setCheckBankName("");
        setCheckIssueDate("");
        setCheckClearanceDate("");
        setTransferReference("");
        setTransferSourceBank("");
        setReceiptPayment(null);
        setPdfBytes(null);
        setAlert(null);
      }, 200);
      return () => clearTimeout(t);
    }
  }, [open]);

  // === Apply context preset when opening ===
  useEffect(() => {
    if (!open) return;
    if (context) {
      if (context.presetAmount && context.presetAmount > 0) {
        setAmount(context.presetAmount);
      }
      // Derive category from the first line item, if available.
      if (context.lineItems.length > 0) {
        setCategory(context.lineItems[0].category);
      }
    }
  }, [open, context]);

  // === Inline parent search (fallback mode only) ===
  useEffect(() => {
    if (!open || context) return;
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
  }, [debouncedQuery, open, context, repos.parents]);

  // === Auto-suggest oldest unpaid installment amount when no preset (tuition/transport) ===
  useEffect(() => {
    if (!open) return;
    if (context?.presetAmount) return;
    if (category !== "tuition" && category !== "transport") return;
    const matching = installments
      .filter((i) => i.category === category && i.status !== "paid")
      .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
    if (matching.length > 0 && amount === 0) {
      setAmount(matching[0].amountDue - matching[0].amountPaid);
    }
  }, [installments, category, amount, context, open]);

  // === Build the slider tranche specs from context OR installments ===
  const sliderTranches = useMemo<PaymentTrancheSpec[]>(() => {
    if (context && context.lineItems.length > 0) {
      return context.lineItems.map(lineItemToTrancheSpec);
    }
    // Fallback: derive from installments, filtered by category.
    // T-060 (BUSINESS-005): the modal ALWAYS sends a concrete category to
    // collect() (the server filters `category = p_category` exactly), so the
    // derived tranche list must use the same exact filter for every
    // category — the old "other categories = no filter" ternary made the
    // slider show tranches the collection would never touch.
    const eligible = installments
      .filter((i) => i.status !== "paid")
      .filter((i) => i.category === category)
      .slice()
      .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
      .slice(0, 6);
    return eligible.map((i) => ({
      id: i.id,
      label: i.label,
      dueWindowLabel: formatDateShort(i.dueDate),
      amountDue: i.amountDue,
      amountPaid: i.amountPaid,
    }));
  }, [context, installments, category]);

  const sliderMode: PaymentSliderMode = useMemo(() => {
    if (mode === "single_item") return "single_item";
    if (mode === "consolidated_debt") return "consolidated_debt";
    return "installment_tranche";
  }, [mode]);

  const totalDue = useMemo(
    () => sliderTranches.reduce((s, t) => s + t.amountDue, 0),
    [sliderTranches],
  );
  const alreadyPaid = useMemo(
    () => sliderTranches.reduce((s, t) => s + Math.min(t.amountPaid, t.amountDue), 0),
    [sliderTranches],
  );

  // === Live waterfall allocation preview ===
  // T-060 (BUSINESS-005): preview ≡ actual. The collection sends
  // p_category = category (exact match server-side per migration 0040), so
  // the preview applies the SAME exact filter and hands the allocator the
  // SAME concrete categoryFilter — for EVERY category, not only
  // tuition/transport. The old "other categories = unfiltered preview"
  // ternary showed a waterfall across all categories while the actual
  // collection filtered to the chosen one.
  const allocationPreview = useMemo(() => {
    if (!effectiveParentId) return null;
    const eligible = installments
      .filter((i) => i.status !== "paid")
      .filter((i) => i.category === category);
    return allocatePaymentToInstallments(eligible, amount, category);
  }, [installments, amount, category, effectiveParentId]);

  const overpayingNow = allocationPreview ? allocationPreview.unallocatedAmount > 0.5 : false;
  const focusedTrancheLabel = useMemo(() => {
    if (!effectiveParentId) return null;
    // T-060 (BUSINESS-005): same exact-category filter as the actual collection.
    const eligible = installments
      .filter((i) => i.status !== "paid")
      .filter((i) => i.category === category);
    return currentTrancheLabel(eligible, category);
  }, [installments, category, effectiveParentId]);

  const selectedParent = parents.find((p) => p.id === effectiveParentId);
  const proofRequired = proofRequiredFor(method);

  // === Pre-submission validation (Epic 5.3 §6.2) ===
  const singleItemViolation =
    mode === "single_item" && !allowPartial && sliderTranches.length === 1
      ? (() => {
          const netPrice = Math.max(0, sliderTranches[0].amountDue - sliderTranches[0].amountPaid);
          return amount > 0 && amount < netPrice - 0.5;
        })()
      : false;

  const canSubmit =
    !!effectiveParentId &&
    amount > 0 &&
    !singleItemViolation &&
    (!proofRequired || (!!proofFileName && !!proofVaultPath)) &&
    // VAULT §07.01 — structured fields required for non-cash methods.
    (method !== "check" || (!!checkNumber.trim() && !!checkBankName.trim())) &&
    (method !== "transfer" || !!transferReference.trim()) &&
    !!session;

  /** VAULT §12.07 — upload the proof to the PRIVATE media vault. */
  async function handleProofFileSelected(file: File | null) {
    setProofFileName(file?.name ?? null);
    setProofVaultPath(null);
    if (!file) return;
    setProofUploading(true);
    try {
      const uploaded = await uploadPrivateMedia({
        bucket: "payment-proofs",
        entityId: effectiveParentId ?? "unknown-parent",
        tenantId: "mock",
        file,
      });
      setProofVaultPath(uploaded.path);
    } catch (e) {
      toast.showError("Échec du téléversement", e instanceof Error ? e.message : String(e));
      setProofFileName(null);
    } finally {
      setProofUploading(false);
    }
  }

  async function submit() {
    if (!session || !effectiveParentId) return;
    if (proofRequired && !proofFileName) {
      setAlert({
        tone: "warning",
        title: "Justificatif requis",
        description: "Chèque et virement nécessitent un justificatif (plan §18.03).",
      });
      return;
    }
    // VAULT §07.01 — structured non-cash field validation (mirrors the
    // backend enforce_payment_proof trigger).
    if (method === "check" && (!checkNumber.trim() || !checkBankName.trim())) {
      setAlert({
        tone: "warning",
        title: "Champs chèque manquants",
        description: "Le numéro de chèque et le nom de la banque sont obligatoires (plan §07.01).",
      });
      return;
    }
    if (method === "transfer" && !transferReference.trim()) {
      setAlert({
        tone: "warning",
        title: "Référence manquante",
        description: "La référence de transaction est obligatoire pour un virement (plan §07.01).",
      });
      return;
    }
    if (singleItemViolation) {
      setAlert({
        tone: "warning",
        title: "Montant insuffisant",
        description: "Ce service nécessite un règlement complet — ajustez le montant au net dû.",
      });
      return;
    }
    setSubmitting(true);
    try {
      // NOTE (double-allocation fix): `collect()` is ATOMIC in both modes —
      // the mock runs the waterfall internally and the Supabase path calls
      // the `collect_and_allocate_payment` RPC. A second explicit
      // `allocatePayment()` call here previously re-allocated the same
      // amount against the NEXT unpaid tranches (mock) or overwrote correct
      // server-side allocations from a stale cache (Supabase), producing
      // ledger inconsistency. Allocation is now left entirely to collect().
      const result = await repos.payments.collect(
        {
          parentId: effectiveParentId,
          studentId: effectiveStudentId,
          amount,
          method,
          category,
          installmentId: context?.targetItemId ?? null,
          proofUrl: proofVaultPath ?? (proofFileName ? `mock://proof/${proofFileName}` : null),
          notes: notes.trim() || null,
          checkNumber: checkNumber.trim() || null,
          checkBankName: checkBankName.trim() || null,
          checkIssueDate: checkIssueDate || null,
          checkClearanceDate: checkClearanceDate || null,
          transferReference: transferReference.trim() || null,
          transferSourceBank: transferSourceBank.trim() || null,
        },
        session.userId,
      );
      if (!result.ok) {
        setAlert({
          tone: "error",
          title: "Échec de l'encaissement",
          description: result.error.userMessage,
        });
        return;
      }
      if (result.value.status === "paid") {
        toast.showSuccess(
          "Paiement encaissé",
          `${result.value.amount.toLocaleString("fr-FR")} DZD encaissés. Reçu ${result.value.receiptNumber}. Allocation waterfall appliquée.`,
        );
      } else {
        toast.showWarning(
          "Paiement enregistré — en attente",
          `${result.value.amount.toLocaleString("fr-FR")} DZD (${PAYMENT_METHOD_LABELS_FR[result.value.method]}). Statut : En attente de compensation bancaire. Reçu ${result.value.receiptNumber}.`,
        );
      }
      // === Generate receipt (DB record + PDF bytes) ===
      const receipt = await repos.payments.generateReceipt(result.value.id, session.userId);
      if (!receipt.ok) {
        toast.showWarning("Paiement encaissé", "La génération du reçu a échoué.");
      }
      // Generate PDF bytes for the Stage 2 preview + download.
      setGeneratingPdf(true);
      try {
        const bytes = await generatePaymentReceiptPdf(result.value, selectedParent ?? undefined);
        setPdfBytes(bytes);
      } catch (e) {
        // PDF generation failure is non-fatal — the receipt record exists.
        toast.showWarning("Reçu PDF", `Échec de génération PDF: ${String(e)}`);
      } finally {
        setGeneratingPdf(false);
      }
      setReceiptPayment(result.value);
      setStage("success");
      onPaymentCollected?.(result.value);
    } finally {
      setSubmitting(false);
    }
  }

  function downloadReceiptPdf() {
    if (!pdfBytes || !receiptPayment) return;
    downloadPdf(pdfBytes, `${receiptPayment.receiptNumber}.pdf`);
  }

  function shareViaWhatsApp() {
    if (!receiptPayment || !selectedParent) return;
    const msg = `Bonjour ${selectedParent.firstName} ${selectedParent.lastName},%0A` +
      `Nous accusons réception de votre paiement de ${formatDzdPlain(receiptPayment.amount)} ` +
      `(reçu N° ${receiptPayment.receiptNumber}, ${PAYMENT_METHOD_LABELS_FR[receiptPayment.method]}).%0A` +
      `Merci — EL-IMTIYAZ`;
    const phone = selectedParent.phone?.replace(/[\s+]/g, "") ?? "";
    const url = `https://wa.me/${phone}?text=${msg}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  // === Custom footer per stage ===
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
      <Button variant="outline" onClick={shareViaWhatsApp} disabled={!pdfBytes}>
        <MessageCircle className="h-4 w-4" /> WhatsApp
      </Button>
      <Button onClick={downloadReceiptPdf} disabled={!pdfBytes}>
        <FileDown className="h-4 w-4" /> Télécharger PDF
      </Button>
    </>
  );

  // === Mode label for header ===
  const modeLabel =
    mode === "single_item"
      ? "Article / Service unique"
      : mode === "installment_tranche"
        ? "Tranche (engagement annuel)"
        : mode === "consolidated_debt"
          ? "Dette consolidée famille"
          : "Ajustement de compte";

  const itemTitle = context?.lineItems?.[0]?.label
    ?? (mode === "consolidated_debt" ? "Solde familial" : "Paiement comptoir");

  return (
    <UnifiedModal
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      variant="dialog"
      icon={Wallet}
      iconTone="success"
      title={stage === "form" ? `Encaissement — ${modeLabel}` : "Paiement encaissé"}
      description={
        stage === "form"
          ? `${itemTitle} · reçu généré automatiquement (plan §07.05).`
          : "Reçu généré — prêt à partager."
      }
      alert={alert}
      onDismissAlert={() => setAlert(null)}
      footer={footerNode}
      hideFooter={false}
    >
      {stage === "form" && (
        <div className="space-y-4">
          {/* === SECTION 1: Context Header === */}
          {!selectedParent ? (
            <FormField label="Parent" required>
              <div className="relative">
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
                          setFallbackParentId(p.id);
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
            <div className="rounded-md border border-border p-3 space-y-1">
              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">
                    {selectedParent.firstName} {selectedParent.lastName}
                    <span className="text-xs text-muted-foreground font-mono ml-2">
                      {selectedParent.code}
                    </span>
                  </p>
                  {context?.studentName && (
                    <p className="text-xs text-muted-foreground">
                      Élève : {context.studentName}
                    </p>
                  )}
                  {effectiveStudentId && !context?.studentName && (
                    <p className="text-xs text-muted-foreground">
                      Élève : {students.find((s) => s.id === effectiveStudentId)?.firstName}{" "}
                      {students.find((s) => s.id === effectiveStudentId)?.lastName}
                    </p>
                  )}
                </div>
                {!context && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => {
                      setFallbackParentId(null);
                      setFallbackStudentId(null);
                      setAmount(0);
                    }}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground italic">{itemTitle}</p>
            </div>
          )}

          {/* Optional student picker (fallback mode only) */}
          {!context && selectedParent && students.length > 0 && (
            <FormField label="Élève (optionnel)">
              <select
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={effectiveStudentId ?? "__none__"}
                onChange={(e) => setFallbackStudentId(e.target.value === "__none__" ? null : e.target.value)}
              >
                <option value="__none__">— Aucun —</option>
                {students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.firstName} {s.lastName} · {s.code}
                  </option>
                ))}
              </select>
            </FormField>
          )}

          {/* === SECTION 2: Line Item / Tranche Summary === */}
          {selectedParent && sliderTranches.length > 0 && (
            <div className="rounded-md border border-border p-3 space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Brut</span>
                <span className="font-mono">{formatDzdPlain(totalDue)}</span>
              </div>
              {context?.lineItems?.[0]?.discountAmount ? (
                <div className="flex justify-between text-status-success">
                  <span className="text-muted-foreground">Remises</span>
                  <span className="font-mono">−{formatDzdPlain(context.lineItems[0].discountAmount)}</span>
                </div>
              ) : null}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Net dû</span>
                <span className="font-mono font-semibold">{formatDzdPlain(totalDue)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Déjà payé</span>
                <span className="font-mono text-status-success">{formatDzdPlain(alreadyPaid)}</span>
              </div>
              <div className="flex justify-between border-t border-border pt-1">
                <span className="text-muted-foreground">Reste à payer</span>
                <span className="font-mono font-bold text-status-danger">
                  {formatDzdPlain(Math.max(0, totalDue - alreadyPaid))}
                </span>
              </div>
              {context?.overdueDays ? (
                <p className="text-[11px] text-status-danger italic">
                  En retard de {context.overdueDays} jour(s) — fenêtre : {context.dueWindowLabel ?? "—"}
                </p>
              ) : null}
            </div>
          )}

          {/* === SECTION 3: Adaptive Payment Slider === */}
          {selectedParent && sliderTranches.length > 0 ? (
            <PaymentSlider
              tranches={sliderTranches}
              value={amount}
              onChange={setAmount}
              disabled={submitting}
              mode={sliderMode}
              allowPartial={allowPartial}
            />
          ) : selectedParent ? (
            <div className="rounded-md border border-status-success/40 bg-status-success/5 p-3 text-xs text-status-success">
              ✓ Aucune tranche impayée pour cette catégorie — le paiement sera enregistré comme crédit parent.
            </div>
          ) : null}

          {/* === Category + method (only when no context, since context drives category) === */}
          {!context && selectedParent && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <FormField label="Catégorie" required>
                <select
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  value={category}
                  onChange={(e) => setCategory(e.target.value as PaymentCategory)}
                >
                  {Object.entries(PAYMENT_CATEGORY_LABELS_FR).map(([k, label]) => (
                    <option key={k} value={k}>{label}</option>
                  ))}
                </select>
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
          )}

          {/* When context IS provided, still allow method selection */}
          {context && selectedParent && (
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
          )}

          {/* === SECTION 5: Unified Debt Meter === */}
          {selectedParent && (
            <DebtMeter
              totalDue={totalDue}
              alreadyPaid={alreadyPaid}
              payingNow={amount}
              currentTrancheLabel={focusedTrancheLabel}
              unallocatedCredit={bankedCredit}
              statusNote={
                allocationPreview && allocationPreview.allocations.length > 0
                  ? `Sera alloué à ${allocationPreview.allocations.length} tranche(s) — waterfall chronologique.`
                  : overpayingNow
                    ? "Excédent — sera stocké comme crédit parent (avance)."
                    : null
              }
            />
          )}

          {/* === SECTION 4: Proof capture (mandatory for check/transfer) === */}
          {proofRequired && (
            <FormField
              label="Justificatif (scan)"
              required
              error={!proofFileName ? "Obligatoire pour chèque et virement (plan §18.03)" : proofVaultPath ? undefined : "Téléversement en cours…"}
              hint="Stockage privé — accès par URL signée (5 min) uniquement"
            >
              <label className="flex items-center gap-2 rounded-md border border-dashed border-border p-3 cursor-pointer hover:bg-accent/5">
                <Upload className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  {proofUploading
                    ? "Téléversement vers le coffre privé…"
                    : proofFileName ?? "Téléverser un justificatif (image/PDF)"}
                </span>
                <input
                  type="file"
                  accept="image/*,.pdf"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    void handleProofFileSelected(f ?? null);
                  }}
                />
              </label>
              {proofFileName && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-1 text-xs"
                  onClick={() => {
                    setProofFileName(null);
                    setProofVaultPath(null);
                  }}
                >
                  Retirer
                </Button>
              )}
            </FormField>
          )}

          {/* === SECTION 4b: Structured non-cash fields (vault §07.01) === */}
          {method === "check" && (
            <div className="rounded-md border border-border bg-surface-elevated/40 p-3 space-y-3">
              <p className="text-xs font-medium text-foreground">
                Détails du chèque <span className="text-status-danger">*</span>
              </p>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <FormField label="N° de chèque" required error={!checkNumber.trim() ? "Obligatoire" : undefined}>
                  <Input
                    value={checkNumber}
                    onChange={(e) => setCheckNumber(e.target.value)}
                    placeholder="ex. 004512"
                  />
                </FormField>
                <FormField label="Banque" required error={!checkBankName.trim() ? "Obligatoire" : undefined}>
                  <Input
                    value={checkBankName}
                    onChange={(e) => setCheckBankName(e.target.value)}
                    placeholder="ex. BNA"
                  />
                </FormField>
                <FormField label="Date d'émission">
                  <Input
                    type="date"
                    value={checkIssueDate}
                    onChange={(e) => setCheckIssueDate(e.target.value)}
                  />
                </FormField>
                <FormField label="Date d'échéance / compensation">
                  <Input
                    type="date"
                    value={checkClearanceDate}
                    onChange={(e) => setCheckClearanceDate(e.target.value)}
                  />
                </FormField>
              </div>
            </div>
          )}
          {method === "transfer" && (
            <div className="rounded-md border border-border bg-surface-elevated/40 p-3 space-y-3">
              <p className="text-xs font-medium text-foreground">
                Détails du virement <span className="text-status-danger">*</span>
              </p>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <FormField label="Référence de transaction" required error={!transferReference.trim() ? "Obligatoire" : undefined}>
                  <Input
                    value={transferReference}
                    onChange={(e) => setTransferReference(e.target.value)}
                    placeholder="ex. VIR-2026-00871"
                  />
                </FormField>
                <FormField label="Banque émettrice">
                  <Input
                    value={transferSourceBank}
                    onChange={(e) => setTransferSourceBank(e.target.value)}
                    placeholder="ex. CPA"
                  />
                </FormField>
              </div>
            </div>
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

          {/* === Single-item partial-payment warning === */}
          {singleItemViolation && sliderTranches[0] && (
            <div className="rounded-md border border-status-warning/40 bg-status-warning/5 p-3 text-xs text-status-warning">
              Ce service nécessite un règlement complet ({formatDzdPlain(
                Math.max(0, sliderTranches[0].amountDue - sliderTranches[0].amountPaid),
              )}) — le montant sera ajusté.
            </div>
          )}

          {/* === Status preview === */}
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

          {/* PDF preview indicator */}
          <div className="rounded-md border border-border p-3 flex items-center gap-3">
            {generatingPdf ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Génération du PDF…</span>
              </>
            ) : pdfBytes ? (
              <>
                <FileDown className="h-4 w-4 text-status-success" />
                <div className="flex-1">
                  <p className="text-sm font-medium">Reçu PDF prêt</p>
                  <p className="text-[11px] text-muted-foreground">
                    {receiptPayment.receiptNumber}.pdf · {Math.ceil(pdfBytes.length / 1024)} Ko
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={downloadReceiptPdf}>
                  <FileDown className="h-3.5 w-3.5 mr-1" /> Télécharger
                </Button>
              </>
            ) : (
              <>
                <Share2 className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">PDF non généré (utilisez WhatsApp pour partager)</span>
              </>
            )}
          </div>

          <p className="text-[11px] text-muted-foreground text-center">
            Le reçu PDF reste disponible dans l'onglet Reçus.
          </p>
        </div>
      )}
    </UnifiedModal>
  );
}
