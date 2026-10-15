import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "./cn";

export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

/**
 * TooltipContent — T-546 (UI-353) contract:
 * - NO internal clipping: the former `overflow-hidden` truncated long
 *   explainability bodies (multi-paragraph glossary entries, formula
 *   blocks) at the rounded corners. Content now sizes naturally; authors
 *   keep `max-w-*` on their own usage.
 * - collisionPadding={8}: viewport-edge triggers keep an 8px margin —
 *   radix flips the side automatically (avoidCollisions default) and the
 *   padding stops the flipped surface from kissing the edge.
 * - z-[70]: one layer ABOVE the modal surface (unified-modal is z-50) —
 *   tooltips opened inside modals (the see-details drill-downs, the
 *   payment dialogs) always paint on top.
 */
export const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, collisionPadding = 8, ...props }, ref) => (
  <TooltipPrimitive.Content
    ref={ref}
    sideOffset={sideOffset}
    collisionPadding={collisionPadding}
    className={cn(
      "z-[70] rounded-md border border-border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md",
      "animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
      className,
    )}
    {...props}
  />
));
TooltipContent.displayName = "TooltipContent";
