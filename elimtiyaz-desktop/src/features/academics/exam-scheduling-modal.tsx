import { useState } from "react";
import { GraduationCap, Send, Loader2 } from "lucide-react";
import { useRepositories } from "../../app/providers/repository-provider";
import { useToast } from "../../app/providers/toast-provider";
import { useAuth } from "../../app/providers/auth-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import {
  UnifiedModal,
  type UnifiedModalProps,
} from "../../shared/ui/unified-modal";
import { Input } from "../../shared/ui/input";
import { Textarea } from "../../shared/ui/textarea";
import { FormField } from "../../shared/ui/form-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../shared/ui/select";
import type { ExamCalendarEvent } from "../../domain/model/calendar";

type Alert = NonNullable<UnifiedModalProps["alert"]>;

/**
 * ExamSchedulingModal — T-525 (CROSS-201): the Pedagogy exam-scheduling
 * surface. Exams are scheduled per class (date, optional time, room,
 * invigilator) and PERSIST through the canonical CalendarRepository
 * (`repos.calendar`) as calendar_events rows with kind='custom' +
 * target_entity_type='exam' — the exact contract the parent portal's
 * calendar renders as its "Exam Timetable" (dates, rooms, invigilators —
 * portal plan §05) and that migration 0154's parent read window scopes.
 *
 * Edit mode (the `exam` prop): rescheduling/patching goes through
 * `repos.calendar.update` — the SAME row is patched, never duplicated (the
 * issue's "editing or rescheduling updates its calendar entry without
 * creating duplicates").
 */
export function ExamSchedulingModal({
  open,
  onOpenChange,
  exam,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** When set, the modal edits this exam instead of creating a new one. */
  exam?: ExamCalendarEvent | null;
}) {
  const repos = useRepositories();
  const toast = useToast();
  const { session } = useAuth();

  const classes = useObservable(() => repos.classes.observe(), []);

  const [classId, setClassId] = useState(exam?.classId ?? "");
  const [title, setTitle] = useState(exam?.title ?? "");
  const [date, setDate] = useState(exam?.date ?? new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState(exam?.time ?? "");
  const [room, setRoom] = useState(exam?.room ?? "");
  const [invigilator, setInvigilator] = useState(exam?.invigilatorName ?? "");
  const [notes, setNotes] = useState(exam?.description ?? "");
  const [saving, setSaving] = useState(false);
  const [alert, setAlert] = useState<Alert | null>(null);

  function reset() {
    setClassId("");
    setTitle("");
    setDate(new Date().toISOString().slice(0, 10));
    setTime("");
    setRoom("");
    setInvigilator("");
    setNotes("");
    setAlert(null);
  }

  async function submit() {
    if (!session) return;
    if (!classId || !title.trim() || !date) {
      setAlert({
        tone: "warning",
        title: "Champs requis",
        description: "Veuillez spécifier la classe, le titre et la date de l'examen.",
      });
      return;
    }

    setSaving(true);
    try {
      const result = exam
        ? await repos.calendar.update(exam.id, {
            date,
            time: time || null,
            title: title.trim(),
            description: notes.trim() || null,
            classId,
            room: room.trim() || null,
            invigilatorName: invigilator.trim() || null,
          })
        : await repos.calendar.create({
            kind: "exam",
            date,
            time: time || null,
            title: title.trim(),
            description: notes.trim() || null,
            priority: "medium",
            createdBy: session.userId,
            classId,
            room: room.trim() || null,
            invigilatorName: invigilator.trim() || null,
          });

      if (result.ok) {
        toast.showSuccess(
          exam ? "Examen replanifié" : "Examen programmé",
          exam
            ? `« ${title.trim()} » a été mis à jour — le portail web est synchronisé.`
            : `« ${title.trim()} » apparaîtra sur le calendrier du portail web des élèves de la classe.`,
        );
        onOpenChange(false);
        reset();
      } else {
        setAlert({
          tone: "error",
          title: exam ? "Échec de la mise à jour" : "Échec de la programmation",
          description: result.error.userMessage,
        });
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <UnifiedModal
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      variant="dialog"
      icon={GraduationCap}
      iconTone="primary"
      title={exam ? "Modifier l'examen" : "Programmer un examen"}
      description={
        exam
          ? "La modification met à jour l'entrée existante du calendrier (aucun doublon créé)."
          : "L'examen sera publié sur le calendrier du portail web des élèves de la classe sélectionnée (dates, salle, surveillant)."
      }
      submitLabel={saving ? "Enregistrement…" : exam ? "Enregistrer les modifications" : "Programmer l'examen"}
      submitIcon={saving ? Loader2 : Send}
      submitLoading={saving}
      onSubmit={submit}
      alert={alert}
      onDismissAlert={() => setAlert(null)}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <FormField label="Classe" required>
            <Select value={classId} onValueChange={setClassId}>
              <SelectTrigger>
                <SelectValue placeholder="Sélectionner la classe…" />
              </SelectTrigger>
              <SelectContent>
                {classes.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          <FormField label="Date de l'examen" required>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </FormField>
        </div>

        <FormField label="Titre de l'examen" required>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Examen de Mathématiques — Trimestre 1"
          />
        </FormField>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <FormField label="Heure">
            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </FormField>

          <FormField label="Salle">
            <Input
              value={room}
              onChange={(e) => setRoom(e.target.value)}
              placeholder="Salle 12"
            />
          </FormField>

          <FormField label="Surveillant">
            <Input
              value={invigilator}
              onChange={(e) => setInvigilator(e.target.value)}
              placeholder="M. Benali"
            />
          </FormField>
        </div>

        <FormField label="Notes (consignes pour les élèves)">
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Programme au programme : chapitres 1 à 4. Calculatrice autorisée."
            rows={3}
          />
        </FormField>
      </div>
    </UnifiedModal>
  );
}
