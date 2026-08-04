/**
 * SecretEditModal — unified modal for editing secret values.
 *
 * Extracted from `configuration-tab.tsx` (iteration 20). Behavior is
 * unchanged — only the file location moved.
 */
import { Bot, Eye, EyeOff } from "lucide-react";
import { UnifiedModal } from "../../../shared/ui/unified-modal";
import { Button } from "../../../shared/ui/button";
import { Input } from "../../../shared/ui/input";
import { Label } from "../../../shared/ui/label";
import type { SecretEditState } from "./types";

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
  return (
    <UnifiedModal
      open={true}
      onOpenChange={(open) => !open && onCancel()}
      variant="dialog"
      size="md"
      title={`Configurer: ${state.label}`}
      icon={Bot}
      iconTone="primary"
      submitLoading={isSaving}
      onSubmit={onSave}
      submitLabel="Enregistrer le secret"
      cancelLabel="Annuler"
      alert={{
        tone: "warning",
        title: "Cette valeur sera stockée chiffrée",
        description: "Le secret sera envoyé au serveur via HTTPS et stocké dans l'environnement des Edge Functions. Il ne sera JAMAIS affiché en clair après enregistrement.",
      }}
    >
      <div className="space-y-4">
        <EnvVarDisplay envVarName={state.envVarName} />

        <SecretValueInput
          state={state}
          onChange={onChange}
        />
      </div>
    </UnifiedModal>
  );
}

function EnvVarDisplay({ envVarName }: { envVarName: string }) {
  return (
    <div className="space-y-1.5">
      <Label>Variable d'environnement</Label>
      <code className="font-mono text-sm bg-muted px-2 py-1.5 rounded block">
        {envVarName}
      </code>
      <p className="text-xs text-muted-foreground">
        Cette valeur sera disponible dans les Edge Functions en tant que{" "}
        <code className="font-mono">Deno.env.get("{envVarName}")</code>
      </p>
    </div>
  );
}

function SecretValueInput({
  state,
  onChange,
}: {
  state: SecretEditState;
  onChange: (s: SecretEditState) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label>Valeur du secret</Label>
      <div className="flex items-center gap-2">
        <Input
          type={state.showValue ? "text" : "password"}
          value={state.value}
          onChange={(e) => onChange({ ...state, value: e.target.value })}
          placeholder="Collez la valeur du secret ici..."
          className="font-mono"
          autoFocus
        />
        <Button
          type="button"
          size="icon"
          variant="outline"
          onClick={() => onChange({ ...state, showValue: !state.showValue })}
          aria-label={state.showValue ? "Masquer" : "Afficher"}
        >
          {state.showValue ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {state.value.length} caractère(s)
      </p>
    </div>
  );
}
