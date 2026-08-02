/**
 * App sidebar — primary navigation (plan §03.02).
 *
 * Persistent left sidebar with 4 Hubs + Personnel + Routing + Settings.
 * Each item is GatedContent-wrapped so locked sections render at reduced
 * opacity with a lock icon. Collapsible to a thin rail.
 */
import { NavLink, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  LayoutDashboard,
  Users,
  GraduationCap,
  Wallet,
  UserCog,
  Workflow as WorkflowIcon,
  Route as RouteIcon,
  Settings,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";
import { cn } from "../ui/cn";
import {
  Dashboard,
  Crm,
  Academics,
  Financials,
  Personnel,
  WorkflowAutomation,
  Routing,
  Settings as SettingsNode,
} from "../../core/rbac/feature-registry";
import { GatedContent } from "./gated-content";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "../ui/tooltip";

interface SidebarItemDef {
  node: typeof Dashboard;
  icon: LucideIcon;
  to: string;
}

const ITEMS: SidebarItemDef[] = [
  { node: Dashboard, icon: LayoutDashboard, to: "/" },
  { node: Crm, icon: Users, to: "/crm" },
  { node: Academics, icon: GraduationCap, to: "/academics" },
  { node: Financials, icon: Wallet, to: "/financials" },
  { node: Personnel, icon: UserCog, to: "/personnel" },
  { node: WorkflowAutomation, icon: WorkflowIcon, to: "/workflow" },
  { node: Routing, icon: RouteIcon, to: "/routing" },
  { node: SettingsNode, icon: Settings, to: "/settings" },
];

export function Sidebar() {
  const { t } = useTranslation();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className="flex h-full flex-col border-r border-border bg-surface-panel transition-all duration-200"
      style={{ width: collapsed ? "var(--sidebar-width-collapsed)" : "var(--sidebar-width)" }}
    >
      {/* Brand */}
      <div className="flex h-[var(--topbar-height)] items-center gap-3 px-4 border-b border-border">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground text-sm font-bold">
          EI
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">El-Imtiyaz</p>
            <p className="text-[10px] text-muted-foreground truncate">Desktop Terminal</p>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto p-2 no-scrollbar">
        <ul className="space-y-1">
          {ITEMS.map((item) => {
            const label = labelFor(item.node.id, t);
            const isActive = location.pathname === item.to ||
              (item.to !== "/" && location.pathname.startsWith(item.to));
            return (
              <li key={item.node.id}>
                <GatedContent
                  node={item.node}
                  disabledStyle="inline"
                >
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <NavLink
                          to={item.to}
                          className={cn(
                            "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                            "hover:bg-accent/10",
                            isActive && "bg-primary/15 text-primary font-medium",
                            !isActive && "text-muted-foreground",
                            collapsed && "justify-center px-0",
                          )}
                          title={collapsed ? label : undefined}
                        >
                          <item.icon className="h-4 w-4 shrink-0" />
                          {!collapsed && <span className="truncate">{label}</span>}
                        </NavLink>
                      </TooltipTrigger>
                      {collapsed && (
                        <TooltipContent side="right">{label}</TooltipContent>
                      )}
                    </Tooltip>
                  </TooltipProvider>
                </GatedContent>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Collapse toggle */}
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex h-10 items-center justify-center border-t border-border text-muted-foreground hover:bg-accent/10 hover:text-foreground transition-colors"
        aria-label={collapsed ? "Déplier" : "Replier"}
      >
        {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
      </button>
    </aside>
  );
}

function labelFor(nodeId: string, t: (key: string) => string): string {
  const map: Record<string, string> = {
    "section.dashboard": t("nav.dashboard"),
    "section.crm": t("nav.crm"),
    "section.academics": t("nav.academics"),
    "section.financials": t("nav.financials"),
    "section.personnel": t("nav.personnel"),
    "section.workflow_automation": t("nav.workflow"),
    "section.routing": t("nav.routing"),
    "section.settings": t("nav.settings"),
  };
  return map[nodeId] ?? nodeId;
}
