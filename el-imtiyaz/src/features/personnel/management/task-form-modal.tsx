/**
 * TaskFormModal — create form for a new Task.
 *
 * Fields: title, description, priority dropdown, department dropdown,
 * multi-select assignees, due date, tags (comma-separated).
 *
 * Submits via `repos.tasks.createTask`. The actor (creator) is the current
 * session user. Tags are parsed from a comma-separated string into an array.
 */
import { useState } from "react";
import { Plus, ListChecks } from "lucide-react";
import { useRepositories } from "../../../app/providers/repository-provider";
import { useObservable } from "../../../shared/hooks/use-observable";
import { useAuth } from "../../../app/providers/auth-provider";
import { useToast } from "../../../app/providers/toast-provider";
import { UnifiedModal } from "../../../shared/ui/unified-modal";
import { FormField } from "../../../shared/ui/form-field";
import { Input } from "../../../shared/ui/input";
import { Textarea } from "../../../shared/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../../../shared/ui/select";
import {
  TASK_PRIORITY_LABELS_FR,
  type TaskPriority,
} from "../../../domain/model/workforce";

const PRIORITIES: readonly TaskPriority[] = ["low", "medium", "high", "urgent"];

interface FormState {
  title: string;
  description: string;
  priority: TaskPriority;
  departmentId: string;
  assigneeIds: string[];
  dueDate: string;
  tags: string;
}

function emptyForm(): FormState {
  return {
    title: "",
    description: "",
    priority: "medium",
    departmentId: "",
    assigneeIds: [],
    dueDate: "",
    tags: "",
  };
}

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

  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((s) => ({ ...s, [key]: value }));
  }

  function toggleAssignee(id: string) {
    setForm((s) => ({
      ...s,
      assigneeIds: s.assigneeIds.includes(id)
        ? s.assigneeIds.filter((x) => x !== id)
        : [...s.assigneeIds, id],
    }));
  }

  function reset() {
    setForm(emptyForm());
    setError(null);
  }

  async function handleSubmit() {
    if (!form.title.trim()) {
      setError("Le titre est obligatoire.");
      return;
    }
    if (!session) {
      setError("Session expirée. Reconnectez-vous.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const tags = form.tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const result = await repos.tasks.createTask({
      title: form.title.trim(),
      description: form.description.trim(),
      priority: form.priority,
      departmentId: form.departmentId || null,
      assigneeIds: form.assigneeIds,
      dueDate: form.dueDate || null,
      createdBy: session.userId,
      createdByName: session.displayName,
      tags,
    });
    setSubmitting(false);
    if (result.ok) {
      toast.showSuccess("Tâche créée", `« ${result.value.title} » a été ajoutée au tableau.`);
      reset();
      onCreated?.();
      onOpenChange(false);
    } else {
      setError(result.error.userMessage);
    }
  }

  // Reset on close
  function handleOpenChange(o: boolean) {
    if (!o) reset();
    onOpenChange(o);
  }

  // Filter personnel by selected department (if any)
  const candidateAssignees = form.departmentId
    ? personnel.filter((p) => p.departmentId === form.departmentId)
    : personnel;

  return (
    <UnifiedModal
      open={open}
      onOpenChange={handleOpenChange}
      variant="dialog"
      size="lg"
      icon={session ? Plus : ListChecks}
      iconTone="primary"
      title="Nouvelle tâche"
      description="Renseignez le titre, la priorité et les affectations."
      submitLabel="Créer la tâche"
      submitLoading={submitting}
      onSubmit={handleSubmit}
      alert={error ? { tone: "error", title: "Erreur", description: error } : null}
      onDismissAlert={() => setError(null)}
    >
      <div className="space-y-4">
        <FormField label="Titre" required>
          <Input
            value={form.title}
            onChange={(e) => update("title", e.target.value)}
            placeholder="Ex. Préparer les bulletins Q1"
          />
        </FormField>
        <FormField label="Description">
          <Textarea
            value={form.description}
            onChange={(e) => update("description", e.target.value)}
            placeholder="Détails, contexte, objectifs…"
            rows={3}
          />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Priorité" required>
            <Select value={form.priority} onValueChange={(v) => update("priority", v as TaskPriority)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PRIORITIES.map((p) => (
                  <SelectItem key={p} value={p}>{TASK_PRIORITY_LABELS_FR[p]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Échéance">
            <Input type="date" value={form.dueDate} onChange={(e) => update("dueDate", e.target.value)} />
          </FormField>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Département">
            <Select value={form.departmentId} onValueChange={(v) => update("departmentId", v)}>
              <SelectTrigger><SelectValue placeholder="Aucun département" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">Aucun</SelectItem>
                {departments.filter((d) => !d.archivedAt).map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Tags (séparés par des virgules)">
            <Input
              value={form.tags}
              onChange={(e) => update("tags", e.target.value)}
              placeholder="Ex. achat, rentree"
            />
          </FormField>
        </div>
        <FormField
          label="Affectations"
          hint={form.departmentId ? "Personnel du département sélectionné." : "Tous les employés sont éligibles."}
        >
          <div className="border border-border rounded-md max-h-44 overflow-y-auto divide-y divide-border">
            {candidateAssignees.length === 0 ? (
              <p className="p-3 text-xs text-muted-foreground text-center">Aucun employé à affecter.</p>
            ) : (
              candidateAssignees.map((p) => {
                const checked = form.assigneeIds.includes(p.id);
                return (
                  <label
                    key={p.id}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-accent/5"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleAssignee(p.id)}
                      className="h-4 w-4 accent-primary"
                    />
                    <span className="flex-1 truncate">
                      {p.firstName} {p.lastName}
                    </span>
                    <span className="text-[11px] text-muted-foreground truncate">{p.position || "—"}</span>
                  </label>
                );
              })
            )}
          </div>
          {form.assigneeIds.length > 0 && (
            <p className="text-[11px] text-muted-foreground mt-1">
              {form.assigneeIds.length} personne(s) sélectionnée(s).
            </p>
          )}
        </FormField>
      </div>
    </UnifiedModal>
  );
}
