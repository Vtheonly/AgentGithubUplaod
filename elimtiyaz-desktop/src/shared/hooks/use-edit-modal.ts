/**
 * useEditModal — the ONE edit-modal save ceremony (E6.11 / DUP-030 / SET-U6).
 *
 * The idiom this hook replaces (hand-rolled per tab modal):
 *   - an `isSaving` flag around the async submit;
 *   - the canonical success/error toasts on the submit's Result;
 *   - close-on-success (the consumer passes its close — each modal owns
 *     its own open/draft state shape).
 *
 * The modal's DRAFT state stays the consumer's own (each modal has its own
 * fields: the secret editor's key/value, the theme editor's palette…);
 * this hook owns only the saving lifecycle.
 */
import { useCallback, useRef, useState } from "react";
import { useToast } from "../../app/providers/toast-provider";
import type { Result } from "../../core/result";

export interface UseEditModalOptions<Draft> {
  /** The async submit — returns a Result; errors are honest, never thrown. */
  readonly onSubmit: (draft: Draft) => Promise<Result<unknown>>;
  /** Called ONLY on success (the modal's own close). */
  readonly closeOnSuccess: () => void;
  /** The save-success toast message (omit to skip the success toast). */
  readonly successMessage?: string;
  /** The save-error toast title. */
  readonly errorTitle?: string;
  /** Guards the empty-value validation error (shown BEFORE the submit). */
  readonly validationError?: (draft: Draft) => string | null;
}

export interface UseEditModalResult<Draft> {
  readonly isSaving: boolean;
  /** Runs the submit with the saving flag + toasts; closes on success. */
  readonly submit: (draft: Draft) => Promise<boolean>;
}

export function useEditModal<Draft>(
  options: UseEditModalOptions<Draft>,
): UseEditModalResult<Draft> {
  const { onSubmit, closeOnSuccess, successMessage, errorTitle, validationError } = options;
  const { showSuccess, showError } = useToast();

  const [isSaving, setIsSaving] = useState(false);

  // The callbacks are read through refs so identity churn (parent
  // re-render) never re-arms the save.
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;
  const closeOnSuccessRef = useRef(closeOnSuccess);
  closeOnSuccessRef.current = closeOnSuccess;

  const submit = useCallback(
    async (draft: Draft): Promise<boolean> => {
      if (isSaving) return false;
      const validation = validationError?.(draft) ?? null;
      if (validation !== null) {
        showError(validation);
        return false;
      }
      setIsSaving(true);
      try {
        const result = await onSubmitRef.current(draft);
        if (result.ok) {
          if (successMessage) showSuccess(successMessage);
          closeOnSuccessRef.current();
          return true;
        }
        showError(errorTitle ?? "Échec de l'enregistrement", result.error.userMessage);
        return false;
      } finally {
        setIsSaving(false);
      }
    },
    [isSaving, successMessage, errorTitle, validationError, showSuccess, showError],
  );

  return { isSaving, submit };
}
