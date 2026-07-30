/**
 * UnifiedModal — single source of truth for ALL modal-style interactions.
 *
 * Per the iteration-3 spec: "all modals throughout the application must be
 * completely unified — same layout, header, footer, spacing, typography,
 * button placement, form styling, validation behavior, animations, close
 * behavior, loading states, error presentation, and success handling."
 *
 * Per the iteration-7 spec: the previous single documented exception (the
 * Cmd+K command palette in topbar.tsx) is eliminated by the new
 * `variant="command-palette"` mode. Zero raw `<Dialog>` call sites remain
 * in production code.
 *
 * This primitive supports THREE visual variants that share the same skeleton:
 *
 *   - variant="dialog"           (default) — centered overlay, used for create/edit
 *   - variant="drawer"           — right-side slide-over, used for detail exploration
 *   - variant="command-palette"  — top-anchored overlay, used for Cmd+K search
 *                                  palettes; no default header, no default close
 *                                  button, custom header slot, p-0 body
 *
 * All variants share:
 *   - Identical overlay (radial blur, fade-in/out animation)
 *   - Identical ESC + backdrop click close behavior (configurable)
 *   - Identical loading / locked / alert semantics
 *   - Identical sub-component exports (UnifiedModalHeader/Body/Footer/Alert)
 *
 * dialog + drawer additionally share:
 *   - Identical header (icon + title + description + close button)
 *   - Identical body (scrollable, consistent padding, optional error alert)
 *   - Identical footer (auto-built cancel + submit, or custom)
 *   - Identical confirmation pattern (2-click for destructive actions)
 *
 * command-palette uses:
 *   - A custom `header` slot (search input, filter chips, etc.)
 *   - `bodyClassName="p-0"` for a flush results list
 *   - `hideFooter` (typically) — palettes have no footer
 *   - `hideCloseButton` — palettes rely on ESC + backdrop
 *   - `hideHeader` if the caller wants to render the entire chrome themselves
 *
 * Usage — centered form modal:
 *   <UnifiedModal
 *     open={open} onOpenChange={setOpen}
 *     title="Nouvelle dépense" description="Sera soumise pour approbation"
 *     submitLabel="Soumettre" onSubmit={async () => …}
 *     size="md" icon={Send}>
 *     <FormField …/>
 *   </UnifiedModal>
 *
 * Usage — slide-over detail drawer:
 *   <UnifiedModal variant="drawer" size="lg"
 *     open={open} onOpenChange={setOpen}
 *     title={parent.name} description={parent.code}>
 *     <DetailSections …/>
 *   </UnifiedModal>
 *
 * Usage — command palette (Cmd+K):
 *   <UnifiedModal
 *     open={open} onOpenChange={setOpen}
 *     variant="command-palette"
 *     size="lg"
 *     title={<span className="sr-only">Search</span>}
 *     header={<SearchInput …/>}
 *     bodyClassName="p-0"
 *     hideFooter
 *     hideCloseButton
 *   >
 *     <SearchResults …/>
 *   </UnifiedModal>
 *
 * Usage — display-only modal (no footer):
 *   <UnifiedModal open={open} onOpenChange={setOpen}
 *     title="Détails" hideFooter>
 *     <Content/>
 *   </UnifiedModal>
 *
 * Usage — custom footer:
 *   <UnifiedModal open={open} onOpenChange={setOpen} title="…"
 *     footer={<CustomButtons/>}>
 *     <Content/>
 *   </UnifiedModal>
 */
import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  X, Loader2, CheckCircle2, AlertTriangle, AlertCircle, type LucideIcon,
} from "lucide-react";
import { cn } from "../ui/cn";
import { Button } from "../ui/button";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type ModalVariant = "dialog" | "drawer" | "command-palette";
type ModalSize = "sm" | "md" | "lg" | "xl" | "full";
type DrawerSize = "sm" | "md" | "lg";
type SubmitVariant = "default" | "destructive" | "success";
type AlertTone = "error" | "warning" | "info";

export interface UnifiedModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;

  /**
   * Centered dialog (default), right-side slide-over drawer, or top-anchored
   * command palette. All three share the same overlay, animations, and
   * close behavior. dialog + drawer additionally share the same header /
   * footer chrome; command-palette uses a custom `header` slot and p-0 body.
   */
  variant?: ModalVariant;

  /** Width sizing. Drawers use only sm/md/lg; xl/full fall back to lg. */
  size?: ModalSize;

  /**
   * Title — rendered inside the default header (dialog + drawer variants).
   * For command-palette, pass a `<span className="sr-only">…</span>` to
   * preserve accessibility (Radix Dialog requires a Title for screen readers)
   * while keeping the visual chrome empty.
   */
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: LucideIcon;
  iconTone?: "primary" | "success" | "warning" | "danger" | "neutral";
  badge?: React.ReactNode;

  /**
   * Custom header slot — replaces the default icon+title+description block.
   * Use this for the command-palette variant (e.g. to embed a search input
   * directly in the header). When provided, `title` is rendered as a
   * visually-hidden Radix Dialog.Title for accessibility.
   */
  header?: React.ReactNode;
  /** Suppress the default header entirely (no icon, no title, no description). */
  hideHeader?: boolean;
  /** Suppress the absolute-positioned close (X) button. */
  hideCloseButton?: boolean;

  /** Body content. */
  children?: React.ReactNode;

  /** Inline alert shown at the top of the body. */
  alert?: { tone: AlertTone; title: string; description?: string } | null;
  onDismissAlert?: () => void;

  /** Auto-built footer. Provide EITHER (submitLabel + onSubmit) OR footer. */
  submitLabel?: React.ReactNode;
  cancelLabel?: React.ReactNode;
  onSubmit?: () => void | Promise<void>;
  submitVariant?: SubmitVariant;
  submitIcon?: LucideIcon;
  submitDisabled?: boolean;
  submitLoading?: boolean;
  hideSubmit?: boolean;
  hideCancel?: boolean;
  hideFooter?: boolean;

  /** Custom footer (overrides auto-built). */
  footer?: React.ReactNode;

  /** Left-side custom footer content (rendered before cancel/submit). */
  footerLeading?: React.ReactNode;

  /** Behavior. */
  closeOnBackdropClick?: boolean;
  closeOnEscape?: boolean;

  /** When true, modal cannot be dismissed by any means except explicit onOpenChange(false). */
  locked?: boolean;

  /** Override body padding. Default: p-5 space-y-4. */
  bodyClassName?: string;
  headerClassName?: string;
  footerClassName?: string;
  contentClassName?: string;
}

/* ------------------------------------------------------------------ */
/*  Internal helpers                                                   */
/* ------------------------------------------------------------------ */

const DIALOG_SIZE_CLASS: Record<ModalSize, string> = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
  full: "max-w-[95vw] h-[90vh]",
};

const DRAWER_SIZE_CLASS: Record<DrawerSize, string> = {
  sm: "w-[400px]",
  md: "w-[560px]",
  lg: "w-[820px]",
};

/**
 * Command-palette sizing — palettes are wider than dialogs because they
 * present rich result lists with icons + subtitles. They sit at the
 * top of the viewport (top-[15vh]) instead of vertically centered.
 */
const COMMAND_PALETTE_SIZE_CLASS: Record<ModalSize, string> = {
  sm: "max-w-md",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
  full: "max-w-[95vw]",
};

const ICON_TONE_CLASS: Record<NonNullable<UnifiedModalProps["iconTone"]>, string> = {
  primary: "bg-primary/10 text-primary",
  success: "bg-status-success/15 text-status-success",
  warning: "bg-status-warning/15 text-status-warning",
  danger: "bg-status-danger/15 text-status-danger",
  neutral: "bg-muted text-muted-foreground",
};

function mapSizeForDrawer(size?: ModalSize): DrawerSize {
  if (size === "sm") return "sm";
  if (size === "md") return "md";
  return "lg";
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

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
  const drawerSize = mapSizeForDrawer(size);

  // Internal loading state — also reflects external submitLoading prop.
  const [internalLoading, setInternalLoading] = React.useState(false);
  const loading = internalLoading || submitLoading;

  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      if (locked && !next) return; // locked modals cannot be dismissed
      if (!next && loading) return; // ignore dismiss while loading
      onOpenChange(next);
    },
    [locked, loading, onOpenChange],
  );

  const handleInteractOutside = React.useCallback(
    (e: Event) => {
      if (!closeOnBackdropClick || locked || loading) {
        e.preventDefault();
      }
    },
    [closeOnBackdropClick, locked, loading],
  );

  const handleEscapeKeyDown = React.useCallback(
    (e: KeyboardEvent) => {
      if (!closeOnEscape || locked || loading) {
        e.preventDefault();
      }
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

  /* ----------------------- Header ----------------------- */
  // command-palette: use the custom header slot if provided, otherwise render
  // a visually-hidden Title for accessibility (Radix Dialog requires a Title).
  // dialog + drawer: use the default UnifiedModalHeader unless `hideHeader`.
  const showDefaultHeader = !hideHeader && !headerSlot;
  const headerNode = isCommandPalette ? (
    headerSlot ? (
      <div className={cn("border-b border-border", headerClassName)}>
        {/* Radix Dialog.Title must exist for a11y — render visually-hidden */}
        <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
        {headerSlot}
      </div>
    ) : !hideHeader ? (
      <div className={cn("border-b border-border p-4", headerClassName)}>
        <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
      </div>
    ) : (
      // Even when hideHeader is true, Radix Dialog requires a Title for a11y.
      <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
    )
  ) : showDefaultHeader ? (
    <UnifiedModalHeader
      isDrawer={isDrawer}
      icon={Icon}
      iconTone={iconTone}
      title={title}
      description={description}
      badge={badge}
      className={headerClassName}
    />
  ) : (
    // hideHeader was set on a dialog/drawer — still render the a11y Title.
    <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
  );

  /* ----------------------- Body ------------------------- */
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

  /* ----------------------- Footer ----------------------- */
  const showAutoFooter = !footer && !hideFooter;
  const footerNode = footer ? (
    <UnifiedModalFooter isDrawer={isDrawer} className={footerClassName}>
      {footer}
    </UnifiedModalFooter>
  ) : showAutoFooter ? (
    <UnifiedModalFooter
      isDrawer={isDrawer}
      leading={footerLeading}
      className={footerClassName}
    >
      {!hideCancel && (
        <Button
          type="button"
          variant="outline"
          onClick={() => onOpenChange(false)}
          disabled={loading}
        >
          {cancelLabel}
        </Button>
      )}
      {!hideSubmit && submitLabel && (
        <Button
          type="button"
          variant={
            submitVariant === "destructive"
              ? "destructive"
              : submitVariant === "success"
                ? "default"
                : "default"
          }
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
  ) : null;

  /* ----------------------- Render ----------------------- */
  if (isCommandPalette) {
    // Command palette: top-anchored, p-0 body, no default chrome.
    // Same overlay + zoom-in animation as dialog variant for visual continuity.
    return (
      <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay
            className={cn(
              "fixed inset-0 z-50 bg-black/70 backdrop-blur-sm",
              "data-[state=open]:animate-in data-[state=closed]:animate-out",
              "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            )}
          />
          <DialogPrimitive.Content
            onInteractOutside={handleInteractOutside}
            onEscapeKeyDown={handleEscapeKeyDown}
            className={cn(
              "fixed left-1/2 top-[15vh] z-50 grid w-full -translate-x-1/2 flex-col gap-0 border border-border bg-popover shadow-2xl sm:rounded-lg overflow-hidden",
              "data-[state=open]:animate-in data-[state=closed]:animate-out",
              "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
              "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
              COMMAND_PALETTE_SIZE_CLASS[size],
              contentClassName,
            )}
          >
            {headerNode}
            {bodyNode}
            {footerNode}
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

  if (isDrawer) {
    return (
      <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay
            className={cn(
              "fixed inset-0 z-50 bg-black/60 backdrop-blur-sm",
              "data-[state=open]:animate-in data-[state=closed]:animate-out",
              "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            )}
          />
          <DialogPrimitive.Content
            onInteractOutside={handleInteractOutside}
            onEscapeKeyDown={handleEscapeKeyDown}
            className={cn(
              "fixed end-0 top-0 z-50 flex h-full flex-col border-s border-border bg-popover shadow-2xl",
              "data-[state=open]:animate-in data-[state=closed]:animate-out",
              "data-[state=open]:slide-in-right data-[state=closed]:slide-out-right",
              DRAWER_SIZE_CLASS[drawerSize],
              contentClassName,
            )}
          >
            {headerNode}
            {bodyNode}
            {footerNode}
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

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-50 bg-black/70 backdrop-blur-sm",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          )}
        />
        <DialogPrimitive.Content
          onInteractOutside={handleInteractOutside}
          onEscapeKeyDown={handleEscapeKeyDown}
          className={cn(
            "fixed left-1/2 top-1/2 z-50 grid w-full -translate-x-1/2 -translate-y-1/2 flex-col gap-0 border border-border bg-popover shadow-2xl sm:rounded-lg overflow-hidden",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
            DIALOG_SIZE_CLASS[size],
            contentClassName,
          )}
        >
          {headerNode}
          {bodyNode}
          {footerNode}
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

/* ------------------------------------------------------------------ */
/*  Sub-components (also exported for advanced composition)            */
/* ------------------------------------------------------------------ */

export function UnifiedModalHeader({
  isDrawer,
  icon: Icon,
  iconTone = "primary",
  title,
  description,
  badge,
  className,
}: {
  isDrawer: boolean;
  icon?: LucideIcon;
  iconTone?: NonNullable<UnifiedModalProps["iconTone"]>;
  title: React.ReactNode;
  description?: React.ReactNode;
  badge?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 pr-12",
        isDrawer ? "border-b border-border p-5" : "border-b border-border p-5",
        className,
      )}
    >
      {Icon && (
        <div
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
            ICON_TONE_CLASS[iconTone],
          )}
        >
          <Icon className="h-5 w-5" />
        </div>
      )}
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <DialogPrimitive.Title
            className={cn(
              "font-semibold text-foreground truncate",
              isDrawer ? "text-base" : "text-lg",
            )}
          >
            {title}
          </DialogPrimitive.Title>
          {badge}
        </div>
        {description && (
          <DialogPrimitive.Description className="text-sm text-muted-foreground leading-snug">
            {description}
          </DialogPrimitive.Description>
        )}
      </div>
    </div>
  );
}

export function UnifiedModalBody({
  isDrawer,
  isCommandPalette = false,
  alert,
  onDismissAlert,
  className,
  children,
}: {
  isDrawer: boolean;
  isCommandPalette?: boolean;
  alert?: UnifiedModalProps["alert"];
  onDismissAlert?: () => void;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex-1 overflow-y-auto",
        // command-palette defaults to p-0 (flush results list); dialog/drawer default to p-5.
        isCommandPalette ? "p-0" : "p-5",
        className,
      )}
    >
      {alert && (
        <UnifiedModalAlert
          tone={alert.tone}
          title={alert.title}
          description={alert.description}
          onDismiss={onDismissAlert}
        />
      )}
      {children}
    </div>
  );
}

export function UnifiedModalFooter({
  isDrawer,
  leading,
  className,
  children,
}: {
  isDrawer: boolean;
  leading?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  // If children provided, render them as-is (custom footer).
  // Otherwise, the parent (UnifiedModal) injects cancel + submit.
  return (
    <div
      className={cn(
        "flex items-center gap-2 border-t border-border p-4",
        leading && "justify-between",
        className,
      )}
    >
      {leading && <div className="flex items-center gap-2">{leading}</div>}
      {children && (
        <div className={cn("flex items-center gap-2", leading ? "" : "ml-auto")}>
          {children}
        </div>
      )}
    </div>
  );
}

export function UnifiedModalAlert({
  tone,
  title,
  description,
  onDismiss,
}: {
  tone: AlertTone;
  title: string;
  description?: string;
  onDismiss?: () => void;
}) {
  const Icon = tone === "error" ? AlertCircle : tone === "warning" ? AlertTriangle : AlertCircle;
  const toneClass =
    tone === "error"
      ? "border-status-danger/30 bg-status-danger/10 text-status-danger"
      : tone === "warning"
        ? "border-status-warning/30 bg-status-warning/10 text-status-warning"
        : "border-status-info/30 bg-status-info/10 text-status-info";

  return (
    <div
      className={cn(
        "mb-4 flex items-start gap-3 rounded-lg border px-3 py-2.5 text-sm",
        toneClass,
      )}
      role="alert"
    >
      <Icon className="h-4 w-4 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="font-medium leading-tight">{title}</p>
        {description && (
          <p className="mt-0.5 text-xs opacity-90 leading-snug">{description}</p>
        )}
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 text-current opacity-60 transition-opacity hover:opacity-100"
          aria-label="Fermer l'alerte"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Convenience preset — ConfirmModal                                  */
/* ------------------------------------------------------------------ */

export function ConfirmModal({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirmer",
  cancelLabel = "Annuler",
  destructive = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  confirmLabel?: React.ReactNode;
  cancelLabel?: React.ReactNode;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
}) {
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
