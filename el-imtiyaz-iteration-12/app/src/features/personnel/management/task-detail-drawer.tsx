/**
 * TaskDetailDrawer — slide-over showing full task detail (iteration 8).
 *
 * Sections:
 *   - Title, description, status changer (dropdown), progress bar
 *   - Metadata: priority, department, due date, created by, created at, updated at
 *   - Assignees (avatars) + reassign UI (multi-select of personnel)
 *   - Tags
 *   - Attachments list (mock)
 *   - Comments timeline + new comment input
 *
 * All mutations go through the task repository:
 *   - updateTaskStatus, reassign, addComment, deleteTask
 */
import { useEffect, useMemo, useState } from "react";
import {
  ClipboardList, Calendar, User, Send, Trash2, Tag, Paperclip, Users as UsersIcon,
} from "lucide-react";
import { useRepositories } from "../../../infrastructure/repository-provider";
import { useObservable } from "../../../shared/hooks/use-observable";
import { useAuth } from "../../../state/auth-context";
import { useToast } from "../../../state/toast-context";
import { UnifiedModal, ConfirmModal } from "../../../shared/components/unified-modal";
import { Button } from "../../../shared/ui/button";
import { Input } from "../../../shared/ui/input";
import { Avatar, AvatarFallback } from "../../../shared/ui/avatar";
import { Separator } from "../../../shared/ui/separator";
import { Progress } from "../../../shared/ui/progress";
import { StatusChip } from "../../../shared/components/status-chip";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../../../shared/ui/select";
import { formatDate, formatDateTime } from "../../../core/format/date";
import {
  TASK_PRIORITY_LABELS_FR,
  TASK_STATUS_LABELS_FR,
  type Task, type TaskStatus,
} from "../../../domain/model/workforce";

const TASK_STATUSES: readonly TaskStatus[] = [
  "pending", "assigned", "in_progress", "blocked", "completed", "cancelled",
];

const STATUS_TONES: Record<TaskStatus, "success" | "warning" | "danger" | "neutral" | "info"> = {
  pending: "neutral",
  assigned: "info",
  in_progress: "warning",
  blocked: "danger",
  completed: "success",
  cancelled: "neutral",
};

const AVATAR_COLORS = [
  "bg-primary/15 text-primary",
  "bg-brand-blue-deep/15 text-brand-blue-deep",
  "bg-status-info/15 text-status-info",
  "bg-status-success/15 text-status-success",
  "bg-status-warning/15 text-status-warning",
  "bg-brand-brown/15 text-brand-brown",
];

function colorFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export function TaskDetailDrawer({
  taskId,
  open,
  onOpenChange,
}: {
  taskId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const repos = useRepositories();
  const { session } = useAuth();
  const toast = useToast();
  const allTasks = useObservable(() => repos.tasks.observe(), []);
  const personnel = useObservable(() => repos.personnel.observe(), []);
  const departments = useObservable(() => repos.departments.observe(), []);

  const task = useMemo(
    () => allTasks.find((t) => t.id === taskId) ?? null,
    [allTasks, taskId],
  );

  const [comment, setComment] = useState("");
  const [reassignOpen, setReassignOpen] = useState(false);
  const [reassignIds, setReassignIds] = useState<string[]>([]);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Reset reassign state when the drawer opens / changes target
  useEffect(() => {
    if (open && task) {
      setReassignIds([...task.assigneeIds]);
      setReassignOpen(false);
    }
  }, [open, taskId, task?.id]);

  if (!open || !taskId || !task) return null;

  const department = departments.find((d) => d.id === task.departmentId) ?? null;
  const assignees = personnel.filter((p) => task.assigneeIds.includes(p.id));

  async function handleStatusChange(status: TaskStatus) {
    if (!session || !task) return;
    const r = await repos.tasks.updateTaskStatus(task.id, status, session.userId);
    if (r.ok) toast.showSuccess("Statut mis à jour", `« ${task.title} » → ${TASK_STATUS_LABELS_FR[status]}.`);
    else toast.showError("Erreur", r.error.userMessage);
  }

  async function handleAddComment() {
    if (!comment.trim() || !session || !task) return;
    const r = await repos.tasks.addComment(task.id, {
      authorId: session.userId,
      authorName: session.displayName,
      body: comment.trim(),
    });
    if (r.ok) {
      setComment("");
      toast.showSuccess("Commentaire ajouté", "");
    } else {
      toast.showError("Erreur", r.error.userMessage);
    }
  }

  function toggleReassign(id: string) {
    setReassignIds((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);
  }

  async function handleReassign() {
    if (!session || !task) return;
    const r = await repos.tasks.reassign(task.id, reassignIds, session.userId);
    if (r.ok) {
      toast.showSuccess("Affectation mise à jour", `${reassignIds.length} personne(s) affectée(s).`);
      setReassignOpen(false);
    } else {
      toast.showError("Erreur", r.error.userMessage);
    }
  }

  async function handleDelete() {
    if (!task) return;
    const r = await repos.tasks.deleteTask(task.id);
    setDeleteOpen(false);
    if (r.ok) {
      toast.showSuccess("Tâche supprimée", `« ${task.title} » a été supprimée.`);
      onOpenChange(false);
    } else {
      toast.showError("Erreur", r.error.userMessage);
    }
  }

  return (
    <UnifiedModal
      open={open}
      onOpenChange={onOpenChange}
      variant="drawer"
      size="lg"
      icon={ClipboardList}
      iconTone="primary"
      title={task.title}
      description={`Créée par ${task.createdByName} · ${formatDate(task.createdAt)}`}
      badge={<StatusChip label={TASK_STATUS_LABELS_FR[task.status]} tone={STATUS_TONES[task.status]} />}
      footer={
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" className="text-status-danger" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="h-4 w-4" /> Supprimer
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        {/* Status + progress */}
        <section className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-[10px] uppercase text-muted-foreground mb-1">Statut</p>
            <Select value={task.status} onValueChange={(v) => handleStatusChange(v as TaskStatus)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {TASK_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>{TASK_STATUS_LABELS_FR[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <p className="text-[10px] uppercase text-muted-foreground mb-1">Progression</p>
            <div className="space-y-1 pt-1.5">
              <Progress value={task.progress} />
              <p className="text-[11px] text-muted-foreground text-right">{task.progress}%</p>
            </div>
          </div>
        </section>

        {/* Description */}
        <section className="space-y-1">
          <p className="text-[10px] uppercase text-muted-foreground">Description</p>
          <p className="text-sm text-foreground whitespace-pre-wrap">
            {task.description || "—"}
          </p>
        </section>

        {/* Metadata */}
        <section className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm border border-border rounded-md p-3">
          <Detail label="Priorité" value={TASK_PRIORITY_LABELS_FR[task.priority]} />
          <Detail label="Département" value={department?.name ?? "—"} />
          <Detail label="Échéance" value={task.dueDate ? formatDate(task.dueDate) : "—"} />
          <Detail label="Terminée le" value={task.completedAt ? formatDateTime(task.completedAt) : "—"} />
          <Detail label="Mise à jour" value={formatDateTime(task.updatedAt)} />
          <Detail label="Créée le" value={formatDateTime(task.createdAt)} />
        </section>

        {/* Tags */}
        {task.tags.length > 0 && (
          <section className="space-y-1">
            <p className="flex items-center gap-1 text-[10px] uppercase text-muted-foreground">
              <Tag className="h-3 w-3" /> Tags
            </p>
            <div className="flex flex-wrap gap-1">
              {task.tags.map((tag) => (
                <span key={tag} className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] text-foreground">
                  {tag}
                </span>
              ))}
            </div>
          </section>
        )}

        <Separator />

        {/* Assignees + reassign UI */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-1 text-[10px] uppercase text-muted-foreground">
              <UsersIcon className="h-3 w-3" /> Affectations ({assignees.length})
            </p>
            <Button size="sm" variant="ghost" onClick={() => setReassignOpen((v) => !v)}>
              <User className="h-3.5 w-3.5" /> {reassignOpen ? "Annuler" : "Réaffecter"}
            </Button>
          </div>
          {assignees.length === 0 && !reassignOpen && (
            <p className="text-xs text-muted-foreground">Aucune affectation.</p>
          )}
          <div className="flex flex-wrap gap-2">
            {assignees.map((p) => (
              <div key={p.id} className="flex items-center gap-1.5 border border-border rounded-full pe-2 ps-1 py-0.5">
                <Avatar className="h-5 w-5">
                  <AvatarFallback className={`text-[10px] ${colorFor(p.id)}`}>
                    {p.firstName[0]}{p.lastName[0]}
                  </AvatarFallback>
                </Avatar>
                <span className="text-xs">{p.firstName} {p.lastName}</span>
              </div>
            ))}
          </div>
          {reassignOpen && (
            <div className="mt-2 border border-border rounded-md">
              <div className="max-h-40 overflow-y-auto divide-y divide-border">
                {personnel.map((p) => {
                  const checked = reassignIds.includes(p.id);
                  return (
                    <label key={p.id} className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-accent/5">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleReassign(p.id)}
                        className="h-4 w-4 accent-primary"
                      />
                      <span className="flex-1 truncate">{p.firstName} {p.lastName}</span>
                      <span className="text-[11px] text-muted-foreground truncate">{p.position || "—"}</span>
                    </label>
                  );
                })}
              </div>
              <div className="flex justify-end p-2 border-t border-border">
                <Button size="sm" onClick={handleReassign}>Enregistrer</Button>
              </div>
            </div>
          )}
        </section>

        <Separator />

        {/* Attachments (mock) */}
        <section className="space-y-1">
          <p className="flex items-center gap-1 text-[10px] uppercase text-muted-foreground">
            <Paperclip className="h-3 w-3" /> Pièces jointes ({task.attachments.length})
          </p>
          {task.attachments.length === 0 ? (
            <p className="text-xs text-muted-foreground">Aucune pièce jointe.</p>
          ) : (
            <ul className="space-y-1">
              {task.attachments.map((a) => (
                <li key={a.id} className="flex items-center justify-between text-sm border border-border rounded-md px-3 py-1.5">
                  <span className="truncate">{a.filename}</span>
                  <span className="text-[11px] text-muted-foreground">{(a.sizeBytes / 1024).toFixed(1)} Ko</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <Separator />

        {/* Comments timeline */}
        <section className="space-y-2">
          <p className="flex items-center gap-1 text-[10px] uppercase text-muted-foreground">
            <Send className="h-3 w-3" /> Commentaires ({task.comments.length})
          </p>
          {task.comments.length === 0 ? (
            <p className="text-xs text-muted-foreground">Aucun commentaire pour l'instant.</p>
          ) : (
            <ul className="space-y-2 max-h-56 overflow-y-auto">
              {task.comments.map((c) => (
                <li key={c.id} className="border-s-2 border-border ps-2">
                  <p className="text-xs text-foreground">{c.body}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {c.authorName} · {formatDateTime(c.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center gap-2 mt-1">
            <Input
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Ajouter un commentaire…"
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAddComment(); } }}
            />
            <Button size="icon" onClick={handleAddComment} disabled={!comment.trim()}>
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </section>

        {task.dueDate && (
          <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Calendar className="h-3 w-3" /> Échéance : {formatDate(task.dueDate)}
          </p>
        )}
      </div>

      <ConfirmModal
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Supprimer la tâche ?"
        description={`« ${task.title} » sera supprimée définitivement.`}
        confirmLabel="Supprimer"
        destructive
        onConfirm={handleDelete}
      />
    </UnifiedModal>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase text-muted-foreground">{label}</p>
      <p className="text-sm text-foreground break-words">{value}</p>
    </div>
  );
}
