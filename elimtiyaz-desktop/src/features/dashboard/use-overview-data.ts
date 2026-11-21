// ============================================================================
// FILE: elimtiyaz-desktop/src/features/dashboard/use-overview-data.ts
// ============================================================================
/**
 * E6.9 (DUP-029, D-U1): the dashboard's Overview view-model — the ONE home
 * of the page's data acquisition, extracted from dashboard-page.tsx (which
 * becomes the pure composition/layout root it always wanted to be).
 *
 * Owns (previously inline in the page component):
 *   - the T-590 (E7A-1) aggregation fetch: the four compact RPC calls
 *     (kpis / revenue / debt-aging / demographics) + the two bounded
 *     row-level reads (paymentsForRange / installmentsForYear) in ONE
 *     Promise.all per year-range change;
 *   - the debt-summary subscription (the top-debtors derivation);
 *   - the T-353 year-window guard over the fetched installment stream
 *     (scopedInstallments) + the range-filtered payment slice
 *     (rangePayments — the SeeDetails modal's input).
 *
 * The hook is the D-U1 view-model the T-596 overhaul composes onto.
 */
import { useEffect, useMemo, useState } from "react";
import { useRepositories } from "../../app/providers/repository-provider";
import type { DebtSummary, Payment, Installment } from "../../domain/model/payment";
import type { DashboardData } from "./tabs/overview-tab";
import type { AcademicYearRange } from "./academic-year-selector";
import {
  applyAnalyticsFilters,
  installmentsForAcademicYear,
  NO_ANALYTICS_FILTERS,
} from "./components/analytics/analytics-derivations";

const EMPTY_DEMOGRAPHICS = {
  grade: [],
  gender: [],
  age: [],
};

const EMPTY_DATA: DashboardData = {
  kpis: null,
  revenue: [],
  debtAging: [],
  demographics: EMPTY_DEMOGRAPHICS,
  topDebtors: [],
};

export interface OverviewViewModel {
  /** The KPI/aggregation bundle (the four RPC reads). */
  data: DashboardData;
  /** The bounded payment slice for the active range (the tabs' input). */
  payments: readonly Payment[];
  /** The analytics-filtered payment slice (the SeeDetails modal's input). */
  rangePayments: readonly Payment[];
  /** The bounded installment slice, re-scoped to the active academic year. */
  installments: readonly Installment[];
  /** The live debt-summary stream (positives, worst first). */
  debtSummaries: readonly DebtSummary[];
  /** The top-10 debtors (the Overview rail + the Analytics Pareto). */
  topDebtors: DebtSummary[];
}

export function useOverviewData(
  yearRange: AcademicYearRange,
): OverviewViewModel {
  const repos = useRepositories();

  const [data, setData] = useState<DashboardData>(EMPTY_DATA);
  const [payments, setPayments] = useState<readonly Payment[]>([]);
  const [installments, setInstallments] = useState<readonly Installment[]>([]);
  const [debtSummaries, setDebtSummaries] = useState<readonly DebtSummary[]>(
    [],
  );

  useEffect(() => {
    const selectedRange = yearRange.range;
    if (!yearRange.academicYear || !selectedRange) return;
    void (async () => {
      // T-590 (E7A-1): the triple data path is gone — this ONE effect is
      // the dashboard's data path: the four compact aggregation calls
      // (the 0002 RPCs server-side) + the two bounded row-level reads
      // (paymentsForRange / installmentsForYear — the range/year windows
      // the tabs filter by anyway, now server-side). The full-tenant
      // payments/installments observable subscriptions previously fired
      // TWO whole-collection downloads on every dashboard mount — the
      // ARCH-040 third path — and the collections re-seeded every 30 s /
      // window-focus tick. The observable caches stay for the
      // entity-detail surfaces (the Finance tab, the student drawers).
      const [k, rev, debt, demo, pays, inst] = await Promise.all([
        repos.dashboard.kpisForRange(yearRange.academicYear, selectedRange),
        repos.dashboard.revenueForRange(yearRange.academicYear, selectedRange),
        repos.dashboard.debtByAgingForRange(
          yearRange.academicYear,
          selectedRange,
        ),
        repos.dashboard.demographics(),
        repos.dashboard.paymentsForRange(selectedRange),
        repos.dashboard.installmentsForYear(yearRange.academicYear),
      ]);
      setData((prev) => ({
        kpis: k.ok ? k.value : null,
        revenue: rev.ok ? rev.value : [],
        debtAging: debt.ok ? debt.value : [],
        demographics: demo.ok ? demo.value : EMPTY_DEMOGRAPHICS,
        topDebtors: prev.topDebtors,
      }));
      setPayments(pays.ok ? pays.value : []);
      setInstallments(inst.ok ? inst.value : []);
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

  // T-590 (E7A-1): the memo keeps the T-353 year-window guard over the
  // fetched stream (a no-op on the parsed-year fetch — the server already
  // applied the same window — but it still re-scopes any in-flight stale
  // slice instantly when the year selector moves).
  const scopedInstallments = useMemo(
    () => installmentsForAcademicYear(installments, yearRange.academicYear),
    [installments, yearRange.academicYear],
  );

  const rangePayments = useMemo(
    () =>
      applyAnalyticsFilters(payments, yearRange.range, NO_ANALYTICS_FILTERS),
    [payments, yearRange.range],
  );

  return {
    data,
    payments,
    rangePayments,
    installments: scopedInstallments,
    debtSummaries,
    topDebtors,
  };
}
