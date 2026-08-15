/**
 * SchoolYearsTab — refactored to use <AutoFormModal> + <ConfirmModal>.
 * Savings: 645 → ~280 lines (-57%).
 */
import { useState } from "react";
import { Plus, Archive, ArchiveRestore, Trash2, Star, Pencil, Calendar } from "lucide-react";
import { z } from "zod";
import { Card, CardContent } from "../../shared/ui/card";
import { Button } from "../../shared/ui/button";
import { Badge } from "../../shared/ui/badge";
import { AutoFormModal, type AutoFormField } from "../../shared/ui/auto-form";
import { ConfirmModal } from "../../shared/ui/unified-modal";
import { useRepositories } from "../../app/providers/repository-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import { useToast } from "../../app/providers/toast-provider";
import { useAuth } from "../../app/providers/auth-provider";
import type { AcademicYear } from "../../domain/model/academic";
import type { CreateSchoolYearInput } from "../../domain/calc/academics/school-year";
import { Permission } from "../../core/rbac/permissions";
import { AcademicYearDetailDrawer } from "./academic-year-detail-drawer";

const TERM_STRUCTURE_LABELS: Record<string, string> = {
  semester: "Semestres", trimester: "Trimestres", quarter: "Quarts",
};

const TERM_OPTIONS = [
  { label: "Trimestres (3)", value: "trimester" },
  { label: "Semestres (2)", value: "semester" },
  { label: "Quarts (4)", value: "quarter" },
];

const SchoolYearSchema = z.object({
  code: z.string().min(4, "Code requis (ex: 2026-2027)"),
  label: z.string().optional().default(""),
  startDate: z.string().min(4, "Date de début requise"),
  endDate: z.string().min(4, "Date de fin requise"),
  termStructure: z.enum(["semester", "trimester", "quarter"]),
  isCurrent: z.boolean().default(false),
});

type SchoolYearFormData = z.infer<typeof SchoolYearSchema>;

const FORM_FIELDS: readonly AutoFormField[] = [
  { name: "code", label: "Code", type: "text", required: true, placeholder: "2026-2027", help: "Ex. 2026-2027" },
  { name: "termStructure", label: "Structure", type: "select", required: true, options: TERM_OPTIONS },
  { name: "label", label: "Libellé", type: "text", wide: true, placeholder: "Année scolaire 2026-2027", help: "Optionnel — généré si vide" },
  { name: "startDate", label: "Date de début", type: "date", required: true },
  { name: "endDate", label: "Date de fin", type: "date", required: true },
  { name: "isCurrent", label: "Définir comme année courante", type: "switch", wide: true,
    help: "Cocher pour désigner cette année comme l'année courante (désactive les autres)" },
];

const EDIT_FIELDS: readonly AutoFormField[] = [
  { name: "label", label: "Libellé", type: "text", required: true, wide: true },
  { name: "startDate", label: "Date de début", type: "date", required: true },
  { name: "endDate", label: "Date de fin", type: "date", required: true },
  { name: "termStructure", label: "Structure", type: "select", required: true, options: TERM_OPTIONS, wide: true },
];

function buildDefaultCode(): string {
  const now = new Date();
  const y = now.getFullYear();
  return `${y}-${y + 1}`;
}

export function SchoolYearsTab() {
  const repos = useRepositories();
  const toast = useToast();
  const { session } = useAuth();
  const years = useObservable(() => repos.academicYears.observeAll(), []);
  const [showArchived, setShowArchived] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AcademicYear | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AcademicYear | null>(null);
  const [detailTarget, setDetailTarget] = useState<AcademicYear | null>(null);

  const canManage = !!session && session.permissions.has(Permission.ManageSchoolYears);
  const visibleYears = showArchived ? years : years.filter((y) => !y.isArchived);
  const sorted = [...visibleYears].sort((a, b) => b.code.localeCompare(a.code));

  async function handleSetCurrent(year: AcademicYear) {
    if (!session) return;
    const res = await repos.academicYears.setCurrentYear(year.id, session.userId, session.displayName);
    if (res.ok) toast.showSuccess("Année courante mise à jour", `L'année ${year.code} est maintenant l'année courante.`);
    else toast.showError("Échec", res.error.userMessage);
  }

  async function handleArchive(year: AcademicYear) {
    if (!session) return;
    const res = await repos.academicYears.archiveAcademicYear(year.id, session.userId, session.displayName);
    if (res.ok) toast.showSuccess("Année archivée", `${year.label} a été archivée.`);
    else toast.showError("Échec de l'archivage", res.error.userMessage);
  }

  async function handleRestore(year: AcademicYear) {
    if (!session) return;
    const res = await repos.academicYears.restoreAcademicYear(year.id, session.userId, session.displayName);
    if (res.ok) toast.showSuccess("Année restaurée", `${year.label} a été restaurée.`);
    else toast.showError("Échec de la restauration", res.error.userMessage);
  }

  async function handleCreateSubmit(data: SchoolYearFormData) {
    if (!session) return;
    const input: CreateSchoolYearInput = {
      code: data.code.trim(),
      label: (data.label ?? "").trim() || `Année scolaire ${data.code.trim()}`,
      startDate: data.startDate, endDate: data.endDate,
      termStructure: data.termStructure, isCurrent: data.isCurrent,
    };
    const res = await repos.academicYears.createAcademicYear(input, session.userId, session.displayName);
    if (res.ok) {
      toast.showSuccess("Année créée", `L'année ${input.code} a été créée avec succès.`);
      setCreateOpen(false);
    } else {
      throw new Error(res.error.userMessage);
    }
  }

  async function handleEditSubmit(data: SchoolYearFormData) {
    if (!session || !editTarget) return;
    const res = await repos.academicYears.updateAcademicYear(
      editTarget.id,
      {
        label: (data.label ?? "").trim() || editTarget.label,
        startDate: data.startDate, endDate: data.endDate,
        termStructure: data.termStructure,
      },
      session.userId, session.displayName,
    );
    if (res.ok) {
      toast.showSuccess("Année modifiée", `${editTarget.code} a été mise à jour.`);
      setEditTarget(null);
    } else {
      throw new Error(res.error.userMessage);
    }
  }

  async function handleDeleteConfirmed() {
    if (!session || !deleteTarget) return;
    const res = await repos.academicYears.deleteAcademicYear(deleteTarget.id, session.userId, session.displayName);
    if (res.ok) {
      toast.showSuccess("Année supprimée", `${deleteTarget.label} a été supprimée.`);
      setDeleteTarget(null);
    } else {
      toast.showError("Échec de la suppression", res.error.userMessage);
    }
  }

  const editInitialValues = editTarget ? {
    code: editTarget.code,
    label: editTarget.label,
    startDate: editTarget.startDate,
    endDate: editTarget.endDate,
    termStructure: editTarget.termStructure,
    isCurrent: editTarget.isCurrent,
  } : undefined;

  const createInitialValues = {
    code: buildDefaultCode(),
    label: "",
    startDate: `${buildDefaultCode().slice(0, 4)}-09-01`,
    endDate: `${buildDefaultCode().slice(5)}-06-30`,
    termStructure: "trimester" as const,
    isCurrent: false,
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Calendar className="size-4 text-muted-foreground ml-1" />
            <span className="text-xs font-medium text-muted-foreground">
              {years.filter((y) => y.isCurrent).length} année courante ·{" "}
              {years.filter((y) => !y.isArchived).length} actives ·{" "}
              {years.filter((y) => y.isArchived).length} archivées
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant={showArchived ? "default" : "outline"} onClick={() => setShowArchived((v) => !v)}>
              <Archive className="size-3.5 mr-1" />
              {showArchived ? "Masquer archivées" : "Voir archivées"}
            </Button>
            {canManage && (
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="size-3.5 mr-1" /> Nouvelle année
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {sorted.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">
          Aucune année scolaire. Cliquez sur « Nouvelle année » pour créer la première.
        </CardContent></Card>
      ) : (
        <div className="grid gap-3 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {sorted.map((year) => (
            <YearCard
              key={year.id} year={year} canManage={canManage}
              onOpenDetail={() => setDetailTarget(year)}
              onSetCurrent={() => handleSetCurrent(year)}
              onEdit={() => setEditTarget(year)}
              onArchive={() => handleArchive(year)}
              onRestore={() => handleRestore(year)}
              onDelete={() => setDeleteTarget(year)}
            />
          ))}
        </div>
      )}

      {detailTarget && (
        <AcademicYearDetailDrawer year={detailTarget} open={!!detailTarget} onOpenChange={(o) => !o && setDetailTarget(null)} canManage={canManage} />
      )}

      <AutoFormModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="Créer une année scolaire"
        description="Format attendu : AAAA-AAAA (ex. 2026-2027). L'année de fin doit être l'année suivante."
        schema={SchoolYearSchema}
        fields={FORM_FIELDS}
        initialValues={createInitialValues}
        onSubmit={handleCreateSubmit}
        submitLabel="Créer l'année"
      />

      <AutoFormModal
        open={editTarget !== null}
        onOpenChange={(o) => !o && setEditTarget(null)}
        title={`Modifier ${editTarget?.code ?? ""}`}
        description="Le code ne peut pas être modifié (identifiant stable)."
        schema={SchoolYearSchema}
        fields={EDIT_FIELDS}
        initialValues={editInitialValues}
        onSubmit={handleEditSubmit}
        submitLabel="Enregistrer"
      />

      <ConfirmModal
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={`Supprimer ${deleteTarget?.code ?? ""} ?`}
        description="Cette action est irréversible. L'année ne peut être supprimée que si elle n'est pas courante et qu'aucune classe / élève n'y est rattaché."
        confirmLabel="Supprimer définitivement"
        destructive
        onConfirm={handleDeleteConfirmed}
      />
    </div>
  );
}

function YearCard({ year, canManage, onOpenDetail, onSetCurrent, onEdit, onArchive, onRestore, onDelete }: {
  year: AcademicYear; canManage: boolean;
  onOpenDetail: () => void; onSetCurrent: () => void; onEdit: () => void;
  onArchive: () => void; onRestore: () => void; onDelete: () => void;
}) {
  return (
    <Card
      className={`${year.isArchived ? "opacity-60" : ""} hover:border-primary/40 transition-all cursor-pointer group`}
      onClick={onOpenDetail}
    >
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-foreground group-hover:text-primary transition-colors">{year.code}</h3>
              {year.isCurrent && <Badge className="text-[10px]"><Star className="size-3 mr-1" />Courante</Badge>}
              {year.isArchived && <Badge variant="secondary" className="text-[10px]">Archivée</Badge>}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{year.label}</p>
          </div>
          <Badge variant="outline" className="text-[10px]">{TERM_STRUCTURE_LABELS[year.termStructure] ?? year.termStructure}</Badge>
        </div>
        <div className="text-xs text-muted-foreground space-y-1">
          <div><strong>Début :</strong> {year.startDate}</div>
          <div><strong>Fin :</strong> {year.endDate}</div>
        </div>
        {canManage && (
          <div className="pt-2 border-t border-border/50 flex items-center gap-1 flex-wrap" onClick={(e) => e.stopPropagation()}>
            {!year.isCurrent && !year.isArchived && (
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onSetCurrent}>
                <Star className="size-3 mr-1" />Définir courante
              </Button>
            )}
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onEdit}>
              <Pencil className="size-3 mr-1" />Modifier
            </Button>
            {!year.isArchived ? (
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onArchive}>
                <Archive className="size-3 mr-1" />Archiver
              </Button>
            ) : (
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onRestore}>
                <ArchiveRestore className="size-3 mr-1" />Restaurer
              </Button>
            )}
            <Button size="sm" variant="outline" className="h-7 text-xs text-status-danger hover:bg-status-danger/10" onClick={onDelete}>
              <Trash2 className="size-3 mr-1" />Supprimer
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
