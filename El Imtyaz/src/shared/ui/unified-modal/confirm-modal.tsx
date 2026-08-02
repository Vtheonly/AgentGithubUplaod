/**
 * ConfirmModal — convenience preset for simple confirm dialogs.
 *
 * Extracted from `unified-modal.tsx` (iteration 20). Behavior unchanged.
 */
import * as React from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { UnifiedModal } from "../unified-modal";

export interface ConfirmModalProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  confirmLabel?: React.ReactNode;
  cancelLabel?: React.ReactNode;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
}

export function ConfirmModal({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirmer",
  cancelLabel = "Annuler",
  destructive = false,
  onConfirm,
}: ConfirmModalProps) {
  return (
    <UnifiedModal
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      variant="dialog"
      title={title}
      description={description}
      icon={destructive ? AlertTriangle : CheckCircle2}
      iconTone={destructive ? "danger" : "primary"}
      submitLabel={confirmLabel}
      cancelLabel={cancelLabel}
      submitVariant={destructive ? "destructive" : "default"}
      onSubmit={async () => {
        await onConfirm();
        onOpenChange(false);
      }}
    />
  );
}
