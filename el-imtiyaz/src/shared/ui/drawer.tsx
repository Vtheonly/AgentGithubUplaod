/**
 * Drawer — right-side slide-over panel.
 *
 * Used for master-detail exploration: Parent detail, Student detail,
 * Expense detail, Personnel detail. Per plan §03.02, complex multi-step
 * actions use centered modals; profile/detail exploration uses slide-overs.
 *
 * Iteration 3: this primitive now shares the EXACT same visual language
 * as UnifiedModal variant="drawer" — same padding (p-5), same header
 * (border-b + pr-12 for the close button), same body, same footer, same
 * animations. This means every drawer in the application looks identical
 * to every modal, fulfilling the "all modals completely unified" rule.
 *
 * Built on Radix Dialog so we get focus trap, escape to close, and
 * accessibility for free. The dialog content is anchored to the right
 * edge and animates in via the `slide-in-right` keyframe.
 *
 * For NEW code, prefer <UnifiedModal variant="drawer"> directly. This
 * primitive remains for backward compatibility with existing drawer
 * call sites.
 */
import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "../ui/cn";

export const Drawer = DialogPrimitive.Root;
export const DrawerTrigger = DialogPrimitive.Trigger;
export const DrawerClose = DialogPrimitive.Close;
export const DrawerPortal = DialogPrimitive.Portal;

export const DrawerOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/60 backdrop-blur-sm",
      "data-[state=open]:animate-in data-[state=closed]:animate-out",
      "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
  />
));
DrawerOverlay.displayName = "DrawerOverlay";

export const DrawerContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    size?: "sm" | "md" | "lg";
  }
>(({ className, children, size = "md", ...props }, ref) => (
  <DrawerPortal>
    <DrawerOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed right-0 top-0 z-50 flex h-full flex-col border-l border-border bg-popover shadow-2xl",
        "data-[state=open]:animate-in data-[state=closed]:animate-out",
        "data-[state=open]:slide-in-right data-[state=closed]:slide-out-right",
        size === "sm" && "w-[400px]",
        size === "md" && "w-[560px]",
        size === "lg" && "w-[820px]",
        className,
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close
        className="absolute right-4 top-4 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent/10 hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        aria-label="Fermer"
      >
        <X className="h-4 w-4" />
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DrawerPortal>
));
DrawerContent.displayName = "DrawerContent";

// Match UnifiedModal header: p-5 + border-b + pr-12 (room for close button)
export function DrawerHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1 border-b border-border p-5 pr-12", className)} {...props} />;
}

// Match UnifiedModal body: p-5
export function DrawerBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex-1 overflow-y-auto p-5", className)} {...props} />;
}

// Match UnifiedModal footer: p-4 + border-t
export function DrawerFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex items-center justify-end gap-2 border-t border-border p-4", className)}
      {...props}
    />
  );
}

export const DrawerTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={cn("text-base font-semibold text-foreground", className)} {...props} />
));
DrawerTitle.displayName = "DrawerTitle";

export const DrawerDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn("text-sm text-muted-foreground leading-snug", className)} {...props} />
));
DrawerDescription.displayName = "DrawerDescription";
