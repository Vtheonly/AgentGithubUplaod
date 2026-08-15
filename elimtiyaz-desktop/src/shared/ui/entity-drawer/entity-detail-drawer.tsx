/**
 * <EntityDetailDrawer<T>> — standardized slide-over drawer primitive.
 * Replaces 9 separate drawers. Avatar header, metadata grid, tabs, action bar.
 */
import { useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "../avatar";
import { Button } from "../button";
import { cn } from "../cn";
import type { EntityDetailDrawerProps } from "./types";

export function EntityDetailDrawer<T>(props: EntityDetailDrawerProps<T>): ReactNode {
  const { open, onOpenChange, entity, title, subtitle, avatar, metadata, tabs, actions,
    widthClass = "max-w-md", headerAccent } = props;
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
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className={cn(
          "fixed end-0 top-0 z-50 flex h-full flex-col border-s border-border bg-popover shadow-2xl w-full",
          widthClass,
          "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right",
        )}>
          <div className={cn("flex items-start gap-3 p-4 border-b border-border", headerAccent)}>
            {headerAvatar && (
              <Avatar className="size-12">
                {headerAvatar.url && <AvatarImage src={headerAvatar.url} alt="" />}
                <AvatarFallback>{headerAvatar.initials.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
            )}
            <div className="flex-1 min-w-0">
              {title && <Dialog.Title className="text-base font-semibold truncate">{title(entity)}</Dialog.Title>}
              {subtitle && <Dialog.Description className="text-xs text-muted-foreground truncate">{subtitle(entity)}</Dialog.Description>}
            </div>
            <Dialog.Close asChild>
              <button className="text-muted-foreground hover:text-foreground" aria-label="Fermer">
                <X className="size-4" />
              </button>
            </Dialog.Close>
          </div>

          {meta.length > 0 && (
            <div className="grid grid-cols-2 gap-px bg-border border-b border-border">
              {meta.map((m, i) => (
                <div key={i} className="bg-popover p-3">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{m.label}</div>
                  <div className="mt-0.5 text-sm font-medium truncate">{m.value}</div>
                </div>
              ))}
            </div>
          )}

          {tabsList.length > 0 && (
            <div className="flex border-b border-border">
              {tabsList.map((tab, idx) => {
                const badge = tab.badge?.(entity);
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(idx)}
                    className={cn(
                      "flex-1 px-3 py-2 text-xs font-medium border-b-2 transition-colors",
                      idx === safeActiveTab
                        ? "border-primary text-primary"
                        : "border-transparent text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {tab.label}
                    {badge != null && badge !== 0 && (
                      <span className="ml-1 rounded-full bg-muted px-1.5 text-[10px]">{badge}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex-1 overflow-auto p-4">
            {activeTabObj ? activeTabObj.content(entity) : null}
          </div>

          {actionList.length > 0 && (
            <div className="flex justify-end gap-2 border-t border-border p-3 bg-muted/30">
              {actionList.map((a, i) => (
                <Button
                  key={i}
                  variant={a.variant ?? "outline"}
                  size="sm"
                  disabled={a.disabled?.(entity)}
                  onClick={() => a.onClick(entity)}
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
