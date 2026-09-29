// ============================================================================
// FILE: elimtiyaz-desktop/src/shared/ui/parent-actions-menu.tsx
// ============================================================================
/**
 * ParentActionsMenu — Standardized 3-dot contextual actions menu for ANY
 * parent/family reference throughout the application.
 */

import { MoreHorizontal, Users, Wallet, Hourglass, MessageCircle, Phone, Eye } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { Button } from "./button";
import { cn } from "./cn";
import { usePersonNavigation } from "../navigation/person-navigation-context";

export interface ParentActionsMenuProps {
  parent: {
    id: string;
    firstName?: string;
    lastName?: string;
    displayName?: string | null;
    code?: string;
    phone?: string;
    whatsapp?: string | null;
  };
  className?: string;
  align?: "start" | "center" | "end";
  label?: string;
}

export function ParentActionsMenu({
  parent,
  className,
  align = "end",
  label,
}: ParentActionsMenuProps) {
  const { openParent, navigateToParent } = usePersonNavigation();

  const fullName =
    parent.displayName ||
    `${parent.firstName ?? ""} ${parent.lastName ?? ""}`.trim() ||
    parent.code ||
    "Famille";

  const cleanPhone = (parent.whatsapp || parent.phone || "").replace(/[\s+]/g, "");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn("h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground", className)}
          aria-label={label ?? `Actions pour ${fullName}`}
          title={`Options pour ${fullName}`}
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-60 z-50">
        <DropdownMenuLabel className="text-xs">
          <span className="block truncate font-semibold">{fullName}</span>
          {parent.code && <span className="font-mono text-[10px] text-muted-foreground">{parent.code}</span>}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        <DropdownMenuItem
          onClick={(e) => {
            e.stopPropagation();
            openParent(parent.id);
          }}
          className="gap-2.5 cursor-pointer"
        >
          <Eye className="h-4 w-4 text-primary" />
          <span className="flex flex-col">
            <span className="text-xs font-semibold text-foreground">Aperçu rapide</span>
            <span className="text-[10px] text-muted-foreground">Ouvrir le panneau latéral</span>
          </span>
        </DropdownMenuItem>

        <DropdownMenuItem
          onClick={(e) => {
            e.stopPropagation();
            navigateToParent(parent.id, "crm");
          }}
          className="gap-2.5 cursor-pointer"
        >
          <Users className="h-4 w-4 text-primary" />
          <span className="flex flex-col">
            <span className="text-xs font-semibold text-foreground">Dossier famille (CRM)</span>
            <span className="text-[10px] text-muted-foreground">Fiche complète, enfants & contact</span>
          </span>
        </DropdownMenuItem>

        <DropdownMenuItem
          onClick={(e) => {
            e.stopPropagation();
            navigateToParent(parent.id, "finances");
          }}
          className="gap-2.5 cursor-pointer"
        >
          <Wallet className="h-4 w-4 text-status-success" />
          <span className="flex flex-col">
            <span className="text-xs font-semibold text-foreground">Finances & Tranches</span>
            <span className="text-[10px] text-muted-foreground">Échéancier, soldes et versements</span>
          </span>
        </DropdownMenuItem>

        <DropdownMenuItem
          onClick={(e) => {
            e.stopPropagation();
            navigateToParent(parent.id, "debt");
          }}
          className="gap-2.5 cursor-pointer"
        >
          <Hourglass className="h-4 w-4 text-status-danger" />
          <span className="flex flex-col">
            <span className="text-xs font-semibold text-foreground">Suivi des dettes</span>
            <span className="text-[10px] text-muted-foreground">Ancienneté et historique par année</span>
          </span>
        </DropdownMenuItem>

        {(cleanPhone || parent.phone) && <DropdownMenuSeparator />}

        {cleanPhone && (
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation();
              window.open(`https://wa.me/${cleanPhone}`, "_blank");
            }}
            className="gap-2.5 cursor-pointer text-status-success focus:text-status-success"
          >
            <MessageCircle className="h-4 w-4" />
            <span className="text-xs">Message WhatsApp direct</span>
          </DropdownMenuItem>
        )}

        {parent.phone && (
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation();
              window.open(`tel:${parent.phone}`);
            }}
            className="gap-2.5 cursor-pointer"
          >
            <Phone className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs">Appeler ({parent.phone})</span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}