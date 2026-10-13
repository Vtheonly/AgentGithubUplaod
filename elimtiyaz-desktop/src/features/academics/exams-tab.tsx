import { useState } from "react";
import { GraduationCap, MapPin, User as UserIcon, Calendar, Pencil, Trash2 } from "lucide-react";
import { useRepositories } from "../../app/providers/repository-provider";
import { useToast } from "../../app/providers/toast-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../shared/ui/card";
import { Badge } from "../../shared/ui/badge";
import { DataTable, type DataTableColumn } from "../../shared/ui/data-table";
import { ConfirmModal } from "../../shared/ui/unified-modal";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../../shared/ui/select";
import { formatDate, formatRelative } from "../../core/format/date";
import type { ExamCalendarEvent } from "../../domain/model/calendar";

/**
 * ExamsTab — T-525 (CROSS-201): the Pedagogy exam-scheduling surface. Lists
 * every scheduled exam (repos.calendar.observeExams — the calendar_events
 * rows with target_entity_type='exam') with its class, date/time, room and
 * invigilator, plus edit/reschedule (repos.calendar.update — the SAME row,
 * never a duplicate) and delete (soft-delete, 0013 semantics).
 *
 * The rows this tab manages are the SAME rows the parent portal calendar
 * renders as its "Exam Timetable" (migration 0154's parent read window
 * scopes them to the parents' own children's classes).
 */
export function ExamsTab({
  onSchedule,
  onEdit,
}: {
  onSchedule: () => void;
  onEdit: (exam: ExamCalendarEvent) => void;
}) {
  const repos = useRepositories();
  const toast = useToast();
  const classes = useObservable(() => repos.classes.observe(), []);
  const exams = useObservable(() => repos.calendar.observeExams(), []);
  const [classId, setClassId] = useState<string>("");
  const [deleteTarget, setDeleteTarget] = useState<ExamCalendarEvent | null>(null);

  const classById = new Map(classes.map((c) => [c.id, c]));
  const visible = exams.filter((e) => !classId || e.classId === classId);

  async function confirmDelete() {
    if (!deleteTarget) return;
    const result = await repos.calendar.delete(deleteTarget.id);
    if (result.ok) {
      toast.showSuccess("Examen supprimé", `« ${deleteTarget.title} » a été retiré du calendrier du portail.`);
    } else {
      toast.showError("Échec de la suppression", result.error.userMessage);
    }
    setDeleteTarget(null);
  }

  const columns: readonly DataTableColumn<ExamCalendarEvent>[] = [
    {
      header: "Examen",
      accessor: "title",
      cell: (ex) => (
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium">{ex.title}</span>
            {(() => {
              const cls = ex.classId ? classById.get(ex.classId) : undefined;
              return cls ? <Badge variant="secondary">{cls.name}</Badge> : null;
            })()}
          </div>
          <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
            {ex.room && <span className="flex items-center gap-1"><MapPin className="size-3" />{ex.room}</span>}
            {ex.invigilatorName && (
              <span className="flex items-center gap-1"><UserIcon className="size-3" />{ex.invigilatorName}</span>
            )}
          </div>
          {ex.description && <p className="text-xs text-muted-foreground line-clamp-2">{ex.description}</p>}
        </div>
      ),
    },
    {
      header: "Date",
      accessor: "date",
      cell: (ex) => (
        <span className="flex items-center gap-1 text-xs">
          <Calendar className="size-3" />
          {formatDate(ex.date)}
          {ex.time ? ` — ${ex.time}` : ""}
        </span>
      ),
    },
    { header: "Programmé", accessor: "createdAt", cell: (ex) => <span className="text-xs text-muted-foreground">{formatRelative(ex.createdAt)}</span> },
  ];

  return (
    <Card>
      <CardHeader className="border-b border-border">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <CardTitle className="text-sm flex items-center gap-2">
              <GraduationCap className="size-4 text-primary" /> Examens programmés
            </CardTitle>
            <CardDescription>
              {visible.length} examen(s) — programmés ici, publiés sur le calendrier du portail web des élèves (dates, salles, surveillants).
            </CardDescription>
          </div>
          <Select value={classId || "__all__"} onValueChange={(v) => setClassId(v === "__all__" ? "" : v)}>
            <SelectTrigger className="w-56 h-8 text-xs"><SelectValue placeholder="Toutes les classes" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Toutes les classes</SelectItem>
              {classes.map((c) => (<SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="p-3">
        <DataTable<ExamCalendarEvent>
          data={visible}
          columns={columns}
          searchFields={["title"]}
          searchPlaceholder="Rechercher un examen…"
          emptyMessage={
            classId
              ? "Aucun examen programmé pour cette classe — cliquez sur « Programmer un examen »."
              : "Aucun examen programmé — cliquez sur « Programmer un examen » pour le publier sur le calendrier du portail."
          }
          pageSize={10}
          actions={[
            {
              label: "Modifier",
              icon: <Pencil className="size-3.5" />,
              variant: "outline",
              onClick: (ex) => onEdit(ex),
            },
            {
              label: "Supprimer",
              icon: <Trash2 className="size-3.5" />,
              variant: "destructive",
              onClick: (ex) => setDeleteTarget(ex),
            },
          ]}
        />
      </CardContent>

      <ConfirmModal
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Supprimer l'examen ?"
        description={
          deleteTarget
            ? `« ${deleteTarget.title} » sera retiré du calendrier du portail web.`
            : ""
        }
        destructive
        confirmLabel="Supprimer"
        onConfirm={confirmDelete}
      />
    </Card>
  );
}
