// ============================================================================
// FILE: src/features/academics/placement/student-placement-card.tsx
// ============================================================================
import { useState } from "react";
import {
  TrendingUp,
  RotateCcw,
  User,
  MoreHorizontal,
  ArrowRight,
  Sparkles,
} from "lucide-react";
import { Badge } from "../../../shared/ui/badge";
import { StatusChip } from "../../../shared/ui/status-chip";
import { Button } from "../../../shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../../shared/ui/dropdown-menu";
import type { PlacementCandidate, ClassDraft } from "../../../domain/calc/academics/class-placement";
import { PROVENANCE_LABELS_FR } from "../../../domain/calc/academics/class-placement";
import { GRADE_LEVEL_LABELS_FR } from "../../../domain/model/student";

interface Props {
  candidate: PlacementCandidate;
  classes: readonly ClassDraft[];
  isSelected?: boolean;
  onToggleSelect?: (studentId: string) => void;
  onAssignToClass?: (studentId: string, classId: string) => void;
  onUnassign?: (studentId: string) => void;
  compact?: boolean;
}

export function StudentPlacementCard({
  candidate,
  classes,
  isSelected = false,
  onToggleSelect,
  onAssignToClass,
  onUnassign,
  compact = false,
}: Props) {
  const isAssigned = candidate.assignedClassId !== null;
  const currentAssignedClass = classes.find((c) => c.id === candidate.assignedClassId);

  const provenanceTone =
    candidate.provenance === "promoted"
      ? "success"
      : candidate.provenance === "repeating"
        ? "warning"
        : candidate.provenance === "transferred"
          ? "info"
          : "neutral";

  return (
    <div
      className={`rounded-lg border transition-all p-2.5 flex items-center justify-between gap-2.5 ${
        isSelected
          ? "border-primary bg-primary/10 shadow-sm"
          : isAssigned
            ? "border-border/80 bg-card hover:border-primary/40"
            : "border-border bg-surface-elevated/40 hover:border-primary/40 hover:bg-surface-elevated/70"
      }`}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        {onToggleSelect && (
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => onToggleSelect(candidate.studentId)}
            className="h-4 w-4 rounded border-border text-primary focus:ring-primary cursor-pointer shrink-0"
          />
        )}

        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-semibold text-xs text-foreground truncate">
              {candidate.studentName}
            </span>
            <span className="text-[10px] text-muted-foreground font-mono">
              {candidate.gender === "male" ? "👦" : "👧"}
            </span>
            <span className="text-[10px] font-mono text-muted-foreground">
              {candidate.studentCode}
            </span>
          </div>

          <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5 flex-wrap">
            <StatusChip
              label={
                candidate.originGradeLevel && candidate.provenance === "promoted"
                  ? `Promu(e) de ${GRADE_LEVEL_LABELS_FR[candidate.originGradeLevel] ?? candidate.originGradeLevel}`
                  : PROVENANCE_LABELS_FR[candidate.provenance]
              }
              tone={provenanceTone}
            />

            {candidate.previousGpa !== null && (
              <span
                className={`font-mono font-bold px-1 rounded ${
                  candidate.previousGpa >= 10
                    ? "text-status-success bg-status-success/10"
                    : "text-status-danger bg-status-danger/10"
                }`}
              >
                {candidate.previousGpa.toFixed(2)} / 20
              </span>
            )}

            {candidate.originClassName && (
              <span className="truncate">Ex: {candidate.originClassName}</span>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {isAssigned ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs font-medium">
                <span className="truncate max-w-[100px] text-foreground font-semibold">
                  {currentAssignedClass?.section ?? "Section"}
                </span>
                <MoreHorizontal className="h-3.5 w-3.5 ml-1 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel className="text-xs">Changer de classe</DropdownMenuLabel>
              {classes
                .filter((c) => c.id !== candidate.assignedClassId)
                .map((cls) => (
                  <DropdownMenuItem
                    key={cls.id}
                    onClick={() => onAssignToClass?.(candidate.studentId, cls.id)}
                    className="text-xs"
                  >
                    <ArrowRight className="h-3.5 w-3.5 mr-1 text-primary" />
                    Déplacer vers {cls.name}
                  </DropdownMenuItem>
                ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => onUnassign?.(candidate.studentId)}
                className="text-xs text-status-danger hover:bg-status-danger/10"
              >
                <RotateCcw className="h-3.5 w-3.5 mr-1" />
                Désaffecter (retour réserve)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" className="h-7 text-xs border-primary/40 text-primary hover:bg-primary/10">
                Affecter <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel className="text-xs">Affecter à une section</DropdownMenuLabel>
              {classes.length === 0 ? (
                <div className="p-2 text-xs text-muted-foreground">Aucune section créée.</div>
              ) : (
                classes.map((cls) => (
                  <DropdownMenuItem
                    key={cls.id}
                    onClick={() => onAssignToClass?.(candidate.studentId, cls.id)}
                    className="text-xs"
                  >
                    <span className="font-semibold text-foreground mr-1">{cls.name}</span>
                    <span className="text-[10px] text-muted-foreground font-mono">
                      (salle {cls.room ?? "—"})
                    </span>
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}