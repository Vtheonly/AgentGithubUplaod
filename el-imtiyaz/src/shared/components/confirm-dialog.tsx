/**
 * Confirm dialog — standardized 2-click confirmation pattern.
 *
 * Per the plan §10: manual one-click triggers require 2-click confirmation
 * (initiate + confirm). This component provides the confirm step.
 *
 * Iteration 3: now implemented on top of UnifiedModal so the visual
 * language is identical to every other modal in the application.
 */
import type { ReactNode } from "react";
import { ConfirmModal } from "./unified-modal";

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirmer",
  cancelLabel = "Annuler",
  destructive = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
}) {
  return (
    <ConfirmModal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      cancelLabel={cancelLabel}
      destructive={destructive}
      onConfirm={onConfirm}
    />
  );
}

// Re-export for new code; ConfirmDialog remains for backward compatibility.
export { ConfirmModal };
