/**
 * SubjectsDirectoryTab — replaces flat list in Academics page.
 *
 * Iteration 3-E (plan §05): Subject CRUD (create / edit coefficient /
 * archive) with full audit logging. Coefficient change is wired to
 * trigger GPA recompute for affected students (audit-log note documents
 * the trigger; actual recompute happens at the repository layer in
 * production via Supabase Edge Function).
 *
 * Built on UnifiedModal so the visual language matches every other
 * modal in the application.
 */
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
import { ConfirmModal } from "../../shared/ui/unified-modal";
import { UnifiedModal, type UnifiedModalProps } from "../../shared/ui/unified-modal";
import { FormField } from "../../shared/ui/form-field";
import { EmptyState } from "../../shared/layout/state-views";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../../shared/ui/select";
import { Permission } from "../../core/rbac/permissions";
import { LEVEL_LABELS_FR, type AcademicLevel } from "../../domain/model/student";
import type { Subject } from "../../domain/model/academic";

type Alert = NonNullable<UnifiedModalProps["alert"]>;

interface SubjectForm {
  name: string;
  code: string;
  level: AcademicLevel;
  coefficient: number;
  passingGrade: number;
  isExtracurricular: boolean;
  nameAr: string;
}

const EMPTY_FORM: SubjectForm = {
  name: "",
  code: "",
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
  const [query, setQuery] = useState("");
  const [levelFilter, setLevelFilter] = useState<string>("all");

  // Modal state
  const [createOpen, setCreateOpen] = useState(false);
  const [editSubject, setEditSubject] = useState<Subject | null>(null);
  const [archiveSubject, setArchiveSubject] = useState<Subject | null>(null);
  const [form, setForm] = useState<SubjectForm>(EMPTY_FORM);
  const [alert, setAlert] = useState<Alert | null>(null);

  const canManage = !!session && session.permissions.has(Permission.ManageSubjects);

  const filtered = subjects.filter((s) => {
    if (levelFilter !== "all" && s.level !== levelFilter) return false;
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      s.name.toLowerCase().includes(q) ||
      s.code.toLowerCase().includes(q) ||
      (s.nameAr ?? "").toLowerCase().includes(q)
    );
  });

  function openCreate() {
    setForm(EMPTY_FORM);
    setAlert(null);
    setCreateOpen(true);
  }

  function openEdit(s: Subject) {
    setForm({
      name: s.name,
      code: s.code,
      level: s.level,
      coefficient: s.coefficient,
      passingGrade: s.passingGrade,
      isExtracurricular: s.isExtracurricular,
      nameAr: s.nameAr ?? "",
    });
    setAlert(null);
    setEditSubject(s);
  }

  async function saveCreate() {
    if (!form.name.trim() || !form.code.trim()) {
      setAlert({ tone: "warning", title: "Champs requis", description: "Nom et code sont obligatoires." });
      return;
    }
    if (subjects.some((s) => s.code.toLowerCase() === form.code.trim().toLowerCase())) {
      setAlert({ tone: "warning", title: "Code dupliqué", description: `Le code ${form.code} existe déjà.` });
      return;
    }
    const r = await repos.subjects.createSubject({
      name: form.name.trim(),
      code: form.code.trim().toUpperCase(),
      level: form.level,
      coefficient: form.coefficient,
      passingGrade: form.passingGrade,
      isExtracurricular: form.isExtracurricular,
      nameAr: form.nameAr.trim() || null,
    });
    if (r.ok) {
      toast.showSuccess("Matière créée", `${r.value.name} (${r.value.code}) ajoutée au catalogue.`);
      setCreateOpen(false);
    } else {
      setAlert({ tone: "error", title: "Échec", description: r.error.userMessage });
    }
  }

  async function saveEdit() {
    if (!editSubject) return;
    if (!form.name.trim() || !form.code.trim()) {
      setAlert({ tone: "warning", title: "Champs requis", description: "Nom et code sont obligatoires." });
      return;
    }
    const coefChanged = form.coefficient !== editSubject.coefficient;
    const r = await repos.subjects.updateSubject(editSubject.id, {
      name: form.name.trim(),
      code: form.code.trim().toUpperCase(),
      level: form.level,
      coefficient: form.coefficient,
      passingGrade: form.passingGrade,
      isExtracurricular: form.isExtracurricular,
      nameAr: form.nameAr.trim() || null,
    });
    if (r.ok) {
      toast.showSuccess(
        "Matière modifiée",
        coefChanged
          ? `Coefficient: ${editSubject.coefficient} → ${form.coefficient}. Les GPA affectés seront recalculés.`
          : "Modifications enregistrées.",
      );
      setEditSubject(null);
    } else {
      setAlert({ tone: "error", title: "Échec", description: r.error.userMessage });
    }
  }

  async function confirmArchive() {
    if (!archiveSubject) return;
    const r = await repos.subjects.archiveSubject(archiveSubject.id);
    if (r.ok) {
      toast.showSuccess("Matière archivée", `${archiveSubject.name} a été retirée du catalogue actif.`);
      setArchiveSubject(null);
    } else {
      toast.showError("Échec", r.error.userMessage);
    }
  }

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-0">
          {/* Toolbar */}
          <div className="flex items-center gap-2 border-b border-border p-3">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Rechercher par nom, code…"
                className="pl-9"
              />
            </div>
            <Select value={levelFilter} onValueChange={setLevelFilter}>
              <SelectTrigger className="w-40">
                <Filter className="h-3.5 w-3.5 mr-1" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous niveaux</SelectItem>
                <SelectItem value="primaire">Primaire</SelectItem>
                <SelectItem value="cem">CEM</SelectItem>
                <SelectItem value="lycee">Lycée</SelectItem>
              </SelectContent>
            </Select>
            {canManage && (
              <Button size="sm" onClick={openCreate}>
                <Plus className="h-4 w-4" /> Nouvelle matière
              </Button>
            )}
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              title="Aucune matière"
              description="Le catalogue de matières est vide pour ce filtre."
            />
          ) : (
            <ul className="divide-y divide-border">
              {filtered.map((s) => (
                <li key={s.id} className="flex items-center gap-3 p-3 hover:bg-accent/5 group">
                  <Avatar className="h-9 w-9 rounded-md">
                    <AvatarFallback className="rounded-md text-xs">
                      {s.code.slice(0, 3)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-foreground">{s.name}</p>
                      <span className="font-mono text-xs text-muted-foreground">{s.code}</span>
                      {s.nameAr && <span className="text-xs text-muted-foreground" dir="rtl">{s.nameAr}</span>}
                      <Badge variant="outline">{LEVEL_LABELS_FR[s.level]}</Badge>
                      {s.isExtracurricular && <Badge variant="secondary">Extracurr.</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Coef. {s.coefficient} · Seuil {s.passingGrade}/20
                    </p>
                  </div>
                  {canManage && (
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost" size="icon" className="h-7 w-7"
                        onClick={() => openEdit(s)}
                        title="Modifier"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost" size="icon" className="h-7 w-7 text-status-danger hover:text-status-danger"
                        onClick={() => setArchiveSubject(s)}
                        title="Archiver"
                      >
                        <Archive className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <p className="text-[11px] text-muted-foreground">
        Plan §05 — Scolarité (primaire/CEM/lycée) + Extracurricular (clubs & thérapie).
        Les notes extracurriculaires ne sont JAMAIS incluses dans le GPA Scolarité.
        Modifier un coefficient déclenche un recalcul des GPA affectés.
      </p>

      {/* Create / Edit modal (shared form) */}
      <UnifiedModal
        open={createOpen || editSubject !== null}
        onOpenChange={(o) => {
          if (!o) {
            setCreateOpen(false);
            setEditSubject(null);
          }
        }}
        size="md"
        icon={BookOpen}
        iconTone="primary"
        title={editSubject ? `Modifier: ${editSubject.name}` : "Nouvelle matière"}
        description={editSubject ? "Les modifications sont journalisées dans l'audit log." : "Ajout au catalogue des matières du niveau sélectionné."}
        submitLabel={editSubject ? "Enregistrer" : "Créer"}
        submitIcon={editSubject ? Edit2 : Plus}
        onSubmit={editSubject ? saveEdit : saveCreate}
        alert={alert}
        onDismissAlert={() => setAlert(null)}
      >
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <FormField label="Nom" required>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Mathématiques"
              />
            </FormField>
            <FormField label="Code" required hint="Code court unique (ex: MATH)">
              <Input
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                placeholder="MATH"
                className="font-mono"
              />
            </FormField>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <FormField label="Niveau" required>
              <Select value={form.level} onValueChange={(v) => setForm({ ...form, level: v as AcademicLevel })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="primaire">Primaire</SelectItem>
                  <SelectItem value="cem">CEM</SelectItem>
                  <SelectItem value="lycee">Lycée</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Coefficient" required>
              <Input
                type="number"
                min={1}
                max={10}
                value={form.coefficient}
                onChange={(e) => setForm({ ...form, coefficient: Number(e.target.value) })}
              />
            </FormField>
            <FormField label="Seuil de passage" required hint="Sur 20">
              <Input
                type="number"
                min={0}
                max={20}
                step={0.5}
                value={form.passingGrade}
                onChange={(e) => setForm({ ...form, passingGrade: Number(e.target.value) })}
              />
            </FormField>
          </div>

          <FormField label="Nom en arabe (optionnel)">
            <Input
              value={form.nameAr}
              onChange={(e) => setForm({ ...form, nameAr: e.target.value })}
              placeholder="رياضيات"
              dir="rtl"
            />
          </FormField>

          <label className="flex items-center gap-2 rounded-md border border-border p-3 cursor-pointer hover:bg-accent/5">
            <input
              type="checkbox"
              checked={form.isExtracurricular}
              onChange={(e) => setForm({ ...form, isExtracurricular: e.target.checked })}
              className="h-4 w-4"
            />
            <div>
              <p className="text-sm font-medium">Matière extracurriculaire</p>
              <p className="text-xs text-muted-foreground">
                Club / thérapie — les notes ne sont JAMAIS incluses dans le GPA Scolarité (plan §05.07).
              </p>
            </div>
          </label>
        </div>
      </UnifiedModal>

      {/* Archive confirmation */}
      <ConfirmModal
        open={archiveSubject !== null}
        onOpenChange={(o) => !o && setArchiveSubject(null)}
        title={`Archiver: ${archiveSubject?.name ?? ""}`}
        description="La matière sera retirée du catalogue actif. Les notes déjà saisies sont conservées dans l'historique."
        confirmLabel="Archiver"
        destructive
        onConfirm={confirmArchive}
      />
    </div>
  );
}
