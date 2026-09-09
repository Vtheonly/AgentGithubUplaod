/**
 * YoYComparisonCard — the like-for-like year-over-year comparison
 * (T-257, 38th session — UI-307): grouped bars per month — current
 * academic year vs the PREVIOUS year's same-month window (the page loads
 * the previous series via revenueForRange on the shifted range — REAL
 * repository data, never a synthesized baseline).
 *
 * The header carries the period verdict: Σ current vs Σ previous + the
 * global delta (null → "—" when the previous window has no activity —
 * §15.16: a divide-by-zero is not a trend). The card renders its honest
 * unavailable state when the page could not load a previous-year series
 * (earliest available year selected).
 */
import { ArrowRight } from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../../../../shared/ui/card";
import { DASHBOARD_THEME, chartPalette } from "../../../../shared/ui/dashboard-theme";
import { formatDzd, formatDzdPlain } from "../../../../core/format/currency";
import type { RevenuePoint } from "../../../../domain/model/operations";
import { deriveYearOverYear } from "./analytics-derivations";

export function YoYComparisonCard({
  currentYear,
  previousYear,
  revenue,
  prevRevenue,
}: {
  /** e.g. "2025-2026" (display only). */
  currentYear: string;
  /** e.g. "2024-2025" (display only). */
  previousYear: string | null;
  revenue: readonly RevenuePoint[];
  prevRevenue: readonly RevenuePoint[];
}) {
  const summary = deriveYearOverYear(revenue, prevRevenue);
  const hasPrevious = prevRevenue.length > 0;
  const anyPreviousActivity = summary.totalPrevious > 0;

  return (
    <Card className="border-border bg-surface-panel h-full flex flex-col">
      <CardHeader className="py-2.5 px-4 border-b border-border/50">
        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <ArrowRight className="h-3.5 w-3.5 text-primary" />
          Comparatif Annuel (N vs N−1)
        </CardTitle>
        <CardDescription className="text-xs text-foreground">
          {hasPrevious ? (
            <>
              {currentYear} : {formatDzd(summary.totalCurrent, { compact: true })}
              <span className="text-muted-foreground">
                {" "}vs {previousYear} : {formatDzd(summary.totalPrevious, { compact: true })}
              </span>
              {summary.deltaPercent !== null && (
                <span
                  className={`ml-2 font-mono ${
                    summary.deltaPercent >= 0 ? "text-status-success" : "text-status-danger"
                  }`}
                >
                  {summary.deltaPercent >= 0 ? "▲" : "▼"} {Math.abs(summary.deltaPercent)}%
                </span>
              )}
            </>
          ) : (
            "Comparaison avec l'année scolaire précédente"
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-2 flex-1">
        {!hasPrevious ? (
          <p className="text-xs text-muted-foreground text-center py-10" data-testid="yoy-unavailable">
            Aucune année précédente disponible dans le référentiel
            ({currentYear} est la première année sélectionnable).
          </p>
        ) : revenue.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-10" data-testid="yoy-empty">
            Aucun encaissement sur la période sélectionnée.
          </p>
        ) : (
          <div className="h-[228px] w-full" data-testid="yoy-chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={summary.points}
                margin={{ top: 10, right: 5, bottom: 0, left: -12 }}
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
                  tickFormatter={(v: number) => `${Math.round(Number(v) / 1000)}k`}
                />
                <Tooltip
                  contentStyle={DASHBOARD_THEME.tooltipStyle}
                  formatter={(val: number, name: string, entry: { payload?: { deltaPercent: number | null } }) => {
                    const delta = entry?.payload?.deltaPercent;
                    const deltaStr = delta === null || delta === undefined ? "n/a" : `${delta >= 0 ? "+" : ""}${delta}%`;
                    return [
                      `${formatDzdPlain(val)} DZD`,
                      `${name} · ${deltaStr}`,
                    ];
                  }}
                />
                <Bar
                  dataKey="previous"
                  name={`N−1 (${previousYear})`}
                  fill={chartPalette.slate}
                  radius={[3, 3, 0, 0]}
                />
                <Bar
                  dataKey="current"
                  name={`N (${currentYear})`}
                  fill={chartPalette.primaryDeep}
                  radius={[3, 3, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        {hasPrevious && !anyPreviousActivity && revenue.length > 0 && (
          <p className="mt-1 text-[10px] text-muted-foreground text-center">
            L'année N−1 n'a aucun encaissement sur les mêmes mois — aucune
            évolution calculable (honnêteté §15.16).
          </p>
        )}
      </CardContent>
    </Card>
  );
}
