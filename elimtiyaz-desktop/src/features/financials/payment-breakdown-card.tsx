/**
 * PaymentBreakdownCard — shows what a single payment covers.
 *
 * PAYMENT BREAKDOWN FEATURE: For each payment, display:
 *   - The payment amount + receipt number + date.
 *   - The breakdown by category (Education: 250,000, Transport: 50,000, etc.)
 *   - The expected total vs paid total.
 *   - If overpaid: the excess amount + remark.
 *
 * This component reads the payment's `expectedAmount`, `excessAmount`, and
 * `excessRemark` fields (added by migration 0033). It also reads the
 * `payment_allocations` table to show the per-category breakdown.
 *
 * For payments that don't have allocations (legacy or single-category), it
 * falls back to showing the payment's `category` + `amount` as a single line.
 */
import { useRepositories } from "../../app/providers/repository-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import { Card, CardContent, CardHeader, CardTitle } from "../../shared/ui/card";
import { Badge } from "../../shared/ui/badge";
import { formatDzdPlain } from "../../core/format/currency";
import { formatRelative } from "../../core/format/date";
import {
  PAYMENT_METHOD_LABELS_FR,
  PAYMENT_STATUS_LABELS_FR,
  PAYMENT_CATEGORY_LABELS_FR,
  type Payment,
  type PaymentAllocation,
} from "../../domain/model/payment";
import { StatusChip } from "../../shared/ui/status-chip";
import { useEffect, useState } from "react";

export function PaymentBreakdownCard({ payment }: { payment: Payment }) {
  const repos = useRepositories();
  const [allocations, setAllocations] = useState<PaymentAllocation[]>([]);

  // Fetch allocations for this payment from the ledger entries that have
  // this payment's receiptNumber in their metadata. This is a client-side
  // join — the `payment_allocations` table may not exist on all DBs.
  useEffect(() => {
    void (async () => {
      try {
        // Read ledger entries for the parent, filter to those whose
        // metadata.paymentReceiptNumber matches this payment.
        const ledgerObs = repos.ledger.observeByParent(payment.parentId);
        const allEntries = typeof ledgerObs.get === "function" ? ledgerObs.get() : [];
        const matching = allEntries.filter(
          (e) =>
            e.receiptNumber === payment.receiptNumber &&
            e.type === "payment",
        );
        // Build allocations from the matching ledger entries.
        // Each payment ledger entry represents one allocation.
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
        setAllocations(built);
      } catch {
        setAllocations([]);
      }
    })();
  }, [payment.id, payment.parentId, payment.receiptNumber, repos.ledger]);

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
            {PAYMENT_METHOD_LABELS_FR[payment.method]} · {PAYMENT_CATEGORY_LABELS_FR[payment.category]}
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
                      {PAYMENT_CATEGORY_LABELS_FR[a.category]}
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
                    {PAYMENT_CATEGORY_LABELS_FR[payment.category]}
                  </Badge>
                  <span>{PAYMENT_CATEGORY_LABELS_FR[payment.category]}</span>
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
