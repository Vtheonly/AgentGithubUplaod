// ============================================================================
// FILE: elimtiyaz-desktop/src/features/dashboard/dashboard-page.tsx
// ============================================================================

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import {
  ChevronRight,
  LayoutDashboard,
  FileText,
  Bell,
  BarChart3,
  Settings2,
} from "lucide-react";
import { useRepositories } from "../../app/providers/repository-provider";
import { useAuth } from "../../app/providers/auth-provider";
import { useObservable } from "../../shared/hooks/use-observable";
import type {
  DashboardKpi,
  RevenuePoint,
  DebtByAgingBucket,
} from "../../domain/model/operations";
import type { DebtSummary } from "../../domain/model/payment";
import type { AcademicYear } from "../../domain/model/academic";
import { PageHeader } from "../../shared/layout/page-header";
import {
  PageTabs,
  PageTabList,
  PageTab,
  PageTabContent,
} from "../../shared/layout/page-tabs";
import { Button } from "../../shared/ui/button";
import { SeeDetailsModal } from "./see-details-modal";
import {
  AcademicYearSelector,
  type AcademicYearRange,
  computeDateRange,
  getLatestAcademicYear,
} from "./academic-year-selector";
import { OverviewTab } from "./tabs/overview-tab";
import { AnalyticsTab } from "./tabs/analytics-tab";
import { AlertsTab } from "./tabs/alerts-tab";
import { ReportsTab } from "./tabs/reports-tab";
import {
  type SeeDetailsTab,
  type Demographics,
} from "./tabs/types";
import type { Payment, Installment } from "../../domain/model/payment";
import {
  applyAnalyticsFilters,
  installmentsForAcademicYear,
  NO_ANALYTICS_FILTERS,
  previousAcademicYear,
  shiftIsoYearBack,
} from "./components/analytics/analytics-derivations";

type DashboardTab = "overview" | "analytics" | "alerts" | "reports";

interface DashboardData {
  kpis: DashboardKpi | null;
  revenue: RevenuePoint[];
  debtAging: DebtByAgingBucket[];
  demographics: Demographics;
  topDebtors: DebtSummary[];
}

const EMPTY_DEMOGRAPHICS: Demographics = {
  grade: [],
  gender: [],
  age: [],
};

/** Stable empty default — keeps hook dependencies referentially stable. */
const NO_YEARS: readonly AcademicYear[] = [];

export function DashboardPage() {
  const { t } = useTranslation();
  const repos = useRepositories();
  const { session } = useAuth();

  // T-408 (ACAD-509): the selectable academic years derive from the
  // CANONICAL academic_years repository — the previous hardcoded
  // four-year list (2023-2024…2026-2027) was fake selector data: years
  // the live database never contained. The default is the CURRENT year
  // (the school's operating year), falling back to the latest configured
  // year, then to the date-derived school-year window.
  const academicYears =
    useObservable(() => repos.academicYears.observeAll(), []) ?? NO_YEARS;
  const availableYears = useMemo(
    () => academicYears.map((y) => y.code).filter((c): c is string => !!c),
    [academicYears],
  );

  const [data, setData] = useState<DashboardData>({
    kpis: null,
    revenue: [],
    debtAging: [],
    demographics: EMPTY_DEMOGRAPHICS,
    topDebtors: [],
  });
  const [debtSummaries, setDebtSummaries] = useState<readonly DebtSummary[]>([]);
  const [payments, setPayments] = useState<readonly Payment[]>([]);
  const [installments, setInstallments] = useState<readonly Installment[]>([]);
  const [prevRevenue, setPrevRevenue] = useState<RevenuePoint[]>([]);
  const [seeDetailsOpen, setSeeDetailsOpen] = useState(false);
  const [seeDetailsTab, setSeeDetailsTab] = useState<SeeDetailsTab>("revenue");
  const [tab, setTab] = useState<DashboardTab>("overview");
  const [unreadAlerts, setUnreadAlerts] = useState(0);
  const [layoutEditing, setLayoutEditing] = useState(false);

  // T-412: `/?tab=<dashboardTab>` routes cross-page links to a specific
  // dashboard tab (the Personnel payroll-forecast section links to the
  // Statistics analytics view). Mount-time only — it never fights the
  // operator's own tab switches afterwards.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const wanted = searchParams.get("tab");
    if (
      wanted === "overview" ||
      wanted === "analytics" ||
      wanted === "alerts" ||
      wanted === "reports"
    ) {
      setTab(wanted);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete("tab");
          return next;
        },
        { replace: true },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [yearRange, setYearRange] = useState<AcademicYearRange>(() => ({
    academicYear: "",
    range: undefined,
    preset: "ytd",
  }));

  // T-408 (ACAD-509): resolve the default year from the CANONICAL years —
  // current year first, then the latest configured year, then the
  // date-derived school-year window (getLatestAcademicYear's fallback for
  // an empty/unresolved repository — a DATE computation, never a fabricated
  // academic record). Runs once years settle; keeps a valid selection.
  useEffect(() => {
    if (yearRange.academicYear && availableYears.includes(yearRange.academicYear)) {
      return;
    }
    const current = academicYears.find((y) => y.isCurrent && !y.isArchived);
    const next = current?.code ?? getLatestAcademicYear(availableYears);
    if (!next || next === yearRange.academicYear) return;
    setYearRange({
      academicYear: next,
      range: computeDateRange(next, "ytd"),
      preset: "ytd",
    });
  }, [availableYears, academicYears, yearRange.academicYear]);

  useEffect(() => {
    if (!yearRange.academicYear || !yearRange.range) return;
    void (async () => {
      const [k, rev, debt, demo] = await Promise.all([
        repos.dashboard.kpisForRange(yearRange.academicYear, yearRange.range),
        repos.dashboard.revenueForRange(yearRange.academicYear, yearRange.range),
        repos.dashboard.debtByAgingForRange(
          yearRange.academicYear,
          yearRange.range,
        ),
        repos.dashboard.demographics(),
      ]);
      setData((prev) => ({
        kpis: k.ok ? k.value : null,
        revenue: rev.ok ? rev.value : [],
        debtAging: debt.ok ? debt.value : [],
        demographics: demo.ok ? demo.value : EMPTY_DEMOGRAPHICS,
        topDebtors: prev.topDebtors,
      }));
    })();
  }, [repos.dashboard, yearRange]);

  useEffect(() => {
    const unsub = repos.debt.observeSummary().subscribe((stream) => {
      setDebtSummaries(
        stream
          .filter((d) => d.outstandingAmount > 0)
          .sort((a, b) => b.outstandingAmount - a.outstandingAmount),
      );
    });
    return unsub;
  }, [repos.debt]);

  const topDebtors = useMemo(
    () => debtSummaries.slice(0, 10) as DebtSummary[],
    [debtSummaries],
  );

  useEffect(() => {
    setData((prev) =>
      prev.topDebtors === topDebtors ? prev : { ...prev, topDebtors },
    );
  }, [topDebtors]);

  const prevYearCode = previousAcademicYear(yearRange.academicYear);
  const loadablePrevYear =
    prevYearCode && availableYears.includes(prevYearCode)
      ? prevYearCode
      : null;

  useEffect(() => {
    const currentRange = yearRange.range;
    if (!loadablePrevYear || !currentRange) {
      setPrevRevenue([]);
      return;
    }
    void (async () => {
      const shifted = {
        from: shiftIsoYearBack(currentRange.from),
        to: shiftIsoYearBack(currentRange.to),
      };
      const prev = await repos.dashboard.revenueForRange(
        loadablePrevYear,
        shifted,
      );
      setPrevRevenue(prev.ok ? prev.value : []);
    })();
  }, [repos.dashboard, loadablePrevYear, yearRange.range]);

  useEffect(() => {
    const unsub = repos.payments.observe().subscribe(setPayments);
    return unsub;
  }, [repos.payments]);

  useEffect(() => {
    const unsub = repos.installments.observe().subscribe(setInstallments);
    return unsub;
  }, [repos.installments]);

  const scopedInstallments = useMemo(
    () => installmentsForAcademicYear(installments, yearRange.academicYear),
    [installments, yearRange.academicYear],
  );

  const rangePayments = useMemo(
    () =>
      applyAnalyticsFilters(payments, yearRange.range, NO_ANALYTICS_FILTERS),
    [payments, yearRange.range],
  );

  useEffect(() => {
    if (!session) return;
    const unsub = repos.notifications
      .observeForSession({ userId: session.userId, role: session.role })
      .subscribe((n) => {
        setUnreadAlerts(n.filter((x) => !x.readAt).length);
      });
    return unsub;
  }, [repos.notifications, session]);

  function openSeeDetails(tabName: SeeDetailsTab = "revenue") {
    setSeeDetailsTab(tabName);
    setSeeDetailsOpen(true);
  }

  const drillByKpi: Record<string, SeeDetailsTab> = {
    students: "demographics",
    parents: "demographics",
    staff: "demographics",
    monthlyRevenue: "revenue",
    todayRevenue: "revenue",
    outstandingDebt: "debt",
    overdueAlerts: "debt",
    pendingExpenses: "debt",
  };

  const handleKpiClick = (kpi: string) => {
    const target = drillByKpi[kpi];
    if (target) openSeeDetails(target);
  };

  const dataProp = useMemo(() => data, [data]);
  const layoutSupported = tab === "overview" || tab === "analytics";

  const handleTabChange = (nextValue: string) => {
    const nextTab = nextValue as DashboardTab;
    setTab(nextTab);
    if (nextTab === "alerts" || nextTab === "reports") {
      setLayoutEditing(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-surface-background">
      <PageHeader
        title={
          <div className="flex items-center gap-3">
            <span>{t("dashboard.title")}</span>
            <span className="text-xs font-mono font-normal px-2.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
              Session {yearRange.academicYear}
            </span>
          </div>
        }
        description="Cockpit institutionnel — pilotage académique, logistique et financier"
        actions={
          <div className="flex items-center gap-2">
            {layoutSupported && (
              <Button
                size="sm"
                variant={layoutEditing ? "default" : "outline"}
                className="gap-1 shadow-sm text-xs"
                aria-pressed={layoutEditing}
                onClick={() => setLayoutEditing((value) => !value)}
              >
                <Settings2 className="h-3.5 w-3.5" />
                {layoutEditing
                  ? "Terminer la personnalisation"
                  : "Personnaliser le tableau de bord"}
              </Button>
            )}
            <AcademicYearSelector
              value={yearRange}
              onChange={setYearRange}
              availableYears={availableYears}
            />
            {tab === "overview" && (
              <Button
                size="sm"
                variant="default"
                className="gap-1 shadow-sm text-xs"
                onClick={() => openSeeDetails("revenue")}
              >
                {t("dashboard.seeDetails")}
                <ChevronRight className="h-4 w-4" />
              </Button>
            )}
          </div>
        }
      />

      <PageTabs
        value={tab}
        onValueChange={handleTabChange}
        className="flex-1 flex flex-col px-6 pb-6 min-h-0"
      >
        <PageTabList className="mb-2">
          <PageTab
            value="overview"
            label={t("dashboard.overview")}
            icon={LayoutDashboard}
          />
          <PageTab
            value="analytics"
            label="Analytique & Pilotage"
            icon={BarChart3}
          />
          <PageTab
            value="alerts"
            label={t("dashboard.alerts")}
            icon={Bell}
            count={unreadAlerts}
            countTone="danger"
          />
          <PageTab
            value="reports"
            label={t("dashboard.reports")}
            icon={FileText}
          />
        </PageTabList>

        <PageTabContent value="overview">
          <OverviewTab
            data={dataProp}
            payments={payments}
            installments={scopedInstallments}
            range={yearRange.range}
            onDrillDown={handleKpiClick}
            onGoToAlerts={() => setTab("alerts")}
            editing={layoutEditing}
          />
        </PageTabContent>

        <PageTabContent value="analytics">
          <AnalyticsTab
            revenue={data.revenue}
            prevRevenue={prevRevenue}
            academicYear={yearRange.academicYear}
            prevAcademicYear={loadablePrevYear}
            debtAging={data.debtAging}
            topDebtors={topDebtors}
            debtSummaries={debtSummaries}
            payments={payments}
            installments={scopedInstallments}
            range={yearRange.range}
            editing={layoutEditing}
          />
        </PageTabContent>

        <PageTabContent value="alerts">
          <AlertsTab />
        </PageTabContent>

        <PageTabContent value="reports">
          <ReportsTab />
        </PageTabContent>
      </PageTabs>

      <SeeDetailsModal
        open={seeDetailsOpen}
        onOpenChange={setSeeDetailsOpen}
        initialTab={seeDetailsTab}
        data={dataProp}
        payments={rangePayments}
      />
    </div>
  );
}
