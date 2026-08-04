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
import { useEffect, useState } from "react";
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
import { MoneyInput } from "../../shared/ui/money-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../shared/ui/select";
import { Separator } from "../../shared/ui/separator";
import { StatusChip } from "../../shared/ui/status-chip";
import { formatDzd, formatDzdPlain } from "../../core/format/currency";
import { formatDateTime } from "../../core/format/date";
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
  const [installmentId, setInstallmentId] = useState<string | null>(presetInstallmentId ?? null);
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
        setInstallmentId(null);
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
      if (presetInstallmentId) setInstallmentId(presetInstallmentId);
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

  // Auto-suggest oldest unpaid installment matching category (plan §07.03)
  useEffect(() => {
    if (presetInstallmentId) return;
    if (category !== "tuition" && category !== "transport") return;
    const matching = installments
      .filter((i) => i.category === category && i.status !== "paid")
      .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
    if (matching.length > 0) {
      setInstallmentId(matching[0].id);
      if (amount === 0) setAmount(matching[0].amountDue - matching[0].amountPaid);
    }
  }, [installments, category, amount, presetInstallmentId]);

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
      const result = await repos.payments.collect(
        {
          parentId: selectedParentId,
          studentId: selectedStudentId,
          amount,
          method,
          category,
          installmentId,
          proofUrl: proofFileName ? `mock://proof/${proofFileName}` : null,
          notes: notes.trim() || null,
        },
        session.userId,
      );
      if (result.ok) {
        // Auto-mark installment paid if linked
        if (installmentId) {
          await repos.installments.markPaid(installmentId, result.value.id);
        }
        // Auto-generate receipt
        const receipt = await repos.payments.generateReceipt(result.value.id, session.userId);
        if (receipt.ok) {
          toast.showSuccess(
            "Paiement encaissé",
            `Reçu ${result.value.receiptNumber} généré automatiquement.`,
          );
        } else {
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
                  setInstallmentId(null);
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

          {/* Category + method + amount */}
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
            <FormField label="Montant" required>
              <MoneyInput value={amount} onChange={setAmount} />
            </FormField>
          </div>

          <FormField label="Méthode" required>
            <div className="grid grid-cols-3 gap-2">
              {(["cash", "check", "transfer"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMethod(m)}
                  className={`rounded-md border p-3 text-center text-sm transition-colors ${
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

          {/* Installment auto-suggest */}
          {installments.length > 0 && (category === "tuition" || category === "transport") && (
            <FormField label="Tranche associée" hint="Auto-suggérée: la plus ancienne non payée de cette catégorie">
              <Select
                value={installmentId ?? "__none__"}
                onValueChange={(v) => setInstallmentId(v === "__none__" ? null : v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Aucune —</SelectItem>
                  {installments
                    .filter((i) => i.category === category)
                    .map((i) => (
                      <SelectItem key={i.id} value={i.id}>
                        {i.label} — {formatDzdPlain(i.amountDue - i.amountPaid)} restant ({PAYMENT_STATUS_LABELS_FR[i.status]})
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </FormField>
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
