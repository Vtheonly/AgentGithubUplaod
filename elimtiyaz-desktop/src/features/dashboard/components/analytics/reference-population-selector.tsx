// ============================================================================
// FILE: elimtiyaz-desktop/src/features/dashboard/components/analytics/reference-population-selector.tsx
// ============================================================================
/**
 * ReferencePopulationSelector — T-467 (DASH-411): the user-selectable
 * reference population for every top-10 meter (the owner's mandate: "There
 * should be a clear control in the dashboard/inspection interface allowing
 * the user to switch between: Whole dataset / Top 10. The selected reference
 * population must be clearly visible so the displayed percentages cannot be
 * misunderstood").
 *
 * ONE control, mounted on every top-10 surface (the Data Inspector's compact
 * popup + forensic drawer, the DebtorsParetoCard, the FamilyConcentration
 * Card) — the mode is the CALLER's state; switching it changes ONLY the
 * denominator the caller renders (the top-10 SELECTION itself is never
 * re-ranked — the owner's explicit rule, structurally guaranteed because
 * the resolution carries BOTH bases precomputed).
 *
 *   Mode "whole-dataset" — Top 10 → Tout le dataset:
 *     each contributor's % = amount ÷ the WHOLE dataset's metric value.
 *     The top 10 are NOT normalized to 100% — they are the highest-ranking
 *     contributors within the complete population.
 *
 *   Mode "top10" — Top 10 → Top 10:
 *     each contributor's % = amount ÷ the top-10's own combined value.
 *     The ten normalize to 100% collectively — the distribution WITHIN
 *     the top 10.
 */
import { cn } from "../../../../shared/ui/cn";
import { InfoTip } from "./info-tip";

export type ReferencePopulationMode = "whole-dataset" | "top10";

export function ReferencePopulationSelector({
  mode,
  onChange,
  className,
  compact = false,
  tipKey = "inspector.referenceMode",
}: {
  mode: ReferencePopulationMode;
  onChange: (mode: ReferencePopulationMode) => void;
  className?: string;
  /** The compact variant (the inspector's popup — smaller chips). */
  compact?: boolean;
  /** The glossary key for the mode explanation tip. */
  tipKey?: string;
}) {
  const options: { value: ReferencePopulationMode; label: string; title: string }[] = [
    {
      value: "whole-dataset",
      label: "Tout le dataset",
      title:
        "Mode 1 — Top 10 → Tout le dataset : chaque pourcentage = valeur individuelle ÷ valeur TOTALE du dataset complet. Le Top 10 n'est PAS normalisé à 100%.",
    },
    {
      value: "top10",
      label: "Top 10",
      title:
        "Mode 2 — Top 10 → Top 10 : chaque pourcentage = valeur individuelle ÷ total des 10 seuls. Les dix somment à 100% — la répartition AU SEIN du Top 10.",
    },
  ];
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-border/70 bg-surface-elevated/40 p-0.5",
        className,
      )}
      role="group"
      aria-label="Population de référence des pourcentages"
      data-testid="reference-population-selector"
      data-mode={mode}
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          title={opt.title}
          aria-pressed={mode === opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            "rounded-full font-medium transition-colors",
            compact ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-[11px]",
            mode === opt.value
              ? "bg-primary/15 text-primary border border-primary/30"
              : "text-muted-foreground hover:text-foreground border border-transparent",
          )}
          data-testid={`reference-mode-${opt.value}`}
        >
          {opt.label}
        </button>
      ))}
      <InfoTip tip={tipKey} className={compact ? "ml-0.5" : "ml-1"} />
    </div>
  );
}

/** The share to display for a contributor under the selected mode. */
export function referenceSharePct(
  contributor: { shareOfTotalPct: number; shareOfTop10Pct: number },
  mode: ReferencePopulationMode,
): number {
  return mode === "top10" ? contributor.shareOfTop10Pct : contributor.shareOfTotalPct;
}

/** The denominator label (the mode's own reference population). */
export function referencePopulationLabel(mode: ReferencePopulationMode): string {
  return mode === "top10"
    ? "les 10 premiers seuls"
    : "l'ensemble du dataset";
}
