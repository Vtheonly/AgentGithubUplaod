/**
 * TaskFormModal — create form for a new Task.
 *
 * Refactored to consume `<AutoFormModal<T>>` so form-state, validation, and
 * field rendering all flow through the shared primitive instead of hand-
 * rolled `useState` + bespoke `<UnifiedModal>` form. Tags are kept as a
 * comma-separated text input parsed at submission time.
 *
 * T-371 (WORKFORCE-501) — the id-space fix: `tasks.assignee_ids` holds
 * user_profiles ids (0010 schema + 0019 RLS + every employee dashboard
 * read), so the assignee options are keyed on the employee's LINKED
 * ACCOUNT (personnel.userId). Employees without an account are listed but
 * DISABLED — a task assigned to an unlinked personnel id would be invisible
 * to its assignee under RLS (the exact split-brain this task repairs).
 */
import { z } from "zod";
import { useRepositories } from "../../../app/providers/repository-provider";
import { useObservable } from "../../../shared/hooks/use-observable";
import { useAuth } from "../../../app/providers/auth-provider";
import { useToast } from "../../../app/providers/toast-provider";
import { AutoFormModal, type AutoFormField } from "../../../shared/ui/auto-form";
import { type TaskPriority } from "../../../domain/model/workforce";

const TaskSchema = z.object({
  title: z.string().min(3, "Titre requis (min. 3 caractères)"),
  description: z.string().optional().default(""),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  departmentId: z.string().optional().default(""),
  assigneeId: z.string().optional().default(""),
  dueDate: z.string().optional().default(""),
  tags: z.string().optional().default(""),
});

type TaskFormData = z.infer<typeof TaskSchema>;

export function TaskFormModal({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
}) {
  const repos = useRepositories();
  const { session } = useAuth();
  const toast = useToast();
  const departments = useObservable(() => repos.departments.observe(), []);
  const personnel = useObservable(() => repos.personnel.observe(), []);

  const fields: readonly AutoFormField[] = [
    { name: "title", label: "Titre de la tâche", type: "text", required: true, wide: true, placeholder: "Ex. Préparer les bulletins Q1" },
    {
      name: "priority", label: "Priorité", type: "select", required: true,
      options: [
        { label: "Basse", value: "low" },
        { label: "Moyenne", value: "medium" },
        { label: "Haute", value: "high" },
        { label: "Urgente", value: "urgent" },
      ],
    },
    {
      name: "departmentId", label: "Département", type: "select",
      options: [
        { label: "— Aucun département —", value: "" },
        ...departments.filter((d) => !d.archivedAt).map((d) => ({ label: d.name, value: d.id })),
      ],
    },
    {
      name: "assigneeId", label: "Assigner à", type: "select",
      help:
        personnel.filter((p) => !p.userId).length > 0
          ? `${personnel.filter((p) => !p.userId).length} employé(s) sans compte lié ne sont pas assignables — liez d'abord un compte (Paramètres → Comptes).`
          : undefined,
      options: [
        { label: "— Non assignée —", value: "" },
        ...personnel
          .filter(
            (p): p is typeof p & { userId: string } =>
              Boolean(p.userId) &&
              (p.status === "active" || p.status === "on_leave"),
          )
          .map((p) => ({
            // T-371: the option VALUE is the linked account id — what
            // assignee_ids actually stores (user_profiles.id per 0010/0019).
            label: `${p.firstName} ${p.lastName}`,
            value: p.userId,
          }))
          .sort((a, b) => a.label.localeCompare(b.label, "fr")),
      ],
    },
    { name: "dueDate", label: "Date d'échéance", type: "date" },
    { name: "tags", label: "Étiquettes", type: "text", wide: true, placeholder: "Séparées par des virgules…" },
    { name: "description", label: "Description", type: "textarea", wide: true, placeholder: "Objectifs, consignes…" },
  ];

  async function handleSubmit(data: TaskFormData) {
    if (!session) return;
    if (data.assigneeId) {
      // Defensive: the select only offers linked accounts, but a stale
      // session could carry a personnel id — reject it BEFORE the round-trip
      // (the Supabase repository also UUID-validates every assignee).
      const linked = personnel.some((p) => p.userId === data.assigneeId);
      if (!linked) {
        throw new Error(
          "Cet employé n'a pas de compte lié — la tâche lui serait invisible. Liez d'abord un compte (Paramètres → Comptes).",
        );
      }
    }
    const tags = data.tags ? data.tags.split(",").map((s) => s.trim()).filter(Boolean) : [];
    const res = await repos.tasks.createTask({
      title: data.title,
      description: data.description ?? "",
      priority: data.priority as TaskPriority,
      departmentId: data.departmentId || null,
      assigneeIds: data.assigneeId ? [data.assigneeId] : [],
      dueDate: data.dueDate || null,
      createdBy: session.userId,
      createdByName: session.displayName,
      tags,
    });
    if (res.ok) {
      toast.showSuccess("Tâche créée", `« ${res.value.title} » ajoutée.`);
      onCreated?.();
    } else {
      throw new Error(res.error.userMessage);
    }
  }

  return (
    <AutoFormModal
      open={open}
      onOpenChange={onOpenChange}
      title="Nouvelle tâche"
      description="Créez et assignez une tâche à un collaborateur."
      schema={TaskSchema}
      fields={fields}
      initialValues={{ priority: "medium" }}
      onSubmit={handleSubmit}
      submitLabel="Créer la tâche"
    />
  );
}
