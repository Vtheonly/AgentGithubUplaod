// ============================================================================
// FILE: src/features/academics/placement/class-placement-studio-modal.tsx
// ============================================================================
/**
 * Master Class Formation & Student Placement Studio (Atelier de Répartition).
 *
 * Provides complete interactive workflows for the new academic year:
 *   1. Board Mode: 2-column interactive canvas (Unassigned Pool on left, Target Sections on right).
 *   2. Matrix Mode: Comprehensive spreadsheet view for rapid multi-select and reassignment.
 *   3. Analytics Mode: Live balance & parity diagnostics (Gender parity, GPA spread, Repeaters dispersion).
 *   4. Review Mode: Final pre-commit breakdown and atomic execution.
 */

import { useState, useMemo } from "react";
import {
  GraduationCap,
  Users,
  Layers,
  Sparkles,
  Plus,
  ArrowRight,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  Search,
  Scale,
  School,
  Table as TableIcon,
  LayoutGrid,
} from "lucide-react";
import { UnifiedModal } from "../../../shared/ui/unified-modal";
import { Button } from "../../../shared/ui/button";
import { Input } from "../../../shared/ui/input";
import { Badge } from "../../../shared/ui/badge";
import { Card, CardContent } from "../../../shared/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../shared/ui/select";
import type { GradeLevel } from "../../../domain/model/student";
import { GRADE_LEVEL_LABELS_FR, GRADE_LEVELS } from "../../../domain/model/student";
import { useClassPlacementStudio } from "../hooks/use-class-placement-studio";
import { ClassCardDropzone } from "./class-card-dropzone";
import { StudentPlacementCard } from "./student-placement-card";
import { CreateSectionDialog } from "./create-section-dialog";
import type { ClassDraft } from "../../../domain/calc/academics/class-placement";
import { PROVENANCE_LABELS_FR } from "../../../domain/calc/academics/class-placement";

type StudioViewMode = "board" | "matrix" | "analytics" | "review";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  presetGradeLevel?: GradeLevel | null;
}

export function ClassPlacementStudioModal({
  open,
  onOpenChange,
  presetGradeLevel,
}: Props) {
  const studio = useClassPlacementStudio(presetGradeLevel ?? "1ap");
  const [viewMode, setViewMode] = useState<StudioViewMode>("board");

  // Filtering on candidate pool
  const [search, setSearch] = useState("");
  const [provenanceFilter, setProvenanceFilter] = useState<string>("all");
  const [genderFilter, setGenderFilter] = useState<string>("all");

  // Selected candidates for bulk operations
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Dialog for adding / editing sections
  const [sectionDialogOpen, setSectionDialogOpen] = useState(false);
  const [editingDraft, setEditingDraft] = useState<ClassDraft | null>(null);

  const toggleSelectStudent = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllUnassigned = () => {
    setSelectedIds(new Set(studio.unassignedCandidates.map((c) => c.studentId)));
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
  };

  // Filtered unassigned list
  const filteredUnassigned = useMemo(() => {
    return studio.unassignedCandidates.filter((c) => {
      if (provenanceFilter !== "all" && c.provenance !== provenanceFilter) return false;
      if (genderFilter !== "all" && c.gender !== genderFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          c.studentName.toLowerCase().includes(q) ||
          c.studentCode.toLowerCase().includes(q) ||
          (c.originClassName ?? "").toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [studio.unassignedCandidates, provenanceFilter, genderFilter, search]);

  const handleBulkAssign = (targetClassId: string) => {
    if (selectedIds.size === 0) return;
    studio.bulkAssignStudents(Array.from(selectedIds), targetClassId);
    clearSelection();
  };

  const handleOpenCreateSection = () => {
    setEditingDraft(null);
    setSectionDialogOpen(true);
  };

  const handleOpenEditSection = (draft: ClassDraft) => {
    setEditingDraft(draft);
    setSectionDialogOpen(true);
  };

  return (
    <UnifiedModal
      open={open}
      onOpenChange={onOpenChange}
      size="full"
      variant="dialog"
      icon={GraduationCap}
      iconTone="primary"
      title="Constitution des Classes & Répartition des Élèves"
      description={`Préparation de la rentrée scolaire ${studio.targetYearCode} · Organisation modulaire des promotions, redoublements et nouveaux inscrits.`}
      hideSubmit
      cancelLabel="Fermer"
      header={
        <div className="flex items-center gap-2 flex-wrap">
          {/* Year selector */}
          <Select value={studio.targetYearCode} onValueChange={studio.setTargetYearCode}>
            <SelectTrigger className="h-8 w-36 text-xs font-mono">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {studio.availableYears.map((y) => (
                <SelectItem key={y.id} value={y.code}>
                  {y.code} {y.isCurrent && "(Actuelle)"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* View mode switcher */}
          <div className="flex rounded-md border border-border bg-muted/30 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setViewMode("board")}
              className={`flex items-center gap-1 px-2.5 py-1 rounded transition-colors ${
                viewMode === "board"
                  ? "bg-primary text-primary-foreground font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <LayoutGrid className="h-3.5 w-3.5" /> Atelier Visuel
            </button>
            <button
              type="button"
              onClick={() => setViewMode("matrix")}
              className={`flex items-center gap-1 px-2.5 py-1 rounded transition-colors ${
                viewMode === "matrix"
                  ? "bg-primary text-primary-foreground font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <TableIcon className="h-3.5 w-3.5" /> Vue Tabulaire
            </button>
            <button
              type="button"
              onClick={() => setViewMode("analytics")}
              className={`flex items-center gap-1 px-2.5 py-1 rounded transition-colors ${
                viewMode === "analytics"
                  ? "bg-primary text-primary-foreground font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Scale className="h-3.5 w-3.5" /> Équilibre &amp; Parité
            </button>
            <button
              type="button"
              onClick={() => setViewMode("review")}
              className={`flex items-center gap-1 px-2.5 py-1 rounded transition-colors ${
                viewMode === "review"
                  ? "bg-primary text-primary-foreground font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <CheckCircle2 className="h-3.5 w-3.5" /> Validation ({studio.poolSummary.totalAssignedCount})
            </button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col h-full space-y-3 min-h-0">
        {/* Grade level picker strip */}
        <div className="flex items-center gap-1 overflow-x-auto border-b border-border pb-2">
          {GRADE_LEVELS.map((g) => {
            const isActive = studio.targetGradeLevel === g;
            return (
              <button
                key={g}
                type="button"
                onClick={() => {
                  studio.setTargetGradeLevel(g);
                  clearSelection();
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-all ${
                  isActive
                    ? "bg-primary text-primary-foreground font-bold shadow-sm"
                    : "bg-surface-elevated/40 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                }`}
              >
                <span>{GRADE_LEVEL_LABELS_FR[g]}</span>
              </button>
            );
          })}
        </div>

        {/* Top Status & Balance Alert Bar */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
          <div className="p-2 rounded border bg-card text-center">
            <span className="text-[10px] uppercase text-muted-foreground block">Éligibles ({GRADE_LEVEL_LABELS_FR[studio.targetGradeLevel]})</span>
            <span className="font-mono font-bold text-sm text-foreground">{studio.poolSummary.totalEligibleCount}</span>
          </div>

          <div className="p-2 rounded border border-status-success/30 bg-status-success/5 text-center">
            <span className="text-[10px] uppercase text-status-success font-semibold block">Affectés</span>
            <span className="font-mono font-bold text-sm text-status-success">{studio.poolSummary.totalAssignedCount}</span>
          </div>

          <div className="p-2 rounded border border-status-warning/30 bg-status-warning/5 text-center">
            <span className="text-[10px] uppercase text-status-warning font-semibold block">En Réserve (Non placés)</span>
            <span className="font-mono font-bold text-sm text-status-warning">{studio.poolSummary.totalUnassignedCount}</span>
          </div>

          <div className="p-2 rounded border bg-card text-center">
            <span className="text-[10px] uppercase text-muted-foreground block">Promus / Redoublants</span>
            <span className="font-mono font-bold text-sm text-foreground">
              {studio.poolSummary.promotedTotal}P · {studio.poolSummary.repeatingTotal}R
            </span>
          </div>

          <div className="p-2 rounded border bg-card text-center flex items-center justify-between px-3">
            <div className="text-left">
              <span className="text-[10px] uppercase text-muted-foreground block">Score Équilibre</span>
              <span className={`font-mono font-bold text-sm ${studio.balanceAnalysis.isBalanced ? "text-status-success" : "text-status-warning"}`}>
                {studio.balanceAnalysis.balanceScore} / 100
              </span>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[11px] gap-1 border-primary/40 text-primary"
              onClick={() => studio.applyAutoBalance("balanced")}
            >
              <Sparkles className="h-3 w-3" /> Auto-équilibrer
            </Button>
          </div>
        </div>

        {/* VIEW 1: INTERACTIVE 2-COLUMN BOARD */}
        {viewMode === "board" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 flex-1 min-h-0 overflow-hidden">
            {/* Left Panel: Unassigned Student Pool (5 cols) */}
            <div className="lg:col-span-5 flex flex-col h-full border rounded-lg bg-surface-panel overflow-hidden">
              <div className="p-3 border-b border-border bg-muted/20 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                    <Users className="h-4 w-4 text-primary" />
                    Réserve ({filteredUnassigned.length} élèves)
                  </span>
                  <div className="flex items-center gap-1">
                    {selectedIds.size > 0 ? (
                      <Button size="sm" variant="ghost" onClick={clearSelection} className="h-6 text-[10px]">
                        Désélectionner ({selectedIds.size})
                      </Button>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={selectAllUnassigned} className="h-6 text-[10px]">
                        Tout cocher
                      </Button>
                    )}
                  </div>
                </div>

                {/* Filters */}
                <div className="flex items-center gap-1.5">
                  <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Filtrer élève, code..."
                      className="h-7 pl-7 text-xs"
                    />
                  </div>
                  <Select value={provenanceFilter} onValueChange={setProvenanceFilter}>
                    <SelectTrigger className="h-7 w-32 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Tous profils</SelectItem>
                      <SelectItem value="promoted">Promus</SelectItem>
                      <SelectItem value="repeating">Redoublants</SelectItem>
                      <SelectItem value="new_student">Nouveaux</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Bulk assign toolbar */}
                {selectedIds.size > 0 && studio.classDrafts.length > 0 && (
                  <div className="p-2 rounded bg-primary/10 border border-primary/20 flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold text-primary">
                      {selectedIds.size} élève(s) sélectionnés
                    </span>
                    <div className="flex items-center gap-1">
                      {studio.classDrafts.map((cls) => (
                        <Button
                          key={cls.id}
                          size="sm"
                          variant="outline"
                          className="h-6 px-2 text-[10px]"
                          onClick={() => handleBulkAssign(cls.id)}
                        >
                          → {cls.section}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="p-2 space-y-1.5 flex-1 overflow-y-auto max-h-[500px]">
                {filteredUnassigned.length === 0 ? (
                  <div className="py-12 text-center text-xs text-muted-foreground border border-dashed rounded-lg">
                    {studio.unassignedCandidates.length === 0
                      ? "Tous les élèves éligibles sont affectés !"
                      : "Aucun élève ne correspond aux filtres de recherche."}
                  </div>
                ) : (
                  filteredUnassigned.map((cand) => (
                    <StudentPlacementCard
                      key={cand.studentId}
                      candidate={cand}
                      classes={studio.classDrafts}
                      isSelected={selectedIds.has(cand.studentId)}
                      onToggleSelect={toggleSelectStudent}
                      onAssignToClass={studio.assignStudent}
                      onUnassign={studio.unassignStudent}
                    />
                  ))
                )}
              </div>
            </div>

            {/* Right Panel: Target Sections Cards (7 cols) */}
            <div className="lg:col-span-7 flex flex-col h-full space-y-3 overflow-hidden">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                  <School className="h-4 w-4 text-primary" />
                  Sections cibles — {GRADE_LEVEL_LABELS_FR[studio.targetGradeLevel]} ({studio.classDrafts.length} classes)
                </span>

                <Button size="sm" onClick={handleOpenCreateSection} className="h-7 text-xs">
                  <Plus className="h-3.5 w-3.5 mr-1" /> Nouvelle Section
                </Button>
              </div>

              {studio.classDrafts.length === 0 ? (
                <Card className="flex-1 flex items-center justify-center p-8 text-center border-dashed">
                  <div className="space-y-2">
                    <School className="h-10 w-10 text-muted-foreground mx-auto" />
                    <h4 className="font-semibold text-sm">Aucune section créée pour {GRADE_LEVEL_LABELS_FR[studio.targetGradeLevel]}</h4>
                    <p className="text-xs text-muted-foreground max-w-sm">
                      Commencez par créer la première section (ex. Section A) pour y répartir les élèves promus et redoublants.
                    </p>
                    <Button size="sm" onClick={handleOpenCreateSection} className="mt-2">
                      <Plus className="h-3.5 w-3.5 mr-1" /> Créer la Section A
                    </Button>
                  </div>
                </Card>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 flex-1 overflow-y-auto max-h-[540px]">
                  {studio.classDrafts.map((draft) => {
                    const summary =
                      studio.classSummaries.find((s) => s.classId === draft.id) ??
                      studio.classSummaries[0];
                    const assigned = studio.getAssignedCandidatesForClass(draft.id);

                    return (
                      <ClassCardDropzone
                        key={draft.id}
                        classDraft={draft}
                        summary={summary}
                        assignedCandidates={assigned}
                        allClasses={studio.classDrafts}
                        selectedStudentIds={selectedIds}
                        onToggleSelectStudent={toggleSelectStudent}
                        onAssignStudent={studio.assignStudent}
                        onUnassignStudent={studio.unassignStudent}
                        onEditClass={handleOpenEditSection}
                        onRemoveClass={draft.isNew ? studio.removeClassDraft : undefined}
                        onAssignSelectedHere={handleBulkAssign}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* VIEW 2: GLOBAL TABLE MATRIX */}
        {viewMode === "matrix" && (
          <div className="border rounded-lg overflow-hidden flex-1 flex flex-col bg-card">
            <div className="overflow-x-auto flex-1">
              <table className="w-full text-xs">
                <thead className="bg-muted/30 text-muted-foreground border-b border-border text-left sticky top-0 bg-card z-10">
                  <tr>
                    <th className="py-2.5 px-3">Élève</th>
                    <th className="py-2.5 px-3">Code</th>
                    <th className="py-2.5 px-3">Statut &amp; Provenance</th>
                    <th className="py-2.5 px-3 text-center">Genre</th>
                    <th className="py-2.5 px-3 text-center">Moyenne Précédente</th>
                    <th className="py-2.5 px-3">Classe Précédente</th>
                    <th className="py-2.5 px-3 text-right">Classe Affectée ({studio.targetYearCode})</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {studio.candidatePool.map((c) => {
                    return (
                      <tr key={c.studentId} className="hover:bg-accent/5">
                        <td className="py-2 px-3 font-semibold text-foreground">{c.studentName}</td>
                        <td className="py-2 px-3 font-mono text-muted-foreground">{c.studentCode}</td>
                        <td className="py-2 px-3">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                              c.provenance === "promoted"
                                ? "bg-status-success/10 text-status-success"
                                : c.provenance === "repeating"
                                  ? "bg-status-warning/10 text-status-warning"
                                  : "bg-status-info/10 text-status-info"
                            }`}
                          >
                            {PROVENANCE_LABELS_FR[c.provenance]}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-center">{c.gender === "male" ? "Garçon 👦" : "Fille 👧"}</td>
                        <td className="py-2 px-3 text-center font-mono font-bold">
                          {c.previousGpa !== null ? (
                            <span className={c.previousGpa >= 10 ? "text-status-success" : "text-status-danger"}>
                              {c.previousGpa.toFixed(2)}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="py-2 px-3 text-muted-foreground">{c.originClassName ?? "—"}</td>
                        <td className="py-2 px-3 text-right">
                          <Select
                            value={c.assignedClassId ?? "__unassigned__"}
                            onValueChange={(v) => {
                              if (v === "__unassigned__") studio.unassignStudent(c.studentId);
                              else studio.assignStudent(c.studentId, v);
                            }}
                          >
                            <SelectTrigger className="h-7 w-44 ml-auto text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__unassigned__">— Non affecté (Réserve) —</SelectItem>
                              {studio.classDrafts.map((cls) => (
                                <SelectItem key={cls.id} value={cls.id}>
                                  {cls.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* VIEW 3: EQUILIBRIUM & PARITY ANALYTICS */}
        {viewMode === "analytics" && (
          <div className="space-y-4 flex-1 overflow-y-auto">
            <Card>
              <CardContent className="p-4 space-y-3">
                <h4 className="text-sm font-bold flex items-center gap-2">
                  <Scale className="h-4 w-4 text-primary" />
                  Diagnostic d'Équilibre Pédagogique &amp; Parité
                </h4>
                {studio.balanceAnalysis.warnings.length > 0 ? (
                  <div className="space-y-1.5 p-3 rounded-lg border border-status-warning/40 bg-status-warning/10 text-xs">
                    <p className="font-bold text-status-warning flex items-center gap-1.5">
                      <AlertTriangle className="h-4 w-4" /> Avertissements d'équilibre détectés :
                    </p>
                    <ul className="list-disc pl-5 space-y-0.5 text-muted-foreground">
                      {studio.balanceAnalysis.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div className="p-3 rounded-lg border border-status-success/40 bg-status-success/10 text-xs text-status-success flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4" />
                    Toutes les sections respectent les critères d'équilibre (effectif, mixité, dispersion des redoublants et niveau académique).
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {studio.classSummaries.map((s) => (
                <Card key={s.classId} className="p-4 space-y-3">
                  <div className="flex items-center justify-between border-b pb-2">
                    <h5 className="font-bold text-sm">{s.className}</h5>
                    <Badge variant="outline" className="font-mono text-xs">
                      {s.totalAssigned} élèves
                    </Badge>
                  </div>

                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Mixité filles / garçons :</span>
                      <span className="font-mono font-semibold">{s.boysCount} 👦 / {s.girlsCount} 👧 ({s.genderRatioBoysPct}%)</span>
                    </div>

                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Élèves redoublants :</span>
                      <span className="font-mono font-bold text-status-warning">{s.repeatingCount}</span>
                    </div>

                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Moyenne de classe estimée :</span>
                      <span className="font-mono font-bold text-primary">{s.averagePreviousGpa ?? "—"} / 20</span>
                    </div>

                    {s.gpaMin !== null && s.gpaMax !== null && (
                      <div className="flex justify-between text-[11px] text-muted-foreground">
                        <span>Écart académique :</span>
                        <span className="font-mono">{s.gpaMin.toFixed(2)} → {s.gpaMax.toFixed(2)}</span>
                      </div>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* VIEW 4: REVIEW & CONFIRMATION */}
        {viewMode === "review" && (
          <div className="space-y-4 flex-1 overflow-y-auto">
            <Card>
              <CardContent className="p-4 space-y-3">
                <h4 className="text-sm font-bold flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-status-success" />
                  Récapitulatif avant confirmation de la rentrée {studio.targetYearCode}
                </h4>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Cette action va créer les nouvelles classes et affecter les {studio.poolSummary.totalAssignedCount} élèves à leurs sections respectives pour l'année scolaire {studio.targetYearCode}.
                  L'historique académique des années passées reste conservé et inaltéré.
                </p>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
                  <div className="p-2.5 rounded bg-muted/20 border">
                    <span className="text-[10px] text-muted-foreground block uppercase">Nouvelles classes à créer</span>
                    <span className="text-base font-bold font-mono">{studio.classDrafts.filter((d) => d.isNew).length}</span>
                  </div>
                  <div className="p-2.5 rounded bg-muted/20 border">
                    <span className="text-[10px] text-muted-foreground block uppercase">Élèves promus placés</span>
                    <span className="text-base font-bold font-mono text-status-success">{studio.poolSummary.promotedTotal}</span>
                  </div>
                  <div className="p-2.5 rounded bg-muted/20 border">
                    <span className="text-[10px] text-muted-foreground block uppercase">Redoublants intégrés</span>
                    <span className="text-base font-bold font-mono text-status-warning">{studio.poolSummary.repeatingTotal}</span>
                  </div>
                  <div className="p-2.5 rounded bg-muted/20 border">
                    <span className="text-[10px] text-muted-foreground block uppercase">Élèves non affectés</span>
                    <span className="text-base font-bold font-mono text-muted-foreground">{studio.poolSummary.totalUnassignedCount}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => setViewMode("board")}>
                Retour à l'atelier
              </Button>
              <Button
                size="default"
                className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold px-6"
                disabled={studio.isSubmitting || studio.poolSummary.totalAssignedCount === 0}
                onClick={studio.finalizePlacements}
              >
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Valider et Enregistrer la Répartition ({studio.poolSummary.totalAssignedCount} élèves)
              </Button>
            </div>
          </div>
        )}

        {/* Persistent Bottom Controls in Board / Matrix Mode */}
        {viewMode !== "review" && (
          <div className="flex items-center justify-between border-t border-border pt-3">
            <Button variant="ghost" size="sm" onClick={studio.resetSessionAssignments} className="text-xs text-muted-foreground">
              <RotateCcw className="h-3.5 w-3.5 mr-1" /> Réinitialiser les affectations
            </Button>

            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setViewMode("review")}>
                Examiner avant confirmation ({studio.poolSummary.totalAssignedCount} placés)
              </Button>

              <Button
                size="sm"
                className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
                disabled={studio.isSubmitting || studio.poolSummary.totalAssignedCount === 0}
                onClick={studio.finalizePlacements}
              >
                <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                Confirmer la Répartition ({studio.poolSummary.totalAssignedCount})
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Dialog: Create / Edit Class Section */}
      <CreateSectionDialog
        open={sectionDialogOpen}
        onOpenChange={setSectionDialogOpen}
        gradeLevel={studio.targetGradeLevel}
        personnel={studio.personnel}
        initialDraft={editingDraft}
        onSave={(data) => {
          if (editingDraft) {
            studio.updateClassDraft(editingDraft.id, data);
          } else {
            studio.createClassDraft(data);
          }
        }}
      />
    </UnifiedModal>
  );
}