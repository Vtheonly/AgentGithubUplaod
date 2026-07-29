/**
 * Financials hub — Hub 4. Plan §07.
 *
 * Tabs: Paiements / Tranches / Créances / Dépenses / Reçus.
 *
 * Iteration 2 additions:
 *   - Counter Payment modal (with proof + receipt preview)
 *   - Expense submit modal
 *   - Expense detail drawer with full workflow (Approve/Reject/Disburse/Settle)
 *   - Installment Schedule tab (replaces ComingSoonCard) with one-click collect
 */
import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Download, Filter, Search, Wallet, TrendingUp, AlertTriangle, Receipt, FileText, CreditCard, CalendarClock, AlertCircle, Send, FileCheck } from "lucide-react";
import { useRepositories } from "../../infrastructure/repository-provider";
import { useAuth } from "../../state/auth-context";
import { useObservable } from "../../shared/hooks/use-observable";
import { formatDzd } from "../../core/format/currency";
import { formatRelative } from "../../core/format/date";
import {
  PAYMENT_METHOD_LABELS_FR,
  PAYMENT_STATUS_LABELS_FR,
  PAYMENT_CATEGORY_LABELS_FR,
  AGING_BUCKET_LABELS_FR,
  sumPaidPayments,
  monthlyRevenue,
} from "../../domain/model/payment";
import { EXPENSE_STATUS_LABELS_FR, EXPENSE_CATEGORY_LABELS_FR } from "../../domain/model/expense";
import { Permission } from "../../core/rbac/permissions";
import { PageHeader } from "../../shared/components/page-header";
import { KpiCard } from "../../shared/components/kpi-card";
import { StatusChip } from "../../shared/components/status-chip";
import { ComingSoonCard } from "../../shared/components/coming-soon-card";
import { Card, CardContent } from "../../shared/ui/card";
import { PageTabs, PageTabList, PageTab, PageTabContent } from "../../shared/components/page-tabs";
import { Button } from "../../shared/ui/button";
import { Input } from "../../shared/ui/input";
import { CounterPaymentModal } from "./counter-payment-modal";
import { ExpenseSubmitModal } from "./expense-submit-modal";
import { ExpenseDetailDrawer } from "./expense-detail-drawer";
import { InstallmentScheduleTab } from "./installment-schedule-tab";
import { ReceiptsTab } from "./receipts-tab";

export function FinancialsPage() {
  const { t } = useTranslation();
  const repos = useRepositories();
  const { session } = useAuth();
  const payments = useObservable(() => repos.payments.observe(), []);
  const expenses = useObservable(() => repos.expenses.observe(), []);
  const debtSummary = useObservable(() => repos.debt.observeSummary(), []);

  const [paymentOpen, setPaymentOpen] = useState(false);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [expenseDetailId, setExpenseDetailId] = useState<string | null>(null);
  const [expenseDetailOpen, setExpenseDetailOpen] = useState(false);

  // Iteration 5: use shared helpers — no duplicated logic.
  const totalToday = sumPaidPayments(payments);
  const pendingExpenses = expenses.filter((e) => e.status === "submitted").length;
  const overdueDebt = debtSummary.reduce((s, d) => s + d.outstandingAmount, 0);
  // Monthly revenue = sum of paid payments collected this month.
  const monthlyRev = monthlyRevenue(payments);

  const canCollect = !!session && session.permissions.has(Permission.CollectPayment);
  const canSubmitExpense = !!session && session.permissions.has(Permission.SubmitExpense);

  function openExpense(id: string) {
    setExpenseDetailId(id);
    setExpenseDetailOpen(true);
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title={t("nav.financials")}
        description="Paiements, tranches, créances, dépenses — avec génération automatique de reçus"
        actions={
          <>
            <Button variant="outline" size="sm"><Download className="h-4 w-4" /> {t("common.export")}</Button>
            {canSubmitExpense && (
              <Button variant="outline" size="sm" onClick={() => setExpenseOpen(true)}>
                <FileText className="h-4 w-4" /> Dépense
              </Button>
            )}
            {canCollect && (
              <Button size="sm" onClick={() => setPaymentOpen(true)}>
                <Plus className="h-4 w-4" /> Encaissement
              </Button>
            )}
          </>
        }
      />

      <div className="px-6 pb-3">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard label="Encaissé (cumul)" value={formatDzd(totalToday, { compact: true })} icon={<Wallet className="h-5 w-5" />} tone="success" />
          <KpiCard label="Revenu mensuel" value={formatDzd(monthlyRev, { compact: true })} icon={<TrendingUp className="h-5 w-5" />} tone="info" />
          <KpiCard label="Créances en retard" value={formatDzd(overdueDebt, { compact: true })} icon={<AlertTriangle className="h-5 w-5" />} tone="danger" />
          <KpiCard label="Dépenses en attente" value={pendingExpenses} icon={<Receipt className="h-5 w-5" />} tone="warning" />
        </div>
      </div>

      <PageTabs defaultValue="payments" className="flex-1 flex flex-col px-6 pb-6 min-h-0">
        <PageTabList>
          <PageTab value="payments" label="Paiements" icon={CreditCard} />
          <PageTab value="installments" label="Tranches" icon={CalendarClock} />
          <PageTab value="debt" label="Créances" icon={AlertCircle} count={debtSummary.length} countTone={overdueDebt > 0 ? "danger" : "default"} />
          <PageTab value="expenses" label="Dépenses" icon={Send} count={pendingExpenses} countTone={pendingExpenses > 0 ? "warning" : "default"} />
          <PageTab value="receipts" label="Reçus" icon={FileCheck} />
        </PageTabList>

        <PageTabContent value="payments">
          <PaymentsTab />
        </PageTabContent>
        <PageTabContent value="installments">
          <InstallmentScheduleTab />
        </PageTabContent>
        <PageTabContent value="debt">
          <DebtTab />
        </PageTabContent>
        <PageTabContent value="expenses">
          <ExpensesTab onOpenExpense={openExpense} />
        </PageTabContent>
        <PageTabContent value="receipts">
          <ReceiptsTab />
        </PageTabContent>
      </PageTabs>

      <CounterPaymentModal open={paymentOpen} onOpenChange={setPaymentOpen} />
      <ExpenseSubmitModal
        open={expenseOpen}
        onOpenChange={setExpenseOpen}
        onSubmitted={(id) => openExpense(id)}
      />
      <ExpenseDetailDrawer
        expenseId={expenseDetailId}
        open={expenseDetailOpen}
        onOpenChange={setExpenseDetailOpen}
      />
    </div>
  );
}

function PaymentsTab() {
  const repos = useRepositories();
  const payments = useObservable(() => repos.payments.observe(), []);
  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex items-center gap-2 border-b border-border p-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Rechercher un paiement…" className="pl-9" />
          </div>
          <Button variant="outline" size="sm"><Filter className="h-4 w-4" /> Méthode</Button>
          <Button variant="outline" size="sm"><Download className="h-4 w-4" /></Button>
        </div>
        <ul className="divide-y divide-border">
          {payments.slice(0, 20).map((p) => (
            <li key={p.id} className="flex items-center gap-3 p-3 hover:bg-accent/5">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-foreground font-mono">{p.receiptNumber}</p>
                  <StatusChip
                    label={PAYMENT_STATUS_LABELS_FR[p.status]}
                    tone={p.status === "paid" ? "success" : p.status === "pending" ? "warning" : p.status === "overdue" ? "danger" : p.status === "refunded" ? "neutral" : "info"}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {PAYMENT_METHOD_LABELS_FR[p.method]} • {PAYMENT_CATEGORY_LABELS_FR[p.category]}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold tnum">{formatDzd(p.amount)}</p>
                <p className="text-[10px] text-muted-foreground">{formatRelative(p.collectedAt)}</p>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function DebtTab() {
  const repos = useRepositories();
  const debt = useObservable(() => repos.debt.observeSummary(), []);
  const students = useObservable(() => repos.students.observe(), []);
  const [reminding, setReminding] = useState<string | null>(null);

  async function sendReminder(parentId: string, name: string) {
    setReminding(parentId);
    try {
      const r = await repos.debt.sendReminder(parentId);
      if (r.ok) {
        // Open WhatsApp with pre-filled message
        const debtor = debt.find((d) => d.parentId === parentId);
        if (debtor) {
          const msg = `Bonjour ${name}, votre solde dû envers El-Imtiyaz est de ${formatDzd(debtor.outstandingAmount)}. Merci de régulariser dans les meilleurs délais.`;
          window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`);
        }
      }
    } finally {
      setReminding(null);
    }
  }

  // Iteration 10 — Top 20 Family Debtors ranking (plan §07.06).
  // Sort by outstanding amount desc, take top 20.
  const top20Debtors = [...debt]
    .filter((d) => d.outstandingAmount > 0)
    .sort((a, b) => b.outstandingAmount - a.outstandingAmount)
    .slice(0, 20);

  // Iteration 10 — Per-Grade breakdown (plan §07.06).
  // For each debtor, look up their students' grade levels and attribute the
  // outstanding amount proportionally across those grades.
  const perGradeBreakdown = useMemo(() => {
    const totals = new Map<string, number>();
    for (const d of debt) {
      if (d.outstandingAmount <= 0) continue;
      const familyStudents = students.filter((s) => s.parentId === d.parentId);
      if (familyStudents.length === 0) {
        // Attribute to "Inconnu" if we can't resolve any student.
        totals.set("Inconnu", (totals.get("Inconnu") ?? 0) + d.outstandingAmount);
        continue;
      }
      const sharePerStudent = d.outstandingAmount / familyStudents.length;
      for (const s of familyStudents) {
        const gradeKey = `${s.level} — A${s.gradeYear}`;
        totals.set(gradeKey, (totals.get(gradeKey) ?? 0) + sharePerStudent);
      }
    }
    return Array.from(totals.entries())
      .map(([grade, amount]) => ({ grade, amount }))
      .sort((a, b) => b.amount - a.amount);
  }, [debt, students]);

  const maxGradeAmount = perGradeBreakdown.length > 0 ? perGradeBreakdown[0].amount : 1;

  return (
    <div className="space-y-4">
      {/* Iteration 10 — Top 20 Family Debtors ranking (plan §07.06) */}
      <Card>
        <CardContent className="p-0">
          <div className="border-b border-border p-3">
            <h3 className="text-sm font-medium text-foreground flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-status-danger" />
              Top 20 débiteurs familiaux
              <span className="text-[10px] text-muted-foreground font-normal">
                (plan §07.06 — priorisation du recouvrement)
              </span>
            </h3>
          </div>
          <ul className="divide-y divide-border">
            {top20Debtors.length === 0 ? (
              <li className="p-6 text-center text-sm text-muted-foreground">
                Aucune créance en cours. 🎉
              </li>
            ) : (
              top20Debtors.map((d, idx) => (
                <li key={d.parentId} className="flex items-center gap-3 p-3 hover:bg-accent/5">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-status-danger/10 text-xs font-mono font-semibold text-status-danger">
                    {idx + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">{d.parentName}</p>
                    <p className="text-xs text-muted-foreground font-mono">{d.parentPhone}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <StatusChip
                      label={AGING_BUCKET_LABELS_FR[d.bucket]}
                      tone={d.bucket === "0_30" ? "success" : d.bucket === "31_60" ? "warning" : "danger"}
                    />
                    <p className="text-xs text-muted-foreground">{d.daysOverdue} j</p>
                  </div>
                  <p className="text-sm font-semibold tnum text-status-danger min-w-[120px] text-right">
                    {formatDzd(d.outstandingAmount)}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={reminding === d.parentId}
                    onClick={() => sendReminder(d.parentId, d.parentName)}
                  >
                    {reminding === d.parentId ? "…" : "Rappel"}
                  </Button>
                </li>
              ))
            )}
          </ul>
        </CardContent>
      </Card>

      {/* Iteration 10 — Per-Grade breakdown (plan §07.06) */}
      {perGradeBreakdown.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="border-b border-border p-3">
              <h3 className="text-sm font-medium text-foreground flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-primary" />
                Répartition par niveau scolaire
                <span className="text-[10px] text-muted-foreground font-normal">
                  (part proportionnelle par élève de la famille)
                </span>
              </h3>
            </div>
            <div className="p-3 space-y-2">
              {perGradeBreakdown.map((g) => {
                const pct = maxGradeAmount > 0 ? (g.amount / maxGradeAmount) * 100 : 0;
                return (
                  <div key={g.grade} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{g.grade}</span>
                      <span className="font-mono text-foreground">{formatDzd(g.amount)}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-status-danger/70 transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ExpensesTab({ onOpenExpense }: { onOpenExpense: (id: string) => void }) {
  const repos = useRepositories();
  const expenses = useObservable(() => repos.expenses.observe(), []);
  return (
    <Card>
      <CardContent className="p-0">
        <ul className="divide-y divide-border">
          {expenses.map((e) => (
            <li
              key={e.id}
              className="flex items-center gap-3 p-3 cursor-pointer hover:bg-accent/5"
              onClick={() => onOpenExpense(e.id)}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-foreground truncate">{e.title}</p>
                  <span className="font-mono text-xs text-muted-foreground">{e.requestCode}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {EXPENSE_CATEGORY_LABELS_FR[e.category]} • {e.payee}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <StatusChip
                  label={EXPENSE_STATUS_LABELS_FR[e.status]}
                  tone={
                    e.status === "settled" ? "success" :
                    e.status === "approved" ? "info" :
                    e.status === "disbursed" ? "warning" :
                    e.status === "rejected" ? "danger" :
                    "warning"
                  }
                />
                {e.anomalyScore != null && e.anomalyScore > 0.7 && (
                  <StatusChip label="Anomalie" tone="danger" />
                )}
              </div>
              <p className="text-sm font-semibold tnum min-w-[120px] text-right">
                {formatDzd(e.amount)}
              </p>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
