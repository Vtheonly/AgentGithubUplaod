/**
 * AcademicYearSelector — dynamic academic year + date-range filter.
 *
 * Iteration 9 — replaces the static "Année 2025-2026" header button on
 * the dashboard with an interactive control that:
 *   - Switches between academic years (e.g. 2024–2025, 2025–2026, 2026–2027)
 *   - Filters dashboard metrics by month, quarter, or custom date range
 *   - Surfaces the currently-active filter as a compact badge
 *
 * The selector uses a DropdownMenu (no separate modal) so users can switch
 * quickly without losing context. All changes call back to the parent
 * component which re-fetches dashboard data with the new range.
 */
import { useState, useMemo } from "react";
import { Calendar, ChevronDown, X } from "lucide-react";
import { Button } from "../../shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../shared/ui/dropdown-menu";
import { cn } from "../../shared/ui/cn";

export interface AcademicYearRange {
  /** Academic year code, e.g. "2025-2026". */
  academicYear: string;
  /** Optional finer-grained date range (ISO dates). */
  range?: { from: string; to: string };
  /** Preset that produced this range (for badge display). */
  preset: DateRangePreset;
}

export type DateRangePreset = "ytd" | "month" | "quarter" | "custom";

interface AcademicYearSelectorProps {
  value: AcademicYearRange;
  onChange: (next: AcademicYearRange) => void;
  /** Available academic years, e.g. ["2024-2025", "2025-2026", "2026-2027"]. */
  availableYears: readonly string[];
}

const PRESET_LABELS_FR: Record<DateRangePreset, string> = {
  ytd: "Année complète",
  month: "Mois courant",
  quarter: "Trimestre courant",
  custom: "Personnalisé",
};

/**
 * Compute the [from, to] ISO date window for an academic year + preset.
 * Used by callers to convert the selector's value into a dashboard query range.
 */
export function computeDateRange(
  academicYear: string,
  preset: DateRangePreset,
  now: Date = new Date(),
): { from: string; to: string } {
  const m = /^(\d{4})-(\d{4})$/.exec(academicYear);
  const startYear = m ? parseInt(m[1], 10) : now.getFullYear();
  const yearStart = new Date(startYear, 8, 1); // Sep 1
  const yearEnd = new Date(startYear + 1, 8, 1); // Sep 1 next year

  if (preset === "ytd") {
    return {
      from: yearStart.toISOString().slice(0, 10),
      to: yearEnd.toISOString().slice(0, 10),
    };
  }
  if (preset === "month") {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return {
      from: monthStart.toISOString().slice(0, 10),
      to: monthEnd.toISOString().slice(0, 10),
    };
  }
  if (preset === "quarter") {
    // Quarters: Q1 = Sep-Nov, Q2 = Dec-Feb, Q3 = Mar-May, Q4 = May-Jul (academic year aligned)
    const month = now.getMonth();
    let qStart: Date;
    if (month >= 8 && month <= 10) qStart = new Date(now.getFullYear(), 8, 1);
    else if (month === 11 || month <= 1) qStart = new Date(now.getFullYear() - (month === 11 ? 0 : 1), 11, 1);
    else if (month >= 2 && month <= 4) qStart = new Date(now.getFullYear(), 2, 1);
    else qStart = new Date(now.getFullYear(), 5, 1);
    const qEnd = new Date(qStart);
    qEnd.setMonth(qEnd.getMonth() + 3);
    return {
      from: qStart.toISOString().slice(0, 10),
      to: qEnd.toISOString().slice(0, 10),
    };
  }
  // custom — return current month range as a sensible default.
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return {
    from: monthStart.toISOString().slice(0, 10),
    to: monthEnd.toISOString().slice(0, 10),
  };
}

export function AcademicYearSelector({
  value,
  onChange,
  availableYears,
}: AcademicYearSelectorProps) {
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const presetLabel = useMemo(() => PRESET_LABELS_FR[value.preset], [value.preset]);
  const showActiveFilter = value.preset !== "ytd";

  function selectYear(year: string) {
    const range = computeDateRange(year, value.preset);
    onChange({ academicYear: year, range, preset: value.preset });
  }

  function selectPreset(preset: DateRangePreset) {
    const range = computeDateRange(value.academicYear, preset);
    onChange({ academicYear: value.academicYear, range, preset });
  }

  function applyCustom() {
    if (!customFrom || !customTo) return;
    onChange({
      academicYear: value.academicYear,
      range: { from: customFrom, to: customTo },
      preset: "custom",
    });
  }

  function reset() {
    const range = computeDateRange(value.academicYear, "ytd");
    onChange({ academicYear: value.academicYear, range, preset: "ytd" });
  }

  return (
    <div className="flex items-center gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1.5">
            <Calendar className="h-3.5 w-3.5" />
            <span className="font-mono text-xs">{value.academicYear}</span>
            <span className="text-[10px] text-muted-foreground">·</span>
            <span className="text-[10px] text-muted-foreground">{presetLabel}</span>
            <ChevronDown className="h-3 w-3 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel>Année académique</DropdownMenuLabel>
          {availableYears.map((year) => (
            <DropdownMenuItem
              key={year}
              onClick={() => selectYear(year)}
              className={cn(
                "flex items-center justify-between",
                year === value.academicYear && "bg-primary/10 text-primary",
              )}
            >
              <span className="font-mono text-xs">{year}</span>
              {year === value.academicYear && <span className="text-[10px]">✓</span>}
            </DropdownMenuItem>
          ))}

          <DropdownMenuSeparator />
          <DropdownMenuLabel>Filtrer par période</DropdownMenuLabel>
          {(["ytd", "month", "quarter"] as const).map((preset) => (
            <DropdownMenuItem
              key={preset}
              onClick={() => selectPreset(preset)}
              className={cn(
                "flex items-center justify-between",
                value.preset === preset && "bg-primary/10 text-primary",
              )}
            >
              <span className="text-xs">{PRESET_LABELS_FR[preset]}</span>
              {value.preset === preset && <span className="text-[10px]">✓</span>}
            </DropdownMenuItem>
          ))}

          <DropdownMenuSeparator />
          <DropdownMenuLabel>Plage personnalisée</DropdownMenuLabel>
          <div className="px-2 py-1 space-y-2">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] uppercase text-muted-foreground">Du</label>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="text-xs rounded border border-border bg-background px-2 py-1"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] uppercase text-muted-foreground">Au</label>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="text-xs rounded border border-border bg-background px-2 py-1"
              />
            </div>
            <Button size="sm" className="w-full h-7 text-xs" onClick={applyCustom} disabled={!customFrom || !customTo}>
              Appliquer
            </Button>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      {showActiveFilter && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-[10px] text-muted-foreground"
          onClick={reset}
          title="Réinitialiser le filtre"
        >
          <X className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}
