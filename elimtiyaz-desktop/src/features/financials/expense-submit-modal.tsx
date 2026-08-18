/**
 * ExpenseSubmitModal — submit a new expense ticket (plan §08).
 *
 * Refactored to consume `<AutoFormModal<T>>` so form-state, Zod validation,
 * and field rendering all flow through the shared primitive instead of
 * hand-rolled `useState` + bespoke `<UnifiedModal>` form. Anomaly detection
 * is server-side.
 */
import { z } from "zod";
import { useRepositories } from "../../app/providers/repository-provider";
import { useToast } from "../../app/providers/toast-provider";
import { useAuth } from "../../app/providers/auth-provider";
import { AutoFormModal, type AutoFormField } from "../../shared/ui/auto-form";
import { EXPENSE_CATEGORY_LABELS_FR, type ExpenseCategory } from "../../domain/model/expense";

const ExpenseSchema = z.object({
  title: z.string().min(3, "Titre requis (min. 3 caractères)"),
  description: z.string().optional().default(""),
  amount: z.number().min(1, "Montant supérieur à 0 requis"),
  category: z.enum([
    "utilities", "supplies", "maintenance", "transport",
    "event", "salary", "tax", "rent", "other",
  ]),
  payee: z.string().min(2, "Bénéficiaire requis"),
});

type ExpenseFormData = z.infer<typeof ExpenseSchema>;

const fields: readonly AutoFormField[] = [
  { name: "title", label: "Intitulé de la dépense", type: "text", required: true, wide: true, placeholder: "Ex. Réparation climatisation" },
  {
    name: "category", label: "Catégorie", type: "select", required: true,
    options: Object.entries(EXPENSE_CATEGORY_LABELS_FR).map(([k, label]) => ({ label, value: k })),
  },
  { name: "amount", label: "Montant (DZD)", type: "money", required: true },
  { name: "payee", label: "Bénéficiaire / Fournisseur", type: "text", required: true, wide: true, placeholder: "Ex. Climat Oran Services" },
  { name: "description", label: "Justification / Détails", type: "textarea", wide: true, placeholder: "Détails de l'intervention…" },
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

  async function handleSubmit(data: ExpenseFormData) {
    if (!session) return;
    const res = await repos.expenses.submit(
      {
        title: data.title,
        description: data.description ?? "",
        amount: data.amount,
        category: data.category as ExpenseCategory,
        payee: data.payee,
      },
      session.userId,
    );
    if (res.ok) {
      toast.showSuccess("Demande soumise", `${res.value.requestCode} — en attente d'approbation.`);
      onSubmitted?.(res.value.id);
    } else {
      throw new Error(res.error.userMessage);
    }
  }

  return (
    <AutoFormModal
      open={open}
      onOpenChange={onOpenChange}
      title="Nouvelle demande de dépense"
      description="Soumettez une dépense pour validation par l'administration."
      schema={ExpenseSchema}
      fields={fields}
      initialValues={{ category: "supplies", amount: 0 }}
      onSubmit={handleSubmit}
      submitLabel="Soumettre la dépense"
    />
  );
}
