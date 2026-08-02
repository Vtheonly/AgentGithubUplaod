/**
 * RollCallScreen — 30-second attendance workflow (plan §09.01).
 *
 * Workflow:
 *   1. Select class + date + session (Matin / Après-midi / Les deux)
 *   2. Roster loads with every student defaulting to PRESENT
 *   3. Per-student 4-button row: P / AE / AN / R
 *      (Présent / Absence excusée / Absence non excusée / Retard)
 *   4. Sticky "Tous présents" button + absence counter
 *   5. Sticky bottom save bar
 *   6. On save → recordRollCall() + alertAbsences() if any non-Present
 *
 * Per plan: maximum 4 statuses. No 5th "CUSTOM" status allowed.
 */
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
import { toIsoDay } from "../../core/format/date";
import { PageHeader } from "../../shared/layout/page-header";
import { Card, CardContent } from "../../shared/ui/card";
import { Button } from "../../shared/ui/button";
import { Avatar, AvatarFallback } from "../../shared/ui/avatar";
import { Input } from "../../shared/ui/input";
import { Label } from "../../shared/ui/label";
import { Badge } from "../../shared/ui/badge";
import { StatusChip } from "../../shared/ui/status-chip";
import { cn } from "../../shared/ui/cn";

const STATUS_ORDER: AttendanceStatus[] = ["present", "absent_excused", "absent_unexcused", "late"];
const STATUS_TONES: Record<AttendanceStatus, "success" | "warning" | "danger" | "info"> = {
  present: "success",
  absent_excused: "info",
  absent_unexcused: "danger",
  late: "warning",
};

export function RollCallScreen() {
  const { classId } = useParams<{ classId: string }>();
  const navigate = useNavigate();
  const repos = useRepositories();
  const toast = useToast();
  const auth = useAuth();
  const cls = useObservable(() => repos.classes.observeById(classId ?? ""), [classId]);
  const students = useObservable(() => repos.students.observeByClass(classId ?? ""), [classId]);

  const [date, setDate] = useState(toIsoDay());
  const [sess, setSess] = useState<AttendanceSession>("morning");
  const [statuses, setStatuses] = useState<Map<string, AttendanceStatus>>(new Map());
  const [saving, setSaving] = useState(false);

  // Initialize all students to "present" on first load.
  function ensureInitialized() {
    if (statuses.size === 0 && students.length > 0) {
      const next = new Map<string, AttendanceStatus>();
      for (const s of students) next.set(s.id, "present");
      setStatuses(next);
    }
  }
  ensureInitialized();

  function setStatus(studentId: string, status: AttendanceStatus) {
    setStatuses((curr) => {
      const next = new Map(curr);
      next.set(studentId, status);
      return next;
    });
  }

  function setAllPresent() {
    const next = new Map<string, AttendanceStatus>();
    for (const s of students) next.set(s.id, "present");
    setStatuses(next);
  }

  const absentCount = Array.from(statuses.values()).filter((s) => s !== "present").length;

  async function save() {
    if (!auth.session || !classId) return;
    setSaving(true);
    try {
      const result = await repos.attendance.recordRollCall({
        classId,
        date,
        session: sess,
        statuses,
        recordedBy: auth.session.userId,
      });
      if (result.ok) {
        const absentIds = [...statuses.entries()]
          .filter(([, s]) => s !== "present")
          .map(([id]) => id);
        if (absentIds.length > 0) {
          await repos.attendance.alertAbsences(absentIds);
        }
        toast.showSuccess(
          "Appel enregistré",
          `${students.length - absentCount} présent(s), ${absentCount} absent(s)/retard(s).`,
        );
        navigate(`/academics/class/${classId}`);
      } else {
        toast.showError("Échec", result.error.userMessage);
      }
    } finally {
      setSaving(false);
    }
  }

  if (!cls) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader title="Classe introuvable" />
        <Button variant="outline" onClick={() => navigate("/academics")} className="mx-6 w-fit">
          <ArrowLeft className="h-4 w-4" /> Retour
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title={`Appel — ${cls.name}`}
        description="Appel en 30 secondes — Plan §09.01"
        actions={
          <Button variant="outline" size="sm" onClick={() => navigate(`/academics/class/${classId}`)}>
            <ArrowLeft className="h-4 w-4" /> Annuler
          </Button>
        }
      />

      {/* Session config */}
      <div className="flex flex-wrap items-end gap-3 px-6 pb-3">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Date</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-44 h-9" />
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
                  sess === s ? "bg-primary text-primary-foreground" : "hover:bg-accent/10",
                )}
              >
                {s === "morning" ? "Matin" : s === "afternoon" ? "Après-midi" : "Les deux"}
              </button>
            ))}
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={setAllPresent} className="ml-auto">
          <CheckCheck className="h-4 w-4" /> Tous présents
        </Button>
        <Badge variant={absentCount > 0 ? "warning" : "success"}>
          {absentCount > 0 ? `${absentCount} absent(s)/retard(s)` : "Tous présents"}
        </Badge>
      </div>

      {/* Roster */}
      <div className="flex-1 overflow-y-auto px-6 pb-20">
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {students.map((s, idx) => {
                const status = statuses.get(s.id) ?? "present";
                return (
                  <li key={s.id} className="flex items-center gap-3 p-3">
                    <span className="text-xs text-muted-foreground font-mono w-6 text-right">
                      {idx + 1}
                    </span>
                    <Avatar className="h-9 w-9">
                      <AvatarFallback>
                        {s.firstName[0]}{s.lastName[0]}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {s.firstName} {s.lastName}
                      </p>
                      <p className="text-[11px] text-muted-foreground font-mono">{s.code}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      {STATUS_ORDER.map((st) => {
                        const active = status === st;
                        const tone = STATUS_TONES[st];
                        const toneClasses = {
                          success: active ? "bg-status-success text-white border-status-success" : "text-status-success border-status-success/40 hover:bg-status-success/10",
                          warning: active ? "bg-status-warning text-white border-status-warning" : "text-status-warning border-status-warning/40 hover:bg-status-warning/10",
                          danger: active ? "bg-status-danger text-white border-status-danger" : "text-status-danger border-status-danger/40 hover:bg-status-danger/10",
                          info: active ? "bg-status-info text-white border-status-info" : "text-status-info border-status-info/40 hover:bg-status-info/10",
                        }[tone];
                        return (
                          <button
                            key={st}
                            type="button"
                            onClick={() => setStatus(s.id, st)}
                            className={cn(
                              "h-9 w-10 rounded-md border text-xs font-bold transition-colors",
                              toneClasses,
                            )}
                            title={ATTENDANCE_STATUS_LABELS_FR[st]}
                          >
                            {ATTENDANCE_STATUS_SHORT[st]}
                          </button>
                        );
                      })}
                    </div>
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

      {/* Sticky save bar */}
      <div className="sticky bottom-0 left-0 right-0 border-t border-border bg-surface-panel/95 backdrop-blur-sm p-3 flex items-center justify-between">
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5" />
          {students.length === 0 ? "Chargement…" : `${students.length} élève(s) · ${absentCount} à signaler`}
        </p>
        <Button onClick={save} disabled={saving || statuses.size === 0}>
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Enregistrement…
            </>
            ) : (
            <>
              <Save className="h-4 w-4" /> Enregistrer l'appel
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
