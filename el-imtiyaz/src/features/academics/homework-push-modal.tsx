/**
 * HomeworkPushModal — teacher creates an assignment and pushes it to students.
 *
 * Plan §06: form with subject dropdown, title, description, due date,
 * attachments. On submit, fires push notification to parents via Web Portal.
 *
 * Iteration 2: simplified — attachments are mock (just file name capture).
 */
import { useState } from "react";
import { Loader2, Send, Upload, X, BookOpen } from "lucide-react";
import { useRepositories } from "../../infrastructure/repository-provider";
import { useToast } from "../../state/toast-context";
import { useAuth } from "../../state/auth-context";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../../shared/ui/dialog";
import { Button } from "../../shared/ui/button";
import { Input } from "../../shared/ui/input";
import { Textarea } from "../../shared/ui/textarea";
import { Label } from "../../shared/ui/label";
import { FormField } from "../../shared/components/form-field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../shared/ui/select";
import { toIsoDay } from "../../core/format/date";

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
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (!session) return;
    if (!classId || !subjectId || !title.trim()) {
      toast.showWarning("Champs invalides", "Classe, matière et titre sont requis.");
      return;
    }
    setSubmitting(true);
    try {
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
        // reset
        setTitle("");
        setDescription("");
        setAttachments([]);
      } else {
        toast.showError("Échec", r.error.userMessage);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-primary" /> Diffuser un devoir
          </DialogTitle>
          <DialogDescription>
            Le devoir sera poussé vers le portail web parent/élève avec notification.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
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

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Diffusion…
              </>
            ) : (
              <>
                <Send className="h-4 w-4" /> Diffuser
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Local import to avoid circular dependency in module-level calls.
import { useObservable } from "../../shared/hooks/use-observable";
