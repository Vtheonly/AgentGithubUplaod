// ============================================================================
// FILE: src/features/academics/placement/class-card-dropzone.tsx
// ============================================================================
import { useState } from "react";
import {
  School,
  Users,
  Building2,
  GraduationCap,
  Sparkles,
  Plus,
  Pencil,
  Trash2,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../../../shared/ui/card";
import { Badge } from "../../../shared/ui/badge";
import { Button } from "../../../shared/ui/button";
import type {
  ClassDraft,
  PlacementCandidate,
  ClassCompositionSummary,
} from "../../../domain/calc/academics/class-placement";
import { StudentPlacementCard } from "./student-placement-card";

interface Props {
  classDraft: ClassDraft;
  summary: ClassCompositionSummary;
  assignedCandidates: readonly PlacementCandidate[];
  allClasses: readonly ClassDraft[];
  selectedStudentIds: Set<string>;
  onToggleSelectStudent: (studentId: string) => void;
  onAssignStudent: (studentId: string, classId: string) => void;
  onUnassignStudent: (studentId: string) => void;
  onEditClass: (classDraft: ClassDraft) => void;
  onRemoveClass?: (classId: string) => void;
  onAssignSelectedHere: (classId: string) => void;
}

export function ClassCardDropzone({
  classDraft,
  summary,
  assignedCandidates,
  allClasses,
  selectedStudentIds,
  onToggleSelectStudent,
  onAssignStudent,
  onUnassignStudent,
  onEditClass,
  onRemoveClass,
  onAssignSelectedHere,
}: Props) {
  const isFull = classDraft.capacity !== null && summary.totalAssigned >= classDraft.capacity;

  return (
    <Card className="flex flex-col h-full border-border bg-card shadow-sm overflow-hidden">
      <CardHeader className="py-3 px-3.5 border-b border-border bg-muted/20 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <CardTitle className="text-sm font-bold text-foreground">
                {classDraft.name}
              </CardTitle>
              {classDraft.isNew && (
                <Badge variant="outline" className="text-[9px] bg-primary/10 text-primary border-primary/20">
                  Nouvelle
                </Badge>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground flex items-center gap-2 mt-0.5">
              <span>Salle : {classDraft.room || "Non assignée"}</span>
              <span>·</span>
              <span>Resp : {classDraft.homeroomTeacherName || "Non désigné"}</span>
            </p>
          </div>

          <div className="flex items-center gap-1">
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={() => onEditClass(classDraft)}
              title="Modifier les détails de la classe"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            {classDraft.isNew && onRemoveClass && (
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 text-status-danger hover:bg-status-danger/10"
                onClick={() => onRemoveClass(classDraft.id)}
                title="Supprimer la section"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>

        {/* Real-time Section Health Strip */}
        <div className="grid grid-cols-4 gap-1.5 text-center text-[10px]">
          <div className="p-1.5 rounded bg-surface-elevated/40 border border-border/40">
            <span className="text-muted-foreground block text-[9px] uppercase">Effectif</span>
            <span className={`font-mono font-bold text-xs ${isFull ? "text-status-warning" : "text-foreground"}`}>
              {summary.totalAssigned}
              {classDraft.capacity ? ` / ${classDraft.capacity}` : ""}
            </span>
          </div>

          <div className="p-1.5 rounded bg-surface-elevated/40 border border-border/40">
            <span className="text-muted-foreground block text-[9px] uppercase">Mixité</span>
            <span className="font-mono font-semibold text-xs text-foreground">
              {summary.boysCount}👦 {summary.girlsCount}👧
            </span>
          </div>

          <div className="p-1.5 rounded bg-surface-elevated/40 border border-border/40">
            <span className="text-muted-foreground block text-[9px] uppercase">Redoublants</span>
            <span className={`font-mono font-bold text-xs ${summary.repeatingCount > 3 ? "text-status-warning" : "text-foreground"}`}>
              {summary.repeatingCount}
            </span>
          </div>

          <div className="p-1.5 rounded bg-surface-elevated/40 border border-border/40">
            <span className="text-muted-foreground block text-[9px] uppercase">Moyenne</span>
            <span className="font-mono font-bold text-xs text-primary">
              {summary.averagePreviousGpa !== null ? `${summary.averagePreviousGpa}` : "—"}
            </span>
          </div>
        </div>

        {/* Action button to assign selected students */}
        {selectedStudentIds.size > 0 && (
          <Button
            size="sm"
            onClick={() => onAssignSelectedHere(classDraft.id)}
            className="w-full h-7 text-xs bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            <Plus className="h-3 w-3 mr-1" /> Placer les {selectedStudentIds.size} élève(s) sélectionnés ici
          </Button>
        )}
      </CardHeader>

      <CardContent className="p-2.5 flex-1 overflow-y-auto space-y-1.5 max-h-[460px]">
        {assignedCandidates.length === 0 ? (
          <div className="py-12 text-center text-xs text-muted-foreground border border-dashed border-border rounded-lg">
            <School className="h-6 w-6 mx-auto mb-1 text-muted-foreground/40" />
            Aucun élève affecté à cette section.
          </div>
        ) : (
          assignedCandidates.map((c) => (
            <StudentPlacementCard
              key={c.studentId}
              candidate={c}
              classes={allClasses}
              isSelected={selectedStudentIds.has(c.studentId)}
              onToggleSelect={onToggleSelectStudent}
              onAssignToClass={onAssignStudent}
              onUnassign={onUnassignStudent}
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}