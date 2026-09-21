// ============================================================================
// FILE: src/features/academics/grade-levels-class-view.tsx
// ============================================================================
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Plus,
  ChevronDown,
  ChevronRight,
  Users,
  Building2,
  StickyNote,
  Filter,
  School,
  CheckCircle2,
  Sparkles,
  GraduationCap,
} from "lucide-react";
import { Card, CardContent } from "../../shared/ui/card";
import { Button } from "../../shared/ui/button";
import { Badge } from "../../shared/ui/badge";
import { Input } from "../../shared/ui/input";
import { Textarea } from "../../shared/ui/textarea";
import { FormField } from "../../shared/ui/form-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../shared/ui/select";
import {
  UnifiedModal,
  type UnifiedModalProps,
} from "../../shared/ui/unified-modal";
import { useRepositories } from "../../app/providers/repository-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import { useCurrentAcademicYear } from "./hooks/use-current-academic-year";
import { useToast } from "../../app/providers/toast-provider";
import { useAuth } from "../../app/providers/auth-provider";
import {
  GRADE_LEVELS,
  GRADE_LEVEL_LABELS_FR,
  LEVEL_LABELS_FR,
  type GradeLevel,
  type AcademicLevel,
} from "../../domain/model/student";
import type { AcademicClass } from "../../domain/model/academic";
import { getFilieresForGrade, getSpecialitesForFiliere, normalizeTrackCode, trackLabelFr } from "../../domain/model/filiere";
import { ClassPlacementStudioModal } from "./placement/class-placement-studio-modal";

type Alert = NonNullable<UnifiedModalProps["alert"]>;

export function GradeLevelsClassView({ canCreate }: { canCreate: boolean }) {
  const navigate = useNavigate();
  const repos = useRepositories();
  const classes = useObservable(() => repos.classes.observe(), []) ?? [];
  const [cycleFilter, setCycleFilter] = useState<string>("all");
  const [collapsedLevels, setCollapsedLevels] = useState<
    Record<string, boolean>
  >({});
  const [createClassOpen, setCreateClassOpen] = useState(false);
  const [presetGradeLevel, setPresetGradeLevel] = useState<GradeLevel | null>(
    null,
  );
  const [placementStudioOpen, setPlacementStudioOpen] = useState(false);
  const [selectedGradeForPlacement, setSelectedGradeForPlacement] =
    useState<GradeLevel | null>(null);

  const classesByGrade = GRADE_LEVELS.reduce(
    (acc, grade) => {
      acc[grade] = classes.filter((c) => c.gradeCode === grade);
      return acc;
    },
    {} as Record<GradeLevel, AcademicClass[]>,
  );

  function toggleLevelCollapse(gradeCode: string) {
    setCollapsedLevels((prev) => ({ ...prev, [gradeCode]: !prev[gradeCode] }));
  }

  function openCreateForGrade(gradeCode?: GradeLevel) {
    setPresetGradeLevel(gradeCode ?? null);
    setCreateClassOpen(true);
  }

  const visibleGradeLevels = GRADE_LEVELS.filter((grade) => {
    if (cycleFilter === "all") return true;
    if (cycleFilter === "prescolaire") return grade.startsWith("prescolaire");
    if (cycleFilter === "primaire") return grade.endsWith("ap");
    if (cycleFilter === "cem") return grade.endsWith("am");
    if (cycleFilter === "lycee") return grade.includes("annee");
    return true;
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground ml-1" />
            <span className="text-xs font-medium text-muted-foreground">
              Filtrer par cycle :
            </span>
            <div className="flex gap-1">
              {[
                { id: "all", label: "Tous les cycles" },
                { id: "prescolaire", label: "Préscolaire" },
                { id: "primaire", label: "Primaire (1AP-5AP)" },
                { id: "cem", label: "CEM (1AM-4AM)" },
                { id: "lycee", label: "Lycée (1A-3A)" },
              ].map((c) => (
                <Button
                  key={c.id}
                  size="sm"
                  variant={cycleFilter === c.id ? "default" : "outline"}
                  className="h-7 text-xs"
                  onClick={() => setCycleFilter(c.id)}
                >
                  {c.label}
                </Button>
              ))}
            </div>
          </div>
          {canCreate ? (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="default"
                className="h-7 text-xs bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
                onClick={() => {
                  setSelectedGradeForPlacement(null);
                  setPlacementStudioOpen(true);
                }}
              >
                <Sparkles className="h-3.5 w-3.5 mr-1" />
                Constitution des Classes & Répartition
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => openCreateForGrade()}
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                Nouvelle classe
              </Button>
            </div>
          ) : null}
          <span className="text-xs text-muted-foreground font-mono">
            {classes.length} classe(s) active(s) au total
          </span>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {visibleGradeLevels.map((gradeCode) => {
          const levelClasses = classesByGrade[gradeCode] ?? [];
          const isCollapsed = !!collapsedLevels[gradeCode];
          const label = GRADE_LEVEL_LABELS_FR[gradeCode] ?? gradeCode;
          return (
            <Card key={gradeCode} className="overflow-hidden">
              <div
                className="flex items-center justify-between p-3.5 bg-muted/20 border-b border-border cursor-pointer select-none hover:bg-muted/30 transition-colors"
                onClick={() => toggleLevelCollapse(gradeCode)}
              >
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    className="p-0.5 rounded text-muted-foreground hover:text-foreground"
                  >
                    {isCollapsed ? (
                      <ChevronRight className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                  </button>
                  <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                    <span>{label}</span>
                    <Badge variant="outline" className="font-normal text-xs">
                      {levelClasses.length} classe(s)
                    </Badge>
                    {Array.from(
                      new Set(
                        levelClasses
                          .map((c) => c.filiereCode)
                          .filter((f): f is string => !!f && f !== "general"),
                      ),
                    ).map((f) => (
                      <Badge key={f} variant="secondary" className="font-normal text-[10px]">
                        {trackLabelFr(f)} ({levelClasses.filter((c) => c.filiereCode === f).length})
                      </Badge>
                    ))}
                  </h3>
                </div>
                <div className="flex items-center gap-1">
                  {canCreate && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs text-primary hover:bg-primary/10"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedGradeForPlacement(gradeCode);
                        setPlacementStudioOpen(true);
                      }}
                      title={`Répartir les élèves de ${label}`}
                    >
                      <Users className="h-3.5 w-3.5 mr-1" />
                      Répartir ({gradeCode.toUpperCase()})
                    </Button>
                  )}
                  {canCreate && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        openCreateForGrade(gradeCode);
                      }}
                    >
                      <Plus className="h-3.5 w-3.5 mr-1" />
                      Ajouter une classe à ce niveau
                    </Button>
                  )}
                </div>
              </div>
              {!isCollapsed && (
                <CardContent className="p-4">
                  {levelClasses.length === 0 ? (
                    <div className="py-6 text-center text-xs text-muted-foreground border border-dashed border-border rounded-lg">
                      Aucune classe créée pour le niveau {label}.
                      {canCreate && (
                        <div className="mt-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-xs text-primary"
                            onClick={() => openCreateForGrade(gradeCode)}
                          >
                            + Créer la première classe de {label}
                          </Button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                      {levelClasses.map((cls) => (
                        <div
                          key={cls.id}
                          onClick={() => navigate(`/academics/class/${cls.id}`)}
                          className="rounded-lg border border-border bg-card p-3.5 hover:border-primary/50 hover:bg-accent/5 transition-all cursor-pointer flex flex-col justify-between space-y-3 group"
                        >
                          <div className="space-y-1">
                            <div className="flex items-start justify-between gap-2">
                              <p className="font-semibold text-sm text-foreground group-hover:text-primary transition-colors">
                                {cls.name}
                              </p>
                              <Badge
                                variant="secondary"
                                className="text-[10px] shrink-0 font-mono"
                              >
                                {cls.code}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                              <Building2 className="h-3.5 w-3.5" />
                              Salle : {cls.room ?? "Non assignée"}
                            </p>
                            {cls.filiereCode && cls.filiereCode !== "general" && (
                              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                                <GraduationCap className="h-3.5 w-3.5" />
                                {trackLabelFr(cls.filiereCode)}
                                {cls.specialiteCode ? ` — ${trackLabelFr(cls.specialiteCode)}` : ""}
                              </p>
                            )}
                          </div>
                          {cls.notes && (
                            <div className="text-xs text-muted-foreground bg-muted/30 p-2 rounded border border-border/50 line-clamp-2 italic">
                              <StickyNote className="h-3 w-3 inline mr-1 text-primary" />
                              {cls.notes}
                            </div>
                          )}
                          <div className="pt-2 border-t border-border/50 flex items-center justify-between text-xs">
                            <span className="text-muted-foreground flex items-center gap-1">
                              <Users className="h-3.5 w-3.5 text-primary" />
                              <strong className="text-foreground">
                                {cls.enrolledCount}
                              </strong>{" "}
                              élève(s)
                            </span>
                            <span className="text-primary group-hover:translate-x-0.5 transition-transform flex items-center">
                              Détails{" "}
                              <ChevronRight className="h-3.5 w-3.5 ml-0.5" />
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>

      <CreateClassModal
        open={createClassOpen}
        onOpenChange={setCreateClassOpen}
        presetGradeCode={presetGradeLevel}
      />
      <ClassPlacementStudioModal
        open={placementStudioOpen}
        onOpenChange={setPlacementStudioOpen}
        presetGradeLevel={selectedGradeForPlacement}
      />
    </div>
  );
}

function CreateClassModal({
  open,
  onOpenChange,
  presetGradeCode,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  presetGradeCode?: GradeLevel | null;
}) {
  const repos = useRepositories();
  const toast = useToast();
  const { session } = useAuth();
  const personnel = useObservable(() => repos.personnel.observe(), []) ?? [];
  const currentYear = useCurrentAcademicYear();

  const [gradeCode, setGradeCode] = useState<GradeLevel>(
    presetGradeCode ?? "1ap",
  );
  const [section, setSection] = useState("Section A");
  const [customName, setCustomName] = useState("");
  const [room, setRoom] = useState("");
  const [teacherId, setTeacherId] = useState("");
  const [notes, setNotes] = useState("");
  // T-401: the new class's classification ("" = untagged / cours commun).
  const [filiereCode, setFiliereCode] = useState("");
  const [specialiteCode, setSpecialiteCode] = useState("");
  const [alert, setAlert] = useState<Alert | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // The canonical catalog for the selected grade — never a page-local list.
  const filieres = getFilieresForGrade(gradeCode);
  const specialites = getSpecialitesForFiliere(filiereCode || null);

  if (presetGradeCode && gradeCode !== presetGradeCode && open) {
    setGradeCode(presetGradeCode);
  }

  const derivedLevel: AcademicLevel =
    gradeCode.startsWith("prescolaire") || gradeCode.endsWith("ap")
      ? "primaire"
      : gradeCode.endsWith("am")
        ? "cem"
        : "lycee";

  const derivedName = customName.trim()
    ? customName.trim()
    : `${GRADE_LEVEL_LABELS_FR[gradeCode] ?? gradeCode} - ${section}`;

  async function handleSubmit() {
    if (!session) return;
    setSubmitting(true);
    setAlert(null);

    const teacher = personnel.find((p) => p.id === teacherId);
    const code = `CLS-${gradeCode.toUpperCase()}-${section.replace(/\s+/g, "").toUpperCase()}-${Date.now().toString(36).slice(-3)}`;

    const result = await repos.classes.createClass({
      academicYearId: currentYear.id,
      academicLevelId: `al-${gradeCode}`,
      code,
      name: derivedName,
      gradeCode,
      level: derivedLevel,
      gradeYear: 1,
      section,
      // T-407 fix: normalize through the CANONICAL normalizer — picking the
      // catalog's « Générale » option (code "general") previously persisted
      // the literal "general" instead of the canonical NULL (the SQL layer
      // normalizes it away server-side, but the wire must carry the
      // canonical form — mock mode has no server to fix it).
      filiereCode: normalizeTrackCode(filiereCode),
      specialiteCode: normalizeTrackCode(specialiteCode),
      room: room.trim() || null,
      capacity: null,
      homeroomTeacherId: teacherId || null,
      homeroomTeacherName: teacher
        ? `${teacher.firstName} ${teacher.lastName}`
        : null,
      notes: notes.trim() || null,
      academicYear: "2025-2026",
      isActive: true,
    } as Omit<AcademicClass, "id" | "tenantId" | "enrolledCount">);

    setSubmitting(false);

    if (result.ok) {
      toast.showSuccess(
        "Classe créée",
        `« ${derivedName} » a été ajoutée au niveau ${GRADE_LEVEL_LABELS_FR[gradeCode]}.`,
      );
      onOpenChange(false);
      setCustomName("");
      setNotes("");
    } else {
      setAlert({
        tone: "error",
        title: "Échec de création",
        description: result.error.userMessage,
      });
    }
  }

  const teachers = personnel.filter(
    (p) => p.staffCategory === "teacher" || p.roleId === "teacher",
  );

  return (
    <UnifiedModal
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      variant="dialog"
      icon={School}
      iconTone="primary"
      title="Créer une nouvelle classe"
      description="Ajoutez une classe indépendante sous le niveau scolaire de votre choix. Aucune limite de nombre d'élèves ou de classes."
      submitLabel="Créer la classe"
      submitIcon={CheckCircle2}
      submitLoading={submitting}
      onSubmit={handleSubmit}
      alert={alert}
      onDismissAlert={() => setAlert(null)}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Niveau Scolaire" required>
            <Select
              value={gradeCode}
              onValueChange={(v) => setGradeCode(v as GradeLevel)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GRADE_LEVELS.map((g) => (
                  <SelectItem key={g} value={g}>
                    {GRADE_LEVEL_LABELS_FR[g]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Section / Groupe" required>
            <Input
              value={section}
              onChange={(e) => setSection(e.target.value)}
              placeholder="Ex. Section A, Groupe 2"
            />
          </FormField>
        </div>
        <FormField
          label="Nom de la classe (optionnel)"
          hint="Aperçu auto : '3ème AP - Section A'"
        >
          <Input
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            placeholder={derivedName}
          />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Enseignant principal">
            <Select
              value={teacherId || "__none__"}
              onValueChange={(v) => setTeacherId(v === "__none__" ? "" : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Non désigné" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— Non désigné —</SelectItem>
                {teachers.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.firstName} {p.lastName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Salle de classe">
            <Input
              value={room}
              onChange={(e) => setRoom(e.target.value)}
              placeholder="Ex. Salle B12"
            />
          </FormField>
        </div>
        {/* T-401 — the new class's academic classification (the canonical
            catalog filtered by the selected grade). */}
        {filieres.length > 1 && (
          <div className="grid grid-cols-2 gap-3">
            <FormField
              label="Filière"
              hint="Cours commun si aucune sélection"
            >
              <Select
                value={filiereCode || "__general__"}
                onValueChange={(v) => {
                  setFiliereCode(v === "__general__" ? "" : v);
                  setSpecialiteCode("");
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Cours commun" />
                </SelectTrigger>
                <SelectContent>
                  {filieres.map((f) => (
                    <SelectItem key={f.code} value={f.code}>
                      {f.labelFr}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            {specialites.length > 0 && (
              <FormField label="Spécialité">
                <Select
                  value={specialiteCode || "__none__"}
                  onValueChange={(v) => setSpecialiteCode(v === "__none__" ? "" : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Aucune" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— Aucune —</SelectItem>
                    {specialites.map((sp) => (
                      <SelectItem key={sp.code} value={sp.code}>
                        {sp.labelFr}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            )}
          </div>
        )}
        <FormField
          label="Notes & Observations"
          hint="Remarques spécifiques, emploi du temps, ou consignes"
        >
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Ex. Cours renforcés en mathématiques, salle équipée de projecteur..."
            rows={3}
          />
        </FormField>
      </div>
    </UnifiedModal>
  );
}