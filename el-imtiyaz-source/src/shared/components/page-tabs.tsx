/**
 * PageTabs — modern, polished, reusable page-level tab navigation.
 *
 * Per iteration-3 spec: "The current page tabs are not satisfactory.
 * Redesign the tab navigation to look more modern, polished, and
 * professional. The tab system should have a consistent appearance
 * across every page, clearly indicate the active tab, improve spacing
 * and typography, feel visually integrated with the rest of the
 * application's design, be easy to scan and navigate, use a single
 * reusable component rather than multiple implementations, and follow
 * the same design language everywhere in the application."
 *
 * Design language:
 *   - "elevated" (DEFAULT) — segmented control with a filled pill background
 *     for the active tab. Modern, polished, scannable. Good for page-level
 *     navigation where tabs are co-equal peers.
 *
 *   - "underline" — minimal underline variant for dense layouts and sub-tabs
 *     inside modals/drawers.
 *
 *   - "rail" — vertical variant for left-rail settings pages.
 *
 * Every tab accepts: label, icon, count, dot, disabled, and an optional
 * description shown beneath the label (elevated variant only).
 *
 * Usage:
 *   <PageTabs value={tab} onValueChange={setTab}>
 *     <PageTab value="parents" label="Parents" icon={Users} count={12} />
 *     <PageTab value="students" label="Élèves" icon={GraduationCap} />
 *   </PageTabs>
 *   <PageTabContent value="parents">…</PageTabContent>
 *
 * Or use the compound form:
 *   <PageTabs defaultValue="parents">
 *     <PageTabList>
 *       <PageTab value="parents" label="Parents" icon={Users} />
 *     </PageTabList>
 *     <PageTabContent value="parents">…</PageTabContent>
 *   </PageTabs>
 */
import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "../ui/cn";
import type { LucideIcon } from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type PageTabsVariant = "elevated" | "underline" | "rail";
type CountTone = "default" | "primary" | "success" | "warning" | "danger";

export interface PageTabsProps extends React.ComponentPropsWithoutRef<typeof TabsPrimitive.Root> {
  variant?: PageTabsVariant;
  /** Stretch the tab list to fill its container. Default: false. */
  fullWidth?: boolean;
}

export interface PageTabListProps extends React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> {
  variant?: PageTabsVariant;
  fullWidth?: boolean;
  /**
   * Iteration 6: When true, the tab list scrolls horizontally instead of
   * overflowing its container. Useful for hubs with many tabs (e.g. Settings
   * with 7 tabs) or for narrow viewports. Default: false (preserves the
   * desktop segmented-control look).
   */
  scrollable?: boolean;
}

export interface PageTabProps extends React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> {
  label: React.ReactNode;
  icon?: LucideIcon;
  /** Optional count badge rendered to the right of the label. */
  count?: number;
  /** Show a dot indicator (for unread state) instead of a count. */
  dot?: boolean;
  /** Tone for the count badge — defaults to subtle. */
  countTone?: CountTone;
  /** Optional description shown beneath the label (elevated variant only). */
  description?: string;
  /** Disable the tab. */
  disabled?: boolean;
}

export interface PageTabContentProps extends React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content> {
  /** Override default content padding/spacing. */
  className?: string;
  /**
   * Make the content area scroll vertically when it overflows. Default: true.
   *
   * Iteration 4: this prop replaces the ~9 redundant
   * `className="flex-1 overflow-y-auto mt-4"` overrides that existed across
   * every call site before this iteration. Call sites can now write
   * `<PageTabContent value="x">` (scrollable by default) or
   * `<PageTabContent value="x" scrollable={false}>` to opt out.
   */
  scrollable?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Root                                                               */
/* ------------------------------------------------------------------ */

/**
 * Compound form — use this when you want to manage tabs declaratively:
 *
 *   <PageTabs defaultValue="parents" variant="elevated">
 *     <PageTabList>
 *       <PageTab value="parents" label="Parents" icon={Users} />
 *     </PageTabList>
 *     <PageTabContent value="parents">…</PageTabContent>
 *   </PageTabs>
 *
 * For controlled usage:
 *   <PageTabs value={tab} onValueChange={setTab} variant="elevated">
 */
export const PageTabs = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Root>,
  PageTabsProps
>(({ variant = "elevated", className, children, ...props }, ref) => {
  // Pass the variant down via context so PageTabList / PageTab can read it
  // without each page having to thread the prop manually.
  return (
    <TabsPrimitive.Root
      ref={ref}
      className={cn(
        variant === "rail" ? "flex flex-row gap-6" : "flex flex-col",
        className,
      )}
      {...props}
    >
      <VariantContext.Provider value={variant}>{children}</VariantContext.Provider>
    </TabsPrimitive.Root>
  );
});
PageTabs.displayName = "PageTabs";

const VariantContext = React.createContext<PageTabsVariant>("elevated");

/* ------------------------------------------------------------------ */
/*  List                                                               */
/* ------------------------------------------------------------------ */

export const PageTabList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  PageTabListProps
>(({ className, variant, fullWidth = false, scrollable = false, ...props }, ref) => {
  const ctxVariant = React.useContext(VariantContext);
  const v = variant ?? ctxVariant;

  // Iteration 6: scrollable lists use `flex` (instead of `inline-flex`) +
  // `overflow-x-auto` + hidden scrollbars so the segmented control can
  // scroll horizontally on narrow viewports without ugly scrollbars.
  const scrollClass = scrollable
    ? "flex overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    : "";

  const baseClass =
    v === "elevated"
      ? cn(
          "inline-flex items-center gap-1 rounded-xl bg-muted/50 p-1 ring-1 ring-inset ring-border/60",
          fullWidth && "flex w-full",
          scrollClass,
        )
      : v === "rail"
        ? cn(
            "inline-flex flex-col items-stretch gap-1 w-[200px] shrink-0",
            fullWidth && "w-full",
          )
        : cn(
            "inline-flex h-10 items-end gap-0 border-b border-border text-muted-foreground",
            fullWidth && "flex w-full",
            scrollClass,
          );

  return (
    <TabsPrimitive.List
      ref={ref}
      className={cn(baseClass, className)}
      {...props}
    />
  );
});
PageTabList.displayName = "PageTabList";

/* ------------------------------------------------------------------ */
/*  Trigger                                                            */
/* ------------------------------------------------------------------ */

export const PageTab = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  PageTabProps
>(
  (
    { label, icon: Icon, count, dot, countTone = "default", description, disabled, className, ...props },
    ref,
  ) => {
    const v = React.useContext(VariantContext);

    const elevatedClass = cn(
      "relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg px-3.5 h-8",
      "text-[13px] font-medium leading-none",
      "ring-offset-background transition-all duration-200",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      "disabled:pointer-events-none disabled:opacity-40",
      // Baseline muted text + subtle hover background (iter 6 polish).
      "text-muted-foreground hover:text-foreground hover:bg-accent/40",
      // Active state: filled pill + primary text + subtle shadow
      "data-[state=active]:bg-popover data-[state=active]:text-foreground",
      "data-[state=active]:shadow-sm data-[state=active]:ring-1 data-[state=active]:ring-border/50",
      "data-[state=active]:hover:bg-popover",
    );

    const underlineClass = cn(
      "relative inline-flex items-center gap-1.5 whitespace-nowrap px-3 pb-2 pt-1.5",
      "text-[13px] font-medium leading-none",
      "ring-offset-background transition-colors duration-150",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      "disabled:pointer-events-none disabled:opacity-40",
      // Underline (transparent by default, primary when active)
      "after:absolute after:inset-x-0 after:bottom-[-1px] after:h-[2px] after:rounded-full",
      "after:bg-transparent after:transition-colors after:duration-150",
      "after:data-[state=active]:bg-primary",
      // Text color + subtle hover background (iter 6 polish).
      "text-muted-foreground hover:text-foreground hover:bg-accent/30",
      "data-[state=active]:text-foreground data-[state=active]:font-semibold",
    );

    const railClass = cn(
      "relative inline-flex items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-left",
      "text-[13px] font-medium leading-tight",
      "ring-offset-background transition-all duration-200",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      "disabled:pointer-events-none disabled:opacity-40",
      "text-muted-foreground hover:text-foreground hover:bg-accent/5",
      "data-[state=active]:bg-primary/10 data-[state=active]:text-primary",
      "data-[state=active]:ring-1 data-[state=active]:ring-primary/20",
    );

    const cls = v === "elevated" ? elevatedClass : v === "rail" ? railClass : underlineClass;

    return (
      <TabsPrimitive.Trigger
        ref={ref}
        disabled={disabled}
        className={cn(cls, className)}
        {...props}
      >
        {Icon && <Icon className={cn("shrink-0", v === "elevated" ? "h-3.5 w-3.5" : "h-4 w-4")} />}
        <span className="flex flex-col items-start leading-tight">
          <span className="flex items-center gap-1.5">
            <span>{label}</span>
            {dot && (
              <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
            )}
            {count != null && count > 0 && (
              <CountBadge count={count} tone={countTone} />
            )}
          </span>
          {description && v === "elevated" && (
            <span className="text-[10px] font-normal text-muted-foreground/80 mt-0.5">
              {description}
            </span>
          )}
        </span>
      </TabsPrimitive.Trigger>
    );
  },
);
PageTab.displayName = "PageTab";

/* ------------------------------------------------------------------ */
/*  Content                                                            */
/* ------------------------------------------------------------------ */

export const PageTabContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  PageTabContentProps
>(({ className, scrollable = true, ...props }, ref) => {
  const v = React.useContext(VariantContext);
  return (
    <TabsPrimitive.Content
      ref={ref}
      className={cn(
        v === "rail" ? "flex-1 mt-0 min-h-0" : "flex-1 mt-4 min-h-0",
        scrollable && "overflow-y-auto",
        "ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "data-[state=inactive]:hidden",
        className,
      )}
      {...props}
    />
  );
});
PageTabContent.displayName = "PageTabContent";

/* ------------------------------------------------------------------ */
/*  Count badge                                                        */
/* ------------------------------------------------------------------ */

function CountBadge({ count, tone }: { count: number; tone: CountTone }) {
  const toneClass: Record<CountTone, string> = {
    default: "bg-muted text-muted-foreground",
    primary: "bg-primary/15 text-primary",
    success: "bg-status-success/15 text-status-success",
    warning: "bg-status-warning/15 text-status-warning",
    danger: "bg-status-danger text-white",
  };
  return (
    <span
      className={cn(
        "inline-flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none",
        toneClass[tone],
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Convenience: PageTabsBar (single-line use without children)        */
/* ------------------------------------------------------------------ */

/**
 * Compact helper for simple cases — pass an array of tab descriptors.
 *
 *   <PageTabsBar
 *     value={tab} onValueChange={setTab}
 *     tabs={[
 *       { value: "a", label: "Alpha", icon: A, count: 3 },
 *       { value: "b", label: "Beta" },
 *     ]}
 *   />
 */
export function PageTabsBar({
  value,
  defaultValue,
  onValueChange,
  tabs,
  variant = "elevated",
  fullWidth = false,
  className,
}: {
  value?: string;
  defaultValue?: string;
  onValueChange?: (v: string) => void;
  tabs: Array<{
    value: string;
    label: React.ReactNode;
    icon?: LucideIcon;
    count?: number;
    dot?: boolean;
    countTone?: CountTone;
    description?: string;
    disabled?: boolean;
  }>;
  variant?: PageTabsVariant;
  fullWidth?: boolean;
  className?: string;
}) {
  return (
    <PageTabs value={value} defaultValue={defaultValue} onValueChange={onValueChange} variant={variant}>
      <PageTabList fullWidth={fullWidth} className={className}>
        {tabs.map((t) => (
          <PageTab key={t.value} {...t} />
        ))}
      </PageTabList>
    </PageTabs>
  );
}
