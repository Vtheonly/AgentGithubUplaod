// ============================================================================
// FILE: elimtiyaz-desktop/src/features/personnel/onboarding/steps/working-days-step.tsx
// ============================================================================
/**
 * T-515 (WORKFORCE-516, the owner's issue 3): the working-DAYS calendar —
 * the replacement for the removed working-HOURS configuration.
 *
 * THE MANDATE: "Remove the working-hours configuration and keep only the
 * working days of the month. Make the working days configurable through
 * toggles for each day of the month. Instead of configuring working hours,
 * provide a calendar-based interface where users can select or deselect
 * working days. Based on the selected days, automatically calculate and
 * display the total number of working days for the selected month."
 *
 * THE SURFACE: a month navigator (‹ Mois Année ›) + a calendar grid of
 * per-day toggle buttons + the quick-selection helpers (the school week
 * Dim–Jeu / all / none — conveniences, every day stays individually
 * toggleable) + the AUTO-COMPUTED TOTAL ("N jours ouvrés en {mois}") —
 * the mandate's explicit display requirement.
 *
 * PERSISTENCE: the same `repos.onboarding.updateData()` seam the other
 * steps use, now writing the T-515 `workingDays: {year, month, days}`
 * shape (the domain model's new contract — domain/model/workforce.ts).
 */
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useRepositories } from "../../../../app/providers/repository-provider";
import { useObservable } from "../../../../shared/hooks/use-observable";
import { Card, CardContent } from "../../../../shared/ui/card";
import { Button } from "../../../../shared/ui/button";
import { cn } from "../../../../shared/ui/cn";
import {
  daysInMonth,
  schoolWeekDaysOfMonth,
  type OnboardingData,
  type WorkingDaysConfig,
} from "../../../../domain/model/workforce";
import { StepHeader } from "./step-header";

/** The calendar's column headers — Sunday-first (the Algerian week). */
const WEEKDAY_HEADS = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"] as const;

/** French month names (1–12). */
const MONTH_LABELS_FR = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
] as const;

/** The (0-based) weekday of each day cell, Sunday-first. */
function weekdayColumnOf(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Shift the month cursor by ±1 month (rolling over the year). */
function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const zero = year * 12 + (month - 1) + delta;
  return { year: Math.floor(zero / 12), month: (zero % 12) + 1 };
}

export function WorkingDaysStep() {
  const repos = useRepositories();
  const state = useObservable(() => repos.onboarding.observe(), []);

  if (!state) return null;
  const wd: WorkingDaysConfig = state.data.workingDays;

  async function persist(next: WorkingDaysConfig) {
    await repos.onboarding.updateData({ workingDays: next } as Partial<OnboardingData>);
  }

  /** Toggle one day of the month (the mandate's core interaction). */
  async function toggleDay(day: number) {
    const set = new Set(wd.days);
    if (set.has(day)) set.delete(day);
    else set.add(day);
    await persist({ ...wd, days: [...set].sort((a, b) => a - b) });
  }

  /** Navigate to the adjacent month (the new month starts on the school week). */
  async function gotoMonth(delta: number) {
    const { year, month } = shiftMonth(wd.year, wd.month, delta);
    await persist({ year, month, days: schoolWeekDaysOfMonth(year, month) });
  }

  const total = daysInMonth(wd.year, wd.month);
  // The calendar grid: 7 columns, Sunday-first, offset blanks before day 1.
  const firstColumn = weekdayColumnOf(wd.year, wd.month, 1);
  const blanks = Array.from({ length: firstColumn }, (_, i) => i);

  return (
    <div className="space-y-4">
      <StepHeader
        icon={CalendarDays}
        title="Quels sont les jours ouvrés du mois ?"
        description="Sélectionnez les jours travaillés du mois. Le total des jours ouvrés est calculé automatiquement."
      />
      <Card>
        <CardContent className="p-5 space-y-5" data-testid="working-days-step">
          {/* ── The month navigator ──────────────────────────────── */}
          <div className="flex items-center justify-between max-w-md">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-7 w-7"
              onClick={() => void gotoMonth(-1)}
              aria-label="Mois précédent"
              data-testid="wd-prev-month"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <p className="text-sm font-semibold" data-testid="wd-month-label">
              {MONTH_LABELS_FR[wd.month - 1]} {wd.year}
            </p>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-7 w-7"
              onClick={() => void gotoMonth(1)}
              aria-label="Mois suivant"
              data-testid="wd-next-month"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          {/* ── The calendar grid (per-day toggles) ──────────────── */}
          <div className="grid grid-cols-7 gap-1.5 max-w-md" role="grid" data-testid="wd-calendar">
            {WEEKDAY_HEADS.map((head) => (
              <div
                key={head}
                className="text-center text-[11px] font-medium text-muted-foreground pb-1"
                role="columnheader"
              >
                {head}
              </div>
            ))}
            {blanks.map((i) => (
              <div key={`blank-${i}`} aria-hidden="true" />
            ))}
            {Array.from({ length: total }, (_, i) => i + 1).map((day) => {
              const selected = wd.days.includes(day);
              return (
                <button
                  key={day}
                  type="button"
                  role="gridcell"
                  aria-pressed={selected}
                  aria-label={`Jour ${day} — ${selected ? "ouvré" : "non ouvré"}`}
                  data-testid={`wd-day-${day}`}
                  onClick={() => void toggleDay(day)}
                  className={cn(
                    "h-9 rounded-md border text-xs font-mono font-medium transition-colors",
                    selected
                      ? "border-primary bg-primary/15 text-primary"
                      : "border-border text-muted-foreground hover:bg-accent/10",
                  )}
                >
                  {day}
                </button>
              );
            })}
          </div>

          {/* ── The quick selections (conveniences, not constraints) ── */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() =>
                void persist({ ...wd, days: schoolWeekDaysOfMonth(wd.year, wd.month) })
              }
              data-testid="wd-school-week"
            >
              Semaine (Dim–Jeu)
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() =>
                void persist({
                  ...wd,
                  days: Array.from({ length: total }, (_, i) => i + 1),
                })
              }
              data-testid="wd-select-all"
            >
              Tout
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => void persist({ ...wd, days: [] })}
              data-testid="wd-select-none"
            >
              Aucun
            </Button>
          </div>

          {/* ── The AUTO-COMPUTED TOTAL (the mandate's display) ───── */}
          <div
            className="flex items-center justify-between rounded-md border bg-primary/5 border-primary/20 px-3 py-2 max-w-md"
            data-testid="wd-total"
          >
            <span className="text-xs text-muted-foreground">Total des jours ouvrés</span>
            <span className="text-sm font-bold text-primary">
              {wd.days.length} jour{wd.days.length === 1 ? "" : "s"}
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
