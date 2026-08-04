/**
 * "Faire l'appel" modal — calls repos.attendance.recordRollCall().
 *
 * Extracted from `teacher-dashboard.tsx` in task 6-b. Behavior preserved
 * verbatim — only file location + import paths changed.
 */
import { useEffect, useState } from "react";
import { ClipboardCheck, CheckCircle2 } from "lucide-react";
import { useRepositories } from "../../../../app/providers/repository-provider";
import { useObservable } from "../../../../shared/hooks/use-observable";
import { useToast } from "../../../../app/providers/toast-provider";
import {
  type AttendanceStatus,
  type AttendanceSession,
  type AcademicClass,
} from "../../../../domain/model/academic";
import { Label } from "../../../../shared/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../../../../shared/ui/select";
import { UnifiedModal } from "../../../../shared/ui/unified-modal";
import { ATTENDANCE_OPTIONS, todayIso } from "./types";

export function TakeAttendanceModal({
  open, onOpenChange, classId, classes, recordedBy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  classId: string;
  classes: readonly AcademicClass[];
  recordedBy: string;
}) {
  const repos = useRepositories();
  const toast = useToast();
  const students = useObservable(
    () => classId ? repos.students.observeByClass(classId) : repos.students.observeByClass(""),
    [classId],
  );
  const [statuses, setStatuses] = useState<Map<string, AttendanceStatus>>(new Map());
  const [session, setSession] = useState<AttendanceSession>("morning");

  useEffect(() => {
    if (open && students.length > 0) {
      setStatuses(new Map(students.map((s) => [s.id, "present" as AttendanceStatus])));
    }
  }, [open, students]);

  const cls = classes.find((c) => c.id === classId);

  async function handleSubmit() {
    if (!cls) return;
    const result = await repos.attendance.recordRollCall({
      classId, date: todayIso(), session, statuses: statuses as ReadonlyMap<string, AttendanceStatus>, recordedBy,
    });
    if (result.ok) {
      toast.showSuccess("Appel enregistré", `${students.length} élève(s) pointé(s).`);
      onOpenChange(false);
    } else {
      toast.showError("Erreur", "Impossible d'enregistrer l'appel.");
    }
  }

  return (
    <UnifiedModal
      open={open} onOpenChange={onOpenChange}
      title={`Faire l'appel — ${cls?.name ?? ""}`}
      description={todayIso()}
      icon={ClipboardCheck} size="lg"
      submitLabel="Enregistrer" submitIcon={CheckCircle2} onSubmit={handleSubmit}
    >
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Label className="text-xs">Session :</Label>
          <Select value={session} onValueChange={(v) => setSession(v as AttendanceSession)}>
            <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="morning">Matin</SelectItem>
              <SelectItem value="afternoon">Après-midi</SelectItem>
              <SelectItem value="both">Les deux</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {students.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun élève dans cette classe.</p>
        ) : (
          <ul className="divide-y divide-border">
            {students.map((s) => {
              const cur = statuses.get(s.id) ?? "present";
              return (
                <li key={s.id} className="py-2 flex items-center gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground truncate">{s.firstName} {s.lastName}</p>
                  </div>
                  <Select value={cur} onValueChange={(v) => {
                    setStatuses((m) => new Map(m).set(s.id, v as AttendanceStatus));
                  }}>
                    <SelectTrigger className="h-8 w-44"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ATTENDANCE_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </UnifiedModal>
  );
}
