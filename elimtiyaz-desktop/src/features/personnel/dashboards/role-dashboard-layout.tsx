/**
 * RoleDashboardLayout — unified dashboard shell for 7 role dashboards.
 *
 * Self-contained: inlines the previously separate `dashboard-primitives.tsx`
 * `DashboardGrid` / `DashboardKpiRow` / `DashboardSection` layout helpers so
 * role dashboards no longer need to import from two files. `DashboardSection`
 * is re-exported for downstream management tabs that still need an inline
 * card wrapper.
 */
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Bell, Clock } from "lucide-react";
import { Button } from "../../../shared/ui/button";
import { Avatar, AvatarFallback } from "../../../shared/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle } from "../../../shared/ui/card";
import { KpiCard } from "../../../shared/ui/kpi-card";
import { ComingSoonCard } from "../../../shared/layout/coming-soon-card";

export interface DashboardKpi {
  readonly label: string;
  readonly value: string | number;
  readonly icon?: LucideIcon;
  readonly trend?: string;
  readonly trendDirection?: "up" | "down" | "flat";
}

export interface DashboardTask {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly dueIn?: string;
  readonly priority?: "high" | "medium" | "low";
  readonly onClick?: () => void;
}

export interface DashboardFeedItem {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly timestamp: string;
  readonly icon?: LucideIcon;
}

export interface DashboardHeaderAction {
  readonly label: string;
  readonly onClick: () => void;
  readonly variant?: "default" | "outline" | "ghost" | "destructive";
  readonly icon?: LucideIcon;
}

export interface RoleDashboardLayoutProps {
  readonly role: string;
  readonly actorName: string;
  readonly kpis: readonly DashboardKpi[];
  readonly tasks?: readonly DashboardTask[];
  readonly feed?: readonly DashboardFeedItem[];
  readonly actions?: readonly DashboardHeaderAction[];
  readonly children?: ReactNode;
  readonly hideFeed?: boolean;
}

export function RoleDashboardLayout(props: RoleDashboardLayoutProps): ReactNode {
  const { role, actorName, kpis, tasks = [], feed = [], actions = [], children, hideFeed } = props;
  const initials = actorName.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();

  return (
    <div className="grid gap-4 p-6 pb-12">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Avatar><AvatarFallback>{initials}</AvatarFallback></Avatar>
          <div>
            <div className="text-lg font-semibold">{role} Dashboard</div>
            <div className="text-xs text-muted-foreground">{actorName}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="size-3" />
            {new Date().toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" })}
          </div>
          <button className="text-muted-foreground hover:text-foreground" aria-label="Notifications">
            <Bell className="size-4" />
          </button>
          {actions.map((a, i) => {
            const Icon = a.icon;
            return (
              <Button key={i} variant={a.variant ?? "outline"} size="sm" onClick={a.onClick}>
                {Icon && <Icon className="size-4" />}
                {a.label}
              </Button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((kpi, i) => {
          const Icon = kpi.icon;
          return (
            <KpiCard
              key={i}
              label={kpi.label}
              value={String(kpi.value)}
              icon={Icon ? <Icon className="size-5" /> : null}
              hint={kpi.trend}
            />
          );
        })}
      </div>

      {tasks.length > 0 && (
        <DashboardSection title="Tâches en attente" action={<span className="text-xs text-muted-foreground">{tasks.length} à traiter</span>}>
          <ul className="divide-y divide-border">
            {tasks.map((t) => (
              <li key={t.id} className="flex items-center justify-between py-2">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{t.label}</div>
                  {t.description && <div className="text-xs text-muted-foreground truncate">{t.description}</div>}
                </div>
                <div className="flex items-center gap-2">
                  {t.dueIn && <span className="text-xs text-muted-foreground">{t.dueIn}</span>}
                  {t.priority === "high" && <span className="rounded bg-status-danger/10 px-1.5 py-0.5 text-[10px] text-status-danger">Urgent</span>}
                  {t.onClick && <Button variant="ghost" size="sm" onClick={t.onClick}>Ouvrir</Button>}
                </div>
              </li>
            ))}
          </ul>
        </DashboardSection>
      )}

      {!hideFeed && feed.length > 0 && (
        <DashboardSection title="Activité récente">
          <ul className="space-y-2">
            {feed.map((f) => {
              const Icon = f.icon;
              return (
                <li key={f.id} className="flex items-start gap-2">
                  {Icon && <Icon className="mt-0.5 size-4 text-muted-foreground" />}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm">{f.label}</div>
                    {f.description && <div className="text-xs text-muted-foreground">{f.description}</div>}
                  </div>
                  <span className="text-[11px] text-muted-foreground whitespace-nowrap">{f.timestamp}</span>
                </li>
              );
            })}
          </ul>
        </DashboardSection>
      )}

      {children}
    </div>
  );
}

/**
 * DashboardSection — inline card wrapper re-exported for management tabs
 * that need a titled card with optional header action.
 */
export function DashboardSection({
  title,
  icon: Icon,
  action,
  children,
  className = "",
}: {
  title: string;
  icon?: LucideIcon;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
          {title}
        </CardTitle>
        {action}
      </CardHeader>
      <CardContent className="pt-2">{children}</CardContent>
    </Card>
  );
}

export { KpiCard, ComingSoonCard };
