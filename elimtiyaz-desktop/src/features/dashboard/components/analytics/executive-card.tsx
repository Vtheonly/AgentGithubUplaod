/**
 * ExecutiveCard — E6.8 (UI-U7b / DUP-027): the executive card COMPOSITION
 * ROOT. The eight analytics cards formerly repeated this exact skeleton
 * (Card shell + header + icon + InfoTip + description + header-actions +
 * content) inside the 1,098-line executive-cards.tsx monolith; they now
 * compose over this one component and declare only their body.
 *
 * Slots:
 *  - icon / title / infoTip / description — the header identity
 *  - headerExtra — badges between the title block and the actions
 *    (WaveVelocity's « % collecté global » chips)
 *  - headerActions — the per-card actions rail (CardHeaderActions wraps)
 *  - shellClassName — tone variants (TripleRisk's danger gradient,
 *    WaveVelocity's shadow); tailwind-merged over the base shell
 *  - contentClassName — the body container's classes
 *
 * T-596's dashboard overhaul re-composes over this root (the plan's
 * « re-composed by T-596's overhaul » seam).
 */
import type { ReactNode } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../../../../shared/ui/card";
import { cn } from "../../../../shared/ui/cn";
import { InfoTip } from "./info-tip";
import { CardHeaderActions } from "./card-header-actions";

export function ExecutiveCard({
  testId,
  icon,
  title,
  infoTip,
  description,
  descriptionExtra,
  headerExtra,
  headerActions,
  headerClassName,
  shellClassName,
  contentClassName,
  children,
}: {
  testId?: string;
  icon: ReactNode;
  title: ReactNode;
  infoTip?: string;
  description?: ReactNode;
  /** Content under the description, inside the title block
   *  (FamilyConcentration's reference-population selector). */
  descriptionExtra?: ReactNode;
  /** Badges between the title block and the actions
   *  (WaveVelocity's « % collecté global » chips, DebtTriage's totals). */
  headerExtra?: ReactNode;
  headerActions?: ReactNode;
  headerClassName?: string;
  shellClassName?: string;
  contentClassName?: string;
  children: ReactNode;
}) {
  return (
    <Card
      className={cn(
        "border-border/70 bg-surface-panel min-h-full flex flex-col justify-between",
        shellClassName,
      )}
      data-testid={testId}
    >
      <CardHeader
        className={cn(
          "py-3 px-4 border-b border-border/50 flex flex-row items-center justify-between flex-wrap gap-2",
          headerClassName,
        )}
      >
        <div>
          <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            {icon}
            {title}
            {infoTip ? <InfoTip tip={infoTip} /> : null}
          </CardTitle>
          {description ? (
            <CardDescription className="text-xs text-muted-foreground">
              {description}
            </CardDescription>
          ) : null}
          {descriptionExtra}
        </div>
        {headerExtra}
        {headerActions ? (
          <CardHeaderActions>{headerActions}</CardHeaderActions>
        ) : null}
      </CardHeader>
      <CardContent className={contentClassName}>{children}</CardContent>
    </Card>
  );
}
