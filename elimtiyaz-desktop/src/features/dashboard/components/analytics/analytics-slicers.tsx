// ============================================================================
// FILE: elimtiyaz-desktop/src/features/dashboard/components/analytics/analytics-slicers.tsx
// ============================================================================

import { Filter, RotateCcw } from "lucide-react";
import { Button } from "../../../../shared/ui/button";
import {
  PAYMENT_METHOD_LABELS_FR,
  type PaymentMethod,
  type PaymentCategory,
} from "../../../../domain/model/payment";
import { PAYMENT_CATEGORY_LABELS_FR, paymentCategoryLabelFr } from "../../../../domain/model/payment";
import {
  hasActiveFilters,
  type AnalyticsFilterState,
} from "./analytics-derivations";
import { formatDzd } from "../../../../core/format/currency";

export interface AnalyticsSlicersProps {
  filters: AnalyticsFilterState;
  onToggleMethod: (method: PaymentMethod) => void;
  onToggleCategory: (category: PaymentCategory | null) => void;
  onReset: () => void;
  methods: PaymentMethod[];
  /** ADR-023: null = the multi-service bucket (labeled via the canonical helper). */
  categories: (PaymentCategory | null)[];
  filteredCount: number;
  filteredTotal: number;
  totalCount: number;
}

function Chip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
        active
          ? "bg-primary text-primary-foreground border-primary shadow-sm font-semibold"
          : "bg-surface-elevated/40 border-border/70 text-muted-foreground hover:border-primary/40 hover:text-foreground"
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
      className="rounded-xl border border-border/70 bg-surface-panel p-3.5 space-y-2.5 shadow-sm"
      data-testid="analytics-slicers"
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Filter className="h-3.5 w-3.5 text-primary" />
          Filtres Dynamiques (Slicers Interactifs)
        </div>

        <div className="flex items-center gap-3">
          <span
            className="text-xs font-mono text-muted-foreground"
            data-testid="analytics-slicer-badge"
          >
            <strong className="text-foreground">{filteredCount}</strong> /{" "}
            {totalCount} opérations ·{" "}
            <strong className="text-status-success font-bold">
              {formatDzd(filteredTotal, { compact: true })}
            </strong>
          </span>
          {active && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2.5 text-xs border-status-danger/30 text-status-danger hover:bg-status-danger/10"
              onClick={onReset}
              data-testid="analytics-slicer-reset"
            >
              <RotateCcw className="h-3 w-3 mr-1" />
              Réinitialiser
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-2 pt-1 border-t border-border/40">
        <div
          className="flex items-center gap-1.5 flex-wrap"
          data-testid="analytics-method-chips"
        >
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-bold pr-1">
            Mode :
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
          <div
            className="flex items-center gap-1.5 flex-wrap"
            data-testid="analytics-category-chips"
          >
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-bold pr-1">
              Pôle :
            </span>
            {categories.map((c) => (
              <Chip
                key={c}
                label={paymentCategoryLabelFr(c)}
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
