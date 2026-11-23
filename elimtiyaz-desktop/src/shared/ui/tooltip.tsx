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
 * - z-tooltip (E6.1/UI-U1): one layer ABOVE the modal surface
 *   (unified-modal is z-50) — tooltips opened inside modals (the
 *   see-details drill-downs, the payment dialogs) always paint on top.
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
      "z-tooltip rounded-md border border-border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md",
      "animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
      className,
    )}
    {...props}
  />
));
TooltipContent.displayName = "TooltipContent";

/**
 * TooltipHint — E6.5 (UI-U5 / DUP-026): the ONE replacement for native
 * HTML `title=` attributes (browser tooltips). Native titles render with a
 * ~1 s OS delay, no theming, no touch support and no escape hatch inside
 * modals — every native site now renders through the shared Radix Tooltip.
 *
 * The empty contract mirrors the native attribute: `content` that is
 * null/undefined/"" renders the child bare (a native `title={undefined}`
 * showed nothing; so does the hint). Each hint carries its OWN provider
 * (§15.79: radix throws without one — nesting is safe, so this works both
 * inside and outside the app-shell provider).
 *
 * Composability: the hint FORWARDS unknown props + ref onto its child
 * (cloneElement), so a hint mounted as the child of another `asChild`
 * Slot (DropdownMenuTrigger asChild, TooltipTrigger asChild, …) keeps the
 * outer trigger semantics — the outer Slot clones the hint, the hint
 * re-clones the DOM child, and the inner TooltipTrigger Slot composes its
 * hover/focus handlers on top (Radix Slots merge handlers and refs).
 */
export interface TooltipHintProps {
  /** The hint text (or node). Empty/null content renders the child unwrapped. */
  content?: React.ReactNode;
  /** The hover target — a single element (props/ref are forwarded onto it). */
  children: React.ReactElement;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  /** Hover delay in ms (native titles were ~1000; we default lighter). */
  delayDuration?: number;
  /** Extra classes for the content surface (e.g. max-w-*). */
  contentClassName?: string;
}

export const TooltipHint = React.forwardRef<
  HTMLElement,
  TooltipHintProps & Omit<React.HTMLAttributes<HTMLElement>, keyof TooltipHintProps>
>(function TooltipHint(
  { content, children, side = "top", align = "center", delayDuration = 350, contentClassName, ...rest },
  ref,
) {
  const child = React.cloneElement(children, { ref, ...rest });
  if (content === null || content === undefined || content === "") return child;
  return (
    <TooltipProvider delayDuration={delayDuration}>
      <Tooltip>
        <TooltipTrigger asChild>{child}</TooltipTrigger>
        <TooltipContent side={side} align={align} className={contentClassName}>
          {content}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
});
TooltipHint.displayName = "TooltipHint";
