/**
 * DashboardPage — Hub 1, the staff statistics dashboard.
 *
 * T-088 (2026-08-30) — restructured for real-world hierarchy (single fetch
 * at the page level, data flows DOWN to both OverviewTab and
 * SeeDetailsModal as props).
 *
 * T-243 (2026-09-09) — the 3-zone dashboard integration (UI-306): the
 * page additionally subscribes ONCE to the canonical payments observable
 * and passes the stream + the academic-year range down to the OverviewTab
 * so the weekly-rhythm chart reads REAL rows. Still ONE data flow: the
 * tab never fetches; the modal receives the same prop shape.
 *
 * Tabs: Overview / Analytique (T-255, 38th session — UI-307) / Alerts /
 * Reports.
 * Per AGENTS.md §15.9 — migrations are append-only; this changes UI code
 * only, no schema touch.
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronRight,
  LayoutDashboard,
  FileText,
  Bell,
  BarChart3,
} from "lucide-react";
import { useRepositories } from "../../app/providers/repository-provider";
import { useAuth } from "../../app/providers/auth-provider";
import type {
  DashboardKpi,
  RevenuePoint,
  DebtByAgingBucket,
} from "../../domain/model/operations";
import type { DebtSummary } from "../../domain/model/payment";
import { PageHeader } from "../../shared/layout/page-header";
import { PageTabs, PageTabList, PageTab, PageTabContent } from "../../shared/layout/page-tabs";
import { Button } from "../../shared/ui/button";
import { SeeDetailsModal } from "./see-details-modal";
import {
  AcademicYearSelector,
  type AcademicYearRange,
  computeDateRange,
} from "./academic-year-selector";
import { OverviewTab } from "./tabs/overview-tab";
import { AnalyticsTab } from "./tabs/analytics-tab";
import { AlertsTab } from "./tabs/alerts-tab";
import { ReportsTab } from "./tabs/reports-tab";
import {
  type SeeDetailsTab,
  type Demographics,
  AVAILABLE_ACADEMIC_YEARS,
} from "./tabs/types";
import type { Payment, Installment } from "../../domain/model/payment";
import {
  installmentsForAcademicYear,
  previousAcademicYear,
  shiftIsoYearBack,
} from "./components/analytics/analytics-derivations";

type DashboardTab = "overview" | "analytics" | "alerts" | "reports";

/**
 * DashboardData — the single source of truth passed to both the
 * OverviewTab and the SeeDetailsModal. Built once at the page level
 * from the four repository calls; never re-fetched by the modal.
 *
 * `topDebtors` is optional because the debt repository's observable
 * may not be subscribed in Mock mode if no parent has debt. The T-243
 * payments stream is passed to the OverviewTab as a SEPARATE prop so
 * stream updates never re-trigger this aggregate fetch.
 */
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

export function DashboardPage() {
  const { t } = useTranslation();
  const repos = useRepositories();
  const { session } = useAuth();
  const [data, setData] = useState<DashboardData>({
    kpis: null,
    revenue: [],
    debtAging: [],
    demographics: EMPTY_DEMOGRAPHICS,
    topDebtors: [],
  });
  // T-351 (DASH-401): the debt summaries, subscribed REACTIVELY. The
  // previous code read the summary observable's cached value synchronously
  // inside the range effect — in Supabase mode that cache seeds
  // ASYNCHRONOUSLY, so the first read returned the initial `[]` and
  // every debt-derived surface (Pareto, "À relancer", the modal's top
  // debtors, the risk engine) rendered empty until the user switched the
  // academic year (the only thing that re-ran the effect). The full sorted
  // stream feeds the risk engine (families ranked 11+ evaluate with their
  // real debt); the top-10 display slice is derived below.
  const [debtSummaries, setDebtSummaries] = useState<readonly DebtSummary[]>([]);
  // T-243: the canonical payments stream (one subscription, feeds the
  // weekly-rhythm chart — the calendar reads the same observable).
  const [payments, setPayments] = useState<readonly Payment[]>([]);
  // T-339 (STATS-400): the canonical installments stream — feeds the
  // Overview's Wave Velocity hero + the debt KPI's chronic-share
  // contextualization (deriveTrancheWaves / deriveDebtTriage). One
  // page-level subscription, the same pattern as the payments stream.
  const [installments, setInstallments] = useState<readonly Installment[]>([]);
  // T-255 (38th session, UI-307): the PREVIOUS academic year's revenue for
  // the same month window — loaded once per range change for the Analytics
  // tab's like-for-like YoY comparison. Empty when the selected year is the
  // earliest available (the card renders its honest unavailable state).
  const [prevRevenue, setPrevRevenue] = useState<RevenuePoint[]>([]);
  const [seeDetailsOpen, setSeeDetailsOpen] = useState(false);
  const [seeDetailsTab, setSeeDetailsTab] = useState<SeeDetailsTab>("revenue");
  const [tab, setTab] = useState<DashboardTab>("overview");
  // T-088: unread-alert badge in the tab strip — a real operational
  // signal, surfaced where the admin can see it without leaving Overview.
  const [unreadAlerts, setUnreadAlerts] = useState(0);

  // Iteration 9 — academic year + date range filter.
  const [yearRange, setYearRange] = useState<AcademicYearRange>(() => ({
    academicYear: "2025-2026",
    range: computeDateRange("2025-2026", "ytd"),
    preset: "ytd",
  }));

  // Reload dashboard data whenever the year/range changes.
  // ONE fetch — passed to both the Overview and the SeeDetailsModal.
  useEffect(() => {
    void (async () => {
      const [k, rev, debt, demo] = await Promise.all([
        repos.dashboard.kpisForRange(yearRange.academicYear, yearRange.range),
        repos.dashboard.revenueForRange(yearRange.academicYear, yearRange.range),
        repos.dashboard.debtByAgingForRange(yearRange.academicYear, yearRange.range),
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

  // T-351 (DASH-401): subscribe ONCE to the debt summary observable — the
  // same pattern as the payments/installments streams above/below. The
  // repository seeds asynchronously in Supabase mode; the subscription
  // delivers the rows the moment they land instead of racing `.get()`.
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

  // The display slice (top 10) for the drill-down modal's "Top débiteurs"
  // table. The FULL stream is what the analytics risk engine consumes
  // (DASH-401: the previous top-10-only feed made every family ranked 11+
  // evaluate as debt 0).
  const topDebtors = useMemo(
    () => debtSummaries.slice(0, 10) as DebtSummary[],
    [debtSummaries],
  );
  useEffect(() => {
    setData((prev) =>
      prev.topDebtors === topDebtors ? prev : { ...prev, topDebtors },
    );
  }, [topDebtors]);

  // T-255: load the previous academic year's series for the YoY card —
  // the SAME month window shifted back one year (like-for-like months).
  // Only years present in AVAILABLE_ACADEMIC_YEARS are fetched.
  const prevYearCode = previousAcademicYear(yearRange.academicYear);
  const loadablePrevYear =
    prevYearCode && AVAILABLE_ACADEMIC_YEARS.includes(prevYearCode) ? prevYearCode : null;
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
      const prev = await repos.dashboard.revenueForRange(loadablePrevYear, shifted);
      setPrevRevenue(prev.ok ? prev.value : []);
    })();
  }, [repos.dashboard, loadablePrevYear, yearRange.range]);

  // T-243 — subscribe ONCE to the canonical payments observable. The
  // weekly-rhythm chart derives its weekday × method matrix from this
  // REAL stream (never hardcoded sample rows). Same observable the
  // DashboardCalendar reads — one cache, one source of truth.
  useEffect(() => {
    const unsub = repos.payments.observe().subscribe((stream) => {
      setPayments(stream);
    });
    return unsub;
  }, [repos.payments]);

  // T-339 — subscribe ONCE to the canonical installments observable (the
  // tranche-wave stream — see the payments comment above).
  useEffect(() => {
    const unsub = repos.installments.observe().subscribe((stream) => {
      setInstallments(stream);
    });
    return unsub;
  }, [repos.installments]);

  // T-353 (DASH-403): the ACADEMIC-YEAR-scoped installment stream. The raw
  // subscription carries EVERY tenant installment (the table has no
  // academic_year column — due_date is the only year signal), so every
  // installment-derived statistic (wave velocity, debt triage, family
  // concentration, transport yield) is derived from the SCOPED slice:
  // switching the year selector now re-scopes those cards instead of
  // leaving last year's numbers under the new year's header (the owner's
  // screenshot 10: waves stayed 44.3M/86.9M/42.6M under 2026-2027).
  const scopedInstallments = useMemo(
    () => installmentsForAcademicYear(installments, yearRange.academicYear),
    [installments, yearRange.academicYear],
  );

  // Unread alerts — keep the tab badge current without making the
  // Overview depend on the alerts observable (decoupling preserves the
  // single-fetch model above).
  useEffect(() => {
    if (!session) return;
    const unsub = repos.notifications
      .observeForSession({ userId: session.userId, role: session.role })
      .subscribe((n) => {
        setUnreadAlerts(n.filter((x) => !x.readAt).length);
      });
    return unsub;
  }, [repos.notifications, session]);

  // ARCH-006: the previous code ran `repos.overdueAlerts.run()` on every
  // mount. In Supabase mode this is `MockOverdueAlertGenerator` (the slot
  // was never overridden in the assembly), so it scans in-memory seed
  // data and persists nothing server-side — a "demo around mock data"
  // pattern exactly as the audit flagged. Removed in T-080; the
  // SupabaseOverdueAlertGenerator (T-080) will be the canonical
  // server-side path. Until then the alerts tab fetches its own state.

  function openSeeDetails(tab: SeeDetailsTab = "revenue") {
    setSeeDetailsTab(tab);
    setSeeDetailsOpen(true);
  }

  // KPIs are clickable. Each click routes to the relevant drill-down
  // sub-tab. The mapping is centralized so the Overview and any future
  // KPI grid share the same drill-down semantics.
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

  // Memoize the data prop so children don't re-render unless the data
  // actually changes.
  const dataProp = useMemo(() => data, [data]);

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title={t("dashboard.title")}
        description="Vue d'ensemble de l'activité de l'établissement"
        actions={
          <>
            {/* The year selector applies to all tabs (KPIs / alerts / reports
                are all scoped to the selected academic year). */}
            <AcademicYearSelector
              value={yearRange}
              onChange={setYearRange}
              availableYears={AVAILABLE_ACADEMIC_YEARS}
            />
            {/* The "Voir les détails" drill-down button is only relevant on
                the Overview tab — Alerts and Reports have their own per-row
                actions. Hiding it on those tabs keeps the header clean. */}
            {tab === "overview" && (
              <Button size="sm" onClick={() => openSeeDetails("revenue")}>
                {t("dashboard.seeDetails")} <ChevronRight className="h-4 w-4" />
              </Button>
            )}
          </>
        }
      />

      <PageTabs
        value={tab}
        onValueChange={(v) => setTab(v as DashboardTab)}
        className="flex-1 flex flex-col px-6 pb-6 min-h-0"
      >
        <PageTabList>
          <PageTab value="overview" label={t("dashboard.overview")} icon={LayoutDashboard} />
          {/* T-255 (UI-307): the Power BI-style analytics report page —
              statistics, trends, comparisons, distributions, heatmap. */}
          <PageTab value="analytics" label="Analytique" icon={BarChart3} />
          {/* Unread badge — a real operational signal, not a decoration.
              The count prop renders inside the tab via PageTab's CountBadge.
              countTone="danger" makes it red so urgent alerts stand out. */}
          <PageTab
            value="alerts"
            label={t("dashboard.alerts")}
            icon={Bell}
            count={unreadAlerts}
            countTone="danger"
          />
          <PageTab value="reports" label={t("dashboard.reports")} icon={FileText} />
        </PageTabList>

        <PageTabContent value="overview">
          <OverviewTab
            data={dataProp}
            payments={payments}
            installments={scopedInstallments}
            range={yearRange.range}
            onDrillDown={handleKpiClick}
            onGoToAlerts={() => setTab("alerts")}
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
          />
        </PageTabContent>

        <PageTabContent value="alerts">
          <AlertsTab />
        </PageTabContent>

        <PageTabContent value="reports">
          <ReportsTab />
        </PageTabContent>
      </PageTabs>

      {/* The drill-down modal receives the SAME data the Overview shows.
          No re-fetch on open; no chance of drift between the two views. */}
      <SeeDetailsModal
        open={seeDetailsOpen}
        onOpenChange={setSeeDetailsOpen}
        initialTab={seeDetailsTab}
        data={dataProp}
      />
    </div>
  );
}
