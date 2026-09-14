// ============================================================================
// FILE: src/features/academics/placement/create-section-dialog.tsx
// ============================================================================
import { useState, useEffect } from "react";
import { School, CheckCircle2 } from "lucide-react";
import { UnifiedModal } from "../../../shared/ui/unified-modal";
import { FormField } from "../../../shared/ui/form-field";
import { Input } from "../../../shared/ui/input";
import { Textarea } from "../../../shared/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../shared/ui/select";
import type { ClassDraft } from "../../../domain/calc/academics/class-placement";
import { GRADE_LEVEL_LABELS_FR, type GradeLevel } from "../../../domain/model/student";
import type { Personnel } from "../../../domain/model/personnel";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  gradeLevel: GradeLevel;
  personnel: readonly Personnel[];
  initialDraft?: ClassDraft | null;
  onSave: (data: {
    name?: string;
    section: string;
    room?: string | null;
    capacity?: number | null;
    homeroomTeacherId?: string | null;
    homeroomTeacherName?: string | null;
    notes?: string | null;
  }) => void;
}

export function CreateSectionDialog({
  open,
  onOpenChange,
  gradeLevel,
  personnel,
  initialDraft,
  onSave,
}: Props) {
  const [section, setSection] = useState("Section A");
  const [customName, setCustomName] = useState("");
  const [room, setRoom] = useState("");
  const [capacity, setCapacity] = useState("");
  const [teacherId, setTeacherId] = useState("");
  const [notes, setNotes] = useState("");

  const teachers = personnel.filter(
    (p) => p.staffCategory === "teacher" || p.roleId === "teacher",
  );

  useEffect(() => {
    if (initialDraft) {
      setSection(initialDraft.section || "Section A");
      setCustomName(initialDraft.name || "");
      setRoom(initialDraft.room || "");
      setCapacity(initialDraft.capacity ? String(initialDraft.capacity) : "");
      setTeacherId(initialDraft.homeroomTeacherId || "");
      setNotes(initialDraft.notes || "");
    } else {
      setSection("Section A");
      setCustomName("");
      setRoom("");
      setCapacity("28");
      setTeacherId("");
      setNotes("");
    }
  }, [initialDraft, open]);

  const previewName = customName.trim()
    ? customName.trim()
    : `${GRADE_LEVEL_LABELS_FR[gradeLevel]} - ${section}`;

  const handleSubmit = () => {
    const selectedTeacher = teachers.find((t) => t.id === teacherId);
    onSave({
      name: previewName,
      section,
      room: room.trim() || null,
      capacity: capacity ? parseInt(capacity, 10) : null,
      homeroomTeacherId: teacherId || null,
      homeroomTeacherName: selectedTeacher ? `${selectedTeacher.firstName} ${selectedTeacher.lastName}` : null,
      notes: notes.trim() || null,
    });
    onOpenChange(false);
  };

  return (
    <UnifiedModal
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      variant="dialog"
      icon={School}
      iconTone="primary"
      title={initialDraft ? `Modifier : ${initialDraft.name}` : `Créer une Section — ${GRADE_LEVEL_LABELS_FR[gradeLevel]}`}
      description="Configurez la nouvelle section de classe pour la répartition des élèves."
      submitLabel={initialDraft ? "Enregistrer" : "Créer la section"}
      onSubmit={handleSubmit}
      submitDisabled={!section.trim()}
    >
      <div className="space-y-3.5">
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Groupe / Section" required>
            <Input
              value={section}
              onChange={(e) => setSection(e.target.value)}
              placeholder="Ex. Section A, Groupe 1"
            />
          </FormField>

          <FormField label="Capacité maximale">
            <Input
              type="number"
              min={1}
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              placeholder="Ex. 28"
            />
          </FormField>
        </div>

        <FormField label="Nom affiché de la classe" hint={`Aperçu automatique : ${previewName}`}>
          <Input
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            placeholder={previewName}
          />
        </FormField>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="Salle de classe">
            <Input
              value={room}
              onChange={(e) => setRoom(e.target.value)}
              placeholder="Ex. Salle B12"
            />
          </FormField>

          <FormField label="Enseignant principal">
            <Select value={teacherId || "__none__"} onValueChange={(v) => setTeacherId(v === "__none__" ? "" : v)}>
              <SelectTrigger>
                <SelectValue placeholder="Non désigné" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— Non désigné —</SelectItem>
                {teachers.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.firstName} {p.lastName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        </div>

        <FormField label="Consignes & Aménagements pédagogiques">
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Ex. Section renforcée, aménagement horaire..."
            rows={2}
          />
        </FormField>
      </div>
    </UnifiedModal>
  );
}