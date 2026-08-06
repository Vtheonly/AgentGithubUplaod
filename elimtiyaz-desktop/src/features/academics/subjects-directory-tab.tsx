import { useState } from "react";
import { Plus, BookOpen, Edit2, Archive, Filter, Search } from "lucide-react";
import { useRepositories } from "../../app/providers/repository-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import { useToast } from "../../app/providers/toast-provider";
import { useAuth } from "../../app/providers/auth-provider";
import { Card, CardContent } from "../../shared/ui/card";
import { Button } from "../../shared/ui/button";
import { Badge } from "../../shared/ui/badge";
import { Input } from "../../shared/ui/input";
import { Avatar, AvatarFallback } from "../../shared/ui/avatar";
import {
  UnifiedModal,
  ConfirmModal,
  type UnifiedModalProps,
} from "../../shared/ui/unified-modal";
import { FormField } from "../../shared/ui/form-field";
import { EmptyState } from "../../shared/layout/state-views";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../shared/ui/select";
import { Permission } from "../../core/rbac/permissions";
import {
  LEVEL_LABELS_FR,
  type AcademicLevel,
} from "../../domain/model/student";
import type { AcademicCycle, Subject } from "../../domain/model/academic";

type Alert = NonNullable<UnifiedModalProps["alert"]>;

interface SubjectFormState {
  name: string;
  code: string;
  cycle: AcademicCycle;
  level: AcademicLevel;
  coefficient: number;
  passingGrade: number;
  isExtracurricular: boolean;
  nameAr: string;
}

const INITIAL_FORM: SubjectFormState = {
  name: "",
  code: "",
  cycle: "primaire",
  level: "primaire",
  coefficient: 1,
  passingGrade: 10,
  isExtracurricular: false,
  nameAr: "",
};

export function SubjectsDirectoryTab() {
  const repos = useRepositories();
  const toast = useToast();
  const { session } = useAuth();
  const subjects = useObservable(() => repos.subjects.observe(), []);

  const [search, setSearch] = useState("");
  const [cycleFilter, setCycleFilter] = useState<string>("all");

  const [createOpen, setCreateOpen] = useState(false);
  const [editingSubject, setEditingSubject] = useState<Subject | null>(null);
  const [archivingSubject, setArchivingSubject] = useState<Subject | null>(
    null,
  );
  const [form, setForm] = useState<SubjectFormState>(INITIAL_FORM);
  const [alert, setAlert] = useState<Alert | null>(null);

  const canManage =
    !!session && session.permissions.has(Permission.ManageSubjects);

  const filtered = subjects.filter((s) => {
    if (cycleFilter !== "all" && s.cycle !== cycleFilter) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      s.name.toLowerCase().includes(q) ||
      s.code.toLowerCase().includes(q) ||
      (s.nameAr ?? "").toLowerCase().includes(q)
    );
  });

  function openCreateModal() {
    setForm(INITIAL_FORM);
    setAlert(null);
    setCreateOpen(true);
  }

  function openEditModal(s: Subject) {
    setForm({
      name: s.name,
      code: s.code,
      cycle: s.cycle,
      level: s.level,
      coefficient: s.coefficient,
      passingGrade: s.passingGrade,
      isExtracurricular: s.isExtracurricular,
      nameAr: s.nameAr ?? "",
    });
    setAlert(null);
    setEditingSubject(s);
  }

  async function handleCreate() {
    if (!form.name.trim() || !form.code.trim()) {
      setAlert({
        tone: "warning",
        title: "Validation",
        description: "Le nom et le code de la matière sont obligatoires.",
      });
      return;
    }

    const result = await repos.subjects.createSubject({
      name: form.name.trim(),
      code: form.code.trim().toUpperCase(),
      cycle: form.cycle,
      level: form.level,
      coefficient: form.coefficient,
      passingGrade: form.passingGrade,
      isExtracurricular: form.isExtracurricular,
      nameAr: form.nameAr.trim() || null,
      isActive: true,
      // Teacher normalization — new subjects start without a primary teacher.
      // The admin assigns a teacher via the Teacher → Subject assignment UI.
      teacherId: null,
      teacherName: null,
      academicYearId: "ay-2025-2026",
      academicYearCode: "2025-2026",
    });

    if (result.ok) {
      toast.showSuccess(
        "Matière créée",
        `${result.value.name} (${result.value.code}) a été ajoutée.`,
      );
      setCreateOpen(false);
    } else {
      setAlert({
        tone: "error",
        title: "Erreur",
        description: result.error.userMessage,
      });
    }
  }

  async function handleUpdate() {
    if (!editingSubject) return;
    if (!form.name.trim() || !form.code.trim()) {
      setAlert({
        tone: "warning",
        title: "Validation",
        description: "Le nom et le code sont obligatoires.",
      });
      return;
    }

    const coefChanged = form.coefficient !== editingSubject.coefficient;

    const result = await repos.subjects.updateSubject(editingSubject.id, {
      name: form.name.trim(),
      code: form.code.trim().toUpperCase(),
      cycle: form.cycle,
      level: form.level,
      coefficient: form.coefficient,
      passingGrade: form.passingGrade,
      isExtracurricular: form.isExtracurricular,
      nameAr: form.nameAr.trim() || null,
    });

    if (result.ok) {
      toast.showSuccess(
        "Matière mise à jour",
        coefChanged
          ? `Le coefficient a changé (${editingSubject.coefficient} → ${form.coefficient}). Un recalcul des moyennes sera effectué.`
          : "Les modifications ont été enregistrées.",
      );
      setEditingSubject(null);
    } else {
      setAlert({
        tone: "error",
        title: "Erreur",
        description: result.error.userMessage,
      });
    }
  }

  async function handleArchive() {
    if (!archivingSubject) return;
    const result = await repos.subjects.archiveSubject(archivingSubject.id);
    if (result.ok) {
      toast.showSuccess(
        "Matière archivée",
        `${archivingSubject.name} a été retirée.`,
      );
      setArchivingSubject(null);
    } else {
      toast.showError("Échec de l'archivage", result.error.userMessage);
    }
  }

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-0">
          <div className="flex items-center gap-2 border-b border-border p-3">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher par nom, code ou nom arabe…"
                className="pl-9"
              />
            </div>

            <Select value={cycleFilter} onValueChange={setCycleFilter}>
              <SelectTrigger className="w-44 h-9">
                <Filter className="h-3.5 w-3.5 mr-1" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les cycles</SelectItem>
                <SelectItem value="primaire">Primaire</SelectItem>
                <SelectItem value="cem">CEM (Collège)</SelectItem>
                <SelectItem value="lycee">Lycée</SelectItem>
              </SelectContent>
            </Select>

            {canManage && (
              <Button size="sm" onClick={openCreateModal}>
                <Plus className="h-4 w-4" /> Nouvelle matière
              </Button>
            )}
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              title="Aucune matière"
              description="Aucune matière ne correspond aux critères de recherche."
            />
          ) : (
            <ul className="divide-y divide-border">
              {filtered.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center gap-3 p-3.5 hover:bg-accent/5 transition-colors group"
                >
                  <Avatar className="h-9 w-9 rounded-md">
                    <AvatarFallback className="rounded-md font-mono text-xs bg-primary/10 text-primary">
                      {s.code.slice(0, 3)}
                    </AvatarFallback>
                  </Avatar>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-foreground">
                        {s.name}
                      </p>
                      <span className="font-mono text-xs text-muted-foreground">
                        ({s.code})
                      </span>
                      {s.nameAr && (
                        <span
                          className="text-xs text-muted-foreground"
                          dir="rtl"
                        >
                          {s.nameAr}
                        </span>
                      )}
                      <Badge variant="outline">
                        {LEVEL_LABELS_FR[s.level]}
                      </Badge>
                      {s.isExtracurricular && (
                        <Badge
                          variant="secondary"
                          className="bg-status-info/10 text-status-info border-status-info/20"
                        >
                          Club / Activité
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Coefficient :{" "}
                      <span className="font-mono font-bold text-foreground">
                        {s.coefficient}
                      </span>{" "}
                      · Seuil de passage :{" "}
                      <span className="font-mono">{s.passingGrade}/20</span>
                    </p>
                  </div>

                  {canManage && (
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => openEditModal(s)}
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-status-danger"
                        onClick={() => setArchivingSubject(s)}
                      >
                        <Archive className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <UnifiedModal
        open={createOpen || editingSubject !== null}
        onOpenChange={(o) => {
          if (!o) {
            setCreateOpen(false);
            setEditingSubject(null);
          }
        }}
        size="md"
        icon={BookOpen}
        iconTone="primary"
        title={
          editingSubject
            ? `Modifier ${editingSubject.name}`
            : "Nouvelle Matière"
        }
        description="Configuration de la matière et de sa pondération dans la moyenne globale Scolarité."
        submitLabel={
          editingSubject ? "Enregistrer les modifications" : "Créer la matière"
        }
        onSubmit={editingSubject ? handleUpdate : handleCreate}
        alert={alert}
        onDismissAlert={() => setAlert(null)}
      >
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <FormField label="Nom (Français)" required>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Mathématiques"
              />
            </FormField>

            <FormField
              label="Code court"
              required
              hint="Code unique (ex: MATH)"
            >
              <Input
                value={form.code}
                onChange={(e) =>
                  setForm({ ...form, code: e.target.value.toUpperCase() })
                }
                placeholder="MATH"
                className="font-mono uppercase"
              />
            </FormField>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <FormField label="Cycle" required>
              <Select
                value={form.cycle}
                onValueChange={(v) => {
                  const cycle = v as AcademicCycle;
                  const level: AcademicLevel =
                    cycle === "cem"
                      ? "cem"
                      : cycle === "lycee"
                        ? "lycee"
                        : "primaire";
                  setForm({ ...form, cycle, level });
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="primaire">Primaire</SelectItem>
                  <SelectItem value="cem">CEM (Collège)</SelectItem>
                  <SelectItem value="lycee">Lycée</SelectItem>
                </SelectContent>
              </Select>
            </FormField>

            <FormField label="Coefficient" required>
              <Input
                type="number"
                min={0.5}
                max={10}
                step={0.5}
                value={form.coefficient}
                onChange={(e) =>
                  setForm({ ...form, coefficient: Number(e.target.value) })
                }
                className="font-mono"
              />
            </FormField>

            <FormField label="Seuil admis" required hint="Sur 20">
              <Input
                type="number"
                min={0}
                max={20}
                step={0.5}
                value={form.passingGrade}
                onChange={(e) =>
                  setForm({ ...form, passingGrade: Number(e.target.value) })
                }
                className="font-mono"
              />
            </FormField>
          </div>

          <FormField label="Nom en Arabe (optionnel)">
            <Input
              value={form.nameAr}
              onChange={(e) => setForm({ ...form, nameAr: e.target.value })}
              placeholder="الرياضيات"
              dir="rtl"
            />
          </FormField>

          <label className="flex items-start gap-2.5 rounded-md border border-border p-3 cursor-pointer hover:bg-accent/5">
            <input
              type="checkbox"
              checked={form.isExtracurricular}
              onChange={(e) =>
                setForm({ ...form, isExtracurricular: e.target.checked })
              }
              className="h-4 w-4 mt-0.5"
            />
            <div className="text-xs">
              <p className="font-semibold text-foreground">
                Activité / Club Extracurriculaire
              </p>
              <p className="text-muted-foreground mt-0.5">
                Si coché, les notes obtenues dans cette matière ne seront
                **jamais** comptabilisées dans la moyenne générale académique
                Scolarité.
              </p>
            </div>
          </label>
        </div>
      </UnifiedModal>

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
