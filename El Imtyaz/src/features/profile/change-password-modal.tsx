/**
 * ChangePasswordModal — plan §12.04 Password Governance UI.
 *
 * Iteration 10 — surfaces the new `useAuth().changePassword` operation.
 *
 * Per plan §12.04:
 *   - "Self-service password reset" → user can change their own password.
 *   - "Credential update (user-initiated)" → same flow.
 *   - "Allow password changes without re-authentication. The user must
 *     prove current credentials before setting a new password." → we
 *     require the current password field.
 *   - "Modifying a password automatically revokes all active JWT tokens
 *     and terminates active sessions across all devices" → on success,
 *     the user is signed out and redirected to login.
 *
 * Strength validation (plan §12.04 "Strong Entropy"):
 *   - min 8 characters
 *   - at least one lowercase letter
 *   - at least one uppercase letter
 *   - at least one digit
 *
 * Uses the UnifiedModal primitive so the visual language matches every
 * other modal in the application (per the unified modal system rule).
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { KeyRound, Eye, EyeOff, Check, X } from "lucide-react";
import { useAuth } from "../../app/providers/auth-provider";
import { useToast } from "../../app/providers/toast-provider";
import { UnifiedModal } from "../../shared/ui/unified-modal";
import { FormField } from "../../shared/ui/form-field";
import { Input } from "../../shared/ui/input";

interface ChangePasswordModalProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

export function ChangePasswordModal({ open, onOpenChange }: ChangePasswordModalProps) {
  const { changePassword } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setShowCurrent(false);
    setShowNew(false);
    setError(null);
  }

  function handleClose(o: boolean) {
    if (!o) reset();
    onOpenChange(o);
  }

  // Live strength checks (plan §12.04 "Strong Entropy").
  const checks = {
    length: newPassword.length >= 8,
    lowercase: /[a-z]/.test(newPassword),
    uppercase: /[A-Z]/.test(newPassword),
    digit: /[0-9]/.test(newPassword),
    matches: newPassword.length > 0 && newPassword === confirmPassword,
  };
  const allValid = checks.length && checks.lowercase && checks.uppercase && checks.digit && checks.matches;

  async function handleSubmit() {
    if (!allValid) {
      setError(
        !checks.length ? "Le mot de passe doit contenir au moins 8 caractères."
        : !checks.matches ? "Les mots de passe ne correspondent pas."
        : "Le mot de passe ne respecte pas les critères de sécurité.",
      );
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await changePassword(currentPassword, newPassword);
      if (result.ok) {
        toast.showSuccess(
          "Mot de passe modifié",
          "Votre session a été révoquée. Veuillez vous reconnecter.",
        );
        handleClose(false);
        // Navigate to login (the session was just cleared).
        navigate("/login");
      } else {
        setError(result.error);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <UnifiedModal
      open={open}
      onOpenChange={handleClose}
      title="Modifier mon mot de passe"
      description="Plan §12.04 — re-authentification requise. Votre session sera révoquée après le changement."
      icon={KeyRound}
      iconTone="warning"
      size="md"
      submitLabel="Changer le mot de passe"
      submitIcon={KeyRound}
      submitLoading={submitting}
      submitDisabled={!allValid || !currentPassword}
      alert={error ? { tone: "error", title: "Erreur", description: error } : null}
      onSubmit={handleSubmit}
    >
      <div className="space-y-4">
        <FormField label="Mot de passe actuel" htmlFor="current-pwd" required>
          <div className="relative">
            <Input
              id="current-pwd"
              type={showCurrent ? "text" : "password"}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowCurrent((s) => !s)}
              className="absolute end-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              tabIndex={-1}
            >
              {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </FormField>

        <FormField label="Nouveau mot de passe" htmlFor="new-pwd" required>
          <div className="relative">
            <Input
              id="new-pwd"
              type={showNew ? "text" : "password"}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowNew((s) => !s)}
              className="absolute end-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              tabIndex={-1}
            >
              {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </FormField>

        <FormField label="Confirmer le nouveau mot de passe" htmlFor="confirm-pwd" required>
          <Input
            id="confirm-pwd"
            type={showNew ? "text" : "password"}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="new-password"
          />
        </FormField>

        {/* Strength checklist (plan §12.04 "Strong Entropy") */}
        <div className="rounded-md border border-border bg-muted/20 p-3 space-y-1">
          <p className="text-[10px] uppercase text-muted-foreground font-semibold">
            Critères de sécurité (plan §12.04)
          </p>
          <StrengthCheck ok={checks.length} label="Au moins 8 caractères" />
          <StrengthCheck ok={checks.lowercase} label="Au moins une lettre minuscule" />
          <StrengthCheck ok={checks.uppercase} label="Au moins une lettre majuscule" />
          <StrengthCheck ok={checks.digit} label="Au moins un chiffre" />
          <StrengthCheck ok={checks.matches} label="Les deux mots de passe correspondent" />
        </div>

        <div className="rounded-md border border-status-warning/30 bg-status-warning/10 p-2.5 text-xs text-status-warning flex items-start gap-2">
          <KeyRound className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <p>
            <strong>Session révoquée:</strong> conformément au plan §12.04, modifier votre
            mot de passe déconnectera toutes vos sessions actives. Vous devrez vous
            reconnecter sur tous vos appareils.
          </p>
        </div>
      </div>
    </UnifiedModal>
  );
}

function StrengthCheck({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span
        className={`flex h-4 w-4 items-center justify-center rounded-full ${
          ok ? "bg-status-success/20 text-status-success" : "bg-muted text-muted-foreground"
        }`}
      >
        {ok ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
      </span>
      <span className={ok ? "text-foreground" : "text-muted-foreground"}>{label}</span>
    </div>
  );
}
