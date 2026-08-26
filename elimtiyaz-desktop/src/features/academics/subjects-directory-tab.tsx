/**
 * SubjectsDirectoryTab — refactored to use <DataTable> + <AutoFormModal>.
 * Savings: 473 → ~190 lines (-60%).
 */
import { useState } from "react";
import { Plus, Edit2, Archive } from "lucide-react";
import { z } from "zod";
import { useRepositories } from "../../app/providers/repository-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import { useToast } from "../../app/providers/toast-provider";
import { useAuth } from "../../app/providers/auth-provider";
import { Button } from "../../shared/ui/button";
import { Badge } from "../../shared/ui/badge";
import { ConfirmModal } from "../../shared/ui/unified-modal";
import { DataTable, type DataTableColumn } from "../../shared/ui/data-table";
import { AutoFormModal, type AutoFormField } from "../../shared/ui/auto-form";
import { Permission } from "../../core/rbac/permissions";
import { LEVEL_LABELS_FR, type AcademicLevel } from "../../domain/model/student";
import { useCurrentAcademicYear } from "./hooks/use-current-academic-year";
import type { AcademicCycle, Subject } from "../../domain/model/academic";

const CYCLE_OPTIONS = [
  { label: "Préscolaire", value: "prescolaire" },
  { label: "Primaire", value: "primaire" },
  { label: "CEM (Collège)", value: "cem" },
  { label: "Lycée", value: "lycee" },
];

const SubjectSchema = z.object({
  name: z.string().min(2, "Nom requis (min. 2 caractères)"),
  code: z.string().min(2, "Code requis (min. 2 caractères)"),
  cycle: z.enum(["prescolaire", "primaire", "cem", "lycee"]),
  level: z.enum(["prescolaire", "primaire", "cem", "lycee"]),
  coefficient: z.number().min(0.5).max(10),
  passingGrade: z.number().min(0).max(20),
  nameAr: z.string().optional().default(""),
  isExtracurricular: z.boolean().default(false),
});

type SubjectFormData = z.infer<typeof SubjectSchema>;

const SUBJECT_FIELDS: readonly AutoFormField[] = [
  { name: "name", label: "Nom (Français)", type: "text", required: true, placeholder: "Mathématiques", wide: true },
  { name: "code", label: "Code court", type: "text", required: true, placeholder: "MATH", help: "Code unique (ex: MATH)" },
  { name: "cycle", label: "Cycle", type: "select", required: true, options: CYCLE_OPTIONS },
  { name: "coefficient", label: "Coefficient", type: "number", required: true, min: 0.5, max: 10 },
  { name: "passingGrade", label: "Seuil admis", type: "number", required: true, min: 0, max: 20, help: "Sur 20" },
  { name: "nameAr", label: "Nom en Arabe (optionnel)", type: "text", placeholder: "الرياضيات", wide: true },
  { name: "isExtracurricular", label: "Activité / Club Extracurriculaire", type: "switch", wide: true,
    help: "Si coché, les notes ne seront pas comptabilisées dans la moyenne générale." },
];

export function SubjectsDirectoryTab() {
  const repos = useRepositories();
  const toast = useToast();
  const { session } = useAuth();
  const subjects = useObservable(() => repos.subjects.observe(), []);
  // FIX (vault §05.05): scope new subjects to the CURRENT academic year.
  const currentYear = useCurrentAcademicYear();

  const [createOpen, setCreateOpen] = useState(false);
  const [editingSubject, setEditingSubject] = useState<Subject | null>(null);
  const [archivingSubject, setArchivingSubject] = useState<Subject | null>(null);

  const canManage = !!session && session.permissions.has(Permission.ManageSubjects);

  const columns: readonly DataTableColumn<Subject>[] = [
    {
      header: "Matière",
      accessor: "name",
      cell: (s) => (
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs bg-primary/10 text-primary rounded px-1.5 py-0.5">{s.code}</span>
          <span className="font-medium">{s.name}</span>
          {s.nameAr && <span className="text-xs text-muted-foreground" dir="rtl">{s.nameAr}</span>}
        </div>
      ),
    },
    { header: "Cycle", accessor: (s) => LEVEL_LABELS_FR[s.level as AcademicLevel] },
    { header: "Coef.", accessor: "coefficient", cell: (s) => <span className="font-mono font-bold">{s.coefficient}</span> },
    { header: "Seuil", accessor: "passingGrade", cell: (s) => <span className="font-mono">{s.passingGrade}/20</span> },
    {
      header: "Type",
      accessor: (s) => s.isExtracurricular ? "Club" : "Standard",
      cell: (s) => s.isExtracurricular
        ? <Badge variant="secondary" className="bg-status-info/10 text-status-info border-status-info/20">Club / Activité</Badge>
        : <Badge variant="outline">Standard</Badge>,
    },
  ];

  const actions = canManage ? [
    { label: "Modifier", icon: <Edit2 className="size-3.5" />, variant: "ghost" as const, onClick: (s: Subject) => setEditingSubject(s) },
    { label: "Archiver", icon: <Archive className="size-3.5" />, variant: "ghost" as const,
      onClick: (s: Subject) => setArchivingSubject(s),
    },
  ] : [];

  async function handleSubmit(data: SubjectFormData) {
    const level = data.cycle as AcademicLevel;
    const payload = {
      name: data.name.trim(),
      code: data.code.trim().toUpperCase(),
      cycle: data.cycle as AcademicCycle,
      level,
      coefficient: data.coefficient,
      passingGrade: data.passingGrade,
      isExtracurricular: data.isExtracurricular,
      nameAr: (data.nameAr ?? "").trim() || null,
      isActive: true,
      teacherId: null,
      teacherName: null,
      academicYearId: currentYear.id,
      academicYearCode: currentYear.code,
    };

    if (editingSubject) {
      const coefChanged = data.coefficient !== editingSubject.coefficient;
      const result = await repos.subjects.updateSubject(editingSubject.id, payload);
      if (result.ok) {
        toast.showSuccess("Matière mise à jour",
          coefChanged
            ? `Le coefficient a changé (${editingSubject.coefficient} → ${data.coefficient}). Un recalcul des moyennes sera effectué.`
            : "Les modifications ont été enregistrées.");
        setEditingSubject(null);
      } else {
        throw new Error(result.error.userMessage);
      }
    } else {
      const result = await repos.subjects.createSubject(payload);
      if (result.ok) {
        toast.showSuccess("Matière créée", `${result.value.name} (${result.value.code}) a été ajoutée.`);
        setCreateOpen(false);
      } else {
        throw new Error(result.error.userMessage);
      }
    }
  }

  async function handleArchive() {
    if (!archivingSubject) return;
    const result = await repos.subjects.archiveSubject(archivingSubject.id);
    if (result.ok) {
      toast.showSuccess("Matière archivée", `${archivingSubject.name} a été retirée.`);
      setArchivingSubject(null);
    } else {
      toast.showError("Échec de l'archivage", result.error.userMessage);
    }
  }

  const editingInitialValues = editingSubject ? {
    name: editingSubject.name,
    code: editingSubject.code,
    cycle: editingSubject.cycle,
    level: editingSubject.level,
    coefficient: editingSubject.coefficient,
    passingGrade: editingSubject.passingGrade,
    nameAr: editingSubject.nameAr ?? "",
    isExtracurricular: editingSubject.isExtracurricular,
  } : undefined;

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        {canManage && (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" /> Nouvelle matière
          </Button>
        )}
      </div>

      <DataTable<Subject>
        data={subjects}
        columns={columns}
        actions={actions}
        searchFields={["name", "code", "nameAr"]}
        searchPlaceholder="Rechercher par nom, code ou nom arabe…"
        emptyMessage="Aucune matière. Cliquez sur « Nouvelle matière » pour en créer une."
        pageSize={15}
      />

      <AutoFormModal
        open={createOpen || editingSubject !== null}
        onOpenChange={(o) => { if (!o) { setCreateOpen(false); setEditingSubject(null); } }}
        title={editingSubject ? `Modifier ${editingSubject.name}` : "Nouvelle Matière"}
        description="Configuration de la matière et de sa pondération dans la moyenne globale Scolarité."
        schema={SubjectSchema}
        fields={SUBJECT_FIELDS}
        initialValues={editingInitialValues}
        onSubmit={handleSubmit}
        submitLabel={editingSubject ? "Enregistrer les modifications" : "Créer la matière"}
      />

      <ConfirmModal
        open={archivingSubject !== null}
        onOpenChange={(o) => !o && setArchivingSubject(null)}
        title={`Archiver la matière ${archivingSubject?.name ?? ""}`}
        description="Cette matière sera masquée pour les futures saisies. L'historique des notes passées reste intact."
        confirmLabel="Archiver la matière"
        destructive
        onConfirm={handleArchive}
      />
    </div>
  );
}
