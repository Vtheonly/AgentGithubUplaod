/**
 * ChangePasswordModal — plan §12.04 Password Governance UI.
 *
 * Refactored to consume `<AutoFormModal<T>>` with the new `"password"` field
 * type so credentials render masked (never in plain text). Strength rules
 * live in the Zod schema so the same validation runs on submit.
 *
 * Per plan §12.04:
 *   - Requires the current password to re-verify identity.
 *   - Min 8 chars + lowercase + uppercase + digit.
 *   - On success, the session is revoked and the user is sent to /login.
 */
import { z } from "zod";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../app/providers/auth-provider";
import { useToast } from "../../app/providers/toast-provider";
import { AutoFormModal, type AutoFormField } from "../../shared/ui/auto-form";

const ChangePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Mot de passe actuel requis"),
    newPassword: z
      .string()
      .min(8, "Au moins 8 caractères requis")
      .regex(/[a-z]/, "Au moins une lettre minuscule")
      .regex(/[A-Z]/, "Au moins une lettre majuscule")
      .regex(/[0-9]/, "Au moins un chiffre"),
    confirmPassword: z.string().min(1, "Confirmation requise"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Les mots de passe ne correspondent pas",
    path: ["confirmPassword"],
  });

type ChangePasswordFormData = z.infer<typeof ChangePasswordSchema>;

const fields: readonly AutoFormField[] = [
  { name: "currentPassword", label: "Mot de passe actuel", type: "password", required: true, wide: true, placeholder: "••••••••" },
  { name: "newPassword", label: "Nouveau mot de passe", type: "password", required: true, wide: true, placeholder: "••••••••", help: "Min. 8 caractères avec majuscule, minuscule et chiffre." },
  { name: "confirmPassword", label: "Confirmer le nouveau mot de passe", type: "password", required: true, wide: true, placeholder: "••••••••" },
];

export interface ChangePasswordModalProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

export function ChangePasswordModal({ open, onOpenChange }: ChangePasswordModalProps) {
  const { changePassword } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  async function handleSubmit(data: ChangePasswordFormData) {
    const res = await changePassword(data.currentPassword, data.newPassword);
    if (res.ok) {
      toast.showSuccess("Mot de passe modifié", "Session révoquée. Veuillez vous reconnecter.");
      navigate("/login");
    } else {
      throw new Error(res.error);
    }
  }

  return (
    <AutoFormModal
      open={open}
      onOpenChange={onOpenChange}
      title="Modifier mon mot de passe"
      description="Plan §12.04 — Ré-authentification requise. Vos sessions actives seront révoquées."
      schema={ChangePasswordSchema}
      fields={fields}
      onSubmit={handleSubmit}
      submitLabel="Changer le mot de passe"
    />
  );
}
