// ============================================================================
// FILE: elimtiyaz-desktop/src/shared/ui/entity-drawer/entity-detail-drawer.tsx
// ============================================================================
/**
 * <EntityDetailDrawer<T>> — Premium redesigned slide-over drawer primitive.
 *
 * Implements a modern executive panel:
 *   - Gradient glassmorphic header banner with rich avatar, status chip & title
 *   - Sleek metadata cards ribbon with icons and high-contrast typography
 *   - Polished segmented pill tab navigation with dynamic counts and icons
 *   - Generous responsive width (w-full sm:max-w-xl md:max-w-2xl lg:max-w-3xl)
 *   - Crisp, styled close button and pinned backdrop-blur action footer
 *
 * E6.3 (DUP-024 / UI-U3): the render skeleton is ModalShell's DRAWER preset —
 * the ONE modal skeleton. The previous hand-rolled Dialog.Portal markup (its
 * own overlay + its own transition classes) is gone; the shell provides the
 * portal, the scrim 60 (drawer opacity), the slide-in/slide-out animation
 * (tailwindcss-animate verbs — E6.1), Escape handling, and the a11y close
 * button. The drawer's VISUAL identity is unchanged: the gradient header
 * banner, the metadata ribbon, the pill tabs, and the action footer all keep
 * their markup; the shell only replaces the bones under them. The responsive
 * widthClass keeps the responsive scale (the shell's fixed DrawerSize tiers
 * are for UnifiedModal's callers; this drawer's own responsive scale passes
 * through contentClassName).
 */

import { useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "../avatar";
import { Button } from "../button";
import { cn } from "../cn";
import { ModalShell } from "../unified-modal/modal-shell";
import type { EntityDetailDrawerProps } from "./types";

export function EntityDetailDrawer<T>(props: EntityDetailDrawerProps<T>): ReactNode {
  const {
    open,
    onOpenChange,
    entity,
    title,
    subtitle,
    avatar,
    metadata,
    tabs,
    actions,
    widthClass = "w-full sm:max-w-xl md:max-w-2xl lg:max-w-3xl",
    headerAccent,
  } = props;

  const [activeTab, setActiveTab] = useState(0);

  if (!entity) {
    return (
      <Dialog.Root open={false} onOpenChange={onOpenChange}>
        <Dialog.Portal />
      </Dialog.Root>
    );
  }

  const tabsList = tabs?.(entity) ?? [];
  const safeActiveTab = Math.min(activeTab, Math.max(0, tabsList.length - 1));
  const activeTabObj = tabsList[safeActiveTab];
  const meta = metadata?.(entity) ?? [];
  const headerAvatar = avatar?.(entity) ?? null;
  const actionList = actions?.(entity) ?? [];

  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      onInteractOutside={() => {}}
      onEscapeKeyDown={() => {}}
      variant="drawer"
      size="lg"
      contentClassName={cn(widthClass, "flex flex-col")}
      hideCloseButton
    >
      {/* Header Banner */}
      <div
        className={cn(
          "relative flex items-start gap-4 p-5 border-b border-border/70 bg-gradient-to-br from-surface-elevated/80 via-surface-panel/90 to-surface-panel pr-14",
          headerAccent,
        )}
      >
        {headerAvatar && (
          <Avatar className="h-13 w-13 rounded-2xl ring-2 ring-primary/20 shadow-md shrink-0">
            {headerAvatar.url && <AvatarImage src={headerAvatar.url} alt="" />}
            <AvatarFallback className="rounded-2xl bg-primary/15 text-primary font-bold text-base">
              {headerAvatar.initials.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        )}

        <div className="flex-1 min-w-0 space-y-1">
          {title && (
            <Dialog.Title className="text-lg font-bold tracking-tight text-foreground truncate">
              {title(entity)}
            </Dialog.Title>
          )}
          {subtitle && (
            <Dialog.Description className="text-xs text-muted-foreground truncate leading-relaxed">
              {subtitle(entity)}
            </Dialog.Description>
          )}
        </div>

        {/* Polished Close Button (kept over the shell's own — this one's
            styling belongs to the banner's identity; the shell's is hidden
            via hideCloseButton). */}
        <Dialog.Close asChild>
          <button
            type="button"
            className="absolute end-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border/70 bg-surface-elevated/70 text-muted-foreground transition-all hover:bg-destructive hover:text-destructive-foreground hover:border-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Fermer"
          >
            <X className="h-4 w-4" />
          </button>
        </Dialog.Close>
      </div>

      {/* Metadata Cards Ribbon */}
      {meta.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-3.5 border-b border-border/60 bg-surface-elevated/20">
          {meta.map((m, i) => (
            <div
              key={i}
              className="rounded-xl border border-border/60 bg-card/90 p-2.5 shadow-sm transition-all hover:border-border"
            >
              <div className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground truncate">
                {m.label}
              </div>
              <div
                className="mt-1 text-xs sm:text-sm font-semibold text-foreground truncate"
                title={typeof m.value === "string" ? m.value : undefined}
              >
                {m.value}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Segmented Pill Tabs Navigation */}
      {tabsList.length > 1 && (
        <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-border/60 bg-surface-panel/40 overflow-x-auto no-scrollbar">
          {tabsList.map((tab, idx) => {
            const badge = tab.badge?.(entity);
            const isActive = idx === safeActiveTab;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(idx)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all",
                  isActive
                    ? "bg-primary text-primary-foreground shadow-sm shadow-primary/25"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                )}
              >
                <span>{tab.label}</span>
                {badge != null && badge !== 0 && (
                  <span
                    className={cn(
                      "px-1.5 py-0.2 rounded-full text-[10px] font-bold font-mono",
                      isActive
                        ? "bg-primary-foreground/20 text-primary-foreground"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-5 space-y-4">
        {activeTabObj ? activeTabObj.content(entity) : null}
      </div>

      {/* Sticky Backdrop-Blur Action Footer */}
      {actionList.length > 0 && (
        <div className="flex items-center justify-end gap-2 border-t border-border/70 p-3.5 bg-surface-panel/90 backdrop-blur-md">
          {actionList.map((a, i) => (
            <Button
              key={i}
              variant={a.variant ?? "outline"}
              size="sm"
              disabled={a.disabled?.(entity)}
              onClick={() => a.onClick(entity)}
              className="h-8 text-xs font-semibold shadow-sm gap-1.5"
            >
              {a.icon}
              {a.label}
            </Button>
          ))}
        </div>
      )}
    </ModalShell>
  );
}
