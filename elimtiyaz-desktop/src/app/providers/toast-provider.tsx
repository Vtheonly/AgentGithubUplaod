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
 *
 * T-559 (EGRESS-LOOP / the S10 loop family): the actions and the LIST live in
 * TWO SEPARATE contexts. The actions context's value is memoized on the STABLE
 * callbacks ONLY (`[show, dismiss]` — both useCallback-stable), so its identity
 * NEVER changes when a toast lands or expires; the 100+ `useToast()` consumers
 * (every error/success notification surface) neither re-render nor re-run
 * effects on toast traffic. The toast LIST context (`useToastList`, consumed by
 * the viewport alone) is the only part that follows the toasts state. This
 * kills the amplification-loop engine at the provider level: pre-T-559 one
 * context value keyed on `[toasts, show, dismiss]` identity-churned on every
 * toast, so any effect depending on `showError`/the toast value tore down and
 * re-fired with each toast — a failing load re-firing itself through its error
 * toast (the unbounded egress loop the audit toaster pinned in T-485, now
 * impossible BY CONSTRUCTION rather than by per-consumer ref discipline).
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
  show(severity: ToastSeverity, title: string, description?: string, durationMs?: number): string;
  showSuccess(title: string, description?: string): string;
  showWarning(title: string, description?: string): string;
  showError(title: string, description?: string): string;
  showInfo(title: string, description?: string): string;
  dismiss(id: string): void;
  clear(): void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/** T-559: the toast LIST context — subscribe ONLY from the viewport (or a
 * surface that genuinely renders the toast stack). Its value changes with
 * every toast add/dismiss by design; subscribing a load effect to it
 * reintroduces the loop this split removed. */
const ToastListContext = createContext<readonly Toast[]>([]);

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

  // T-559: keyed ONLY on the stable deps — the context value identity is
  // PERMANENT for the provider's lifetime; landing/dismissing toasts can
  // never re-render the useToast() consumers or re-fire their effects.
  const value = useMemo<ToastContextValue>(
    () => ({
      show,
      showSuccess: (t, d) => show("success", t, d),
      showWarning: (t, d) => show("warning", t, d),
      showError: (t, d) => show("danger", t, d),
      showInfo: (t, d) => show("info", t, d),
      dismiss,
      clear: () => setToasts([]),
    }),
    [show, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      <ToastListContext.Provider value={toasts}>{children}</ToastListContext.Provider>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

/** T-559: the toast LIST — the viewport's subscription. Returns the current
 * stack; the subscribing component re-renders on toast traffic (by design,
 * it renders the stack). */
export function useToastList(): readonly Toast[] {
  return useContext(ToastListContext);
}
