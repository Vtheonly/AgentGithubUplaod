/**
 * KPI card — standardized metric display. Tone-tinted icon, label, and value.
 * Used in dashboard and financials hub.
 */
import type { ReactNode } from "react";
import { cn } from "../ui/cn";
import { Card, CardContent } from "../ui/card";

export type KpiTone = "default" | "success" | "warning" | "danger" | "info";

const TONE_ICON_BG: Record<KpiTone, string> = {
  default: "bg-primary/15 text-primary",
  success: "bg-status-success/15 text-status-success",
  warning: "bg-status-warning/15 text-status-warning",
  danger: "bg-status-danger/15 text-status-danger",
  info: "bg-status-info/15 text-status-info",
};

export function KpiCard({
  label,
  value,
  icon,
  tone = "default",
  hint,
  className,
}: {
  label: string;
  value: ReactNode;
  icon: ReactNode;
  tone?: KpiTone;
  hint?: string;
  className?: string;
}) {
  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardContent className="flex items-center gap-3 p-4">
        <div className={cn("flex h-10 w-10 items-center justify-center rounded-md", TONE_ICON_BG[tone])}>
          {icon}
        </div>
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground truncate">
            {label}
          </span>
          <span className="text-xl font-semibold text-foreground tnum truncate">{value}</span>
          {hint ? <span className="text-xs text-muted-foreground truncate">{hint}</span> : null}
        </div>
      </CardContent>
    </Card>
  );
}
