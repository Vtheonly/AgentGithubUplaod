/**
 * ExpenseSubmitModal — submit a new expense ticket (plan §08).
 *
 * Form: title, description, amount, category (controlled list), payee.
 * Calls ExpenseRepository.submit() which sets status to "submitted".
 * Anomaly detection is server-side (mocked as null in current iteration).
 */
import { useState } from "react";
import { Loader2, Send } from "lucide-react";
import { useRepositories } from "../../infrastructure/repository-provider";
import { useToast } from "../../state/toast-context";
import { useAuth } from "../../state/auth-context";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../../shared/ui/dialog";
import { Button } from "../../shared/ui/button";
import { Input } from "../../shared/ui/input";
import { Textarea } from "../../shared/ui/textarea";
import { FormField } from "../../shared/components/form-field";
import { MoneyInput } from "../../shared/components/money-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../shared/ui/select";
import { EXPENSE_CATEGORY_LABELS_FR, type ExpenseCategory } from "../../domain/model/expense";

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
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (!session) return;
    if (!title.trim() || amount <= 0 || !payee.trim()) {
      toast.showWarning("Champs invalides", "Titre, montant et bénéficiaire sont requis.");
      return;
    }
    setSubmitting(true);
    try {
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
        // reset
        setTitle("");
        setDescription("");
        setAmount(0);
        setCategory("supplies");
        setPayee("");
      } else {
        toast.showError("Échec", r.error.userMessage);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Nouvelle demande de dépense</DialogTitle>
          <DialogDescription>
            Sera soumise pour approbation. Pas d'auto-approbation (plan §08).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <FormField label="Titre" required>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Réparation climatisation salle B12" />
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
            <Input value={payee} onChange={(e) => setPayee(e.target.value)} placeholder="Climat Oran Services" />
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Soumission…
              </>
            ) : (
              <>
                <Send className="h-4 w-4" /> Soumettre
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
