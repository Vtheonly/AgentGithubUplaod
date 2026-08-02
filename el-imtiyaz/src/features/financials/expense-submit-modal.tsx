/**
 * ExpenseSubmitModal — submit a new expense ticket (plan §08).
 *
 * Form: title, description, amount, category (controlled list), payee.
 * Calls ExpenseRepository.submit() which sets status to "submitted".
 * Anomaly detection is server-side (mocked as null in current iteration).
 *
 * Iteration 3: refactored to use UnifiedModal — consistent header,
 * footer, loading state, error display, and animation with every
 * other modal in the application.
 */
import { useState } from "react";
import { Send } from "lucide-react";
import { useRepositories } from "../../app/providers/repository-provider";
import { useToast } from "../../app/providers/toast-provider";
import { useAuth } from "../../app/providers/auth-provider";
import { UnifiedModal, type UnifiedModalProps } from "../../shared/ui/unified-modal";
import { Input } from "../../shared/ui/input";
import { Textarea } from "../../shared/ui/textarea";
import { FormField } from "../../shared/ui/form-field";
import { MoneyInput } from "../../shared/ui/money-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../shared/ui/select";
import { EXPENSE_CATEGORY_LABELS_FR, type ExpenseCategory } from "../../domain/model/expense";

type Alert = NonNullable<UnifiedModalProps["alert"]>;

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
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState(0);
  const [category, setCategory] = useState<ExpenseCategory>("supplies");
  const [payee, setPayee] = useState("");
  const [alert, setAlert] = useState<Alert | null>(null);

  function reset() {
    setTitle("");
    setDescription("");
    setAmount(0);
    setCategory("supplies");
    setPayee("");
    setAlert(null);
  }

  async function submit() {
    if (!session) return;
    if (!title.trim() || amount <= 0 || !payee.trim()) {
      setAlert({
        tone: "warning",
        title: "Champs invalides",
        description: "Titre, montant et bénéficiaire sont requis.",
      });
      return;
    }
    const r = await repos.expenses.submit(
      {
        title: title.trim(),
        description: description.trim(),
        amount,
        category,
        payee: payee.trim(),
      },
      session.userId,
    );
    if (r.ok) {
      toast.showSuccess("Dépense soumise", `${r.value.requestCode} — en attente d'approbation.`);
      onSubmitted?.(r.value.id);
      onOpenChange(false);
      setTimeout(reset, 200);
    } else {
      setAlert({
        tone: "error",
        title: "Échec de la soumission",
        description: r.error.userMessage,
      });
    }
  }

  return (
    <UnifiedModal
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      variant="dialog"
      icon={Send}
      iconTone="primary"
      title="Nouvelle demande de dépense"
      description="Sera soumise pour approbation. Pas d'auto-approbation (plan §08)."
      submitLabel="Soumettre"
      submitIcon={Send}
      onSubmit={submit}
      alert={alert}
      onDismissAlert={() => setAlert(null)}
    >
      <div className="space-y-4">
        <FormField label="Titre" required>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Réparation climatisation salle B12"
          />
        </FormField>
        <FormField label="Description">
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Détails complémentaires…"
            rows={3}
          />
        </FormField>
        <div className="grid gap-3 md:grid-cols-2">
          <FormField label="Catégorie" required hint="Liste contrôlée — pas de texte libre">
            <Select value={category} onValueChange={(v) => setCategory(v as ExpenseCategory)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(EXPENSE_CATEGORY_LABELS_FR).map(([k, label]) => (
                  <SelectItem key={k} value={k}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Montant" required>
            <MoneyInput value={amount} onChange={setAmount} />
          </FormField>
        </div>
        <FormField label="Bénéficiaire" required>
          <Input
            value={payee}
            onChange={(e) => setPayee(e.target.value)}
            placeholder="Climat Oran Services"
          />
        </FormField>
      </div>
    </UnifiedModal>
  );
}
