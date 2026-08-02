/**
 * Tab 1 — Infos (identity card + family links).
 *
 * Bidirectional navigation to the parent drawer (plan §04.04).
 *
 * Extracted from `student-detail-drawer.tsx` (iteration 6-a). Behavior
 * preserved exactly — only file location + import paths changed.
 */
import {
  ArrowRight, Phone,
} from "lucide-react";
import { useRepositories } from "../../../app/providers/repository-provider";
import { useObservable } from "../../../shared/hooks/use-observable";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../../shared/ui/card";
import { Button } from "../../../shared/ui/button";
import { StatusChip } from "../../../shared/ui/status-chip";
import { formatDate } from "../../../core/format/date";
import {
  LEVEL_LABELS_FR,
  STUDENT_STATUS_LABELS_FR,
} from "../../../domain/model/student";

export function InfoTab({
  studentId,
  onOpenParent,
}: {
  studentId: string;
  onOpenParent?: (parentId: string) => void;
}) {
  const repos = useRepositories();
  const student = useObservable(() => repos.students.observeById(studentId), [studentId]);
  const parent = useObservable(
    () => repos.parents.observeById(student?.parentId ?? ""),
    [student?.parentId],
  );
  const siblings = useObservable(
    () => repos.students.observeByParent(student?.parentId ?? ""),
    [student?.parentId],
  );

  if (!student) return null;

  return (
    <div className="space-y-4">
      {/* Identity */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Identité</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <Detail label="Nom complet" value={`${student.firstName} ${student.lastName}`} />
          <Detail label="Code" value={student.code} mono />
          <Detail label="Né(e) le" value={formatDate(student.birthDate)} />
          <Detail label="Inscrit le" value={formatDate(student.enrollmentDate)} />
          <Detail label="Niveau" value={LEVEL_LABELS_FR[student.level]} />
          <Detail label="Année" value={`${student.gradeYear}`} />
          <Detail
            label="Statut"
            value={
              <StatusChip
                label={STUDENT_STATUS_LABELS_FR[student.status]}
                tone={student.status === "active" ? "success" : "neutral"}
              />
            }
          />
          <Detail label="Transport" value={zoneLabel(student.transportTier)} />
          {student.medicalNotes && (
            <div className="col-span-2">
              <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Notes médicales</p>
              <p className="text-sm rounded-md bg-status-warning/10 border border-status-warning/30 p-2">
                {student.medicalNotes}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Family — bidirectional nav to parent drawer (plan §04.04) */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-sm">Famille</CardTitle>
            <CardDescription>Navigation bidirectionnelle parent  enfant (plan §04.04)</CardDescription>
          </div>
          {parent && onOpenParent && (
            <Button size="sm" variant="outline" onClick={() => onOpenParent(parent.id)}>
              Voir le parent <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {parent && (
            <div className="rounded-md border border-border p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Parent / Tuteur</p>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{parent.firstName} {parent.lastName}</p>
                  <p className="text-xs text-muted-foreground font-mono">{parent.code}</p>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  <p className="flex items-center gap-1 justify-end">
                    <Phone className="h-3 w-3" /> {parent.phone}
                  </p>
                </div>
              </div>
            </div>
          )}
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
              Fratrie ({siblings.filter((s) => s.id !== studentId).length})
            </p>
            {siblings.filter((s) => s.id !== studentId).length === 0 ? (
              <p className="text-xs text-muted-foreground italic">Aucun frère / sœur inscrit.</p>
            ) : (
              <ul className="space-y-1">
                {siblings.filter((s) => s.id !== studentId).map((sib) => (
                  <li key={sib.id} className="flex items-center gap-2 text-sm">
                    <span className="flex-1 truncate">{sib.firstName} {sib.lastName}</span>
                    <span className="text-xs text-muted-foreground">{LEVEL_LABELS_FR[sib.level]} · A{sib.gradeYear}</span>
                    <StatusChip
                      label={STUDENT_STATUS_LABELS_FR[sib.status]}
                      tone={sib.status === "active" ? "success" : "neutral"}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ============================================================ */
/* Helpers (used only by InfoTab — kept local to this file)     */
/* ============================================================ */
function Detail({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-sm ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}

function zoneLabel(tier: string | null | undefined): string {
  if (!tier) return "Sans transport";
  if (tier === "t1") return "Zone urbaine (T1)";
  if (tier === "t2") return "Zone périurbaine (T2)";
  if (tier === "t3") return "Zone rurale (T3)";
  return tier;
}
