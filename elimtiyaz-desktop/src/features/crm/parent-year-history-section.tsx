/**
 * ParentYearHistorySection — T-436 (UI-318): the « Historique par Année
 * Scolaire » section of the CRM parent drawer's Finances tab.
 *
 * A PURE CONSUMER of the canonical year-history engine
 * (`domain/calc/ledger/year-history.ts` — financial-rules §17.3): this
 * component renders, never re-derives (§15.53a). Every amount shown is a
 * stored column, the INV-4 remaining, or an allocation amount — the same
 * numbers the Finance tab shows for the same rows (INV-20a).
 *
 * The owner's mandate this surfaces: "when we review a person's financial
 * history, we can clearly understand exactly what happened during EACH
 * academic year and how their financial state changed from one year to
 * the next" — per year: what they were supposed to pay, what they paid,
 * what they did NOT pay, the year-end remaining, the carried-forward
 * debt, the cross-year settlements, the pricing configuration of the
 * year, and the balance evolution.
 */
import { useMemo, useState } from "react";
import {
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ArrowLeftRight,
  Landmark,
} from "lucide-react";
import { Badge } from "../../shared/ui/badge";
import { StatusChip } from "../../shared/ui/status-chip";
import { formatDzd } from "../../core/format/currency";
import { formatDate } from "../../core/format/date";
import {
  computeParentYearHistory,
  type AcademicYearFinancialRecord,
  type YearChargeItem,
  type PricingConfigIndex,
} from "../../domain/calc/ledger/year-history";
import type { Installment, Payment, PaymentAllocation } from "../../domain/model/payment";
import type { LedgerEntry } from "../../domain/model/ledger";
import type { AcademicYear } from "../../domain/model/academic";

/* ── Settlement chip vocabulary (one wording — the §15.3 rule) ───────── */

const SETTLEMENT_LABEL_FR: Record<YearChargeItem["settlement"], string> = {
  fully_paid: "Réglée",
  partially_paid: "Partiellement réglée",
  pending_clearance: "En attente d'encaissement",
  outstanding: "Non réglée",
};

const SETTLEMENT_TONE: Record<YearChargeItem["settlement"], "success" | "warning" | "neutral" | "danger"> = {
  fully_paid: "success",
  partially_paid: "warning",
  pending_clearance: "warning",
  outstanding: "danger",
};

/** The settlement item's display label (the allocation's charge label, or
 *  the payment receipt — one fallback, rendered inline). */
function settlementLabel(s: {
  readonly chargeLabel: string | null;
  readonly paymentId: string | null;
}): string {
  return s.chargeLabel ?? (s.paymentId ? `Paiement ${s.paymentId.slice(0, 8)}` : "Charge");
}

/* ── One year card ─────────────────────────────────────────────────── */

function YearCard({ record }: { record: AcademicYearFinancialRecord }) {
  const [open, setOpen] = useState(false);
  const last = record.balanceEvolution[record.balanceEvolution.length - 1];

  return (
    <div className="rounded-md border border-border bg-card">
      {/* Card header — always visible */}
      <button
        type="button"
        className="flex w-full items-start justify-between gap-2 px-3 py-2.5 text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-semibold tabular-nums">{record.academicYear}</span>
            {record.isOpen ? (
              <Badge variant="outline" className="h-4 px-1.5 text-[10px] text-emerald-600">en cours</Badge>
            ) : (
              <Badge variant="outline" className="h-4 px-1.5 text-[10px] text-muted-foreground">clôturée</Badge>
            )}
            {record.reEnrolledOwing && (
              <Badge variant="outline" className="h-4 px-1.5 text-[10px] text-amber-600">réinscrit avec dette</Badge>
            )}
            {record.leftOwing && (
              <Badge variant="outline" className="h-4 px-1.5 text-[10px] text-rose-600">parti avec dette</Badge>
            )}
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Facturé {formatDzd(record.totalCharged)} · Payé {formatDzd(record.totalPaidOnCharges)}
            {record.totalPendingOnCharges > 0 && ` · En attente ${formatDzd(record.totalPendingOnCharges)}`}
            {record.pricingConfig && ` · Tarif : ${record.pricingConfig.label}`}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5">
          <span className="text-xs tabular-nums font-semibold">
            Reste fin d&apos;année : {formatDzd(record.yearEndOutstanding)}
          </span>
          {record.carriedForwardFromPriorYear > 0 && (
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <ArrowLeftRight className="h-3 w-3" aria-hidden />
              Reporté : {formatDzd(record.carriedForwardFromPriorYear)}
            </span>
          )}
          {open ? (
            <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          )}
        </div>
      </button>

      {open && (
        <div className="space-y-3 border-t border-border px-3 py-2.5">
          {/* The charges — what they were supposed to pay / paid / not paid */}
          {record.charges.length > 0 && (
            <div>
              <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Charges de l&apos;année ({record.charges.length})
              </p>
              <ul className="space-y-1">
                {record.charges.map((c) => (
                  <li
                    key={c.installmentId}
                    className="grid grid-cols-[1fr_auto] items-center gap-x-2 rounded-sm bg-muted/40 px-2 py-1 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{c.label}</p>
                      <p className="text-[11px] text-muted-foreground">
                        Échéance {formatDate(c.dueDate)} · Dû {formatDzd(c.amountDue)} · Payé {formatDzd(c.amountPaid)}
                        {c.settlement === "fully_paid" && c.settledAt && ` · Réglée le ${formatDate(c.settledAt)}`}
                        {c.attribution.source === "due_date" && " · année dérivée de l'échéance"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="tabular-nums text-muted-foreground">
                        Reste {formatDzd(c.remaining)}
                      </span>
                      <StatusChip tone={SETTLEMENT_TONE[c.settlement]} label={SETTLEMENT_LABEL_FR[c.settlement]} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Payments made in the year */}
          {record.paymentsMadeInYear.length > 0 && (
            <div>
              <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Paiements de l&apos;année ({record.paymentsMadeInYear.length}) — {formatDzd(record.paymentsMadeInYearTotal)}
              </p>
              <ul className="space-y-1">
                {record.paymentsMadeInYear.map((p) => (
                  <li key={p.ledgerEntryId} className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-muted-foreground">
                      {formatDate(p.at)} · {p.receiptNumber ?? "Paiement"}
                    </span>
                    <span className="tabular-nums">{formatDzd(p.amount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Cross-year settlements — later-year payments settling THIS year */}
          {record.settlementsReceivedFromLaterYears.length > 0 && (
            <div className="rounded-sm border border-amber-200 bg-amber-50/60 px-2 py-1.5 dark:border-amber-900/60 dark:bg-amber-950/30">
              <p className="mb-1 text-[11px] font-medium text-amber-800 dark:text-amber-400">
                <ArrowLeftRight className="mr-1 inline h-3 w-3" aria-hidden />
                Dette réglée par des paiements d&apos;années suivantes —{" "}
                {formatDzd(record.settlementsReceivedFromLaterYearsTotal)}
              </p>
              <ul className="space-y-1">
                {record.settlementsReceivedFromLaterYears.map((s, i) => (
                  <li key={`${s.paymentId}-${s.installmentId}-${i}`} className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-muted-foreground">
                      {s.at ? formatDate(s.at) : "—"} · {settlementLabel(s)}{" "}
                      <span className="font-medium">(année {s.paymentYear})</span>
                    </span>
                    <span className="tabular-nums">{formatDzd(s.allocatedAmount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Balance evolution summary */}
          {record.balanceEvolution.length > 0 && (
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Landmark className="h-3 w-3" aria-hidden />
              Évolution : {record.balanceEvolution.length} événements · solde final{" "}
              <span className="tabular-nums font-medium">{formatDzd(last?.runningOutstanding ?? 0)}</span>
              {record.yearEndBasis !== "allocations" && (
                <span className="italic"> · détail de règlement estimé (données antérieures sans affectations)</span>
              )}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/* ── The section ───────────────────────────────────────────────────── */

export interface ParentYearHistorySectionProps {
  readonly parentId: string;
  readonly installments: readonly Installment[];
  readonly payments: readonly Payment[];
  readonly allocations: readonly PaymentAllocation[];
  readonly ledgerEntries: readonly LedgerEntry[];
  readonly academicYears: readonly AcademicYear[];
  readonly pricingConfigs: PricingConfigIndex;
}

export function ParentYearHistorySection({
  parentId,
  installments,
  payments,
  allocations,
  ledgerEntries,
  academicYears,
  pricingConfigs,
}: ParentYearHistorySectionProps) {
  // T-436: the ONE canonical derivation (financial-rules §17.3) — the
  // component renders its output verbatim, zero local math.
  const history = useMemo(
    () =>
      computeParentYearHistory({
        parentId,
        installments,
        payments,
        allocations,
        ledgerEntries,
        academicYears: academicYears.map((y) => ({
          code: y.code,
          startDate: y.startDate,
          endDate: y.endDate,
          id: y.id,
        })),
        pricingConfigs,
      }),
    [parentId, installments, payments, allocations, ledgerEntries, academicYears, pricingConfigs],
  );

  if (history.years.length === 0) {
    // Honest empty state (§15.49a): no charges and no payments ever
    // attributed to this person — never a fabricated zero-year.
    return null;
  }

  return (
    <div className="space-y-2">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Calendar className="h-3.5 w-3.5" aria-hidden />
        Historique par Année Scolaire
      </p>
      {history.priorYearOutstandingStillOwed > 0 && (
        <p className="rounded-sm border border-rose-200 bg-rose-50/60 px-2 py-1 text-xs text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-400">
          <CheckCircle2 className="mr-1 inline h-3 w-3" aria-hidden />
          Dette des années antérieures encore due aujourd&apos;hui :{" "}
          <span className="font-semibold tabular-nums">{formatDzd(history.priorYearOutstandingStillOwed)}</span>
        </p>
      )}
      <div className="space-y-2">
        {history.years.map((y) => (
          <YearCard key={y.academicYear} record={y} />
        ))}
      </div>
    </div>
  );
}
