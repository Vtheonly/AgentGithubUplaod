/**
 * Toast notifications — popups / dialogs (secondary feedback layer).
 *
 * Per the spec: popups/dialogs are for warnings, success messages, errors,
 * system notifications, and confirmation prompts. They should be:
 *   - Non-blocking when possible
 *   - Clear and minimal
 *   - Consistent across the system
 *
 * Four severities map to the four status colors (Success / Warning / Danger / Info).
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export type ToastSeverity = "success" | "warning" | "danger" | "info";

export interface Toast {
  readonly id: string;
  readonly severity: ToastSeverity;
  readonly title: string;
  readonly description?: string;
  readonly durationMs: number;
}

interface ToastContextValue {
  toasts: readonly Toast[];
  show(severity: ToastSeverity, title: string, description?: string, durationMs?: number): string;
  showSuccess(title: string, description?: string): string;
  showWarning(title: string, description?: string): string;
  showError(title: string, description?: string): string;
  showInfo(title: string, description?: string): string;
  dismiss(id: string): void;
  clear(): void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((curr) => curr.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (severity: ToastSeverity, title: string, description?: string, durationMs = 4500): string => {
      const id = `tst-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const toast: Toast = { id, severity, title, description, durationMs };
      setToasts((curr) => [...curr, toast]);
      if (durationMs > 0) {
        setTimeout(() => dismiss(id), durationMs);
      }
      return id;
    },
    [dismiss],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      toasts,
      show,
      showSuccess: (t, d) => show("success", t, d),
      showWarning: (t, d) => show("warning", t, d),
      showError: (t, d) => show("danger", t, d),
      showInfo: (t, d) => show("info", t, d),
      dismiss,
      clear: () => setToasts([]),
    }),
    [toasts, show, dismiss],
  );

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
