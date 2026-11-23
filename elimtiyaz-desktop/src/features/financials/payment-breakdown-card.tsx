/**
 * PaymentBreakdownCard — shows what a single payment covers.
 *
 * PAYMENT BREAKDOWN FEATURE: For each payment, display:
 *   - The payment amount + receipt number + date.
 *   - The breakdown by category (Education: 250,000, Transport: 50,000, etc.)
 *   - The expected total vs paid total.
 *   - If overpaid: the excess amount + remark.
 *
 * T-330 (58th session, 2026-09-13) — the canonical precedence chain, in
 * lockstep with the website's src/lib/canonical/payment-coverage.ts
 * (cross-platform mandate: same payment → same coverage lines):
 *   1. PRIMARY: `payment_allocations` rows (migration 0033 — the
 *      server-side waterfall record written by collect_and_allocate_payment)
 *      via repos.payments.allocationsForPayment(payment.id).
 *   2. FALLBACK (legacy payments): the ledger receipt-number join (the
 *      previous only source — every payment ledger entry sharing the
 *      payment's receiptNumber is one allocation).
 *   3. LAST RESORT: the payment's own category + amount as a single line.
 *
 * T-579 (Session 52): the fetch chain now lives in `payment-coverage.ts`
 * (`resolvePaymentAllocations`) — this card, the drawers, the tabs, the modal
 * and the PDF call sites share that ONE implementation. When the caller
 * supplies the family context (installments + familyPayments [+ academicYears]),
 * the card additionally renders the SITUATION DE LA FAMILLE block from
 * `buildPaymentCoverage` — the same totals the receipt/statement PDFs draw
 * (paid-to-date, Prix justifié, reste dû, année scolaire).
 */
import { useRepositories } from "../../app/providers/repository-provider";
import { Card, CardContent, CardHeader, CardTitle } from "../../shared/ui/card";
import { Badge } from "../../shared/ui/badge";
import { formatDzdPlain } from "../../core/format/currency";
import { formatRelative } from "../../core/format/date";
import {
  PAYMENT_METHOD_LABELS_FR,
  PAYMENT_STATUS_LABELS_FR,
  paymentCategoryLabelFr,
  type Payment,
  type Installment,
  type PaymentAllocation,
} from "../../domain/model/payment";
import type { AcademicYear } from "../../domain/model/academic";
import { StatusChip } from "../../shared/ui/status-chip";
import { useEffect, useState } from "react";
import {
  buildPaymentCoverage,
  resolvePaymentAllocations,
  type PaymentCoverage,
} from "../../domain/calc/payment/payment-coverage";

export interface PaymentBreakdownCardProps {
  payment: Payment;
  /** The family's installments — enables the family-situation totals block. */
  installments?: readonly Installment[];
  /** The family's full payment history — enables paid-to-date / reste dû. */
  familyPayments?: readonly Payment[];
  /** The academic years list — resolves the année scolaire label. */
  academicYears?: readonly AcademicYear[];
}

export function PaymentBreakdownCard({
  payment,
  installments,
  familyPayments,
  academicYears,
}: PaymentBreakdownCardProps) {
  const repos = useRepositories();
  const [allocations, setAllocations] = useState<PaymentAllocation[]>([]);

  // T-330 → T-579: the canonical chain (payment_allocations table FIRST, the
  // ledger receipt-number join as fallback, single-category line last) — now
  // the SHARED resolvePaymentAllocations (payment-coverage.ts).
  useEffect(() => {
    let cancelled = false;
    void resolvePaymentAllocations(repos, payment).then((rows) => {
      if (!cancelled) setAllocations([...rows]);
    });
    return () => {
      cancelled = true;
    };
  }, [payment.id, payment.parentId, payment.receiptNumber, repos]);

  const expectedTotal = payment.expectedAmount ?? 0;
  const paidTotal = payment.amount;
  const excess = payment.excessAmount ?? (expectedTotal > 0 ? Math.max(0, paidTotal - expectedTotal) : 0);
  const hasExcess = excess > 0;
  const hasBreakdown = allocations.length > 0 || expectedTotal > 0;

  // T-579: the family-situation view model — only when the caller supplied
  // BOTH the installments and the family history (the totals need both).
  const situation: PaymentCoverage | null =
    installments && familyPayments
      ? buildPaymentCoverage(payment, allocations, installments, { academicYears, familyPayments })
      : null;

  return (
    <Card className="w-full">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <span className="font-mono">{payment.receiptNumber}</span>
            <StatusChip
              label={PAYMENT_STATUS_LABELS_FR[payment.status]}
              tone={payment.status === "paid" ? "success" : payment.status === "pending" ? "warning" : "neutral"}
            />
          </CardTitle>
          <span className="text-xs text-muted-foreground">{formatRelative(payment.collectedAt)}</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Payment summary line */}
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {PAYMENT_METHOD_LABELS_FR[payment.method]} · {paymentCategoryLabelFr(payment.category)}
          </span>
          <span className="font-mono font-bold text-base">{formatDzdPlain(paidTotal)}</span>
        </div>

        {/* Breakdown by category */}
        {hasBreakdown && (
          <div className="rounded-md border border-border p-3 space-y-1.5 bg-muted/30">
            <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
              {/* T-586: the standardized label — Couverture (one of the three:
                  Prix / Prix justifié / Couverture). */}
              Couverture
            </p>
            {allocations.length > 0 ? (
              allocations.map((a) => (
                <div key={a.id} className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px]">
                      {paymentCategoryLabelFr(a.category)}
                    </Badge>
                    <span>{a.label ?? a.category}</span>
                  </span>
                  <span className="font-mono">{formatDzdPlain(a.allocatedAmount)}</span>
                </div>
              ))
            ) : (
              /* Fallback: single-category payment */
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px]">
                    {paymentCategoryLabelFr(payment.category)}
                  </Badge>
                  <span>{paymentCategoryLabelFr(payment.category)}</span>
                </span>
                <span className="font-mono">{formatDzdPlain(paidTotal)}</span>
              </div>
            )}
            {/* Total expected vs paid — T-586: the standardized labels
                (Prix = the expected total for the covered scope). */}
            {expectedTotal > 0 && (
              <>
                <div className="border-t border-border mt-1.5 pt-1.5 flex items-center justify-between text-xs font-medium">
                  <span>Prix</span>
                  <span className="font-mono">{formatDzdPlain(expectedTotal)}</span>
                </div>
                <div className="flex items-center justify-between text-xs font-medium">
                  <span>Payé</span>
                  <span className="font-mono text-status-success">{formatDzdPlain(paidTotal)}</span>
                </div>
              </>
            )}
          </div>
        )}

        {/* T-579 — SITUATION DE LA FAMILLE: the same totals the receipt PDF
            draws (buildPaymentCoverage — ONE builder for every surface). */}
        {situation && (
          <div className="rounded-md border border-border p-3 space-y-1.5 bg-muted/20">
            <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
              Situation de la famille
            </p>
            {situation.totals.paidToDate !== null && (
              <div className="flex items-center justify-between text-xs">
                {/* T-586: the standardized label — no parenthetical (the
                    “since the family's first payment” nuance is the
                    tooltip/comment's job, not the label's). */}
                <span className="text-muted-foreground">Payé à ce jour</span>
                <span className="font-mono">{formatDzdPlain(situation.totals.paidToDate)}</span>
              </div>
            )}
            {situation.totals.totalJustified > 0 && (
              <div className="flex items-center justify-between text-xs">
                {/* T-586: the standardized label — Prix justifié (net of
                    discounts/adjustments; the net detail lives here, not in
                    the visible label). */}
                <span className="text-muted-foreground">Prix justifié</span>
                <span className="font-mono">{formatDzdPlain(situation.totals.totalJustified)}</span>
              </div>
            )}
            {situation.totals.remaining !== null && (
              <div className="border-t border-border mt-1.5 pt-1.5 flex items-center justify-between text-xs font-semibold">
                <span>Reste dû</span>
                <span
                  className={`font-mono ${
                    situation.totals.remaining > 0 ? "text-status-danger" : "text-status-success"
                  }`}
                >
                  {formatDzdPlain(situation.totals.remaining)}
                </span>
              </div>
            )}
            {situation.academicYearLabel && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Année scolaire</span>
                <span className="font-mono">{situation.academicYearLabel}</span>
              </div>
            )}
          </div>
        )}

        {/* Overpayment / Excess */}
        {hasExcess && (
          <div className="rounded-md border border-status-warning/40 bg-status-warning/5 p-3 space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-status-warning">Excédent (surpaiement)</span>
              <span className="font-mono font-bold text-status-warning">+{formatDzdPlain(excess)}</span>
            </div>
            {payment.excessRemark && (
              <p className="text-xs text-muted-foreground italic">
                Remarque: {payment.excessRemark}
              </p>
            )}
            {!payment.excessRemark && (
              <p className="text-xs text-muted-foreground italic">
                Le parent a payé plus que le montant attendu. L'excédent est conservé comme crédit parent.
              </p>
            )}
          </div>
        )}

        {/* Notes */}
        {payment.notes && (
          <p className="text-xs text-muted-foreground italic border-t border-border pt-2">
            {payment.notes}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
