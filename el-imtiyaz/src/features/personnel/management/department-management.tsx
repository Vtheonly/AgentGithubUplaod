/**
 * DepartmentManagement — grid of department cards with full CRUD.
 *
 * Each card shows: name, description, head (personnel name), headcount,
 * archived badge. Actions per card: Edit, Archive/Unarchive, Delete.
 *
 * "New department" button opens a <UnifiedModal> form with name, description,
 * color picker (DEPARTMENT_COLOR_OPTIONS), and head selector.
 *
 * All confirmations use <UnifiedModal> via ConfirmModal presets.
 */
import { useMemo, useState } from "react";
import { Building2, Plus, Pencil, Archive, ArchiveRestore, Trash2, Users } from "lucide-react";
import { useRepositories } from "../../../app/providers/repository-provider";
import { useObservable } from "../../../shared/hooks/use-observable";
import { useToast } from "../../../app/providers/toast-provider";
import { DashboardSection } from "../dashboards/dashboard-primitives";
import { Button } from "../../../shared/ui/button";
import { Input } from "../../../shared/ui/input";
import { Textarea } from "../../../shared/ui/textarea";
import { StatusChip } from "../../../shared/ui/status-chip";
import { FormField } from "../../../shared/ui/form-field";
import { UnifiedModal, ConfirmModal } from "../../../shared/ui/unified-modal";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../../../shared/ui/select";
import {
  DEPARTMENT_COLOR_OPTIONS,
  type Department, type DepartmentColor,
} from "../../../domain/model/workforce";

const COLOR_SWATCHES: Record<DepartmentColor, string> = {
  "brand-blue": "bg-brand-blue",
  "brand-blue-deep": "bg-brand-blue-deep",
  "brand-gold": "bg-brand-gold",
  "brand-brown": "bg-brand-brown",
  "brand-slate": "bg-brand-slate",
  "status-success": "bg-status-success",
  "status-warning": "bg-status-warning",
  "status-danger": "bg-status-danger",
  "status-info": "bg-status-info",
};

const COLOR_LABELS_FR: Record<DepartmentColor, string> = {
  "brand-blue": "Bleu",
  "brand-blue-deep": "Bleu foncé",
  "brand-gold": "Or",
  "brand-brown": "Marron",
  "brand-slate": "Ardoise",
  "status-success": "Vert",
  "status-warning": "Orange",
  "status-danger": "Rouge",
  "status-info": "Cyan",
};

interface FormState {
  name: string;
  description: string;
  color: DepartmentColor;
  headId: string;
  parentId: string;
}

function emptyForm(): FormState {
  return { name: "", description: "", color: "brand-blue", headId: "", parentId: "" };
}

function fromDepartment(d: Department): FormState {
  return {
    name: d.name,
    description: d.description,
    color: (d.color as DepartmentColor) ?? "brand-blue",
    headId: d.headId ?? "",
    parentId: d.parentId ?? "",
  };
}

export function DepartmentManagement() {
  const repos = useRepositories();
  const toast = useToast();
  const departments = useObservable(() => repos.departments.observe(), []);
  const personnel = useObservable(() => repos.personnel.observe(), []);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<Department | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Department | null>(null);

  const headcountByDept = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of personnel) {
      if (!p.departmentId) continue;
      map.set(p.departmentId, (map.get(p.departmentId) ?? 0) + 1);
    }
    return map;
  }, [personnel]);

  const personnelName = (id: string | null | undefined): string | null => {
    if (!id) return null;
    const p = personnel.find((x) => x.id === id);
    return p ? `${p.firstName} ${p.lastName}` : null;
  };

  function openNew() {
    setEditingId(null);
    setForm(emptyForm());
    setError(null);
    setFormOpen(true);
  }

  function openEdit(d: Department) {
    setEditingId(d.id);
    setForm(fromDepartment(d));
    setError(null);
    setFormOpen(true);
  }

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((s) => ({ ...s, [key]: value }));
  }

  async function handleSubmit() {
    if (!form.name.trim()) {
      setError("Le nom du département est obligatoire.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const payload = {
      name: form.name.trim(),
      description: form.description.trim(),
      color: form.color,
      headId: form.headId || null,
      parentId: form.parentId || null,
    };
    if (editingId) {
      const result = await repos.departments.updateDepartment(editingId, payload);
      setSubmitting(false);
      if (result.ok) {
        toast.showSuccess("Département modifié", `« ${payload.name} » a été mis à jour.`);
        setFormOpen(false);
      } else {
        setError(result.error.userMessage);
      }
    } else {
      const result = await repos.departments.createDepartment(payload);
      setSubmitting(false);
      if (result.ok) {
        toast.showSuccess("Département créé", `« ${payload.name} » a été ajouté.`);
        setFormOpen(false);
      } else {
        setError(result.error.userMessage);
      }
    }
  }

  async function handleArchive(d: Department) {
    if (d.archivedAt) {
      const r = await repos.departments.unarchiveDepartment(d.id);
      if (r.ok) toast.showSuccess("Département restauré", `« ${d.name} » est à nouveau actif.`);
      else toast.showError("Erreur", r.error.userMessage);
    } else {
      const r = await repos.departments.archiveDepartment(d.id);
      if (r.ok) toast.showSuccess("Département archivé", `« ${d.name} » a été archivé.`);
      else toast.showError("Erreur", r.error.userMessage);
    }
    setArchiveTarget(null);
  }

  async function handleDelete(d: Department) {
    const r = await repos.departments.deleteDepartment(d.id);
    setDeleteTarget(null);
    if (r.ok) toast.showSuccess("Département supprimé", `« ${d.name} » a été supprimé.`);
    else toast.showError("Erreur", r.error.userMessage);
  }

  return (
    <>
      <DashboardSection
        title="Départements"
        icon={Building2}
        action={
          <Button size="sm" onClick={openNew}>
            <Plus className="h-4 w-4" /> Nouveau département
          </Button>
        }
      >
        {departments.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            Aucun département. Créez-en un pour commencer.
          </p>
        ) : (
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {departments.map((d) => {
              const head = personnelName(d.headId);
              const count = headcountByDept.get(d.id) ?? 0;
              const archived = !!d.archivedAt;
              return (
                <div
                  key={d.id}
                  className="rounded-lg border border-border bg-card p-4 flex flex-col gap-2"
                >
                  <div className="flex items-start gap-2">
                    <span className={`mt-1 h-3 w-3 rounded-full shrink-0 ${COLOR_SWATCHES[(d.color as DepartmentColor) ?? "brand-blue"]}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-foreground truncate">{d.name}</p>
                        {archived && <StatusChip label="Archivé" tone="neutral" />}
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2">{d.description || "—"}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Users className="h-3.5 w-3.5" /> {count} employé{count > 1 ? "s" : ""}
                    </span>
                    <span className="inline-flex items-center gap-1 truncate">
                      <Building2 className="h-3.5 w-3.5" /> {head ?? "Sans responsable"}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 mt-1 pt-2 border-t border-border">
                    <Button size="sm" variant="ghost" onClick={() => openEdit(d)}>
                      <Pencil className="h-3.5 w-3.5" /> Modifier
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setArchiveTarget(d)}>
                      {archived ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
                      {archived ? "Restaurer" : "Archiver"}
                    </Button>
                    <Button size="sm" variant="ghost" className="text-status-danger hover:text-status-danger" onClick={() => setDeleteTarget(d)}>
                      <Trash2 className="h-3.5 w-3.5" /> Supprimer
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </DashboardSection>

      {/* Create / edit modal */}
      <UnifiedModal
        open={formOpen}
        onOpenChange={setFormOpen}
        variant="dialog"
        size="md"
        icon={editingId ? Pencil : Plus}
        iconTone="primary"
        title={editingId ? "Modifier le département" : "Nouveau département"}
        description="Les départements regroupent le personnel et les canaux de discussion."
        submitLabel={editingId ? "Enregistrer" : "Créer"}
        submitLoading={submitting}
        onSubmit={handleSubmit}
        alert={error ? { tone: "error", title: "Erreur", description: error } : null}
        onDismissAlert={() => setError(null)}
      >
        <div className="space-y-3">
          <FormField label="Nom" required>
            <Input value={form.name} onChange={(e) => update("name", e.target.value)} placeholder="Ex. Enseignants" />
          </FormField>
          <FormField label="Description">
            <Textarea
              value={form.description}
              onChange={(e) => update("description", e.target.value)}
              placeholder="Rôle du département dans l'organisation"
              rows={2}
            />
          </FormField>
          <FormField label="Couleur">
            <div className="flex flex-wrap gap-2">
              {DEPARTMENT_COLOR_OPTIONS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => update("color", c)}
                  title={COLOR_LABELS_FR[c]}
                  className={`h-8 w-8 rounded-full border-2 transition ${COLOR_SWATCHES[c]} ${
                    form.color === c ? "border-foreground ring-2 ring-ring" : "border-transparent"
                  }`}
                  aria-label={COLOR_LABELS_FR[c]}
                />
              ))}
            </div>
          </FormField>
          <FormField label="Responsable">
            <Select value={form.headId} onValueChange={(v) => update("headId", v)}>
              <SelectTrigger><SelectValue placeholder="Aucun responsable" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">Aucun</SelectItem>
                {personnel.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.firstName} {p.lastName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Département parent">
            <Select value={form.parentId} onValueChange={(v) => update("parentId", v)}>
              <SelectTrigger><SelectValue placeholder="Aucun (top-level)" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">Aucun</SelectItem>
                {departments.filter((d) => d.id !== editingId).map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        </div>
      </UnifiedModal>

      {/* Archive confirmation */}
      <ConfirmModal
        open={!!archiveTarget}
        onOpenChange={(o) => !o && setArchiveTarget(null)}
        title={archiveTarget?.archivedAt ? "Restaurer le département ?" : "Archiver le département ?"}
        description={
          archiveTarget?.archivedAt
            ? `« ${archiveTarget.name} » sera à nouveau visible et actif.`
            : `« ${archiveTarget?.name} » sera masqué des sélecteurs mais conservé dans l'historique.`
        }
        confirmLabel={archiveTarget?.archivedAt ? "Restaurer" : "Archiver"}
        destructive={!archiveTarget?.archivedAt}
        onConfirm={() => { if (archiveTarget) void handleArchive(archiveTarget); }}
      />

      {/* Delete confirmation */}
      <ConfirmModal
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Supprimer définitivement ?"
        description={`« ${deleteTarget?.name} » sera supprimé. Cette action est irréversible.`}
        confirmLabel="Supprimer"
        destructive
        onConfirm={() => { if (deleteTarget) void handleDelete(deleteTarget); }}
      />
    </>
  );
}
