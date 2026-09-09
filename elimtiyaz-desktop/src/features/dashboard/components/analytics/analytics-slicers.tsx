/**
 * AnalyticsSlicers — the Power BI-style slicer bar (T-255, 38th session —
 * UI-307): interactive filter chips for payment method and category that
 * CROSS-FILTER every payments-derived card on the Analytics tab.
 *
 * Semantics (documented in analytics-derivations.ts):
 *   - empty selection = ALL values included (no filter);
 *   - a selected chip INCLUDES its value (multi-select, additive);
 *   - "Réinitialiser" clears both groups;
 *   - the live badge shows the effect of the current selection.
 *
 * The chips list real values only: methods are the 3 canonical PaymentMethod
 * values; categories are the ones actually PRESENT in the period's paid
 * payments (presentCategories — no inert chips for categories with zero
 * activity).
 */
import { Filter, RotateCcw } from "lucide-react";
import { Button } from "../../../../shared/ui/button";
import { PAYMENT_METHOD_LABELS_FR, type PaymentMethod, type PaymentCategory } from "../../../../domain/model/payment";
import { PAYMENT_CATEGORY_LABELS_FR } from "../../../../domain/model/payment";
import { hasActiveFilters, type AnalyticsFilterState } from "./analytics-derivations";
import { formatDzd } from "../../../../core/format/currency";

export interface AnalyticsSlicersProps {
  filters: AnalyticsFilterState;
  onToggleMethod: (method: PaymentMethod) => void;
  onToggleCategory: (category: PaymentCategory) => void;
  onReset: () => void;
  /** Method values renderable as chips (canonical 3). */
  methods: PaymentMethod[];
  /** Category values actually present in the period (presentCategories). */
  categories: PaymentCategory[];
  /** Live effect of the current selection (the filtered slice). */
  filteredCount: number;
  filteredTotal: number;
  /** Unfiltered totals for the honest "sur N" baseline. */
  totalCount: number;
}

function Chip({
  label,
  active,
  onClick,
  title,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors whitespace-nowrap ${
        active
          ? "bg-primary/15 border-primary/60 text-primary"
          : "bg-surface-panel border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

export function AnalyticsSlicers({
  filters,
  onToggleMethod,
  onToggleCategory,
  onReset,
  methods,
  categories,
  filteredCount,
  filteredTotal,
  totalCount,
}: AnalyticsSlicersProps) {
  const active = hasActiveFilters(filters);
  return (
    <div
      className="rounded-lg border border-border bg-surface-panel px-3.5 py-2.5 flex flex-col gap-2"
      data-testid="analytics-slicers"
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Filter className="h-3.5 w-3.5 text-primary" />
          Filtres dynamiques
        </div>
        <div className="flex items-center gap-3">
          <span
            className="text-[11px] font-mono text-muted-foreground tabular-nums"
            data-testid="analytics-slicer-badge"
          >
            {filteredCount} / {totalCount} opérations · {formatDzd(filteredTotal, { compact: true })}
          </span>
          {active && (
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-[11px]"
              onClick={onReset}
              data-testid="analytics-slicer-reset"
            >
              <RotateCcw className="h-3 w-3 mr-1" /> Réinitialiser
            </Button>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <div className="flex items-center gap-1.5 flex-wrap" data-testid="analytics-method-chips">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70 w-max pr-0.5">
            Moyen :
          </span>
          {methods.map((m) => (
            <Chip
              key={m}
              label={PAYMENT_METHOD_LABELS_FR[m]}
              active={filters.methods.has(m)}
              onClick={() => onToggleMethod(m)}
            />
          ))}
        </div>
        {categories.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap" data-testid="analytics-category-chips">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70 w-max pr-0.5">
              Catégorie :
            </span>
            {categories.map((c) => (
              <Chip
                key={c}
                label={PAYMENT_CATEGORY_LABELS_FR[c]}
                active={filters.categories.has(c)}
                onClick={() => onToggleCategory(c)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
