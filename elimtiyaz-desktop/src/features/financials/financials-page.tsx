/**
 * Financials hub — Hub 4. Plan §07.
 *
 * Tabs: Paiements / Tranches / Créances / Dépenses / Reçus.
 *
 * Refactored:
 *   - `PaymentsTab` now uses `<DataTable<Payment>>` instead of bespoke
 *     `<ul>/<li>` markup + hand-rolled search state.
 *   - `ExpensesTab` now uses `<DataTable<Expense>>` with declarative row
 *     actions and `onRowClick` to open the detail drawer.
 *   - `DebtTab` keeps its two cards (Top 20 débiteurs + per-grade breakdown)
 *     but the Top 20 list is rendered via `<DataTable>`.
 *   - `PaymentNavigationContext` integration with `<UnifiedPaymentModal>`
 *     for consolidated debt collection is preserved.
 */
import { useState, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Plus,
  Wallet,
  TrendingUp,
  AlertTriangle,
  Receipt,
  FileText,
  CreditCard,
  CalendarClock,
  AlertCircle,
  Send,
  FileCheck,
} from "lucide-react";
import { useRepositories } from "../../app/providers/repository-provider";
import { useAuth } from "../../app/providers/auth-provider";
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
  type Payment,
  type PaymentNavigationContext,
} from "../../domain/model/payment";
import {
  EXPENSE_STATUS_LABELS_FR,
  EXPENSE_CATEGORY_LABELS_FR,
  type Expense,
} from "../../domain/model/expense";
import { Permission } from "../../core/rbac/permissions";
import { PageHeader } from "../../shared/layout/page-header";
import { KpiCard } from "../../shared/ui/kpi-card";
import { StatusChip } from "../../shared/ui/status-chip";
import { Card, CardContent } from "../../shared/ui/card";
import { PageTabs, PageTabList, PageTab, PageTabContent } from "../../shared/layout/page-tabs";
import { Button } from "../../shared/ui/button";
import { DataTable, type DataTableColumn, type DataTableAction } from "../../shared/ui/data-table";
import { CounterPaymentModal } from "./counter-payment-modal";
import { UnifiedPaymentModal } from "./unified-payment-modal";
import { ExpenseSubmitModal } from "./expense-submit-modal";
import { ExpenseDetailDrawer } from "./expense-detail-drawer";
import { InstallmentScheduleTab } from "./installment-schedule-tab";
import { ReceiptsTab } from "./receipts-tab";
import { PaymentDetailDrawer } from "./payment-detail-drawer";

type FinanceTab = "payments" | "installments" | "debt" | "expenses" | "receipts";

export function FinancialsPage() {
  const { t } = useTranslation();
  const repos = useRepositories();
  const { session } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const payments = useObservable(() => repos.payments.observe(), []);
  const expenses = useObservable(() => repos.expenses.observe(), []);
  const debtSummary = useObservable(() => repos.debt.observeSummary(), []);

  const [tab, setTab] = useState<FinanceTab>("payments");
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [expenseDetailId, setExpenseDetailId] = useState<string | null>(null);
  // FIX (missing detail view): payment detail drawer — payments previously
  // had no inspection UI, and the global-search deep link
  // `/financials?paymentId=…` was ignored entirely.
  const [paymentDetailId, setPaymentDetailId] = useState<string | null>(null);

  // FIX (deep link): `/financials?paymentId=…` opens the payment drawer on
  // the payments tab, then cleans the param.
  useEffect(() => {
    const paymentId = searchParams.get("paymentId");
    if (paymentId) {
      setTab("payments");
      setPaymentDetailId(paymentId);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete("paymentId");
          return next;
        },
        { replace: true },
      );
    }
  }, [searchParams, setSearchParams]);

  const totalToday = sumPaidPayments(payments);
  const pendingExpenses = expenses.filter((e) => e.status === "submitted").length;
  const overdueDebt = debtSummary.reduce((s, d) => s + d.outstandingAmount, 0);
  const monthlyRev = monthlyRevenue(payments);

  const canCollect = !!session && session.permissions.has(Permission.CollectPayment);
  const canSubmitExpense = !!session && session.permissions.has(Permission.SubmitExpense);

  function openExpense(id: string) {
    setExpenseDetailId(id);
  }

  const descriptionFor = (active: FinanceTab): string => {
    switch (active) {
      case "payments":
        return "Journal des paiements encaissés — recherchez par reçu, méthode ou catégorie.";
      case "installments":
        return "Échéancier des tranches par famille — encaissement en un clic.";
      case "debt":
        return "Top 20 débiteurs familiaux + répartition par niveau scolaire.";
      case "expenses":
        return "Demandes de dépenses — workflow Approbation → Décaissement → Justificatif.";
      case "receipts":
        return "Reçus générés — téléchargement PDF et régénération à la demande.";
    }
  };

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title={t("nav.financials")}
        description={descriptionFor(tab)}
        actions={
          <TabActions
            tab={tab}
            canCollect={canCollect}
            canSubmitExpense={canSubmitExpense}
            onCollect={() => setPaymentOpen(true)}
            onExpense={() => setExpenseOpen(true)}
          />
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

      <PageTabs
        value={tab}
        onValueChange={(v) => setTab(v as FinanceTab)}
        className="flex-1 flex flex-col px-6 pb-6 min-h-0"
      >
        <PageTabList>
          <PageTab value="payments" label="Paiements" icon={CreditCard} />
          <PageTab value="installments" label="Tranches" icon={CalendarClock} />
          <PageTab value="debt" label="Créances" icon={AlertCircle} count={debtSummary.length} countTone={overdueDebt > 0 ? "danger" : "default"} />
          <PageTab value="expenses" label="Dépenses" icon={Send} count={pendingExpenses} countTone={pendingExpenses > 0 ? "warning" : "default"} />
          <PageTab value="receipts" label="Reçus" icon={FileCheck} />
        </PageTabList>

        <PageTabContent value="payments">
          <PaymentsTab payments={payments} onOpenPayment={setPaymentDetailId} />
        </PageTabContent>
        <PageTabContent value="installments">
          <InstallmentScheduleTab />
        </PageTabContent>
        <PageTabContent value="debt">
          <DebtTab />
        </PageTabContent>
        <PageTabContent value="expenses">
          <ExpensesTab expenses={expenses} onOpenExpense={openExpense} />
        </PageTabContent>
        <PageTabContent value="receipts">
          <ReceiptsTab />
        </PageTabContent>
      </PageTabs>

      <CounterPaymentModal open={paymentOpen} onOpenChange={setPaymentOpen} />
      <PaymentDetailDrawer
        paymentId={paymentDetailId}
        open={paymentDetailId !== null}
        onOpenChange={(o) => !o && setPaymentDetailId(null)}
        onOpenParent={(parentId) => {
          setPaymentDetailId(null);
          navigate(`/crm?parentId=${parentId}`);
        }}
      />
      <ExpenseSubmitModal
        open={expenseOpen}
        onOpenChange={setExpenseOpen}
        onSubmitted={(id) => openExpense(id)}
      />
      <ExpenseDetailDrawer
        expenseId={expenseDetailId}
        open={expenseDetailId !== null}
        onOpenChange={(o) => !o && setExpenseDetailId(null)}
      />
    </div>
  );
}

// ============================================================================
// TabActions — purpose-bound action buttons that change based on active tab
// ============================================================================

function TabActions({
  tab,
  canCollect,
  canSubmitExpense,
  onCollect,
  onExpense,
}: {
  tab: FinanceTab;
  canCollect: boolean;
  canSubmitExpense: boolean;
  onCollect: () => void;
  onExpense: () => void;
}) {
  switch (tab) {
    case "installments":
      return canCollect ? (
        <Button size="sm" onClick={onCollect}>
          <Plus className="h-4 w-4" /> Encaissement
        </Button>
      ) : null;
    case "expenses":
      return canSubmitExpense ? (
        <Button variant="outline" size="sm" onClick={onExpense}>
          <FileText className="h-4 w-4" /> Nouvelle dépense
        </Button>
      ) : null;
    case "payments":
    case "debt":
    case "receipts":
      return null;
    default:
      return null;
  }
}

// ============================================================================
// PaymentsTab — DataTable-backed list
// ============================================================================

const PAYMENT_STATUS_TONE: Record<string, "success" | "warning" | "danger" | "neutral" | "info"> = {
  paid: "success",
  pending: "warning",
  overdue: "danger",
  refunded: "neutral",
  partial: "info",
};

function PaymentsTab({
  payments,
  onOpenPayment,
}: {
  payments: readonly Payment[];
  onOpenPayment: (id: string) => void;
}) {
  const columns: readonly DataTableColumn<Payment>[] = [
    {
      header: "Reçu",
      accessor: "receiptNumber",
      cell: (p) => <span className="font-mono font-medium">{p.receiptNumber}</span>,
    },
    {
      header: "Méthode",
      accessor: "method",
      cell: (p) => PAYMENT_METHOD_LABELS_FR[p.method],
    },
    {
      header: "Catégorie",
      accessor: "category",
      cell: (p) => PAYMENT_CATEGORY_LABELS_FR[p.category],
    },
    {
      header: "Montant",
      accessor: "amount",
      cell: (p) => <span className="font-mono font-semibold">{formatDzd(p.amount)}</span>,
    },
    {
      header: "Date",
      accessor: "collectedAt",
      cell: (p) => formatRelative(p.collectedAt),
    },
    {
      header: "Statut",
      accessor: "status",
      cell: (p) => (
        <StatusChip
          label={PAYMENT_STATUS_LABELS_FR[p.status]}
          tone={PAYMENT_STATUS_TONE[p.status] ?? "neutral"}
        />
      ),
    },
  ];

  return (
    <DataTable<Payment>
      data={payments}
      columns={columns}
      onRowClick={(p) => onOpenPayment(p.id)}
      getRowId={(p) => p.id}
      searchFields={["receiptNumber", "method", "category"]}
      searchPlaceholder="Rechercher un reçu, méthode, catégorie…"
      pageSize={15}
    />
  );
}

// ============================================================================
// ExpensesTab — DataTable-backed list with row click → drawer
// ============================================================================

const EXPENSE_STATUS_TONE: Record<string, "success" | "info" | "warning" | "danger" | "neutral"> = {
  draft: "neutral",
  submitted: "warning",
  approved: "info",
  rejected: "danger",
  disbursed: "warning",
  settled: "success",
};

function ExpensesTab({
  expenses,
  onOpenExpense,
}: {
  expenses: readonly Expense[];
  onOpenExpense: (id: string) => void;
}) {
  const columns: readonly DataTableColumn<Expense>[] = [
    {
      header: "Réf.",
      accessor: "requestCode",
      cell: (e) => <span className="font-mono">{e.requestCode}</span>,
    },
    {
      header: "Intitulé",
      accessor: "title",
      cell: (e) => <span className="font-medium">{e.title}</span>,
    },
    {
      header: "Catégorie",
      accessor: "category",
      cell: (e) => EXPENSE_CATEGORY_LABELS_FR[e.category],
    },
    { header: "Bénéficiaire", accessor: "payee" },
    {
      header: "Montant",
      accessor: "amount",
      cell: (e) => <span className="font-mono font-semibold">{formatDzd(e.amount)}</span>,
    },
    {
      header: "Statut",
      accessor: "status",
      cell: (e) => (
        <div className="flex flex-col items-start gap-1">
          <StatusChip label={EXPENSE_STATUS_LABELS_FR[e.status]} tone={EXPENSE_STATUS_TONE[e.status] ?? "neutral"} />
          {e.anomalyScore != null && e.anomalyScore > 0.7 && (
            <StatusChip label="Anomalie" tone="danger" />
          )}
        </div>
      ),
    },
  ];

  const actions: readonly DataTableAction<Expense>[] = [
    {
      label: "Détails",
      variant: "outline",
      onClick: (e) => onOpenExpense(e.id),
    },
  ];

  return (
    <DataTable<Expense>
      data={expenses}
      columns={columns}
      actions={actions}
      searchFields={["title", "requestCode", "payee"]}
      searchPlaceholder="Rechercher une dépense…"
      pageSize={15}
      onRowClick={(e) => onOpenExpense(e.id)}
    />
  );
}

// ============================================================================
// DebtTab — Top 20 family debtors (DataTable) + per-grade breakdown (bars)
// ============================================================================

interface DebtSummaryRow {
  readonly parentId: string;
  readonly parentName: string;
  readonly parentPhone: string;
  readonly studentCount: number;
  readonly bucket: string;
  readonly daysOverdue: number;
  readonly outstandingAmount: number;
}

function DebtTab() {
  const repos = useRepositories();
  const debt = useObservable(() => repos.debt.observeSummary(), []);
  const students = useObservable(() => repos.students.observe(), []);
  const [reminding, setReminding] = useState<string | null>(null);
  const [collectFor, setCollectFor] = useState<{ parentId: string; parentName: string; amount: number } | null>(null);

  async function sendReminder(parentId: string, name: string) {
    setReminding(parentId);
    try {
      const r = await repos.debt.sendReminder(parentId);
      if (r.ok) {
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

  const top20Debtors = useMemo(
    () => [...debt]
      .filter((d) => d.outstandingAmount > 0)
      .sort((a, b) => b.outstandingAmount - a.outstandingAmount)
      .slice(0, 20),
    [debt],
  );

  const perGradeBreakdown = useMemo(() => {
    const totals = new Map<string, number>();
    for (const d of debt) {
      if (d.outstandingAmount <= 0) continue;
      const familyStudents = students.filter((s) => s.parentId === d.parentId);
      if (familyStudents.length === 0) {
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

  const columns: readonly DataTableColumn<DebtSummaryRow>[] = [
    {
      header: "#",
      accessor: "parentId",
      cell: (_d, idx) => (
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-status-danger/10 text-xs font-mono font-semibold text-status-danger">
          {idx + 1}
        </span>
      ),
      sortable: false,
    },
    {
      header: "Parent",
      accessor: "parentName",
      cell: (d) => (
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{d.parentName}</p>
          <p className="text-xs text-muted-foreground font-mono">{d.parentPhone}</p>
        </div>
      ),
    },
    { header: "Élèves", accessor: "studentCount", cell: (d) => `${d.studentCount} enfant(s)` },
    {
      header: "Tranche d'âge",
      accessor: "bucket",
      cell: (d) => (
        <StatusChip
          label={AGING_BUCKET_LABELS_FR[d.bucket as keyof typeof AGING_BUCKET_LABELS_FR] ?? d.bucket}
          tone={d.bucket === "0_30" ? "success" : d.bucket === "31_60" ? "warning" : "danger"}
        />
      ),
    },
    { header: "Retard", accessor: "daysOverdue", cell: (d) => `${d.daysOverdue} j` },
    {
      header: "Créance",
      accessor: "outstandingAmount",
      cell: (d) => <span className="font-mono font-bold text-status-danger">{formatDzd(d.outstandingAmount)}</span>,
    },
  ];

  const actions: readonly DataTableAction<DebtSummaryRow>[] = [
    {
      label: "Rappel",
      variant: "outline",
      onClick: (d) => sendReminder(d.parentId, d.parentName),
    },
    {
      label: "Encaisser",
      variant: "default",
      icon: <Wallet className="size-3.5" />,
      onClick: (d) => setCollectFor({
        parentId: d.parentId,
        parentName: d.parentName,
        amount: d.outstandingAmount,
      }),
    },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-3">
          <h3 className="text-sm font-medium text-foreground flex items-center gap-2 mb-3">
            <AlertCircle className="h-4 w-4 text-status-danger" />
            Top 20 débiteurs familiaux
            <span className="text-[10px] text-muted-foreground font-normal">
              (plan §07.06 — priorisation du recouvrement)
            </span>
          </h3>
          <DataTable<DebtSummaryRow>
            data={top20Debtors as unknown as DebtSummaryRow[]}
            columns={columns}
            actions={actions}
            pageSize={20}
            hideSearch
          />
        </CardContent>
      </Card>

      {perGradeBreakdown.length > 0 && (
        <Card>
          <CardContent className="pt-3">
            <h3 className="text-sm font-medium text-foreground flex items-center gap-2 mb-3">
              <TrendingUp className="h-4 w-4 text-primary" />
              Répartition par niveau scolaire
              <span className="text-[10px] text-muted-foreground font-normal">
                (part proportionnelle par élève de la famille)
              </span>
            </h3>
            <div className="space-y-2">
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

      {collectFor && (
        <UnifiedPaymentModal
          open={!!collectFor}
          onOpenChange={(o) => !o && setCollectFor(null)}
          context={
            (() => {
              const ctx: PaymentNavigationContext = {
                parentId: collectFor.parentId,
                parentName: collectFor.parentName,
                mode: "consolidated_debt",
                presetAmount: collectFor.amount,
                lineItems: [{
                  itemId: `debt-${collectFor.parentId}`,
                  category: "other",
                  label: "Solde familial consolidé",
                  grossAmount: collectFor.amount,
                  discountAmount: 0,
                  netAmount: collectFor.amount,
                  alreadyPaidAmount: 0,
                  remainingAmount: collectFor.amount,
                }],
                allowPartial: true,
                originRoute: "financials.debt_dashboard",
              };
              return ctx;
            })()
          }
        />
      )}
    </div>
  );
}
