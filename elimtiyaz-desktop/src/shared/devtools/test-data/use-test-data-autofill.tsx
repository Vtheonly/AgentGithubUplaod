/**
 * useTestDataAutofill (T-399 / OPS-321) — the global Ctrl+O shortcut that
 * fills the active form with realistic test data.
 *
 * The listener pattern is the app's established global-shortcut shape (the
 * topbar's Ctrl+K palette / Ctrl+J copilot): window keydown, preventDefault,
 * no dependencies beyond the toast + i18n. Mounted ONCE next to the
 * ToastViewport inside the provider tree (src/app/app.tsx) so it is live on
 * every screen — the engine itself finds no form scope on non-form screens
 * and reports "nothing to fill".
 *
 * Ctrl+O collision check (83rd session): the Electron menu carries no
 * Ctrl+O accelerator (Fichier: quit only; Affichage: reload/devtools/zoom)
 * and no web handler binds it — preventDefault makes the shortcut ours in
 * the packaged app AND the browser dev server.
 *
 * i18n: every user-visible string is a dictionary key (the T-385/T-388
 * discipline) — fr/ar/en all carry the devtools.autofill.* block.
 */
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "../../../app/providers/toast-provider";
import { runAutofill } from "./autofill-engine";

export function useTestDataAutofill(): void {
  const toast = useToast();
  const { t } = useTranslation();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.altKey || e.shiftKey) return;
      if (e.key.toLowerCase() !== "o") return;
      e.preventDefault();
      void (async () => {
        try {
          const report = await runAutofill(document);
          if (!report.scopeFound) {
            toast.showInfo(
              t("devtools.autofill.title"),
              t("devtools.autofill.emptyScope"),
            );
            return;
          }
          const skippedNote =
            report.skipped.length > 0
              ? ` ${t("devtools.autofill.skippedNote", { count: report.skipped.length })}`
              : "";
          if (report.filledCount === 0) {
            toast.showWarning(
              t("devtools.autofill.title"),
              `${t("devtools.autofill.nothingFilled")}${skippedNote}`,
            );
            return;
          }
          toast.showSuccess(
            t("devtools.autofill.successTitle"),
            `${t("devtools.autofill.filled", { count: report.filledCount })}${skippedNote}`,
          );
        } catch (err) {
          toast.showError(
            t("devtools.autofill.title"),
            err instanceof Error ? err.message : t("devtools.autofill.unexpected"),
          );
        }
      })();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toast, t]);
}

/** Mount-once component form (rendered next to the ToastViewport). */
export function TestDataAutofill(): null {
  useTestDataAutofill();
  return null;
}
