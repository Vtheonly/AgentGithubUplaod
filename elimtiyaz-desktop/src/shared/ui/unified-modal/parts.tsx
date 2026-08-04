/**
 * UnifiedModal sub-components — Header, Body, Footer, Alert.
 *
 * Extracted from `unified-modal.tsx` (iteration 20) for size + clarity.
 * Behavior is unchanged — only the file location moved.
 */
import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X, AlertTriangle, AlertCircle, type LucideIcon } from "lucide-react";
import { cn } from "../cn";
import {
  ICON_TONE_CLASS,
  type IconTone,
  type ModalAlert,
} from "./types";

export interface UnifiedModalHeaderProps {
  isDrawer: boolean;
  icon?: LucideIcon;
  iconTone?: IconTone;
  title: React.ReactNode;
  description?: React.ReactNode;
  badge?: React.ReactNode;
  className?: string;
}

export function UnifiedModalHeader({
  isDrawer,
  icon: Icon,
  iconTone = "primary",
  title,
  description,
  badge,
  className,
}: UnifiedModalHeaderProps) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 pr-12",
        isDrawer ? "border-b border-border p-5" : "border-b border-border p-5",
        className,
      )}
    >
      {Icon && (
        <div
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
            ICON_TONE_CLASS[iconTone],
          )}
        >
          <Icon className="h-5 w-5" />
        </div>
      )}
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <DialogPrimitive.Title
            className={cn(
              "font-semibold text-foreground truncate",
              isDrawer ? "text-base" : "text-lg",
            )}
          >
            {title}
          </DialogPrimitive.Title>
          {badge}
        </div>
        {description && (
          <DialogPrimitive.Description className="text-sm text-muted-foreground leading-snug">
            {description}
          </DialogPrimitive.Description>
        )}
      </div>
    </div>
  );
}

export interface UnifiedModalBodyProps {
  isDrawer: boolean;
  isCommandPalette?: boolean;
  alert?: ModalAlert | null;
  onDismissAlert?: () => void;
  className?: string;
  children?: React.ReactNode;
}

export function UnifiedModalBody({
  isCommandPalette = false,
  alert,
  onDismissAlert,
  className,
  children,
}: UnifiedModalBodyProps) {
  return (
    <div
      className={cn(
        "flex-1 overflow-y-auto",
        // command-palette defaults to p-0 (flush results list); dialog/drawer default to p-5.
        isCommandPalette ? "p-0" : "p-5",
        className,
      )}
    >
      {alert && (
        <UnifiedModalAlert
          tone={alert.tone}
          title={alert.title}
          description={alert.description}
          onDismiss={onDismissAlert}
        />
      )}
      {children}
    </div>
  );
}

export interface UnifiedModalFooterProps {
  isDrawer: boolean;
  leading?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}

export function UnifiedModalFooter({
  leading,
  className,
  children,
}: UnifiedModalFooterProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 border-t border-border p-4",
        leading && "justify-between",
        className,
      )}
    >
      {leading && <div className="flex items-center gap-2">{leading}</div>}
      {children && (
        <div className={cn("flex items-center gap-2", leading ? "" : "ml-auto")}>
          {children}
        </div>
      )}
    </div>
  );
}

export interface UnifiedModalAlertProps {
  tone: ModalAlert["tone"];
  title: string;
  description?: string;
  onDismiss?: () => void;
}

export function UnifiedModalAlert({
  tone,
  title,
  description,
  onDismiss,
}: UnifiedModalAlertProps) {
  const Icon = tone === "error" ? AlertCircle : tone === "warning" ? AlertTriangle : AlertCircle;
  const toneClass =
    tone === "error"
      ? "border-status-danger/30 bg-status-danger/10 text-status-danger"
      : tone === "warning"
        ? "border-status-warning/30 bg-status-warning/10 text-status-warning"
        : "border-status-info/30 bg-status-info/10 text-status-info";

  return (
    <div
      className={cn(
        "mb-4 flex items-start gap-3 rounded-lg border px-3 py-2.5 text-sm",
        toneClass,
      )}
      role="alert"
    >
      <Icon className="h-4 w-4 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="font-medium leading-tight">{title}</p>
        {description && (
          <p className="mt-0.5 text-xs opacity-90 leading-snug">{description}</p>
        )}
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 text-current opacity-60 transition-opacity hover:opacity-100"
          aria-label="Fermer l'alerte"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
