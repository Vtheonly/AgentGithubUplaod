/**
 * Toast viewport — renders the toasts managed by ToastProvider.
 * Fixed to bottom-right; auto-dismisses per toast duration.
 */
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { useToast, useToastList, type ToastSeverity } from "../../app/providers/toast-provider";
import { cn } from "../ui/cn";

const SEVERITY_STYLES: Record<ToastSeverity, { container: string; icon: typeof Info }> = {
  success: { container: "border-status-success/40 bg-status-success/10", icon: CheckCircle2 },
  warning: { container: "border-status-warning/40 bg-status-warning/10", icon: AlertTriangle },
  danger: { container: "border-status-danger/40 bg-status-danger/10", icon: XCircle },
  info: { container: "border-status-info/40 bg-status-info/10", icon: Info },
};

const SEVERITY_ICON_CLASS: Record<ToastSeverity, string> = {
  success: "text-status-success",
  warning: "text-status-warning",
  danger: "text-status-danger",
  info: "text-status-info",
};

export function ToastViewport() {
  // T-559: the actions (dismiss — the stable context) + the LIST (the
  // toast-traffic context, subscribed HERE and essentially only here).
  const { dismiss } = useToast();
  const toasts = useToastList();
  if (toasts.length === 0) return null;
  return (
    // E6.1 (UI-U1): z-toast (the named scale) + the tailwindcss-animate
    // verb `slide-in-from-bottom-4 fade-in-0` — the ONE animation family.
    // The former bare z literal (100) + the custom slide-up keyframe are
    // retired (DUP-023/028).
    <div className="fixed bottom-4 right-4 z-toast flex flex-col gap-2 max-w-sm">
      {toasts.map((t) => {
        const styles = SEVERITY_STYLES[t.severity];
        const Icon = styles.icon;
        return (
          <div
            key={t.id}
            className={cn(
              "flex items-start gap-3 rounded-md border p-3 shadow-lg backdrop-blur-sm animate-in fade-in-0 slide-in-from-bottom-4",
              styles.container,
            )}
          >
            <Icon className={cn("h-5 w-5 shrink-0 mt-0.5", SEVERITY_ICON_CLASS[t.severity])} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">{t.title}</p>
              {t.description ? (
                <p className="text-xs text-muted-foreground mt-0.5">{t.description}</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
