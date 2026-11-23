/**
 * useSettingsSection — the ONE settings load/save/toast ceremony (E6.11 /
 * DUP-030 / SET-U2).
 *
 * The ceremony this hook replaces (it was hand-rolled per settings tab):
 *   - rows + isLoading state;
 *   - a `load` callback reading the config service;
 *   - the T-560 load-generation-ref gate — the load fires ON MOUNT and on
 *     EXPLICIT refresh only; toast traffic, service identity churn, and
 *     parent re-renders can NEVER re-fire it (the S10 egress-loop shape
 *     stays dead by construction);
 *   - the T-560 identical-consecutive-error-toast dedupe — the SAME
 *     failure twice in a row renders ONE toast; a DIFFERENT message still
 *     toasts (honest failures);
 *   - a save wrapper with the canonical success/error toasts.
 *
 * Consumers stay in full control of the DATA: they pass the typed `load`
 * (a Result-returning function) and receive `rows`, `isLoading`,
 * `refresh`, and `save`.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "../../app/providers/toast-provider";
import type { Result } from "../../core/result";

export interface UseSettingsSectionOptions<T> {
  /** The typed load (a Result — errors are honest, never thrown). */
  readonly load: () => Promise<Result<T>>;
  /** The initial rows value (before the first load lands). */
  readonly initial: T;
  /** Builds the load-failure toast message from the error's userMessage. */
  readonly loadErrorMessage?: (userMessage: string) => string;
  /** The save-success toast message (omit to skip the success toast). */
  readonly saveSuccessMessage?: string;
  /** The save-error toast title. */
  readonly saveErrorTitle?: string;
}

export interface UseSettingsSectionResult<T> {
  readonly rows: T;
  readonly isLoading: boolean;
  /** EXPLICIT refresh (the Refresh button / post-save reload). */
  readonly refresh: () => Promise<void>;
  /**
   * Save wrapper: runs the Result-returning mutation, toasts success /
   * failure, returns the outcome. The consumer decides WHAT to persist.
   */
  readonly save: (mutation: () => Promise<Result<unknown>>) => Promise<boolean>;
}

export function useSettingsSection<T>(
  options: UseSettingsSectionOptions<T>,
): UseSettingsSectionResult<T> {
  const { load, initial, loadErrorMessage, saveSuccessMessage, saveErrorTitle } = options;
  const { showSuccess, showError } = useToast();

  const [rows, setRows] = useState<T>(initial);
  const [isLoading, setIsLoading] = useState(false);

  // T-560: the load callback is read through a ref so no identity churn
  // (toast context, service re-creation, parent re-render) can ever
  // re-fire the network load.
  const loadRef = useRef(load);
  loadRef.current = load;
  const lastLoadErrorRef = useRef<string | null>(null);
  const loadGenerationRef = useRef(0);
  const mountedRef = useRef(false);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    const result = await loadRef.current();
    if (result.ok) {
      setRows(result.value);
      lastLoadErrorRef.current = null;
    } else {
      // T-560: the identical-consecutive-error-toast dedupe.
      const message = loadErrorMessage
        ? loadErrorMessage(result.error.userMessage)
        : `Erreur chargement : ${result.error.userMessage}`;
      if (lastLoadErrorRef.current !== message) {
        lastLoadErrorRef.current = message;
        showError(message);
      }
    }
    setIsLoading(false);
    // loadErrorMessage is read through the closure; showError is the
    // toast-context action (stable per the T-559 split).
  }, [loadErrorMessage, showError]);

  // T-560: the load fires ON MOUNT ONLY — the generation ref counts the
  // legitimate triggers (mount), and the effect's dependency list is
  // deliberately EMPTY.
  useEffect(() => {
    mountedRef.current = true;
    loadGenerationRef.current += 1;
    void refresh();
    return () => {
      mountedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the T-560 gate: mount-only.
  }, []);

  const save = useCallback(
    async (mutation: () => Promise<Result<unknown>>): Promise<boolean> => {
      const result = await mutation();
      if (result.ok) {
        if (saveSuccessMessage) showSuccess(saveSuccessMessage);
      } else {
        showError(
          saveErrorTitle ?? "Échec de l'enregistrement",
          result.error.userMessage,
        );
      }
      return result.ok;
    },
    [saveSuccessMessage, saveErrorTitle, showSuccess, showError],
  );

  return { rows, isLoading, refresh, save };
}
