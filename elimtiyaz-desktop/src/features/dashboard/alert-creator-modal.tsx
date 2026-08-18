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
 * Refactored to consume `<AutoFormModal<T>>` so form-state, Zod validation,
 * and field rendering all flow through the shared primitive instead of
 * hand-rolled `useState` + bespoke `<UnifiedModal>` form. The original
 * target-kind selector (broadcast / role / user) is collapsed into two
 * fields: `targetRole` (empty = broadcast) and `targetUserId`. The handler
 * decides whether to attach `targetRole` only, both, or neither.
 */
import { useMemo } from "react";
import { z } from "zod";
import { useRepositories } from "../../app/providers/repository-provider";
import { useAuth } from "../../app/providers/auth-provider";
import { useToast } from "../../app/providers/toast-provider";
import { AutoFormModal, type AutoFormField } from "../../shared/ui/auto-form";
import { Role, ROLE_LABELS_FR, STAFF_ROLES } from "../../core/rbac/roles";
import {
  type AlertPriority,
  type NotificationType,
  ALERT_PRIORITY_LABELS_FR,
  NOTIFICATION_TYPE_LABELS_FR,
} from "../../domain/model/operations";
import { useObservable } from "../../shared/hooks/use-observable";

const AlertSchema = z.object({
  title: z.string().min(3, "Titre requis (min. 3 caractères)"),
  body: z.string().min(5, "Description requise (min. 5 caractères)"),
  type: z.enum([
    "payment_overdue", "expense_pending", "attendance_alert",
    "homework", "audit", "system", "message", "custom",
  ]).default("custom"),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  targetRole: z.string().optional().default(""),
  targetUserId: z.string().optional().default(""),
});

type AlertFormData = z.infer<typeof AlertSchema>;

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
  const personnel = useObservable(() => repos.personnel.observe(), []);

  const userOptions = useMemo(
    () => [
      { label: "— Diffusion (tous les rôles) —", value: "" },
      ...personnel.map((p) => ({ label: `${p.firstName} ${p.lastName}`, value: p.id })),
    ],
    [personnel],
  );

  const fields: readonly AutoFormField[] = [
    { name: "title", label: "Titre de l'alerte", type: "text", required: true, wide: true, placeholder: "Ex. Réunion exceptionnelle" },
    {
      name: "type", label: "Type", type: "select", required: true,
      options: Object.entries(NOTIFICATION_TYPE_LABELS_FR).map(([k, label]) => ({ label, value: k })),
    },
    {
      name: "priority", label: "Priorité", type: "select", required: true,
      options: Object.entries(ALERT_PRIORITY_LABELS_FR).map(([k, label]) => ({ label, value: k })),
    },
    {
      name: "targetRole", label: "Rôle cible", type: "select",
      options: [
        { label: "— Tous les utilisateurs (Diffusion) —", value: "" },
        ...Array.from(STAFF_ROLES).map((r) => ({ label: ROLE_LABELS_FR[r], value: r })),
      ],
      wide: true,
    },
    {
      name: "targetUserId", label: "Utilisateur spécifique (optionnel)", type: "select",
      options: userOptions, wide: true,
    },
    { name: "body", label: "Contenu du message", type: "textarea", required: true, wide: true, placeholder: "Précisez l'objet de l'alerte…" },
  ];

  async function handleSubmit(data: AlertFormData) {
    if (!session) return;
    const res = await repos.notifications.create({
      title: data.title,
      body: data.body,
      type: data.type as NotificationType,
      priority: data.priority as AlertPriority,
      sourceLabel,
      targetRole: (data.targetRole as Role) || null,
      targetUserId: data.targetUserId || null,
      createdBy: session.userId,
    });
    if (res.ok) {
      toast.showSuccess("Alerte créée", `« ${data.title} » a été diffusée.`);
      onCreated?.();
    } else {
      throw new Error(res.error.userMessage);
    }
  }

  return (
    <AutoFormModal
      open={open}
      onOpenChange={onOpenChange}
      title="Créer une alerte"
      description="Diffuser une notification ciblée à un rôle ou à tous les collaborateurs."
      schema={AlertSchema}
      fields={fields}
      initialValues={{ type: "custom", priority: "medium", targetRole: "", targetUserId: "" }}
      onSubmit={handleSubmit}
      submitLabel="Diffuser l'alerte"
    />
  );
}
