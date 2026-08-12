/**
 * Shared types + constants for UnifiedModal.
 *
 * Extracted from `unified-modal.tsx` (iteration 20) so sub-components
 * can be split into focused files without circular imports.
 */
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export type ModalVariant = "dialog" | "drawer" | "command-palette";
export type ModalSize = "sm" | "md" | "lg" | "xl" | "full";
export type DrawerSize = "sm" | "md" | "lg";
export type SubmitVariant = "default" | "destructive" | "success";
export type AlertTone = "error" | "warning" | "info";
export type IconTone = "primary" | "success" | "warning" | "danger" | "neutral";

export interface ModalAlert {
  tone: AlertTone;
  title: string;
  description?: string;
}

export interface UnifiedModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  variant?: ModalVariant;
  size?: ModalSize;
  title: ReactNode;
  description?: ReactNode;
  icon?: LucideIcon;
  iconTone?: IconTone;
  badge?: ReactNode;
  header?: ReactNode;
  hideHeader?: boolean;
  hideCloseButton?: boolean;
  children?: ReactNode;
  alert?: ModalAlert | null;
  onDismissAlert?: () => void;
  submitLabel?: ReactNode;
  cancelLabel?: ReactNode;
  onSubmit?: () => void | Promise<void>;
  submitVariant?: SubmitVariant;
  submitIcon?: LucideIcon;
  submitDisabled?: boolean;
  submitLoading?: boolean;
  hideSubmit?: boolean;
  hideCancel?: boolean;
  hideFooter?: boolean;
  footer?: ReactNode;
  footerLeading?: ReactNode;
  closeOnBackdropClick?: boolean;
  closeOnEscape?: boolean;
  locked?: boolean;
  bodyClassName?: string;
  headerClassName?: string;
  footerClassName?: string;
  contentClassName?: string;
}

export const DIALOG_SIZE_CLASS: Record<ModalSize, string> = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
  full: "max-w-[95vw] h-[90vh]",
};

export const DRAWER_SIZE_CLASS: Record<DrawerSize, string> = {
  sm: "w-[400px]",
  md: "w-[560px]",
  lg: "w-[820px]",
};

export const COMMAND_PALETTE_SIZE_CLASS: Record<ModalSize, string> = {
  sm: "max-w-md",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
  full: "max-w-[95vw]",
};

export const ICON_TONE_CLASS: Record<IconTone, string> = {
  primary: "bg-primary/10 text-primary",
  success: "bg-status-success/15 text-status-success",
  warning: "bg-status-warning/15 text-status-warning",
  danger: "bg-status-danger/15 text-status-danger",
  neutral: "bg-muted text-muted-foreground",
};

/** Map a ModalSize to the closest DrawerSize (drawers only use sm/md/lg). */
export function mapSizeForDrawer(size?: ModalSize): DrawerSize {
  if (size === "sm") return "sm";
  if (size === "md") return "md";
  return "lg";
}
