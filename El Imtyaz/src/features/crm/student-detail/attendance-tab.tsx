/**
 * Tab 3 — Présences (attendance summary with 3+ absence alert badge).
 *
 * Plan §09.03: 3+ absences over the last 90 days → automatic parent
 * notification. This tab surfaces the alert badge + the per-status
 * breakdown.
 *
 * Extracted from `student-detail-drawer.tsx` (iteration 6-a). Behavior
 * preserved exactly — only file location + import paths changed.
 */
import { useRepositories } from "../../../app/providers/repository-provider";
import { useObservable } from "../../../shared/hooks/use-observable";
import { Card, CardContent, CardHeader, CardTitle } from "../../../shared/ui/card";
import { StatusChip } from "../../../shared/ui/status-chip";
import { formatDate, formatRelative } from "../../../core/format/date";
import {
  ATTENDANCE_STATUS_LABELS_FR,
  SESSION_LABELS_FR,
} from "../../../domain/model/academic";

export function AttendanceTab({ studentId }: { studentId: string }) {
  const repos = useRepositories();
  const student = useObservable(() => repos.students.observeById(studentId), [studentId]);

  // Last 90 days of attendance
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 90);
  const attendance = useObservable(
    () => repos.attendance.observeByStudent(
      studentId,
      from.toISOString().slice(0, 10),
      to.toISOString().slice(0, 10),
    ),
    [studentId],
  );

  const counts = attendance.reduce(
    (acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  const totalAbsences = (counts.absent_excused ?? 0) + (counts.absent_unexcused ?? 0);
  const alert = totalAbsences >= 3;

  return (
    <div className="space-y-4">
      {alert && (
        <div className="rounded-md border border-status-warning/40 bg-status-warning/10 p-3 flex items-start gap-2">
          <StatusChip label="Alerte présences" tone="warning" />
          <div className="flex-1 text-sm">
            <p className="font-medium">
              {totalAbsences} absence{totalAbsences > 1 ? "s" : ""} sur les 90 derniers jours (plan §09.03)
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Seuil d'alerte: 3+ absences → notification automatique aux parents.
            </p>
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Synthèse — 90 derniers jours</CardTitle>
        </CardHeader>
        <CardContent>
          {attendance.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Aucun enregistrement de présence sur la période.
            </p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatBox label="Présents" value={counts.present ?? 0} tone="success" />
              <StatBox label="Absences excusées" value={counts.absent_excused ?? 0} tone="info" />
              <StatBox label="Absences non excusées" value={counts.absent_unexcused ?? 0} tone="danger" />
              <StatBox label="Retards" value={counts.late ?? 0} tone="warning" />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Derniers enregistrements</CardTitle>
        </CardHeader>
        <CardContent>
          {attendance.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">Aucun enregistrement.</p>
          ) : (
            <ul className="divide-y divide-border">
              {attendance.slice(0, 10).map((r) => (
                <li key={r.id} className="flex items-center gap-3 py-2 text-sm">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">{formatDate(r.date)}</p>
                    <p className="text-xs text-muted-foreground">
                      {SESSION_LABELS_FR[r.session]} · {formatRelative(r.recordedAt)}
                    </p>
                  </div>
                  <StatusChip
                    label={ATTENDANCE_STATUS_LABELS_FR[r.status]}
                    tone={
                      r.status === "present" ? "success" :
                      r.status === "absent_excused" ? "info" :
                      r.status === "absent_unexcused" ? "danger" :
                      "warning"
                    }
                  />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ============================================================ */
/* Helper (used only by AttendanceTab — kept local to this file) */
/* ============================================================ */
function StatBox({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "success" | "warning" | "danger" | "info";
}) {
  const toneClass = {
    success: "text-status-success",
    warning: "text-status-warning",
    danger: "text-status-danger",
    info: "text-status-info",
  }[tone];
  return (
    <div className="rounded-md border border-border p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-2xl font-mono font-bold ${toneClass} mt-1`}>{value}</p>
    </div>
  );
}
