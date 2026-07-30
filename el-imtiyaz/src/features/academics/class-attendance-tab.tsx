/**
 * ClassAttendanceTab — replaces placeholder in Class Detail page.
 *
 * Iteration 3-G: this-week summary (Present/Late/Absent counts),
 * grouped by date. Uses AttendanceRepository.observeByClass(classId, date).
 */
import { useState } from "react";
import { Calendar, CheckCircle2, AlertCircle, XCircle, Clock } from "lucide-react";
import { useRepositories } from "../../app/providers/repository-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../shared/ui/card";
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

  // Query attendance for the last 7 days
  const today = new Date();
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const todayStr = today.toISOString().slice(0, 10);
  const weekAgoStr = weekAgo.toISOString().slice(0, 10);

  // observeByClass(classId, date) — pass today's date as a reasonable default
  const records = useObservable(
    () => repos.attendance.observeByClass(classId, todayStr),
    [classId, todayStr],
  );

  // Group by date
  const byDate = new Map<string, typeof records>();
  for (const r of records) {
    if (!byDate.has(r.date)) byDate.set(r.date, []);
    byDate.get(r.date)!.push(r);
  }
  const dates = Array.from(byDate.keys()).sort((a, b) => b.localeCompare(a));

  // Compute summary
  const counts = records.reduce(
    (acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<AttendanceStatus, number>,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <Calendar className="h-4 w-4 text-primary" /> Présences — 7 derniers jours
        </CardTitle>
        <CardDescription>
          {records.length} enregistrement(s) sur la période {formatDate(weekAgoStr)} → {formatDate(todayStr)}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {records.length === 0 ? (
          <EmptyState
            title="Aucun enregistrement"
            description="Les présences apparaîtront ici une fois l'appel effectué via 'Appel (30 sec)'."
          />
        ) : (
          <>
            {/* Summary cards */}
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

            {/* Per-date breakdown */}
            <div className="rounded-md border border-border overflow-hidden">
              <div className="bg-muted/30 px-3 py-2 text-xs uppercase text-muted-foreground">
                Détail par date
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
                          <p className="text-sm font-medium">{formatDate(date)}</p>
                          <p className="text-xs text-muted-foreground">
                            {dayCounts.present ?? 0} présents · {dayCounts.late ?? 0} retards ·{" "}
                            {(dayCounts.absent_excused ?? 0) + (dayCounts.absent_unexcused ?? 0)} absences
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
                        {(["present", "late", "absent_excused", "absent_unexcused"] as AttendanceStatus[]).map((s) => {
                          const c = dayCounts[s] ?? 0;
                          if (c === 0) return null;
                          return (
                            <StatusChip
                              key={s}
                              label={`${c} ${ATTENDANCE_STATUS_LABELS_FR[s]}`}
                              tone={
                                s === "present" ? "success" :
                                s === "late" ? "warning" :
                                s === "absent_excused" ? "info" : "danger"
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
  icon: Icon, label, value, tone,
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
      <div className={`inline-flex items-center justify-center h-8 w-8 rounded-md ${toneClass} mb-2`}>
        <Icon className="h-4 w-4" />
      </div>
      <p className="text-2xl font-mono font-bold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
