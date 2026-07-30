/**
 * CalendarEventCreatorModal — schedule a new follow-up call / reminder /
 * meeting / custom event from the Dashboard calendar.
 *
 * Iteration 9 — Integrated Calendar View (plan §15 expansion).
 *
 * Per spec §3.3: "Allow users to interactively add, remove, and manage
 * scheduled entries, follow-up calls, reminders, and custom events
 * directly within the calendar interface."
 *
 * This modal is the canonical UI for adding calendar events. It supports
 * 4 event kinds (follow_up_call, reminder, meeting, custom). All
 * schedule-related mutations go through this single component so the
 * experience is consistent regardless of where the user clicks "Add".
 */
import { useState, useEffect } from "react";
import { CalendarPlus, Phone, Bell, Users, Calendar } from "lucide-react";
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
import {
  AlertPriority,
  ALERT_PRIORITY_LABELS_FR,
} from "../../domain/model/operations";
import type { CalendarEventKind, CreateCalendarEventInput } from "../../domain/model/calendar";
import { Role, ROLE_LABELS_FR, STAFF_ROLES } from "../../core/rbac/roles";

const KIND_LABELS_FR: Record<Exclude<CalendarEventKind, "payment_received" | "audit_log" | "expense_event">, string> = {
  follow_up_call: "Appel de suivi",
  reminder: "Rappel",
  meeting: "Réunion",
  custom: "Événement personnalisé",
};

type CreatableKind = keyof typeof KIND_LABELS_FR;

const KIND_ICONS: Record<CreatableKind, typeof Phone> = {
  follow_up_call: Phone,
  reminder: Bell,
  meeting: Users,
  custom: Calendar,
};

export interface CalendarEventCreatorModalProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Pre-fill the date (YYYY-MM-DD) when opening from a calendar day click. */
  presetDate?: string;
  onCreated?: () => void;
}

export function CalendarEventCreatorModal({
  open,
  onOpenChange,
  presetDate,
  onCreated,
}: CalendarEventCreatorModalProps) {
  const repos = useRepositories();
  const { session } = useAuth();
  const toast = useToast();

  const [kind, setKind] = useState<CreatableKind>("reminder");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [priority, setPriority] = useState<AlertPriority>("medium");
  const [assignedToRole, setAssignedToRole] = useState<Role | "broadcast">("broadcast");
  const [targetType, setTargetType] = useState<"parent" | "personnel" | "student" | "vendor" | "other">("parent");
  const [targetName, setTargetName] = useState("");
  const [targetPhone, setTargetPhone] = useState("");
  const [location, setLocation] = useState("");
  const [attendeeCount, setAttendeeCount] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setKind("reminder");
      setTitle("");
      setDescription("");
      setDate(presetDate ?? new Date().toISOString().slice(0, 10));
      setTime("");
      setPriority("medium");
      setAssignedToRole("broadcast");
      setTargetType("parent");
      setTargetName("");
      setTargetPhone("");
      setLocation("");
      setAttendeeCount(0);
      setError(null);
    }
  }, [open, presetDate]);

  function validate(): string | null {
    if (title.trim().length < 3) return "Le titre doit contenir au moins 3 caractères.";
    if (!date) return "La date est obligatoire.";
    if (kind === "follow_up_call" && !targetName.trim()) return "Le nom de la cible est obligatoire pour un appel de suivi.";
    if (kind === "meeting" && !location.trim()) return "Le lieu est obligatoire pour une réunion.";
    return null;
  }

  async function handleSubmit() {
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    if (!session) {
      setError("Session expirée.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const input: CreateCalendarEventInput = {
        kind,
        date,
        time: time || null,
        title: title.trim(),
        description: description.trim() || null,
        priority,
        assignedToRole: assignedToRole === "broadcast" ? null : assignedToRole,
        createdBy: session.userId,
        ...(kind === "follow_up_call"
          ? {
              targetType,
              targetName: targetName.trim(),
              phone: targetPhone.trim() || null,
            }
          : {}),
        ...(kind === "meeting"
          ? {
              location: location.trim(),
              attendeeCount,
            }
          : {}),
      };
      const result = await repos.calendar.create(input);
      if (!result.ok) {
        setError(result.error.userMessage);
        return;
      }
      toast.showSuccess("Événement créé", `« ${title.trim()} » ajouté au calendrier.`);
      onCreated?.();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  const KindIcon = KIND_ICONS[kind];

  return (
    <UnifiedModal
      open={open}
      onOpenChange={onOpenChange}
      title="Nouvel événement"
      description="Planifier un appel, un rappel, une réunion ou un événement personnalisé."
      icon={CalendarPlus}
      iconTone="primary"
      size="lg"
      submitLabel="Planifier"
      submitIcon={CalendarPlus}
      submitLoading={submitting}
      alert={error ? { tone: "error", title: "Erreur", description: error } : null}
      onSubmit={handleSubmit}
    >
      <div className="space-y-4">
        {/* Kind selector */}
        <div className="space-y-2">
          <Label className="text-xs">Type d'événement</Label>
          <div className="grid grid-cols-4 gap-2">
            {(Object.keys(KIND_LABELS_FR) as CreatableKind[]).map((k) => {
              const Icon = KIND_ICONS[k];
              return (
                <Button
                  key={k}
                  type="button"
                  variant={kind === k ? "default" : "outline"}
                  size="sm"
                  className="flex flex-col items-center gap-1 h-auto py-2"
                  onClick={() => setKind(k)}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span className="text-[10px]">{KIND_LABELS_FR[k]}</span>
                </Button>
              );
            })}
          </div>
        </div>

        <FormField label="Titre" htmlFor="cal-title" required>
          <Input
            id="cal-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={
              kind === "follow_up_call"
                ? "Ex. Appel de suivi — Famille Benali"
                : kind === "meeting"
                  ? "Ex. Réunion parents-professeurs"
                  : kind === "reminder"
                    ? "Ex. Échéance tranche 3"
                    : "Ex. Événement"
            }
            maxLength={120}
          />
        </FormField>

        <FormField label="Description" htmlFor="cal-desc">
          <Textarea
            id="cal-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Contexte, objectif, liens…"
            rows={3}
            maxLength={500}
          />
        </FormField>

        <div className="grid grid-cols-3 gap-3">
          <FormField label="Date" htmlFor="cal-date" required>
            <Input
              id="cal-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </FormField>
          <FormField label="Heure" htmlFor="cal-time">
            <Input
              id="cal-time"
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </FormField>
          <FormField label="Priorité" htmlFor="cal-priority">
            <Select value={priority} onValueChange={(v) => setPriority(v as AlertPriority)}>
              <SelectTrigger id="cal-priority">
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

        {/* Kind-specific fields */}
        {kind === "follow_up_call" && (
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Cible" htmlFor="cal-target-type">
              <Select value={targetType} onValueChange={(v) => setTargetType(v as typeof targetType)}>
                <SelectTrigger id="cal-target-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="parent">Parent</SelectItem>
                  <SelectItem value="personnel">Personnel</SelectItem>
                  <SelectItem value="student">Élève</SelectItem>
                  <SelectItem value="vendor">Fournisseur</SelectItem>
                  <SelectItem value="other">Autre</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Nom" htmlFor="cal-target-name" required>
              <Input
                id="cal-target-name"
                value={targetName}
                onChange={(e) => setTargetName(e.target.value)}
                placeholder="Ex. Karim Benali"
              />
            </FormField>
            <FormField label="Téléphone" htmlFor="cal-target-phone">
              <Input
                id="cal-target-phone"
                value={targetPhone}
                onChange={(e) => setTargetPhone(e.target.value)}
                placeholder="+213 …"
              />
            </FormField>
          </div>
        )}

        {kind === "meeting" && (
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Lieu" htmlFor="cal-location" required>
              <Input
                id="cal-location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Ex. Salle de conférence"
              />
            </FormField>
            <FormField label="Nombre de participants" htmlFor="cal-attendees">
              <Input
                id="cal-attendees"
                type="number"
                min={0}
                value={attendeeCount}
                onChange={(e) => setAttendeeCount(parseInt(e.target.value, 10) || 0)}
              />
            </FormField>
          </div>
        )}

        {/* Assignment */}
        <FormField label="Assigner à" htmlFor="cal-assign">
          <Select
            value={assignedToRole}
            onValueChange={(v) => setAssignedToRole(v as Role | "broadcast")}
          >
            <SelectTrigger id="cal-assign">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="broadcast">Tous (diffusion)</SelectItem>
              {Array.from(STAFF_ROLES).map((r) => (
                <SelectItem key={r} value={r}>{ROLE_LABELS_FR[r]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      </div>
    </UnifiedModal>
  );
}
