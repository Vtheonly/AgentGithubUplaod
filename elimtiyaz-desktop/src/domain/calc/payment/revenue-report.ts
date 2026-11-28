import type { Payment } from "../../model/payment";

/** The PDF report's canonical population (T-580), shared with XLSX by
 * T-630. The period is inclusive and compares the stored calendar day;
 * pending, bounced and refunded money is not collected revenue. */
export function selectRevenuePayments(
  payments: readonly Payment[],
  period: { readonly from: string; readonly to: string },
): Payment[] {
  return payments.filter((payment) => {
    const day = payment.collectedAt.slice(0, 10);
    return payment.status === "paid" && day >= period.from && day <= period.to;
  });
}
