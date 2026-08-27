import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Save, CheckCheck, Loader2, Clock } from "lucide-react";
import { useRepositories } from "../../app/providers/repository-provider";
import { useToast } from "../../app/providers/toast-provider";
import { useAuth } from "../../app/providers/auth-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import {
  ATTENDANCE_STATUS_LABELS_FR,
  ATTENDANCE_STATUS_SHORT,
  type AttendanceStatus,
  type AttendanceSession,
} from "../../domain/model/academic";
import { PageHeader } from "../../shared/layout/page-header";
import { Card, CardContent } from "../../shared/ui/card";
import { Button } from "../../shared/ui/button";
import { Avatar, AvatarFallback } from "../../shared/ui/avatar";
import { Input } from "../../shared/ui/input";
import { Label } from "../../shared/ui/label";
import { Badge } from "../../shared/ui/badge";
import { StatusChip } from "../../shared/ui/status-chip";
import { cn } from "../../shared/ui/cn";

const STATUS_ORDER: AttendanceStatus[] = [
  "present",
  "absent_excused",
  "absent_unexcused",
  "late",
];
const STATUS_TONES: Record<
  AttendanceStatus,
  "success" | "warning" | "danger" | "info"
> = {
  present: "success",
  // VAULT §09.03 — EXCUSED = warning gold (#C8A98C), LATE = light blue
  // (#6EC1E4). The previous mapping swapped these two tones.
  absent_excused: "warning",
  absent_unexcused: "danger",
  late: "info",
};

export function RollCallScreen() {
  const { classId } = useParams<{ classId: string }>();
  const navigate = useNavigate();
  const repos = useRepositories();
  const toast = useToast();
  const { session: authSession } = useAuth();

  const cls = useObservable(
    () => repos.classes.observeById(classId ?? ""),
    [classId],
  );
  const students = useObservable(
    () => repos.students.observeByClass(classId ?? ""),
    [classId],
  );

  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [sess, setSess] = useState<AttendanceSession>("morning");
  const [statuses, setStatuses] = useState<Map<string, AttendanceStatus>>(
    new Map(),
  );
  // VAULT §09.01 — arrival times (HH:MM) for students marked LATE.
  const [arrivalTimes, setArrivalTimes] = useState<Map<string, string>>(
    new Map(),
  );
  const [saving, setSaving] = useState(false);

  // Initialize students to "present"
  if (statuses.size === 0 && students.length > 0) {
    const initial = new Map<string, AttendanceStatus>();
    students.forEach((s) => initial.set(s.id, "present"));
    setStatuses(initial);
  }

  function setStatus(studentId: string, status: AttendanceStatus) {
    setStatuses((prev) => new Map(prev).set(studentId, status));
    // VAULT §09.01 — tapping LATE opens an inline time selector pre-filled
    // with the current time; switching away from LATE clears it.
    if (status === "late") {
      setArrivalTimes((prev) =>
        prev.has(studentId)
          ? prev
          : new Map(prev).set(studentId, new Date().toTimeString().slice(0, 5)),
      );
    } else {
      setArrivalTimes((prev) => {
        if (!prev.has(studentId)) return prev;
        const next = new Map(prev);
        next.delete(studentId);
        return next;
      });
    }
  }

  function setAllPresent() {
    const next = new Map<string, AttendanceStatus>();
    students.forEach((s) => next.set(s.id, "present"));
    setStatuses(next);
  }

  const absentCount = Array.from(statuses.values()).filter(
    (s) => s !== "present",
  ).length;

  async function save() {
    if (!authSession || !classId) return;
    setSaving(true);
    try {
      const result = await repos.attendance.recordRollCall({
        classId,
        date,
        session: sess,
        statuses,
        arrivalTimes,
        recordedBy: authSession.userId,
      });

      if (result.ok) {
        const nonPresentIds = Array.from(statuses.entries())
          .filter(([, st]) => st !== "present")
          .map(([id]) => id);

        if (nonPresentIds.length > 0) {
          await repos.attendance.alertAbsences(nonPresentIds);
        }

        toast.showSuccess(
          "Appel enregistré",
          `${students.length - absentCount} présent(s), ${absentCount} absence(s)/retard(s).`,
        );
        navigate(`/academics/class/${classId}`);
      } else {
        toast.showError("Échec de l'appel", result.error.userMessage);
      }
    } finally {
      setSaving(false);
    }
  }

  if (!cls) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader title="Classe introuvable" />
        <Button
          variant="outline"
          onClick={() => navigate("/academics")}
          className="mx-6 w-fit"
        >
          <ArrowLeft className="h-4 w-4" /> Retour
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title={`Appel 30 sec — ${cls.name}`}
        description="Saisie rapide des présences quotidiennes (plan §09.01)"
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate(`/academics/class/${classId}`)}
          >
            <ArrowLeft className="h-4 w-4" /> Annuler
          </Button>
        }
      />

      <div className="flex flex-wrap items-end gap-3 px-6 pb-3">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Date</Label>
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-44 h-9"
          />
        </div>

        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Session</Label>
          <div className="flex rounded-md border border-border overflow-hidden">
            {(["morning", "afternoon", "both"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSess(s)}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium transition-colors",
                  sess === s
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-accent/10",
                )}
              >
                {s === "morning"
                  ? "Matin"
                  : s === "afternoon"
                    ? "Après-midi"
                    : "Les deux"}
              </button>
            ))}
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={setAllPresent}
          className="ml-auto"
        >
          <CheckCheck className="h-4 w-4" /> Tous présents
        </Button>

        <Badge variant={absentCount > 0 ? "warning" : "success"}>
          {absentCount > 0 ? `${absentCount} signalement(s)` : "Tous présents"}
        </Badge>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-20">
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {students.map((s, idx) => {
                const status = statuses.get(s.id) ?? "present";
                return (
                  <li
                    key={s.id}
                    className="flex items-center gap-3 p-3 hover:bg-accent/5"
                  >
                    <span className="text-xs text-muted-foreground font-mono w-6 text-right">
                      {idx + 1}
                    </span>
                    <Avatar className="h-9 w-9">
                      <AvatarFallback>
                        {s.firstName[0]}
                        {s.lastName[0]}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {s.firstName} {s.lastName}
                      </p>
                      <p className="text-[10px] text-muted-foreground font-mono">
                        {s.code}
                      </p>
                    </div>

                    <div className="flex items-center gap-1">
                      {STATUS_ORDER.map((st) => {
                        const active = status === st;
                        const tone = STATUS_TONES[st];
                        const toneClass = {
                          success: active
                            ? "bg-status-success text-white"
                            : "text-status-success border-status-success/40",
                          warning: active
                            ? "bg-status-warning text-white"
                            : "text-status-warning border-status-warning/40",
                          danger: active
                            ? "bg-status-danger text-white"
                            : "text-status-danger border-status-danger/40",
                          info: active
                            ? "bg-status-info text-white"
                            : "text-status-info border-status-info/40",
                        }[tone];

                        return (
                          <button
                            key={st}
                            type="button"
                            onClick={() => setStatus(s.id, st)}
                            className={cn(
                              "h-9 w-10 rounded-md border text-xs font-bold transition-all",
                              toneClass,
                            )}
                          >
                            {ATTENDANCE_STATUS_SHORT[st]}
                          </button>
                        );
                      })}
                    </div>

                    {/* VAULT §09.01 — inline arrival-time selector for LATE */}
                    {status === "late" && (
                      <div className="flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5 text-status-info" />
                        <input
                          type="time"
                          value={arrivalTimes.get(s.id) ?? ""}
                          onChange={(e) =>
                            setArrivalTimes((prev) =>
                              new Map(prev).set(s.id, e.target.value),
                            )
                          }
                          className="h-8 w-28 rounded-md border border-status-info/40 bg-background px-2 text-xs font-mono text-status-info"
                          aria-label={`Heure d'arrivée de ${s.firstName} ${s.lastName}`}
                        />
                      </div>
                    )}

                    <div className="w-32 text-right">
                      <StatusChip
                        label={ATTENDANCE_STATUS_LABELS_FR[status]}
                        tone={STATUS_TONES[status]}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      </div>

      <div className="sticky bottom-0 left-0 right-0 border-t border-border bg-surface-panel/95 backdrop-blur-sm p-3 flex items-center justify-between">
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5" /> {students.length} élève(s) ·{" "}
          {absentCount} absence(s)
        </p>
        <Button onClick={save} disabled={saving || students.length === 0}>
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Enregistrer l'appel
        </Button>
      </div>
    </div>
  );
}
