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
 * It reads the payment's `expectedAmount`, `excessAmount`, and
 * `excessRemark` fields (added by migration 0033) for the totals block.
 */
import { useRepositories } from "../../app/providers/repository-provider";
import { Card, CardContent, CardHeader, CardTitle } from "../../shared/ui/card";
import { Badge } from "../../shared/ui/badge";
import { formatDzdPlain } from "../../core/format/currency";
import { formatRelative } from "../../core/format/date";
import {
  PAYMENT_METHOD_LABELS_FR,
  PAYMENT_STATUS_LABELS_FR,
  PAYMENT_CATEGORY_LABELS_FR,
  paymentCategoryLabelFr,
  type Payment,
  type PaymentAllocation,
} from "../../domain/model/payment";
import { StatusChip } from "../../shared/ui/status-chip";
import { useEffect, useState } from "react";

export function PaymentBreakdownCard({ payment }: { payment: Payment }) {
  const repos = useRepositories();
  const [allocations, setAllocations] = useState<PaymentAllocation[]>([]);

  // T-330: the canonical chain — payment_allocations table FIRST (the
  // server waterfall record), the ledger receipt-number join as fallback
  // (legacy payments / mock mode), single-category line last.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // 1. PRIMARY: the canonical table read (Supabase mode; the mock
        //    repository derives the same lines from its own ledger).
        if (typeof repos.payments.allocationsForPayment === "function") {
          const result = await repos.payments.allocationsForPayment(payment.id);
          if (!cancelled && result.ok && result.value.length > 0) {
            setAllocations([...result.value]);
            return;
          }
        }
        // 2. FALLBACK: ledger entries for the parent filtered to this
        //    payment's receiptNumber (payment-type entries are allocations).
        const ledgerObs = repos.ledger.observeByParent(payment.parentId);
        const allEntries = typeof ledgerObs.get === "function" ? ledgerObs.get() : [];
        const matching = allEntries.filter(
          (e) =>
            e.receiptNumber === payment.receiptNumber &&
            e.type === "payment",
        );
        const built: PaymentAllocation[] = matching.map((e) => ({
          id: `${payment.id}-${e.id}`,
          paymentId: payment.id,
          chargeId: null,
          installmentId: null,
          category: e.category,
          allocatedAmount: Math.abs(e.amount),
          label: (e.metadata?.field as string) ?? null,
          createdAt: e.at,
        }));
        if (!cancelled) setAllocations(built);
      } catch {
        if (!cancelled) setAllocations([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [payment.id, payment.parentId, payment.receiptNumber, repos.ledger, repos.payments]);

  const expectedTotal = payment.expectedAmount ?? 0;
  const paidTotal = payment.amount;
  const excess = payment.excessAmount ?? (expectedTotal > 0 ? Math.max(0, paidTotal - expectedTotal) : 0);
  const hasExcess = excess > 0;
  const hasBreakdown = allocations.length > 0 || expectedTotal > 0;

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
              Détail de la couverture
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
            {/* Total expected vs paid */}
            {expectedTotal > 0 && (
              <>
                <div className="border-t border-border mt-1.5 pt-1.5 flex items-center justify-between text-xs font-medium">
                  <span>Total attendu</span>
                  <span className="font-mono">{formatDzdPlain(expectedTotal)}</span>
                </div>
                <div className="flex items-center justify-between text-xs font-medium">
                  <span>Total payé</span>
                  <span className="font-mono text-status-success">{formatDzdPlain(paidTotal)}</span>
                </div>
              </>
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
