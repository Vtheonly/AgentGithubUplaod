/**
 * UnifiedModal — single source of truth for ALL modal-style interactions.
 *
 * Iteration 20 refactor: extracted types into `./unified-modal/types.ts`,
 * sub-components (Header/Body/Footer/Alert) into `./unified-modal/parts.tsx`,
 * the shared render skeleton into `./unified-modal/modal-shell.tsx`, and
 * the ConfirmModal preset into `./unified-modal/confirm-modal.tsx`.
 *
 * Behavior is unchanged — only file structure moved. This file now only
 * contains the `UnifiedModal` orchestrator that wires props → shell +
 * header + body + footer.
 *
 * See `./unified-modal/types.ts` for the full props documentation.
 */
import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Loader2 } from "lucide-react";
import { cn } from "./cn";
import { Button } from "./button";
import { ModalShell } from "./unified-modal/modal-shell";
import {
  UnifiedModalHeader,
  UnifiedModalBody,
  UnifiedModalFooter,
} from "./unified-modal/parts";
import {
  type UnifiedModalProps,
} from "./unified-modal/types";

export { UnifiedModalHeader, UnifiedModalBody, UnifiedModalFooter } from "./unified-modal/parts";
export { UnifiedModalAlert } from "./unified-modal/parts";
export { ConfirmModal } from "./unified-modal/confirm-modal";
export type { UnifiedModalProps, ModalAlert, ModalVariant, ModalSize, IconTone } from "./unified-modal/types";

export function UnifiedModal(props: UnifiedModalProps) {
  const {
    open,
    onOpenChange,
    variant = "dialog",
    size = "md",
    title,
    description,
    icon: Icon,
    iconTone = "primary",
    badge,
    header: headerSlot,
    hideHeader = false,
    hideCloseButton = false,
    children,
    alert,
    onDismissAlert,
    submitLabel,
    cancelLabel = "Annuler",
    onSubmit,
    submitVariant = "default",
    submitIcon: SubmitIcon,
    submitDisabled = false,
    submitLoading = false,
    hideSubmit = false,
    hideCancel = false,
    hideFooter = false,
    footer,
    footerLeading,
    closeOnBackdropClick = true,
    closeOnEscape = true,
    locked = false,
    bodyClassName,
    headerClassName,
    footerClassName,
    contentClassName,
  } = props;

  const isDrawer = variant === "drawer";
  const isCommandPalette = variant === "command-palette";

  const [internalLoading, setInternalLoading] = React.useState(false);
  const loading = internalLoading || submitLoading;

  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      if (locked && !next) return;
      if (!next && loading) return;
      onOpenChange(next);
    },
    [locked, loading, onOpenChange],
  );

  const handleInteractOutside = React.useCallback(
    (e: Event) => {
      if (!closeOnBackdropClick || locked || loading) e.preventDefault();
    },
    [closeOnBackdropClick, locked, loading],
  );

  const handleEscapeKeyDown = React.useCallback(
    (e: KeyboardEvent) => {
      if (!closeOnEscape || locked || loading) e.preventDefault();
    },
    [closeOnEscape, locked, loading],
  );

  async function handleSubmit() {
    if (!onSubmit || loading || submitDisabled) return;
    try {
      setInternalLoading(true);
      await onSubmit();
    } finally {
      setInternalLoading(false);
    }
  }

  const headerNode = buildHeader({
    isCommandPalette,
    isDrawer,
    hideHeader,
    headerSlot,
    title,
    headerClassName,
    icon: Icon,
    iconTone,
    description,
    badge,
  });

  const bodyNode = (
    <UnifiedModalBody
      isDrawer={isDrawer}
      isCommandPalette={isCommandPalette}
      alert={alert}
      onDismissAlert={onDismissAlert}
      className={bodyClassName}
    >
      {children}
    </UnifiedModalBody>
  );

  const footerNode = buildFooter({
    footer,
    hideFooter,
    isDrawer,
    footerLeading,
    footerClassName,
    hideCancel,
    cancelLabel,
    onOpenChange,
    loading,
    hideSubmit,
    submitLabel,
    submitVariant,
    handleSubmit,
    submitDisabled,
    SubmitIcon,
  });

  return (
    <ModalShell
      open={open}
      onOpenChange={handleOpenChange}
      onInteractOutside={handleInteractOutside}
      onEscapeKeyDown={handleEscapeKeyDown}
      variant={variant}
      size={size}
      contentClassName={contentClassName}
      hideCloseButton={hideCloseButton}
    >
      {headerNode}
      {bodyNode}
      {footerNode}
    </ModalShell>
  );
}

interface BuildHeaderArgs {
  isCommandPalette: boolean;
  isDrawer: boolean;
  hideHeader: boolean;
  headerSlot: React.ReactNode;
  title: React.ReactNode;
  headerClassName?: string;
  icon?: UnifiedModalProps["icon"];
  iconTone: NonNullable<UnifiedModalProps["iconTone"]>;
  description?: React.ReactNode;
  badge?: React.ReactNode;
}

function buildHeader(args: BuildHeaderArgs): React.ReactNode {
  const { isCommandPalette, isDrawer, hideHeader, headerSlot, title, headerClassName, icon, iconTone, description, badge } = args;
  const showDefaultHeader = !hideHeader && !headerSlot;

  if (isCommandPalette) {
    if (headerSlot) {
      return (
        <div className={cn("border-b border-border", headerClassName)}>
          <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
          {headerSlot}
        </div>
      );
    }
    if (!hideHeader) {
      return (
        <div className={cn("border-b border-border p-4", headerClassName)}>
          <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
        </div>
      );
    }
    return <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>;
  }

  if (showDefaultHeader) {
    return (
      <UnifiedModalHeader
        isDrawer={isDrawer}
        icon={icon}
        iconTone={iconTone}
        title={title}
        description={description}
        badge={badge}
        className={headerClassName}
      />
    );
  }

  return <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>;
}

interface BuildFooterArgs {
  footer: React.ReactNode;
  hideFooter: boolean;
  isDrawer: boolean;
  footerLeading?: React.ReactNode;
  footerClassName?: string;
  hideCancel: boolean;
  cancelLabel: React.ReactNode;
  onOpenChange: (open: boolean) => void;
  loading: boolean;
  hideSubmit: boolean;
  submitLabel?: React.ReactNode;
  submitVariant: NonNullable<UnifiedModalProps["submitVariant"]>;
  handleSubmit: () => void;
  submitDisabled: boolean;
  SubmitIcon?: UnifiedModalProps["submitIcon"];
}

function buildFooter(args: BuildFooterArgs): React.ReactNode {
  const {
    footer, hideFooter, isDrawer, footerLeading, footerClassName,
    hideCancel, cancelLabel, onOpenChange, loading, hideSubmit,
    submitLabel, submitVariant, handleSubmit, submitDisabled, SubmitIcon,
  } = args;

  if (footer) {
    return (
      <UnifiedModalFooter isDrawer={isDrawer} className={footerClassName}>
        {footer}
      </UnifiedModalFooter>
    );
  }
  if (hideFooter) return null;

  return (
    <UnifiedModalFooter
      isDrawer={isDrawer}
      leading={footerLeading}
      className={footerClassName}
    >
      {!hideCancel && (
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
          {cancelLabel}
        </Button>
      )}
      {!hideSubmit && submitLabel && (
        <Button
          type="button"
          variant={submitVariant === "destructive" ? "destructive" : "default"}
          onClick={handleSubmit}
          disabled={loading || submitDisabled}
          className={submitVariant === "success" ? "bg-status-success hover:bg-status-success/90" : undefined}
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="ml-1">Traitement…</span>
            </>
          ) : (
            <>
              {SubmitIcon && <SubmitIcon className="h-4 w-4" />}
              <span className={SubmitIcon ? "ml-1" : ""}>{submitLabel}</span>
            </>
          )}
        </Button>
      )}
    </UnifiedModalFooter>
  );
}
