/**
 * State views — LoadingState, ErrorState, EmptyState, AsyncContent.
 *
 * Standardized patterns for handling the four UI states every list/grid
 * goes through: loading, error, empty, content. Mirrors the Android
 * `core/ui/StateViews.kt` so the UX is identical across platforms.
 */
import type { ReactNode } from "react";
import { AlertCircle, Inbox, RefreshCw, WifiOff } from "lucide-react";
import type { AppError } from "../../core/result";
import { isNetworkError } from "../../core/app-error";
import { Button } from "../ui/button";
import { cn } from "../ui/cn";

export function LoadingState({ message = "Chargement…" }: { message?: string }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-8">
      <RefreshCw className="h-6 w-6 animate-spin text-primary" />
      <span className="text-sm text-muted-foreground">{message}</span>
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: AppError; onRetry?: () => void }) {
  const Icon = isNetworkError(error) ? WifiOff : AlertCircle;
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-status-danger/15">
        <Icon className="h-7 w-7 text-status-danger" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{error.userMessage}</p>
        <p className="text-xs text-muted-foreground font-mono">{error.code}</p>
      </div>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="h-4 w-4" /> Réessayer
        </Button>
      ) : null}
    </div>
  );
}

export function EmptyState({
  title = "Aucun élément",
  description,
  icon,
  actionLabel,
  onAction,
}: {
  title?: string;
  description?: string;
  icon?: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
        {icon ?? <Inbox className="h-7 w-7 text-muted-foreground" />}
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
      {actionLabel && onAction ? (
        <Button variant="outline" size="sm" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}

export function AsyncContent<T>({
  isLoading,
  error,
  items,
  onRetry,
  emptyTitle,
  emptyDescription,
  emptyIcon,
  className,
  children,
}: {
  isLoading: boolean;
  error: AppError | null;
  items: readonly T[];
  onRetry?: () => void;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyIcon?: ReactNode;
  className?: string;
  children: (items: readonly T[]) => ReactNode;
}) {
  if (isLoading && items.length === 0) return <LoadingState />;
  if (error && items.length === 0) return <ErrorState error={error} onRetry={onRetry} />;
  if (items.length === 0)
    return <EmptyState title={emptyTitle} description={emptyDescription} icon={emptyIcon} />;
  return <div className={cn("h-full", className)}>{children(items)}</div>;
}
