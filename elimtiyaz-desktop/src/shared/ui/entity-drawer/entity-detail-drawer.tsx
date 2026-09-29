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
 */

import { useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "../avatar";
import { Button } from "../button";
import { cn } from "../cn";
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
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm transition-opacity data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className={cn(
            "fixed end-0 top-0 z-50 flex h-full flex-col border-s border-border bg-popover shadow-2xl transition-transform duration-300 ease-out",
            widthClass,
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right",
          )}
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

            {/* Polished Close Button */}
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
          <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
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
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}