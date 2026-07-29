/**
 * Shared dashboard primitives used by every role-based dashboard.
 *
 * These wrap the existing KpiCard / Card components with role-dashboard
 * conventions (consistent spacing, header actions, empty states) so each
 * dashboard file stays focused on its role's data and actions.
 */
import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../../../shared/ui/card";
import { KpiCard } from "../../../shared/components/kpi-card";
import { ComingSoonCard } from "../../../shared/components/coming-soon-card";
import type { LucideIcon } from "lucide-react";

export function DashboardGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 p-6 pb-12">{children}</div>;
}

export function DashboardKpiRow({ children }: { children: ReactNode }) {
  return (
    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
  );
}

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
