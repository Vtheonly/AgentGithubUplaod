// ============================================================================
// FILE: elimtiyaz-desktop/src/features/dashboard/components/analytics/payroll-cost-trend-card.tsx
// ============================================================================
/**
 * T-412 — "Coûts du Personnel & Besoin de Financement" (the Statistics
 * planning view of the canonical payroll forecast, ADR-024).
 *
 * Monthly / quarterly personnel-cost trend with the historical ACTUALS
 * (real salary disbursements) vs the PROJECTED costs (the canonical
 * forecast) clearly separated, plus the per-period funding requirement.
 * The Monthly/Quarterly toggle re-aggregates the SAME canonical points —
 * no second calculation (§15.53a).
 *
 * Cross-page summary link → the Personnel operational view (the wave
 * detail); the Finance cash-management view is linked from there.
 */
import { useState } from "react";
import { useNavigate, useInRouterContext } from "react-router-dom";
import { Users } from "lucide-react";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../../../shared/ui/card";
import { Button } from "../../../../shared/ui/button";
import {
  DASHBOARD_THEME,
  chartPalette,
} from "../../../../shared/ui/dashboard-theme";
import { formatDzd, formatDzdPlain } from "../../../../core/format/currency";
import type { PayrollCostTrend } from "./executive-statistics";

export function PayrollCostTrendCard({ trend }: { trend: PayrollCostTrend }) {
  // Router-optional navigation (the analytics-visuals suite mounts the tab
  // WITHOUT a Router): the navigating Button is a CHILD component rendered
  // only inside a Router context — useNavigate would throw at call time in
  // a bare mount (the t-369/t-412 convention).
  const inRouter = useInRouterContext();
  const [granularity, setGranularity] = useState<"monthly" | "quarterly">(
    "monthly",
  );

  const points = granularity === "monthly" ? trend.monthly : trend.quarterly;
  // Recharts expects a mutable array — copy the canonical readonly points.
  const chartData = [...points];
  const hasAnyData =
    trend.totals.actualTotal > 0 || trend.totals.projectedTotal > 0;

  return (
    <Card
      className="border-border/70 bg-surface-panel shadow-sm h-full flex flex-col"
      data-testid="payroll-cost-trend-card"
    >
      <CardHeader className="py-3 px-4 border-b border-border/50 flex flex-row items-center justify-between flex-wrap gap-2">
        <div>
          <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            Coûts du Personnel — Réalisé vs Projeté & Besoin de Financement
          </CardTitle>
          <CardDescription className="text-xs text-muted-foreground">
            Prévision canonique des vagues de paie — même calcul que Personnel
            et Finance (Diagnostic)
          </CardDescription>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant={granularity === "monthly" ? "default" : "outline"}
            className="h-7 text-xs"
            onClick={() => setGranularity("monthly")}
            data-testid="payroll-trend-monthly-toggle"
          >
            Mensuel
          </Button>
          <Button
            size="sm"
            variant={granularity === "quarterly" ? "default" : "outline"}
            className="h-7 text-xs"
            onClick={() => setGranularity("quarterly")}
            data-testid="payroll-trend-quarterly-toggle"
          >
            Trimestriel
          </Button>
        </div>
      </CardHeader>

      <CardContent className="p-4 flex-1 flex flex-col gap-3">
        {!hasAnyData ? (
          <p
            className="text-xs text-muted-foreground text-center py-10"
            data-testid="payroll-trend-empty"
          >
            Aucun versement de salaire enregistré et aucun personnel actif
            rémunéré — aucune tendance de coût à afficher.
          </p>
        ) : (
          <>
            <div className="h-[220px] w-full" data-testid="payroll-trend-chart">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={chartData}
                  margin={{ top: 10, right: 8, bottom: 0, left: -14 }}
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
                    tickFormatter={(v: number) => `${Math.round(v / 1000)}k`}
                  />
                  <Tooltip
                    contentStyle={DASHBOARD_THEME.tooltipStyle}
                    formatter={(val: number, name: string) => [
                      `${formatDzdPlain(val)} DZD`,
                      name,
                    ]}
                  />
                  {/* Manual legend — the shared recharts test mocks predate
                      <Legend> and mock it away per-file; a hand-rolled row
                      avoids forcing every mock to grow (scope control). */}
                  <Bar
                    dataKey="actualPaid"
                    name="Réalisé (versements)"
                    fill={chartPalette.primary}
                    radius={[3, 3, 0, 0]}
                    barSize={16}
                  />
                  <Bar
                    dataKey="projectedCost"
                    name="Projeté (prévision)"
                    fill={chartPalette.slate}
                    fillOpacity={0.55}
                    stroke={chartPalette.slate}
                    strokeDasharray="4 2"
                    radius={[3, 3, 0, 0]}
                    barSize={16}
                  />
                  <Line
                    type="monotone"
                    dataKey="fundingRequirement"
                    name="Besoin de financement"
                    stroke={chartPalette.warning}
                    strokeWidth={2}
                    dot={{ r: 2.5 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* Manual legend — same colors as the chart series. */}
            <div className="flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="h-2.5 w-2.5 rounded-sm"
                  style={{ backgroundColor: chartPalette.primary }}
                />
                Réalisé (versements)
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="h-2.5 w-2.5 rounded-sm"
                  style={{
                    backgroundColor: chartPalette.slate,
                    opacity: 0.55,
                    border: `1px dashed ${chartPalette.slate}`,
                  }}
                />
                Projeté (prévision)
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="h-0.5 w-3 rounded-full"
                  style={{ backgroundColor: chartPalette.warning }}
                />
                Besoin de financement
              </span>
            </div>

            {/* Summary strip — the canonical totals (single source). */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div className="p-2 rounded-md border border-border bg-surface-elevated/40">
                <span className="text-[10px] uppercase text-muted-foreground block">
                  Réalisé (fenêtre)
                </span>
                <span className="font-mono font-semibold">
                  {formatDzd(trend.totals.actualTotal, { compact: true })}
                </span>
              </div>
              <div className="p-2 rounded-md border border-border bg-surface-elevated/40">
                <span className="text-[10px] uppercase text-muted-foreground block">
                  Projeté (horizon)
                </span>
                <span className="font-mono font-semibold">
                  {formatDzd(trend.totals.projectedTotal, { compact: true })}
                </span>
              </div>
              <div className="p-2 rounded-md border border-status-warning/30 bg-status-warning/5">
                <span className="text-[10px] uppercase text-status-warning block">
                  Pic de besoin
                </span>
                <span className="font-mono font-semibold">
                  {formatDzd(trend.totals.maxFundingRequirement, { compact: true })}
                </span>
              </div>
              <div className="p-2 rounded-md border border-border bg-surface-elevated/40">
                <span className="text-[10px] uppercase text-muted-foreground block">
                  Coût mensuel projeté
                </span>
                <span className="font-mono font-semibold">
                  {formatDzd(trend.totals.projectedMonthlyPayroll, { compact: true })}
                </span>
              </div>
            </div>

            <p className="text-[10px] text-muted-foreground">
              Réalisé = versements enregistrés (salary_payments) · Projeté =
              salaires de base actuels (les primes futures ne sont pas
              prévisibles) · Besoin = masse salariale moins fonds sécurisés.
            </p>
          </>
        )}

        {/* Cross-page summary — the Personnel operational view. */}
        <div className="flex justify-end">
          {inRouter ? (
            <PersonnelLinkButton />
          ) : (
            <a
              href="/personnel"
              className="inline-flex items-center h-7 px-3 text-xs rounded-md border border-input bg-background hover:bg-accent/5"
              data-testid="link-personnel-payroll-trend"
            >
              Détail des vagues de paie — Personnel
            </a>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/** SPA-navigation variant (rendered only inside a Router context). */
function PersonnelLinkButton() {
  const navigate = useNavigate();
  return (
    <Button
      size="sm"
      variant="outline"
      className="h-7 text-xs"
      onClick={() => navigate("/personnel")}
      data-testid="link-personnel-payroll-trend"
    >
      Détail des vagues de paie — Personnel
    </Button>
  );
}
