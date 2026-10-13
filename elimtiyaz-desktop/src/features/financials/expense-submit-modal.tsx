/**
 * ExpenseSubmitModal — submit a new expense ticket (plan §08 + T-521).
 *
 * T-521 (issue #29) converts the AutoFormModal form into a custom
 * UnifiedModal body so it can carry the TWO unification additions the shared
 * primitive has no field type for:
 *
 *   1. The RESPONSIBLE-PERSON select (WORKFORCE-520) — the staff member
 *      accountable for the spend, DISTINCT from the submitter; the option
 *      source is the personnel directory (only records with a bound account
 *      carry a user_profiles id — the T-371 assignability rule: an employee
 *      without a linked account is unassignable BY DESIGN, never a fallback).
 *   2. The ATTACHMENT area (WORKFORCE-518) — a multi-image picker whose
 *      files are uploaded through the canonical addAttachment() AFTER the
 *      expense row exists (the metadata row needs its parent expense id);
 *      each file is validated client-side against the 0018 bucket limits
 *      (10 MB, jpeg/png/webp/pdf — the chat-attachment precedent).
 *
 * The original Zod validation rules are preserved verbatim (title ≥ 3,
 * amount > 0, payee ≥ 2, urgency default medium).
 */
import { useMemo, useState } from "react";
import { Paperclip, Trash2, Upload } from "lucide-react";
import { useRepositories } from "../../app/providers/repository-provider";
import { useToast } from "../../app/providers/toast-provider";
import { useAuth } from "../../app/providers/auth-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import { UnifiedModal } from "../../shared/ui/unified-modal";
import { FormField } from "../../shared/ui/form-field";
import { Input } from "../../shared/ui/input";
import { Textarea } from "../../shared/ui/textarea";
import { MoneyInput } from "../../shared/ui/money-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../shared/ui/select";
import { Button } from "../../shared/ui/button";
import {
  EXPENSE_CATEGORY_LABELS_FR,
  EXPENSE_URGENCY_LABELS_FR,
  type ExpenseCategory,
  type ExpenseUrgency,
} from "../../domain/model/expense";

/** The 0018 expense-receipts bucket limits (validated client-side first). */
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const ALLOWED_ATTACHMENT_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
];

export function ExpenseSubmitModal({
  open,
  onOpenChange,
  onSubmitted,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSubmitted?: (expenseId: string) => void;
}) {
  const repos = useRepositories();
  const toast = useToast();
  const { session } = useAuth();
  const personnel = useObservable(() => repos.personnel.observe(), []);

  // ── Form state (the original Zod rules, hand-validated) ──────────────
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState(0);
  const [category, setCategory] = useState<ExpenseCategory>("supplies");
  const [urgency, setUrgency] = useState<ExpenseUrgency>("medium");
  const [payee, setPayee] = useState("");
  const [responsibleProfileId, setResponsibleProfileId] = useState<string>("unassigned");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  /** The selectable responsible persons: ACTIVE personnel with a bound
   *  account (the user_profiles id is what the canonical column stores). */
  const responsibleOptions = useMemo(
    () =>
      personnel
        .filter((p) => p.status === "active" && p.userId)
        .map((p) => ({
          value: p.userId as string,
          label: `${p.firstName} ${p.lastName}${p.position ? ` — ${p.position}` : ""}`,
        })),
    [personnel],
  );

  function handleFilesPicked(files: FileList | null) {
    if (!files) return;
    const next: File[] = [];
    for (const file of Array.from(files)) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        setErrors((e) => ({
          ...e,
          attachments: `"${file.name}" dépasse 10 Mo — choisissez un fichier plus léger.`,
        }));
        continue;
      }
      if (file.type && !ALLOWED_ATTACHMENT_MIME.includes(file.type)) {
        setErrors((e) => ({
          ...e,
          attachments: `"${file.name}" : type non autorisé (JPEG, PNG, WebP ou PDF uniquement).`,
        }));
        continue;
      }
      next.push(file);
    }
    if (next.length > 0) {
      setPendingFiles((prev) => [...prev, ...next]);
      setErrors((e) => ({ ...e, attachments: "" }));
    }
  }

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (title.trim().length < 3) e.title = "Titre requis (min. 3 caractères)";
    if (!(amount >= 1)) e.amount = "Montant supérieur à 0 requis";
    if (payee.trim().length < 2) e.payee = "Bénéficiaire requis (min. 2 caractères)";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function reset() {
    setTitle("");
    setDescription("");
    setAmount(0);
    setCategory("supplies");
    setUrgency("medium");
    setPayee("");
    setResponsibleProfileId("unassigned");
    setPendingFiles([]);
    setErrors({});
  }

  async function handleSubmit() {
    if (!session || submitting) return;
    if (!validate()) return;
    setSubmitting(true);
    try {
      const res = await repos.expenses.submit(
        {
          title: title.trim(),
          description: description.trim(),
          amount,
          category,
          urgency,
          payee: payee.trim(),
          responsibleProfileId:
            responsibleProfileId !== "unassigned" ? responsibleProfileId : undefined,
        },
        session.userId,
      );
      if (!res.ok) {
        toast.showError("Échec de la soumission", res.error.userMessage);
        return;
      }

      // The attachments ride the canonical path — uploaded AFTER the parent
      // row exists, each linked to it (never separate expense records).
      let attached = 0;
      let attachErrors = 0;
      for (const file of pendingFiles) {
        const a = await repos.expenses.addAttachment(
          res.value.id,
          {
            name: file.name,
            type: file.type || "application/octet-stream",
            size: file.size,
            blob: file,
          },
          session.userId,
          "desktop",
        );
        if (a.ok) attached += 1;
        else attachErrors += 1;
      }

      toast.showSuccess(
        "Demande soumise",
        `${res.value.requestCode} — en attente d'approbation${
          attached > 0 ? ` · ${attached} justificatif${attached > 1 ? "s" : ""} joint${attached > 1 ? "s" : ""}` : ""
        }${attachErrors > 0 ? ` · ${attachErrors} téléversement(s) en échec (réessayez depuis le détail)` : ""}.`,
      );
      reset();
      onOpenChange(false);
      onSubmitted?.(res.value.id);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <UnifiedModal
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
      variant="dialog"
      size="lg"
      icon={Paperclip}
      iconTone="primary"
      title="Nouvelle demande de dépense"
      description="Soumettez une dépense pour validation par l'administration. Les justificatifs (reçus, factures) peuvent être joints dès la création."
      submitLabel="Soumettre la dépense"
      onSubmit={handleSubmit}
      submitDisabled={submitting}
    >
      <div className="space-y-3">
        <FormField label="Intitulé de la dépense" required error={errors.title || undefined}>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ex. Réparation climatisation"
          />
        </FormField>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Catégorie" required>
            <Select value={category} onValueChange={(v) => setCategory(v as ExpenseCategory)}>
              <SelectTrigger>
                <SelectValue placeholder="Catégorie" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(EXPENSE_CATEGORY_LABELS_FR).map(([k, label]) => (
                  <SelectItem key={k} value={k}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Urgence" required>
            <Select value={urgency} onValueChange={(v) => setUrgency(v as ExpenseUrgency)}>
              <SelectTrigger>
                <SelectValue placeholder="Urgence" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(EXPENSE_URGENCY_LABELS_FR).map(([k, label]) => (
                  <SelectItem key={k} value={k}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Montant (DZD)" required error={errors.amount || undefined}>
            <MoneyInput value={amount} onChange={setAmount} />
          </FormField>
          <FormField label="Bénéficiaire / Fournisseur" required error={errors.payee || undefined}>
            <Input
              value={payee}
              onChange={(e) => setPayee(e.target.value)}
              placeholder="Ex. Climat Oran Services"
            />
          </FormField>
        </div>

        {/* T-521 (WORKFORCE-520) — the distinct accountable person. */}
        <FormField
          label="Responsable de la dépense"
          hint="Le membre du personnel accountable de la dépense — peut différer du demandeur (ex. une demande saisie pour un chauffeur)."
        >
          <Select
            value={responsibleProfileId}
            onValueChange={setResponsibleProfileId}
          >
            <SelectTrigger>
              <SelectValue placeholder="Sélectionner un responsable" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unassigned">
                À renseigner plus tard (la dépense sera signalée)
              </SelectItem>
              {responsibleOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {responsibleOptions.length === 0 && (
            <p className="text-[11px] text-muted-foreground mt-1">
              Aucun personnel actif avec un compte lié — liez un compte dans Paramètres → Comptes
              pour assigner un responsable.
            </p>
          )}
        </FormField>

        <FormField label="Justification opérationnelle">
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Justification de la dépense (contexte, urgence, bénéfice attendu)…"
            rows={3}
          />
        </FormField>

        {/* T-521 (WORKFORCE-518) — the multi-image attachment area. */}
        <FormField
          label="Justificatifs (reçus, factures, scans)"
          hint="Images (JPEG/PNG/WebP) ou PDF — 10 Mo max par fichier, plusieurs fichiers possibles."
          error={errors.attachments || undefined}
        >
          <label className="flex items-center gap-2 rounded-md border border-dashed border-border p-3 cursor-pointer hover:bg-accent/5">
            <Upload className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">
              Choisir des fichiers (image / PDF)
            </span>
            <input
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp,.pdf"
              className="hidden"
              onChange={(e) => {
                handleFilesPicked(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
          {pendingFiles.length > 0 && (
            <ul className="mt-2 space-y-1.5">
              {pendingFiles.map((f, idx) => (
                <li
                  key={`${f.name}-${idx}`}
                  className="flex items-center justify-between gap-2 rounded-md border border-border/60 px-2.5 py-1.5 text-xs"
                >
                  <span className="truncate">
                    {f.type.startsWith("image/") ? "🖼" : "📄"} {f.name}{" "}
                    <span className="text-muted-foreground">({(f.size / 1024).toFixed(0)} Ko)</span>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setPendingFiles((prev) => prev.filter((_, i) => i !== idx))}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </FormField>
      </div>
    </UnifiedModal>
  );
}
