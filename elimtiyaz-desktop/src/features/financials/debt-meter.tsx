/**
 * UnifiedDebtMeter — color-coded progress bar that visualizes the parent's
 * payment state alongside an in-progress payment.
 *
 * Shows:
 *   - Total amount due
 *   - Already-paid amount (green)
 *   - Paying-now amount (blue)
 *   - Remaining debt after this payment (gray)
 *   - Current tranche focus indicator
 *   - Overpaid / Underpaid badge
 *   - Parent credit balance (when overpayment has been banked)
 *
 * UNIFIED ARCHITECTURE (this revision):
 *   - New optional `unallocatedCredit` prop displays the parent's banked
 *     credit balance (from prior overpayments) as a distinct row, making
 *     it clear when future invoices will be auto-absorbed.
 *   - Enhanced status badges: "Dette entièrement soldée" (when remaining
 *     hits 0), "Excédent de +X (Crédit Parent)" (when overpaying), and
 *     "Tranche cible : [Label]" (when paying toward a specific tranche).
 *   - `UnifiedDebtMeter` is exported as an alias for `DebtMeter` so
 *     callers adopting the unified architecture can use the new name.
 *
 * Plan §07 architectural blueprint: "Alongside the slider, add a debt meter
 * that clearly shows: how much has been paid, how much is still owed, the
 * total amount due, the remaining balance, the payment progress."
 */
import { formatDzdPlain } from "../../core/format/currency";
import { StatusChip } from "../../shared/ui/status-chip";

export interface DebtMeterProps {
  /** Total annual commitment (sum of all installment amountDue). */
  totalDue: number;
  /** Cumulative amount already paid across all cleared installments. */
  alreadyPaid: number;
  /** Amount being paid right now (the slider's current value). */
  payingNow: number;
  /** Label of the tranche currently being satisfied (e.g. "Tranche 2"). */
  currentTrancheLabel: string | null;
  /** Optional note about which tranche will be completed/cleared. */
  statusNote?: string | null;
  /**
   * Optional parent's banked credit MAGNITUDE (always >= 0; 0 hides the row).
   * T-157 (ADR-010 residual wiring): the value passed here MUST be the
   * ADR-010 display derivation `displayParentCredit(totalOutstanding,
   * totalUnallocatedCredit)` — the raw ledger balance double-counts the
   * credit for canonical-path overpayments (DATA-009), and the raw
   * unallocated Σ is wrong for 0062-era historical overpayers (no credit
   * entries exist; the raw negative balance is exact there). Positive
   * numbers represent the magnitude (e.g. 5000 = 5,000 DA credit).
   * Defaults to 0 (no credit).
   */
  unallocatedCredit?: number;
}

export function DebtMeter({
  totalDue,
  alreadyPaid,
  payingNow,
  currentTrancheLabel,
  statusNote,
  unallocatedCredit = 0,
}: DebtMeterProps) {
  const remainingAfter = Math.max(0, totalDue - alreadyPaid - payingNow);
  const totalProjected = alreadyPaid + payingNow;
  const overpayment = Math.max(0, totalProjected - totalDue);

  // Segment widths (clamped 0..100, percentages of totalDue).
  const paidPct = totalDue > 0 ? Math.min(100, (alreadyPaid / totalDue) * 100) : 0;
  const payingPct = totalDue > 0 ? Math.min(100 - paidPct, (payingNow / totalDue) * 100) : 0;
  const remainingPct = Math.max(0, 100 - paidPct - payingPct);

  // Status badge selection (enhanced with new badges).
  let badge: { tone: "success" | "warning" | "danger" | "neutral"; label: string };
  if (totalDue === 0) {
    badge = { tone: "neutral", label: "Aucune tranche due" };
  } else if (overpayment > 0.5) {
    badge = {
      tone: "warning",
      label: `Excédent de +${formatDzdPlain(overpayment)} (Crédit Parent)`,
    };
  } else if (remainingAfter <= 0.5) {
    badge = {
      tone: "success",
      label: "Dette entièrement soldée",
    };
  } else if (payingNow > 0) {
    badge = {
      tone: "neutral",
      label: currentTrancheLabel ? `Tranche cible : ${currentTrancheLabel}` : "Paiement partiel",
    };
  } else {
    badge = {
      tone: "warning",
      label: "Aucun montant sélectionné",
    };
  }

  return (
    <div className="rounded-lg border border-border bg-surface-panel/40 p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Compteur de dette
        </p>
        <StatusChip tone={badge.tone} label={badge.label} />
      </div>

      {/* Numeric grid */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div>
          <p className="text-[10px] uppercase text-muted-foreground">Total dû</p>
          <p className="font-mono font-semibold">{formatDzdPlain(totalDue)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase text-muted-foreground">Déjà payé</p>
          <p className="font-mono font-semibold text-status-success">{formatDzdPlain(alreadyPaid)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase text-muted-foreground">Encaissement en cours</p>
          <p className="font-mono font-semibold text-primary">+{formatDzdPlain(payingNow)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase text-muted-foreground">Reste après</p>
          <p className="font-mono font-semibold text-status-danger">{formatDzdPlain(remainingAfter)}</p>
        </div>
        {unallocatedCredit > 0 && (
          <div className="col-span-2 border-t border-border pt-2 mt-1">
            <p className="text-[10px] uppercase text-muted-foreground">Crédit parent disponible</p>
            <p className="font-mono font-semibold text-status-warning">
              {formatDzdPlain(unallocatedCredit)} (sera absorbé sur la prochaine facture)
            </p>
          </div>
        )}
      </div>

      {/* Segmented progress bar */}
      <div className="relative h-3 w-full overflow-hidden rounded-full bg-muted">
        {/* Already-paid segment (green) */}
        <div
          className="absolute inset-y-0 left-0 bg-status-success transition-all duration-300"
          style={{ width: `${paidPct}%` }}
        />
        {/* Paying-now segment (blue) */}
        <div
          className="absolute inset-y-0 bg-primary/80 transition-all duration-300"
          style={{ left: `${paidPct}%`, width: `${payingPct}%` }}
        />
        {/* Remaining segment (gray) — implicit via parent bg-muted */}
        <div
          className="absolute inset-y-0 bg-muted-foreground/20"
          style={{ left: `${paidPct + payingPct}%`, width: `${remainingPct}%` }}
        />
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-status-success" />
          Payé ({formatDzdPlain(alreadyPaid)})
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-primary/80" />
          En cours (+{formatDzdPlain(payingNow)})
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground/30" />
          Reste ({formatDzdPlain(remainingAfter)})
        </span>
      </div>

      {/* Status note */}
      {statusNote && (
        <p className="text-xs text-muted-foreground italic border-t border-border pt-2">
          {statusNote}
        </p>
      )}
    </div>
  );
}

/**
 * Backward-compat alias — `DebtMeter` is the canonical export, but callers
 * adopting the unified architecture can import `UnifiedDebtMeter` by name
 * to make the intent explicit.
 */
export const UnifiedDebtMeter = DebtMeter;
