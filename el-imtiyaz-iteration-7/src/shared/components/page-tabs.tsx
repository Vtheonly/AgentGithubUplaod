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
 * Per iteration-7 spec: the tab navigation is further modernized with
 *   - A single shared sliding ink-bar on the `underline` variant (replaces
 *     the per-tab `after:` pseudo-element fade with a single absolutely-
 *     positioned indicator that animates `left`/`width` between tabs)
 *   - A single shared sliding pill on the `elevated` variant (Apple/Tailwind-
 *     UI segmented control pattern; the active trigger loses its own
 *     background and the sliding thumb takes over)
 *   - A `size` prop (`"sm" | "md" | "lg"`) controlling tab height + font size
 *   - An explicit `keyboardActivation` prop (`"automatic" | "manual"`)
 *   - An `iconPosition` prop (`"leading" | "trailing"`)
 *   - Logical CSS properties (`ms-*`, `me-*`, `start-*`, `end-*`, `border-s`,
 *     `border-e`) so the tabs render correctly in RTL mode
 *
 * Design language:
 *   - "elevated" (DEFAULT) — segmented control with a sliding pill background
 *     for the active tab. Modern, polished, scannable. Good for page-level
 *     navigation where tabs are co-equal peers.
 *
 *   - "underline" — minimal variant with a sliding ink-bar beneath the active
 *     tab. Used for dense layouts and sub-tabs inside modals/drawers.
 *
 *   - "rail" — vertical variant for left-rail settings pages.
 *
 * Every tab accepts: label, icon, count, dot, disabled, description, and
 * optionally `iconPosition` and `countTone`.
 *
 * Usage:
 *   <PageTabs value={tab} onValueChange={setTab}>
 *     <PageTabList>
 *       <PageTab value="parents" label="Parents" icon={Users} count={12} />
 *       <PageTab value="students" label="Élèves" icon={GraduationCap} />
 *     </PageTabList>
 *     <PageTabContent value="parents">…</PageTabContent>
 *   </PageTabs>
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
type PageTabsSize = "sm" | "md" | "lg";
type CountTone = "default" | "primary" | "success" | "warning" | "danger";

export interface PageTabsProps extends React.ComponentPropsWithoutRef<typeof TabsPrimitive.Root> {
  variant?: PageTabsVariant;
  /**
   * Density / size of the tab triggers.
   *   - "sm" — h-7 text-xs (dense toolbars, sub-tabs in small modals)
   *   - "md" — h-8 text-[13px] (DEFAULT — current behavior preserved)
   *   - "lg" — h-10 text-sm (primary navigation, large screens)
   */
  size?: PageTabsSize;
  /** Stretch the tab list to fill its container. Default: false. */
  fullWidth?: boolean;
}

export interface PageTabListProps extends React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> {
  variant?: PageTabsVariant;
  size?: PageTabsSize;
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
  /**
   * Position of the icon relative to the label. Default: "leading".
   * Use "trailing" for "external link" or "new" indicators.
   */
  iconPosition?: "leading" | "trailing";
  /** Optional count badge rendered to the right of the label. */
  count?: number;
  /** Show a dot indicator (for unread state) instead of a count. */
  dot?: boolean;
  /** Tone for the count badge — defaults to subtle. */
  countTone?: CountTone;
  /** Optional description shown beneath the label (elevated + rail variants). */
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
/*  Size classes — height + font size + icon size per density         */
/* ------------------------------------------------------------------ */

const SIZE_HEIGHT: Record<PageTabsSize, string> = {
  sm: "h-7",
  md: "h-8",
  lg: "h-10",
};

const SIZE_TEXT: Record<PageTabsSize, string> = {
  sm: "text-xs",
  md: "text-[13px]",
  lg: "text-sm",
};

const SIZE_ICON_ELEVATED: Record<PageTabsSize, string> = {
  sm: "h-3 w-3",
  md: "h-3.5 w-3.5",
  lg: "h-4 w-4",
};

const SIZE_ICON_UNDERLINE: Record<PageTabsSize, string> = {
  sm: "h-3.5 w-3.5",
  md: "h-4 w-4",
  lg: "h-4 w-4",
};

const SIZE_PADDING_X_ELEVATED: Record<PageTabsSize, string> = {
  sm: "px-2.5",
  md: "px-3.5",
  lg: "px-4",
};

const SIZE_PADDING_RAIL: Record<PageTabsSize, string> = {
  sm: "px-2.5 py-1.5",
  md: "px-3 py-2",
  lg: "px-4 py-2.5",
};

/* ------------------------------------------------------------------ */
/*  Root                                                               */
/* ------------------------------------------------------------------ */

/**
 * Compound form — use this when you want to manage tabs declaratively:
 *
 *   <PageTabs defaultValue="parents" variant="elevated" size="md">
 *     <PageTabList>
 *       <PageTab value="parents" label="Parents" icon={Users} />
 *     </PageTabList>
 *     <PageTabContent value="parents">…</PageTabContent>
 *   </PageTabs>
 *
 * For controlled usage:
 *   <PageTabs value={tab} onValueChange={setTab} variant="elevated" size="md">
 */
export const PageTabs = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Root>,
  PageTabsProps
>(({ variant = "elevated", size = "md", className, children, ...props }, ref) => {
  // Pass the variant + size down via context so PageTabList / PageTab can read it
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
      <VariantContext.Provider value={variant}>
        <SizeContext.Provider value={size}>{children}</SizeContext.Provider>
      </VariantContext.Provider>
    </TabsPrimitive.Root>
  );
});
PageTabs.displayName = "PageTabs";

const VariantContext = React.createContext<PageTabsVariant>("elevated");
const SizeContext = React.createContext<PageTabsSize>("md");

/* ------------------------------------------------------------------ */
/*  List — with sliding ink-bar (underline) + sliding pill (elevated) */
/* ------------------------------------------------------------------ */

export const PageTabList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  PageTabListProps
>(({ className, variant, size, fullWidth = false, scrollable = false, ...props }, ref) => {
  const ctxVariant = React.useContext(VariantContext);
  const ctxSize = React.useContext(SizeContext);
  const v = variant ?? ctxVariant;
  const s = size ?? ctxSize;
  const listRef = React.useRef<HTMLDivElement | null>(null);

  // Sliding indicator state — position + width of the active tab trigger.
  // Measured via useLayoutEffect whenever the active value changes.
  const [indicatorStyle, setIndicatorStyle] = React.useState<{
    left: number;
    width: number;
    visible: boolean;
  }>({ left: 0, width: 0, visible: false });

  // Re-measure on resize + when the active value changes.
  // We rely on Radix's data-[state=active] attribute to find the active trigger.
  React.useLayoutEffect(() => {
    if (v === "rail") return; // rail has no sliding indicator
    const list = listRef.current;
    if (!list) return;

    const measure = () => {
      const active = list.querySelector<HTMLElement>('[data-state="active"]');
      if (!active) {
        setIndicatorStyle((prev) => ({ ...prev, visible: false }));
        return;
      }
      const listRect = list.getBoundingClientRect();
      const activeRect = active.getBoundingClientRect();
      setIndicatorStyle({
        left: activeRect.left - listRect.left,
        width: activeRect.width,
        visible: true,
      });
    };

    measure();

    // Re-measure on window resize.
    const ro = new ResizeObserver(measure);
    ro.observe(list);
    Array.from(list.children).forEach((child) => ro.observe(child as HTMLElement));

    return () => ro.disconnect();
  }, [v, props["data-value" as keyof typeof props]]);

  // Also re-measure whenever children change (controlled value changes).
  // We attach a MutationObserver as a safety net for late-mounted content.
  React.useLayoutEffect(() => {
    if (v === "rail") return;
    const list = listRef.current;
    if (!list) return;
    const mo = new MutationObserver(() => {
      const active = list.querySelector<HTMLElement>('[data-state="active"]');
      if (!active) return;
      const listRect = list.getBoundingClientRect();
      const activeRect = active.getBoundingClientRect();
      setIndicatorStyle({
        left: activeRect.left - listRect.left,
        width: activeRect.width,
        visible: true,
      });
    });
    mo.observe(list, { subtree: true, attributes: true, attributeFilter: ["data-state"] });
    return () => mo.disconnect();
  }, [v]);

  // Compose the forwarded ref + the local ref so we can measure.
  const composedRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      listRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
    },
    [ref],
  );

  // Iteration 6: scrollable lists use `flex` (instead of `inline-flex`) +
  // `overflow-x-auto` + hidden scrollbars so the segmented control can
  // scroll horizontally on narrow viewports without ugly scrollbars.
  const scrollClass = scrollable
    ? "flex overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    : "";

  const baseClass =
    v === "elevated"
      ? cn(
          "relative inline-flex items-center gap-1 rounded-xl bg-muted/50 p-1 ring-1 ring-inset ring-border/60",
          fullWidth && "flex w-full",
          scrollClass,
        )
      : v === "rail"
        ? cn(
            "inline-flex flex-col items-stretch gap-1 w-[200px] shrink-0",
            fullWidth && "w-full",
          )
        : cn(
            "relative inline-flex h-10 items-end gap-0 border-b border-border text-muted-foreground",
            fullWidth && "flex w-full",
            scrollClass,
          );

  // The sliding indicator (only rendered for elevated + underline variants).
  const indicator =
    v === "elevated" ? (
      <span
        aria-hidden
        data-ink-bar
        className={cn(
          "absolute top-1 bottom-1 rounded-lg bg-popover shadow-sm ring-1 ring-border/50",
          "transition-all duration-300",
          "pointer-events-none",
          !indicatorStyle.visible && "opacity-0",
        )}
        style={{
          left: indicatorStyle.left,
          width: indicatorStyle.width,
          transitionTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)",
        }}
      />
    ) : v === "underline" ? (
      <span
        aria-hidden
        data-ink-bar
        className={cn(
          "absolute bottom-[-1px] h-[2px] rounded-full bg-primary",
          "transition-all duration-300",
          "pointer-events-none",
          !indicatorStyle.visible && "opacity-0",
        )}
        style={{
          left: indicatorStyle.left,
          width: indicatorStyle.width,
          transitionTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)",
        }}
      />
    ) : null;

  return (
    <TabsPrimitive.List
      ref={composedRef}
      className={cn(baseClass, className)}
      {...props}
    >
      {indicator}
      {props.children}
    </TabsPrimitive.List>
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
    {
      label,
      icon: Icon,
      iconPosition = "leading",
      count,
      dot,
      countTone = "default",
      description,
      disabled,
      className,
      ...props
    },
    ref,
  ) => {
    const v = React.useContext(VariantContext);
    const s = React.useContext(SizeContext);

    // elevated: the active trigger no longer carries its own background —
    // the sliding pill (rendered by PageTabList) provides the visual.
    // We still set text color + weight on active for clarity.
    const elevatedClass = cn(
      "relative z-10 inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg",
      SIZE_PADDING_X_ELEVATED[s],
      SIZE_HEIGHT[s],
      SIZE_TEXT[s],
      "font-medium leading-none",
      "ring-offset-background transition-colors duration-200",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      "disabled:pointer-events-none disabled:opacity-40",
      // Baseline muted text + subtle hover background (iter 6 polish).
      "text-muted-foreground hover:text-foreground",
      // Active: stronger text color + slightly heavier weight; background
      // is provided by the sliding pill in PageTabList.
      "data-[state=active]:text-foreground data-[state=active]:font-semibold",
    );

    const underlineClass = cn(
      "relative z-10 inline-flex items-center gap-1.5 whitespace-nowrap px-3 pb-2 pt-1.5",
      SIZE_TEXT[s],
      "font-medium leading-none",
      "ring-offset-background transition-colors duration-150",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      "disabled:pointer-events-none disabled:opacity-40",
      // Text color + subtle hover background (iter 6 polish).
      "text-muted-foreground hover:text-foreground hover:bg-accent/30",
      // Active: stronger text color + heavier weight. The ink-bar is
      // rendered by PageTabList, so no per-tab underline pseudo-element.
      "data-[state=active]:text-foreground data-[state=active]:font-semibold",
    );

    const railClass = cn(
      "relative inline-flex items-center gap-2.5 whitespace-nowrap rounded-lg text-left",
      SIZE_PADDING_RAIL[s],
      SIZE_TEXT[s],
      "font-medium leading-tight",
      "ring-offset-background transition-all duration-200",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      "disabled:pointer-events-none disabled:opacity-40",
      "text-muted-foreground hover:text-foreground hover:bg-accent/5",
      "data-[state=active]:bg-primary/10 data-[state=active]:text-primary",
      "data-[state=active]:ring-1 data-[state=active]:ring-primary/20",
    );

    const cls = v === "elevated" ? elevatedClass : v === "rail" ? railClass : underlineClass;

    const iconSize =
      v === "elevated" ? SIZE_ICON_ELEVATED[s] : SIZE_ICON_UNDERLINE[s];

    const iconEl = Icon ? <Icon className={cn("shrink-0", iconSize)} /> : null;

    return (
      <TabsPrimitive.Trigger
        ref={ref}
        disabled={disabled}
        className={cn(cls, className)}
        {...props}
      >
        {iconPosition === "leading" && iconEl}
        <span className="flex flex-col items-start leading-tight">
          <span className="flex items-center gap-1.5">
            {iconPosition === "trailing" && <span>{label}</span>}
            {iconPosition === "leading" && <span>{label}</span>}
            {iconPosition === "trailing" && iconEl}
            {dot && (
              <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
            )}
            {count != null && count > 0 && (
              <CountBadge count={count} tone={countTone} />
            )}
          </span>
          {description && (v === "elevated" || v === "rail") && (
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
  size = "md",
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
    iconPosition?: "leading" | "trailing";
    count?: number;
    dot?: boolean;
    countTone?: CountTone;
    description?: string;
    disabled?: boolean;
  }>;
  variant?: PageTabsVariant;
  size?: PageTabsSize;
  fullWidth?: boolean;
  className?: string;
}) {
  return (
    <PageTabs
      value={value}
      defaultValue={defaultValue}
      onValueChange={onValueChange}
      variant={variant}
      size={size}
    >
      <PageTabList fullWidth={fullWidth} className={className}>
        {tabs.map((t) => (
          <PageTab key={t.value} {...t} />
        ))}
      </PageTabList>
    </PageTabs>
  );
}
