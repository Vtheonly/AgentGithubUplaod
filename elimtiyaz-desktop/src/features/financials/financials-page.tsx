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
  Bell,
  Lock,
} from "lucide-react";
import { useRepositories } from "../../app/providers/repository-provider";
import { useAuth } from "../../app/providers/auth-provider";
import { useToast } from "../../app/providers/toast-provider";
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
import { ConfirmModal } from "../../shared/ui/unified-modal/confirm-modal";
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
  const toast = useToast();
  const { session } = useAuth();
  const debt = useObservable(() => repos.debt.observeSummary(), []);
  const students = useObservable(() => repos.students.observe(), []);
  const ledgerEntries = useObservable(() => repos.ledger.observe(), []);
  const [reminding, setReminding] = useState<string | null>(null);
  const [collectFor, setCollectFor] = useState<{ parentId: string; parentName: string; amount: number } | null>(null);
  // VAULT §10.08 — every manual bulk trigger requires a confirmation dialog
  // (two clicks: initiate + confirm).
  const [confirmBroadcast, setConfirmBroadcast] = useState(false);
  const [confirmLock, setConfirmLock] = useState(false);
  const [confirmReminderFor, setConfirmReminderFor] = useState<DebtSummaryRow | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  // VAULT §07.06 — Total Outstanding trend vs last month (↑ / ↓).
  // Debt 30 days ago = Σ max(0, per-parent ledger balance at cutoff).
  const { debtNow, debtPrevMonth, debtTrend } = useMemo(() => {
    const now = debt.reduce((acc, d) => acc + d.outstandingAmount, 0);
    const cutoff = Date.now() - 30 * 86_400_000;
    const byParent = new Map<string, number>();
    for (const e of ledgerEntries) {
      const at = new Date(e.at).getTime();
      if (at > cutoff) continue;
      byParent.set(e.parentId, (byParent.get(e.parentId) ?? 0) + e.amount);
    }
    let prev = 0;
    for (const balance of byParent.values()) {
      if (balance > 0) prev += balance;
    }
    const delta = now - prev;
    return {
      debtNow: now,
      debtPrevMonth: prev,
      debtTrend: Math.abs(delta) < 0.005 ? null : delta > 0 ? "up" : "down",
    };
  }, [debt, ledgerEntries]);

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

  // VAULT §10.07 — "Broadcast Overdue Payment Reminders" one-click trigger.
  async function broadcastReminders() {
    setBulkBusy(true);
    try {
      const r = await repos.debt.broadcastReminders(0, session?.userId);
      if (r.ok) {
        toast.showSuccess(
          "Rappels diffusés",
          `${r.value} rappel(s) envoyé(s) aux débiteurs — notifications portail + journal d'audit.`,
        );
      } else {
        toast.showError("Échec de la diffusion", r.error.userMessage);
      }
    } finally {
      setBulkBusy(false);
      setConfirmBroadcast(false);
    }
  }

  // VAULT §10.07 — "Lock Delinquent Accounts" (> 90 days overdue).
  async function lockDelinquent() {
    setBulkBusy(true);
    try {
      const r = await repos.debt.lockDelinquentAccounts(90, session?.userId);
      if (r.ok) {
        toast.showWarning(
          "Comptes délinquants verrouillés",
          `${r.value} compte(s) marqué(s) FINANCIALLY_RESTRICTED (> 90 jours de retard). Chaque restriction est journalisée.`,
        );
      } else {
        toast.showError("Échec du verrouillage", r.error.userMessage);
      }
    } finally {
      setBulkBusy(false);
      setConfirmLock(false);
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
      onClick: (d) => setConfirmReminderFor(d),
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
      {/* VAULT §07.06 — Debt Dashboard sections 1 + 4: Total Outstanding (with
          MoM trend) + Actions (broadcast reminders / lock delinquent). */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card>
          <CardContent className="pt-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase text-muted-foreground">Créances totales</p>
                <p className="break-words text-2xl font-mono font-bold text-status-danger">
                  {formatDzd(debtNow)}
                </p>
                <p className="text-xs text-muted-foreground">
                  Il y a 30 jours : {formatDzd(debtPrevMonth)}
                </p>
              </div>
              {debtTrend && (
                <div
                  className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${
                    debtTrend === "up"
                      ? "bg-status-danger/10 text-status-danger"
                      : "bg-status-success/10 text-status-success"
                  }`}
                >
                  <TrendingUp
                    className={`h-3.5 w-3.5 ${debtTrend === "down" ? "rotate-180" : ""}`}
                  />
                  {debtTrend === "up" ? "En hausse" : "En baisse"} vs mois dernier
                </div>
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-3">
            <p className="text-xs uppercase text-muted-foreground mb-2">Actions groupées</p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={bulkBusy || top20Debtors.length === 0}
                onClick={() => setConfirmBroadcast(true)}
              >
                <Bell className="h-4 w-4" /> Diffuser les rappels
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={bulkBusy || top20Debtors.length === 0}
                onClick={() => setConfirmLock(true)}
              >
                <Lock className="h-4 w-4" /> Verrouiller comptes délinquants
              </Button>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Rappels : notification portail à chaque débiteur. Verrouillage : FINANCIALLY_RESTRICTED
              pour les retards supérieurs à 90 jours (plan §07.06 / §10.07 — confirmation requise).
            </p>
          </CardContent>
        </Card>
      </div>

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

      {/* VAULT §10.08 — confirmation dialogs for every manual trigger */}
      <ConfirmModal
        open={confirmBroadcast}
        onOpenChange={setConfirmBroadcast}
        title="Diffuser les rappels de paiement"
        description={
          <>
            Un rappel sera envoyé à <b>chaque débiteur</b> de la liste (notification portail +
            journal d'audit). Cette action groupée s'applique aux {top20Debtors.length} famille(s)
            endettées affichées — elle ne peut pas être annulée après confirmation.
          </>
        }
        confirmLabel="Diffuser maintenant"
        onConfirm={broadcastReminders}
      />
      <ConfirmModal
        open={confirmLock}
        onOpenChange={setConfirmLock}
        destructive
        title="Verrouiller les comptes délinquants"
        description={
          <>
            Tous les comptes avec plus de <b>90 jours</b> de retard seront marqués
            FINANCIALLY_RESTRICTED (accès restreint). Chaque restriction est journalisée
            avec l'identité de l'acteur. Les comptes déjà restreints sont ignorés.
          </>
        }
        confirmLabel="Verrouiller"
        onConfirm={lockDelinquent}
      />
      <ConfirmModal
        open={!!confirmReminderFor}
        onOpenChange={(o) => !o && setConfirmReminderFor(null)}
        title={`Envoyer un rappel à ${confirmReminderFor?.parentName ?? ""}`}
        description={
          <>
            Un rappel WhatsApp sera préparé et un événement d'audit sera enregistré pour la
            créance de <b>{confirmReminderFor ? formatDzd(confirmReminderFor.outstandingAmount) : ""}</b>
            (retard : {confirmReminderFor?.daysOverdue ?? 0} jours).
          </>
        }
        confirmLabel="Envoyer le rappel"
        onConfirm={() => {
          if (!confirmReminderFor) return;
          void sendReminder(confirmReminderFor.parentId, confirmReminderFor.parentName);
          setConfirmReminderFor(null);
        }}
      />
    </div>
  );
}
