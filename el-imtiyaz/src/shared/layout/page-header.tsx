/**
 * Page header — consistent page-title + actions row at the top of every page.
 */
import type { ReactNode } from "react";
import { cn } from "../ui/cn";

export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-4 px-6 py-4", className)}>
      <div className="space-y-1 min-w-0">
        <h1 className="text-xl font-semibold text-foreground truncate">{title}</h1>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2 shrink-0">{actions}</div> : null}
    </div>
  );
}
