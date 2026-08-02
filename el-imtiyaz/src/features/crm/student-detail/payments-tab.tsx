/**
 * Tab 4 — Paiements (individual share + family balance).
 *
 * Extracted from `student-detail-drawer.tsx` (iteration 6-a). Behavior
 * preserved exactly — only file location + import paths changed.
 */
import { ArrowRight } from "lucide-react";
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
} from "../../../domain/model/payment";

export function PaymentsTab({
  studentId,
  onOpenParent,
}: {
  studentId: string;
  onOpenParent?: (parentId: string) => void;
}) {
  const repos = useRepositories();
  const student = useObservable(() => repos.students.observeById(studentId), [studentId]);
  const payments = useObservable(() => repos.payments.observeByStudent(studentId), [studentId]);
  const installments = useObservable(() => repos.installments.observeByStudent(studentId), [studentId]);
  const familyProfile = useObservable(
    () => repos.debt.observeParentProfile(student?.parentId ?? ""),
    [student?.parentId],
  );

  if (!student) return null;

  const individualPaid = payments.filter((p) => p.status === "paid").reduce((s, p) => s + p.amount, 0);
  const individualPending = payments.filter((p) => p.status === "pending").reduce((s, p) => s + p.amount, 0);
  const individualOverdue = installments
    .filter((i) => i.status !== "paid")
    .reduce((s, i) => s + (i.amountDue - i.amountPaid), 0);
  const familyOutstanding = familyProfile?.totalOutstanding ?? 0;
  const familyOverdue = familyProfile?.overdueAmount ?? 0;

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
            <CardTitle className="text-sm">Paiements individuels</CardTitle>
            <CardDescription>{payments.length} paiement(s) affecté(s) à cet élève</CardDescription>
          </div>
          {student && onOpenParent && (
            <Button size="sm" variant="outline" onClick={() => onOpenParent(student.parentId)}>
              Profil financier famille <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {payments.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Aucun paiement affecté à cet élève.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {payments.slice(0, 10).map((p) => (
                <li key={p.id} className="flex items-center gap-3 py-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs">{p.receiptNumber}</span>
                      <StatusChip
                        label={PAYMENT_STATUS_LABELS_FR[p.status]}
                        tone={p.status === "paid" ? "success" : p.status === "pending" ? "warning" : "neutral"}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {PAYMENT_METHOD_LABELS_FR[p.method]} · {PAYMENT_CATEGORY_LABELS_FR[p.category]}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-mono font-semibold">{formatDzdPlain(p.amount)}</p>
                    <p className="text-[10px] text-muted-foreground">{formatRelative(p.collectedAt)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
