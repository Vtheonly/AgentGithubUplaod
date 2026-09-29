// ============================================================================
// FILE: elimtiyaz-desktop/src/features/financials/financials-page.tsx
// ============================================================================
/**
 * Financials hub — Hub 4. Plan §07.
 *
 * Tabs: Paiements / Tranches / Créances / Suivi des Dettes / Dépenses / Reçus / Diagnostic.
 *
 * Fully integrated with the global Person Navigation System:
 *   - Parent and student names are interactive across all financial tables.
 *   - Contextual three-dot menus (ParentActionsMenu & StudentActionsMenu)
 *     allow immediate cross-module jumps without manual re-searching.
 *   - Full drawer support for payments, expenses, and family accounts.
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
  Brain,
  Hourglass,
  Trash2,
} from "lucide-react";
import { useRepositories } from "../../app/providers/repository-provider";
import { useAuth } from "../../app/providers/auth-provider";
import { useToast } from "../../app/providers/toast-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import {
  observeSeedHealth,
  type SeedHealthEntry,
} from "../../infrastructure/supabase/repositories/supabase-shared-repositories";
import { formatDzd } from "../../core/format/currency";
import { formatRelative, formatDateTime } from "../../core/format/date";
import { parentDisplayName } from "../../domain/model/parent";
import { Avatar, AvatarFallback } from "../../shared/ui/avatar";
import {
  PAYMENT_METHOD_LABELS_FR,
  PAYMENT_STATUS_LABELS_FR,
  PAYMENT_CATEGORY_LABELS_FR,
  paymentCategoryLabelFr,
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
import { DebtAgingTab } from "./debt-aging-tab";
import {
  evaluateFamilyFinancialDiagnoses,
  computeCrossServicePerformance,
  computeTreasuryHealth,
} from "../../domain/calc/payment/financial-query-engine";
import { FinancialQueryConsole } from "./financial-query-console";
import { CrossServiceMatrix } from "./cross-service-matrix";
import { CashFlowRadar } from "./cash-flow-radar";
import { PayrollFundingCard } from "./payroll-funding-card";
import { computePayrollForecast } from "../../domain/calc/payroll/payroll-forecast";
import { usePersonNavigation } from "../../shared/navigation/person-navigation-context";
import { ParentActionsMenu } from "../../shared/ui/parent-actions-menu";
import { StudentActionsMenu } from "../../shared/ui/student-actions-menu";

type FinanceTab =
  | "payments"
  | "installments"
  | "debt"
  | "debt-aging"
  | "expenses"
  | "receipts"
  | "diagnostic";

const FINANCIAL_SEED_SOURCES = [
  "payments",
  "installments",
  "ledger",
  "debtSummary",
  "allocations",
] as const;

const SEED_SOURCE_LABELS_FR: Record<string, string> = {
  payments: "paiements",
  installments: "tranches",
  ledger: "grand livre",
  debtSummary: "créances",
  allocations: "ventilations",
};

export function FinancialsPage() {
  const { t } = useTranslation();
  const repos = useRepositories();
  const { session } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { openParent, openStudent } = usePersonNavigation();

  const payments = useObservable(() => repos.payments.observe(), []);
  const expenses = useObservable(() => repos.expenses.observe(), []);
  const debtSummary = useObservable(() => repos.debt.observeSummary(), []);
  const parents = useObservable(() => repos.parents.observe(), []);
  const students = useObservable(() => repos.students.observe(), []);
  const installments = useObservable(() => repos.installments.observe(), []);
  const ledgerEntries = useObservable(() => repos.ledger.observe(), []);
  const paymentAllocations = useObservable(
    () =>
      repos.payments.observeAllocations?.() ?? {
        subscribe: () => () => {},
        get: () => [],
      },
    [],
  );
  const payrollPersonnel = useObservable(
    () =>
      repos.personnel?.observe?.() ?? {
        subscribe: () => () => {},
        get: () => [],
      },
    [],
  );
  const salaryPayments = useObservable(
    () =>
      repos.personnel?.observeSalaryPayments?.() ?? {
        subscribe: () => () => {},
        get: () => [],
      },
    [],
  );

  const [tab, setTab] = useState<FinanceTab>("payments");
  const [paymentOpen, setPaymentOpen] = useState(false);
  const seedHealth = useObservable(() => observeSeedHealth(), []);
  const degradedFinancialSeeds = seedHealth.filter(
    (h: SeedHealthEntry) =>
      h.state === "degraded" &&
      (FINANCIAL_SEED_SOURCES as readonly string[]).includes(h.source),
  );
  const isSeedDegraded = (source: string): boolean =>
    seedHealth.some((h: SeedHealthEntry) => h.source === source && h.state === "degraded");
  const paymentsKnown = !isSeedDegraded("payments") || payments.length > 0;
  const debtSummaryKnown = !isSeedDegraded("debtSummary") || debtSummary.length > 0;
  const [retryingSeeds, setRetryingSeeds] = useState(false);

  const retryDegradedSeeds = async () => {
    setRetryingSeeds(true);
    try {
      await Promise.all([
        repos.payments.refresh?.(),
        repos.installments.refresh?.(),
        repos.ledger.refresh?.(),
        repos.debt.refreshSummary?.(),
      ]);
    } finally {
      setRetryingSeeds(false);
    }
  };

  const [diagnosticCollect, setDiagnosticCollect] = useState<{ parentId: string; amount: number } | null>(null);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [expenseDetailId, setExpenseDetailId] = useState<string | null>(null);
  const [paymentDetailId, setPaymentDetailId] = useState<string | null>(null);
  const [installmentCategoryFilter, setInstallmentCategoryFilter] = useState<string | null>(null);
  const [installmentFamilyFilter, setInstallmentFamilyFilter] = useState<string | null>(null);

  useEffect(() => {
    const paymentId = searchParams.get("paymentId");
    const expenseId = searchParams.get("expenseId");
    const installmentId = searchParams.get("installmentId");
    const tabParam = searchParams.get("tab");
    const familyId = searchParams.get("familyId");

    if (paymentId) {
      setTab("payments");
      setPaymentDetailId(paymentId);
    }
    if (expenseId) {
      setTab("expenses");
      setExpenseDetailId(expenseId);
    }
    if (installmentId) {
      setTab("installments");
    }
    if (familyId) {
      setTab("installments");
      setInstallmentFamilyFilter(familyId);
    }
    if (
      tabParam === "payments" ||
      tabParam === "installments" ||
      tabParam === "debt" ||
      tabParam === "debt-aging" ||
      tabParam === "expenses" ||
      tabParam === "receipts" ||
      tabParam === "diagnostic"
    ) {
      setTab(tabParam);
    }
    if (paymentId || expenseId || installmentId || tabParam || familyId) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete("paymentId");
          next.delete("expenseId");
          next.delete("installmentId");
          next.delete("familyId");
          next.delete("tab");
          return next;
        },
        { replace: true },
      );
    }
  }, [searchParams, setSearchParams]);

  const totalToday = sumPaidPayments(payments);
  const pendingExpenses = expenses.filter((e) => e.status === "submitted").length;
  const overdueDebt = debtSummary.reduce((s, d) => s + d.outstandingAmount, 0);
  const pastDueDebt = debtSummary
    .filter((d) => d.daysOverdue > 0)
    .reduce((s, d) => s + d.outstandingAmount, 0);
  const monthlyRev = monthlyRevenue(payments);

  const financialDiagnoses = useMemo(() => {
    return evaluateFamilyFinancialDiagnoses({
      parents,
      students,
      installments,
      payments,
      ledgerEntries,
      debtSummaries: debtSummary,
    });
  }, [parents, students, installments, payments, ledgerEntries, debtSummary]);

  const servicePerformance = useMemo(() => {
    return computeCrossServicePerformance({
      installments,
      payments,
      allocations: paymentAllocations,
    });
  }, [installments, payments, paymentAllocations]);

  const payrollForecast = useMemo(
    () =>
      computePayrollForecast({
        personnel: payrollPersonnel,
        salaryPayments,
        now: new Date(),
      }),
    [payrollPersonnel, salaryPayments],
  );

  const treasuryHealth = useMemo(() => {
    return computeTreasuryHealth({
      payments,
      installments,
      expenses,
      debtSummaries: debtSummary,
      payroll: payrollForecast,
    });
  }, [payments, installments, expenses, debtSummary, payrollForecast]);

  const diagnosticAlertCount = useMemo(
    () =>
      financialDiagnoses.filter(
        (d) => d.anomalies.length > 0 && !d.anomalies.includes("healthy"),
      ).length,
    [financialDiagnoses],
  );

  const canCollect = !!session && session.permissions.has(Permission.CollectPayment);
  const canSubmitExpense = !!session && session.permissions.has(Permission.SubmitExpense);

  function openExpense(id: string) {
    setExpenseDetailId(id);
  }

  const descriptionFor = (active: FinanceTab): string => {
    switch (active) {
      case "payments":
        return "Journal des paiements encaissés — cliquez sur un émetteur ou un élève pour ouvrir son profil.";
      case "installments":
        return "Échéancier des tranches par famille — encaissement en un clic.";
      case "debt":
        return "Top 20 débiteurs familiaux + répartition par niveau scolaire.";
      case "debt-aging":
        return "Suivi des dettes multi-années — ancienneté, comportement de paiement et statut canonique par famille.";
      case "expenses":
        return "Demandes de dépenses — workflow Approbation → Décaissement → Justificatif.";
      case "receipts":
        return "Reçus générés — téléchargement PDF et régénération à la demande.";
      case "diagnostic":
        return "Diagnostic financier des familles — requêtes stratégiques, fuite inter-services et santé de trésorerie.";
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

      {degradedFinancialSeeds.length > 0 && (
        <div
          role="alert"
          data-testid="finance-seed-degraded-banner"
          className="mx-6 mb-3 flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <AlertTriangle className="size-4 shrink-0" />
          <span className="font-medium">Échec du chargement des données financières</span>
          <span className="text-destructive/80">
            (
            {degradedFinancialSeeds
              .map((h: SeedHealthEntry) => SEED_SOURCE_LABELS_FR[h.source] ?? h.source)
              .join(", ")}
            ) — les dernières valeurs connues sont conservées.
          </span>
          <button
            type="button"
            onClick={() => void retryDegradedSeeds()}
            disabled={retryingSeeds}
            className="ml-auto rounded-md border border-destructive/50 px-2.5 py-1 text-xs font-medium uppercase tracking-wide hover:bg-destructive/20 disabled:opacity-50"
          >
            {retryingSeeds ? "Chargement…" : "Réessayer"}
          </button>
        </div>
      )}

      <div className="px-6 pb-3">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <button
            type="button"
            onClick={() => setTab("payments")}
            title="Voir le journal des paiements"
            className="text-left rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer transition-transform hover:-translate-y-0.5"
          >
            <KpiCard
              label="Encaissé (cumul)"
              value={paymentsKnown ? formatDzd(totalToday, { compact: true }) : "—"}
              icon={<Wallet className="h-5 w-5" />}
              tone="success"
            />
          </button>
          <button
            type="button"
            onClick={() => setTab("payments")}
            title="Voir le journal des paiements"
            className="text-left rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer transition-transform hover:-translate-y-0.5"
          >
            <KpiCard
              label="Revenu mensuel"
              value={paymentsKnown ? formatDzd(monthlyRev, { compact: true }) : "—"}
              icon={<TrendingUp className="h-5 w-5" />}
              tone="info"
            />
          </button>
          <button
            type="button"
            onClick={() => setTab("debt")}
            title={`Encours des tranches — dont ${formatDzd(pastDueDebt)} échues (en retard).`}
            className="text-left rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer transition-transform hover:-translate-y-0.5"
          >
            <KpiCard
              label="Encours total créances"
              value={debtSummaryKnown ? formatDzd(overdueDebt, { compact: true }) : "—"}
              hint={
                debtSummaryKnown
                  ? `base échéancier · dont ${formatDzd(pastDueDebt, { compact: true })} échues`
                  : undefined
              }
              icon={<AlertTriangle className="h-5 w-5" />}
              tone="danger"
            />
          </button>
          <button
            type="button"
            onClick={() => setTab("expenses")}
            title="Voir les dépenses en attente"
            className="text-left rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer transition-transform hover:-translate-y-0.5"
          >
            <KpiCard
              label="Dépenses en attente"
              value={pendingExpenses}
              icon={<Receipt className="h-5 w-5" />}
              tone="warning"
            />
          </button>
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
          <PageTab
            value="debt"
            label="Créances"
            icon={AlertCircle}
            count={debtSummary.length}
            countTone={overdueDebt > 0 ? "danger" : "default"}
          />
          <PageTab value="debt-aging" label="Suivi des Dettes" icon={Hourglass} />
          <PageTab
            value="expenses"
            label="Dépenses"
            icon={Send}
            count={pendingExpenses}
            countTone={pendingExpenses > 0 ? "warning" : "default"}
          />
          <PageTab value="receipts" label="Reçus" icon={FileCheck} />
          <PageTab
            value="diagnostic"
            label="Diagnostic & Requêtes"
            icon={Brain}
            count={diagnosticAlertCount}
            countTone={diagnosticAlertCount > 0 ? "warning" : "default"}
          />
        </PageTabList>

        <PageTabContent value="payments">
          <PaymentsTab
            payments={payments}
            onOpenPayment={setPaymentDetailId}
            onOpenParent={openParent}
            onOpenStudent={openStudent}
          />
        </PageTabContent>
        <PageTabContent value="installments">
          <InstallmentScheduleTab
            initialCategory={installmentCategoryFilter}
            initialFamilyId={installmentFamilyFilter}
          />
        </PageTabContent>
        <PageTabContent value="debt">
          <DebtTab onOpenParent={openParent} />
        </PageTabContent>
        <PageTabContent value="debt-aging">
          <DebtAgingTab />
        </PageTabContent>
        <PageTabContent value="expenses">
          <ExpensesTab expenses={expenses} onOpenExpense={openExpense} />
        </PageTabContent>
        <PageTabContent value="receipts">
          <ReceiptsTab />
        </PageTabContent>
        <PageTabContent value="diagnostic">
          <div className="space-y-4">
            <FinancialQueryConsole
              diagnoses={financialDiagnoses}
              onOpenParent={(parentId) => {
                openParent(parentId);
              }}
              onCollectPayment={(parentId, amount) => {
                setDiagnosticCollect({ parentId, amount });
                setPaymentOpen(true);
              }}
            />

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              <div className="lg:col-span-7">
                <CrossServiceMatrix
                  services={servicePerformance}
                  onFilterService={(category) => {
                    setInstallmentCategoryFilter(category);
                    setTab("installments");
                  }}
                />
              </div>
              <div className="lg:col-span-5 space-y-4">
                <CashFlowRadar treasury={treasuryHealth} />
                <PayrollFundingCard treasury={treasuryHealth} />
              </div>
            </div>
          </div>
        </PageTabContent>
      </PageTabs>

      <CounterPaymentModal
        open={paymentOpen}
        onOpenChange={(o) => {
          setPaymentOpen(o);
          if (!o) setDiagnosticCollect(null);
        }}
        presetParentId={diagnosticCollect?.parentId ?? null}
        presetAmount={diagnosticCollect?.amount ?? null}
      />
      <PaymentDetailDrawer
        paymentId={paymentDetailId}
        open={paymentDetailId !== null}
        onOpenChange={(o) => !o && setPaymentDetailId(null)}
        onOpenParent={(parentId) => {
          setPaymentDetailId(null);
          openParent(parentId);
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
    case "diagnostic":
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
    case "debt-aging":
    case "receipts":
      return null;
    default:
      return null;
  }
}

const PAYMENT_STATUS_TONE: Record<string, "success" | "warning" | "danger" | "neutral" | "info"> = {
  paid: "success",
  pending: "warning",
  overdue: "danger",
  refunded: "neutral",
  partial: "info",
};

interface EnrichedPaymentRow extends Payment {
  readonly parentName: string;
  readonly parentCode: string;
  readonly studentName: string;
  readonly exactDateTime: string;
}

function PaymentsTab({
  payments,
  onOpenPayment,
  onOpenParent,
  onOpenStudent,
}: {
  payments: readonly Payment[];
  onOpenPayment: (id: string) => void;
  onOpenParent: (id: string) => void;
  onOpenStudent: (id: string) => void;
}) {
  const repos = useRepositories();
  const parents = useObservable(() => repos.parents.observe(), []);
  const students = useObservable(() => repos.students.observe(), []);

  const rows: readonly EnrichedPaymentRow[] = useMemo(() => {
    const parentMap = new Map(parents.map((p) => [p.id, p]));
    const studentMap = new Map(students.map((s) => [s.id, s]));
    return payments.map((p) => {
      const par = parentMap.get(p.parentId);
      const stu = p.studentId ? studentMap.get(p.studentId) : undefined;
      const parentName = par ? parentDisplayName(par) : "Parent non répertorié";
      const studentName = stu ? `${stu.firstName} ${stu.lastName}`.trim() : "";
      return {
        ...p,
        parentName,
        parentCode: par?.code ?? "",
        studentName,
        exactDateTime: formatDateTime(p.collectedAt),
      };
    });
  }, [payments, parents, students]);

  const columns: readonly DataTableColumn<EnrichedPaymentRow>[] = [
    {
      header: "Émetteur (Payeur)",
      accessor: "parentName",
      cell: (p) => (
        <div className="flex items-center gap-2.5 min-w-0">
          <Avatar className="h-8 w-8 shrink-0">
            <AvatarFallback className="text-xs font-semibold bg-primary/10 text-primary">
              {p.parentName
                .split(/\s+/)
                .slice(0, 2)
                .map((w) => w[0])
                .join("")
                .toUpperCase() || "PA"}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenParent(p.parentId);
                }}
                className="text-sm font-semibold text-foreground hover:text-primary hover:underline truncate text-left"
              >
                {p.parentName}
              </button>
              <ParentActionsMenu
                parent={{
                  id: p.parentId,
                  displayName: p.parentName,
                  code: p.parentCode,
                }}
              />
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground min-w-0">
              {p.parentCode && <span className="font-mono shrink-0">{p.parentCode}</span>}
              {p.studentName && (
                <>
                  <span className="shrink-0">·</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (p.studentId) onOpenStudent(p.studentId);
                    }}
                    className="hover:text-primary hover:underline truncate"
                  >
                    Élève : {p.studentName}
                  </button>
                  {p.studentId && (
                    <StudentActionsMenu
                      student={{
                        id: p.studentId,
                        firstName: p.studentName.split(" ")[0] ?? p.studentName,
                        lastName: p.studentName.split(" ").slice(1).join(" ") ?? "",
                        parentId: p.parentId,
                      }}
                      parentName={p.parentName}
                    />
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      ),
    },
    {
      header: "Reçu / Encaissé par",
      accessor: "receiptNumber",
      cell: (p) => (
        <div className="flex flex-col max-w-[170px]">
          <span
            className="font-mono text-xs font-medium text-foreground truncate"
            title={p.receiptNumber}
          >
            {p.receiptNumber}
          </span>
          {p.collectedBy && (
            <span className="text-[10px] text-muted-foreground truncate" title={p.collectedBy}>
              Par : {p.collectedBy}
            </span>
          )}
        </div>
      ),
    },
    {
      header: "Date & Heure",
      accessor: "collectedAt",
      cell: (p) => (
        <div className="flex flex-col whitespace-nowrap">
          <span className="text-xs font-medium text-foreground">{p.exactDateTime}</span>
          <span className="text-[11px] text-muted-foreground">{formatRelative(p.collectedAt)}</span>
        </div>
      ),
    },
    {
      header: "Méthode",
      accessor: "method",
      cell: (p) => (
        <div className="flex flex-col min-w-0">
          <span className="text-xs font-medium text-foreground">{PAYMENT_METHOD_LABELS_FR[p.method]}</span>
          {p.checkNumber && (
            <span className="font-mono text-[10px] text-muted-foreground truncate" title={p.checkNumber}>
              N° {p.checkNumber}
            </span>
          )}
          {p.transferReference && (
            <span className="font-mono text-[10px] text-muted-foreground truncate" title={p.transferReference}>
              Réf : {p.transferReference}
            </span>
          )}
        </div>
      ),
    },
    {
      header: "Catégorie",
      accessor: "category",
      cell: (p) => (
        <span className="text-xs text-muted-foreground">{paymentCategoryLabelFr(p.category)}</span>
      ),
    },
    {
      header: "Montant",
      accessor: "amount",
      cell: (p) => <span className="font-mono font-semibold">{formatDzd(p.amount)}</span>,
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
    <DataTable<EnrichedPaymentRow>
      data={rows}
      columns={columns}
      onRowClick={(p) => onOpenPayment(p.id)}
      getRowId={(p) => p.id}
      searchFields={["parentName", "studentName", "parentCode", "receiptNumber", "method", "category"]}
      searchPlaceholder="Rechercher par payeur, élève, code famille, reçu, méthode, catégorie…"
      pageSize={15}
    />
  );
}

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

interface DebtSummaryRow {
  readonly parentId: string;
  readonly parentName: string;
  readonly parentPhone: string;
  readonly studentCount: number;
  readonly bucket: string;
  readonly daysOverdue: number;
  readonly outstandingAmount: number;
}

function DebtTab({ onOpenParent }: { onOpenParent?: (id: string) => void }) {
  const repos = useRepositories();
  const toast = useToast();
  const { session } = useAuth();
  const { openParent } = usePersonNavigation();
  const debt = useObservable(() => repos.debt.observeSummary(), []);
  const pastDueDebt = debt
    .filter((d) => d.daysOverdue > 0)
    .reduce((s, d) => s + d.outstandingAmount, 0);
  const students = useObservable(() => repos.students.observe(), []);
  const ledgerEntries = useObservable(() => repos.ledger.observe(), []);
  const [reminding, setReminding] = useState<string | null>(null);
  const [collectFor, setCollectFor] = useState<{ parentId: string; parentName: string; amount: number } | null>(null);
  const [confirmBroadcast, setConfirmBroadcast] = useState(false);
  const [confirmLock, setConfirmLock] = useState(false);
  const [confirmReminderFor, setConfirmReminderFor] = useState<DebtSummaryRow | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

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
    () =>
      [...debt]
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

  const handleOpenParentDirect = (id: string) => {
    if (onOpenParent) {
      onOpenParent(id);
    } else {
      openParent(id);
    }
  };

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
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => handleOpenParentDirect(d.parentId)}
              className="text-sm font-semibold text-foreground hover:text-primary hover:underline truncate text-left"
            >
              {d.parentName}
            </button>
            <ParentActionsMenu
              parent={{
                id: d.parentId,
                displayName: d.parentName,
                phone: d.parentPhone,
              }}
            />
          </div>
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
      onClick: (d) =>
        setCollectFor({
          parentId: d.parentId,
          parentName: d.parentName,
          amount: d.outstandingAmount,
        }),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card>
          <CardContent className="pt-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase text-muted-foreground">Encours total (toutes créances)</p>
                <p className="break-words text-2xl font-mono font-bold text-status-danger">
                  {formatDzd(debtNow)}
                </p>
                <p className="text-xs text-muted-foreground">
                  Dont échues (en retard) : {formatDzd(pastDueDebt)} · Il y a 30 jours : {formatDzd(debtPrevMonth)}
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
              pour les retards supérieurs à 90 jours (plan §07.06 / §10.07).
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
              (cliquez un parent pour ouvrir son dossier)
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
          context={{
            parentId: collectFor.parentId,
            parentName: collectFor.parentName,
            mode: "consolidated_debt",
            presetAmount: collectFor.amount,
            lineItems: [
              {
                itemId: `debt-${collectFor.parentId}`,
                category: null,
                label: "Solde familial consolidé (toutes catégories)",
                grossAmount: collectFor.amount,
                discountAmount: 0,
                netAmount: collectFor.amount,
                alreadyPaidAmount: 0,
                remainingAmount: collectFor.amount,
              },
            ],
            allowPartial: true,
            originRoute: "financials.debt_dashboard",
          }}
        />
      )}

      <ConfirmModal
        open={confirmBroadcast}
        onOpenChange={setConfirmBroadcast}
        title="Diffuser les rappels de paiement"
        description={
          <>
            Un rappel sera envoyé à <b>chaque débiteur</b> de la liste (notification portail +
            journal d'audit). Cette action groupée s'applique aux {top20Debtors.length} famille(s)
            endettées affichées.
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
            FINANCIALLY_RESTRICTED (accès restreint). Chaque restriction est journalisée.
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