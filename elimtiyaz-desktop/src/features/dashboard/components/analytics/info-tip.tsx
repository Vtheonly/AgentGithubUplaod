// ============================================================================
// FILE: elimtiyaz-desktop/src/features/dashboard/components/analytics/info-tip.tsx
// ============================================================================
/**
 * InfoTip — T-447 (UI-325): the Statistics explainability tooltip.
 *
 * The owner's mandate: explanations on EVERY Statistics card, chart, metric,
 * header, slicer and control — what the element measures, how it is
 * calculated, and what its status means — bilingual (French + English),
 * NEVER hardcoded in JSX (the texts live in the centralized glossary
 * `src/i18n/stats-tips.ts`, consumed through the EXISTING react-i18next
 * system with fr fallback and ar parity).
 *
 * Usage (the tip key is a dotted path under the `statsTips` namespace):
 *   <InfoTip tip="waveVelocity.card" />
 *   <InfoTip tip="statStrip.median" className="ml-1" />
 *
 * Rendering: a small ⓘ icon button (keyboard focusable, aria-labelled with
 * the tip's title) that opens the radix Tooltip (the project's shared
 * TooltipProvider is mounted at the app shell — app.tsx). The tooltip body
 * renders the entry's fields with their section labels, all dictionary
 * strings (the labels themselves come from `statsTips._meta`).
 */
import { useTranslation } from "react-i18next";
import { Info } from "lucide-react";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "../../../../shared/ui/tooltip";
import { cn } from "../../../../shared/ui/cn";

/** The section labels (rendered from the dictionaries — never hardcoded). */
const META_FIELDS = ["measures", "calc", "status"] as const;

export interface InfoTipProps {
  /** The dotted glossary key (e.g. "waveVelocity.collectedPct") under statsTips. */
  tip: string;
  className?: string;
  /** Icon size (px) — defaults to the small inline metric size. */
  size?: number;
}

export function InfoTip({ tip, className, size = 12 }: InfoTipProps) {
  const { t } = useTranslation();
  const title = t(`statsTips.${tip}.title`, { defaultValue: "" });
  // Honest-empty: a missing key renders NOTHING (the parity test + the
  // compile-time dictionary shape make this impossible in practice, but
  // the component never fabricates content).
  if (!title) return null;
  return (
    // Self-contained provider (nested safely inside the app-level one):
    // the tip mounts wherever a metric renders — including bare test
    // mounts — without requiring an ancestor TooltipProvider.
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={title}
            data-testid={`stat-tip-${tip.replace(/\./g, "-")}`}
            className={cn(
              "inline-flex items-center justify-center rounded-full text-muted-foreground/70 hover:text-primary hover:bg-primary/10 transition-colors shrink-0",
              className,
            )}
            style={{ width: size + 6, height: size + 6 }}
            tabIndex={0}
          >
            <Info style={{ width: size, height: size }} aria-hidden />
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          className="max-w-[300px] px-3 py-2.5 space-y-1.5 text-left leading-relaxed"
        >
          <p className="text-xs font-semibold text-popover-foreground">{title}</p>
          {META_FIELDS.map((field) => {
            const value = t(`statsTips.${tip}.${field}`, { defaultValue: "" });
            if (!value) return null;
            const label = t(`statsTips._meta.${field}`, { defaultValue: "" });
            return (
              <p key={field} className="text-[11px] text-popover-foreground/90">
                {label && (
                  <span className="font-semibold uppercase tracking-wide text-[9px] text-muted-foreground mr-1">
                    {label}
                  </span>
                )}
                {value}
              </p>
            );
          })}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
