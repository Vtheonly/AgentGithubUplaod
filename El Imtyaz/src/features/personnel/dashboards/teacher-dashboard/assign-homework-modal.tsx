/**
 * "Donner un devoir" modal — pushed to repos.homework.
 *
 * Extracted from `teacher-dashboard.tsx` in task 6-b. Behavior preserved
 * verbatim — only file location + import paths changed.
 */
import { useEffect, useState } from "react";
import { Plus, Send } from "lucide-react";
import { useRepositories } from "../../../../app/providers/repository-provider";
import { useToast } from "../../../../app/providers/toast-provider";
import type { AcademicClass, Subject } from "../../../../domain/model/academic";
import { Button } from "../../../../shared/ui/button";
import { Input } from "../../../../shared/ui/input";
import { Label } from "../../../../shared/ui/label";
import { Textarea } from "../../../../shared/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../../../../shared/ui/select";
import { UnifiedModal } from "../../../../shared/ui/unified-modal";

export function AssignHomeworkModal({
  open, onOpenChange, classes, subjects, teacherId, teacherName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  classes: readonly AcademicClass[];
  subjects: readonly Subject[];
  teacherId: string;
  teacherName: string;
}) {
  const repos = useRepositories();
  const toast = useToast();
  const [classId, setClassId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");

  useEffect(() => { if (open && classes[0] && !classId) setClassId(classes[0].id); }, [open, classes, classId]);

  async function handleSubmit() {
    if (!title.trim() || !classId || !subjectId || !dueDate) {
      toast.showWarning("Champs requis", "Classe, matière, titre et date sont obligatoires.");
      return;
    }
    const result = await repos.homework.push({
      classId, subjectId, teacherId, teacherName,
      title: title.trim(), description: description.trim(),
      dueDate, attachments: [],
    });
    if (result.ok) {
      toast.showSuccess("Devoir publié", "Les élèves et parents ont été notifiés.");
      setTitle(""); setDescription(""); setDueDate("");
      onOpenChange(false);
    } else {
      toast.showError("Erreur", "Impossible de publier le devoir.");
    }
  }

  return (
    <UnifiedModal
      open={open} onOpenChange={onOpenChange}
      title="Donner un devoir" description="Sera publié aux élèves et parents."
      icon={Plus} size="md"
      submitLabel="Publier" submitIcon={Send} onSubmit={handleSubmit}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Classe</Label>
            <Select value={classId} onValueChange={setClassId}>
              <SelectTrigger><SelectValue placeholder="Choisir…" /></SelectTrigger>
              <SelectContent>
                {classes.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Matière</Label>
            <Select value={subjectId} onValueChange={setSubjectId}>
              <SelectTrigger><SelectValue placeholder="Choisir…" /></SelectTrigger>
              <SelectContent>
                {subjects.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="hw-title">Titre</Label>
          <Input id="hw-title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="hw-desc">Description</Label>
          <Textarea id="hw-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="hw-due">À rendre le</Label>
          <Input id="hw-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </div>
      </div>
    </UnifiedModal>
  );
}
