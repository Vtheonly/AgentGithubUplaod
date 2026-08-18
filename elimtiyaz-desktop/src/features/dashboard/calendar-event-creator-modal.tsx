/**
 * CalendarEventCreatorModal — schedule a new follow-up call / reminder /
 * meeting / custom event from the Dashboard calendar.
 *
 * Refactored to consume `<AutoFormModal<T>>` so form-state, Zod validation,
 * and field rendering all flow through the shared primitive instead of
 * hand-rolled `useState` + bespoke `<UnifiedModal>` form. Captures the
 * essential fields required by `repos.calendar.create`; the kind-specific
 * extras (location, attendeeCount, phone) are surfaced as optional text /
 * number inputs in the same form.
 */
import { z } from "zod";
import { useRepositories } from "../../app/providers/repository-provider";
import { useAuth } from "../../app/providers/auth-provider";
import { useToast } from "../../app/providers/toast-provider";
import { AutoFormModal, type AutoFormField } from "../../shared/ui/auto-form";
import { ALERT_PRIORITY_LABELS_FR, type AlertPriority } from "../../domain/model/operations";

const CalendarEventSchema = z.object({
  title: z.string().min(3, "Titre requis (min. 3 caractères)"),
  kind: z.enum(["follow_up_call", "reminder", "meeting", "custom"]),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  date: z.string().min(4, "Date requise"),
  time: z.string().optional().default(""),
  description: z.string().optional().default(""),
  location: z.string().optional().default(""),
  attendeeCount: z.number().optional().default(0),
  targetName: z.string().optional().default(""),
  targetPhone: z.string().optional().default(""),
});

type CalendarEventFormData = z.infer<typeof CalendarEventSchema>;

const fields: readonly AutoFormField[] = [
  { name: "title", label: "Intitulé", type: "text", required: true, wide: true, placeholder: "Ex. Rendez-vous parent" },
  {
    name: "kind", label: "Type d'événement", type: "select", required: true,
    options: [
      { label: "Rappel", value: "reminder" },
      { label: "Appel de suivi", value: "follow_up_call" },
      { label: "Réunion", value: "meeting" },
      { label: "Événement", value: "custom" },
    ],
  },
  {
    name: "priority", label: "Priorité", type: "select", required: true,
    options: Object.entries(ALERT_PRIORITY_LABELS_FR).map(([k, label]) => ({ label, value: k })),
  },
  { name: "date", label: "Date", type: "date", required: true },
  { name: "time", label: "Heure (HH:MM)", type: "text", placeholder: "10:30" },
  { name: "location", label: "Lieu (réunion)", type: "text", placeholder: "Ex. Salle des professeurs" },
  { name: "attendeeCount", label: "Nombre de participants", type: "number", min: 0 },
  { name: "targetName", label: "Nom cible (appel)", type: "text", placeholder: "Ex. Mme Benali" },
  { name: "targetPhone", label: "Téléphone cible (appel)", type: "tel" },
  { name: "description", label: "Notes / Description", type: "textarea", wide: true },
];

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

  async function handleSubmit(data: CalendarEventFormData) {
    if (!session) return;
    const res = await repos.calendar.create({
      title: data.title,
      kind: data.kind,
      date: data.date,
      time: data.time || null,
      priority: data.priority as AlertPriority,
      description: data.description || null,
      location: data.location || null,
      attendeeCount: data.attendeeCount ?? 0,
      targetName: data.targetName || undefined,
      phone: data.targetPhone || null,
      targetType: data.kind === "follow_up_call" ? "parent" : undefined,
      createdBy: session.userId,
    });
    if (res.ok) {
      toast.showSuccess("Événement planifié", data.title);
      onCreated?.();
    } else {
      throw new Error(res.error.userMessage);
    }
  }

  return (
    <AutoFormModal
      open={open}
      onOpenChange={onOpenChange}
      title="Planifier un événement"
      description="Ajouter une entrée au calendrier opérationnel."
      schema={CalendarEventSchema}
      fields={fields}
      initialValues={{
        date: presetDate ?? new Date().toISOString().slice(0, 10),
        kind: "reminder",
        priority: "medium",
        attendeeCount: 0,
      }}
      onSubmit={handleSubmit}
      submitLabel="Planifier"
    />
  );
}
