/**
 * AlertCreatorModal — manual custom alert / reminder / timer creation.
 *
 * Iteration 9 — Alert & Notification System Overhaul.
 *
 * This modal is the canonical UI for creating custom alerts. It is reused
 * in TWO locations per the spec:
 *
 *   1. The main Dashboard → Alerts tab ("Alertes & Notifications")
 *   2. The Personnel workspace ("PersonnelPage")
 *
 * Both locations instantiate this exact same component so the alert
 * creation experience is identical everywhere. This is a hard requirement:
 * "There should never be multiple modal styles across the application."
 *
 * The form supports:
 *   - Title & Description
 *   - Trigger Date/Time & Timers (for scheduled reminders)
 *   - Priority Level (Low, Medium, High, Urgent)
 *   - Targeting: dispatch to ANY specific user or role across the platform
 *     without restrictions (broadcast / user / role).
 *   - Source label (auto-derived from the calling context, overridable).
 *
 * Validation:
 *   - Title is required (min 3 chars).
 *   - Body is required (min 5 chars).
 *   - If priority is "urgent", a trigger date is recommended (warning).
 *   - If target is "user", a userId must be selected.
 *   - If target is "role", a role must be selected.
 */
import { useState, useEffect, useMemo } from "react";
import { BellPlus, AlertTriangle } from "lucide-react";
import { useRepositories } from "../../infrastructure/repository-provider";
import { useAuth } from "../../state/auth-context";
import { useToast } from "../../state/toast-context";
import { UnifiedModal } from "./unified-modal";
import { FormField } from "./form-field";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Button } from "../ui/button";
import { Role, ROLE_LABELS_FR, STAFF_ROLES } from "../../core/rbac/roles";
import {
  AlertPriority,
  ALERT_PRIORITY_LABELS_FR,
  NotificationType,
  NOTIFICATION_TYPE_LABELS_FR,
} from "../../domain/model/operations";

type TargetKind = "broadcast" | "role" | "user";

export interface AlertCreatorModalProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Optional source label (defaults to "Alerte manuelle"). */
  sourceLabel?: string;
  /** Called after a successful creation. */
  onCreated?: () => void;
}

export function AlertCreatorModal({
  open,
  onOpenChange,
  sourceLabel = "Alerte manuelle",
  onCreated,
}: AlertCreatorModalProps) {
  const repos = useRepositories();
  const { session } = useAuth();
  const toast = useToast();

  const personnel = useRepositories().personnel.observe().get();

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [type, setType] = useState<NotificationType>("custom");
  const [priority, setPriority] = useState<AlertPriority>("medium");
  const [targetKind, setTargetKind] = useState<TargetKind>("broadcast");
  const [targetRole, setTargetRole] = useState<Role>(Role.Teacher);
  const [targetUserId, setTargetUserId] = useState<string>("");
  const [triggerDate, setTriggerDate] = useState("");
  const [triggerTime, setTriggerTime] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when modal opens.
  useEffect(() => {
    if (open) {
      setTitle("");
      setBody("");
      setType("custom");
      setPriority("medium");
      setTargetKind("broadcast");
      setTargetRole(Role.Teacher);
      setTargetUserId("");
      setTriggerDate("");
      setTriggerTime("");
      setError(null);
    }
  }, [open]);

  const validation = useMemo(() => {
    if (title.trim().length < 3) return "Le titre doit contenir au moins 3 caractères.";
    if (body.trim().length < 5) return "La description doit contenir au moins 5 caractères.";
    if (targetKind === "user" && !targetUserId) return "Veuillez sélectionner un utilisateur cible.";
    if (targetKind === "role" && !targetRole) return "Veuillez sélectionner un rôle cible.";
    return null;
  }, [title, body, targetKind, targetUserId, targetRole]);

  const showTriggerWarning = priority === "urgent" && !triggerDate;

  async function handleSubmit() {
    if (validation) {
      setError(validation);
      return;
    }
    if (!session) {
      setError("Session expirée. Veuillez vous reconnecter.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const triggeredAt =
        triggerDate && triggerTime
          ? new Date(`${triggerDate}T${triggerTime}:00`).toISOString()
          : triggerDate
            ? new Date(`${triggerDate}T09:00:00`).toISOString()
            : null;

      const result = await repos.notifications.create({
        title: title.trim(),
        body: body.trim(),
        type,
        priority,
        sourceLabel,
        targetUserId: targetKind === "user" ? targetUserId : null,
        targetRole: targetKind === "role" ? targetRole : null,
        triggeredAt,
        createdBy: session.userId,
      });
      if (!result.ok) {
        setError(result.error.userMessage);
        return;
      }
      toast.showSuccess("Alerte créée", `« ${title.trim()} » a été diffusée.`);
      onCreated?.();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <UnifiedModal
      open={open}
      onOpenChange={onOpenChange}
      title="Nouvelle alerte"
      description="Créer et diffuser une alerte personnalisée vers n'importe quel utilisateur ou rôle."
      icon={BellPlus}
      iconTone="primary"
      size="lg"
      submitLabel="Diffuser l'alerte"
      submitIcon={BellPlus}
      submitLoading={submitting}
      alert={
        error
          ? { tone: "error", title: "Erreur de validation", description: error }
          : showTriggerWarning
            ? { tone: "warning", title: "Priorité urgente sans déclencheur", description: "Pour une alerte urgente, il est recommandé de définir une date de déclenchement." }
            : null
      }
      onSubmit={handleSubmit}
    >
      <div className="space-y-4">
        <FormField label="Titre" htmlFor="alert-title" required>
          <Input
            id="alert-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ex. Réunion exceptionnelle conseil pédagogique"
            maxLength={120}
          />
        </FormField>

        <FormField label="Description" htmlFor="alert-body" required>
          <Textarea
            id="alert-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Détails de l'alerte, contexte, action attendue…"
            rows={4}
            maxLength={500}
          />
          <p className="text-[10px] text-muted-foreground">{body.length}/500 caractères</p>
        </FormField>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="Type" htmlFor="alert-type">
            <Select value={type} onValueChange={(v) => setType(v as NotificationType)}>
              <SelectTrigger id="alert-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(NOTIFICATION_TYPE_LABELS_FR).map(([k, label]) => (
                  <SelectItem key={k} value={k}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          <FormField label="Priorité" htmlFor="alert-priority">
            <Select value={priority} onValueChange={(v) => setPriority(v as AlertPriority)}>
              <SelectTrigger id="alert-priority">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(ALERT_PRIORITY_LABELS_FR).map(([k, label]) => (
                  <SelectItem key={k} value={k}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="Date de déclenchement" htmlFor="alert-trigger-date">
            <Input
              id="alert-trigger-date"
              type="date"
              value={triggerDate}
              onChange={(e) => setTriggerDate(e.target.value)}
            />
          </FormField>
          <FormField label="Heure" htmlFor="alert-trigger-time">
            <Input
              id="alert-trigger-time"
              type="time"
              value={triggerTime}
              onChange={(e) => setTriggerTime(e.target.value)}
              disabled={!triggerDate}
            />
          </FormField>
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Cible</Label>
          <div className="grid grid-cols-3 gap-2">
            <Button
              type="button"
              variant={targetKind === "broadcast" ? "default" : "outline"}
              size="sm"
              onClick={() => setTargetKind("broadcast")}
            >
              Tous
            </Button>
            <Button
              type="button"
              variant={targetKind === "role" ? "default" : "outline"}
              size="sm"
              onClick={() => setTargetKind("role")}
            >
              Par rôle
            </Button>
            <Button
              type="button"
              variant={targetKind === "user" ? "default" : "outline"}
              size="sm"
              onClick={() => setTargetKind("user")}
            >
              Par utilisateur
            </Button>
          </div>

          {targetKind === "role" && (
            <FormField label="Rôle cible" htmlFor="alert-target-role">
              <Select value={targetRole} onValueChange={(v) => setTargetRole(v as Role)}>
                <SelectTrigger id="alert-target-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from(STAFF_ROLES).map((r) => (
                    <SelectItem key={r} value={r}>{ROLE_LABELS_FR[r]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          )}

          {targetKind === "user" && (
            <FormField label="Utilisateur cible" htmlFor="alert-target-user">
              <Select value={targetUserId} onValueChange={setTargetUserId}>
                <SelectTrigger id="alert-target-user">
                  <SelectValue placeholder="Sélectionner…" />
                </SelectTrigger>
                <SelectContent>
                  {personnel
                    .filter((p) => p.userId)
                    .map((p) => (
                      <SelectItem key={p.userId} value={p.userId!}>
                        {p.firstName} {p.lastName} — {ROLE_LABELS_FR[p.roleId]}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </FormField>
          )}
        </div>

        {showTriggerWarning && (
          <div className="flex items-start gap-2 rounded-md border border-status-warning/30 bg-status-warning/10 p-2 text-xs text-status-warning">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <p>
              Pour une alerte urgente, il est recommandé de définir une date de déclenchement
              afin que le destinataire puisse être notifié à temps.
            </p>
          </div>
        )}
      </div>
    </UnifiedModal>
  );
}
