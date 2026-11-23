/**
 * AdaptivePaymentSlider — interactive slider that adapts its rendering and
 * snap-point calculation to one of three payment modes.
 *
 * UNIFIED ARCHITECTURE (this revision):
 *   - `mode` prop selects between:
 *     * `single_item`         — Single non-divisible item (club, uniform, apron).
 *                               Slider snaps to 0 and 100% (Net Price). When
 *                               `allowPartial = false`, mid-values snap back to 100%.
 *     * `installment_tranche` — 1–3 tuition/transport tranches. Proportional
 *                               segments + magnetic snap points computed from
 *                               REMAINING unpaid balances (NOT gross amountDue).
 *     * `consolidated_debt`   — N segments grouped by child/service in chronological
 *                               due-date order. Snap points at each child's debt
 *                               boundary.
 *   - SNAP-POINT BUG FIX: The original `snapPoints` function used
 *     `cumulative += t.amountDue` — this snapped to the GROSS tranche amount,
 *     so a tranche that was already 30% paid would still snap at its full
 *     gross amount, forcing the user to over-pay by 30% to hit the snap.
 *     The fix: snap on REMAINING debt `max(0, amountDue - amountPaid)`.
 *   - T-498 (INV-4 parity): every remaining computation in this view now
 *     subtracts `amountPending` too (the canonical INV-4 form — an uncleared
 *     cheque covering a tranche is coverage, not open debt). The spec carries
 *     the field from the installments stream; quote line items leave it 0.
 *   - The component remains a PURE VIEW — all financial math comes from
 *     the `tranches` spec passed in by the caller (Zero-Logic Rule).
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
import { installmentRemaining } from "../../domain/calc/payment/queries";
import { TooltipHint } from "../../shared/ui/tooltip";

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
  /** T-498 (INV-4): uncleared funds already covering this tranche (e.g. a
   *  pending cheque) — coverage, not open debt. Optional so quote-driven
   *  line items (no clearance lifecycle) can omit it. */
  readonly amountPending?: number | null;
}

/** Adaptive slider operational mode — see file header for details. */
export type PaymentSliderMode = "single_item" | "installment_tranche" | "consolidated_debt";

export interface PaymentSliderProps {
  /** The 1–3 (or N for consolidated_debt) tranches, in chronological order. */
  tranches: readonly PaymentTrancheSpec[];
  /** Current payment amount selected on the slider. */
  value: number;
  /** Callback when the value changes (drag or manual input). */
  onChange: (value: number) => void;
  /** Maximum allowed value. Defaults to sum of all tranche REMAINING balances. */
  max?: number;
  /** Disabled state. */
  disabled?: boolean;
  /** Operational mode — drives rendering + snap behavior. Defaults to "installment_tranche". */
  mode?: PaymentSliderMode;
  /** Whether partial payments are permitted. When `false` and `mode === "single_item"`,
   *  mid-values snap back to 100% on release. Defaults to `true`. */
  allowPartial?: boolean;
}

/** Snap threshold in DZD — if the slider is within this distance of a snap point, snap. */
const SNAP_THRESHOLD_DZD = 500;

/**
 * BUG-048 (T-578): the cumulative scale labels collided when two boundaries
 * sat close together (the last label also overflowed the right edge by half
 * its width under `-translate-x-1/2`). The guard: a label renders only when
 * the gap to its nearest included RIGHT neighbor fits both half-widths; the
 * LAST boundary always renders, right-clamped (`right-0 translate-x-0`).
 * Widths are estimated at a conservative 320 px container (the worst case —
 * wider containers only gain room). Pure + unit-tested.
 */
export interface BoundaryLabel {
  readonly index: number;
  readonly text: string;
  readonly leftPct: number;
  readonly clampRight: boolean;
}

const BOUNDARY_CHAR_PX = 5; // text-[9px] digit estimate
const BOUNDARY_CONTAINER_PX = 320; // conservative (worst-case) container width

export function visibleBoundaryLabels(
  boundaries: readonly number[],
  maxAmount: number,
  containerPx: number = BOUNDARY_CONTAINER_PX,
): BoundaryLabel[] {
  if (boundaries.length === 0 || maxAmount <= 0) return [];
  const labels = boundaries.map((b, i) => {
    const text = formatDzdPlain(b);
    const widthPct = ((text.length * BOUNDARY_CHAR_PX + 4) / containerPx) * 100;
    const leftPct = (b / maxAmount) * 100;
    return { index: i, text, leftPct, halfPct: widthPct / 2 };
  });
  const out: BoundaryLabel[] = [];
  let rightNeighborLeftEdge: number | null = null;
  for (let i = labels.length - 1; i >= 0; i--) {
    const l = labels[i];
    if (i === labels.length - 1) {
      out.unshift({ index: l.index, text: l.text, leftPct: l.leftPct, clampRight: true });
      // The clamped label occupies [100 − width, 100].
      rightNeighborLeftEdge = 100 - l.halfPct * 2;
      continue;
    }
    const myRightEdge = l.leftPct + l.halfPct;
    if (rightNeighborLeftEdge === null || myRightEdge <= rightNeighborLeftEdge - 0.5) {
      out.unshift({ index: l.index, text: l.text, leftPct: l.leftPct, clampRight: false });
      rightNeighborLeftEdge = l.leftPct - l.halfPct;
    }
  }
  return out;
}

/**
 * Compute the cumulative snap points from a list of tranches using
 * REMAINING unpaid balances.
 *
 * BUG FIX (this revision): The original implementation used
 *   `cumulative += t.amountDue`
 * which snapped to the GROSS tranche amount. If a tranche had
 * `amountDue = 100,000` and `amountPaid = 30,000`, the snap point was
 * at 100,000 — forcing the user to drag 30,000 past the actual remaining
 * debt (70,000) to hit the snap. The fix uses `max(0, amountDue - amountPaid)`.
 *
 * Snap points array:
 *   [0, Rem_1, Rem_1 + Rem_2, Rem_1 + Rem_2 + Rem_3, ...]
 *
 * Tranches that are already fully paid (`remaining === 0`) contribute
 * no new snap point — they're skipped.
 */
function snapPointsFromRemaining(tranches: readonly PaymentTrancheSpec[]): number[] {
  const points = [0];
  let cumulative = 0;
  for (const t of tranches) {
    // T-498: INV-4 form — pending coverage reduces the snap target.
    const remaining = installmentRemaining(t);
    if (remaining <= 0) continue; // skip fully-paid tranches
    cumulative += remaining;
    points.push(cumulative);
  }
  return points;
}

/**
 * Legacy snap-points function (uses gross `amountDue`).
 * Kept for backward compatibility but NOT used by default —
 * `snapPointsFromRemaining` is the correct implementation.
 */
function snapPointsFromGross(tranches: readonly PaymentTrancheSpec[]): number[] {
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
  mode = "installment_tranche",
  allowPartial = true,
}: PaymentSliderProps) {
  // Total REMAINING debt across all tranches — used as the default max.
  // T-498: INV-4 form (pending uncleared funds are coverage).
  const totalRemaining = useMemo(
    () => tranches.reduce((s, t) => s + installmentRemaining(t), 0),
    [tranches],
  );
  // Total GROSS debt — used for the proportional segment widths (visual only).
  const totalDue = useMemo(
    () => tranches.reduce((s, t) => s + t.amountDue, 0),
    [tranches],
  );
  const maxAmount = max ?? Math.max(totalRemaining, totalDue);
  // CRITICAL FIX: snap points now use REMAINING balances.
  const snaps = useMemo(() => snapPointsFromRemaining(tranches), [tranches]);
  // Legacy gross snap points — kept for the cumulative-scale labels (visual).
  const grossBoundaries = useMemo(() => snapPointsFromGross(tranches), [tranches]);

  if (tranches.length === 0 || totalDue === 0) {
    return (
      <div className="rounded-lg border border-border bg-muted/20 p-4 text-center text-xs text-muted-foreground">
        Aucune tranche à afficher — sélectionnez un parent avec des échéances impayées.
      </div>
    );
  }

  // Cumulative REMAINING boundaries — drive the tranche strip overlay widths.
  const cumulativeRemainingBoundaries: number[] = [];
  let cumRem = 0;
  for (const t of tranches) {
    cumRem += installmentRemaining(t);
    cumulativeRemainingBoundaries.push(cumRem);
  }

  // Slider value as a percentage of maxAmount.
  const sliderPct = maxAmount > 0 ? (value / maxAmount) * 100 : 0;

  // Compute "paying now" distribution per tranche (for the live preview row).
  let remainingToAllocate = value;
  const tranchePayingNow = tranches.map((t) => {
    const remaining = installmentRemaining(t);
    const allocated = Math.min(remainingToAllocate, remaining);
    remainingToAllocate -= allocated;
    return allocated;
  });
  const overpayment = Math.max(0, remainingToAllocate);

  // Mode-specific behaviors
  const handleSliderChange = (vals: number[]) => {
    const v = vals[0] ?? 0;
    let snapped = snap(v, snaps);
    // single_item + !allowPartial: snap mid-values to the net price (100%).
    if (mode === "single_item" && !allowPartial) {
      const netPrice = totalRemaining; // for single_item, totalRemaining = net price
      if (snapped > 0 && snapped < netPrice) {
        snapped = netPrice; // force to 100%
      }
    }
    onChange(snapped);
  };

  return (
    <div className="space-y-4">
      {/* Mode badge */}
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {mode === "single_item" && "Article / Service unique"}
          {mode === "installment_tranche" && "Tranches (engagement annuel)"}
          {mode === "consolidated_debt" && "Dette consolidée famille"}
        </p>
        <p className="text-[10px] text-muted-foreground flex items-center gap-1">
          <Magnet className="h-3 w-3" />
          Aimanté aux soldes restants
        </p>
      </div>

      {/* Tranche strip — visual segmented track above the slider.
          Widths are proportional to REMAINING debt (not gross).
          BUG-048 (T-578): the strip is taller (h-11) and a segment narrower
          than 12% drops its due-window sub-label (the collision source). */}
      <div>
        <div className="relative h-11 w-full overflow-hidden rounded-md border border-border bg-muted">
          {tranches.map((t, i) => {
            const leftPct = i === 0 ? 0 : (cumulativeRemainingBoundaries[i - 1] / maxAmount) * 100;
            const widthPct = (installmentRemaining(t) / maxAmount) * 100;
            const isFullyPaid = t.amountPaid + (t.amountPending ?? 0) >= t.amountDue && t.amountDue > 0;
            const isCleared = isFullyPaid;
            return (
              <div
                key={t.id}
                className={`absolute inset-y-0 flex flex-col items-center justify-center border-r border-border last:border-r-0 px-1 text-center ${
                  isCleared
                    ? "bg-status-success/25"
                    : widthPct > 0
                      ? "bg-primary/10"
                      : "bg-muted/40"
                }`}
                style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
              >
                <span className="text-[10px] font-medium leading-tight truncate w-full text-center">
                  {t.label}
                </span>
                {/* BUG-048: a segment narrower than 12% cannot fit the
                    due-window sub-label without colliding — drop it (the
                    label above + the boundary scale still carry the info). */}
                {widthPct >= 12 && (
                  <span className="text-[9px] text-muted-foreground leading-tight truncate w-full text-center">
                    {t.dueWindowLabel}
                  </span>
                )}
              </div>
            );
          })}
          {/* Slider handle position marker */}
          <div
            className="absolute inset-y-0 w-0.5 bg-foreground/60 pointer-events-none"
            style={{ left: `${sliderPct}%` }}
          />
        </div>
        {/* Cumulative REMAINING scale labels (bug fix: was gross amounts).
            BUG-048 (T-578): collision-guarded — a label renders only when
            the gap to its right neighbor fits both half-widths; the LAST
            boundary is always rendered, right-clamped (never half off the
            edge). */}
        <div className="relative h-4 mt-0.5 text-[9px] text-muted-foreground">
          <span className="absolute left-0">0</span>
          {visibleBoundaryLabels(cumulativeRemainingBoundaries, maxAmount).map((l) => (
            <span
              key={l.index}
              className={l.clampRight ? "absolute right-0 translate-x-0" : "absolute -translate-x-1/2"}
              style={l.clampRight ? undefined : { left: `${l.leftPct}%` }}
            >
              {l.text}
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
          onValueChange={handleSliderChange}
          aria-label="Montant du paiement"
        />
      </div>

      {/* single_item + !allowPartial warning */}
      {mode === "single_item" && !allowPartial && value > 0 && value < totalRemaining && (
        <p className="text-[11px] text-status-warning">
          Ce service nécessite un règlement complet — le montant sera ajusté à {formatDzdPlain(totalRemaining)}.
        </p>
      )}

      {/* Manual input + quick snap buttons */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <p className="text-[10px] uppercase text-muted-foreground mb-1">Montant précis</p>
          <MoneyInput value={value} onChange={(v) => onChange(v)} disabled={disabled} />
        </div>
        <div>
          <p className="text-[10px] uppercase text-muted-foreground mb-1">Raccourcis tranche</p>
          <div className="flex flex-wrap gap-1.5">
            <SnapButton label="0" onClick={() => onChange(0)} disabled={disabled} />
            {tranches.map((t, i) => {
              // Snap buttons also use REMAINING boundaries (bug fix, INV-4).
              const remaining = installmentRemaining(t);
              if (remaining <= 0) return null; // skip fully-paid
              return (
                <SnapButton
                  key={t.id}
                  label={t.label}
                  amount={cumulativeRemainingBoundaries[i]}
                  onClick={() => onChange(cumulativeRemainingBoundaries[i])}
                  disabled={disabled}
                />
              );
            })}
            <SnapButton
              label="Solde Total"
              amount={totalRemaining}
              onClick={() => onChange(totalRemaining)}
              disabled={disabled}
            />
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
            const willComplete = allocated > 0 && installmentRemaining({ ...t, amountPaid: newPaid }) === 0;
            const remainingAfter = installmentRemaining({ ...t, amountPaid: newPaid });
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

      {/* Silence unused var — grossBoundaries is kept for future visualizations. */}
      <span className="hidden">{grossBoundaries.length}</span>
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
    <TooltipHint content={amount !== undefined ? formatDzd(amount) : label}><button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-md border border-border bg-background px-2 py-1 text-[10px] hover:border-primary hover:bg-accent/5 transition-colors disabled:opacity-50 disabled:pointer-events-none"
    >
      {label}{amount !== undefined && amount > 0 ? ` · ${formatDzdPlain(amount)}` : ""}
    </button></TooltipHint>
  );
}

/**
 * Backward-compat alias — `PaymentSlider` is the canonical export, but
 * callers adopting the unified architecture can import `AdaptivePaymentSlider`
 * by name to make the intent explicit.
 */
export const AdaptivePaymentSlider = PaymentSlider;
