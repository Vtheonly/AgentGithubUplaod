import { useState } from "react";
import { Send, Upload, X, BookOpen } from "lucide-react";
import { useRepositories } from "../../app/providers/repository-provider";
import { useToast } from "../../app/providers/toast-provider";
import { useAuth } from "../../app/providers/auth-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import {
  UnifiedModal,
  type UnifiedModalProps,
} from "../../shared/ui/unified-modal";
import { Button } from "../../shared/ui/button";
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

type Alert = NonNullable<UnifiedModalProps["alert"]>;

export function HomeworkPushModal({
  open,
  onOpenChange,
  presetClassId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  presetClassId?: string | null;
}) {
  const repos = useRepositories();
  const toast = useToast();
  const { session } = useAuth();

  const classes = useObservable(() => repos.classes.observe(), []);
  const subjects = useObservable(() => repos.subjects.observe(), []);

  const [classId, setClassId] = useState(presetClassId ?? "");
  const [subjectId, setSubjectId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState(new Date().toISOString().slice(0, 10));
  const [attachments, setAttachments] = useState<string[]>([]);
  const [alert, setAlert] = useState<Alert | null>(null);

  function reset() {
    setSubjectId("");
    setTitle("");
    setDescription("");
    setDueDate(new Date().toISOString().slice(0, 10));
    setAttachments([]);
    setAlert(null);
  }

  async function submit() {
    if (!session) return;
    if (!classId || !subjectId || !title.trim()) {
      setAlert({
        tone: "warning",
        title: "Champs requis",
        description: "Veuillez spécifier la classe, la matière et le titre.",
      });
      return;
    }

    const selectedSubject = subjects.find((s) => s.id === subjectId);

    const result = await repos.homework.push({
      classId,
      subjectId,
      teacherId: session.userId,
      teacherName: session.displayName,
      title: title.trim(),
      description: description.trim(),
      dueDate,
      attachments,
    });

    if (result.ok) {
      toast.showSuccess(
        "Devoir diffusé",
        `Le devoir de ${selectedSubject?.name ?? "matière"} a été envoyé au portail web.`,
      );
      onOpenChange(false);
      reset();
    } else {
      setAlert({
        tone: "error",
        title: "Échec de la diffusion",
        description: result.error.userMessage,
      });
    }
  }

  return (
    <UnifiedModal
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      variant="dialog"
      icon={BookOpen}
      iconTone="primary"
      title="Diffuser un devoir"
      description="Le devoir sera publié sur le portail web des élèves et notifié aux parents."
      submitLabel="Diffuser au portail"
      submitIcon={Send}
      onSubmit={submit}
      alert={alert}
      onDismissAlert={() => setAlert(null)}
    >
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
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

          <FormField label="Matière" required>
            <Select value={subjectId} onValueChange={setSubjectId}>
              <SelectTrigger>
                <SelectValue placeholder="Sélectionner la matière…" />
              </SelectTrigger>
              <SelectContent>
                {subjects.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name} ({s.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        </div>

        <FormField label="Titre du devoir" required>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Exercices 1 à 5 page 42 — Fractions"
          />
        </FormField>

        <FormField label="Instructions & Consignes">
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Résoudre les exercices sur le cahier de devoirs. Rendu obligatoire."
            rows={4}
          />
        </FormField>

        <FormField label="Date limite de rendu" required>
          <Input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </FormField>

        <FormField label="Pièces jointes (PDF / Photos tableau)">
          <label className="flex items-center gap-2 rounded-md border border-dashed border-border p-3 cursor-pointer hover:bg-accent/5">
            <Upload className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              Ajouter des documents ou photos
            </span>
            <input
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                setAttachments((prev) => [
                  ...prev,
                  ...files.map((f) => f.name),
                ]);
              }}
            />
          </label>
          {attachments.length > 0 && (
            <ul className="mt-2 space-y-1">
              {attachments.map((fileName, idx) => (
                <li
                  key={idx}
                  className="flex items-center justify-between text-xs border border-border p-1.5 rounded"
                >
                  <span className="truncate">{fileName}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5"
                    onClick={() =>
                      setAttachments((prev) => prev.filter((_, i) => i !== idx))
                    }
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </FormField>
      </div>
    </UnifiedModal>
  );
}
