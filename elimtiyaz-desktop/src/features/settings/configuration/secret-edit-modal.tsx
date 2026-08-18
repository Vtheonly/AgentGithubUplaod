/**
 * SecretEditModal — unified modal for editing secret values.
 *
 * Refactored to consume `<AutoFormModal<T>>` with the `"password"` field type
 * so the secret value renders masked (never in plain text). The `showValue`
 * toggle from the previous hand-rolled modal is no longer needed because
 * browsers' native password input has its own reveal affordance.
 */
import { z } from "zod";
import { AutoFormModal, type AutoFormField } from "../../../shared/ui/auto-form";
import type { SecretEditState } from "./types";

const SecretSchema = z.object({
  secretValue: z.string().min(1, "La valeur du secret ne peut pas être vide"),
});

type SecretFormData = z.infer<typeof SecretSchema>;

export interface SecretEditModalProps {
  state: SecretEditState;
  isSaving: boolean;
  onChange: (s: SecretEditState) => void;
  onSave: () => void;
  onCancel: () => void;
}

export function SecretEditModal({
  state,
  isSaving,
  onChange,
  onSave,
  onCancel,
}: SecretEditModalProps) {
  const fields: readonly AutoFormField[] = [
    {
      name: "secretValue",
      label: `Valeur du secret (${state.envVarName})`,
      type: "password",
      required: true,
      wide: true,
      placeholder: "Collez la valeur du secret ici…",
      help: "Cette valeur sera chiffrée et injectée comme variable d'environnement. Elle ne sera jamais affichée en clair après enregistrement.",
    },
  ];

  function handleSubmit(data: SecretFormData) {
    onChange({ ...state, value: data.secretValue });
    onSave();
  }

  return (
    <AutoFormModal
      open={true}
      onOpenChange={(open) => !open && onCancel()}
      title={`Configurer : ${state.label}`}
      description={`Variable d'environnement : ${state.envVarName} — stockée chiffrée, injectée dans les Edge Functions.`}
      schema={SecretSchema}
      fields={fields}
      initialValues={{ secretValue: state.value }}
      onSubmit={handleSubmit}
      submitLabel={isSaving ? "Chiffrement…" : "Enregistrer le secret"}
    />
  );
}
