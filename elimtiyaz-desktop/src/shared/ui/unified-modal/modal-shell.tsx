/**
 * ModalShell — shared render skeleton for all 3 UnifiedModal variants.
 *
 * Extracted from `unified-modal.tsx` (iteration 20) to eliminate the
 * triplicated Dialog/Drawer/CommandPalette render branches. Each variant
 * only differs in: overlay color, content position, size class, and
 * animation. Everything else (header/body/footer/close-button) is shared.
 */
import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "../cn";
import {
  DIALOG_SIZE_CLASS,
  DRAWER_SIZE_CLASS,
  COMMAND_PALETTE_SIZE_CLASS,
  mapSizeForDrawer,
  type ModalVariant,
  type ModalSize,
} from "./types";

export interface ModalShellProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInteractOutside: (e: Event) => void;
  onEscapeKeyDown: (e: KeyboardEvent) => void;
  variant: ModalVariant;
  size: ModalSize;
  contentClassName?: string;
  hideCloseButton: boolean;
  children: React.ReactNode;
}

/** Overlay classes differ only in opacity (drawer = 60, dialog/palette = 70). */
function overlayClass(variant: ModalVariant): string {
  const opacity = variant === "drawer" ? "bg-black/60" : "bg-black/70";
  return cn(
    "fixed inset-0 z-50 backdrop-blur-sm",
    opacity,
    "data-[state=open]:animate-in data-[state=closed]:animate-out",
    "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
  );
}

/** Content position + animation per variant. */
function contentClass(variant: ModalVariant, size: ModalSize, contentClassName?: string): string {
  const base = "data-[state=open]:animate-in data-[state=closed]:animate-out";
  if (variant === "drawer") {
    return cn(
      "fixed end-0 top-0 z-50 flex h-full flex-col border-s border-border bg-popover shadow-2xl",
      "data-[state=open]:slide-in-right data-[state=closed]:slide-out-right",
      DRAWER_SIZE_CLASS[mapSizeForDrawer(size)],
      contentClassName,
    );
  }
  if (variant === "command-palette") {
    return cn(
      "fixed left-1/2 top-[15vh] z-50 grid w-full -translate-x-1/2 flex-col gap-0 border border-border bg-popover shadow-2xl sm:rounded-lg overflow-hidden",
      "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
      COMMAND_PALETTE_SIZE_CLASS[size],
      contentClassName,
    );
  }
  // dialog
  return cn(
    "fixed left-1/2 top-1/2 z-50 grid w-full -translate-x-1/2 -translate-y-1/2 flex-col gap-0 border border-border bg-popover shadow-2xl sm:rounded-lg overflow-hidden",
    base,
    "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
    "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
    DIALOG_SIZE_CLASS[size],
    contentClassName,
  );
}

export function ModalShell({
  open,
  onOpenChange,
  onInteractOutside,
  onEscapeKeyDown,
  variant,
  size,
  contentClassName,
  hideCloseButton,
  children,
}: ModalShellProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={overlayClass(variant)} />
        <DialogPrimitive.Content
          onInteractOutside={onInteractOutside}
          onEscapeKeyDown={onEscapeKeyDown}
          className={contentClass(variant, size, contentClassName)}
        >
          {children}
          {!hideCloseButton && (
            <DialogPrimitive.Close
              className="absolute end-4 top-4 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent/10 hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              aria-label="Fermer"
            >
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
