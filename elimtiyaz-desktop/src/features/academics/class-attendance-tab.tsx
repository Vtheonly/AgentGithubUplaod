// ============================================================================
// FILE: src/features/academics/class-attendance-tab.tsx
// ============================================================================
import { useNavigate } from "react-router-dom";
import {
  Calendar,
  CheckCircle2,
  AlertCircle,
  XCircle,
  Clock,
  ClipboardCheck,
} from "lucide-react";
import { useRepositories } from "../../app/providers/repository-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../../shared/ui/card";
import { Button } from "../../shared/ui/button";
import { EmptyState } from "../../shared/layout/state-views";
import { StatusChip } from "../../shared/ui/status-chip";
import { formatDate } from "../../core/format/date";
import {
  ATTENDANCE_STATUS_LABELS_FR,
  SESSION_LABELS_FR,
  type AttendanceStatus,
} from "../../domain/model/academic";

export function ClassAttendanceTab({ classId }: { classId: string }) {
  const repos = useRepositories();
  const navigate = useNavigate();

  const today = new Date();
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 14);
  const todayStr = today.toISOString().slice(0, 10);
  const weekAgoStr = weekAgo.toISOString().slice(0, 10);

  const records = useObservable(
    () => repos.attendance.observeByClassRange(classId, weekAgoStr, todayStr),
    [classId, weekAgoStr, todayStr],
  );

  const byDate = new Map<string, typeof records>();
  for (const r of records) {
    if (!byDate.has(r.date)) byDate.set(r.date, []);
    byDate.get(r.date)!.push(r);
  }
  const dates = Array.from(byDate.keys()).sort((a, b) => b.localeCompare(a));

  const counts = records.reduce(
    (acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<AttendanceStatus, number>,
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3 flex-wrap gap-2">
        <div>
          <CardTitle className="text-sm flex items-center gap-2">
            <Calendar className="h-4 w-4 text-primary" /> Présences &amp;
            Assiduité de la classe
          </CardTitle>
          <CardDescription>
            {records.length} enregistrement(s) sur les 14 derniers jours (
            {formatDate(weekAgoStr)} → {formatDate(todayStr)})
          </CardDescription>
        </div>
        <Button
          size="sm"
          onClick={() => navigate(`/academics/class/${classId}/roll-call`)}
        >
          <ClipboardCheck className="h-4 w-4 mr-1" /> Faire l'appel (30 sec)
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        {records.length === 0 ? (
          <div className="space-y-3 py-6 text-center">
            <EmptyState
              title="Aucun enregistrement de présence"
              description="Les présences apparaîtront ici dès que l'appel aura été effectué."
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigate(`/academics/class/${classId}/roll-call`)}
            >
              <ClipboardCheck className="h-4 w-4 mr-1" /> Faire le premier appel
              de la classe
            </Button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <SummaryCard
                icon={CheckCircle2}
                label="Présents"
                value={counts.present ?? 0}
                tone="success"
              />
              <SummaryCard
                icon={Clock}
                label="Retards"
                value={counts.late ?? 0}
                tone="warning"
              />
              <SummaryCard
                icon={AlertCircle}
                label="Abs. excusées"
                value={counts.absent_excused ?? 0}
                tone="info"
              />
              <SummaryCard
                icon={XCircle}
                label="Abs. non excusées"
                value={counts.absent_unexcused ?? 0}
                tone="danger"
              />
            </div>

            <div className="rounded-md border border-border overflow-hidden">
              <div className="bg-muted/30 px-3 py-2 text-xs uppercase text-muted-foreground font-semibold">
                Historique chronologique
              </div>
              <ul className="divide-y divide-border">
                {dates.map((date) => {
                  const dayRecords = byDate.get(date) ?? [];
                  const dayCounts = dayRecords.reduce(
                    (acc, r) => {
                      acc[r.status] = (acc[r.status] ?? 0) + 1;
                      return acc;
                    },
                    {} as Record<string, number>,
                  );
                  return (
                    <li key={date} className="p-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            {formatDate(date)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {dayCounts.present ?? 0} présents ·{" "}
                            {dayCounts.late ?? 0} retards ·{" "}
                            {(dayCounts.absent_excused ?? 0) +
                              (dayCounts.absent_unexcused ?? 0)}{" "}
                            absences
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {dayRecords[0] && (
                            <span className="text-xs text-muted-foreground">
                              {SESSION_LABELS_FR[dayRecords[0].session]}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1 mt-2">
                        {(
                          [
                            "present",
                            "late",
                            "absent_excused",
                            "absent_unexcused",
                          ] as AttendanceStatus[]
                        ).map((s) => {
                          const c = dayCounts[s] ?? 0;
                          if (c === 0) return null;
                          return (
                            <StatusChip
                              key={s}
                              label={`${c} ${ATTENDANCE_STATUS_LABELS_FR[s]}`}
                              tone={
                                s === "present"
                                  ? "success"
                                  : s === "late"
                                    ? "info"
                                    : s === "absent_excused"
                                      ? "warning"
                                      : "danger"
                              }
                            />
                          );
                        })}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof CheckCircle2;
  label: string;
  value: number;
  tone: "success" | "warning" | "danger" | "info";
}) {
  const toneClass = {
    success: "text-status-success bg-status-success/10",
    warning: "text-status-warning bg-status-warning/10",
    danger: "text-status-danger bg-status-danger/10",
    info: "text-status-info bg-status-info/10",
  }[tone];
  return (
    <div className="rounded-md border border-border p-3">
      <div
        className={`inline-flex items-center justify-center h-8 w-8 rounded-md ${toneClass} mb-2`}
      >
        <Icon className="h-4 w-4" />
      </div>
      <p className="text-2xl font-mono font-bold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
