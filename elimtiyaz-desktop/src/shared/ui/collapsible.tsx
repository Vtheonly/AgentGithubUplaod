import * as React from "react";
import * as CollapsiblePrimitive from "@radix-ui/react-collapsible";
import { cn } from "./cn";

/**
 * Collapsible — E6.7 (ROADMAP 5.8 / UI-U7a): the ONE shared expandable
 * primitive. Every hand-rolled `useState(open)` + `aria-expanded` +
 * `{open && …}` section collapses onto this (Radix owns the trigger
 * semantics: aria-expanded, aria-controls, data-state, keyboard toggling).
 *
 * Controlled accordion items pass `open` + `onOpenChange` (the parent keeps
 * the single-open key); uncontrolled sections mount bare and let the root
 * own the boolean. `CollapsibleContent` is unmounted when closed (the
 * same DOM shape the hand-rolled `{open && …}` blocks had) — pass
 * `forceMount` only for measure-needing surfaces.
 */
export const Collapsible = CollapsiblePrimitive.Root;

export const CollapsibleTrigger = React.forwardRef<
  React.ElementRef<typeof CollapsiblePrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof CollapsiblePrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <CollapsiblePrimitive.Trigger
    ref={ref}
    className={cn(className)}
    {...props}
  />
));
CollapsibleTrigger.displayName = "CollapsibleTrigger";

export const CollapsibleContent = React.forwardRef<
  React.ElementRef<typeof CollapsiblePrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof CollapsiblePrimitive.Content>
>(({ className, ...props }, ref) => (
  <CollapsiblePrimitive.Content
    ref={ref}
    className={cn(className)}
    {...props}
  />
));
CollapsibleContent.displayName = "CollapsibleContent";
