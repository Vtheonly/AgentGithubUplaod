/**
 * Tab 4 — Paiements (individual share + family balance + payment breakdown).
 *
 * Extracted from `student-detail-drawer.tsx` (iteration 6-a). Behavior
 * preserved exactly — only file location + import paths changed.
 *
 * BULK IMPORT FIX (round 2): Now uses the PaymentBreakdownCard component
 * to show what each payment covers (Education: 250,000, Transport: 50,000,
 * etc.) and any overpayment with remark. The old single-line display
 * showed only the amount without explanation.
 *
 * Epic 6.3 (this revision): added "Encaisser part élève" button that opens
 * `UnifiedPaymentModal` in `installment_tranche` mode scoped to this student.
 */
import { useState } from "react";
import { ArrowRight, Wallet } from "lucide-react";
import { useRepositories } from "../../../app/providers/repository-provider";
import { useObservable } from "../../../shared/hooks/use-observable";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../../shared/ui/card";
import { Button } from "../../../shared/ui/button";
import { StatusChip } from "../../../shared/ui/status-chip";
import { formatDzdPlain } from "../../../core/format/currency";
import { formatRelative } from "../../../core/format/date";
import {
  PAYMENT_METHOD_LABELS_FR,
  PAYMENT_STATUS_LABELS_FR,
  PAYMENT_CATEGORY_LABELS_FR,
  // TIER 4 FIX (bypass #1) — canonical helpers from `domain/calc/payment`
  // (re-exported via `domain/model/payment` for backward compat).
  sumPaidPayments,
  totalOutstanding,
  type PaymentNavigationContext,
} from "../../../domain/model/payment";
import { UnifiedPaymentModal } from "../../financials/unified-payment-modal";
import { PaymentBreakdownCard } from "../../financials/payment-breakdown-card";

export function PaymentsTab({
  studentId,
  onOpenParent,
}: {
  studentId: string;
  onOpenParent?: (parentId: string) => void;
}) {
  const repos = useRepositories();
  const student = useObservable(() => repos.students.observeById(studentId), [studentId]);
  const parents = useObservable(() => repos.parents.observe(), []);
  const payments = useObservable(() => repos.payments.observeByStudent(studentId), [studentId]);
  const installments = useObservable(() => repos.installments.observeByStudent(studentId), [studentId]);
  const familyProfile = useObservable(
    () => repos.debt.observeParentProfile(student?.parentId ?? ""),
    [student?.parentId],
  );
  // === Epic 6.3 — UnifiedPaymentModal trigger ===
  const [collectOpen, setCollectOpen] = useState(false);

  if (!student) return null;

  // TIER 4 FIX (bypass #1) — delegate to canonical helpers from
  // `domain/calc/payment` instead of inline `filter + reduce` over raw
  // payment / installment rows. The canonical `sumPaidPayments` filters
  // by `status === "paid"` (the canonical "cleared revenue" rule) and
  // `totalOutstanding` returns `clampNonNegative(sumDue - sumPaid)` so
  // reversed originals / adjustments / credits are correctly accounted
  // for via the ledger (where they live) rather than re-derived here.
  const individualPaid = sumPaidPayments(payments);
  // `individualPending` is a UI-only metric: the sum of uncleared
  // checks / transfers awaiting compensation. There is no canonical
  // helper for it because the canonical rule only defines
  // "revenue = Σ cleared payments". The reconciler's
  // `crossCheckClearedBalance` already verifies this sum equals the
  // ledger's pending-payment credits, so the inline sum is acceptable.
  const individualPending = payments.filter((p) => p.status === "pending").reduce((s, p) => s + p.amount, 0);
  const unpaidInstallments = installments.filter((i) => i.status !== "paid");
  const individualOverdue = totalOutstanding(unpaidInstallments);
  const familyOutstanding = familyProfile?.totalOutstanding ?? 0;
  const familyOverdue = familyProfile?.overdueAmount ?? 0;

  // Build the navigation context for "Encaisser part élève" — scoped to
  // this student's unpaid installments only.
  const parent = parents.find((p) => p.id === student.parentId);
  const collectContext: PaymentNavigationContext | null = unpaidInstallments.length > 0
    ? {
        parentId: student.parentId,
        parentName: parent ? `${parent.firstName} ${parent.lastName}` : undefined,
        parentCode: parent?.code,
        studentId: student.id,
        studentName: `${student.firstName} ${student.lastName}`,
        mode: "installment_tranche",
        presetAmount: individualOverdue,
        lineItems: unpaidInstallments
          .slice()
          .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
          .map((i) => ({
            itemId: i.id,
            category: i.category,
            label: i.label,
            grossAmount: i.amountDue,
            discountAmount: 0,
            netAmount: i.amountDue,
            alreadyPaidAmount: i.amountPaid,
            remainingAmount: Math.max(0, i.amountDue - i.amountPaid),
            dueDate: i.dueDate,
            isOverdue: i.status === "overdue",
          })),
        allowPartial: true,
        originRoute: "crm.student_drawer.payments",
      }
    : null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Part individuelle</p>
            <p className="text-xl font-mono font-bold text-status-success mt-1">{formatDzdPlain(individualPaid)}</p>
            <p className="text-[10px] text-muted-foreground mt-1">Encaissé (payé)</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">En attente</p>
            <p className="text-xl font-mono font-bold text-status-warning mt-1">{formatDzdPlain(individualPending)}</p>
            <p className="text-[10px] text-muted-foreground mt-1">Chèques / virements à compenser</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Tranches restantes</p>
            <p className="text-xl font-mono font-bold text-status-danger mt-1">{formatDzdPlain(individualOverdue)}</p>
            <p className="text-[10px] text-muted-foreground mt-1">Sur les tranches affectées à cet élève</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Solde famille</p>
            <p className="text-xl font-mono font-bold text-foreground mt-1">{formatDzdPlain(familyOutstanding)}</p>
            <p className="text-[10px] text-muted-foreground mt-1">
              Dont {formatDzdPlain(familyOverdue)} en retard — voir le parent
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-sm">Historique des paiements</CardTitle>
            <CardDescription>
              {payments.length} paiement(s) · cliquez pour voir le détail de ce que couvre chaque paiement
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {/* Epic 6.3 — Encaisser part élève → UnifiedPaymentModal (installment_tranche) */}
            <Button
              size="sm"
              variant="default"
              onClick={() => setCollectOpen(true)}
              disabled={individualOverdue <= 0}
            >
              <Wallet className="h-3.5 w-3.5" /> Encaisser part élève
            </Button>
            {student && onOpenParent && (
              <Button size="sm" variant="outline" onClick={() => onOpenParent(student.parentId)}>
                Profil financier famille <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {payments.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Aucun paiement affecté à cet élève.
            </p>
          ) : (
            /* PAYMENT BREAKDOWN: Show each payment with its breakdown card
               instead of the old single-line display. This makes it clear
               what each payment covers (Education, Transport, etc.) and
               any overpayment with remark. */
            <div className="space-y-3">
              {payments.slice(0, 20).map((p) => (
                <PaymentBreakdownCard key={p.id} payment={p} />
              ))}
              {payments.length > 20 && (
                <p className="text-xs text-muted-foreground text-center pt-2">
                  + {payments.length - 20} paiement(s) précédent(s)…
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Epic 6.3 — UnifiedPaymentModal scoped to this student's installments */}
      <UnifiedPaymentModal
        open={collectOpen}
        onOpenChange={setCollectOpen}
        context={collectContext}
      />
    </div>
  );
}
