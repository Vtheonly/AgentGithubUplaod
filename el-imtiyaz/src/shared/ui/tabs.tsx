import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "./cn";

/**
 * Tabs — two variants:
 *
 *  - "underline" (DEFAULT) — tight, left-aligned cohesive group with a
 *    subtle bottom border that hugs the tab group (NOT full-width).
 *    Active trigger gets a 2px primary underline. Linear/Vercel style.
 *
 *  - "pill" — compact segmented control in a muted container.
 *    Use for sub-tabs inside modals and drawers.
 *
 * The variant is set on <TabsList variant="...">. Default is "underline".
 */
export const Tabs = TabsPrimitive.Root;

interface TabsListProps extends React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> {
  variant?: "underline" | "pill";
  /** Stretch the list to fill its container. Default: false (hugs content). */
  fullWidth?: boolean;
}

export const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  TabsListProps
>(({ className, variant = "underline", fullWidth = false, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      variant === "underline"
        ? cn(
            "inline-flex h-9 items-end gap-0 border-b border-border text-muted-foreground",
            fullWidth && "flex w-full",
          )
        : "inline-flex h-8 items-center gap-1 rounded-lg bg-muted p-1",
      className,
    )}
    {...props}
  />
));
TabsList.displayName = "TabsList";

interface TabsTriggerProps extends React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> {
  /** Optional count badge rendered to the right of the label. */
  count?: number;
  /** Show a dot indicator (for unread state) instead of a count. */
  dot?: boolean;
  /** Tone for the count badge — defaults to subtle. */
  countTone?: "default" | "primary" | "success" | "warning" | "danger";
}

export const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  TabsTriggerProps
>(({ className, children, count, dot, countTone = "default", ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "relative inline-flex items-center gap-1.5 whitespace-nowrap px-2.5 text-[13px] font-medium",
      "ring-offset-background transition-colors duration-150",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      "disabled:pointer-events-none disabled:opacity-40",
      // Baseline: padding-bottom leaves room for the underline
      "pb-2 pt-1.5",
      // Underline (transparent by default, primary when active)
      "after:absolute after:inset-x-0 after:bottom-[-1px] after:h-[2px] after:rounded-full",
      "after:bg-transparent after:transition-colors after:duration-150",
      "data-[state=active]:after:bg-primary",
      // Text color
      "text-muted-foreground hover:text-foreground",
      "data-[state=active]:text-foreground",
      className,
    )}
    {...props}
  >
    {children}
    {dot && (
      <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
    )}
    {count != null && count > 0 && (
      <CountBadge count={count} tone={countTone} />
    )}
  </TabsPrimitive.Trigger>
));
TabsTrigger.displayName = "TabsTrigger";

function CountBadge({ count, tone }: { count: number; tone: "default" | "primary" | "success" | "warning" | "danger" }) {
  const toneClass = {
    default: "bg-muted text-muted-foreground",
    primary: "bg-primary/15 text-primary",
    success: "bg-status-success/15 text-status-success",
    warning: "bg-status-warning/15 text-status-warning",
    danger: "bg-status-danger text-white",
  }[tone];
  return (
    <span
      className={cn(
        "inline-flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none",
        toneClass,
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

export const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-4 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      "data-[state=inactive]:hidden",
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = "TabsContent";
