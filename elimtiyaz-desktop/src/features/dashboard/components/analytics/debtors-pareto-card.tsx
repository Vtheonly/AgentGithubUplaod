// ============================================================================
// FILE: elimtiyaz-desktop/src/features/dashboard/components/analytics/debtors-pareto-card.tsx
// ============================================================================

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
import {
  DASHBOARD_THEME,
  chartPalette,
} from "../../../../shared/ui/dashboard-theme";
import { formatDzd, formatDzdPlain } from "../../../../core/format/currency";
import type { DebtSummary } from "../../../../domain/model/payment";
import { derivePareto } from "./analytics-derivations";

function shortName(full: string): string {
  const trimmed = full.replace(/^Famille\s+/i, "").trim();
  const parts = trimmed.split(/\s+/);
  if (parts.length === 0) return trimmed;
  const initial = parts[0].charAt(0).toUpperCase();
  const lastName = parts[parts.length - 1];
  return `${initial}. ${lastName}`;
}

export function DebtorsParetoCard({
  topDebtors,
}: {
  topDebtors: DebtSummary[];
}) {
  const data = useMemo(() => derivePareto(topDebtors), [topDebtors]);
  const displayedTotal = data.reduce((s, d) => s + d.amount, 0);
  const paretoCut = data.findIndex((d) => d.cumPercent >= 80) + 1;
  const chartData = data.map((d) => ({ ...d, short: shortName(d.name) }));

  return (
    <Card
      className="border-border/70 bg-surface-panel shadow-sm h-full flex flex-col justify-between"
      data-testid="debtors-pareto-card"
    >
      <CardHeader className="py-3 px-4 border-b border-border/50 flex flex-row items-center justify-between flex-wrap gap-2">
        <div>
          <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Users className="h-4 w-4 text-status-danger" />
            Distribution Pareto des Créances (Règle des 80/20)
          </CardTitle>
          <CardDescription className="text-xs text-muted-foreground">
            Concentration cumulée des impayés par tuteur
          </CardDescription>
        </div>

        {paretoCut > 0 && (
          <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-full bg-status-warning/15 text-status-warning border border-status-warning/30">
            {paretoCut} foyer(s) = 80% de l'encours
          </span>
        )}
      </CardHeader>

      <CardContent className="p-4 flex-1">
        {data.length === 0 ? (
          <p
            className="text-xs text-muted-foreground text-center py-10"
            data-testid="pareto-empty"
          >
            Aucun débiteur identifié sur la période active.
          </p>
        ) : (
          <div className="h-[230px] w-full" data-testid="pareto-chart">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={chartData}
                margin={{ top: 10, right: 0, bottom: 0, left: -10 }}
              >
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
                  angle={-25}
                  textAnchor="end"
                  height={45}
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
                  formatter={(
                    val: number,
                    name: string,
                    entry: { payload?: { name?: string } },
                  ) => {
                    if (name === "amount") {
                      return [
                        `${formatDzdPlain(val)} DZD`,
                        entry?.payload?.name ?? "Dette",
                      ];
                    }
                    return [`${val}%`, "Part cumulée"];
                  }}
                />
                <Bar
                  yAxisId="amount"
                  dataKey="amount"
                  fill={chartPalette.danger}
                  radius={[4, 4, 0, 0]}
                  barSize={20}
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
