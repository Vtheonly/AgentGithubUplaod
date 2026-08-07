/**
 * PaymentSlider — interactive slider that represents the entire annual
 * financial commitment, divided into 3 tranches as proportional segments.
 *
 * Features (per the architectural blueprint):
 *   - Proportional segments: the track is split into 3 tranches, each
 *     occupying its proportional share of the total commitment.
 *   - Magnetic snap points: the handle snaps to tranche boundaries (T1 end,
 *     T2 end, T3 end) plus 0.
 *   - Fine-tuning input: a manual numerical input alongside the slider lets
 *     the operator type custom partial amounts.
 *   - Per-tranche visual: each tranche shows its label, due-date window,
 *     amount, and current paid/remaining state.
 *
 * Plan §07: "The entire slider should represent the three payment tranches.
 * Each tranche should occupy its corresponding percentage of the total
 * slider, with the 34% mark representing the beginning of the next tranche,
 * and each tranche should have its own corresponding price."
 */
import { useMemo } from "react";
import { Magnet } from "lucide-react";
import { Slider } from "../../shared/ui/slider";
import { MoneyInput } from "../../shared/ui/money-input";
import { formatDzd, formatDzdPlain } from "../../core/format/currency";

export interface PaymentTrancheSpec {
  /** Stable identifier for the tranche (e.g. "tuition-T1"). */
  readonly id: string;
  /** Display label (e.g. "Tranche 1"). */
  readonly label: string;
  /** Due-date window label (e.g. "À l'inscription" or "01–15 Déc"). */
  readonly dueWindowLabel: string;
  /** Total amount due for this tranche. */
  readonly amountDue: number;
  /** Amount already paid toward this tranche (before this payment). */
  readonly amountPaid: number;
}

export interface PaymentSliderProps {
  /** The 3 (or fewer) tranches, in chronological order. */
  tranches: readonly PaymentTrancheSpec[];
  /** Current payment amount selected on the slider. */
  value: number;
  /** Callback when the value changes (drag or manual input). */
  onChange: (value: number) => void;
  /** Maximum allowed value. Defaults to sum of all tranche amountDue. */
  max?: number;
  /** Disabled state. */
  disabled?: boolean;
}

/** Snap threshold in DZD — if the slider is within this distance of a snap point, snap. */
const SNAP_THRESHOLD_DZD = 500;

/**
 * Compute the cumulative snap points from a list of tranches.
 * Each tranche contributes one snap point at its right edge.
 * The first snap point is always 0.
 */
function snapPoints(tranches: readonly PaymentTrancheSpec[]): number[] {
  const points = [0];
  let cumulative = 0;
  for (const t of tranches) {
    cumulative += t.amountDue;
    points.push(cumulative);
  }
  return points;
}

/** Apply magnetic snapping to a value. */
function snap(value: number, points: number[]): number {
  for (const p of points) {
    if (Math.abs(value - p) <= SNAP_THRESHOLD_DZD) return p;
  }
  return value;
}

export function PaymentSlider({
  tranches,
  value,
  onChange,
  max,
  disabled,
}: PaymentSliderProps) {
  const totalDue = useMemo(
    () => tranches.reduce((s, t) => s + t.amountDue, 0),
    [tranches],
  );
  const maxAmount = max ?? totalDue;
  const snaps = useMemo(() => snapPoints(tranches), [tranches]);

  if (tranches.length === 0 || totalDue === 0) {
    return (
      <div className="rounded-lg border border-border bg-muted/20 p-4 text-center text-xs text-muted-foreground">
        Aucune tranche à afficher — sélectionnez un parent avec des échéances impayées.
      </div>
    );
  }

  // Compute the cumulative boundaries for the tranche strip overlay.
  const cumulativeBoundaries: number[] = [];
  let cum = 0;
  for (const t of tranches) {
    cum += t.amountDue;
    cumulativeBoundaries.push(cum);
  }

  // Slider value as a percentage of maxAmount.
  const sliderPct = maxAmount > 0 ? (value / maxAmount) * 100 : 0;

  // Compute "paying now" distribution per tranche (for the live preview row).
  let remainingToAllocate = value;
  const tranchePayingNow = tranches.map((t) => {
    const remaining = Math.max(0, t.amountDue - t.amountPaid);
    const allocated = Math.min(remainingToAllocate, remaining);
    remainingToAllocate -= allocated;
    return allocated;
  });
  const overpayment = Math.max(0, remainingToAllocate);

  return (
    <div className="space-y-4">
      {/* Tranche strip — visual segmented track above the slider */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Tranches (engagement annuel)
          </p>
          <p className="text-[10px] text-muted-foreground flex items-center gap-1">
            <Magnet className="h-3 w-3" />
            Aimanté aux bornes de tranches
          </p>
        </div>
        <div className="relative h-9 w-full overflow-hidden rounded-md border border-border bg-muted">
          {tranches.map((t, i) => {
            const leftPct = i === 0 ? 0 : (cumulativeBoundaries[i - 1] / maxAmount) * 100;
            const widthPct = (t.amountDue / maxAmount) * 100;
            const isFullyPaid = t.amountPaid >= t.amountDue && t.amountDue > 0;
            return (
              <div
                key={t.id}
                className={`absolute inset-y-0 flex flex-col items-center justify-center border-r border-border last:border-r-0 px-1 text-center ${
                  isFullyPaid ? "bg-status-success/25" : "bg-primary/10"
                }`}
                style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
              >
                <span className="text-[10px] font-medium leading-tight truncate w-full text-center">
                  {t.label}
                </span>
                <span className="text-[9px] text-muted-foreground leading-tight truncate w-full text-center">
                  {t.dueWindowLabel}
                </span>
              </div>
            );
          })}
          {/* Slider handle position marker */}
          <div
            className="absolute inset-y-0 w-0.5 bg-foreground/60 pointer-events-none"
            style={{ left: `${sliderPct}%` }}
          />
        </div>
        {/* Cumulative scale labels */}
        <div className="relative h-4 mt-0.5 text-[9px] text-muted-foreground">
          <span className="absolute left-0">0</span>
          {cumulativeBoundaries.map((b, i) => (
            <span
              key={i}
              className="absolute -translate-x-1/2"
              style={{ left: `${(b / maxAmount) * 100}%` }}
            >
              {formatDzdPlain(b)}
            </span>
          ))}
        </div>
      </div>

      {/* Slider itself */}
      <div className="pt-2">
        <Slider
          value={[value]}
          min={0}
          max={maxAmount}
          step={100}
          disabled={disabled}
          onValueChange={(vals) => {
            const v = vals[0] ?? 0;
            onChange(snap(v, snaps));
          }}
          aria-label="Montant du paiement"
        />
      </div>

      {/* Manual input + quick snap buttons */}
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <p className="text-[10px] uppercase text-muted-foreground mb-1">Montant précis</p>
          <MoneyInput value={value} onChange={(v) => onChange(v)} disabled={disabled} />
        </div>
        <div>
          <p className="text-[10px] uppercase text-muted-foreground mb-1">Raccourcis tranche</p>
          <div className="flex flex-wrap gap-1.5">
            <SnapButton label="0" onClick={() => onChange(0)} disabled={disabled} />
            {tranches.map((t, i) => (
              <SnapButton
                key={t.id}
                label={t.label}
                amount={cumulativeBoundaries[i]}
                onClick={() => onChange(cumulativeBoundaries[i])}
                disabled={disabled}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Per-tranche live preview */}
      <div className="rounded-md border border-border">
        <div className="border-b border-border px-3 py-1.5 bg-muted/30">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Répartition du paiement
          </p>
        </div>
        <ul className="divide-y divide-border text-xs">
          {tranches.map((t, i) => {
            const allocated = tranchePayingNow[i];
            const newPaid = t.amountPaid + allocated;
            const willComplete = allocated > 0 && newPaid >= t.amountDue;
            const remainingAfter = Math.max(0, t.amountDue - newPaid);
            return (
              <li key={t.id} className="grid grid-cols-12 gap-2 items-center px-3 py-2">
                <div className="col-span-3">
                  <p className="font-medium">{t.label}</p>
                  <p className="text-[10px] text-muted-foreground">{t.dueWindowLabel}</p>
                </div>
                <div className="col-span-3 text-muted-foreground">
                  <p>Dû : <span className="font-mono">{formatDzdPlain(t.amountDue)}</span></p>
                  <p>Déjà payé : <span className="font-mono">{formatDzdPlain(t.amountPaid)}</span></p>
                </div>
                <div className="col-span-3 text-primary">
                  <p>+ Maintenant :</p>
                  <p className="font-mono font-semibold">{formatDzdPlain(allocated)}</p>
                </div>
                <div className="col-span-3 text-right">
                  {willComplete ? (
                    <span className="text-status-success font-medium">✓ Soldée</span>
                  ) : (
                    <p className="text-muted-foreground">
                      Reste : <span className="font-mono">{formatDzdPlain(remainingAfter)}</span>
                    </p>
                  )}
                </div>
              </li>
            );
          })}
          {overpayment > 0.5 && (
            <li className="px-3 py-2 bg-status-warning/10 text-status-warning">
              <div className="flex justify-between">
                <span className="font-medium">Excédent (crédit parent)</span>
                <span className="font-mono">+{formatDzdPlain(overpayment)}</span>
              </div>
            </li>
          )}
        </ul>
      </div>

      {/* Total summary */}
      <div className="rounded-md border border-border bg-muted/30 px-3 py-2 flex justify-between items-center">
        <span className="text-sm font-semibold">Paiement sélectionné</span>
        <span className="font-mono text-base font-bold text-primary">{formatDzd(value)}</span>
      </div>
    </div>
  );
}

function SnapButton({
  label,
  amount,
  onClick,
  disabled,
}: {
  label: string;
  amount?: number;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-md border border-border bg-background px-2 py-1 text-[10px] hover:border-primary hover:bg-accent/5 transition-colors disabled:opacity-50 disabled:pointer-events-none"
      title={amount !== undefined ? formatDzd(amount) : label}
    >
      {label}{amount !== undefined && amount > 0 ? ` · ${formatDzdPlain(amount)}` : ""}
    </button>
  );
}
