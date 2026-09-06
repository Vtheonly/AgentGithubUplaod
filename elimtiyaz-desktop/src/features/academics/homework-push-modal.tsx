import { useState } from "react";
import { Send, Upload, X, BookOpen, Loader2 } from "lucide-react";
import { useRepositories } from "../../app/providers/repository-provider";
import { useToast } from "../../app/providers/toast-provider";
import { useAuth } from "../../app/providers/auth-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import { uploadPrivateMedia } from "../../infrastructure/storage/media-vault";
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
  // VAULT §02.06 — "Homework Push Engine … With photo/PDF attachments".
  // Pending files are held until submit, then uploaded to the PRIVATE
  // `homework-attachments` bucket (migration 0018) via the signed-URL media
  // vault — the same flow as payment proofs. The persisted `attachments`
  // array carries the vault paths (never public URLs).
  const [pendingFiles, setPendingFiles] = useState<{ file: File; name: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [alert, setAlert] = useState<Alert | null>(null);

  function reset() {
    setSubjectId("");
    setTitle("");
    setDescription("");
    setDueDate(new Date().toISOString().slice(0, 10));
    setPendingFiles([]);
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

    // T-053 (TENANT-103): a global admin without a picked tenant cannot
    // upload (the vault path is tenant-scoped) — fail with the same clear
    // French message requireTenantId uses, before any network call.
    const workingTenantId = session.tenantId;
    if (!workingTenantId) {
      toast.showError(
        "Aucun établissement actif — sélectionnez un établissement dans la barre supérieure (compte admin global) ou reconnectez-vous.",
      );
      return;
    }

    // VAULT §02.06 — upload the real files to the private media vault so
    // students/parents can download them via signed URLs from the portal.
    // A failed upload aborts the push (a homework referencing a missing
    // file would be worse than a clear error now).
    const attachmentPaths: string[] = [];
    if (pendingFiles.length > 0) {
      setUploading(true);
      try {
        for (const { file } of pendingFiles) {
          const uploaded = await uploadPrivateMedia({
            bucket: "homework-attachments",
            entityId: classId,
            tenantId: workingTenantId,
            file,
          });
          attachmentPaths.push(uploaded.path);
        }
      } catch (err) {
        setAlert({
          tone: "error",
          title: "Échec du téléversement",
          description:
            err instanceof Error
              ? err.message
              : "Impossible de téléverser les pièces jointes. Réessayez.",
        });
        return;
      } finally {
        setUploading(false);
      }
    }

    const result = await repos.homework.push({
      classId,
      subjectId,
      teacherId: session.userId,
      teacherName: session.displayName,
      title: title.trim(),
      description: description.trim(),
      dueDate,
      attachments: attachmentPaths,
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
      submitLabel={uploading ? "Téléversement des pièces jointes…" : "Diffuser au portail"}
      submitIcon={uploading ? Loader2 : Send}
      submitLoading={uploading}
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
                setPendingFiles((prev) => [
                  ...prev,
                  ...files.map((f) => ({ file: f, name: f.name })),
                ]);
                e.target.value = "";
              }}
            />
          </label>
          {pendingFiles.length > 0 && (
            <ul className="mt-2 space-y-1">
              {pendingFiles.map(({ name }, idx) => (
                <li
                  key={idx}
                  className="flex items-center justify-between text-xs border border-border p-1.5 rounded"
                >
                  <span className="truncate">{name}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5"
                    onClick={() =>
                      setPendingFiles((prev) => prev.filter((_, i) => i !== idx))
                    }
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[11px] text-muted-foreground mt-1">
            Les fichiers sont téléversés dans le coffre privé (buckets signés) —
            jamais d'URL publique.
          </p>
        </FormField>
      </div>
    </UnifiedModal>
  );
}
