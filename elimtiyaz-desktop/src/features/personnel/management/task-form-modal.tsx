/**
 * TaskFormModal — create form for a new Task.
 *
 * Refactored to consume `<AutoFormModal<T>>` so form-state, validation, and
 * field rendering all flow through the shared primitive instead of hand-
 * rolled `useState` + bespoke `<UnifiedModal>` form. Tags are kept as a
 * comma-separated text input parsed at submission time.
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
      options: [
        { label: "— Non assignée —", value: "" },
        ...personnel.map((p) => ({ label: `${p.firstName} ${p.lastName}`, value: p.id })),
      ],
    },
    { name: "dueDate", label: "Date d'échéance", type: "date" },
    { name: "tags", label: "Étiquettes", type: "text", wide: true, placeholder: "Séparées par des virgules…" },
    { name: "description", label: "Description", type: "textarea", wide: true, placeholder: "Objectifs, consignes…" },
  ];

  async function handleSubmit(data: TaskFormData) {
    if (!session) return;
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
