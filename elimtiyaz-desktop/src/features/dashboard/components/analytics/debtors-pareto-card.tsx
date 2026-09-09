/**
 * DebtorsParetoCard — the 80/20 Pareto chart (T-257, 38th session —
 * UI-307): top debtors as bars (outstanding, desc) + the cumulative-share
 * line on a right 0–100% axis. The classic recouvrement question — "how
 * many families carry most of the debt?" — answered from the REAL
 * topDebtors summary (the page's single-fetch pipeline; no re-fetch).
 *
 * The header carries the honest Pareto verdict: the minimum number of
 * families covering ≥80% of the displayed outstanding (derived, never
 * rounded up by hand), and the 80/20 callout when it applies.
 */
import { useMemo } from "react";
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
import { Users } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../../../../shared/ui/card";
import { DASHBOARD_THEME, chartPalette } from "../../../../shared/ui/dashboard-theme";
import { formatDzd, formatDzdPlain } from "../../../../core/format/currency";
import type { DebtSummary } from "../../../../domain/model/payment";
import { derivePareto } from "./analytics-derivations";

export function DebtorsParetoCard({ topDebtors }: { topDebtors: DebtSummary[] }) {
  const data = useMemo(() => derivePareto(topDebtors), [topDebtors]);
  const displayedTotal = data.reduce((s, d) => s + d.amount, 0);

  // The Pareto verdict — smallest prefix whose cumulative share ≥ 80%.
  const paretoCut = data.findIndex((d) => d.cumPercent >= 80) + 1;

  // Short display names (first + last initial) so bars stay readable.
  const chartData = data.map((d) => ({ ...d, short: shortName(d.name) }));

  return (
    <Card className="border-border bg-surface-panel h-full flex flex-col">
      <CardHeader className="py-2.5 px-4 border-b border-border/50">
        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Users className="h-3.5 w-3.5 text-primary" />
          Pareto des Débiteurs
        </CardTitle>
        <CardDescription className="text-xs text-muted-foreground">
          {data.length > 0 ? (
            <>
              Top {data.length} familles · {formatDzd(displayedTotal, { compact: true })}
              {paretoCut > 0 && (
                <span className="ml-1 font-mono text-status-warning">
                  · {paretoCut} fam. = 80% de l'encours affiché
                </span>
              )}
            </>
          ) : (
            "Concentration de l'impayé par famille"
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-2 flex-1">
        {data.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-10" data-testid="pareto-empty">
            Aucun débiteur (aucune créance ouverte).
          </p>
        ) : (
          <div className="h-[228px] w-full" data-testid="pareto-chart">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 10, right: 0, bottom: 0, left: -10 }}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke={DASHBOARD_THEME.gridStroke}
                  vertical={false}
                />
                <XAxis
                  dataKey="short"
                  {...DASHBOARD_THEME.axisTick}
                  axisLine={false}
                  tickLine={false}
                  interval={0}
                  angle={-28}
                  textAnchor="end"
                  height={44}
                />
                <YAxis
                  yAxisId="amount"
                  {...DASHBOARD_THEME.axisTick}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) => `${Math.round(v / 1000)}k`}
                />
                <YAxis
                  yAxisId="percent"
                  orientation="right"
                  domain={[0, 100]}
                  {...DASHBOARD_THEME.axisTick}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) => `${v}%`}
                />
                <Tooltip
                  contentStyle={DASHBOARD_THEME.tooltipStyle}
                  formatter={(val: number, name: string, entry: { payload?: { name?: string; cumPercent?: number } }) => {
                    if (name === "amount") {
                      return [`${formatDzdPlain(val)} DZD`, `Encours — ${entry?.payload?.name ?? ""}`];
                    }
                    return [`${val}%`, "Part cumulée"];
                  }}
                />
                <Bar
                  yAxisId="amount"
                  dataKey="amount"
                  fill={chartPalette.danger}
                  radius={[4, 4, 0, 0]}
                  barSize={22}
                />
                <Line
                  yAxisId="percent"
                  dataKey="cumPercent"
                  type="monotone"
                  stroke={chartPalette.gold}
                  strokeWidth={2}
                  dot={{ r: 2.5, fill: chartPalette.gold }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** "Famille BENALI Karim" → "F. BENALI" (bar labels stay compact). */
function shortName(full: string): string {
  const trimmed = full.replace(/^Famille\s+/i, "").trim();
  const parts = trimmed.split(/\s+/);
  if (parts.length === 0) return trimmed;
  const initial = parts[0].charAt(0).toUpperCase();
  const lastName = parts[parts.length - 1];
  return `${initial}. ${lastName}`;
}
