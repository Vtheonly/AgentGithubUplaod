/**
 * HomeworkPushModal — teacher creates an assignment and pushes it to students.
 *
 * Plan §06: form with subject dropdown, title, description, due date,
 * attachments. On submit, fires push notification to parents via Web Portal.
 *
 * Iteration 3: refactored to use UnifiedModal — consistent header, footer,
 * loading state, error display, and animation with every other modal.
 * Attachments are mock (just file name capture) per iteration-2 scope.
 */
import { useState } from "react";
import { Send, Upload, X, BookOpen } from "lucide-react";
import { useRepositories } from "../../app/providers/repository-provider";
import { useToast } from "../../app/providers/toast-provider";
import { useAuth } from "../../app/providers/auth-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import { UnifiedModal, type UnifiedModalProps } from "../../shared/ui/unified-modal";
import { Button } from "../../shared/ui/button";
import { Input } from "../../shared/ui/input";
import { Textarea } from "../../shared/ui/textarea";
import { FormField } from "../../shared/ui/form-field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../shared/ui/select";
import { toIsoDay } from "../../core/format/date";

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

  const [classId, setClassId] = useState(presetClassId ?? "");
  const [subjectId, setSubjectId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState(toIsoDay());
  const [attachments, setAttachments] = useState<string[]>([]);
  const [alert, setAlert] = useState<Alert | null>(null);

  function reset() {
    setSubjectId("");
    setTitle("");
    setDescription("");
    setDueDate(toIsoDay());
    setAttachments([]);
    setAlert(null);
  }

  async function submit() {
    if (!session) return;
    if (!classId || !subjectId || !title.trim()) {
      setAlert({
        tone: "warning",
        title: "Champs invalides",
        description: "Classe, matière et titre sont requis.",
      });
      return;
    }
    const subject = repos.subjects.observe().get().find((s) => s.id === subjectId);
    const r = await repos.homework.push({
      classId,
      subjectId,
      teacherId: session.userId,
      teacherName: session.displayName,
      title: title.trim(),
      description: description.trim(),
      dueDate,
      attachments,
    });
    if (r.ok) {
      toast.showSuccess(
        "Devoir diffusé",
        `Notification push envoyée aux parents/élèves (${subject?.name ?? "matière"}).`,
      );
      onOpenChange(false);
      setTimeout(reset, 200);
    } else {
      setAlert({
        tone: "error",
        title: "Échec de la diffusion",
        description: r.error.userMessage,
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
      description="Le devoir sera poussé vers le portail web parent/élève avec notification."
      submitLabel="Diffuser"
      submitIcon={Send}
      onSubmit={submit}
      alert={alert}
      onDismissAlert={() => setAlert(null)}
    >
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <FormField label="Classe" required>
            <Select value={classId} onValueChange={setClassId}>
              <SelectTrigger><SelectValue placeholder="Sélectionner…" /></SelectTrigger>
              <SelectContent>
                {classes.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Matière" required>
            <Select value={subjectId} onValueChange={setSubjectId}>
              <SelectTrigger><SelectValue placeholder="Sélectionner…" /></SelectTrigger>
              <SelectContent>
                {repos.subjects.observe().get().map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        </div>

        <FormField label="Titre" required>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Lecture chapitre 3 + exercices"
          />
        </FormField>

        <FormField label="Description">
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Lire pages 24-32, faire exercices 1 à 5."
            rows={4}
          />
        </FormField>

        <FormField label="Date d'échéance" required>
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </FormField>

        <FormField label="Pièces jointes" hint="Images, PDF, photos tableau">
          <label className="flex items-center gap-2 rounded-md border border-dashed border-border p-3 cursor-pointer hover:bg-accent/5">
            <Upload className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Téléverser un fichier</span>
            <input
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                setAttachments((curr) => [...curr, ...files.map((f) => `mock://attachments/${f.name}`)]);
              }}
            />
          </label>
          {attachments.length > 0 && (
            <ul className="mt-2 space-y-1">
              {attachments.map((a, i) => (
                <li key={i} className="flex items-center gap-2 text-xs">
                  <span className="font-mono text-muted-foreground flex-1 truncate">{a}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5"
                    onClick={() => setAttachments((curr) => curr.filter((_, idx) => idx !== i))}
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
