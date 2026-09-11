/**
 * SeeDetailsModal — drill-down analytics for the dashboard.
 *
 * T-088 (2026-08-30) — single-source-of-truth refactor: the modal receives
 * ALL data via the `data` prop from the page (no fetch, no drift; the 4
 * sub-tabs render from the page-level data).
 *
 * T-247 (2026-09-09, 37th session) — the owner's AI-review drill-down
 * overhaul (Screens 1–2), adapted to REAL data per §15.16:
 *   - Revenue tab: "Encaissé vs Échéancier théorique" — bars are the REAL
 *     monthly series; the dashed gold line is the DERIVED planning
 *     projection (40% Sep / 30% Déc / 30% Mar — the canonical tranche rule,
 *     `docs/domain/financial-rules.md` / the billing-breakdown synthesis)
 *     applied to totalExpected = encaissé + créances. It is labeled
 *     "théorique" everywhere and NEVER presented as collected data; when
 *     `kpis` is unavailable the projection is omitted (bars only).
 *   - Demographics tab: the gender chart is now a dual-ring DONUT with the
 *     REAL center total (Σ gender counts) + legend callouts — replacing the
 *     hollow borderless pie the review flagged. The per-class capacity
 *     gauges (already REAL from the repository contract) are kept.
 *   - Debt tab: per-bucket severity badges (Normal / Avertissement /
 *     Critique) so the aging table reads as a triage queue, not raw counts.
 *   - Chart chrome now comes from the single `DASHBOARD_THEME` source
 *     (T-243) instead of per-chart inline styles.
 *
 * Per AGENTS.md §15.9 — UI code only, no schema touch.
 */
import { useTranslation } from "react-i18next";
import { useMemo } from "react";
import {
  BarChart3,
  TrendingUp,
  Building2,
  Users,
  AlertCircle,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  ComposedChart,
  Line,
} from "recharts";
import type {
  DashboardKpi,
  RevenuePoint,
  DebtByAgingBucket,
} from "../../domain/model/operations";
import { formatDzd, formatDzdPlain } from "../../core/format/currency";
import {
  AGING_BUCKET_LABELS_FR,
  PAYMENT_CATEGORY_LABELS_FR,
  type PaymentCategory,
  type DebtSummary,
  type AgingBucket,
} from "../../domain/model/payment";
import { UnifiedModal } from "../../shared/ui/unified-modal";
import {
  PageTabs,
  PageTabList,
  PageTab,
  PageTabContent,
} from "../../shared/layout/page-tabs";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../../shared/ui/card";
import { DASHBOARD_THEME, chartPalette } from "../../shared/ui/dashboard-theme";
import type { Demographics } from "./tabs/types";

import { ClassCapacityAnalyzer } from "./components/class-capacity-analyzer";

/** VAULT §15.02 — the 4 operational units (never a single "Other" bucket). */
const OPERATIONAL_UNITS: readonly {
  key: string;
  label: string;
  categories: readonly PaymentCategory[];
  tokenName: string;
  fallback: string;
}[] = [
  {
    key: "scolarite",
    label: "Scolarité (académique)",
    categories: ["tuition", "books", "uniform", "second_apron"],
    tokenName: "--brand-blue",
    fallback: "#349bd4",
  },
  {
    key: "therapy",
    label: "Thérapie (Orthophonie / Psychologie)",
    categories: ["therapy_psychology", "therapy_speech"],
    tokenName: "--brand-gold",
    fallback: "#eab308",
  },
  {
    key: "clubs",
    label: "Clubs & parascolaire",
    categories: ["extracurricular"],
    tokenName: "--status-danger",
    fallback: "#ef4444",
  },
  {
    key: "auxiliary",
    label: "Services auxiliaires (Transport / Cantine)",
    categories: ["transport", "canteen"],
    tokenName: "--status-success",
    fallback: "#10b981",
  },
];

/**
 * T-247 — the canonical tranche-projection rule mirrored as month labels.
 * The due months (15 Sep / 15 Déc / 15 Mar) and the 40/30/30 split are the
 * canonical business rule (see `billing-breakdown.ts`'s synthesis + the
 * domain financial rules); the labels match `MONTH_LABELS_FR` so they align
 * with the revenue buckets element-wise.
 */
const TRANCHE_PROJECTION_MONTHS: ReadonlyArray<{
  label: string;
  share: number;
}> = [
  { label: "Sep", share: 0.4 },
  { label: "Déc", share: 0.3 },
  { label: "Mar", share: 0.3 },
];

/**
 * Derive the theoretical échéancier projection for the revenue chart.
 *
 * PURE function (unit-testable): maps each REAL revenue point to
 * `{ label, amount, targetProjection }` where `targetProjection` =
 * share × totalExpected on the canonical tranche months, 0 elsewhere.
 * 12 consecutive month labels are unique, so label matching is safe.
 */
export function deriveTrancheProjection(
  revenue: readonly RevenuePoint[],
  totalExpected: number,
): Array<{ label: string; amount: number; targetProjection: number }> {
  return revenue.map((r) => {
    const rule = TRANCHE_PROJECTION_MONTHS.find((m) => m.label === r.label);
    return {
      label: r.label,
      amount: r.amount,
      targetProjection: rule ? Math.round(totalExpected * rule.share) : 0,
    };
  });
}

/** T-247 — aging-bucket triage severity (display-only). */
function agingSeverity(bucket: AgingBucket): {
  label: string;
  className: string;
} {
  if (bucket === "0_30") {
    return {
      label: "Normal",
      className: "bg-status-success/15 text-status-success",
    };
  }
  if (bucket === "31_60") {
    return {
      label: "Avertissement",
      className: "bg-status-warning/15 text-status-warning",
    };
  }
  return {
    label: "Critique",
    className: "bg-status-danger/15 text-status-danger",
  };
}

/** Dashboard data — the same shape the OverviewTab consumes. */
export interface DashboardData {
  kpis: DashboardKpi | null;
  revenue: RevenuePoint[];
  debtAging: DebtByAgingBucket[];
  demographics: Demographics;
  topDebtors: DebtSummary[];
}

export function SeeDetailsModal({
  open,
  onOpenChange,
  initialTab = "revenue",
  data,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Pre-select the tab the user clicked from in the dashboard. */
  initialTab?: "revenue" | "departments" | "demographics" | "debt";
  /** Page-level data — no fetch inside the modal (T-088). */
  data: DashboardData;
}) {
  const { t } = useTranslation();

  // VAULT §15.01 — annual revenue (PAID only) + collection-rate summary.
  // Derived from the page-level revenue series; no re-fetch.
  const annualRevenue = useMemo(
    () => data.revenue.reduce((s, r) => s + r.amount, 0),
    [data.revenue],
  );
  const outstanding = data.kpis?.outstandingDebt ?? 0;
  const totalExpected = annualRevenue + outstanding;
  const collectionRate =
    totalExpected > 0 ? Math.round((annualRevenue / totalExpected) * 100) : 0;

  // T-247 — the theoretical échéancier line (derived planning reference,
  // rendered ONLY when a real debt figure exists; labeled "théorique").
  const projection = useMemo(
    () =>
      data.kpis
        ? deriveTrancheProjection(data.revenue, totalExpected)
        : data.revenue.map((r) => ({ ...r, targetProjection: 0 })),
    [data.revenue, data.kpis, totalExpected],
  );

  const genderTotal = useMemo(
    () => data.demographics.gender.reduce((s, g) => s + g.count, 0),
    [data.demographics.gender],
  );

  return (
    <UnifiedModal
      open={open}
      onOpenChange={onOpenChange}
      size="xl"
      variant="dialog"
      icon={BarChart3}
      iconTone="primary"
      title={t("dashboard.seeDetails")}
      description="Vue détaillée des indicateurs — revenus, départements, démographie, créances."
      hideFooter
    >
      <PageTabs defaultValue={initialTab} variant="underline">
        <PageTabList>
          <PageTab
            value="revenue"
            label={t("dashboard.sections.revenue")}
            icon={TrendingUp}
          />
          <PageTab
            value="departments"
            label={t("dashboard.sections.departments")}
            icon={Building2}
          />
          <PageTab
            value="demographics"
            label={t("dashboard.sections.demographics")}
            icon={Users}
          />
          <PageTab
            value="debt"
            label={t("dashboard.sections.debt")}
            icon={AlertCircle}
          />
        </PageTabList>

        <PageTabContent value="revenue">
          <div className="space-y-4">
            {/* T-247 — the review's collection-rate summary (all REAL). */}
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-md border border-border p-3">
                <p className="text-[10px] uppercase text-muted-foreground">
                  Encaissé annuel
                </p>
                <p className="text-lg font-mono font-bold text-status-success">
                  {formatDzd(annualRevenue)}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  paiements PAID au guichet
                </p>
              </div>
              <div className="rounded-md border border-border p-3">
                <p className="text-[10px] uppercase text-muted-foreground">
                  Créances restantes
                </p>
                <p className="text-lg font-mono font-bold text-status-danger">
                  {data.kpis ? formatDzd(outstanding) : "—"}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  engagements à percevoir
                </p>
              </div>
              <div className="rounded-md border border-border p-3">
                <p className="text-[10px] uppercase text-muted-foreground">
                  Taux de recouvrement
                </p>
                <p className="text-lg font-mono font-bold text-primary">
                  {data.kpis ? `${collectionRate}%` : "—"}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  encaissé / total attendu
                </p>
              </div>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">
                  Encaissements vs échéancier théorique
                  <span className="ml-2 text-[10px] font-normal text-muted-foreground">
                    {data.revenue.length} mois · projection 40 / 30 / 30 (Sep ·
                    Déc · Mar)
                  </span>
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground">
                  Barres : encaissements réels · Ligne pointillée : échéancier
                  théorique
                  {data.kpis
                    ? ` dérivé du total attendu (${formatDzdPlain(totalExpected)} DZD)`
                    : " indisponible (KPIs non chargés)"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[280px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart
                      data={projection}
                      margin={{ top: 10, right: 10, bottom: 0, left: -10 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke={DASHBOARD_THEME.gridStroke}
                        vertical={false}
                      />
                      <XAxis
                        dataKey="label"
                        {...DASHBOARD_THEME.axisTick}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        {...DASHBOARD_THEME.axisTick}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(v) =>
                          `${Math.round(Number(v) / 1000)}k`
                        }
                      />
                      <RTooltip
                        contentStyle={DASHBOARD_THEME.tooltipStyle}
                        formatter={(v: number, name: string) => [
                          `${formatDzdPlain(v)} DZD`,
                          name === "amount"
                            ? "Encaissé réel"
                            : "Objectif théorique",
                        ]}
                      />
                      <Bar
                        dataKey="amount"
                        name="amount"
                        fill={chartPalette.primary}
                        radius={[4, 4, 0, 0]}
                        barSize={26}
                      />
                      {data.kpis && (
                        <Line
                          type="monotone"
                          dataKey="targetProjection"
                          name="targetProjection"
                          stroke={chartPalette.gold}
                          strokeWidth={2}
                          strokeDasharray="4 4"
                          dot={false}
                        />
                      )}
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>
        </PageTabContent>

        <PageTabContent value="departments">
          {/* T-088: Departments derives its breakdown from the page-level
              revenue series via the canonical `revenueByCategory` helper.
              No more `repos.payments.observe().get()` Mock-only leak. */}
          <DepartmentsTab data={data} />
        </PageTabContent>

        <PageTabContent value="demographics">
          <div className="space-y-4">
            {/* Grade Level Distribution */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">
                  Effectifs par niveau
                  <span className="ml-2 text-[10px] font-normal text-muted-foreground">
                    1AP → 3ème Année (diagramme en barres, plan §15.03)
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[240px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.demographics.grade}>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke={DASHBOARD_THEME.gridStroke}
                        vertical={false}
                      />
                      <XAxis
                        dataKey="label"
                        tick={{
                          fill: "hsl(var(--muted-foreground))",
                          fontSize: 10,
                        }}
                        axisLine={false}
                        tickLine={false}
                        interval={0}
                        angle={-30}
                        textAnchor="end"
                        height={50}
                      />
                      <YAxis
                        {...DASHBOARD_THEME.axisTick}
                        axisLine={false}
                        tickLine={false}
                        allowDecimals={false}
                      />
                      <RTooltip
                        contentStyle={DASHBOARD_THEME.tooltipStyle}
                        formatter={(v: number) => [`${v} élèves`, "Effectif"]}
                      />
                      <Bar
                        dataKey="count"
                        fill={chartPalette.primary}
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {/* Gender Donut */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Par genre</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-[220px] relative flex items-center justify-center">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={data.demographics.gender}
                          dataKey="count"
                          nameKey="label"
                          cx="50%"
                          cy="50%"
                          innerRadius={48}
                          outerRadius={68}
                          paddingAngle={3}
                          stroke="none"
                        >
                          {data.demographics.gender.map((g, i) => (
                            <Cell
                              key={g.label}
                              fill={
                                [
                                  chartPalette.primary,
                                  chartPalette.gold,
                                  chartPalette.slate,
                                ][i % 3]
                              }
                            />
                          ))}
                        </Pie>
                        <RTooltip
                          contentStyle={DASHBOARD_THEME.tooltipStyle}
                          formatter={(v: number) => [
                            `${v} élèves${genderTotal > 0 ? ` (${Math.round((v / genderTotal) * 100)}%)` : ""}`,
                            "Effectif",
                          ]}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                      <span className="text-2xl font-bold font-mono text-foreground tnum">
                        {genderTotal}
                      </span>
                      <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                        élèves
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center justify-around border-t border-border/50 pt-2 mt-1 text-xs">
                    {data.demographics.gender.map((g, i) => (
                      <div key={g.label} className="flex items-center gap-1.5">
                        <span
                          className="h-2.5 w-2.5 rounded-full shrink-0"
                          style={{
                            background: [
                              chartPalette.primary,
                              chartPalette.gold,
                              chartPalette.slate,
                            ][i % 3],
                          }}
                        />
                        <span className="text-muted-foreground truncate">
                          {g.label} :
                        </span>
                        <strong className="font-mono text-foreground">
                          {g.count}
                        </strong>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Age Distribution */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">
                    Distribution par âge
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-[220px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data.demographics.age}>
                        <CartesianGrid
                          strokeDasharray="3 3"
                          stroke={DASHBOARD_THEME.gridStroke}
                          vertical={false}
                        />
                        <XAxis
                          dataKey="label"
                          {...DASHBOARD_THEME.axisTick}
                          axisLine={false}
                          tickLine={false}
                        />
                        <YAxis
                          {...DASHBOARD_THEME.axisTick}
                          axisLine={false}
                          tickLine={false}
                          allowDecimals={false}
                        />
                        <RTooltip
                          contentStyle={DASHBOARD_THEME.tooltipStyle}
                          formatter={(v: number) => [`${v} élèves`, "Effectif"]}
                        />
                        <Bar
                          dataKey="count"
                          fill={chartPalette.cyan}
                          radius={[4, 4, 0, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Replaced with the new Interactive Class Capacity Analyzer */}
            <ClassCapacityAnalyzer capacityData={data.demographics.capacity} />
          </div>
        </PageTabContent>

        <PageTabContent value="debt">
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">
                  Créances par tranche d'âge
                  <span className="ml-2 text-[10px] font-normal text-muted-foreground">
                    gravité par ancienneté
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="py-2">Tranche</th>
                      <th className="py-2 text-right">Montant</th>
                      <th className="py-2 text-right">Familles</th>
                      <th className="py-2 text-right">Gravité</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.debtAging.map((b) => {
                      const severity = agingSeverity(b.bucket);
                      return (
                        <tr key={b.bucket} className="hover:bg-accent/5">
                          <td className="py-2.5">
                            {AGING_BUCKET_LABELS_FR[b.bucket]}
                          </td>
                          <td className="py-2.5 text-right font-mono">
                            {formatDzdPlain(b.amount)}
                          </td>
                          <td className="py-2.5 text-right font-mono">
                            {b.debtorCount}
                          </td>
                          <td className="py-2.5 text-right">
                            <span
                              className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${severity.className}`}
                            >
                              {severity.label}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            {/* VAULT §15.05 — Debt tab: top debtors list. */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">
                  Top débiteurs
                  <span className="ml-2 text-[10px] font-normal text-muted-foreground">
                    10 familles les plus endettées
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {data.topDebtors.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    Aucune créance en cours.
                  </p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="py-2">#</th>
                        <th className="py-2">Famille</th>
                        <th className="py-2 text-right">Retard</th>
                        <th className="py-2 text-right">Créance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {data.topDebtors.map((d, i) => (
                        <tr key={d.parentId}>
                          <td className="py-2 font-mono text-muted-foreground">
                            {i + 1}
                          </td>
                          <td className="py-2">{d.parentName}</td>
                          <td className="py-2 text-right font-mono">
                            {d.daysOverdue} j
                          </td>
                          <td className="py-2 text-right font-mono font-semibold text-status-danger">
                            {formatDzdPlain(d.outstandingAmount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          </div>
        </PageTabContent>
      </PageTabs>
    </UnifiedModal>
  );
}

/**
 * DepartmentsTab — derives its per-category breakdown from the page-level
 * revenue series via the canonical `revenueByCategory` helper.
 *
 * T-088 fix: BEFORE this used `repos.payments.observe().get()` which is
 * the local cached observable. In Supabase mode that cache is NOT
 * preloaded for the dashboard (the assembly only loads it when a
 * feature fetches payments), so the Departments pie showed zero data
 * even when the Revenue chart on the same modal showed real numbers —
 * a contradiction.
 *
 * NOTE: the page-level data currently exposes revenue as `RevenuePoint[]`
 * (monthly aggregates), not raw `Payment[]`. To keep the
 * single-source-of-truth model intact WITHOUT another fetch, the
 * Departments tab surfaces an honest empty state explaining WHY the
 * breakdown is unavailable, instead of fabricating data from a different
 * cache (which was the bug). The real per-category breakdown belongs in a
 * new `DashboardRepository.revenueByCategory()` method (a backend change,
 * not a UI shortcut).
 */
function DepartmentsTab({ data }: { data: DashboardData }) {
  // The DashboardData shape the page passes doesn't include raw
  // `Payment[]`. Departments breakdown can't be derived from monthly
  // `RevenuePoint[]` alone. So this tab now surfaces an honest empty
  // state explaining WHY the breakdown is unavailable, instead of
  // fabricating data from a different cache (which was the bug).
  //
  // This is the correct fix per AGENTS.md §15: "Never add a second
  // implementation of a rule that exists". The real per-category
  // breakdown belongs in a new `DashboardRepository.revenueByCategory()`
  // method (a backend addition, not a UI shortcut).
  const hasRevenueData =
    data.revenue.length > 0 && data.revenue.some((r) => r.amount > 0);
  const annualTotal = data.revenue.reduce((s, r) => s + r.amount, 0);

  /** Resolve a design-token CSS variable (plan §03; T-246 palette). */
  const token = (name: string, fallback: string): string => {
    try {
      if (typeof document === "undefined") return fallback;
      const v = getComputedStyle(document.documentElement)
        .getPropertyValue(name)
        .trim();
      return v || fallback;
    } catch {
      return fallback;
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            Revenu par unité opérationnelle
            <span className="ml-2 text-[10px] font-normal text-muted-foreground">
              Scolarité / Thérapie / Clubs / Auxiliaire
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!hasRevenueData ? (
            <div className="py-8 text-center space-y-2">
              <p className="text-sm font-medium text-foreground">
                Aucun revenu enregistré sur la période sélectionnée.
              </p>
              <p className="text-xs text-muted-foreground max-w-md mx-auto">
                Le découpage par unité opérationnelle nécessite les paiements
                agrégés par catégorie, qui ne sont pas encore exposés par le
                <code className="mx-1 px-1 py-0.5 bg-muted rounded text-[10px]">
                  DashboardRepository
                </code>
                (une extension de l'API backend, pas un contournement UI). Le
                total annuel agrégé ci-dessous reste correct.
              </p>
              <p className="text-xs text-muted-foreground">
                Total annuel agrégé :{" "}
                <span className="font-mono font-semibold text-foreground">
                  {formatDzd(annualTotal)}
                </span>
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Per-unit breakdown placeholder — kept for when the
                  backend exposes per-category revenue. The buckets
                  are the 4 canonical operational units (VAULT §15.02). */}
              {OPERATIONAL_UNITS.map((u) => (
                <div key={u.key} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ background: token(u.tokenName, u.fallback) }}
                      />
                      <span className="text-muted-foreground">{u.label}</span>
                    </div>
                    <span className="text-muted-foreground italic text-[10px]">
                      données par catégorie non exposées
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full"
                      style={{
                        width: "0%",
                        background: token(u.tokenName, u.fallback),
                      }}
                    />
                  </div>
                </div>
              ))}
              <div className="pt-2 border-t border-border flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  Total agrégé
                </span>
                <span className="font-mono font-semibold text-foreground">
                  {formatDzdPlain(annualTotal)}
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
